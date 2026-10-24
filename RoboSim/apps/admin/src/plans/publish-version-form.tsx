import {
  PLAN_INTERVALS,
  createPlanVersionSchema,
  type AdminPlan,
  type AdminPlanVersion,
  type CreatePlanVersionInput,
  type EntitlementKey,
  type PlanInterval,
} from '@robosim/shared';
import { Button } from '@robosim/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ENTITLEMENT_GROUPS, changedKeys, isValidValue } from '../entitlements/entitlement-kinds.js';
import { EntitlementValueEditor } from '../entitlements/entitlement-ui.js';
import { useFormat } from '../lib/format.js';
import { useClient } from '../session/session.js';
import { useProblemText } from '../ui/form-utils.js';
import { Field, FormError, Select } from '../ui/form.js';
import { PLANS_KEY } from './plans-query.js';

/** Publishes a new version of `plan`, prefilled from `current`; a confirmation step lists what changes. */
export function PublishVersionForm({
  plan,
  current,
  onCancel,
  onPublished,
}: {
  plan: AdminPlan;
  current: AdminPlanVersion;
  onCancel: () => void;
  onPublished: (version: number) => void;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const client = useClient();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const [interval, setPlanInterval] = useState<PlanInterval>(current.interval);
  const [price, setPrice] = useState(current.priceIrr === null ? '' : String(current.priceIrr));
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...current.entitlements }));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = new Set(
    ENTITLEMENT_GROUPS.flatMap((g) => g.keys).filter((k) => !isValidValue(k, values[k])),
  );
  const priceIrr = price.trim() === '' ? null : Number(price);
  const parsed = createPlanVersionSchema.safeParse({ interval, priceIrr, entitlements: values });

  const publish = useMutation({
    mutationFn: (data: CreatePlanVersionInput) => client.publishPlanVersion(plan.code, data),
    onSuccess: (updated) => {
      queryClient.setQueryData<AdminPlan[]>(PLANS_KEY, (list) =>
        list?.map((p) => (p.code === updated.code ? updated : p)),
      );
      onPublished(updated.versions[0]?.version ?? current.version + 1);
    },
    onError: (e) => setError(problemText(e)),
  });

  const review = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!parsed.success) {
      setError(t('admin:publish.invalid'));
      return;
    }
    setConfirming(true);
  };

  const formId = `publish-${plan.code}`;

  if (confirming && parsed.success) {
    const changes = changedKeys(current.entitlements, parsed.data.entitlements);
    const intervalChanged = interval !== current.interval;
    const priceChanged = priceIrr !== current.priceIrr;
    const nothing = changes.length === 0 && !intervalChanged && !priceChanged;
    return (
      <section
        aria-labelledby={`${formId}-confirm`}
        className="flex flex-col gap-3 rounded-md border border-line p-4"
      >
        <h3 id={`${formId}-confirm`} className="font-semibold">
          {t('admin:publish.confirmTitle', { plan: t(`admin:planName.${plan.code}`) })}
        </h3>
        {nothing ? (
          <p className="text-sm text-ink-muted">{t('admin:publish.noChanges')}</p>
        ) : (
          <ul
            className="flex list-disc flex-col gap-1 ps-5 text-sm"
            aria-label={t('admin:publish.changesLabel')}
          >
            {intervalChanged && (
              <li>
                {t('admin:publish.change', {
                  name: t('admin:publish.interval'),
                  from: t(`admin:interval.${current.interval}`),
                  to: t(`admin:interval.${interval}`),
                })}
              </li>
            )}
            {priceChanged && (
              <li>
                {t('admin:publish.change', {
                  name: t('admin:publish.price'),
                  from: fmt.price(current.priceIrr),
                  to: fmt.price(priceIrr),
                })}
              </li>
            )}
            {changes.map((key: EntitlementKey) => (
              <li key={key}>
                {t('admin:publish.change', {
                  name: t(`admin:ent.${key}`),
                  from: fmt.value(key, current.entitlements[key]),
                  to: fmt.value(key, parsed.data.entitlements[key]),
                })}
              </li>
            ))}
          </ul>
        )}
        <p className="rounded-md bg-surface p-3 text-sm text-ink-muted">
          {plan.code === 'free' ? t('admin:publish.freeNote') : t('admin:publish.paidNote')}
        </p>
        <FormError text={error} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => publish.mutate(parsed.data)} disabled={publish.isPending}>
            {t('admin:publish.confirm')}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={publish.isPending}>
            {t('admin:publish.back')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form
      aria-labelledby={`${formId}-title`}
      className="flex flex-col gap-4 rounded-md border border-line p-4"
      onSubmit={review}
      noValidate
    >
      <h3 id={`${formId}-title`} className="font-semibold">
        {t('admin:publish.title', { plan: t(`admin:planName.${plan.code}`) })}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id={`${formId}-interval`}
          label={t('admin:publish.interval')}
          value={interval}
          onChange={(e) => setPlanInterval(e.target.value as PlanInterval)}
        >
          {PLAN_INTERVALS.map((i) => (
            <option key={i} value={i}>
              {t(`admin:interval.${i}`)}
            </option>
          ))}
        </Select>
        <Field
          id={`${formId}-price`}
          label={t('admin:publish.price')}
          hint={t('admin:publish.priceHint')}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          dir="ltr"
          aria-invalid={priceIrr !== null && !(Number.isInteger(priceIrr) && priceIrr >= 0)}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
      {ENTITLEMENT_GROUPS.map((group) => (
        <fieldset key={group.id} className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold text-ink-muted">
            {t(`admin:group.${group.id}`)}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.keys.map((key) => (
              <EntitlementValueEditor
                key={key}
                id={`${formId}-${key}`}
                entKey={key}
                label={t(`admin:ent.${key}`)}
                value={values[key]}
                invalid={invalid.has(key)}
                onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
              />
            ))}
          </div>
        </fieldset>
      ))}
      <FormError text={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{t('admin:publish.review')}</Button>
        <Button variant="secondary" onClick={onCancel}>
          {t('admin:actions.cancel')}
        </Button>
      </div>
    </form>
  );
}
