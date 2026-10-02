import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

let messages: Record<string, unknown> = en as Record<string, unknown>;
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => (key: string) => {
    const hit = `${ns}.${key}`.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
    if (typeof hit !== "string") throw new Error(`missing message ${ns}.${key}`);
    return hit;
  },
}));

import Page from "./page";

describe("Assets hub", () => {
  // GAP-ASSETS-HOME-01
  it("groups all 16 tiles under five headings with no duplicates", async () => {
    messages = en as Record<string, unknown>;
    render(await Page());
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Overview", "Register & capture", "Registers", "Operate", "Account & dispose"]);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toHaveLength(16);
    expect(new Set(hrefs).size).toBe(16);
    const register = screen.getByRole("region", { name: "Register & capture" });
    expect(within(register).getAllByRole("link")).toHaveLength(4);
  });

  // GAP-ASSETS-HOME-02
  it("renders the subtitle and tiles from the locale catalogue", async () => {
    messages = hi as Record<string, unknown>;
    render(await Page());
    expect(screen.getByText("संपत्ति जीवनचक्र, मूल्यह्रास, रखरखाव और निपटान।")).toBeInTheDocument();
    expect(screen.getByText("संपत्ति रजिस्टर")).toBeInTheDocument();
    expect(screen.queryByText("Asset Register")).not.toBeInTheDocument();
    messages = en as Record<string, unknown>;
  });

  it("has every hub key in both en and hi with matching shape", () => {
    const keys = (o: Record<string, unknown>, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
    const enKeys = keys((en as Record<string, Record<string, unknown>>).assets).sort();
    const hiKeys = keys((hi as Record<string, Record<string, unknown>>).assets).sort();
    expect(hiKeys).toEqual(enKeys);
  });
});
