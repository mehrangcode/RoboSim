CREATE TYPE "public"."project_language" AS ENUM('cpp', 'blocks');--> statement-breakpoint
CREATE TYPE "public"."project_version_source" AS ENUM('manual', 'auto_build', 'restore', 'ai_apply', 'submission', 'import');--> statement-breakpoint
CREATE TYPE "public"."project_visibility" AS ENUM('private', 'link', 'workspace');--> statement-breakpoint
CREATE TABLE "project_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"label" text,
	"source" "project_version_source" NOT NULL,
	"document" jsonb NOT NULL,
	"document_sha256" text NOT NULL,
	"artifact_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"board_id" text NOT NULL,
	"language" "project_language" NOT NULL,
	"visibility" "project_visibility" DEFAULT 'private' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"schema_version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"document_sha256" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_versions_project_number_key" ON "project_versions" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "project_versions_workspace_idx" ON "project_versions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "projects_workspace_updated_idx" ON "projects" USING btree ("workspace_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "projects_workspace_name_idx" ON "projects" USING btree ("workspace_id","name","id");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_user_id");--> statement-breakpoint
-- Row-level security for projects (ADR-007): rows are visible and writable only inside the active workspace.
-- No DELETE grants: projects are soft-deleted, versions are immutable (a project purge job runs as the owner).
GRANT SELECT, INSERT, UPDATE ON projects TO robosim_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON project_versions TO robosim_app;
--> statement-breakpoint
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY projects_isolation ON projects TO robosim_app
  USING (workspace_id = app_current_workspace_id())
  WITH CHECK (workspace_id = app_current_workspace_id());
--> statement-breakpoint
CREATE POLICY project_versions_isolation ON project_versions TO robosim_app
  USING (workspace_id = app_current_workspace_id())
  WITH CHECK (
    workspace_id = app_current_workspace_id()
    AND project_id IN (SELECT p.id FROM projects p WHERE p.workspace_id = app_current_workspace_id())
  );
