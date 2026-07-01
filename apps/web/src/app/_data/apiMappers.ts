import type {
  AssetDetail,
  AssetSummary,
  DealSummary,
  EstabFileSummary,
  IndentDetail,
  IndentSummary,
  GRNDetail,
  GRNSummary,
  LegalCaseSummary,
  MaintenanceSummary,
  PODetail,
  PurchaseOrderListItem,
  StockItemDetail,
  StockItemSummary,
  StockLedgerEntry,
  TicketDetail,
  UserSummary,
  VendorDetail,
  VendorSummary,
  PurchaseOrderSummary,
  TenantUserSummary,
  CRMDealSummary,
} from "@civitasone/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getArrayPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  if (isRecord(payload) && Array.isArray(payload.items)) return payload.items;
  return null;
}

export function parseMinor(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function parsePaiseFromDisplay(display: string | null): number {
  if (!display) return 0;
  const digits = display.replace(/[^\d.]/g, "");
  const rupees = parseFloat(digits);
  return Number.isFinite(rupees) ? Math.round(rupees * 100) : 0;
}

function slugCode(name: string, fallback: string): string {
  const slug = name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 12).toUpperCase();
  return slug || fallback.slice(0, 8).toUpperCase();
}

export function mapProcurementPOListItems(payload: unknown): PurchaseOrderListItem[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: PurchaseOrderListItem[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const poNo = toText(row.poNo) ?? id;
    const vendor = toText(row.vendor) ?? toText(row.vendorName) ?? "—";
    const amount =
      typeof row.amount === "number"
        ? row.amount
        : parseMinor(row.totalMinor) || parsePaiseFromDisplay(toText(row.amountDisplay));
    const orderDate = toText(row.orderDate) ?? toText(row.createdAt)?.slice(0, 10) ?? "—";
    const raw = (toText(row.status) ?? "draft").toLowerCase();
    const status: PurchaseOrderListItem["status"] =
      raw === "approved" ? "approved"
        : raw === "pending" ? "pending"
          : raw === "dispatched" ? "dispatched"
            : raw === "partial_grn" ? "partial_grn"
              : raw === "fully_received" ? "fully_received"
                : raw === "cancelled" ? "cancelled"
                  : raw === "gem_placed" ? "gem_placed"
                    : raw === "review" ? "draft"
                      : "draft";
    if (!id || !poNo) continue;
    mapped.push({
      id,
      poNo,
      vendor,
      amount,
      orderDate,
      deliveryDate: toText(row.deliveryDate) ?? undefined,
      grnStatus: toText(row.grnStatus) ?? undefined,
      status,
    });
  }
  return mapped;
}

export function mapProcurementVendorDetails(payload: unknown): VendorDetail[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: VendorDetail[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const name = toText(row.name);
    if (!name) continue;
    const id = toText(row.id) ?? name;
    const category = toText(row.category) ?? toText(row.vendorType) ?? "General";
    const rawEmp = (toText(row.empanelmentStatus) ?? toText(row.vendorType) ?? "registered").toLowerCase();
    const empanelmentStatus: VendorDetail["empanelmentStatus"] =
      rawEmp.includes("black") ? "blacklisted"
        : rawEmp.includes("provis") ? "provisional"
          : rawEmp.includes("empanel") || rawEmp === "registered" ? "empanelled"
            : "not_empanelled";
    mapped.push({
      id,
      vendorCode: toText(row.vendorCode) ?? slugCode(name, id),
      name,
      gstin: toText(row.gstin) ?? undefined,
      panNo: toText(row.pan) ?? toText(row.panNo) ?? undefined,
      category,
      empanelmentStatus,
      rating: typeof row.rating === "number" ? row.rating : undefined,
      contactPerson: toText(row.contactPerson) ?? undefined,
      email: toText(row.email) ?? undefined,
      phone: toText(row.phone) ?? undefined,
      kycStatus: toText(row.kycStatus) ?? undefined,
      kycVerifiedAt: toText(row.kycVerifiedAt) ?? null,
    });
  }
  return mapped;
}

