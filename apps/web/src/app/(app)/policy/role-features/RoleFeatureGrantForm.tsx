"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { Button, ConfirmDialog, EntityPicker, Field } from "@/app/_components/ds";
import { searchPolicyRoles, resolvePolicyRoles } from "@/lib/entityAdapters/policyRole";

/** service.resource.action style feature key (lowercase, dotted). */
const FEATURE_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/**
 * Client form — POST /api/proxy/v1/policy/role-features.
 *
 * GAP-POLICY-ROLE-FEATURES-02/03/04:
 *  - Role is chosen from the role catalogue (searchable picker), not free text.
 *  - Feature key is validated against the dotted-key pattern; an unknown shape
 *    shows an inline error and blocks submission (no silent dangling grant).
 *  - Fields start empty; submit is disabled until both are set and opens a
 *    ConfirmDialog ("Grant <feature> to <role>?") with an optional reason.
 *  - On success the list refreshes, fields clear, and the 202 (async) nature is
 *    explained.
 */
export function RoleFeatureGrantForm() {
  const router = useRouter();
  const [roleId, setRoleId] = useState<string | null>(null);
  const [roleName, setRoleName] = useState("");
  const [featureKey, setFeatureKey] = useState("");
  const [featureError, setFeatureError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");
  const formError = useFormError("role feature grant");

  const trimmedKey = featureKey.trim();
  const keyValid = FEATURE_KEY_RE.test(trimmedKey);
  const canSubmit = Boolean(roleName && trimmedKey) && keyValid;

  async function doGrant(reason?: string) {
    setStatus("pending");
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/policy/role-features", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleName, featureKey: trimmedKey, granted: true, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      await res.json().catch(() => ({}));
      setStatus("ok");
      setMessage("Grant submitted — it may take a moment to appear.");
      setRoleId(null);
      setRoleName("");
      setFeatureKey("");
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(formError.fromException("save", caught).message);
    }
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!keyValid) {
            setFeatureError("Use a dotted key like finance.dashboard");
            return;
          }
          setFeatureError("");
          if (canSubmit) setConfirmOpen(true);
        }}
        style={{ display: "grid", gap: 12, maxWidth: 520 }}
      >
        <Field label="Role">
          <EntityPicker
            value={roleId}
            onChange={(v) => {
              const id = Array.isArray(v) ? (v[0] ?? null) : v;
              setRoleId(id);
            }}
            search={async (q, signal) => {
              const opts = await searchPolicyRoles(q, signal);
              const sel = opts.find((o) => o.id === roleId);
              if (sel) setRoleName(sel.label);
              return opts;
            }}
            resolve={async (ids) => {
              const opts = await resolvePolicyRoles(ids);
              const sel = opts[0];
              if (sel) setRoleName(sel.label);
              return opts;
            }}
            aria-label="Role"
            placeholder="Search roles…"
          />
        </Field>
        <Field label="Feature key" error={featureError || undefined}>
          <input
            value={featureKey}
            onChange={(e) => {
              setFeatureKey(e.target.value);
              if (featureError) setFeatureError("");
            }}
            maxLength={200}
            placeholder="finance.dashboard"
            aria-describedby="feature-key-hint"
          />
          <p id="feature-key-hint" style={{ fontSize: 12, color: "var(--mut, #64748b)", margin: "4px 0 0" }}>
            Dotted key, e.g. finance.dashboard
          </p>
        </Field>
        <Button type="submit" disabled={!canSubmit || status === "pending"}>
          {status === "pending" ? "Granting…" : "Grant feature"}
        </Button>
        {message && (
          <p role="status" aria-live="polite" style={{ color: status === "error" ? "#b91c1c" : "#166534" }}>
            {message}
          </p>
        )}
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="Grant feature to role?"
        description={
          <>
            Grant <strong>{trimmedKey}</strong> to role <strong>{roleName}</strong>? Everyone with this role
            will see the feature.
          </>
        }
        confirmLabel="Grant"
        optionalReason
        reasonLabel="Reason (optional)"
        busy={status === "pending"}
        onConfirm={(reason) => {
          setConfirmOpen(false);
          void doGrant(reason);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
