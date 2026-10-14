-- Tenant isolation and append-only audit (Technical Design §8.1, Security §12, ADR-007).
-- Request transactions run `SET LOCAL ROLE robosim_app` plus `app.user_id` / `app.workspace_id`
-- settings; system jobs (outbox relay, migrations, seeds) run as the owning role.
DO $$
BEGIN
  CREATE ROLE robosim_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;
--> statement-breakpoint
GRANT robosim_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO robosim_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON users, workspaces TO robosim_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO robosim_app;
--> statement-breakpoint
GRANT SELECT ON staff_roles, feature_flags TO robosim_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_logs TO robosim_app;
--> statement-breakpoint
GRANT INSERT ON outbox_events TO robosim_app;
--> statement-breakpoint
CREATE FUNCTION app_current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE FUNCTION app_current_workspace_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.workspace_id', true), '')::uuid
$$;
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A membership is visible inside its workspace, and to the member themself (to list their workspaces).
CREATE POLICY memberships_isolation ON memberships TO robosim_app
  USING (workspace_id = app_current_workspace_id() OR user_id = app_current_user_id())
  WITH CHECK (workspace_id = app_current_workspace_id());
--> statement-breakpoint
CREATE POLICY workspaces_isolation ON workspaces TO robosim_app
  USING (
    id = app_current_workspace_id()
    OR id IN (SELECT m.workspace_id FROM memberships m WHERE m.user_id = app_current_user_id())
  )
  WITH CHECK (id = app_current_workspace_id());
--> statement-breakpoint
-- Users see themselves and co-members of the active workspace; they can only write their own row.
CREATE POLICY users_isolation ON users TO robosim_app
  USING (
    id = app_current_user_id()
    OR id IN (SELECT m.user_id FROM memberships m WHERE m.workspace_id = app_current_workspace_id())
  )
  WITH CHECK (id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY audit_logs_read ON audit_logs FOR SELECT TO robosim_app
  USING (workspace_id = app_current_workspace_id());
--> statement-breakpoint
CREATE POLICY audit_logs_append ON audit_logs FOR INSERT TO robosim_app
  WITH CHECK (workspace_id IS NULL OR workspace_id = app_current_workspace_id());
--> statement-breakpoint
CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
