import { blankProject } from '@robosim/circuit-canvas';
import { ProjectDocumentError } from '@robosim/shared';
import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { type ProjectFileError, encodeProjectFile, fileBase, readProjectFile, utf8 } from './project-file.js';

const doc = { ...blankProject('Line follower', ''), meta: { title: 'ربات Line follower' } };
const blob = (data: Uint8Array | string) =>
  new Blob([typeof data === 'string' ? data : new Uint8Array(data)]);

describe('.robosim files (FR-PRJ-06)', () => {
  it('round-trips a document through the zip with a manifest', async () => {
    const bytes = encodeProjectFile(doc, new Date('2026-10-25T10:00:00Z'));
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual(['manifest.json', 'project.json']);
    expect(JSON.parse(new TextDecoder().decode(entries['manifest.json']))).toMatchObject({
      format: 'robosim',
      formatVersion: 1,
      schemaVersion: 4,
      exportedAt: '2026-10-25T10:00:00.000Z',
    });
    expect(await readProjectFile(blob(bytes))).toEqual(doc);
  });

  it('still imports the older JSON export and exported input logs', async () => {
    expect(await readProjectFile(blob(JSON.stringify(doc)))).toEqual(doc);
    expect(await readProjectFile(blob(JSON.stringify({ seed: 1, project: doc })))).toEqual(doc);
  });

  it('migrates older documents and rejects invalid ones', async () => {
    const v3 = { ...doc, schemaVersion: 3 };
    expect((await readProjectFile(blob(JSON.stringify(v3)))).schemaVersion).toBe(4);
    await expect(readProjectFile(blob(JSON.stringify({ ...doc, wires: 'x' })))).rejects.toBeInstanceOf(
      ProjectDocumentError,
    );
  });

  it('explains files it cannot use', async () => {
    const reason = (p: Promise<unknown>) => p.catch((e: unknown) => (e as ProjectFileError).reason);
    expect(await reason(readProjectFile(blob('not json')))).toBe('unreadable');
    expect(await reason(readProjectFile(blob(zipSync({ 'other.txt': utf8('x') }))))).toBe('missing_project');
    const newer = zipSync({
      'manifest.json': utf8(JSON.stringify({ format: 'robosim', formatVersion: 99 })),
      'project.json': utf8(JSON.stringify(doc)),
    });
    expect(await reason(readProjectFile(blob(newer)))).toBe('newer');
  });

  it('names files after the title in any script', () => {
    expect(fileBase(doc)).toBe('ربات-Line-follower');
    expect(fileBase({ ...doc, meta: { title: '***' } })).toBe('project');
  });
});
