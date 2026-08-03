import { PageHeader, Card, EmptyState } from "@/app/_components/ds";
import Link from "next/link";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/metadata/entities", title: "Entities", desc: "Custom entity definitions (/api/v1/metadata/entities)" },
  { href: "/metadata/fields", title: "Fields", desc: "Field definitions on entities" },
  { href: "/metadata/rules", title: "Validation rules", desc: "Entity validation rules" },
  { href: "/metadata/records", title: "Records", desc: "Custom master-data records" },
  { href: "/metadata/forms", title: "Forms", desc: "Form versions and publish lifecycle" },
];

export default function MetadataHubPage() {
  return (
    <main className="page-main wrap" aria-label="Metadata hub">
      <PageHeader
        title="Metadata"
        subtitle="Configure custom entities, fields, rules, records and forms via /api/v1/metadata/*."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {LINKS.map((l) => (
          <Card key={l.href} title={l.title} padding>
            <p className="text-sm text-muted mb-3">{l.desc}</p>
            <Link className="text-sm underline" href={l.href}>{l.title} →</Link>
          </Card>
        ))}
      </div>
    </main>
  );
}
