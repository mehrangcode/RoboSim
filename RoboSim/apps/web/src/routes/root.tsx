import { AppShell } from '@robosim/ui';
import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AccountBanner, AccountMenu } from '../auth/auth-ui.js';
import { LanguageSwitch } from '../language-switch.js';

export function RootLayout() {
  const { t } = useTranslation();
  return (
    <AppShell
      brand={
        <>
          <img src="/favicon.svg" alt="" className="size-7" />
          <span>{t('common:appName')}</span>
          <span className="hidden text-xs font-normal text-ink-muted sm:inline">{t('common:publisher')}</span>
        </>
      }
      navLabel={t('shell:nav.mainLabel')}
      nav={
        <>
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className="text-ink-muted hover:text-ink [&.active]:font-medium [&.active]:text-ink"
          >
            {t('shell:nav.home')}
          </Link>
          <Link
            to="/projects"
            className="text-ink-muted hover:text-ink [&.active]:font-medium [&.active]:text-ink"
          >
            {t('shell:nav.projects')}
          </Link>
          <Link
            to="/editor"
            activeOptions={{ exact: true }}
            className="text-ink-muted hover:text-ink [&.active]:font-medium [&.active]:text-ink"
          >
            {t('shell:nav.editor')}
          </Link>
          <Link
            to="/lab"
            className="text-ink-muted hover:text-ink [&.active]:font-medium [&.active]:text-ink"
          >
            {t('shell:nav.lab')}
          </Link>
          <Link
            to="/plans"
            className="text-ink-muted hover:text-ink [&.active]:font-medium [&.active]:text-ink"
          >
            {t('plans:nav')}
          </Link>
          {import.meta.env.DEV && (
            <Link
              to="/dev/mail"
              className="text-ink-muted hover:text-ink [&.active]:font-medium [&.active]:text-ink"
            >
              {t('auth:devMail.title')}
            </Link>
          )}
        </>
      }
      actions={
        <>
          <LanguageSwitch />
          <AccountMenu />
        </>
      }
    >
      <AccountBanner />
      <Outlet />
    </AppShell>
  );
}

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-2xl font-semibold">{t('shell:notFound.title')}</h1>
      <p className="mt-2 text-ink-muted">{t('shell:notFound.body')}</p>
      <Link to="/" className="mt-6 inline-block text-brand-600 hover:underline">
        {t('common:actions.backHome')}
      </Link>
    </div>
  );
}
