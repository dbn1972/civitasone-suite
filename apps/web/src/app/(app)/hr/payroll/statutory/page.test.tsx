import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatutoryHubPage from "./page";

// The "Statutory Compliance Summary" cards above the module directory are
// themselves full-card links to the same consoles the directory tiles below
// link to (e.g. both an "ESI" summary card AND an "ESI" directory tile point
// at /hr/payroll/statutory/esi) -- two legitimate paths to the same
// destination, not a bug, but it means a plain getByRole("link", {name})
// query can match more than one element for ESI/GPF/NPS specifically
// (the three labels that are spelled identically in both places). Assert
// that a link with the expected accessible name AND href exists, rather
// than requiring exactly one match.
function expectSomeLinkTo(name: RegExp, href: string) {
  const matches = screen.getAllByRole("link", { name });
  expect(matches.some((el) => el.getAttribute("href") === href)).toBe(true);
}

describe("StatutoryHubPage", () => {
  it("renders links to every statutory console", () => {
    render(<StatutoryHubPage />);
    expectSomeLinkTo(/PF & ECR/, "/hr/payroll/statutory/pf");
    expectSomeLinkTo(/\bESI\b/, "/hr/payroll/statutory/esi");
    expectSomeLinkTo(/Professional Tax/, "/hr/payroll/statutory/pt");
    expectSomeLinkTo(/Labour Welfare Fund/, "/hr/payroll/statutory/lwf");
    expectSomeLinkTo(/Gratuity/, "/hr/payroll/statutory/gratuity");
    expectSomeLinkTo(/Challans/, "/hr/payroll/statutory/challans");
    expectSomeLinkTo(/Perquisites/, "/hr/payroll/statutory/perquisite");
    expectSomeLinkTo(/\bGPF\b/, "/hr/payroll/gpf");
    expectSomeLinkTo(/\bNPS\b/, "/hr/payroll/nps");
  });
});
