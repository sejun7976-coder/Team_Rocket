import { describe, expect, it } from "vitest";
import initialSchemaSql from "../../supabase/migrations/202608220001_initial_schema.sql?raw";
import adminPolicySql from "../../supabase/migrations/202608220002_admin_account_policy.sql?raw";
import explicitGrantsSql from "../../supabase/migrations/202608220003_explicit_data_api_grants.sql?raw";
import bootstrapSql from "../../supabase/migrations/202608220004_system_admin_bootstrap.sql?raw";
import recoveryBootstrapSql from "../../supabase/migrations/202608220005_recoverable_system_admin_bootstrap.sql?raw";
import accessLogSql from "../../supabase/migrations/202608220007_admin_project_access_logs.sql?raw";
import taskAndAISql from "../../supabase/migrations/202608220008_task_atomic_and_ai.sql?raw";
import multiProviderSql from "../../supabase/migrations/202608220009_ai_registry_user_deletion_task_rpc.sql?raw";
import singleGatewaySql from "../../supabase/migrations/202608220012_single_ai_gateway.sql?raw";
import notificationSql from "../../supabase/migrations/202608220016_materialize_project_notifications.sql?raw";
import fileFoldersSql from "../../supabase/migrations/202608220014_virtual_file_folders.sql?raw";
import projectGitHubSql from "../../supabase/migrations/202608220015_decouple_project_github_status.sql?raw";
import announcementsAndRolesSql from "../../supabase/migrations/202608240001_project_announcements_and_admin_roles.sql?raw";
import adminPermissionsSql from "../../supabase/migrations/202608240002_admin_permissions.sql?raw";
import generalPermissionsSql from "../../supabase/migrations/202608250002_general_permissions_and_ai_models.sql?raw";
import aiPolicySql from "../../supabase/migrations/202608250004_ai_policy_and_conversations.sql?raw";

const authenticatedPrivileges = {
  profiles: ["select", "update"],
  projects: ["select", "update"],
  project_members: ["select"],
  project_keys: ["select"],
  tasks: ["select", "insert", "update", "delete"],
  task_assignees: ["select", "insert", "delete"],
  task_checklist_items: ["select", "insert", "update"],
  comments: ["select", "insert", "update"],
  activities: ["select"],
  files: ["select", "insert"],
  notifications: ["select", "update"],
  github_sync_jobs: ["select"]
} as const;

const businessTables = [...Object.keys(authenticatedPrivileges), "admin_audit_logs"];
const policySql = `${initialSchemaSql}\n${adminPolicySql}`.toLowerCase();

