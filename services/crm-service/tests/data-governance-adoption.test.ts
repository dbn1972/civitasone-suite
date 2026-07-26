/**
 * CAP-085 adoption proof — crm-service consumes @civitasone/data-governance.
 * The contact masking policy is declared once and applied by role; PII roles
 * see raw email/phone, everyone else sees the masked form.
 */
import { describe, it, expect } from "vitest";
import { CONTACT_MASKING_POLICY, CONTACT_PII_ROLES, maskContactRecord } from "../src/shared/data-governance.js";

describe("crm data-governance adoption", () => {
  const contact = { id: "c1", name: "Asha Rao", email: "asha@techcorp.in", phone: "9998887777" };

  it("masks PII for non-privileged roles (matches crm's canonical format)", () => {
    const masked = maskContactRecord(contact, ["crm_user"]);
    expect(masked.name).toBe("Asha Rao");        // not in policy → untouched
    expect(masked.email).toBe("a***@techcorp.in");
    expect(masked.phone).toBe("******7777");
  });

  it("reveals PII to privileged roles", () => {
    const raw = maskContactRecord(contact, CONTACT_PII_ROLES);
    expect(raw.email).toBe("asha@techcorp.in");
    expect(raw.phone).toBe("9998887777");
  });

  it("defaults to fully masked with no roles", () => {
    expect(maskContactRecord(contact).email).toBe("a***@techcorp.in");
  });

  it("policy declares email + phone rules", () => {
    expect(Object.keys(CONTACT_MASKING_POLICY).sort()).toEqual(["email", "phone"]);
  });
});
