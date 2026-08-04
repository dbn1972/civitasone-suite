"use client";
/**
 * LeadFilters — LQ-003. Classification/segmentation filter controls for the
 * contacts (leads) list. Selecting values pushes them onto the URL query, which
 * the server component forwards to the list loader so filtering happens
 * server-side (single source of truth = the URL).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TEMPERATURES, PRIORITIES } from "@/lib/crm/leadQualification";

export interface LeadFilterValues {
  temperature: string;
  priority: string;
  segment: string;
  product: string;
  region: string;
  status: string;
  source: string;
}

const STATUS_OPTIONS = ["new", "contacted", "qualified", "unqualified", "disqualified", "customer"];

const selStyle = { padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const inputStyle = { padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)", minWidth: 140 } as const;
const labelStyle = { display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 2, fontWeight: 600 } as const;

export function LeadFilters({ initial }: { initial: Partial<LeadFilterValues> }) {
  const router = useRouter();
  const [v, setV] = useState<LeadFilterValues>({
    temperature: initial.temperature ?? "",
    priority: initial.priority ?? "",
    segment: initial.segment ?? "",
    product: initial.product ?? "",
    region: initial.region ?? "",
    status: initial.status ?? "",
    source: initial.source ?? "",
  });

  function set(patch: Partial<LeadFilterValues>) {
    setV((prev) => ({ ...prev, ...patch }));
  }

  function apply() {
    const params = new URLSearchParams();
    (Object.keys(v) as Array<keyof LeadFilterValues>).forEach((k) => {
      const val = v[k].trim();
      if (val) params.set(k, val);
    });
    router.push(params.toString() ? `/crm/contacts?${params.toString()}` : "/crm/contacts");
  }

  function clear() {
    setV({ temperature: "", priority: "", segment: "", product: "", region: "", status: "", source: "" });
    router.push("/crm/contacts");
  }

  return (
    <section className="card" aria-label="Lead classification filters" style={{ marginBottom: 12 }}>
      <div className="card-h"><h3>Filter leads</h3></div>
      <div className="pad" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label htmlFor="lf-temperature" style={labelStyle}>Temperature</label>
          <select id="lf-temperature" value={v.temperature} onChange={(e) => set({ temperature: e.target.value })} style={selStyle}>
            <option value="">Any</option>
            {TEMPERATURES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="lf-priority" style={labelStyle}>Priority</label>
          <select id="lf-priority" value={v.priority} onChange={(e) => set({ priority: e.target.value })} style={selStyle}>
            <option value="">Any</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="lf-status" style={labelStyle}>Status</label>
          <select id="lf-status" value={v.status} onChange={(e) => set({ status: e.target.value })} style={selStyle}>
            <option value="">Any</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="lf-segment" style={labelStyle}>Segment</label>
          <input id="lf-segment" value={v.segment} onChange={(e) => set({ segment: e.target.value })} placeholder="Any segment" style={inputStyle} />
        </div>
        <div>
          <label htmlFor="lf-product" style={labelStyle}>Product</label>
          <input id="lf-product" value={v.product} onChange={(e) => set({ product: e.target.value })} placeholder="Any product" style={inputStyle} />
        </div>
        <div>
          <label htmlFor="lf-region" style={labelStyle}>Region</label>
          <input id="lf-region" value={v.region} onChange={(e) => set({ region: e.target.value })} placeholder="Any region" style={inputStyle} />
        </div>
        <div>
          <label htmlFor="lf-source" style={labelStyle}>Source</label>
          <input id="lf-source" value={v.source} onChange={(e) => set({ source: e.target.value })} placeholder="Any source" style={inputStyle} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn primary" onClick={apply} style={{ minHeight: 44 }}>Apply filters</button>
          <button type="button" className="btn ghost" onClick={clear} style={{ minHeight: 44 }}>Clear</button>
        </div>
      </div>
    </section>
  );
}
