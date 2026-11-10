import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/api/browserClient", () => ({ browserJson: vi.fn() }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import { PayComponentsSection } from "./PayComponentsSection";
import { getPayComponentsView } from "./payComponentsData";

describe("getPayComponentsView (flag S8_PAY_COMPONENTS_ENABLED)", () => {
  beforeEach(() => fetchJsonMock.mockReset());
  it("is disabled, without a second request, when meta says so, fails, or returns nothing", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: { enabled: false }, source: "api" });
    expect(await getPayComponentsView()).toEqual({ enabled: false, templates: [] });
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    fetchJsonMock.mockReset().mockResolvedValueOnce({ data: null, source: "error" });
    expect((await getPayComponentsView()).enabled).toBe(false);
    fetchJsonMock.mockReset().mockResolvedValueOnce(undefined);
    expect((await getPayComponentsView()).enabled).toBe(false);
  });
  it("is enabled with the templates when meta says so", async () => {
    const tpl = { id: "t1", name: "Project Staff CTC - Delhi", isLocked: false, templateVersion: 1, effectiveFrom: "2026-12-01", activeComponents: 7 };
    fetchJsonMock.mockResolvedValueOnce({ data: { enabled: true }, source: "api" }).mockResolvedValueOnce({ data: [tpl], source: "api" });
    expect(await getPayComponentsView()).toEqual({ enabled: true, templates: [tpl] });
  });
});

describe("PayComponentsSection", () => {
  it("links each template and run structure to its component page; readers get no create form", () => {
    const tpl = { id: "t1", name: "Project Staff CTC - Delhi", isLocked: true, templateVersion: 2, effectiveFrom: "2026-12-01", activeComponents: 7 };
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PayComponentsSection structures={[{ id: "s1", name: "Deputation Pay", status: "active" }]} templates={[tpl]} canWrite={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("link", { name: "Project Staff CTC - Delhi" }).getAttribute("href")).toBe("/hr/payroll/structures/t1/components");
    expect(screen.getByRole("link", { name: /Manage components of Deputation Pay/ }).getAttribute("href")).toBe("/hr/payroll/structures/s1/components");
    expect(screen.getByText(/Locked/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create template/i })).toBeNull();
  });
});
