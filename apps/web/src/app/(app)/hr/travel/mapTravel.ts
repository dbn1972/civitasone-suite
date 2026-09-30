export type ApiTravelRow = {
  id: string;
  purpose: string;
  destination: string;
  from_date: string;
  to_date: string;
  advance_required: number | null;
  mode: string;
  status: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
};

export type ApiTravelTeamRow = ApiTravelRow & {
  employee_id: string;
  employeeName?: string;
};

export type Row = {
  id: string;
  destination: string;
  purpose: string;
  from_date: string;
  to_date: string;
  mode: string;
  status: string;
  // GAP-HR-TRAVEL-02: advance_required was fetched by the API all along but
  // never shown. Kept as a number (paise) for cellType:"amount"; null means
  // "no advance requested", not zero.
  advanceRequired: number | null;
  rejectionReason: string;
  // GAP-HR-TRAVEL-02: an approved request can be claimed as an expense
  // (social/routes.ts already accepts travelRequestId on POST /expenses).
  canClaim: boolean;
} & Record<string, unknown>;

export type TeamRow = Row & {
  employee: string;
};

export function mapTravel(rows: ApiTravelRow[]): Row[] {
  return rows.map((r) => ({
    id: r.id,
    destination: r.destination,
    purpose: r.purpose,
    from_date: r.from_date,
    to_date: r.to_date,
    mode: r.mode,
    status: r.status,
    advanceRequired: r.advance_required ?? null,
    rejectionReason: r.rejection_reason ?? "—",
    canClaim: r.status === "approved",
  }));
}

export function mapTravelTeam(rows: ApiTravelTeamRow[]): TeamRow[] {
  return mapTravel(rows).map((row, i) => ({
    ...row,
    employee: rows[i]!.employeeName ?? "Unknown employee",
  }));
}
