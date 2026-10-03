/**
 * GAP-HR-TRANSFER-02: validation for the Issue Order form. The order number is
 * the department's own order-register number, typed by the issuing officer (it
 * becomes the service-book document reference) -- never generated here.
 *
 * The pattern mirrors services/hrms-service lifecycle/validators.ts
 * ORDER_NO_PATTERN; the server re-validates and also enforces uniqueness.
 */
export const ORDER_NO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,63}$/;

export type IssueOrderForm = { orderNo: string; orderDate: string; orderRef: string };

export type IssueOrderError = "orderNoRequired" | "orderNoFormat" | "orderDateRequired" | "orderDateFuture";

/** `todayIst` is the IST calendar date (YYYY-MM-DD). Returns every problem, in field order. */
export function validateIssueOrder(f: IssueOrderForm, todayIst: string): IssueOrderError[] {
  const errors: IssueOrderError[] = [];
  const no = f.orderNo.trim();
  if (!no) errors.push("orderNoRequired");
  else if (!ORDER_NO_PATTERN.test(no)) errors.push("orderNoFormat");
  if (!f.orderDate) errors.push("orderDateRequired");
  else if (f.orderDate > todayIst) errors.push("orderDateFuture");
  return errors;
}

/** The exact body POSTed to issue-order: only what the officer typed, trimmed; optional ref omitted when blank. */
export function toIssueOrderBody(f: IssueOrderForm): Record<string, string> {
  const body: Record<string, string> = { orderNo: f.orderNo.trim(), orderDate: f.orderDate };
  if (f.orderRef.trim()) body.orderRef = f.orderRef.trim();
  return body;
}
