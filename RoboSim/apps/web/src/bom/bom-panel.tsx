import type { ProjectDocument } from '@robosim/shared';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../lab/format.js';
import type { BomClient } from '../lib/bom-api.js';
import { useBomText } from './bom-text.js';
import { PartsList, usePricedBom } from './parts-list.js';
import { useBomData, type BomData } from './use-bom-data.js';
import { WiringGuide, WiringSteps, useWiringGuide } from './wiring-guide.js';
/** Tick box drawn next to each line on the printed sheet. */ const PRINT_BOX = '☐ ';

export type BomTab = 'parts' | 'wiring';

/** The editor dock's "Parts list" and "Wiring" tabs (FR-BOM-01…05), with a printable sheet of both. */
export function BomPanel({
  doc,
  tab,
  client,
  onShow,
}: {
  doc: ProjectDocument;
  tab: BomTab;
  client: BomClient;
  onShow: (step: { kind: 'seat' | 'wire'; id: string }) => void;
}) {
  const data = useBomData(client);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    try {
      window.print();
    } catch {
      done(); // printing unavailable (tests, some embedded browsers)
    }
    return () => window.removeEventListener('afterprint', done);
  }, [printing]);

  const print = () => setPrinting(true);
  return (
    <>
      {tab === 'parts' ? (
        <PartsList doc={doc} data={data} onPrint={print} />
      ) : (
        <WiringGuide doc={doc} onShow={onShow} onPrint={print} />
      )}
      {printing && createPortal(<PrintSheet doc={doc} data={data} />, document.body)}
    </>
  );
}

/** What paper gets: title, parts list and wiring guide. Shown only by the print stylesheet. */
function PrintSheet({ doc, data }: { doc: ProjectDocument; data: BomData }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { lineName } = useBomText(doc);
  const bom = usePricedBom(doc, data);
  const groups = useWiringGuide(doc);
  const money = (v: number | null) => (v === null ? '—' : t('bom:money', { amount: fmt(v) }));
  return (
    <div className="print-sheet hidden bg-white p-6 text-black print:block" data-testid="print-sheet">
      <h1 className="text-xl font-bold">{doc.meta.title}</h1>
      <h2 className="mt-4 text-lg font-semibold">{t('bom:tab.parts')}</h2>
      <table className="mt-2 w-full text-start text-sm">
        <thead>
          <tr>
            <th className="text-start">{t('bom:col.part')}</th>
            <th className="text-end">{t('bom:col.toBuy')}</th>
            <th className="text-end">{t('bom:col.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {bom.lines.map((l) => (
            <tr key={l.key}>
              <td>
                <span aria-hidden>{PRINT_BOX}</span>
                {lineName(l)}
              </td>
              <td className="text-end">{fmt(l.toBuy)}</td>
              <td className="text-end">{money(l.lineTotalIrr)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td colSpan={2}>{t('bom:total')}</td>
            <td className="text-end">{money(bom.totalIrr)}</td>
          </tr>
        </tfoot>
      </table>
      <h2 className="mt-6 break-before-page text-lg font-semibold">{t('bom:tab.wiring')}</h2>
      <WiringSteps doc={doc} groups={groups} />
    </div>
  );
}