export function mapProcurementIndentSummaries(payload: unknown): IndentSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: IndentSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const indentNo = toText(row.indentNo) ?? id;
    if (!id || !indentNo) continue;
    const rawStatus = (toText(row.status) ?? "pending_approval").toLowerCase();
    const status: IndentSummary["status"] =
      rawStatus === "approved" ? "approved"
        : rawStatus === "rejected" ? "rejected"
          : rawStatus === "draft" ? "draft"
            : rawStatus === "converted_to_po" ? "converted_to_po"
              : rawStatus === "pending" ? "pending_approval"
                : "pending_approval";
    mapped.push({
      id,
      indentNo,
      requestedBy: toText(row.requestedBy) ?? toText(row.createdBy)?.slice(0, 8) ?? "—",
      department: toText(row.department) ?? "—",
      itemCount: typeof row.itemCount === "number" ? row.itemCount : 1,
      estimatedAmount: parseMinor(row.totalMinor) || parseMinor(row.estimatedAmount),
      requestDate: toText(row.indentDate) ?? toText(row.requestDate) ?? toText(row.createdAt)?.slice(0, 10) ?? "—",
      requiredByDate: toText(row.requiredBy) ?? toText(row.requiredByDate) ?? undefined,
      status,
    });
  }
  return mapped;
}

export function mapProcurementIndentDetail(payload: unknown): IndentDetail | null {
  const summaries = mapProcurementIndentSummaries(Array.isArray(payload) ? payload : payload ? [payload] : []);
  if (!summaries?.[0]) return null;
  const base = summaries[0];
  if (!isRecord(payload)) return { ...base, lineItems: [], approvalTrail: [] };

  const lineItems: IndentDetail["lineItems"] = [];
  const rawItems = Array.isArray(payload.lineItems) ? payload.lineItems : Array.isArray(payload.items) ? payload.items : [];
  for (const item of rawItems) {
    if (!isRecord(item)) continue;
    const qty = typeof item.quantity === "number" ? item.quantity : 1;
    const unitPrice = parseMinor(item.estimatedUnitPrice) || parseMinor(item.unitPriceMinor);
    lineItems.push({
      itemCode: toText(item.itemCode) ?? "—",
      itemName: toText(item.itemName) ?? toText(item.description) ?? "—",
      quantity: qty,
      unit: toText(item.unit) ?? "nos",
      estimatedUnitPrice: unitPrice,
      totalPrice: parseMinor(item.totalPrice) || unitPrice * qty,
    });
  }

  const approvalTrail: IndentDetail["approvalTrail"] = [];
  const rawTrail = Array.isArray(payload.approvalTrail) ? payload.approvalTrail : [];
  for (const step of rawTrail) {
    if (!isRecord(step)) continue;
    const actor = toText(step.actor);
    const action = toText(step.action);
    const timestamp = toText(step.timestamp);
    if (!actor || !action || !timestamp) continue;
    approvalTrail.push({
      actor,
      action,
      timestamp,
      remarks: toText(step.remarks) ?? undefined,
    });
  }

  return { ...base, lineItems, approvalTrail };
}

export function mapProcurementVendorDetail(payload: unknown): VendorDetail | null {
  const list = mapProcurementVendorDetails(payload ? [payload] : []);
  if (!list?.[0]) return null;
  const base = list[0];
  if (!isRecord(payload)) return base;
  return {
    ...base,
    email: toText(payload.email) ?? base.email,
    phone: toText(payload.phone) ?? base.phone,
    address: toText(payload.address) ?? undefined,
    bankAccountNo: toText(payload.bankAccount) ?? toText(payload.bankAccountNo) ?? undefined,
    ifscCode: toText(payload.ifsc) ?? toText(payload.ifscCode) ?? undefined,
  };
}

function normalizePoStatus(raw: string | null): PODetail["status"] {
  const key = (raw ?? "draft").toLowerCase();
  if (key === "pending") return "pending";
  if (key === "approved") return "approved";
  if (key === "dispatched") return "dispatched";
  if (key === "partial_grn" || key === "partial") return "partial_grn";
  if (key === "fully_received" || key === "received") return "fully_received";
  if (key === "cancelled" || key === "rejected") return "cancelled";
  return "draft";
}

