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
});
