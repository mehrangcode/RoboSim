import { describe, expect, it } from 'vitest';
import {
  createProjectSchema,
  parseIfMatch,
  projectEtag,
  projectListQuerySchema,
  updateProjectSchema,
} from './project-api.js';

describe('projects API contract (API Spec §4.4)', () => {
  it('round-trips ETags and ignores foreign If-Match values', () => {
    expect(parseIfMatch(projectEtag(42))).toBe(42);
    expect(parseIfMatch(' "r0" ')).toBe(0);
    for (const h of [undefined, '', '*', 'W/"r1"', '"1"', '"r-1"', '"rabc"'])
      expect(parseIfMatch(h)).toBeUndefined();
  });

  it('defaults list queries and coerces query-string values', () => {
    expect(projectListQuerySchema.parse({})).toEqual({ sort: '-updatedAt', limit: 50, deleted: false });
    expect(projectListQuerySchema.parse({ limit: '10', deleted: 'true', tag: ' Robot ' })).toMatchObject({
      limit: 10,
      deleted: true,
      tag: 'robot',
    });
    expect(projectListQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(projectListQuerySchema.safeParse({ sort: 'owner' }).success).toBe(false);
  });

  it('needs a document to create and something to update; tags are normalised', () => {
    expect(createProjectSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(createProjectSchema.parse({ document: {}, tags: ['A', 'a', ' b '] }).tags).toEqual(['a', 'b']);
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
    expect(updateProjectSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(updateProjectSchema.parse({ name: ' Line follower ' })).toEqual({ name: 'Line follower' });
  });
});
