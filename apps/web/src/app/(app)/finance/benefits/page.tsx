import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, StatusPill } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

export type BenefitType = "ltc" | "cgeis" | "cghs" | "cea";

export type BenefitRecord = {
  id: string;
  employeeName: string;
  employeeCode: string;
  benefitType: BenefitType;
  status: "active" | "claimed" | "pending" | "not_eligible";
  lastClaimedDate: string | null;
  nextEligibleDate: string | null;
  amountDisplay: string | null;
};

const BENEFIT_META: Record<BenefitType, { label: string; description: string }> = {
  ltc: {
    label: "LTC",
    description: "Leave Travel Concession — any place in India once in 4 years or hometown every 2 years (7th CPC)",
  },
  cgeis: {
    label: "CGEIS",
    description: "Central Government Employees Insurance Scheme",
  },
  cghs: {
    label: "CGHS",
    description: "Central Government Health Scheme — monthly subscription",
  },
  cea: {
    label: "CEA",
    description: "Children Education Allowance — up to 2 children",
  },
};

async function getBenefits() {
  return fetchJson<BenefitRecord[], BenefitRecord[]>("/api/v1/finance/benefits", [] as BenefitRecord[], {
    revalidateSeconds: 60,
    telemetryKey: "finance.benefits",
    mapResponse: (d) => (Array.isArray(d) ? d : []),
  });
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

export default async function BenefitsPage() {
  const { data: benefits, source } = await getBenefits();

  const activeLTC = benefits.filter((b) => b.benefitType === "ltc" && b.status === "active").length;
  const pendingClaims = benefits.filter((b) => b.status === "pending").length;
  const cghsSubscribers = benefits.filter((b) => b.benefitType === "cghs" && b.status === "active").length;
  const ceaRecipients = benefits.filter((b) => b.benefitType === "cea" && b.status === "active").length;

  const groupedByType: Partial<Record<BenefitType, BenefitRecord[]>> = {};
  for (const b of benefits) {
    if (!groupedByType[b.benefitType]) groupedByType[b.benefitType] = [];
    groupedByType[b.benefitType]!.push(b);
  }

  return (
    <>
      <PageHeader
        title="Benefits"
        subtitle="Central Government employee benefits — LTC, CGEIS, CGHS, CEA. 7th CPC rates apply."
        actions={source === "error" ? <DataSourceBadge source={source} /> : undefined}
        help="finance-benefits"
      />

      <StatGrid>
        <StatCard icon="✈" iconBg="#e7edfd" label="Active LTC Eligibility" value={activeLTC} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Claims" value={pendingClaims} />
        <StatCard icon="🏥" iconBg="#ecfdf3" label="CGHS Subscribers" value={cghsSubscribers} />
        <StatCard icon="🎓" iconBg="#fef3f2" label="CEA Recipients" value={ceaRecipients} />
      </StatGrid>

      <div className="grid gap-6 md:grid-cols-2">
        {(Object.entries(BENEFIT_META) as [BenefitType, typeof BENEFIT_META[BenefitType]][]).map(([type, meta]) => {
          const rows = groupedByType[type] ?? [];
          return (
            <Card key={type} title={meta.label}>
              <p className="px-4 pt-3 pb-2 text-xs text-gray-500">{meta.description}</p>
              {rows.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">No records.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" aria-label={`${meta.label} benefit records`}>
                    <thead>
                      <tr>
                        <th scope="col" className="text-left py-2 px-3">Employee</th>
                        <th scope="col" className="text-left py-2 px-3">Status</th>
                        <th scope="col" className="text-left py-2 px-3">Last Claimed</th>
                        <th scope="col" className="text-left py-2 px-3">Next Eligible</th>
                        {type === "ltc" && <th scope="col" className="text-left py-2 px-3">Amount</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <div className="font-medium">{b.employeeName}</div>
                            <div className="text-xs text-gray-500">{b.employeeCode}</div>
                          </td>
                          <td><StatusPill status={b.status} /></td>
                          <td className="text-sm">{formatDate(b.lastClaimedDate)}</td>
                          <td className="text-sm">{formatDate(b.nextEligibleDate)}</td>
                          {type === "ltc" && (
                            <td className="text-sm font-mono">{b.amountDisplay ?? "—"}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="LTC Policy Reference" padding>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium">LTC — Any Place in India</dt>
            <dd className="text-gray-600 mt-1">Once in a block of 4 years. Current block: 2026-29.</dd>
          </div>
          <div>
            <dt className="font-medium">LTC — Hometown</dt>
            <dd className="text-gray-600 mt-1">Once every 2 years. Can be used in lieu of 1 API claim.</dd>
          </div>
          <div>
            <dt className="font-medium">CGHS Subscription</dt>
            <dd className="text-gray-600 mt-1">Monthly deduction from salary based on pay level (7th CPC).</dd>
          </div>
          <div>
            <dt className="font-medium">CEA — Children Education Allowance</dt>
            <dd className="text-gray-600 mt-1">Max 2 children. Annual reimbursement with fee receipts.</dd>
          </div>
        </dl>
      </Card>
    </>
  );
}
