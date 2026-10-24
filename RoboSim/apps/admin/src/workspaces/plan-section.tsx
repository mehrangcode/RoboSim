import {
  setSubscriptionSchema,
  type AdminWorkspace,
  type PlanCode,
  type SetSubscriptionInput,
} from '@robosim/shared';
import { Button, Card } from '@robosim/ui';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../lib/format.js';
import { useCan, useClient } from '../session/session.js';
import { endOfDayIso, useProblemText } from '../ui/form-utils.js';
import { Field, FormError, Select, TextArea } from '../ui/form.js';
import { useWorkspaceUpdated } from './workspace-query.js';

/** Plans staff can put a workspace on by hand; private cloud is contracted outside the back office. */
const ASSIGNABLE_PLANS = ['free', 'maker', 'classroom', 'institution'] as const satisfies readonly PlanCode[];

export function PlanSection({ workspace }: { workspace: AdminWorkspace }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const canChange = useCan('subscriptions');
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const sub = workspace.subscription;

  return (
    <Card aria-labelledby="plan-title" className="flex flex-col gap-3 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="plan-title" className="text-lg font-semibold">
            {t('admin:workspace.planTitle')}
          </h2>
          <p className="mt-1">
            {t('admin:workspace.planLine', {
              plan: t(`admin:planName.${sub.plan}`),
              version: fmt.num(sub.version),
              status: t(`admin:status.${sub.status}`),
            })}
          </p>
          <p className="text-sm text-ink-muted">
            {sub.periodEnd
              ? t('admin:workspace.periodEnd', { date: fmt.date(sub.periodEnd) })
              : t('admin:workspace.openEnded')}
            {sub.source && <> {t('admin:workspace.source', { source: sub.source })}</>}
          </p>
        </div>
        {canChange && !editing && (
          <Button
            size="sm"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            {t('admin:changePlan.open')}
          </Button>
        )}
      </div>
      {saved && (
        <p role="status" className="text-sm text-ok">
          {t('admin:changePlan.done')}
        </p>
      )}
      {editing && (
        <ChangePlanForm
          workspace={workspace}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
          }}
        />
      )}
    </Card>
  );
}

function ChangePlanForm({
  workspace,
  onCancel,
  onSaved,
}: {
  workspace: AdminWorkspace;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const client = useClient();
  const problemText = useProblemText();
  const updated = useWorkspaceUpdated(workspace.id);
  const [plan, setPlan] = useState<PlanCode>(workspace.subscription.plan);
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: SetSubscriptionInput) => client.setSubscription(workspace.id, input),
    onSuccess: (ws) => {
      updated(ws);
      onSaved();
    },
    onError: (e) => setError(problemText(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = setSubscriptionSchema.safeParse({
      plan,
      periodEnd: endOfDayIso(plan === 'free' ? '' : end),
      reason,
    });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setError(field === 'reason' ? t('admin:form.reasonInvalid') : t('admin:form.dateInvalid'));
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <form
      aria-label={t('admin:changePlan.title')}
      className="flex flex-col gap-4 rounded-md border border-line p-4"
      onSubmit={submit}
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="change-plan"
          label={t('admin:changePlan.plan')}
          value={plan}
          onChange={(e) => setPlan(e.target.value as PlanCode)}
        >
          {ASSIGNABLE_PLANS.map((p) => (
            <option key={p} value={p}>
              {t(`admin:planName.${p}`)}
            </option>
          ))}
        </Select>
        <Field
          id="change-plan-end"
          type="date"
          label={t('admin:changePlan.end')}
          hint={t('admin:changePlan.endHint')}
          disabled={plan === 'free'}
          value={plan === 'free' ? '' : end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </div>
      {plan === 'free' && <p className="text-sm text-ink-muted">{t('admin:changePlan.freeNote')}</p>}
      <TextArea
        id="change-plan-reason"
        label={t('admin:form.reason')}
        hint={t('admin:form.reasonHint')}
        required
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <FormError text={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          {t('admin:changePlan.submit')}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={save.isPending}>
          {t('admin:actions.cancel')}
        </Button>
      </div>
    </form>
  );
}
