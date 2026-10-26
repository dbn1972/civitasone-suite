"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Select } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { KNOWLEDGE_CATEGORIES } from "../../_data/categories";

/**
 * GAP-KNOWLEDGE-DOCUMENTS-NEW-03: category is now a <Select> from a shared
 *   constant list, preventing typos that would fall out of repository segment
 *   filters.
 * GAP-KNOWLEDGE-DOCUMENTS-NEW-04: renamed "Publish document" to "Add document"
 *   because the create endpoint sets status="draft", not "published". The governed
 *   publish lifecycle is for policies (policies/[id]/PolicyActions).
 * GAP-KNOWLEDGE-DOCUMENTS-NEW-06: removed inline background:'var(--panel)' that broke
 *   dark mode. The .field class already sets background: var(--panel).
 */
/**
 * UAT owner decision #15 (GAP-KNOWLEDGE-DOCUMENTS-NEW-05): the create endpoint
 * answers 409 DUPLICATE_TITLE with a link to the existing document. Only an
 * internal knowledge-document path is ever rendered as a link.
 */
const EXISTING_DOC_HREF = /^\/knowledge\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readDuplicateTitle(res: Response): Promise<{ href: string | null } | null> {
  if (res.status !== 409) return null;
  try {
    const body = (await res.clone().json()) as { code?: unknown; existingDocumentHref?: unknown };
    if (body.code !== "DUPLICATE_TITLE") return null;
    const href = typeof body.existingDocumentHref === "string" && EXISTING_DOC_HREF.test(body.existingDocumentHref)
      ? body.existingDocumentHref
      : null;
    return { href };
  } catch {
    return null;
  }
}

export function CreateDocumentForm({
  defaultCategory = "",
  backHref = "/knowledge/repository",
  canSetRestricted = true,
}: {
  defaultCategory?: string;
  backHref?: string;
  /**
   * Restricted / confidential levels need knowledge-admin clearance. The
   * service rejects them for anyone else (403), so the form does not offer
   * them; the server remains the control.
   */
  canSetRestricted?: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("knowledgeDocumentsNew");
  const [existingHref, setExistingHref] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(defaultCategory);
  // GAP-KNOWLEDGE-DOCUMENTS-NEW-01: accessLevel select, defaults to least-privilege "internal"
  const [accessLevel, setAccessLevel] = useState<"public" | "internal" | "restricted" | "confidential">("internal");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("document");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 1) {
      setStatus("error");
      setMessage("Document title is required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    setDuplicate(false);
    setExistingHref(null);
    const body = {
      title: title.trim(),
      category: category.trim() || undefined,
      accessLevel,
    };
    try {
      const res = await fetch("/api/proxy/v1/knowledge/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const dup = await readDuplicateTitle(res);
        if (dup) {
          setStatus("error");
          setDuplicate(true);
          setExistingHref(dup.href);
          setMessage(t("duplicateTitle"));
          return;
        }
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      // GAP-KNOWLEDGE-DOCUMENTS-NEW-04: show saved-as-draft hint
      setStatus("success");
      setMessage("Document saved as draft.");
      router.push(backHref);
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card pad" style={{ maxWidth: 820 }} noValidate>
      <div className="fields">
        {/* GAP-KNOWLEDGE-DOCUMENTS-NEW-06: removed background:'var(--panel)' — .field already uses var(--panel) */}
        <div style={{ gridColumn: "1 / -1" }}>
          <Field
            label="Title"
            required
            error={status === "error" && !duplicate && !message.startsWith("Document") ? message : undefined}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              style={{ minHeight: 44 }}
              placeholder="e.g. Travel Policy 2024"
              maxLength={200}
            />
          </Field>
        </div>
        {/* GAP-KNOWLEDGE-DOCUMENTS-NEW-03: category select from shared constant list */}
        <Field label="Category">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ minHeight: 44 }}
          >
            <option value="">Select a category</option>
            {KNOWLEDGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        {/* GAP-KNOWLEDGE-DOCUMENTS-NEW-01: access level select, enforced server-side */}
        <Field label="Access level">
          <Select
            value={accessLevel}
            onChange={(e) => setAccessLevel(e.target.value as typeof accessLevel)}
            style={{ minHeight: 44 }}
          >
            <option value="public">Public</option>
            <option value="internal">Internal (default)</option>
            {canSetRestricted && <option value="restricted">Restricted</option>}
            {canSetRestricted && <option value="confidential">Confidential</option>}
          </Select>
        </Field>
      </div>

      {/* GAP-KNOWLEDGE-DOCUMENTS-NEW-01: file attachment is not yet supported.
          Attaching a file requires object-storage (S3/MinIO) upload wiring and a
          fileKey field on the create command, which is a larger backend change.
          Until then, documents are created as metadata-only draft records and
          this is stated honestly rather than implying a file was stored. Access level is enforced on the server. */}
      <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--mut)" }}>
        File attachments are not yet available here — this creates a draft document record. Access level is enforced on the server.
      </p>

      <div role="status" aria-live="polite">
        {message ? (
          <p role={status === "error" ? "alert" : undefined} style={{ marginTop: 12, color: status === "error" ? "var(--bad)" : "var(--good)", fontSize: "0.875rem" }}>
            {message}
          </p>
        ) : null}
        {duplicate && existingHref ? (
          <p style={{ marginTop: 4, fontSize: "0.875rem" }}>
            <Link href={existingHref}>{t("openExisting")}</Link>
          </p>
        ) : null}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        {/* GAP-KNOWLEDGE-DOCUMENTS-NEW-04: "Add document" (creates draft, not published) */}
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={status === "submitting"}>
          {status === "submitting" ? "Saving…" : "Add document"}
        </Button>
        <Link href={backHref} className="btn ghost" style={{ minHeight: 44 }}>Cancel</Link>
      </div>
    </form>
  );
}
