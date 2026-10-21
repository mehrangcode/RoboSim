import { describe, expect, it } from 'vitest';
import { assertAcceptablePassword, hashPassword, needsRehash, verifyPassword } from './password.js';

describe('password hashing (Security §9: argon2id m=64 MiB, t=3, p=1)', () => {
  it('hashes to a salted PHC string that verifies only the same password', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse batterY', a)).toBe(false);
    expect(needsRehash(a)).toBe(false);
  });

  it('treats malformed or weaker hashes as non-matching or stale', async () => {
    expect(await verifyPassword('x', 'plaintext')).toBe(false);
    expect(needsRehash('$argon2id$v=19$m=4096,t=1,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAA')).toBe(true);
  });

  it('rejects common passwords and passwords containing the email name', () => {
    expect(() => assertAcceptablePassword('Password123', 'sara@example.com')).toThrow();
    expect(() => assertAcceptablePassword('sara.rahimi-99', 'sara.rahimi@example.com')).toThrow();
    expect(() => assertAcceptablePassword('green lamp 42', 'sara@example.com')).not.toThrow();
  });
});
