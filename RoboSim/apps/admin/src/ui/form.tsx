import { cn } from '@robosim/ui';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { useProblemText } from './form-utils.js';

export const inputClass =
  'rounded-md border border-line bg-surface px-3 py-2 text-sm aria-[invalid=true]:border-danger';

function Labelled({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  id,
  className,
  ...input
}: { label: string; hint?: string; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Labelled id={id} label={label} hint={hint}>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cn(inputClass, className)}
        {...input}
      />
    </Labelled>
  );
}

export function TextArea({
  label,
  hint,
  id,
  ...input
}: { label: string; hint?: string; id: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Labelled id={id} label={label} hint={hint}>
      <textarea
        id={id}
        rows={2}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={inputClass}
        {...input}
      />
    </Labelled>
  );
}

export function Select({
  label,
  hint,
  id,
  children,
  ...select
}: { label: string; hint?: string; id: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Labelled id={id} label={label} hint={hint}>
      <select id={id} aria-describedby={hint ? `${id}-hint` : undefined} className={inputClass} {...select}>
        {children}
      </select>
    </Labelled>
  );
}

export function FormError({ text }: { text: string | null | undefined }) {
  return text ? (
    <p role="alert" className="text-sm text-danger">
      {text}
    </p>
  ) : null;
}

export function Loading() {
  const { t } = useTranslation();
  return (
    <p role="status" className="py-8 text-center text-ink-muted">
      {t('common:status.loading')}
    </p>
  );
}

/** A failed query with a retry button. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p role="alert" className="text-danger">
        {problemText(error)}
      </p>
      <button type="button" onClick={onRetry} className="text-sm text-brand-600 hover:underline">
        {t('common:actions.retry')}
      </button>
    </div>
  );
}
