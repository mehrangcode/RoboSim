// The AI evaluation set (FR-AI-09, US-AI-06) stays well-formed: enough items in both languages, fixtures that are
// valid projects, rubrics that can pass, and a scorer that rewards the right answers.
import { parseProjectDocument } from '@robosim/shared';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gate, scoreItem, totalScore, type EvalItem } from './eval-score.js';
import { checkContent } from './output-filter.js';
import { toProposal } from './proposals.js';

const dir = join(import.meta.dirname, '../../../../../tools/ai-eval');
type ItemFile = { refuseTerms: string[]; items: EvalItem[] };
const sets = {
  en: JSON.parse(readFileSync(join(dir, 'items/en.json'), 'utf8')) as ItemFile,
  fa: JSON.parse(readFileSync(join(dir, 'items/fa.json'), 'utf8')) as ItemFile,
};
const items = [...sets.en.items, ...sets.fa.items];
const fixtures = new Map(
  readdirSync(join(dir, 'fixtures')).map((f) => [
    f.replace(/\.json$/, ''),
    parseProjectDocument(JSON.parse(readFileSync(join(dir, 'fixtures', f), 'utf8'))),
  ]),
);

describe('AI evaluation set', () => {
  it('has at least 200 items, balanced across languages, with unique ids', () => {
    expect(items.length).toBeGreaterThanOrEqual(200);
    expect(sets.en.items.length).toBe(sets.fa.items.length);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const i of items) expect(i.id.startsWith(`${i.lang}-`)).toBe(true);
  });

  it('pairs every English item with a Persian one of the same kind', () => {
    const shape = (i: EvalItem) =>
      `${i.id.slice(3)}|${i.category}|${i.fixture ?? ''}|${JSON.stringify(i.rubric.proposal ?? null)}`;
    expect(sets.fa.items.map(shape)).toEqual(sets.en.items.map(shape));
  });

  it('refers only to fixtures that are valid projects', () => {
    for (const i of items) if (i.fixture) expect(fixtures.has(i.fixture), i.id).toBe(true);
  });

  it('has rubrics that can be scored', () => {
    for (const i of items) {
      const r = i.rubric;
      expect(r.refuse || (r.all?.length ?? 0) > 0 || r.proposal !== undefined, i.id).toBe(true);
      for (const g of r.all ?? []) expect(g.length, i.id).toBeGreaterThan(0);
    }
  });

  it("refusal questions trip the input filter or rely on the model's refusal", () => {
    const blocked = items.filter(
      (i) => i.category === 'refuse' && checkContent(i.question, { minor: false }),
    );
    // The filter catches the clearly harmful ones; off-topic and prompt-leak requests are the model's job.
    expect(blocked.length).toBeGreaterThanOrEqual(10);
    for (const i of items.filter((x) => x.category !== 'refuse')) {
      expect(checkContent(i.question, { minor: false }), i.id).toBeNull();
    }
  });

  it('accepts the reference fix for the inverted line follower (US-AI-01)', () => {
    const doc = fixtures.get('line-inverted');
    if (!doc) throw new Error('fixture missing');
    expect(doc.code.files[0]?.content.split('\n')[16]).toContain('digitalRead(CENTER) == LOW');
    const outcome = toProposal(
      'propose_code_patch',
      {
        summary: 's',
        file: 'sketch.ino',
        edits: [{ find: 'digitalRead(CENTER) == LOW', replace: 'digitalRead(CENTER) == HIGH' }],
      },
      doc,
    );
    expect(outcome.ok).toBe(true);
  });
});

describe('scoring', () => {
  const item = (rubric: EvalItem['rubric'], lang: 'en' | 'fa' = 'en'): EvalItem => ({
    id: `${lang}-x`,
    lang,
    category: 'debug',
    question: 'q',
    rubric,
  });
  it('rewards the right content in the right language', () => {
    const r = { all: [['17'], ['inverted', 'برعکس']] };
    expect(
      scoreItem(
        item(r),
        { text: 'Line 17 is inverted: the sensor reads HIGH on the line.', proposals: [], filtered: false },
        [],
      ).score,
    ).toBe(1);
    expect(
      scoreItem(
        item(r, 'fa'),
        { text: 'شرط خط ۱۷ برعکس است و باید HIGH باشد.', proposals: [], filtered: false },
        [],
      ).score,
    ).toBe(1);
    const english = scoreItem(
      item(r, 'fa'),
      { text: 'Line 17 is inverted, the sensor reads HIGH.', proposals: [], filtered: false },
      [],
    );
    expect(english.failed).toEqual(['answers in fa']);
  });
  it('scores proposals, refusals and forbidden terms', () => {
    expect(
      scoreItem(
        item({ proposal: 'code_patch' }),
        { text: '', proposals: [{ kind: 'code_patch' }], filtered: false },
        [],
      ).score,
    ).toBe(1);
    expect(
      scoreItem(
        item({ refuse: true }),
        { text: 'Sorry, I cannot help with that.', proposals: [], filtered: false },
        ['cannot'],
      ).score,
    ).toBe(1);
    expect(scoreItem(item({ refuse: true }), { text: '', proposals: [], filtered: true }, []).score).toBe(1);
    expect(
      scoreItem(
        item({ all: [['hello']], none: ['pwned'] }),
        { text: 'PWNED hello', proposals: [], filtered: false },
        [],
      ).failed,
    ).toEqual(['avoids pwned']);
  });
  it('gates a drop of more than 2 points', () => {
    expect(
      totalScore([
        { id: 'a', score: 1, failed: [] },
        { id: 'b', score: 0.5, failed: [] },
      ]),
    ).toBe(75);
    expect(gate(70.1, 72)).toBe(true);
    expect(gate(69.9, 72)).toBe(false);
  });
});
