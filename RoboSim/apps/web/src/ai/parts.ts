import { UNO_PINS } from '@robosim/board-avr-uno/pins';
import { findManifest } from '@robosim/catalog/manifests';
import type { PartResolver } from '@robosim/shared';

/** Catalogue and board pins for checking and applying circuit proposals in the browser (same rules as the API). */
export const PARTS: PartResolver = {
  part(type) {
    const m = findManifest(type);
    if (!m) return undefined;
    return {
      version: m.version,
      pins: m.pins.map((p) => p.name),
      props: Object.fromEntries(Object.entries(m.props).map(([k, spec]) => [k, spec.default])),
    };
  },
  boardPins: UNO_PINS.map((p) => p.id),
};
