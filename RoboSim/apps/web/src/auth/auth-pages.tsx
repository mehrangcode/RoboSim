import { AUTH_LIMITS, LOCALES, type Locale, type Me } from '@robosim/shared';
import { Button, buttonVariants } from '@robosim/ui';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { safeRedirect, useAuth } from './use-auth.js';
import { AuthCard, Field, FormError } from './auth-ui.js';
import { useProblemText } from './problem-text.js';

type Search = { redirect?: string; token?: string };

function useSubmit<T>(work: () => Promise<T>, done: (result: T) => void | Promise<void>) {
  const problemText = useProblemText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await done(await work());
    } catch (err) {
      setError(problemText(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

/** After sign-in: back where the user came from, or to their projects. */
function useSignedIn() {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Search;
  return async (me: Me) => {
    setMe(me);
    await navigate({ to: safeRedirect(search.redirect) ?? '/projects' });
  };
}

export function LoginPage() {
  const { t } = useTranslation();
  const { client } = useAuth();
  const search = useSearch({ strict: false }) as Search;
  const signedIn = useSignedIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(() => client.login({ email, password }), signedIn);
  const redirect = safeRedirect(search.redirect);
  return (
    <AuthCard title={t('auth:login.title')}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <Field
          id="login-email"
          label={t('auth:login.email')}
          type="email"
          autoComplete="username"
          dir="ltr"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          id="login-password"
          label={t('auth:login.password')}
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError text={error} />
        <Button type="submit" disabled={busy}>
          {t('auth:login.submit')}
        </Button>
      </form>
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <Link to="/forgot-password" className="text-brand-600 hover:underline">
          {t('auth:login.forgot')}
        </Link>
        <p className="text-ink-muted">
          {t('auth:login.noAccount')}{' '}
          <Link
            to="/register"
            search={redirect ? { redirect } : {}}
            className="text-brand-600 hover:underline"
          >
            {t('auth:login.register')}
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { client } = useAuth();
  const search = useSearch({ strict: false }) as Search;
  const signedIn = useSignedIn();
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: '',
    dateOfBirth: '',
    locale: (i18n.language === 'fa' ? 'fa' : 'en') as Locale,
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const { busy, error, submit } = useSubmit(() => client.register(form), signedIn);
  const redirect = safeRedirect(search.redirect);
  return (
    <AuthCard title={t('auth:register.title')}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <Field
          id="register-name"
          label={t('auth:register.displayName')}
          autoComplete="name"
          required
          maxLength={AUTH_LIMITS.maxDisplayNameLength}
          value={form.displayName}
          onChange={set('displayName')}
        />
        <Field
          id="register-email"
          label={t('auth:register.email')}
          type="email"
          autoComplete="email"
          dir="ltr"
          required
          value={form.email}
          onChange={set('email')}
        />
        <Field
          id="register-password"
          label={t('auth:register.password')}
          hint={t('auth:register.passwordHint', { min: AUTH_LIMITS.minPasswordLength })}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          required
          minLength={AUTH_LIMITS.minPasswordLength}
          maxLength={AUTH_LIMITS.maxPasswordLength}
          value={form.password}
          onChange={set('password')}
        />
        <Field
          id="register-dob"
          label={t('auth:register.dateOfBirth')}
          hint={t('auth:register.dateOfBirthHint')}
          type="date"
          required
          max={new Date().toISOString().slice(0, 10)}
          value={form.dateOfBirth}
          onChange={set('dateOfBirth')}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="register-locale" className="text-sm font-medium">
            {t('auth:register.language')}
          </label>
          <select
            id="register-locale"
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            value={form.locale}
            onChange={set('locale')}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l} lang={l}>
                {t(`common:language.${l}`)}
              </option>
            ))}
          </select>
        </div>
        <FormError text={error} />
        <Button type="submit" disabled={busy}>
          {t('auth:register.submit')}
        </Button>
      </form>
      <p className="mt-4 text-sm text-ink-muted">
        {t('auth:register.haveAccount')}{' '}
        <Link to="/login" search={redirect ? { redirect } : {}} className="text-brand-600 hover:underline">
          {t('auth:register.signIn')}
        </Link>
      </p>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const { busy, error, submit } = useSubmit(
    () => client.requestPasswordReset(email),
    () => setSent(email),
  );
  return (
    <AuthCard title={t('auth:forgot.title')}>
      {sent ? (
        <p role="status">
          {t('auth:forgot.sent', { email: sent, minutes: AUTH_LIMITS.passwordResetMinutes })}
        </p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <p className="text-sm text-ink-muted">{t('auth:forgot.body')}</p>
          <Field
            id="forgot-email"
            label={t('auth:forgot.email')}
            type="email"
            autoComplete="email"
            dir="ltr"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <FormError text={error} />
          <Button type="submit" disabled={busy}>
            {t('auth:forgot.submit')}
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
        {t('auth:forgot.back')}
      </Link>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const { client, setMe } = useAuth();
  const { token } = useSearch({ strict: false }) as Search;
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, submit } = useSubmit(
    () => client.confirmPasswordReset(token ?? '', password),
    () => {
      // Every session ended with the reset, this one included.
      setMe(null);
      setDone(true);
    },
  );
  return (
    <AuthCard title={t('auth:reset.title')}>
      {!token ? (
        <p role="alert" className="text-danger">
          {t('auth:reset.missingToken')}
        </p>
      ) : done ? (
        <>
          <p role="status">{t('auth:reset.done')}</p>
          <Link to="/login" className={buttonVariants({ size: 'sm', className: 'mt-4' })}>
            {t('auth:reset.signIn')}
          </Link>
        </>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <Field
            id="reset-password"
            label={t('auth:reset.password')}
            hint={t('auth:register.passwordHint', { min: AUTH_LIMITS.minPasswordLength })}
            type="password"
            autoComplete="new-password"
            dir="ltr"
            required
            minLength={AUTH_LIMITS.minPasswordLength}
            maxLength={AUTH_LIMITS.maxPasswordLength}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FormError text={error} />
          <Button type="submit" disabled={busy}>
            {t('auth:reset.submit')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

/** Opens from the emailed link; the token is posted, never fetched with GET (no side effects on prefetch). */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const { client, me, setMe } = useAuth();
  const { token } = useSearch({ strict: false }) as Search;
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
  const started = useRef(false);
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    client
      .verifyEmail(token)
      .then(async () => {
        setState('done');
        const fresh = await client.me().catch(() => null);
        if (fresh) setMe(fresh);
      })
      .catch(() => setState('failed'));
  }, [client, setMe, token]);
  return (
    <AuthCard title={t('auth:verify.title')}>
      <p role={state === 'failed' ? 'alert' : 'status'} className={state === 'failed' ? 'text-danger' : ''}>
        {state === 'working'
          ? t('auth:verify.working')
          : state === 'done'
            ? t('auth:verify.done')
            : t('auth:verify.failed')}
      </p>
      {state !== 'working' && (
        <Link to={me ? '/projects' : '/login'} className={buttonVariants({ size: 'sm', className: 'mt-4' })}>
          {t('auth:verify.continue')}
        </Link>
      )}
    </AuthCard>
  );
}
