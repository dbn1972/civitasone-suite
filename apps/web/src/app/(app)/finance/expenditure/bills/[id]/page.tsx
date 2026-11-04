import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, Card, StatusPill, EmptyState, LoadErrorState, RecordHeader, DetailList, ApprovalTrail } from "../../../../../_components/ds";
import { getFinanceBillById } from "../../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { canWrite, BILL_APPROVE_ROLES, PAYMENT_RELEASE_ROLES } from "@/lib/finance/writeRoles";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { resolveRecordRefs } from "@/lib/records/recordRefs";
import { resolveLinkedRecord, type LinkedRecord } from "@/lib/records/linkedRecords";
import { nameLabel, personLabel } from "@/lib/records/labels";
import { isTerminalStatus, outcomeLine } from "@/lib/records/statusActions";
import { BILL_STATUS_RULE } from "@/lib/records/status/bill";
import { BillPassPayActions } from "../../../_components/FinanceActions";
import { ScannedDocumentsSection } from "../../../_components/scanned/ScannedDocumentsSection";
import { BillLineItemsTable } from "./BillLineItemsTable";

function RefLink({ link: r }: { link: LinkedRecord | null }) {
  if (!r) return <>—</>;
  return r.href ? <Link href={r.href}>{r.label}</Link> : <>{r.label}</>;
}

/**
 * Bill detail (UX-R5 record detail template): header with the bill number, status badge, net amount, payee and
 * lodging officer by name; the PO and GRN as business numbers linked to their records ("PO/2026/0025", never
 * "PO c78d6089"); one primary action (Pass bill / Release payment, gated by status and maker-checker) in the
 * header right; a paid or rejected bill shows its outcome instead.
 */
export default async function BillDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const t = await getTranslations("expenditureBillDetail");
  const result = await getFinanceBillById(params.id);
  const { data: bill } = result;

  if (!bill) {
    // A failed load is not "bill not found" (GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-01):
    // only a real 404 says the bill does not exist; 403 -> permission denied,
    // anything else -> retryable error state.
    if (result.source === "error" && result.status !== 404) {
      return (
        <>
          <PageHeader title={t("titleLoadFailed")} back="/finance/expenditure/bills" />
          <LoadErrorState result={result} area={t("areaBill")} backHref="/finance/expenditure/bills" />
        </>
      );
    }
    return (
      <>
        <PageHeader title={t("titleNotFound")} back="/finance/expenditure/bills" />
        <EmptyState icon="🧮" title={t("emptyTitleNotFound")} message={t("emptyMessageNotFound")} />
      </>
    );
  }

  const roles = getSessionRoles();
  // UX-R5: one batched lookup for the payee and the officers, in parallel with the linked PO / GRN numbers.
  const [refs, po, grn] = await Promise.all([
    resolveRecordRefs({ people: [bill.createdBy, bill.passedBy], vendors: [bill.vendorId] }),
    resolveLinkedRecord("po", bill.poRef, bill.poNumber),
    resolveLinkedRecord("grn", bill.grnRef),
  ]);
  const vendorLabel = nameLabel(refs.vendors, bill.vendorId, bill.vendor);
  const lodgedBy = bill.createdBy ? personLabel(refs.people, bill.createdBy) : null;
  const passedBy = bill.passedBy ? personLabel(refs.people, bill.passedBy) : null;
  const finished = isTerminalStatus(BILL_STATUS_RULE, bill.status);

  return (
    <>
      <RecordHeader
        kind="Bill"
        recordNo={bill.billNo}
        status={bill.status}
        amountMinor={bill.amount}
        amountLabel={t("amount")}
        parties={[
          { label: "Payee", value: vendorLabel },
          lodgedBy ? { label: "Lodged by", value: lodgedBy } : null,
        ]}
        outcome={finished ? outcomeLine({ status: bill.status, by: bill.status === "paid" ? null : passedBy }) : null}
        back="/finance/expenditure/bills"
        backLabel="Bills"
        primaryAction={
          finished ? undefined : (
            <BillPassPayActions
              id={params.id}
              status={bill.status}
              threeWayMatch={bill.threeWayMatch}
              canPass={canWrite(roles, BILL_APPROVE_ROLES)}
              canRelease={canWrite(roles, PAYMENT_RELEASE_ROLES)}
              // Maker-checker (GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-03): withhold what the server would 409.
              viewerId={getSessionUserId()}
              createdBy={bill.createdBy ?? null}
              passedBy={bill.passedBy ?? null}
            />
          )
        }
      />

      <Card title={t("cardTitleDetails")} padding>
        <DetailList
          ariaLabel={t("cardTitleDetails")}
          items={[
            { label: t("fieldPoRef"), value: <RefLink link={po} /> },
            { label: t("fieldGrnRef"), value: <RefLink link={grn} /> },
            { label: t("fieldInvoiceNo"), value: bill.invoiceNo ?? null },
            { label: t("fieldThreeWayMatch"), value: <StatusPill status={bill.threeWayMatch} /> },
            { label: t("fieldSubmitted"), value: formatIndianDate(bill.submittedDate) },
            { label: t("fieldDueDate"), value: bill.dueDate ? formatIndianDate(bill.dueDate) : null },
            { label: t("fieldPaymentRef"), value: bill.paymentRef ?? null },
          ]}
        />
      </Card>

      {bill.lineItems.length > 0 && (
        <Card title={t("cardTitleLineItems")}>
          <BillLineItemsTable
            rows={bill.lineItems as ({ description: string; quantity: number; unitPrice: number; amount: string; taxCode?: string } & Record<string, unknown>)[]}
          />
        </Card>
      )}

      <ApprovalTrail
        entries={[
          lodgedBy ? { key: "lodged", actor: lodgedBy, action: "Lodged" } : null,
          passedBy ? { key: "passed", actor: passedBy, action: "Passed for payment" } : null,
        ].filter((e): e is NonNullable<typeof e> => e !== null)}
      />

      <ScannedDocumentsSection kind="bills" id={params.id} backHref="/finance/expenditure/bills" />
    </>
  );
}
