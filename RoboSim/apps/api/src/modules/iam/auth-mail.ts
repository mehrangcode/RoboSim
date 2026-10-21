import { createI18n } from '@robosim/i18n';
import type { Locale } from '@robosim/shared';
import type { MailMessage } from './mailer.js';

type I18nInstance = Awaited<ReturnType<typeof createI18n>>;

const instances = new Map<Locale, Promise<I18nInstance>>();
function i18nFor(locale: Locale): Promise<I18nInstance> {
  let instance = instances.get(locale);
  if (!instance) {
    instance = createI18n({ lng: locale });
    instances.set(locale, instance);
  }
  return instance;
}

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
