"use client";
/**
 * PipelineEditor — OP-002 admin. CRUD sales pipelines and, per stage, configure
 * the mandatory fields, gate flag and product/region/business-unit scope that
 * drive OP-003's stage-entry enforcement. A pipeline is selected (or a new one
 * started), its stages edited inline, then saved as a whole (POST for new, PUT
 * for existing). Deletion is governed by a ConfirmDialog. A failed load shows
 * the saved-info badge and never fabricates an empty pipeline list as fact.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button } from "../ds";
import { HelpTip } from "../ds/HelpTip";
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
// GAP-CRM-PIPELINES-06: a new stage carries a TRANSIENT key marker (prefixed
// `__new_`) only so React has a stable list key while editing. The real,
// persisted key is derived from the stage NAME on save (slugified, uniqueness-
// suffixed) — never the opaque `stage_N` the editor used to persist, which left
// keys like "stage_2" drifting from a name like "Proposal". A key WITHOUT this
// prefix is one already persisted by the server and is left immutable, so a
// rename never re-keys a saved stage (which would orphan its stage limits).
const NEW_STAGE_PREFIX = "__new_";
function blankStage(): PipelineStage {
  return { key: `${NEW_STAGE_PREFIX}${SEQ++}`, name: "", mandatoryFields: [], gate: false };
}
function isNewStageKey(key: string): boolean {
  return key.startsWith(NEW_STAGE_PREFIX);
}
/** Slugify a stage name to a key, falling back to a stable id when it is blank. */
function slugifyStageName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "stage"
  );
}
function blankPipeline(): Pipeline {
  return { name: "", stages: [blankStage()], enabled: true };
}

