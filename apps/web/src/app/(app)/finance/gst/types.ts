export type SummaryRow = {
  gst_type: string;
  direction: "input" | "output";
  total_taxable: string | number;
  total_tax: string | number;
  transaction_count: number;
} & Record<string, unknown>;

export type LedgerRow = {
  id: string;
  invoice_id: string;
  /** True when invoice_id is a bill of this tenant (finance-service verified), so it can be linked. */
  invoice_is_bill?: boolean;
  invoice_no: string;
  invoice_date: string;
  party_gstin: string;
  party_name: string;
  gst_type: string;
  direction: string;
  taxable_minor: string | number;
  tax_minor: string | number;
  rate_pct: string | number;
  hsn_code: string;
  period: string;
  status: string;
  created_at: string;
} & Record<string, unknown>;

export type ItcRow = {
  gst_type: string;
  itc_available: string | number;
  output_liability: string | number;
  net_payable: string | number;
} & Record<string, unknown>;

export type GstSource = "api" | "error";
