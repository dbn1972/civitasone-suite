import Link from "next/link";

type Props = { module?: string; requiredRoles?: string[]; reason?: string };

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

export function PermissionDenied({ module, requiredRoles, reason }: Props) {
  return (
    <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
      <div className="pad" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>🔒</div>
        <h2 style={{ margin: "0 0 8px" }}>Access restricted</h2>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 16px" }}>
          {reason ? (
            // `reason` is the backend's own HttpError message for THIS specific
            // request (e.g. "managers may only view their own direct reports'
            // records") — always already a clerk-safe, specific sentence (see
            // apiClient.ts's `errorMessage` doc comment), so it takes priority
            // over the generic module/requiredRoles copy below when present:
            // it reflects exactly what was actually checked, not a static
            // guess at it.
            sentence(reason)
          ) : (
            <>
              {module
                ? `You don’t have permission to view ${module}.`
                : "You don’t have permission to view this page."}
              {requiredRoles?.length ? ` Required: ${requiredRoles.join(", ")}.` : ""}
            </>
          )}
        </p>
        <Link href="/dashboard" className="btn primary">Return to command center</Link>
      </div>
    </div>
  );
}
