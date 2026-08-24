import { describe, expect, it } from "vitest";
import { accessMetadataFromRequest, describeUserAgent } from "../../supabase/functions/_shared/accessLog";
import adminListSource from "../../supabase/functions/admin-list-access-logs/index.ts?raw";
import recordSource from "../../supabase/functions/record-access-event/index.ts?raw";
import migrationSql from "../../supabase/migrations/202608220007_admin_project_access_logs.sql?raw";
import permissionMigrationSql from "../../supabase/migrations/202608250002_general_permissions_and_ai_models.sql?raw";

describe("access-log security", () => {
  it("requires the access-log capability for reads and exposes no browser table access", () => {
    expect(adminListSource).toContain("await requireReadyUser(request)");
    expect(adminListSource).toContain("ADMIN_PERMISSIONS.ACCESS_LOGS_VIEW");
    expect(adminListSource).toContain("requirePermission(context");
    expect(adminListSource).not.toContain("requireSystemAdmin(request)");
    expect(migrationSql).toContain("alter table public.user_access_logs enable row level security");
    expect(migrationSql).toContain("revoke all privileges on table public.user_access_logs from public, anon, authenticated");
    expect(permissionMigrationSql).toContain("permission = 'access_logs.view'");
    expect(permissionMigrationSql).toContain("permission = 'users.view'");
    const auditOverrides = permissionMigrationSql.slice(permissionMigrationSql.indexOf("create or replace function public.list_auth_audit_logs_admin"));
    expect(auditOverrides).not.toContain("system_role = 'admin'");
  });

  it("ignores spoofed IP/country/user-agent JSON fields and uses gateway headers", () => {
    const request = new Request("https://example.supabase.co/functions/v1/record-access-event", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.8",
        "cf-ipcountry": "KR",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/132.0"
      },
      body: JSON.stringify({
        eventType: "login",
        ipAddress: "198.51.100.99",
        countryCode: "US",
        userAgent: "spoofed"
      })
    });
    expect(accessMetadataFromRequest(request)).toEqual({
      ipAddress: "203.0.113.8",
      countryCode: "KR",
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/132.0"
    });
    expect(recordSource).not.toMatch(/body\.(ipAddress|countryCode|userAgent)/u);
    expect(recordSource).toContain("accessMetadataFromRequest(request)");
  });

  it("normalizes browser/device without persisting tokens or credentials", () => {
    const forwarded = new Request("https://example.supabase.co", {
      headers: { "x-forwarded-for": "198.51.100.99, 203.0.113.8" }
    });
    expect(accessMetadataFromRequest(forwarded).ipAddress).toBe("203.0.113.8");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/132.0")).toBe("Chrome · Windows");
    expect(migrationSql).not.toMatch(/(password|credential|access_token|refresh_token|jwt)\s+(text|json|jsonb)/iu);
    expect(migrationSql).toContain("interval '90 days'");
  });
});
