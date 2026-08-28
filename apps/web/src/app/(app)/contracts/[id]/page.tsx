import Link from "next/link";
import { PageHeader, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { getContractById } from "../../../_data/loaders";
import { RaiseEOfficeNote } from "../../../_components/RaiseEOfficeNote";
import { getContractMilestones, getContractBonds, getContractObligations } from "../../../_data/loaders";
import { MilestoneActions } from "./MilestoneActions";
import { BondActions } from "./BondActions";
import { ObligationsPanel } from "./ObligationsPanel";

export function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
}

export type ContractDisplayFields = {
  title: string;
  contractNo: string;
  parties: string;
  contractType: string;
  startDate: string;
  endDate: string;
  status: string;
  statusLower: string;
  statusCls: "good" | "bad" | "mut";
  description: string;
  valueDisplay: string;
  dept: string;
  amountMinor: number | string | undefined;
};

// Pure derivation of everything the page renders from the raw contract
// record contract-service returns. Extracted (and exported) specifically so
// this — the exact logic that had multiple field-name mismatches against the
// real backend response (see fix/contract-frontend-field-mapping) — is
// directly unit-testable against realistic API payloads without needing to
// render the async server component itself.
export function deriveContractDisplayFields(contract: Record<string, unknown>): ContractDisplayFields {
  const title = field(contract, "title", "name", "contractNo");
  const contractNo = field(contract, "contractNo", "contract_no", "number");
  // contract-service returns the vendor as a raw `vendorId` (uuid) with no
  // joined display name today (no vendor-name enrichment exists in the
  // backend) -- falls back to the id itself rather than a permanent "--",
  // which previously made this field look empty even when the data exists.
  const parties = field(contract, "party", "partyName", "parties", "vendor", "vendorId");
  const contractType = field(contract, "type", "contractType", "contract_type");
  const startDate = field(contract, "startDate", "start_date", "validFrom");
  // contract-service's column is `expiry`, not endDate/validTo/expiryDate.
  const endDate = field(contract, "endDate", "end_date", "validTo", "expiryDate", "expiry");
  const status = field(contract, "status");
  const description = field(contract, "description", "remarks", "notes");

  // contract-service's column is `valueMinor` (already in minor units/paise --
  // formatMoney expects exactly that, no conversion needed). The previous
  // value/amount/contractValue aliases never matched the real API response,
  // so the contract's own monetary value never rendered on its detail page.
  const rawValue = contract.value ?? contract.amount ?? contract.contractValue ?? contract.valueMinor;
  const valueDisplay =
    rawValue != null && rawValue !== "" && rawValue !== "—"
      ? formatMoney(rawValue as number | string | bigint)
      : "—";

  const statusLower = status.toLowerCase();
  const statusCls = statusLower === "active" ? "good" : statusLower === "expired" ? "bad" : "mut";

  const deptVal = field(contract, "department", "dept");
  const dept = deptVal !== "—" ? deptVal : "Procurement";
  // RaiseEOfficeNote's amountMinor prop accepts number | string specifically
  // so callers never have to round-trip a paise value through a JS double --
  // it's forwarded as-is and never used in arithmetic. valueMinor now really
  // is populated (a numeric string, per the live API response), so keep it as
  // a string rather than coercing through Number(), which would silently
  // round any value above Number.MAX_SAFE_INTEGER paise. Same accepted shape
  // as formatMoney's own integer-string check (a leading "+" is valid there
  // too) -- Value and the eOffice note's amount must agree on what counts as
  // a usable numeric string, or the two could silently disagree.
  const amountMinor: number | string | undefined =
    typeof rawValue === "number"
      ? rawValue
      : typeof rawValue === "string" && /^[+-]?\d+$/.test(rawValue.trim())
        ? rawValue.trim()
        : undefined;

  return {
    title, contractNo, parties, contractType, startDate, endDate,
    status, statusLower, statusCls, description, valueDisplay, dept, amountMinor,
  };
}

