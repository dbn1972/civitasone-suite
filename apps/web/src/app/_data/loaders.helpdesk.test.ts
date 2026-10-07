import { describe, it, expect } from "vitest";
import { mapTickets } from "./loaders";

describe("mapTickets (GAP-HELPDESK-INTERNAL-04)", () => {
  it("keeps a row with an unknown status like 'Pending'", () => {
    const payload = { data: [{ id: "a1", subject: "Test", priority: "High", status: "Pending" }] };
    const result = mapTickets(payload);
    expect(result).toHaveLength(1);
    expect(result![0].status).toBe("Pending");
  });

  it("keeps a row with 'Closed' status", () => {
    const payload = { data: [{ id: "a2", subject: "Done", priority: "Low", status: "Closed" }] };
    const result = mapTickets(payload);
    expect(result).toHaveLength(1);
    expect(result![0].status).toBe("Closed");
  });

  it("keeps a row with an unknown priority like 'Urgent'", () => {
    const payload = { data: [{ id: "a3", subject: "Urgent", priority: "Urgent", status: "Open" }] };
    const result = mapTickets(payload);
    expect(result).toHaveLength(1);
    expect(result![0].priority).toBe("Urgent");
  });

  it("still drops rows without id or subject", () => {
    const payload = { data: [{ id: "", subject: "", priority: "High", status: "Open" }] };
    const result = mapTickets(payload);
    expect(result).toHaveLength(0);
  });

  it("returns an empty array (not null) for an empty list", () => {
    const payload = { data: [] };
    const result = mapTickets(payload);
    expect(result).toEqual([]);
  });
});
