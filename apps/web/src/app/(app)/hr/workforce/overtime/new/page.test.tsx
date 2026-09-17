import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import OvertimeNewPage from "./page";

// UX-017 (tranche 6): OvertimeNewPage now reads its heading copy through
// next-intl's getTranslations(), which is async -- the component itself is
// now an async Server Component, so every render() call below must await it
// first, same as every other workforce/* page test (e.g.
// ../page.test.tsx's `render(await OvertimePage())`). This file used to call
// `render(<OvertimeNewPage />)` synchronously because the component had no
// data/translation dependency; that no longer works once the component
// returns a Promise instead of a React element.
describe("OvertimeNewPage", () => {
  it("renders page heading", async () => {
    render(await OvertimeNewPage());
    expect(screen.getByRole("heading", { name: /new overtime claim/i })).toBeInTheDocument();
  });

  it("renders CCS Rules reference in subtitle", async () => {
    render(await OvertimeNewPage());
    expect(screen.getByText(/CCS Rules apply/i)).toBeInTheDocument();
  });

  it("embeds the OvertimeClaimForm", async () => {
    render(await OvertimeNewPage());
    expect(screen.getByRole("form", { name: /overtime claim form/i })).toBeInTheDocument();
  });

  it("shows policy note inside form", async () => {
    render(await OvertimeNewPage());
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("shows submit and cancel buttons", async () => {
    render(await OvertimeNewPage());
    expect(screen.getByRole("button", { name: /submit claim/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});
