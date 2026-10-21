import { z } from 'zod';
import { ageBandSchema } from './workspace.js';
import { localeSchema } from './locale.js';

/** Authentication API contract (API Spec §2, §4.1; Security §3, §9). Shared by the API and the web client. */

export const AUTH_LIMITS = {
  minPasswordLength: 10,
  /** argon2 hashes any length, but an upper bound keeps hashing cost predictable. */
  maxPasswordLength: 128,
  maxDisplayNameLength: 80,
  /** Sessions end after this long without a request (Security §6.5). */
  sessionIdleDays: 30,
  /** Failed password logins before the account is locked (Security §3). */
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  emailVerifyHours: 48,
  passwordResetMinutes: 30,
} as const;

/** Cookie names (API Spec §2). `__Host-` pins them to this origin, path `/`, and HTTPS. */
export const SESSION_COOKIE = '__Host-rs_sid';
export const CSRF_COOKIE = '__Host-rs_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Length and character mix only; the server also rejects common passwords and ones containing the email. */
export const passwordSchema = z
  .string()
  .min(AUTH_LIMITS.minPasswordLength)
  .max(AUTH_LIMITS.maxPasswordLength)
  .refine((p) => p.trim().length === p.length, { message: 'no leading or trailing spaces' })
  .refine((p) => new Set(p).size >= 4, { message: 'too few distinct characters' });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const token = z.string().min(16).max(128);

export const registerRequestSchema = z.object({
  email: z.string().trim().min(3).max(254),
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(AUTH_LIMITS.maxDisplayNameLength),
  dateOfBirth: isoDate,
  locale: localeSchema.default('en'),
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(AUTH_LIMITS.maxPasswordLength),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const tokenRequestSchema = z.object({ token });
export type TokenRequest = z.infer<typeof tokenRequestSchema>;

export const passwordResetRequestSchema = z.object({ email: z.string().trim().min(3).max(254) });
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({ token, password: passwordSchema });
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(AUTH_LIMITS.maxPasswordLength),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const updateMeRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(AUTH_LIMITS.maxDisplayNameLength),
    locale: localeSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;

export const USER_STATUSES = ['pending_consent', 'active', 'suspended', 'deleted'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);

export const meSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  displayName: z.string(),
  locale: localeSchema,
  ageBand: ageBandSchema,
  status: userStatusSchema,
  personalWorkspaceId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type Me = z.infer<typeof meSchema>;

export const sessionInfoSchema = z.object({
  id: z.uuid(),
  current: z.boolean(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  /** Coarse device description from the User-Agent ("Firefox on Linux"); never the raw header. */
  device: z.string(),
  ip: z.string().nullable(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export const sessionListSchema = z.object({ items: z.array(sessionInfoSchema) });
export type SessionList = z.infer<typeof sessionListSchema>;

export const csrfResponseSchema = z.object({ token: z.string() });
export type CsrfResponse = z.infer<typeof csrfResponseSchema>;

/** A message captured by the development mail sink (`GET /dev/mail`, local and test only). */
export const devMailSchema = z.object({
  id: z.string(),
  to: z.string(),
  subject: z.string(),
  text: z.string(),
  /** The action link in the message (verify / reset), for one-click use in development. */
  link: z.string().nullable(),
  sentAt: z.iso.datetime(),
});
export type DevMail = z.infer<typeof devMailSchema>;
export const devMailListSchema = z.object({ items: z.array(devMailSchema) });
