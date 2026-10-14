import { describe, it, expect } from "vitest";
import { getMunicipalService, MUNICIPAL_SERVICE_CATALOG } from "./services";
import { parseListPayload, pickField, toMunicipalRecordRow, countInProgress, isInProgressStatus, detailEntries, omittedFieldCount, statusFilterOptions } from "./records";

describe("municipal record parsing", () => {
  const trade = getMunicipalService("trade")!;

  it("extracts title and reference from application row", () => {
    const row = toMunicipalRecordRow(
      {
        id: "a1",
        applicationNumber: "TL-2026-0001",
        businessName: "Acme Traders",
        status: "under_review",
        updatedAt: "2026-08-09T10:00:00Z",
      },
      trade,
    );
    expect(row).toEqual({
      id: "a1",
      reference: "TL-2026-0001",
      title: "Acme Traders",
      status: "under_review",
      updatedAt: "2026-08-09T10:00:00Z",
    });
  });

  it("parses paginated list payload", () => {
    const parsed = parseListPayload(
      {
        data: [
          { id: "1", applicationNumber: "TL-1", businessName: "Shop A", status: "draft", updatedAt: "x" },
        ],
        meta: { page: 1, pageSize: 20, total: 1 },
      },
      trade,
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.meta.total).toBe(1);
  });

  it("formats nested address objects as title fallback", () => {
    const title = pickField(
      { siteAddress: { line1: "12 MG Road", city: "Pune" } },
      ["architectName", "siteAddress"],
    );
    expect(title).toContain("MG Road");
  });

  it("counts only non-terminal, known statuses as in progress (SERVICEKEY-02)", () => {
    expect(isInProgressStatus("submitted")).toBe(true);
    expect(isInProgressStatus("under_review")).toBe(true);
    expect(isInProgressStatus("approved")).toBe(false);
    expect(isInProgressStatus("rejected")).toBe(false);
    expect(isInProgressStatus("cancelled")).toBe(false);
    expect(isInProgressStatus("expired")).toBe(false);
    expect(isInProgressStatus("—")).toBe(false);
    const rows = [
      { id: "1", reference: "r", title: "t", status: "submitted", updatedAt: "x" },
      { id: "2", reference: "r", title: "t", status: "rejected", updatedAt: "x" },
      { id: "3", reference: "r", title: "t", status: "approved", updatedAt: "x" },
      { id: "4", reference: "r", title: "t", status: "scrutiny", updatedAt: "x" },
    ];
    expect(countInProgress(rows)).toBe(2);
  });

  it("detailEntries: skips id, orders by fieldOrder, flags PII, formats dates, flattens nested (DETAIL-01/03)", () => {
    const entries = detailEntries(
      {
        id: "abc-123",
        tenantId: "t1",
        ownerName: "Asha Rao",
        ownerMobile: "9876543210",
        businessName: "Acme Traders",
        status: "submitted",
        applicationNumber: "TL-1",
        createdAt: "2026-03-04T10:00:00Z",
        siteAddress: { line1: "12 MG Road", city: "Pune" },
      },
      trade,
    );
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));

    // id and tenantId never render.
    expect(byKey.id).toBeUndefined();
    expect(byKey.tenantId).toBeUndefined();

    // fieldOrder leads: status, applicationNumber, businessName, ownerName first.
    expect(entries.slice(0, 4).map((e) => e.key)).toEqual([
      "status",
      "applicationNumber",
      "businessName",
      "ownerName",
    ]);

    // ownerMobile is PII with the phone mask kind.
    expect(byKey.ownerMobile.kind).toBe("pii");
    expect(byKey.ownerMobile.piiKind).toBe("phone");
    expect(byKey.ownerMobile.rawValue).toBe("9876543210");

    // ISO timestamp is formatted (not the raw ISO string).
    expect(byKey.createdAt.value).not.toContain("T10:00:00Z");
    expect(byKey.createdAt.value).toMatch(/2026/);

    // Nested object becomes a readable key/value block, not raw JSON braces.
    expect(byKey.siteAddress.kind).toBe("nested");
    expect(byKey.siteAddress.value).not.toContain("{");
    expect(byKey.siteAddress.value).toContain("MG Road");
  });

  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: filter options come from each
  // service's real status vocabulary; the Animal console's options must be a
  // subset of its backend COMPLAINT_STATUSES (reported|assigned|dispatched|
  // action_taken|closed) — the OLD universal set
  // (submitted/under_review/approved/rejected/issued) shares ZERO values with
  // it, so this fails on the old code.
  it("statusFilterOptions: Animal console options ⊆ COMPLAINT_STATUSES (STATUS-01)", () => {
    const animal = getMunicipalService("animal")!;
    const COMPLAINT_STATUSES = ["reported", "assigned", "dispatched", "action_taken", "closed"];
    const options = statusFilterOptions(animal);
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      expect(COMPLAINT_STATUSES).toContain(o.value);
    }
    // None of the old universal filter values can appear.
    const oldUniversal = ["submitted", "under_review", "approved", "rejected", "issued"];
    for (const o of options) {
      expect(oldUniversal).not.toContain(o.value);
    }
  });

  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-02: tab labels are humanized Title-case,
  // never raw snake_case — "Action Taken", not "action_taken".
  it("statusFilterOptions: labels are humanized, no raw snake_case reaches the label (STATUS-02)", () => {
    const animal = getMunicipalService("animal")!;
    const options = statusFilterOptions(animal);
    const actionTaken = options.find((o) => o.value === "action_taken");
    expect(actionTaken?.label).toBe("Action Taken");
    for (const o of options) {
      expect(o.label).not.toMatch(/_/);
      expect(o.label).not.toBe(o.value);
    }
  });

  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: a service with no known vocabulary
  // yields no tabs (rather than a mismatching guessed set).
  it("statusFilterOptions: returns [] when a service has no statusVocabulary (STATUS-01)", () => {
    const options = statusFilterOptions({
      serviceKey: "x", moduleKey: "x", label: "X", shortLabel: "X", icon: "x",
      description: "d", listPath: "/api/v1/x", resourceLabel: "X",
      titleFields: [], numberFields: [], sec5: true,
    });
    expect(options).toEqual([]);
  });

  // GAP2-MUNICIPAL-DETAIL-MONEY-01: bigint minor-unit money columns render as
  // ₹-formatted currency, not the raw paise integer. Fails on the old code,
  // which fell through to String(value)/value.toString().
  it("detailEntries: *_minor money fields render as ₹ currency, not raw paise (MONEY-01)", () => {
    const refund = getMunicipalService("refund")!;
    const entries = detailEntries(
      {
        id: "r1",
        refundAmountMinor: 150000,
        originalAmountMinor: "250000",
        feeMinor: 150000n,
      },
      refund,
    );
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    expect(byKey.refundAmountMinor.value).toBe("₹1,500.00");
    expect(byKey.refundAmountMinor.value).not.toBe("150000");
    expect(byKey.originalAmountMinor.value).toBe("₹2,500.00");
    expect(byKey.feeMinor.value).toBe("₹1,500.00");
  });

  // GAP2-MUNICIPAL-DETAIL-UUID-01: raw actor/FK UUID columns (reportedBy/
  // assignedTo and other *By/*Id with a bare-UUID value) are not rendered; a
  // non-UUID reference still shows. Fails on the old code, which rendered them.
  it("detailEntries: raw actor/FK UUID columns are dropped, no UUID reaches a value (UUID-01)", () => {
    const animal = getMunicipalService("animal")!;
    const entries = detailEntries(
      {
        id: "c1",
        complaintNumber: "AC-1",
        reportedBy: "11111111-2222-4333-8444-555555555555",
        assignedTo: "66666666-7777-4888-8999-aaaaaaaaaaaa",
        wardId: "ward-12", // not a UUID -> still shown
        status: "reported",
      },
      animal,
    );
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    expect(byKey.reportedBy).toBeUndefined();
    expect(byKey.assignedTo).toBeUndefined();
    expect(byKey.wardId).toBeDefined();
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const e of entries) {
      expect(e.value).not.toMatch(uuidRe);
      expect(e.rawValue ?? "").not.toMatch(uuidRe);
    }
  });

  // W2 PQ-C (DETAIL-01): the panel is an allow-list. Unknown keys (applicant
  // address, document numbers, free blobs) are not rendered; PII keys are
  // flagged for masking; PII inside nested objects and free text is masked.
  it("detailEntries: allow-list drops unknown keys and masks nested/free-text PII (PQ-C)", () => {
    const entries = detailEntries(
      {
        id: "x",
        status: "submitted",
        applicationNumber: "TL-1",
        ownerMobile: "9876543210",
        applicantAddress: "12 Secret Lane",
        aadhaarNumber: "123456789012",
        documentNumber: "DOC-99",
        internalNotesBlob: { a: 1 },
        remarks: "call me on 9876543210 or a.b@example.com",
        siteAddress: { line1: "12 MG Road", ownerPhone: "9876543210" },
      },
      trade,
    );
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    expect(byKey.applicantAddress).toBeUndefined();
    expect(byKey.documentNumber).toBeUndefined();
    expect(byKey.internalNotesBlob).toBeUndefined();
    expect(byKey.aadhaarNumber.kind).toBe("pii");
    expect(byKey.remarks.value).not.toContain("9876543210");
    expect(byKey.remarks.value).not.toContain("a.b@example.com");
    expect(byKey.siteAddress.value).toContain("MG Road");
    expect(byKey.siteAddress.value).not.toContain("9876543210");
  });

  // W2 PQ-C round 2: the allow-list must not silently drop a service's real
  // operational columns. Columns below are the user-facing fields of each
  // service's drizzle table (services/<svc>-service/.../schema.ts), minus
  // blobs/photos/actor-ids/system columns which are intentionally not shown.
  const SERVICE_COLUMNS: Record<string, string[]> = {
    advertisement: ["applicationNumber", "status", "advertiserName", "advertiserOrg", "advertisementType", "location", "dimensions", "structuralDetails", "feeMinor", "feePaid", "submittedAt"],
    animal: ["complaintNumber", "location", "animalType", "complaintType", "description", "severity", "status", "assignedTeam", "resolvedAt", "resolution"],
    building: ["applicationNumber", "status", "siteAddress", "plotArea", "builtUpArea", "proposedFloors", "fsiRequested", "farComputed", "architectName", "architectLicenceNo", "structuralEngineer", "feeMinor", "feePaid"],
    crematorium: ["bookingNumber", "applicantName", "applicantRelation", "deceasedName", "deceasedAge", "deceasedGender", "serviceType", "requestedDate", "requestedSlot", "status", "slotNumber", "feeMinor", "feePaid", "paymentRef"],
    drainage: ["complaintNumber", "location", "complaintType", "description", "severity", "status", "resolvedAt", "resolution"],
    event: ["applicationNumber", "status", "organiserName", "organiserOrg", "eventType", "venueName", "venueAddress", "startDate", "endDate", "expectedAttendance", "temporaryStructures", "soundPermission", "feeMinor", "depositMinor"],
    fire: ["applicationNumber", "status", "buildingName", "buildingAddress", "occupancyType", "buildingHeight", "numberOfFloors", "builtUpArea", "fireSafetyMeasures", "feeMinor", "feePaid"],
    market: ["allotmentNumber", "allotteeName", "allotmentType", "allotmentDate", "agreementStartDate", "agreementEndDate", "monthlyRentMinor", "securityDepositMinor", "status"],
    parking: ["bookingNumber", "vehicleNumber", "vehicleType", "entryTime", "exitTime", "durationMinutes", "amountMinor", "status", "paymentRef", "spaceNumber"],
    parks: ["requestNumber", "requestType", "location", "treeSpecies", "reason", "status", "inspectionReport"],
    refund: ["requestNumber", "status", "applicantName", "originalServiceType", "originalTransactionRef", "originalAmountMinor", "refundAmountMinor", "refundReason", "description"],
    roadcut: ["applicationNumber", "status", "applicantName", "applicantOrg", "purpose", "location", "roadType", "cuttingLength", "cuttingWidth", "cuttingDepth", "feeMinor", "depositMinor"],
    sewerage: ["bookingNumber", "address", "tankCapacityLitres", "requestedDate", "requestedSlot", "status", "feeMinor", "feePaid"],
    shop: ["applicationNumber", "status", "establishmentName", "establishmentType", "ownerName", "ownerType", "premisesAddress", "activityDescription", "activityCategory", "employeeCount", "capacityDetails", "feeAmountMinor", "feePaid"],
    swm: ["registrationNumber", "generatorName", "generatorType", "address", "estimatedWasteKgPerDay", "category", "status", "feeMinor"],
    trade: ["applicationNumber", "status", "businessName", "tradeCategory", "subCategory", "ownerName", "premisesAddress", "areaInSqft", "employeeCount", "feeMinor", "feePaid"],
    vendor: ["registrationNumber", "status", "vendorName", "category", "preferredZone", "allocatedZone", "allocatedSpot", "feeMinor", "feePaid"],
  };

  it("detailEntries: every catalog service keeps its operational columns visible (PQ-C r2)", () => {
    const configs = MUNICIPAL_SERVICE_CATALOG;
    for (const cfg of configs) {
      const cols = SERVICE_COLUMNS[cfg.serviceKey];
      expect(cols, `columns map missing for ${cfg.serviceKey}`).toBeDefined();
      const record: Record<string, unknown> = { id: "r1", tenantId: "t1", documents: [{ n: 1 }], photo: "p.jpg" };
      for (const c of cols) record[c] = "x1";
      const shown = new Set(detailEntries(record, cfg).map((e) => e.key));
      const missing = cols.filter((c) => !shown.has(c));
      expect(missing, `${cfg.serviceKey}: operational fields silently dropped`).toEqual([]);
      // blobs stay out, and the panel can report them instead of hiding silently
      expect(shown.has("documents")).toBe(false);
      expect(omittedFieldCount(record, cfg)).toBe(2);
    }
  });

  it("omittedFieldCount: counts populated non-allow-listed keys only (PQ-C r2)", () => {
    expect(
      omittedFieldCount({ id: "a", status: "x", documentNumber: "D1", internalNotesBlob: { a: 1 }, emptyThing: null }, trade),
    ).toBe(2);
  });

  it("detailEntries: address strings are identifier-masked (PQ-C r2)", () => {
    const e = detailEntries({ status: "s", venueAddress: "Hall 3, call 9876543210" }, getMunicipalService("event")!);
    expect(e.find((x) => x.key === "venueAddress")!.value).not.toContain("9876543210");
  });
});
