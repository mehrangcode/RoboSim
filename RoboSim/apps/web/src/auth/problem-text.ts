import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api.js';

const PASSWORD_RULES = new Set(['common', 'contains_email']);

/** A form error in the user's language: password-policy rejections get their own explanation. */
export function useProblemText(): (e: unknown) => string {
  const { t } = useTranslation();
  return (e) => {
    if (!(e instanceof ApiError)) return t('errors:provider_error');
    const errors = e.problem.params?.['errors'];
    if (Array.isArray(errors)) {
      for (const item of errors as { path?: unknown; message?: unknown }[]) {
        if (item.path === 'password' && typeof item.message === 'string' && PASSWORD_RULES.has(item.message))
          return t(`auth:passwordRule.${item.message}`);
      }
    }
    return e.problem.title;
  };
}