export function mapProcurementPODetail(payload: unknown): PODetail | null {
  if (!isRecord(payload)) return null;
  const id = toText(payload.id);
  const poNo = toText(payload.poNo) ?? id;
  if (!id || !poNo) return null;

  const lineItems: PODetail["lineItems"] = [];
  const rawItems = Array.isArray(payload.lineItems) ? payload.lineItems : Array.isArray(payload.items) ? payload.items : [];
  for (const item of rawItems) {
    if (!isRecord(item)) continue;
    const qty = typeof item.quantity === "number" ? item.quantity : 1;
    const unitPrice = parseMinor(item.unitPrice) || parseMinor(item.unitPriceMinor);
    lineItems.push({
      itemCode: toText(item.itemCode) ?? "—",
      itemName: toText(item.itemName) ?? toText(item.description) ?? "—",
      quantity: qty,
      unit: toText(item.unit) ?? "nos",
      unitPrice,
      totalPrice: parseMinor(item.totalPrice) || unitPrice * qty,
      grnQty: typeof item.grnQty === "number" ? item.grnQty : 0,
    });
  }

  return {
    id,
    poNo,
    vendor: toText(payload.vendor) ?? toText(payload.vendorName) ?? "—",
    vendorId: toText(payload.vendorId) ?? undefined,
    orderDate: toText(payload.orderDate) ?? toText(payload.createdAt)?.slice(0, 10) ?? "—",
    deliveryDate: toText(payload.deliveryDate) ?? undefined,
    totalAmount: parseMinor(payload.totalAmount) || parseMinor(payload.totalMinor),
    status: normalizePoStatus(toText(payload.status)),
    lineItems,
  };
}

const GRN_STATUSES = new Set(["draft", "received", "quality_check", "accepted", "partially_rejected", "rejected"]);

function normalizeGrnStatus(raw: string | null): GRNSummary["status"] {
  const key = (raw ?? "draft").toLowerCase();
  return GRN_STATUSES.has(key) ? key as GRNSummary["status"] : "draft";
}

export function mapProcurementGRNSummaries(payload: unknown): GRNSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: GRNSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const grnNo = toText(row.grnNo) ?? id;
    if (!id || !grnNo) continue;
    mapped.push({
      id,
      grnNo,
      poRef: toText(row.poRef) ?? "—",
      vendor: toText(row.vendor) ?? "—",
      receivedDate: toText(row.receivedDate) ?? "—",
      receivedBy: toText(row.receivedBy) ?? "—",
      itemCount: typeof row.itemCount === "number" ? row.itemCount : 0,
      totalValue: typeof row.totalValue === "number" ? row.totalValue : parseMinor(row.totalValue),
      status: normalizeGrnStatus(toText(row.status)),
      threeWayMatch: typeof row.threeWayMatch === "boolean" ? row.threeWayMatch : undefined,
    });
  }
  return mapped;
}

export function mapProcurementGRNDetail(payload: unknown): GRNDetail | null {
  if (!isRecord(payload)) return null;
  const summaries = mapProcurementGRNSummaries([payload]);
  if (!summaries?.[0]) return null;
  const base = summaries[0];
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items: GRNDetail["items"] = [];
  for (const item of rawItems) {
    if (!isRecord(item)) continue;
    items.push({
      id: toText(item.id) ?? undefined,
      poItemRef: toText(item.poItemRef) ?? "—",
      itemCode: toText(item.itemCode) ?? "—",
      orderedQty: typeof item.orderedQty === "number" ? item.orderedQty : 0,
      receivedQty: typeof item.receivedQty === "number" ? item.receivedQty : 0,
      acceptedQty: typeof item.acceptedQty === "number" ? item.acceptedQty : 0,
      unit: toText(item.unit) ?? "nos",
    });
  }
  const insp = isRecord(payload.inspection) ? payload.inspection : null;
  return {
    ...base,
    vendorId: toText(payload.vendorId) ?? undefined,
    notes: toText(payload.notes) ?? undefined,
    threeWayMatch: typeof payload.threeWayMatch === "boolean" ? payload.threeWayMatch : base.threeWayMatch ?? false,
    items,
    inspection: insp
      ? {
          inspectorId: toText(insp.inspectorId) ?? "—",
          inspectionDate: toText(insp.inspectionDate) ?? "—",
          result: toText(insp.result) ?? "pending",
          remarks: toText(insp.remarks) ?? undefined,
        }
      : null,
  };
}

const DEAL_STAGES = new Set(["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"]);

