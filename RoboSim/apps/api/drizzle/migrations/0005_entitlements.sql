CREATE TYPE "public"."plan_code" AS ENUM('free', 'maker', 'classroom', 'institution', 'private_cloud');--> statement-breakpoint
CREATE TYPE "public"."plan_interval" AS ENUM('month', 'year', 'term');--> statement-breakpoint
CREATE TYPE "public"."subscription_source" AS ENUM('self_serve', 'contract', 'pilot', 'manual');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'expired', 'canceled');--> statement-breakpoint
CREATE TABLE "entitlement_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"granted_by" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"interval" "plan_interval" NOT NULL,
	"price_irr" bigint,
	"seat_based" boolean DEFAULT false NOT NULL,
	"min_seats" integer DEFAULT 1 NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"entitlements" jsonb NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" "plan_code" NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"status" "subscription_status" NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"source" "subscription_source" NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone,
	"auto_renew_from_wallet" boolean DEFAULT false NOT NULL,
	"contract_ref" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlement_overrides_workspace_idx" ON "entitlement_overrides" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_plan_version_key" ON "plan_versions" USING btree ("plan_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_workspace_key" ON "subscriptions" USING btree ("workspace_id");--> statement-breakpoint
-- Plans and entitlements (Technical Design §8.7, §9.1; ADR-007). Plans and versions are a global catalogue that
-- requests read; a workspace reads its own subscription and overrides. Every write is trusted staff or system
-- code (admin endpoints, the retention job), which runs as the owning role outside RLS.
GRANT SELECT ON plans, plan_versions TO robosim_app;
--> statement-breakpoint
GRANT SELECT ON subscriptions, entitlement_overrides TO robosim_app;
--> statement-breakpoint
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE entitlement_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE entitlement_overrides FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY subscriptions_isolation ON subscriptions FOR SELECT TO robosim_app
  USING (workspace_id = app_current_workspace_id());
--> statement-breakpoint
CREATE POLICY entitlement_overrides_isolation ON entitlement_overrides FOR SELECT TO robosim_app
  USING (workspace_id = app_current_workspace_id());
--> statement-breakpoint
-- First version of each plan, from PRD §3 (`DEFAULT_PLAN_ENTITLEMENTS`; a test keeps them equal). Prices are set
-- by finance in the back office. Private Cloud is licensed per contract and has no catalogue plan yet.
INSERT INTO plans (id, code, public) VALUES (gen_random_uuid(), 'free', true);
--> statement-breakpoint
INSERT INTO plan_versions (id, plan_id, version, interval, price_irr, seat_based, min_seats, entitlements)
  SELECT gen_random_uuid(), p.id, 1, 'month', NULL, false, 1,
    '{"export.csv":true,"export.pdf":false,"collab.realtime":false,"community.publish":false,"ai.byok":false,"hwb.upload":true,"arena.custom":false,"org.classes":false,"org.verified_grading":false,"org.sso":false,"org.scim":false,"org.lti":false,"org.analytics":false,"org.audit_export":false,"boards.allowed":["avr-uno"],"components.tier":"basic","projects.cloud_max":3,"projects.version_retention_days":7,"build.daily_quota":30,"build.priority":"low","learning.guided_projects":"first","learning.courses":"none","ai.platform_credits_monthly":0}'::jsonb
  FROM plans p WHERE p.code = 'free';
--> statement-breakpoint
INSERT INTO plans (id, code, public) VALUES (gen_random_uuid(), 'maker', true);
--> statement-breakpoint
INSERT INTO plan_versions (id, plan_id, version, interval, price_irr, seat_based, min_seats, entitlements)
  SELECT gen_random_uuid(), p.id, 1, 'month', NULL, false, 1,
    '{"export.csv":true,"export.pdf":true,"collab.realtime":true,"community.publish":true,"ai.byok":true,"hwb.upload":true,"arena.custom":true,"org.classes":false,"org.verified_grading":false,"org.sso":false,"org.scim":false,"org.lti":false,"org.analytics":false,"org.audit_export":false,"boards.allowed":["avr-uno"],"components.tier":"all","projects.cloud_max":null,"projects.version_retention_days":365,"build.daily_quota":500,"build.priority":"normal","learning.guided_projects":"all","learning.courses":"public","ai.platform_credits_monthly":0}'::jsonb
  FROM plans p WHERE p.code = 'maker';
--> statement-breakpoint
INSERT INTO plans (id, code, public) VALUES (gen_random_uuid(), 'classroom', false);
--> statement-breakpoint
INSERT INTO plan_versions (id, plan_id, version, interval, price_irr, seat_based, min_seats, entitlements)
  SELECT gen_random_uuid(), p.id, 1, 'year', NULL, true, 10,
    '{"export.csv":true,"export.pdf":true,"collab.realtime":true,"community.publish":true,"ai.byok":true,"hwb.upload":true,"arena.custom":true,"org.classes":true,"org.verified_grading":true,"org.sso":false,"org.scim":false,"org.lti":false,"org.analytics":true,"org.audit_export":false,"boards.allowed":["avr-uno"],"components.tier":"all","projects.cloud_max":null,"projects.version_retention_days":365,"build.daily_quota":300,"build.priority":"normal","learning.guided_projects":"all","learning.courses":"all","ai.platform_credits_monthly":0}'::jsonb
  FROM plans p WHERE p.code = 'classroom';
--> statement-breakpoint
INSERT INTO plans (id, code, public) VALUES (gen_random_uuid(), 'institution', false);
--> statement-breakpoint
INSERT INTO plan_versions (id, plan_id, version, interval, price_irr, seat_based, min_seats, entitlements)
  SELECT gen_random_uuid(), p.id, 1, 'term', NULL, false, 1,
    '{"export.csv":true,"export.pdf":true,"collab.realtime":true,"community.publish":true,"ai.byok":true,"hwb.upload":true,"arena.custom":true,"org.classes":true,"org.verified_grading":true,"org.sso":true,"org.scim":true,"org.lti":true,"org.analytics":true,"org.audit_export":true,"boards.allowed":["avr-uno"],"components.tier":"all","projects.cloud_max":null,"projects.version_retention_days":null,"build.daily_quota":300,"build.priority":"high","learning.guided_projects":"all","learning.courses":"all","ai.platform_credits_monthly":0}'::jsonb
  FROM plans p WHERE p.code = 'institution';
--> statement-breakpoint
-- Over the cloud-project cap (PRD §3), only the most recently updated live projects stay editable. The rank is
-- needed inside request transactions, also for sharees who cannot see the owner's other projects, so it runs as
-- the owning role (like system code) and returns nothing but a count.
CREATE FUNCTION app_project_rank(project uuid) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM projects o JOIN projects p ON o.workspace_id = p.workspace_id
  WHERE p.id = project AND o.deleted_at IS NULL AND (o.updated_at, o.id) > (p.updated_at, p.id)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_project_rank(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_project_rank(uuid) TO robosim_app;
