"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/app/_components/ds";
import { useToast } from "@/app/_components/ds/Toast";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  minHeight: 44,
  borderRadius: 8,
  border: "1px solid var(--line)",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
  fontWeight: 600,
};

function RaiseIssueForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const initialWorkId = searchParams.get("workId") ?? "";

  const [workId, setWorkId] = useState(initialWorkId);
  const [issueTypeId, setIssueTypeId] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const body: Record<string, string> = { workId, description };
      if (issueTypeId.trim()) body.issueTypeId = issueTypeId.trim();

      const res = await fetch("/api/proxy/v1/works/execution/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { message?: string })?.message ?? `Error ${res.status}`
        );
      }

      toast.success("Issue raised.");
      setTimeout(() => router.push(`/works/execution/${workId}`), 600);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 20 }}
    >
      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(220,38,38,0.08)",
            border: "1px solid rgba(220,38,38,0.3)",
            color: "var(--ink)",
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      <div>
        <label style={labelStyle} htmlFor="workId">
          Work ID *
        </label>
        <input
          id="workId"
          style={inputStyle}
          type="text"
          required
          value={workId}
          onChange={(e) => setWorkId(e.target.value)}
          placeholder="UUID of the work"
        />
      </div>

      <div>
        <label style={labelStyle} htmlFor="issueTypeId">
          Issue Type ID
        </label>
        <input
          id="issueTypeId"
          style={inputStyle}
          type="text"
          value={issueTypeId}
          onChange={(e) => setIssueTypeId(e.target.value)}
          placeholder="Issue type UUID (optional)"
        />
      </div>

      <div>
        <label style={labelStyle} htmlFor="description">
          Description *
        </label>
        <textarea
          id="description"
          style={{ ...inputStyle, minHeight: 100, resize: "vertical" }}
          required
          maxLength={2048}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the issue in detail"
        />
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            marginTop: 4,
            textAlign: "right",
          }}
        >
          {description.length}/2048
        </div>
      </div>

      <div>
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "10px 24px",
            borderRadius: 8,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Raising..." : "Raise Issue"}
        </button>
      </div>
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
        <Suspense fallback={<div>Loading...</div>}>
          <RaiseIssueForm />
        </Suspense>
      </div>
    </>
  );
}
