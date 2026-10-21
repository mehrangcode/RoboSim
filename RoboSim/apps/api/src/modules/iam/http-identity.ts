import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** 256-bit secret for session cookies, CSRF tokens and emailed links (base64url, 43 characters). */
export function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Sessions and one-time tokens are stored as this hash; a database leak does not reveal usable secrets. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value || undefined;
  }
  return undefined;
}

/**
 * Sets a `__Host-` cookie (API Spec §2): Secure, path `/`, no Domain. Browsers accept Secure cookies on
 * `http://localhost`, so development needs no TLS. `maxAgeSeconds` 0 deletes the cookie.
 */
export function setHostCookie(reply: FastifyReply, name: string, value: string, maxAgeSeconds: number): void {
  const cookie = `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
  const existing = reply.getHeader('set-cookie');
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing : [String(existing)];
  void reply.header('set-cookie', [...list.filter((c) => !c.startsWith(`${name}=`)), cookie]);
}

/** "Firefox on Linux": shown in the sessions list and used to bind a session to its browser family. */
export function describeDevice(userAgent: string | undefined): { family: string; label: string } {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Other';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux|X11/.test(ua)
            ? 'Linux'
            : 'Other';
  return {
    family: browser,
    label: browser === 'Other' && os === 'Other' ? 'Unknown device' : `${browser} on ${os}`,
  };
}
