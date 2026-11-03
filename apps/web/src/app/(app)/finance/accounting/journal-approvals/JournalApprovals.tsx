"use client";

/**
 * UAT P2 (J6, D4): the checker's screen for manual journal vouchers. A maker's voucher is saved as
 * pending_approval (POST /v1/finance/journals); it reaches the ledger only when a DIFFERENT officer with an
 * approving role approves it here (PATCH /v1/finance/journals/:id/approve). finance-service stays the authority
 * for both rules (role on the route, approver != maker in the posting consumer); the screen only avoids offering
 * an Approve the server would refuse.
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
};

const DIGITS = /^\d{1,38}$/;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** GET /v1/finance/journals/pending -> rows the screen can trust; null when the payload is not that shape. */
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
    });
  }
  return out;
}

type LineRow = PendingJournalLine & { _key: string; _account: string } & Record<string, unknown>;

export function JournalApprovals({ initial, canApprove, heads }: { initial: PendingJournal[]; canApprove: boolean; heads: HeadLookup }) {
  const t = useTranslations("journalApprovals");
  const formError = useFormError("journal approval");
  const [journals, setJournals] = useState(initial);
  const [confirming, setConfirming] = useState<PendingJournal | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  async function approve() {
    const j = confirming;
    if (!j || busy) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/finance/journals/${encodeURIComponent(j.id)}/approve`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        setDialogError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setConfirming(null);
      setJournals((rows) => rows.filter((r) => r.id !== j.id));
      setNotice(t("approvedNotice"));
    } catch (err) {
      setDialogError(formError.fromException("save", err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {notice ? (
        <Alert variant="success" role="status">
          {notice} <Link href="/finance/accounting/general-ledger">{t("viewLedger")}</Link>
        </Alert>
      ) : null}
      {!canApprove ? <p role="note" style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 12px" }}>{t("readOnlyNote")}</p> : null}
      {journals.length === 0 ? (
        <Card>
          <EmptyState icon="📒" title={t("emptyTitle")} message={t("emptyMessage")} />
        </Card>
      ) : (
        journals.map((j) => {
          const rows: LineRow[] = j.lines.map((l, i) => ({ ...l, _key: `${j.id}:${i}`, _account: headLabel(heads, l.accountCode) }));
          return (
            <Card key={j.id} title={t("cardTitle", { date: j.postingDate ? formatIndianDate(j.postingDate) : "—", amount: formatMoney(j.totalMinor) })}>
              <div className="pad" data-testid="pending-journal">
                <dl style={{ display: "grid", gridTemplateColumns: "minmax(120px, 180px) 1fr", gap: "6px 16px", margin: "0 0 12px", fontSize: 13.5 }}>
                  <dt style={{ color: "var(--mut)" }}>{t("voucherNo")}</dt>
                  <dd style={{ margin: 0 }}>{j.voucherNo ?? t("voucherAuto")}</dd>
                  <dt style={{ color: "var(--mut)" }}>{t("narration")}</dt>
                  <dd style={{ margin: 0 }}>{j.narration ?? t("noNarration")}</dd>
                  <dt style={{ color: "var(--mut)" }}>{t("submitted")}</dt>
                  <dd style={{ margin: 0 }}>{j.createdAt ? formatIndianDate(j.createdAt) : "—"}{j.isOwn ? ` · ${t("byYou")}` : ""}</dd>
                </dl>
                <DataTable<LineRow>
                  columns={[
                    { key: "_account", label: t("colAccount") },
                    { key: "debitMinor", label: t("colDebit"), align: "right", cellType: "amount" },
                    { key: "creditMinor", label: t("colCredit"), align: "right", cellType: "amount" },
                  ]}
                  rows={rows}
                  pageSize={50}
                  emptyIcon="📒"
                  emptyTitle={t("noLinesTitle")}
                  emptyMessage={t("noLinesMessage")}
                />
                <div style={{ marginTop: 12 }}>
                  {j.isOwn ? (
                    <p role="note" style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("ownNote")}</p>
                  ) : canApprove ? (
                    <Button variant="primary" style={{ minHeight: 44 }} onClick={() => { setDialogError(undefined); setConfirming(j); }}>
                      {t("approve")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })
      )}
      <ConfirmDialog
        open={confirming !== null}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={confirming ? t("confirmBody", { count: confirming.lines.length, amount: formatMoney(confirming.totalMinor) }) : undefined}
        onConfirm={() => void approve()}
        onCancel={() => { if (!busy) setConfirming(null); }}
      />
    </>
  );
}
