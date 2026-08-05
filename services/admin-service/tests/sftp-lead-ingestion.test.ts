/**
 * SFTP lead-ingestion — engine + service tests (BRD §9 #12 / LM-005).
 *
 * The engine is exercised against an INJECTED fake SftpClientLike (no live SFTP
 * server) and a MOCKED CRM poster — the correct testing approach for a connector
 * whose only external dependency is a remote SFTP endpoint. Service-level tests
 * hit the live civitas_admin DB (RLS) to prove run bookkeeping, the idempotency
 * ledger and dead-letter routing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHash } from "node:crypto";

// Encryption key must be set BEFORE importing app/db so configKey() sees it.
process.env.CONFIG_ENC_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { sqlClient } = await import("../src/shared/db.js");
const { sealSecrets } = await import("../src/modules/integration-settings/domain.js");
const {
  sweepConnector,
  globToRegExp,
} = await import("../src/modules/lead-ingestion/sftp-ingest.js");
const parse = await import("../src/modules/lead-ingestion/parse.js");
const { runIngestion } = await import("../src/modules/lead-ingestion/service.js");

import type { SftpClientLike, SftpClientFactory, SftpIngestConfig } from "../src/modules/lead-ingestion/sftp-ingest.js";
import type { MappedContact } from "../src/modules/lead-ingestion/parse.js";

// ── fake SFTP client ─────────────────────────────────────────────────────────
interface FakeFile { name: string; content: Buffer; size?: number; }
interface FakeOpts { connectThrows?: boolean; listThrows?: boolean; }

function makeFactory(files: FakeFile[], opts: FakeOpts = {}): { factory: SftpClientFactory; renames: Array<[string, string]>; connected: boolean[]; gets: string[]; factoryCalls: number[] } {
  const renames: Array<[string, string]> = [];
  const connected: boolean[] = [];
  const gets: string[] = [];
  const factoryCalls: number[] = [];
  const factory: SftpClientFactory = async () => {
    factoryCalls.push(1);
    const client: SftpClientLike = {
      async connect() { if (opts.connectThrows) throw new Error("ECONNREFUSED sftp.example.gov.in:22"); connected.push(true); return {}; },
      async list() {
        if (opts.listThrows) throw new Error("list failed: permission denied");
        return files.map((f) => ({ name: f.name, size: f.size ?? f.content.length, type: "-" }));
      },
      async get(remotePath: string) {
        gets.push(remotePath);
        const base = remotePath.split("/").pop();
        const f = files.find((x) => x.name === base);
        if (!f) throw new Error("no such file: " + remotePath);
        return f.content;
      },
      async mkdir() { return {}; },
      async rename(from: string, to: string) { renames.push([from, to]); return {}; },
      async end() { return {}; },
    };
    return client;
  };
  return { factory, renames, connected, gets, factoryCalls };
}

const CSV_HEADER = "Full Name,Email,Mobile,Company,City";
const MAPPING: SftpIngestConfig["columnMapping"] = { "Full Name": "name", Email: "email", Mobile: "mobile", Company: "company", City: "city" };

function baseCfg(over: Partial<SftpIngestConfig> = {}): SftpIngestConfig {
  return {
    host: "203.0.113.10", port: 22, username: "leads",
    inboundPath: "/inbound", filePattern: "*.csv",
    archivePath: "/archive", leadSourceLabel: "SFTP Partner X",
    columnMapping: MAPPING, ...over,
  };
}

const SECRETS = { privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----" };

describe("parse — CSV + mapping + validation", () => {
  it("parses quoted CSV with embedded commas and validates rows", () => {
    const csv = [CSV_HEADER,
      'Asha Rao,asha@example.com,9876543210,"Rao, Sons & Co",Pune',
      'Bad Row Missing Name,,9812345678,Acme,Delhi'.replace("Bad Row Missing Name", ""), // no name → bad
    ].join("\n");
    const rows = parse.parseCsv(csv);
    expect(rows.length).toBe(3);
    const { contacts, bad } = parse.mapAndValidate(rows, MAPPING);
    expect(contacts.length).toBe(1);
    expect(contacts[0]).toMatchObject({ name: "Asha Rao", email: "asha@example.com", phone: "9876543210", company: "Rao, Sons & Co", city: "Pune" });
    expect(bad.length).toBe(1);
    expect(bad[0]!.reason).toBe("missing_name");
  });

  it("flags an invalid Indian mobile (DQ-003) as a bad row", () => {
    const csv = [CSV_HEADER, "Ravi,ravi@example.com,12345,Acme,Delhi"].join("\n");
    const { contacts, bad } = parse.mapAndValidate(parse.parseCsv(csv), MAPPING);
    expect(contacts.length).toBe(0);
    expect(bad[0]!.reason).toBe("invalid_mobile");
  });

  it("globToRegExp matches *.csv but not *.xlsx", () => {
    expect(globToRegExp("*.csv").test("leads-2026.csv")).toBe(true);
    expect(globToRegExp("*.csv").test("leads.xlsx")).toBe(false);
    expect(globToRegExp("*.xlsx").test("leads.xlsx")).toBe(true);
  });
});

describe("sweepConnector — engine (injected fake client)", () => {
  it("ingests a CSV with N valid + 1 malformed row; posts N, counts the bad row, archives", async () => {
    const csv = [CSV_HEADER,
      "Asha Rao,asha@example.com,9876543210,Rao Sons,Pune",
      "Vikram S,vikram@example.com,9812345678,Vik Ltd,Delhi",
      "Meera,meera@example.com,9900112233,Meera Co,Surat",
      ",noname@example.com,9911002233,Ghost,Nowhere", // missing name → bad
    ].join("\n");
    const { factory, renames } = makeFactory([{ name: "leads-1.csv", content: Buffer.from(csv) }]);
    const posted: MappedContact[][] = [];
    const res = await sweepConnector(baseCfg(), SECRETS, {
      clientFactory: factory,
      crmPost: async (c) => { posted.push(c); return c.length; },
      isIngested: async () => false,
      markIngested: async () => {},
    });
    expect(posted.length).toBe(1);
    expect(posted[0]!.length).toBe(3);
    expect(res.rowsTotal).toBe(4);
    expect(res.rowsCreated).toBe(3);
    expect(res.rowsFailed).toBe(1);
    expect(res.filesIngested).toBe(1);
    expect(res.fileErrors.length).toBe(0);
    // archived to /archive/leads-1.csv
    expect(renames).toEqual([["/inbound/leads-1.csv", "/archive/leads-1.csv"]]);
  });

  it("renames processed file with .done when no archivePath is set", async () => {
    const csv = [CSV_HEADER, "A,a@example.com,9876543210,Co,Pune"].join("\n");
    const { factory, renames } = makeFactory([{ name: "x.csv", content: Buffer.from(csv) }]);
    await sweepConnector(baseCfg({ archivePath: undefined }), SECRETS, {
      clientFactory: factory, crmPost: async (c) => c.length, isIngested: async () => false, markIngested: async () => {},
    });
    expect(renames).toEqual([["/inbound/x.csv", "/inbound/x.csv.done"]]);
  });

  it("SKIPS an already-ingested file (same name+checksum) — no duplicate import", async () => {
    const csv = [CSV_HEADER, "A,a@example.com,9876543210,Co,Pune"].join("\n");
    const { factory, renames } = makeFactory([{ name: "dup.csv", content: Buffer.from(csv) }]);
    let posts = 0;
    const res = await sweepConnector(baseCfg(), SECRETS, {
      clientFactory: factory,
      crmPost: async (c) => { posts++; return c.length; },
      isIngested: async () => true, // already in the ledger
      markIngested: async () => { throw new Error("must not mark a skipped file"); },
    });
    expect(posts).toBe(0);
    expect(res.filesSkipped).toBe(1);
    expect(res.filesIngested).toBe(0);
    expect(renames.length).toBe(0);
  });

  it("parses an XLSX file via exceljs", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("leads");
    ws.addRow(["Full Name", "Email", "Mobile", "Company", "City"]);
    ws.addRow(["Xl User", "xl@example.com", "9876500000", "Xl Co", "Nagpur"]);
    const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());
    const { factory } = makeFactory([{ name: "leads.xlsx", content: xlsxBuf }]);
    const posted: MappedContact[][] = [];
    const res = await sweepConnector(baseCfg({ filePattern: "*.xlsx" }), SECRETS, {
      clientFactory: factory, crmPost: async (c) => { posted.push(c); return c.length; }, isIngested: async () => false, markIngested: async () => {},
    });
    expect(res.filesIngested).toBe(1);
    expect(posted[0]![0]).toMatchObject({ name: "Xl User", email: "xl@example.com", phone: "9876500000" });
  });

  it("isolates a per-file parse error into fileErrors without aborting the sweep", async () => {
    const good = [CSV_HEADER, "Ok,ok@example.com,9876543210,Co,Pune"].join("\n");
    // second 'file' is an xlsx name but corrupt bytes → exceljs throws
    const { factory } = makeFactory([
      { name: "good.csv", content: Buffer.from(good) },
      { name: "broken.xlsx", content: Buffer.from("not a real xlsx") },
    ], {});
    const res = await sweepConnector(baseCfg({ filePattern: "*" }), SECRETS, {
      clientFactory: factory, crmPost: async (c) => c.length, isIngested: async () => false, markIngested: async () => {},
    });
    expect(res.filesIngested).toBe(1);
    expect(res.fileErrors.length).toBe(1);
    expect(res.fileErrors[0]!.filename).toBe("broken.xlsx");
  });

  it("THROWS on a connect failure (caller marks run failed)", async () => {
    const { factory } = makeFactory([], { connectThrows: true });
    await expect(sweepConnector(baseCfg(), SECRETS, {
      clientFactory: factory, crmPost: async (c) => c.length, isIngested: async () => false, markIngested: async () => {},
    })).rejects.toThrow(/ECONNREFUSED/);
  });

  it("SSRF: a blocked (link-local/metadata) host THROWS before any client is created — never dials", async () => {
    const { factory, connected, factoryCalls } = makeFactory([{ name: "x.csv", content: Buffer.from("a") }]);
    await expect(sweepConnector(baseCfg({ host: "169.254.169.254" }), SECRETS, {
      clientFactory: factory, crmPost: async (c) => c.length, isIngested: async () => false, markIngested: async () => {},
    })).rejects.toThrow(/blocked address/);
    // The guard runs before clientFactory() → no client, no connect, no socket.
    expect(factoryCalls.length).toBe(0);
    expect(connected.length).toBe(0);
  });

  it("SSRF: a private RFC1918 host is also blocked", async () => {
    const { factory } = makeFactory([]);
    await expect(sweepConnector(baseCfg({ host: "10.0.0.5" }), SECRETS, {
      clientFactory: factory, crmPost: async (c) => c.length, isIngested: async () => false, markIngested: async () => {},
    })).rejects.toThrow(/blocked address/);
  });

  it("skips an OVERSIZED file as a per-file error WITHOUT downloading it; keeps sweeping", async () => {
    const good = [CSV_HEADER, "Ok,ok@example.com,9876543210,Co,Pune"].join("\n");
    const huge = 26 * 1024 * 1024; // > 25 MB default cap
    const { factory, gets } = makeFactory([
      { name: "huge.csv", content: Buffer.from("tiny"), size: huge }, // list reports 26MB
      { name: "good.csv", content: Buffer.from(good) },
    ]);
    let posts = 0;
    const res = await sweepConnector(baseCfg({ filePattern: "*.csv" }), SECRETS, {
      clientFactory: factory, crmPost: async (c) => { posts++; return c.length; }, isIngested: async () => false, markIngested: async () => {},
    });
    // The oversized file was never downloaded, but the good one still ingested.
    expect(gets).toEqual(["/inbound/good.csv"]);
    expect(res.filesIngested).toBe(1);
    expect(res.fileErrors.length).toBe(1);
    expect(res.fileErrors[0]!.filename).toBe("huge.csv");
    expect(res.fileErrors[0]!.error).toMatch(/exceeds max size/);
    expect(posts).toBe(1);
  });
});

// ── service-level tests against the live civitas_admin DB (RLS) ──────────────
const TENANT = randomUUID();

async function insertConnector(tenantId: string, env: string, config: Record<string, unknown>): Promise<void> {
  const { ciphertext } = sealSecrets(SECRETS);
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await sql`
      INSERT INTO integration_settings.integration_settings
        (tenant_id, provider, env_scope, enabled, endpoint_url, config, secret_ciphertext, secret_last4, status, version, created_by, updated_by)
      VALUES (${tenantId}, 'sftp', ${env}, true, '', ${sql.json(config)}, ${ciphertext}, '9', 'connected', 1,
              '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000aa')
    `;
  });
}

async function runRows(tenantId: string): Promise<Array<Record<string, unknown>>> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return sql`SELECT * FROM lead_ingestion.sftp_ingestion_runs WHERE tenant_id = ${tenantId} ORDER BY started_at DESC` as unknown as Array<Record<string, unknown>>;
  }) as unknown as Array<Record<string, unknown>>;
}
async function ledgerRows(tenantId: string): Promise<Array<Record<string, unknown>>> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return sql`SELECT * FROM lead_ingestion.sftp_ingested_files WHERE tenant_id = ${tenantId}` as unknown as Array<Record<string, unknown>>;
  }) as unknown as Array<Record<string, unknown>>;
}
async function dlqRows(tenantId: string): Promise<Array<Record<string, unknown>>> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return sql`SELECT * FROM integration_ops.dead_letter WHERE tenant_id = ${tenantId}` as unknown as Array<Record<string, unknown>>;
  }) as unknown as Array<Record<string, unknown>>;
}

const connCfg = {
  host: "203.0.113.10", port: 22, username: "leads",
  inboundPath: "/inbound", filePattern: "*.csv", archivePath: "/archive",
  leadSource: true, leadSourceLabel: "SFTP Partner X", columnMapping: MAPPING,
};

describe("runIngestion — service against live DB (RLS)", () => {
  beforeAll(async () => { await insertConnector(TENANT, "dev", connCfg); });
  afterAll(async () => {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`DELETE FROM lead_ingestion.sftp_ingested_files WHERE tenant_id = ${TENANT}`;
      await sql`DELETE FROM lead_ingestion.sftp_ingestion_runs WHERE tenant_id = ${TENANT}`;
      await sql`DELETE FROM integration_ops.dead_letter WHERE tenant_id = ${TENANT}`;
      await sql`DELETE FROM integration_settings.integration_settings WHERE tenant_id = ${TENANT}`;
    });
  });

  it("persists a succeeded run + idempotency ledger; a re-run SKIPS the file", async () => {
    const csv = [CSV_HEADER,
      "Asha Rao,asha@example.com,9876543210,Rao Sons,Pune",
      ",bad@example.com,9812345678,Ghost,Nowhere", // bad row
    ].join("\n");
    const { factory } = makeFactory([{ name: "run1.csv", content: Buffer.from(csv) }]);
    const posted: MappedContact[][] = [];
    const out1 = await runIngestion(TENANT, "dev", { clientFactory: factory, crmPost: async (c) => { posted.push(c); return c.length; } });
    expect(out1.status).toBe("succeeded");
    expect(out1.summary!.rowsCreated).toBe(1);
    expect(out1.summary!.rowsFailed).toBe(1);
    expect(posted[0]!.length).toBe(1);

    const runs = await runRows(TENANT);
    expect(runs.length).toBe(1);
    expect(runs[0]!.status).toBe("succeeded");
    expect(Number(runs[0]!.rows_created)).toBe(1);
    expect(Number(runs[0]!.rows_failed)).toBe(1);
    const ledger = await ledgerRows(TENANT);
    expect(ledger.length).toBe(1);
    expect(ledger[0]!.filename).toBe("run1.csv");

    // Re-run the SAME file (same name+content) → idempotent skip, no new import.
    const { factory: f2 } = makeFactory([{ name: "run1.csv", content: Buffer.from(csv) }]);
    let posts2 = 0;
    const out2 = await runIngestion(TENANT, "dev", { clientFactory: f2, crmPost: async (c) => { posts2++; return c.length; } });
    expect(out2.status).toBe("succeeded");
    expect(out2.summary!.filesSkipped).toBe(1);
    expect(posts2).toBe(0);
    expect((await ledgerRows(TENANT)).length).toBe(1); // no new ledger row
  });

  it("a connect failure → run status=failed + dead-letter written, no throw", async () => {
    const { factory } = makeFactory([], { connectThrows: true });
    const out = await runIngestion(TENANT, "dev", { clientFactory: factory, crmPost: async (c) => c.length });
    expect(out.status).toBe("failed");
    const runs = await runRows(TENANT);
    expect(runs.some((r) => r.status === "failed")).toBe(true);
    const dlq = await dlqRows(TENANT);
    expect(dlq.length).toBeGreaterThanOrEqual(1);
    expect(dlq[0]!.topic).toBe("admin.sftp_lead_ingestion.file");
  });

  it("skips when the connector is not a lead source / not enabled", async () => {
    const other = randomUUID();
    await insertConnector(other, "dev", { ...connCfg, leadSource: false });
    const { factory } = makeFactory([]);
    const out = await runIngestion(other, "dev", { clientFactory: factory, crmPost: async (c) => c.length });
    expect(out.status).toBe("skipped");
    expect(out.reason).toBe("not_a_lead_source");
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${other}, true)`;
      await sql`DELETE FROM integration_settings.integration_settings WHERE tenant_id = ${other}`;
    });
  });
});

describe("list_sftp_lead_source_tenants — SECURITY DEFINER is REVOKED from PUBLIC", () => {
  it("has no PUBLIC execute grant; admin_svc is granted", async () => {
    const rows = (await sqlClient`
      SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'list_sftp_lead_source_tenants'
    `) as unknown as Array<{ acl: string }>;
    expect(rows.length).toBe(1);
    const acl = rows[0]!.acl;
    // A PUBLIC grant shows as an entry with an EMPTY grantee before '='.
    expect(/(^|,)=/.test(acl)).toBe(false);
    expect(acl).toContain("admin_svc=X");
  });
});

// ── crm-client (injected fetch) ──────────────────────────────────────────────
const { makeCrmPoster } = await import("../src/modules/lead-ingestion/crm-client.js");

describe("crm-client — makeCrmPoster", () => {
  it("POSTs to the internal seam with attribution headers + returns the count", async () => {
    const calls: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = [];
    const fetchFn = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, init }); return { ok: true, status: 202, text: async () => "" };
    };
    const post = makeCrmPoster("tid-1", "SFTP Src", "corr-1", { baseUrl: "http://crm.local/", secret: "S3", fetchFn });
    const n = await post([{ name: "A" }, { name: "B" }]);
    expect(n).toBe(2);
    expect(calls[0]!.url).toBe("http://crm.local/v1/crm/contacts/bulk/import/internal");
    expect(calls[0]!.init.headers["x-internal"]).toBe("1");
    expect(calls[0]!.init.headers["x-service-secret"]).toBe("S3");
    expect(calls[0]!.init.headers["x-tenant-id"]).toBe("tid-1");
    const body = JSON.parse(calls[0]!.init.body);
    expect(body).toMatchObject({ tenantId: "tid-1", source: "SFTP Src" });
    expect(body.contacts.length).toBe(2);
  });

  it("returns 0 for an empty batch without calling fetch", async () => {
    let called = false;
    const post = makeCrmPoster("t", "s", "c", { fetchFn: async () => { called = true; return { ok: true, status: 202, text: async () => "" }; } });
    expect(await post([])).toBe(0);
    expect(called).toBe(false);
  });

  it("throws on a non-2xx response", async () => {
    const post = makeCrmPoster("t", "s", "c", { fetchFn: async () => ({ ok: false, status: 500, text: async () => "boom" }) });
    await expect(post([{ name: "A" }])).rejects.toThrow(/HTTP 500/);
  });
});

// ── operator routes (admin-gated) ────────────────────────────────────────────
const { buildApp } = await import("../src/app.js");
const { signToken } = await import("@civitasone/auth");
import type { FastifyInstance } from "fastify";

const JWT = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const RT = randomUUID();
function rtToken(roles: string[] = ["tenant_admin"], tenantId = RT): string {
  return signToken({ sub: "aaaaaaaa-0000-4000-8000-00000000000a", tid: tenantId, roles, sid: "s" }, JWT, 3600);
}
function rtAuth(roles?: string[], tenantId?: string) { return { authorization: `Bearer ${rtToken(roles, tenantId)}` }; }

describe("lead-ingestion operator routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
    // Seed one run row so GET /ingestions has something to serialize.
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${RT}, true)`;
      await sql`INSERT INTO lead_ingestion.sftp_ingestion_runs (tenant_id, provider, env, status, files_seen, rows_total, rows_created, rows_failed)
                VALUES (${RT}, 'sftp', 'dev', 'succeeded', 1, 5, 4, 1)`;
    });
  });
  afterAll(async () => {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${RT}, true)`;
      await sql`DELETE FROM lead_ingestion.sftp_ingestion_runs WHERE tenant_id = ${RT}`;
    });
    await app.close();
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/integrations/sftp/dev/ingestions" });
    expect(res.statusCode).toBe(401);
  });
  it("403 for a non-admin role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/integrations/sftp/dev/ingestions", headers: rtAuth(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
  it("400 for a non-sftp provider", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/admin/integrations/ocr/dev/ingest", headers: rtAuth() });
    expect(res.statusCode).toBe(400);
  });
  it("409 skipped when no connector is configured", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/admin/integrations/sftp/dev/ingest", headers: rtAuth() });
    expect(res.statusCode).toBe(409);
    expect(res.json().status).toBe("skipped");
  });
  it("GET /ingestions lists recent runs with counts + status", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/integrations/sftp/dev/ingestions", headers: rtAuth() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ status: string; rowsCreated: number; env: string }>;
    expect(data.length).toBe(1);
    expect(data[0]).toMatchObject({ status: "succeeded", rowsCreated: 4, rowsFailed: 1, env: "dev" });
  });
});

// ── scheduler ────────────────────────────────────────────────────────────────
const { runIngestionCycle, startSftpLeadIngestionScheduler } = await import("../src/modules/lead-ingestion/scheduler.js");

describe("scheduler", () => {
  it("runIngestionCycle drives the (injected) runner for each discovered lead-source tenant", async () => {
    const ST = randomUUID();
    await insertConnector(ST, "dev", connCfg);
    try {
      const seen: Array<[string, string]> = [];
      const n = await runIngestionCycle(async (t, e) => { seen.push([t, e]); return { status: "succeeded" as const }; });
      expect(seen.some(([t]) => t === ST)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
    } finally {
      await sqlClient.begin(async (sql) => {
        await sql`SELECT set_config('app.tenant_id', ${ST}, true)`;
        await sql`DELETE FROM integration_settings.integration_settings WHERE tenant_id = ${ST}`;
      });
    }
  });

  it("startSftpLeadIngestionScheduler returns a clearable, overlap-guarded timer", () => {
    const timer = startSftpLeadIngestionScheduler(1_000_000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });
});
