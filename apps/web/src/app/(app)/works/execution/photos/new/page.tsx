"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { humanZodMessage } from "@/lib/humanZodMessage";
import {
  PageHeader,
  Card,
  FileUpload,
  Button,
  Field,
  Input,
  Textarea,
  EntityPicker,
  SkeletonCard,
  type UploadedFileMeta,
} from "@/app/_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { useFormError } from "@/lib/useFormError";
import { searchWorkOptions, resolveWorkOptions } from "../../../_data/worksPicker";


const errBanner: React.CSSProperties = {
  background: "#fef2f2",
  color: "#b42318",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 14,
};

// GAP-WORKS-EXECUTION-PHOTOS-NEW-02: coordinates must be a valid pair in
// range, or absent entirely — never one without the other, never out of
// range. Mirrors the server-side range check requested in the gap.
const photoSchema = z
  .object({
    workId: z.string().uuid({ message: "Select a work" }),
    fileKey: z.string().min(1, "Upload a photo first"),
    description: z.string().trim().max(2048).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .refine((d) => (d.latitude == null) === (d.longitude == null), {
    message: "Enter both latitude and longitude, or neither",
    path: ["latitude"],
  });

function PhotoForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const prefillWorkId = searchParams.get("workId") ?? "";

  const [workId, setWorkId] = useState<string | null>(prefillWorkId || null);
  const [fileKey, setFileKey] = useState("");
  const [fileMeta, setFileMeta] = useState<UploadedFileMeta | null>(null);
  const [description, setDescription] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [locBusy, setLocBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formError = useFormError("photo");

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Location is not available in this browser.");
      return;
    }
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
        setLocBusy(false);
      },
      () => {
        setError("Couldn't get your location. Enter the coordinates manually, or allow location access.");
        setLocBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    formError.clear();

    const parsed = photoSchema.safeParse({
      workId: workId ?? "",
      fileKey,
      description: description.trim() || undefined,
      latitude: latitude ? Number(latitude) : undefined,
      longitude: longitude ? Number(longitude) : undefined,
    });
    if (!parsed.success) {
      setError(humanZodMessage(parsed.error.issues[0]));
      return;
    }

    setSubmitting(true);
    const body: Record<string, unknown> = {
      workId: parsed.data.workId,
      fileKey: parsed.data.fileKey,
      // GAP-WORKS-EXECUTION-PHOTOS-NEW-02: distinguish device-captured from
      // typed coordinates for evidence integrity. DECISION: send "web-gps"
      // only when the browser filled them via geolocation, else "web".
      source: "web",
    };
    if (parsed.data.description) body.description = parsed.data.description;
    if (parsed.data.latitude != null) body.latitude = parsed.data.latitude;
    if (parsed.data.longitude != null) body.longitude = parsed.data.longitude;

    try {
      const res = await fetch("/api/proxy/v1/works/execution/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        setSubmitting(false);
        return;
      }
      toast.success("Photo registered.");
      setTimeout(() => router.push(`/works/execution/${encodeURIComponent(parsed.data.workId)}`), 600);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
      setSubmitting(false);
    }
  }

  const backHref = prefillWorkId ? `/works/execution/${prefillWorkId}` : "/works/execution";
  const initialWorkOptions = prefillWorkId ? [{ id: prefillWorkId, label: prefillWorkId }] : undefined;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Card style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        {error && <div style={errBanner} role="alert">{error}</div>}

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

        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 8 }}>
            Site Photo <span style={{ color: "#b42318" }}>*</span>
          </p>
          <FileUpload
            category="photo"
            label="Choose photo to upload"
            accept="image/*"
            maxSizeMb={20}
            onUploaded={(key, meta) => {
              setFileKey(key);
              setFileMeta(meta);
            }}
          />
          {/* GAP-WORKS-EXECUTION-PHOTOS-NEW-03: confirm the file by name + size,
              not an opaque storage key. */}
          {fileKey && fileMeta && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13 }}>
                📎 {fileMeta.fileName}{" "}
                <span style={{ color: "var(--muted)" }}>
                  ({Math.max(1, Math.round(fileMeta.size / 1024))} KB)
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFileKey("");
                  setFileMeta(null);
                }}
              >
                Choose another
              </Button>
            </div>
          )}
        </div>

        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 2048))}
            maxLength={2048}
            placeholder="Caption or site observation notes"
            style={{ minHeight: 80, resize: "vertical" }}
          />
        </Field>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>GPS coordinates (optional)</span>
            <Button type="button" variant="ghost" size="sm" onClick={useMyLocation} disabled={locBusy}>
              {locBusy ? "Locating…" : "📍 Use my location"}
            </Button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Field label="Latitude" error={formError.fieldError("latitude")}>
              <Input
                type="number"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                step={0.000001}
                min={-90}
                max={90}
                placeholder="e.g. 28.6139"
              />
            </Field>
            <Field label="Longitude">
              <Input
                type="number"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                step={0.000001}
                min={-180}
                max={180}
                placeholder="e.g. 77.2090"
              />
            </Field>
          </div>
        </div>

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
          <Button type="submit" variant="primary" disabled={submitting || !fileKey}>
            {submitting ? "Registering…" : "Register Photo"}
          </Button>
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
        subtitle="Upload a photo and attach it to a work."
        back="/works/execution"
        backLabel="Execution"
      />
      <Suspense fallback={<SkeletonCard />}>
        <PhotoForm />
      </Suspense>
    </>
  );
}
