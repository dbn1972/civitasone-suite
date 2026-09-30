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
 * GAP-HR-DPC-04: previously tracked "the list this session just generated"
 * as local `generatedId` state — a refresh or a second visit lost track of
 * it entirely (the Approve button just disappeared), and nothing on the
 * page ever listed OTHER already-generated-but-not-yet-approved snapshots
 * (GET /v1/hrms/seniority/lists did not exist). The parent page
 * (dpc/page.tsx) now fetches that list server-side and passes it down as
 * `lists`; this component renders an Approve action for every row still in
 * "generated" status, not just the one (if any) generated in this browser
 * session. `router.refresh()` re-fetches `lists` from the server after a
 * generate/approve — the reload-based acceptance check ("generate, reload
 * page, Approve button still available for that list") holds unconditionally
 * either way, since `lists` is never client-only state.
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
import { formatIndianDate } from "@/lib/formatters";

type AcceptedResponse = { id: string; status: string; correlationId?: string };

export interface SeniorityListSummary {
  id: string;
  status: string;
  asOf: string;
  createdAt: string;
  approvedAt: string | null;
}

interface Props {
  canAdminister: boolean;
  lists: SeniorityListSummary[];
}

export function SeniorityListActions({ canAdminister, lists }: Props) {
  const t = useTranslations("dpcSeniorityActions");
  const router = useRouter();

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [generateError, setGenerateError] = useState<string | undefined>();

  // GAP-HR-DPC-04: which persisted list (by id, from `lists`) the Approve
  // confirm dialog targets — replaces the old single `generatedId` that
  // only ever pointed at this session's own most recent generate() call.
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveError, setApproveError] = useState<string | undefined>();

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

  async function approve(id: string, remarks?: string) {
    setApproveBusy(true);
    setApproveError(undefined);
    try {
      await browserJson<AcceptedResponse>(`v1/hrms/seniority/${id}/approve`, {
        method: "POST",
        body: JSON.stringify(remarks ? { remarks } : {}),
      });
      setApprovingId(null);
      setTone("good");
      // DOM-023 fix: a 202 here only means the approve command was queued --
      // the consumer's status-guarded UPDATE can still silently no-op (see
      // routes.ts). Don't claim "approved" as a done fact; state what we
      // actually know, matching generate's "queued" phrasing below.
      setMessage(t("approveSubmittedMessage", { id }));
      router.refresh();
    } catch (err) {
      setApproveError(
        err instanceof Error ? err.message : t("approveErrorFallback"),
      );
    } finally {
      setApproveBusy(false);
    }
  }

  const approveTarget = lists.find((l) => l.id === approvingId) ?? null;

  return (
    <Card title={t("cardTitle")} padding>
      <div style={{ display: "grid", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>
          {t("description")}
        </p>
        <div>
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

        {lists.length > 0 && (
          <div className="tbl-wrap" style={{ marginTop: 4 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">{t("colAsOf")}</th>
                  <th scope="col">{t("colStatus")}</th>
                  <th scope="col">{t("colGeneratedAt")}</th>
                  <th scope="col"><span className="sr-only">{t("approveConfirmLabel")}</span></th>
                </tr>
              </thead>
              <tbody>
                {lists.map((l) => (
                  <tr key={l.id}>
                    <td>{formatIndianDate(l.asOf)}</td>
                    <td>{l.status}</td>
                    <td>{formatIndianDate(l.createdAt)}</td>
                    <td>
                      {l.status === "generated" && (
                        <Button
                          size="sm"
                          disabled={approveBusy}
                          onClick={() => {
                            setApproveError(undefined);
                            setApprovingId(l.id);
                          }}
                        >
                          {t("approveListBtn", { idPrefix: l.id.slice(0, 8) })}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        open={approvingId !== null}
        title={t("approveConfirmTitle")}
        confirmLabel={t("approveConfirmLabel")}
        busy={approveBusy}
        errorMessage={approveError}
        requireReason
        reasonLabel={t("approveReasonLabel")}
        minReasonLength={0}
        maxReasonLength={2000}
        description={
          approveTarget
            ? t("approveConfirmDescription", { id: approveTarget.id })
            : undefined
        }
        onConfirm={(reason) => { if (approvingId) void approve(approvingId, reason); }}
        onCancel={() => !approveBusy && setApprovingId(null)}
      />
    </Card>
  );
}
