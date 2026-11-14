/**
 * S8-G4: the designations table and the add form on a tenant with private grade bands, and the proof that a
 * government tenant (the default props) is unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { DesignationsTable } from "./DesignationsTable";
import { AddDesignationForm } from "./new/AddDesignationForm";
import type { GradeBand } from "@/lib/gradeBands";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const band = (code: string, rank: number, extra: Partial<GradeBand> = {}): GradeBand => ({
  id: `band-${code}`, code, name: `${code} name`, rank, track: null, ctcMinMinor: null, ctcMaxMinor: null,
  noticeDays: null, isActive: true, version: 1, ...extra,
});
const BANDS = [band("C2", 20), band("T3", 30), band("OLD", 5, { isActive: false })];
const ITEMS = [
  { id: "d1", code: "ENG", name: "Engineer", level: 0, payGrade: null, gradeBandId: "band-C2" },
  { id: "d2", code: "MGR", name: "Manager", level: 40, payGrade: "legacy", gradeBandId: null },
  { id: "d3", code: "RET", name: "Retired role", level: 0, payGrade: null, gradeBandId: "band-OLD" },
];

const wrap = (ui: React.ReactElement, locale: "en" | "hi" = "en") =>
  render(<NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>{ui}</NextIntlClientProvider>);

describe("DesignationsTable on a private-bands tenant", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a Grade band column and hides the 7th CPC level and the government service group", () => {
    wrap(<DesignationsTable items={ITEMS} canEdit payScale="private_bands" bands={BANDS} />);
    expect(screen.getByRole("columnheader", { name: /grade band/i })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /pay level/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /service group/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Group-[ABC]/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Level 40/)).not.toBeInTheDocument();
    expect(screen.getByText("C2")).toBeInTheDocument();
    expect(screen.getByText("No band")).toBeInTheDocument();
    expect(screen.getByText(/grade band decides its rank/i)).toBeInTheDocument();
  });

  it("edit offers the active bands (plus the row's own inactive band), and PATCH sends gradeBandId and never a level", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "d2" }), { status: 202 }));
    wrap(<DesignationsTable items={ITEMS} canEdit payScale="private_bands" bands={BANDS} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Manager" }));
    const select = screen.getByRole("combobox", { name: "Grade band" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["No band", "C2 — C2 name", "T3 — T3 name"]);
    fireEvent.change(select, { target: { value: "band-T3" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ code: "MGR", name: "Manager", payGrade: "legacy", gradeBandId: "band-T3" });
    expect(body).not.toHaveProperty("level");
    await waitFor(() => expect(screen.getByText("T3")).toBeInTheDocument());
  });

  it("keeps an inactive band selectable on the row that already uses it, labelled as inactive, and can clear to no band", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    wrap(<DesignationsTable items={ITEMS} canEdit payScale="private_bands" bands={BANDS} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Retired role" }));
    const select = screen.getByRole("combobox", { name: "Grade band" });
    expect(select).toHaveValue("band-OLD");
    expect(within(select).getByRole("option", { name: /OLD.*\(inactive\)/ })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).gradeBandId).toBeNull();
  });

  it("a government tenant (default props) is exactly as before: level + service group columns, no band column, level in the PATCH", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    wrap(<DesignationsTable items={[{ id: "d9", code: "SO", name: "Section Officer", level: 7, payGrade: "PB-2" }]} canEdit />);
    expect(screen.getByRole("columnheader", { name: /pay level \(7th cpc\)/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /service group/i })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /grade band/i })).not.toBeInTheDocument();
    expect(screen.getByText("Group-B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ code: "SO", name: "Section Officer", level: 7, payGrade: "PB-2" });
  });

  it("is available in Hindi", () => {
    wrap(<DesignationsTable items={ITEMS} canEdit payScale="private_bands" bands={BANDS} />, "hi");
    expect(screen.getByRole("columnheader", { name: "ग्रेड बैंड" })).toBeInTheDocument();
    expect(screen.getByText("कोई बैंड नहीं")).toBeInTheDocument();
  });
});

describe("AddDesignationForm on a private-bands tenant", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("replaces the pay-level field with a labelled band picker listing only active bands", () => {
    wrap(<AddDesignationForm onCancel={vi.fn()} payScale="private_bands" bands={BANDS} />);
    expect(screen.queryByLabelText(/pay level/i)).not.toBeInTheDocument();
    const select = screen.getByLabelText(/grade band/i);
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["No band", "C2 — C2 name", "T3 — T3 name"]);
    expect(select).toHaveAccessibleDescription(/bands are managed under hr/i);
  });

  it("posts gradeBandId and no level", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "n" }), { status: 202 }));
    wrap(<AddDesignationForm onCancel={vi.fn()} payScale="private_bands" bands={BANDS} />);
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: "SE" } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Senior Engineer" } });
    fireEvent.change(screen.getByLabelText(/grade band/i), { target: { value: "band-T3" } });
    fireEvent.click(screen.getByRole("button", { name: /add designation/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ code: "SE", name: "Senior Engineer", gradeBandId: "band-T3" });
  });

  it("with no bands yet it says so and links to the band screen instead of an empty dropdown", () => {
    wrap(<AddDesignationForm onCancel={vi.fn()} payScale="private_bands" bands={[]} />);
    expect(screen.getByRole("link", { name: /open grade bands/i })).toHaveAttribute("href", "/hr/grade-bands");
  });

  it("a government tenant (default props) still gets the pay-level field and no band picker", () => {
    wrap(<AddDesignationForm onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/pay level/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/grade band/i)).not.toBeInTheDocument();
  });
});
