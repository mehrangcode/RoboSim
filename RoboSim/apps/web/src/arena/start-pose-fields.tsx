import type { PoseProblem } from '@robosim/content/arenas';
import type { Pose } from '@robosim/renderer-2d';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const RAD_PER_DEG = Math.PI / 180;

/** One number field that commits on Enter / blur and shows the committed value otherwise. */
export function NumberField({
  label,
  value,
  step,
  disabled,
  onCommit,
  className = 'flex items-center gap-1',
}: {
  label: string;
  value: number;
  step: number;
  disabled: boolean;
  onCommit: (v: number) => void;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const v = Number(text);
    // A refused value snaps back to the committed one (the parent says why).
    if (text.trim() !== '' && Number.isFinite(v)) onCommit(v);
    setText(null);
  };
  return (
    <label className={className}>
      <span className="text-ink-muted">{label}</span>
      <input
        type="number"
        dir="ltr"
        step={step}
        disabled={disabled}
        value={text ?? String(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setText(null);
        }}
        className="w-20 rounded border border-line bg-surface px-1 py-0.5 tabular-nums"
      />
    </label>
  );
}

/**
 * Exact start pose (FR-ARN-06): x / y in centimetres, heading in degrees, and back to the arena's
 * own start. Values that put the robot off the mat or onto an obstacle are refused.
 */
export function StartPoseFields({
  pose,
  disabled,
  check,
  onChange,
  onReset,
}: {
  pose: Pose;
  disabled: boolean;
  check: (pose: Pose) => PoseProblem | null;
  onChange: (pose: Pose) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const [problem, setProblem] = useState<PoseProblem | null>(null);
  const tryPose = (next: Pose) => {
    const p = check(next);
    setProblem(p);
    if (!p) onChange(next);
  };
  const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs" disabled={disabled}>
      <legend className="sr-only">{t('shell:arena.pose.title')}</legend>
      <NumberField
        label={t('shell:arena.pose.x')}
        value={round(pose.x * 100, 1)}
        step={1}
        disabled={disabled}
        onCommit={(cm) => tryPose({ ...pose, x: cm / 100 })}
      />
      <NumberField
        label={t('shell:arena.pose.y')}
        value={round(pose.y * 100, 1)}
        step={1}
        disabled={disabled}
        onCommit={(cm) => tryPose({ ...pose, y: cm / 100 })}
      />
      <NumberField
        label={t('shell:arena.pose.heading')}
        value={round(pose.angle / RAD_PER_DEG, 1)}
        step={15}
        disabled={disabled}
        onCommit={(deg) => tryPose({ ...pose, angle: deg * RAD_PER_DEG })}
      />
      <button
        type="button"
        onClick={() => {
          setProblem(null);
          onReset();
        }}
        className="rounded border border-line px-1.5 py-0.5 hover:bg-surface-raised"
      >
        {t('shell:arena.pose.reset')}
      </button>
      {problem && (
        <span role="alert" className="text-danger">
          {problem.kind === 'outside'
            ? t('shell:arena.pose.outside')
            : t('shell:arena.pose.obstacle', { id: problem.id })}
        </span>
      )}
    </fieldset>
  );
}
