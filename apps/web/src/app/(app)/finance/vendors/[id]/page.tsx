import { PageHeader, StatGrid, StatCard, StatusPill, Card, DataTable, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { RevealableValue } from "@/app/_components/ds/RevealableValue";
import { maskAccount, maskPan } from "@/app/_components/ds/Masked";
import { getFinanceActorNames, getFinanceVendorById } from "@/app/_data/loaders";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { bankLine, billTotals, minorOf } from "./vendorBills";
import { VendorStatusAction } from "../VendorStatusAction";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { canWrite, VENDOR_APPROVE_ROLES, VENDOR_PII_REVEAL_ROLES, VENDOR_WRITE_ROLES } from "@/lib/finance/writeRoles";
import { actorLabel } from "@/lib/finance/workflowTypes";
import { VendorApprovalActions } from "../VendorApprovalActions";
import { VendorBankChange, type PendingBankChange } from "../VendorBankChange";

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
}

/** Best-effort minor-unit amount from a loosely-typed record (number | numeric string | bigint). */
function rawStr(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  const v = field(data, ...keys);
  return v === "—" ? undefined : v;
}

/**
 * The API already returns PAN / account masked; this re-applies the (idempotent) mask so a full value
 * can never reach the DOM even if a future payload regressed. The clear value comes only from the
 * audited reveal endpoint.
 */
function maskedOrUndefined(v: string | undefined, mask: (s: string) => string): string | undefined {
  return v ? mask(v) : undefined;
}

function rawArray(data: Record<string, unknown>, ...keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const v = data[key];
    if (Array.isArray(v)) return v.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object");
  }
  return [];
}

// amount / tds stay raw paise strings (undefined when absent) so the DataTable formats and sorts them numerically.
type BillRow = { id?: string; billNo: string; date: string; amount?: string; tds?: string; status: string; [k: string]: unknown };

