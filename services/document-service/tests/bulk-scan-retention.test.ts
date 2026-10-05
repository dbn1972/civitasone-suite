/** Retention sweeper (real DB, fake object store, per-tenant fake discovery). */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { LINK_TOPICS } from "@civitasone/scan-link";
import { randomUUID } from "node:crypto";
import { sqlClient } from "../src/shared/db.js";
import { setPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";
import { sweepRetention, storageKeysOf, type RetentionDiscovery } from "../src/modules/bulk-scan/retention.js";
import { batchFiles, fileEvents, links } from "../src/modules/bulk-scan/schema.js";
import { files } from "../src/modules/files/schema.js";
import { keys } from "../src/modules/bulk-scan/keys.js";
import { newTenant, tenantTx, memoryStore, putSettings, send, USER2 } from "./bulk-scan-helpers.js";
import { useFiling, seedFiled, seedFile, getFileRow, outboxOf, auditsOf, newInlineAll } from "./bulk-scan-review-helpers.js";
import { vi } from "vitest";
import type { FileState } from "../src/modules/bulk-scan/state.js";

const store = memoryStore();
let now = new Date("2026-10-04T10:00:00Z");
const discovery = (tenants: string[]): RetentionDiscovery => ({ tenants: async () => tenants });

beforeAll(() => { setPorts({ store, now: () => now }); useFiling(); });
afterEach(() => { store.objects.clear(); store.deleted.length = 0; now = new Date("2026-10-04T10:00:00Z"); });
afterAll(async () => { resetPorts(); await sqlClient.end(); });

const docOf = async (t: string, id: string) => (await tenantTx(t, (tx) => tx.select().from(files).where(eq(files.id, id))))[0];

describe("retention sweeper", () => {
  it("deletes original + all derivatives + page images, soft-deletes the document, removes it from search, audits, records file_events", async () => {
    const t = newTenant();
    await putSettings(t, { retentionDaysByType: { bill_voucher: 30 } });
    const d = await seedFiled(store, t);                                   // filed 2026-09-01 -> 33 days old
    const f0 = await getFileRow(t, d.fileId);
    const objectKeys = storageKeysOf(f0!);
    expect(objectKeys).toHaveLength(5);                                    // original, text, pdf, json, page 1
    for (const k of objectKeys) expect(store.objects.has(k), k).toBe(true);

    const r = await sweepRetention({ discovery: discovery([t]) });
    expect(r).toMatchObject({ purged: 1, failed: 0, due: 1 });

    for (const k of objectKeys) expect(store.objects.has(k), "still in store: " + k).toBe(false);
    const f = await getFileRow(t, d.fileId);
    expect(f?.retentionDeletedAt).toBeTruthy();
    expect(f).toMatchObject({ state: "filed", searchText: null, textMaskedKey: null, searchablePdfKey: null, structuredJsonKey: null, extractedFields: null, pageImageCount: 0 });
    const doc = await docOf(t, d.documentId);
    expect(doc?.status).toBe("deleted");
    expect(doc?.deletedAt).toBeTruthy();
    const ev = await tenantTx(t, (tx) => tx.select().from(fileEvents).where(and(eq(fileEvents.fileId, d.fileId), eq(fileEvents.reason, "RETENTION_DELETED"))));
    expect(ev).toHaveLength(1);
    const audit = await auditsOf(t, "retention_deleted");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.payload).toMatchObject({ resourceId: d.fileId, details: { documentId: d.documentId, docType: "bill_voucher", retentionDays: 30 } });
    expect(JSON.stringify(audit[0]?.payload)).not.toMatch(/XXXX|V-100/);
    const idx = await outboxOf(t, "search.index.update");
    expect(idx.filter((x) => x.payload.action === "delete")).toHaveLength(1);
    expect(idx.find((x) => x.payload.action === "delete")?.payload).toMatchObject({ id: d.documentId });
    expect(await outboxOf(t, "document.bulkscan.file.retention_deleted")).toHaveLength(1);
  });

  it("is idempotent: a second sweep (or a concurrent one) purges nothing more", async () => {
    const t = newTenant();
    await putSettings(t, { retentionDaysByType: { bill_voucher: 30 } });
    await seedFiled(store, t);
    const [a, b] = await Promise.all([sweepRetention({ discovery: discovery([t]) }), sweepRetention({ discovery: discovery([t]) })]);
    expect(a.purged + b.purged).toBe(1);
    expect((await sweepRetention({ discovery: discovery([t]) })).purged).toBe(0);
    expect(await auditsOf(t, "retention_deleted")).toHaveLength(1);
  });

  it("dry run reports the candidates and changes nothing", async () => {
    const t = newTenant();
    await putSettings(t, { retentionDaysByType: { bill_voucher: 30 } });
    const d = await seedFiled(store, t);
    const r = await sweepRetention({ discovery: discovery([t]), dryRun: true });
    expect(r).toMatchObject({ dryRun: true, due: 1, purged: 0 });
    expect(r.candidates).toEqual([{ tenantId: t, fileId: d.fileId, docType: "bill_voucher" }]);
    expect(store.deleted).toHaveLength(0);
    expect((await getFileRow(t, d.fileId))?.retentionDeletedAt).toBeNull();
    expect((await docOf(t, d.documentId))?.status).toBe("active");
  });

  it("respects the period per doc type: young docs, types without a policy and other tenants are untouched", async () => {
    const t = newTenant(), other = newTenant();
    await putSettings(t, { retentionDaysByType: { bill_voucher: 60, pay_slip: 30 } });        // voucher 33d < 60d: keep; pay slip 33d > 30d: purge
    const young = await seedFiled(store, t);
    const slip = await seedFiled(store, t, { docType: "pay_slip" });
    const noPolicy = await seedFiled(store, t, { docType: "letter" });
    const otherTenant = await seedFiled(store, other);                                         // other tenant has no policy
    const r = await sweepRetention({ discovery: discovery([t, other]) });
    expect(r.purged).toBe(1);
    expect((await getFileRow(t, slip.fileId))?.retentionDeletedAt).toBeTruthy();
    for (const k of [young, noPolicy]) expect((await getFileRow(t, k.fileId))?.retentionDeletedAt).toBeNull();
    expect((await getFileRow(other, otherTenant.fileId))?.retentionDeletedAt).toBeNull();
    // time passes: now the voucher is past 60 days too
    now = new Date("2026-11-10T00:00:00Z");
    expect((await sweepRetention({ discovery: discovery([t]) })).purged).toBe(1);
    expect((await getFileRow(t, young.fileId))?.retentionDeletedAt).toBeTruthy();
    expect((await getFileRow(t, noPolicy.fileId))?.retentionDeletedAt).toBeNull();
  });

  it("a storage failure leaves that document for the next sweep and does not stop the others", async () => {
    const t = newTenant();
    await putSettings(t, { retentionDaysByType: { bill_voucher: 30 } });
    const bad = await seedFiled(store, t), good = await seedFiled(store, t);
    const realDel = store.del.bind(store);
    store.del = async (key: string) => { if (key.includes(bad.fileId)) throw new Error("S3 down"); return realDel(key); };
    const r = await sweepRetention({ discovery: discovery([t]) });
    expect(r).toMatchObject({ purged: 1, failed: 1 });
    expect((await getFileRow(t, bad.fileId))?.retentionDeletedAt).toBeNull();
    expect((await docOf(t, bad.documentId))?.status).toBe("active");
    expect((await getFileRow(t, good.fileId))?.retentionDeletedAt).toBeTruthy();
    store.del = realDel;
    expect((await sweepRetention({ discovery: discovery([t]) })).purged).toBe(1);               // retried and done
  });

  it("asks the target service to drop its reference to a purged linked document", async () => {
    const t = newTenant();
    await putSettings(t, { retentionDaysByType: { bill_voucher: 30 } });
    const d = await seedFiled(store, t, { link: "hr_employee" });
    await sweepRetention({ discovery: discovery([t]) });
    const l = (await tenantTx(t, (tx) => tx.select().from(links).where(eq(links.fileId, d.fileId))))[0];
    expect(l).toMatchObject({ state: "unlink_requested", reason: "RETENTION_EXPIRED" });
    const req = await outboxOf(t, LINK_TOPICS.unlinkRequest("hrms"));
    expect(req).toHaveLength(1);
    expect(req[0]?.payload).toMatchObject({ documentId: d.documentId, reason: "RETENTION_EXPIRED" });
  });

  it("never touches files that are not filed (still in review)", async () => {
    const t = newTenant();
    await putSettings(t, { retentionDaysByType: { bill_voucher: 1 } });
    const d = await seedFiled(store, t);
    await tenantTx(t, (tx) => tx.update(batchFiles).set({ state: "needs_review", filedAt: null }).where(eq(batchFiles.id, d.fileId)).then(() => undefined));
    expect((await sweepRetention({ discovery: discovery([t]) })).due).toBe(0);
  });

  it("storageKeysOf only returns tenant-owned keys", () => {
    const t = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", f = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const ks = storageKeysOf({ id: f, tenantId: t, batchId: b, storageKey: keys.original(t, b, f), textMaskedKey: "tenants/other/bulk-scan/x", searchablePdfKey: null, structuredJsonKey: null, finalTextKey: null, pageImageCount: 2 });
    expect(ks).toEqual([keys.original(t, b, f), keys.pageImage(t, b, f, 1), keys.pageImage(t, b, f, 2)]);
  });
});

