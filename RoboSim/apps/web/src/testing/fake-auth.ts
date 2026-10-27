import type { DevMail, ErrorCode, Me, SessionInfo } from '@robosim/shared';
import { ApiError } from '../lib/api.js';
import type { AuthClient } from '../lib/auth-api.js';

export const problem = (code: ErrorCode, status: number, params?: Record<string, unknown>) =>
  new ApiError({ type: code, title: code, status, code, requestId: 'test', ...(params ? { params } : {}) });

export const SARA: Me = {
  id: '01920000-0000-7000-8000-000000000001',
  email: 'sara@example.com',
  emailVerified: true,
  displayName: 'Sara',
  locale: 'en',
  ageBand: 'adult',
  status: 'active',
  personalWorkspaceId: '01920000-0000-7000-8000-000000000002',
  createdAt: '2026-10-21T08:00:00.000Z',
  editorTourCompletedAt: '2026-10-21T08:05:00.000Z',
};

/** In-memory auth API: one known account (`sara@example.com` / `green lamp 42`); every call is recorded. */
export class FakeAuth implements AuthClient {
  user: Me | null = null;
  password = 'green lamp 42';
  readonly calls: { method: string; args: unknown[] }[] = [];
  sessionList: SessionInfo[] = [
    {
      id: '01920000-0000-7000-8000-0000000000a1',
      current: true,
      createdAt: '2026-10-21T08:00:00.000Z',
      lastSeenAt: '2026-10-21T09:00:00.000Z',
      expiresAt: '2026-11-20T09:00:00.000Z',
      device: 'Firefox on Linux',
      ip: '127.0.0.1',
    },
    {
      id: '01920000-0000-7000-8000-0000000000a2',
      current: false,
      createdAt: '2026-10-20T08:00:00.000Z',
      lastSeenAt: '2026-10-20T10:00:00.000Z',
      expiresAt: '2026-11-19T10:00:00.000Z',
      device: 'Chrome on Android',
      ip: '10.0.0.7',
    },
  ];

  constructor(signedIn?: Me) {
    this.user = signedIn ?? null;
  }

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }

  me = () => Promise.resolve(this.user);

  register: AuthClient['register'] = async (input) => {
    this.record('register', input);
    if (input.password.toLowerCase().includes('password'))
      throw problem('validation_failed', 400, { errors: [{ path: 'password', message: 'common' }] });
    this.user = { ...SARA, email: input.email, displayName: input.displayName, emailVerified: false };
    return this.user;
  };

  login: AuthClient['login'] = async (input) => {
    this.record('login', input);
    if (input.email !== SARA.email || input.password !== this.password)
      throw problem('invalid_credentials', 401);
    this.user = SARA;
    return SARA;
  };

  logout = async () => {
    this.record('logout');
    this.user = null;
  };

  verifyEmail = async (token: string) => {
    this.record('verifyEmail', token);
    if (token !== 'good-token-0123456789') throw problem('gone', 410);
    if (this.user) this.user = { ...this.user, emailVerified: true };
  };

  resendVerification = async () => this.record('resendVerification');
  requestPasswordReset = async (email: string) => this.record('requestPasswordReset', email);
  confirmPasswordReset = async (token: string, password: string) => {
    this.record('confirmPasswordReset', token, password);
    this.password = password;
  };

  updateMe: AuthClient['updateMe'] = async (input) => {
    this.record('updateMe', input);
    if (!this.user) throw problem('unauthenticated', 401);
    this.user = {
      ...this.user,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
      ...(input.editorTourCompleted
        ? { editorTourCompletedAt: this.user.editorTourCompletedAt ?? '2026-10-27T08:00:00.000Z' }
        : {}),
    };
    return this.user;
  };

  changePassword: AuthClient['changePassword'] = async (input) => {
    this.record('changePassword', input);
    if (input.currentPassword !== this.password) throw problem('invalid_credentials', 401);
    this.password = input.newPassword;
  };

  sessions = async () => this.sessionList;
  revokeSession = async (id: string) => {
    this.record('revokeSession', id);
    this.sessionList = this.sessionList.filter((s) => s.id !== id);
  };
  revokeOtherSessions = async () => {
    this.record('revokeOtherSessions');
    this.sessionList = this.sessionList.filter((s) => s.current);
  };
  devMail = async (): Promise<DevMail[]> => [];
}
