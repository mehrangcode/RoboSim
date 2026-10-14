import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { createPgliteDatabase } from '../src/db/client.js';

describe('createPgliteDatabase', () => {
  let root = '';
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('creates missing parent folders of the data directory (fresh checkout without .local/)', async () => {
    root = mkdtempSync(join(tmpdir(), 'robosim-pglite-'));
    const database = await createPgliteDatabase(join(root, 'nested', '.local', 'pglite'));
    await database.ping();
    await database.close();
  });
});
