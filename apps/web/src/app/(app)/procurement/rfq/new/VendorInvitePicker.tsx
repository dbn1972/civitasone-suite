"use client";

/**
 * GAP-PROCUREMENT-RFQ-NEW-02 / RFQ-NEW-04 - the RFQ "invite vendors" checklist.
 *
 * Searches the SERVER (?q=, 25 per query) instead of filtering the first 100
 * rows in the browser, so a vendor master of any size is reachable. Every row
 * shows the vendor's standing (Empanelled / Registered / Blacklisted); a
 * blacklisted vendor is visible but cannot be ticked (the server also rejects
 * it). Vendors already ticked stay listed in a "selected" strip even when the
 * current search no longer shows them, so a selection is never silently lost.
 * A failed search is an error with Retry - never an empty list.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export type InviteVendor = { id: string; name: string; blacklisted: boolean; vendorType?: string };

type Row = { id: string; name: string; blacklisted?: boolean; vendorType?: string };
type LoadState = "loading" | "ready" | "error";

const PAGE = 25;

export function VendorInvitePicker({
  selected,
  onToggle,
  onStateChange,
}: {
  selected: Map<string, InviteVendor>;
  onToggle: (v: InviteVendor) => void;
  onStateChange?: (state: LoadState) => void;
}) {
  const tw = useTranslations("procurement.w2.rfq");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<InviteVendor[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [nonce, setNonce] = useState(0);

  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    const handle = setTimeout(() => {
      const qs = new URLSearchParams({ limit: String(PAGE) });
      if (query.trim()) qs.set("q", query.trim());
      fetch(`/api/proxy/v1/procurement/vendors?${qs.toString()}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error("vendor search failed");
          const body = await res.json() as { data?: Row[] } | Row[];
          const list = Array.isArray(body) ? body : (body.data ?? []);
          setRows(list
            .filter((v) => v.id && v.name)
            .map((v) => ({ id: v.id, name: v.name, blacklisted: Boolean(v.blacklisted) || v.vendorType === "blacklisted", ...(v.vendorType ? { vendorType: v.vendorType } : {}) })));
          setState("ready");
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setRows([]);
          setState("error");
        });
    }, query ? 250 : 0);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [query, nonce]);

  const standing = (v: InviteVendor): { label: string; cls: string } => {
    if (v.blacklisted) return { label: tw("blacklisted"), cls: "pill bad" };
    if (v.vendorType === "empanelled") return { label: tw("empanelled"), cls: "pill good" };
    return { label: tw("notEmpanelled"), cls: "pill" };
  };

  const hiddenSelected = [...selected.values()].filter((s) => !rows.some((r) => r.id === s.id));

  return (
    <div>
      <input
        className="inp"
        type="search"
        placeholder={tw("searchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ minHeight: 40, marginBottom: 10 }}
        aria-label={tw("searchLabel")}
      />

      {hiddenSelected.length > 0 ? (
        <p style={{ fontSize: 12.5, margin: "0 0 8px" }} data-testid="rfq-selected-strip">
          <strong>{tw("selectedOutsideSearch", { count: hiddenSelected.length })}</strong>{" "}
          {hiddenSelected.map((s) => (
            <button key={s.id} type="button" className="pill" style={{ marginInlineEnd: 4 }} onClick={() => onToggle(s)} aria-label={tw("removeVendor", { name: s.name })}>
              {s.name} x
            </button>
          ))}
        </p>
      ) : null}

      {state === "loading" ? (
        <p role="status" style={{ fontSize: 13, color: "var(--mut)", margin: 0 }}>{tw("searching")}</p>
      ) : state === "error" ? (
        <p role="alert" style={{ fontSize: 13, color: "var(--bad)", margin: 0 }}>
          {tw("searchFailed")}{" "}
          <button type="button" className="btn ghost" style={{ padding: "2px 8px" }} onClick={() => setNonce((n) => n + 1)}>{tw("retry")}</button>
        </p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--mut)", margin: 0 }}>{query.trim() ? tw("noMatch", { query: query.trim() }) : tw("noVendors")}</p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
            {rows.map((v) => {
              const s = standing(v);
              return (
                <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, minHeight: 36, opacity: v.blacklisted ? 0.6 : 1 }}>
                  <input
                    type="checkbox"
                    checked={selected.has(v.id)}
                    disabled={v.blacklisted}
                    onChange={() => { if (!v.blacklisted) onToggle(v); }}
                  />
                  {v.name}
                  <span className={s.cls} style={{ marginInlineStart: 4 }}>{s.label}</span>
                </label>
              );
            })}
          </div>
          {rows.length >= PAGE ? <p style={{ fontSize: 12, color: "var(--mut)", margin: "8px 0 0" }}>{tw("refine", { count: PAGE })}</p> : null}
        </>
      )}
    </div>
  );
}
