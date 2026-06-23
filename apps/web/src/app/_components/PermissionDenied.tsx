import Link from "next/link";

type Props = { module?: string; requiredRoles?: string[] };

export function PermissionDenied({ module, requiredRoles }: Props) {
  return (
    <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
      <div className="pad" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>🔒</div>
        <h2 style={{ margin: "0 0 8px" }}>Access restricted</h2>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 16px" }}>
          {module
            ? `You don’t have permission to view ${module}.`
            : "You don’t have permission to view this page."}
          {requiredRoles?.length ? ` Required: ${requiredRoles.join(", ")}.` : ""}
        </p>
        <Link href="/dashboard" className="btn primary">Return to command center</Link>
      </div>
    </div>
  );
}
