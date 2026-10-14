import { persistLocale, applyDocumentLocale } from '@robosim/i18n/browser';
import { LOCALES, type Locale } from '@robosim/shared';
import { SegmentedControl } from '@robosim/ui';
import { useTranslation } from 'react-i18next';

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const current = (LOCALES as readonly string[]).includes(i18n.language) ? (i18n.language as Locale) : 'en';
  const options = LOCALES.map((l) => ({ value: l, label: t(`common:language.${l}`), lang: l }));

  async function change(locale: Locale) {
    applyDocumentLocale(locale);
    persistLocale(locale);
    await i18n.changeLanguage(locale);
  }

  return (
    <SegmentedControl
      label={t('common:language.label')}
      value={current}
      options={options}
      onChange={change}
    />
  );
}
