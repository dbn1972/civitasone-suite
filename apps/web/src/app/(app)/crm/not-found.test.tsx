import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CrmNotFound from "./not-found";

describe("CRM not-found (GAP-CRM-HOME-05)", () => {
  it("offers a working link back to the CRM hub", () => {
    render(<CrmNotFound />);
    const link = screen.getByRole("link", { name: "Back to CRM" });
    expect(link).toHaveAttribute("href", "/crm");
  });
});
