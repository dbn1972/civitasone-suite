/**
 * P0-1..P0-5 cross-citizen authz tests (inject, HS256 test JWTs, real DB).
 *
 * For each module: a `citizen` reading/mutating ANOTHER citizen's record by id
 * must get 404; the OWNER citizen and OFFICER must get 200/202.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerGrievanceConsumers } from "../src/modules/grievance/consumer.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import { registerRtiConsumers } from "../src/modules/rti/consumer.js";
import { registerHelpdeskConsumers } from "../src/modules/helpdesk/consumer.js";
import { registerPortalConsumers } from "../src/modules/portal/consumer.js";

registerPortalConsumers(queue);
registerGrievanceConsumers(queue);
registerApplicationConsumers(queue);
registerRtiConsumers(queue);
registerHelpdeskConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000a1";
const OWNER  = "11111111-1111-4000-8000-0000000000a1"; // citizen actorId == own profile id
const OTHER  = "22222222-2222-4000-8000-0000000000a1"; // a different citizen
const OFFICER = "99999999-9999-4000-8000-0000000000a1";

function citizenTok(sub: string) {
  return signToken({ sub, tid: TENANT, roles: ["citizen"], sid: "s" }, SECRET);
}
function officerTok() {
  return signToken({ sub: OFFICER, tid: TENANT, roles: ["citizen_officer"], sid: "s" }, SECRET);
}

const app = await buildApp();
const ofH = { authorization: `Bearer ${officerTok()}`, "content-type": "application/json" };
const ownerH = { authorization: `Bearer ${citizenTok(OWNER)}`, "content-type": "application/json" };
const otherH = { authorization: `Bearer ${citizenTok(OTHER)}`, "content-type": "application/json" };

async function post(url: string, body: any, headers: any) {
  const r = await app.inject({ method: "POST", url, headers, payload: body });
  return r;
}
async function get(url: string, headers: any) {
  return app.inject({ method: "GET", url, headers });
}

// helper: poll until a GET as officer returns 200 (consumer processed)
async function waitReady(url: string) {
  for (let i = 0; i < 40; i++) {
    const r = await get(url, ofH);
    if (r.statusCode === 200) return;
    await new Promise((res) => setTimeout(res, 50));
  }
}

let grievanceId = "";
let applicationId = "";
let rtiId = "";
let ticketId = "";

beforeAll(async () => {
  // seed a service so application submit resolves SLA (not strictly required)
  // Grievance owned by OWNER
  const g = await post("/v1/citizen/grievances",
    { citizenId: OWNER, category: "water", subject: "leak", description: "desc" }, ofH);
  grievanceId = JSON.parse(g.body).id;
  await waitReady(`/v1/citizen/grievances/${grievanceId}`);

  // RTI owned by OWNER
  const r = await post("/v1/citizen/rti",
    { citizenId: OWNER, subject: "info", description: "give docs", cpioRef: "33333333-3333-4000-8000-0000000000a1" }, ofH);
  rtiId = JSON.parse(r.body).id;
  await waitReady(`/v1/citizen/rti/${rtiId}`);

  // Ticket owned by OWNER
  const t = await post("/v1/citizen/tickets",
    { citizenId: OWNER, subject: "help", description: "stuck", priority: "medium", channel: "web" }, ofH);
  ticketId = JSON.parse(t.body).id;
  await waitReady(`/v1/citizen/tickets/${ticketId}`);

  // Application owned by OWNER (serviceId arbitrary uuid; submit is async)
  const a = await post("/v1/citizen/applications",
    { citizenId: OWNER, serviceId: "44444444-4444-4000-8000-0000000000a1", serviceType: "cert" }, ofH);
  applicationId = JSON.parse(a.body).id;
  await waitReady(`/v1/citizen/applications/${applicationId}`);
}, 30000);

afterAll(async () => {
  // cleanup seeded rows
  await sqlClient`DELETE FROM grievance.citizen_grievance_actions WHERE grievance_id = ${grievanceId}`.catch(() => {});
  await sqlClient`DELETE FROM grievance.citizen_grievances WHERE id = ${grievanceId}`.catch(() => {});
  await sqlClient`DELETE FROM rti.citizen_rti_appeals WHERE rti_id = ${rtiId}`.catch(() => {});
  await sqlClient`DELETE FROM rti.citizen_rti_requests WHERE id = ${rtiId}`.catch(() => {});
  await sqlClient`DELETE FROM helpdesk.citizen_ticket_notes WHERE ticket_id = ${ticketId}`.catch(() => {});
  await sqlClient`DELETE FROM helpdesk.citizen_tickets WHERE id = ${ticketId}`.catch(() => {});
  await sqlClient`DELETE FROM application.citizen_app_documents WHERE application_id = ${applicationId}`.catch(() => {});
  await sqlClient`DELETE FROM application.citizen_status_history WHERE application_id = ${applicationId}`.catch(() => {});
  await sqlClient`DELETE FROM application.citizen_applications WHERE id = ${applicationId}`.catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("grievance cross-citizen authz", () => {
  it("owner reads own → 200", async () => {
    expect((await get(`/v1/citizen/grievances/${grievanceId}`, ownerH)).statusCode).toBe(200);
  });
  it("other citizen reads → 404", async () => {
    expect((await get(`/v1/citizen/grievances/${grievanceId}`, otherH)).statusCode).toBe(404);
  });
  it("officer reads → 200", async () => {
    expect((await get(`/v1/citizen/grievances/${grievanceId}`, ofH)).statusCode).toBe(200);
  });
  it("other citizen reopen → 404", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/citizen/grievances/${grievanceId}/reopen`, headers: otherH, payload: { reason: "x" } });
    expect(r.statusCode).toBe(404);
  });
});

describe("rti cross-citizen authz", () => {
  it("owner reads own → 200", async () => {
    expect((await get(`/v1/citizen/rti/${rtiId}`, ownerH)).statusCode).toBe(200);
  });
  it("other citizen reads → 404", async () => {
    expect((await get(`/v1/citizen/rti/${rtiId}`, otherH)).statusCode).toBe(404);
  });
  it("officer reads → 200", async () => {
    expect((await get(`/v1/citizen/rti/${rtiId}`, ofH)).statusCode).toBe(200);
  });
  it("other citizen appeal → 404", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/citizen/rti/${rtiId}/appeal`, headers: otherH, payload: { appealType: "first", grounds: "x" } });
    expect(r.statusCode).toBe(404);
  });
});

describe("helpdesk cross-citizen authz", () => {
  it("owner reads own → 200", async () => {
    expect((await get(`/v1/citizen/tickets/${ticketId}`, ownerH)).statusCode).toBe(200);
  });
  it("other citizen reads → 404", async () => {
    expect((await get(`/v1/citizen/tickets/${ticketId}`, otherH)).statusCode).toBe(404);
  });
  it("officer reads → 200", async () => {
    expect((await get(`/v1/citizen/tickets/${ticketId}`, ofH)).statusCode).toBe(200);
  });
});

describe("application cross-citizen authz", () => {
  it("owner reads own → 200", async () => {
    expect((await get(`/v1/citizen/applications/${applicationId}`, ownerH)).statusCode).toBe(200);
  });
  it("other citizen reads → 404", async () => {
    expect((await get(`/v1/citizen/applications/${applicationId}`, otherH)).statusCode).toBe(404);
  });
  it("officer reads → 200", async () => {
    expect((await get(`/v1/citizen/applications/${applicationId}`, ofH)).statusCode).toBe(200);
  });
  it("other citizen doc-upload → 404", async () => {
    const r = await post(`/v1/citizen/applications/${applicationId}/documents`, { docType: "id_proof" }, otherH);
    expect(r.statusCode).toBe(404);
  });
});
