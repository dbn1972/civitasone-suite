import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DevLoginPage from "./page";

const DEMO_PW = "q".repeat(16);

describe("DevLoginPage", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("ENABLE_DEV_LOGIN", "true");
    vi.stubEnv("DEV_LOGIN_PASSWORD", DEMO_PW);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("DEV-01: never renders the DEV_LOGIN_PASSWORD value anywhere in the HTML", () => {
    const { container } = render(<DevLoginPage searchParams={{}} />);
    expect(container.innerHTML).not.toContain("super-secret-demo-pw");
  });

  it("DEV-03: shows a prominent TEST ENVIRONMENT banner (role=note)", () => {
    render(<DevLoginPage searchParams={{}} />);
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(/test environment/i);
  });

  it("DEV-06: auditor description does not claim 'Legal'", () => {
    const { container } = render(<DevLoginPage searchParams={{}} />);
    expect(container.textContent).toContain("auditor");
    expect(container.textContent).not.toMatch(/Audit · Legal/);
  });
});
