CREATE TYPE "public"."ai_key_owner" AS ENUM('user', 'workspace');--> statement-breakpoint
CREATE TYPE "public"."ai_key_status" AS ENUM('pending', 'active', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."ai_mode" AS ENUM('full', 'hints');--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('platform', 'openai', 'anthropic', 'gemini', 'openrouter', 'compatible');--> statement-breakpoint
CREATE TYPE "public"."ai_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"mode" "ai_mode" DEFAULT 'full' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_kind" "ai_key_owner" NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"ciphertext" text NOT NULL,
	"wrapped_dek" text NOT NULL,
	"key_last4" text NOT NULL,
	"base_url" text,
	"status" "ai_key_status" DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"validated_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "ai_role" NOT NULL,
	"content" text NOT NULL,
	"proposals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" "ai_provider",
	"model" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"filtered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_provider_configs" (
	"provider" "ai_provider" PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"base_url" text,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_model" text,
	"legal_ref" text,
	"legal_approved_at" timestamp with time zone,
	"price_in_irr" bigint,
	"price_out_irr" bigint,
	"checked_at" timestamp with time zone,
	"check_ok" boolean,
	"check_error" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"credits" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_keys" ADD CONSTRAINT "ai_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversations_user_project" ON "ai_conversations" USING btree ("user_id","project_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_conversations_expires" ON "ai_conversations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_keys_owner_provider" ON "ai_keys" USING btree ("owner_kind","owner_id","provider");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_user_month" ON "ai_usage" USING btree ("workspace_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
-- AI conversations, messages and usage (FR-AI-08): each user reads and writes only their own rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_conversations, ai_messages TO robosim_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON ai_usage TO robosim_app;
--> statement-breakpoint
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_conversations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_conversations_owner ON ai_conversations TO robosim_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id() AND workspace_id = app_current_workspace_id());
--> statement-breakpoint
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_messages_owner ON ai_messages TO robosim_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_usage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_usage_owner ON ai_usage TO robosim_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id() AND workspace_id = app_current_workspace_id());
--> statement-breakpoint
-- ai_keys and ai_provider_configs: no grant to robosim_app. Keys are decrypted only by system code, and the
-- provider catalogue is written by staff (BR-15).
-- The platform model is self-hosted (ADR-009), so it ships enabled; external providers wait for legal review.
INSERT INTO ai_provider_configs (provider, enabled) VALUES
  ('platform', true), ('openai', false), ('anthropic', false), ('gemini', false), ('openrouter', false), ('compatible', false);
--> statement-breakpoint
-- Placeholder monthly platform credits (tokens) on the seeded first plan versions, which carried 0 until AI
-- shipped; product sets real allowances by publishing new versions in the back office.
UPDATE plan_versions pv SET entitlements = jsonb_set(pv.entitlements, '{ai.platform_credits_monthly}', to_jsonb(v.credits))
FROM plans p, (VALUES ('free', 20000), ('maker', 200000), ('classroom', 50000), ('institution', 100000)) AS v(code, credits)
WHERE pv.plan_id = p.id AND p.code::text = v.code AND pv.version = 1
  AND (pv.entitlements->>'ai.platform_credits_monthly')::int = 0;
