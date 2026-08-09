import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WebhookSubscriptionsBuilder, type WebhookRow } from "./WebhookSubscriptionsBuilder";
import { GovernanceLinkageBuilder } from "./GovernanceLinkageBuilder";
import { OfficeOverridesBuilder, type OfficeOverrideRow } from "./OfficeOverridesBuilder";
import { RenewalPolicyBuilder, type RenewalPolicyValue } from "./RenewalPolicyBuilder";

/* ── FN-30 ─────────────────────────────────────────────────────────────── */

describe("FN-30 WebhookSubscriptionsBuilder", () => {
  const row: WebhookRow = {
    id: "police",
    url: "https://police.odisha.gov.in/hook",
    events: ["application.issued"],
    active: true,
    secretConfigured: true,
  };

  it("never renders a stored secret, only that one is set", () => {
    // The API redacts it, so there is nothing to render — and a field that could
    // render one would be a place for it to be read off a screen.
    const { container } = render(<WebhookSubscriptionsBuilder value={[row]} onChange={() => {}} />);
    const secretInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(secretInput.value).toBe("");
    expect(secretInput.placeholder).toMatch(/type to replace/i);
    expect(screen.getByText(/never shown again/i)).toBeTruthy();
  });

  it("asks for a secret on a subscription that has none", () => {
    render(<WebhookSubscriptionsBuilder value={[{ ...row, secretConfigured: false }]} onChange={() => {}} />);
    expect(screen.getByText(/verify the callback really came from us/i)).toBeTruthy();
  });

  it("warns when a subscription would receive nothing", () => {
    render(<WebhookSubscriptionsBuilder value={[{ ...row, events: [] }]} onChange={() => {}} />);
    expect(screen.getByText(/at least one event/i)).toBeTruthy();
  });

  it("says the payload carries no applicant data", () => {
    render(<WebhookSubscriptionsBuilder value={[]} onChange={() => {}} />);
    expect(screen.getByText(/never contains form answers or applicant identity/i)).toBeTruthy();
  });

  it("toggles an event without dropping the others", () => {
    const onChange = vi.fn();
    render(<WebhookSubscriptionsBuilder value={[{ ...row, events: ["application.issued"] }]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("rejected"));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ events: ["application.issued", "application.rejected"] }),
    ]);
  });
});

/* ── FN-27 / FN-28 / FN-18 ─────────────────────────────────────────────── */

describe("FN-27/28 GovernanceLinkageBuilder", () => {
  const noop = () => {};
  const props = {
    appeal: null,
    rti: null,
    locales: ["en", "or"],
    onAppealChange: noop,
    onRtiChange: noop,
    onLocalesChange: noop,
  };

  it("hides the appellate field until appeals are switched on", () => {
    const { rerender } = render(<GovernanceLinkageBuilder {...props} />);
    expect(screen.queryByText(/Appellate authority/i)).toBeNull();

    rerender(<GovernanceLinkageBuilder {...props} appeal={{ appealable: true }} />);
    expect(screen.getByText(/Appellate authority/i)).toBeTruthy();
    // Says why it is mandatory, at the point of the decision.
    expect(screen.getByText(/dead end for the citizen/i)).toBeTruthy();
  });

  it("hides the PIO field until RTI publication is switched on", () => {
    const { rerender } = render(<GovernanceLinkageBuilder {...props} />);
    expect(screen.queryByText(/Public Information Officer/i)).toBeNull();

    rerender(<GovernanceLinkageBuilder {...props} rti={{ published: true }} />);
    expect(screen.getByText(/Public Information Officer/i)).toBeTruthy();
  });

  it("switching appeals off records the decision rather than clearing the block", () => {
    // null means "never configured"; {appealable:false} means "considered and declined".
    const onAppealChange = vi.fn();
    render(<GovernanceLinkageBuilder {...props} appeal={{ appealable: true }} onAppealChange={onAppealChange} />);
    fireEvent.click(screen.getByLabelText(/can be appealed/i));
    expect(onAppealChange).toHaveBeenCalledWith({ appealable: false });
  });

  it("parses a comma-separated locale list", () => {
    const onLocalesChange = vi.fn();
    render(<GovernanceLinkageBuilder {...props} onLocalesChange={onLocalesChange} />);
    fireEvent.change(screen.getByDisplayValue("en, or"), { target: { value: "en, hi , or " } });
    expect(onLocalesChange).toHaveBeenCalledWith(["en", "hi", "or"]);
  });

  it("frames the GIGW bilingual rule as a warning, not a block", () => {
    render(<GovernanceLinkageBuilder {...props} />);
    expect(screen.getByText(/not a block/i)).toBeTruthy();
  });
});

