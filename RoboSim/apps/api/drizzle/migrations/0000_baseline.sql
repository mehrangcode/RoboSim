CREATE TYPE "public"."actor_kind" AS ENUM('user', 'staff', 'system', 'scim', 'lti');--> statement-breakpoint
CREATE TYPE "public"."age_band" AS ENUM('u13', '13_15', '16_17', 'adult');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('fa', 'en');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('org_owner', 'org_admin', 'billing_manager', 'teacher', 'assistant_teacher', 'student');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('platform_admin', 'content_editor', 'shop_operator', 'finance', 'support_agent', 'moderator');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending_consent', 'active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."workspace_kind" AS ENUM('personal', 'organization', 'branch');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_kind" "actor_kind" NOT NULL,
	"workspace_id" uuid,
	"action" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"seat_assigned" boolean DEFAULT false NOT NULL,
	"branch_id" uuid,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_kind" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"user_id" uuid NOT NULL,
	"role" "staff_role" NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"phone" text,
	"password_hash" text,
	"display_name" text NOT NULL,
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"date_of_birth" date,
	"age_band" "age_band" DEFAULT 'adult' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_verified_at" timestamp with time zone,
	"personal_workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_phone_e164" CHECK ("users"."phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "users_has_contact" CHECK ("users"."email" is not null or "users"."phone" is not null)
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "workspace_kind" NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_key" text,
	"owner_user_id" uuid NOT NULL,
	"economic_code" text,
	"national_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspaces_branch_has_parent" CHECK (("workspaces"."kind" = 'branch') = ("workspaces"."parent_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_branch_id_workspaces_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_personal_workspace_id_workspaces_id_fk" FOREIGN KEY ("personal_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_parent_id_workspaces_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_workspace_at_idx" ON "audit_logs" USING btree ("workspace_id","at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_workspace_user_key" ON "memberships" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_branch_idx" ON "memberships" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."published_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "workspaces_owner_idx" ON "workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "workspaces_parent_idx" ON "workspaces" USING btree ("parent_id");