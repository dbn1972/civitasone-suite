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

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
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

  const title = field(contract, "title", "name", "contractNo");
  const contractNo = field(contract, "contractNo", "contract_no", "number");
  const parties = field(contract, "party", "partyName", "parties", "vendor");
  const contractType = field(contract, "type", "contractType", "contract_type");
  const startDate = field(contract, "startDate", "start_date", "validFrom");
  const endDate = field(contract, "endDate", "end_date", "validTo", "expiryDate");
  const status = field(contract, "status");
  const description = field(contract, "description", "remarks", "notes");

  const rawValue = contract.value ?? contract.amount ?? contract.contractValue;
  const valueDisplay =
    rawValue != null && rawValue !== "" && rawValue !== "—"
      ? formatMoney(rawValue as number | string | bigint)
      : "—";

  const statusLower = status.toLowerCase();
  const statusCls = statusLower === "active" ? "good" : statusLower === "expired" ? "bad" : "mut";

  const deptVal = field(contract, "department", "dept");
  const dept = deptVal !== "—" ? deptVal : "Procurement";
  const amountMinor =
    typeof rawValue === "number"
      ? rawValue
      : typeof rawValue === "string" && rawValue.trim() !== "" && Number.isFinite(Number(rawValue))
        ? Number(rawValue)
        : undefined;

  return (
    <main className="wrap" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/contracts" className="lnk">Contracts</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "#cdd2dc" }}>/</span>
        <Link href="/contracts/list" className="lnk">List</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "#cdd2dc" }}>/</span>
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
            <p style={{ margin: 0, color: "var(--ink2)", fontSize: 13 }}>No milestones on this contract.</p>
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
