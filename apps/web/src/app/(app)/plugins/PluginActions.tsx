"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useRouter } from "next/navigation";
import { ActionButton } from "../../_components/ds";

type Plugin = { id?: string; name: string; status: string };

/**
 * GAP-PLUGINS-INSTALLED-01 (theme LOGIC): a plugin's lifecycle state decides
 * which single primary action is offered. "available"/"not_installed" offers
 * Install; "disabled" offers Enable; "enabled"/"active" offers Disable. No row
 * ever shows more than one primary action, and Install is never offered on an
 * already-enabled plugin (which would silently re-provision it with tenant-data
 * access).
 */
function normalize(status: string): string {
  return status.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export type PluginLifecycle = "available" | "enabled" | "disabled" | "other";

export function lifecycleOf(status: string): PluginLifecycle {
  switch (normalize(status)) {
    case "available":
    case "not_installed":
    case "uninstalled":
    case "uploaded":
      return "available";
    case "enabled":
    case "active":
      return "enabled";
    case "disabled":
      return "disabled";
    default:
      return "other";
  }
}

async function postVerb(
  verb: "install" | "enable" | "disable",
  pluginId: string,
  reason: string | undefined,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  let url: string;
  let body: string | undefined;
  if (verb === "install") {
    url = `/api/proxy/v1/plugins/install`;
    body = JSON.stringify({ pluginId, reason });
  } else {
    url = `/api/proxy/v1/plugins/${pluginId}/${verb}`;
    body = reason ? JSON.stringify({ reason }) : undefined;
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
export function PluginActions({ plugin, canManage = true }: { plugin: Plugin; canManage?: boolean }) {
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

  const run = (verb: "install" | "enable" | "disable", reason?: string) => postVerb(verb, id, reason, router);
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
          requireReason
          reasonLabel="Reason for installing"
          onConfirm={(reason) => run("install", reason)}
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
          reasonLabel="Reason for disabling"
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
          requireReason
          reasonLabel="Reason for enabling"
          onConfirm={(reason) => run("enable", reason)}
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
  if (!canManage) return null;
  if (installed) return <span className="muted">Installed</span>;
  if (!listingId) return <span className="muted">—</span>;

  async function install(reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/plugins/marketplace/${listingId}/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
    router.refresh();
  }

  return (
    <ActionButton
      label="Install"
      className="btn primary"
      confirmTitle={`Install “${name}”?`}
      confirmDescription="Installing provisions this plugin for the entire tenant and may grant it access to tenant data."
      confirmLabel="Install"
      requireReason
      reasonLabel="Reason for installing"
      onConfirm={(reason) => install(reason)}
    />
  );
}
