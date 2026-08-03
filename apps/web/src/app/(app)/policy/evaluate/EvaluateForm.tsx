"use client";

import { useState } from "react";

type Decision = {
  decision?: string;
  reason?: string;
  matchedRuleId?: string | null;
};

const EVALUATE_API = "/api/v1/policy/evaluate";

/**
 * Client form — POST via Next proxy to gateway /api/v1/policy/evaluate.
 * Principal is derived server-side from the JWT; only permissionKey (+ optional resource) is sent.
 */
export function EvaluateForm() {
  const [permissionKey, setPermissionKey] = useState("finance.journal.create");
  const [resourceJson, setResourceJson] = useState("{}");
  const [status, setStatus] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [result, setResult] = useState<Decision | null>(null);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("pending");
    setError("");
    setResult(null);

    let resource: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(resourceJson || "{}") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        resource = parsed as Record<string, unknown>;
      } else {
        setStatus("error");
        setError("Resource must be a JSON object");
        return;
      }
    } catch {
      setStatus("error");
      setError("Invalid JSON in resource field");
      return;
    }

    try {
      const res = await fetch(`/api/proxy${EVALUATE_API.replace(/^\/api/, "")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permissionKey, resource }),
      });
      const body = (await res.json().catch(() => ({}))) as Decision & { message?: string };
      if (!res.ok) {
        setStatus("error");
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setStatus("ok");
      setResult(body);
    } catch {
      setStatus("error");
      setError("Network error");
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, maxWidth: 640 }}>
      <label>
        <span>Permission key</span>
        <input
          required
          value={permissionKey}
          onChange={(e) => setPermissionKey(e.target.value)}
          placeholder="service.resource.action"
          minLength={3}
        />
      </label>
      <label>
        <span>Resource attributes (JSON)</span>
        <textarea
          value={resourceJson}
          onChange={(e) => setResourceJson(e.target.value)}
          rows={4}
          spellCheck={false}
          style={{ fontFamily: "ui-monospace, monospace" }}
        />
      </label>
      <button type="submit" disabled={status === "pending"}>
        {status === "pending" ? "Evaluating…" : "Evaluate"}
      </button>

      {error && (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      )}

      {result && (
        <div role="status" aria-live="polite" className="card" style={{ padding: 12 }}>
          <p>
            <strong>Decision:</strong> {result.decision ?? "—"}
          </p>
          <p>
            <strong>Reason:</strong> {result.reason ?? "—"}
          </p>
          {result.matchedRuleId != null && result.matchedRuleId !== "" && (
            <p>
              <strong>Matched rule:</strong> <code>{result.matchedRuleId}</code>
            </p>
          )}
        </div>
      )}
    </form>
  );
}
