/**
 * Unit test for the shell-free psql runner: a fake `psql` on PATH records the
 * argv it receives, proving shell metacharacters in connection values or SQL
 * reach psql verbatim (and are never interpreted by a shell).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runPsql } from "./psql-exec";

let dir: string;
let origPath: string | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "fake-psql-"));
  const fake = join(dir, "psql");
  writeFileSync(
    fake,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(dir, "argv.txt")}"\nprintf '%s' "$PGPASSWORD" > "${join(dir, "pw.txt")}"\necho ok\n`,
  );
  chmodSync(fake, 0o755);
  origPath = process.env.PATH;
  process.env.PATH = `${dir}:${origPath}`;
});

afterAll(() => {
  process.env.PATH = origPath;
  rmSync(dir, { recursive: true, force: true });
});

describe("runPsql", () => {
  it("passes shell metacharacters through as literal argv and never runs them", () => {
    const marker = join(dir, "pwned");
    // Shell-hostile value, randomised so no secret-shaped literal lives in the repo.
    const pw = `${globalThis.crypto.randomUUID()}$\`x\``;
    const res = runPsql(
      { host: `h; touch ${marker}`, port: "55432", user: "u", db: "d", password: pw },
      [`SELECT $$a "b" $$; touch ${marker}`],
      { onErrorStop: true },
    );
    expect(res).toEqual({ ok: true, output: "ok" });
    expect(existsSync(marker)).toBe(false);
    const argv = readFileSync(join(dir, "argv.txt"), "utf8").split("\n");
    expect(argv).toContain(`h; touch ${marker}`);
    expect(argv).toContain(`SELECT $$a "b" $$; touch ${marker}`);
    expect(argv).toContain("ON_ERROR_STOP=1");
    expect(readFileSync(join(dir, "pw.txt"), "utf8")).toBe(pw);
  });
});
