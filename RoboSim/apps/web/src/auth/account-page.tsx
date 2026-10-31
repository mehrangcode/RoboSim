import { formatDate } from '@robosim/i18n';
import { applyDocumentLocale, persistLocale } from '@robosim/i18n/browser';
import { AUTH_LIMITS, LOCALES, type Locale, type SessionInfo } from '@robosim/shared';
import { Button, Card } from '@robosim/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AiKeysCard } from '../ai/ai-keys-card.js';
import { PlanUsageCard } from '../plans/plan-usage.js';
import { useAuth } from './use-auth.js';
import { Field, FormError, SignInGate } from './auth-ui.js';
import { useProblemText } from './problem-text.js';

/** Profile, password and sessions (FR-IAM-03, US-IAM-02 AC2). */
export function AccountPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  if (me === undefined)
    return <p className="py-16 text-center text-ink-muted">{t('common:status.loading')}</p>;
  if (me === null) return <SignInGate />;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-6">
      <h1 className="text-2xl font-bold tracking-tight">{t('auth:account.title')}</h1>
      <ProfileCard />
      <PlanUsageCard />
      <AiKeysCard />
      <PasswordCard />
      <SessionsCard />
    </div>
  );
}

function ProfileCard() {
  const { t, i18n } = useTranslation();
  const { me, client, setMe } = useAuth();
  const problemText = useProblemText();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [locale, setLocale] = useState<Locale>(me?.locale ?? 'en');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  if (!me) return null;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const updated = await client.updateMe({ displayName, locale });
      setMe(updated);
      if (updated.locale !== i18n.language) {
        applyDocumentLocale(updated.locale);
        persistLocale(updated.locale);
        await i18n.changeLanguage(updated.locale);
      }
      setStatus({ ok: true, text: t('auth:account.saved') });
    } catch (err) {
      setStatus({ ok: false, text: problemText(err) });
    }
  };
  return (
    <Card aria-labelledby="account-profile">
      <h2 id="account-profile" className="mb-4 font-semibold">
        {t('auth:account.profile')}
      </h2>
      <form className="flex flex-col gap-4" onSubmit={(e) => void save(e)}>
        <Field
          id="account-name"
          label={t('auth:account.displayName')}
          required
          maxLength={AUTH_LIMITS.maxDisplayNameLength}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('auth:account.email')}</span>
          <span dir="ltr" className="text-start">
            {me.email}{' '}
            <span className={me.emailVerified ? 'text-ok' : 'text-danger'}>
              ({me.emailVerified ? t('auth:account.verified') : t('auth:account.notVerified')})
            </span>
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="account-locale" className="text-sm font-medium">
            {t('auth:account.language')}
          </label>
          <select
            id="account-locale"
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l} lang={l}>
                {t(`common:language.${l}`)}
              </option>
            ))}
          </select>
        </div>
        {status && (
          <p
            role={status.ok ? 'status' : 'alert'}
            className={status.ok ? 'text-sm text-ok' : 'text-sm text-danger'}
          >
            {status.text}
          </p>
        )}
        <Button type="submit" size="sm" className="self-start">
          {t('auth:account.save')}
        </Button>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const { t } = useTranslation();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await client.changePassword({ currentPassword, newPassword });
      setCurrent('');
      setNew('');
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    } catch (err) {
      setError(problemText(err));
    }
  };
  return (
    <Card aria-labelledby="account-password">
      <h2 id="account-password" className="mb-4 font-semibold">
        {t('auth:account.password.title')}
      </h2>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <Field
          id="account-current-password"
          label={t('auth:account.password.current')}
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          id="account-new-password"
          label={t('auth:account.password.new')}
          hint={t('auth:register.passwordHint', { min: AUTH_LIMITS.minPasswordLength })}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          required
          minLength={AUTH_LIMITS.minPasswordLength}
          maxLength={AUTH_LIMITS.maxPasswordLength}
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
        />
        <FormError text={error} />
        {done && (
          <p role="status" className="text-sm text-ok">
            {t('auth:account.password.done')}
          </p>
        )}
        <Button type="submit" size="sm" className="self-start">
          {t('auth:account.password.submit')}
        </Button>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const { t, i18n } = useTranslation();
  const { client, setMe } = useAuth();
  const locale = (i18n.language === 'fa' ? 'fa' : 'en') satisfies Locale;
  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => client.sessions(),
    retry: false,
  });
  const when = (iso: string) =>
    formatDate(locale, new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const revoke = async (s: SessionInfo) => {
    await client.revokeSession(s.id);
    if (s.current) setMe(null);
    else await sessions.refetch();
  };
  const items = sessions.data ?? [];
  return (
    <Card aria-labelledby="account-sessions">
      <h2 id="account-sessions" className="font-semibold">
        {t('auth:account.sessions.title')}
      </h2>
      <p className="mt-1 mb-4 text-sm text-ink-muted">{t('auth:account.sessions.intro')}</p>
      {items.length === 0 && sessions.isSuccess ? (
        <p className="text-sm text-ink-muted">{t('auth:account.sessions.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="me-auto min-w-0">
                <p className="font-medium">
                  {s.device}
                  {s.current && (
                    <span className="ms-2 rounded bg-brand-600 px-1.5 py-0.5 text-xs text-white">
                      {t('auth:account.sessions.current')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-muted">
                  {t('auth:account.sessions.lastSeen', { time: when(s.lastSeenAt) })} ·{' '}
                  {t('auth:account.sessions.signedIn', { time: when(s.createdAt) })}
                  {s.ip && (
                    <>
                      {' · '}
                      <span dir="ltr">{s.ip}</span>
                    </>
                  )}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void revoke(s)}>
                {t('auth:account.sessions.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 1 && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-4"
          onClick={() => void client.revokeOtherSessions().then(() => sessions.refetch())}
        >
          {t('auth:account.sessions.revokeOthers')}
        </Button>
      )}
    </Card>
  );
}
