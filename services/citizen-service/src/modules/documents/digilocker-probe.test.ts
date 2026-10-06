import { describe, it, expect } from "vitest";
import { isDigiLockerConfigured, digiLockerFetch } from "./domain.js";
import { digilockerFetchBody } from "./validators.js";

describe("GAP-CITIZEN-DOCUMENTS-02 — DigiLocker configured probe + consent", () => {
  it("isDigiLockerConfigured is false with no provider credentials (powers the probe route)", () => {
    expect(isDigiLockerConfigured({})).toBe(false);
    expect(isDigiLockerConfigured({ DIGILOCKER_CLIENT_ID: "", DIGILOCKER_CLIENT_SECRET: "" })).toBe(false);
  });

  it("isDigiLockerConfigured is true only when both id and secret are present", () => {
    expect(
      isDigiLockerConfigured({ DIGILOCKER_CLIENT_ID: "id", DIGILOCKER_CLIENT_SECRET: "secret" }),
    ).toBe(true);
    expect(isDigiLockerConfigured({ DIGILOCKER_CLIENT_ID: "id" })).toBe(false);
  });

  it("digiLockerFetch never fabricates source-verified success when unconfigured", () => {
    const r = digiLockerFetch("digilocker://id_proof", {});
    expect(r.configured).toBe(false);
    expect(r.providerStatus).toBe("provider_unconfigured");
    expect(r.authenticity).toBe("unverified");
  });

  it("the digilocker-fetch body accepts an optional DPDP consent boolean (not stripped as unknown)", () => {
    const parsed = digilockerFetchBody.parse({
      serviceId: "11111111-1111-4111-8111-111111111111",
      docType: "id_proof",
      docUri: "digilocker://id_proof",
      consent: true,
    });
    expect(parsed.consent).toBe(true);
  });

  it("the consent flag remains optional for backward compatibility", () => {
    const parsed = digilockerFetchBody.parse({
      serviceId: "11111111-1111-4111-8111-111111111111",
      docType: "id_proof",
      docUri: "digilocker://id_proof",
    });
    expect(parsed.consent).toBeUndefined();
  });
});
