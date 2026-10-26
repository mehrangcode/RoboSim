import { describe, expect, it } from 'vitest';
import { MAX_SERIES, buildPlot, niceTicks, parsePlotLine, plotRange } from './plotter.js';

const line = (text: string, slice = 0) => ({ slice, text });

describe('serial plotter (FR-SIM-07, US-SIM-03 AC2)', () => {
  it('makes each comma-separated column a series (AC2)', () => {
    const plot = buildPlot([line('1,2,3'), line('4,5,6', 10)], false, 100);
    expect(plot.keys).toEqual(['#1', '#2', '#3']);
    expect(plot.samples.map((s) => [...s.values.values()])).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(plot.samples[1]?.slice).toBe(10);
  });

  it('accepts tabs, spaces and labelled values like the Arduino IDE 2 plotter', () => {
    expect(parsePlotLine('10\t20 30')).toEqual([
      { key: '#1', value: 10 },
      { key: '#2', value: 20 },
      { key: '#3', value: 30 },
    ]);
    expect(parsePlotLine('left:512, right: -3.5e1 speed:7')).toEqual([
      { key: 'left', value: 512 },
      { key: 'right', value: -35 },
      { key: 'speed', value: 7 },
    ]);
    // Bare numbers keep their column among bare numbers, next to labelled ones.
    expect(parsePlotLine('t:5 1 2')).toEqual([
      { key: 't', value: 5 },
      { key: '#1', value: 1 },
      { key: '#2', value: 2 },
    ]);
  });

  it('skips text, non-numbers and repeated labels', () => {
    expect(parsePlotLine('Ready!')).toEqual([]);
    expect(parsePlotLine('Distance cm 42')).toEqual([{ key: '#1', value: 42 }]);
    expect(parsePlotLine('a:nan b:inf c:0x10 d:1')).toEqual([{ key: 'd', value: 1 }]);
    expect(parsePlotLine('a:1 a:2')).toEqual([{ key: 'a', value: 1 }]);
    const plot = buildPlot([line('hello'), line('1'), line('world')], false, 100);
    expect(plot.samples).toHaveLength(1);
  });

  it('leaves out an unterminated last line and keeps only the window', () => {
    const lines = Array.from({ length: 10 }, (_, i) => line(String(i), i));
    expect(buildPlot(lines, true, 100).samples.at(-1)?.values.get('#1')).toBe(8);
    expect(buildPlot(lines, false, 3).samples.map((s) => s.slice)).toEqual([7, 8, 9]);
  });

  it('keeps series in order of first appearance and caps them', () => {
    const many = Array.from({ length: MAX_SERIES + 2 }, (_, i) => `s${i}:${i}`).join(' ');
    const plot = buildPlot([line('b:1'), line('a:1 b:2'), line(many)], false, 100);
    expect(plot.keys.slice(0, 2)).toEqual(['b', 'a']);
    expect(plot.keys).toHaveLength(MAX_SERIES);
    expect(plot.dropped).toEqual(['s6', 's7', 's8', 's9']); // b and a took two slots
  });

  it('scales the y axis with headroom and handles flat signals', () => {
    const plot = buildPlot([line('0,10'), line('5,0')], false, 100);
    expect(plotRange(plot.samples, plot.keys)).toEqual({ min: -0.5, max: 10.5 });
    expect(plotRange(plot.samples, ['#1'])).toEqual({ min: -0.25, max: 5.25 });
    expect(plotRange(buildPlot([line('3')], false, 9).samples, ['#1'])).toEqual({ min: 2, max: 4 });
    expect(plotRange([], ['#1'])).toBeNull();
  });

  it('picks round ticks', () => {
    expect(niceTicks(0, 1023)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(niceTicks(-1, 1)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });
});
