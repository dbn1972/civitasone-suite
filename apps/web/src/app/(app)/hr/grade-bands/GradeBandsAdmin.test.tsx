import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import type { GradeBand } from "@/lib/gradeBands";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { GradeBandsAdmin } from "./GradeBandsAdmin";

const band = (o: Partial<GradeBand> & Pick<GradeBand, "id" | "code" | "rank">): GradeBand => ({
  name: o.code, track: null, ctcMinMinor: null, ctcMaxMinor: null, noticeDays: null, isActive: true, version: 1, designationCount: 0, ...o,
});
const BANDS = [
  band({ id: "b1", code: "C2", name: "Consultant 2", rank: 20, track: "Technical", noticeDays: 30, ctcMinMinor: "600000000", ctcMaxMinor: "900000000", version: 4, designationCount: 2 }),
  band({ id: "b2", code: "M2", name: "Manager 2", rank: 40 }),
  band({ id: "b3", code: "OLD", name: "Retired", rank: 5, isActive: false }),
];

type Opts = { canManage?: boolean; canSwitchScale?: boolean; payScale?: "cpc7" | "private_bands"; bands?: GradeBand[]; loadFailed?: boolean; locale?: "en" | "hi" };
function renderAdmin(o: Opts = {}) {
  const locale = o.locale ?? "en";
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      <GradeBandsAdmin
        initialBands={o.bands ?? BANDS} loadFailed={o.loadFailed ?? false}
        canManage={o.canManage ?? true} canSwitchScale={o.canSwitchScale ?? true} payScale={o.payScale ?? "private_bands"}
      />
    </NextIntlClientProvider>,
  );
}
const ok202 = (id = "new-id") => new Response(JSON.stringify({ id, status: "accepted" }), { status: 202 });
const lastBody = (fetchMock: ReturnType<typeof vi.fn>, i = -1) => {
  const call = fetchMock.mock.calls.at(i)!;
  return { url: call[0] as string, init: call[1] as RequestInit, body: call[1]?.body ? JSON.parse(call[1].body as string) : undefined };
};

