import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatutoryHubPage from "./page";

describe("StatutoryHubPage", () => {
  it("renders links to every statutory console", () => {
    render(<StatutoryHubPage />);
    expect(screen.getByRole("link", { name: /PF & ECR/ })).toHaveAttribute("href", "/hr/payroll/statutory/pf");
    expect(screen.getByRole("link", { name: /ESI/ })).toHaveAttribute("href", "/hr/payroll/statutory/esi");
    expect(screen.getByRole("link", { name: /Professional Tax/ })).toHaveAttribute("href", "/hr/payroll/statutory/pt");
    expect(screen.getByRole("link", { name: /Labour Welfare Fund/ })).toHaveAttribute("href", "/hr/payroll/statutory/lwf");
    expect(screen.getByRole("link", { name: /Gratuity/ })).toHaveAttribute("href", "/hr/payroll/statutory/gratuity");
    expect(screen.getByRole("link", { name: /Challans/ })).toHaveAttribute("href", "/hr/payroll/statutory/challans");
    expect(screen.getByRole("link", { name: /Perquisites/ })).toHaveAttribute("href", "/hr/payroll/statutory/perquisite");
    expect(screen.getByRole("link", { name: "GPF" })).toHaveAttribute("href", "/hr/payroll/gpf");
    expect(screen.getByRole("link", { name: "NPS" })).toHaveAttribute("href", "/hr/payroll/nps");
  });
});
