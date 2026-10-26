import { staffCan } from '@robosim/shared';
import { AppShell, Button } from '@robosim/ui';
import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../language-switch.js';
import { NoAccessPage, SignInPage } from '../session/session-gate.js';
import { useSession, useSignOut } from '../session/use-session.js';
import { StaffContext } from '../session/session.js';
import { LoadError, Loading } from '../ui/form.js';

const navLink = 'text-ink-muted hover:text-ink [&.active]:font-medium [&.active]:text-ink';

/** Page frame plus the staff session gate: nothing below renders until `/admin/me` says this is staff. */
export function RootLayout() {
  const { t } = useTranslation();
  const session = useSession();
  const signOut = useSignOut();
  const staff = session.kind === 'staff' ? session.me : null;

  return (
    <AppShell
      brand={
        <>
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="hidden sm:inline">{t('admin:title')}</span>
        </>
      }
      navLabel={t('admin:nav.mainLabel')}
      nav={
        staff && (
          <>
            <Link to="/workspaces" className={navLink}>
              {t('admin:nav.workspaces')}
            </Link>
            <Link to="/plans" className={navLink}>
              {t('admin:nav.plans')}
            </Link>
            {staffCan(staff.roles, 'prices') && (
              <Link to="/prices" className={navLink}>
                {t('admin:nav.prices')}
              </Link>
            )}
          </>
        )
      }
      actions={
        <>
          <LanguageSwitch />
          {staff && (
            <>
              <div className="hidden min-w-0 flex-col text-end text-xs leading-tight md:flex">
                <span className="truncate font-medium" data-testid="staff-name">
                  {staff.displayName}
                </span>
                <span className="truncate text-ink-muted">
                  {staff.roles.map((r) => t(`admin:role.${r}`)).join(t('admin:session.roleSeparator'))}
                </span>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void signOut()}>
                {t('admin:session.signOut')}
              </Button>
            </>
          )}
        </>
      }
    >
      {session.kind === 'loading' && <Loading />}
      {session.kind === 'signedOut' && <SignInPage />}
      {session.kind === 'forbidden' && <NoAccessPage />}
      {session.kind === 'error' && <LoadError error={session.error} onRetry={session.retry} />}
      {staff && (
        <StaffContext value={staff}>
          <Outlet />
        </StaffContext>
      )}
    </AppShell>
  );
}

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-2xl font-semibold">{t('admin:notFound.title')}</h1>
      <Link to="/workspaces" className="mt-6 inline-block text-brand-600 hover:underline">
        {t('admin:notFound.back')}
      </Link>
    </div>
  );
}
