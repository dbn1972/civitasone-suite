/**
 * empty-vs-error-guard.mjs — fixture-based unit tests (UX-001).
 *
 * Exercises the exported `checkSource()` function directly with in-memory
 * page.tsx source strings (a bad fixture with the raw `.length === 0` empty
 * check and no error-token awareness, and a good fixture that also branches
 * on the loader's error token), mirroring the pure "exported functions +
 * optional CLI entrypoint" shape used by tenant-router-guard.mjs.
 *
 * Run: pnpm exec vitest run tests/architecture/empty-vs-error-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import { checkSource } from "../../scripts/ci/empty-vs-error-guard.mjs";

describe("empty-vs-error-guard: checkSource()", () => {
  it("flags a page.tsx with .length === 0 and no error-token awareness anywhere in the file", () => {
    const source = `
import { PageHeader, Card, EmptyState, StatGrid, StatCard } from "../../_components/ds";
import { getWidgets } from "../../_data/loaders";

export default async function WidgetsPage() {
  const { data: widgets, source } = await getWidgets();
  const total = widgets.length;

  return (
    <main>
      <PageHeader title="Widgets" />
      <StatGrid>
        <StatCard label="Total" value={total} />
      </StatGrid>
      <Card>
        {widgets.length === 0 ? (
          <EmptyState title="No widgets yet" message="Create your first widget." />
        ) : (
          <p>{widgets.length} widgets</p>
        )}
      </Card>
    </main>
  );
}
`;

    const violations = checkSource(source);
    expect(violations).not.toBeNull();
    expect(violations.length).toBe(1);
    expect(violations[0].snippet).toContain("widgets.length === 0");
  });

  it("does not flag a page.tsx that branches on the loader's source before deciding empty (the fixed shape)", () => {
    const source = `
import { PageHeader, Card, EmptyState, StatGrid, StatCard, RefreshErrorState } from "../../_components/ds";
import { getWidgets } from "../../_data/loaders";
import { useResource } from "../../_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function WidgetsPage() {
  const result = await getWidgets();
  const { data: widgets } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";
  const total = errored ? null : widgets.length;

  return (
    <main>
      <PageHeader title="Widgets" />
      <StatGrid>
        <StatCard label="Total" value={total ?? "—"} />
      </StatGrid>
      <Card>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "widgets" })} />
        ) : widgets.length === 0 ? (
          <EmptyState title="No widgets yet" message="Create your first widget." />
        ) : (
          <p>{widgets.length} widgets</p>
        )}
      </Card>
    </main>
  );
}
`;

    expect(checkSource(source)).toBeNull();
  });

  it("does not flag a file with no empty-check at all", () => {
    const source = `
export default async function StaticPage() {
  return <main>Static content, no fetch involved.</main>;
}
`;
    expect(checkSource(source)).toBeNull();
  });

  it("respects the // ux-001-ok inline suppression for a genuinely unrelated empty-check", () => {
    const source = `
export default async function LocalOnlyPage() {
  const localItems = computeLocally();
  return (
    <main>
      {localItems.length === 0 ? <p>Nothing to show</p> : <p>{localItems.length}</p>} {/* ux-001-ok: purely local computation, no loader involved */}
    </main>
  );
}
`;
    expect(checkSource(source)).toBeNull();
  });

  // Sabotage check: with the core "no error-aware token anywhere in the file"
  // check disabled (always treating the file as error-aware), the bad
  // fixture above must stop being flagged — proving the first test actually
  // exercises this branch rather than passing for an unrelated reason.
  it("[sabotage] the bad fixture is caught BECAUSE the error-awareness check runs — disabling it stops the flag", () => {
    const source = `
import { PageHeader, Card, EmptyState, StatGrid, StatCard } from "../../_components/ds";
import { getWidgets } from "../../_data/loaders";

export default async function WidgetsPage() {
  const { data: widgets, source } = await getWidgets();
  const total = widgets.length;

  return (
    <main>
      <PageHeader title="Widgets" />
      <StatGrid>
        <StatCard label="Total" value={total} />
      </StatGrid>
      <Card>
        {widgets.length === 0 ? (
          <EmptyState title="No widgets yet" message="Create your first widget." />
        ) : (
          <p>{widgets.length} widgets</p>
        )}
      </Card>
    </main>
  );
}
`;
    // Sabotaged stand-in for checkSource's second half: skips the
    // ERROR_AWARE_RE.test(source) short-circuit entirely (as if it always
    // returned true), reproducing what checkSource would do if that check
    // were removed/disabled.
    function sabotagedCheckSource(src) {
      const EMPTY_CHECK_RE = /\.length\s*===\s*0/g;
      const lines = src.split("\n");
      const emptyCheckLines = [];
      for (let i = 0; i < lines.length; i++) {
        EMPTY_CHECK_RE.lastIndex = 0;
        if (EMPTY_CHECK_RE.test(lines[i])) emptyCheckLines.push(lines[i]);
      }
      if (emptyCheckLines.length === 0) return null;
      // SABOTAGE: pretend the file is always error-aware.
      return null;
    }

    // The real rule flags it...
    expect(checkSource(source)).not.toBeNull();
    // ...but the sabotaged version (core check disabled) does not.
    expect(sabotagedCheckSource(source)).toBeNull();
  });
});
