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
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type AcceptedResponse = { id: string; status: string; correlationId?: string };

export function SeniorityListActions({ canAdminister }: { canAdminister: boolean }) {
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
      setMessage(
        `Seniority list generation queued (list ID ${res.id}). It will be ready to approve shortly.`,
      );
      router.refresh();
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Could not queue seniority list generation. Please try again.",
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
      setMessage(
        `Seniority list approval submitted (list ID ${generatedId}). It will be confirmed shortly.`,
      );
      setGeneratedId(null);
      router.refresh();
    } catch (err) {
      setApproveError(
        err instanceof Error ? err.message : "Could not approve the seniority list. Please try again.",
      );
    } finally {
      setApproveBusy(false);
    }
  }

  return (
    <Card title="Seniority List Actions" padding>
      <div style={{ display: "grid", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>
          Generate a point-in-time seniority snapshot for DPC records, then approve it once reviewed.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn primary"
            style={{ minHeight: 44 }}
            disabled={generateBusy}
            onClick={() => {
              setGenerateError(undefined);
              setGenerateOpen(true);
            }}
          >
            {generateBusy ? "Generating…" : "Generate Seniority List"}
          </button>
          {generatedId && (
            <button
              type="button"
              className="btn"
              style={{ minHeight: 44 }}
              disabled={approveBusy}
              onClick={() => {
                setApproveError(undefined);
                setApproveOpen(true);
              }}
            >
              {approveBusy ? "Approving…" : `Approve List ${generatedId.slice(0, 8)}…`}
            </button>
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
        title="Generate a new seniority list?"
        confirmLabel="Generate"
        busy={generateBusy}
        errorMessage={generateError}
        description="This creates a new point-in-time seniority snapshot for DPC review, ranked by date of joining, date of birth and merit — matching the live seniority list above."
        onConfirm={() => void generate()}
        onCancel={() => !generateBusy && setGenerateOpen(false)}
      />

      <ConfirmDialog
        open={approveOpen}
        title="Approve this seniority list?"
        confirmLabel="Approve"
        busy={approveBusy}
        errorMessage={approveError}
        requireReason
        reasonLabel="Remarks (optional)"
        minReasonLength={0}
        maxReasonLength={2000}
        description={
          generatedId
            ? `Approve seniority list ${generatedId}. This finalizes the DPC snapshot for promotion consideration.`
            : undefined
        }
        onConfirm={(reason) => void approve(reason)}
        onCancel={() => !approveBusy && setApproveOpen(false)}
      />
    </Card>
  );
}
