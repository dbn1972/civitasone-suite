"use client";

import { useTranslations } from "next-intl";
import { formatIndianDateTime } from "@/lib/formatters";
import type { PfmsSigning } from "./signingStatus";

/** Signing status + certificate info for one batch row. A mock (sandbox) signature is always labelled as such. */
export function SigningCell({ signing }: { signing: PfmsSigning }) {
  const t = useTranslations("pfmsBatchesPanel");
  if (signing.status === "unsigned") {
    return <span className="pill warn">{t("signUnsigned")}</span>;
  }
  if (signing.status === "signed_legacy") {
    return <span className="pill">{t("signLegacy")}</span>;
  }
  return (
    <div style={{ display: "grid", gap: 2, fontSize: 12 }}>
      <span className={signing.mock ? "pill warn" : "pill ok"} style={{ width: "fit-content" }}>
        {signing.mock ? t("signMock") : t("signSigned")}
      </span>
      {signing.certificateSerial && <span>{t("signCert", { serial: signing.certificateSerial })}</span>}
      {signing.signedByName && <span>{t("signBy", { name: signing.signedByName })}</span>}
      {signing.signedAt && <span>{formatIndianDateTime(signing.signedAt)}</span>}
      {signing.algorithm && <span>{t("signAlgorithm", { algorithm: signing.algorithm })}</span>}
      {signing.environment && <span>{signing.environment === "production" ? t("signEnvProduction") : t("signEnvSandbox")}</span>}
      {signing.verifiedAt && <span>{t("signVerified", { when: formatIndianDateTime(signing.verifiedAt) })}</span>}
    </div>
  );
}
