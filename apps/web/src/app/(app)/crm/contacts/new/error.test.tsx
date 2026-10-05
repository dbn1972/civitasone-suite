import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// RouteError uses next/link.
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import ErrorBoundary from "./error";

describe("New Contact error boundary copy (GAP-CRM-CONTACTS-NEW-07)", () => {
  it("names the area 'New Contact', never the broken 'CRM New'", () => {
    const err = Object.assign(new Error("boom"), { digest: "abc" });
    const { container } = render(<ErrorBoundary error={err} reset={() => {}} />);
    // The developer label "CRM New" must not appear in the user-facing copy.
    expect(container.textContent).not.toContain("CRM New");
    // The friendly area name is present.
    expect(container.textContent).toContain("New Contact");
  });
});
