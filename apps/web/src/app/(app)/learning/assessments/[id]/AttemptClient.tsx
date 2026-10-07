"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { Button } from "@/app/_components/ds";

export interface LearnerQuestion {
  id: string;
  qtype: string;
  stem: string;
  options: Array<{ id: string; text: string }>;
}

export interface AttemptClientProps {
  assessmentId: string;
  /** The viewer's own hrms_employees.id (server force-scopes non-HR anyway). */
  employeeId: string;
  questions: LearnerQuestion[];
}

type Phase = "ready" | "starting" | "answering" | "submitting" | "done";

interface Result {
  score: number;
  passed: boolean;
}

/**
 * GAP-LEARNING-ASSESSMENTS-01: starts an attempt (POST /attempts), renders the
 * answer-key-stripped questions, then submits (POST /attempts/:id/submit) and
 * shows the score + pass/fail. The attempt-limit error (409 ATTEMPT_LIMIT) is
 * surfaced via useFormError so the learner sees an honest message, not a raw
 * code.
 */
export function AttemptClient({ assessmentId, employeeId, questions }: AttemptClientProps) {
  const router = useRouter();
  const formError = useFormError("assessment attempt");
  const [phase, setPhase] = useState<Phase>("ready");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<Result | null>(null);

  function toggleAnswer(questionId: string, optionId: string, multi: boolean) {
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      if (multi) {
        const next = current.includes(optionId)
          ? current.filter((o) => o !== optionId)
          : [...current, optionId];
        return { ...prev, [questionId]: next };
      }
      return { ...prev, [questionId]: [optionId] };
    });
  }

  async function handleStart() {
    setPhase("starting");
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/hrms/assessments/${assessmentId}/attempts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      if (!res.ok) {
        await formError.fromResponse(res, "save");
        setPhase("ready");
        return;
      }
      const body = (await res.json()) as { id: string };
      setAttemptId(body.id);
      setPhase("answering");
    } catch (caught) {
      formError.fromException("save", caught);
      setPhase("ready");
    }
  }

  async function handleSubmit() {
    if (!attemptId) return;
    setPhase("submitting");
    formError.clear();
    try {
      const payload = {
        answers: questions.map((q) => ({ questionId: q.id, response: answers[q.id] ?? [] })),
      };
      const res = await fetch(`/api/proxy/v1/hrms/attempts/${attemptId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        await formError.fromResponse(res, "save");
        setPhase("answering");
        return;
      }
      const body = (await res.json()) as { score: number; passed: boolean };
      setResult({ score: body.score, passed: body.passed });
      setPhase("done");
      router.refresh();
    } catch (caught) {
      formError.fromException("save", caught);
      setPhase("answering");
    }
  }

  if (phase === "done" && result) {
    return (
      <div style={{ padding: 16 }} role="status">
        <p style={{ fontSize: 18, fontWeight: 600 }}>
          {result.passed ? "✅ Passed" : "❌ Not passed"}
        </p>
        <p>Your score: <strong>{result.score}</strong></p>
        <p style={{ marginTop: 12 }}>
          <Button variant="secondary" onClick={() => router.push("/learning/assessments")}>Back to assessments</Button>
        </p>
      </div>
    );
  }

  if (phase === "ready" || phase === "starting") {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ marginBottom: 12 }}>This assessment has {questions.length} question(s). Click start to begin your attempt.</p>
        <Button variant="primary" onClick={handleStart} disabled={phase === "starting"} aria-busy={phase === "starting"}>
          {phase === "starting" ? "Starting…" : "Start attempt"}
        </Button>
        {formError.message && (
          <p role="alert" aria-live="assertive" style={{ color: "var(--bad, #dc2626)", marginTop: 8 }}>{formError.message}</p>
        )}
      </div>
    );
  }

  // answering / submitting
  return (
    <div style={{ padding: 16 }}>
      <ol style={{ display: "flex", flexDirection: "column", gap: 20, paddingInlineStart: 20 }}>
        {questions.map((q) => {
          const multi = q.qtype === "multi";
          return (
            <li key={q.id}>
              <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                <legend style={{ fontWeight: 600, marginBottom: 8 }}>{q.stem}</legend>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {q.options.map((o) => {
                    const selected = (answers[q.id] ?? []).includes(o.id);
                    return (
                      <label key={o.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type={multi ? "checkbox" : "radio"}
                          name={q.id}
                          value={o.id}
                          checked={selected}
                          onChange={() => toggleAnswer(q.id, o.id, multi)}
                        />
                        <span>{o.text}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>
      <div style={{ marginTop: 20 }}>
        <Button variant="primary" onClick={handleSubmit} disabled={phase === "submitting"} aria-busy={phase === "submitting"}>
          {phase === "submitting" ? "Submitting…" : "Submit attempt"}
        </Button>
        {formError.message && (
          <p role="alert" aria-live="assertive" style={{ color: "var(--bad, #dc2626)", marginTop: 8 }}>{formError.message}</p>
        )}
      </div>
    </div>
  );
}
