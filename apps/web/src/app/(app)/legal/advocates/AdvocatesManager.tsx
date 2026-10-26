"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState } from "../../../_components/ds";

/**
 * GAP-LEGAL-LIST-04 (owner decision #14): the empanelled-advocate master.
 * Everyone with legal access can read it (contact is masked by the server except for the
 * head of legal); only the head of legal can add an advocate (the server enforces it: 403).
 */
type Advocate = { id: string; name: string; barEnrolmentNo: string; contact: string };
type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready"; items: Advocate[] };

export function AdvocatesManager() {
  const t = useTranslations("legalAdvocates");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [name, setName] = useState("");
  const [bar, setBar] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/v1/legal/advocates");
      if (!res.ok) { setLoad({ kind: "error" }); return; }
      const json = (await res.json()) as { items?: Advocate[] };
      setLoad({ kind: "ready", items: json.items ?? [] });
    } catch {
      setLoad({ kind: "error" });
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!name.trim() || !bar.trim() || !contact.trim()) { setMessage({ tone: "bad", text: t("invalid") }); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/legal/advocates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), barEnrolmentNo: bar.trim(), contact: contact.trim() }),
      });
      if (res.status === 202) {
        setName(""); setBar(""); setContact("");
        setMessage({ tone: "good", text: t("added") });
        // The create is accepted asynchronously; give the consumer a moment, then reload.
        await new Promise((r) => setTimeout(r, 600));
        await refresh();
        return;
      }
      if (res.status === 409) setMessage({ tone: "bad", text: t("duplicate") });
      else if (res.status === 403) setMessage({ tone: "bad", text: t("adminOnly") });
      else if (res.status === 400) setMessage({ tone: "bad", text: t("invalid") });
      else setMessage({ tone: "bad", text: t("saveFailed") });
    } catch {
      setMessage({ tone: "bad", text: t("saveFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="card">
        {load.kind === "loading" ? (
          <p className="pad" style={{ color: "var(--ink2)" }}>{t("loading")}</p>
        ) : load.kind === "error" ? (
          <div className="pad" role="alert">
            <p style={{ color: "var(--bad)" }}>{t("loadError")}</p>
            <Button variant="ghost" onClick={() => { setLoad({ kind: "loading" }); void refresh(); }}>{t("retry")}</Button>
          </div>
        ) : load.items.length === 0 ? (
          <EmptyState icon="⚖️" title={t("title")} message={t("empty")} />
        ) : (
          <table className="tbl" style={{ width: "100%" }}>
            <thead><tr><th>{t("colName")}</th><th>{t("colBar")}</th><th>{t("colContact")}</th></tr></thead>
            <tbody>
              {load.items.map((a) => (
                <tr key={a.id}><td>{a.name}</td><td className="mono">{a.barEnrolmentNo}</td><td>{a.contact}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form className="card pad" onSubmit={(e) => void add(e)} noValidate style={{ maxWidth: 640 }}>
        <h3 style={{ marginTop: 0 }}>{t("addTitle")}</h3>
        <label className="label" htmlFor="advName">{t("name")}</label>
        <input id="advName" className="inp" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} style={{ minHeight: 44, width: "100%", marginBottom: 10 }} />
        <label className="label" htmlFor="advBar">{t("bar")}</label>
        <input id="advBar" className="inp" value={bar} onChange={(e) => setBar(e.target.value)} maxLength={40} style={{ minHeight: 44, width: "100%" }} />
        <p style={{ fontSize: "0.75rem", color: "var(--ink2)", margin: "4px 0 10px" }}>{t("barHelp")}</p>
        <label className="label" htmlFor="advContact">{t("contact")}</label>
        <input id="advContact" className="inp" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} style={{ minHeight: 44, width: "100%" }} />
        <div role="status" aria-live="polite">
          {message ? <p role={message.tone === "bad" ? "alert" : undefined} style={{ marginTop: 10, fontSize: "0.875rem", color: message.tone === "bad" ? "var(--bad)" : "var(--good)" }}>{message.text}</p> : null}
        </div>
        <div style={{ marginTop: 14 }}>
          <Button type="submit" disabled={busy} aria-busy={busy} style={{ minHeight: 44 }}>{busy ? t("adding") : t("add")}</Button>
        </div>
      </form>
    </div>
  );
}
