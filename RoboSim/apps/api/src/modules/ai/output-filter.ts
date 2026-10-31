/**
 * Bilingual content filter (FR-AI-07, Security §7) for questions and streamed answers. It looks for harmful
 * intent ("how to build a bomb"), not for words that are normal in electronics ("the capacitor may explode"),
 * and adds categories for minors. A stand-in for a trained classifier; the evaluation set keeps it honest.
 */

export type FilterCategory = 'weapons' | 'self_harm' | 'sexual' | 'hate' | 'adult' | 'profanity';

type Rule = { category: FilterCategory; pattern: RegExp; minorsOnly?: boolean };

/** Within one sentence: a gap that does not cross . ? ! ؟ or a newline. */
const gap = (n: number): string => `[^.?!؟\\n]{0,${n}}`;

const RULES: readonly Rule[] = [
  {
    category: 'weapons',
    pattern: new RegExp(
      `\\b(make|making|build|building|assemble|construct|detonate)\\b${gap(60)}\\b(bomb|explosive device|ied|pipe bomb|grenade|landmine)s?\\b`,
    ),
  },
  {
    category: 'weapons',
    pattern: /\b(how to|steps to) (make|build|print) (a |an )?(gun|firearm|silencer|suppressor)\b/,
  },
  {
    category: 'weapons',
    pattern: new RegExp(
      `\\b(drone|robot)s?\\b${gap(40)}\\b(armed with|carrying|that (fires|shoots)|drops?) (a |an )?(bomb|explosive|gun|grenade)`,
    ),
  },
  {
    category: 'weapons',
    pattern: new RegExp(
      `(ساخت|ساختن|درست کردن|بسازیم|بسازم|بساز)${gap(60)}(بمب|مواد منفجره|نارنجک|چاشنی انفجاری)`,
    ),
  },
  // Persian puts the verb last: «بمب بسازیم».
  {
    category: 'weapons',
    pattern: new RegExp(`(بمب|مواد منفجره|نارنجک|چاشنی انفجاری)${gap(40)}(بساز|ساخت|درست کن|منفجر کن)`),
  },
  { category: 'weapons', pattern: new RegExp(`(پهپاد|ربات)${gap(40)}(مسلح|انتحاری|بمب)`) },
  {
    category: 'self_harm',
    pattern: /\b(how to (kill myself|commit suicide)|suicide methods?|ways to (kill myself|self[- ]harm))\b/,
  },
  { category: 'self_harm', pattern: new RegExp(`(روش|راه)(های)?${gap(20)}(خودکشی|خودزنی)`) },
  { category: 'self_harm', pattern: /(خودم را|خودمو) (بکشم|بکشم؟)/ },
  { category: 'sexual', pattern: /\b(porn\w*|explicit sex\w*|nude (photo|image|pic)s?|sexting)\b/ },
  { category: 'sexual', pattern: /(پورن|سکسی|فیلم سکس|عکس برهنه)/ },
  {
    category: 'hate',
    pattern:
      /\b(kill|exterminate|gas) (all|every) (the )?(jews|muslims|christians|blacks|whites|gays|arabs|persians|afghans|kurds)\b/,
  },
  {
    category: 'hate',
    pattern: new RegExp(
      `(همه|تمام) (یهودی|مسلمان|مسیحی|افغان|عرب|کرد|ترک)(ها)?${gap(20)}(را )?(بکشید|نابود کنید)`,
    ),
  },
  {
    category: 'adult',
    minorsOnly: true,
    pattern: /\b(alcohol|beer|vodka|whisky|gambling|casino|betting|cannabis|marijuana|cocaine|vaping)\b/,
  },
  {
    category: 'adult',
    minorsOnly: true,
    pattern: /(الکل|مشروب|قمار|کازینو|شرط ?بندی|ماری ?جوانا|مواد مخدر|کوکائین)/,
  },
  { category: 'profanity', minorsOnly: true, pattern: /\b(fuck\w*|shit\w*|bitch\w*|asshole\w*)\b/ },
];

/** Lower case, Arabic → Persian letters, no zero-width joiners or diacritics. */
export function normalizeForFilter(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u200c|\u200d|\u200e|\u200f/g, '')
    .replace(/[\u064b-\u0670]/g, '')
    .replace(/\u064a/g, '\u06cc')
    .replace(/\u0643/g, '\u06a9')
    .replace(/\s+/g, ' ');
}

export function checkContent(text: string, opts: { minor: boolean }): FilterCategory | null {
  const t = normalizeForFilter(text);
  for (const r of RULES) {
    if (r.minorsOnly && !opts.minor) continue;
    if (r.pattern.test(t)) return r.category;
  }
  return null;
}

/** Notice stored and shown instead of an answer the filter stopped. */
export const FILTERED_NOTICE = {
  en: 'This answer was stopped by the safety filter. Please ask about your robot or circuit.',
  fa: 'این پاسخ توسط فیلتر ایمنی متوقف شد. لطفاً درباره ربات یا مدار خود بپرسید.',
} as const;
