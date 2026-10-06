"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

type Props = { projectId: string };

const ROLES = ["project_manager", "project_officer", "engineer", "finance_officer", "viewer"] as const;

// GAP-PROJECTS-DETAIL-MEMBERS-01 (fix step 4): zod uuid guard at the boundary so
// a non-UUID (e.g. a pasted name or truncated id) is caught here with a clear
// message instead of round-tripping to a raw server validation error.
const userIdSchema = z.string().uuid();

export function AddMemberForm({ projectId }: Props) {
  const router = useRouter();
  const [userId, setUserId]   = useState("");
  const [role, setRole]       = useState<typeof ROLES[number]>("viewer");
  const [status, setStatus]   = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("project member");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userIdSchema.safeParse(userId.trim()).success) {
      setStatus("error");
      setMessage("Enter a valid User ID (UUID).");
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
      setUserId("");
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
        <label className="label" htmlFor="userId" style={{ fontSize: "0.82rem" }}>User ID (UUID)</label>
        <input
          id="userId"
          className="inp"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          style={{ minHeight: 40 }}
          aria-required="true"
        />
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
