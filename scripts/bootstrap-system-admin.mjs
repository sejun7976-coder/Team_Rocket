import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliEntry = join(projectRoot, "node_modules", "supabase", "dist", "supabase.js");
const linkedProjectRefPath = join(projectRoot, "supabase", ".temp", "project-ref");
const projectRefPattern = /^[a-z0-9]{20}$/u;
const studentIdPattern = /^[0-9]{6,12}$/u;

async function ask(label) {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    return (await readline.question(label)).trim();
  } finally {
    readline.close();
  }
}

async function askUntil(label, validate, errorMessage) {
  while (true) {
    const value = await ask(label);
    if (validate(value)) return value;
    console.error(errorMessage);
  }
}

async function runSupabase(args, label, allowFailure = false) {
  console.log(`[bootstrap] ${label}`);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: projectRoot,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0 && !allowFailure) throw new Error(`${label} 단계가 실패했습니다.`);
  return exitCode === 0;
}

function safeDiagnostic(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(value) ? value : null;
}

function bootstrapApiError(response, body) {
  const safeBody = body && typeof body === "object" ? body : {};
  const message = typeof safeBody.error === "string"
    ? Array.from(safeBody.error, (character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 || codePoint === 127 ? " " : character;
      }).join("").slice(0, 200)
    : `Bootstrap API가 HTTP ${response.status}를 반환했습니다.`;
  const diagnostics = ["code", "phase", "dbCode", "databaseError", "authCode"]
    .flatMap((key) => {
      const value = safeDiagnostic(safeBody[key]);
      return value ? [`${key}=${value}`] : [];
    });
  return new Error(`${message}${diagnostics.length ? ` [${diagnostics.join(", ")}]` : ""}`);
}

async function main() {
  if (!existsSync(cliEntry)) throw new Error("먼저 npm install을 실행해야 합니다.");
  const linkedProjectRef = existsSync(linkedProjectRefPath)
    ? readFileSync(linkedProjectRefPath, "utf8").trim()
    : "";
  const projectRef = projectRefPattern.test(linkedProjectRef)
    ? linkedProjectRef
    : await askUntil("Supabase Project ref: ", (value) => projectRefPattern.test(value), "Project ref는 영문 소문자와 숫자 20자리여야 합니다.");
  const studentId = await askUntil("최초 관리자 학번: ", (value) => studentIdPattern.test(value), "학번은 숫자 6~12자리여야 합니다.");
  const name = await askUntil("최초 관리자 이름: ", (value) => value.length >= 1 && value.length <= 80, "이름은 1~80자여야 합니다.");

  const bootstrapSecret = randomBytes(32).toString("base64url");
  let secretMayExist = false;
  let functionMayExist = false;
  try {
    await runSupabase(
      ["db", "push", "--project-ref", projectRef, "--yes"],
      "recoverable bootstrap migration 적용"
    );

    const temporaryDirectory = mkdtempSync(join(tmpdir(), "rocket-admin-bootstrap-"));
    const temporarySecretFile = join(temporaryDirectory, "bootstrap.env");
    try {
      writeFileSync(temporarySecretFile, `SYSTEM_ADMIN_BOOTSTRAP_SECRET=${bootstrapSecret}\n`, { encoding: "utf8", mode: 0o600 });
      secretMayExist = true;
      await runSupabase(
        ["secrets", "set", "--env-file", temporarySecretFile, "--project-ref", projectRef],
        "일회성 bootstrap Secret 등록"
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
    functionMayExist = true;
    await runSupabase(
      ["functions", "deploy", "bootstrap-system-admin", "--project-ref", projectRef, "--no-verify-jwt", "--use-api"],
      "일회성 bootstrap Function 배포"
    );

    console.log("[bootstrap] 최초 system_admin 생성");
    const response = await fetch(`https://${projectRef}.supabase.co/functions/v1/bootstrap-system-admin`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bootstrapSecret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ studentId, name }),
      signal: AbortSignal.timeout(30_000)
    });
    const responseText = await response.text();
    let responseBody = {};
    try {
      const parsed = JSON.parse(responseText);
      responseBody = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      // Never print an untrusted upstream response body during credential bootstrap.
    }
    if (!response.ok) throw bootstrapApiError(response, responseBody);

    const recovered = responseBody.recovered === true || responseBody.alreadyCompleted === true;
    console.log(`\n최초 system_admin ${recovered ? "복구" : "생성"} 완료: ${studentId} / ${name}`);
    console.log(responseBody.requiresInitialPassword === false
      ? "학번과 현재 PIN 또는 비밀번호로 로그인하세요."
      : "학번과 초기 비밀번호 1234로 로그인한 뒤 최초 비밀번호 변경을 완료하세요.");
  } finally {
    if (functionMayExist) {
      const deleted = await runSupabase(
        ["functions", "delete", "bootstrap-system-admin", "--project-ref", projectRef, "--yes"],
        "일회성 bootstrap Function 삭제",
        true
      );
      if (!deleted) console.warn("경고: 임시 bootstrap Function 삭제를 확인하지 못했습니다. Supabase Dashboard에서 삭제 상태를 확인하세요.");
    }
    if (secretMayExist) {
      const unset = await runSupabase(
        ["secrets", "unset", "SYSTEM_ADMIN_BOOTSTRAP_SECRET", "--project-ref", projectRef, "--yes"],
        "일회성 bootstrap Secret 삭제",
        true
      );
      if (!unset) console.warn("경고: 임시 bootstrap Secret 삭제를 확인하지 못했습니다. Supabase Dashboard에서 삭제 상태를 확인하세요.");
    }
  }
}

main().catch((error) => {
  console.error(`Bootstrap 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
  process.exitCode = 1;
});
