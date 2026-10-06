import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

function pillTone(status: string): string | null {
  const { container } = render(<StatusPill status={status} />);
  const el = container.querySelector(".pill");
  const tone = el ? [...el.classList].find((c) => c !== "pill") : undefined;
  return tone ?? null;
}

// The full pre-existing STATUS_MAP, exactly as it stood before GAP SF-04 added
// the hr/**-derived keys below. Locked in here so a future edit to the map
// can't silently change one of these tones as a side effect -- this is the
// "snapshot" the SF-04 verification step asks for.
const PRE_EXISTING_MAP: Record<string, string> = {
  active: "good",
  approved: "good",
  paid: "good",
  completed: "good",
  passed: "good",
  cleared: "good",
  open: "good",
  signed: "good",
  pending: "warn",
  "under review": "warn",
  "in progress": "warn",
  submitted: "warn",
  review: "warn",
  draft: "mut",
  inactive: "mut",
  closed: "mut",
  confirmed: "good",
  probation: "warn",
  retired: "mut",
  resigned: "mut",
  terminated: "bad",
  rejected: "bad",
  overdue: "bad",
  breached: "bad",
  failed: "bad",
  blocked: "bad",
  expired: "bad",
  success: "good",
  failure: "bad",
  connected: "good",
  unconfigured: "mut",
  "low stock": "bad",
  archived: "mut",
};

// Every key GAP SF-04 added to STATUS_MAP, verified against a real call site
// under apps/web/src/app/(app)/hr/** (incl. payroll/** and recruitment/**) --
// see StatusPill.tsx's own comments for the module each cluster came from.
const SF04_NEW_MAP: Record<string, string> = {
  present: "good",
  settled: "good",
  credited: "good",
  finalized: "good",
  disbursed: "good",
  validated: "good",
  selected: "good",
  offered: "good",
  hired: "good",
  responded: "good",
  relieved: "good",
  accepted: "good",
  processing: "warn",
  initiated: "warn",
  opened: "warn",
  registered: "warn",
  "under inquiry": "warn",
  inquiry: "warn",
  applied: "warn",
  filed: "warn",
  "late filed": "warn",
  assigned: "warn",
  computed: "warn",
  recalled: "warn",
  "half day": "warn",
  "charge memo issued": "warn",
  "inquiry appointed": "warn",
  "finding recorded": "warn",
  "pending approval": "warn",
  "appeal filed": "warn",
  "order issued": "warn",
  separated: "mut",
  disposed: "mut",
  dropped: "mut",
  "on leave": "info",
  holiday: "info",
  deputation: "info",
  scheduled: "info",
  upcoming: "info",
  "appeal decided": "info",
  suspended: "bad",
  "no show": "bad",
  disputed: "bad",
  cancelled: "bad",
  "routing failed": "bad",
  "penalty imposed": "bad",
};

