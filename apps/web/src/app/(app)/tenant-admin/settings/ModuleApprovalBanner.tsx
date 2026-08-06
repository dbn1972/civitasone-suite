"use client";

import { useState } from "react";

type UserRole = "super_admin" | "platform_admin" | "tenant_admin" | string;

interface ModuleApprovalBannerProps {
  /** User's roles from the auth session */
  roles: UserRole[];
  /** Module keys that have been toggled (dirty) */
  dirtyKeys: string[];
  /** Pending state of each dirty module */
  pendingState: Record<string, boolean>;
}

/**
 * Approval workflow banner for module enable/disable operations.
 *
 * - super_admin / platform_admin: changes take effect immediately (no approval needed)
 * - tenant_admin: submits a module_change_request to workflow-service for approval
 *
 * This component renders contextual guidance above the save button based on
 * the user's role.
 */
export function ModuleApprovalBanner({ roles, dirtyKeys, pendingState }: ModuleApprovalBannerProps) {
  const [requestStatus, setRequestStatus] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const isSuperAdmin = roles.includes("super_admin") || roles.includes("platform_admin");

  if (dirtyKeys.length === 0) return null;

  async function submitApprovalRequest() {
    setRequestStatus("submitting");
    setErrorMessage("");
    try {
      // admin-service owns the change-request lifecycle (create → approve/
      // reject); the old /v1/workflow/module-change-requests path never existed.
      const res = await fetch("/api/proxy/v1/admin/change/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Module configuration change",
          type: "normal",
          risk: "medium",
          affectedServices: ["admin-service"],
          description: `Module configuration change requested by tenant admin: ${dirtyKeys
            .map((key) => `${key} → ${pendingState[key] ? "enabled" : "disabled"}`)
            .join(", ")}`,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setRequestStatus("submitted");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Request failed");
      setRequestStatus("error");
    }
  }

  if (isSuperAdmin) {
    return (
      <div className="approval-banner approval-banner--direct" role="status" aria-live="polite">
        <span className="approval-banner__icon" aria-hidden="true">⚡</span>
        <div className="approval-banner__text">
          <strong>Direct access</strong> — your changes will take effect immediately.
        </div>
      </div>
    );
  }

  // tenant_admin: needs approval
  return (
    <div className="approval-banner approval-banner--pending" role="status" aria-live="polite">
      <span className="approval-banner__icon" aria-hidden="true">⏳</span>
      <div className="approval-banner__content">
        <div className="approval-banner__text">
          <strong>Approval required</strong> — module changes need super admin approval.
          {dirtyKeys.length > 0 && (
            <span className="approval-banner__count">
              {" "}({dirtyKeys.length} change{dirtyKeys.length > 1 ? "s" : ""} pending)
            </span>
          )}
        </div>
        {requestStatus === "submitted" ? (
          <div className="approval-banner__success">
            ✅ Request submitted. Awaiting super admin approval.
          </div>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={requestStatus === "submitting"}
            aria-busy={requestStatus === "submitting"}
            onClick={() => void submitApprovalRequest()}
          >
            {requestStatus === "submitting" ? "Submitting…" : "Request Approval"}
          </button>
        )}
        {requestStatus === "error" && (
          <div role="alert" aria-live="assertive" className="approval-banner__error">
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
