import { CATALOG_MANIFESTS } from '@robosim/catalog/manifests';
import { formatDate } from '@robosim/i18n';
import type { Locale } from '@robosim/shared';
import { Button, buttonVariants } from '@robosim/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../editor/cloud-dialogs.js';
import type { PaywallReason } from './paywall-reason.js';

const NAME_KEY = new Map(CATALOG_MANIFESTS.map((m) => [m.id, m.nameKey]));

/**
 * What is blocked, why, and the cheapest plan that unblocks it (FR-BIL-05). Work is never lost: `actions` offers
 * the way to keep it (download a copy, keep it in this browser) next to "See plans".
 */
export function PaywallDialog({
  reason,
  onClose,
  actions,
}: {
  reason: PaywallReason;
  onClose: () => void;
  actions?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language === 'fa' ? 'fa' : 'en') satisfies Locale;
  const plan = t('plans:plan.maker');
  return (
    <Modal id="paywall-title" title={t('plans:paywall.title', { plan })} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        {reason.kind === 'cloudMax' && <p>{t('plans:paywall.cloudMax', { limit: reason.limit })}</p>}
        {reason.kind === 'locked' && <p>{t('plans:paywall.locked', { limit: reason.limit })}</p>}
        {reason.kind === 'builds' && (
          <p>
            {t('plans:paywall.builds', {
              limit: reason.limit,
              date: reason.resetAt
                ? formatDate(locale, new Date(reason.resetAt), { dateStyle: 'medium', timeStyle: 'short' })
                : '',
            })}
          </p>
        )}
        {reason.kind === 'parts' && (
          <>
            <p>{t('plans:paywall.parts', { plan })}</p>
            <ul aria-label={t('plans:paywall.partsLabel')} className="list-disc ps-5">
              {reason.parts.map((id) => (
                <li key={id}>{NAME_KEY.has(id) ? t(`components:${NAME_KEY.get(id) ?? ''}`) : id}</li>
              ))}
            </ul>
            <p className="text-ink-muted">{t('plans:paywall.partsHint')}</p>
          </>
        )}
        {reason.kind === 'aiCredits' && (
          <>
            <p>
              {t('plans:paywall.aiCredits', {
                date: reason.resetAt
                  ? formatDate(locale, new Date(reason.resetAt), { dateStyle: 'medium' })
                  : '',
              })}
            </p>
            <p className="text-ink-muted">{t('plans:paywall.aiCreditPacks')}</p>
          </>
        )}
        {reason.kind === 'feature' && <p>{t('plans:paywall.feature')}</p>}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {actions}
        <Link to="/plans" className={buttonVariants({ size: 'sm' })}>
          {t('plans:paywall.seePlans')}
        </Link>
        <Button size="sm" variant="secondary" onClick={onClose}>
          {t('plans:paywall.close')}
        </Button>
      </div>
    </Modal>
  );
}
