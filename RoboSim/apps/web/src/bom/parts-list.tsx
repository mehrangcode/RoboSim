import { buildBom, priceBom, type PricedBom } from '@robosim/circuit-canvas';
import { formatDate } from '@robosim/i18n';
import type { ProjectDocument } from '@robosim/shared';
import { Button } from '@robosim/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../lab/format.js';
import { downloadBlob, fileBase } from '../editor/project-file.js';
import { useBomText } from './bom-text.js';
import { toCsv, toXlsx, type Cell } from './exports.js';
import type { BomData } from './use-bom-data.js';

/** The priced parts list of a document with its owned parts applied (FR-BOM-01…03). */
export function usePricedBom(doc: ProjectDocument, data: BomData): PricedBom {
  const lines = useMemo(() => buildBom(doc), [doc]);
  return useMemo(
    () => priceBom(lines, data.prices?.items ?? [], data.owned),
    [lines, data.prices, data.owned],
  );
}

/** Rows for CSV/XLSX: a header, one row per line, and the total. */
export function useBomRows(doc: ProjectDocument, bom: PricedBom) {
  const { t } = useTranslation();
  const { lineName } = useBomText(doc);
  return (): Cell[][] => [
    [
      t('bom:col.part'),
      t('bom:col.quantity'),
      t('bom:col.owned'),
      t('bom:col.toBuy'),
      t('bom:col.unitPrice'),
      t('bom:col.lineTotal'),
      t('bom:col.stock'),
      t('bom:col.notes'),
    ],
    ...bom.lines.map((l): Cell[] => [
      lineName(l),
      l.quantity,
      l.owned,
      l.toBuy,
      l.unitPriceIrr,
      l.lineTotalIrr,
      t(`bom:stock.${l.stock}`),
      l.kind === 'jumper' ? t('bom:jumperNote', { count: l.wires ?? 0 }) : l.instances.join(' '),
    ]),
    [
      t('bom:total'),
      null,
      null,
      null,
      null,
      bom.totalIrr,
      null,
      bom.unpriced ? t('bom:unpriced', { count: bom.unpriced }) : null,
    ],
  ];
}

export function PartsList({
  doc,
  data,
  onPrint,
}: {
  doc: ProjectDocument;
  data: BomData;
  onPrint: () => void;
}) {
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const { lineName } = useBomText(doc);
  const bom = usePricedBom(doc, data);
  const rows = useBomRows(doc, bom);
  const money = (v: number | null) => (v === null ? '—' : t('bom:money', { amount: fmt(v) }));
  const name = fileBase(doc);
  const rtl = i18n.language === 'fa';

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            downloadBlob(`${name}-parts.csv`, new Blob([toCsv(rows())], { type: 'text/csv;charset=utf-8' }))
          }
        >
          {t('bom:export.csv')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            downloadBlob(
              `${name}-parts.xlsx`,
              new Blob([toXlsx(t('bom:sheetName'), rows(), rtl)], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              }),
            )
          }
        >
          {t('bom:export.xlsx')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onPrint}>
          {t('bom:print')}
        </Button>
        <span className="ms-auto text-xs text-ink-muted">
          {data.prices?.asOf
            ? t('bom:asOf', { date: formatDate(rtl ? 'fa' : 'en', new Date(data.prices.asOf)) })
            : data.pricesFailed
              ? t('bom:pricesFailed')
              : null}
        </span>
      </div>
      {data.saveFailed && (
        <p role="alert" className="text-xs text-danger">
          {t('bom:saveFailed')}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-start">
          <caption className="sr-only">{t('bom:caption')}</caption>
          <thead className="text-xs text-ink-muted">
            <tr>
              <th className="px-2 py-1 text-start font-medium">{t('bom:col.part')}</th>
              <th className="px-2 py-1 text-end font-medium">{t('bom:col.quantity')}</th>
              <th className="px-2 py-1 text-start font-medium">{t('bom:col.owned')}</th>
              <th className="px-2 py-1 text-end font-medium">{t('bom:col.unitPrice')}</th>
              <th className="px-2 py-1 text-end font-medium">{t('bom:col.lineTotal')}</th>
              <th className="px-2 py-1 text-start font-medium">{t('bom:col.stock')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {bom.lines.map((l) => {
              const label = lineName(l);
              return (
                <tr key={l.key} className={l.toBuy === 0 ? 'text-ink-muted' : undefined}>
                  <td className="px-2 py-1">
                    {label}
                    {l.tier === 'pro' && (
                      <span className="ms-1 rounded bg-brand-600/10 px-1 text-xs text-brand-700">
                        {t('bom:pro')}
                      </span>
                    )}
                    {l.kind === 'jumper' && (
                      <span className="block text-xs text-ink-muted">
                        {t('bom:jumperNote', { count: l.wires ?? 0 })}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-end tabular-nums">{fmt(l.quantity)}</td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      min={0}
                      max={l.quantity}
                      step={1}
                      value={l.owned}
                      aria-label={t('bom:ownedOf', { part: label })}
                      onChange={(e) =>
                        data.setOwned(l.key, Math.max(0, Math.min(l.quantity, Number(e.target.value) || 0)))
                      }
                      className="w-16 rounded border border-line bg-surface px-1 py-0.5 tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1 text-end tabular-nums">{money(l.unitPriceIrr)}</td>
                  <td className="px-2 py-1 text-end tabular-nums">{money(l.lineTotalIrr)}</td>
                  <td className="px-2 py-1">{t(`bom:stock.${l.stock}`)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-semibold">
              <td className="px-2 py-1" colSpan={4}>
                {t('bom:total')}
              </td>
              <td className="px-2 py-1 text-end tabular-nums" data-testid="bom-total">
                {money(bom.totalIrr)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {bom.unpriced > 0 && (
        <p className="text-xs text-ink-muted">{t('bom:unpriced', { count: bom.unpriced })}</p>
      )}
    </div>
  );
}
