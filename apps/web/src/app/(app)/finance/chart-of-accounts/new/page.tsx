"use client";

/**
 * Add / Map Head of Account (LMMHA).
 *
 * "+ Add Head" creates a single new head of account via the real
 * POST /v1/finance/accounts endpoint (see budget/routes.ts on finance-service —
 * accepts code, name, level, and optional hoaCode/classification, returns 201).
 *
 * There is no bulk-import endpoint on finance-service (the list page no longer
 * offers an "Import LMMHA" button): an operator creates heads one at a time
 * below, or assigns/updates the 18-digit PFMS Head-of-Account code on an
 * existing head via the separate PATCH /v1/finance/accounts/:id/hoa command
 * further down.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, PageHeader, Card, ConfirmDialog, Term } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

type AccountRow = {
  id: string;
  code?: string;
  name?: string;
  hoaCode?: string | null;
  /** 0 = major, 1 = minor, 2 = sub-minor */
  level?: number;
};

const inputStyle = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;

/**
 * GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-03: one feedback banner for both cards. A
 * failure is announced assertively (role="alert"); success politely
 * (role="status").
 */
function FormBanner({ message, isError }: { message: string; isError: boolean }) {
  if (!message) return null;
  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className="banner"
      style={{ background: isError ? "#fef2f2" : "#ecfdf3", padding: 12, borderRadius: 12, margin: "0 16px 16px", fontSize: 13 }}
    >
      {message}
    </div>
  );
}