const nonFiledDiscovery = (tenants: string[]): RetentionDiscovery => ({ tenants: async () => [], nonFiledTenants: async () => tenants, unlinkPendingTenants: async () => [] });
const unlinkDiscovery = (tenants: string[]): RetentionDiscovery => ({ tenants: async () => [], unlinkPendingTenants: async () => tenants });
const OLD = new Date("2026-08-01T00:00:00Z");                 // 64 days before the fixed clock
const NON_FILED: FileState[] = ["skipped_duplicate", "skipped", "failed", "cancelled", "quarantined"];

describe("retention: canonical-hash claim", () => {
  it("a purged filed document releases canonical_for_hash so a re-scan is not skipped as a duplicate of a deleted file", async () => {
    const t = newTenant();
    await putSettings(t, { retentionDaysByType: { bill_voucher: 30 } });
    const d = await seedFiled(store, t);
    await tenantTx(t, (tx) => tx.update(batchFiles).set({ canonicalForHash: true, sha256: "a".repeat(64) }).where(eq(batchFiles.id, d.fileId)).then(() => undefined));
    await sweepRetention({ discovery: discovery([t]) });
    expect(await getFileRow(t, d.fileId)).toMatchObject({ canonicalForHash: false });
  });
});

describe("retention: NON-filed terminal files", () => {
  async function seedTerminal(t: string, state: FileState, over: Partial<typeof batchFiles.$inferInsert> = {}) {
    const s = await seedFile(store, t, "needs_review", { state, updatedAt: OLD, canonicalForHash: true, sha256: (randomUUID() + randomUUID()).replace(/-/g, "").slice(0, 64), ...over });
    const f = await getFileRow(t, s.fileId);
    if (state === "quarantined") {
      const qk = keys.quarantine(t, s.batchId, s.fileId);
      store.objects.set(qk, Buffer.from("MALWARE"));
      await tenantTx(t, (tx) => tx.update(batchFiles).set({ quarantineKey: qk }).where(eq(batchFiles.id, s.fileId)).then(() => undefined));
    }
    return { ...s, allKeys: storageKeysOf((await getFileRow(t, s.fileId))!).concat(state === "quarantined" ? [keys.quarantine(t, s.batchId, s.fileId)] : []), f };
  }

  it("deletes original + derivatives + quarantine copy of every non-filed terminal state after the default 30 days; keeps file_events; audits; clears content and the hash claim", async () => {
    const t = newTenant();
    const seeded = [];
    for (const st of NON_FILED) seeded.push({ st, ...(await seedTerminal(t, st)) });
    const young = await seedTerminal(t, "skipped", { updatedAt: new Date("2026-09-29T00:00:00Z") });     // 5 days old
    const review = await seedTerminal(t, "needs_review");                                              // not terminal: never purged
    for (const x of seeded) await tenantTx(t, (tx) => tx.insert(fileEvents).values({ id: randomUUID(), tenantId: t, fileId: x.fileId, batchId: x.batchId, toState: x.st, reason: "SEED" }).then(() => undefined));
    const eventsBefore = await tenantTx(t, (tx) => tx.select().from(fileEvents).where(eq(fileEvents.tenantId, t)));

    const r = await sweepRetention({ discovery: nonFiledDiscovery([t]) });
    expect(r.nonFiled).toEqual({ due: 5, purged: 5, failed: 0 });

    for (const x of seeded) {
      for (const k of x.allKeys) expect(store.objects.has(k), x.st + " " + k).toBe(false);
      const row = await getFileRow(t, x.fileId);
      expect(row, x.st).toMatchObject({ retentionDeletedAt: expect.any(Date), searchText: null, extractedFields: null, textMaskedKey: null, structuredJsonKey: null, searchablePdfKey: null, quarantineKey: null, pageImageCount: 0, canonicalForHash: false });
      expect(row?.state).toBe(x.st);
    }
    for (const k of young.allKeys) expect(store.objects.has(k), "young file kept").toBe(true);
    for (const k of review.allKeys) expect(store.objects.has(k), "needs_review kept").toBe(true);
    expect((await getFileRow(t, young.fileId))?.retentionDeletedAt).toBeNull();
    // file_events are kept (append-only) and gain one RETENTION_DELETED row per purged file
    const eventsAfter = await tenantTx(t, (tx) => tx.select().from(fileEvents).where(eq(fileEvents.tenantId, t)));
    expect(eventsAfter.length).toBe(eventsBefore.length + 5);
    for (const e of eventsBefore) expect(eventsAfter.some((x) => x.id === e.id)).toBe(true);
    const audits = await auditsOf(t, "non_filed_retention_deleted");
    expect(audits).toHaveLength(5);
    expect(audits[0]?.payload).toMatchObject({ resourceType: "bulk_scan_file", details: { retentionDays: 30 } });
    expect(JSON.stringify(audits.map((a) => a.payload))).not.toMatch(/XXXX|V-100|voucher/);
    // idempotent
    expect((await sweepRetention({ discovery: nonFiledDiscovery([t]) })).nonFiled).toEqual({ due: 0, purged: 0, failed: 0 });
    expect(await auditsOf(t, "non_filed_retention_deleted")).toHaveLength(5);
  });

  it("honours the tenant setting nonFiledRetentionDays and is tenant scoped", async () => {
    const a = newTenant(), b = newTenant();
    await putSettings(a, { nonFiledRetentionDays: 90 });          // 64 days old < 90: kept
    const fa = await seedTerminal(a, "failed");
    const fb = await seedTerminal(b, "failed");                    // default 30: purged
    const r = await sweepRetention({ discovery: nonFiledDiscovery([a, b]) });
    expect(r.nonFiled.purged).toBe(1);
    expect((await getFileRow(a, fa.fileId))?.retentionDeletedAt).toBeNull();
    expect((await getFileRow(b, fb.fileId))?.retentionDeletedAt).toBeTruthy();
    for (const k of fa.allKeys) expect(store.objects.has(k)).toBe(true);
    // a discovery that only names tenant b never touches tenant a, even with a shorter period
    await putSettings(newTenant(), { nonFiledRetentionDays: 1 });
    expect((await sweepRetention({ discovery: nonFiledDiscovery([b]) })).nonFiled.due).toBe(0);
  });

  it("a failed object delete leaves the file unstamped (retried next sweep) and nothing is audited as purged", async () => {
    const t = newTenant();
    const x = await seedTerminal(t, "quarantined");
    const del = vi.spyOn(store, "del").mockRejectedValueOnce(new Error("S3 down"));
    const r1 = await sweepRetention({ discovery: nonFiledDiscovery([t]) });
    expect(r1.nonFiled).toEqual({ due: 1, purged: 0, failed: 1 });
    expect((await getFileRow(t, x.fileId))?.retentionDeletedAt).toBeNull();
    expect(await auditsOf(t, "non_filed_retention_deleted")).toHaveLength(0);
    del.mockRestore();
    const r2 = await sweepRetention({ discovery: nonFiledDiscovery([t]) });
    expect(r2.nonFiled).toEqual({ due: 1, purged: 1, failed: 0 });
    for (const k of x.allKeys) expect(store.objects.has(k)).toBe(false);
  });

  it("dry run reports and changes nothing", async () => {
    const t = newTenant();
    const x = await seedTerminal(t, "skipped");
    const r = await sweepRetention({ discovery: nonFiledDiscovery([t]), dryRun: true });
    expect(r.nonFiled).toEqual({ due: 1, purged: 0, failed: 0 });
    expect(store.deleted).toHaveLength(0);
    expect((await getFileRow(t, x.fileId))?.retentionDeletedAt).toBeNull();
  });

  it("the filed sweep still works for a tenant with NO per-type policy (non-filed retention is independent of retentionDaysByType)", async () => {
    const t = newTenant();                                          // no settings row: defaults, retentionDaysByType = {}
    const x = await seedTerminal(t, "cancelled");
    const r = await sweepRetention({ discovery: { tenants: async () => [t], nonFiledTenants: async () => [t] } });
    expect(r.nonFiled.purged).toBe(1);
    expect((await getFileRow(t, x.fileId))?.retentionDeletedAt).toBeTruthy();
  });
});

