import { describe, expect, it } from "vitest";
import bootstrapFunctionSource from "../../supabase/functions/bootstrap-system-admin/index.ts?raw";
import bootstrapScriptSource from "../../scripts/bootstrap-system-admin.mjs?raw";
import { INITIAL_PASSWORD } from "../../supabase/functions/_shared/accountPolicy.ts";

describe("one-time system admin bootstrap policy", () => {
  it("uses the same fixed initial password as managed users", () => {
    expect(INITIAL_PASSWORD).toBe("1234");
    expect(bootstrapFunctionSource).toContain("deriveInitialAuthCredential(studentId)");
    expect(bootstrapFunctionSource).toContain("password: authCredential");
    expect(bootstrapFunctionSource).not.toContain("password: INITIAL_PASSWORD");
  });

  it("does not accept a bootstrap password from the operator or request body", () => {
    expect(bootstrapScriptSource).not.toContain("askHidden");
    expect(bootstrapScriptSource).toContain("JSON.stringify({ studentId, name })");
    expect(bootstrapFunctionSource).not.toMatch(/password\?:\s*unknown/u);
  });

  it("keeps forced password change metadata enabled", () => {
    expect(bootstrapFunctionSource).toContain("must_change_password: true");
    expect(bootstrapFunctionSource).toContain('system_role: "admin"');
  });
});
