import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LEAD_FIELDS,
  isLeadField,
  mappingRowsToObject,
  mappingObjectToRows,
  newMappingRow,
  hasContactMapping,
  skipReasonMessage,
  validateIngestionConfig,
  isConfigValid,
  buildSftpConfigPatch,
  extractIngestionDraft,
  runStatusLabel,
  runStatusVariant,
  runStatusIcon,
  isRunStatus,
  normaliseRun,
  normaliseRuns,
  formatDateTime,
  getIngestionRuns,
  triggerIngestion,
  type IngestionConfigDraft,
  type MappingRow,
} from "@/lib/admin/sftpIngestion";
import * as browser from "@/lib/api/browserClient";

vi.mock("@/lib/api/browserClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/api/browserClient")>();
  return { ...actual, browserFetch: vi.fn() };
});
const fetchMock = vi.mocked(browser.browserFetch);
function res(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body, clone() { return this; } } as unknown as Response;
}
beforeEach(() => fetchMock.mockReset());

function draft(over: Partial<IngestionConfigDraft> = {}): IngestionConfigDraft {
  return {
    inboundPath: "/inbound",
    filePattern: "*.csv",
    archivePath: "",
    leadSource: false,
    leadSourceLabel: "",
    mapping: [],
    ...over,
  };
}
const emailRow: MappingRow = { column: "Email Addr", field: "email" };
const mobileRow: MappingRow = { column: "Phone", field: "mobile" };
const nameRow: MappingRow = { column: "Full Name", field: "name" };

