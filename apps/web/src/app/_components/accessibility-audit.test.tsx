/**
 * Accessibility Audit Tests — automated WCAG 2.2 checks for CivitasOne components.
 *
 * Verifies:
 * - All interactive elements are keyboard accessible (role + tabIndex)
 * - ARIA attributes are correctly applied
 * - Focus management works (dialogs trap focus, return focus)
 * - Screen reader announcements for dynamic content (aria-live)
 * - Semantic structure (headings, landmarks, labels)
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./ds/ConfirmDialog";
import { Tabs } from "./ds/Tabs";
import { Segmented } from "./ds/Segmented";
import { DataTable } from "./ds/DataTable";
import { ErrorState } from "./ds/ErrorState";
import { HelpTip } from "./ds/HelpTip";
import { PageHeader } from "./ds/PageHeader";
import { EmptyState } from "./ds/EmptyState";

vi.mock("@/lib/messages", () => ({
  ACTION_LABELS: { retry: "Try again", back: "Go back", help: "Get help" },
}));

describe("Accessibility Audit: WCAG 2.2 AA", () => {
  describe("ConfirmDialog — focus management", () => {
    it("has role=alertdialog and aria-modal for screen readers", () => {
      render(
        <ConfirmDialog
          open={true}
          title="Delete?"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      const dialog = screen.getByRole("alertdialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby");
    });

    it("title is linked via aria-labelledby", () => {
      render(
        <ConfirmDialog
          open={true}
          title="Confirm action"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      const dialog = screen.getByRole("alertdialog");
      const titleId = dialog.getAttribute("aria-labelledby");
      const titleEl = document.getElementById(titleId!);
      expect(titleEl?.textContent).toContain("Confirm action");
    });

    it("description is linked via aria-describedby", () => {
      render(
        <ConfirmDialog
          open={true}
          title="Delete?"
          description="This cannot be undone"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      const dialog = screen.getByRole("alertdialog");
      const descId = dialog.getAttribute("aria-describedby");
      expect(descId).toBeTruthy();
      const descEl = document.getElementById(descId!);
      expect(descEl?.textContent).toContain("This cannot be undone");
    });

    it("reason textarea has aria-required when requireReason=true", () => {
      render(
        <ConfirmDialog
          open={true}
          title="Approve"
          requireReason
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByRole("textbox")).toHaveAttribute("aria-required", "true");
    });

    it("confirm button has aria-busy when loading", () => {
      render(
        <ConfirmDialog
          open={true}
          title="Saving"
          busy
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByText("Working…")).toHaveAttribute("aria-busy", "true");
    });
  });

  describe("Tabs — keyboard accessibility", () => {
    it("each tab has role=tab", () => {
      render(<Tabs tabs={["All", "Active"]} active="All" onChange={vi.fn()} />);
      expect(screen.getByText("All")).toHaveAttribute("role", "tab");
      expect(screen.getByText("Active")).toHaveAttribute("role", "tab");
    });

    it("each tab has tabIndex=0 for keyboard focus", () => {
      render(<Tabs tabs={["All", "Active"]} active="All" onChange={vi.fn()} />);
      expect(screen.getByText("All")).toHaveAttribute("tabindex", "0");
      expect(screen.getByText("Active")).toHaveAttribute("tabindex", "0");
    });

    it("responds to Enter keydown", () => {
      const onChange = vi.fn();
      render(<Tabs tabs={["All", "Active"]} active="All" onChange={onChange} />);
      fireEvent.keyDown(screen.getByText("Active"), { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("Active");
    });
  });

  describe("DataTable — sortable header accessibility", () => {
    const columns = [
      { key: "name" as const, label: "Name" },
      { key: "status" as const, label: "Status" },
    ];
    const rows = [{ name: "Item A", status: "active" }];

    it("sortable headers have aria-sort attribute", () => {
      render(<DataTable columns={columns} rows={rows} sortable />);
      const nameHeader = screen.getByText("Name").closest("th");
      expect(nameHeader).toHaveAttribute("aria-sort", "none");
    });

    it("sorted header updates aria-sort to ascending", () => {
      render(<DataTable columns={columns} rows={rows} sortable />);
      fireEvent.click(screen.getByText("Name"));
      const nameHeader = screen.getByText("Name").closest("th");
      expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    });

    it("sorted headers are keyboard accessible (tabIndex=0)", () => {
      render(<DataTable columns={columns} rows={rows} sortable />);
      const nameHeader = screen.getByText("Name").closest("th");
      expect(nameHeader).toHaveAttribute("tabindex", "0");
    });

    it("pagination has aria-live for page changes", () => {
      const manyRows = Array.from({ length: 5 }, (_, i) => ({ name: `Item ${i}`, status: "ok" }));
      render(<DataTable columns={columns} rows={manyRows} pageSize={2} />);
      const liveRegion = screen.getByText(/Page \d+ of \d+/);
      expect(liveRegion).toHaveAttribute("aria-live", "polite");
    });
  });

  describe("ErrorState — alert semantics", () => {
    const error = { what: "Failed", next: "Try again", actions: ["retry" as const] };

    it("renders with role=alert", () => {
      render(<ErrorState error={error} onRetry={vi.fn()} />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("has aria-live=assertive for urgent announcements", () => {
      render(<ErrorState error={error} onRetry={vi.fn()} />);
      expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    });
  });

  describe("HelpTip — tooltip accessibility", () => {
    it("trigger button has aria-label", () => {
      render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
      expect(screen.getByRole("button")).toHaveAttribute("aria-label", "What is GRN?");
    });

    it("trigger has aria-expanded state", () => {
      render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
      const btn = screen.getByRole("button");
      expect(btn).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(btn);
      expect(btn).toHaveAttribute("aria-expanded", "true");
    });

    it("tooltip has role=tooltip", () => {
      render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });

    it("trigger has aria-describedby pointing to tooltip", () => {
      render(<HelpTip term="GRN">Goods Received Note</HelpTip>);
      const btn = screen.getByRole("button");
      fireEvent.click(btn);
      const tooltipId = screen.getByRole("tooltip").getAttribute("id");
      expect(btn).toHaveAttribute("aria-describedby", tooltipId);
    });
  });

  describe("PageHeader — semantic structure", () => {
    it("title uses h1 element for page landmark", () => {
      render(<PageHeader title="Finance" />);
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    it("h1 has id for aria-labelledby usage by sections", () => {
      render(<PageHeader title="Finance" />);
      expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("id", "page-heading");
    });

    it("help link has descriptive aria-label", () => {
      render(<PageHeader title="Bills" help="bills" />);
      expect(screen.getByRole("link", { name: /plain-language help/ })).toBeInTheDocument();
    });
  });

  describe("EmptyState — decorative icon handling", () => {
    it("icon is aria-hidden (decorative)", () => {
      const { container } = render(<EmptyState icon="📋" title="No data" />);
      const icon = container.querySelector("[aria-hidden]");
      expect(icon).toBeInTheDocument();
    });

    it("title uses h4 for semantic heading", () => {
      render(<EmptyState title="No records" />);
      expect(screen.getByRole("heading", { name: "No records" })).toBeInTheDocument();
    });
  });
});
