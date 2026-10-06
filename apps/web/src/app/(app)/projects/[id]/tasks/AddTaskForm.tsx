"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

type Props = { projectId: string };

// GAP-PROJECTS-DETAIL-TASKS-01: zod at the boundary, mirroring project-service
// createTaskBody (name 1..255, weight 0..100, optional planned dates).
const addTaskSchema = z.object({
  name: z.string().min(1, "Task name is required").max(255),
  weightPct: z.number().min(0).max(100),
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
});

export function AddTaskForm({ projectId }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [weightPct, setWeightPct] = useState("0");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("task");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = addTaskSchema.safeParse({
      name: name.trim(),
      weightPct: Number(weightPct),
      plannedStart: plannedStart || undefined,
      plannedEnd: plannedEnd || undefined,
    });
    if (!parsed.success) {
      setStatus("error");
      setMessage(parsed.error.issues[0]?.message ?? "Please check the task details.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setStatus("success");
      setMessage("Task added. Reloading…");
      setName("");
      setWeightPct("0");
      setPlannedStart("");
      setPlannedEnd("");
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 240px" }}>
        <label className="label" htmlFor="task-name" style={{ fontSize: "0.82rem" }}>Task name</label>
        <input id="task-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} style={{ minHeight: 40 }} aria-required="true" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 120px" }}>
        <label className="label" htmlFor="task-weight" style={{ fontSize: "0.82rem" }}>Weight %</label>
        <input id="task-weight" className="inp" type="number" min={0} max={100} step="0.1" value={weightPct} onChange={(e) => setWeightPct(e.target.value)} style={{ minHeight: 40 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 160px" }}>
        <label className="label" htmlFor="task-start" style={{ fontSize: "0.82rem" }}>Planned start</label>
        <input id="task-start" className="inp" type="date" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} style={{ minHeight: 40 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 160px" }}>
        <label className="label" htmlFor="task-end" style={{ fontSize: "0.82rem" }}>Planned end</label>
        <input id="task-end" className="inp" type="date" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} style={{ minHeight: 40 }} />
      </div>
      <Button type="submit" variant="primary" disabled={status === "submitting"} style={{ minHeight: 40 }}>
        {status === "submitting" ? "Adding…" : "Add task"}
      </Button>
      {message && (
        <p
          role={status === "error" ? "alert" : "status"}
          aria-live="polite"
          style={{ width: "100%", margin: 0, fontSize: "0.875rem", color: status === "error" ? "var(--bad)" : "var(--good)" }}
        >
          {message}
        </p>
      )}
    </form>
  );
}
