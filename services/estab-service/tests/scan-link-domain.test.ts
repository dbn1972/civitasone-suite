import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fileAcceptsDocuments, scoreLookup, rankCandidates, escapeLike, tokenise, LOOKUP_MAX, FUZZY_CEILING,
} from "../src/modules/scan-link/domain.js";

const SRC = join(__dirname, "../src/modules/scan-link");

describe("scan-link domain: file states", () => {
  it("accepts draft/active, rejects closed/archived", () => {
    expect(fileAcceptsDocuments("draft")).toBe(true);
    expect(fileAcceptsDocuments("active")).toBe(true);
    expect(fileAcceptsDocuments("closed")).toBe(false);
    expect(fileAcceptsDocuments("archived")).toBe(false);
    expect(fileAcceptsDocuments("")).toBe(false);
  });
});

describe("scan-link domain: lookup scoring", () => {
  const f = { fileNo: "EST/2026/00042", subject: "Sanction of road repair works in ward 7" };
  it("exact file number (case/space-insensitive) is 1.0", () => {
    expect(scoreLookup(f, { fileNo: "EST/2026/00042" })).toBe(1);
    expect(scoreLookup(f, { fileNo: " est/2026/ 00042 " })).toBe(1);
  });
  it("partial file number is 0.7, never exact", () => {
    expect(scoreLookup(f, { fileNo: "2026/00042" })).toBe(0.7);
  });
  it("too-short partial file numbers do not match", () => {
    expect(scoreLookup(f, { fileNo: "42" })).toBe(0);
  });
  it("subject overlap is fuzzy: below 1 and capped", () => {
    const s = scoreLookup(f, { subject: "road repair works ward" });
    expect(s).toBeGreaterThan(0.2);
    expect(s).toBeLessThanOrEqual(FUZZY_CEILING);
    expect(s).toBeLessThan(1);
  });
  it("identical subject still stays below exact-match confidence", () => {
    expect(scoreLookup(f, { subject: f.subject })).toBeLessThan(1);
  });
  it("unrelated subject scores 0", () => {
    expect(scoreLookup(f, { subject: "annual cricket tournament" })).toBe(0);
  });
  it("exact file number wins over a poor subject", () => {
    expect(scoreLookup(f, { fileNo: "EST/2026/00042", subject: "cricket" })).toBe(1);
  });
  it("tokenises Devanagari and drops short tokens", () => {
    expect(tokenise("सड़क मरम्मत of a")).toEqual(expect.arrayContaining(["मरम्मत"]));
    expect(tokenise("of a to")).toEqual([]);
  });
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });
});

describe("scan-link domain: ranking", () => {
  it("orders exact first, caps at LOOKUP_MAX, labels non-accepting states", () => {
    const rows = [
      { id: "11111111-1111-4111-8111-111111111111", fileNo: "X/1", subject: "road repair works", status: "closed" },
      { id: "22222222-2222-4222-8222-222222222222", fileNo: "EST/9", subject: "road repair", status: "active" },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`, fileNo: `Z/${i}`, subject: "road repair works", status: "active",
      })),
    ];
    const out = rankCandidates(rows, { fileNo: "EST/9", subject: "road repair works" });
    expect(out).toHaveLength(LOOKUP_MAX);
    expect(out[0]).toMatchObject({ targetId: "22222222-2222-4222-8222-222222222222", confidence: 1, target: "eoffice_file" });
    expect(out.slice(1).every((c) => c.confidence < 1)).toBe(true);
    const closed = rankCandidates([rows[0]!], { subject: "road repair works" });
    expect(closed[0]?.label).toMatch(/\[closed\]$/);
  });
});

describe("scan-link module: structural guards", () => {
  it("routes never write the DB (CQRS: reads only)", () => {
    const routes = readFileSync(join(SRC, "routes.ts"), "utf8");
    expect(routes).not.toMatch(/db\.transaction|\.insert\(|\.update\(|\.delete\(/);
  });
  it("migration 0047 forces RLS with literal statements and a tenant_isolation policy", () => {
    const sql = readFileSync(join(__dirname, "../migrations/0047_file_scanned_documents.sql"), "utf8");
    expect(sql).toContain("ALTER TABLE files.file_scanned_documents ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE files.file_scanned_documents FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("CREATE POLICY tenant_isolation ON files.file_scanned_documents");
    expect(sql).toContain("UNIQUE (tenant_id, link_id)");
  });
  it("consumer audits with resourceType file and runs everything in one db.transaction", () => {
    const c = readFileSync(join(SRC, "consumer.ts"), "utf8");
    expect(c).toContain('resourceType: "file"');
    expect(c).toContain("markProcessed");
    expect(c.match(/db\.transaction/g)?.length).toBe(2);
  });
});