function normalizeDealStage(raw: string | null): DealSummary["stage"] | null {
  if (!raw) return null;
  const key = raw.trim();
  const lower = key.toLowerCase().replace(/\s+/g, "_");
  // Handle exact matches
  if (DEAL_STAGES.has(lower)) return lower as DealSummary["stage"];
  // Handle PascalCase/legacy variants
  if (lower === "lead" || lower === "prospecting") return "prospecting";
  if (lower === "proposal" || lower === "qualification") return "proposal";
  if (lower === "negotiation") return "negotiation";
  if (lower === "won" || lower === "closed_won") return "closed_won";
  if (lower === "lost" || lower === "closed_lost") return "closed_lost";
  return "prospecting";
}

export function mapDealSummaries(payload: unknown): DealSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: DealSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const dealName = toText(row.dealName) ?? toText(row.name);
    const stage = normalizeDealStage(toText(row.stage));
    if (!id || !dealName || !stage) continue;
    const rawStatus = (toText(row.status) ?? "open").toLowerCase();
    const status: DealSummary["status"] =
      rawStatus === "won" || rawStatus === "closed_won" ? "won"
        : rawStatus === "lost" || rawStatus === "closed_lost" ? "lost"
          : "open";
    mapped.push({
      id,
      dealName,
      contactId: toText(row.contactId) ?? undefined,
      contactName: toText(row.contactName) ?? toText(row.company) ?? undefined,
      stage,
      amount: parseMinor(row.valueMinor) || parseMinor(row.amount),
      owner: toText(row.owner) ?? "—",
      closeDate: toText(row.closeDate) ?? undefined,
      probability: typeof row.probability === "number" ? row.probability : 0,
      status,
    });
  }
  return mapped;
}

export function mapCrmDealSummaries(payload: unknown): CRMDealSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: CRMDealSummary[] = [];
  const stages = new Set(["Lead", "Proposal", "Negotiation", "Won", "Lost"]);
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const name = toText(row.name);
    const stageRaw = toText(row.stage);
    const stage =
      stageRaw === "lead" ? "Lead"
        : stageRaw && stages.has(stageRaw) ? stageRaw as CRMDealSummary["stage"]
          : stageRaw ? (stageRaw.charAt(0).toUpperCase() + stageRaw.slice(1).toLowerCase()) as CRMDealSummary["stage"]
            : null;
    const valueDisplay = toText(row.valueDisplay) ?? "—";
    if (!id || !name || !stage) continue;
    mapped.push({ id, name, stage, valueDisplay });
  }
  return mapped;
}

export function mapHelpdeskTicketList(payload: unknown): TicketDetail[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: TicketDetail[] = [];
  for (const row of rows) {
    const ticket = mapSingleHelpdeskTicket(row);
    if (ticket) mapped.push(ticket);
  }
  return mapped;
}

