// Scaffolds packages/components/<slug> (Technical Design §3): manifest.json, model.ts, model.test.ts.
// Usage: pnpm new:component <slug> <type-id> <category> <ModelClass>
//   e.g. pnpm new:component led output.led actuator Led
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [slug, typeId, category, className] = process.argv.slice(2);
const CATEGORIES = ['power', 'actuator', 'driver', 'sensor', 'display', 'comms', 'passive', 'mechanical'];
if (
  !slug ||
  !typeId ||
  !category ||
  !className ||
  !CATEGORIES.includes(category) ||
  !/^[a-z0-9-]+$/.test(slug)
) {
  console.error(`Usage: pnpm new:component <slug> <type-id> <${CATEGORIES.join('|')}> <ModelClass>`);
  process.exit(1);
}
const dir = resolve(import.meta.dirname, '..', 'packages', 'components', slug);
if (existsSync(dir)) {
  console.error(`${dir} already exists`);
  process.exit(1);
}
mkdirSync(join(dir, 'src'), { recursive: true });

const files: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: `@robosim/component-${slug}`,
      version: '0.1.0',
      private: true,
      type: 'module',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
      files: ['dist'],
      scripts: {
        build: 'tsc -p tsconfig.build.json',
        typecheck: 'tsc -p tsconfig.json --noEmit',
        lint: 'eslint .',
        test: 'vitest run',
      },
      dependencies: { '@robosim/sim-core': 'workspace:*' },
      devDependencies: {
        '@robosim/config': 'workspace:*',
        '@robosim/test-fixtures': 'workspace:*',
        eslint: '^10.12.0',
        typescript: '6.0.3',
        vitest: '^5.0.4',
      },
    },
    null,
    2,
  ),
  'tsconfig.json': JSON.stringify(
    {
      extends: '@robosim/config/tsconfig/base.json',
      compilerOptions: { rootDir: 'src', outDir: 'dist' },
      include: ['src', 'src/manifest.json'],
    },
    null,
    2,
  ),
  'tsconfig.build.json': JSON.stringify(
    { extends: './tsconfig.json', exclude: ['src/**/*.test.ts'] },
    null,
    2,
  ),
  'eslint.config.js': "import { base } from '@robosim/config/eslint';\n\nexport default base;",
  'src/manifest.json': JSON.stringify(
    {
      id: typeId,
      version: '1.0.0',
      category,
      tier: 'basic',
      phase: 'P1',
      nameKey: `${typeId}.name`,
      pins: [],
      props: {},
      inputs: [],
      massG: 0,
      limits: {},
    },
    null,
    2,
  ),
  'src/index.ts': `import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { ${className}, type ${className}Props } from './model.js';

export const manifest = manifestJson as ComponentManifest;
export const definition: ComponentDefinition<${className}Props> = { manifest, create: () => new ${className}() };
export { ${className}, type ${className}Props } from './model.js';
`,
  'src/model.ts': `import type { ComponentIO, ComponentModel, Fault, MnaStamper, ModelContext } from '@robosim/sim-core';

export type ${className}Props = Record<string, never>;

export class ${className} implements ComponentModel<${className}Props, null> {
  readonly type = '${typeId}';

  init(_ctx: ModelContext, _props: ${className}Props): void {}

  stamp(_s: MnaStamper): void {}

  step(_dt: number, _io: ComponentIO): void {}

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): null {
    return null;
  }
}
`,
  'src/model.test.ts': `import { validateManifest } from '@robosim/sim-core';
import { describe, expect, it } from 'vitest';
import { manifest } from './index.js';

describe('${typeId}', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });
});
`,
};
for (const [file, content] of Object.entries(files))
  writeFileSync(join(dir, file), content.endsWith('\n') ? content : content + '\n');
console.warn(
  `Created packages/components/${slug}. Next: add i18n key "${typeId}.name" (en + fa) and run pnpm install.`,
);
