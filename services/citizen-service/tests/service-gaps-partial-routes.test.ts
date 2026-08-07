/**
 * SVC-081/082/084/089 — route integration tests (partial-capability completion).
 * Covers: versioned catalogue maker-checker publish + immutability, draft/ack/
 * tracking intake + assisted channel, DigiLocker env-gated honesty + checklist +
 * deficiency/resubmission, appeal filing-window + order maker-checker + remand,
 * RLS cross-tenant 404, and outbox emission.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import { registerAppealConsumers } from "../src/modules/appeal/consumer.js";
import { registerCatalogueConsumers } from "../src/modules/catalogue/consumer.js";
import { registerDocumentsConsumers } from "../src/modules/documents/consumer.js";
import type { FastifyInstance } from "fastify";

registerApplicationConsumers(queue);
registerAppealConsumers(queue);
registerCatalogueConsumers(queue);
registerDocumentsConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "a1a1a1a1-0000-4000-8000-000000000016";
const TENANT_B = "b2b2b2b2-0000-4000-8000-000000000016";
const MAKER   = "11111111-0000-4000-8000-000000000016";
const CHECKER = "22222222-0000-4000-8000-000000000016";
const SERVICE_ID = "33333333-0000-4000-8000-000000000016";
const CITIZEN = "55555555-0000-4000-8000-000000000016";

function tok(tenant: string, actor: string, roles = ["citizen_admin", "citizen_officer", "super_admin"]) {
  return signToken({ sub: actor, tid: tenant, roles, sid: "sess-gaps16" }, SECRET, 3600);
}
function hdr(t: string) { return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": TENANT_A }; }

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

async function outboxTopics(): Promise<string[]> {
  // _outbox.messages has FORCED RLS — read under the transaction-LOCAL tenant GUC.
  const rows = await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT_A}, true)`;
    return sql`SELECT topic FROM _outbox.messages WHERE tenant_id = ${TENANT_A}`;
  });
  return rows.map((r: { topic: string }) => r.topic);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════ SVC-081 Government service catalogue ═════════════════
describe("SVC-081 versioned catalogue maker-checker publish", () => {
  let defId: string;
  let v1: number;
  // Unique per run so absolute version numbers stay deterministic across reruns.
  const SERVICE_KEY = `trade-licence-${Date.now().toString(36)}`;

  it("creates a draft service definition (version 1 for a fresh key)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/catalogue/services", headers: hdr(tok(TENANT_A, MAKER)),
      payload: {
        serviceKey: SERVICE_KEY, serviceId: SERVICE_ID, name: "Trade Licence",
        ownerDepartment: "Municipal Licensing", channels: ["portal", "counter"],
        requiredDocuments: [
          { docType: "id_proof", label: "ID proof", mandatory: true },
          { docType: "address_proof", label: "Address proof", mandatory: true },
        ],
        slaDays: 15,
      },
    });
    expect(res.statusCode).toBe(202);
    defId = res.json().id;
    const def = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/catalogue/services/${defId}`, headers: hdr(tok(TENANT_A, MAKER)) });
      return g.statusCode === 200 ? g.json() : null;
    });
    expect(def.version).toBe(1);
    expect(def.status).toBe("draft");
    v1 = def.version;
  });

  it("patches a draft definition (designer B1 autosave)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/citizen/catalogue/services/${defId}`, headers: hdr(tok(TENANT_A, MAKER)),
      payload: {
        name: "Trade Licence (Revised)",
        servicePattern: "certificate",
        slaDays: 21,
        channels: ["portal", "mobile"],
        statutoryReferences: [{ act: "Municipal Act", section: "12" }],
      },
    });
    expect(res.statusCode).toBe(202);
    const def = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/catalogue/services/${defId}`, headers: hdr(tok(TENANT_A, MAKER)) });
      return g.json().slaDays === 21 ? g.json() : null;
    });
    expect(def.name).toBe("Trade Licence (Revised)");
    expect(def.servicePattern).toBe("certificate");
    expect(def.channels).toEqual(["portal", "mobile"]);
  });

  it("submit records the maker", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/citizen/catalogue/services/${defId}/submit`, headers: hdr(tok(TENANT_A, MAKER)), payload: {} });
    expect(res.statusCode).toBe(202);
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/catalogue/services/${defId}`, headers: hdr(tok(TENANT_A, MAKER)) });
      return g.json().submittedBy ? g.json() : null;
    });
  });

  it("MAKER-CHECKER: publish by the submitter is rejected 403", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/citizen/catalogue/services/${defId}/publish`, headers: hdr(tok(TENANT_A, MAKER)), payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MAKER_CHECKER");
  });

  it("publish by a different checker succeeds + emits catalogue.published", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/citizen/catalogue/services/${defId}/publish`, headers: hdr(tok(TENANT_A, CHECKER)), payload: {} });
    expect(res.statusCode).toBe(202);
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/catalogue/services/${defId}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.json().status === "published" ? g.json() : null;
    });
    const topics = await outboxTopics();
    expect(topics).toContain("citizen.catalogue.published");
  });

  it("published definition is immutable (re-publish 409)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/citizen/catalogue/services/${defId}/publish`, headers: hdr(tok(TENANT_A, CHECKER)), payload: {} });
    expect(res.statusCode).toBe(409);
  });

  it("a revision is a NEW row at the next version (versioned)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/catalogue/services", headers: hdr(tok(TENANT_A, MAKER)),
      payload: { serviceKey: SERVICE_KEY, name: "Trade Licence v2", channels: ["portal"], requiredDocuments: [] },
    });
    expect(res.json().version).toBe(v1 + 1);
  });

  it("citizen-facing browse returns only published + lookup by key", async () => {
    const browse = await app.inject({ method: "GET", url: "/v1/citizen/catalogue/published", headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])) });
    expect(browse.statusCode).toBe(200);
    expect(browse.json().data.every((d: { status: string }) => d.status === "published")).toBe(true);
    // Only v1 is published for this fresh key (the revision is still a draft).
    const lookup = await app.inject({ method: "GET", url: `/v1/citizen/catalogue/published/lookup?serviceKey=${SERVICE_KEY}`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])) });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().version).toBe(v1);
  });

  it("RLS: tenant B cannot read tenant A definition (404)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/catalogue/services/${defId}`,
      headers: { authorization: `Bearer ${tok(TENANT_B, CHECKER)}`, "x-tenant-id": TENANT_B },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ══════════════════════ SVC-082 Online + assisted intake ════════════════════
describe("SVC-082 draft/ack/tracking + assisted channel", () => {
  let draftId: string;
  let trackingNo: string;

  it("saves a portal draft (self-service)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/intake/drafts", headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
      payload: { serviceId: SERVICE_ID, channel: "portal", formData: { name: "Asha" }, documentTypes: ["id_proof"] },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    draftId = res.json().id;
    const draft = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/intake/drafts/${draftId}`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])) });
      return g.statusCode === 200 ? g.json() : null;
    });
    expect(draft.status).toBe("draft");
    expect(draft.assistedBy).toBeNull();
  });

  it("resumes/updates the draft", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/citizen/intake/drafts/${draftId}`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
      payload: { formData: { name: "Asha Kumar" } },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("submit produces an ACKNOWLEDGEMENT with a unique tracking number", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/citizen/intake/drafts/${draftId}/submit`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])), payload: {} });
    expect(res.statusCode).toBe(202);
    expect(res.json().trackingNo).toMatch(/^CIT-\d{4}-[0-9A-F]{8}$/);
    expect(res.json().channel).toBe("portal");
    trackingNo = res.json().trackingNo;
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/intake/track/${trackingNo}`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])) });
      return g.statusCode === 200 ? g.json() : null;
    });
  });

  it("re-submitting an already-submitted draft is rejected 409", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/citizen/intake/drafts/${draftId}/submit`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])), payload: {} });
    expect(res.statusCode).toBe(409);
  });

  it("track by number returns the acknowledgement + status", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/citizen/intake/track/${trackingNo}`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])) });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("submitted");
    expect(res.json().channel).toBe("portal");
  });

  it("ASSISTED entry records the operator-on-behalf-of", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/intake/drafts", headers: hdr(tok(TENANT_A, MAKER)),
      payload: { citizenId: CITIZEN, serviceId: SERVICE_ID, channel: "assisted", formData: {} },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id;
    const draft = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/intake/drafts/${id}`, headers: hdr(tok(TENANT_A, MAKER)) });
      return g.statusCode === 200 ? g.json() : null;
    });
    expect(draft.channel).toBe("assisted");
    expect(draft.assistedBy).toBe(MAKER);
  });

  it("a citizen cannot use the assisted channel (needs officer operator)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/intake/drafts", headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
      payload: { serviceId: SERVICE_ID, channel: "assisted", operatorId: MAKER, formData: {} },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════ SVC-084 Document submission & verification ═══════════
describe("SVC-084 upload/DigiLocker-gated/checklist/deficiency/resubmit", () => {
  const APP_ID = "44444444-0000-4000-8000-000000000016";
  let docId: string;

  it("DigiLocker fetch with NO creds stays pending (honest, provider_unconfigured)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/digilocker-fetch", headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
      payload: { applicationId: APP_ID, serviceId: SERVICE_ID, docType: "id_proof", docUri: "digilocker://aadhaar/xyz" },
    });
    expect(res.statusCode).toBe(202);
    const doc = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/documents/${res.json().id}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.statusCode === 200 ? g.json() : null;
    });
    expect(doc.providerStatus).toBe("provider_unconfigured");
    expect(doc.verificationStatus).toBe("pending");
    expect(doc.authenticity).toBe("unverified");
  });

  it("upload intake records a self-attested pending submission", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/upload", headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
      payload: { applicationId: APP_ID, serviceId: SERVICE_ID, docType: "address_proof" },
    });
    expect(res.statusCode).toBe(202);
    docId = res.json().id;
    const doc = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/documents/${docId}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.statusCode === 200 ? g.json() : null;
    });
    expect(doc.verificationStatus).toBe("pending");
  });

  it("checklist is sourced from the published catalogue definition (081)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/documents/checklist?serviceId=${SERVICE_ID}&applicationId=${APP_ID}`,
      headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().source).toBe("catalogue");
    const items = res.json().items as Array<{ docType: string; provided: boolean }>;
    expect(items.find((i) => i.docType === "address_proof")?.provided).toBe(true);
    expect(res.json().complete).toBe(false); // nothing verified yet
  });

  it("officer issues a deficiency memo (requires a reason)", async () => {
    const noReason = await app.inject({
      method: "POST", url: `/v1/citizen/documents/${docId}/verify`, headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { decision: "deficient" },
    });
    expect(noReason.statusCode).toBe(422);
    const res = await app.inject({
      method: "POST", url: `/v1/citizen/documents/${docId}/verify`, headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { decision: "deficient", reason: "blurred scan" },
    });
    expect(res.statusCode).toBe(202);
    const verified = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/documents/${docId}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.json().status === "deficient" ? g.json() : null;
    });
    expect(verified.status).toBe("deficient");
  });

  it("resubmission supersedes the deficient submission", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/citizen/documents/${docId}/resubmit`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
      payload: { source: "upload" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().supersedes).toBe(docId);
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/documents/${docId}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.json().status === "superseded" ? g.json() : null;
    });
  });

  it("verify emits a document.verified outbox event", async () => {
    const fresh = await app.inject({
      method: "POST", url: "/v1/citizen/documents/upload", headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
      payload: { applicationId: APP_ID, serviceId: SERVICE_ID, docType: "id_proof" },
    });
    const id = fresh.json().id;
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/documents/${id}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.statusCode === 200 ? g.json() : null;
    });
    const res = await app.inject({
      method: "POST", url: `/v1/citizen/documents/${id}/verify`, headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { decision: "verify" },
    });
    expect(res.statusCode).toBe(202);
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/documents/${id}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.json().verificationStatus === "verified" ? g.json() : null;
    });
    const topics = await outboxTopics();
    expect(topics).toContain("citizen.document.verified");
  });
});

// ══════════════════════ SVC-089 Appeal, review & revision ════════════════════
describe("SVC-089 appeal filing-window + order maker-checker + remand", () => {
  const APP_ID = "66666666-0000-4000-8000-000000000016";
  let appealId: string;

  it("filing OUTSIDE the window is rejected 422 FILING_WINDOW_EXPIRED", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/appeals", headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
      payload: { applicationId: APP_ID, grounds: "unfair", decisionDate: isoDaysAgo(60), windowDays: 30 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FILING_WINDOW_EXPIRED");
  });

  it("filing WITHIN the window succeeds + emits appeal.filed", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/appeals", headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
      payload: { applicationId: APP_ID, citizenId: CITIZEN, grounds: "documents ignored", decisionDate: isoDaysAgo(5), windowDays: 30 },
    });
    expect(res.statusCode).toBe(202);
    appealId = res.json().id;
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/appeals/${appealId}`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])) });
      return g.statusCode === 200 && g.json().status === "filed" ? g.json() : null;
    });
    const topics = await outboxTopics();
    expect(topics).toContain("citizen.appeal.filed");
  });

  it("assign authority, transfer records, schedule + record hearing", async () => {
    const assign = await app.inject({
      method: "POST", url: `/v1/citizen/appeals/${appealId}/assign`, headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { appellateAuthorityId: "77777777-0000-4000-8000-000000000016" },
    });
    expect(assign.statusCode).toBe(202);
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/appeals/${appealId}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.json().status === "assigned" ? g.json() : null;
    });
    const transfer = await app.inject({ method: "POST", url: `/v1/citizen/appeals/${appealId}/transfer-records`, headers: hdr(tok(TENANT_A, CHECKER)), payload: {} });
    expect(transfer.statusCode).toBe(202);
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/appeals/${appealId}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.json().recordsTransferred ? g.json() : null;
    });
    const hearing = await app.inject({ method: "POST", url: `/v1/citizen/appeals/${appealId}/hearings`, headers: hdr(tok(TENANT_A, CHECKER)), payload: { mode: "video" } });
    expect(hearing.statusCode).toBe(202);
    const hearingId = hearing.json().hearingId;
    const record = await app.inject({
      method: "POST", url: `/v1/citizen/appeals/${appealId}/hearings/record`, headers: hdr(tok(TENANT_A, CHECKER)),
      payload: { hearingId, record: "both parties heard" },
    });
    expect(record.statusCode).toBe(202);
  });

  it("MAKER-CHECKER order: prepare by maker, issue by same actor rejected 403", async () => {
    const prep = await app.inject({
      method: "POST", url: `/v1/citizen/appeals/${appealId}/order/prepare`, headers: hdr(tok(TENANT_A, MAKER)),
      payload: { orderType: "overturned", orderNote: "decision set aside" },
    });
    expect(prep.statusCode).toBe(202);
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/appeals/${appealId}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.json().preparedBy ? g.json() : null;
    });
    const self = await app.inject({ method: "POST", url: `/v1/citizen/appeals/${appealId}/order/issue`, headers: hdr(tok(TENANT_A, MAKER)), payload: {} });
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe("MAKER_CHECKER");
  });

  it("issue by a different checker finalises + emits appeal.decided", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/citizen/appeals/${appealId}/order/issue`, headers: hdr(tok(TENANT_A, CHECKER)), payload: {} });
    expect(res.statusCode).toBe(202);
    const decided = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/appeals/${appealId}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.json().status === "decided" ? g.json() : null;
    });
    expect(decided.outcome).toBe("overturned");
    const topics = await outboxTopics();
    expect(topics).toContain("citizen.appeal.decided");
  });

  it("REMAND path: a remand order requires a target and sets status remanded", async () => {
    const file = await app.inject({
      method: "POST", url: "/v1/citizen/appeals", headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
      payload: { applicationId: APP_ID, grounds: "fresh evidence", decisionDate: isoDaysAgo(2), windowDays: 30 },
    });
    const id = file.json().id;
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/appeals/${id}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.statusCode === 200 ? g.json() : null;
    });
    await app.inject({ method: "POST", url: `/v1/citizen/appeals/${id}/assign`, headers: hdr(tok(TENANT_A, CHECKER)), payload: { appellateAuthorityId: "77777777-0000-4000-8000-000000000016" } });
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/appeals/${id}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.json().status === "assigned" ? g.json() : null;
    });
    const noTarget = await app.inject({
      method: "POST", url: `/v1/citizen/appeals/${id}/order/prepare`, headers: hdr(tok(TENANT_A, MAKER)),
      payload: { orderType: "remanded", orderNote: "reconsider" },
    });
    expect(noTarget.statusCode).toBe(422);
    await app.inject({
      method: "POST", url: `/v1/citizen/appeals/${id}/order/prepare`, headers: hdr(tok(TENANT_A, MAKER)),
      payload: { orderType: "remanded", orderNote: "reconsider", remandTo: "88888888-0000-4000-8000-000000000016" },
    });
    await app.inject({ method: "POST", url: `/v1/citizen/appeals/${id}/order/issue`, headers: hdr(tok(TENANT_A, CHECKER)), payload: {} });
    const remanded = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/appeals/${id}`, headers: hdr(tok(TENANT_A, CHECKER)) });
      return g.json().status === "remanded" ? g.json() : null;
    });
    expect(remanded.status).toBe("remanded");
  });

  it("RLS: tenant B cannot read tenant A appeal (404)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/appeals/${appealId}`,
      headers: { authorization: `Bearer ${tok(TENANT_B, CHECKER)}`, "x-tenant-id": TENANT_B },
    });
    expect(res.statusCode).toBe(404);
  });
});


// ══════════════════════ SVC-084 IDOR — cross-citizen document access ═════════
describe("SVC-084 IDOR: a citizen cannot read/attribute another citizen's document", () => {
  const APP_ID = "44444444-0000-4000-8000-000000000016";
  const CITIZEN_B = "99999999-0000-4000-8000-000000000016";
  let docId: string;

  it("citizen A uploads a submission (owned by A)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/upload", headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
      payload: { applicationId: APP_ID, serviceId: SERVICE_ID, docType: "id_proof" },
    });
    expect(res.statusCode).toBe(202);
    docId = res.json().id;
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/documents/${docId}`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])) });
      return g.statusCode === 200 ? g.json() : null;
    });
  });

  it("owner citizen A CAN read their own submission (200)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/documents/${docId}`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(docId);
  });

  it("citizen B CANNOT read citizen A's submission (404, no existence leak)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/documents/${docId}`, headers: hdr(tok(TENANT_A, CITIZEN_B, ["citizen"])),
    });
    expect(res.statusCode).toBe(404);
  });

  it("citizen B CANNOT upload attributing the document to citizen A (403 FORBIDDEN)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/documents/upload", headers: hdr(tok(TENANT_A, CITIZEN_B, ["citizen"])),
      payload: { applicationId: APP_ID, serviceId: SERVICE_ID, docType: "id_proof", citizenId: CITIZEN },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("citizen B CANNOT list citizen A's documents by applicationId (A's rows excluded)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/documents?applicationId=${APP_ID}`, headers: hdr(tok(TENANT_A, CITIZEN_B, ["citizen"])),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ id: string }>;
    expect(data.find((d) => d.id === docId)).toBeUndefined();
  });
});

// ══════════════════════ SVC-089 IDOR — cross-citizen appeal access ═══════════
describe("SVC-089 IDOR: a citizen cannot read/spoof another citizen's appeal", () => {
  const APP_ID = "66666666-0000-4000-8000-000000000016";
  const CITIZEN_B = "99999999-0000-4000-8000-000000000016";
  let appealId: string;

  it("citizen A files an appeal (owned by A)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/appeals", headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
      payload: { applicationId: APP_ID, grounds: "unfair decision", decisionDate: isoDaysAgo(3), windowDays: 30 },
    });
    expect(res.statusCode).toBe(202);
    appealId = res.json().id;
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/appeals/${appealId}`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])) });
      return g.statusCode === 200 ? g.json() : null;
    });
  });

  it("owner citizen A CAN read their own appeal (200)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/appeals/${appealId}`, headers: hdr(tok(TENANT_A, CITIZEN, ["citizen"])),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(appealId);
  });

  it("citizen B CANNOT read citizen A's appeal (404, no existence leak)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/appeals/${appealId}`, headers: hdr(tok(TENANT_A, CITIZEN_B, ["citizen"])),
    });
    expect(res.statusCode).toBe(404);
  });

  it("citizen B CANNOT file an appeal spoofing citizen A's citizenId (403 FORBIDDEN)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/appeals", headers: hdr(tok(TENANT_A, CITIZEN_B, ["citizen"])),
      payload: { applicationId: APP_ID, citizenId: CITIZEN, grounds: "spoof attempt", decisionDate: isoDaysAgo(3), windowDays: 30 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });
});