function mapSingleHelpdeskTicket(row: unknown): TicketDetail | null {
  if (!isRecord(row)) return null;
  const id = toText(row.id);
  const subject = toText(row.subject) ?? toText(row.title);
  if (!id || !subject) return null;
  const rawPriority = (toText(row.priority) ?? "medium").toLowerCase();
  const priority: TicketDetail["priority"] =
    rawPriority === "critical" ? "critical"
      : rawPriority === "high" ? "high"
        : rawPriority === "low" ? "low"
          : "medium";
  const rawStatus = (toText(row.status) ?? "open").toLowerCase().replace(/\s+/g, "_");
  const status: TicketDetail["status"] =
    rawStatus === "in_progress" ? "in_progress"
      : rawStatus === "resolved" ? "resolved"
        : rawStatus === "closed" ? "closed"
          : rawStatus === "pending" ? "pending"
            : "open";
  const rawSla = (toText(row.slaStatus) ?? "within_sla").toLowerCase();
  const slaStatus: TicketDetail["slaStatus"] =
    rawSla === "breached" ? "breached"
      : rawSla === "due_soon" || rawSla === "at_risk" ? "due_soon"
        : "within_sla";
  const noteRows = Array.isArray(row.comments) ? row.comments : Array.isArray(row.notes) ? row.notes : [];
  const comments = noteRows.flatMap((n) => {
    if (!isRecord(n)) return [];
    const noteId = toText(n.id);
    const content = toText(n.content) ?? toText(n.body);
    if (!noteId || !content) return [];
    return [{
      id: noteId,
      author: toText(n.author) ?? toText(n.authorId)?.slice(0, 8) ?? "Agent",
      content,
      createdAt: toText(n.createdAt) ?? new Date().toISOString(),
      isInternal: Boolean(n.isInternal),
    }];
  });
  return {
    id,
    ticketNo: toText(row.ticketNo) ?? id.slice(0, 8).toUpperCase(),
    subject,
    description: toText(row.description) ?? undefined,
    requesterName: toText(row.requesterName) ?? toText(row.requester) ?? "Citizen",
    assignedTo: toText(row.assignedTo) ?? toText(row.assigneeId) ?? undefined,
    priority,
    slaStatus,
    status,
    channel: (["web", "email", "phone", "walk_in"] as const).find((c) => c === row.channel),
    createdAt: toText(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toText(row.updatedAt) ?? new Date().toISOString(),
    resolvedAt: toText(row.resolvedAt) ?? undefined,
    comments,
  };
}

export function mapHelpdeskTicketDetail(payload: unknown): TicketDetail | null {
  if (isRecord(payload) && toText(payload.id)) {
    return mapSingleHelpdeskTicket(payload);
  }
  const rows = mapHelpdeskTicketList({ data: [payload] });
  return rows?.[0] ?? null;
}

export function mapLegalCaseSummaries(payload: unknown): LegalCaseSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: LegalCaseSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const caseNo = toText(row.caseNo) ?? id;
    const title = toText(row.title) ?? toText(row.subject);
    const court = toText(row.court) ?? "—";
    if (!id || !caseNo || !title) continue;
    const caseNoUpper = caseNo.toUpperCase();
    const type: LegalCaseSummary["type"] =
      caseNoUpper.startsWith("WP") || caseNoUpper.includes("WRIT") ? "writ"
        : caseNoUpper.includes("ARB") ? "arbitration"
          : "other";
    const rawStatus = (toText(row.status) ?? "pending").toLowerCase();
    const status: LegalCaseSummary["status"] =
      rawStatus === "pending" || rawStatus === "active" ? "pending"
        : rawStatus === "disposed" || rawStatus === "dismissed" ? "disposed"
          : rawStatus === "appealed" || rawStatus === "transferred" ? "appealed"
            : rawStatus === "stayed" ? "stayed"
              : rawStatus === "settled" ? "settled"
                : "pending";
    mapped.push({
      id,
      caseNo,
      title,
      court,
      type,
      filedDate: toText(row.filedDate) ?? toText(row.createdAt)?.slice(0, 10) ?? "—",
      department: toText(row.department) ?? undefined,
      petitioner: toText(row.petitioner) ?? undefined,
      respondent: toText(row.respondent) ?? undefined,
      nextHearingDate: toText(row.nextDate) ?? toText(row.nextHearingDate) ?? undefined,
      status,
    });
  }
  return mapped;
}

export function mapEstabFileSummaries(payload: unknown): EstabFileSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: EstabFileSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const fileNo = toText(row.fileNo) ?? id;
    const subject = toText(row.subject);
    if (!id || !fileNo || !subject) continue;
    const rawClass = (toText(row.classification) ?? "unclassified").toLowerCase();
    const classification: EstabFileSummary["classification"] =
      rawClass === "public" || rawClass === "unclassified" ? "unclassified"
        : rawClass === "restricted" ? "restricted"
          : rawClass === "confidential" ? "confidential"
            : rawClass === "secret" ? "secret"
              : rawClass === "top_secret" ? "top_secret"
                : "unclassified";
    const rawStatus = (toText(row.status) ?? "active").toLowerCase();
    const status: EstabFileSummary["status"] =
      rawStatus === "archived" ? "archived"
        : rawStatus === "disposed" ? "disposed"
          : rawStatus === "pending" ? "pending"
            : "active";
    mapped.push({
      id,
      fileNo,
      subject,
      classification,
      department: toText(row.dept) ?? toText(row.department) ?? undefined,
      createdBy: toText(row.createdBy) ?? "—",
      createdDate: toText(row.createdDate) ?? toText(row.createdAt)?.slice(0, 10) ?? "—",
      currentHolder: toText(row.currentWith) ?? toText(row.currentHolder) ?? undefined,
      status,
      dueDate: toText(row.dueBy)?.slice(0, 10) ?? toText(row.dueDate) ?? undefined,
      tags: [],
    });
  }
  return mapped;
}

