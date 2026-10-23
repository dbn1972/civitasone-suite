"use client";

import { lifecycleOf, type PluginLifecycle } from "./pluginLifecycle";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton } from "../../_components/ds";

// Re-exported for existing client/test consumers; server code imports ./pluginLifecycle directly.
export { lifecycleOf };
export type { PluginLifecycle };

const INSTALL_POLL_MS = 3000;
const INSTALL_MAX_POLLS = 20;

type Plugin = { id?: string; name: string; status: string };

async function postVerb(
  verb: "install" | "enable" | "disable",
  pluginId: string,
  router: ReturnType<typeof useRouter>,
  reason?: string,
): Promise<void> {
  let url: string;
  let body: string | undefined;
  if (verb === "install") {
    url = `/api/proxy/v1/plugins/install`;
    body = JSON.stringify({ pluginId });
  } else {
    url = `/api/proxy/v1/plugins/${pluginId}/${verb}`;
    // Disable is audited: the service requires the operator's reason in the body.
    body = verb === "disable" ? JSON.stringify({ reason: (reason ?? "").trim() }) : undefined;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body,
  });
  // GAP-PLUGINS-INSTALLED-03: never surface the raw proxy body — map to a
  // clerk-safe, status-aware message (already in place; kept).
  if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  router.refresh();
}

/**
 * Row actions on the Installed list.
 *
 * GAP-PLUGINS-INSTALLED-02 (theme ROLEGATE): `canManage` (passed from the
 * server page, derived from PLUGIN_MANAGE_ROLES) hides the mutating controls
 * for a non-admin. The plugin-service remains the authority; this only avoids
 * offering a control whose POST is guaranteed to 403.
 *
 * GAP-PLUGINS-INSTALLED-04 (theme STATUS): a row with no id cannot be managed,
 * so instead of three dead disabled buttons it renders an explanatory note.
 */
export type PluginActionLabels = { disableReasonLabel: string };
const DEFAULT_LABELS: PluginActionLabels = { disableReasonLabel: "Reason for disabling (recorded in the audit log)" };

export function PluginActions({
  plugin,
  canManage = true,
  labels = DEFAULT_LABELS,
}: {
  plugin: Plugin;
  canManage?: boolean;
  /** Translated copy, supplied by the server page (this component renders without an intl provider in tests). */
  labels?: PluginActionLabels;
}) {
  const router = useRouter();

  if (!canManage) return null;

  if (!plugin.id) {
    return (
      <span className="muted" title="This plugin has no identifier, so it cannot be managed from here.">
        Not manageable
      </span>
    );
  }
  const id = plugin.id;

  const run = (verb: "install" | "enable" | "disable", reason?: string) => postVerb(verb, id, router, reason);
  const lifecycle = lifecycleOf(plugin.status);

  const wrap = { display: "inline-flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" as const };

  if (lifecycle === "available") {
    return (
      <div style={wrap}>
        <ActionButton
          label="Install"
          className="btn ghost"
          confirmTitle={`Install “${plugin.name}”?`}
          confirmDescription="Installing provisions this plugin for the entire tenant and may grant it access to tenant data."
          confirmLabel="Install"
          onConfirm={() => run("install")}
        />
      </div>
    );
  }

  if (lifecycle === "enabled") {
    return (
      <div style={wrap}>
        <ActionButton
          label="Disable"
          className="btn danger"
          danger
          confirmTitle={`Disable “${plugin.name}”?`}
          confirmDescription="Disabling immediately removes this feature for all tenant users. This may interrupt active workflows."
          confirmLabel="Disable plugin"
          requireReason
          minReasonLength={3}
          maxReasonLength={500}
          reasonLabel={labels.disableReasonLabel}
          onConfirm={(reason) => run("disable", reason)}
        />
      </div>
    );
  }

  if (lifecycle === "disabled") {
    return (
      <div style={wrap}>
        <ActionButton
          label="Enable"
          className="btn primary"
          confirmTitle={`Enable “${plugin.name}”?`}
          confirmDescription="Enabling activates this feature for all tenant users."
          confirmLabel="Enable plugin"
          onConfirm={() => run("enable")}
        />
      </div>
    );
  }

  // GAP-PLUGINS-INSTALLED-04: an unknown status (pending/error/…) offers no
  // enable/disable action — only installed/available states are actionable.
  return <span className="muted">—</span>;
}

/**
 * GAP-PLUGINS-MARKETPLACE-01 (theme MISSINGFEATURE): an install-only control
 * for the Marketplace list, so "Discover and install plugins" is actionable
 * from the Marketplace page itself rather than only from Installed. Uses the
 * marketplace install endpoint (POST /v1/plugins/marketplace/:id/install).
 * `canManage` mirrors PLUGIN_MANAGE_ROLES; the service remains the authority.
 */
export function MarketplaceInstallButton({
  listingId,
  name,
  installed,
  canManage = true,
}: {
  listingId?: string;
  name: string;
  installed?: boolean;
  canManage?: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("pluginMarketplace");
  // "idle" -> (202 accepted) "requested" -> (status poll sees the plugin) "installed".
  // The 202 only means the install was queued, so the UI never claims "Installed" until
  // the service reports it; after MAX_POLLS without a result it says it is still pending.
  const [phase, setPhase] = useState<"idle" | "requested" | "installed" | "pending">("idle");

  useEffect(() => {
    if (phase !== "requested" || !listingId) return;
    let polls = 0;
    let cancelled = false;
    const timer = setInterval(async () => {
      polls += 1;
      try {
        const res = await fetch(`/api/proxy/v1/plugins/marketplace/${listingId}/install-status`, { credentials: "same-origin" });
        if (res.ok) {
          const body = (await res.json()) as { data?: { status?: string } };
          if (!cancelled && body.data?.status === "installed") {
            clearInterval(timer);
            setPhase("installed");
            router.refresh();
            return;
          }
        }
      } catch {
        /* transient: keep polling until the cap */
      }
      if (!cancelled && polls >= INSTALL_MAX_POLLS) {
        clearInterval(timer);
        setPhase("pending");
      }
    }, INSTALL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, listingId, router]);

  if (!canManage) return null;
  if (installed || phase === "installed") return <span className="muted">{t("installed")}</span>;
  if (!listingId) return <span className="muted">—</span>;
  if (phase === "requested") return <span className="muted" role="status">{t("requested")}. {t("requestedNote")}</span>;
  if (phase === "pending") return <span className="muted" role="status">{t("requested")}. {t("stillPending")}</span>;

  async function install(reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/plugins/marketplace/${listingId}/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: (reason ?? "").trim() }),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
    setPhase("requested");
  }

  return (
    <ActionButton
      label={t("install")}
      className="btn primary"
      confirmTitle={t("confirmTitle", { name })}
      confirmDescription={t("confirmDescription")}
      confirmLabel={t("confirmLabel")}
      requireReason
      minReasonLength={3}
      maxReasonLength={500}
      reasonLabel={t("reasonLabel")}
      onConfirm={(reason) => install(reason)}
    />
  );
}
