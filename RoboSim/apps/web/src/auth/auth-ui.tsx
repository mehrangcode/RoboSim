import { Button, buttonVariants, Card, cn } from '@robosim/ui';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './use-auth.js';

export function Field({
  label,
  hint,
  id,
  ...input
}: { label: string; hint?: string; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
        {...input}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Narrow centred card used by every sign-in page. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <h1 className="mb-5 text-xl font-bold tracking-tight">{title}</h1>
        {children}
      </Card>
    </div>
  );
}

export function FormError({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="text-sm text-danger">
      {text}
    </p>
  ) : null;
}

/** Shown instead of a page that needs an account; sign-in returns here. */
export function SignInGate() {
  const { t } = useTranslation();
  const location = useLocation();
  const redirect = location.href;
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-bold tracking-tight">{t('auth:gate.title')}</h1>
      <p className="mt-2 text-ink-muted">{t('auth:gate.body')}</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link to="/login" search={{ redirect }} className={buttonVariants({ size: 'sm' })}>
          {t('auth:gate.signIn')}
        </Link>
        <Link
          to="/register"
          search={{ redirect }}
          className={buttonVariants({ size: 'sm', variant: 'secondary' })}
        >
          {t('auth:gate.signUp')}
        </Link>
      </div>
    </div>
  );
}

/** Header actions: sign-in links, or the user's name with Account and Sign out. */
export function AccountMenu() {
  const { t } = useTranslation();
  const { me, client, setMe } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (me === undefined) return null;
  if (me === null)
    return (
      <div className="flex items-center gap-2 text-sm">
        <Link to="/login" className="text-ink-muted hover:text-ink">
          {t('auth:nav.signIn')}
        </Link>
        <Link to="/register" className={buttonVariants({ size: 'sm' })}>
          {t('auth:nav.signUp')}
        </Link>
      </div>
    );
  const signOut = async () => {
    setOpen(false);
    await client.logout().catch(() => undefined);
    setMe(null);
    await navigate({ to: '/' });
  };
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('auth:nav.menuLabel')}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          aria-hidden
          className="grid size-6 place-items-center rounded-full bg-brand-600 text-xs text-white"
        >
          {[...me.displayName][0]?.toUpperCase()}
        </span>
        <span className="hidden max-w-32 truncate sm:inline">{me.displayName}</span>
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 z-20 mt-1 flex w-44 flex-col rounded-md border border-line bg-surface-raised py-1 text-sm shadow-md"
        >
          <Link
            role="menuitem"
            to="/account"
            className="px-3 py-2 hover:bg-surface"
            onClick={() => setOpen(false)}
          >
            {t('auth:nav.account')}
          </Link>
          <button
            role="menuitem"
            type="button"
            className="px-3 py-2 text-start hover:bg-surface"
            onClick={() => void signOut()}
          >
            {t('auth:nav.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Reminder to verify the email, or a note while a minor's account waits for guardian consent. */
export function AccountBanner() {
  const { t } = useTranslation();
  const { me, client } = useAuth();
  const [sent, setSent] = useState(false);
  if (!me) return null;
  if (me.status === 'pending_consent') return <Banner>{t('auth:banner.consentPending')}</Banner>;
  if (me.emailVerified || !me.email) return null;
  return (
    <Banner>
      {t('auth:banner.unverified', { email: me.email })}{' '}
      {sent ? (
        <span role="status">{t('auth:banner.resent')}</span>
      ) : (
        <button
          type="button"
          className="font-medium text-brand-600 hover:underline"
          onClick={() => void client.resendVerification().then(() => setSent(true))}
        >
          {t('auth:banner.resend')}
        </button>
      )}
    </Banner>
  );
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className={cn('-mx-6 -mt-6 mb-6 border-b border-line bg-surface px-6 py-2 text-sm')}>{children}</div>
  );
}