export function PipelineEditor() {
  const t = useTranslations("crmPipelineEditor");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [source, setSource] = useState<OpSource | "loading">("loading");
  const [draft, setDraft] = useState<Pipeline | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Pipeline | null>(null);
  // GAP-CRM-PIPELINES-02: an aria-live message announcing stage reorders.
  const [stageAnnouncement, setStageAnnouncement] = useState("");
  // GAP-CRM-PIPELINES-05: the pristine JSON of the draft when it was opened, used
  // to detect unsaved edits; a pending editor-switch action held while the
  // "discard unsaved changes?" confirm is shown; and a ref to the draft fieldset
  // + name input so opening an editor scrolls it into view and moves focus.
  const [pristine, setPristine] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState<(() => void) | null>(null);
  const fieldsetRef = useRef<HTMLFieldSetElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
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

  // GAP-CRM-PIPELINES-05: an open draft is "dirty" when it differs from the
  // snapshot captured when it was opened.
  const dirty = draft !== null && pristine !== null && JSON.stringify(draft) !== pristine;

  function openDraft(next: Pipeline) {
    setDraft(next);
    setPristine(JSON.stringify(next));
    setMessage("");
    setError("");
  }

  // Guard switching between drafts: if the current draft has unsaved edits, hold
  // the requested open behind a confirm; otherwise open immediately.
  function guardedOpen(open: () => void) {
    if (dirty) {
      setPendingOpen(() => open);
      return;
    }
    open();
  }

  // GAP-CRM-PIPELINES-05: when a draft opens, scroll the editor into view and
  // move focus to the name input so the editor below the list is not missed.
  useEffect(() => {
    if (draft && fieldsetRef.current) {
      if (typeof fieldsetRef.current.scrollIntoView === "function") {
        fieldsetRef.current.scrollIntoView({ block: "nearest" });
      }
      nameInputRef.current?.focus();
    }
  }, [draft]);

  function startNew() {
    guardedOpen(() => openDraft(blankPipeline()));
  }
  function edit(p: Pipeline) {
    guardedOpen(() =>
      // Deep copy so edits don't mutate the loaded list until saved.
      openDraft({ ...p, stages: p.stages.map((s) => ({ ...s, mandatoryFields: [...s.mandatoryFields] })) }),
    );
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

  // GAP-CRM-PIPELINES-02: stage order IS the process flow, but the editor could
  // only append/remove, never reorder. moveStage swaps a stage with its
  // neighbour so the order can be corrected without deleting and recreating.
  // The server must key stage identity on `key` (not array index) for this to
  // be safe on a pipeline with live deals — the save payload preserves each
  // stage's key, so a reorder changes only ordinal, not identity. (That server
  // behaviour is asserted by the save contract, not verifiable here.)
  function moveStage(idx: number, dir: "up" | "down") {
    setDraft((d) => {
      if (!d) return d;
      const target = dir === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= d.stages.length) return d;
      const stages = [...d.stages];
      const [moved] = stages.splice(idx, 1);
      stages.splice(target, 0, moved);
      return { ...d, stages };
    });
    setStageAnnouncement(
      t("stageMovedAnnouncement", { n: idx + 1, dir, position: dir === "up" ? idx : idx + 2 }),
    );
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
    // GAP-CRM-PIPELINES-06: compute each stage's persisted key.
    //  - A stage already persisted (key without the __new_ marker) keeps its
    //    key verbatim, even after a rename — re-keying it would orphan the
    //    stage limits typed against the old key.
    //  - A new stage's key is derived from its (trimmed) name, slugified, with a
    //    numeric suffix when that slug collides with another stage in this
    //    pipeline, so two stages named "Review" become "review" and "review_2".
    const usedKeys = new Set<string>();
    for (const s of draft.stages) {
      if (!isNewStageKey(s.key)) usedKeys.add(s.key);
    }
    const payload: Pipeline = {
      ...draft,
      name: draft.name.trim(),
      stages: draft.stages.map((s) => {
        const name = s.name.trim();
        let key = s.key;
        if (isNewStageKey(s.key)) {
          const base = slugifyStageName(name);
          key = base;
          let n = 2;
          while (usedKeys.has(key)) key = `${base}_${n++}`;
          usedKeys.add(key);
        }
        return { ...s, name, key };
      }),
    };
    setBusy(true);
    try {
      if (payload.id) await updatePipeline(payload.id, payload);
      else await createPipeline(payload);
      setMessage(`Pipeline “${payload.name}” saved.`);
      setDraft(null);
      setPristine(null);
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
      if (draft?.id === p.id) { setDraft(null); setPristine(null); }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the pipeline.");
    } finally {
      setBusy(false);
    }
  }

  // GAP-CRM-PIPELINES-04: distinct, non-empty scope values already used across
  // saved pipelines and the current draft — the datalist suggestions.
  const scopeOptions = (() => {
    const products = new Set<string>();
    const regions = new Set<string>();
    const businessUnits = new Set<string>();
    const sources = [...pipelines, ...(draft ? [draft] : [])];
    for (const p of sources) {
      for (const s of p.stages) {
        if (s.product?.trim()) products.add(s.product.trim());
        if (s.region?.trim()) regions.add(s.region.trim());
        if (s.businessUnit?.trim()) businessUnits.add(s.businessUnit.trim());
      }
    }
    return {
      products: [...products].sort(),
      regions: [...regions].sort(),
      businessUnits: [...businessUnits].sort(),
    };
  })();

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
                <Button type="button" variant="ghost" size="sm" onClick={() => edit(p)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(p)}
                  aria-label={`Delete pipeline ${p.name}`}
                >
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ padding: 12 }}>
        {!draft ? (
          <Button type="button" variant="ghost" onClick={startNew}>
            + New pipeline
          </Button>
        ) : (
          <fieldset ref={fieldsetRef} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
            <legend style={{ fontSize: 13, fontWeight: 600 }}>{draft.id ? "Edit pipeline" : "New pipeline"}</legend>

            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              <label style={{ fontSize: 13 }}>
                Pipeline name
                <input
                  ref={nameInputRef}
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
              {/* GAP-CRM-PIPELINES-02: announce reorders to assistive tech. */}
              <div className="sr-only" role="status" aria-live="polite">{stageAnnouncement}</div>
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
                      {/* GAP-CRM-PIPELINES-04: "Gate" is specialist jargon whose
                          meaning previously lived only in a type comment. */}
                      <HelpTip term={t("gate")}>
                        {t("gateHelp")}
                      </HelpTip>
                    </label>
                    {/* GAP-CRM-PIPELINES-02: reorder a stage within the flow. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => moveStage(idx, "up")}
                      disabled={idx === 0}
                      aria-label={t("moveStageUp", { n: idx + 1 })}
                      title={t("moveStageUpTitle")}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => moveStage(idx, "down")}
                      disabled={idx === draft.stages.length - 1}
                      aria-label={t("moveStageDown", { n: idx + 1 })}
                      title={t("moveStageDownTitle")}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeStage(idx)}
                      disabled={draft.stages.length <= 1}
                      aria-label={`Remove stage ${idx + 1}`}
                      title={draft.id ? t("removeStageHint") : undefined}
                    >
                      ✕
                    </Button>
                  </div>

                  {/* GAP-CRM-PIPELINES-06: surface the stage KEY so the admin can
                      see what the stage limits are keyed against. A persisted
                      stage shows its immutable key read-only; a new stage shows
                      the slug its name will be saved as (so there is no surprise
                      "stage_2" drift). */}
                  <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 8px" }}>
                    {isNewStageKey(stage.key) ? (
                      <>Key (on save): <code>{slugifyStageName(stage.name)}</code></>
                    ) : (
                      <>Key: <code>{stage.key}</code></>
                    )}
                  </p>

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

                  {/* GAP-CRM-PIPELINES-04: explain what the scope fields do, and
                      offer existing values as a datalist so the clerk reuses an
                      established value instead of inventing a mismatching one.
                      These stay free text until master data exists (the server's
                      scope-matching format is not confirmable here). */}
                  <fieldset style={{ border: "none", padding: 0, margin: 0, marginTop: 8 }}>
                    <legend style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "inline-flex", alignItems: "center" }}>
                      {t("scopeLegend")}
                      <HelpTip term={t("scope")}>
                        {t("scopeHelp")}
                      </HelpTip>
                    </legend>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                      <input
                        value={stage.product ?? ""}
                        onChange={(e) => patchStage(idx, { product: e.target.value })}
                        style={inputStyle}
                        placeholder={t("productScope")}
                        aria-label={t("productScopeAria", { n: idx + 1 })}
                        list={`${headingId}-products`}
                      />
                      <input
                        value={stage.region ?? ""}
                        onChange={(e) => patchStage(idx, { region: e.target.value })}
                        style={inputStyle}
                        placeholder={t("regionScope")}
                        aria-label={t("regionScopeAria", { n: idx + 1 })}
                        list={`${headingId}-regions`}
                      />
                      <input
                        value={stage.businessUnit ?? ""}
                        onChange={(e) => patchStage(idx, { businessUnit: e.target.value })}
                        style={inputStyle}
                        placeholder={t("businessUnit")}
                        aria-label={t("businessUnitAria", { n: idx + 1 })}
                        list={`${headingId}-business-units`}
                      />
                    </div>
                  </fieldset>
                </div>
              ))}
            </div>

            {/* GAP-CRM-PIPELINES-04: datalists of scope values already in use
                across saved pipelines + the current draft, so entries are reused
                consistently rather than retyped (and mis-typed). */}
            <datalist id={`${headingId}-products`}>
              {scopeOptions.products.map((v) => <option key={v} value={v} />)}
            </datalist>
            <datalist id={`${headingId}-regions`}>
              {scopeOptions.regions.map((v) => <option key={v} value={v} />)}
            </datalist>
            <datalist id={`${headingId}-business-units`}>
              {scopeOptions.businessUnits.map((v) => <option key={v} value={v} />)}
            </datalist>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Button type="button" variant="ghost" size="sm" onClick={addStage}>
                + Add stage
              </Button>
              <span style={{ flex: 1 }} />
              <Button type="button" variant="ghost" onClick={() => { setDraft(null); setPristine(null); }} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : draft.id ? "Save pipeline" : "Create pipeline"}
              </Button>
            </div>
          </fieldset>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        danger
        title={confirmDelete ? `Delete pipeline “${confirmDelete.name}”?` : ""}
        description={t("deleteDescription")}
        confirmLabel="Delete pipeline"
        busy={busy}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void doDelete(confirmDelete)}
      />

      {/* GAP-CRM-PIPELINES-05: switching to Edit/New with unsaved edits used to
          silently discard the current draft. Hold the switch behind an explicit
          confirm; cancelling keeps the current draft intact. */}
      <ConfirmDialog
        open={pendingOpen !== null}
        danger
        title="Discard unsaved changes?"
        description="You have unsaved changes to this pipeline. Opening another will discard them. This cannot be undone."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onCancel={() => setPendingOpen(null)}
        onConfirm={() => {
          const open = pendingOpen;
          setPendingOpen(null);
          open?.();
        }}
      />
    </div>
  );
}
