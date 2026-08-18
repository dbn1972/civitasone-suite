"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, useToast, Card } from "@/app/_components/ds";

interface ExecutionActionsProps {
  workId: string;
}

type ClosureType = "closed" | "dropped" | "completion";

export function ExecutionActions({ workId }: ExecutionActionsProps) {
  const router = useRouter();
  const { toast } = useToast();

  // ── Physical Completion Certificate ────────────────────────────────────────
  const [completionDate, setCompletionDate] = useState("");
  const [physDialog, setPhysDialog] = useState(false);
  const [physBusy, setPhysBusy] = useState(false);
  const [physError, setPhysError] = useState("");

  async function handlePhysicalComplete() {
    setPhysBusy(true);
    setPhysError("");
    try {
      const body: Record<string, unknown> = { workId };
      if (completionDate) body.completionDate = completionDate;
      const res = await fetch("/api/proxy/v1/works/execution/physical-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setPhysError(await res.text().catch(() => "Request failed"));
        return;
      }
      toast.success("Work physically marked as complete.");
      setPhysDialog(false);
      setTimeout(() => router.refresh(), 600);
    } catch {
      setPhysError("Network error. Please try again.");
    } finally {
      setPhysBusy(false);
    }
  }

  // ── Work Closure ───────────────────────────────────────────────────────────
  const [closureType, setClosureType] = useState<ClosureType>("completion");
  const [closureDialog, setClosureDialog] = useState(false);
  const [closureBusy, setClosureBusy] = useState(false);
  const [closureError, setClosureError] = useState("");

  async function handleClosure() {
    setClosureBusy(true);
    setClosureError("");
    try {
      const res = await fetch("/api/proxy/v1/works/execution/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId, closureType }),
      });
      if (!res.ok) {
        setClosureError(await res.text().catch(() => "Request failed"));
        return;
      }
      toast.success(`Work closed (${closureType}).`);
      setClosureDialog(false);
      setTimeout(() => router.refresh(), 600);
    } catch {
      setClosureError("Network error. Please try again.");
    } finally {
      setClosureBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
      {/* ── Physical Completion Certificate ─────────────────────────────────── */}
      <Card title="Physical Completion Certificate">
        <div
          style={{
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              alignItems: "end",
              maxWidth: 560,
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--ink3)",
                  marginBottom: 4,
                }}
              >
                Completion Date (optional)
              </label>
              <input
                type="date"
                className="input"
                value={completionDate}
                onChange={(e) => setCompletionDate(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => setPhysDialog(true)}
              className="btn primary"
              style={{ minHeight: 36 }}
            >
              Mark Complete
            </button>
          </div>
          {physError && (
            <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{physError}</p>
          )}
        </div>
      </Card>

      {/* ── Work Closure ────────────────────────────────────────────────────── */}
      <Card title="Work Closure">
        <div
          style={{
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              alignItems: "end",
              maxWidth: 560,
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--ink3)",
                  marginBottom: 4,
                }}
              >
                Closure Type
              </label>
              <select
                className="input"
                value={closureType}
                onChange={(e) => setClosureType(e.target.value as ClosureType)}
              >
                <option value="completion">Completion</option>
                <option value="closed">Closed</option>
                <option value="dropped">Dropped</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => setClosureDialog(true)}
              className="btn primary"
              style={{ minHeight: 36 }}
            >
              Close Work
            </button>
          </div>
          {closureError && (
            <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{closureError}</p>
          )}
        </div>
      </Card>

      {/* Dialogs */}
      <ConfirmDialog
        open={physDialog}
        title="Mark Work as Physically Complete"
        description={`This will record physical completion${
          completionDate ? ` on ${completionDate}` : ""
        }. This action cannot be undone.`}
        confirmLabel="Mark Complete"
        busy={physBusy}
        errorMessage={physError || undefined}
        onConfirm={handlePhysicalComplete}
        onCancel={() => {
          setPhysDialog(false);
          setPhysError("");
        }}
      />
      <ConfirmDialog
        open={closureDialog}
        title="Close Work"
        description={`This will permanently close this work as "${closureType}". This action cannot be undone.`}
        confirmLabel="Close Work"
        danger
        busy={closureBusy}
        errorMessage={closureError || undefined}
        onConfirm={handleClosure}
        onCancel={() => {
          setClosureDialog(false);
          setClosureError("");
        }}
      />
    </div>
  );
}
