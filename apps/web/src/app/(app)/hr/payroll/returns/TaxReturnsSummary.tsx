import { StatusPill } from "@/app/_components/ds";
import { minorToRupeesOrNull } from "@/lib/formatters";

type Quarter = "Q1" | "Q2" | "Q3" | "Q4";

const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4"];

// UX-017: keys are the stable quarter codes, never translated -- only used to
// look up which message key holds the display label.
const QUARTER_LABEL_KEYS: Record<Quarter, string> = {
  Q1: "quarterQ1Label",
  Q2: "quarterQ2Label",
  Q3: "quarterQ3Label",
  Q4: "quarterQ4Label",
};

export type QuarterSummaryRow = {
  quarter: Quarter;
  status: string;
  filingDate: string | null;
  challanRef: string | null;
  totalTdsDepositedMinor: number;
  deducteeCount: number;
};

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

// `key: any` (not `string`) deliberately: next-intl's real translator type
// (what getTranslations/useTranslations/createTranslator actually return) is
// generic over a namespace-specific literal union of valid keys, which is a
// *subtype* of `string` -- so passing that concrete, narrowly-typed function
// into a prop typed `(key: string) => string` fails TypeScript's contravariant
// parameter check (a caller holding the wider-typed prop could otherwise call
// it with a key outside that union). `any` sidesteps the check for this
// intentionally-loose "accept whatever translator the caller already
// resolved" prop, the same shape used to pass `t` into
// ExceptionPanel.tsx's deriveExceptions(slips, t).
// values: any too -- next-intl's real Translator call signature varies its
// `values` parameter's exact shape per message key (some keys take no
// values at all, typed as exactly `undefined` rather than an optional
// Record), which a single simple function type can't structurally match
// either. `any` on both parameters is the pragmatic fit for this
// intentionally-loose prop.
type Translator = (key: any, values?: any) => string;

// Kept as a plain (non-async) component -- unlike a page.tsx, this is a
// server-rendered child nested inside another server component's own JSX
// (ReturnsPage), and an async function component in that nested position
// cannot be resolved by React Testing Library's render() the way Next.js's
// own App Router does (it surfaces as "Objects are not valid as a React
// child (found: [object Promise])" in every test that renders ReturnsPage
// or this component directly). ReturnsPage already calls getTranslations
// once for its own "payrollReturns" namespace; it now also resolves this
// component's own "taxReturnsSummary" translator and passes it down as a
// prop, the same "pass the caller's own t" pattern already used by
// ExceptionPanel.tsx's deriveExceptions(slips, t) in the [id] cluster.
export function TaxReturnsSummary({ fy, quarters, t }: { fy: string; quarters: QuarterSummaryRow[]; t: Translator }) {
  // UX-022: the per-quarter figure below already guards against a missing
  // totalTdsDepositedMinor (UX-018) by rendering "—" instead of dividing a
  // possibly-missing value. The annual tile has the same exposure one level
  // up: a bare `+` reduce turns a single `undefined` quarter total into
  // "₹NaN" for the whole year, and a single `null` quarter total into a
  // silent undercount (`s + null` coerces to `s + 0`) with no visible sign
  // anything is wrong. Convention, chosen to match UX-018's per-quarter
  // answer to the same question (show "—" rather than a fabricated number):
  // if ANY quarter's total is unknown, the annual tile shows "—" too, rather
  // than quietly summing only the known quarters — silently excluding a
  // missing quarter from the sum is itself indistinguishable from treating
  // it as a real zero, the exact masking this campaign closes.
  const quarterTdsRupees = quarters.map((q) => minorToRupeesOrNull(q.totalTdsDepositedMinor));
  const totalTdsRupees = quarterTdsRupees.some((r) => r === null)
    ? null
    : quarterTdsRupees.reduce<number>((s, r) => s + (r as number), 0);
  const filedCount = quarters.filter((q) => q.status === "filed" || q.status === "late_filed").length;
  const qMap = new Map<Quarter, QuarterSummaryRow>(quarters.map((q) => [q.quarter, q]));
  const filedLabel = String(filedCount) + " / 4";

  return (
    <div>
      {/* Annual summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
        <div style={{ background: "var(--infobg)", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("financialYearLabel")}</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{fy}</div>
        </div>
        <div style={{ background: "var(--goodbg)", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("quartersFiledLabel")}</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{filedLabel}</div>
        </div>
        <div style={{ background: "var(--panel)", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("totalTdsDepositedLabel")}</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{totalTdsRupees === null ? "—" : inrFmt.format(totalTdsRupees)}</div>
        </div>
      </div>

      {/* Quarter rows */}
      <div style={{ display: "grid", gap: 10 }}>
        {QUARTERS.map((q) => {
          const data = qMap.get(q);
          // UX-018: deducteeCount > 0 gates whether this quarter has data at all, but
          // doesn't guarantee totalTdsDepositedMinor itself is present — a partial API
          // response could have one without the other. Don't divide a possibly-missing
          // value; let minorToRupeesOrNull distinguish "missing" from a genuine zero.
          const tdsRupees = minorToRupeesOrNull(data?.totalTdsDepositedMinor);
          return (
            <div
              key={q}
              style={{
                border: "1px solid var(--line2)",
                borderRadius: 10,
                padding: "14px 18px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t(QUARTER_LABEL_KEYS[q])}</div>
                {data?.filingDate ? (
                  <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>
                    {t("filedOnText", { date: new Date(data.filingDate).toLocaleDateString("en-IN") })}
                  </div>
                ) : null}
                {data?.challanRef ? (
                  <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--ink2)", marginTop: 1 }}>
                    {t("challanRefText", { ref: data.challanRef })}
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                {data && data.deducteeCount > 0 ? (
                  <div style={{ textAlign: "end" }}>
                    <div style={{ fontSize: 11, color: "var(--ink2)" }}>{t("tdsDepositedLabel")}</div>
                    <div style={{ fontWeight: 700 }}>{tdsRupees === null ? "—" : inrFmt.format(tdsRupees)}</div>
                  </div>
                ) : null}
                {data && data.deducteeCount > 0 ? (
                  <div style={{ textAlign: "end" }}>
                    <div style={{ fontSize: 11, color: "var(--ink2)" }}>{t("deducteesLabel")}</div>
                    <div style={{ fontWeight: 700 }}>{data.deducteeCount}</div>
                  </div>
                ) : null}
                <StatusPill status={data?.status ?? "pending"} />
                <a
                  className="btn ghost sm"
                  href={"/hr/payroll/returns?fy=" + encodeURIComponent(fy) + "&quarter=" + q}
                  style={{ fontSize: 12 }}
                >
                  {t("viewDetailLink")}
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