/* ── FN-22 ─────────────────────────────────────────────────────────────── */

describe("FN-22 OfficeOverridesBuilder", () => {
  const ZONE_A = "aaaaaaaa-0000-4000-8000-00000000000a";

  it("states what an office may not vary", () => {
    const { container } = render(
      <OfficeOverridesBuilder value={[]} offeringOfficeIds={[]} onChange={() => {}} />,
    );
    const caveat = screen.getByText(/Not variable per office/i).closest("p");
    // All four immutables named together, so the boundary is unambiguous.
    expect(caveat?.textContent).toMatch(/intake form/i);
    expect(caveat?.textContent).toMatch(/approval chain/i);
    expect(caveat?.textContent).toMatch(/service pattern/i);
    expect(caveat?.textContent).toMatch(/head of account/i);
    expect(container.textContent).toMatch(/one published version still means one thing/i);
  });

  it("shows rupees but emits paise", () => {
    // Money stays in minor units end to end so nothing rounds on the way to the ledger.
    const onChange = vi.fn();
    const rows: OfficeOverrideRow[] = [{ officeId: ZONE_A, feeFromMinor: 50000 }];
    render(<OfficeOverridesBuilder value={rows} offeringOfficeIds={[ZONE_A]} onChange={onChange} />);

    expect(screen.getByDisplayValue("500")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("500"), { target: { value: "750.50" } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ feeFromMinor: 75050 })]);
  });

  it("marks the audit note as not citizen-facing", () => {
    render(<OfficeOverridesBuilder value={[{ officeId: ZONE_A }]} offeringOfficeIds={[ZONE_A]} onChange={() => {}} />);
    expect(screen.getByText(/not shown to citizens/i)).toBeTruthy();
  });

  it("offers only offices that are not already overridden", () => {
    const B = "bbbbbbbb-0000-4000-8000-00000000000b";
    render(
      <OfficeOverridesBuilder value={[{ officeId: ZONE_A }]} offeringOfficeIds={[ZONE_A, B]} onChange={() => {}} />,
    );
    const options = Array.from(document.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toContain(B);
    expect(options.filter((o) => o === ZONE_A)).toHaveLength(0);
  });
});

/* ── FN-15 ─────────────────────────────────────────────────────────────── */

describe("FN-15 RenewalPolicyBuilder", () => {
  const expiring: RenewalPolicyValue = {
    renewable: true,
    renewalWindowDays: 30,
    validityMode: "duration",
    validityYears: 1,
  };

  it("hides renewal entirely when the output never expires", () => {
    // A renewal window that can never open would imply a capability that does not exist.
    render(<RenewalPolicyBuilder value={{ ...expiring, validityMode: "none" }} onChange={() => {}} />);
    expect(screen.queryByLabelText(/Citizens can renew/i)).toBeNull();
    expect(screen.getByText(/Nothing to renew/i)).toBeTruthy();
  });

  it("forces renewable off when validity is switched to never-expires", () => {
    const onChange = vi.fn();
    render(<RenewalPolicyBuilder value={expiring} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("Fixed period from issue"), { target: { value: "none" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ validityMode: "none", renewable: false }));
  });

  it("explains that expiry is terminal for renewal", () => {
    render(<RenewalPolicyBuilder value={expiring} onChange={() => {}} />);
    expect(screen.getByText(/fresh application is required/i)).toBeTruthy();
  });

  it("warns that dates and documents are not carried over", () => {
    render(<RenewalPolicyBuilder value={expiring} onChange={() => {}} />);
    expect(screen.getByText(/cannot silently reassert last year/i)).toBeTruthy();
  });

  it("handles a service with no policy configured yet", () => {
    render(<RenewalPolicyBuilder value={null} onChange={() => {}} />);
    expect(screen.getByText(/Nothing to renew/i)).toBeTruthy();
  });
});
