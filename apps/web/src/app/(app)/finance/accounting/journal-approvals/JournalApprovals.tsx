"use client";

/**
 * UAT P2 (J6, D4): the checker's screen for manual journal vouchers. A maker's voucher is saved as
 * pending_approval (POST /v1/finance/journals); it reaches the ledger only when a DIFFERENT officer with an
 * approving role approves it here (PATCH /v1/finance/journals/:id/approve). The checker may instead reject it
 * (PATCH /v1/finance/journals/:id/reject, reason of at least 10 characters): rejection is final, nothing posts, and
 * the rejected voucher stays below, read-only, for audit; the maker raises a fresh voucher. finance-service stays
 * the authority for every rule (role on the route, approver != maker); the screen only avoids offering an action
 * the server would refuse.
 */
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Alert, Button, Card, ConfirmDialog, DataTable, EmptyState } from "@/app/_components/ds";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import { headLabel, type HeadLookup } from "../../_components/headLookup";

export type PendingJournalLine = { accountCode: string; debitMinor: string; creditMinor: string; narration: string | null };
export type PendingJournal = {
  id: string;
  voucherNo: string | null;
  type: string;
  postingDate: string;
  narration: string | null;
  totalMinor: string;
  lines: PendingJournalLine[];
  createdAt: string;
  isOwn: boolean;
  /** Rejected journals only: why and when. */
  rejectionReason?: string | null;
  decidedAt?: string | null;
};

const DIGITS = /^\d{1,38}$/;
const REJECT_MIN = 10;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** GET /v1/finance/journals/pending (or /rejected) -> rows the screen can trust; null when the payload is not that shape. */
export function mapPendingJournals(payload: unknown): PendingJournal[] | null {
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return null;
  const out: PendingJournal[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const id = str(r?.id);
    const total = str(r?.totalMinor);
    if (!id || !total || !DIGITS.test(total) || !Array.isArray(r.lines)) continue;
    out.push({
      id,
      voucherNo: str(r.voucherNo),
      type: str(r.type) ?? "journal",
      postingDate: str(r.postingDate) ?? "",
      narration: str(r.narration),
      totalMinor: total,
      lines: (r.lines as Array<Record<string, unknown>>).map((l) => ({
        accountCode: str(l?.accountCode) ?? "",
        debitMinor: str(l?.debitMinor) ?? "0",
        creditMinor: str(l?.creditMinor) ?? "0",
        narration: str(l?.narration),
      })),
      createdAt: str(r.createdAt) ?? "",
      isOwn: r.isOwn === true,
      rejectionReason: str(r.rejectionReason),
      decidedAt: str(r.decidedAt),
    });
  }
  return out;
}

type LineRow = PendingJournalLine & { _key: string; _account: string } & Record<string, unknown>;
type Action = { journal: PendingJournal; kind: "approve" | "reject" };

