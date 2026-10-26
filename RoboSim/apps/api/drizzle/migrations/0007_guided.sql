CREATE TABLE "guided_progress" (
	"user_id" uuid NOT NULL,
	"content_version_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"completed_steps" text[] DEFAULT '{}'::text[] NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guided_progress_user_id_content_version_id_pk" PRIMARY KEY("user_id","content_version_id")
);
--> statement-breakpoint
ALTER TABLE "guided_progress" ADD CONSTRAINT "guided_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guided_progress" ADD CONSTRAINT "guided_progress_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Guided-project progress (FR-LRN-01): each user reads and writes only their own rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON guided_progress TO robosim_app;
--> statement-breakpoint
ALTER TABLE guided_progress ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guided_progress FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY guided_progress_owner ON guided_progress TO robosim_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
