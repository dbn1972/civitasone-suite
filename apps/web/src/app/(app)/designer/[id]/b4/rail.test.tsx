import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const def = {
  id: "d1", serviceKey: "tl", name: "Trade Licence", version: 1, status: "draft",
  servicePattern: "certificate", channels: ["portal"], outputs: [],
  formId: "f1", eligibilityRuleSetId: "r1", workflowDefinitionId: "w1",
  feeModel: "fixed", feeScheduleId: null, hoaCode: "0030", requiredDocuments: [],
};

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "d1" }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => <a href={href}>{children as never}</a>,
}));
vi.mock("../../_data/designerApi", async () => {
  const actual = await vi.importActual<typeof import("../../_data/designerApi")>("../../_data/designerApi");
  return { ...actual, fetchServiceDefinition: vi.fn().mockResolvedValue(def), updateServiceDefinition: vi.fn() };
});
vi.mock("../../_data/workflowBuilderApi", async () => {
  const actual = await vi.importActual<typeof import("../../_data/workflowBuilderApi")>("../../_data/workflowBuilderApi");
  return { ...actual, loadWorkflowDesign: vi.fn().mockResolvedValue(actual.emptyWorkflowDesign("Trade Licence")) };
});
vi.mock("@/app/_components/ds/designer", () => ({
  WizardShell: ({ blocks }: { blocks: { id: string; status: string }[] }) => (
    <ul data-testid="rail">{blocks.map((b) => <li key={b.id}>{b.id}:{b.status}</li>)}</ul>
  ),
}));

import { computeWizardBlocks } from "../../_data/designerRail";
import { hiddenBlocksForPattern } from "../../_data/designerConstants";

describe("block rail is consistent across pages", () => {
  it("B4 and B6 render the same rail as the shared calc for one draft", async () => {
    const expected = computeWizardBlocks(def as never, hiddenBlocksForPattern("certificate"))
      .map((b) => `${b.id}:${b.status}`);
    // B5 has fee model + HoA but NO saved fee schedule: rail must not claim "complete".
    expect(expected).toContain("b5:in-progress");
    expect(expected).toContain("b3:complete");

    const rails: string[][] = [];
    for (const mod of [await import("./page"), await import("../b6/page")]) {
      const Page = mod.default as () => JSX.Element;
      const { unmount } = render(<Page />);
      await waitFor(() => expect(screen.queryByTestId("rail")?.textContent).toContain("b3:complete"));
      rails.push(Array.from(screen.getByTestId("rail").querySelectorAll("li")).map((li) => li.textContent ?? ""));
      unmount();
    }
    expect(rails[0]).toEqual(expected);
    expect(rails[1]).toEqual(expected);
  });
});
