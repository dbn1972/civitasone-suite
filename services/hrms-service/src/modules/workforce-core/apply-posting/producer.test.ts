/**
 * applyPosting — producer ACL unit tests (SmartTransfer OS, ST-M01-15).
 *
 * Fast, no-DB proof that the scoped service credential for the
 * SmartTransfer→HRMS command path admits ONLY the frozen contract owner and
 * the hrms-service in-service affordance, and refuses everything else. The
 * contract owner is read from the registered `hrms.posting.apply` contract so
 * the allow-list cannot drift from the frozen definition (D-ST-19). All
 * producer labels are plain runtime strings — no secret-shaped literal.
 */
import { describe, it, expect } from "vitest";
// Register the SmartTransfer / hrms.posting contract pack in the module-level
// registry via the declared "./contracts" subpath export. getContract read
// from the same module graph that producer.ts reads (one singleton registry).
import { getContract, smartTransferContractPack } from "@civitasone/events/contracts";
import {
  APPLY_POSTING_TOPIC,
  IN_SERVICE_PRODUCER,
  contractOwner,
  allowedProducers,
  isAllowedProducer,
} from "./producer.js";

describe("applyPosting producer ACL", () => {
  it("reads the frozen contract owner from the registered contract", () => {
    expect(APPLY_POSTING_TOPIC).toBe("hrms.posting.apply");
    // Touch the pack so it is registered, then read the frozen owner — the
    // single authorised cross-service publisher (D-ST-19). Our ACL derives
    // from it, not a hard-coded literal.
    expect(Array.isArray(smartTransferContractPack)).toBe(true);
    expect(getContract("hrms.posting.apply")?.owner).toBe(
      "smarttransfer-service",
    );
    expect(contractOwner()).toBe("smarttransfer-service");
  });

  it("admits exactly the contract owner and the in-service affordance", () => {
    const allowed = allowedProducers();
    expect(allowed.has("smarttransfer-service")).toBe(true);
    expect(allowed.has(IN_SERVICE_PRODUCER)).toBe(true);
    expect(allowed.size).toBe(2);
  });

  it("accepts the authorised producers", () => {
    expect(isAllowedProducer("smarttransfer-service")).toBe(true);
    expect(isAllowedProducer("hrms-service")).toBe(true);
  });

  it("refuses any other producer, including blank, undefined and non-strings", () => {
    for (const bad of [
      "payroll-service",
      "leave-service",
      "estab-service",
      "smarttransfer", // the short SERVICE label, not the service name — refused
      "hrms", // the short SERVICE label — refused
      "",
      " smarttransfer-service", // whitespace — exact match only
      undefined,
      null,
      123,
      {},
    ]) {
      expect(isAllowedProducer(bad), `producer ${JSON.stringify(bad)}`).toBe(
        false,
      );
    }
  });
});
