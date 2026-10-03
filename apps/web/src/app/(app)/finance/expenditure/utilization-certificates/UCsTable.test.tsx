import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

import { beforeEach } from "vitest";
beforeEach(() => { vi.restoreAllMocks(); });
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { UCsTable, ucPeriod, ucRowActions } from "./UCsTable";

const uc = (id: string, status: UCStatus, extra: Record<string, unknown> = {}) => ({
  id, ucNo: `UC-${id}`, grantee: "G", amount: "100", periodFrom: "2026-04-01", periodTo: "2026-06-30", status, ...extra,
});
type UCStatus = "pending" | "submitted" | "verified" | "rejected";

function renderTable(ucs: ReturnType<typeof uc>[], props: Partial<React.ComponentProps<typeof UCsTable>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <UCsTable ucs={ucs} {...props} />
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

// fp-finance-01: verify / return / resubmit
describe("ucRowActions", () => {
  const viewer = { id: "checker", canVerify: true, canResubmit: true };
  it("a verifier acts on a submitted UC raised by someone else, never their own", () => {
    expect(ucRowActions({ status: "submitted", createdBy: "maker" }, viewer)).toBe("verify");
    expect(ucRowActions({ status: "submitted", createdBy: "checker" }, viewer)).toBe("none");
    expect(ucRowActions({ status: "submitted", createdBy: "maker" }, { ...viewer, canVerify: false })).toBe("none");
  });
  it("a returned UC can be resubmitted by finance staff; other statuses offer nothing", () => {
    expect(ucRowActions({ status: "rejected", createdBy: "maker" }, viewer)).toBe("resubmit");
    expect(ucRowActions({ status: "rejected", createdBy: "maker" }, { ...viewer, canResubmit: false })).toBe("none");
    for (const s of ["pending", "verified"] as const) expect(ucRowActions({ status: s, createdBy: "m" }, viewer)).toBe("none");
  });
});

describe("UCsTable actions", () => {
  it("shows the return reason for a returned certificate and a dash when none was recorded", () => {
    renderTable([uc("1", "rejected", { rejectionReason: "Bills for Q3 missing" }), uc("2", "rejected")]);
    fireEvent.click(screen.getByRole("tab", { name: "Returned" }));
    expect(screen.getByText("Bills for Q3 missing")).toBeInTheDocument();
    expect(screen.getByText("No reason recorded")).toBeInTheDocument();
  });

  it("verify: confirms first, then POSTs to the verify route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    renderTable([uc("1", "submitted", { createdBy: "maker" })], { viewerId: "checker", canVerify: true });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("Verify UC-1?")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Verify" }).at(-1)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proxy/v1/finance/utilization-certificates/1/verify");
  });

  it("return: needs a reason and sends it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    renderTable([uc("1", "submitted", { createdBy: "maker" })], { viewerId: "checker", canVerify: true });
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    const confirm = (await screen.findAllByRole("button", { name: "Return" })).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Why is it being returned?"), { target: { value: "Bills for Q3 missing" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proxy/v1/finance/utilization-certificates/1/reject");
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ reason: "Bills for Q3 missing" });
  });

  it("no verify / return buttons on the viewer's own certificate or without the verifier role", () => {
    renderTable([uc("1", "submitted", { createdBy: "me" })], { viewerId: "me", canVerify: true });
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    cleanup();
    renderTable([uc("1", "submitted", { createdBy: "maker" })], { viewerId: "x", canVerify: false });
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
  });

  it("resubmit: POSTs the optional note to the resubmit route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    renderTable([uc("1", "rejected", { rejectionReason: "Missing bills" })], { viewerId: "maker", canResubmit: true });
    fireEvent.click(screen.getByRole("tab", { name: "Returned" }));
    fireEvent.click(screen.getByRole("button", { name: "Resubmit" }));
    fireEvent.change(await screen.findByLabelText("Note for the verifier (optional)"), { target: { value: "Bills attached" } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Resubmit" })).at(-1)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proxy/v1/finance/utilization-certificates/1/resubmit");
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ note: "Bills attached" });
  });

  it("a server refusal reads in plain words (own certificate), never the code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "MAKER_CHECKER_VIOLATION" }), { status: 409 }));
    renderTable([uc("1", "submitted", { createdBy: "maker" })], { viewerId: "checker", canVerify: true });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Verify" })).at(-1)!);
    const msg = await screen.findByText(/You raised this certificate, so a different officer must verify or return it/);
    expect(msg.textContent).not.toMatch(/MAKER_CHECKER|409/);
  });
});
