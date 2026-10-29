/**
 * UAT FQ12 runner, document-service (real DB, via the queue + consumers):
 *  #112 folder move accepted a self/descendant parent (cycle) and `path` was never computed (always "/").
 *       `path` is the human-readable name path the web shows ("/Budget/2026"), kept for the whole subtree on rename and move.
 *  #111 #122 #126 #127 folder rename/move, file tags, noting create and approval submit/decide wrote no audit event.
 *  #125 dak forward validated `remarks` and then dropped them.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerFoldersConsumers } from "../src/modules/folders/consumer.js";
import { registerFilesConsumers } from "../src/modules/files/consumer.js";
import { registerWorkflowConsumers } from "../src/modules/workflow/consumer.js";
import * as folderCommands from "../src/modules/folders/commands.js";
import { auditsOf } from "./bulk-scan-review-helpers.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const as = (tid: string, sub: string, roles = ["document_user"]): Record<string, string> =>
  ({ authorization: `Bearer ${signToken({ sub, tid, roles, sid: "sess-fq12" }, SECRET)}`, "x-tenant-id": tid });
const ctxFor = (tenantId: string, actorId: string): RequestContext => ({ tenantId, actorId, correlationId: randomUUID() } as unknown as RequestContext);

registerFoldersConsumers(appQueue);
registerFilesConsumers(appQueue);
registerWorkflowConsumers(appQueue);
await appQueue.start();
const app = await buildApp();
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function mkFolder(tid: string, actor: string, name: string, parentId?: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/documents/folders", headers: as(tid, actor), payload: parentId ? { name, parentId } : { name } });
  expect(res.statusCode).toBe(202);
  await appQueue.drain();
  return res.json().id as string;
}
async function folder(tid: string, actor: string, id: string): Promise<{ parentId: string | null; path: string; name: string }> {
  return (await app.inject({ method: "GET", url: `/v1/documents/folders/${id}`, headers: as(tid, actor) })).json();
}
const move = (tid: string, actor: string, id: string, parentId: string | null) =>
  app.inject({ method: "PATCH", url: `/v1/documents/folders/${id}/move`, headers: as(tid, actor), payload: { parentId } });

const rename = (tid: string, actor: string, id: string, name: string) =>
  app.inject({ method: "PATCH", url: `/v1/documents/folders/${id}/rename`, headers: as(tid, actor), payload: { name } });
const paths = async (tid: string, u: string, ids: string[]): Promise<string[]> => Promise.all(ids.map(async (id) => (await folder(tid, u, id)).path));

describe("#112 folder move: no cycles, path maintained", () => {
  it("create computes the name path (root included, as the web fixtures expect: /Budget)", async () => {
    const tid = randomUUID(); const u = randomUUID();
    const a = await mkFolder(tid, u, "Budget"); const b = await mkFolder(tid, u, "2026", a); const c = await mkFolder(tid, u, "Q1 Bills", b);
    expect(await paths(tid, u, [a, b, c])).toEqual(["/Budget", "/Budget/2026", "/Budget/2026/Q1 Bills"]);
  });

  it("renaming a middle folder rewrites its own path and every descendant's; unknown folder 404", async () => {
    const tid = randomUUID(); const u = randomUUID();
    const a = await mkFolder(tid, u, "A"); const b = await mkFolder(tid, u, "B", a); const c = await mkFolder(tid, u, "C", b);
    const d = await mkFolder(tid, u, "D", c); const sib = await mkFolder(tid, u, "Sib", a);
    expect((await rename(tid, u, b, "Bee")).statusCode).toBe(202);
    await appQueue.drain();
    expect(await paths(tid, u, [a, b, c, d, sib])).toEqual(["/A", "/A/Bee", "/A/Bee/C", "/A/Bee/C/D", "/A/Sib"]);
    expect((await rename(tid, u, randomUUID(), "x")).statusCode).toBe(404);
  });

  it("a folder name containing '/' is rejected on create and rename (400), so the name path stays unambiguous", async () => {
    const tid = randomUUID(); const u = randomUUID();
    const a = await mkFolder(tid, u, "A");
    const create = await app.inject({ method: "POST", url: "/v1/documents/folders", headers: as(tid, u), payload: { name: "a/b" } });
    expect(create.statusCode).toBe(400);
    expect(create.json().code).toBe("VALIDATION_FAILED");
    expect((await rename(tid, u, a, "x/y")).statusCode).toBe(400);
    await appQueue.drain();
    expect((await folder(tid, u, a)).name).toBe("A");
  });

  it("a create, rename or move whose path would exceed 2000 chars is refused synchronously (422 PATH_TOO_LONG)", async () => {
    const tid = randomUUID(); const u = randomUUID(); const long = (ch: string) => ch.repeat(500);
    const a = await mkFolder(tid, u, long("a")); const b = await mkFolder(tid, u, long("b"), a); const c = await mkFolder(tid, u, long("c"), b);
    const leaf = await mkFolder(tid, u, "d", c);                     // path length 1505
    const tooDeep = await app.inject({ method: "POST", url: "/v1/documents/folders", headers: as(tid, u), payload: { name: long("e"), parentId: c } });
    expect(tooDeep.statusCode).toBe(422);
    expect(tooDeep.json().code).toBe("PATH_TOO_LONG");
    expect((await rename(tid, u, leaf, long("d"))).json().code).toBe("PATH_TOO_LONG");
    const x = await mkFolder(tid, u, long("x"));
    const mv = await move(tid, u, x, c);
    expect(mv.statusCode).toBe(422);
    expect(mv.json().code).toBe("PATH_TOO_LONG");
    await appQueue.drain();
    expect((await folder(tid, u, leaf)).name).toBe("d");
    expect((await folder(tid, u, x)).parentId).toBeNull();
  });

  it("rejects moving a folder under itself or under its own descendant (422 FOLDER_CYCLE); nothing changes", async () => {
    const tid = randomUUID(); const u = randomUUID();
    const a = await mkFolder(tid, u, "A"); const b = await mkFolder(tid, u, "B", a); const c = await mkFolder(tid, u, "C", b);
    for (const target of [a, b, c]) {
      const res = await move(tid, u, a, target);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("FOLDER_CYCLE");
    }
    await appQueue.drain();
    expect((await folder(tid, u, a)).parentId).toBeNull();
  });

  it("unknown folder 404, unknown parent 422 PARENT_NOT_FOUND (create and move)", async () => {
    const tid = randomUUID(); const u = randomUUID();
    const a = await mkFolder(tid, u, "A");
    expect((await move(tid, u, randomUUID(), a)).statusCode).toBe(404);
    const badMove = await move(tid, u, a, randomUUID());
    expect(badMove.statusCode).toBe(422);
    expect(badMove.json().code).toBe("PARENT_NOT_FOUND");
    const badCreate = await app.inject({ method: "POST", url: "/v1/documents/folders", headers: as(tid, u), payload: { name: "X", parentId: randomUUID() } });
    expect(badCreate.statusCode).toBe(422);
    expect(badCreate.json().code).toBe("PARENT_NOT_FOUND");
  });

  it("a move recomputes the path of the folder and its whole subtree; moving to root resets it", async () => {
    const tid = randomUUID(); const u = randomUUID();
    const a = await mkFolder(tid, u, "A"); const b = await mkFolder(tid, u, "B", a); const c = await mkFolder(tid, u, "C", b);
    const d = await mkFolder(tid, u, "D");
    expect((await move(tid, u, a, d)).statusCode).toBe(202);
    await appQueue.drain();
    expect(await folder(tid, u, a)).toMatchObject({ parentId: d });
    expect(await paths(tid, u, [d, a, b, c])).toEqual(["/D", "/D/A", "/D/A/B", "/D/A/B/C"]);

    expect((await move(tid, u, b, null)).statusCode).toBe(202);
    await appQueue.drain();
    expect(await folder(tid, u, b)).toMatchObject({ parentId: null, path: "/B" });
    expect(await paths(tid, u, [a, c])).toEqual(["/D/A", "/B/C"]);
  });

  it("a cyclic move that slips past the route (race) is refused by the consumer and audited as denied", async () => {
    const tid = randomUUID(); const u = randomUUID();
    const a = await mkFolder(tid, u, "A"); const b = await mkFolder(tid, u, "B", a);
    await folderCommands.moveFolder(ctxFor(tid, u), a, b);
    await appQueue.drain();
    expect((await folder(tid, u, a)).parentId).toBeNull();
    const denied = (await auditsOf(tid, "move")).filter((r) => r.payload.outcome === "denied" && r.payload.resourceId === a);
    expect(denied).toHaveLength(1);
    expect((denied[0].payload.details as { reason: string }).reason).toBe("cycle");
  });
});

describe("#111 folder rename / move are audited", () => {
  it("rename and move each write one success audit naming the folder", async () => {
    const tid = randomUUID(); const u = randomUUID();
    const a = await mkFolder(tid, u, "A"); const p = await mkFolder(tid, u, "P");
    await app.inject({ method: "PATCH", url: `/v1/documents/folders/${a}/rename`, headers: as(tid, u), payload: { name: "A2" } });
    await move(tid, u, a, p);
    await appQueue.drain();
    for (const action of ["rename", "move"]) {
      const rows = (await auditsOf(tid, action)).filter((r) => r.payload.resourceId === a);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: u, payload: { service: "document", resourceType: "folder", outcome: "success" } });
    }
  });
});

describe("#122 file tags are audited", () => {
  it("a tag update on an existing file writes a success audit; on an unknown file it writes none", async () => {
    const tid = randomUUID(); const u = randomUUID(); const fileId = randomUUID();
    await appQueue.publish(COMMANDS.fileUpload, {
      messageId: randomUUID(), type: COMMANDS.fileUpload, tenantId: tid, actorId: u, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: fileId, tenantId: tid, folderId: null, name: "a.pdf", mimeType: "application/pdf", sizeBytes: 10, storageKey: `t/${fileId}`, tags: [] },
    });
    await appQueue.drain();
    const missing = randomUUID();
    for (const id of [fileId, missing]) {
      const res = await app.inject({ method: "PATCH", url: `/v1/documents/files/${id}/tags`, headers: as(tid, u), payload: { tags: ["urgent"] } });
      expect(res.statusCode).toBe(202);
    }
    await appQueue.drain();
    const rows = await auditsOf(tid, "tag");
    expect(rows.map((r) => r.payload.resourceId)).toEqual([fileId]);
    expect(rows[0]).toMatchObject({ actorId: u, payload: { resourceType: "file", outcome: "success" } });
  });
});

async function mkDak(tid: string, creator: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/documents/daks", headers: as(tid, creator), payload: { subject: "FQ12 dak" } });
  await appQueue.drain();
  return res.json().id as string;
}

describe("#126 #127 noting create and approval submit/decide are audited", () => {
  it("noting create, approval submit and approval decide each write one success audit", async () => {
    const tid = randomUUID(); const owner = randomUUID(); const holder = randomUUID();
    const dak = await mkDak(tid, owner);
    const noting = (await app.inject({ method: "POST", url: `/v1/documents/daks/${dak}/notings`, headers: as(tid, owner), payload: { body: "Put up for orders" } })).json().id as string;
    const approval = (await app.inject({ method: "POST", url: `/v1/documents/daks/${dak}/approval`, headers: as(tid, owner) })).json().id as string;
    await appQueue.drain();
    await app.inject({ method: "POST", url: `/v1/documents/daks/${dak}/forward`, headers: as(tid, owner), payload: { assignedTo: holder } });
    await appQueue.drain();
    expect((await app.inject({ method: "POST", url: `/v1/documents/approvals/${approval}/decide`, headers: as(tid, holder), payload: { decision: "approved" } })).statusCode).toBe(202);
    await appQueue.drain();

    const create = (await auditsOf(tid, "create")).filter((r) => r.payload.resourceType === "noting");
    expect(create).toHaveLength(1);
    expect(create[0]).toMatchObject({ actorId: owner, payload: { resourceId: noting, outcome: "success", details: { dakId: dak } } });
    const submit = await auditsOf(tid, "submit");
    expect(submit).toHaveLength(1);
    expect(submit[0]).toMatchObject({ actorId: owner, payload: { resourceType: "approval", resourceId: approval, outcome: "success", details: { dakId: dak } } });
    const decide = (await auditsOf(tid, "decide")).filter((r) => r.payload.outcome === "success");
    expect(decide).toHaveLength(1);
    expect(decide[0]).toMatchObject({ actorId: holder, payload: { resourceType: "approval", resourceId: approval, details: { decision: "approved" } } });
  });
});

describe("#125 dak forward keeps the remarks", () => {
  it("forward remarks are recorded as a noting by the forwarder; a forward without remarks adds none", async () => {
    const tid = randomUUID(); const owner = randomUUID(); const next = randomUUID(); const last = randomUUID();
    const dak = await mkDak(tid, owner);
    const fwd = await app.inject({ method: "POST", url: `/v1/documents/daks/${dak}/forward`, headers: as(tid, owner), payload: { assignedTo: next, remarks: "Please examine and put up" } });
    expect(fwd.statusCode).toBe(202);
    await appQueue.drain();
    await app.inject({ method: "POST", url: `/v1/documents/daks/${dak}/forward`, headers: as(tid, next), payload: { assignedTo: last } });
    await appQueue.drain();

    const notings = (await app.inject({ method: "GET", url: `/v1/documents/daks/${dak}/notings`, headers: as(tid, last) })).json().data as { body: string; createdBy: string }[];
    expect(notings.map((n) => ({ body: n.body, createdBy: n.createdBy }))).toEqual([{ body: "Please examine and put up", createdBy: owner }]);
    const audits = (await auditsOf(tid, "forward")).filter((r) => r.payload.outcome === "success");
    expect(audits.map((a) => (a.payload.details as { hasRemarks: boolean }).hasRemarks)).toEqual([true, false]);
    const [row] = await withRawTenantGuc(sqlClient, tid, (tx) => tx`select assigned_to from document.daks where tenant_id = ${tid} and id = ${dak}`);
    expect(row.assigned_to).toBe(last);
  });
});
