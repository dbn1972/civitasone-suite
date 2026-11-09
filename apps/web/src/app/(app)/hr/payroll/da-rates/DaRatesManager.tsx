"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, DataTable, Field, Input } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { parseDaRateForm, type DaRatePayload } from "./daRateSchema";

export type DaRateRow = { id: string; effectiveFrom: string; rateBps: number; orderRef: string | null };

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

/**
 * Payroll admin: record a Dearness Allowance revision (Jan / Jul order) and remove a mistaken one.
 * POST/DELETE /v1/payroll/da-rates are CQRS commands (202); the server refuses a duplicate
 * effective date and a rate that a processed payroll already used.
 */
export function DaRatesManager({ rows, canWrite }: { rows: DaRateRow[]; canWrite: boolean }) {
  const t = useTranslations("payrollDaRates");
  const router = useRouter();
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [ratePct, setRatePct] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [pending, setPending] = useState<DaRatePayload | null>(null);
  const [removing, setRemoving] = useState<DaRateRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const fromId = useId();
  const rateId = useId();
  const orderId = useId();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const r = parseDaRateForm({ effectiveFrom, ratePct, orderRef });
    if (!r.ok) {
      setMessage({ tone: "bad", text: t(r.messageKey) });
      return;
    }
    if (rows.some((x) => x.effectiveFrom === r.payload.effectiveFrom)) {
      setMessage({ tone: "bad", text: t("errDuplicate", { date: r.payload.effectiveFrom }) });
      return;
    }
    setDialogError(undefined);
    setPending(r.payload);
  }

  async function run(fn: () => Promise<unknown>, okText: string, reset: () => void) {
    setBusy(true);
    setDialogError(undefined);
    try {
      await fn();
      reset();
      setMessage({ tone: "good", text: okText });
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  type TableRow = DaRateRow & { rate: string; order: string };
  const tableRows: TableRow[] = [...rows].reverse().map((r) => ({ ...r, rate: pct(r.rateBps), order: r.orderRef ?? "—" }));
  const columns: { key: keyof TableRow & string; label: string; align?: "left" | "right"; render?: (r: TableRow) => React.ReactNode }[] = [
    { key: "effectiveFrom", label: t("colEffectiveFrom") },
    { key: "rate", label: t("colRate"), align: "right" },
    { key: "order", label: t("colOrder") },
    ...(canWrite ? [{
      key: "id" as const,
      label: t("colActions"),
      render: (r: TableRow) => (
        <Button variant="ghost" onClick={() => { setDialogError(undefined); setRemoving(r); }} disabled={busy}>
          {t("removeBtn")}
        </Button>
      ),
    }] : []),
  ];

  return (
    <>
      {canWrite && (
        <form onSubmit={submit} noValidate style={{ marginBottom: 16 }}>
          <Card title={t("formTitle")} padding>
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
                <Field id={fromId} label={t("effectiveFromLabel")} required hint={t("effectiveFromHint")}>
                  <Input id={fromId} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                </Field>
                <Field id={rateId} label={t("rateLabel")} required hint={t("rateHint")}>
                  <Input id={rateId} inputMode="decimal" value={ratePct} onChange={(e) => setRatePct(e.target.value)} />
                </Field>
                <Field id={orderId} label={t("orderRefLabel")} required hint={t("orderRefHint")}>
                  <Input id={orderId} maxLength={300} value={orderRef} onChange={(e) => setOrderRef(e.target.value)} />
                </Field>
              </div>
              <div>
                <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>{t("addBtn")}</Button>
              </div>
            </div>
          </Card>
        </form>
      )}

      {message && (
        <p role={message.tone === "bad" ? "alert" : "status"} className={`pill ${message.tone}`} style={{ width: "fit-content", marginBottom: 12 }}>
          {message.text}
        </p>
      )}

      <Card title={t("cardTitle")}>
        {rows.length === 0 ? (
          <p className="pad" style={{ color: "var(--ink2)" }}>{t("emptyMessage")}</p>
        ) : (
          <DataTable<TableRow>
            columns={columns}
            rows={tableRows}
            pageSize={15}
            emptyIcon="📈"
            emptyTitle={t("cardTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={pending ? t("confirmDescription", { rate: pct(pending.rateBps), date: pending.effectiveFrom, order: pending.orderRef }) : null}
        onConfirm={() => pending && void run(
          () => browserJson("v1/payroll/da-rates", { method: "POST", body: JSON.stringify(pending) }),
          t("addedMessage", { date: pending.effectiveFrom }),
          () => { setPending(null); setEffectiveFrom(""); setRatePct(""); setOrderRef(""); },
        )}
        onCancel={() => !busy && setPending(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        title={t("removeTitle")}
        confirmLabel={t("removeConfirm")}
        busy={busy}
        errorMessage={dialogError}
        description={removing ? t("removeDescription", { rate: pct(removing.rateBps), date: removing.effectiveFrom }) : null}
        onConfirm={() => removing && void run(
          () => browserJson(`v1/payroll/da-rates/${encodeURIComponent(removing.id)}`, { method: "DELETE" }),
          t("removedMessage", { date: removing.effectiveFrom }),
          () => setRemoving(null),
        )}
        onCancel={() => !busy && setRemoving(null)}
      />
    </>
  );
}
