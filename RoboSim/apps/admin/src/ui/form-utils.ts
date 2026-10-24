import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api.js';

/** An API failure in the user's language: the problem title (localized by the API) or a generic message. */
export function useProblemText(): (e: unknown) => string {
  const { t } = useTranslation();
  return (e) => (e instanceof ApiError ? e.problem.title : t('admin:errors.generic'));
}

/** `YYYY-MM-DD` from a date input → the end of that day in Tehran, as the API's ISO datetime. */
export function endOfDayIso(date: string): string | null {
  return date ? `${date}T23:59:59+03:30` : null;
}
