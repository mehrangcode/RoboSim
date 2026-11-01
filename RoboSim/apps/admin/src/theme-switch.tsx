import { SegmentedControl, THEME_PREFERENCES, useTheme } from '@robosim/ui';
import { useTranslation } from 'react-i18next';

export function ThemeSwitch() {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();
  const options = THEME_PREFERENCES.map((p) => ({ value: p, label: t(`common:theme.${p}`) }));
  return (
    <SegmentedControl
      label={t('common:theme.label')}
      value={preference}
      options={options}
      onChange={(p) => setPreference(p)}
    />
  );
}
