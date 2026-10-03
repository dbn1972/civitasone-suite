import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { AddLocationForm } from "./AddLocationForm";

// GAP-HR-LOCATIONS-02: the add form in edit mode -- prefilled, PATCHes only what changed.
const EDITING = { id: "loc-1", name: "Block Office", type: "office", parentId: "d1", addressLine: "1 Main St", city: "Delhi", postalCode: "110001", lgdCode: null };
const PARENTS = [{ id: "d1", name: "Central District", type: "district", parentId: null }, { id: "d2", name: "North District", type: "district", parentId: null }];

describe("AddLocationForm in edit mode", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  function renderEdit(onSuccess = vi.fn()) {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddLocationForm editing={EDITING} locations={PARENTS} onCancel={vi.fn()} onSuccess={onSuccess} />
      </NextIntlClientProvider>,
    );
    return onSuccess;
  }

  it("is prefilled and titled Edit, with a Save changes button (not Add)", () => {
    renderEdit();
    expect(screen.getByRole("heading", { name: "Edit Location" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^name/i)).toHaveValue("Block Office");
    expect(screen.getByLabelText(/postal code/i)).toHaveValue("110001");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add location/i })).not.toBeInTheDocument();
  });

  it("PATCHes only the changed fields to the location's own URL (postal code corrected)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "loc-1", status: "accepted" }), { status: 202 }));
    const onSuccess = renderEdit();
    fireEvent.change(screen.getByLabelText(/postal code/i), { target: { value: "110002" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/locations/loc-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ postalCode: "110002" });
  });

  it("clearing an optional field sends null to clear it", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    renderEdit();
    fireEvent.change(screen.getByLabelText(/^city/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ city: null });
  });

  it("an unchanged form says so and sends nothing", async () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/nothing has changed/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still validates the postal code client-side before any request", async () => {
    renderEdit();
    fireEvent.change(screen.getByLabelText(/postal code/i), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/6-digit/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
