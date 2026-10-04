/**
 * GAP-FINANCE-PFMS-01 -- the sign and list routes (real DB, sandbox mock signer).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";

// ── routes ─────────────────────────────────────────────────────────────────
vi.mock("../src/modules/pfms/dsc-client.js", async (orig) => {
  const real = await orig<typeof import("../src/modules/pfms/dsc-client.js")>();
  const { createDscSigner } = await import("@civitasone/connector-framework/ports");
  return {
    ...real,
    resolveDscSigner: async () => {
      const signer = createDscSigner({ providerKey: "dsc_usb_token_bridge", providerName: "USB token bridge", environment: "sandbox", config: {}, secrets: {} });
      return { signer, providerKey: "dsc_usb_token_bridge", environment: "sandbox" as const, mock: true, signerRef: "slot-1" };
    },
  };
});

import { withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import * as repo from "../src/modules/pfms/repo.js";
import { registerPfmsConsumers } from "../src/modules/pfms/consumer.js";
import { buildApp } from "../src/app.js";
import { bearer, drain } from "./_fp02.js";

const T = randomUUID();
const OFFICER = "00000000-0f03-4000-8000-0000000000a1";
const fin = () => bearer(T, OFFICER, ["finance_officer"]);

describe("POST /v1/finance/pfms/:id/sign and GET /batches (real DB)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    registerPfmsConsumers(queue);
    await queue.start();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seed = async (status = "pending", channel = "treasury_batch") => {
    const id = randomUUID();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await withTenantScope(db, T, (tx: any) => repo.insertPfmsBatch(tx, {
      id, tenantId: T, pfmsId: `PFMS-${id.slice(0, 8)}`, type: "salary", amountMinor: 500n, currency: "INR", beneficiaryCount: 0, agencyCode: "AG",
      submissionStatus: status, status: "pending", channel, createdBy: OFFICER, updatedBy: OFFICER,
    }));
    return id;
  };
  const sign = (id: string, payload: unknown = {}) => app.inject({ method: "POST", url: `/v1/finance/pfms/${id}/sign`, headers: fin(), payload: payload as object });
  const listRow = async (id: string) => (await app.inject({ method: "GET", url: "/v1/finance/pfms/batches", headers: fin() })).json().data.find((b: { id: string }) => b.id === id);

  it("a pasted signature (certificateRef / signaturePayload) is refused: the signature only ever comes from the DSC signer", async () => {
    const id = await seed();
    const res = await sign(id, { certificateRef: "CERT", signaturePayload: "forged" });
    expect(res.statusCode).toBe(400);
    expect((await listRow(id)).signing.status).toBe("unsigned");
  });

  it("signing returns 202, then the list shows signed + certificate info + the mock label, and never the signature value", async () => {
    const id = await seed();
    expect((await listRow(id)).signing).toMatchObject({ status: "unsigned", certificateSerial: null });
    const res = await sign(id);
    expect(res.statusCode).toBe(202);
    await drain();
    const row = await listRow(id);
    expect(row.submissionStatus).toBe("signed");
    expect(row.signing).toMatchObject({ status: "signed", mock: true, environment: "sandbox", signerRef: "slot-1" });
    expect(row.signing.certificateSerial).toMatch(/^MOCK-/);
    expect(row.signing.batchDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("dscSignature");
    expect(row.signing.signature).toBeUndefined();
  });

  it("an already-signed batch answers 202 without re-signing; a submitted batch is a 409; an e-Kuber row is a 400", async () => {
    const id = await seed();
    await sign(id); await drain();
    expect((await sign(id)).statusCode).toBe(202);
    const sent = await seed("file_sent");
    const r = await sign(sent);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("INVALID_STATE");
    const ek = await seed("completed", "ekuber_adapter");
    expect((await sign(ek)).json().code).toBe("INVALID_CHANNEL");
  });

  it("a reader (audit_officer) cannot sign (403)", async () => {
    const id = await seed();
    const res = await app.inject({ method: "POST", url: `/v1/finance/pfms/${id}/sign`, headers: bearer(T, OFFICER, ["audit_officer"]), payload: {} });
    expect(res.statusCode).toBe(403);
  });
});
