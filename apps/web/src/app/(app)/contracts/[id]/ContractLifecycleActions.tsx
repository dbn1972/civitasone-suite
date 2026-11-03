"use client";

/**
 * UAT J10 / D6: approve, activate, close and terminate a contract on screen.
 * contract-service already exposes POST /v1/contract/contracts/:id/{approve,
 * activate,close,terminate}, but the web app never called them, so a contract
 * raised for approval could never be approved or brought into force on screen.
 *
 * The offered actions mirror contract-service's state machine (contracts/
 * domain.ts TRANSITIONS) and its route guards (CONTRACT_ROLES; approve and
 * terminate refuse the contract's own maker, 403 SOD_VIOLATION). The backend
 * stays the authority; this only avoids offering a button that must be refused.
 * Each command is applied by a queue consumer (202), so the copy says
 * "submitted" and the page is refreshed.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AcceptedNotice, Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { useSessionIdentity } from "@/lib/auth/useSessionIdentity";

/** contract-service contracts/routes.ts CONTRACT_ROLES. */
export const CONTRACT_ACTION_ROLES: readonly string[] = ["procurement_admin", "finance_admin", "super_admin"];

export type ContractAction = "approve" | "activate" | "close" | "terminate";

/** Checker-only actions: contract-service refuses the contract's maker (SoD). */
const CHECKER_ONLY: ReadonlySet<ContractAction> = new Set(["approve", "terminate"]);

/** Transitions out of each status (contract-service contracts/domain.ts), as screen actions. */
export function availableContractActions(status: string): ContractAction[] {
  switch (status.toLowerCase()) {
    case "draft":
    case "pending_approval":
      return ["approve", "terminate"];
    case "approved":
      return ["activate", "terminate"];
    case "active":
      return ["close", "terminate"];
    default:
      return [];
  }
}

/** Actions this session may trigger: right role, and not a checker action on its own contract. */
export function contractActionsFor(status: string, roles: readonly string[], isMaker: boolean): ContractAction[] {
  if (!roles.some((r) => CONTRACT_ACTION_ROLES.includes(r))) return [];
  return availableContractActions(status).filter((a) => !(isMaker && CHECKER_ONLY.has(a)));
}

export function ContractLifecycleActions({
  contractId,
  status,
  roles,
  isMaker,
}: {
  contractId: string;
  status: string;
  roles: string[];
  isMaker: boolean;
}) {
  const t = useTranslations("contractLifecycle");
  const router = useRouter();
  const accepted = useAcceptedWrite();
  const [active, setActive] = useState<ContractAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canAct = roles.some((r) => CONTRACT_ACTION_ROLES.includes(r));
  if (!canAct) return null;
  const actions = contractActionsFor(status, roles, isMaker);
  const makerBlocked = isMaker && availableContractActions(status).some((a) => CHECKER_ONLY.has(a));

  async function submit(text: string | undefined) {
    if (!active) return;
    const body = active === "terminate" ? { reason: (text ?? "").trim() } : text ? { note: text } : {};
    setBusy(true);
    setError("");
    try {
      const res = await browserFetch(`v1/contract/contracts/${contractId}/${active}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        if (code === "SOD_VIOLATION") setError(t("errMaker"));
        else if (res.status === 409) setError(t("errWrongState"));
        else setError(await errorMessageFromResponse(res));
        return;
      }
      setActive(null);
      setNotice(t("submitted"));
      router.refresh();
      void accepted.accept();
    } catch {
      setError(t("errNetwork"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("heading")} padding>
      <AcceptedNotice {...accepted.noticeProps} />
      {notice && <p role="status" style={{ margin: "0 0 10px", fontSize: 13, color: "var(--good)" }}>{notice}</p>}
      {makerBlocked && <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--mut)" }}>{t("makerNote")}</p>}
      {actions.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("noneAvailable")}</p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {actions.map((a) => (
            <Button key={a} variant={a === "terminate" ? "danger" : a === "approve" || a === "activate" ? "primary" : "secondary"}
              onClick={() => { setError(""); setNotice(""); setActive(a); }}>
              {t(`actions.${a}.label`)}
            </Button>
          ))}
        </div>
      )}
      {active && (
        <ConfirmDialog
          open
          title={t(`actions.${active}.title`)}
          description={t(`actions.${active}.description`)}
          confirmLabel={t(`actions.${active}.confirm`)}
          danger={active === "terminate"}
          requireReason={active === "terminate"}
          optionalReason={active !== "terminate"}
          {...(active === "terminate" ? { minReasonLength: 5 } : {})}
          maxReasonLength={500}
          reasonLabel={active === "terminate" ? t("reasonLabel") : t("noteLabel")}
          busy={busy}
          errorMessage={error}
          onConfirm={(text) => { void submit(text); }}
          onCancel={() => { if (!busy) setActive(null); }}
        />
      )}
    </Card>
  );
}

/**
 * Page entry point: resolves the signed-in user's roles and id on the client
 * (display only; contract-service re-checks role and maker-checker) and hides
 * the panel until the session has answered.
 */
export function ContractLifecycleSection({ contractId, status, createdBy }: { contractId: string; status: string; createdBy: string | null }) {
  const session = useSessionIdentity();
  if (!session.loaded) return null;
  return (
    <ContractLifecycleActions
      contractId={contractId}
      status={status}
      roles={[...session.roles]}
      isMaker={!!createdBy && session.userId === createdBy}
    />
  );
}
