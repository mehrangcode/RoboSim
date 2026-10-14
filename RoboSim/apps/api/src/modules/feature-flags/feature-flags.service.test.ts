import type { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestingModule, testEnv } from '../../../test/support/app.js';
import { createTestDatabase } from '../../../test/support/database.js';
import type { Database } from '../../db/client.js';
import { featureFlags } from '../../db/schema.js';
import { withSystem } from '../../db/scope.js';
import { FeatureFlagsService } from './feature-flags.service.js';

let database: Database;
let moduleRef: TestingModule;
let service: FeatureFlagsService;

beforeAll(async () => {
  database = await createTestDatabase();
  await withSystem(database.db, (tx) =>
    tx.insert(featureFlags).values([
      { key: 'blocks', enabled: true, rules: [{ environments: ['test'], value: true }] },
      { key: 'collab.realtime', enabled: true, rules: [{ environments: ['production'], value: true }] },
      { key: 'killed', enabled: false, rules: [{ value: true }] },
      // Malformed on purpose: must be ignored, not crash evaluation.
      { key: 'Bad Key!', enabled: true, rules: [{ value: true }] },
    ]),
  );
  moduleRef = await createTestingModule(
    database,
    testEnv({ FEATURE_FLAGS_OVERRIDE: 'collab.realtime=on,local.only=on' }),
  );
  service = moduleRef.get(FeatureFlagsService);
});
afterAll(async () => {
  await moduleRef.close();
  await database.close();
});

describe('FR-ADM-09 feature flags service', () => {
  it('evaluates stored rules for the current environment, applies overrides, and skips malformed flags', async () => {
    expect(await service.evaluateAll()).toEqual({
      blocks: true,
      'collab.realtime': true,
      killed: false,
      'local.only': true,
    });
  });

  it('caches definitions until invalidated', async () => {
    await service.evaluateAll();
    await withSystem(database.db, (tx) =>
      tx.insert(featureFlags).values({ key: 'late', enabled: true, rules: [{ value: true }] }),
    );
    expect(await service.isEnabled('late')).toBe(false);
    service.invalidate();
    expect(await service.isEnabled('late')).toBe(true);
  });
});
