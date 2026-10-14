/** Server-enforced entitlement keys (PRD §3). The entitlements service (P2) resolves their values. */
export const FEATURE_ENTITLEMENTS = [
  'export.csv',
  'export.pdf',
  'collab.realtime',
  'community.publish',
  'ai.byok',
  'hwb.upload',
  'arena.custom',
  'org.classes',
  'org.verified_grading',
  'org.sso',
  'org.scim',
  'org.lti',
  'org.analytics',
  'org.audit_export',
] as const;

export const QUOTA_ENTITLEMENTS = [
  'projects.cloud_max',
  'projects.version_retention_days',
  'build.daily_quota',
  'ai.platform_credits_monthly',
] as const;

export const SETTING_ENTITLEMENTS = [
  'boards.allowed',
  'components.tier',
  'build.priority',
  'learning.guided_projects',
  'learning.courses',
] as const;

export type FeatureEntitlement = (typeof FEATURE_ENTITLEMENTS)[number];
export type QuotaEntitlement = (typeof QUOTA_ENTITLEMENTS)[number];
export type SettingEntitlement = (typeof SETTING_ENTITLEMENTS)[number];
export type EntitlementKey = FeatureEntitlement | QuotaEntitlement | SettingEntitlement;