export function mapEstabFileDetail(payload: unknown): import("@civitasone/types").EstabFileDetail | null {
  if (!isRecord(payload)) return null;
  const id = toText(payload.id);
  const fileNo = toText(payload.fileNo);
  const subject = toText(payload.subject);
  if (!id || !fileNo || !subject) return null;

  const summaries = mapEstabFileSummaries([payload]);
  const base = summaries?.[0];
  if (!base) return null;

  const noteSheetsRaw = Array.isArray(payload.noteSheets) ? payload.noteSheets : [];
  const noteSheets = noteSheetsRaw.flatMap((row) => {
    if (!isRecord(row)) return [];
    const nid = toText(row.id);
    if (!nid) return [];
    return [{
      id: nid,
      author: toText(row.author) ?? "—",
      content: toText(row.content) ?? toText(row.body) ?? "",
      timestamp: toText(row.timestamp) ?? toText(row.createdAt) ?? "",
      type: (toText(row.type) ?? "note") as "note" | "order" | "remark",
      noteType: toText(row.noteType) ?? undefined,
      noteStatus: toText(row.noteStatus) ?? undefined,
      eSigned: Boolean(row.eSigned),
    }];
  });

  const dispatchRaw = Array.isArray(payload.dispatchHistory) ? payload.dispatchHistory : [];
  const dispatchHistory = dispatchRaw.flatMap((row) => {
    if (!isRecord(row)) return [];
    const did = toText(row.id);
    if (!did) return [];
    return [{
      id: did,
      dispatchedTo: toText(row.dispatchedTo) ?? "—",
      dispatchedBy: toText(row.dispatchedBy) ?? "—",
      timestamp: toText(row.timestamp) ?? "",
      remarks: toText(row.remarks) ?? undefined,
    }];
  });

  const attachRaw = Array.isArray(payload.attachments) ? payload.attachments : [];
  const attachments = attachRaw.flatMap((row) => {
    if (!isRecord(row)) return [];
    const aid = toText(row.id);
    if (!aid) return [];
    return [{
      id: aid,
      fileName: toText(row.fileName) ?? "file",
      fileType: toText(row.fileType) ?? "application/pdf",
      size: Number(row.size ?? 0),
      uploadedAt: toText(row.uploadedAt) ?? "",
    }];
  });

  return {
    ...base,
    dakNo: toText(payload.dakNo) ?? undefined,
    dueBy: toText(payload.dueBy) ?? undefined,
    noteSheets,
    dispatchHistory,
    attachments,
    movementHistory: Array.isArray(payload.movementHistory) ? payload.movementHistory : [],
  } as import("@civitasone/types").EstabFileDetail & { dakNo?: string; dueBy?: string; movementHistory?: unknown[] };
}

export function mapAssetSummaries(payload: unknown): AssetSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: AssetSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const name = toText(row.name);
    const assetCode = toText(row.assetCode) ?? toText(row.code) ?? id;
    if (!id || !name || !assetCode) continue;
    const purchaseCost = parseMinor(row.acquisitionCost) || parseMinor(row.purchaseCost);
    const currentValue = parseMinor(row.bookValue) || purchaseCost;
    const rawType = (toText(row.assetType) ?? toText(row.type) ?? "other").toLowerCase();
    const type: AssetSummary["type"] =
      rawType === "fixed" || rawType === "infra" || rawType === "movable" || rawType === "it" || rawType === "vehicle"
        ? rawType
        : "other";
    const rawStatus = (toText(row.status) ?? "active").toLowerCase();
    const status: AssetSummary["status"] =
      rawStatus === "in_use" ? "in_use"
        : rawStatus === "maintenance" ? "maintenance"
          : rawStatus === "disposed" ? "disposed"
            : rawStatus === "condemned" ? "condemned"
              : "active";
    mapped.push({
      id,
      assetCode,
      name,
      category: toText(row.category) ?? toText(row.categoryId)?.slice(0, 8) ?? "General",
      type,
      purchaseDate: toText(row.acquisitionDate) ?? toText(row.purchaseDate) ?? toText(row.createdAt)?.slice(0, 10) ?? "—",
      purchaseCost,
      currentValue,
      location: toText(row.location) ?? undefined,
      status,
    });
  }
  return mapped;
}

