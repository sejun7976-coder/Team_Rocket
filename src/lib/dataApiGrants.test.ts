import { describe, expect, it } from "vitest";
import initialSchemaSql from "../../supabase/migrations/202608220001_initial_schema.sql?raw";
import adminPolicySql from "../../supabase/migrations/202608220002_admin_account_policy.sql?raw";
import explicitGrantsSql from "../../supabase/migrations/202608220003_explicit_data_api_grants.sql?raw";
import bootstrapSql from "../../supabase/migrations/202608220004_system_admin_bootstrap.sql?raw";
import recoveryBootstrapSql from "../../supabase/migrations/202608220005_recoverable_system_admin_bootstrap.sql?raw";

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
});
