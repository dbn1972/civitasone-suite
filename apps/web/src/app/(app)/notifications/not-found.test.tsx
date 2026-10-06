import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import NotificationsNotFound from "./not-found";

// GAP-NOTIFICATIONS-HOME-03: the not-found page must offer a way back to the
// module hub rather than being a dead end. These assertions fail on the old
// code, which rendered an EmptyState with no action.
describe("NotificationsNotFound", () => {
  it("renders the not-found message", () => {
    render(<NotificationsNotFound />);
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("offers a link back to the notifications hub", () => {
    render(<NotificationsNotFound />);
    const link = screen.getByRole("link", { name: /back to notifications/i });
    expect(link).toHaveAttribute("href", "/notifications");
  });
});