describe("GradeBandsAdmin", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); refresh.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("lists the bands by rank with an accessible caption, formatted CTC and notice, and status text (not colour alone)", () => {
    renderAdmin();
    expect(screen.getByRole("table", { name: /grade bands, from most senior/i })).toBeInTheDocument();
    expect(screen.getByText("₹60,00,000 – ₹90,00,000")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
  });

  it("every row action names its band, so a screen-reader list of buttons is unambiguous", () => {
    renderAdmin();
    for (const code of ["C2", "M2", "OLD"]) {
      expect(screen.getByRole("button", { name: `Edit band ${code}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Delete band ${code}` })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Deactivate band C2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivate band OLD" })).toBeInTheDocument();
  });

  it("a band in use cannot be deleted: the button is aria-disabled, stays focusable and points at its reason", () => {
    renderAdmin();
    const del = screen.getByRole("button", { name: "Delete band C2" });
    expect(del).toHaveAttribute("aria-disabled", "true");
    const reason = document.getElementById(del.getAttribute("aria-describedby")!)!;
    expect(reason).toHaveTextContent(/used by 2 designations/i);
    fireEvent.click(del);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete band M2" })).not.toHaveAttribute("aria-disabled");
  });

  it("creates a band: validates first, posts the right body (rupees -> paise, code as typed), shows 'submitted' and refreshes", async () => {
    fetchMock.mockResolvedValue(ok202("n1"));
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /new band/i }));
    expect(screen.getByRole("heading", { name: "Add a grade band" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Add band" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("Enter a band code.")).toBeInTheDocument();
    expect(screen.getByText("Enter a name of at least 2 characters.")).toBeInTheDocument();
    expect(screen.getByText("Enter a whole number from 1 to 9999.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/band code/i), { target: { value: "t3" } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Tech Lead" } });
    fireEvent.change(screen.getByLabelText(/^rank/i), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/ctc from/i), { target: { value: "12,00,000" } });
    fireEvent.change(screen.getByLabelText(/ctc up to/i), { target: { value: "18,00,000" } });
    fireEvent.change(screen.getByLabelText(/notice period/i), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Add band" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { url, init, body } = lastBody(fetchMock);
    expect(url).toBe("/api/proxy/v1/hrms/admin/grade-bands");
    expect(init.method).toBe("POST");
    expect(body).toEqual({ code: "t3", name: "Tech Lead", rank: 30, track: null, ctcMinMinor: "120000000", ctcMaxMinor: "180000000", noticeDays: 60 });
    expect(await screen.findByText(/band T3 submitted/i)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit band T3" })).toBeInTheDocument();
  });

  it("rejects a bad code, an inverted CTC range and an out-of-range rank before any request", async () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /new band/i }));
    fireEvent.change(screen.getByLabelText(/band code/i), { target: { value: "no spaces" } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Name" } });
    fireEvent.change(screen.getByLabelText(/^rank/i), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText(/ctc from/i), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/ctc up to/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Add band" }));
    expect(await screen.findByText("Use letters, digits, dot, underscore or hyphen only, up to 16 characters.")).toBeInTheDocument();
    expect(screen.getByText("Enter a whole number from 1 to 9999.")).toBeInTheDocument();
    expect(screen.getByText("The minimum cannot be above the maximum.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's duplicate-code message on the field's form, never a raw status", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "DUPLICATE_CODE", message: "Grade band \"C2\" already exists.", fieldErrors: [{ field: "code", message: "This code is already in use." }] }), { status: 409 }));
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /new band/i }));
    fireEvent.change(screen.getByLabelText(/band code/i), { target: { value: "C2" } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Again" } });
    fireEvent.change(screen.getByLabelText(/^rank/i), { target: { value: "21" } });
    fireEvent.click(screen.getByRole("button", { name: "Add band" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/409/)).not.toBeInTheDocument();
  });

  it("edit: the code is read-only, the form loads the row, and the PATCH carries expectedVersion and no code", async () => {
    fetchMock.mockResolvedValue(ok202("b1"));
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "Edit band C2" }));
    expect(screen.getByRole("heading", { name: "Edit band C2" })).toHaveFocus();
    expect(screen.getByLabelText(/band code/i)).toBeDisabled();
    expect(screen.getByLabelText(/band code/i)).toHaveValue("C2");
    expect(screen.getByLabelText(/ctc from/i)).toHaveValue("6000000");
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Consultant II" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { url, init, body } = lastBody(fetchMock);
    expect(url).toBe("/api/proxy/v1/hrms/admin/grade-bands/b1");
    expect(init.method).toBe("PATCH");
    expect(body).toMatchObject({ name: "Consultant II", rank: 20, expectedVersion: 4, ctcMinMinor: "600000000", ctcMaxMinor: "900000000", noticeDays: 30, track: "Technical" });
    expect(body).not.toHaveProperty("code");
    expect(await screen.findByText(/changes to band C2 submitted/i)).toBeInTheDocument();
  });

  it("deactivate asks first, then posts; reactivate posts straight away", async () => {
    fetchMock.mockResolvedValue(ok202());
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate band M2" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(within(dlg).getByText("Deactivate band M2?")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole("button", { name: "Deactivate band" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastBody(fetchMock).url).toBe("/api/proxy/v1/hrms/admin/grade-bands/b2/deactivate");
    await waitFor(() => expect(screen.getByRole("button", { name: "Reactivate band M2" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Reactivate band OLD" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(lastBody(fetchMock).url).toBe("/api/proxy/v1/hrms/admin/grade-bands/b3/reactivate");
  });

  it("delete confirms, calls DELETE, and removes the row; a 409 keeps the row and explains in the dialog", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: "BAND_IN_USE", message: "x" }), { status: 409 }));
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "Delete band M2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete band" }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent(/designations still use this grade band/i));
    expect(screen.getByRole("button", { name: "Edit band M2" })).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(ok202());
    fireEvent.click(screen.getByRole("button", { name: "Delete band" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit band M2" })).not.toBeInTheDocument());
    expect(lastBody(fetchMock).init.method).toBe("DELETE");
  });

  it("pay-scale switch: only an HR admin sees it as editable; save is disabled until it changes; PUT body is {kind}", async () => {
    fetchMock.mockResolvedValue(ok202());
    renderAdmin({ payScale: "cpc7" });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    expect(screen.getByRole("button", { name: "Save pay scale" })).toBeDisabled();
    fireEvent.click(radios[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Save pay scale" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { url, init, body } = lastBody(fetchMock);
    expect(url).toBe("/api/proxy/v1/hrms/policy-settings/pay_scale");
    expect(init.method).toBe("PUT");
    expect(body).toEqual({ kind: "private_bands" });
    expect(await screen.findByText(/pay scale saved/i)).toBeInTheDocument();
  });

  it("a viewer without write rights gets a read-only table, no form, no switch, no row actions", () => {
    renderAdmin({ canManage: false, canSwitchScale: false });
    expect(screen.queryByRole("button", { name: /new band/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit band/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText(/only an hr administrator can change this/i)).toBeInTheDocument();
    expect(screen.getByText("Manager 2")).toBeInTheDocument();
  });

  it("empty and error states are honest and different", () => {
    const { unmount } = renderAdmin({ bands: [] });
    expect(screen.getByText("No grade bands yet")).toBeInTheDocument();
    unmount();
    renderAdmin({ bands: [], loadFailed: true });
    expect(screen.queryByText("No grade bands yet")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });

  it("renders in Hindi without falling back to English for the page's own strings", () => {
    renderAdmin({ locale: "hi" });
    expect(screen.getByRole("button", { name: /नया बैंड/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "बैंड C2 संपादित करें" })).toBeInTheDocument();
    expect(screen.getByText("इस संगठन का वेतन ढाँचा")).toBeInTheDocument();
  });
});
