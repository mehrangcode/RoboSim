import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@robosim/shared';
import {
  createI18n,
  formatDate,
  formatIrr,
  formatNumber,
  NAMESPACES,
  pseudoLocalize,
  resources,
} from './index.js';

describe('FR-I18N-01 translation resources', () => {
  it('ships every namespace in both locales', () => {
    for (const ns of NAMESPACES) {
      expect(resources.en[ns]).toBeDefined();
      expect(resources.fa[ns]).toBeDefined();
    }
  });

  it('has a localized title for every API error code', () => {
    for (const code of ERROR_CODES) {
      expect(resources.en.errors[code as keyof typeof resources.en.errors], code).toBeTruthy();
      expect(resources.fa.errors[code as keyof typeof resources.fa.errors], code).toBeTruthy();
    }
  });

  it('translates with ICU interpolation', async () => {
    const i18n = await createI18n({ lng: 'fa' });
    expect(i18n.t('common:appName')).toBe('روبوسیم');
    expect(i18n.t('shell:home.lastChecked', { time: '۱۶:۱۶' })).toBe('آخرین بررسی: ۱۶:۱۶');
  });
});

describe('FR-I18N-04 numbers, dates, money', () => {
  it('uses Persian digits in FA and Latin digits in EN', () => {
    expect(formatNumber('fa', 1234567)).toBe('۱٬۲۳۴٬۵۶۷');
    expect(formatNumber('en', 1234567)).toBe('1,234,567');
  });

  it('uses the Jalali calendar in FA and Gregorian in EN', () => {
    const date = new Date('2026-10-13T08:30:00Z');
    const fa = formatDate('fa', date, { year: 'numeric', month: 'numeric', day: 'numeric' });
    expect(fa).toContain('۱۴۰۵');
    expect(fa).toContain('۲۱');
    expect(formatDate('en', date, { year: 'numeric', month: 'short', day: 'numeric' })).toBe('Oct 13, 2026');
  });

  it('displays Toman as IRR / 10 without changing stored values', () => {
    expect(formatIrr('en', 125_000, 'toman')).toBe('12,500');
    expect(formatIrr('fa', 125_000, 'rial')).toBe('۱۲۵٬۰۰۰');
  });
});

describe('FR-I18N-03 pseudo-localization', () => {
  it('accents and expands literal text while keeping ICU arguments intact', () => {
    const out = pseudoLocalize('Last checked {time}');
    expect(out.startsWith('⟦')).toBe(true);
    expect(out).toContain('{time}');
    expect(out).not.toContain('Last');
    expect(out.length).toBeGreaterThan('Last checked {time}'.length);
  });
});
