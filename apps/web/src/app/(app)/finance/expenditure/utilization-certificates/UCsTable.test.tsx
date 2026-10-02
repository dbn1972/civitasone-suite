import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { UCsTable, ucPeriod } from "./UCsTable";

const uc = (id: string, status: UCStatus, extra: Record<string, unknown> = {}) => ({
  id, ucNo: `UC-${id}`, grantee: "G", amount: "100", periodFrom: "2026-04-01", periodTo: "2026-06-30", status, ...extra,
});
type UCStatus = "pending" | "submitted" | "verified" | "rejected";

function renderTable(ucs: ReturnType<typeof uc>[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <UCsTable ucs={ucs} />
    </NextIntlClientProvider>,
  );
}

describe("ucPeriod (GAP-...-UTILIZATION-CERTIFICATES-NEW-02)", () => {
  it("never renders 'undefined – undefined'", () => {
    expect(ucPeriod(undefined, undefined)).toBe("—");
    expect(ucPeriod("2026-04-01", undefined)).toBe("—");
    expect(ucPeriod("2026-04-01", "2026-06-30")).toBe("2026-04-01 – 2026-06-30");
  });
});

describe("UCsTable tabs (GAP-...-UTILIZATION-CERTIFICATES-01)", () => {
  it("the Pending tab no longer lists rejected UCs; Returned tab lists only rejected", () => {
    renderTable([uc("1", "pending"), uc("2", "rejected"), uc("3", "submitted")]);
    fireEvent.click(screen.getByRole("tab", { name: "Pending" }));
    expect(screen.getByText("UC-1")).toBeInTheDocument();
    expect(screen.queryByText("UC-2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Returned" }));
    expect(screen.getByText("UC-2")).toBeInTheDocument();
    expect(screen.queryByText("UC-1")).not.toBeInTheDocument();
  });
});
