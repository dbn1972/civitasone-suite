import { describe, it, expect } from "vitest";
import { getHelpModule } from "@/lib/helpContent";
import { explain } from "@/lib/glossary";
import { findBannedTerms } from "@/lib/labels";

/**
 * GAP-APPROVALS-HOME-04: the /approvals page (PageHeader help="approvals") and
 * its error page (helpHref="/help/approvals") linked to a Help Centre slug that
 * did not exist, so "How this works" 404'd via notFound(). This pins the
 * 'approvals' guide into existence and keeps its copy clerk-safe.
 */
describe("approvals help guide (GAP-APPROVALS-HOME-04)", () => {
  it("getHelpModule('approvals') is defined", () => {
    const mod = getHelpModule("approvals");
    expect(mod, "the /approvals page links to /help/approvals").toBeDefined();
    expect(mod!.href).toBe("/approvals");
    expect(mod!.tasks.length).toBeGreaterThan(0);
  });

  it("every term it references resolves in the glossary", () => {
    const mod = getHelpModule("approvals")!;
    for (const term of mod.terms) {
      expect(explain(term), `unresolved term "${term}"`).toBeTruthy();
    }
  });

  it("its clerk-facing copy carries no banned platform jargon", () => {
    const mod = getHelpModule("approvals")!;
    const copy = [mod.summary, ...mod.tasks.flatMap((t) => [t.title, ...t.steps])].join(" ");
    expect(findBannedTerms(copy)).toEqual([]);
  });
});
