import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { contrast, WCAG_AA_NORMAL } from "@/lib/contrast";
import type { CrmGrievanceRow } from "../../../_data/loaders";
import { GrievancesTable } from "./GrievancesTable";
import { GrievanceFilters } from "./GrievanceFilters";

function row(id: string, over: Partial<CrmGrievanceRow> = {}): CrmGrievanceRow {
  return {
    id,
    referenceNo: `GRV/2026/${id}`,
    citizenName: `Citizen ${id}`,
    category: "water_supply",
    subject: `Grievance ${id}`,
    priority: "normal",
    status: "REGISTERED",
    assignedTo: null,
    dueAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

/** The table row (tr) that carries a grievance's reference number. */
function rowFor(ref: string): HTMLElement {
  return screen.getByText(ref).closest("tr") as HTMLElement;
}

describe("GrievancesTable status + priority display (GAP-CRM-GRIEVANCES-06)", () => {
  it("labels the APPEAL row's status pill 'First appeal' and the other CPGRAMS states by their own names", () => {
    renderWithIntl(
      <GrievancesTable
        grievances={[
          row("1", { status: "REGISTERED" }),
          row("2", { status: "FORWARDED" }),
          row("3", { status: "ATTENDED" }),
          row("4", { status: "DISPOSED" }),
          row("5", { status: "APPEAL" }),
        ]}
      />,
    );
    // The row also carries a priority pill, so pick out the status pill(s) by their label.
    const statusText = (ref: string) =>
      [...rowFor(ref).querySelectorAll(".pill")].map((p) => p.textContent).filter((t) => /registered|forwarded|attended|disposed|appeal/i.test(t ?? ""));
    expect(statusText("GRV/2026/1")).toEqual(["Registered"]);
    expect(statusText("GRV/2026/2")).toEqual(["Forwarded"]);
    expect(statusText("GRV/2026/3")).toEqual(["Attended"]);
    expect(statusText("GRV/2026/4")).toEqual(["Disposed"]);
    expect(statusText("GRV/2026/5")).toEqual(["First appeal"]);
    // ... and never the bare enum word.
    expect(screen.queryByText("Appeal")).not.toBeInTheDocument();
  });

  it("renders priority with the shared tone classes (urgent=bad, high=warn, normal/low=mut)", () => {
    renderWithIntl(
      <GrievancesTable
        grievances={[
          row("1", { priority: "urgent" }),
          row("2", { priority: "high" }),
          row("3", { priority: "normal" }),
          row("4", { priority: "low" }),
        ]}
      />,
    );
    const prio = (ref: string, label: string) =>
      [...rowFor(ref).querySelectorAll(".pill")].find((p) => p.textContent === label)!;
    expect(prio("GRV/2026/1", "Urgent")).toHaveClass("pill", "bad");
    expect(prio("GRV/2026/2", "High")).toHaveClass("pill", "warn");
    expect(prio("GRV/2026/3", "Normal")).toHaveClass("pill", "mut");
    expect(prio("GRV/2026/4", "Low")).toHaveClass("pill", "mut");
    // No hand-rolled inline colours on the priority pill.
    expect(prio("GRV/2026/1", "Urgent").getAttribute("style") ?? "").not.toMatch(/background|color/);
  });
});

describe("status filter wording (GAP-CRM-GRIEVANCES-06)", () => {
  it("names the APPEAL filter 'First appeal'", () => {
    renderWithIntl(<GrievanceFilters />);
    const option = screen.getByRole("option", { name: "First appeal" }) as HTMLOptionElement;
    expect(option.value).toBe("APPEAL");
    expect(screen.queryByRole("option", { name: "Appeal" })).not.toBeInTheDocument();
  });
});

// The `.pill` tone classes are only "theme-safe" if the token pairs they use clear WCAG AA in
// BOTH themes. Read the real stylesheet and compute the ratios, rather than trusting a comment.
describe("priority pill colour contrast, light and dark (WCAG 2.2 AA, 4.5:1)", () => {
  const css = readFileSync(path.resolve(process.cwd(), "src/app/civitas-ds.css"), "utf8");

  function hexTokens(block: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of block.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]!] = m[2]!;
    return out;
  }
  const rootBlock = /(?:^|\n):root\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const darkBlocks = [...css.matchAll(/(?:^|\n)\.dark\{([^}]*)\}/g)].map((m) => m[1]!);
  const light = hexTokens(rootBlock);
  const dark = { ...light, ...Object.assign({}, ...darkBlocks.map(hexTokens)) } as Record<string, string>;

  /** background/foreground token names a `.pill.<tone>` rule uses. */
  function pillTokens(tone: string): { bg: string; fg: string } {
    const m = new RegExp(`\\.pill\\.${tone}\\{background:var\\(--([\\w-]+)\\);color:var\\(--([\\w-]+)\\)`).exec(css);
    if (!m) throw new Error(`.pill.${tone} rule not found in civitas-ds.css`);
    return { bg: m[1]!, fg: m[2]! };
  }

  it("found both theme token sets", () => {
    expect(Object.keys(light).length).toBeGreaterThan(10);
    expect(darkBlocks.length).toBeGreaterThan(0);
    // The dark theme really overrides the pill tokens (otherwise 'dark' would just re-test light).
    expect(dark["bad"]).not.toBe(light["bad"]);
    expect(dark["badbg"]).not.toBe(light["badbg"]);
  });

  it.each([
    ["bad", "urgent"],
    ["warn", "high"],
    ["mut", "normal / low"],
  ])("`.pill.%s` (%s priority) text/background >= 4.5:1 in light and dark", (tone) => {
    const { bg, fg } = pillTokens(tone);
    for (const [theme, tokens] of [["light", light], ["dark", dark]] as const) {
      const fgHex = tokens[fg];
      const bgHex = tokens[bg];
      expect(fgHex, `--${fg} in ${theme}`).toBeDefined();
      expect(bgHex, `--${bg} in ${theme}`).toBeDefined();
      expect(contrast(fgHex!, bgHex!), `${tone} pill in ${theme}: ${fgHex} on ${bgHex}`).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
    }
  });
});
