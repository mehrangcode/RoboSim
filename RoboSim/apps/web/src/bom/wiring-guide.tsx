import { CircuitPicture, stepFocus, wiringGuide, type WiringGroup } from '@robosim/circuit-canvas';
import type { ProjectDocument } from '@robosim/shared';
import { Button } from '@robosim/ui';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../lab/format.js';
import { downloadBlob, fileBase } from '../editor/project-file.js';
import { useBomText } from './bom-text.js';
import { svgMarkup, svgToPng } from './exports.js';

export function useWiringGuide(doc: ProjectDocument): WiringGroup[] {
  return useMemo(() => wiringGuide(doc), [doc]);
}

/** The guide as steps grouped by subsystem; `onShow` points the canvas at a step's wire or part. */
export function WiringSteps({
  doc,
  groups,
  onShow,
}: {
  doc: ProjectDocument;
  groups: readonly WiringGroup[];
  onShow?: ((step: { kind: 'seat' | 'wire'; id: string }) => void) | undefined;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { stepText, stepDetail } = useBomText(doc);
  let n = 0;
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section
          key={g.subsystem}
          aria-labelledby={`wiring-${g.subsystem}`}
          className="break-inside-avoid-page"
        >
          <h3 id={`wiring-${g.subsystem}`} className="mb-2 text-sm font-semibold">
            {t(`bom:subsystem.${g.subsystem}`)}
          </h3>
          <ol className="flex flex-col gap-2">
            {g.steps.map((step) => {
              const text = stepText(step);
              const number = ++n;
              return (
                <li
                  key={`${step.kind}:${step.id}`}
                  className="flex break-inside-avoid gap-3 rounded-md border border-line p-2"
                >
                  <span className="w-6 shrink-0 text-end font-semibold tabular-nums" aria-hidden>
                    {fmt(number)}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-sm">
                      <span className="sr-only">{t('bom:wiring.stepNumber', { n: number })} </span>
                      {text}
                    </p>
                    {stepDetail(step) && <p className="text-xs text-ink-muted">{stepDetail(step)}</p>}
                    {onShow && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="self-start print:hidden"
                        onClick={() => onShow({ kind: step.kind, id: step.id })}
                      >
                        {t('bom:wiring.show')}
                      </Button>
                    )}
                  </div>
                  <div className="w-40 shrink-0 [content-visibility:auto] sm:w-48">
                    <CircuitPicture
                      doc={doc}
                      focus={stepFocus(step)}
                      label={t('bom:wiring.diagram', { step: text })}
                      className="h-28 w-full rounded border border-line bg-white"
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function WiringGuide({
  doc,
  onShow,
  onPrint,
}: {
  doc: ProjectDocument;
  onShow: (step: { kind: 'seat' | 'wire'; id: string }) => void;
  onPrint: () => void;
}) {
  const { t } = useTranslation();
  const groups = useWiringGuide(doc);
  const picture = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);
  const name = fileBase(doc);

  const exportSvg = () => {
    if (!picture.current) return;
    downloadBlob(`${name}-circuit.svg`, new Blob([svgMarkup(picture.current)], { type: 'image/svg+xml' }));
  };
  const exportPng = async () => {
    if (!picture.current) return;
    try {
      setFailed(false);
      downloadBlob(`${name}-circuit.png`, await svgToPng(svgMarkup(picture.current)));
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onPrint}>
          {t('bom:print')}
        </Button>
        <Button size="sm" variant="secondary" onClick={exportSvg}>
          {t('bom:export.svg')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void exportPng()}>
          {t('bom:export.png')}
        </Button>
        {failed && (
          <span role="alert" className="text-xs text-danger">
            {t('bom:export.pngFailed')}
          </span>
        )}
      </div>
      {/* The full circuit as one picture, the source of the image exports. */}
      <div className="hidden" aria-hidden>
        <CircuitPicture ref={picture} doc={doc} label={doc.meta.title} />
      </div>
      {groups.length ? (
        <WiringSteps doc={doc} groups={groups} onShow={onShow} />
      ) : (
        <p className="text-ink-muted">{t('bom:wiring.empty')}</p>
      )}
    </div>
  );
}
