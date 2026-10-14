"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { humanZodMessage } from "@/lib/humanZodMessage";
import {
  PageHeader,
  Button,
  Field,
  Textarea,
  FileUpload,
  EntityPicker,
  ConfirmDialog,
  SkeletonCard,
  type EntityOption,
  type UploadedFileMeta,
} from "@/app/_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { useFormError } from "@/lib/useFormError";
import { browserFetch } from "@/lib/api/browserClient";
import { searchWorkOptions, resolveWorkOptions } from "../../../_data/worksPicker";


const errBanner: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  background: "rgba(220,38,38,0.08)",
  border: "1px solid rgba(220,38,38,0.3)",
  color: "var(--ink)",
  fontSize: 14,
};

// GAP-WORKS-EXECUTION-ISSUES-NEW-01: pick a work and an issue type by name,
// never by hand-typed UUID. Reuses the shared searchWorks/resolveWorks
// adapters; issue types come from the works masters catalogue.
async function searchIssueTypes(query: string, signal: AbortSignal): Promise<EntityOption[]> {
  const res = await browserFetch("v1/works/masters/issue-types?pageSize=100", { signal });
  if (!res.ok) return [];
  const out = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const q = query.trim().toLowerCase();
  return (out.data ?? [])
    .map((r) => ({ id: String(r.id ?? ""), label: String(r.name ?? r.code ?? r.id ?? "") }))
    .filter((o) => o.id && (q === "" || o.label.toLowerCase().includes(q)));
}

// GAP-WORKS-EXECUTION-ISSUES-NEW-03: validate before posting; a bad id never
// reaches the server, and the redirect only ever uses a real UUID.
const raiseIssueSchema = z.object({
  workId: z.string().uuid({ message: "Select a work" }),
  issueTypeId: z.string().uuid().optional(),
  description: z.string().trim().min(1, "Describe the issue").max(2048),
});

function RaiseIssueForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const initialWorkId = searchParams.get("workId") ?? "";

  const [workId, setWorkId] = useState<string | null>(initialWorkId || null);
  const [issueTypeId, setIssueTypeId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  // GAP-WORKS-EXECUTION-ISSUES-NEW-05: optional supporting photo/document (the backend already stores attachmentKey).
  const [attachmentKey, setAttachmentKey] = useState("");
  const [attachmentMeta, setAttachmentMeta] = useState<UploadedFileMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const formError = useFormError("issue");

  // GAP-WORKS-EXECUTION-ISSUES-NEW-02: a dirty form warns before an
  // accidental navigation / tab close; the back target follows ?workId=.
  const dirty = useMemo(
    () => description.trim().length > 0 || !!issueTypeId || !!attachmentKey || (workId ?? "") !== initialWorkId,
    [description, issueTypeId, attachmentKey, workId, initialWorkId],
  );
  const backHref = initialWorkId ? `/works/execution/${initialWorkId}` : "/works/execution";

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const initialWorkOptions = initialWorkId ? [{ id: initialWorkId, label: initialWorkId }] : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    formError.clear();

    const parsed = raiseIssueSchema.safeParse({
      workId: workId ?? "",
      issueTypeId: issueTypeId ?? undefined,
      description,
    });
    if (!parsed.success) {
      setError(humanZodMessage(parsed.error.issues[0]));
      return;
    }

    setBusy(true);
    try {
      const body: Record<string, string> = {
        workId: parsed.data.workId,
        description: parsed.data.description,
      };
      if (parsed.data.issueTypeId) body.issueTypeId = parsed.data.issueTypeId;
      if (attachmentKey) body.attachmentKey = attachmentKey;

      const res = await fetch("/api/proxy/v1/works/execution/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        setBusy(false);
        return;
      }

      toast.success("Issue raised.");
      setTimeout(() => router.push(`/works/execution/${encodeURIComponent(parsed.data.workId)}`), 600);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
      setBusy(false);
    }
  }

  function onCancel() {
    if (dirty) setCancelOpen(true);
    else router.push(backHref);
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 20 }}
    >
      {error && <div role="alert" style={errBanner}>{error}</div>}

      <Field label="Work" required error={formError.fieldError("workId")}>
        <EntityPicker
          value={workId}
          onChange={(v) => setWorkId(Array.isArray(v) ? (v[0] ?? null) : v)}
          search={searchWorkOptions}
          resolve={resolveWorkOptions}
          initialOptions={initialWorkOptions}
          placeholder="Search by work number or description…"
        />
      </Field>

      <Field label="Issue Type" error={formError.fieldError("issueTypeId")}>
        <EntityPicker
          value={issueTypeId}
          onChange={(v) => setIssueTypeId(Array.isArray(v) ? (v[0] ?? null) : v)}
          search={searchIssueTypes}
          placeholder="Search issue types (optional)…"
        />
      </Field>

      <Field label="Description" required error={formError.fieldError("description")}>
        <Textarea
          required
          maxLength={2048}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the issue in detail"
          style={{ minHeight: 100, resize: "vertical" }}
        />
      </Field>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: -12, textAlign: "end" }}>
        {description.length}/2048
      </div>

      <div>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Attachment (optional)</p>
        <FileUpload
          category="attachment"
          label="Attach a photo or document"
          accept=".pdf,.jpg,.png"
          maxSizeMb={10}
          onUploaded={(key, meta) => {
            setAttachmentKey(key);
            setAttachmentMeta(meta);
          }}
        />
        {attachmentKey && attachmentMeta ? (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13 }}>
              📎 {attachmentMeta.fileName}{" "}
              <span style={{ color: "var(--muted)" }}>({Math.max(1, Math.round(attachmentMeta.size / 1024))} KB)</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAttachmentKey("");
                setAttachmentMeta(null);
              }}
            >
              Remove
            </Button>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Raising..." : "Raise Issue"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        title="Discard this issue?"
        description="You have unsaved changes. Leaving now will discard them."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger
        onConfirm={() => router.push(backHref)}
        onCancel={() => setCancelOpen(false)}
      />
    </form>
  );
}

export default function RaiseIssuePage() {
  return (
    <>
      <PageHeader
        title="Raise Issue"
        subtitle="Log a field issue against a work."
        back="/works/execution"
        backLabel="Execution"
      />
      <div style={{ padding: "24px 32px" }}>
        <Suspense fallback={<SkeletonCard />}>
          <RaiseIssueForm />
        </Suspense>
      </div>
    </>
  );
}
