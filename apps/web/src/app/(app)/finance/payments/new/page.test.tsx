import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// GAP-FINANCE-PAYMENTS-01: the signed-in officer (JWT sub), compared with each bill's creator / passer.
const viewer = vi.hoisted(() => ({ id: "99999999-0000-4000-8000-000000000009" as string | null }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionUserId: () => viewer.id }));

// Real payloads, shaped exactly like finance-service emits them (payments/queries.ts),
// pushed through the REAL zod response schemas and loader mappers: only the
// network call is replaced. A schema that rejects `passed` / `on_hold` rows
// makes the loader return source:"error" and these tests fail.
const BILLS = [
  { id: "11111111-2222-4333-8444-555555555551", billNo: "INV-PASSED", vendor: "Acme Supplies", amount: "4750000", amountDisplay: "₹47,500.00", submittedDate: "2026-09-01", status: "passed", threeWayMatch: "na", createdBy: "aaaaaaaa-0000-4000-8000-00000000000a", passedBy: "bbbbbbbb-0000-4000-8000-00000000000b" },
  { id: "11111111-2222-4333-8444-555555555555", billNo: "INV-MINE-MADE", vendor: "Maker Co", amount: "500", submittedDate: "2026-09-05", status: "passed", threeWayMatch: "na", createdBy: "99999999-0000-4000-8000-000000000009", passedBy: "bbbbbbbb-0000-4000-8000-00000000000b" },
  { id: "11111111-2222-4333-8444-555555555556", billNo: "INV-MINE-PASSED", vendor: "Passer Co", amount: "600", submittedDate: "2026-09-06", status: "passed", threeWayMatch: "na", createdBy: "aaaaaaaa-0000-4000-8000-00000000000a", passedBy: "99999999-0000-4000-8000-000000000009" },
  { id: "11111111-2222-4333-8444-555555555552", billNo: "INV-HOLD", vendor: "Hold Co", amount: "100", submittedDate: "2026-09-02", status: "on_hold", threeWayMatch: "na" },
  { id: "11111111-2222-4333-8444-555555555553", billNo: "INV-PENDING", vendor: "Pending Co", amount: "200", submittedDate: "2026-09-03", status: "pending", threeWayMatch: "na" },
  { id: "11111111-2222-4333-8444-555555555554", billNo: "INV-PAID", vendor: "Paid Co", amount: "300", submittedDate: "2026-09-04", status: "paid", threeWayMatch: "na" },
];
const DDOS = { data: [{ id: "d1", ddoCode: "DDO12345", name: "Main DDO", isActive: true }] };

vi.mock("@/app/_data/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/_data/apiClient")>();
  return {
    ...actual,
    fetchJson: async (path: string, empty: unknown, options: { responseSchema?: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }; mapResponse: (p: unknown) => unknown }) => {
      const raw = path.includes("/finance/bills") ? BILLS : path.includes("/finance/ddo") ? DDOS : null;
      if (raw === null) return { data: empty, source: "error", status: 404 };
      let payload: unknown = raw;
      if (options.responseSchema) {
        const parsed = options.responseSchema.safeParse(raw);
        if (!parsed.success) return { data: empty, source: "error", status: 200 };
        payload = parsed.data;
      }
      const mapped = options.mapResponse(payload);
      return mapped === null ? { data: empty, source: "error", status: 200 } : { data: mapped, source: "api" };
    },
  };
});

import NewPaymentPage from "./page";
import { BillDetailSchema, BillSummaryListSchema } from "@civitasone/schemas/web";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("/finance/payments/new with real finance-service payloads (HIGH: passed / on_hold bills)", () => {
  it("lists the passed bill (and only it) as payable", async () => {
    render(await NewPaymentPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("option", { name: /INV-PASSED — Acme Supplies — ₹47,500\.00/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /INV-HOLD/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /INV-PENDING/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /INV-PAID/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // no load-failure state
  });

  // GAP-FINANCE-PAYMENTS-01: do not invite a guaranteed refusal (payer != creator, payer != passer).
  it("does not list a passed bill the signed-in officer created or passed, and says how many were left out", async () => {
    viewer.id = "99999999-0000-4000-8000-000000000009";
    render(await NewPaymentPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("option", { name: /INV-PASSED/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /INV-MINE-MADE/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /INV-MINE-PASSED/ })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Passed bills not listed: 2");
  });

  it("lists every passed bill for a different officer, with no left-out note", async () => {
    viewer.id = "cccccccc-0000-4000-8000-00000000000c";
    render(await NewPaymentPage({ searchParams: Promise.resolve({}) }));
    for (const no of ["INV-PASSED", "INV-MINE-MADE", "INV-MINE-PASSED"]) {
      expect(screen.getByRole("option", { name: new RegExp(no) })).toBeInTheDocument();
    }
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("fails open (the server decides) when the signed-in user id is unknown", async () => {
    viewer.id = null;
    render(await NewPaymentPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("option", { name: /INV-MINE-MADE/ })).toBeInTheDocument();
  });

  it("the bill schemas accept every status the service emits, and threeWayMatch 'pending' on detail", () => {
    for (const status of ["pending", "passed", "paid", "rejected", "on_hold", "under_review"]) {
      expect(BillSummaryListSchema.safeParse([{ ...BILLS[0], status }]).success, status).toBe(true);
    }
    expect(BillDetailSchema.safeParse({ ...BILLS[0], threeWayMatch: "pending", lineItems: [] }).success).toBe(true);
    expect(BillSummaryListSchema.safeParse([{ ...BILLS[0], status: "draft" }]).success).toBe(false);
  });
});
