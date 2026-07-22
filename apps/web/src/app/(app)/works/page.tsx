import { PageHeader } from "@/app/_components/ds";
import Link from "next/link";

export default function WorksHub() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Works & Billing" subtitle="Engineering works lifecycle management" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
        <HubTile href="/works/proposals" icon="📋" label="Work Proposals" count="—" />
        <HubTile href="/works/approvals" icon="✅" label="AA / TS" count="—" />
        <HubTile href="/works/boq" icon="📐" label="Bill of Quantities" count="—" />
        <HubTile href="/works/tenders" icon="📢" label="Tender Pipeline" count="—" />
        <HubTile href="/works/execution" icon="🏗️" label="Execution" count="—" />
        <HubTile href="/works/billing" icon="💰" label="Bills & MB" count="—" />
        <HubTile href="/works/closure" icon="🔒" label="Closure" count="—" />
      </div>
    </main>
  );
}

function HubTile({ href, icon, label, count }: { href: string; icon: string; label: string; count: string }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-2 p-6 rounded-xl border hover:bg-muted/50 transition-colors">
      <span className="text-3xl">{icon}</span>
      <span className="font-medium text-sm">{label}</span>
      <span className="text-xs text-muted-foreground">{count}</span>
    </Link>
  );
}
