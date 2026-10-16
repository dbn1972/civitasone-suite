import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill, QuotaStatusPill } from "./StatusPill";

// GAP-TENANT-QUOTAS-02: near_limit -> amber "Near limit" WITH an icon cue;
// exceeded -> red with an icon; unknown snake_case -> sentence case.
describe("StatusPill quota tones (GAP-TENANT-QUOTAS-02)", () => {
  it("shared StatusPill: near limit is warn, exceeded bad, ok good", () => {
    render(
      <>
        <StatusPill status="near_limit" />
        <StatusPill status="Exceeded" />
        <StatusPill status="OK" />
      </>,
    );
    expect(screen.getByText("Near Limit")).toHaveClass("warn");
    expect(screen.getByText("Exceeded")).toHaveClass("bad");
    expect(screen.getByText("Ok")).toHaveClass("good");
  });
});

describe("QuotaStatusPill (GAP-TENANT-QUOTAS-02)", () => {
  it("near_limit renders 'Near limit' on an amber pill with an aria-hidden icon", () => {
    const { container } = render(<QuotaStatusPill status="near_limit" />);
    const pill = container.querySelector(".pill") as HTMLElement;
    expect(pill).toHaveClass("warn");
    expect(pill.textContent).toContain("Near limit");
    const icon = pill.querySelector("[aria-hidden='true']");
    expect(icon).not.toBeNull();
    expect(icon?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("Exceeded is red with an icon cue; OK is green with no icon", () => {
    const { container } = render(
      <>
        <QuotaStatusPill status="Exceeded" />
        <QuotaStatusPill status="OK" />
      </>,
    );
    const [ex, ok] = Array.from(container.querySelectorAll(".pill")) as HTMLElement[];
    expect(ex).toHaveClass("bad");
    expect(ex.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(ok).toHaveClass("good");
    expect(ok.textContent).toBe("OK");
    expect(ok.querySelector("[aria-hidden='true']")).toBeNull();
  });

  it("an unknown value 'foo_bar' renders sentence case 'Foo bar'", () => {
    render(<QuotaStatusPill status="foo_bar" />);
    expect(screen.getByText("Foo bar")).toBeInTheDocument();
  });
});