export function JournalApprovals({
  initial, rejected = [], canApprove, heads,
}: { initial: PendingJournal[]; rejected?: PendingJournal[] | null; canApprove: boolean; heads: HeadLookup }) {
  const t = useTranslations("journalApprovals");
  const formError = useFormError("journal approval");
  const [journals, setJournals] = useState(initial);
  const [rejectedRows, setRejectedRows] = useState(rejected);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<{ text: string; ledger: boolean } | null>(null);

  async function decide(reason?: string) {
    const a = action;
    if (!a || busy) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const path = a.kind === "approve" ? "approve" : "reject";
      const res = await fetch(`/api/proxy/v1/finance/journals/${encodeURIComponent(a.journal.id)}/${path}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(a.kind === "reject" ? { reason: (reason ?? "").trim() } : {}),
      });
      if (!res.ok) {
        setDialogError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setAction(null);
      setJournals((rows) => rows.filter((r) => r.id !== a.journal.id));
      if (a.kind === "reject") {
        const done = { ...a.journal, rejectionReason: (reason ?? "").trim(), decidedAt: new Date().toISOString() };
        setRejectedRows((rows) => [done, ...(rows ?? [])]);
        setNotice({ text: t("rejectedNotice"), ledger: false });
      } else {
        setNotice({ text: t("approvedNotice"), ledger: true });
      }
    } catch (err) {
      setDialogError(formError.fromException("save", err).message);
    } finally {
      setBusy(false);
    }
  }

  const linesOf = (j: PendingJournal): LineRow[] => j.lines.map((l, i) => ({ ...l, _key: `${j.id}:${i}`, _account: headLabel(heads, l.accountCode) }));
  const lineTable = (j: PendingJournal) => (
    <DataTable<LineRow>
      columns={[
        { key: "_account", label: t("colAccount") },
        { key: "debitMinor", label: t("colDebit"), align: "right", cellType: "amount" },
        { key: "creditMinor", label: t("colCredit"), align: "right", cellType: "amount" },
      ]}
      rows={linesOf(j)}
      pageSize={50}
      emptyIcon="📒"
      emptyTitle={t("noLinesTitle")}
      emptyMessage={t("noLinesMessage")}
    />
  );
  const dl: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(120px, 180px) 1fr", gap: "6px 16px", margin: "0 0 12px", fontSize: 13.5 };
  const dt: React.CSSProperties = { color: "var(--mut)" };

  return (
    <>
      {notice ? (
        <Alert variant="success" role="status">
          {notice.text} {notice.ledger ? <Link href="/finance/accounting/general-ledger">{t("viewLedger")}</Link> : null}
        </Alert>
      ) : null}
      {!canApprove ? <p role="note" style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 12px" }}>{t("readOnlyNote")}</p> : null}
      {journals.length === 0 ? (
        <Card>
          <EmptyState icon="📒" title={t("emptyTitle")} message={t("emptyMessage")} />
        </Card>
      ) : (
        journals.map((j) => (
          <Card key={j.id} title={t("cardTitle", { date: j.postingDate ? formatIndianDate(j.postingDate) : "—", amount: formatMoney(j.totalMinor) })}>
            <div className="pad" data-testid="pending-journal">
              <dl style={dl}>
                <dt style={dt}>{t("voucherNo")}</dt>
                <dd style={{ margin: 0 }}>{j.voucherNo ?? t("voucherAuto")}</dd>
                <dt style={dt}>{t("narration")}</dt>
                <dd style={{ margin: 0 }}>{j.narration ?? t("noNarration")}</dd>
                <dt style={dt}>{t("submitted")}</dt>
                <dd style={{ margin: 0 }}>{j.createdAt ? formatIndianDate(j.createdAt) : "—"}{j.isOwn ? ` · ${t("byYou")}` : ""}</dd>
              </dl>
              {lineTable(j)}
              <div style={{ marginTop: 12 }}>
                {j.isOwn ? (
                  <p role="note" style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("ownNote")}</p>
                ) : canApprove ? (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Button variant="primary" style={{ minHeight: 44 }} onClick={() => { setDialogError(undefined); setAction({ journal: j, kind: "approve" }); }}>
                      {t("approve")}
                    </Button>
                    <Button variant="danger" style={{ minHeight: 44 }} onClick={() => { setDialogError(undefined); setAction({ journal: j, kind: "reject" }); }}>
                      {t("reject")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </Card>
        ))
      )}

      <Card title={t("rejectedTitle")}>
        <div className="pad">
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--mut)" }}>{t("rejectedHelp")}</p>
          {rejectedRows === null ? (
            <p role="alert" style={{ margin: 0, fontSize: 13 }}>{t("rejectedLoadError")}</p>
          ) : rejectedRows.length === 0 ? (
            <EmptyState icon="🗂️" title={t("rejectedEmptyTitle")} message={t("rejectedEmptyMessage")} />
          ) : (
            rejectedRows.map((j) => (
              <div key={j.id} data-testid="rejected-journal" style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 12 }}>
                <dl style={dl}>
                  <dt style={dt}>{t("rejectedJournal")}</dt>
                  <dd style={{ margin: 0 }}>{t("cardTitle", { date: j.postingDate ? formatIndianDate(j.postingDate) : "—", amount: formatMoney(j.totalMinor) })}</dd>
                  <dt style={dt}>{t("narration")}</dt>
                  <dd style={{ margin: 0 }}>{j.narration ?? t("noNarration")}</dd>
                  <dt style={dt}>{t("rejectionReason")}</dt>
                  <dd style={{ margin: 0 }}>{j.rejectionReason ?? "—"}</dd>
                  <dt style={dt}>{t("rejectedOn")}</dt>
                  <dd style={{ margin: 0 }}>{j.decidedAt ? formatIndianDate(j.decidedAt) : "—"}</dd>
                </dl>
                {lineTable(j)}
                {j.isOwn ? (
                  <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                    <Link href="/finance/accounting/vouchers/new">{t("raiseNew")}</Link>
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={action !== null}
        title={action?.kind === "reject" ? t("rejectTitle") : t("confirmTitle")}
        confirmLabel={action?.kind === "reject" ? t("rejectConfirmLabel") : t("confirmLabel")}
        danger={action?.kind === "reject"}
        requireReason={action?.kind === "reject"}
        minReasonLength={REJECT_MIN}
        maxReasonLength={500}
        reasonLabel={t("rejectReasonLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={action
          ? action.kind === "reject"
            ? t("rejectBody", { amount: formatMoney(action.journal.totalMinor) })
            : t("confirmBody", { count: action.journal.lines.length, amount: formatMoney(action.journal.totalMinor) })
          : undefined}
        onConfirm={(reason) => void decide(reason)}
        onCancel={() => { if (!busy) setAction(null); }}
      />
    </>
  );
}
