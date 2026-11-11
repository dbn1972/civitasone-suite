import Link from "next/link";
import { EmptyState, LoadErrorState, StatusPill, RecordHeader, DetailList } from "../../../_components/ds";
import { resolveRecordRefs } from "@/lib/records/recordRefs";
import { isUuid, nameLabel, personLabel } from "@/lib/records/labels";
import { isTerminalStatus, outcomeLine, raiseBlockedReason } from "@/lib/records/statusActions";
import { CONTRACT_STATUS_RULE, contractAllowedActions, contractLockedReason } from "@/lib/records/status/contract";
import { formatIndianDate } from "@/lib/formatters";
import { poHrefFromRef } from "@/lib/procurement-po-ref";
import { getTranslations } from "next-intl/server";
import { getContractById } from "../../../_data/loaders";
import { RaiseEOfficeNote } from "../../../_components/RaiseEOfficeNote";
import { getContractMilestones, getContractBonds, getContractObligations } from "../../../_data/loaders";
import { MilestoneActions } from "./MilestoneActions";
import { BondActions } from "./BondActions";
import { ObligationsPanel } from "./ObligationsPanel";
import { ContractLifecycleSection } from "./ContractLifecycleActions";
import { deriveContractDisplayFields } from "./page.helpers";
import { ArrowLeft } from "lucide-react";

const DAY_MS = 86_400_000;

function isDone(status: string): boolean {
  const s = status.toLowerCase();
  return s === "completed" || s === "completed_late";
}

function isOverdue(dueDate: string | undefined, status: string): boolean {
  if (!dueDate) return false;
  const s = status.toLowerCase();
  if (s === "completed" || s === "completed_late") return false;
  const ms = Date.parse(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  return ms < Date.now() - DAY_MS; // strictly before today (UTC day)
}

export default async function ContractDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const [{ data: contract, source, status }, milestonesRes, bondsRes, obligationsRes] =
    await Promise.all([
      getContractById(params.id),
      getContractMilestones(params.id),
      getContractBonds(params.id),
      getContractObligations(params.id),
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
    status: contractStatus, statusLower, description, valueDisplay, dept, amountMinor, poRef,
  } = deriveContractDisplayFields(contract);
  const t = await getTranslations("procurement.contractsPage");
  const poHref = poRef !== "—" ? poHrefFromRef(poRef) : null;

  // UX-R5 (names, not ids): one batched, tenant-scoped lookup for the vendor and the officers on this record.
  // contract-service stores the vendor as a raw vendorId and the maker / last actor as user ids.
  const createdBy = typeof contract.createdBy === "string" ? contract.createdBy : null;
  const updatedBy = typeof contract.updatedBy === "string" ? contract.updatedBy : null;
  const vendorId = isUuid(parties) ? parties : null;
  const refs = await resolveRecordRefs({ people: [createdBy, updatedBy], vendors: [vendorId] });
  const partyDisplay = parties === "—" ? "—" : nameLabel(refs.vendors, vendorId, vendorId ? null : parties);
  const raisedBy = createdBy ? personLabel(refs.people, createdBy) : null;

  // UX-R5 / DS-3: actions follow the contract state machine (lib/records/status/contract.ts).
  const allowed = contractAllowedActions(statusLower);
  const lockedReason = contractLockedReason(statusLower);
  const finished = isTerminalStatus(CONTRACT_STATUS_RULE, statusLower);
  const updatedAt = typeof contract.updatedAt === "string" ? contract.updatedAt : null;
  const outcome = finished
    ? outcomeLine({ status: statusLower, by: updatedBy ? personLabel(refs.people, updatedBy) : null, at: updatedAt })
    : null;

  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" data-dup-crumb style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/contracts" className="lnk">Contracts</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
        <Link href="/contracts/list" className="lnk">List</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
        <span aria-current="page">{contractNo !== "—" ? contractNo : title}</span>
      </nav>

      <RecordHeader
        kind="Contract"
        recordNo={contractNo !== "—" ? contractNo : null}
        subtitle={title}
        back="/contracts/list"
        backLabel="Contracts"
        status={contractStatus !== "—" ? contractStatus : null}
        amountMinor={amountMinor ?? null}
        amountLabel="Value"
        parties={[
          partyDisplay !== "—" ? { label: "Vendor", value: partyDisplay } : null,
          raisedBy ? { label: "Raised by", value: raisedBy } : null,
        ]}
        primaryAction={finished ? undefined : <ContractLifecycleSection contractId={params.id} status={statusLower} createdBy={createdBy} inline />}
        outcome={outcome}
      />

      <div className="card">
        <div className="card-h"><h2 style={{ fontSize: 15, margin: 0 }}>Contract details</h2></div>
        <div className="pad">
          <DetailList
            ariaLabel="Contract details"
            items={[
              { label: "Contract No.", value: contractNo !== "—" ? contractNo : null, mono: true },
              { label: "Vendor", value: partyDisplay !== "—" ? partyDisplay : null },
              // GAP-CONTRACTS-DETAIL-04: Type is hidden when contract-service has none.
              contractType !== "—" ? { label: "Type", value: contractType } : null,
              { label: "Value", value: valueDisplay !== "—" ? valueDisplay : null },
              // GAP-PROCUREMENT-CONTRACTS-05: the linked PO (uuid opens the order; free text as typed).
              poRef !== "—"
                ? { label: t("poColumn"), value: poHref ? <Link href={poHref} className="lnk">{t("viewPo")}</Link> : poRef }
                : null,
              { label: "Start date", value: startDate !== "—" ? formatIndianDate(startDate) : null },
              { label: "End date", value: endDate !== "—" ? formatIndianDate(endDate) : null },
            ]}
          />
        </div>
      </div>

      {description !== "—" && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-h"><h2 style={{ fontSize: 15, margin: 0 }}>Terms &amp; description</h2></div>
          <div className="pad">
            <p style={{ whiteSpace: "pre-wrap", color: "var(--ink2)", lineHeight: 1.6 }}>{description}</p>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Milestones</h3></div>
        <div className="pad">
          {milestonesRes.source === "error" ? (
            <LoadErrorState result={{ status: milestonesRes.status }} area="milestones" />
          ) : milestonesRes.data.length === 0 ? (
            <EmptyState icon="📋" title="No milestones" message="No milestones on this contract." />
          ) : (
            <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
              {/* UX-R5: each milestone is listed once -- open ones appear with their actions below. */}
              {milestonesRes.data.filter((m) => lockedReason || isDone(String(m.status ?? ""))).map((m) => {
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
          {lockedReason && milestonesRes.source !== "error" ? (
            <p data-testid="milestones-locked" style={{ margin: "0 0 4px", fontSize: 13, color: "var(--ink2)" }}>{lockedReason}</p>
          ) : null}
          <MilestoneActions
            contractId={params.id}
            milestones={milestonesRes.data.map((m) => ({
              id: String(m.id),
              title: String(m.title ?? "Milestone"),
              status: String(m.status ?? "pending"),
              dueDate: typeof m.dueDate === "string" ? m.dueDate : undefined,
              overdue: isOverdue(typeof m.dueDate === "string" ? m.dueDate : undefined, String(m.status ?? "")),
            }))}
            lockedReason={lockedReason}
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
              canRegister={allowed.has("registerBond")}
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
              lockedReason={lockedReason}
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
        statusAllowsRaise={allowed.has("raiseForApproval")}
        outcome={outcome ?? raiseBlockedReason(CONTRACT_STATUS_RULE, statusLower)}
        {...(amountMinor != null ? { amountMinor } : {})}
      />
    </div>
  );
}
