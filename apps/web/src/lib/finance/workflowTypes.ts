/** Wire shapes of the fp-finance-02 finance detail extras (read by the loaders, rendered by the pages). */

export type PaymentContext = {
  beneficiary: { vendorId: string; name: string } | null;
  bill: { id: string; billNo: string } | null;
  approvedBy: string | null;
  events: { status: string; actorId: string | null; note: string | null; at: string }[];
};

export type AuditParaEvent = {
  id: string;
  action: "respond" | "escalate" | "settle";
  fromStatus: string;
  toStatus: string;
  note: string;
  actorId: string;
  createdAt: string;
};

export type GlLinesTotals = {
  entryLines: number;
  vouchers: number;
  accountsActive: number;
  debitMinor: string;
  creditMinor: string;
};

export type GlLinesPagination = { limit: number; offset: number; total: number; hasMore: boolean };

/** Display name for an actor id: a resolved name, else a short "User 1a2b3c4d" -- never a raw UUID. */
export function actorLabel(id: string | null | undefined, names: Record<string, string>): string {
  if (!id) return "—";
  const name = names[id];
  if (name) return name;
  return /^[0-9a-f]{8}-/i.test(id) ? `User ${id.slice(0, 8)}` : id;
}
