import type { BomLine, WireEnd, WiringStep } from '@robosim/circuit-canvas';
import { findManifest } from '@robosim/catalog/manifests';
import { BOARD_PART, type PinRef, type ProjectDocument, type VariantValue } from '@robosim/shared';
import { useTranslation } from 'react-i18next';

const ohms = (v: number) => (v >= 1e6 ? `${v / 1e6} MΩ` : v >= 1e3 ? `${v / 1e3} kΩ` : `${v} Ω`);

/** Words for parts-list lines and wiring steps, in the UI language. */
export function useBomText(doc: ProjectDocument) {
  const { t } = useTranslation();
  const typeOf = new Map(doc.components.map((c) => [c.id, c.type]));
  const count = new Map<string, number>();
  for (const c of doc.components) count.set(c.type, (count.get(c.type) ?? 0) + 1);

  const typeName = (type: string): string => {
    const key = findManifest(type)?.nameKey;
    return key ? t(`components:${key}`) : type;
  };

  const variantValue = (prop: string, v: VariantValue): string => {
    if (prop === 'ohms' && typeof v === 'number') return ohms(v);
    if (prop === 'capacitanceNf') return `${String(v)} nF`;
    if (prop === 'capacitanceUf') return `${String(v)} µF`;
    if (prop === 'count') return t('bom:variant.count', { count: Number(v) });
    return t(`editor:option.${String(v)}`, { defaultValue: String(v) });
  };

  const lineName = (line: BomLine): string => {
    if (line.kind === 'board') return t(`bom:board.${line.type}`, { defaultValue: line.type });
    if (line.kind === 'jumper') return t(`bom:jumper.${line.type}`);
    const variant = Object.entries(line.variant).map(([p, v]) => variantValue(p, v));
    return variant.length ? `${typeName(line.type)} — ${variant.join(', ')}` : typeName(line.type);
  };

  /** A part as the guide names it: its type, plus its canvas id when there are several of that type. */
  const partName = (id: string): string => {
    if (id === BOARD_PART) return t(`bom:board.${doc.board.id}`, { defaultValue: doc.board.id });
    const type = typeOf.get(id) ?? '';
    return (count.get(type) ?? 0) > 1 ? `${typeName(type)} (${id})` : typeName(type);
  };
  const pinText = (ref: PinRef): string =>
    t('bom:wiring.pin', {
      part: partName(ref.part),
      pin: ref.part === BOARD_PART ? ref.pin : ref.pin.toUpperCase(),
    });

  const endText = (end: WireEnd): string => {
    if (end.ref.part === BOARD_PART)
      return t('bom:wiring.pin', { part: partName(BOARD_PART), pin: end.label });
    if (end.hole) {
      const hole = t('bom:wiring.hole', { hole: end.label, breadboard: partName(end.ref.part) });
      return end.via.length ? t('bom:wiring.holeVia', { hole, legs: end.via.map(pinText).join(', ') }) : hole;
    }
    return t('bom:wiring.pin', { part: partName(end.ref.part), pin: end.label });
  };

  const stepText = (step: WiringStep): string =>
    step.kind === 'seat'
      ? t('bom:wiring.seat', {
          part: partName(step.part),
          breadboard: partName(step.breadboard),
          holes: step.legs.map((l) => `${l.pin.toUpperCase()} → ${l.hole}`).join(', '),
        })
      : t('bom:wiring.wire', { from: endText(step.from), to: endText(step.to) });

  const stepDetail = (step: WiringStep): string => {
    if (step.kind === 'seat') return '';
    const color = t(`editor:color.${step.color}`, { defaultValue: step.color });
    return step.jumper
      ? t('bom:wiring.detail', { color, jumper: t(`bom:jumperShort.${step.jumper}`) })
      : t('bom:wiring.detailLead', { color });
  };

  return { lineName, partName, stepText, stepDetail };
}
