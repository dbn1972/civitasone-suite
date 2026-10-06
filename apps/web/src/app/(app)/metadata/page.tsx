import { PageHeader, Card } from "@/app/_components/ds";
import Link from "next/link";

export const dynamic = "force-dynamic";

// GAP-METADATA-HOME-03: each card's title now equals the target page's H1
// (Entities, Fields, Validation rules, Records, Forms) so the hub and the
// pages agree. GAP-METADATA-HOME-02: descriptions are business copy with no
// "/api/v1/..." path. GAP-METADATA-HOME-04: the href drives a whole-tile Link
// (below) rather than a tiny underlined text link, so the entire card is the
// click/focus target.
const LINKS = [
  { href: "/metadata/entities", title: "Entities", desc: "Custom entity definitions for your organisation." },
  { href: "/metadata/fields", title: "Fields", desc: "Field definitions on each entity." },
  { href: "/metadata/rules", title: "Validation rules", desc: "Validation rules enforced on each entity." },
  { href: "/metadata/records", title: "Records", desc: "Custom master-data records held against an entity." },
  { href: "/metadata/forms", title: "Forms", desc: "Form layouts and their publish lifecycle." },
];

export default function MetadataHubPage() {
  return (
    <div className="page-main wrap" aria-label="Metadata hub">
      <PageHeader
        title="Metadata"
        subtitle="Configure custom entities, fields, rules, records and forms."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="mtile"
            style={{ textDecoration: "none", color: "inherit", display: "block" }}
          >
            <Card title={l.title} padding>
              <p className="text-sm text-muted">{l.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