describe("retention: tenant paging (no starvation past the page size)", () => {
  it("keeps a keyset cursor so every tenant is served across sweeps when there are more tenants than maxTenants", async () => {
    const all = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005"];
    const served: string[] = [];
    const disc: RetentionDiscovery = {
      tenants: async (limit, after) => { const page = all.filter((x) => !after || x > after).slice(0, limit); served.push(...page); return page; },
    };
    for (let i = 0; i < 4; i++) await sweepRetention({ discovery: disc, maxTenants: 2 });
    expect(new Set(served)).toEqual(new Set(all));
    expect(served.slice(0, 6)).toEqual([all[0], all[1], all[2], all[3], all[4], all[0]]);      // 2,2,1 then wraps
  });
});

describe("retention: unlink after purge", () => {
  const { q } = newInlineAll();
  const linkOf = async (t: string) => (await tenantTx(t, (tx) => tx.select().from(links).where(eq(links.tenantId, t))))[0];

  it("a refused unlink after a purge keeps the link unlink_requested (flagged), is audited, retried on the next sweep and cleared once confirmed", async () => {
    const t = newTenant();
    await putSettings(t, { retentionDaysByType: { bill_voucher: 30 } });
    const d = await seedFiled(store, t, { link: "hr_employee" });
    await sweepRetention({ discovery: discovery([t]) });
    expect(await getFileRow(t, d.fileId)).toMatchObject({ retentionUnlinkPending: true });
    const link = (await linkOf(t))!;
    expect(link.state).toBe("unlink_requested");
    expect(await outboxOf(t, LINK_TOPICS.unlinkRequest("hrms"))).toHaveLength(1);

    // the target refuses
    await send(q, LINK_TOPICS.unlinkResult("hrms"), t, USER2, { linkId: link.id, documentId: d.documentId, status: "rejected", reason: "LINK_NOT_FOUND" });
    expect((await linkOf(t))?.state).toBe("unlink_requested");                                // NOT back to "linked"
    const refused = await auditsOf(t, "unlink_refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.payload).toMatchObject({ details: { afterPurge: true } });
    expect(await getFileRow(t, d.fileId)).toMatchObject({ retentionUnlinkPending: true });

    // too soon: nothing re-sent
    const early = await sweepRetention({ discovery: unlinkDiscovery([t]), unlinkRetryAfterMs: 7 * 86_400_000 });
    expect(early.unlinks).toEqual({ retried: 0, completed: 0 });
    // next sweep re-sends it (idempotent per link id at the target) and audits the retry
    const r = await sweepRetention({ discovery: unlinkDiscovery([t]), unlinkRetryAfterMs: 0 });
    expect(r.unlinks.retried).toBe(1);
    expect(await outboxOf(t, LINK_TOPICS.unlinkRequest("hrms"))).toHaveLength(2);
    expect(await auditsOf(t, "retention_unlink_retried")).toHaveLength(1);

    // confirmed: link unlinked, flag cleared, sweep has nothing left
    await send(q, LINK_TOPICS.unlinkResult("hrms"), t, USER2, { linkId: link.id, documentId: d.documentId, status: "unlinked", reason: null });
    expect((await linkOf(t))?.state).toBe("unlinked");
    expect(await getFileRow(t, d.fileId)).toMatchObject({ retentionUnlinkPending: false });
    expect((await sweepRetention({ discovery: unlinkDiscovery([t]), unlinkRetryAfterMs: 0 })).unlinks).toEqual({ retried: 0, completed: 0 });
  });

  it("a refused unlink of a NOT purged document still returns the link to linked (unchanged behaviour)", async () => {
    const t = newTenant();
    const d = await seedFiled(store, t, { link: "hr_employee" });
    const link = (await linkOf(t))!;
    await send(q, "document.bulkscan.link.unlink", t, USER2, { linkId: link.id, reason: "attached to wrong employee" });
    await send(q, LINK_TOPICS.unlinkResult("hrms"), t, USER2, { linkId: link.id, documentId: d.documentId, status: "rejected", reason: "LINK_NOT_FOUND" });
    expect((await linkOf(t))?.state).toBe("linked");
    expect(await getFileRow(t, d.fileId)).toMatchObject({ retentionUnlinkPending: false });
  });
});
