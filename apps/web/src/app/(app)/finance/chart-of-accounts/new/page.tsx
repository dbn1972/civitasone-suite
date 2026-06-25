"use client";

/**
 * Map / Add Head of Account (LMMHA).
 *
 * The finance-service exposes no "create account" endpoint — the only write on
 * the chart of accounts is PATCH /v1/finance/accounts/:id/hoa, which assigns the
 * 18-digit PFMS Head-of-Account code to an existing head. So both header actions
 * ("+ Add Head" and "Import LMMHA") land here, where an operator selects a head
 * and assigns/updates its PFMS HoA code via that real command endpoint.
 *
 * Missing backend (noted in handoff): POST /v1/finance/accounts (create head)
 * and a bulk LMMHA import endpoint do not exist yet.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../../../_components/ds";

type AccountRow = { id: string; code?: string; name?: string; hoaCode?: string };

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

export default function MapHeadOfAccountPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [accountId, setAccountId] = useState("");
  const [hoaCode, setHoaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/finance/accounts?limit=200", { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`Failed to load accounts (${res.status}).`);
        const json = (await res.json()) as { data?: AccountRow[] } | AccountRow[];
        const rows = Array.isArray(json) ? json : json.data ?? [];
        if (active) setAccounts(rows);
      } catch (e) {
        if (active) setLoadError(e instanceof Error ? e.message : "Failed to load accounts.");
      }
    })();
    return () => { active = false; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch(`/api/proxy/v1/finance/accounts/${accountId}/hoa`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hoaCode }),
      });
      if (!(res.ok || res.status === 202)) throw new Error(await res.text());
      setMessage("Head of Account code saved.");
      setHoaCode("");
      router.refresh();
      setTimeout(() => router.push("/finance/chart-of-accounts"), 700);
    } catch (e) {
      setIsError(true);
      setMessage(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Map Head of Account (LMMHA)"
        subtitle="Assign the 18-digit PFMS Head-of-Account code to a head."
        back="/finance/chart-of-accounts"
        backLabel="Chart of Accounts"
      />
      {message ? (
        <div role="status" aria-live="polite" className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      {loadError ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{loadError}</div>
      ) : null}
      <div className="card">
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="hoa-account">Head of account</label>
              <select id="hoa-account" required value={accountId} onChange={(e) => setAccountId(e.target.value)} style={inputStyle}>
                <option value="" disabled>Select a head…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{[a.code, a.name].filter(Boolean).join(" · ") || a.id}</option>
                ))}
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="hoa-code">PFMS HoA code</label>
              <input
                id="hoa-code"
                required
                inputMode="numeric"
                pattern="\d{18}"
                maxLength={18}
                placeholder="18 numeric digits"
                value={hoaCode}
                onChange={(e) => setHoaCode(e.target.value.replace(/\D/g, ""))}
                aria-describedby="hoa-help"
                style={inputStyle}
              />
              <span id="hoa-help" className="sub" style={{ fontSize: 12 }}>Exactly 18 digits (PFMS format).</span>
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={busy || !accountId} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? "Saving…" : "Save HoA code"}
          </button>
        </form>
      </div>
    </>
  );
}
