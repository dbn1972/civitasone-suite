"use client";

/**
 * GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-01 / -04: the sanction detail page used
 * to offer two competing approval paths (direct "Approve sanction" and
 * "Raise for approval" to eOffice) with no guidance, and kept the direct
 * Approve visible while an eFile for the same sanction was in flight.
 *
 * Policy (conservative default, see PR "VERIFY"): once an eFile is linked, the
 * eOffice decision callback is the approver, so the direct Approve control is
 * replaced by an "Awaiting eOffice decision" notice. Direct approval is only
 * offered to the approver roles finance-service accepts (finance_admin /
 * super_admin); everyone else sees only the eOffice route. finance-service
 * stays the final authority (role + maker-checker 409).
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { RaiseEOfficeNote, type LinkedFile, type RaiseEOfficeNoteProps } from "../../../../../_components/RaiseEOfficeNote";
import { sanctionApprovalMode } from "./sanctionApproval";
import { SanctionApproveAction } from "../../../_components/FinanceActions";

const FALLBACK: Record<string, string> = {
  chooseHint: "Approve directly (approving authority, a different officer from the proposer) or route through eOffice file noting.",
  eofficeOnlyHint: "Route this sanction through eOffice file noting; the eOffice decision approves it. Only a finance administrator can approve directly.",
  awaiting: "Awaiting eOffice decision:",
  openFile: "Open file",
  directUnavailable: "Direct approval is unavailable while this file is in flight.",
  fileEnded: "The linked eOffice file did not result in approval (it was rejected or closed). You may raise a new file or, as an approving authority, approve directly.",
};

function useSanctionApprovalText(): (key: string) => string {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- same provider-less fallback pattern as DataTable's useSafeTranslations
    const t = useTranslations("sanctionApproval");
    return (key: string) => t(key);
  } catch {
    return (key: string) => FALLBACK[key] ?? key;
  }
}

export function SanctionApprovalPanel({
  id,
  isPending,
  canApprove,
  ...noteProps
}: { id: string; isPending: boolean; canApprove: boolean } & Omit<RaiseEOfficeNoteProps, "refType" | "refId" | "onLinkedFileChange">) {
  const [state, setState] = useState<{ loading: boolean; file: LinkedFile | null }>({ loading: true, file: null });
  const t = useSanctionApprovalText();
  const mode = sanctionApprovalMode({ isPending, canApprove, loading: state.loading, file: state.file });

  return (
    <>
      {mode === "choose" || mode === "eoffice-only" ? (
        <p style={{ marginTop: 18, fontSize: "0.8125rem", color: "var(--mut)" }}>
          {mode === "choose" ? t("chooseHint") : t("eofficeOnlyHint")}
        </p>
      ) : null}
      {mode === "awaiting-eoffice" && state.file ? (
        <p role="status" style={{ marginTop: 18, fontSize: "0.8125rem" }}>
          {t("awaiting")} <span className="mono">{state.file.file_no}</span>{" "}
          <a href={`/estab/files/${state.file.id}`}>{t("openFile")}</a>. {t("directUnavailable")}
        </p>
      ) : null}
      {state.file && (mode === "choose" || mode === "eoffice-only") ? (
        <p role="status" style={{ marginTop: 8, fontSize: "0.8125rem" }}>{t("fileEnded")}</p>
      ) : null}
      {mode === "choose" ? (
        <div style={{ marginTop: 8 }}>
          <SanctionApproveAction id={id} />
        </div>
      ) : null}
      <RaiseEOfficeNote {...noteProps} allowRaiseAfterTerminal refType="finance_sanction" refId={id} onLinkedFileChange={setState} />
    </>
  );
}
