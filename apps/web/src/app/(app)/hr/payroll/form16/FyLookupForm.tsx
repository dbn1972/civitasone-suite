import { Button } from "../../../../_components/ds";

/**
 * Server-safe (no JS required) financial-year lookup — a plain GET form that
 * re-navigates this page with ?fy=YYYY-YY, letting the server component below
 * re-fetch the bulk-status job for that year. There is no "list all jobs"
 * endpoint, so this is the FY-scoped substitute for a table.
 *
 * UX-017: stays a plain (non-async) function component and takes its copy as
 * props rather than calling getTranslations itself -- Form16Page (its only
 * caller) already resolves the "fyLookupForm" namespace and passes the
 * strings down. Keeping this component synchronous preserves both its
 * server-safe/no-JS-required design (a real behavioral property, not just
 * style) and its testability: a nested async Server Component rendered as a
 * plain JSX child (`<FyLookupForm .../>`) cannot be awaited by plain
 * react-dom in a vitest/jsdom unit test the way Next.js's real RSC renderer
 * awaits it -- only a directly-awaited top-level page component can be. That
 * mismatch was caught by Form16Page's own test suite (see page.test.tsx).
 */
export function FyLookupForm({
  defaultFy,
  financialYearLabel,
  checkRunLabel,
  formatHint,
}: {
  defaultFy: string;
  financialYearLabel: string;
  checkRunLabel: string;
  formatHint: string;
}) {
  return (
    <form method="GET" style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 16 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor="fy-lookup" style={{ fontSize: 13, fontWeight: 600 }}>
          {financialYearLabel}
        </label>
        <input
          id="fy-lookup"
          name="fy"
          defaultValue={defaultFy}
          pattern="\d{4}-\d{2}"
          placeholder="2025-26"
          aria-describedby="fy-lookup-hint"
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, width: 140 }}
        />
      </div>
      <Button type="submit" variant="ghost" style={{ minHeight: 44 }}>
        {checkRunLabel}
      </Button>
      <span id="fy-lookup-hint" style={{ fontSize: 12, color: "var(--mut)" }}>
        {formatHint}
      </span>
    </form>
  );
}
