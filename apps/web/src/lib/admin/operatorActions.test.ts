import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  availableChanges, canCancel, canDecide, decideOperatorRequest, errorCodeFrom, loadPendingRequests, otherRole,
  parsePendingRequest, requestOperatorChange, toOperatorRequests,
} from "./operatorActions";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const op = (over: Record<string, unknown> = {}) => ({ id: OTHER, role: "platform_admin", status: "active", pendingRequest: null, ...over }) as Parameters<typeof availableChanges>[0];

describe("availableChanges (GAP-ADMIN-OPERATORS-05)", () => {
  it("offers suspend and a role change for an active operator, reactivate for a suspended one", () => {
    expect(availableChanges(op(), ME)).toEqual(["suspend", "role_change"]);
    expect(availableChanges(op({ status: "suspended" }), ME)).toEqual(["reactivate"]);
    expect(availableChanges(op({ status: "Active" }), ME)).toEqual(["suspend", "role_change"]);
  });
  it("offers nothing on your own row, a row with a change pending, an unknown state or no id", () => {
    expect(availableChanges(op({ id: ME }), ME)).toEqual([]);
    expect(availableChanges(op({ id: ME.toUpperCase() }), ME)).toEqual([]);
    expect(availableChanges(op({ pendingRequest: { id: "r", kind: "suspend", toRole: null, requestedBy: ME } }), ME)).toEqual([]);
    expect(availableChanges(op({ status: "unknown" }), ME)).toEqual([]);
    expect(availableChanges(op({ status: "" }), ME)).toEqual([]);
    expect(availableChanges(op({ id: undefined }), ME)).toEqual([]);
  });
  it("only offers a role change between the two platform roles", () => {
    expect(otherRole("super_admin")).toBe("platform_admin");
    expect(otherRole("platform_admin")).toBe("super_admin");
    expect(otherRole("tenant_admin")).toBeNull();
    expect(availableChanges(op({ role: "tenant_admin" }), ME)).toEqual(["suspend"]);
  });
});

describe("who may decide or cancel", () => {
  const req = { status: "pending", requestedBy: ME };
  it("a super admin other than the requester decides; the requester and a platform admin cannot", () => {
    expect(canDecide(req, OTHER, ["super_admin"])).toBe(true);
    expect(canDecide(req, ME, ["super_admin"])).toBe(false);
    expect(canDecide(req, ME.toUpperCase(), ["super_admin"])).toBe(false);
    expect(canDecide(req, OTHER, ["platform_admin"])).toBe(false);
    expect(canDecide({ ...req, status: "approved" }, OTHER, ["super_admin"])).toBe(false);
    expect(canDecide(req, null, ["super_admin"])).toBe(false);
  });
  it("only the requester cancels, and only while pending", () => {
    expect(canCancel(req, ME)).toBe(true);
    expect(canCancel(req, OTHER)).toBe(false);
    expect(canCancel({ ...req, status: "rejected" }, ME)).toBe(false);
  });
});

describe("parsing", () => {
  it("reads the pending request on a row and drops junk", () => {
    expect(parsePendingRequest({ id: "r1", kind: "suspend", toRole: null, requestedBy: ME })).toEqual({ id: "r1", kind: "suspend", toRole: null, requestedBy: ME });
    expect(parsePendingRequest(null)).toBeNull();
    expect(parsePendingRequest({ kind: "suspend" })).toBeNull();
  });
  it("maps the request list from the {data} envelope", () => {
    const rows = toOperatorRequests({ data: [{ id: "r1", kind: "role_change", targetName: "Pavan", fromRole: "platform_admin", toRole: "super_admin", reason: "promotion", status: "pending", requestedBy: ME, requestedByName: "Asha", requestedAt: "2026-10-04T10:00:00Z" }, { kind: "x" }] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "r1", toRole: "super_admin", targetName: "Pavan" });
    expect(toOperatorRequests("nonsense")).toEqual([]);
  });
  it("maps only known server codes and never passes the server text through", () => {
    expect(errorCodeFrom({ code: "LAST_SUPER_ADMIN", message: "raw text" })).toBe("LAST_SUPER_ADMIN");
    expect(errorCodeFrom({ error: { code: "ALREADY_PENDING" } })).toBe("ALREADY_PENDING");
    expect(errorCodeFrom({ code: "SOMETHING_NEW" })).toBe("generic");
    expect(errorCodeFrom(null)).toBe("generic");
  });
});

describe("requests", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const json = (b: unknown, status: number) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

  it("posts the change with the reason to the operator's requests endpoint", async () => {
    fetchMock.mockResolvedValue(json({ id: "x" }, 202));
    expect(await requestOperatorChange(OTHER, { kind: "role_change", reason: "promotion", toRole: "super_admin" })).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/proxy/v1/admin/operators/${OTHER}/requests`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ kind: "role_change", reason: "promotion", toRole: "super_admin" });
  });
  it("returns the machine code on refusal and 'generic' when the network fails", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "LAST_SUPER_ADMIN", message: "x" }, 409));
    expect(await requestOperatorChange(OTHER, { kind: "suspend", reason: "because" })).toEqual({ ok: false, code: "LAST_SUPER_ADMIN" });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await requestOperatorChange(OTHER, { kind: "suspend", reason: "because" })).toEqual({ ok: false, code: "generic" });
  });
  it("decides with an optional note", async () => {
    fetchMock.mockResolvedValue(json({ id: "x" }, 202));
    await decideOperatorRequest("r1", "approve");
    await decideOperatorRequest("r1", "reject", "not now");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/proxy/v1/admin/operators/requests/r1/approve");
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({});
    expect(String(fetchMock.mock.calls[1]![0])).toBe("/api/proxy/v1/admin/operators/requests/r1/reject");
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string)).toEqual({ note: "not now" });
  });
  it("loads pending requests, and reports a failure instead of an empty list", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [{ id: "r1", kind: "suspend", status: "pending" }] }, 200));
    const ok = await loadPendingRequests();
    expect(ok.ok && ok.requests).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(json({}, 500));
    expect(await loadPendingRequests()).toEqual({ ok: false });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await loadPendingRequests()).toEqual({ ok: false });
  });
});
