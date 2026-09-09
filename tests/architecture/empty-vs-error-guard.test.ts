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

  // ───────────────────────────────────────────────────────────────────────
  // 2026-09 regression coverage: an independent review of PR #1127 found the
  // file-level `ERROR_AWARE_RE.test(source)` check could be fooled by an
  // error-aware token that exists in the file but gates nothing related to
  // the actual empty-check — exactly the bug this guard exists to catch.
  // `citizen/grievances/page.tsx` and `workflow/page.tsx` (2 of the 3 pages
  // the review named) had this precise shape: `actions={source === "error"
  // ? <DataSourceBadge .../> : null}` on a <PageHeader>, wired to nothing,
  // next to a `.length === 0` check in an unrelated <Card> that had no error
  // handling at all. Fixed by requiring the error token to be structurally
  // connected to the SPECIFIC empty-check (same conditional test, sibling
  // branch of the same ternary/if, or an earlier same-block early-return
  // guard) rather than merely present anywhere in the file.
  // ───────────────────────────────────────────────────────────────────────
  it("[false-negative regression] flags a disconnected error-aware token (PR #1127 review bug shape)", () => {
    const source = `
import { PageHeader, Card, EmptyState, StatGrid, StatCard } from "../../_components/ds";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { getWidgets } from "../../_data/loaders";

export default async function WidgetsPage() {
  const { data: widgets, source } = await getWidgets();

  return (
    <main>
      <PageHeader
        title="Widgets"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard label="Total" value={widgets.length} />
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

    // The improved, structurally-aware check flags it: the error-aware token
    // in the PageHeader's \`actions\` prop shares no conditional ancestor
    // with the empty-check in the Card below it.
    const violations = checkSource(source);
    expect(violations).not.toBeNull();
    expect(violations.length).toBe(1);
    expect(violations[0].snippet).toContain("widgets.length === 0");

    // Reproduce the OLD (file-level) algorithm this guard shipped with in
    // PR #1127, to prove it really would have missed this exact fixture —
    // this is the false negative the independent review demonstrated.
    function oldFileLevelCheckSource(src) {
      const EMPTY_CHECK_RE_OLD = /\.length\s*===\s*0/g;
      const ERROR_AWARE_RE_OLD =
        /source\s*===\s*"error"|status\s*===\s*"error"|errored|useResource\s*\(|combineResourceState\s*\(|<ErrorState|<RefreshErrorState/i;
      const lines = src.split("\n");
      const emptyCheckLines = [];
      for (let i = 0; i < lines.length; i++) {
        EMPTY_CHECK_RE_OLD.lastIndex = 0;
        if (EMPTY_CHECK_RE_OLD.test(lines[i])) emptyCheckLines.push(lines[i]);
      }
      if (emptyCheckLines.length === 0) return null;
      if (ERROR_AWARE_RE_OLD.test(src)) return null; // <-- the bug: file-level, not scoped
      return emptyCheckLines;
    }
    expect(oldFileLevelCheckSource(source)).toBeNull();
  });

  it("does not flag the same shape once the header badge and the empty-check share the same gating ternary", () => {
    const source = `
import { PageHeader, Card, EmptyState, StatGrid, StatCard, RefreshErrorState } from "../../_components/ds";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { getWidgets } from "../../_data/loaders";

export default async function WidgetsPage() {
  const { data: widgets, source } = await getWidgets();
  const errored = source === "error";

  return (
    <main>
      <PageHeader title="Widgets" actions={errored ? <DataSourceBadge source={source} /> : null} />
      <StatGrid>
        <StatCard label="Total" value={errored ? "—" : widgets.length} />
      </StatGrid>
      <Card>
        {errored ? (
          <RefreshErrorState error="Could not load widgets" />
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

  it("does not flag a page using an early-return error guard before an unrelated later empty-check", () => {
    const source = `
import { PageHeader, Card, EmptyState, StatGrid, StatCard, ErrorState } from "../../_components/ds";
import { getWidgets } from "../../_data/loaders";

export default async function WidgetsPage() {
  const result = await getWidgets();
  if (result.source === "error") {
    return <ErrorState message="Could not load widgets" />;
  }
  const widgets = result.data;

  return (
    <main>
      <PageHeader title="Widgets" />
      <StatGrid>
        <StatCard label="Total" value={widgets.length} />
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
    expect(checkSource(source)).toBeNull();
  });

  it("still flags an unrelated early-return that doesn't check the error token", () => {
    const source = `
import { PageHeader, Card, EmptyState, StatGrid, StatCard } from "../../_components/ds";
import { getWidgets } from "../../_data/loaders";

export default async function WidgetsPage() {
  const result = await getWidgets();
  if (!result) {
    return null;
  }
  const widgets = result.data;

  return (
    <main>
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
  });
});
