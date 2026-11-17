import { NonRetryableError } from "@civitasone/queue";
import type { CoaTemplate } from "@civitasone/tenant-profile";
import { HoaError } from "../../shared/hoa.js";
import { headNatureOf } from "../../shared/head-nature.js";
import { assertValidHoAWithMaster } from "../hoa/domain.js";
import { ddoExists, paoExists } from "../masters/repo.js";
import { hasChildHeadsTx } from "../budget/repo.js";

type HoaReader = Parameters<typeof assertValidHoAWithMaster>[1];
type ChildTx = Parameters<typeof hasChildHeadsTx>[0];

export type BillHeadInput = {
  /** The tenant chart template (gl.finance_settings.coa_template, via resolveCoaTemplateTx). Data key, never an edition. */
  coaTemplate: CoaTemplate;
  tenantId: string;
  head: { id: string; code: string; classification: string | null; isControl?: boolean | null; hoaCode: string | null };
  /** govt only: the resolved DDO / optional PAO the bill is drawn on. */
  ddoCode: string | null;
  paoCode?: string | null | undefined;
  reader: HoaReader;
};

/**
 * Segment Phase B3: validate the head a bill is posted to, keyed on the tenant COA template.
 * - govt: exactly the pre-B3 checks, in the same order: HoA well-formed + major head in master, DDO in master, PAO in master.
 * - commercial / nonprofit: no HoA, DDO or PAO requirement. The head must be a LEAF EXPENSE head and not a control account
 *   (same leaf / nature / control rules as the grants bank-head check).
 * Every refusal is a NonRetryableError (a redelivery cannot fix it).
 */
export async function assertBillHeadValid(i: BillHeadInput): Promise<void> {
  if (i.coaTemplate === "govt") {
    try { await assertValidHoAWithMaster(i.head.hoaCode, i.reader); }
    catch (e) { throw e instanceof HoaError ? new NonRetryableError(e.message) : e; }
    const ddo = (i.ddoCode ?? "").toUpperCase();
    if (!(await ddoExists(i.tenantId, ddo, i.reader as Parameters<typeof ddoExists>[2]))) {
      throw new NonRetryableError(`UNKNOWN_DDO: ${i.ddoCode} not found in DDO master`);
    }
    if (i.paoCode && !(await paoExists(i.tenantId, i.paoCode.toUpperCase(), i.reader as Parameters<typeof paoExists>[2]))) {
      throw new NonRetryableError(`UNKNOWN_PAO: ${i.paoCode} not found in PAO master`);
    }
    return;
  }
  const refusal = nonGovtBillHeadRefusal(i.head, await hasChildHeadsTx(i.reader as unknown as ChildTx, i.head.id));
  if (refusal) throw new NonRetryableError(`${refusal.code}: ${refusal.message}`);
}

/**
 * The non-govt bill-head rule, ONE definition shared by the consumer (assertBillHeadValid) and the POST /v1/finance/bills
 * route, so the two cannot diverge: a leaf expense head that is not a control account. PURE; null = usable.
 */
export function nonGovtBillHeadRefusal(
  head: { code: string; classification: string | null; isControl?: boolean | null },
  hasChildren: boolean,
): { code: "BILL_HEAD_INVALID"; message: string } | null {
  if (headNatureOf(head.code, head.classification) !== "expense") return { code: "BILL_HEAD_INVALID", message: `head ${head.code} must be an expense head` };
  if (head.isControl) return { code: "BILL_HEAD_INVALID", message: `head ${head.code} is a control account and cannot take a bill` };
  if (hasChildren) return { code: "BILL_HEAD_INVALID", message: `head ${head.code} is a group account; choose a leaf head` };
  return null;
}
