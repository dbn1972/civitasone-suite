import { describe, it, expect } from "vitest";
import { Cache, MemoryCache } from "../src/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// invalidateResource() prefix-collision fix
//
// Bug: invalidateResource() built its delete-prefix as `${service}:${tenantId}:${resource}`
// with NO trailing delimiter, then delByPrefix() did a raw string-prefix scan. Any resource
// whose name is a textual prefix of another resource's name in the SAME service (e.g.
// "contract" / "contractLine", or a singular/plural pair like "counsel_brief" / "counsel_briefs")
// would cross-invalidate: clearing the shorter-named resource also wiped every entry under the
// longer-named one, because "contractLine:1" starts with the exact same characters as "contract"
// once the key's own ":" delimiter is missing from the scanned prefix.
//
// Fix: the prefix now ends with ":", the same delimiter makeKey()/listKey() always place
// immediately after the resource segment, anchoring the match to a full key-segment boundary.
// ═══════════════════════════════════════════════════════════════════════════

describe("invalidateResource() prefix collision", () => {
  it("does not cross-invalidate a differently-named resource that shares a text prefix", async () => {
    const store = new MemoryCache();
    const cache = new Cache({ service: "contract-service", store });

    const contractKey = cache.makeKey("tenant-a", "contract", "1");
    const contractListKey = cache.listKey("tenant-a", "contract", "hash1");
    // "contractLine" is a DIFFERENT resource that merely starts with the same
    // characters as "contract" -- the exact collision shape the bug produced.
    const contractLineKey = cache.makeKey("tenant-a", "contractLine", "1");

    await cache.put(contractKey, { v: "contract-item" });
    await cache.put(contractListKey, { v: "contract-list" });
    await cache.put(contractLineKey, { v: "contract-line-item" });

    await cache.invalidateResource("tenant-a", "contract");

    // The targeted resource -- both its item key and its list key -- is gone.
    expect(await store.get(contractKey)).toBeNull();
    expect(await store.get(contractListKey)).toBeNull();
    // The differently-named resource that only shares a text PREFIX survives.
    expect(await store.get(contractLineKey)).not.toBeNull();
  });

  it("is collision-safe in both directions (shorter name vs longer name)", async () => {
    const store = new MemoryCache();
    const cache = new Cache({ service: "legal-service", store });

    const singularKey = cache.makeKey("tenant-a", "counsel_brief", "1");
    const pluralListKey = cache.listKey("tenant-a", "counsel_briefs", "hash1");

    await cache.put(singularKey, { v: "brief" });
    await cache.put(pluralListKey, { v: "briefs-list" });

    // Invalidating the LONGER name must not touch the shorter one either.
    await cache.invalidateResource("tenant-a", "counsel_briefs");
    expect(await store.get(pluralListKey)).toBeNull();
    expect(await store.get(singularKey)).not.toBeNull();

    // Invalidating the SHORTER name must not touch the longer one.
    await cache.put(pluralListKey, { v: "briefs-list-again" });
    await cache.invalidateResource("tenant-a", "counsel_brief");
    expect(await store.get(singularKey)).toBeNull();
    expect(await store.get(pluralListKey)).not.toBeNull();
  });

  it("still removes every entry actually under the resource, across ids, and leaves other tenants alone", async () => {
    const store = new MemoryCache();
    const cache = new Cache({ service: "svc", store });

    await cache.put(cache.makeKey("tenant-a", "widget", "1"), { v: 1 });
    await cache.put(cache.makeKey("tenant-a", "widget", "2"), { v: 2 });
    await cache.put(cache.listKey("tenant-a", "widget", "hash"), { v: "list" });
    await cache.put(cache.makeKey("tenant-b", "widget", "1"), { v: "other-tenant" });

    await cache.invalidateResource("tenant-a", "widget");

    expect(await store.get(cache.makeKey("tenant-a", "widget", "1"))).toBeNull();
    expect(await store.get(cache.makeKey("tenant-a", "widget", "2"))).toBeNull();
    expect(await store.get(cache.listKey("tenant-a", "widget", "hash"))).toBeNull();
    // A different tenant's identically-named resource is untouched.
    expect(await store.get(cache.makeKey("tenant-b", "widget", "1"))).not.toBeNull();
  });

  it("invalidateResourceAfterCommit is likewise collision-safe on the no-commit-hook (immediate) path", async () => {
    const store = new MemoryCache();
    const cache = new Cache({ service: "helpdesk", store });

    const ticketKey = cache.makeKey("tenant-a", "ticket", "1");
    const ticketNotesKey = cache.makeKey("tenant-a", "ticket_notes", "1");
    await cache.put(ticketKey, { v: "ticket" });
    await cache.put(ticketNotesKey, { v: "notes" });

    await cache.invalidateResourceAfterCommit({}, "tenant-a", "ticket");

    expect(await store.get(ticketKey)).toBeNull();
    expect(await store.get(ticketNotesKey)).not.toBeNull();
  });
});
