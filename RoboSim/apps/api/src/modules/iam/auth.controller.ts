import {
  changePasswordRequestSchema,
  CSRF_COOKIE,
  DomainError,
  loginRequestSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  SESSION_COOKIE,
  tokenRequestSchema,
  updateMeRequestSchema,
  type ChangePasswordRequest,
  type CsrfResponse,
  type DevMail,
  type LoginRequest,
  type Me,
  type PasswordResetConfirm,
  type PasswordResetRequest,
  type RegisterRequest,
  type SessionList,
  type TokenRequest,
  type UpdateMeRequest,
} from '@robosim/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FixedWindowRateLimiter } from '../../common/rate-limiter.js';
import { ENV, type Env } from '../../config/env.js';
import { AuthService } from './auth.service.js';
import { CallerGuard, CallerScope, type Caller } from './caller.guard.js';
import { randomSecret, readCookie, setHostCookie } from './http-identity.js';
import { DevMailSink, MAILER, type Mailer } from './mailer.js';
import { SESSION_IDLE_MS, SessionsService, type ClientInfo } from './sessions.service.js';

const SESSION_MAX_AGE = Math.floor(SESSION_IDLE_MS / 1000);
/** The CSRF cookie outlives sessions; it carries no authority on its own. */
const CSRF_MAX_AGE = 365 * 86_400;

function clientOf(request: FastifyRequest): ClientInfo {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

/** API Spec §4.1 (IAM): sign-up, sign-in, sign-out and account recovery. All `POST`s need `X-CSRF-Token`. */
@Controller('auth')
export class AuthController {
  private readonly limiter: FixedWindowRateLimiter;

  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) env: Env,
  ) {
    this.limiter = new FixedWindowRateLimiter(env.AUTH_RATE_LIMIT_PER_MIN, 60_000);
  }

  /** Reuses the browser's CSRF cookie when it has one, so open tabs keep working. */
  @Get('csrf')
  csrf(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): CsrfResponse {
    const token = readCookie(req, CSRF_COOKIE) ?? randomSecret();
    setHostCookie(reply, CSRF_COOKIE, token, CSRF_MAX_AGE);
    return { token };
  }

  @Post('register')
  @HttpCode(201)
  async register(
    @Body({ schema: registerRequestSchema }) body: RegisterRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Me> {
    this.throttle(req, reply);
    const { me, session } = await this.auth.register(body, clientOf(req));
    setHostCookie(reply, SESSION_COOKIE, session.secret, SESSION_MAX_AGE);
    return me;
  }

  /** A previous session cookie is revoked: every sign-in starts a new session (fixation defence). */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body({ schema: loginRequestSchema }) body: LoginRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Me> {
    this.throttle(req, reply);
    try {
      const { me, session } = await this.auth.login(body, clientOf(req));
      await this.auth.logout(readCookie(req, SESSION_COOKIE));
      setHostCookie(reply, SESSION_COOKIE, session.secret, SESSION_MAX_AGE);
      return me;
    } catch (error) {
      if (error instanceof DomainError && error.code === 'account_locked')
        void reply.header('Retry-After', String(error.params?.['retryAfterSeconds'] ?? 900));
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.auth.logout(readCookie(req, SESSION_COOKIE));
    setHostCookie(reply, SESSION_COOKIE, '', 0);
  }

  @Post('email/verify')
  @HttpCode(204)
  async verifyEmail(
    @Body({ schema: tokenRequestSchema }) body: TokenRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    this.throttle(req, reply);
    await this.auth.verifyEmail(body.token);
  }

  @Post('email/resend')
  @HttpCode(204)
  @UseGuards(CallerGuard)
  async resendVerification(
    @CallerScope() caller: Caller,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    this.throttle(req, reply);
    await this.auth.resendVerification(caller);
  }

  /** `202` whether or not the email is registered (no account enumeration). */
  @Post('password-reset/request')
  @HttpCode(202)
  async requestReset(
    @Body({ schema: passwordResetRequestSchema }) body: PasswordResetRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    this.throttle(req, reply);
    await this.auth.requestPasswordReset(body.email);
  }

  @Post('password-reset/confirm')
  @HttpCode(204)
  async confirmReset(
    @Body({ schema: passwordResetConfirmSchema }) body: PasswordResetConfirm,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    this.throttle(req, reply);
    await this.auth.confirmPasswordReset(body);
  }

  private throttle(req: FastifyRequest, reply: FastifyReply): void {
    const rate = this.limiter.take(`ip:${req.ip}`);
    void reply.header('RateLimit-Limit', String(rate.limit));
    void reply.header('RateLimit-Remaining', String(rate.remaining));
    void reply.header('RateLimit-Reset', String(rate.resetSeconds));
    if (!rate.allowed) {
      void reply.header('Retry-After', String(rate.resetSeconds));
      throw new DomainError('rate_limited');
    }
  }
}

/** API Spec §4.1 (`/me`): the signed-in user's profile, password and sessions (FR-IAM-03, US-IAM-02). */
@Controller('me')
@UseGuards(CallerGuard)
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Get()
  me(@CallerScope() caller: Caller): Promise<Me> {
    return this.auth.me(caller);
  }

  @Patch()
  update(
    @CallerScope() caller: Caller,
    @Body({ schema: updateMeRequestSchema }) body: UpdateMeRequest,
  ): Promise<Me> {
    return this.auth.updateMe(caller, body);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CallerScope() caller: Caller,
    @Body({ schema: changePasswordRequestSchema }) body: ChangePasswordRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const session = await this.auth.changePassword(caller, body, clientOf(req));
    if (session) setHostCookie(reply, SESSION_COOKIE, session.secret, SESSION_MAX_AGE);
  }

  @Get('sessions')
  async list(@CallerScope() caller: Caller): Promise<SessionList> {
    return { items: await this.sessions.list(caller, caller.sessionId) };
  }

  /** Revoking the current session signs this browser out too. */
  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(
    @CallerScope() caller: Caller,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.revoke(caller, id);
    if (id === caller.sessionId) setHostCookie(reply, SESSION_COOKIE, '', 0);
  }

  /** "Sign out everywhere else": every session but the one making the request. */
  @Delete('sessions')
  @HttpCode(204)
  async revokeOthers(@CallerScope() caller: Caller): Promise<void> {
    await this.sessions.revokeAll(caller.userId, caller.sessionId);
  }
}

/** Development mail sink (local and test only): `404` elsewhere, as if the route did not exist. */
@Controller('dev/mail')
export class DevMailController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  @Get()
  list(@Query('to') to: string | undefined): { items: DevMail[] } {
    if (!this.env.devEndpoints || !(this.mailer instanceof DevMailSink)) throw new DomainError('not_found');
    return { items: this.mailer.list(to?.trim().toLowerCase() || undefined) };
  }
}
