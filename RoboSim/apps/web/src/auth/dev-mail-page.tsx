import { formatDate } from '@robosim/i18n';
import type { Locale } from '@robosim/shared';
import { Button, buttonVariants, Card } from '@robosim/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from './use-auth.js';

const SENT_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'medium' };

/** The API's development mail sink (local only): stands in for an inbox when trying sign-up and reset. */
export function DevMailPage() {
  const { t, i18n } = useTranslation();
  const { client } = useAuth();
  const locale = (i18n.language === 'fa' ? 'fa' : 'en') satisfies Locale;
  const mail = useQuery({ queryKey: ['auth', 'dev-mail'], queryFn: () => client.devMail(), retry: false });
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="me-auto text-2xl font-bold tracking-tight">{t('auth:devMail.title')}</h1>
        <Button size="sm" variant="secondary" onClick={() => void mail.refetch()}>
          {t('auth:devMail.refresh')}
        </Button>
      </div>
      <p className="text-sm text-ink-muted">{t('auth:devMail.intro')}</p>
      {mail.data?.length === 0 && <p className="text-ink-muted">{t('auth:devMail.empty')}</p>}
      {mail.data?.map((m) => (
        <Card key={m.id} className="p-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="me-auto font-semibold">{m.subject}</h2>
            <span className="text-xs text-ink-muted">
              {formatDate(locale, new Date(m.sentAt), SENT_FORMAT)}
            </span>
          </div>
          <p className="text-xs text-ink-muted">{t('auth:devMail.to', { address: m.to })}</p>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm">{m.text}</pre>
          {m.link && (
            <a href={m.link} className={buttonVariants({ size: 'sm', className: 'mt-3' })}>
              {t('auth:devMail.open')}
            </a>
          )}
        </Card>
      ))}
    </div>
  );
}
