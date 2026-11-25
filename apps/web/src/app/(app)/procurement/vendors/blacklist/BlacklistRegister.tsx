"use client";

/**
 * Vendor blacklist register + central debarment register.
 *
 *  - GET    /vendor-blacklist                 PROC_ROLES  -> { data, total }
 *  - DELETE /vendors/:id/blacklist            PROC_ROLES  -> 202 (reinstate; 404 when not blacklisted)
 *  - GET    /central-debarment                PROC_ROLES  -> { data, total } (cross-tenant, by PAN)
 *  - POST   /central-debarment                super_admin body { pan, reason, blacklistedFrom,
 *                                             blacklistedUntil?, orderRef? } -> 202 (409 ALREADY_DEBARRED)
 * All writes are async (202) and audited; lists are re-fetched, never faked.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ActionButton, ConfirmDialog } from "@/app/_components/ds";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { isNetworkFailure } from "@/lib/userFacingError";

interface Entry {
  id: string;
  vendorId: string;
  pan?: string;
  reason: string;
  blacklistedFrom: string;
  blacklistedUntil?: string | null;
  orderRef?: string | null;
}

const PREFIX = "/api/proxy/v1/procurement";
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

async function getList(path: string): Promise<Entry[]> {
  const res = await fetch(`${PREFIX}${path}?limit=200`, { cache: "no-store" });
  if (!res.ok) throw new Error("load");
  const json = (await res.json()) as { data?: Entry[] };
  return Array.isArray(json.data) ? json.data : [];
}

function useList(path: string) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try { setRows(await getList(path)); setFailed(false); } catch { setFailed(true); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { rows, failed, load, reset: () => setRows(null) };
}

export function BlacklistRegister({ canCentralDebar }: { canCentralDebar: boolean }) {
  const t = useTranslations("procurement.w2.blacklist");
  const local = useList("/vendor-blacklist");
  const central = useList("/central-debarment");
  const [names, setNames] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const ids = (local.rows ?? []).map((r) => r.vendorId).join(",");
  useEffect(() => {
    if (!ids) return;
    void (async () => {
      // The names endpoint caps at 100 ids per request; chunk and merge.
      const all = ids.split(",");
      const found: Record<string, string> = {};
      for (let i = 0; i < all.length; i += 100) {
        try {
          const chunk = all.slice(i, i + 100).map(encodeURIComponent).join(",");
          const res = await fetch(`${PREFIX}/vendors/names?ids=${chunk}`, { cache: "no-store" });
          if (!res.ok) continue;
          const json = (await res.json()) as { data?: Array<{ id: string; name: string }> };
          for (const v of json.data ?? []) found[v.id] = v.name;
        } catch { /* names are cosmetic; the id is shown as a fallback */ }
      }
      setNames(found);
    })();
  }, [ids]);

  const accepted = (reload: () => Promise<void>) => () => { setNote(t("accepted")); void reload(); };

  return (
    <>
      {note ? <p role="status" style={{ fontSize: 12 }}>{note}</p> : null}

      <section className="card pad" aria-labelledby="bl-h" style={{ marginBlockEnd: 16 }}>
        <h2 id="bl-h" style={{ fontSize: 16, marginBlockStart: 0 }}>{t("localTitle")}</h2>
        <ListState list={local} empty={t("localEmpty")} retryLabel={t("retry")} failedLabel={t("loadFailed")} loadingLabel={t("loading")}>
          {(rows) => (
            <table className="tbl" style={{ width: "100%" }}>
              <thead><tr>
                <th scope="col">{t("vendor")}</th><th scope="col">{t("reason")}</th>
                <th scope="col">{t("from")}</th><th scope="col">{t("until")}</th><th scope="col"><span className="sr-only">{t("actions")}</span></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{names[r.vendorId] ?? r.vendorId}</td>
                    <td>{r.reason}</td>
                    <td>{r.blacklistedFrom}</td>
                    <td>{r.blacklistedUntil ?? t("indefinite")}</td>
                    <td>
                      <ActionButton
                        className="btn ghost"
                        label={t("reinstate")}
                        confirmTitle={t("reinstateTitle")}
                        confirmDescription={t("reinstateBody")}
                        confirmLabel={t("reinstate")}
                        onConfirm={async () => {
                          const res = await fetch(`${PREFIX}/vendors/${r.vendorId}/blacklist`, { method: "DELETE" });
                          if (!res.ok) throw await userFacingErrorFromResponse(res, "save", "vendor blacklist");
                        }}
                        onSuccess={accepted(local.load)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ListState>
      </section>

      <section className="card pad" aria-labelledby="cd-h">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 id="cd-h" style={{ fontSize: 16, margin: 0 }}>{t("centralTitle")}</h2>
          {canCentralDebar ? <DebarForm onDone={accepted(central.load)} /> : null}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>{t("centralHint")}</p>
        <ListState list={central} empty={t("centralEmpty")} retryLabel={t("retry")} failedLabel={t("loadFailed")} loadingLabel={t("loading")}>
          {(rows) => (
            <table className="tbl" style={{ width: "100%" }}>
              <thead><tr>
                <th scope="col">{t("pan")}</th><th scope="col">{t("reason")}</th>
                <th scope="col">{t("from")}</th><th scope="col">{t("until")}</th><th scope="col">{t("orderRef")}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.pan ?? "—"}</td><td>{r.reason}</td>
                    <td>{r.blacklistedFrom}</td><td>{r.blacklistedUntil ?? t("indefinite")}</td><td>{r.orderRef ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ListState>
      </section>
    </>
  );
}

function ListState({ list, empty, retryLabel, failedLabel, loadingLabel, children }: {
  list: { rows: Entry[] | null; failed: boolean; load: () => Promise<void>; reset: () => void };
  empty: string; retryLabel: string; failedLabel: string; loadingLabel: string;
  children: (rows: Entry[]) => React.ReactNode;
}) {
  if (list.failed) {
    return (
      <div role="alert">
        <p style={{ margin: 0 }}>{failedLabel}</p>
        <button type="button" className="btn ghost" onClick={() => { list.reset(); void list.load(); }}>{retryLabel}</button>
      </div>
    );
  }
  if (list.rows === null) return <p className="muted" role="status">{loadingLabel}</p>;
  if (list.rows.length === 0) return <p className="muted">{empty}</p>;
  return <>{children(list.rows)}</>;
}

function DebarForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations("procurement.w2.blacklist");
  const [open, setOpen] = useState(false);
  const [pan, setPan] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const panOk = PAN_RE.test(pan);
  const datesOk = from !== "" && (until === "" || until >= from);

  async function submit(reason?: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`${PREFIX}/central-debarment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pan, reason: (reason ?? "").trim(), blacklistedFrom: from,
          ...(until ? { blacklistedUntil: until } : {}), ...(orderRef.trim() ? { orderRef: orderRef.trim() } : {}),
        }),
      });
      if (res.status === 409) throw new Error(t("alreadyDebarred"));
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save", "central debarment");
      setOpen(false);
      setPan(""); setFrom(""); setUntil(""); setOrderRef("");
      onDone();
    } catch (e) {
      setError(!isNetworkFailure(e) && e instanceof Error ? e.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn danger" onClick={() => { setError(undefined); setOpen(true); }}>{t("debar")}</button>
      <ConfirmDialog
        open={open}
        title={t("debarTitle")}
        description={t("debarBody")}
        confirmLabel={t("debar")}
        danger
        requireReason
        minReasonLength={5}
        maxReasonLength={1000}
        reasonLabel={t("reasonLabel")}
        blockConfirm={!panOk || !datesOk}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void submit(reason)}
        onCancel={() => { if (!busy) setOpen(false); }}
      >
        <label className="field" style={{ display: "block", marginBlockEnd: 8 }}>
          <span className="label">{t("pan")}</span>
          <input className="inp mono" value={pan} maxLength={10} onChange={(e) => setPan(e.target.value.toUpperCase())} aria-invalid={pan !== "" && !panOk} />
          {pan !== "" && !panOk ? <span role="alert" style={{ fontSize: 12, color: "var(--bad)" }}>{t("panInvalid")}</span> : null}
        </label>
        <label className="field" style={{ display: "block", marginBlockEnd: 8 }}>
          <span className="label">{t("from")}</span>
          <input className="inp" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field" style={{ display: "block", marginBlockEnd: 8 }}>
          <span className="label">{t("until")}</span>
          <input className="inp" type="date" value={until} min={from || undefined} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <label className="field" style={{ display: "block", marginBlockEnd: 8 }}>
          <span className="label">{t("orderRef")}</span>
          <input className="inp" value={orderRef} maxLength={128} onChange={(e) => setOrderRef(e.target.value)} />
        </label>
      </ConfirmDialog>
    </>
  );
}
