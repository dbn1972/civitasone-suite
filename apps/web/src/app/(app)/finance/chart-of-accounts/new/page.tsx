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
import { Button, PageHeader, Card } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

type AccountRow = { id: string; code?: string; name?: string; hoaCode?: string };

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

const LEVEL_OPTIONS = [
  { value: "0", label: "Major head" },
  { value: "1", label: "Minor head" },
  { value: "2", label: "Sub-minor head" },
];

const CLASSIFICATION_OPTIONS = ["", "asset", "liability", "equity", "income", "expense"] as const;

export default function MapHeadOfAccountPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const loadFormError = useFormError("accounts");

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/v1/finance/accounts?limit=200", { headers: { accept: "application/json" } });
      if (!res.ok) {
        setLoadError((await loadFormError.fromResponse(res, "load")).message);
        return;
      }
      const json = (await res.json()) as { data?: AccountRow[] } | AccountRow[];
      const rows = Array.isArray(json) ? json : json.data ?? [];
      setAccounts(rows);
    } catch {
      setLoadError(loadFormError.fromException("load").message);
    }
    // loadFormError.fromResponse/fromException are stable (useCallback'd on a
    // fixed `area` string inside useFormError) even though the wrapping
    // loadFormError object literal isn't, so omitting it here is safe and
    // avoids re-creating loadAccounts (and re-running its effect) every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFormError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
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
  const createFormError = useFormError("head of account");

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateBusy(true);
    setCreateMessage("");
    setCreateIsError(false);
    createFormError.clear();
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
      if (!res.ok) {
        setCreateIsError(true);
        setCreateMessage((await createFormError.fromResponse(res, "save")).message);
        return;
      }
      setCreateMessage(`Head of account "${code}" created.`);
      setCode("");
      setName("");
      setLevel("0");
      setClassification("");
      setCreateHoaCode("");
      await loadAccounts();
      router.refresh();
    } catch {
      setCreateIsError(true);
      setCreateMessage(createFormError.fromException("save").message);
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
  const mapFormError = useFormError("HoA code");

  async function submitMap(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setIsError(false);
    mapFormError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/finance/accounts/${accountId}/hoa`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hoaCode }),
      });
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        setMessage((await mapFormError.fromResponse(res, "save")).message);
        return;
      }
      setMessage("Head of Account code saved.");
      setHoaCode("");
      router.refresh();
      setTimeout(() => router.push("/finance/chart-of-accounts"), 700);
    } catch {
      setIsError(true);
      setMessage(mapFormError.fromException("save").message);
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
              {createFormError.fieldError("code") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{createFormError.fieldError("code")}</span>
              )}
            </div>
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="new-name">Name</label>
              <input id="new-name" required minLength={2} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. Sundry Creditors" />
              {createFormError.fieldError("name") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{createFormError.fieldError("name")}</span>
              )}
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
              {createFormError.fieldError("hoaCode") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{createFormError.fieldError("hoaCode")}</span>
              )}
            </div>
          </div>
          <Button type="submit" disabled={createBusy || !code || !name} aria-busy={createBusy} style={{ marginTop: 12 }}>
            {createBusy ? "Creating…" : "Create head"}
          </Button>
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
              {mapFormError.fieldError("hoaCode") && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{mapFormError.fieldError("hoaCode")}</span>
              )}
            </div>
          </div>
          <Button type="submit" disabled={busy || !accountId} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? "Saving…" : "Save HoA code"}
          </Button>
        </form>
      </Card>
    </>
  );
}