export default async function VendorDetailPage({ params }: { params: { id: string } }) {
  const result = await getFinanceVendorById(params.id);
  const { data: vendor } = result;

  if (!vendor) {
    // A failed load (5xx / 403 / network / schema) is NOT "not found": only a
    // real 404 (or a clean empty api response) says the vendor does not exist
    // (GAP-FINANCE-VENDORS-DETAIL-02).
    if (result.source === "error" && result.status !== 404) {
      return (
        <div className="page-main wrap" aria-labelledby="page-heading">
          <PageHeader title="Vendor Detail" back="/finance/vendors" />
          <LoadErrorState result={result} area="vendor" backHref="/finance/vendors" />
        </div>
      );
    }
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Vendor Detail" back="/finance/vendors" />
        <EmptyState icon="🏢" title="Vendor not found" message="This vendor may have been removed or the ID is invalid." />
      </div>
    );
  }

  const name = field(vendor, "name", "vendorName");
  const category = field(vendor, "category", "vendorCategory", "type");
  const status = field(vendor, "status");
  // "Registered Since" is only that when the API supplies it; otherwise the
  // record's creation date is shown under its own honest label.
  const registeredRaw = rawStr(vendor, "registeredSince");
  const registeredLabel = registeredRaw ? "Registered Since" : "Created";
  const registeredSince = formatIndianDate(registeredRaw ?? rawStr(vendor, "createdAt"));

  // Bill history isn't guaranteed on the vendor payload — read it defensively and
  // derive the summary stats from the same raw rows so they never drift from the table.
  const rawBills = rawArray(vendor, "bills", "billHistory");
  const bills: BillRow[] = rawBills.map((b) => {
    const amt = minorOf(b, "amountMinor", "amount");
    const tds = minorOf(b, "tdsMinor", "tds");
    const billId = field(b, "id");
    return {
      ...(billId !== "—" ? { id: billId } : {}),
      billNo: field(b, "billNo", "billNumber", "referenceId"),
      date: field(b, "date", "billDate"),
      ...(amt !== undefined ? { amount: amt.toString() } : {}),
      ...(tds !== undefined ? { tds: tds.toString() } : {}),
      status: field(b, "status"),
    };
  });
  // GAP-FINANCE-VENDORS-DETAIL-03: "Total Paid (initiated)" / TDS count bills with status paid only (payment initiated);
  // pending / rejected bills show up under "Total Billed".
  const totals = billTotals(rawBills);
  const money = (m: bigint | undefined) => (m !== undefined ? formatMoney(m) : "—");

  // fp-finance-02: approval + bank-change workflow context. Names are resolved server-side (a raw id is
  // never shown); PAN / account / phone / email arrive MASKED from the API and are revealed only
  // through the audited reveal endpoint.
  const roles = getSessionRoles();
  const me = getSessionUserId();
  const v = vendor as Record<string, unknown>;
  const createdBy = typeof v.createdBy === "string" ? v.createdBy : null;
  const approvedBy = typeof v.approvedBy === "string" ? v.approvedBy : null;
  const pendingRaw = v.pendingBankChange && typeof v.pendingBankChange === "object" ? (v.pendingBankChange as Record<string, string>) : null;
  const names = await getFinanceActorNames([createdBy, approvedBy, pendingRaw?.proposedBy]);
  const canReveal = canWrite(roles, VENDOR_PII_REVEAL_ROLES);
  const isPending = status.toLowerCase() === "pending";
  const isDecided = status.toLowerCase() === "active" || status.toLowerCase() === "inactive";
  const pendingChange: PendingBankChange | null = pendingRaw
    ? {
        id: pendingRaw.id ?? "",
        bankName: pendingRaw.bankName ?? "",
        ifsc: pendingRaw.ifsc ?? "",
        accountMasked: pendingRaw.accountMasked ?? "",
        reason: pendingRaw.reason ?? "",
        proposedByName: actorLabel(pendingRaw.proposedBy, names),
        proposedAtLabel: formatIndianDate(pendingRaw.proposedAt),
        proposedByMe: !!me && pendingRaw.proposedBy === me,
      }
    : null;
  const reveal = (fieldKey: "pan" | "bankAccount" | "phone" | "email", masked: string | undefined, label: string) => (
    <RevealableValue
      maskedText={masked ?? ""}
      revealPath={`v1/finance/vendors/${params.id}/reveal`}
      revealBody={{ fields: [fieldKey] }}
      pick={(json) => (json as { values?: Record<string, string | null> })?.values?.[fieldKey]}
      canReveal={canReveal}
      label={label}
      fallback="—"
    />
  );

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={name}
        subtitle={category !== "—" ? category : undefined}
        back="/finance/vendors"
        actions={
          isPending && canWrite(roles, VENDOR_APPROVE_ROLES) ? (
            <VendorApprovalActions id={params.id} name={name} createdByMe={!!me && createdBy === me} version={typeof v.version === "number" ? v.version : 0} />
          ) : typeof (vendor as Record<string, unknown>).version === "number" && isDecided && canWrite(roles, VENDOR_WRITE_ROLES) ? (
            <VendorStatusAction
              id={params.id}
              version={(vendor as Record<string, unknown>).version as number}
              isActive={status.toLowerCase() === "active"}
              name={name}
            />
          ) : null
        }
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Total Bills" value={rawBills.length} />
        <StatCard icon="🧾" iconBg="#eff6ff" label="Total Billed" value={money(totals.billedMinor)} />
        <StatCard icon="₹" iconBg="#ecfdf3" label="Total Paid (initiated)" value={money(totals.paidMinor)} />
        <StatCard icon="🧮" iconBg="#fffaeb" label="TDS Deducted (initiated payments)" value={money(totals.tdsOnPaidMinor)} />
      </StatGrid>

      <Card title="Vendor Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Name</span><span>{name}</span></div>
          <div className="field"><span className="label">PAN</span>{reveal("pan", maskedOrUndefined(rawStr(vendor, "pan", "panNumber"), maskPan), "PAN")}</div>
          <div className="field"><span className="label">GSTIN</span><span className="mono">{field(vendor, "gstin", "gstNumber")}</span></div>
          <div className="field"><span className="label">Category</span><span>{category}</span></div>
          <div className="field"><span className="label">Address</span><span>{field(vendor, "address", "registeredAddress")}</span></div>
          <div className="field"><span className="label">Contact Person</span><span>{field(vendor, "contactPerson", "contactName")}</span></div>
          <div className="field"><span className="label">Email</span>{reveal("email", rawStr(vendor, "email", "contactEmail"), "email")}</div>
          <div className="field"><span className="label">Phone</span>{reveal("phone", rawStr(vendor, "phone", "contactPhone", "mobile"), "phone number")}</div>
          <div className="field"><span className="label">Bank</span><span>{bankLine(field(vendor, "bankName", "bank"), field(vendor, "ifsc", "ifscCode"))}</span></div>
          <div className="field"><span className="label">Account</span>{reveal("bankAccount", maskedOrUndefined(rawStr(vendor, "bankAccount", "accountNumber", "accountNo"), maskAccount), "account number")}</div>
          <div className="field"><span className="label">{registeredLabel}</span><span>{registeredSince}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={status} /></div>
          <div className="field"><span className="label">Created by</span><span>{actorLabel(createdBy, names)}</span></div>
          {approvedBy ? (
            <div className="field"><span className="label">Approved by</span><span>{actorLabel(approvedBy, names)}{rawStr(vendor, "approvedAt") ? ` · ${formatIndianDate(rawStr(vendor, "approvedAt"))}` : ""}</span></div>
          ) : null}
          {rawStr(vendor, "decisionReason") ? (
            <div className="field"><span className="label">Decision note</span><span>{rawStr(vendor, "decisionReason")}</span></div>
          ) : null}
        </div>
        {isDecided ? (
          <VendorBankChange
            vendorId={params.id}
            vendorName={name}
            pending={pendingChange}
            canPropose={canWrite(roles, VENDOR_WRITE_ROLES)}
            canDecide={canWrite(roles, VENDOR_APPROVE_ROLES)}
          />
        ) : null}
      </Card>

      <Card title="Bill History">
        <DataTable<BillRow>
          columns={[
            { key: "billNo", label: "Bill No" },
            { key: "date", label: "Date", cellType: "date" },
            { key: "amount", label: "Amount", align: "right", cellType: "amount" },
            { key: "tds", label: "TDS", align: "right", cellType: "amount" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={bills}
          // Each bill id is the finance bill id the expenditure bill detail route takes.
          rowLinkKey="id"
          rowLinkPrefix="/finance/expenditure/bills/"
          sortable
          pageSize={15}
          emptyIcon="📋"
          emptyTitle="No bills yet"
          emptyMessage="No bills have been recorded for this vendor."
        />
      </Card>
    </div>
  );
}
