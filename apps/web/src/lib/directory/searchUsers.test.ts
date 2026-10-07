import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchDirectoryUsers, resolveDirectoryUsers } from "./searchUsers";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("searchDirectoryUsers (client directory adapter)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("short-circuits a <2 char query without calling fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await searchDirectoryUsers("a", new AbortController().signal)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps {id, displayName} rows to {id, label} options", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({ data: [{ id: UUID_A, displayName: "Asha Rao" }] }),
    );
    const opts = await searchDirectoryUsers("Asha", new AbortController().signal);
    expect(opts).toEqual([{ id: UUID_A, label: "Asha Rao" }]);
  });

  it("hits the directory q endpoint through the browser proxy", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson({ data: [] }));
    await searchDirectoryUsers("Asha", new AbortController().signal);
    expect(String(spy.mock.calls[0]![0])).toContain("/api/proxy/v1/identity/users/directory?q=Asha");
  });

  it("fail-soft: an HTTP error yields []", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await searchDirectoryUsers("Asha", new AbortController().signal)).toEqual([]);
  });
});

describe("resolveDirectoryUsers (client directory adapter)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("ignores non-UUID ids and returns [] when nothing is valid", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await resolveDirectoryUsers(["not-a-uuid", ""])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("batches ids and maps rows to options", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({ data: [{ id: UUID_A, displayName: "Asha Rao" }, { id: UUID_B, displayName: "Bimal Das" }] }),
    );
    const opts = await resolveDirectoryUsers([UUID_A, UUID_B]);
    expect(opts).toEqual([
      { id: UUID_A, label: "Asha Rao" },
      { id: UUID_B, label: "Bimal Das" },
    ]);
    expect(String(spy.mock.calls[0]![0])).toContain("/api/proxy/v1/identity/users/directory?ids=");
  });

  it("fail-soft: a network error yields []", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await resolveDirectoryUsers([UUID_A])).toEqual([]);
  });
});
