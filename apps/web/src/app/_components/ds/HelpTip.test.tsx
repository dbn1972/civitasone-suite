import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { HelpTip } from "./HelpTip";

describe("HelpTip", () => {
  it("renders trigger button with ? character", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    expect(screen.getByRole("button")).toHaveTextContent("?");
  });

  it("has aria-label derived from term", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "What is GRN?");
  });

  it("has generic aria-label when no term", () => {
    render(<HelpTip>Some explanation</HelpTip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "More information");
  });

  it("tooltip is not visible initially", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip on click", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Goods Received Note");
  });

  it("shows term name in bold within tooltip", () => {
    render(<HelpTip term="UC">Utilisation Certificate</HelpTip>);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("UC")).toBeInTheDocument();
  });

  it("shows tooltip on mouseEnter", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  // A bare, immediate close on mouseLeave closed the tooltip before the
  // pointer could ever travel down into the popover itself -- see
  // HelpTip.tsx. These three replace the old "hides tooltip on mouseLeave"
  // test, which asserted exactly that (now-fixed) immediate-close behavior.
  describe("mouseLeave grace period", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not hide the tooltip immediately on mouseLeave", () => {
      render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
      fireEvent.mouseEnter(screen.getByRole("button"));
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      fireEvent.mouseLeave(screen.getByRole("button"));
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });

    it("hides the tooltip once the grace period elapses without the pointer returning", () => {
      render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
      fireEvent.mouseEnter(screen.getByRole("button"));
      fireEvent.mouseLeave(screen.getByRole("button"));
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("cancels the scheduled close if the pointer re-enters the trigger within the grace period", () => {
      render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
      const btn = screen.getByRole("button");
      fireEvent.mouseEnter(btn);
      fireEvent.mouseLeave(btn);
      act(() => {
        vi.advanceTimersByTime(50);
      });
      fireEvent.mouseEnter(btn);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });
  });

  it("shows tooltip on focus", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("hides tooltip on blur", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    fireEvent.focus(screen.getByRole("button"));
    fireEvent.blur(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("sets aria-expanded=true when open", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("sets aria-expanded=false when closed", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  // Issue #21: the button previously had marginLeft but no marginRight, so
  // whatever a caller interpolated right after it (a closing paren, a
  // sentence period -- see Term.tsx) rendered flush against its edge with
  // zero gap. This asserts the actual CSS property the fix depends on,
  // rather than only the visible text/DOM-structure assertions elsewhere in
  // this file, none of which would catch a regression here.
  it("gives the trigger button a non-zero marginRight so adjacent punctuation never sits flush against it", () => {
    render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
    const btn = screen.getByRole("button");
    const marginRight = getComputedStyle(btn).marginRight;
    expect(marginRight).not.toBe("");
    expect(marginRight).not.toBe("0px");
    expect(parseFloat(marginRight)).toBeGreaterThan(0);
  });
});
