import { StatusPill } from "@/app/_components/ds";

type Quarter = "Q1" | "Q2" | "Q3" | "Q4";

const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4"];

const QUARTER_LABELS: Record<Quarter, string> = {
  Q1: "Q1 — Apr to Jun",
  Q2: "Q2 — Jul to Sep",
  Q3: "Q3 — Oct to Dec",
  Q4: "Q4 — Jan to Mar",
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

export function TaxReturnsSummary({ fy, quarters }: { fy: string; quarters: QuarterSummaryRow[] }) {
  const totalTds = quarters.reduce((s, q) => s + q.totalTdsDepositedMinor, 0);
  const filedCount = quarters.filter((q) => q.status === "filed" || q.status === "late_filed").length;
  const qMap = new Map<Quarter, QuarterSummaryRow>(quarters.map((q) => [q.quarter, q]));
  const filedLabel = String(filedCount) + " / 4";

  return (
    <div>
      {/* Annual summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
        <div style={{ background: "var(--infobg)", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Financial Year</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{fy}</div>
        </div>
        <div style={{ background: "var(--goodbg)", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Quarters Filed</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{filedLabel}</div>
        </div>
        <div style={{ background: "var(--panel)", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Total TDS Deposited</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{inrFmt.format(totalTds / 100)}</div>
        </div>
      </div>

      {/* Quarter rows */}
      <div style={{ display: "grid", gap: 10 }}>
        {QUARTERS.map((q) => {
          const data = qMap.get(q);
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
                <div style={{ fontWeight: 700, fontSize: 14 }}>{QUARTER_LABELS[q]}</div>
                {data?.filingDate ? (
                  <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>
                    {"Filed: " + new Date(data.filingDate).toLocaleDateString("en-IN")}
                  </div>
                ) : null}
                {data?.challanRef ? (
                  <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--ink2)", marginTop: 1 }}>
                    {"Challan: " + data.challanRef}
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                {data && data.deducteeCount > 0 ? (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "var(--ink2)" }}>TDS Deposited</div>
                    <div style={{ fontWeight: 700 }}>{inrFmt.format(data.totalTdsDepositedMinor / 100)}</div>
                  </div>
                ) : null}
                {data && data.deducteeCount > 0 ? (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "var(--ink2)" }}>Deductees</div>
                    <div style={{ fontWeight: 700 }}>{data.deducteeCount}</div>
                  </div>
                ) : null}
                <StatusPill status={data?.status ?? "pending"} />
                <a
                  className="btn ghost sm"
                  href={"/hr/payroll/returns?fy=" + encodeURIComponent(fy) + "&quarter=" + q}
                  style={{ fontSize: 12 }}
                >
                  View detail
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
