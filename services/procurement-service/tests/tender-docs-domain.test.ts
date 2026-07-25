import { describe, it, expect } from "vitest";
import {
  nextSeq, nextDocVersion, assertPrebidTransition, assertRepublishable,
  assertTenderAmendable, TenderDocsDomainError,
} from "../src/modules/tender/docs-domain.js";

describe("SVC-043 tender-docs domain — versioning", () => {
  it("nextSeq assigns monotonically increasing corrigendum numbers", () => {
    expect(nextSeq(0)).toBe(1);
    expect(nextSeq(2)).toBe(3);
    expect(nextSeq(null)).toBe(1);
  });

  it("nextDocVersion increments document version on supersede", () => {
    expect(nextDocVersion(undefined)).toBe(1); // first upload
    expect(nextDocVersion(1)).toBe(2);         // supersedes v1
    expect(nextDocVersion(3)).toBe(4);
  });
});

describe("SVC-043 tender-docs domain — pre-bid query status machine", () => {
  it("open -> answered -> published", () => {
    expect(() => assertPrebidTransition("open", "answered")).not.toThrow();
    expect(() => assertPrebidTransition("answered", "published")).not.toThrow();
  });

  it("rejects illegal jumps", () => {
    expect(() => assertPrebidTransition("open", "published")).toThrow(TenderDocsDomainError);
    expect(() => assertPrebidTransition("published", "answered")).toThrow();
  });
});

describe("SVC-043 tender-docs domain — corrigendum republish + amendability", () => {
  it("blocks a second republish", () => {
    expect(() => assertRepublishable(false)).not.toThrow();
    expect(() => assertRepublishable(true)).toThrow(/ALREADY_REPUBLISHED/);
  });

  it("blocks corrigenda on awarded/closed/cancelled tenders", () => {
    expect(() => assertTenderAmendable("published")).not.toThrow();
    expect(() => assertTenderAmendable("draft")).not.toThrow();
    expect(() => assertTenderAmendable("awarded")).toThrow(/TENDER_NOT_AMENDABLE/);
    expect(() => assertTenderAmendable("closed")).toThrow(/TENDER_NOT_AMENDABLE/);
  });
});
