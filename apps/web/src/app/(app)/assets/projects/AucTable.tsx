"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, DataTable, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { formatMoney, todayIST } from "@/lib/formatters";
import { aucCapitalizeErrorMessage, type CapitalizeMode } from "./capitalizeFlow";
import { glErrorKey, journalKey, journalState } from "../glStatus";

export type AucRow = {
  id: string;
  projectCode: string;
  name: string;
  wbsRef: string | null;
  accumulatedMinor: number | string;
  status: string;
  assetId: string | null;
  /** Finance-side state of the capitalisation journal: none | pending | posted | failed. */
  glPostStatus?: string;
} & Record<string, unknown>;

type DisplayRow = AucRow & {
  costDisplay: string;
  statusDisplay: string;
  actions: string;
};

type Dialog = { mode: CapitalizeMode; row: AucRow };

/**
 * GAP-ASSETS-PROJECTS-09: capitalisation posts to the GL, so by default it is a two-step action -- one
 * person requests, a DIFFERENT asset admin approves (server-enforced, per-tenant setting). `makerChecker`
 * only steers the wording; the service decides what actually happens.
 */
export function AucTable({ rows, makerChecker = true }: { rows: AucRow[]; makerChecker?: boolean }) {
  const router = useRouter();
  const t = useTranslations("assetsGl");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [capDate, setCapDate] = useState(todayIST());
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  function open(mode: CapitalizeMode, row: AucRow) {
    setDialogError(undefined);
    setCapDate(todayIST());
    setDialog({ mode, row });
  }

  async function submit(reason?: string) {
    if (!dialog) return;
    const { mode, row } = dialog;
    if (mode === "capitalize" && (!/^\d{4}-\d{2}-\d{2}$/.test(capDate) || capDate > todayIST())) {
      setDialogError("Choose a capitalisation date that is not in the future.");
      return;
    }
    setBusy(true);
    setDialogError(undefined);
    try {
      const path = mode === "capitalize" ? "capitalize" : mode === "approve" ? "capitalize/approve" : mode === "repost" ? "journal/repost" : "capitalize/reject";
      const body = mode === "capitalize"
        ? { reason, capitalizationDate: capDate }
        : mode === "reject" ? { reason } : {};
      const res = await browserFetch(`v1/asset/projects/auc/${row.id}/${path}`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        // GL-heads errors are translated (en + hi); the other known codes keep their plain-English copy.
        const gl = glErrorKey(code);
        const known = aucCapitalizeErrorMessage(code);
        setDialogError(gl ? t(gl) : known ?? (await errorMessageFromResponse(res)));
        return;
      }
      const out = (await res.json().catch(() => ({}))) as { id?: string };
      setMessage(
        mode === "repost" ? t("repostDone") :
        mode === "capitalize"
          ? `Capitalization submitted for "${row.projectCode}"${makerChecker ? " — awaiting approval by a different asset administrator" : out.id ? ` — asset ${out.id.slice(0, 8)}` : ""}.`
          : mode === "approve"
            ? `Capitalization approved for "${row.projectCode}"${out.id ? ` — asset ${out.id.slice(0, 8)}` : ""}.`
            : `Capitalization of "${row.projectCode}" rejected; the project is back under construction.`,
      );
      setDialog(null);
      router.refresh();
    } catch {
      setDialogError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const displayRows: DisplayRow[] = rows.map((r) => ({
    ...r,
    costDisplay: formatMoney(r.accumulatedMinor),
    statusDisplay: r.status === "pending_capitalization" ? "awaiting approval" : r.status.replace(/_/g, " "),
    actions: r.id,
  }));

  const columns = [
    { key: "projectCode" as const, label: "Code" },
    { key: "name" as const, label: "Name" },
    { key: "wbsRef" as const, label: "WBS ref", render: (row: DisplayRow) => row.wbsRef ?? "—" },
    { key: "costDisplay" as const, label: "Accumulated cost", align: "right" as const },
    { key: "statusDisplay" as const, label: "Status", cellType: "status" as const },
    {
      // Capitalised projects show what finance did with the journal, so a capitalised project never reads as posted when it is not.
      key: "glPostStatus" as const,
      label: t("journal"),
      render: (row: DisplayRow) => {
        const s = journalState(row.glPostStatus);
        if (s === "none") return <span style={{ color: "var(--ink2)", fontSize: 13 }}>{t("journalNone")}</span>;
        return (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span className={`pill ${s === "posted" ? "good" : s === "failed" ? "bad" : "warn"}`}>{t(journalKey(s))}</span>
            {s === "failed" ? (
              <Button type="button" variant="ghost" size="sm" aria-label={`${t("repostJournal")}: ${row.projectCode}`} onClick={() => open("repost", row)}>
                {t("repostJournal")}
              </Button>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "actions" as const,
      label: "",
      sortable: false,
      render: (row: DisplayRow) => {
        if (row.status === "under_construction") {
          return (
            <Button type="button" variant="ghost" size="sm" aria-label={`Capitalize project ${row.projectCode}`} onClick={() => open("capitalize", row)}>
              Capitalize
            </Button>
          );
        }
        if (row.status === "pending_capitalization") {
          return (
            <span style={{ display: "inline-flex", gap: 4 }}>
              <Button type="button" variant="ghost" size="sm" aria-label={`Approve capitalization of project ${row.projectCode}`} onClick={() => open("approve", row)}>
                Approve
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label={`Reject capitalization of project ${row.projectCode}`} onClick={() => open("reject", row)}>
                Reject
              </Button>
            </span>
          );
        }
        if (row.assetId) {
          return <Link href={`/assets/${row.assetId}`} aria-label={`View capitalized asset for project ${row.projectCode}`}>View asset</Link>;
        }
        return <span style={{ color: "var(--ink2)", fontSize: 13 }}>—</span>;
      },
    },
  ];

  const row = dialog?.row ?? null;
  const mode = dialog?.mode ?? null;

  return (
    <>
      {message && (
        <p role="status" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>
          {message}
        </p>
      )}
      <DataTable<DisplayRow>
        columns={columns}
        rows={displayRows}
        sortable
        filterable
        filterPlaceholder="Filter by code, name, or status…"
        pageSize={15}
        emptyIcon="🏗️"
        emptyTitle="No AUC projects yet"
        emptyMessage="Create an AUC project above to accumulate WIP before capitalization."
      />

      <ConfirmDialog
        open={dialog !== null}
        title={row ? (mode === "repost" ? t("repostTitle") : mode === "approve" ? `Approve capitalization of "${row.projectCode}"?` : mode === "reject" ? `Reject capitalization of "${row.projectCode}"?` : `Capitalize "${row.projectCode}"?`) : ""}
        confirmLabel={mode === "repost" ? t("repostConfirm") : mode === "approve" ? "Approve capitalization" : mode === "reject" ? "Reject capitalization" : makerChecker ? "Request capitalization" : "Capitalize to fixed asset"}
        danger={mode !== "reject" && mode !== "repost"}
        requireReason={mode === "capitalize" || mode === "reject"}
        optionalReason={mode === "approve"}
        reasonLabel={mode === "reject" ? "Reason for rejection" : "Reason / authorisation"}
        busy={busy}
        errorMessage={dialogError}
        description={
          row ? (
            mode === "repost" ? (
              <>{t("repostDescription")}</>
            ) : mode === "capitalize" ? (
              <>
                This transfers <strong>{formatMoney(row.accumulatedMinor)}</strong> of accumulated WIP from AUC{" "}
                <strong>{row.projectCode}</strong> into the fixed-asset register and starts dual-book depreciation from the capitalisation date.
                {makerChecker
                  ? " A different asset administrator must approve it before anything is posted."
                  : " This posts to the GL and cannot be undone."}
                <span style={{ display: "block", marginTop: 10 }}>
                  <label htmlFor="auc-cap-date" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Capitalisation date</label>
                  <input
                    id="auc-cap-date" type="date" value={capDate} max={todayIST()}
                    onChange={(e) => setCapDate(e.target.value)}
                    style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}
                  />
                </span>
              </>
            ) : mode === "approve" ? (
              <>
                Approving moves <strong>{formatMoney(row.accumulatedMinor)}</strong> from AUC <strong>{row.projectCode}</strong> into the
                fixed-asset register, posts it to the GL (debit fixed assets, credit capital work in progress) and starts dual-book depreciation.
                This <strong>cannot be undone</strong>. You cannot approve a capitalization you requested yourself.
              </>
            ) : (
              <>The project <strong>{row.projectCode}</strong> goes back to under construction and nothing is posted. Give the requester a reason.</>
            )
          ) : null
        }
        onConfirm={(reason) => void submit(reason)}
        onCancel={() => {
          if (busy) return;
          setDialog(null);
          setDialogError(undefined);
        }}
      />
    </>
  );
}
