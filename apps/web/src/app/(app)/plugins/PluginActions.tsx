"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "../../_components/ds";

type Plugin = { id?: string; name: string; status: string };

function isEnabled(status: string) {
	return status.toLowerCase() === "enabled";
}

export function PluginActions({ plugin }: { plugin: Plugin }) {
	const router = useRouter();

	async function run(verb: "install" | "enable" | "disable", reason?: string) {
		if (!plugin.id) throw new Error("This plugin is not installable in the current tenant.");
		let url: string;
		let method: string;
		let body: string | undefined;
		if (verb === "install") {
			url = `/api/proxy/v1/plugins/install`;
			method = "POST";
			body = JSON.stringify({ pluginId: plugin.id, reason });
		} else {
			url = `/api/proxy/v1/plugins/${plugin.id}/${verb}`;
			method = "POST";
			body = reason ? JSON.stringify({ reason }) : undefined;
		}
		const res = await fetch(url, {
			method,
			headers: body ? { "Content-Type": "application/json" } : undefined,
			body,
		});
		if (!res.ok) throw new Error((await res.text()) || `Failed to ${verb} plugin.`);
		router.refresh();
	}

	const enabled = isEnabled(plugin.status);
	const disabled = !plugin.id;

	return (
		<div style={{ display: "inline-flex", gap: 8, justifyContent: "flex-end" }}>
			<ActionButton
				label="Install"
				className="btn ghost"
				disabled={disabled}
				confirmTitle={`Install “${plugin.name}”?`}
				confirmDescription="Installing provisions this plugin for the entire tenant and may grant it access to tenant data."
				confirmLabel="Install"
				requireReason
				reasonLabel="Reason for installing"
				onConfirm={(reason) => run("install", reason)}
			/>
			{enabled ? (
				<ActionButton
					label="Disable"
					className="btn danger"
					danger
					disabled={disabled}
					confirmTitle={`Disable “${plugin.name}”?`}
					confirmDescription="Disabling immediately removes this feature for all tenant users. This may interrupt active workflows."
					confirmLabel="Disable plugin"
					requireReason
					reasonLabel="Reason for disabling"
					onConfirm={(reason) => run("disable", reason)}
				/>
			) : (
				<ActionButton
					label="Enable"
					className="btn primary"
					disabled={disabled}
					confirmTitle={`Enable “${plugin.name}”?`}
					confirmDescription="Enabling activates this feature for all tenant users."
					confirmLabel="Enable plugin"
					requireReason
					reasonLabel="Reason for enabling"
					onConfirm={(reason) => run("enable", reason)}
				/>
			)}
		</div>
	);
}
