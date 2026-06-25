"use client";

import Link from "next/link";

interface PluginsErrorProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function PluginsError({ error, reset }: PluginsErrorProps) {
	return (
		<div
			className="wrap"
			style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 24, textAlign: "center" }}
			role="alert"
		>
			<span style={{ fontSize: 48 }} role="img" aria-label="Warning">⚠️</span>
			<div>
				<h1 style={{ fontSize: "1.5rem", fontWeight: 600, color: "var(--ink)", marginBottom: 8 }}>Could not load plugins</h1>
				<p style={{ color: "var(--ink2)", maxWidth: 480, margin: "0 auto" }}>
					{error.message || "An unexpected error occurred in the Plugins module."}
				</p>
				{error.digest && <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8 }}>Error ID: {error.digest}</p>}
			</div>
			<div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
				<button type="button" className="btn primary" onClick={reset}>Try again</button>
				<Link href="/" className="btn ghost">Back to dashboard</Link>
			</div>
		</div>
	);
}
