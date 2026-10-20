import { finding, type CodeRef, type Finding, type PinUse, type StaticRule } from '@robosim/sim-core';
import { codeOutputPins, netUsers, wiredMcuPins } from '../helpers.js';

/**
 * Code-aware rules (FR-SAF-03): the sketch's pin usage (FR-COD-06, `ctx.code`) checked against the wiring.
 * Each finding carries the sketch lines it is about (`codeRefs`) so the editor can mark them. A pin the
 * analysis could not resolve is never guessed: no finding rather than a false one.
 */

const FLOATING_OHMS = 10e6; // as the runtime SAF-FLOATING-INPUT
/** The Servo library on the ATmega328P runs on Timer1, whose PWM outputs are D9 and D10. */
const SERVO_TIMER_PINS = new Set(['D9', 'D10']);

/** Uses of each pin, in source order. */
function byPin(uses: readonly PinUse[], keep: (u: PinUse) => boolean): Map<string, CodeRef[]> {
  const out = new Map<string, CodeRef[]>();
  for (const u of uses) if (keep(u)) out.set(u.pin, [...(out.get(u.pin) ?? []), u.at]);
  return out;
}

const pinNumber = (label: string): string => label.replace(/^~/, '');

/** How the sketch writes the pin: D2 → '2', A0 → 'A0' (for advice like `pinMode(2, INPUT_PULLUP)`). */
const pinArg = (pin: string): string => pin.replace(/^D/, '');

/** analogWrite on a pin without hardware PWM (US-SAF-02 AC1). */
export const codePwmPin: StaticRule = {
  id: 'SAF-CODE-PWM-PIN',
  kind: 'static',
  check({ code, board }) {
    if (!code || !board) return [];
    const pwm = board.pins.filter((p) => p.capabilities.includes('pwm'));
    const pwmIds = new Set(pwm.map((p) => p.id));
    const out: Finding[] = [];
    for (const [pin, at] of byPin(code.uses, (u) => u.use === 'analogWrite' && !pwmIds.has(u.pin)))
      out.push(
        finding({
          ruleId: this.id,
          severity: 'warning',
          componentIds: [],
          pinIds: [pin],
          params: { pin, pwmPins: pwm.map((p) => pinNumber(p.label)).join(', ') },
          codeRefs: at,
        }),
      );
    return out;
  },
};

/** The sketch drives a pin that a part's output (or another driven MCU pin) also drives. */
export const codeOutputConflict: StaticRule = {
  id: 'SAF-CODE-OUTPUT-CONFLICT',
  kind: 'static',
  check({ code, circuit }) {
    if (!code) return [];
    const outputs = codeOutputPins(code);
    const refs = byPin(
      code.uses,
      (u) => outputs.has(u.pin) && u.use !== 'digitalRead' && u.use !== 'analogRead',
    );
    const users = netUsers(circuit);
    const out: Finding[] = [];
    const paired = new Set<string>();
    for (const { pin, net } of wiredMcuPins(circuit)) {
      if (!outputs.has(pin) || net === 0) continue;
      const at = refs.get(pin) ?? [];
      for (const u of users.get(net) ?? []) {
        if (u.partId === null) {
          // Two driven MCU pins on one net: one finding for the pair.
          if (u.pin === pin || !outputs.has(u.pin) || paired.has(u.pin)) continue;
          paired.add(pin);
          out.push(
            finding({
              ruleId: this.id,
              severity: 'error',
              componentIds: [],
              pinIds: [pin, u.pin],
              params: { pin, other: u.pin },
              codeRefs: [...at, ...(refs.get(u.pin) ?? [])],
            }),
          );
          continue;
        }
        const part = circuit.parts.find((p) => p.id === u.partId);
        if (part?.def.manifest.pins.find((p) => p.name === u.pin)?.kind !== 'output') continue;
        out.push(
          finding({
            ruleId: this.id,
            severity: 'error',
            componentIds: [part.id],
            pinIds: [pin],
            params: { pin, other: `${part.id}.${u.pin}` },
            codeRefs: at,
          }),
        );
      }
    }
    return out;
  },
};

/**
 * A pin the sketch reads as a plain input whose net, with every MCU pin high-impedance, has no path to a
 * rail. Skipped while any pinMode is unresolved (it might set INPUT_PULLUP), and for pins the sketch
 * also drives, pulls up (pinMode INPUT_PULLUP, or digitalWrite HIGH on an input) or that share a net
 * with a pin it drives (multiplexed lines).
 */
export const codeFloatingInput: StaticRule = {
  id: 'SAF-CODE-FLOATING-INPUT',
  kind: 'static',
  check({ code, circuit, idle }) {
    if (!code || code.unresolved.some((u) => u.call === 'pinMode')) return [];
    const outputs = codeOutputPins(code);
    const pulled = new Set(
      code.uses.filter((u) => u.mode === 'INPUT_PULLUP' || u.use === 'digitalWrite').map((u) => u.pin),
    );
    const reads = byPin(code.uses, (u) => u.use === 'digitalRead' || u.mode === 'INPUT');
    const users = netUsers(circuit);
    const out: Finding[] = [];
    for (const { pin, net } of wiredMcuPins(circuit)) {
      const at = reads.get(pin);
      if (!at || outputs.has(pin) || pulled.has(pin) || net === 0) continue;
      if ((users.get(net) ?? []).some((u) => u.partId === null && outputs.has(u.pin))) continue;
      if (idle.netResistance(net) <= FLOATING_OHMS) continue;
      out.push(
        finding({
          ruleId: this.id,
          severity: 'warning',
          componentIds: [],
          pinIds: [pin],
          params: { pin, pinArg: pinArg(pin) },
          codeRefs: at,
        }),
      );
    }
    return out;
  },
};

/** The Servo library takes Timer1: analogWrite on D9 / D10 stops working once a servo is attached. */
export const codeServoPwm: StaticRule = {
  id: 'SAF-CODE-SERVO-PWM',
  kind: 'static',
  check({ code }) {
    if (!code || !code.uses.some((u) => u.use === 'servo')) return [];
    const out: Finding[] = [];
    for (const [pin, at] of byPin(code.uses, (u) => u.use === 'analogWrite' && SERVO_TIMER_PINS.has(u.pin)))
      out.push(
        finding({
          ruleId: this.id,
          severity: 'warning',
          componentIds: [],
          pinIds: [pin],
          params: { pin },
          codeRefs: at,
        }),
      );
    return out;
  },
};

export const CODE_RULES: readonly StaticRule[] = [
  codePwmPin,
  codeOutputConflict,
  codeFloatingInput,
  codeServoPwm,
];
