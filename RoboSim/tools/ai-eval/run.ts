// AI evaluation harness (FR-AI-09, US-AI-06). Runs the bilingual item set through the API's own prompt builder,
// tool validation and output filter against a model, scores the answers and compares with the baseline.
//
//   node tools/ai-eval/run.ts                          platform model (Ollama: OLLAMA_BASE_URL, AI_PLATFORM_MODEL)
//   node tools/ai-eval/run.ts --lang fa --limit 20     a subset
//   node tools/ai-eval/run.ts --check                  exit 1 when the score drops more than 2 points
//   node tools/ai-eval/run.ts --update-baseline        record this run as the baseline
//   node tools/ai-eval/run.ts --base-url URL --model M --api-key K   any OpenAI-compatible endpoint
//
// Needs `pnpm build` (the providers, shared and catalogue packages are imported from their dist).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { OpenAICompatibleProvider } from '../../packages/ai-providers/dist/index.js';
import { parseProjectDocument } from '../../packages/shared/dist/index.js';
import { checkContent } from '../../apps/api/src/modules/ai/output-filter.ts';
import { buildPrompt, TOOLS } from '../../apps/api/src/modules/ai/prompt.ts';
import { PART_TYPES, PARTS, toProposal } from '../../apps/api/src/modules/ai/proposals.ts';
import {
  gate,
  scoreItem,
  totalScore,
  type EvalAnswer,
  type EvalItem,
  type ItemScore,
} from '../../apps/api/src/modules/ai/eval-score.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const { values: opts } = parseArgs({
  options: {
    lang: { type: 'string' },
    category: { type: 'string' },
    limit: { type: 'string' },
    'base-url': { type: 'string' },
    model: { type: 'string' },
    'api-key': { type: 'string' },
    check: { type: 'boolean', default: false },
    'update-baseline': { type: 'boolean', default: false },
  },
});

const baseUrl = opts['base-url'] ?? `${process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'}/v1`;
const model = opts.model ?? process.env.AI_PLATFORM_MODEL ?? 'qwen2.5:3b';
const provider = new OpenAICompatibleProvider({
  baseUrl,
  apiKey: opts['api-key'] ?? process.env.AI_EVAL_API_KEY,
  timeoutMs: 300_000,
});

type ItemFile = { refuseTerms: string[]; items: EvalItem[] };
const sets: Record<'en' | 'fa', ItemFile> = {
  en: JSON.parse(readFileSync(join(here, 'items', 'en.json'), 'utf8')) as ItemFile,
  fa: JSON.parse(readFileSync(join(here, 'items', 'fa.json'), 'utf8')) as ItemFile,
};
let items = [...sets.en.items, ...sets.fa.items];
if (opts.lang) items = items.filter((i) => i.lang === opts.lang);
if (opts.category) items = items.filter((i) => i.category === opts.category);
if (opts.limit) items = items.slice(0, Number(opts.limit));

const fixture = (name: string) =>
  parseProjectDocument(JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8')));

async function ask(item: EvalItem): Promise<EvalAnswer & { ms: number }> {
  const started = Date.now();
  if (checkContent(item.question, { minor: false })) {
    return { text: '', proposals: [], filtered: true, ms: 0 };
  }
  const document = item.fixture ? fixture(item.fixture) : null;
  const prompt = buildPrompt({
    locale: item.lang,
    minor: false,
    mode: 'full',
    document,
    context: (item.context ?? {}) as Parameters<typeof buildPrompt>[0]['context'],
    history: [],
    message: item.question,
    budget: 12_000,
    partTypes: PART_TYPES,
    boardPins: PARTS.boardPins,
  });
  let text = '';
  let filtered = false;
  const proposals: { kind: 'code_patch' | 'circuit_change' }[] = [];
  for await (const chunk of provider.chat({
    model,
    system: prompt.system,
    messages: prompt.messages,
    tools: TOOLS,
    maxTokens: 700,
    temperature: 0,
  })) {
    if (chunk.type === 'text') {
      text += chunk.text;
      if (checkContent(text, { minor: false })) {
        filtered = true;
        break;
      }
    } else if (chunk.type === 'tool_call') {
      const outcome = toProposal(chunk.name, chunk.args, document);
      if (outcome.ok) proposals.push({ kind: outcome.proposal.kind });
    }
  }
  return { text, proposals, filtered, ms: Date.now() - started };
}

const results: (ItemScore & { lang: string; category: string; ms: number; answer: string })[] = [];
for (const [n, item] of items.entries()) {
  let answer: EvalAnswer & { ms: number };
  try {
    answer = await ask(item);
  } catch (e) {
    answer = { text: `[error] ${(e as Error).message}`, proposals: [], filtered: false, ms: 0 };
  }
  const s = scoreItem(item, answer, sets[item.lang].refuseTerms);
  results.push({
    ...s,
    lang: item.lang,
    category: item.category,
    ms: answer.ms,
    answer: answer.text.slice(0, 2000),
  });
  const mark = s.score === 1 ? 'ok ' : s.score === 0 ? 'FAIL' : 'part';
  console.log(
    `[${n + 1}/${items.length}] ${mark} ${item.id} ${(answer.ms / 1000).toFixed(1)}s ${s.failed.join('; ')}`,
  );
}

const score = totalScore(results);
const by = (key: 'lang' | 'category') =>
  Object.fromEntries(
    [...new Set(results.map((r) => r[key]))].map((k) => [k, totalScore(results.filter((r) => r[key] === k))]),
  );
const report = {
  at: new Date().toISOString(),
  model,
  baseUrl,
  items: results.length,
  score,
  byLang: by('lang'),
  byCategory: by('category'),
  results,
};
const outDir = join(root, '.local', 'ai-eval');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `report-${report.at.replace(/[:.]/g, '-')}.json`);
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nScore ${score} over ${results.length} items (model ${model})`);
console.log('By language:', report.byLang);
console.log('By category:', report.byCategory);
console.log(`Report: ${outFile}`);

const baselineFile = join(here, 'baseline.json');
if (opts['update-baseline']) {
  writeFileSync(
    baselineFile,
    `${JSON.stringify({ score, model, items: results.length, at: report.at }, null, 2)}\n`,
  );
  console.log(`Baseline updated: ${score}`);
}
if (opts.check) {
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as { score: number; items: number };
  if (baseline.items !== results.length) {
    console.error(
      `The baseline covers ${baseline.items} items; this run ${results.length}. Run the full set.`,
    );
    process.exit(2);
  }
  if (!gate(score, baseline.score)) {
    console.error(`Score ${score} is more than 2 points below the baseline ${baseline.score}.`);
    process.exit(1);
  }
  console.log(`Within 2 points of the baseline ${baseline.score}.`);
}
