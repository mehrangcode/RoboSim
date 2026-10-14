import { describe, expect, it } from 'vitest';
import { isUuid, uuidv7 } from './ids.js';

describe('UUIDv7 identifiers (Technical Design §7.2)', () => {
  it('generates RFC 9562 version-7 UUIDs', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('is time-ordered', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
  });

  it('sorts in creation order within the same millisecond (outbox tie-breaker)', () => {
    const ms = Date.now() + 60_000;
    const ids = Array.from({ length: 5000 }, () => uuidv7(ms)); // > 4096 forces a counter rollover
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isUuid)).toBe(true);
  });

  it('stays ordered when the clock goes backwards', () => {
    const a = uuidv7(Date.now() + 120_000);
    const b = uuidv7(Date.now());
    expect(a < b).toBe(true);
  });

  it('is unique across many calls', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7()));
    expect(ids.size).toBe(10_000);
  });

  it('rejects malformed ids', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('01890a5d-ac96-774b-bcce-b302099a8057 ')).toBe(false);
  });
});
