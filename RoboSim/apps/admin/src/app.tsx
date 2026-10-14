import { AppShell, Card } from '@robosim/ui';
import type { i18n as I18nInstance } from 'i18next';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { LanguageSwitch } from './language-switch.js';

function Dashboard() {
  const { t } = useTranslation();
  return (
    <AppShell
      brand={
        <>
          <img src="/favicon.svg" alt="" className="size-7" />
          <span>{t('admin:title')}</span>
        </>
      }
      navLabel={t('admin:nav.mainLabel')}
      nav={<span className="font-medium">{t('admin:nav.dashboard')}</span>}
      actions={<LanguageSwitch />}
    >
      <Card className="mx-auto mt-10 max-w-2xl">
        <h1 className="text-xl font-semibold">{t('admin:dashboard.heading')}</h1>
        <p className="mt-2 text-ink-muted">{t('admin:dashboard.body')}</p>
      </Card>
    </AppShell>
  );
}

export function App({ i18n }: { i18n: I18nInstance }) {
  return (
    <I18nextProvider i18n={i18n}>
      <Dashboard />
    </I18nextProvider>
  );
}
