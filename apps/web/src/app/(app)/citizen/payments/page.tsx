import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getFeeSchedules } from "../../../_data/citizenGaps";
import { PaymentPanel } from "./PaymentPanel";
import { useResource } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";

/** SVC-085 — Service fee & payment handling. */
export default async function PaymentsPage() {
  const result = await getFeeSchedules();
  const { data: schedules } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  return (
    <>
      <PageHeader
        title="Fees & Payments"
        subtitle="Fee schedules with exemptions, payment intents, receipts and maker-checker refunds."
      />

      <PaymentPanel schedules={schedules.map((s) => ({ id: s.id, name: s.name }))} />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="pad" style={{ borderBottom: "1px solid var(--line)" }}><strong>Fee schedules</strong></div>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "fee schedules" })} />
          </div>
        ) : schedules.length === 0 ? (
          <div className="pad" style={{ color: "var(--muted)" }}>No fee schedules configured.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>
                  <th scope="col" style={{ padding: 8 }}>Name</th>
                  <th scope="col" style={{ padding: 8 }}>Base amount</th>
                  <th scope="col" style={{ padding: 8 }}>Currency</th>
                  <th scope="col" style={{ padding: 8 }}>Exemptions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: 8 }}>{s.name}</td>
                    <td style={{ padding: 8 }}>{s.baseAmount}</td>
                    <td style={{ padding: 8 }}>{s.currency}</td>
                    <td style={{ padding: 8 }}>{s.exemptionCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
