/** Lease heartbeat (real DB, real time, short lease): alive heartbeat is never swept; dead heartbeat is; lost lease cannot write. */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/bulk-scan/repo.js";
import { batchFiles } from "../src/modules/bulk-scan/schema.js";
import { sweepLeases, createDispatcher, type DiscoveryPort } from "../src/modules/bulk-scan/dispatcher.js";
import { setPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";
import { setLeaseMsForTests, setHeartbeatEnabledForTests } from "../src/modules/bulk-scan/lease.js";
import { COMMANDS } from "../src/topics.js";
import type { OcrPipelinePort } from "../src/modules/bulk-scan/ocr-port.js";
import { newTenant, newInline, send, pump, tenantTx, memoryStore, fakeScanner, okOutput, insertBatchRow, insertFileRow, USER1 } from "./bulk-scan-helpers.js";

const store = memoryStore();
const { q } = newInline();
const LEASE = 600;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function discovery(tenants: string[]): DiscoveryPort {
  return {
    async dueTenants(now) { const o: string[] = []; for (const t of tenants) if ((await tenantTx(t, (tx) => repo.dueFilesForTenant(tx, t, now, 1))).length) o.push(t); return o; },
    dueFiles: (t, now, cap) => tenantTx(t, (tx) => repo.dueFilesForTenant(tx, t, now, cap)),
    async expiredLeases(now, limit) { const a = []; for (const t of tenants) a.push(...(await tenantTx(t, (tx) => repo.discoverExpiredLeases(tx, now, limit)))); return a; },
  };
}

/** OCR that takes `ms` and honours the abort signal. */
function slowOcr(ms: number): OcrPipelinePort & { started: number; aborted: number; finished: number } {
  const o = {
    started: 0, aborted: 0, finished: 0,
    run(input: Parameters<OcrPipelinePort["run"]>[0]) {
      o.started++;
      return new Promise<ReturnType<typeof okOutput>>((resolve, reject) => {
        const t = setTimeout(() => { o.finished++; resolve(okOutput()); }, ms);
        input.signal?.addEventListener("abort", () => { clearTimeout(t); o.aborted++; reject(new Error("aborted")); });
      });
    },
  };
  return o;
}

const row = (t: string, id: string) => runWithTenant(t, () => repo.getFile(t, id)) as Promise<Awaited<ReturnType<typeof repo.getFile>>>;
const states = async (t: string, id: string) => (await runWithTenant(t, () => repo.listFileEvents(t, id))).map((e) => e.toState);

async function ocrRunningFile(t: string): Promise<{ batchId: string; id: string }> {
  const batchId = await insertBatchRow(t);
  const id = await insertFileRow(t, batchId, "ocr_running", { leaseExpiresAt: new Date(Date.now() + LEASE) });
  store.objects.set(`tenants/${t}/bulk-scan/${batchId}/${id}/original`, Buffer.from("png"));
  return { batchId, id };
}

beforeAll(() => { setLeaseMsForTests(LEASE); setPorts({ store, scanner: fakeScanner(), now: () => new Date(), random: () => 0.5 }); });
afterEach(() => { setHeartbeatEnabledForTests(true); });
afterAll(async () => { setLeaseMsForTests(null); resetPorts(); await sqlClient.end(); });

describe("lease heartbeat", () => {
  it("a slow job is NOT swept while its heartbeat is alive (lease is extended), and completes", async () => {
    const t = newTenant();
    const { id } = await ocrRunningFile(t);
    const ocr = slowOcr(2200);                                  // > 3x the lease
    setPorts({ ocr });
    const done = send(q, COMMANDS.bulkStepOcr, t, USER1, { fileId: id });
    let swept = 0;
    for (let i = 0; i < 9; i++) {                               // ~2.2s of sweeping at 250ms
      await sleep(250);
      const r = await sweepLeases({ discovery: discovery([t]) }, new Date());
      swept += r.requeued + r.deadLettered;
    }
    expect(swept).toBe(0);
    const mid = await row(t, id);
    expect(mid?.state === "ocr_running" || mid?.state === "extracted" || mid?.state === "ready_to_file").toBe(true);
    await done;
    await pump(q);
    expect((await row(t, id))?.state).toBe("ready_to_file");
    expect((await row(t, id))?.leaseOwner).toBeNull();
    expect(ocr.started).toBe(1);
    expect((await states(t, id)).filter((s) => s === "extracted")).toHaveLength(1);
  }, 20_000);

  it("IS swept after the heartbeat dies, and the dead worker then cannot transition or write results", async () => {
    const t = newTenant();
    const { batchId, id } = await ocrRunningFile(t);
    const ocr = slowOcr(1800);
    setPorts({ ocr });
    setHeartbeatEnabledForTests(false);                         // worker "hangs": no more heartbeats
    const puts: string[] = [];
    const origPut = store.put;
    store.put = async (k, b, c) => { puts.push(k); return origPut(k, b, c); };

    const zombie = send(q, COMMANDS.bulkStepOcr, t, USER1, { fileId: id });
    await sleep(LEASE + 300);                                   // lease truly expired
    const r = await sweepLeases({ discovery: discovery([t]) }, new Date());
    expect(r).toEqual({ requeued: 1, deadLettered: 0 });
    expect(await row(t, id)).toMatchObject({ state: "queued", attempts: 1, leaseOwner: null });

    // a second worker takes it over, while the zombie is still running
    setHeartbeatEnabledForTests(true);
    const d = createDispatcher({ discovery: discovery([t]), slots: 2 });
    expect((await d.dispatchOnce()).ocrClaimed).toBe(1);
    await zombie;                                               // zombie finishes OCR: must not write or move anything
    expect(puts.filter((k) => k.includes("/derived/"))).toHaveLength(0);
    expect((await row(t, id))?.state).toBe("ocr_running");     // still the new owner's
    await pump(q);                                              // new owner's step runs to completion
    store.put = origPut;

    const finalRow = await row(t, id);
    expect(finalRow?.state).toBe("ready_to_file");
    const ev = await states(t, id);
    expect(ev.filter((s) => s === "extracted")).toHaveLength(1);          // exactly one winner
    expect(ev.filter((s) => s === "ready_to_file")).toHaveLength(1);
    expect(puts.filter((k) => k.includes("/derived/"))).toHaveLength(3);  // one derivative set, written once
    expect(batchId).toBeTruthy();
  }, 20_000);

  it("a job whose lease is taken away aborts its OCR call (AbortSignal) and writes nothing", async () => {
    const t = newTenant();
    const { id } = await ocrRunningFile(t);
    const ocr = slowOcr(5000);
    setPorts({ ocr });
    const run = send(q, COMMANDS.bulkStepOcr, t, USER1, { fileId: id });
    await sleep(150);
    // someone else re-queued and re-claimed the file: owner changes under the running job
    await tenantTx(t, (tx) => tx.update(batchFiles).set({ leaseOwner: "99999999-9999-4999-8999-999999999999" }).where(eq(batchFiles.id, id)).then(() => undefined));
    const t0 = Date.now();
    await run;                                                  // heartbeat (every ~200ms) finds 0 rows, aborts the OCR
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(ocr.aborted).toBe(1);
    expect(ocr.finished).toBe(0);
    const r = await row(t, id);
    expect(r).toMatchObject({ state: "ocr_running", leaseOwner: "99999999-9999-4999-8999-999999999999", textMaskedKey: null });
    expect(await states(t, id)).toEqual([]);                    // no events from the loser
  }, 20_000);

  it("a second step for a file that is already being worked is dropped (single owner)", async () => {
    const t = newTenant();
    const { id } = await ocrRunningFile(t);
    const ocr = slowOcr(900);
    setPorts({ ocr });
    await Promise.all([
      send(q, COMMANDS.bulkStepOcr, t, USER1, { fileId: id }),
      send(q, COMMANDS.bulkStepOcr, t, USER1, { fileId: id }),
    ]);
    expect(ocr.started).toBe(1);
    await pump(q);
    expect((await states(t, id)).filter((s) => s === "extracted")).toHaveLength(1);
  }, 20_000);

  it("transition() refuses a non-owner and a non-expired sweep", async () => {
    const t = newTenant();
    const b = await insertBatchRow(t);
    const owner = "11111111-1111-4111-8111-111111111111";
    const id = await insertFileRow(t, b, "ocr_running", { leaseOwner: owner, leaseExpiresAt: new Date(Date.now() + 60_000) });
    const mv = (o: Partial<Parameters<typeof repo.transition>[1]>) =>
      tenantTx(t, (tx) => repo.transition(tx, { tenantId: t, fileId: id, from: ["ocr_running"], to: "queued", ...o }));
    expect(await mv({ leaseOwner: "22222222-2222-4222-8222-222222222222" })).toBe(false);
    expect(await mv({ leaseExpiredBy: new Date() })).toBe(false);
    expect(await mv({ leaseOwner: owner })).toBe(true);
    expect(await row(t, id)).toMatchObject({ state: "queued", leaseOwner: null });
  });
});
void db;
