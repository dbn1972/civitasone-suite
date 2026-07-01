import { pino } from "pino";

const log = pino({ name: "nic-ewb-client" });

export interface GenerateEwbPayload {
  supplyType: string;
  subSupplyType: string;
  docType: string;
  docNo: string;
  docDate: string;
  fromGstin: string;
  fromName: string;
  fromAddr: string;
  fromPin: string;
  fromStateCode: string;
  toGstin?: string | undefined;
  toName: string;
  toAddr: string;
  toPin: string;
  toStateCode: string;
  totalValue: number; // in rupees (converted from paise)
  hsnCode: string;
  transportMode?: string | undefined;
  vehicleNo?: string | undefined;
  transporterId?: string | undefined;
}

export interface GenerateEwbResponse {
  ewbNo: string;
  validUpto: string; // ISO datetime
  ewbDate: string;   // ISO datetime
}

export interface CancelEwbResponse {
  ewbNo: string;
  cancelDate: string;
}

export interface UpdateVehicleResponse {
  ewbNo: string;
  vehicleNo: string;
  validUpto: string;
}

export interface GetEwbResponse {
  ewbNo: string;
  status: string;
  validUpto: string;
  ewbDate: string;
}

const EWB_API_URL  = process.env.EWB_API_URL ?? "mock";
const EWB_USERNAME = process.env.EWB_USERNAME ?? "";
const EWB_PASSWORD = process.env.EWB_PASSWORD ?? "";
const EWB_GSTIN   = process.env.EWB_GSTIN ?? "";

function isMockMode(): boolean {
  return EWB_API_URL === "mock" || !EWB_API_URL.startsWith("https://");
}

function deterministicEwbNo(docNo: string): string {
  // Format: 1234567890XX — deterministic for testing
  const hash = docNo.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const suffix = String(hash % 100).padStart(2, "0");
  return `1234567890${suffix}`;
}

function mockValidUpto(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1); // valid for 24h
  return d.toISOString();
}

async function nicRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  const url = `${EWB_API_URL}${path}`;
  log.info({ url, method }, "NIC EWB API request");

  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "gstin": EWB_GSTIN,
      "username": EWB_USERNAME,
      "password": EWB_PASSWORD,
    },
  };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NIC EWB API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

export async function generateEwb(payload: GenerateEwbPayload): Promise<GenerateEwbResponse> {
  if (isMockMode()) {
    const ewbNo = deterministicEwbNo(payload.docNo);
    log.info({ ewbNo, mode: "mock" }, "mock generateEwb");
    return {
      ewbNo,
      validUpto: mockValidUpto(),
      ewbDate: new Date().toISOString(),
    };
  }

  return nicRequest<GenerateEwbResponse>("/ewayapi/Generate", "POST", {
    supplyType: payload.supplyType === "outward" ? "O" : "I",
    subSupplyType: mapSubSupplyType(payload.subSupplyType),
    docType: mapDocType(payload.docType),
    docNo: payload.docNo,
    docDate: formatNicDate(payload.docDate),
    fromGstin: payload.fromGstin,
    fromTrdName: payload.fromName,
    fromAddr1: payload.fromAddr,
    fromPin: Number(payload.fromPin),
    fromStateCode: Number(payload.fromStateCode),
    toGstin: payload.toGstin ?? "URP",
    toTrdName: payload.toName,
    toAddr1: payload.toAddr,
    toPin: Number(payload.toPin),
    toStateCode: Number(payload.toStateCode),
    totalValue: payload.totalValue,
    hsnCode: payload.hsnCode,
    transportMode: mapTransportMode(payload.transportMode),
    vehicleNo: payload.vehicleNo,
    transporterId: payload.transporterId,
  });
}

export async function cancelEwb(ewbNo: string, reason: string): Promise<CancelEwbResponse> {
  if (isMockMode()) {
    log.info({ ewbNo, mode: "mock" }, "mock cancelEwb");
    return { ewbNo, cancelDate: new Date().toISOString() };
  }

  return nicRequest<CancelEwbResponse>("/ewayapi/Cancel", "POST", {
    ewbNo,
    cancelRsnCode: 1,
    cancelRmrk: reason,
  });
}

export async function updateVehicle(
  ewbNo: string,
  vehicleNo: string,
  mode?: string,
): Promise<UpdateVehicleResponse> {
  if (isMockMode()) {
    log.info({ ewbNo, vehicleNo, mode: "mock" }, "mock updateVehicle");
    return { ewbNo, vehicleNo, validUpto: mockValidUpto() };
  }

  return nicRequest<UpdateVehicleResponse>("/ewayapi/UpdateVehicle", "POST", {
    ewbNo,
    vehicleNo,
    fromPlace: "",
    fromState: 0,
    reasonCode: "1",
    reasonRem: "vehicle update",
    transDocNo: "",
    transDocDate: "",
    transMode: mapTransportMode(mode),
  });
}

export async function getEwb(ewbNo: string): Promise<GetEwbResponse> {
  if (isMockMode()) {
    log.info({ ewbNo, mode: "mock" }, "mock getEwb");
    return {
      ewbNo,
      status: "active",
      validUpto: mockValidUpto(),
      ewbDate: new Date().toISOString(),
    };
  }

  return nicRequest<GetEwbResponse>(`/ewayapi/GetEwayBill?ewbNo=${ewbNo}`, "GET");
}

// --- NIC format helpers ---

function mapSubSupplyType(sub: string): number {
  const map: Record<string, number> = {
    supply: 1, export: 3, job_work: 4, for_own_use: 9, sales_return: 10, others: 12,
  };
  return map[sub] ?? 12;
}

function mapDocType(doc: string): number {
  const map: Record<string, number> = {
    invoice: 1, bill: 2, challan: 3, credit_note: 4, others: 5,
  };
  return map[doc] ?? 5;
}

function mapTransportMode(mode?: string): string {
  const map: Record<string, string> = { road: "1", rail: "2", air: "3", ship: "4" };
  return map[mode ?? "road"] ?? "1";
}

function formatNicDate(isoDate: string): string {
  // NIC expects dd/MM/yyyy
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}
