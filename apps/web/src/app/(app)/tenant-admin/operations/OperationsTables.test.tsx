import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentErrorsTable } from "./OperationsTables";

describe("RecentErrorsTable (UAT b23: readable labels, no raw paths)", () => {
  it("shows a readable source and an error line without server file paths", () => {
    render(
      <RecentErrorsTable
        errors={[{ source: "finance-worker", line: "Error: outbox purge failed at /home/ec2-user/CivitasOne/civitasone-suite/packages/outbox/dist/index.js:608:11" }]}
      />,
    );
    expect(screen.getByText("Finance worker")).toBeInTheDocument();
    expect(screen.queryByText(/\/home\/ec2-user/)).not.toBeInTheDocument();
    expect(screen.getByText(/outbox purge failed/)).toBeInTheDocument();
  });
});
