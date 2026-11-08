/** Wire colours the editor offers, by name (the document stores the name). */
export const WIRE_COLORS: Readonly<Record<string, string>> = {
  red: '#dc2626',
  black: '#111827',
  yellow: '#eab308',
  green: '#16a34a',
  blue: '#2563eb',
  orange: '#ea580c',
  white: '#e5e7eb',
  purple: '#9333ea',
};

/**
 * Wire colour convention (FR-CIR-11): ground and supply nets get their colour, and signal wires should
 * not use either of them (`signalAvoid`). User-configurable, kept in this browser.
 */
export interface WireConvention {
  readonly ground: string;
  readonly supply: string;
  readonly signalAvoid: boolean;
}

export const DEFAULT_WIRE_CONVENTION: WireConvention = { ground: 'black', supply: 'red', signalAvoid: true };

export const WIRE_CONVENTION_KEY = 'robosim.wireConvention.v1';

const isColor = (v: unknown): v is string => typeof v === 'string' && v in WIRE_COLORS;

/** The saved convention, or the default when nothing (valid) is saved or storage is blocked. */
export function loadWireConvention(): WireConvention {
  try {
    const raw = JSON.parse(
      localStorage.getItem(WIRE_CONVENTION_KEY) ?? 'null',
    ) as Partial<WireConvention> | null;
    if (!raw || !isColor(raw.ground) || !isColor(raw.supply) || raw.ground === raw.supply)
      return DEFAULT_WIRE_CONVENTION;
    return { ground: raw.ground, supply: raw.supply, signalAvoid: raw.signalAvoid !== false };
  } catch {
    return DEFAULT_WIRE_CONVENTION;
  }
}

export function saveWireConvention(conv: WireConvention): void {
  try {
    localStorage.setItem(WIRE_CONVENTION_KEY, JSON.stringify(conv));
  } catch {
    // Storage blocked: the convention applies to this session only.
  }
}
