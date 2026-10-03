"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, PageHeader, EmptyState, ErrorState } from "../../../_components/ds";
import { SkeletonRow } from "../../../_components/ds/Skeleton";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import {
  buildLocationTree,
  fetchAllLocations,
  flattenTree,
  hasDuplicateCode,
  orgUnitNames,
  type Location,
  type LocationNode,
} from "./locationTree";

export default function LocationsPage() {
  const [rows, setRows] = useState<Location[]>([]);
  const [form, setForm] = useState({ code: "", name: "", orgUnit: "", parentId: "" });
  const [codeError, setCodeError] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // null = org list not (yet) available -> free-text fallback (e.g. the admin endpoint 403s for asset clerks)
  const [orgUnits, setOrgUnits] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; orgUnit: string } | null>(null);
  const formError = useFormError("functional location");

  async function load(signal?: AbortSignal) {
    setLoadError(false);
    try {
      const all = await fetchAllLocations(async (offset, limit) => {
        const res = await fetch(`/api/proxy/v1/asset/locations?limit=${limit}&offset=${offset}`, { signal });
        if (!res.ok) return null;
        const body = (await res.json()) as { data?: Location[] };
        return body.data ?? [];
      });
      setLoaded(true);
      if (all === null) {
        setLoadError(true);
        return;
      }
      setRows(all);
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") {
        setLoaded(true);
        setLoadError(true);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    // GAP-ASSETS-LOCATIONS-05: org units come from the tenant org hierarchy; any failure
    // (403 for a clerk, network) just leaves the free-text input in place.
    void (async () => {
      try {
        const res = await fetch("/api/proxy/v1/admin/org-hierarchy", { signal: controller.signal });
        if (!res.ok) return;
        const names = orgUnitNames(await res.json());
        if (names.length > 0) setOrgUnits(names);
      } catch {
        /* free-text fallback */
      }
    })();
    return () => controller.abort();
  }, []);

  const tree = useMemo(() => buildLocationTree(rows), [rows]);
  const parentOptions = useMemo(() => flattenTree(tree), [tree]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setIsError(false);
    // GAP-ASSETS-LOCATIONS-02: the code is unique per tenant -- say so before any request.
    if (hasDuplicateCode(rows, form.code)) {
      setCodeError("Code already exists. Choose a different location code.");
      document.getElementById("loc-code")?.focus();
      return;
    }
    setCodeError("");
    setBusy(true);
    try {
      const res = await fetch("/api/proxy/v1/asset/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim(),
          name: form.name.trim(),
          orgUnit: form.orgUnit.trim() || undefined,
          parentId: form.parentId || undefined,
        }),
      });
      if (res.status === 409) {
        setCodeError("Code already exists. Choose a different location code.");
        return;
      }
      if (!res.ok) {
        setIsError(true);
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage("Functional location submitted. It appears in the list once processed.");
      setForm({ code: "", name: "", orgUnit: "", parentId: "" });
      await load();
    } catch (caught) {
      setIsError(true);
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch(`/api/proxy/v1/asset/locations/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editing.name.trim(), orgUnit: editing.orgUnit.trim() || null }),
      });
      if (!res.ok) {
        setIsError(true);
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setMessage("Location updated. The code cannot be changed.");
      setEditing(null);
      await load();
    } catch (caught) {
      setIsError(true);
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { padding: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
  const fieldCol = { display: "flex", flexDirection: "column" as const, gap: 4 };

  function renderNode(n: LocationNode) {
    const isEditing = editing?.id === n.id;
    return (
      <li key={n.id} style={{ marginBottom: 4 }}>
        {isEditing && editing ? (
          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <strong>{n.code}</strong>
            <input aria-label={`Name for ${n.code}`} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} style={inputStyle} />
            <input aria-label={`Org unit for ${n.code}`} value={editing.orgUnit} maxLength={64} onChange={(e) => setEditing({ ...editing, orgUnit: e.target.value })} style={inputStyle} />
            <Button type="button" size="sm" disabled={busy || !editing.name.trim()} onClick={() => void saveEdit()}>Save</Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
          </span>
        ) : (
          <>
            <strong>{n.code}</strong> — {n.name}{n.orgUnit ? ` (${n.orgUnit})` : ""}{" "}
            <Button
              type="button" size="sm" variant="ghost"
              aria-label={`Edit location ${n.code}`}
              onClick={() => setEditing({ id: n.id, name: n.name, orgUnit: n.orgUnit ?? "" })}
            >
              Edit
            </Button>
          </>
        )}
        {n.children.length > 0 ? <ul style={{ margin: "4px 0 0", paddingLeft: 20, listStyle: "circle" }}>{n.children.map(renderNode)}</ul> : null}
      </li>
    );
  }

  return (
    <>
      <PageHeader
        title="Functional Locations"
        subtitle="Equipment and org-unit locations, nested under their parent location."
        back="/assets"
        backLabel="Assets"
      />
      {message ? (
        <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} className="banner" style={{ background: "var(--panel)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>{message}</div>
      ) : null}
      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={submit} className="pad">
          <div className="fields">
            <div style={fieldCol}>
              <label className="l" htmlFor="loc-code">Location code</label>
              <input
                id="loc-code" required value={form.code} maxLength={64}
                onChange={(e) => { setForm({ ...form, code: e.target.value }); setCodeError(""); }}
                aria-invalid={codeError ? true : undefined}
                aria-describedby={codeError ? "loc-code-err" : undefined}
                style={inputStyle}
              />
              {codeError ? <p id="loc-code-err" role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{codeError}</p> : null}
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="loc-name">Name</label>
              <input id="loc-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="loc-parent">Parent location</label>
              <select id="loc-parent" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} style={inputStyle}>
                <option value="">None (top level)</option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>{`${"— ".repeat(p.depth)}${p.code} · ${p.name}`}</option>
                ))}
              </select>
            </div>
            <div style={fieldCol}>
              <label className="l" htmlFor="loc-org">Org unit</label>
              {orgUnits ? (
                <select id="loc-org" value={form.orgUnit} onChange={(e) => setForm({ ...form, orgUnit: e.target.value })} style={inputStyle}>
                  <option value="">None</option>
                  {orgUnits.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input id="loc-org" value={form.orgUnit} maxLength={64} onChange={(e) => setForm({ ...form, orgUnit: e.target.value })} style={inputStyle} />
              )}
            </div>
          </div>
          <Button type="submit" disabled={busy} style={{ marginTop: 12 }}>{busy ? "Adding…" : "Add location"}</Button>
        </form>
      </div>
      <div className="card">
        <div className="card-h"><h3>Location hierarchy</h3></div>
        {loadError ? (
          <div className="pad">
            <ErrorState error={toHumanError("load", { area: "functional locations" })} onRetry={() => load()} />
          </div>
        ) : !loaded ? (
          <div className="pad" aria-busy="true" aria-label="Loading locations…">
            {[0, 1, 2, 3, 4].map((i) => <SkeletonRow key={i} />)}
          </div>
        ) : tree.length === 0 ? (
          <EmptyState icon="📍" title="No locations yet" message="Add functional locations to build the location hierarchy." />
        ) : (
          <div className="pad">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{tree.map(renderNode)}</ul>
          </div>
        )}
      </div>
    </>
  );
}
