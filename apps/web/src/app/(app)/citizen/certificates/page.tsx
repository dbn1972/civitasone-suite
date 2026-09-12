import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getCertificates } from "../../../_data/citizenGaps";
import { CertificateVerify } from "./CertificateVerify";
import { useResource } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";

/** SVC-086 — Certificate, licence & permit issuance + public QR verify. */
export default async function CertificatesPage() {
  const result = await getCertificates();
  const { data: certs } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";
  const active = errored
    ? null
    : certs.filter((c) => c.status === "active" || c.status === "amended" || c.status === "renewed").length;

  return (
    <>
      <PageHeader
        title="Certificates & Licences"
        subtitle="Maker-checker issuance with gapless numbering, signed output and QR verification."
      />

      <CertificateVerify />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="pad" style={{ borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
          <strong>Issued certificates</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{active ?? "—"} active</span>
        </div>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "certificates" })} />
          </div>
        ) : certs.length === 0 ? (
          <div className="pad" style={{ color: "var(--muted)" }}>No certificates issued yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>
                  <th scope="col" style={{ padding: 8 }}>Certificate No.</th>
                  <th scope="col" style={{ padding: 8 }}>Type</th>
                  <th scope="col" style={{ padding: 8 }}>Status</th>
                  <th scope="col" style={{ padding: 8 }}>Valid to</th>
                  <th scope="col" style={{ padding: 8 }}>Verify token</th>
                </tr>
              </thead>
              <tbody>
                {certs.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: 8, fontFamily: "monospace" }}>{c.certNo}</td>
                    <td style={{ padding: 8 }}>{c.certType}</td>
                    <td style={{ padding: 8 }}>{c.status}</td>
                    <td style={{ padding: 8 }}>{c.validTo || "—"}</td>
                    <td style={{ padding: 8, fontFamily: "monospace", fontSize: 11 }}>{c.verifyToken ? `${c.verifyToken.slice(0, 12)}…` : "—"}</td>
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
