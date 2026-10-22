import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import enMessages from "@/messages/en.json";
import { FeedRow, type FeedItem } from "./FeedRow";

function renderRow(item: FeedItem) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <FeedRow item={item} />
    </NextIntlClientProvider>,
  );
}

const BASE = { id: "x1", createdAt: "2026-09-20T10:00:00Z" };

describe("FeedRow (GAP-HR-SOCIAL-FEED-05)", () => {
  it.each([
    ["kudos", { type: "kudos", giver_name: "A", receiver_name: "B", badge: "star" }, "Kudos"],
    ["birthday", { type: "birthday", name: "Priya", department: "Finance", designation: "Officer" }, "Birthday"],
    ["new_joinee", { type: "new_joinee", name: "Ravi", department: "Works", designation: "Engineer" }, "New joinee"],
    ["announcement", { type: "announcement", title: "Holiday", body: "Office closed", category: "general" }, "Announcement"],
  ])("a %s row announces its type in text, not by emoji alone", (_kind, partial, label) => {
    const { container } = renderRow({ ...BASE, ...partial } as FeedItem);
    const sr = container.querySelector(".sr-only");
    expect(sr?.textContent).toBe(label);
    // the glyph itself is hidden from assistive tech
    const glyph = container.querySelector('span[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    expect(glyph?.textContent?.length).toBeGreaterThan(0);
  });

  it("a pinned announcement gets the pin glyph and the info tone", () => {
    const { container } = renderRow({ ...BASE, type: "announcement", title: "T", body: "B", pinned: true } as FeedItem);
    expect(container.querySelector('span[aria-hidden="true"]')?.textContent).toBe("📌");
    expect((container.firstChild as HTMLElement).style.background).toBe("var(--infobg)");
  });

  it("renders the category as a design-system pill, not a hand-coloured span", () => {
    const { container } = renderRow({ ...BASE, type: "announcement", title: "T", body: "B", category: "policy" } as FeedItem);
    const pill = screen.getByText("policy");
    expect(pill.className).toContain("pill");
    expect(container.innerHTML).not.toContain("primary-l");
  });

  it("renders nothing for an unknown item type", () => {
    const { container } = renderRow({ ...BASE, type: "mystery" } as FeedItem);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("social-feed styling only uses defined design tokens (GAP-HR-SOCIAL-FEED-05 step 3)", () => {
  const SRC = join(process.cwd(), "src/app");
  const css = readFileSync(join(SRC, "civitas-ds.css"), "utf8");
  const defined = new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));

  it.each(["FeedRow.tsx", "page.tsx", "loading.tsx", "BirthdaySharingToggle.tsx"])("%s references no undefined CSS variable", (file) => {
    const src = readFileSync(join(SRC, "(app)/hr/social-feed", file), "utf8");
    // strip comments: they may name the old, removed tokens
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const used = [...code.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((m) => m[1]!);
    const undefinedTokens = used.filter((v) => !defined.has(v));
    expect(undefinedTokens).toEqual([]);
  });

  it("the two tokens the page used to rely on really are undefined (so the guard above is meaningful)", () => {
    expect(defined.has("--bg2")).toBe(false);
    expect(defined.has("--primary-l")).toBe(false);
  });
});
