import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { emptyNotificationsDesign } from "@/app/_components/ds/designer/notificationTypes";
import { NotificationsBuilder } from "./NotificationsBuilder";

vi.mock("../_data/notificationBuilderApi", async () => {
  const actual = await vi.importActual<typeof import("../_data/notificationBuilderApi")>(
    "../_data/notificationBuilderApi",
  );
  return {
    ...actual,
    persistNotificationTemplates: vi.fn(async (design: unknown) => design),
  };
});

describe("NotificationsBuilder", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows summary and opens editor with FormRenderer sample preview", () => {
    render(
      <NotificationsBuilder
        serviceKey="tl"
        serviceName="Trade License"
        pattern="certificate"
        initial={emptyNotificationsDesign("certificate")}
      />,
    );

    expect(screen.getByTestId("notifications-summary")).toHaveTextContent(/messages on/i);
    fireEvent.click(screen.getByLabelText(/Edit Application submitted SMS template/i));
    expect(screen.getByTestId("notification-sample-form")).toBeInTheDocument();
    expect(screen.getByLabelText(/Applicant name/i)).toBeInTheDocument();
  });

  // GAP-DESIGNER-DETAIL-B8-01: locale tabs + the completeness warning follow
  // the service's own locales, not a hard-coded en/hi.
  it("renders English + Odia tabs (not Hindi) for an ['en','or'] service and warns about the missing Odia locale", () => {
    render(
      <NotificationsBuilder
        serviceKey="tl"
        serviceName="Trade License"
        pattern="certificate"
        locales={["en", "or"]}
        initial={emptyNotificationsDesign("certificate")}
      />,
    );

    // The seed fills en + hi, so en/or is incomplete and the warning names Odia,
    // never "Hindi or English".
    const summary = screen.getByTestId("notifications-summary");
    expect(summary).toHaveTextContent(/ଓଡ଼ିଆ/);
    expect(summary).not.toHaveTextContent(/Hindi or English/);

    // Open a cell → the locale tabs are English + Odia, with no Hindi tab.
    fireEvent.click(screen.getByLabelText(/Edit Application submitted SMS template/i));
    const tablist = screen.getByRole("tablist", { name: /locale/i });
    const tabNames = screen.getAllByRole("tab").map((t) => t.textContent ?? "");
    expect(tablist).toBeInTheDocument();
    expect(tabNames.some((n) => n.includes("English"))).toBe(true);
    expect(tabNames.some((n) => n.includes("ଓଡ଼ିଆ"))).toBe(true);
    expect(tabNames.some((n) => n.includes("हिंदी"))).toBe(false);
  });
});
