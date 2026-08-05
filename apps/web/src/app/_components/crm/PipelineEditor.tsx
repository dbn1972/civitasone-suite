"use client";
/**
 * PipelineEditor — OP-002 admin. CRUD sales pipelines and, per stage, configure
 * the mandatory fields, gate flag and product/region/business-unit scope that
 * drive OP-003's stage-entry enforcement. A pipeline is selected (or a new one
 * started), its stages edited inline, then saved as a whole (POST for new, PUT
 * for existing). Deletion is governed by a ConfirmDialog. A failed load shows
 * the saved-info badge and never fabricates an empty pipeline list as fact.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import {
  getPipelines,
  createPipeline,
  updatePipeline,
  deletePipeline,
  OPP_FIELD_KEYS,
  OPP_FIELD_LABELS,
  type Pipeline,
  type PipelineStage,
  type OppFieldKey,
  type OpSource,
} from "@/lib/crm/opportunity";

const inputStyle = { padding: 6, minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

let SEQ = 0;
function blankStage(): PipelineStage {
  return { key: `stage_${SEQ++}`, name: "", mandatoryFields: [], gate: false };
}
function blankPipeline(): Pipeline {
  return { name: "", stages: [blankStage()], enabled: true };
}

export function PipelineEditor() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [source, setSource] = useState<OpSource | "loading">("loading");
  const [draft, setDraft] = useState<Pipeline | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Pipeline | null>(null);
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getPipelines();
    if (!isLive()) return;
    setPipelines(data);
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, []);

  function startNew() {
    setDraft(blankPipeline());
    setMessage("");
    setError("");
  }
  function edit(p: Pipeline) {
    // Deep copy so edits don't mutate the loaded list until saved.
    setDraft({ ...p, stages: p.stages.map((s) => ({ ...s, mandatoryFields: [...s.mandatoryFields] })) });
    setMessage("");
    setError("");
  }

  function patchStage(idx: number, patch: Partial<PipelineStage>) {
    setDraft((d) => (d ? { ...d, stages: d.stages.map((s, i) => (i === idx ? { ...s, ...patch } : s)) } : d));
  }
  function toggleField(idx: number, field: OppFieldKey) {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        stages: d.stages.map((s, i) => {
          if (i !== idx) return s;
          const has = s.mandatoryFields.includes(field);
          return {
            ...s,
            mandatoryFields: has ? s.mandatoryFields.filter((f) => f !== field) : [...s.mandatoryFields, field],
          };
        }),
      };
    });
  }
  function addStage() {
    setDraft((d) => (d ? { ...d, stages: [...d.stages, blankStage()] } : d));
  }
  function removeStage(idx: number) {
    setDraft((d) => (d ? { ...d, stages: d.stages.filter((_, i) => i !== idx) } : d));
  }

  function draftValid(d: Pipeline): boolean {
    return d.name.trim().length > 0 && d.stages.length > 0 && d.stages.every((s) => s.name.trim().length > 0);
  }

  async function save() {
    if (!draft) return;
    setMessage("");
    setError("");
    if (!draftValid(draft)) {
      setError("A pipeline needs a name and at least one named stage.");
      return;
    }
    const payload: Pipeline = {
      ...draft,
      name: draft.name.trim(),
      stages: draft.stages.map((s) => ({
        ...s,
        name: s.name.trim(),
        key: s.key || s.name.trim().toLowerCase().replace(/\s+/g, "_"),
      })),
    };
    setBusy(true);
    try {
      if (payload.id) await updatePipeline(payload.id, payload);
      else await createPipeline(payload);
      setMessage(`Pipeline “${payload.name}” saved.`);
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the pipeline.");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(p: Pipeline) {
    if (!p.id) {
      setConfirmDelete(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await deletePipeline(p.id);
      setMessage(`Pipeline “${p.name}” deleted.`);
      setConfirmDelete(null);
      if (draft?.id === p.id) setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the pipeline.");
    } finally {
      setBusy(false);
    }
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading pipelines…
      </p>
    );
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Pipelines</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>
          {error}
        </p>
      ) : null}

      {pipelines.length === 0 && !draft ? (
        <EmptyState
          icon="🛤️"
          title="No pipelines yet"
          message="Create a pipeline and define its stages, mandatory fields and gates."
        />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: "0 12px", display: "grid", gap: 6 }}>
          {pipelines.map((p) => (
            <li
              key={p.id ?? p.name}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line)" }}
            >
              <span style={{ fontSize: 14 }}>
                <strong>{p.name}</strong>{" "}
                <span style={{ color: "var(--muted)" }}>
                  · {p.stages.length} stage{p.stages.length === 1 ? "" : "s"}
                  {p.enabled ? "" : " · disabled"}
                </span>
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn ghost sm" onClick={() => edit(p)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setConfirmDelete(p)}
                  aria-label={`Delete pipeline ${p.name}`}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ padding: 12 }}>
        {!draft ? (
          <button type="button" className="btn ghost" onClick={startNew}>
            + New pipeline
          </button>
        ) : (
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
            <legend style={{ fontSize: 13, fontWeight: 600 }}>{draft.id ? "Edit pipeline" : "New pipeline"}</legend>

            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              <label style={{ fontSize: 13 }}>
                Pipeline name
                <input
                  aria-label="Pipeline name"
                  value={draft.name}
                  aria-invalid={draft.name.trim() ? undefined : true}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  style={inputStyle}
                  placeholder="e.g. Enterprise sales"
                />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                Enabled
              </label>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {draft.stages.map((stage, idx) => (
                <div key={stage.key} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <label className="sr-only" htmlFor={`${headingId}-stage-${idx}`}>
                      Stage {idx + 1} name
                    </label>
                    <input
                      id={`${headingId}-stage-${idx}`}
                      value={stage.name}
                      aria-invalid={stage.name.trim() ? undefined : true}
                      onChange={(e) => patchStage(idx, { name: e.target.value })}
                      style={{ ...inputStyle, fontWeight: 600 }}
                      placeholder={`Stage ${idx + 1} name`}
                    />
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, whiteSpace: "nowrap" }}>
                      <input
                        type="checkbox"
                        checked={stage.gate}
                        onChange={(e) => patchStage(idx, { gate: e.target.checked })}
                        aria-label={`Gate stage ${idx + 1}`}
                      />
                      Gate
                    </label>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => removeStage(idx)}
                      disabled={draft.stages.length <= 1}
                      aria-label={`Remove stage ${idx + 1}`}
                    >
                      ✕
                    </button>
                  </div>

                  <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                    <legend style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Mandatory fields to enter this stage</legend>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {OPP_FIELD_KEYS.map((f) => (
                        <label key={f} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={stage.mandatoryFields.includes(f)}
                            onChange={() => toggleField(idx, f)}
                            aria-label={`${OPP_FIELD_LABELS[f]} mandatory for stage ${idx + 1}`}
                          />
                          {OPP_FIELD_LABELS[f]}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 8 }}>
                    <input
                      value={stage.product ?? ""}
                      onChange={(e) => patchStage(idx, { product: e.target.value })}
                      style={inputStyle}
                      placeholder="Product scope"
                      aria-label={`Product scope for stage ${idx + 1}`}
                    />
                    <input
                      value={stage.region ?? ""}
                      onChange={(e) => patchStage(idx, { region: e.target.value })}
                      style={inputStyle}
                      placeholder="Region scope"
                      aria-label={`Region scope for stage ${idx + 1}`}
                    />
                    <input
                      value={stage.businessUnit ?? ""}
                      onChange={(e) => patchStage(idx, { businessUnit: e.target.value })}
                      style={inputStyle}
                      placeholder="Business unit"
                      aria-label={`Business unit for stage ${idx + 1}`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="btn ghost sm" onClick={addStage}>
                + Add stage
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn ghost" onClick={() => setDraft(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : draft.id ? "Save pipeline" : "Create pipeline"}
              </button>
            </div>
          </fieldset>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        danger
        title={confirmDelete ? `Delete pipeline “${confirmDelete.name}”?` : ""}
        description="Opportunities can no longer use this pipeline. This cannot be undone."
        confirmLabel="Delete pipeline"
        busy={busy}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void doDelete(confirmDelete)}
      />
    </div>
  );
}
