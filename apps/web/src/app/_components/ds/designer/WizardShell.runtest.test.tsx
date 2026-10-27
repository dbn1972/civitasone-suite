import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WizardShell } from "./WizardShell";

const blocks = [{ id: "b1", shortLabel: "B1", label: "Catalogue & Identity", status: "complete" as const }];

function shell(props: Record<string, unknown>) {
  return render(
    <WizardShell
      serviceName="S" patternLabel="P" version={1} status="draft" saveState="saved"
      blocks={blocks} activeBlockId="b1" onBlockSelect={() => undefined}
      {...props}
    >
      <div />
    </WizardShell>,
  );
}

describe("WizardShell — shows which block holds Run Test back (D4c #11)", () => {
  it("names the blocks and puts them in the button title", () => {
    shell({ canRunTest: false, runTestBlockedBy: ["Fee & Revenue", "Documents"] });
    expect(screen.getByTestId("run-test-blockers").textContent).toBe("Run Test is waiting on: Fee & Revenue, Documents");
    expect(screen.getByRole("button", { name: "Run Test" }).getAttribute("title")).toContain("Fee & Revenue, Documents");
  });
  it("shows nothing extra once Run Test is allowed", () => {
    shell({ canRunTest: true, runTestBlockedBy: [] });
    expect(screen.queryByTestId("run-test-blockers")).toBeNull();
  });
});
