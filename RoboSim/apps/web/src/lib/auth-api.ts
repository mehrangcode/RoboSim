import {
  devMailListSchema,
  meSchema,
  sessionListSchema,
  type ChangePasswordRequest,
  type DevMail,
  type LoginRequest,
  type Me,
  type RegisterRequest,
  type SessionInfo,
  type UpdateMeRequest,
} from '@robosim/shared';
import { ApiError, apiGet, apiSend } from './api.js';

/** The auth API (API Spec §2, §4.1) as the web app uses it; injectable so pages can be tested without HTTP. */
export interface AuthClient {
  /** The signed-in user, or `null` when there is no session. */
  me(): Promise<Me | null>;
  register(input: RegisterRequest): Promise<Me>;
  login(input: LoginRequest): Promise<Me>;
  logout(): Promise<void>;
  verifyEmail(token: string): Promise<void>;
  resendVerification(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(token: string, password: string): Promise<void>;
  updateMe(input: UpdateMeRequest): Promise<Me>;
  changePassword(input: ChangePasswordRequest): Promise<void>;
  sessions(): Promise<SessionInfo[]>;
  revokeSession(id: string): Promise<void>;
  revokeOtherSessions(): Promise<void>;
  devMail(): Promise<DevMail[]>;
}

/** `locale` may be a getter, so one client follows language switches. */
export function authApi(locale: string | (() => string)): AuthClient {
  const lang = typeof locale === 'function' ? locale : () => locale;
  const post = (path: string, body?: unknown) => apiSend<unknown>('POST', path, body, lang());
  return {
    me: async () => {
      try {
        const parsed = meSchema.safeParse(await apiGet('/me', lang()));
        return parsed.success ? parsed.data : null;
      } catch (e) {
        if (e instanceof ApiError && e.problem.code === 'unauthenticated') return null;
        throw e;
      }
    },
    register: async (input) => meSchema.parse(await post('/auth/register', input)),
    login: async (input) => meSchema.parse(await post('/auth/login', input)),
    logout: async () => void (await post('/auth/logout')),
    verifyEmail: async (token) => void (await post('/auth/email/verify', { token })),
    resendVerification: async () => void (await post('/auth/email/resend')),
    requestPasswordReset: async (email) => void (await post('/auth/password-reset/request', { email })),
    confirmPasswordReset: async (token, password) =>
      void (await post('/auth/password-reset/confirm', { token, password })),
    updateMe: async (input) => meSchema.parse(await apiSend('PATCH', '/me', input, lang())),
    changePassword: async (input) => void (await post('/me/password', input)),
    sessions: async () => sessionListSchema.parse(await apiGet('/me/sessions', lang())).items,
    revokeSession: async (id) =>
      void (await apiSend('DELETE', `/me/sessions/${encodeURIComponent(id)}`, undefined, lang())),
    revokeOtherSessions: async () => void (await apiSend('DELETE', '/me/sessions', undefined, lang())),
    devMail: async () => devMailListSchema.parse(await apiGet('/dev/mail', lang())).items,
  };
}
