import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import {
  TRANSFER_STATUSES,
  TRANSFER_STATUS_TONE,
  ISSUE_ORDER_FROM,
  RELIEVE_FROM,
  JOIN_FROM,
  DIRECT_PIPELINE,
  directPipelineIndex,
  isEofficeStatus,
  transferStatusBucket,
  countTransferBuckets,
  transferStatusLabel,
  transferStatusTone,
  type StatusTranslator,
} from "./transferStatus";

// Source of truth for "which statuses does the backend actually emit".
const MODULE_DIR = "../../../../../services/hrms-service/src/modules/";
const read = (rel: string): string | null => {
  const p = fileURLToPath(new URL(MODULE_DIR + rel, import.meta.url));
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

/** Status literals the lifecycle consumers write: every `to: "x"` and `from: [...]`
 * of a transfer transition, plus the status a new transfer request is created with. */
function backendTransferStatuses(): Set<string> | null {
  const sources = ["lifecycle/consumer.ts", "lifecycle/eoffice-consumer.ts"].map(read);
  if (sources.some((s) => s === null)) return null;
  const found = new Set<string>();
  for (const src of sources as string[]) {
    for (const m of src.matchAll(/\bto:\s*"([a-z_]+)"/g)) found.add(m[1] as string);
    for (const m of src.matchAll(/\bfrom:\s*\[([^\]]*)\]/g)) {
      for (const lit of (m[1] as string).matchAll(/"([a-z_]+)"/g)) found.add(lit[1] as string);
    }
  }
  const created = (sources[0] as string).match(/fromStation:[^\n]*status:\s*"([a-z_]+)"/);
  if (created) found.add(created[1] as string);
  return found;
}

function translator(messages: { transferUi: { status: Record<string, string> } }): StatusTranslator {
  const fn = ((key: string) => (messages.transferUi.status as Record<string, string>)[key.replace(/^status\./, "")] ?? key) as StatusTranslator;
  fn.has = (key: string) => key.replace(/^status\./, "") in messages.transferUi.status;
  return fn;
}

describe("transfer status module (GAP-HR-TRANSFER-07/08)", () => {
  const backend = backendTransferStatuses();

  it("knows every status the backend consumers emit", () => {
    // The hrms-service sources always exist in the monorepo. A null here means
    // MODULE_DIR (or a consumer file name) moved -- fail loudly instead of
    // letting the backend-status assertions silently vanish.
    expect(backend, "hrms-service lifecycle consumers not found under MODULE_DIR").not.toBeNull();
    expect([...(backend as Set<string>)].sort()).toEqual(
      expect.arrayContaining(["requested", "ordered", "relieved", "joined", "pending_approval", "pending_effective", "completed", "cancelled"]),
    );
    for (const s of backend as Set<string>) {
      expect(TRANSFER_STATUSES, `backend status "${s}" is missing from TRANSFER_STATUSES`).toContain(s);
    }
  });

  it("has an English AND a Hindi label for every status (the label map covers the backend enum)", () => {
    for (const s of TRANSFER_STATUSES) {
      expect((enMessages.transferUi.status as Record<string, string>)[s], `en label for ${s}`).toBeTruthy();
      expect((hiMessages.transferUi.status as Record<string, string>)[s], `hi label for ${s}`).toBeTruthy();
    }
    // and no stray label for a status this module does not know
    for (const s of Object.keys(enMessages.transferUi.status)) expect(TRANSFER_STATUSES).toContain(s);
  });

  it("has a pill tone for every status, so none falls through to the neutral default", () => {
    for (const s of TRANSFER_STATUSES) expect(transferStatusTone(s)).toBe(TRANSFER_STATUS_TONE[s]);
    expect(transferStatusTone("not_a_status")).toBeUndefined();
  });

  it("labels a status through transferUi.status.* and humanises an unknown one (never the raw enum)", () => {
    const tr = translator(enMessages);
    expect(transferStatusLabel(tr, "ordered")).toBe("Order Issued");
    expect(transferStatusLabel(tr, "pending_effective")).toBe("Approved — Effective Soon");
    expect(transferStatusLabel(tr, "on_hold_by_hr")).toBe("On Hold By Hr");
  });

  it("gates the lifecycle actions exactly like the backend routes", () => {
    expect(ISSUE_ORDER_FROM).toEqual(["requested", "pending"]);
    expect(RELIEVE_FROM).toEqual(["ordered"]);
    expect(JOIN_FROM).toEqual(["relieved"]);
    const routes = read("lifecycle/routes.ts");
    expect(routes, "lifecycle/routes.ts not found under MODULE_DIR").not.toBeNull();
    expect(routes).toContain('transfer.status !== "requested" && transfer.status !== "pending"');
    expect(routes).toContain('transfer.status !== "ordered"');
    expect(routes).toContain('transfer.status !== "relieved"');
  });

  it("models the direct pipeline as Requested -> Order Issued -> Relieved -> Joined (no HOD/Admin stages)", () => {
    expect(DIRECT_PIPELINE.map((p) => p.key)).toEqual(["requested", "ordered", "relieved", "joined"]);
    expect(["pending", "requested", "ordered", "relieved", "joined"].map(directPipelineIndex)).toEqual([0, 0, 1, 2, 3]);
    expect(["pending_approval", "pending_effective", "completed"].every(isEofficeStatus)).toBe(true);
    expect(["requested", "ordered", "relieved", "joined", "cancelled"].some(isEofficeStatus)).toBe(false);
  });

  it("puts every status in exactly one stat bucket, so the buckets always add up to the total", () => {
    const all = [...TRANSFER_STATUSES, "something_new"];
    const counts = countTransferBuckets(all);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(all.length);
    // cancelled / legacy pending / an unknown status are no longer counted nowhere
    expect(transferStatusBucket("cancelled")).toBe("cancelled");
    expect(transferStatusBucket("pending")).toBe("pending");
    expect(transferStatusBucket("something_new")).toBe("pending");
    expect(countTransferBuckets(["joined", "completed", "ordered", "pending_effective", "requested", "relieved", "cancelled"])).toEqual({
      completed: 2, approved: 2, pending: 1, relieved: 1, cancelled: 1,
    });
  });
});
