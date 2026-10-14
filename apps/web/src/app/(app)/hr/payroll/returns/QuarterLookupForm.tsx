import { Button, Field, Input, Select } from "../../../../_components/ds";

// key: any -- see TaxReturnsSummary.tsx's own comment on this exact type.
// key/values: any -- see TaxReturnsSummary.tsx's own comment on this exact type.
type Translator = (key: any, values?: any) => string;

/**
 * Server-safe (no JS required) FY + quarter lookup — a plain GET form that
 * re-navigates this page with ?fy=YYYY-YY&quarter=Qn, letting the server
 * component re-fetch Form-24Q/26Q for that period.
 *
 * Kept as a plain (non-async) component -- see TaxReturnsSummary.tsx's own
 * comment: an async function component nested inside another server
 * component's JSX (rather than a route's own page.tsx) isn't resolved by
 * React Testing Library's render(). ReturnsPage resolves this component's
 * own "quarterLookupForm" translator and passes it down as a prop.
 */
export function QuarterLookupForm({
  defaultFy,
  defaultQuarter,
  quarters,
  t,
}: {
  defaultFy: string;
  defaultQuarter: string;
  quarters: readonly string[];
  t: Translator;
}) {
  return (
    <form method="GET" style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
      <Field id="ret-fy" label={t("financialYearLabel")}>
        <Input
          name="fy"
          aria-describedby="ret-fy-hint"
          defaultValue={defaultFy}
          pattern="\d{4}-\d{2}"
          title={t("fyFormatHint")}
          placeholder="2025-26"
        />
      </Field>
      <Field id="ret-quarter" label={t("quarterLabel")}>
        <Select name="quarter" defaultValue={defaultQuarter}>
          {quarters.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="ghost" style={{ minHeight: 44 }}>
        {t("viewReturnsBtn")}
      </Button>
      <span id="ret-fy-hint" style={{ fontSize: 12, color: "var(--mut)" }}>
        {t("fyFormatHint")}
      </span>
    </form>
  );
}