describe("StatusPill", () => {
  it("renders a humanized status label when no explicit label is given", () => {
    render(<StatusPill status="active" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
  });

  // Regression coverage for the raw-enum-leak bug: Finance/Grants/Projects
  // status pills used to render the DB raw lowercase enum value verbatim
  // ("pending", "active", "na") instead of a real display label, because
  // StatusPill defaulted to the raw status string whenever a caller (most
  // call sites in the app) did not pass an explicit label prop.
  it("humanizes a plain lowercase status", () => {
    render(<StatusPill status="pending" />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("humanizes a snake_case status by replacing underscores and title-casing each word", () => {
    render(<StatusPill status="pending_approval" />);
    expect(screen.getByText("Pending Approval")).toBeInTheDocument();
  });

  it('renders the "na" three-way-match/status value as "N/A" instead of raw lowercase text', () => {
    render(<StatusPill status="na" />);
    expect(screen.getByText("N/A")).toBeInTheDocument();
    expect(screen.queryByText("na")).not.toBeInTheDocument();
  });

  it("humanizes an uppercase status consistently with its lowercase form", () => {
    render(<StatusPill status="APPROVED" />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("renders custom label when provided", () => {
    render(<StatusPill status="active" label="Approved" />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
  });

  it("applies 'good' variant for approved status", () => {
    const { container } = render(<StatusPill status="approved" />);
    expect(container.querySelector(".pill.good")).toBeInTheDocument();
  });

  it("applies 'warn' variant for pending status", () => {
    const { container } = render(<StatusPill status="pending" />);
    expect(container.querySelector(".pill.warn")).toBeInTheDocument();
  });

  it("applies 'bad' variant for rejected status", () => {
    const { container } = render(<StatusPill status="rejected" />);
    expect(container.querySelector(".pill.bad")).toBeInTheDocument();
  });

  it("applies 'mut' variant for draft status", () => {
    const { container } = render(<StatusPill status="draft" />);
    expect(container.querySelector(".pill.mut")).toBeInTheDocument();
  });

  it("applies 'info' variant for unknown status", () => {
    const { container } = render(<StatusPill status="unknown_status" />);
    expect(container.querySelector(".pill.info")).toBeInTheDocument();
  });

  it("handles case-insensitive status lookup", () => {
    const { container } = render(<StatusPill status="APPROVED" />);
    expect(container.querySelector(".pill.good")).toBeInTheDocument();
  });

  it("maps 'completed' to good", () => {
    const { container } = render(<StatusPill status="completed" />);
    expect(container.querySelector(".pill.good")).toBeInTheDocument();
  });

  it("maps 'overdue' to bad", () => {
    const { container } = render(<StatusPill status="overdue" />);
    expect(container.querySelector(".pill.bad")).toBeInTheDocument();
  });

  it("maps 'in progress' to warn", () => {
    const { container } = render(<StatusPill status="in progress" />);
    expect(container.querySelector(".pill.warn")).toBeInTheDocument();
  });

  it("maps 'closed' to mut", () => {
    const { container } = render(<StatusPill status="closed" />);
    expect(container.querySelector(".pill.mut")).toBeInTheDocument();
  });

  // --- GAP SF-04 regression lock: every tone STATUS_MAP already assigned
  // before this change must still resolve exactly the same way. If this
  // fails, an edit to STATUS_MAP changed a pre-existing key's tone as a side
  // effect of adding the new hr/** keys below.
  describe("pre-existing STATUS_MAP entries are unchanged", () => {
    it.each(Object.entries(PRE_EXISTING_MAP))("%s -> %s", (status, tone) => {
      expect(pillTone(status)).toBe(tone);
    });
  });

  // --- GAP SF-04: the "open" special case (always good/green platform-wide)
  // must survive the new inventory-based entries untouched.
  it("keeps the 'open' special case as good, case-insensitively", () => {
    expect(pillTone("open")).toBe("good");
    expect(pillTone("OPEN")).toBe("good");
    expect(pillTone("Open")).toBe("good");
  });

  // --- GAP SF-04: every newly-added status key gets its verified tone.
  describe("GAP SF-04 newly-added status keys", () => {
    it.each(Object.entries(SF04_NEW_MAP))("%s -> %s", (status, tone) => {
      expect(pillTone(status)).toBe(tone);
    });
  });

  // --- GAP SF-04: case/underscore/hyphen/camelCase normalization. Real API
  // values are snake_case; these variants must all resolve identically.
  describe("normalizeStatusKey handles separator and case variants alike", () => {
    it.each([
      ["pending_approval", "pendingApproval", "pending-approval", "PENDING_APPROVAL", "pending approval"],
      ["half_day", "halfDay", "half-day", "HALF_DAY", "half day"],
      ["no_show", "noShow", "no-show", "NO_SHOW", "no show"],
      ["routing_failed", "routingFailed", "routing-failed", "ROUTING_FAILED", "routing failed"],
    ])("%s / %s / %s / %s all resolve the same as %s", (...variants) => {
      const tones = variants.map((v) => pillTone(v));
      expect(new Set(tones).size).toBe(1);
      expect(tones[0]).not.toBeNull();
    });

    // The concrete bug this fixes: STATUS_MAP already had "in progress" (with
    // a space) mapped to warn, but the real API/UI value is snake_case
    // "in_progress" (goals, onboarding, grievance all use it) -- before
    // normalization, that never matched and silently fell back to "info".
    it("matches the pre-existing 'in progress' entry from the snake_case API value 'in_progress'", () => {
      expect(pillTone("in_progress")).toBe("warn");
      expect(pillTone("in_progress")).toBe(pillTone("in progress"));
    });

    it("still resolves plain single-word statuses unaffected by normalization", () => {
      expect(pillTone("approved")).toBe("good");
      expect(pillTone("APPROVED")).toBe("good");
    });

    it("still falls back to info for a truly unknown status after normalization", () => {
      expect(pillTone("some_unmapped_status")).toBe("info");
    });
  });
});

// --- GAP-HR-TRAINING-NOMINATIONS-01: nominated/waitlisted/attended are real
// hrms_nominations.status values (training/schema.ts's CHECK constraint,
// training-admin/routes.ts's approve/reject logic) that had no STATUS_MAP
// entry at all before this change, so they fell back to the neutral "info"
// tone -- "nominated" (awaiting HR review) reads as an actionable "warn",
// matching how this same file already treats other awaiting-review states
// ("pending", "submitted", "under review").
describe("GAP-HR-TRAINING-NOMINATIONS-01: training nomination status keys", () => {
  it.each([
    ["nominated", "warn"],
    ["waitlisted", "info"],
    ["attended", "info"],
  ])("%s -> %s", (status, tone) => {
    expect(pillTone(status)).toBe(tone);
  });
});

// GAP-FINANCE-TREASURY-CHEQUES-01
describe("StatusPill cheque register statuses", () => {
  it.each([
    ["bounced", "bad"],
    ["stale", "bad"],
    ["presented", "warn"],
    ["issued", "info"],
    ["cleared", "good"],
  ])("%s renders the %s tone", (status, tone) => {
    expect(pillTone(status)).toBe(tone);
  });

  it.each([
    ["under_construction", "warn"],
    ["capitalized", "good"],
    ["scheduled", "info"],
  ])("%s has a deliberate tone (GAP-ASSETS-PROJECTS-06 / MAINTENANCE-03)", (status, tone) => {
    expect(pillTone(status)).toBe(tone);
  });

  it("an explicit variant overrides the global map (GAP-FINANCE-AUDIT-PARAS-01)", () => {
    const { container } = render(<StatusPill status="open" variant="bad" />);
    const el = container.querySelector(".pill");
    expect(el?.classList.contains("bad")).toBe(true);
    expect(el?.classList.contains("good")).toBe(false);
    expect(el?.textContent).toBe("Open");
  });
});

describe("platform admin status keys (GAP-ADMIN-ENTITLEMENTS-06 / GAP-ADMIN-GATEWAYS-04)", () => {
  it.each([
    ["revoked", "bad"],
    ["down", "bad"],
    ["degraded", "warn"],
    ["standby", "mut"],
  ])("%s renders the %s pill", (status, variant) => {
    const { container } = render(<StatusPill status={status} />);
    expect(container.querySelector(`.pill.${variant}`)).toBeInTheDocument();

  });
});
// GAP-FINANCE-PAYMENTS-03 / PAYMENTS-DETAIL-07 / PERIOD-CLOSE-05
describe("StatusPill payments + period-close statuses", () => {
  it.each([
    ["queued", "mut"],
    ["Queued", "mut"],
    ["Pending Approval", "warn"],
    ["pending_approval", "warn"],
    ["Failed", "bad"],
    ["soft_close", "warn"],
    ["soft close", "warn"],
    ["hard_close", "bad"],
    ["open", "good"],
  ])("%s renders the %s tone", (status, tone) => {
    expect(pillTone(status)).toBe(tone);
  });

  it("soft- and hard-closed are visually distinct", () => {
    expect(pillTone("soft_close")).not.toBe(pillTone("hard_close"));
  });

  it("humanizes the label for a period status", () => {
    const { container } = render(<StatusPill status="hard_close" />);
    expect(container.querySelector(".pill")?.textContent).toBe("Hard Close");
  });
});

// GAP-FINANCE-BUDGET-OUTCOME-BUDGET-04 / DEMAND-GRANTS-05 / FORMULATION-05:
// every value the finance-service budget module can emit has an explicit tone.
describe("budget module status vocabularies", () => {
  it.each([
    // outcome indicator lifecycle (outcome-domain OutcomeStatus)
    ["draft", "mut"], ["active", "good"], ["evaluated", "info"], ["closed", "mut"],
    // demand-for-grants status (finance_demands.status defaults to draft)
    // budget estimate rows (Formulation tabs)
    ["pending", "warn"], ["submitted", "warn"], ["approved", "good"], ["rejected", "bad"],
  ])("%s renders the %s tone", (status, tone) => {
    expect(pillTone(status)).toBe(tone);
  });
});



describe("recruitment status keys (GAP-RECRUITMENT-TALENT-POOL-04 / GAP-RECRUITMENT-HOME-04)", () => {
  it.each([
    ["not_selected", "mut", "Not Selected"],
    ["published", "good", "Published"],
    ["unpublished", "mut", "Unpublished"],
  ])("%s renders the %s pill labelled %s", (status, variant, label) => {
    const { container } = render(<StatusPill status={status} />);
    const el = container.querySelector(`.pill.${variant}`);
    expect(el).toBeInTheDocument();
    expect(el?.textContent?.toLowerCase()).toBe(label.toLowerCase());
  });
});

// GAP-ADMIN-API-MONITORING-05 / GAP-ADMIN-EDITIONS-06: monitoring + edition statuses used to
// all fall through to the neutral "info" tone, so Healthy / Degraded / Down looked identical.
describe("platform monitoring and edition statuses", () => {
  it.each([
    ["healthy", "good"],
    ["degraded", "warn"],
    ["down", "bad"],
    ["unhealthy", "bad"],
    ["unknown", "mut"],
    ["maintenance", "mut"],
    ["deprecated", "mut"],
    ["trusted", "good"],
  ])("%s -> %s", (status, tone) => {
    expect(pillTone(status)).toBe(tone);
  });
});

// GAP-CRM-SERVICE-REQUESTS-04: service-request lifecycle words must not share
// the neutral "info" blue. "in_progress" (underscore) normalises to "in
// progress" (warn); "resolved" is a successful terminal state (good). Note:
// "cancelled" is deliberately LEFT at the app-wide "bad" tone (recruitment /
// finance callers depend on it) rather than recoloured to "mut" for this one
// screen — a conservative choice recorded in the M09 report.
describe("CRM service-request statuses", () => {
  it.each([
    ["in_progress", "warn"],
    ["in progress", "warn"],
    ["resolved", "good"],
    ["open", "good"],
    ["pending", "warn"],
  ])("%s -> %s", (status, tone) => {
    expect(pillTone(status)).toBe(tone);
  });
});

// GAP-BILLING-GSTN-07 / GAP-BILLING-INVOICES-03 / GAP-BILLING-INVOICES-DETAIL-07:
// invoice + GST return / e-invoice status words. "generated"/"partially paid"/
// "trial" previously had no key and fell through to the neutral "info" pill;
// these assertions fail on the old STATUS_MAP. The already-mapped words are
// locked in so a future edit can't recolour them.
describe("billing invoice + GSTN return status keys", () => {
  it.each([
    ["issued", "info"],
    ["cancelled", "bad"],
    ["filed", "warn"],
    ["processing", "warn"],
    ["suspended", "bad"],
    ["generated", "good"],
    ["partially_paid", "warn"],
    ["partially paid", "warn"],
    ["trial", "warn"],
  ])("%s -> %s", (status, tone) => {
    expect(pillTone(status)).toBe(tone);
  });

  it("an issued and a cancelled invoice render visually distinct pills", () => {
    expect(pillTone("issued")).not.toBe(pillTone("cancelled"));
  });

  it("a generated IRN is not the neutral info fallback", () => {
    expect(pillTone("generated")).toBe("good");
    expect(pillTone("generated")).not.toBe("info");
  });
});

// GAP-WORKFLOW-DEFINITIONS-03: a workflow definition version that is
// "deployed" is live and must read green, not the neutral "info" fallback.
describe("workflow definition status 'deployed'", () => {
  it("maps 'deployed' to the green 'good' tone (same as 'active')", () => {
    expect(pillTone("deployed")).toBe("good");
    expect(pillTone("active")).toBe("good");
  });
});
