import {
  createOverrideSchema,
  isEntitlementKey,
  type AdminOverride,
  type AdminWorkspace,
  type CreateOverrideInput,
  type EntitlementKey,
} from '@robosim/shared';
import { Button, Card } from '@robosim/ui';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ENTITLEMENT_GROUPS, defaultGrant } from '../entitlements/entitlement-kinds.js';
import { EntitlementValueEditor } from '../entitlements/entitlement-ui.js';
import { useFormat } from '../lib/format.js';
import { useCan, useClient } from '../session/session.js';
import { endOfDayIso, useProblemText } from '../ui/form-utils.js';
import { Field, FormError, Select, TextArea } from '../ui/form.js';
import { useWorkspaceUpdated } from './workspace-query.js';

export function OverridesSection({ workspace }: { workspace: AdminWorkspace }) {
  const { t } = useTranslation();
  const canGrant = useCan('overrides');
  const [granting, setGranting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Card aria-labelledby="overrides-title" className="flex flex-col gap-3 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="overrides-title" className="text-lg font-semibold">
          {t('admin:overrides.title')}
        </h2>
        {canGrant && !granting && (
          <Button
            size="sm"
            onClick={() => {
              setNotice(null);
              setGranting(true);
            }}
          >
            {t('admin:overrides.open')}
          </Button>
        )}
      </div>
      <p className="text-sm text-ink-muted">{t('admin:overrides.rules')}</p>
      {notice && (
        <p role="status" className="text-sm text-ok">
          {notice}
        </p>
      )}
      {granting && (
        <GrantOverrideForm
          workspace={workspace}
          onCancel={() => setGranting(false)}
          onGranted={() => {
            setGranting(false);
            setNotice(t('admin:overrides.granted'));
          }}
        />
      )}
      {workspace.overrides.length === 0 ? (
        <p className="py-2 text-sm text-ink-muted">{t('admin:overrides.empty')}</p>
      ) : (
        <OverridesTable
          workspace={workspace}
          canRemove={canGrant}
          onRemoved={() => setNotice(t('admin:overrides.removed'))}
        />
      )}
    </Card>
  );
}

function OverridesTable({
  workspace,
  canRemove,
  onRemoved,
}: {
  workspace: AdminWorkspace;
  canRemove: boolean;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const client = useClient();
  const problemText = useProblemText();
  const updated = useWorkspaceUpdated(workspace.id);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (overrideId: string) => client.removeOverride(workspace.id, overrideId),
    onSuccess: (ws) => {
      setConfirming(null);
      updated(ws);
      onRemoved();
    },
    onError: (e) => setError(problemText(e)),
  });

  const keyName = (o: AdminOverride) => (isEntitlementKey(o.key) ? t(`admin:ent.${o.key}`) : o.key);
  const scope = (o: AdminOverride) =>
    o.userId === null
      ? t('admin:overrides.wholeWorkspace')
      : o.userId === workspace.ownerId
        ? t('admin:overrides.member', { name: workspace.ownerName })
        : t('admin:overrides.member', { name: o.userId });

  return (
    <>
      <FormError text={error} />
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-surface text-xs text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t('admin:overrides.col.key')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin:overrides.col.value')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin:overrides.col.scope')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin:overrides.col.reason')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin:overrides.col.expires')}</th>
              <th className="px-3 py-2 text-start font-medium">{t('admin:overrides.col.granted')}</th>
              {canRemove && (
                <th className="px-3 py-2 text-start font-medium">
                  <span className="sr-only">{t('admin:overrides.col.actions')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {workspace.overrides.map((o) => (
              <tr key={o.id}>
                <td className="px-3 py-2 font-medium">{keyName(o)}</td>
                <td className="px-3 py-2">{fmt.value(o.key, o.value)}</td>
                <td className="px-3 py-2">{scope(o)}</td>
                <td className="px-3 py-2">{o.reason}</td>
                <td className="px-3 py-2">
                  {o.expiresAt ? fmt.date(o.expiresAt) : t('admin:overrides.never')}
                </td>
                <td className="px-3 py-2">{fmt.date(o.createdAt)}</td>
                {canRemove && (
                  <td className="px-3 py-2 text-end">
                    {confirming === o.id ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => remove.mutate(o.id)} disabled={remove.isPending}>
                          {t('admin:overrides.confirmRemove')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                          {t('admin:actions.cancel')}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t('admin:overrides.removeFor', { name: keyName(o) })}
                        onClick={() => {
                          setError(null);
                          setConfirming(o.id);
                        }}
                      >
                        {t('admin:overrides.remove')}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function GrantOverrideForm({
  workspace,
  onCancel,
  onGranted,
}: {
  workspace: AdminWorkspace;
  onCancel: () => void;
  onGranted: () => void;
}) {
  const { t } = useTranslation();
  const client = useClient();
  const problemText = useProblemText();
  const updated = useWorkspaceUpdated(workspace.id);
  const [key, setKey] = useState<EntitlementKey>('build.daily_quota');
  const [value, setValue] = useState<unknown>(() => defaultGrant('build.daily_quota'));
  const [scope, setScope] = useState<'workspace' | 'owner'>('workspace');
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState('');
  const [error, setError] = useState<string | null>(null);

  const grant = useMutation({
    mutationFn: (input: CreateOverrideInput) => client.grantOverride(workspace.id, input),
    onSuccess: (ws) => {
      updated(ws);
      onGranted();
    },
    onError: (e) => setError(problemText(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const input = {
      key,
      value,
      reason,
      expiresAt: endOfDayIso(expires),
      userId: scope === 'owner' ? workspace.ownerId : null,
    };
    const parsed = createOverrideSchema.safeParse(input);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setError(
        field === 'reason'
          ? t('admin:form.reasonInvalid')
          : field === 'value'
            ? t('admin:overrides.valueInvalid')
            : t('admin:form.dateInvalid'),
      );
      return;
    }
    grant.mutate(input);
  };

  return (
    <form
      aria-label={t('admin:overrides.formTitle')}
      className="flex flex-col gap-4 rounded-md border border-line p-4"
      onSubmit={submit}
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="override-key"
          label={t('admin:overrides.key')}
          value={key}
          onChange={(e) => {
            const next = e.target.value as EntitlementKey;
            setKey(next);
            setValue(defaultGrant(next));
          }}
        >
          {ENTITLEMENT_GROUPS.map((group) => (
            <optgroup key={group.id} label={t(`admin:group.${group.id}`)}>
              {group.keys.map((k) => (
                <option key={k} value={k}>
                  {t(`admin:ent.${k}`)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <EntitlementValueEditor
          key={key}
          id="override-value"
          entKey={key}
          label={t('admin:overrides.value')}
          value={value}
          onChange={setValue}
        />
        <Select
          id="override-scope"
          label={t('admin:overrides.scope')}
          value={scope}
          onChange={(e) => setScope(e.target.value as 'workspace' | 'owner')}
        >
          <option value="workspace">{t('admin:overrides.wholeWorkspace')}</option>
          <option value="owner">{t('admin:overrides.member', { name: workspace.ownerName })}</option>
        </Select>
        <Field
          id="override-expires"
          type="date"
          label={t('admin:overrides.expires')}
          hint={t('admin:overrides.expiresHint')}
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
        />
      </div>
      <TextArea
        id="override-reason"
        label={t('admin:form.reason')}
        hint={t('admin:form.reasonHint')}
        required
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <FormError text={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={grant.isPending}>
          {t('admin:overrides.submit')}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={grant.isPending}>
          {t('admin:actions.cancel')}
        </Button>
      </div>
    </form>
  );
}
