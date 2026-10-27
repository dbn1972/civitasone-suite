import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DesignIssuesList } from "./DesignIssuesList";

describe("DesignIssuesList (D4c #7)", () => {
  it("lists blockers and warnings with the shared Blocks Next / Warning wording", () => {
    render(
      <DesignIssuesList
        issues={[
          { blockId: "b5", severity: "blocks_next", code: "hoa_missing" },
          { blockId: "b6", severity: "warning", code: "doc_no_lane", count: 2 },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("Blocks Next");
    expect(items[0]?.textContent).toContain("Head of Account is missing");
    expect(items[1]?.textContent).toContain("Warning");
    expect(items[1]?.textContent).toContain("2 mandatory document(s)");
  });

  it("says plainly when there is nothing to fix", () => {
    render(<DesignIssuesList issues={[]} />);
    expect(screen.getByText("No blocking issues or warnings.")).toBeTruthy();
  });
});
