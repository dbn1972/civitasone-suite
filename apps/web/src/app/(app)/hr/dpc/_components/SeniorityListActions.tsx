"use client";
/**
 * DOM-023: frontend trigger for DOM-019's backend routes.
 *
 * `POST /v1/hrms/seniority/generate` and `POST /v1/hrms/seniority/:id/approve`
 * existed with no UI caller anywhere in apps/web — reachable only via direct
 * API call (curl/Postman/integration test), never by a real HR admin using
 * the product. This component is that missing trigger: a "Generate Seniority
 * List" action wired to the generate route, and a per-list "Approve" action
 * (using the id the generate call returns, matching the backend's
 * POST /v1/hrms/seniority/:id/approve shape) wired to the approve route.
 *
 * Role gating mirrors the backend's HR_ROLES guard exactly
 * (services/hrms-service/src/modules/seniority/routes.ts): hr_admin,
 * hr_officer, super_admin. The parent page computes `canAdminister` from the
 * session (same pattern as hr/payroll/page.tsx's canAdminister) and this
 * component renders nothing for anyone else — but, as with every other
 * write action in this app, the backend's own role check is the real
 * enforcement; hiding the button is a UX nicety, not the security boundary.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, ConfirmDialog, Button } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type AcceptedResponse = { id: string; status: string; correlationId?: string };

export function SeniorityListActions({ canAdminister }: { canAdminister: boolean }) {
  const t = useTranslations("dpcSeniorityActions");
  const router = useRouter();

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [generateError, setGenerateError] = useState<string | undefined>();

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveError, setApproveError] = useState<string | undefined>();

  const [generatedId, setGeneratedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  if (!canAdminister) return null;

  async function generate() {
    setGenerateBusy(true);
    setGenerateError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/hrms/seniority/generate", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setGenerateOpen(false);
      setGeneratedId(res.id);
      setTone("good");
      setMessage(t("generateQueuedMessage", { id: res.id }));
      router.refresh();
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : t("generateErrorFallback"),
      );
    } finally {
      setGenerateBusy(false);
    }
  }

  async function approve(remarks?: string) {
    if (!generatedId) return;
    setApproveBusy(true);
    setApproveError(undefined);
    try {
      await browserJson<AcceptedResponse>(`v1/hrms/seniority/${generatedId}/approve`, {
        method: "POST",
        body: JSON.stringify(remarks ? { remarks } : {}),
      });
      setApproveOpen(false);
      setTone("good");
      // DOM-023 fix: a 202 here only means the approve command was queued --
      // the consumer's status-guarded UPDATE can still silently no-op (see
      // routes.ts). Don't claim "approved" as a done fact; state what we
      // actually know, matching generate's "queued" phrasing below.
      setMessage(t("approveSubmittedMessage", { id: generatedId }));
      setGeneratedId(null);
      router.refresh();
    } catch (err) {
      setApproveError(
        err instanceof Error ? err.message : t("approveErrorFallback"),
      );
    } finally {
      setApproveBusy(false);
    }
  }

  return (
    <Card title={t("cardTitle")} padding>
      <div style={{ display: "grid", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>
          {t("description")}
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Button
            variant="primary"
            style={{ minHeight: 44 }}
            disabled={generateBusy}
            onClick={() => {
              setGenerateError(undefined);
              setGenerateOpen(true);
            }}
          >
            {generateBusy ? t("generatingBtn") : t("generateBtn")}
          </Button>
          {generatedId && (
            <Button
              style={{ minHeight: 44 }}
              disabled={approveBusy}
              onClick={() => {
                setApproveError(undefined);
                setApproveOpen(true);
              }}
            >
              {approveBusy ? t("approvingBtn") : t("approveListBtn", { idPrefix: generatedId.slice(0, 8) })}
            </Button>
          )}
        </div>

        {message && (
          <p
            role={tone === "bad" ? "alert" : "status"}
            aria-live={tone === "bad" ? undefined : "polite"}
            className={`pill ${tone}`}
            style={{ width: "fit-content" }}
          >
            {message}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={generateOpen}
        title={t("generateConfirmTitle")}
        confirmLabel={t("generateConfirmLabel")}
        busy={generateBusy}
        errorMessage={generateError}
        description={t("generateConfirmDescription")}
        onConfirm={() => void generate()}
        onCancel={() => !generateBusy && setGenerateOpen(false)}
      />

      <ConfirmDialog
        open={approveOpen}
        title={t("approveConfirmTitle")}
        confirmLabel={t("approveConfirmLabel")}
        busy={approveBusy}
        errorMessage={approveError}
        requireReason
        reasonLabel={t("approveReasonLabel")}
        minReasonLength={0}
        maxReasonLength={2000}
        description={
          generatedId
            ? t("approveConfirmDescription", { id: generatedId })
            : undefined
        }
        onConfirm={(reason) => void approve(reason)}
        onCancel={() => !approveBusy && setApproveOpen(false)}
      />
    </Card>
  );
}
