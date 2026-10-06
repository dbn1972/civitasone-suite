"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { Button, ConfirmDialog, EntityPicker, Field } from "@/app/_components/ds";
import { searchIdentityUsers, resolveIdentityUsers } from "@/lib/entityAdapters/identityUser";
import { searchPolicyRoles, resolvePolicyRoles } from "@/lib/entityAdapters/policyRole";

/**
 * Client form — POST /api/proxy/v1/policy/bindings → gateway /api/v1/policy/bindings.
 *
 * GAP-POLICY-BINDINGS-01/02/04:
 *  - User and Role are chosen with searchable EntityPickers (names, not raw
 *    UUIDs; the loose `[0-9a-fA-F-]{36}` pattern that accepted 36 hyphens is
 *    gone — a selection yields a real id or nothing).
 *  - Submit opens a ConfirmDialog that requires a reason and shows the resolved
 *    names; granting a role to one's own account is refused (the server also
 *    enforces this — SELF_BINDING_FORBIDDEN).
 *  - On success the list is refreshed and the 202 (async) nature is explained.
 */
export function BindingCreateForm({ currentUserId }: { currentUserId: string | null }) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [userLabel, setUserLabel] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const formError = useFormError("role binding");

  const isSelf = currentUserId != null && userId === currentUserId;
  const canSubmit = Boolean(userId && roleId) && !isSelf;

  async function doCreate(reason?: string) {
    setStatus("pending");
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/policy/bindings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, roleId, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      const body = await res.json().catch(() => ({}));
      setStatus("ok");
      setMessage(
        body?.id
          ? `Request accepted (id ${body.id}); the binding appears once processed.`
          : "Request accepted; the binding appears once processed.",
      );
      setUserId(null);
      setRoleId(null);
      setUserLabel("");
      setRoleLabel("");
      // GAP-POLICY-BINDINGS-04: refetch the server list so the new row shows.
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
          if (canSubmit) setConfirmOpen(true);
        }}
        className="form-grid"
        style={{ display: "grid", gap: 12, maxWidth: 520 }}
      >
        <Field label="User">
          <EntityPicker
            value={userId}
            onChange={(v) => {
              const id = Array.isArray(v) ? (v[0] ?? null) : v;
              setUserId(id);
            }}
            search={async (q, signal) => {
              const opts = await searchIdentityUsers(q, signal);
              const sel = opts.find((o) => o.id === userId);
              if (sel) setUserLabel(sel.label);
              return opts;
            }}
            resolve={resolveIdentityUsers}
            aria-label="User"
            placeholder="Search users…"
          />
        </Field>
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
              if (sel) setRoleLabel(sel.label);
              return opts;
            }}
            resolve={resolvePolicyRoles}
            aria-label="Role"
            placeholder="Search roles…"
          />
        </Field>
        {isSelf && (
          <p role="alert" style={{ color: "#b91c1c", margin: 0 }}>
            You cannot bind a role to your own account.
          </p>
        )}
        <Button type="submit" disabled={!canSubmit || status === "pending"}>
          {status === "pending" ? "Submitting…" : "Create binding"}
        </Button>
        {message && (
          <p role="status" aria-live="polite" style={{ color: status === "error" ? "#b91c1c" : "#166534" }}>
            {message}
          </p>
        )}
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="Grant role binding?"
        description={
          <>
            Bind role <strong>{roleLabel || roleId}</strong> to user{" "}
            <strong>{userLabel || userId}</strong>? This changes what the user can do.
          </>
        }
        confirmLabel="Grant binding"
        requireReason
        reasonLabel="Reason for this grant"
        busy={status === "pending"}
        onConfirm={(reason) => {
          setConfirmOpen(false);
          void doCreate(reason);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