export default async function ContractDetailPage({ params }: { params: { id: string } }) {
  const [{ data: contract, source }, milestonesRes, bondsRes, obligationsRes] = await Promise.all([
    getContractById(params.id),
    getContractMilestones(params.id),
    getContractBonds(params.id),
    getContractObligations(params.id),
  ]);

  if (!contract) {
    return (
      <main className="wrap">
        <Link href="/contracts/list" className="back">← Back</Link>
        <EmptyState
          icon="🔍"
          title="Contract not found"
          message="This contract may have been removed or the ID is invalid."
        />
      </main>
    );
  }

  const {
    title, contractNo, parties, contractType, startDate, endDate,
    status, statusLower, statusCls, description, valueDisplay, dept, amountMinor,
  } = deriveContractDisplayFields(contract);

  return (
    <main className="wrap" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/contracts" className="lnk">Contracts</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
        <Link href="/contracts/list" className="lnk">List</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
        <span aria-current="page">{contractNo !== "—" ? contractNo : title}</span>
      </nav>

      <PageHeader
        title={title}
        back="/contracts/list"
      />

      {source === "error" && <DataSourceBadge source={source} />}

      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Contract Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Contract No.</div><div className="v">{contractNo}</div></div>
              <div className="fld"><div className="l">Party</div><div className="v">{parties}</div></div>
              <div className="fld"><div className="l">Type</div><div className="v">{contractType}</div></div>
              <div className="fld"><div className="l">Value</div><div className="v">{valueDisplay}</div></div>
              <div className="fld">
                <div className="l">Status</div>
                <div className="v"><span className={`pill ${statusCls}`}>{status}</span></div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-h"><h3>Duration</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Start Date</div><div className="v">{formatIndianDate(startDate !== "—" ? startDate : null)}</div></div>
              <div className="fld"><div className="l">End Date</div><div className="v">{formatIndianDate(endDate !== "—" ? endDate : null)}</div></div>
            </div>
          </div>

          {description !== "—" && (
            <div className="card">
              <div className="card-h"><h3>Terms &amp; Description</h3></div>
              <div className="pad">
                <p style={{ whiteSpace: "pre-wrap", color: "var(--ink2)", lineHeight: 1.6 }}>{description}</p>
              </div>
            </div>
          )}
        </div>
      </div>


      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Milestones</h3></div>
        <div className="pad">
          {milestonesRes.data.length === 0 ? (
            <EmptyState icon="📋" title="No milestones" message="No milestones on this contract." />
          ) : (
            <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
              {milestonesRes.data.map((m) => (
                <li key={String(m.id)} style={{ fontSize: 13, marginBottom: 4 }}>
                  {String(m.title ?? "Milestone")} — <span className="pill mut">{String(m.status ?? "—")}</span>
                </li>
              ))}
            </ul>
          )}
          <MilestoneActions
            contractId={params.id}
            milestones={milestonesRes.data.map((m) => ({
              id: String(m.id),
              title: String(m.title ?? "Milestone"),
              status: String(m.status ?? "pending"),
              dueDate: typeof m.dueDate === "string" ? m.dueDate : undefined,
            }))}
          />
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Performance bonds</h3></div>
        <div className="pad">
          <BondActions
            contractId={params.id}
            canRegister={statusLower === "active" || statusLower === "approved"}
            bonds={bondsRes.data.map((b) => ({
              id: String(b.id),
              referenceNo: typeof b.referenceNo === "string" ? b.referenceNo : undefined,
              status: String(b.status ?? "held"),
              amountMinor: b.amountMinor as string | number | undefined,
              bondType: typeof b.bondType === "string" ? b.bondType : undefined,
            }))}
          />
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Obligations</h3></div>
        <div className="pad">
          <ObligationsPanel
            contractId={params.id}
            obligations={obligationsRes.data.map((o) => ({
              id: String(o.id),
              title: String(o.title ?? "Obligation"),
              description: typeof o.description === "string" ? o.description : undefined,
              dueDate: typeof o.dueDate === "string" ? o.dueDate : undefined,
              status: String(o.status ?? "pending"),
              ownerId: typeof o.ownerId === "string" ? o.ownerId : undefined,
              ...(typeof o.version === "number" ? { version: o.version } : {}),
            }))}
          />
        </div>
      </div>

      <RaiseEOfficeNote
        refType="contract_award"
        refId={params.id}
        subject={`Contract award — ${title}`}
        dept={dept}
        defaultApprovalChain="file_noting"
        notifyPath={`/api/proxy/v1/contract/contracts/${params.id}/submit-approval`}
        {...(amountMinor != null ? { amountMinor } : {})}
      />
    </main>
  );
}
