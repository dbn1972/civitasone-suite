"use client";

/**
 * Add / Map Head of Account (LMMHA).
 *
 * "+ Add Head" creates a single new head of account via the real
 * POST /v1/finance/accounts endpoint (see budget/routes.ts on finance-service —
 * accepts code, name, level, and optional hoaCode/classification, returns 201).
 *
 * "Import LMMHA" still has no bulk-import endpoint on finance-service, so it
 * lands on this same page too: an operator can create heads one at a time
 * below, or assign/update the 18-digit PFMS Head-of-Account code on an
 * existing head via the separate PATCH /v1/finance/accounts/:id/hoa command
 * further down.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card } from "../../../../_components/ds";

type AccountRow = { id: string; code?: string; name?: string; hoaCode?: string };

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

const LEVEL_OPTIONS = [
  { value: "0", label: "Major head" },
  { value: "1", label: "Minor head" },
  { value: "2", label: "Sub-minor head" },
];

const CLASSIFICATION_OPTIONS = ["", "asset", "liability", "equity", "income", "expense"] as const;

/** Mirrors the { message } / { error } envelope shapes used across the finance
 * proxy routes (see FinanceActions.tsx / JournalEntryForm.tsx) so failures
 * show the real backend reason instead of a raw response body. */
async function parseErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let msg = `Request failed (${res.status}).`;
  try {
    const j = JSON.parse(text);
    msg = j?.message ?? j?.error ?? msg;
  } catch {
    if (text) msg = text;
  }
  return msg;
}

export default function MapHeadOfAccountPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loadError, setLoadError] = useState("");

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/v1/finance/accounts?limit=200", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`Failed to load accounts (${res.status}).`);
      const json = (await res.json()) as { data?: AccountRow[] } | AccountRow[];
      const rows = Array.isArray(json) ? json : json.data ?? [];
      setAccounts(rows);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load accounts.");
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  // ── Create a new head of account ──────────────────────────────────────
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [level, setLevel] = useState("0");
  const [classification, setClassification] = useState<(typeof CLASSIFICATION_OPTIONS)[number]>("");
  const [createHoaCode, setCreateHoaCode] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [createIsError, setCreateIsError] = useState(false);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateBusy(true);
    setCreateMessage("");
    setCreateIsError(false);
    try {
      const res = await fetch("/api/proxy/v1/finance/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          level: Number(level),
          hoaCode: createHoaCode || undefined,
          classification: classification || undefined,
        }),
      });
      if (!res.ok) throw new Error(await parseErrorMessage(res));
      setCreateMessage(`Head of account "${code}" created.`);
      setCode("");
      setName("");
      setLevel("0");
      setClassification("");
      setCreateHoaCode("");
      await loadAccounts();
      router.refresh();
    } catch (e) {
      setCreateIsError(true);
      setCreateMessage(e instanceof Error ? e.message : "Create failed.");
    } finally {
      setCreateBusy(false);
    }
  }

  // ── Map a PFMS HoA code onto an existing head ─────────────────────────
  const [accountId, setAccountId] = useState("");
  const [hoaCode, setHoaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function submitMap(e: React.FormEvent) {
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
      if (!(res.ok || res.status === 202)) throw new Error(await parseErrorMessage(res));
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
        title="Add / Map Head of Account (LMMHA)"
        subtitle="Create a new head of account, or assign a PFMS Head-of-Account code to an existing one."
        back="/finance/chart-of-accounts"
        backLabel="Chart of Accounts"
      />
      {loadError ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{loadError}</div>
      ) : null}

      <Card title="Create a new head of account">
        {createMessage ? (
          <div role={createIsError ? "alert" : "status"} aria-live={createIsError ? "assertive" : "polite"} className="banner" style={{ background: createIsError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, margin: "0 16px 16px", fontSize: 13 }}>{createMessage}</div>
        ) : null}
        <form onSubmit={submitCreate} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="new-code">Code</label>
              <input id="new-code" required maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} style={inputStyle} placeholder="e.g. 2110" />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="new-name">Name</label>
              <input id="new-name" required minLength={2} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. Sundry Creditors" />
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="new-level">Level</label>
              <select id="new-level" value={level} onChange={(e) => setLevel(e.target.value)} style={inputStyle}>
                {LEVEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="new-classification">Classification</label>
              <select id="new-classification" value={classification} onChange={(e) => setClassification(e.target.value as typeof classification)} style={inputStyle}>
                <option value="">— Not set —</option>
                {CLASSIFICATION_OPTIONS.filter(Boolean).map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="new-hoa">PFMS HoA code (optional)</label>
              <input
                id="new-hoa"
                inputMode="numeric"
                pattern="\d{18}"
                maxLength={18}
                placeholder="18 numeric digits"
                value={createHoaCode}
                onChange={(e) => setCreateHoaCode(e.target.value.replace(/\D/g, ""))}
                style={inputStyle}
              />
            </div>
          </div>
          <button type="submit" className="btn primary" disabled={createBusy || !code || !name} aria-busy={createBusy} style={{ marginTop: 12 }}>
            {createBusy ? "Creating…" : "Create head"}
          </button>
        </form>
      </Card>

      <Card title="Map PFMS HoA code to an existing head">
        {message ? (
          <div role="status" aria-live="polite" className="banner" style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, margin: "0 16px 16px", fontSize: 13 }}>{message}</div>
        ) : null}
        <form onSubmit={submitMap} className="pad">
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
      </Card>
    </>
  );
}
