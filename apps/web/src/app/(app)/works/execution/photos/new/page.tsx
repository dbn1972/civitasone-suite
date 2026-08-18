"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, Card, FileUpload } from "@/app/_components/ds";
import { useToast } from "@/app/_components/ds/Toast";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  minHeight: 44,
  borderRadius: 8,
  border: "1px solid var(--line)",
  boxSizing: "border-box",
  fontSize: 14,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
  fontWeight: 600,
};

function PhotoForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const prefillWorkId = searchParams.get("workId") ?? "";

  const [workId, setWorkId]           = useState(prefillWorkId);
  const [fileKey, setFileKey]         = useState("");
  const [description, setDescription] = useState("");
  const [latitude, setLatitude]       = useState("");
  const [longitude, setLongitude]     = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!workId.trim()) { setError("Work ID is required."); return; }
    if (!fileKey.trim()) { setError("Please upload a photo first."); return; }

    setSubmitting(true);

    const body: Record<string, unknown> = {
      workId: workId.trim(),
      fileKey: fileKey.trim(),
      source: "web",
    };
    if (description.trim()) body.description = description.trim();
    if (latitude)  body.latitude  = parseFloat(latitude);
    if (longitude) body.longitude = parseFloat(longitude);

    try {
      const res = await fetch("/api/proxy/v1/works/execution/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { message?: string }).message ?? "Failed to register photo.");
        setSubmitting(false);
        return;
      }

      toast.success("Photo registered.");
      setTimeout(() => {
        router.push(
          workId.trim()
            ? `/works/execution/${workId.trim()}`
            : "/works/execution",
        );
      }, 600);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error.");
      setSubmitting(false);
    }
  }

  const backHref = prefillWorkId
    ? `/works/execution/${prefillWorkId}`
    : "/works/execution";

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Card style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        {error && (
          <div
            style={{
              background: "#fef2f2",
              color: "#b42318",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 14,
            }}
            role="alert"
          >
            {error}
          </div>
        )}

        <div>
          <label style={labelStyle} htmlFor="workId">
            Work ID <span style={{ color: "#b42318" }}>*</span>
          </label>
          <input
            id="workId"
            type="text"
            style={inputStyle}
            value={workId}
            onChange={(e) => setWorkId(e.target.value)}
            placeholder="UUID of the execution record"
            required
          />
        </div>

        {/* F2 — replaced raw fileKey text input with presigned FileUpload */}
        <div>
          <p style={{ ...labelStyle, marginBottom: 8 }}>
            Site Photo <span style={{ color: "#b42318" }}>*</span>
          </p>
          <FileUpload
            category="photo"
            label="Choose photo to upload"
            accept="image/*"
            maxSizeMb={20}
            onUploaded={(key) => setFileKey(key)}
          />
          {fileKey && (
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
              ✓ File key: <code style={{ fontSize: 11 }}>{fileKey}</code>
            </p>
          )}
        </div>

        <div>
          <label style={labelStyle} htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 2048))}
            maxLength={2048}
            placeholder="Caption or site observation notes"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={labelStyle} htmlFor="latitude">Latitude</label>
            <input
              id="latitude"
              type="number"
              style={inputStyle}
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              step={0.000001}
              placeholder="e.g. 28.6139 (optional)"
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="longitude">Longitude</label>
            <input
              id="longitude"
              type="number"
              style={inputStyle}
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              step={0.000001}
              placeholder="e.g. 77.2090 (optional)"
            />
          </div>
        </div>

        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
          GPS coordinates are optional but help verify on-site photo authenticity.
        </p>

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <a
            href={backHref}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              color: "var(--ink)",
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              fontWeight: 600,
              fontSize: 14,
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Registering…" : "Register Photo"}
          </button>
        </div>
      </Card>
    </form>
  );
}

export default function PhotoNewPage() {
  return (
    <>
      <PageHeader
        title="Register Site Photo"
        subtitle="Upload a photo and attach it to an execution record."
        back="/works/execution"
        backLabel="Execution"
      />
      <Suspense fallback={<div style={{ padding: 24, color: "var(--muted)" }}>Loading…</div>}>
        <PhotoForm />
      </Suspense>
    </>
  );
}
