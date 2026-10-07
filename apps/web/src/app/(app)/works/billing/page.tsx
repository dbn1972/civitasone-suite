import Link from "next/link";
import { PageHeader, Card } from "@/app/_components/ds";
import { getBills } from "../_data/loaders";
import { BillingRegister } from "./BillingTable";

export default async function BillingPage() {
  const { data: bills, source } = await getBills();

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012 + GAP-WORKS-BILLING-03: both the stat cards and the table are
          now driven by the SAME useSeededResource call inside
          <BillingRegister>, so the counts can never read 0 (raw fetch) next
          to cached rows (table). The page is a thin server shell that only
          fetches and hands the seed to the client register. */}
      <PageHeader
        title="Bills & Measurement Books"
        subtitle="e-MB, RA bills, and abstract bill processing."
        back="/works"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {/* GAP-WORKS-BILLING-04: surface the other billing entry points on
                the register header, not only "+ Issue MB". Record measurement
                and Generate bill need a work context (?workId), so from the
                tenant-wide register they route to the picker-less forms where
                the clerk selects the work; keep "+ Issue MB" primary. */}
            <Link
              href="/works/billing/measurements/new"
              className="btn ghost"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Record measurement
            </Link>
            <Link
              href="/works/billing/bills/new"
              className="btn ghost"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Generate bill
            </Link>
            <Link
              href="/works/billing/account-compile"
              className="btn ghost"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              Account compile
            </Link>
            <Link
              href="/works/billing/new-mb"
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Issue MB
            </Link>
          </div>
        }
      />
      <Card title="Works Bills">
        <BillingRegister bills={bills} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