describe("Supabase Data API authorization contract", () => {
  it("declares the exact authenticated table grants in both schema and hardening migrations", () => {
    for (const [table, privileges] of Object.entries(authenticatedPrivileges)) {
      const grant = `grant ${privileges.join(", ")} on table public.${table} to authenticated;`;
      expect(initialSchemaSql.toLowerCase()).toContain(grant);
      expect(explicitGrantsSql.toLowerCase()).toContain(grant);
    }
  });

  it("revokes anon and PUBLIC business-table access and locks future defaults", () => {
    expect(explicitGrantsSql.toLowerCase()).toContain("from public, anon, authenticated;");
    expect(explicitGrantsSql.toLowerCase()).toContain(
      "alter default privileges in schema public revoke all privileges on tables from public, anon, authenticated;"
    );
    expect(explicitGrantsSql).not.toMatch(/grant\s+[\s\S]*?\s+to\s+anon\s*;/iu);
  });

  it("enables RLS on every business table", () => {
    for (const table of businessTables) {
      expect(explicitGrantsSql.toLowerCase()).toContain(`alter table public.${table} enable row level security;`);
    }
  });

  it("has an operation-matching RLS policy for every authenticated grant", () => {
    for (const [table, privileges] of Object.entries(authenticatedPrivileges)) {
      for (const privilege of privileges) {
        expect(policySql).toContain(`on public.${table} for ${privilege}`);
      }
    }
  });

  it("keeps the one-time bootstrap latch inaccessible to browser roles", () => {
    const sql = bootstrapSql.toLowerCase();
    expect(sql).toContain("alter table public.system_admin_bootstrap_state enable row level security;");
    expect(sql).toContain("revoke all privileges on table public.system_admin_bootstrap_state from public, anon, authenticated;");
    expect(sql).toContain("grant select, insert, update, delete on table public.system_admin_bootstrap_state to service_role;");
    expect(sql).not.toMatch(/grant\s+[\s\S]*?system_admin_bootstrap_state[\s\S]*?\s+to\s+(anon|authenticated)\s*;/iu);
    const recoverySql = recoveryBootstrapSql.toLowerCase();
    for (const signature of [
      "prepare_system_admin_bootstrap(uuid, text)",
      "finalize_system_admin_bootstrap_recovery(uuid, uuid, text, text)",
      "release_system_admin_bootstrap_recovery(uuid)"
    ]) {
      expect(recoverySql).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(recoverySql).toContain(`grant execute on function public.${signature} to service_role;`);
    }
  });

  it("keeps access logs behind service-role RPCs with RLS and no browser table grants", () => {
    const sql = accessLogSql.toLowerCase();
    expect(sql).toContain("alter table public.user_access_logs enable row level security;");
    expect(sql).toContain("revoke all privileges on table public.user_access_logs from public, anon, authenticated;");
    expect(sql).toContain("grant select, insert, delete on table public.user_access_logs to service_role;");
    expect(sql).not.toMatch(/grant\s+[\s\S]*?user_access_logs[\s\S]*?\s+to\s+(anon|authenticated)\s*;/iu);
    expect(sql).toContain("revoke all on function public.list_auth_audit_logs_admin");
    expect(sql).toContain("to service_role;");
  });

  it("routes destructive task cleanup through Edge and keeps AI tables service-role-only", () => {
    const sql = taskAndAISql.toLowerCase();
    expect(sql).toContain("grant delete on table public.files to authenticated;");
    expect(sql).toContain("revoke delete on table public.tasks from authenticated;");
    expect(sql).toContain("alter table public.ai_provider_settings enable row level security;");
    expect(sql).toContain("alter table public.ai_usage_logs enable row level security;");
    expect(sql).toContain("revoke all on table public.ai_provider_settings, public.ai_usage_logs from public, anon, authenticated;");
    expect(sql).toContain("grant all on table public.ai_provider_settings, public.ai_usage_logs to service_role;");
  });

  it("keeps the multi-provider model registry RLS-protected and browser-inaccessible", () => {
    const sql = multiProviderSql.toLowerCase();
    for (const table of ["ai_provider_settings", "ai_model_settings"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(sql).toContain("revoke all on table public.ai_provider_settings, public.ai_model_settings from public, anon, authenticated;");
    expect(sql).toContain("grant all on table public.ai_provider_settings, public.ai_model_settings to service_role;");
  });

  it("keeps the single AI Gateway and model registry outside anon/authenticated Data API access", () => {
    const sql = singleGatewaySql.toLowerCase();
    expect(sql).toContain("alter table public.ai_gateway_settings enable row level security;");
    expect(sql).toContain("alter table public.ai_gateway_settings force row level security;");
    expect(sql).toContain("revoke all on table public.ai_gateway_settings from public, anon, authenticated;");
    expect(sql).toContain("grant all on table public.ai_gateway_settings to service_role;");
    expect(sql).toContain("revoke all on table public.ai_model_settings from public, anon, authenticated;");
    expect(sql).not.toMatch(/grant\s+[\s\S]*?ai_gateway_settings[\s\S]*?\s+to\s+(anon|authenticated)\s*;/iu);
  });

  it("adds notification refresh with authenticated RPC access but no elevated table grant", () => {
    const sql = notificationSql.toLowerCase();
    expect(sql).toContain("grant execute on function public.refresh_due_notifications() to authenticated;");
    expect(sql).toContain("revoke all on function public.refresh_due_notifications() from public, anon, authenticated;");
    expect(sql).toContain("auth.uid() is null or not public.current_account_ready()");
  });

  it("protects virtual folders with explicit grants, RLS policies and cross-project validation", () => {
    const sql = fileFoldersSql.toLowerCase();
    expect(sql).toContain("alter table public.file_folders enable row level security;");
    expect(sql).toContain("alter table public.file_folders force row level security;");
    expect(sql).toContain("revoke all on table public.file_folders from public, anon, authenticated;");
    expect(sql).toContain("grant select, insert, delete on table public.file_folders to authenticated;");
    expect(sql).toContain("grant update(folder_id) on table public.files to authenticated;");
    for (const operation of ["select", "insert", "delete"]) {
      expect(sql).toContain(`on public.file_folders for ${operation}`);
    }
    expect(sql).toContain("raise exception using errcode = '23514'");
  });

  it("keeps optional GitHub project finalizers service-role-only", () => {
    const sql = projectGitHubSql.toLowerCase();
    for (const signature of ["finalize_project_without_repository(uuid)", "mark_project_github_error(uuid, text)"]) {
      expect(sql).toContain(`revoke all on function public.${signature}`);
      expect(sql).toContain(`grant execute on function public.${signature}`);
    }
    expect(sql).toContain("auth.role() <> 'service_role'");
  });

  it("protects encrypted project announcements with member-only RLS", () => {
    const sql = announcementsAndRolesSql.toLowerCase();
    expect(sql).toContain("alter table public.project_announcements enable row level security;");
    expect(sql).toContain("alter table public.project_announcements force row level security;");
    expect(sql).toContain("grant select, insert, update on table public.project_announcements to authenticated;");
    expect(sql).toContain("revoke all privileges on table public.project_announcements");
    for (const operation of ["select", "insert", "update"]) {
      expect(sql).toContain(`on public.project_announcements for ${operation} to authenticated`);
    }
    expect(sql).toContain("public.is_project_member(project_id)");
    expect(sql).toContain("updated_by = auth.uid()");
    expect(sql).not.toContain("content text");
  });

  it("keeps system-role mutation RPCs service-role-only", () => {
    const sql = announcementsAndRolesSql.toLowerCase();
    for (const signature of [
      "set_managed_system_role(uuid, uuid, public.system_role)",
      "restore_system_role_after_auth_failure(uuid, uuid, public.system_role, public.system_role)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature}`);
      expect(sql).toContain(`grant execute on function public.${signature}`);
      expect(sql).toContain("to service_role;");
    }
    expect(sql).toContain("last_system_admin");
    expect(sql).toContain("pg_advisory_xact_lock");
  });

  it("allows active User/Admin callers to read only their own permissions and blocks browser writes", () => {
    const sql = `${adminPermissionsSql}\n${generalPermissionsSql}`.toLowerCase();
    expect(sql).toContain("alter table public.user_admin_permissions enable row level security;");
    expect(sql).toContain("alter table public.user_admin_permissions force row level security;");
    expect(sql).toContain("on public.user_admin_permissions for select to authenticated");
    expect(generalPermissionsSql.toLowerCase()).toContain("user_id = auth.uid()");
    expect(generalPermissionsSql.toLowerCase()).toContain("profile.account_status = 'active'");
    expect(generalPermissionsSql).toContain("drop trigger if exists user_admin_permissions_admin_only");
    expect(sql).toContain("revoke all privileges on table public.user_admin_permissions");
    expect(sql).toContain("grant select on table public.user_admin_permissions to authenticated;");
    expect(sql).not.toMatch(/grant\s+(?:insert|update|delete|all)[^;]*user_admin_permissions[^;]*to authenticated/iu);
  });

  it("keeps AI policy, conversation, message, event, and runtime tables service-role-only", () => {
    const sql = aiPolicySql.toLowerCase();
    for (const table of [
      "ai_runtime_settings",
      "ai_user_policy_status",
      "ai_conversations",
      "ai_messages",
      "ai_policy_events",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`alter table public.${table} force row level security;`);
    }
    expect(sql).toContain("from public, anon, authenticated;");
    expect(sql).toContain("to service_role;");
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete|all)[^;]*ai_(?:runtime_settings|user_policy_status|conversations|messages|policy_events)[^;]*to authenticated/iu);
    for (const signature of [
      "record_ai_policy_violation(uuid, uuid, text, text, text, text, numeric)",
      "set_ai_guard_model_by_actor(uuid, text)",
      "reset_ai_user_policy_by_actor(uuid, uuid)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
    }
  });
});
