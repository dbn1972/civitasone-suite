import Link from "next/link";
import { PageHeader, EmptyState, LoadErrorState, StatusPill } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { getContractById, getVendorOptions } from "../../../_data/loaders";
import { RaiseEOfficeNote } from "../../../_components/RaiseEOfficeNote";
import { getContractMilestones, getContractBonds, getContractObligations } from "../../../_data/loaders";
import { MilestoneActions } from "./MilestoneActions";
import { BondActions } from "./BondActions";
import { ObligationsPanel } from "./ObligationsPanel";
import { deriveContractDisplayFields } from "./page.helpers";
import { ArrowLeft } from "lucide-react";

const DAY_MS = 86_400_000;

function isOverdue(dueDate: string | undefined, status: string): boolean {
  if (!dueDate) return false;
  const s = status.toLowerCase();
  if (s === "completed" || s === "completed_late") return false;
  const ms = Date.parse(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  return ms < Date.now() - DAY_MS; // strictly before today (UTC day)
}

export default async function ContractDetailPage({ params }: { params: { id: string } }) {
  const [{ data: contract, source, status }, milestonesRes, bondsRes, obligationsRes, vendorsRes] =
    await Promise.all([
      getContractById(params.id),
      getContractMilestones(params.id),
      getContractBonds(params.id),
      getContractObligations(params.id),
      getVendorOptions(),
    ]);

  // GAP-CONTRACTS-DETAIL-01: distinguish a genuine 404 (the contract does not
  // exist) from a transient/authz failure. The old code collapsed EVERY
  // failure into "Contract not found", so an outage read as a deletion and the
  // source==="error" badge was dead code. Now:
  //   • 404 (or a clean null with source "api") -> honest "not found";
  //   • 403                                      -> access-restricted copy;
  //   • any other error (5xx/network/timeout)    -> retryable load error.
  if (source === "error" && status !== 404) {
    return (
      <div className="wrap">
        <Link href="/contracts/list" className="back"><ArrowLeft aria-hidden="true" size={14} /> Back</Link>
        <LoadErrorState
          result={{ status }}
          area="contract"
          backHref="/contracts/list"
          backLabel="Back to Contracts"
        />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="wrap">
        <Link href="/contracts/list" className="back"><ArrowLeft aria-hidden="true" size={14} /> Back</Link>
        <EmptyState
          icon="🔍"
          title="Contract not found"
          message="This contract may have been removed or the ID is invalid."
          action={<Link href="/contracts/list" className="btn">Back to Contracts</Link>}
        />
      </div>
    );
  }

  const {
    title, contractNo, parties, contractType, startDate, endDate,
    status: contractStatus, statusLower, description, valueDisplay, dept, amountMinor,
  } = deriveContractDisplayFields(contract);

  // GAP-CONTRACTS-DETAIL-04: resolve the vendor name from the vendor master
  // (contract-service stores only a raw vendorId). Fall back to the short id
  // when unknown — never show nothing. `parties` is already the vendorId when
  // no name field was on the contract itself.
  const vendorName =
    vendorsRes.source === "api" && parties !== "—"
      ? (vendorsRes.data.find((v) => v.id === parties)?.name ?? null)
      : null;
  const partyDisplay = vendorName ?? (parties !== "—" ? parties.slice(0, 8) : "—");

  return (
    <div className="wrap" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/contracts" className="lnk">Contracts</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
        <Link href="/contracts/list" className="lnk">List</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
        <span aria-current="page">{contractNo !== "—" ? contractNo : title}</span>
      </nav>

      <PageHeader title={title} back="/contracts/list" />

      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Contract Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Contract No.</div><div className="v">{contractNo}</div></div>
              <div className="fld"><div className="l">Party</div><div className="v">{partyDisplay}</div></div>
              {/* GAP-CONTRACTS-DETAIL-04: hide Type entirely when absent rather
                  than showing a meaningless "—" (contract-service has no type). */}
              {contractType !== "—" && (
                <div className="fld"><div className="l">Type</div><div className="v">{contractType}</div></div>
              )}
              <div className="fld"><div className="l">Value</div><div className="v">{valueDisplay}</div></div>
              <div className="fld">
                <div className="l">Status</div>
                {/* GAP-CONTRACTS-DETAIL-04: StatusPill maps approved->good,
                    terminated->bad, draft->mut, pending->warn — the old inline
                    `pill` class only coloured active/expired. */}
                <div className="v"><StatusPill status={contractStatus} /></div>
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
          {milestonesRes.source === "error" ? (
            <LoadErrorState result={{ status: milestonesRes.status }} area="milestones" />
          ) : milestonesRes.data.length === 0 ? (
            <EmptyState icon="📋" title="No milestones" message="No milestones on this contract." />
          ) : (
            <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
              {milestonesRes.data.map((m) => {
                const mStatus = String(m.status ?? "—");
                const due = typeof m.dueDate === "string" ? m.dueDate : undefined;
                const overdue = isOverdue(due, mStatus);
                return (
                  <li key={String(m.id)} style={{ fontSize: 13, marginBottom: 4 }}>
                    {String(m.title ?? "Milestone")} — <StatusPill status={mStatus} />
                    {/* GAP-CONTRACTS-DETAIL-05: show the due date and flag overdue. */}
                    {due ? <span style={{ color: "var(--ink2)" }}> · due {formatIndianDate(due)}</span> : null}
                    {overdue ? <> <StatusPill status="overdue" variant="bad" label="Overdue" /></> : null}
                  </li>
                );
              })}
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
          {bondsRes.source === "error" ? (
            <LoadErrorState result={{ status: bondsRes.status }} area="performance bonds" />
          ) : (
            <BondActions
              contractId={params.id}
              canRegister={statusLower === "active" || statusLower === "approved"}
              bonds={bondsRes.data.map((b) => ({
                id: String(b.id),
                referenceNo: typeof b.referenceNo === "string" ? b.referenceNo : undefined,
                status: String(b.status ?? "held"),
                amountMinor: b.amountMinor as string | number | undefined,
                bondType: typeof b.bondType === "string" ? b.bondType : undefined,
                validFrom: typeof b.validFrom === "string" ? b.validFrom : undefined,
                validTo: typeof b.validTo === "string" ? b.validTo : undefined,
              }))}
            />
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Obligations</h3></div>
        <div className="pad">
          {obligationsRes.source === "error" ? (
            <LoadErrorState result={{ status: obligationsRes.status }} area="obligations" />
          ) : (
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
          )}
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
    </div>
  );
}