export function mapAssetDetail(payload: unknown): AssetDetail | null {
  if (!isRecord(payload)) return null;
  const summaries = mapAssetSummaries({ data: [payload] });
  const base = summaries?.[0];
  if (!base) return null;
  return {
    ...base,
    description: toText(payload.description) ?? toText(payload.notes) ?? undefined,
    serialNo: toText(payload.serialNo) ?? toText(payload.barcode) ?? undefined,
    warrantyExpiry: toText(payload.warrantyExpiry)?.slice(0, 10) ?? undefined,
    depreciationSchedule: [],
    maintenanceHistory: [],
  };
}

export function mapDepreciationEntries(payload: unknown): AssetDetail["depreciationSchedule"] {
  if (!isRecord(payload)) return [];
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  let opening = 0;
  const schedule: AssetDetail["depreciationSchedule"] = [];
  for (const row of entries) {
    if (!isRecord(row)) continue;
    const period = toText(row.period) ?? "";
    const year = Number(period.slice(0, 4)) || new Date().getFullYear();
    const depAmt = parseMinor(row.amountMinor);
    const closing = parseMinor(row.bookValueAfterMinor);
    schedule.push({
      year,
      openingValue: opening || closing + depAmt,
      depreciationAmount: depAmt,
      closingValue: closing,
      rate: 20,
    });
    opening = closing;
  }
  return schedule;
}

export function mapAssetMaintenanceHistory(payload: unknown): AssetDetail["maintenanceHistory"] {
  const rows = getArrayPayload(payload);
  if (!rows) return [];
  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = toText(row.id);
    if (!id) return [];
    return [{
      id,
      date: toText(row.completedDate)?.slice(0, 10) ?? toText(row.scheduledDate)?.slice(0, 10) ?? "—",
      type: toText(row.maintenanceType) ?? toText(row.type) ?? "maintenance",
      description: toText(row.description) ?? toText(row.notes) ?? "Work order",
      cost: parseMinor(row.costMinor),
    }];
  });
}

export function mapMaintenanceSummaries(payload: unknown): MaintenanceSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: MaintenanceSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const assetId = toText(row.assetId);
    if (!id || !assetId) continue;
    const rawStatus = (toText(row.status) ?? "open").toLowerCase();
    const status: MaintenanceSummary["status"] =
      rawStatus === "completed" ? "completed"
        : rawStatus === "in_progress" ? "in_progress"
          : rawStatus === "cancelled" ? "cancelled"
            : rawStatus === "overdue" ? "overdue"
              : "scheduled";
    mapped.push({
      id,
      assetId,
      assetCode: assetId.slice(0, 8).toUpperCase(),
      assetName: toText(row.assetName) ?? "Asset",
      maintenanceType: "corrective",
      scheduledDate: toText(row.scheduledDate)?.slice(0, 10) ?? "—",
      completedDate: toText(row.completedDate)?.slice(0, 10) ?? undefined,
      estimatedCost: parseMinor(row.costMinor),
      actualCost: parseMinor(row.costMinor),
      status,
      remarks: toText(row.notes) ?? undefined,
    });
  }
  return mapped;
}

export function mapStockItemDetail(payload: unknown): StockItemDetail | null {
  if (!isRecord(payload)) return null;
  const summaries = mapStockItemSummaries({ data: [payload] });
  const base = summaries?.[0];
  if (!base) return null;
  return {
    ...base,
    description: toText(payload.description) ?? undefined,
    stockLedger: [],
  };
}

