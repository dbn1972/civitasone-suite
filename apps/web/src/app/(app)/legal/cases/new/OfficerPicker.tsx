"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** An officer from the HRMS employee directory; `id` is the officer's login id (what case access is checked against). */
export interface PickedOfficer { id: string; name: string; employeeNo: string; department: string }

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

/**
 * F4: picks the additional officers a privileged case is assigned to, from the HRMS employee directory
 * (via legal-service /v1/legal/officers). The creator is always assigned by the server, so only extras are picked.
 * An empty result and a failed search are distinct states.
 */
export function OfficerPicker({ selected, onChange }: { selected: PickedOfficer[]; onChange: (next: PickedOfficer[]) => void }) {
  const t = useTranslations("legalCaseNew");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedOfficer[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) { setState("idle"); setResults([]); return; }
    let active = true;
    setState("loading");
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/proxy/v1/legal/officers?q=${encodeURIComponent(q)}`);
          if (!res.ok) throw new Error("officer search unavailable");
          const json = (await res.json()) as { items?: PickedOfficer[] };
          if (active) { setResults(json.items ?? []); setState("ready"); }
        } catch {
          if (active) { setResults([]); setState("error"); }
        }
      })();
    }, DEBOUNCE_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);

  const chosen = new Set(selected.map((o) => o.id));
  const offered = results.filter((o) => !chosen.has(o.id));

  return (
    <div className="field" style={{ gridColumn: "1 / -1" }}>
      <label className="label" htmlFor="officerSearch">{t("officersSearchLabel")}</label>
      <input id="officerSearch" className="inp" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" style={{ minHeight: 44 }} aria-describedby="officerHelp" />
      <p id="officerHelp" style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--ink2)" }}>{t("officersHelp")}</p>

      <div aria-live="polite">
        {state === "loading" ? <p style={{ fontSize: "0.8125rem", color: "var(--ink2)" }}>{t("officersSearching")}</p> : null}
        {state === "error" ? <p role="alert" style={{ fontSize: "0.8125rem", color: "var(--bad)" }}>{t("officersError")}</p> : null}
        {state === "ready" && results.length === 0 ? <p style={{ fontSize: "0.8125rem", color: "var(--ink2)" }}>{t("officersNone")}</p> : null}
      </div>

      {offered.length > 0 ? (
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 4 }}>
          {offered.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="btn"
                aria-label={t("officersAdd", { name: o.name })}
                onClick={() => { onChange([...selected, o]); setQuery(""); }}
                style={{ minHeight: 44, width: "100%", textAlign: "start" }}
              >
                {o.name}{o.employeeNo ? ` (${o.employeeNo})` : ""}{o.department ? ` - ${o.department}` : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {selected.length > 0 ? (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {selected.map((o) => (
            <li key={o.id} className="pill info" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {o.name}
              <button
                type="button"
                aria-label={t("officersRemove", { name: o.name })}
                onClick={() => onChange(selected.filter((x) => x.id !== o.id))}
                style={{ minWidth: 24, minHeight: 24, background: "none", border: 0, cursor: "pointer", color: "inherit" }}
              >
                x
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
