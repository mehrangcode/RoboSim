import { breadboardLayout } from '@robosim/catalog/manifests';
import { BOARD_FOOTPRINT, pinNamesOf } from '@robosim/circuit-canvas';
import { BOARD_PART, type PinRef, type ProjectDocument } from '@robosim/shared';

/** All points of the circuit a probe can sit on, for keyboard and screen-reader users. */
export function pointOptions(
  doc: ProjectDocument,
): { group: string; options: { value: string; label: string }[] }[] {
  const enc = (r: PinRef) => `${r.part}\u0000${r.pin}`;
  return [
    {
      group: 'Uno',
      options: Object.keys(BOARD_FOOTPRINT.pins).map((pin) => ({
        value: enc({ part: BOARD_PART, pin }),
        label: pin,
      })),
    },
    ...doc.components
      .filter((c) => !breadboardLayout(c.type))
      .map((c) => ({
        group: c.id,
        options: pinNamesOf(c.type).map((pin) => ({
          value: enc({ part: c.id, pin }),
          label: `${c.id} · ${pin}`,
        })),
      })),
  ];
}
/** Wraps text in Unicode LEFT-TO-RIGHT ISOLATE … POP DIRECTIONAL ISOLATE. */
export const ltr = (text: string): string => `\u2066${text}\u2069`;
export const decodePoint = (v: string): PinRef => {
  const [part = '', pin = ''] = v.split('\u0000');
  return { part, pin };
};
export const encodePoint = (r: PinRef | null) => (r ? `${r.part}\u0000${r.pin}` : '');
