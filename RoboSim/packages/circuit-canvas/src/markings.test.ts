import { describe, expect, it } from 'vitest';
import { capacitorCode } from './markings.js';

describe('part markings', () => {
  it('prints EIA capacitance codes on ceramic capacitors', () => {
    expect(capacitorCode(100)).toBe('104');
    expect(capacitorCode(10)).toBe('103');
    expect(capacitorCode(4.7)).toBe('472');
    expect(capacitorCode(1000)).toBe('105');
    expect(capacitorCode(0.1)).toBe('101');
    expect(capacitorCode(0.022)).toBe('220');
    expect(capacitorCode(0.0999)).toBe('101');
    expect(capacitorCode(0.0047)).toBe('4.7');
  });
});
