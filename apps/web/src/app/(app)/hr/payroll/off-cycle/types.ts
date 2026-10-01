/**
 * Wire row of GET /v1/payroll/off-cycle (payroll-service gap-routes.ts).
 * GAP-PAYROLL-OFF-CYCLE-06: moved here from the dead OffCycleList.tsx (whose
 * table + Process button were never rendered) so the card view and page
 * no longer import a dead component just for its type.
 */
export type OffCycleRow = {
  id: string;
  run_type: string;
  period: string;
  description: string | null;
  total_amount_minor: number | string;
  total_tax_minor: number | string | null;
  total_net_minor: number | string | null;
  status: string;
  created_at: string;
  /** GAP-PAYROLL-OFF-CYCLE-02: number of items (employees) in the run. */
  employee_count?: number | null;
} & Record<string, unknown>;
