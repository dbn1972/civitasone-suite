"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, PageHeader, Term, ConfirmDialog, useConfirmAction } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

// Classification options are exactly the four tiers the estab-service actually
// stores and enforces as an ordered clearance lattice
// (public < confidential < secret < top_secret — see createFileBody validator
// and migration 0015_operator_clearance). The audit-era CLASS_MAP silently
// collapsed Restricted → confidential (security-marking DATA LOSS) and relabelled
// an internal file as "public"; it is removed. The selected value is sent
// unchanged — the server is the single source of truth for the enum and will
// reject anything outside it (fail closed) rather than the client guessing.
// NOTE (HUMAN REVIEW): if "restricted"/"unclassified" are required marking
// tiers, the backend lattice + clearance ranks must be redesigned first; that
// is out of scope for a client-only fix.
const CLASSIFICATION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "public", label: "Public (unclassified)" },
  { value: "confidential", label: "Confidential" },
  { value: "secret", label: "Secret" },
  { value: "top_secret", label: "Top Secret" },
];

export default function NewFilePage() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [classification, setClassification] = useState("public");
  const [department, setDepartment] = useState("ADMIN");
  // GAP-ESTAB-FILES-NEW-03: load operator divisions for a department dropdown.
  const [divisions, setDivisions] = useState<string[]>([]);
  const [initialNote, setInitialNote] = useState("");
  const [dakNo, setDakNo] = useState("");
  const [parentFileId, setParentFileId] = useState("");
  // GAP-ESTAB-FILES-NEW-02: parent-file search results + DAK list for pickers.
  const [parentQuery, setParentQuery] = useState("");
  const [parentResults, setParentResults] = useState<Array<{ id: string; fileNo: string; subject: string }>>([]);
  const [dakOptions, setDakOptions] = useState<Array<{ id: string; dakNo: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  // `created` latches true after a successful create so the submit button stays
  // disabled through the navigation window — prevents a double-click opening a
  // second file with a fresh gapless number (GAP-ESTAB-FILES-NEW-05).
  const [created, setCreated] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const formError = useFormError("file");
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only success toasts auto-dismiss; error banners persist until the next
  // submit so a screen-reader user isn't raced by a 5s timer (A11Y, NEW-04).
  // Clean the timer up on unmount.
  useEffect(() => {
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, []);

  // On error, move focus to the banner so it is announced and visible.
  useEffect(() => {
    if (toast?.type === "error" && bannerRef.current) {
      bannerRef.current.focus();
    }
  }, [toast]);

  // GAP-ESTAB-FILES-NEW-03: load divisions for department dropdown.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/estab/operators?activeOnly=true&limit=500", { signal: controller.signal });
        if (res.ok) {
          const body = (await res.json()) as { data?: Array<{ division: string }> };
          const divs = [...new Set((body.data ?? []).map((o) => o.division).filter(Boolean))].sort();
          setDivisions(divs);
          // Default to the first division instead of hard-coded "ADMIN".
          if (divs.length > 0 && department === "ADMIN" && !divs.includes("ADMIN")) {
            setDepartment(divs[0]);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    })();
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GAP-ESTAB-FILES-NEW-02: load unlinked DAK items for the DAK picker.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/estab/dak?limit=200", { signal: controller.signal });
        if (res.ok) {
          const body = (await res.json()) as { data?: Array<{ id: string; dakNo?: string; receiptNo?: string }> };
          setDakOptions(
            (body.data ?? [])
              .filter((d) => d.dakNo || d.receiptNo)
              .map((d) => ({ id: d.id, dakNo: d.dakNo ?? d.receiptNo ?? d.id.slice(0, 8) })),
          );
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    })();
    return () => controller.abort();
  }, []);

  // GAP-ESTAB-FILES-NEW-02: debounced parent-file search (typeahead).
  useEffect(() => {
    if (parentQuery.length < 2) { setParentResults([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/proxy/v1/estab/files/search?q=${encodeURIComponent(parentQuery)}&limit=10`,
          { signal: controller.signal },
        );
        if (res.ok) {
          const body = (await res.json()) as { data?: Array<{ id: string; fileNo: string; subject: string }> };
          setParentResults(body.data ?? []);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [parentQuery]);

  const dirty = Boolean(
    subject || initialNote || dakNo || parentFileId.trim() || parentQuery.trim(),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || created) return;
    setSubmitting(true);
    formError.clear();
    setToast(null);
    if (successTimer.current) {
      clearTimeout(successTimer.current);
      successTimer.current = null;
    }
    try {
      // Do NOT invent a file number on the client — the gapless CSMOP file
      // number is allocated server-side (per section + year). Sending a random
      // one both showed the officer a wrong number and risked persisting it.
      const payload = {
        subject,
        dept: department || "ADMIN",
        // Send the selected tier verbatim — no lossy remap (NEW-01).
        classification,
        // SECURITY: no officer placeholder — currentWith is intentionally
        // omitted so the server defaults it to the authenticated actor
        // creating this file (never a client-suppliable id).
        initialNote: initialNote || undefined,
        dakNo: dakNo || undefined,
        parentFileId: parentFileId.trim() || undefined,
      };
      const res = await fetch("/api/proxy/v1/estab/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 202 || res.ok) {
        const body = (await res.json().catch(() => ({}))) as { id?: string; fileNo?: string };
        // Latch created so the button cannot fire a second POST.
        setCreated(true);
        // Show the allocated file number so the officer can record it even if
        // they are navigated away (NEW-06).
        setToast({
          type: "success",
          message: body.fileNo
            ? `File ${body.fileNo} created with an opening yellow note. Opening it now…`
            : "File created with an opening yellow note. Opening it now…",
        });
        if (body.id) {
          router.push(`/estab/files/${body.id}`);
        }
        return;
      }
      setToast({
        type: "error",
        message: (await formError.fromResponse(res, "save")).message,
      });
      setSubmitting(false);
    } catch (caught) {
      setToast({ type: "error", message: formError.fromException("save", caught).message });
      setSubmitting(false);
    }
  };

  const cancelConfirm = useConfirmAction({
    onConfirm: () => {
      router.push("/estab/list");
    },
  });

  const onCancel = (e: React.MouseEvent) => {
    e.preventDefault();
    if (dirty && !created) {
      cancelConfirm.trigger();
    } else {
      router.push("/estab/list");
    }
  };

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Create File"
        subtitle={
          <>
            Opens a new <Term name="eOffice" /> digital file with an initial
            yellow note.
          </>
        }
        back="/estab/list"
        help="estab"
      />

      {toast && (
        <div
          className="banner"
          ref={bannerRef}
          role={toast.type === "error" ? "alert" : "status"}
          aria-live={toast.type === "error" ? "assertive" : "polite"}
          tabIndex={-1}
          style={{
            background: toast.type === "success" ? "#ecfdf3" : "#fef2f2",
            border: `1px solid ${toast.type === "success" ? "#6ee7b7" : "#fca5a5"}`,
            color: toast.type === "success" ? "#065f46" : "#991b1b",
            borderRadius: 12,
            padding: "13px 16px",
            marginBottom: 18,
            fontSize: 13,
          }}
        >
          {toast.message}
        </div>
      )}

      <div className="card">
        <div className="card-h">
          <h3>File details</h3>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="fields">
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="subject" className="l">
                Subject <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                id="subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="dakNo" className="l">
                Linked <Term name="DAK" /> No (optional)
              </label>
              <input
                id="dakNo"
                type="text"
                list="dak-options"
                value={dakNo}
                onChange={(e) => setDakNo(e.target.value)}
                placeholder="DAK/2026/001"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
              <datalist id="dak-options">
                {dakOptions.map((d) => (
                  <option key={d.id} value={d.dakNo} />
                ))}
              </datalist>
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="parentFileId" className="l">
                Parent file (part-file, optional)
              </label>
              <input
                id="parentFileId"
                type="text"
                value={parentFileId ? `${parentResults.find((r) => r.id === parentFileId)?.fileNo ?? ""} — selected` : parentQuery}
                onChange={(e) => {
                  setParentFileId("");
                  setParentQuery(e.target.value);
                }}
                placeholder="Search by subject or file no…"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
              {parentResults.length > 0 && !parentFileId && (
                <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none", maxHeight: 150, overflow: "auto", fontSize: 13, background: "var(--surface, #fff)", border: "1px solid var(--line)", borderRadius: 6 }}>
                  {parentResults.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => { setParentFileId(r.id); setParentQuery(r.fileNo); setParentResults([]); }}
                        style={{ display: "block", width: "100%", textAlign: "start", padding: "6px 10px", border: "none", background: "transparent", cursor: "pointer", font: "inherit" }}
                      >
                        {r.fileNo} — {r.subject}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {parentFileId && (
                <span className="sub" style={{ fontSize: 12 }}>Selected: {parentResults.find((r) => r.id === parentFileId)?.fileNo ?? parentFileId.slice(0, 8)}</span>
              )}
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="classification" className="l">
                Classification
              </label>
              <select
                id="classification"
                value={classification}
                onChange={(e) => setClassification(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                {CLASSIFICATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="department" className="l">
                Department
              </label>
              {divisions.length > 0 ? (
                <select
                  id="department"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                >
                  {divisions.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="department"
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                />
              )}
            </div>
            <div
              className="fld"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
              }}
            >
              <label htmlFor="initialNote" className="l">
                Initial yellow note
              </label>
              <textarea
                id="initialNote"
                value={initialNote}
                onChange={(e) => setInitialNote(e.target.value)}
                rows={4}
                placeholder="Opening yellow note on note sheet"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #fde047",
                  borderRadius: 8,
                  fontSize: 13,
                  background: "#fefce8",
                  resize: "vertical",
                }}
              />
            </div>
          </div>
          <div
            className="pad"
            style={{
              borderTop: "1px solid var(--line)",
              display: "flex",
              gap: 8,
            }}
          >
            <Button type="submit" disabled={submitting || created}>
              {submitting ? "Creating…" : created ? "Created" : "Create File"}
            </Button>
            <a href="/estab/list" className="btn ghost" onClick={onCancel}>
              Cancel
            </a>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={cancelConfirm.open}
        title="Discard this file?"
        description="You have unsaved details on this form. Leaving now discards the subject and opening note — nothing will be saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger
        busy={cancelConfirm.busy}
        errorMessage={cancelConfirm.error}
        onConfirm={cancelConfirm.confirm}
        onCancel={cancelConfirm.cancel}
      />
    </div>
  );
}
