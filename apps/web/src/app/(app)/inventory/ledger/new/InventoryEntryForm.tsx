"use client";

/**
 * New stock entry for a tenant whose ledger source is "inventory" (inventory settings, migration 0027).
 *
 * Receipts, issues, transfers and adjustments are posted to inventory-service
 * (POST /v1/inventory/receipts | issues | transfers | adjustments) using the inventory item master and
 * the inventory stores directly. There is no stock-service item or warehouse to create or link first.
 * The write is queued (202 + id); the form then waits briefly for the movement to appear, because an
 * issue larger than the stock on hand is rejected by the service after it has been accepted.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { todayIST } from "@/lib/formatters";
import { UserFacingError } from "@/lib/userFacingError";
import { useFormError } from "@/lib/useFormError";
import { rupeesInputToMinorNumber, rupeesToMinorString } from "@/lib/money";
import { PageHeader, ConfirmDialog, useConfirmAction } from "../../../../_components/ds";
import { ItemPicker } from "@/app/_components/ItemPicker";
import { purgeInventoryCache } from "../../_revalidate";
import type { PickerEntry } from "../../linkHelpers";

type EntryType = "receipt" | "issue" | "transfer" | "adjustment";
type Store = { id: string; name: string; code: string | null };

const ENDPOINT: Record<EntryType, string> = {
  receipt: "receipts",
  issue: "issues",
  transfer: "transfers",
  adjustment: "adjustments",
};

/** Tests shorten the wait; production polls for about four seconds. */
export const pollOptions = { intervalMs: 500, attempts: 8 };

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

async function waitForPosting(id: string): Promise<"posted" | "pending"> {
  for (let i = 0; i < pollOptions.attempts; i += 1) {
    const res = await fetch(`/api/proxy/v1/inventory/movements/${encodeURIComponent(id)}`);
    if (res.ok) return "posted";
    if (res.status !== 404) break;
    await new Promise((resolve) => setTimeout(resolve, pollOptions.intervalMs));
  }
  return "pending";
}

