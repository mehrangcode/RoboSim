import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DomainError } from '@robosim/shared';

const argon2Async = promisify(argon2);

/** Security §9: argon2id, m = 64 MiB, t = 3, p = 1. Parameters travel in the PHC string, so they can change. */
export const ARGON2_PARAMS = { memory: 65_536, passes: 3, parallelism: 1 } as const;
const TAG_LENGTH = 32;
const SALT_LENGTH = 16;

async function derive(
  password: string,
  salt: Buffer,
  params: { memory: number; passes: number; parallelism: number },
): Promise<Buffer> {
  return argon2Async('argon2id', { message: password, nonce: salt, tagLength: TAG_LENGTH, ...params });
}

/** `$argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>` (unpadded base64, as in the reference implementation). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, ARGON2_PARAMS);
  const { memory: m, passes: t, parallelism: p } = ARGON2_PARAMS;
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(hash)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC.exec(stored);
  if (!match) return false;
  const [, m, t, p, salt = '', hash = ''] = match;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), {
    memory: Number(m),
    passes: Number(t),
    parallelism: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Whether a stored hash uses weaker parameters than today's, so it is re-hashed on the next sign-in. */
export function needsRehash(stored: string): boolean {
  const match = PHC.exec(stored);
  if (!match) return true;
  return (
    Number(match[1]) < ARGON2_PARAMS.memory ||
    Number(match[2]) < ARGON2_PARAMS.passes ||
    Number(match[3]) !== ARGON2_PARAMS.parallelism
  );
}

/** A real hash of a random password: sign-in for an unknown email spends the same time as a wrong password. */
let decoy: Promise<string> | undefined;
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(16).toString('hex'));
  return decoy;
}

function b64(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=+$/, '');
}

/**
 * The most common passwords that pass the length rule (from public breach corpora). Stand-in for the offline
 * k-anonymity breached-password list (Security §3), which ships with the deployment track.
 */
const COMMON_PASSWORDS = new Set([
  '1234567890',
  '0123456789',
  '1q2w3e4r5t',
  'qwertyuiop',
  'password123',
  'password1234',
  'password12345',
  'iloveyou123',
  'qwerty12345',
  'qwerty123456',
  '1234qwerty',
  'qwer1234asdf',
  'zxcvbnm123',
  'abcdefghij',
  'abc1234567',
  'football123',
  'princess123',
  'sunshine123',
  'welcome123',
  'admin12345',
  'letmein123',
  'baseball123',
  'superman123',
  'starwars123',
  'passw0rd123',
  'p@ssw0rd123',
  'robosim123',
  'robosim1234',
  'arduino123',
  'arduino1234',
  '0987654321',
  '1029384756',
  'aa12345678',
  'a123456789',
  'q123456789',
  'asdfghjkl1',
  'iran123456',
  'tehran1234',
]);

/** Rules the schema cannot check alone (Security §3): common passwords and passwords built from the email. */
export function assertAcceptablePassword(password: string, email: string): void {
  const lower = password.toLowerCase();
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (COMMON_PASSWORDS.has(lower))
    throw new DomainError('validation_failed', { errors: [{ path: 'password', message: 'common' }] });
  if (local.length >= 4 && lower.includes(local))
    throw new DomainError('validation_failed', { errors: [{ path: 'password', message: 'contains_email' }] });
}
