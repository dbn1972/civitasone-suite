import { describe, it, expect } from "vitest";
import {
  knowledgeDocStatusLabel,
  knowledgeDocStatusPill,
  policyStatusLabel,
  policyStatusPill,
  recordStatusLabel,
  recordStatusPill,
  categorySegment,
} from "./statusLabels";

describe("knowledgeDocStatusLabel", () => {
  it("maps approved to Published", () => expect(knowledgeDocStatusLabel("approved")).toBe("Published"));
  it("maps under_review to Under review", () => expect(knowledgeDocStatusLabel("under_review")).toBe("Under review"));
  it("maps draft to Draft", () => expect(knowledgeDocStatusLabel("draft")).toBe("Draft"));
  it("maps archived to Archived", () => expect(knowledgeDocStatusLabel("archived")).toBe("Archived"));
  it("title-cases unknown", () => expect(knowledgeDocStatusLabel("some_thing")).toBe("Some thing"));
});

describe("knowledgeDocStatusPill", () => {
  it("approved -> approved", () => expect(knowledgeDocStatusPill("approved")).toBe("approved"));
  it("under_review -> pending", () => expect(knowledgeDocStatusPill("under_review")).toBe("pending"));
  it("unknown -> mut", () => expect(knowledgeDocStatusPill("xyz")).toBe("mut"));
});

describe("policyStatusLabel", () => {
  it("maps draft to Draft", () => expect(policyStatusLabel("draft")).toBe("Draft"));
  it("maps under_review to Under review", () => expect(policyStatusLabel("under_review")).toBe("Under review"));
  it("maps published to Published", () => expect(policyStatusLabel("published")).toBe("Published"));
  it("maps superseded to Superseded", () => expect(policyStatusLabel("superseded")).toBe("Superseded"));
  it("maps withdrawn to Withdrawn", () => expect(policyStatusLabel("withdrawn")).toBe("Withdrawn"));
});

describe("policyStatusPill", () => {
  it("published -> active", () => expect(policyStatusPill("published")).toBe("active"));
  it("superseded -> archived", () => expect(policyStatusPill("superseded")).toBe("archived"));
  it("withdrawn -> rejected", () => expect(policyStatusPill("withdrawn")).toBe("rejected"));
});

describe("recordStatusLabel (GAP-KNOWLEDGE-RECORDS-01)", () => {
  it("maps disposed to Disposed (not 'Weeding due')", () => {
    expect(recordStatusLabel("disposed")).toBe("Disposed");
  });
  it("maps transferred to Transferred (not 'Review')", () => {
    expect(recordStatusLabel("transferred")).toBe("Transferred");
  });
  it("maps archived to Archived", () => {
    expect(recordStatusLabel("archived")).toBe("Archived");
  });
  it("maps inactive to Inactive", () => {
    expect(recordStatusLabel("inactive")).toBe("Inactive");
  });
});

describe("recordStatusPill (GAP-KNOWLEDGE-RECORDS-01/06)", () => {
  it("disposed -> archived (not rejected)", () => {
    expect(recordStatusPill("disposed")).toBe("archived");
  });
  it("inactive -> pending", () => {
    expect(recordStatusPill("inactive")).toBe("pending");
  });
  it("archived -> archived", () => {
    expect(recordStatusPill("archived")).toBe("archived");
  });
});

describe("categorySegment (GAP-KNOWLEDGE-REPOSITORY-07)", () => {
  it("matches 'Circular' (singular) as Circulars", () => {
    expect(categorySegment("Circular")).toBe("Circulars");
  });
  it("matches 'Circulars' as Circulars", () => {
    expect(categorySegment("Circulars")).toBe("Circulars");
  });
  it("matches 'Policy' as Policies", () => {
    expect(categorySegment("Policy")).toBe("Policies");
  });
  it("matches 'Policies' as Policies", () => {
    expect(categorySegment("Policies")).toBe("Policies");
  });
  it("matches 'Notification' as Notifications", () => {
    expect(categorySegment("Notification")).toBe("Notifications");
  });
  it("matches 'General Circular' as Circulars", () => {
    expect(categorySegment("General Circular")).toBe("Circulars");
  });
  it("falls back to Other for unknown", () => {
    expect(categorySegment("Memo")).toBe("Other");
  });
});
