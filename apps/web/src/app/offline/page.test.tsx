import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

// OfflineActions is a client component with its own tests; stub it here so the
// server-component page test stays focused on layout/tokens/i18n.
vi.mock("./OfflineActions", () => ({ OfflineActions: () => <div data-testid="offline-actions" /> }));

import OfflinePage from "./page";

describe("OfflinePage", () => {
  // GAP-OFFLINE-HOME-04: copy comes from the next-intl offlinePage namespace.
  it("renders the translated title and intro (not hard-coded English literals)", async () => {
    render(await OfflinePage());
    expect(screen.getByRole("heading", { name: enMessages.offlinePage.title })).toBeInTheDocument();
    expect(screen.getByText(enMessages.offlinePage.intro)).toBeInTheDocument();
  });

  it("mounts the client actions component", async () => {
    render(await OfflinePage());
    expect(screen.getByTestId("offline-actions")).toBeInTheDocument();
  });

  // GAP-OFFLINE-HOME-03: styling uses DS tokens (var(--...)), no hard-coded hex,
  // so the page follows the .dark theme and the real brand colour.
  it("uses design-system CSS variables for colours, not hard-coded hex", async () => {
    const { container } = render(await OfflinePage());
    const main = container.querySelector("main")!;
    expect(main.style.background).toContain("var(--bg)");
    const heading = container.querySelector("h1")!;
    expect(heading.style.color).toContain("var(--ink)");
    // No forced light-mode hex anywhere in the server-rendered markup.
    expect(container.innerHTML).not.toMatch(/#f8fafc|#0f172a|#475569|#4f46e5/i);
  });

  // GAP-OFFLINE-HOME-04: Hindi parity for every offlinePage key.
  it("has a Hindi translation for every offlinePage key", () => {
    const enKeys = Object.keys(enMessages.offlinePage).sort();
    const hiKeys = Object.keys(hiMessages.offlinePage).sort();
    expect(hiKeys).toEqual(enKeys);
    for (const k of enKeys) {
      const v = (hiMessages.offlinePage as Record<string, string>)[k];
      expect(v, `hi.offlinePage.${k}`).toBeTruthy();
    }
  });
});
