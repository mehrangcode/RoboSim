import { CSRF_COOKIE, CSRF_HEADER, DomainError, SESSION_COOKIE } from '@robosim/shared';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { readCookie, safeEqual } from './http-identity.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF check (API Spec §2, Security §3). `GET /auth/csrf` sets `__Host-rs_csrf` and returns the
 * same value, which unsafe requests echo in `X-CSRF-Token`. A cross-site page can make the browser send the
 * cookie but cannot read it. It applies where ambient credentials exist (a session cookie) and to every
 * `/auth/*` call, which blocks login CSRF too. Header-only clients (tests, scripts) carry no cookie to abuse.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;
    const path = request.url.split('?')[0] ?? '';
    const needsCheck = readCookie(request, SESSION_COOKIE) !== undefined || path.startsWith('/api/v1/auth/');
    if (!needsCheck) return true;
    const cookie = readCookie(request, CSRF_COOKIE);
    const header = request.headers[CSRF_HEADER];
    if (!cookie || typeof header !== 'string' || !safeEqual(cookie, header))
      throw new DomainError('csrf_failed');
    return true;
  }
}
