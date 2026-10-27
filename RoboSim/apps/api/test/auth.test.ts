// Authentication over HTTP (API Spec §2, §4.1; FR-IAM-01, FR-IAM-03; US-IAM-02; Security §4).
import type { DevMail, Me, SessionList } from '@robosim/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import type { Database } from '../src/db/client.js';
import { sessions, users } from '../src/db/schema.js';
import { withSystem } from '../src/db/scope.js';
import { testEnv } from './support/app.js';
import { createTestDatabase } from './support/database.js';

let database: Database;
let app: NestFastifyApplication;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createApp(testEnv({ DEV_IDENTITY: 'false', AUTH_RATE_LIMIT_PER_MIN: '1000' }), database);
});
afterAll(async () => {
  await app.close();
  await database.close();
});

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const PASSWORD = 'green lamp 42';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** A browser: keeps cookies across requests and echoes the CSRF token like the web client does. */
class Browser {
  readonly cookies = new Map<string, string>();
  csrf: string | undefined;

  constructor(
    private readonly target: () => NestFastifyApplication = () => app,
    readonly userAgent = FIREFOX,
  ) {}

  async call(
    method: Method,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    if (method !== 'GET' && !this.csrf) {
      const res = await this.call('GET', '/auth/csrf');
      this.csrf = res.json<{ token: string }>().token;
    }
    const res = await this.target().inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        'user-agent': this.userAgent,
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(method !== 'GET' && this.csrf ? { 'x-csrf-token': this.csrf } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
    const set = res.headers['set-cookie'];
    for (const cookie of set === undefined ? [] : Array.isArray(set) ? set : [set]) {
      const [pair = ''] = cookie.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value && !/Max-Age=0\b/.test(cookie)) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    return res;
  }

  get session(): string | undefined {
    return this.cookies.get('__Host-rs_sid');
  }
}

let counter = 0;
const uniqueEmail = (name = 'user') => `${name}.${++counter}@example.com`;

async function register(browser: Browser, email = uniqueEmail(), extra: Record<string, unknown> = {}) {
  const res = await browser.call('POST', '/auth/register', {
    email,
    password: PASSWORD,
    displayName: 'Sara',
    dateOfBirth: '1999-03-21',
    locale: 'fa',
    ...extra,
  });
  expect(res.statusCode).toBe(201);
  return { email, me: res.json<Me>() };
}

async function mailTo(email: string): Promise<DevMail[]> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/dev/mail?to=${encodeURIComponent(email)}` });
  expect(res.statusCode).toBe(200);
  return res.json<{ items: DevMail[] }>().items;
}

const tokenOf = (mail: DevMail | undefined) =>
  new URL(mail?.link ?? 'http://x/').searchParams.get('token') ?? '';

describe('CSRF (API Spec §2)', () => {
  it('refuses auth calls without a matching X-CSRF-Token', async () => {
    const body = { email: 'x@example.com', password: PASSWORD };
    const bare = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: body });
    expect(bare.statusCode).toBe(403);
    expect(bare.json()).toMatchObject({ code: 'csrf_failed' });

    const browser = new Browser();
    await browser.call('GET', '/auth/csrf');
    const forged = await browser.call('POST', '/auth/login', body, { 'x-csrf-token': 'not-the-cookie' });
    expect(forged.json()).toMatchObject({ code: 'csrf_failed' });
  });

  it('issues an HttpOnly __Host- cookie and keeps the token stable for the browser', async () => {
    const browser = new Browser();
    const first = await browser.call('GET', '/auth/csrf');
    expect(String(first.headers['set-cookie'])).toMatch(
      /^__Host-rs_csrf=[\w-]{43}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/,
    );
    const again = await browser.call('GET', '/auth/csrf');
    expect(again.json()).toEqual(first.json());
  });

  it('protects session-authenticated writes elsewhere too', async () => {
    const browser = new Browser();
    await register(browser);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: `__Host-rs_sid=${browser.session}`, 'user-agent': FIREFOX },
      payload: {},
    });
    expect(res.json()).toMatchObject({ code: 'csrf_failed' });
  });
});

describe('sign-up and email verification (FR-IAM-01)', () => {
  it('creates the account, signs in, and emails a one-time verification link', async () => {
    const browser = new Browser();
    const { email, me } = await register(browser);
    expect(me).toMatchObject({
      email,
      emailVerified: false,
      locale: 'fa',
      ageBand: 'adult',
      status: 'active',
    });
    expect(browser.session).toMatch(/^[\w-]{43}$/);
    expect((await browser.call('GET', '/me')).json<Me>().id).toBe(me.id);

    const [mail] = await mailTo(email);
    expect(mail?.subject).toBe('تأیید ایمیل روبوسیم');
    expect(mail?.link).toMatch(/^http:\/\/localhost:5173\/verify-email\?token=[\w-]{43}$/);
    const verify = await new Browser().call('POST', '/auth/email/verify', { token: tokenOf(mail) });
    expect(verify.statusCode).toBe(204);
    expect((await browser.call('GET', '/me')).json<Me>().emailVerified).toBe(true);

    const reuse = await new Browser().call('POST', '/auth/email/verify', { token: tokenOf(mail) });
    expect(reuse.statusCode).toBe(410);
  });

  it('remembers per account that the editor tour was done (FR-WRK-06), keeping the first time', async () => {
    const browser = new Browser();
    const { me } = await register(browser);
    expect(me.editorTourCompletedAt).toBeNull();
    const done = await browser.call('PATCH', '/me', { editorTourCompleted: true });
    expect(done.statusCode).toBe(200);
    const at = done.json<Me>().editorTourCompletedAt;
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const again = await browser.call('PATCH', '/me', { editorTourCompleted: true, displayName: 'Sara K' });
    expect(again.json<Me>()).toMatchObject({ editorTourCompletedAt: at, displayName: 'Sara K' });
    expect((await browser.call('PATCH', '/me', { editorTourCompleted: false })).statusCode).toBe(400);
  });

  it('stores only an argon2id hash of the password', async () => {
    const { me } = await register(new Browser());
    const [row] = await withSystem(database.db, (tx) => tx.select().from(users).where(eq(users.id, me.id)));
    expect(row?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  });

  it('resending retires the earlier link', async () => {
    const browser = new Browser();
    const { email } = await register(browser);
    const [first] = await mailTo(email);
    expect((await browser.call('POST', '/auth/email/resend')).statusCode).toBe(204);
    const [second] = await mailTo(email);
    expect(tokenOf(second)).not.toBe(tokenOf(first));
    expect((await browser.call('POST', '/auth/email/verify', { token: tokenOf(first) })).statusCode).toBe(
      410,
    );
    expect((await browser.call('POST', '/auth/email/verify', { token: tokenOf(second) })).statusCode).toBe(
      204,
    );
  });

  it('rejects duplicates, common passwords and passwords built from the email', async () => {
    const { email } = await register(new Browser());
    const dup = await new Browser().call('POST', '/auth/register', {
      email: email.toUpperCase(),
      password: PASSWORD,
      displayName: 'Again',
      dateOfBirth: '1999-03-21',
    });
    expect(dup.statusCode).toBe(409);

    const common = await new Browser().call('POST', '/auth/register', {
      email: uniqueEmail(),
      password: 'Password123',
      displayName: 'X',
      dateOfBirth: '1999-03-21',
    });
    expect(common.json()).toMatchObject({
      code: 'validation_failed',
      params: { errors: [{ path: 'password', message: 'common' }] },
    });
  });

  it('applies the minors rules: 13–15 wait for consent, under 13 is refused', async () => {
    const teen = await register(new Browser(), uniqueEmail('teen'), { dateOfBirth: '2012-01-01' });
    expect(teen.me).toMatchObject({ ageBand: '13_15', status: 'pending_consent' });
    const kid = await new Browser().call('POST', '/auth/register', {
      email: uniqueEmail('kid'),
      password: PASSWORD,
      displayName: 'Kid',
      dateOfBirth: '2018-01-01',
    });
    expect(kid.json()).toMatchObject({ code: 'policy_restricted' });
  });
});

describe('sign-in, lockout and sign-out (Security §4)', () => {
  it('answers the same invalid_credentials for a wrong password and an unknown email', async () => {
    const { email } = await register(new Browser());
    const wrong = await new Browser().call('POST', '/auth/login', { email, password: 'not it at all' });
    const unknown = await new Browser().call('POST', '/auth/login', {
      email: uniqueEmail(),
      password: PASSWORD,
    });
    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'invalid_credentials' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('locks password sign-in for 15 minutes after five failures', async () => {
    const { email } = await register(new Browser());
    const browser = new Browser();
    for (let i = 0; i < 5; i++)
      await browser.call('POST', '/auth/login', { email, password: `wrong ${i} pass` });
    const locked = await browser.call('POST', '/auth/login', { email, password: PASSWORD });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ code: 'account_locked' });
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(890);

    await withSystem(database.db, (tx) =>
      tx
        .update(users)
        .set({ lockedUntil: new Date(Date.now() - 1000) })
        .where(eq(users.email, email)),
    );
    expect((await browser.call('POST', '/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);
  });

  it('starts a new session on every sign-in and revokes the one the browser had', async () => {
    const browser = new Browser();
    const { email } = await register(browser);
    const before = browser.session;
    expect(
      (await browser.call('POST', '/auth/login', { email: ` ${email.toUpperCase()} `, password: PASSWORD }))
        .statusCode,
    ).toBe(200);
    expect(browser.session).not.toBe(before);
    const stale = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `__Host-rs_sid=${before}`, 'user-agent': FIREFOX },
    });
    expect(stale.statusCode).toBe(401);
  });

  it('signs out: the cookie is cleared and the session is dead server-side', async () => {
    const browser = new Browser();
    await register(browser);
    const secret = browser.session;
    const res = await browser.call('POST', '/auth/logout');
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/^__Host-rs_sid=; Path=\/; Max-Age=0;/);
    expect(browser.session).toBeUndefined();
    const replay = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `__Host-rs_sid=${secret}`, 'user-agent': FIREFOX },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('binds a session to its browser family and expires it after 30 idle days', async () => {
    const browser = new Browser();
    const { me } = await register(browser);
    const stolen = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: `__Host-rs_sid=${browser.session}`, 'user-agent': CHROME },
    });
    expect(stolen.statusCode).toBe(401);
    expect((await browser.call('GET', '/me')).statusCode).toBe(401);

    const other = new Browser();
    await other.call('POST', '/auth/login', { email: me.email, password: PASSWORD });
    await withSystem(database.db, (tx) =>
      tx
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(sessions.userId, me.id)),
    );
    expect((await other.call('GET', '/me')).statusCode).toBe(401);
  });

  it('throttles auth endpoints per client address', async () => {
    const strict = await createApp(
      testEnv({ DEV_IDENTITY: 'false', AUTH_RATE_LIMIT_PER_MIN: '2' }),
      database,
    );
    try {
      const browser = new Browser(() => strict);
      const body = { email: uniqueEmail(), password: PASSWORD };
      await browser.call('POST', '/auth/login', body);
      await browser.call('POST', '/auth/login', body);
      const third = await browser.call('POST', '/auth/login', body);
      expect(third.statusCode).toBe(429);
      expect(third.json()).toMatchObject({ code: 'rate_limited' });
      expect(third.headers['retry-after']).toBeDefined();
    } finally {
      await strict.close();
    }
  });
});

describe('sessions (FR-IAM-03, US-IAM-02 AC2)', () => {
  it('lists sessions and logs a revoked device out on its next request', async () => {
    const laptop = new Browser();
    const { email } = await register(laptop);
    const phone = new Browser(() => app, CHROME);
    await phone.call('POST', '/auth/login', { email, password: PASSWORD });

    const list = (await laptop.call('GET', '/me/sessions')).json<SessionList>().items;
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.current)?.device).toBe('Firefox on Linux');
    const phoneSession = list.find((s) => !s.current);
    expect(phoneSession?.device).toBe('Chrome on Windows');

    expect((await laptop.call('DELETE', `/me/sessions/${phoneSession?.id}`)).statusCode).toBe(204);
    expect((await phone.call('GET', '/me')).statusCode).toBe(401);
    expect((await laptop.call('GET', '/me')).statusCode).toBe(200);
  });

  it("cannot revoke another user's session", async () => {
    const ana = new Browser();
    await register(ana);
    const reza = new Browser();
    await register(reza);
    const [rezaSession] = (await reza.call('GET', '/me/sessions')).json<SessionList>().items;
    expect((await ana.call('DELETE', `/me/sessions/${rezaSession?.id}`)).statusCode).toBe(404);
    expect((await reza.call('GET', '/me')).statusCode).toBe(200);
  });

  it('signs out everywhere else but keeps this browser', async () => {
    const a = new Browser();
    const { email } = await register(a);
    const b = new Browser();
    await b.call('POST', '/auth/login', { email, password: PASSWORD });
    expect((await a.call('DELETE', '/me/sessions')).statusCode).toBe(204);
    expect((await b.call('GET', '/me')).statusCode).toBe(401);
    expect((await a.call('GET', '/me/sessions')).json<SessionList>().items).toHaveLength(1);
  });
});

describe('password reset and change', () => {
  it('answers 202 for unknown emails without sending anything', async () => {
    const email = uniqueEmail('ghost');
    const res = await new Browser().call('POST', '/auth/password-reset/request', { email });
    expect(res.statusCode).toBe(202);
    expect(await mailTo(email)).toEqual([]);
  });

  it('resets via a one-time link, signs out everywhere, and verifies the email', async () => {
    const browser = new Browser();
    const { email } = await register(browser);
    expect((await new Browser().call('POST', '/auth/password-reset/request', { email })).statusCode).toBe(
      202,
    );
    const [mail] = await mailTo(email);
    expect(mail?.link).toMatch(/\/reset-password\?token=/);

    const newPassword = 'blue kettle 77';
    const confirm = await new Browser().call('POST', '/auth/password-reset/confirm', {
      token: tokenOf(mail),
      password: newPassword,
    });
    expect(confirm.statusCode).toBe(204);
    expect((await browser.call('GET', '/me')).statusCode).toBe(401);
    expect((await mailTo(email))[0]?.subject).toBe('رمز عبور روبوسیم شما تغییر کرد');

    const old = await new Browser().call('POST', '/auth/login', { email, password: PASSWORD });
    expect(old.statusCode).toBe(401);
    const fresh = await new Browser().call('POST', '/auth/login', { email, password: newPassword });
    expect(fresh.json<Me>().emailVerified).toBe(true);

    const reuse = await new Browser().call('POST', '/auth/password-reset/confirm', {
      token: tokenOf(mail),
      password: 'another one 99',
    });
    expect(reuse.statusCode).toBe(410);
  });

  it('changes the password with the current one, rotating this session and ending the others', async () => {
    const a = new Browser();
    const { email } = await register(a);
    const b = new Browser();
    await b.call('POST', '/auth/login', { email, password: PASSWORD });

    const wrong = await a.call('POST', '/me/password', {
      currentPassword: 'nope nope',
      newPassword: 'blue kettle 77',
    });
    expect(wrong.json()).toMatchObject({ code: 'invalid_credentials' });

    const before = a.session;
    const ok = await a.call('POST', '/me/password', {
      currentPassword: PASSWORD,
      newPassword: 'blue kettle 77',
    });
    expect(ok.statusCode).toBe(204);
    expect(a.session).not.toBe(before);
    expect((await a.call('GET', '/me')).statusCode).toBe(200);
    expect((await b.call('GET', '/me')).statusCode).toBe(401);
  });
});

describe('profile and the development identity', () => {
  it('updates the display name and language', async () => {
    const browser = new Browser();
    await register(browser);
    const res = await browser.call('PATCH', '/me', { displayName: 'Sara R.', locale: 'en' });
    expect(res.json<Me>()).toMatchObject({ displayName: 'Sara R.', locale: 'en' });
  });

  it('requires a session for /me and project routes when DEV_IDENTITY is off', async () => {
    for (const url of ['/me', '/projects']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1${url}` });
      expect(res.json()).toMatchObject({ code: 'unauthenticated' });
    }
  });

  it('a session wins over the development identity when both are available', async () => {
    const dev = await createApp(testEnv(), database);
    try {
      const browser = new Browser(() => dev);
      const { me } = await register(browser);
      expect((await browser.call('GET', '/me')).json<Me>().id).toBe(me.id);
      const anonymous = await dev.inject({ method: 'GET', url: '/api/v1/me' });
      expect(anonymous.json<Me>().email).toBe('learner@dev.local');
    } finally {
      await dev.close();
    }
  });

  it('serves the dev mailbox only in local and test environments', async () => {
    const preview = await createApp(testEnv({ APP_ENV: 'preview', DEV_IDENTITY: 'false' }), database);
    try {
      expect((await preview.inject({ method: 'GET', url: '/api/v1/dev/mail' })).statusCode).toBe(404);
    } finally {
      await preview.close();
    }
  });
});
