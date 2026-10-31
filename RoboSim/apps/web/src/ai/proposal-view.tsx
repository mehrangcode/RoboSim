import type { AiProposal, CircuitChange } from '@robosim/shared';
import { Button } from '@robosim/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Status =
  { kind: 'open' } | { kind: 'applied' } | { kind: 'rejected' } | { kind: 'failed'; reason: string };

/** One suggested change (FR-AI-05, US-AI-02): nothing changes until the learner presses Apply. */
export function ProposalView({
  proposal,
  onApply,
}: {
  proposal: AiProposal;
  /** Applies it; returns why it no longer fits, or null. Absent when the project is read-only. */
  onApply: ((p: AiProposal) => string | null) | undefined;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>({ kind: 'open' });
  const title =
    proposal.kind === 'code_patch'
      ? t('ai:proposal.codeTitle', { file: proposal.file })
      : t('ai:proposal.circuitTitle');
  const apply = () => {
    if (!onApply) return;
    const reason = onApply(proposal);
    setStatus(reason ? { kind: 'failed', reason } : { kind: 'applied' });
  };
  return (
    <section aria-label={title} className="mt-2 rounded-md border border-line bg-surface">
      <header className="border-b border-line px-3 py-2">
        <p className="text-sm font-medium">{title}</p>
        {proposal.summary && <p className="text-xs text-ink-muted">{proposal.summary}</p>}
      </header>
      {proposal.kind === 'code_patch' ? (
        <Diff text={proposal.unifiedDiff} />
      ) : (
        <ChangeList changes={proposal.changes} />
      )}
      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        {status.kind === 'open' && onApply && (
          <>
            <Button size="sm" onClick={apply}>
              {t('ai:proposal.apply')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStatus({ kind: 'rejected' })}>
              {t('ai:proposal.reject')}
            </Button>
          </>
        )}
        {status.kind === 'open' && !onApply && (
          <p className="text-xs text-ink-muted">{t('ai:proposal.readOnly')}</p>
        )}
        {status.kind === 'applied' && (
          <p role="status" className="text-xs text-ok">
            {t('ai:proposal.applied')}
          </p>
        )}
        {status.kind === 'rejected' && <p className="text-xs text-ink-muted">{t('ai:proposal.rejected')}</p>}
        {status.kind === 'failed' && (
          <p role="alert" className="text-xs text-danger">
            {t('ai:proposal.failed', { reason: status.reason })}
          </p>
        )}
      </footer>
    </section>
  );
}

function Diff({ text }: { text: string }) {
  const { t } = useTranslation();
  const lines = text.split('\n').filter((l, i) => i > 1 && l !== '');
  return (
    <pre
      dir="ltr"
      aria-label={t('ai:proposal.diffLabel')}
      className="max-h-64 overflow-auto px-0 py-1 font-mono text-xs leading-5"
    >
      {lines.map((l, i) => (
        <div
          key={i}
          className={
            l.startsWith('+')
              ? 'bg-ok/10 px-3 text-ok'
              : l.startsWith('-')
                ? 'bg-danger/10 px-3 text-danger'
                : l.startsWith('@@')
                  ? 'px-3 text-ink-muted'
                  : 'px-3'
          }
        >
          {l.startsWith('+') ? <span className="sr-only">{t('ai:proposal.added')} </span> : null}
          {l.startsWith('-') ? <span className="sr-only">{t('ai:proposal.removed')} </span> : null}
          {l}
        </div>
      ))}
    </pre>
  );
}

function ChangeList({ changes }: { changes: readonly CircuitChange[] }) {
  const { t } = useTranslation();
  const pin = (p: { part: string; pin: string }) => `${p.part}:${p.pin}`;
  const describe = (c: CircuitChange): string => {
    switch (c.op) {
      case 'add_component':
        return t('ai:change.addComponent', {
          id: c.id,
          type: t(`components:${c.type}.name`, { defaultValue: c.type }),
        });
      case 'remove_component':
        return t('ai:change.removeComponent', { id: c.id });
      case 'set_prop':
        return t('ai:change.setProp', { id: c.id, prop: c.prop, value: String(c.value) });
      case 'add_wire':
        return t('ai:change.addWire', { from: pin(c.from), to: pin(c.to) });
      case 'remove_wire':
        return t('ai:change.removeWire', { from: pin(c.from), to: pin(c.to) });
    }
  };
  return (
    <ol className="list-decimal px-3 py-2 ps-8 text-sm">
      {changes.map((c, i) => (
        <li key={i}>
          <bdi>{describe(c)}</bdi>
        </li>
      ))}
    </ol>
  );
}
