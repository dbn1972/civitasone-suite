"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Button, EntityPicker, Field } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { searchDirectoryUsers, resolveDirectoryUsers } from "@/lib/directory/searchUsers";

type Props = { projectId: string };

const ROLES = ["project_manager", "project_officer", "engineer", "finance_officer", "viewer"] as const;

// GAP-PROJECTS-DETAIL-MEMBERS-01 (fix step 4): zod uuid guard at the boundary so
// a selection without a valid id (empty, or a stale/bad value) is caught here
// with a clear message instead of round-tripping to a raw server validation
// error. The EntityPicker already yields a real directory id on selection; this
// is defence in depth.
const userIdSchema = z.string().uuid();

export function AddMemberForm({ projectId }: Props) {
  const router = useRouter();
  const [userId, setUserId]   = useState<string | null>(null);
  const [role, setRole]       = useState<typeof ROLES[number]>("viewer");
  const [status, setStatus]   = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("project member");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !userIdSchema.safeParse(userId.trim()).success) {
      setStatus("error");
      setMessage("Search for and select a person to add.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/projects/${projectId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), role }),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setStatus("success");
      setMessage("Member added. Reloading…");
      setUserId(null);
      setRole("viewer");
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 260px" }}>
        {/* GAP-PROJECTS-DETAIL-MEMBERS-01: searchable person picker (by name) via the
            shared tenant-scoped user directory, replacing the raw UUID paste box. */}
        <Field label="Member" id="member">
          <EntityPicker
            value={userId}
            onChange={(v) => setUserId(Array.isArray(v) ? (v[0] ?? null) : v)}
            search={searchDirectoryUsers}
            resolve={resolveDirectoryUsers}
            minQueryLength={2}
            placeholder="Search people by name…"
          />
        </Field>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 180px" }}>
        <label className="label" htmlFor="role" style={{ fontSize: "0.82rem" }}>Role</label>
        <select
          id="role"
          className="inp"
          value={role}
          onChange={(e) => setRole(e.target.value as typeof ROLES[number])}
          style={{ minHeight: 40 }}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>
      <Button
        type="submit"
        variant="primary"
        disabled={status === "submitting"}
        style={{ minHeight: 40 }}
      >
        {status === "submitting" ? "Adding…" : "Add Member"}
      </Button>
      {message && (
        <p
          role={status === "error" ? "alert" : "status"}
          aria-live="polite"
          style={{
            width: "100%",
            margin: 0,
            fontSize: "0.875rem",
            color: status === "error" ? "var(--bad)" : "var(--good)",
          }}
        >
          {message}
        </p>
      )}
    </form>
  );
}