describe("lead field guards + mapping transforms", () => {
  it("isLeadField accepts the fixed set and rejects others", () => {
    for (const f of LEAD_FIELDS) expect(isLeadField(f)).toBe(true);
    expect(isLeadField("phone")).toBe(false);
    expect(isLeadField(42)).toBe(false);
  });

  it("mappingRowsToObject drops blank columns, trims, and last-dup-wins", () => {
    const obj = mappingRowsToObject([
      { column: "  Email Addr ", field: "email" },
      { column: "", field: "name" }, // dropped
      { column: "Phone", field: "mobile" },
      { column: "Phone", field: "name" }, // overrides prior Phone
    ]);
    expect(obj).toEqual({ "Email Addr": "email", Phone: "name" });
  });

  it("mappingObjectToRows inflates only valid lead fields, stamping a stable id", () => {
    const rows = mappingObjectToRows({ Email: "email", Junk: "phone", City: "city" });
    expect(rows.map(({ column, field }) => ({ column, field }))).toEqual([
      { column: "Email", field: "email" },
      { column: "City", field: "city" },
    ]);
    // each row carries a stable, unique id for React reconciliation
    expect(rows.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(mappingObjectToRows(null)).toEqual([]);
    expect(mappingObjectToRows("nope")).toEqual([]);
  });

  it("add/remove a mapping row round-trips through the transforms", () => {
    let rows: MappingRow[] = [];
    // add
    rows = [...rows, { column: "Email Addr", field: "email" }];
    expect(mappingRowsToObject(rows)).toEqual({ "Email Addr": "email" });
    // add a second
    rows = [...rows, { column: "Phone", field: "mobile" }];
    expect(Object.keys(mappingRowsToObject(rows))).toHaveLength(2);
    // remove the first
    rows = rows.filter((_, i) => i !== 0);
    expect(mappingRowsToObject(rows)).toEqual({ Phone: "mobile" });
  });

  it("hasContactMapping requires a non-blank email or mobile column", () => {
    expect(hasContactMapping([nameRow])).toBe(false);
    expect(hasContactMapping([{ column: "  ", field: "email" }])).toBe(false);
    expect(hasContactMapping([emailRow])).toBe(true);
    expect(hasContactMapping([mobileRow])).toBe(true);
  });

  it("newMappingRow stamps a unique id and defaults field to name/empty column", () => {
    const a = newMappingRow();
    const b = newMappingRow("mobile", "Phone");
    expect(a.field).toBe("name");
    expect(a.column).toBe("");
    expect(b).toMatchObject({ field: "mobile", column: "Phone" });
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });
});

describe("validateIngestionConfig", () => {
  it("passes when leadSource is off regardless of label/mapping", () => {
    expect(validateIngestionConfig(draft({ leadSource: false }))).toEqual({});
    expect(isConfigValid(draft({ leadSource: false }))).toBe(true);
  });

  it("flags a missing label when leadSource is on", () => {
    const errs = validateIngestionConfig(draft({ leadSource: true, leadSourceLabel: "  ", mapping: [emailRow] }));
    expect(errs.leadSourceLabel).toBeTruthy();
    expect(errs.mapping).toBeUndefined();
  });

  it("flags a missing email-or-mobile mapping when leadSource is on", () => {
    const errs = validateIngestionConfig(draft({ leadSource: true, leadSourceLabel: "Partner X", mapping: [nameRow] }));
    expect(errs.mapping).toBeTruthy();
    expect(errs.leadSourceLabel).toBeUndefined();
    expect(isConfigValid(draft({ leadSource: true, leadSourceLabel: "Partner X", mapping: [nameRow] }))).toBe(false);
  });

  it("passes with a label + an email mapping (or a mobile mapping)", () => {
    expect(validateIngestionConfig(draft({ leadSource: true, leadSourceLabel: "P", mapping: [emailRow] }))).toEqual({});
    expect(validateIngestionConfig(draft({ leadSource: true, leadSourceLabel: "P", mapping: [mobileRow] }))).toEqual({});
  });
});

describe("buildSftpConfigPatch / extractIngestionDraft", () => {
  it("builds the persisted patch, omitting an empty archive and label when off", () => {
    const patch = buildSftpConfigPatch(draft({ inboundPath: " /in ", filePattern: " *.csv ", leadSource: false, mapping: [emailRow] }));
    expect(patch).toEqual({
      inboundPath: "/in",
      filePattern: "*.csv",
      leadSource: false,
      columnMapping: { "Email Addr": "email" },
    });
    expect(patch.archivePath).toBeUndefined();
    expect(patch.leadSourceLabel).toBeUndefined();
  });

  it("includes archivePath and label when set / on", () => {
    const patch = buildSftpConfigPatch(draft({ archivePath: "/arch", leadSource: true, leadSourceLabel: " Partner ", mapping: [emailRow] }));
    expect(patch.archivePath).toBe("/arch");
    expect(patch.leadSourceLabel).toBe("Partner");
  });

  it("extractIngestionDraft round-trips a stored config and tolerates junk", () => {
    const stored = { inboundPath: "/in", filePattern: "*.csv", archivePath: "/arch", leadSource: true, leadSourceLabel: "P", columnMapping: { Email: "email" } };
    const draft = extractIngestionDraft(stored);
    expect(draft).toMatchObject({
      inboundPath: "/in",
      filePattern: "*.csv",
      archivePath: "/arch",
      leadSource: true,
      leadSourceLabel: "P",
    });
    expect(draft.mapping.map(({ column, field }) => ({ column, field }))).toEqual([{ column: "Email", field: "email" }]);
    expect(typeof draft.mapping[0].id).toBe("string");
    // missing/undefined config -> safe empty draft
    expect(extractIngestionDraft(undefined)).toEqual({
      inboundPath: "", filePattern: "", archivePath: "", leadSource: false, leadSourceLabel: "", mapping: [],
    });
  });
});

describe("run status label/variant/icon", () => {
  it("maps known statuses and falls back for unknown", () => {
    expect(isRunStatus("succeeded")).toBe(true);
    expect(isRunStatus("weird")).toBe(false);
    expect(runStatusLabel("succeeded")).toBe("Succeeded");
    expect(runStatusVariant("failed")).toBe("bad");
    expect(runStatusVariant("partial")).toBe("warn");
    expect(runStatusVariant("running")).toBe("info");
    expect(runStatusIcon("succeeded")).toBe("✓");
    // unknown status: label echoes, variant/icon default (never throws)
    expect(runStatusLabel("weird")).toBe("weird");
    expect(runStatusVariant("weird")).toBe("info");
    expect(runStatusIcon("weird")).toBe("•");
    expect(runStatusLabel("")).toBe("Unknown");
  });
});

describe("normaliseRun(s)", () => {
  it("normalises a full run and coerces numeric fields", () => {
    const r = normaliseRun({ id: "run1", status: "partial", filesSeen: 3, rowsTotal: 100, rowsCreated: 90, rowsFailed: 10, error: "10 bad rows", startedAt: "2026-08-05T10:00:00Z", finishedAt: "2026-08-05T10:01:00Z" });
    expect(r).toMatchObject({ id: "run1", status: "partial", filesSeen: 3, rowsCreated: 90, rowsFailed: 10, error: "10 bad rows" });
  });

  it("fills safe defaults for a junk/empty run (no NaN counts, no fake 'running')", () => {
    const r = normaliseRun({}, 2);
    expect(r.id).toBe("run-2");
    // must NOT masquerade as a healthy live sweep — empty status stays "" and
    // renders as "Unknown"/neutral via the label/variant/icon fallbacks.
    expect(r.status).toBe("");
    expect(runStatusLabel(r.status)).toBe("Unknown");
    expect(runStatusVariant(r.status)).toBe("info");
    expect(r.filesSeen).toBe(0);
    expect(r.rowsCreated).toBe(0);
    expect(r.error).toBeNull();
    expect(r.startedAt).toBeNull();
  });

  it("tolerates bare array and {runs|items|data} wrappers", () => {
    const one = [{ id: "a", status: "succeeded" }];
    expect(normaliseRuns(one)).toHaveLength(1);
    expect(normaliseRuns({ runs: one })).toHaveLength(1);
    expect(normaliseRuns({ items: one })).toHaveLength(1);
    expect(normaliseRuns({ data: one })).toHaveLength(1);
    expect(normaliseRuns(null)).toEqual([]);
    expect(normaliseRuns({ nope: one })).toEqual([]);
  });
});

describe("formatDateTime", () => {
  it("returns an em-dash for missing/invalid timestamps (never fabricates a time)", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });
  it("formats a valid ISO timestamp", () => {
    expect(formatDateTime("2026-08-05T10:00:00Z")).not.toBe("—");
  });
});

