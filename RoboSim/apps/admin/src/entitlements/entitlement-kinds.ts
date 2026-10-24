import {
  BUILD_BOARDS,
  BUILD_PRIORITIES,
  COMPONENT_TIERS,
  COURSE_ACCESS,
  FEATURE_ENTITLEMENTS,
  GUIDED_PROJECT_ACCESS,
  QUOTA_ENTITLEMENTS,
  SETTING_ENTITLEMENTS,
  entitlementValueSchema,
  type EntitlementKey,
  type EntitlementValues,
} from '@robosim/shared';

export type EntitlementKind = 'feature' | 'quota' | 'setting' | 'boards';

export function entitlementKind(key: EntitlementKey): EntitlementKind {
  if ((FEATURE_ENTITLEMENTS as readonly string[]).includes(key)) return 'feature';
  if ((QUOTA_ENTITLEMENTS as readonly string[]).includes(key)) return 'quota';
  return key === 'boards.allowed' ? 'boards' : 'setting';
}

/** The allowed values of each single-choice setting, lowest first. */
export const SETTING_OPTIONS: Record<
  Exclude<(typeof SETTING_ENTITLEMENTS)[number], 'boards.allowed'>,
  readonly string[]
> = {
  'components.tier': COMPONENT_TIERS,
  'build.priority': BUILD_PRIORITIES,
  'learning.guided_projects': GUIDED_PROJECT_ACCESS,
  'learning.courses': COURSE_ACCESS,
};

export function settingOptions(key: EntitlementKey): readonly string[] {
  return (SETTING_OPTIONS as Record<string, readonly string[]>)[key] ?? [];
}

/** Groups as shown on screen: Features, Quotas, Settings (boards are a setting). */
export const ENTITLEMENT_GROUPS = [
  { id: 'features', keys: FEATURE_ENTITLEMENTS },
  { id: 'quotas', keys: QUOTA_ENTITLEMENTS },
  { id: 'settings', keys: SETTING_ENTITLEMENTS },
] as const satisfies readonly { id: string; keys: readonly EntitlementKey[] }[];

/** A sensible starting value when granting an override for `key`. */
export function defaultGrant(key: EntitlementKey): unknown {
  switch (entitlementKind(key)) {
    case 'feature':
      return true;
    case 'quota':
      return 10;
    case 'boards':
      return [BUILD_BOARDS[0]];
    case 'setting':
      return settingOptions(key).at(-1);
  }
}

export function isValidValue(key: EntitlementKey, value: unknown): boolean {
  return entitlementValueSchema(key).safeParse(value).success;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && [...a].sort().join() === [...b].sort().join();
  return a === b;
}

/** Keys whose value differs between two complete sets, in display order. */
export function changedKeys(before: EntitlementValues, after: EntitlementValues): EntitlementKey[] {
  return ENTITLEMENT_GROUPS.flatMap((g) => g.keys).filter((k) => !sameValue(before[k], after[k]));
}
