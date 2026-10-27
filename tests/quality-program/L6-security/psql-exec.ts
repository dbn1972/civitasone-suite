/**
 * Shell-free psql runner for the L6 security tests.
 *
 * Every value (host, port, role, database, SQL) is passed to `psql` as a
 * discrete argv element via execFileSync, and the password travels in the
 * PGPASSWORD environment variable — nothing is ever interpolated into a shell
 * command line, so neither PGHOST/PGPORT from the environment nor SQL text can
 * inject shell syntax (and `$`, backticks and quotes in SQL need no escaping).
 */
import { execFileSync } from "child_process";

export interface PsqlConnection {
  host: string;
  port: string;
  user: string;
  db: string;
  password: string;
}

export interface PsqlResult {
  ok: boolean;
  output: string;
}

/** Collapse whitespace so multi-line SQL literals reach psql as one line each. */
export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

export function runPsql(
  conn: PsqlConnection,
  commands: string[],
  opts: { onErrorStop?: boolean; timeoutMs?: number } = {},
): PsqlResult {
  const args = ["-h", conn.host, "-p", conn.port, "-U", conn.user, "-d", conn.db, "-t", "-A"];
  if (opts.onErrorStop) args.push("-v", "ON_ERROR_STOP=1");
  for (const c of commands) args.push("-c", normalizeSql(c));
  try {
    const out = execFileSync("psql", args, {
      encoding: "utf-8",
      timeout: opts.timeoutMs ?? 10000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PGPASSWORD: conn.password },
    });
    return { ok: true, output: out.trim() };
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
    const stderr = e.stderr ? String(e.stderr) : "";
    const stdout = e.stdout ? String(e.stdout) : "";
    return { ok: false, output: stderr || stdout || e.message || "unknown error" };
  }
}
