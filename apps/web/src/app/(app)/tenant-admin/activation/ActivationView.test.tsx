import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ActivationView } from "./ActivationView";
import { aggregateFunnel, type ActivationEvent } from "@/lib/activation";

// A platform-ish aggregate with two offices making progress.
function platformAgg() {
  const events: ActivationEvent[] = [
    { tenantId: "o1", step: "signin", at: "2026-01-01T00:00:00.000Z" },
    { tenantId: "o1", step: "wizard_opened", at: "2026-01-01T00:05:00.000Z" },
    { tenantId: "o1", step: "first_transaction", at: "2026-01-01T01:00:00.000Z" },
    { tenantId: "o2", step: "signin", at: "2026-01-01T00:00:00.000Z" },
  ];
  return aggregateFunnel(events);
}

// A single office's own funnel.
function selfAgg() {
  const events: ActivationEvent[] = [
    { tenantId: "self", step: "signin", at: "2026-01-01T00:00:00.000Z" },
    { tenantId: "self", step: "wizard_opened", at: "2026-01-01T00:05:00.000Z" },
  ];
  return aggregateFunnel(events);
}

describe("ActivationView — GAP-TENANT-ADMIN-ACTIVATION-01 (FAILMASK)", () => {
  it("shows a retry error state (not 0% / 'no events yet') when the load failed", () => {
    render(<ActivationView agg={aggregateFunnel([])} platform={false} failed />);
    expect(screen.getByText(/couldn't load activation events/i)).toBeInTheDocument();
    expect(screen.queryByText(/No activation events yet/i)).not.toBeInTheDocument();
    // No fabricated 0% activation-rate card.
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("shows the empty-state text (not an error) when the load succeeded with zero events", () => {
    render(<ActivationView agg={aggregateFunnel([])} platform={false} failed={false} />);
    expect(screen.getByText(/No activation events yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });
});

describe("ActivationView — GAP-TENANT-ADMIN-ACTIVATION-02 (footer copy)", () => {
  it("does not contain the self-contradictory 'kept in memory / moves to analytics next' copy", () => {
    const { container } = render(<ActivationView agg={platformAgg()} platform failed={false} />);
    expect(container.textContent).not.toMatch(/kept in memory/i);
    expect(container.textContent).not.toMatch(/moves to the analytics service next/i);
    expect(container.textContent).toMatch(/recorded by the analytics service/i);
  });
});

describe("ActivationView — GAP-TENANT-ADMIN-ACTIVATION-03 (tenant scope)", () => {
  it("tenant scope hides the 0/1 office counts and shows a setup checklist instead", () => {
    render(<ActivationView agg={selfAgg()} platform={false} failed={false} />);
    expect(screen.queryByText(/Offices signed in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Offices activated/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Setup progress/i)).toBeInTheDocument();
    expect(screen.getByText(/Setup checklist/i)).toBeInTheDocument();
  });

  it("platform scope keeps the office funnel cards", () => {
    render(<ActivationView agg={platformAgg()} platform failed={false} />);
    expect(screen.getByText(/Offices signed in/i)).toBeInTheDocument();
    expect(screen.getByText(/Offices activated/i)).toBeInTheDocument();
    expect(screen.getByText(/Golden-path funnel/i)).toBeInTheDocument();
  });
});

describe("ActivationView — GAP-TENANT-ADMIN-ACTIVATION-04 (chart + DataTable)", () => {
  it("renders a bar chart of reached-per-step above the table (DataTable, not the old raw .tbl)", () => {
    const { container } = render(<ActivationView agg={platformAgg()} platform failed={false} />);
    // Chart renders an SVG with role=img.
    expect(container.querySelector("svg[role='img']")).not.toBeNull();
    // DataTable gives every cell a data-label for its responsive/mobile
    // transform — the old hand-rolled <table className="tbl"> had none.
    expect(container.querySelector("td[data-label]")).not.toBeNull();
  });
});
