import { PageHeader, Card, StatGrid, StatCard } from "../../../_components/ds";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ORG_TYPES, ORG_TYPE_LABELS, getTerminology, type OrgType } from "@/lib/orgConfig";

export default function OrgTypePage() {
  requireAnyRole(["admin", "tenant_admin", "platform_admin", "super_admin"]);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Organisation Type"
        subtitle="Choose what kind of organisation you are — this adjusts terminology, default policies, and which features are shown."
        back="/tenant-admin"
        backLabel="Office Admin"
      />

      <Card padding>
        <p style={{ margin: "0 0 16px", color: "var(--ink)", fontSize: 14.5, lineHeight: 1.6 }}>
          CivitasOne adapts to your organisation type. Pick the one that best describes you — the system
          will use the right words, show relevant features, and hide what doesn&apos;t apply.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {ORG_TYPES.map((type) => {
            const t = getTerminology(type);
            return (
              <div
                key={type}
                style={{
                  padding: "16px 18px", borderRadius: 12, border: "1px solid #e2e8f0",
                  background: "#fff",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", marginBottom: 6 }}>
                  {ORG_TYPE_LABELS[type]}
                </div>
                <div style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.5 }}>
                  <div>You are: <strong>{t.orgUnit}</strong></div>
                  <div>Branches called: <strong>{t.branch}</strong></div>
                  <div>Head: <strong>{t.orgHead}</strong></div>
                  <div>Finance authority: <strong>{t.financeHead}</strong></div>
                  <div>Salary called: <strong>{t.salary}</strong></div>
                  <div style={{ marginTop: 4 }}>
                    {t.govtTerms && <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#dbeafe", color: "#1e40af", marginRight: 4 }}>Govt terms</span>}
                    {t.cpcPayMatrix && <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#dcfce7", color: "#166534", marginRight: 4 }}>CPC Pay</span>}
                    {t.ccsLeaveRules && <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#fef3c7", color: "#92400e" }}>CCS Leave</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ margin: "16px 0 0", fontSize: 13, color: "var(--mut)" }}>
          To change your org type, update the tenant settings via <code>PATCH /v1/tenants/:id</code> with <code>{`{"settings":{"orgType":"private"}}`}</code>.
          A full selector form is coming soon.
        </p>
      </Card>
    </main>
  );
}
