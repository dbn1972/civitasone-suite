"use client";
/**
 * LeadFilters — LQ-003. Classification/segmentation filter controls for the
 * contacts (leads) list. Selecting values pushes them onto the URL query, which
 * the server component forwards to the list loader so filtering happens
 * server-side (single source of truth = the URL).
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "../ds";
import { TEMPERATURES, PRIORITIES, LEAD_STATUSES } from "@/lib/crm/leadQualification";

export interface LeadFilterValues {
  temperature: string;
  priority: string;
  /** Classification segment. Sent as the `segmentName` query param — distinct
   *  from the toolbar's `segment` view-mode (mine/recent) param. */
  segmentName: string;
  product: string;
  region: string;
  status: string;
  source: string;
}

const selStyle = { padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const inputStyle = { padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)", minWidth: 140 } as const;
const labelStyle = { display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 2, fontWeight: 600 } as const;

export function LeadFilters({ initial }: { initial: Partial<LeadFilterValues> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [v, setV] = useState<LeadFilterValues>({
    temperature: initial.temperature ?? "",
    priority: initial.priority ?? "",
    segmentName: initial.segmentName ?? "",
    product: initial.product ?? "",
    region: initial.region ?? "",
    status: initial.status ?? "",
    source: initial.source ?? "",
  });

  function set(patch: Partial<LeadFilterValues>) {
    setV((prev) => ({ ...prev, ...patch }));
  }

  function apply() {
    // GAP-CRM-CONTACTS-04: start from the CURRENT URL so the toolbar's own keys
    // (search, segment view-mode) survive; set/delete only this control's keys.
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    (Object.keys(v) as Array<keyof LeadFilterValues>).forEach((k) => {
      const val = v[k].trim();
      if (val) params.set(k, val);
      else params.delete(k);
    });
    router.push(params.toString() ? `/crm/contacts?${params.toString()}` : "/crm/contacts");
  }

  function clear() {
    // Clear only the classification filters this control owns; leave the
    // toolbar's search/segment in place (its own Clear drops everything).
    setV({ temperature: "", priority: "", segmentName: "", product: "", region: "", status: "", source: "" });
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    (["temperature", "priority", "segmentName", "product", "region", "status", "source"] as const).forEach((k) => params.delete(k));
    router.push(params.toString() ? `/crm/contacts?${params.toString()}` : "/crm/contacts");
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
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="lf-segment" style={labelStyle}>Segment</label>
          <input id="lf-segment" value={v.segmentName} onChange={(e) => set({ segmentName: e.target.value })} placeholder="Any segment" style={inputStyle} />
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
          <Button type="button" onClick={apply} style={{ minHeight: 44 }}>Apply filters</Button>
          <Button type="button" variant="ghost" onClick={clear} style={{ minHeight: 44 }}>Clear</Button>
        </div>
      </div>
    </section>
  );
}
