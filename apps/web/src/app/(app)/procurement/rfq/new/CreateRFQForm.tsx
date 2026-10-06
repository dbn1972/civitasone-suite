"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import { Button, useToast } from "@/app/_components/ds";
import { todayIST } from "@/lib/formatters";

type IndentOption = { id: string; indentNo?: string; department?: string; status?: string };
type VendorOption = { id: string; name: string; blacklisted?: boolean };

// GFR limited-tender rule: at least three vendors must be invited to an RFQ;
// fewer requires a recorded justification (override).
const MIN_VENDORS = 3;

export function CreateRFQForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [indents, setIndents] = useState<IndentOption[]>([]);
  const [indentId, setIndentId] = useState("");
  const [title, setTitle] = useState("");
  const [closingDate, setClosingDate] = useState("");
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorSearch, setVendorSearch] = useState("");
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [fewerJustification, setFewerJustification] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("RFQ");

  const today = todayIST();
  const deepLinkIndent = searchParams.get("indent");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        // GAP-PROCUREMENT-RFQ-NEW-01: only APPROVED indents — an RFQ must never
        // be raised against a draft/rejected/already-ordered indent. The server
        // also enforces status=approved; we filter client-side as a guard.
        const res = await fetch("/api/proxy/v1/procurement/indents?status=approved&limit=100", { signal: controller.signal });
        if (res.ok) {
          const body = await res.json() as { data?: IndentOption[] } | IndentOption[];
          const rows = Array.isArray(body) ? body : (body.data ?? []);
          const clean = rows.filter((i) => i.id && (i.status === undefined || i.status === "approved"));
          setIndents(clean);
          // GAP-PROCUREMENT-RFQ-NEW-01: no auto-select. Only preselect when the
          // page was deep-linked with ?indent=<id> AND that indent is approved.
          if (deepLinkIndent && clean.some((i) => i.id === deepLinkIndent)) {
            setIndentId(deepLinkIndent);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        /* optional */
      }
    })();
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/procurement/vendors?limit=100", { signal: controller.signal });
        if (res.ok) {
          const body = await res.json() as { data?: VendorOption[] } | VendorOption[];
          const rows = Array.isArray(body) ? body : (body.data ?? []);
          setVendors(rows.filter((v) => v.id && v.name));
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        /* optional */
      }
    })();
    return () => controller.abort();
  }, [deepLinkIndent]);

  // GAP-PROCUREMENT-RFQ-NEW-04 / VENDORS-01: client-side vendor search instead
  // of relying on the first 100 rows. A blacklisted vendor stays VISIBLE but
  // is rendered disabled with a "Blacklisted" badge (RFQ-NEW-02's tested
  // design — so the officer sees WHY it is unavailable) and can never be
  // toggled on; the POST /rfqs route is the real server control.
  const visibleVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    return vendors.filter((v) => !q || v.name.toLowerCase().includes(q));
  }, [vendors, vendorSearch]);

  function toggleVendor(id: string, blacklisted?: boolean) {
    if (blacklisted) return; // defence-in-depth: cannot invite a blacklisted vendor
    setInvited((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const belowMinimum = invited.size > 0 && invited.size < MIN_VENDORS;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!indentId || title.trim().length < 1 || !closingDate || invited.size === 0) {
      setStatus("error");
      setMessage("Source indent, title, closing date and at least one invited vendor are required.");
      return;
    }
    // GAP-PROCUREMENT-RFQ-NEW-04: closing date must not be in the past (IST).
    if (closingDate < today) {
      setStatus("error");
      setMessage("Closing date cannot be in the past.");
      return;
    }
    // GAP-PROCUREMENT-RFQ-NEW-02: GFR limited-tender minimum of three vendors;
    // fewer requires a written justification.
    if (belowMinimum && fewerJustification.trim().length < 1) {
      setStatus("error");
      setMessage(`At least ${MIN_VENDORS} vendors are required for a limited tender (GFR). Inviting fewer needs a justification.`);
      return;
    }
    setStatus("submitting");
    setMessage("");
    const body = {
      // GAP-PROCUREMENT-RFQ-NEW-02: no client-generated rfqNo — the server
      // allocates the authoritative gapless number (collision-free).
      title: title.trim(),
      indentRef: `procurement_indent:${indentId}`,
      closingDate,
      vendorIds: [...invited],
      ...(belowMinimum ? { fewerVendorsJustification: fewerJustification.trim() } : {}),
    };
    try {
      const res = await fetch("/api/proxy/v1/procurement/rfqs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        const human = toHumanError("save", { area: "RFQ" });
        setStatus("error");
        setMessage(`${human.what} ${human.next}`);
        return;
      }
      let parsed: { id?: string } = {};
      try { parsed = JSON.parse(text) as { id?: string }; } catch { /* ignore */ }
      setStatus("accepted");
      // GAP-PROCUREMENT-RFQ-NEW-05: a toast survives the navigation (the old
      // inline success message was overwritten by router.push immediately).
      toast.success("RFQ issued to the selected vendors.");
      router.push(parsed.id ? `/procurement/rfq/${parsed.id}` : "/procurement/rfq");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(formError.fromException("save", err).message);
    }
  }

  return (
    <form className="card pad" onSubmit={(e) => void handleSubmit(e)} style={{ maxWidth: 720 }} noValidate>
      <div className="fields">
        <label className="field">
          <span className="label">Source indent *</span>
          <select className="inp" value={indentId} onChange={(e) => setIndentId(e.target.value)} required style={{ minHeight: 44 }}>
            {/* GAP-PROCUREMENT-RFQ-NEW-01: placeholder, no auto-selected indent. */}
            <option value="">{indents.length === 0 ? "No approved indents available" : "Select an approved indent"}</option>
            {indents.map((i) => <option key={i.id} value={i.id}>{i.indentNo ?? i.id}{i.department ? ` — ${i.department}` : ""}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="label">Closing date *</span>
          {/* GAP-PROCUREMENT-RFQ-NEW-04: min=today (IST) blocks past dates. */}
          <input className="inp" type="date" min={today} value={closingDate} onChange={(e) => setClosingDate(e.target.value)} required style={{ minHeight: 44 }} />
        </label>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="r-title">RFQ title *</label>
          <input id="r-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ minHeight: 44 }} />
        </div>
      </div>

      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, margin: "8px 0 0" }}>
        <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 6px" }}>
          Invite vendors * ({invited.size} selected; minimum {MIN_VENDORS} for a limited tender)
        </legend>
        <input
          className="inp"
          type="search"
          placeholder="Search vendors…"
          value={vendorSearch}
          onChange={(e) => setVendorSearch(e.target.value)}
          style={{ minHeight: 40, marginBottom: 10 }}
          aria-label="Search vendors"
        />
        {vendors.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--mut)", margin: 0 }}>Loading vendors…</p>
        ) : visibleVendors.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--mut)", margin: 0 }}>No vendors match “{vendorSearch}”.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {visibleVendors.map((v) => (
              <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, minHeight: 36, opacity: v.blacklisted ? 0.6 : 1 }}>
                <input
                  type="checkbox"
                  checked={invited.has(v.id)}
                  disabled={v.blacklisted}
                  onChange={() => toggleVendor(v.id, v.blacklisted)}
                />
                {v.name}
                {v.blacklisted ? <span className="pill bad" style={{ marginInlineStart: 4 }}>Blacklisted</span> : null}
              </label>
            ))}
          </div>
        )}
        {belowMinimum ? (
          <div className="field" style={{ marginTop: 12 }}>
            <label className="label" htmlFor="r-fewer">Justification for inviting fewer than {MIN_VENDORS} vendors *</label>
            <textarea
              id="r-fewer"
              className="inp"
              value={fewerJustification}
              onChange={(e) => setFewerJustification(e.target.value)}
              rows={2}
            />
          </div>
        ) : null}
      </fieldset>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, fontSize: "0.875rem", color: status === "error" ? "var(--bad)" : "var(--good)" }}>{message}</p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Issuing…" : "Issue RFQ"}
        </Button>
        <Link href="/procurement/rfq" className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
