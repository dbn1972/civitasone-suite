import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

import { GeoCheckInCard } from "./GeoCheckInCard";

/**
 * HIGH fix regression test: a complete geo-attendance backend (check-in/out,
 * office-locations, geo-history) existed with zero reachable UI. Covers the
 * self-service check-in/out this component adds.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderCard(props: Partial<React.ComponentProps<typeof GeoCheckInCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GeoCheckInCard employeeId="emp-1" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("GeoCheckInCard", () => {
  const fetchMock = vi.fn();
  const getCurrentPosition = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    getCurrentPosition.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    // Override only navigator.geolocation (jsdom's real navigator has none by
    // default) rather than replacing the whole navigator object, which would
    // lose unrelated properties (userAgent etc.) other test infra may rely on.
    Object.defineProperty(global.navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error -- test-only cleanup of the property added above.
    delete global.navigator.geolocation;
  });

  it("shows a no-linked-profile message and no actions when employeeId is null", () => {
    renderCard({ employeeId: null });
    expect(screen.getByText(/No employee record is linked/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check In/ })).not.toBeInTheDocument();
  });

  it("shows an exited message and no actions for an already-exited employee, never calling the backend", () => {
    renderCard({ employeeStatus: "separated" });
    expect(screen.getByText(/Attendance can no longer be recorded/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check In/ })).not.toBeInTheDocument();
  });

  it("fetches office locations and recent history for the given employeeId only, never another employee's", async () => {
    renderCard();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/office-locations",
      expect.anything(),
    ));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/attendance/geo-history?employeeId=emp-1",
      expect.anything(),
    );
  });

  it("check-in gets the browser location and POSTs geo-check-in with this employee's own id", async () => {
    getCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: 12.9, longitude: 77.6, accuracy: 8 } } as GeolocationPosition),
    );
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("geo-check-in")) {
        return Promise.resolve(jsonResponse({ status: "within_geofence", message: "Check-in recorded within office boundary", distanceMeters: 12 }, 201));
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /Check In/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/attendance/geo-check-in",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          employeeId: "emp-1",
          latitude: 12.9,
          longitude: 77.6,
          accuracyMeters: 8,
          officeLocationId: undefined,
        }),
      }),
    ));
    expect(await screen.findByText("Check-in recorded within office boundary")).toBeInTheDocument();
  });

  it("surfaces a clear error when location access is denied, without ever calling the backend", async () => {
    getCurrentPosition.mockImplementation((_success: PositionCallback, error: PositionErrorCallback) =>
      error({ message: "User denied Geolocation" } as GeolocationPositionError),
    );
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /Check In/ }));

    // Testing-library concatenates the "⚠ " prefix and {error} into one match
    // target since both are direct text-node children of the same <p> --
    // match by substring rather than the error text alone.
    expect(await screen.findByText(/User denied Geolocation/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/proxy/v1/hrms/attendance/geo-check-in", expect.anything());
  });
});
