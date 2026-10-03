import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { INDIAN_STATES_UTS } from "@/lib/india/states";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

import { PtStatePicker } from "./PtStatePicker";

function renderPicker(selected: string | null = null, configured: string[] = []) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PtStatePicker selected={selected} configured={configured} />
    </NextIntlClientProvider>,
  );
  return screen.getByRole("combobox") as HTMLSelectElement;
}

describe("PtStatePicker", () => {
  it("lists real states / UTs only: KA and MH present, ZZ absent, each exactly once", () => {
    const select = renderPicker();
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(values).toContain("KA");
    expect(values).toContain("MH");
    expect(values).not.toContain("ZZ");
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(INDIAN_STATES_UTS.map((s) => s.code));
  });

  it("marks states that already have slabs, and navigates by state code", () => {
    const select = renderPicker("MH", ["MH"]);
    expect(screen.getByRole("option", { name: "Maharashtra (MH) — slabs configured" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Karnataka (KA)" })).toBeInTheDocument();
    expect(select.value).toBe("MH");
    fireEvent.change(select, { target: { value: "KA" } });
    expect(pushMock).toHaveBeenCalledWith("/hr/payroll/statutory/pt?state=KA");
    fireEvent.change(select, { target: { value: "" } });
    expect(pushMock).toHaveBeenLastCalledWith("/hr/payroll/statutory/pt");
  });
});
