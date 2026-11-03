/**
 * UAT #2445 review item 6: every meeting-service logger (the Fastify request logger and each
 * module pino logger) uses the shared log-safe err serializer, so a postgres-js error,
 * whose message, detail, query and parameters can carry input values, is logged as
 * code / constraint / table only. Same guard approach as hrms-service
 * (employee-duplicate-no-409-real-db.test.ts).
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pino } from "pino";
import { SAFE_LOG_SERIALIZERS } from "@civitasone/observability";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

afterAll(async () => { await sqlClient.end(); });

const SECRET_VALUE = "Kumari Sensitive QWERT6789Z";

describe("meeting-service log-safe error serializer (UAT #2445 review item 6)", () => {
  it("a real Postgres error carrying an input value is logged without it", async () => {
    let caught: unknown;
    try { await sqlClient.unsafe("select $1::int as n", [SECRET_VALUE] as never[]); } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    // Control: the raw driver error really does carry the value.
    expect(JSON.stringify(caught) + String((caught as Error).message)).toContain("Kumari");

    const lines: string[] = [];
    const log = pino({ serializers: SAFE_LOG_SERIALIZERS }, new Writable({ write(c, _e, cb) { lines.push(String(c)); cb(); } }));
    log.error({ err: caught }, "query failed");
    log.error({ err: new Error("wrapped", { cause: caught }) }, "wrapped failure");
    const out = lines.join("\n");
    expect(out).not.toContain("Kumari");
    expect(out).not.toContain("QWERT6789Z");
    expect(out).not.toContain('"parameters"');
    expect(out).not.toContain('"query"');
    expect(JSON.parse(lines[0]!).err).toMatchObject({ type: "PostgresError", code: "22P02" });
  });

  it("the Fastify request logger and every module pino logger use it", async () => {
    const app = await buildApp();
    try {
      const sers = (app.log as unknown as Record<symbol, Record<string, unknown>>)[pino.symbols.serializersSym];
      expect(sers?.err).toBe(SAFE_LOG_SERIALIZERS.err);
    } finally {
      await app.close();
    }
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "__tests__") walk(p); continue; }
        if (!e.isFile() || !p.endsWith(".ts") || p.endsWith(".test.ts")) continue;
        for (const m of readFileSync(p, "utf8").matchAll(/pino\(\{[^)]*\}\)/g)) if (!m[0].includes("SAFE_LOG_SERIALIZERS")) offenders.push(p);
      }
    };
    walk(join(__dirname, "../src"));
    expect(offenders).toEqual([]);
  });
});
