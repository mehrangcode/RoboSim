import type { Locale } from '@robosim/shared';
import { i18nFor } from '../../common/i18n.js';
import type { MailMessage } from './mailer.js';

export interface MailRecipient {
  email: string;
  displayName: string;
  locale: Locale;
}

/** Email verification after sign-up (FR-IAM-01), in the user's language. */
export async function verifyEmailMessage(
  to: MailRecipient,
  link: string,
  hours: number,
): Promise<MailMessage> {
  const { t } = await i18nFor(to.locale);
  return {
    to: to.email,
    subject: t('auth:mail.verify.subject'),
    text: t('auth:mail.verify.body', { name: to.displayName, link, hours }),
    link,
  };
}

export async function passwordResetMessage(
  to: MailRecipient,
  link: string,
  minutes: number,
): Promise<MailMessage> {
  const { t } = await i18nFor(to.locale);
  return {
    to: to.email,
    subject: t('auth:mail.reset.subject'),
    text: t('auth:mail.reset.body', { name: to.displayName, link, minutes }),
    link,
  };
}

/** Sent after a password change or reset, so an owner who did not make it can react. */
export async function passwordChangedMessage(to: MailRecipient): Promise<MailMessage> {
  const { t } = await i18nFor(to.locale);
  return {
    to: to.email,
    subject: t('auth:mail.changed.subject'),
    text: t('auth:mail.changed.body', { name: to.displayName }),
  };
}
