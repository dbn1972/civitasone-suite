"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

type Props = { projectId: string };

const CATEGORIES = ["technical", "financial", "environmental", "social", "regulatory", "resource", "schedule"] as const;
const LEVELS = ["low", "medium", "high", "critical"] as const;

// GAP-PROJECTS-DETAIL-RISKS-01: zod at the boundary, mirroring project-service
// createRiskBody. The riskScore is computed server-side from probability×impact.
const addRiskSchema = z.object({
  title: z.string().min(1, "Risk title is required").max(256),
  category: z.enum(CATEGORIES),
  probability: z.enum(LEVELS),
  impact: z.enum(LEVELS),
  mitigationPlan: z.string().max(4000).optional(),
});

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function AddRiskForm({ projectId }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("technical");
  const [probability, setProbability] = useState<(typeof LEVELS)[number]>("medium");
  const [impact, setImpact] = useState<(typeof LEVELS)[number]>("medium");
  const [mitigationPlan, setMitigationPlan] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("risk");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = addRiskSchema.safeParse({
      title: title.trim(),
      category,
      probability,
      impact,
      mitigationPlan: mitigationPlan.trim() || undefined,
    });
    if (!parsed.success) {
      setStatus("error");
      setMessage(parsed.error.issues[0]?.message ?? "Please check the risk details.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/projects/${projectId}/risks`, {
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
      setMessage("Risk recorded. Reloading…");
      setTitle("");
      setCategory("technical");
      setProbability("medium");
      setImpact("medium");
      setMitigationPlan("");
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 220px" }}>
        <label className="label" htmlFor="risk-title" style={{ fontSize: "0.82rem" }}>Risk title</label>
        <input id="risk-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} style={{ minHeight: 40 }} aria-required="true" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 160px" }}>
        <label className="label" htmlFor="risk-category" style={{ fontSize: "0.82rem" }}>Category</label>
        <select id="risk-category" className="inp" value={category} onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])} style={{ minHeight: 40 }}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 140px" }}>
        <label className="label" htmlFor="risk-prob" style={{ fontSize: "0.82rem" }}>Probability</label>
        <select id="risk-prob" className="inp" value={probability} onChange={(e) => setProbability(e.target.value as (typeof LEVELS)[number])} style={{ minHeight: 40 }}>
          {LEVELS.map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 140px" }}>
        <label className="label" htmlFor="risk-impact" style={{ fontSize: "0.82rem" }}>Impact</label>
        <select id="risk-impact" className="inp" value={impact} onChange={(e) => setImpact(e.target.value as (typeof LEVELS)[number])} style={{ minHeight: 40 }}>
          {LEVELS.map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 100%" }}>
        <label className="label" htmlFor="risk-mitigation" style={{ fontSize: "0.82rem" }}>Mitigation plan (optional)</label>
        <input id="risk-mitigation" className="inp" value={mitigationPlan} onChange={(e) => setMitigationPlan(e.target.value)} style={{ minHeight: 40 }} />
      </div>
      <Button type="submit" variant="primary" disabled={status === "submitting"} style={{ minHeight: 40 }}>
        {status === "submitting" ? "Saving…" : "Add risk"}
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