describe("getIngestionRuns loader", () => {
  it("returns source 'api' + normalised runs on success", async () => {
    fetchMock.mockResolvedValue(res({ runs: [{ id: "r1", status: "succeeded", rowsCreated: 5 }] }));
    const out = await getIngestionRuns("sftp", "prod");
    expect(out.source).toBe("api");
    expect(out.data).toHaveLength(1);
    expect(out.data[0].rowsCreated).toBe(5);
    expect(fetchMock).toHaveBeenCalledWith("v1/admin/integrations/sftp/prod/ingestions");
  });

  it("returns source 'error' + EMPTY data on a non-ok response (never fabricates rows)", async () => {
    fetchMock.mockResolvedValue(res({ message: "boom" }, 500));
    const out = await getIngestionRuns("sftp", "prod");
    expect(out.source).toBe("error");
    expect(out.data).toEqual([]);
  });

  it("returns source 'error' when the fetch itself throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const out = await getIngestionRuns("sftp", "prod");
    expect(out.source).toBe("error");
    expect(out.data).toEqual([]);
  });
});

describe("triggerIngestion", () => {
  it("POSTs to the ingest endpoint and reports ok", async () => {
    fetchMock.mockResolvedValue(res({ accepted: true }, 202));
    const out = await triggerIngestion("sftp", "staging");
    expect(out.ok).toBe(true);
    expect(out.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("v1/admin/integrations/sftp/staging/ingest", { method: "POST", body: "{}" });
  });

  it("surfaces the server error on a non-ok response", async () => {
    fetchMock.mockResolvedValue(res({ code: "DISABLED", message: "connector off" }, 409));
    const out = await triggerIngestion("sftp", "prod");
    expect(out.ok).toBe(false);
    expect(out.error).toContain("connector off");
  });

  it("reports an error when the fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const out = await triggerIngestion("sftp", "prod");
    expect(out.ok).toBe(false);
    expect(out.error).toBe("timeout");
  });

  it("surfaces the BE 409 { status:'skipped', reason } as an actionable message (not 'API_ERROR: 409')", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: "skipped", reason: "connector_not_enabled" }, 409));
    const out = await triggerIngestion("sftp", "prod");
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/disabled/i);
    expect(out.error).not.toMatch(/API_ERROR/);
  });

  it("maps a secret_unavailable:<detail> 409 skip by prefix", async () => {
    fetchMock.mockResolvedValueOnce(res({ status: "skipped", reason: "secret_unavailable:no_key" }, 409));
    const out = await triggerIngestion("sftp", "prod");
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/secret is unavailable/i);
  });
});

describe("skipReasonMessage", () => {
  it("maps every known reason to a distinct actionable message", () => {
    expect(skipReasonMessage("connector_not_enabled")).toMatch(/disabled/i);
    expect(skipReasonMessage("not_a_lead_source")).toMatch(/lead source/i);
    expect(skipReasonMessage("connector_incomplete")).toMatch(/incomplete/i);
    expect(skipReasonMessage("secret_unavailable")).toMatch(/secret is unavailable/i);
    expect(skipReasonMessage("secret_unavailable:privateKey")).toMatch(/secret is unavailable/i);
  });
  it("falls back gracefully for an unknown or empty reason", () => {
    expect(skipReasonMessage("gremlins")).toContain("gremlins");
    expect(skipReasonMessage("")).toMatch(/skipped/i);
  });
});
