"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton, EntityPicker } from "@/app/_components/ds";
import { searchDirectoryUsers, resolveDirectoryUsers } from "@/lib/directory/searchUsers";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";

/**
 * GAP-FIELD-TASKS-05: Start / Mark complete / Assign controls for a field task.
 *
 * Every action goes through a confirm dialog and posts to the existing,
 * role-gated, audit-emitting field-service endpoints via the browser proxy.
 * The row's `version` is pinned in the body so a stale click is rejected by the
 * server (409) instead of overwriting a concurrent change. The server stays the
 * authority on who may act (assignee-or-supervisor; assign is supervisor-only):
 * `canAssign` only decides whether the UI offers the Assign control.
 * The commands are accepted asynchronously (202), so the list is refreshed and
 * the status moves when the worker has applied the change.
 */
export type FieldTaskActionsProps = {
  id: string;
  status: string;
  version: number;
  canAssign: boolean;
};

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
}

export function FieldTaskActions({ id, status, version, canAssign }: FieldTaskActionsProps) {
  const t = useTranslations("fieldTasks");
  const router = useRouter();
  const [assignee, setAssignee] = useState<string | null>(null);
  const refresh = () => router.refresh();
  const base = `/api/proxy/v1/field/tasks/${encodeURIComponent(id)}`;

  const showStart = status === "assigned";
  const showComplete = status === "in_progress";
  const showAssign = canAssign && (status === "unassigned" || status === "assigned");
  if (!showStart && !showComplete && !showAssign) return <span className="muted">—</span>;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {showStart && (
        <ActionButton
          label={t("startLabel")}
          className="btn"
          confirmTitle={t("startTitle")}
          confirmDescription={t("startDescription")}
          confirmLabel={t("startConfirm")}
          onConfirm={() => post(`${base}/start`, { version })}
          onSuccess={refresh}
        />
      )}
      {showComplete && (
        <ActionButton
          label={t("completeLabel")}
          className="btn primary"
          confirmTitle={t("completeTitle")}
          confirmDescription={t("completeDescription")}
          confirmLabel={t("completeConfirm")}
          onConfirm={() => post(`${base}/complete`, { version })}
          onSuccess={refresh}
        />
      )}
      {showAssign && (
        <ActionButton
          label={t("assignLabel")}
          className="btn"
          confirmTitle={t("assignTitle")}
          confirmDescription={t("assignDescription")}
          confirmLabel={t("assignConfirm")}
          blockConfirm={assignee === null}
          onConfirm={() => post(`${base}/assign`, { assigneeId: assignee, version })}
          onSuccess={refresh}
        >
          <EntityPicker
            value={assignee}
            onChange={(v) => setAssignee(Array.isArray(v) ? (v[0] ?? null) : v)}
            search={searchDirectoryUsers}
            resolve={resolveDirectoryUsers}
            minQueryLength={2}
            aria-label={t("assignPicker")}
            placeholder={t("assignPlaceholder")}
          />
        </ActionButton>
      )}
    </div>
  );
}
