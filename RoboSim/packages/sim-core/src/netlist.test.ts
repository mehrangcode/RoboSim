import { describe, expect, it } from 'vitest';
import { NetlistError, buildNetlist } from './netlist.js';

describe('buildNetlist', () => {
  const terminals = ['bat:+', 'bat:-', 'r1:a', 'r1:b', 'led:a', 'led:k', 'r2:a', 'r2:b'];

  it('merges wired terminals and numbers nets by first appearance', () => {
    const nl = buildNetlist({
      terminals,
      connections: [
        ['bat:+', 'r1:a'],
        ['r1:b', 'led:a'],
      ],
      ground: ['bat:-', 'led:k'],
    });
    expect(nl.netOf('bat:-')).toBe(0);
    expect(nl.netOf('led:k')).toBe(0);
    expect(nl.netOf('bat:+')).toBe(1);
    expect(nl.netOf('r1:a')).toBe(1);
    expect(nl.netOf('r1:b')).toBe(2);
    expect(nl.netOf('led:a')).toBe(2);
    expect(nl.netOf('r2:a')).toBe(3);
    expect(nl.netOf('r2:b')).toBe(4);
    expect(nl.netCount).toBe(4);
    expect(nl.members[0]).toEqual(['bat:-', 'led:k']);
  });

  it('is independent of connection order and direction', () => {
    const a = buildNetlist({
      terminals,
      connections: [
        ['r1:a', 'bat:+'],
        ['led:a', 'r1:b'],
      ],
      ground: ['led:k'],
    });
    const b = buildNetlist({
      terminals,
      connections: [
        ['r1:b', 'led:a'],
        ['bat:+', 'r1:a'],
      ],
      ground: ['led:k'],
    });
    expect(terminals.map((t) => a.netOf(t))).toEqual(terminals.map((t) => b.netOf(t)));
  });

  it('merges transitively through chains', () => {
    const nl = buildNetlist({
      terminals,
      connections: [
        ['r1:a', 'r2:b'],
        ['r2:b', 'led:a'],
        ['led:a', 'bat:+'],
      ],
      ground: [],
    });
    expect(new Set(['r1:a', 'r2:b', 'led:a', 'bat:+'].map((t) => nl.netOf(t))).size).toBe(1);
    expect(nl.members[0]).toEqual([]);
  });

  it('rejects unknown and duplicate terminals', () => {
    expect(() => buildNetlist({ terminals, connections: [['r1:a', 'nope']], ground: [] })).toThrow(
      NetlistError,
    );
    expect(() => buildNetlist({ terminals: ['x', 'x'], connections: [], ground: [] })).toThrow(NetlistError);
    expect(() => buildNetlist({ terminals, connections: [], ground: [] }).netOf('nope')).toThrow(
      NetlistError,
    );
  });
});
