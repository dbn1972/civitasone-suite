"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormError } from "@/lib/useFormError";
import { StatusPill, EntityPicker, Field } from "@/app/_components/ds";
import { searchIdentityUsers, resolveIdentityUsers } from "@/lib/entityAdapters/identityUser";

type Decision = {
  decision?: string;
  reason?: string;
  matchedRuleId?: string | null;
  subjectUserId?: string | null;
};

const EVALUATE_API = "/api/v1/policy/evaluate";

/**
 * Client form — POST via Next proxy to gateway /api/v1/policy/evaluate.
 * Principal defaults to the caller (derived server-side from the JWT). An admin
 * may additionally evaluate on behalf of another user (GAP-POLICY-EVALUATE-01):
 * when `canEvaluateOthers` the "Evaluate as user" picker is shown and its id is
 * sent as subjectUserId (the server re-checks the admin role and audits it).
 */
export function EvaluateForm({ canEvaluateOthers = false }: { canEvaluateOthers?: boolean }) {
  const [permissionKey, setPermissionKey] = useState("finance.journal.create");
  const [resourceJson, setResourceJson] = useState("{}");
  const [subjectUserId, setSubjectUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [result, setResult] = useState<Decision | null>(null);
  const [resourceError, setResourceError] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("permission check");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("pending");
    setError("");
    setResourceError("");
    // GAP-POLICY-EVALUATE-04: keep the previous result visible (dimmed via
    // aria-busy below) until the new one arrives — don't blank it on submit.

    let resource: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(resourceJson || "{}") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        resource = parsed as Record<string, unknown>;
      } else {
        setStatus("error");
        setResourceError("Resource must be a JSON object");
        return;
      }
    } catch {
      setStatus("error");
      setResourceError("Invalid JSON in resource field");
      return;
    }

    try {
      const res = await fetch(`/api/proxy${EVALUATE_API.replace(/^\/api/, "")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          permissionKey,
          resource,
          ...(canEvaluateOthers && subjectUserId ? { subjectUserId } : {}),
        }),
      });
      if (!res.ok) {
        setStatus("error");
        // GAP-POLICY-EVALUATE-03: this is a read-only check, not a save.
        setError((await formError.fromResponse(res, "load")).message);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as Decision;
      setStatus("ok");
      setResult(body);
    } catch (caught) {
      setStatus("error");
      setError(formError.fromException("load", caught).message);
    }
  }

  const decision = result?.decision ?? "";
  const matchedRuleId = result?.matchedRuleId;

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, maxWidth: 640 }}>
      {canEvaluateOthers && (
        <Field label="Evaluate as user">
          <EntityPicker
            value={subjectUserId}
            onChange={(v) => setSubjectUserId(Array.isArray(v) ? (v[0] ?? null) : v)}
            search={searchIdentityUsers}
            resolve={resolveIdentityUsers}
            aria-label="Evaluate as user"
            placeholder="Me (default) — search to pick a user…"
          />
          <p style={{ fontSize: 12, color: "var(--mut, #64748b)", margin: "4px 0 0" }}>
            Leave empty to check your own permissions.
          </p>
        </Field>
      )}
      <Field label="Permission key">
        <input
          required
          value={permissionKey}
          onChange={(e) => setPermissionKey(e.target.value)}
          placeholder="service.resource.action"
          minLength={3}
          aria-describedby="eval-key-hint"
        />
        <p id="eval-key-hint" style={{ fontSize: 12, color: "var(--mut, #64748b)", margin: "4px 0 0" }}>
          Format: service.resource.action, e.g. finance.journal.create
        </p>
      </Field>
      <Field label="Resource attributes (JSON)" error={resourceError || undefined}>
        <textarea
          value={resourceJson}
          onChange={(e) => setResourceJson(e.target.value)}
          rows={4}
          spellCheck={false}
          style={{ fontFamily: "ui-monospace, monospace" }}
          aria-describedby="eval-resource-hint"
        />
        <p id="eval-resource-hint" style={{ fontSize: 12, color: "var(--mut, #64748b)", margin: "4px 0 0" }}>
          Optional, e.g. {'{"department":"IT"}'}
        </p>
      </Field>
      <button type="submit" disabled={status === "pending"}>
        {status === "pending" ? "Evaluating…" : "Evaluate"}
      </button>

      {error && (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      )}

      {result && (
        <div
          role="status"
          aria-live="polite"
          aria-busy={status === "pending"}
          className="card"
          style={{ padding: 12, opacity: status === "pending" ? 0.5 : 1 }}
        >
          <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong>Decision:</strong> {decision ? <StatusPill status={decision} /> : "—"}
          </p>
          {result.subjectUserId && (
            <p>
              <strong>Evaluated for:</strong> <code>{result.subjectUserId}</code>
            </p>
          )}
          <p>
            <strong>Reason:</strong> {result.reason ?? "—"}
          </p>
          {matchedRuleId != null && matchedRuleId !== "" && (
            <p>
              <strong>Matched rule:</strong>{" "}
              {/* GAP-POLICY-EVALUATE-02: deep-link to the matched ABAC rule. */}
              <Link href={`/policy/abac#rule-${matchedRuleId}`}>View rule</Link>{" "}
              <code style={{ fontSize: 12, color: "var(--mut, #64748b)" }}>{matchedRuleId}</code>
            </p>
          )}
        </div>
      )}
    </form>
  );
}
