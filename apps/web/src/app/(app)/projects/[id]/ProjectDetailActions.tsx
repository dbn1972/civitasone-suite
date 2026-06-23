"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Milestone = { id: string; title: string; status: string };

type Props = { projectId: string; milestones: Milestone[] };

export function ProjectDetailActions({ projectId, milestones }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const pending = milestones.filter((m) => m.status === "pending");

  async function completeMilestone(milestoneId: string) {
    setBusy(milestoneId);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/projects/${projectId}/milestones/${milestoneId}/complete`, {
        method: "PATCH",
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Milestone marked complete.");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  if (pending.length === 0) return message ? <p style={{ fontSize: 13, color: "#047857" }}>{message}</p> : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {pending.map((m) => (
        <button
          key={m.id}
          type="button"
          className="btn ghost"
          disabled={busy === m.id}
          onClick={() => void completeMilestone(m.id)}
        >
          {busy === m.id ? "Saving…" : `Complete: ${m.title}`}
        </button>
      ))}
      {message ? <p style={{ fontSize: 13, color: "#047857" }}>{message}</p> : null}
    </div>
  );
}