/** Page size of the initial head list; a chart larger than this is searched, not scrolled. */
const HEAD_LIST_LIMIT = 200;

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
  // NEW-04: the list is capped at HEAD_LIST_LIMIT; `truncated` says so, and the
  // "Find a head" box queries the server so a head beyond the cap is reachable.
  const [truncated, setTruncated] = useState(false);
  const [headSearch, setHeadSearch] = useState("");
  const [searchResults, setSearchResults] = useState<AccountRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const loadFormError = useFormError("accounts");

  const loadAccounts = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/proxy/v1/finance/accounts?limit=${HEAD_LIST_LIMIT}`, { headers: { accept: "application/json" }, signal });
      if (!res.ok) {
        setLoadError((await loadFormError.fromResponse(res, "load")).message);
        return;
      }
      const json = (await res.json()) as { data?: AccountRow[]; pagination?: { hasMore?: boolean } } | AccountRow[];
      const rows = Array.isArray(json) ? json : json.data ?? [];
      setAccounts(rows);
      setTruncated(Array.isArray(json) ? rows.length >= HEAD_LIST_LIMIT : json.pagination?.hasMore === true);
      setLoadError("");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setLoadError(loadFormError.fromException("load", err).message);
    }
    // loadFormError.fromResponse/fromException are stable (useCallback'd on a
    // fixed `area` string inside useFormError) even though the wrapping
    // loadFormError object literal isn't, so omitting it here is safe and
    // avoids re-creating loadAccounts (and re-running its effect) every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFormError.fromResponse/fromException/clear are stable (useCallback'd on a fixed area string in useFormError); the wrapping object is recreated every render but isn't read here.
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadAccounts(controller.signal);
    return () => controller.abort();
  }, [loadAccounts]);

  // ── Create a new head of account ──────────────────────────────────────
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [level, setLevel] = useState("0");
  const [classification, setClassification] = useState<(typeof CLASSIFICATION_OPTIONS)[number]>("");
  const [createHoaCode, setCreateHoaCode] = useState("");
  // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-02: a minor/sub-minor head must name its
  // parent (a head exactly one level above it).
  const [parentId, setParentId] = useState("");
  const levelNum = Number(level);
  const parentOptions = accounts.filter((a) => a.level === levelNum - 1);
  const [createBusy, setCreateBusy] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [createIsError, setCreateIsError] = useState(false);
  const createFormError = useFormError("head of account");

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (levelNum > 0 && !parentId) {
      setCreateIsError(true);
      setCreateMessage("Select a parent head for a minor or sub-minor head.");
      return;
    }
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
          parentId: levelNum > 0 ? parentId : undefined,
        }),
      });
      if (!res.ok) {
        setCreateIsError(true);
        setCreateMessage((await createFormError.fromResponse(res, "save")).message);
        return;
      }
      const parentHead = accounts.find((a) => a.id === parentId);
      setCreateMessage(
        parentHead
          ? `Head of account "${code}" created under ${parentHead.code ?? parentHead.id} (${parentHead.name ?? ""}).`
          : `Head of account "${code}" created.`,
      );
      setParentId("");
      setCode("");
      setName("");
      setLevel("0");
      setClassification("");
      setCreateHoaCode("");
      await loadAccounts();
      router.refresh();
    } catch (caught) {
      setCreateIsError(true);
      setCreateMessage(createFormError.fromException("save", caught).message);
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mapFormError = useFormError("HoA code");
  // Options for the map card: server search results when searching, else the
  // loaded list. The chosen head stays selectable even if a later search
  // no longer returns it.
  const baseOptions = searchResults ?? accounts;
  const selectedHead = [...baseOptions, ...accounts].find((a) => a.id === accountId);
  const mapOptions = selectedHead && !baseOptions.some((a) => a.id === selectedHead.id) ? [selectedHead, ...baseOptions] : baseOptions;
  const currentHoa = selectedHead?.hoaCode ? selectedHead.hoaCode : null;

  // NEW-04: debounced server-side head search for the map card.
  useEffect(() => {
    const q = headSearch.trim();
    if (q === "") { setSearchResults(null); setSearching(false); return; }
    const controller = new AbortController();
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/proxy/v1/finance/accounts?q=${encodeURIComponent(q)}&limit=50`, { headers: { accept: "application/json" }, signal: controller.signal });
        if (!res.ok) { setSearchResults([]); return; }
        const json = (await res.json()) as { data?: AccountRow[] } | AccountRow[];
        setSearchResults(Array.isArray(json) ? json : json.data ?? []);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setSearchResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => { clearTimeout(t); controller.abort(); };
  }, [headSearch]);

  // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-01: submitting only opens the confirm
  // dialog (old -> new code + mandatory reason); the PATCH happens on confirm.
  function submitMap(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setIsError(false);
    setConfirmOpen(true);
  }

  async function doMap(reason: string | undefined) {
    setBusy(true);
    setMessage("");
    setIsError(false);
    mapFormError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/finance/accounts/${accountId}/hoa`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hoaCode, reason }),
      });
      setConfirmOpen(false);
      if (!(res.ok || res.status === 202)) {
        setIsError(true);
        setMessage((await mapFormError.fromResponse(res, "save")).message);
        return;
      }
      const body = (await res.json().catch(() => null)) as { status?: string } | null;
      setMessage(body?.status === "pending_approval"
        ? "HoA code change submitted. It takes effect when a different finance administrator approves it; you can follow it on the Chart of Accounts page."
        : body?.status === "accepted" ? "Head of Account code submitted. It is applied in a moment." : "Head of Account code saved.");
      setHoaCode("");
      router.refresh();
      setTimeout(() => router.push("/finance/chart-of-accounts"), 700);
    } catch (caught) {
      setConfirmOpen(false);
      setIsError(true);
      setMessage(mapFormError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={<>Add / Map Head of Account <Term name="LMMHA" before="(" after=")" /></>}
        subtitle="Create a new head of account, or assign a PFMS Head-of-Account code to an existing one."
        back="/finance/chart-of-accounts"
        backLabel="Chart of Accounts"
      />
      {loadError ? (
        <div role="alert" aria-live="assertive" className="banner" style={{ background: "#fef2f2", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>{loadError}</span>
          <Button type="button" variant="ghost" onClick={() => { setLoadError(""); void loadAccounts(); }}>Retry</Button>
        </div>
      ) : null}

      <Card title="Create a new head of account">
        <FormBanner message={createMessage} isError={createIsError} />
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
              <select id="new-level" value={level} onChange={(e) => { setLevel(e.target.value); setParentId(""); }} style={inputStyle}>
                {LEVEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {levelNum > 0 ? (
              <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                <label className="l" htmlFor="new-parent">Parent head</label>
                <select id="new-parent" required value={parentId} onChange={(e) => setParentId(e.target.value)} style={inputStyle}>
                  <option value="" disabled>Select a parent head…</option>
                  {parentOptions.map((a) => (
                    <option key={a.id} value={a.id}>{[a.code, a.name].filter(Boolean).join(" · ") || a.id}</option>
                  ))}
                </select>
                {!loadError && parentOptions.length === 0 ? ( // ux-001-ok: a failed accounts load is reported by the loadError banner; this hint only shows after a successful (empty) load
                  <span className="sub" style={{ fontSize: 12 }}>
                    No {levelNum === 1 ? "major" : "minor"} head exists yet - create one first.
                  </span>
                ) : null}
              </div>
            ) : null}
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
          <Button type="submit" disabled={createBusy || !code || !name || (levelNum > 0 && !parentId)} aria-busy={createBusy} style={{ marginTop: 12 }}>
            {createBusy ? "Creating…" : "Create head"}
          </Button>
        </form>
      </Card>

      <Card title="Map PFMS HoA code to an existing head">
        <FormBanner message={message} isError={isError} />
        <form onSubmit={submitMap} className="pad">
          <div className="fields">
            <div className="fld" style={{ flexDirection: "column", alignItems: "flex-start" }}>
              <label className="l" htmlFor="hoa-search">Find a head by code or name</label>
              <input
                id="hoa-search"
                type="search"
                value={headSearch}
                disabled={!!loadError}
                onChange={(e) => setHeadSearch(e.target.value)}
                style={inputStyle}
                placeholder="e.g. 2110 or Sundry"
                aria-describedby="hoa-search-help"
              />
              <span id="hoa-search-help" className="sub" style={{ fontSize: 12 }}>
                {loadError
                  ? "Heads could not be loaded. Use Retry above."
                  : searching
                    ? "Searching…"
                    : truncated && headSearch.trim() === ""
                      ? `Showing the first ${HEAD_LIST_LIMIT} heads. Search by code or name to find any other head.`
                      : headSearch.trim() !== "" && searchResults?.length === 0 // ux-001-ok: a search that returns no match is a genuine "no match"; load failures are reported by the loadError banner
                        ? "No head matches that search."
                        : " "}
              </span>
              <label className="l" htmlFor="hoa-account">Head of account</label>
              <select id="hoa-account" required disabled={!!loadError} value={accountId} onChange={(e) => setAccountId(e.target.value)} style={inputStyle}>
                <option value="" disabled>Select a head…</option>
                {mapOptions.map((a) => (
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
          {accountId ? (
            <p className="sub" style={{ fontSize: 13, marginTop: 8 }}>
              Current PFMS HoA code:{" "}
              <strong className="mono">{currentHoa ?? "Not mapped"}</strong>
            </p>
          ) : null}
          <Button type="submit" disabled={busy || !accountId || !!loadError} aria-busy={busy} style={{ marginTop: 12 }}>
            {busy ? "Saving…" : "Save HoA code"}
          </Button>
        </form>
      </Card>
      <ConfirmDialog
        open={confirmOpen}
        title="Change PFMS HoA code?"
        danger
        requireReason
        minReasonLength={5}
        maxReasonLength={500}
        reasonLabel="Reason for changing PFMS HoA code"
        confirmLabel="Change HoA code"
        description={
          <>
            <p style={{ margin: "0 0 8px" }}>
              HoA codes drive PFMS payment and budget mapping; a wrong code silently misroutes money.
            </p>
            <p style={{ margin: "0 0 8px" }}>
              Unless this office has switched the second-approver rule off, the change is held until a <strong>different finance administrator approves it</strong>; the current code stays in use until then.
            </p>
            <p style={{ margin: 0 }}>
              {selectedHead ? <strong>{[selectedHead.code, selectedHead.name].filter(Boolean).join(" · ")}</strong> : null}
              <br />
              <span className="mono">{currentHoa ?? "Not mapped"}</span> → <strong className="mono">{hoaCode}</strong>
            </p>
          </>
        }
        busy={busy}
        onConfirm={(reason) => { void doMap(reason); }}
        onCancel={() => { if (!busy) setConfirmOpen(false); }}
      />
    </>
  );
}
