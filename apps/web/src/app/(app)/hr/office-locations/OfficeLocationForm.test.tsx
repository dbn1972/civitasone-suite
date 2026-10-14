import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { OfficeLocationForm } from "./OfficeLocationForm";

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); refresh.mockClear(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <OfficeLocationForm />
    </NextIntlClientProvider>,
  );
}

function fill(radius = "200", lat = "28.6139") {
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "HQ" } });
  fireEvent.change(screen.getByLabelText(/^latitude/i), { target: { value: lat } });
  fireEvent.change(screen.getByLabelText(/^longitude/i), { target: { value: "77.2090" } });
  fireEvent.change(screen.getByLabelText(/^radius/i), { target: { value: radius } });
}

describe("OfficeLocationForm (GAP-HR-LOCATIONS-NEW-02)", () => {
  it("rejects a radius outside 50-5000 client-side and never calls the API", () => {
    renderForm();
    fill("10");
    fireEvent.click(screen.getByRole("button", { name: /add office location/i }));
    expect(screen.getAllByRole("alert").some((a) => /between 50 and 5000/i.test(a.textContent ?? ""))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an impossible latitude", () => {
    renderForm();
    fill("200", "123");
    fireEvent.click(screen.getByRole("button", { name: /add office location/i }));
    expect(screen.getByText(/latitude must be between -90 and 90/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for confirmation with the coordinates before posting, then posts the typed body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 201 }));
    renderForm();
    fill();
    fireEvent.click(screen.getByRole("button", { name: /add office location/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/28\.6139/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm and add/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/hrms/office-locations");
    expect(JSON.parse(init.body as string)).toEqual({ name: "HQ", latitude: 28.6139, longitude: 77.209, radiusMeters: 200 });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows a clerk-safe error, not the HTTP status, when the API rejects", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderForm();
    fill();
    fireEvent.click(screen.getByRole("button", { name: /add office location/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm and add/i }));
    const alert = await screen.findByText(/couldn't save/i);
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});
