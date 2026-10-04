import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { AccountingBanner } from "./AccountingBanner";
import { renderIntl } from "./testIntl";

const ACC = (area: string, missing: string[]) => ({ [area]: { configured: missing.length === 0, missing } });
const settings = (accounting: Record<string, unknown>) => ({ capitalizeMakerChecker: true, accounting });

function mockSettings(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("AccountingBanner (fp-assets-02)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("says 'Accounting not set up', names the missing accounts, says the record is still saved and links to Asset settings", async () => {
    const spy = mockSettings(settings({ ...ACC("acquisition", ["fixed_asset", "acquisition_offset"]) }));
    renderIntl(<AccountingBanner areas={["acquisition"]} />);
    expect(await screen.findByText("Accounting not set up")).toBeInTheDocument();
    expect(screen.getByText(/Fixed asset account \(debit on capitalisation\), Acquisition offset account \(payable or capital\)/)).toBeInTheDocument();
    expect(screen.getByText(/Your records are still saved/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Asset settings" })).toHaveAttribute("href", "/assets/settings");
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/asset/settings");
  });

  it("only counts the areas the screen cares about, and lists a shared head once", async () => {
    mockSettings(settings({ ...ACC("impairment", ["fixed_asset", "impairment_expense"]), ...ACC("revaluation", ["fixed_asset"]), ...ACC("maintenance", ["ap_control"]) }));
    renderIntl(<AccountingBanner areas={["impairment", "revaluation"]} />);
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toMatch(/Fixed asset account.*Impairment loss account/);
    expect(banner.textContent).not.toMatch(/Accounts payable control/);
    expect(banner.textContent!.match(/Fixed asset account/g)).toHaveLength(1);
  });

  it("renders nothing when the accounts are set up, and nothing while loading", async () => {
    mockSettings(settings({ ...ACC("maintenance", []) }));
    const { container } = renderIntl(<AccountingBanner areas={["maintenance"]} />);
    expect(container.textContent).toBe(""); // loading
    await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.textContent).toBe("");
  });

  it("a failed check is its own small note, not the banner and not silence", async () => {
    mockSettings({}, 500);
    renderIntl(<AccountingBanner areas={["maintenance"]} />);
    expect(await screen.findByText("Couldn't check whether accounting is set up.")).toBeInTheDocument();
    expect(screen.queryByText("Accounting not set up")).not.toBeInTheDocument();
  });

  it("renders in Hindi", async () => {
    mockSettings(settings({ ...ACC("maintenance", ["maintenance_expense", "ap_control"]) }));
    renderIntl(<AccountingBanner areas={["maintenance"]} />, "hi");
    expect(await screen.findByText("लेखा सेटअप नहीं है")).toBeInTheDocument();
    expect(screen.getByText(/रखरखाव व्यय खाता \(व्यय\), देय खाता नियंत्रण खाता \(देयता\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "संपत्ति सेटिंग्स खोलें" })).toBeInTheDocument();
  });
});
