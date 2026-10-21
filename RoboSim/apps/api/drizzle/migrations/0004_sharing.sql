CREATE TYPE "public"."project_share_role" AS ENUM('view', 'comment', 'edit');--> statement-breakpoint
CREATE TYPE "public"."share_principal_kind" AS ENUM('user', 'workspace');--> statement-breakpoint
CREATE TABLE "project_shares" (
	"project_id" uuid NOT NULL,
	"principal_kind" "share_principal_kind" NOT NULL,
	"principal_id" uuid NOT NULL,
	"role" "project_share_role" NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_shares_project_id_principal_kind_principal_id_pk" PRIMARY KEY("project_id","principal_kind","principal_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "share_link_nonce" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "share_token_hash" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "link_remixable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "remixed_from_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "remixed_from_name" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "remixed_from_author" text;--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_shares_principal_idx" ON "project_shares" USING btree ("principal_kind","principal_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_remixed_from_id_projects_id_fk" FOREIGN KEY ("remixed_from_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_share_token_hash_key" ON "projects" USING btree ("share_token_hash");--> statement-breakpoint
-- Sharing (FR-PRJ-04, Security §4.3, ADR-007). The owner's workspace manages its shares; a sharee sees (and may
-- remove) their own share. A shared project is visible to its sharees while not deleted, and editable by `edit`
-- sharees, who cannot soft-delete it. Share links are resolved by trusted system code, outside RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON project_shares TO robosim_app;
--> statement-breakpoint
ALTER TABLE project_shares ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_shares FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_shares_owner ON project_shares TO robosim_app
  USING (workspace_id = app_current_workspace_id())
  WITH CHECK (
    workspace_id = app_current_workspace_id()
    AND project_id IN (SELECT p.id FROM projects p WHERE p.workspace_id = app_current_workspace_id())
  );
--> statement-breakpoint
CREATE POLICY project_shares_principal_read ON project_shares FOR SELECT TO robosim_app
  USING (principal_kind = 'user' AND principal_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY project_shares_principal_leave ON project_shares FOR DELETE TO robosim_app
  USING (principal_kind = 'user' AND principal_id = app_current_user_id());
--> statement-breakpoint
CREATE FUNCTION app_project_share_role(project uuid) RETURNS project_share_role LANGUAGE sql STABLE AS $$
  SELECT s.role FROM project_shares s
  WHERE s.project_id = project AND s.principal_kind = 'user' AND s.principal_id = app_current_user_id()
$$;
--> statement-breakpoint
CREATE POLICY projects_shared_read ON projects FOR SELECT TO robosim_app
  USING (deleted_at IS NULL AND app_project_share_role(id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY projects_shared_edit ON projects FOR UPDATE TO robosim_app
  USING (deleted_at IS NULL AND app_project_share_role(id) = 'edit')
  WITH CHECK (deleted_at IS NULL AND app_project_share_role(id) = 'edit');
--> statement-breakpoint
CREATE POLICY project_versions_shared_read ON project_versions FOR SELECT TO robosim_app
  USING (app_project_share_role(project_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY project_versions_shared_insert ON project_versions FOR INSERT TO robosim_app
  WITH CHECK (
    app_project_share_role(project_id) = 'edit'
    AND workspace_id IN (SELECT p.workspace_id FROM projects p WHERE p.id = project_id)
  );