export function InventoryEntryForm() {
  const t = useTranslations("inventoryLedger");
  const router = useRouter();
  const formError = useFormError("stock entry");

  const [entryType, setEntryType] = useState<EntryType>("receipt");
  const [postingDate, setPostingDate] = useState(todayIST());
  const [picked, setPicked] = useState<PickerEntry | null>(null);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [storeId, setStoreId] = useState("");
  const [toStoreId, setToStoreId] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [refNo, setRefNo] = useState("");
  const [notes, setNotes] = useState("");
  const [onHand, setOnHand] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const outcome = useRef<{ id: string; state: "posted" | "pending" } | null>(null);

  const itemId = picked?.inventoryItemId ?? "";
  // The store the stock leaves (issue, transfer) or is counted in (adjustment).
  const needsOnHand = entryType === "issue" || entryType === "transfer" || entryType === "adjustment";

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/inventory/stores?limit=200");
        if (!res.ok) { if (active) setStores([]); return; }
        const body = (await res.json()) as { data?: Array<{ id?: string; name?: string; code?: string | null }> };
        const rows = (body.data ?? []).filter((s): s is { id: string; name: string; code?: string | null } => !!s.id && !!s.name);
        if (active) setStores(rows.map((s) => ({ id: s.id, name: s.name, code: s.code ?? null })));
      } catch {
        if (active) setStores([]);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setOnHand(null);
    if (!needsOnHand || !itemId || !storeId) return;
    let active = true;
    (async () => {
      try {
        const qs = new URLSearchParams({ itemId, storeId, limit: "1" });
        const res = await fetch(`/api/proxy/v1/inventory/balances?${qs.toString()}`);
        if (!res.ok) return;
        const body = (await res.json()) as { data?: Array<{ onHandQty?: number }> };
        if (active) setOnHand(body.data?.[0]?.onHandQty ?? 0);
      } catch {
        // The warning is a convenience; the service still rejects an issue that exceeds the stock.
      }
    })();
    return () => { active = false; };
  }, [needsOnHand, itemId, storeId]);

  const qtyNum = Math.round(Number(qty || "0"));
  const overIssue = (entryType === "issue" || entryType === "transfer") && onHand !== null && qtyNum > onHand;

  async function postEntry(reason?: string) {
    setMessage("");
    setIsError(false);
    outcome.current = null;
    const combinedNotes = [notes.trim(), reason?.trim() ? `Reason: ${reason.trim()}` : ""].filter(Boolean).join(" — ").slice(0, 512);
    const common = {
      postingDate,
      ...(combinedNotes ? { notes: combinedNotes } : {}),
    };
    let body: Record<string, unknown>;
    if (entryType === "receipt") {
      body = {
        ...common, toStoreId: storeId, ...(refNo.trim() ? { refNo: refNo.trim() } : {}),
        lines: [{ itemId, qty: qtyNum, rateMinor: rupeesInputToMinorNumber(rate) }],
      };
    } else if (entryType === "issue") {
      body = {
        ...common, fromStoreId: storeId,
        ...(reasonCode.trim() ? { reasonCode: reasonCode.trim() } : {}),
        ...(refNo.trim() ? { refNo: refNo.trim() } : {}),
        lines: [{ itemId, qty: qtyNum }],
      };
    } else if (entryType === "transfer") {
      body = {
        ...common, fromStoreId: storeId, toStoreId,
        ...(refNo.trim() ? { refNo: refNo.trim() } : {}),
        lines: [{ itemId, qty: qtyNum }],
      };
    } else {
      body = { ...common, storeId, reasonCode: reasonCode.trim(), lines: [{ itemId, countedQty: qtyNum }] };
    }
    const res = await fetch(`/api/proxy/v1/inventory/${ENDPOINT[entryType]}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!(res.ok || res.status === 202)) throw UserFacingError.from(await formError.fromResponse(res, "save"));
    const accepted = (await res.json().catch(() => ({}))) as { id?: string };
    outcome.current = accepted.id ? { id: accepted.id, state: await waitForPosting(accepted.id) } : null;
  }

  const post = useConfirmAction({
    onConfirm: postEntry,
    onSuccess: async () => {
      const done = outcome.current;
      await purgeInventoryCache();
      if (done?.state === "posted") {
        setIsError(false);
        setMessage(t("result.posted"));
        router.refresh();
        setTimeout(() => router.push(`/inventory/movements/${done.id}`), 700);
        return;
      }
      // Accepted but not visible yet: say so plainly instead of claiming success.
      setIsError(false);
      setMessage(t("result.pending"));
      setQty("");
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setIsError(false);
    const fail = (key: string, values?: Record<string, string | number>) => {
      setIsError(true);
      setMessage(t(key, values));
    };
    if (!itemId) return fail("error.item");
    if (!storeId) return fail("error.store");
    if (entryType === "transfer" && (!toStoreId || toStoreId === storeId)) return fail("error.toStore");
    if (!Number.isFinite(qtyNum) || qtyNum < (entryType === "adjustment" ? 0 : 1)) return fail("error.qty");
    if (entryType === "adjustment" && !reasonCode.trim()) return fail("error.reasonCode");
    if (entryType === "receipt" && rate.trim() !== "" && rupeesToMinorString(rate, { allowZero: true }) === null) return fail("error.rate");
    if (overIssue) return fail("error.insufficient", { qty: onHand ?? 0 });
    post.trigger();
  }

  const storeOptions = (exclude?: string) => (
    <>
      <option value="">{t("field.storePlaceholder")}</option>
      {(stores ?? []).filter((s) => s.id !== exclude).map((s) => (
        <option key={s.id} value={s.id}>{s.code ? `${s.code} · ${s.name}` : s.name}</option>
      ))}
    </>
  );

  const storeLabel = entryType === "receipt" ? t("field.toStore") : entryType === "adjustment" ? t("field.store") : t("field.fromStore");

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/inventory/issues" backLabel={t("back")} />
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner"
          style={{ background: isError ? "var(--badbg)" : "var(--goodbg)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {stores !== null && stores.length === 0 ? (
        <div role="alert" className="banner" style={{ background: "var(--badbg)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{t("noStores")}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ie-type">{t("field.type")}</label>
              <select id="ie-type" value={entryType} onChange={(e) => setEntryType(e.target.value as EntryType)} style={inputStyle}>
                {(["receipt", "issue", "transfer", "adjustment"] as const).map((k) => <option key={k} value={k}>{t(`type.${k}`)}</option>)}
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ie-date">{t("field.date")}</label>
              <input id="ie-date" required type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} style={inputStyle} />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ie-item">{t("field.item")}</label>
              <div style={{ width: "100%" }}>
                <ItemPicker id="ie-item" value={picked?.key ?? null} onChange={setPicked} initialEntry={picked ?? undefined} masters="inventory" clearable />
              </div>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ie-store">{storeLabel}</label>
              <select id="ie-store" value={storeId} onChange={(e) => setStoreId(e.target.value)} style={inputStyle}>{storeOptions()}</select>
              {needsOnHand && onHand !== null ? (
                <span className="sub" style={{ fontSize: "0.8125rem" }}>{t("hint.onHand", { qty: onHand })}</span>
              ) : null}
            </div>
            {entryType === "transfer" ? (
              <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                <label className="l" htmlFor="ie-to-store">{t("field.toStore")}</label>
                <select id="ie-to-store" value={toStoreId} onChange={(e) => setToStoreId(e.target.value)} style={inputStyle}>{storeOptions(storeId)}</select>
              </div>
            ) : null}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ie-qty">{entryType === "adjustment" ? t("field.countedQty") : t("field.qty")}</label>
              <input id="ie-qty" required type="number" min={entryType === "adjustment" ? 0 : 1} step="1" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} />
            </div>
            {entryType === "receipt" ? (
              <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                <label className="l" htmlFor="ie-rate">{t("field.rate")}</label>
                <input id="ie-rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} style={inputStyle} />
              </div>
            ) : null}
            {entryType === "issue" || entryType === "adjustment" ? (
              <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                <label className="l" htmlFor="ie-reason">{entryType === "adjustment" ? t("field.reasonCodeRequired") : t("field.reasonCode")}</label>
                <input id="ie-reason" maxLength={32} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} style={inputStyle} />
              </div>
            ) : null}
            {entryType !== "adjustment" ? (
              <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                <label className="l" htmlFor="ie-ref">{t("field.refNo")}</label>
                <input id="ie-ref" maxLength={64} value={refNo} onChange={(e) => setRefNo(e.target.value)} style={inputStyle} />
              </div>
            ) : null}
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="ie-notes">{t("field.notes")}</label>
              <input id="ie-notes" maxLength={400} value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={post.busy} aria-busy={post.busy} style={{ marginTop: 12 }}>
            {post.busy ? t("action.posting") : t("action.post")}
          </button>
        </form>
      </div>
      <ConfirmDialog
        open={post.open}
        title={t("confirm.title")}
        description={t("confirm.description", { type: t(`type.${entryType}`), qty: qty || "0" })}
        confirmLabel={t("action.post")}
        cancelLabel={t("confirm.cancel")}
        danger
        requireReason
        reasonLabel={t("confirm.reasonLabel")}
        busy={post.busy}
        errorMessage={post.error}
        onConfirm={post.confirm}
        onCancel={post.cancel}
      />
    </>
  );
}
