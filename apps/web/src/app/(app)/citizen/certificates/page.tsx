import { getTranslations } from "next-intl/server";
import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getCertificates } from "../../../_data/citizenGaps";
import { CertificateVerify } from "./CertificateVerify";
import { useResource } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";

/** SVC-086 — Certificate, licence & permit issuance + public QR verify. */
export default async function CertificatesPage() {
  const t = await getTranslations("citizenCertificates");
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
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />

      <CertificateVerify />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="pad" style={{ borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between" }}>
          <strong>{t("listTitle")}</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{active ?? "—"} active</span>
        </div>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "certificates" })} />
          </div>
        ) : certs.length === 0 ? (
          <div className="pad" style={{ color: "var(--muted)" }}>{t("empty")}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>
                  <th scope="col" style={{ padding: 8 }}>{t("colCertNo")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colType")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colStatus")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colValidTo")}</th>
                  <th scope="col" style={{ padding: 8 }}>{t("colVerifyToken")}</th>
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
