import { formatIndianDate, formatMoney } from "@/lib/formatters";

/**
 * GAP-HR-OUTSOURCED-01: pure mapping of the outsourced-contract register
 * (GET /v1/hrms/outsourced). contractValueMinor arrives as a PAISE string and is
 * only ever rendered through formatMoney -- never via Number()/float.
 */
export type ApiContract = {
  id: string;
  vendorName: string;
  serviceCategory: string;
  contractRef: string | null;
  headcount: number;
  contractStart: string;
  contractEnd: string;
  contractValueMinor: string;
  status: string;
  remarks?: string | null;
};

export type ApiStats = {
  contracts: number;
  vendors: number;
  activeContracts: number;
  expiringIn60Days: number;
  totalHeadcount: number;
};

export type ContractRow = {
  id: string;
  vendorName: string;
  serviceCategory: string;
  contractRef: string;
  headcount: number;
  period: string;
  contractValue: string;
  /** active | expired | terminated -- "expired" is an active contract whose end date has passed. */
  status: string;
  canTerminate: boolean;
} & Record<string, unknown>;

export function contractStatus(status: string, contractEnd: string, today: string): "active" | "expired" | "terminated" {
  if (status === "terminated") return "terminated";
  return contractEnd < today ? "expired" : "active";
}

export function mapContracts(items: readonly ApiContract[], today: string): ContractRow[] {
  return items.map((c) => {
    const status = contractStatus(c.status, c.contractEnd, today);
    return {
      id: c.id,
      vendorName: c.vendorName,
      serviceCategory: c.serviceCategory,
      contractRef: c.contractRef ?? "—",
      headcount: c.headcount,
      period: `${formatIndianDate(c.contractStart)} – ${formatIndianDate(c.contractEnd)}`,
      contractValue: formatMoney(c.contractValueMinor),
      status,
      canTerminate: c.status === "active",
    };
  });
}
