import type { ComponentManifest, PropSpec } from './contracts.js';

export type PropValue = number | string | boolean;

/** Fills manifest defaults and validates user-supplied properties (unknown keys, type, range, enum). */
export function resolveProps(
  manifest: ComponentManifest,
  given: Readonly<Record<string, PropValue>> = {},
): Record<string, PropValue> {
  for (const key of Object.keys(given)) {
    if (!(key in manifest.props)) throw new RangeError(`${manifest.id}: unknown property '${key}'`);
  }
  const out: Record<string, PropValue> = {};
  for (const [key, spec] of Object.entries(manifest.props)) {
    const value = given[key] ?? spec.default;
    checkProp(manifest.id, key, spec, value);
    out[key] = value;
  }
  return out;
}

function checkProp(id: string, key: string, spec: PropSpec, value: PropValue): void {
  const fail = (why: string): never => {
    throw new RangeError(`${id}: property '${key}' ${why}`);
  };
  switch (spec.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a finite number');
      if (spec.min !== undefined && (value as number) < spec.min) fail(`must be ≥ ${spec.min}`);
      if (spec.max !== undefined && (value as number) > spec.max) fail(`must be ≤ ${spec.max}`);
      break;
    case 'enum':
      if (typeof value !== 'string' || !spec.options.includes(value))
        fail(`must be one of ${spec.options.join(', ')}`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') fail('must be a boolean');
  }
}

/** Structural checks every catalogue manifest must pass (run by each component package's tests). */
export function validateManifest(m: ComponentManifest): string[] {
  const errors: string[] = [];
  if (!/^[a-z]+\.[a-z0-9-]+$/.test(m.id)) errors.push(`id '${m.id}' must look like 'category.name'`);
  if (!/^\d+\.\d+\.\d+$/.test(m.version)) errors.push(`version '${m.version}' must be semver`);
  if (m.nameKey !== `${m.id}.name`) errors.push(`nameKey must be '${m.id}.name'`);
  const pinNames = m.pins.map((p) => p.name);
  if (new Set(pinNames).size !== pinNames.length) errors.push('duplicate pin names');
  if (!(m.massG >= 0)) errors.push('massG must be ≥ 0');
  if (m.mounting) {
    for (const [key, v] of Object.entries(m.mounting))
      if (!(v > 0)) errors.push(`mounting.${key} must be > 0`);
  }
  for (const [key, spec] of Object.entries(m.props)) {
    try {
      checkProp(m.id, key, spec, spec.default);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  const hasPin = (pin: string): boolean => pinNames.includes(pin);
  for (const pin of m.polarity ?? []) if (!hasPin(pin)) errors.push(`polarity pin '${pin}' does not exist`);
  for (const sp of m.supplyPins ?? []) {
    if (!hasPin(sp.pin)) errors.push(`supply pin '${sp.pin}' does not exist`);
    if (sp.enabledByProp && m.props[sp.enabledByProp]?.type !== 'boolean') {
      errors.push(`supply pin '${sp.pin}': enabledByProp '${sp.enabledByProp}' must be a boolean prop`);
    }
  }
  for (const pair of [...(m.bondedPins ?? []), ...(m.signalPassthrough ?? []), ...(m.isolationGroups ?? [])])
    for (const pin of pair)
      if (!hasPin(pin))
        errors.push(`pin '${pin}' in bondedPins/signalPassthrough/isolationGroups does not exist`);
  for (const pin of Object.keys(m.pinMaxVolts ?? {}))
    if (!hasPin(pin)) errors.push(`pinMaxVolts pin '${pin}' does not exist`);
  if (m.pinMaxVolts && !m.polarity) errors.push('pinMaxVolts needs a polarity pair as reference');
  if (m.peakCurrentPer && m.props[m.peakCurrentPer]?.type !== 'number')
    errors.push(`peakCurrentPer '${m.peakCurrentPer}' must be a number prop`);
  if (m.i2c) {
    for (const pin of [
      m.i2c.sda,
      m.i2c.scl,
      ...(m.i2c.addressPin ? [m.i2c.addressPin.pin] : []),
      ...(m.i2c.resetPin ? [m.i2c.resetPin] : []),
    ])
      if (!hasPin(pin)) errors.push(`i2c pin '${pin}' does not exist`);
    if (m.i2c.addressProp && m.props[m.i2c.addressProp]?.type !== 'enum')
      errors.push(`i2c addressProp '${m.i2c.addressProp}' must be an enum prop`);
    if (!(m.i2c.address >= 0x08 && m.i2c.address <= 0x77)) errors.push('i2c address must be 0x08–0x77');
  }
  for (const input of m.inputs) {
    if (typeof input.default !== input.type)
      errors.push(`input '${input.name}' default must be ${input.type}`);
  }
  return errors;
}
