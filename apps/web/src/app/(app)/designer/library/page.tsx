import Link from "next/link";
import { PageHeader, Card, EmptyState } from "@/app/_components/ds";
import { getDomainPacks } from "../_data/designerLoader";

export default async function PackLibraryPage() {
  const { data: packs } = await getDomainPacks();

  return (
    <>
      <PageHeader
        title="Pack Library"
        subtitle="Browse domain packs and import starter services as drafts."
        actions={<Link href="/designer" className="btn ghost">← Library</Link>}
      />

      {packs.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No packs available"
          message="Run migrations to seed the municipal-in-v1 reference pack, or import a pack manifest."
          action={<Link href="/designer/new" className="btn primary">Create from pattern</Link>}
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {packs.map((p) => (
            <Card key={p.id} title={p.name} padding>
              <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--ink2)" }}>{p.domainPackKey}</p>
              <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--mut)" }}>
                {p.sector} · {p.jurisdiction || "—"} · {p.packCount} packs · v{p.version}
              </p>
              <button type="button" className="btn ghost" disabled title="Import flow ships in Phase 1">
                Preview & Import
              </button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