export function mapStockLedgerEntries(payload: unknown): StockLedgerEntry[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: StockLedgerEntry[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const itemId = toText(row.itemId);
    if (!id) continue;
    const qtyIn = typeof row.qtyIn === "number" ? row.qtyIn : 0;
    const qtyOut = typeof row.qtyOut === "number" ? row.qtyOut : 0;
    const quantity = qtyIn > 0 ? qtyIn : qtyOut;
    const typeRaw = (toText(row.voucherType) ?? "receipt").toLowerCase();
    const type: StockLedgerEntry["type"] =
      typeRaw === "issue" ? "issue"
        : typeRaw === "transfer" ? "transfer"
          : typeRaw === "adjustment" ? "adjustment"
            : "receipt";
    const unitCost = parseMinor(row.rateMinor);
    mapped.push({
      id,
      itemCode: itemId?.slice(0, 8).toUpperCase() ?? id.slice(0, 8),
      itemName: toText(row.itemName) ?? itemId?.slice(0, 8) ?? "Item",
      date: toText(row.postingDate)?.slice(0, 10) ?? toText(row.createdAt)?.slice(0, 10) ?? "—",
      type,
      quantity,
      unitCost,
      totalValue: unitCost * quantity,
      referenceNo: toText(row.entryId)?.slice(0, 8) ?? undefined,
      balance: typeof row.balanceQty === "number" ? row.balanceQty : 0,
    });
  }
  return mapped;
}

export function mapStockItemSummaries(payload: unknown): StockItemSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: StockItemSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const name = toText(row.name);
    const itemCode = toText(row.itemCode) ?? toText(row.code) ?? id;
    if (!id || !name || !itemCode) continue;
    const currentStock = typeof row.currentStock === "number" ? row.currentStock : 0;
    const minStockLevel = typeof row.minStockLevel === "number" ? row.minStockLevel : parseMinor(row.reorderLevel);
    mapped.push({
      id,
      itemCode,
      name,
      category: toText(row.category) ?? toText(row.categoryId)?.slice(0, 8) ?? "General",
      unit: toText(row.unit) ?? toText(row.uomId)?.slice(0, 4) ?? "EA",
      currentStock,
      minStockLevel,
      unitCost: parseMinor(row.unitCost),
      totalValue: parseMinor(row.totalValue),
      isLowStock: currentStock <= minStockLevel,
    });
  }
  return mapped;
}

export function mapAdminUserSummaries(payload: unknown): UserSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: UserSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const email = toText(row.email);
    if (!id || !email) continue;
    mapped.push({
      id,
      email,
      name: toText(row.name) ?? undefined,
      roles: Array.isArray(row.roles) ? row.roles.filter((r): r is string => typeof r === "string") : [],
      mfaEnabled: row.mfaEnabled === true,
      lastLoginAt: toText(row.lastLoginAt) ?? undefined,
      status: toText(row.status) ?? "active",
      createdAt: toText(row.createdAt) ?? new Date().toISOString(),
    });
  }
  return mapped;
}

export function mapVendorSummaries(payload: unknown): VendorSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: VendorSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const name = toText(row.name);
    if (!name) continue;
    mapped.push({
      name,
      category: toText(row.category) ?? "General",
      ratingDisplay: toText(row.ratingDisplay) ?? toText(row.rating)?.toString() ?? "—",
    });
  }
  return mapped;
}

export function mapPurchaseOrderSummaries(payload: unknown): PurchaseOrderSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: PurchaseOrderSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id) ?? toText(row.poNo);
    const vendor = toText(row.vendor) ?? toText(row.vendorName);
    const amountDisplay = toText(row.amountDisplay) ?? (parseMinor(row.totalMinor) ? `₹${(parseMinor(row.totalMinor) / 100).toLocaleString("en-IN")}` : null);
    const status = toText(row.status);
    if (!id || !vendor || !amountDisplay || !status) continue;
    if (status !== "Pending" && status !== "Approved" && status !== "Review" && status !== "Rejected") continue;
    mapped.push({ id, vendor, amountDisplay, status: status as PurchaseOrderSummary["status"] });
  }
  return mapped;
}

export function mapTenantUsers(payload: unknown): TenantUserSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: TenantUserSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const name = toText(row.name) ?? toText(row.email);
    const role = toText(row.role) ?? toText(row.empCode) ?? "Member";
    const rawStatus = toText(row.status);
    const status =
      rawStatus === "Active" || rawStatus === "Suspended" || rawStatus === "Invited"
        ? rawStatus
        : rawStatus === "active"
          ? "Active"
          : rawStatus === "suspended" || rawStatus === "locked" || rawStatus === "deactivated"
            ? "Suspended"
            : rawStatus === "invited"
              ? "Invited"
              : "Active";
    if (!name) continue;
    mapped.push({ name, role, status });
  }
  return mapped;
}
