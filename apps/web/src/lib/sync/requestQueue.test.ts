import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushRequestQueue, pendingRequestCount } from "./requestQueue";
import { resolveNamespace } from "./identity";

/**
 * GAP-OFFLINE-HOME-02: verify that flushRequestQueue sends exactly ONE fetch
 * per queued item, carrying the same idempotency key the item was queued with.
 *
 * jsdom 24.x does not ship IndexedDB, so this test provides a minimal
 * Map-based IDB stub matching only the operations requestQueue.ts uses.
 */

vi.mock("./crypto", () => ({
  encryptJson: vi.fn((x: unknown) => Promise.resolve(x)),
  decryptJson: vi.fn((x: unknown) => Promise.resolve(x)),
}));
vi.mock("./identity", () => ({
  resolveNamespace: vi.fn().mockResolvedValue({ tenantId: "t1", userId: "u1" }),
}));
vi.mock("./indexedDb", () => ({
  requestBackgroundSync: vi.fn().mockResolvedValue(undefined),
  registerServiceWorker: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./headers", () => ({
  buildSyncHeaders: vi.fn(() => ({})),
}));

type Row = Record<string, unknown> & { id: string };

function createFakeIDB() {
  const records = new Map<string, Row>();

  function makeReq<T>(getValue: () => T) {
    let successHandler: ((e: Event) => void) | undefined;
    const req = {
      result: undefined as T,
      error: null,
      get onsuccess() { return successHandler ?? null; },
      set onsuccess(fn: ((e: Event) => void) | null) {
        successHandler = fn ?? undefined;
        Promise.resolve().then(() => {
          const v = getValue();
          (req as { result: T }).result = v;
          successHandler?.({} as Event);
        });
      },
      set onerror(_fn: unknown) { /* not needed for happy paths */ },
    };
    return req as unknown as IDBRequest<T>;
  }

  const fakeStore = {
    getAll: () => makeReq<Row[]>(() => [...records.values()]),
    put: (val: Row) => makeReq<undefined>(() => { records.set(val.id, val); return undefined; }),
    delete: (key: string) => makeReq<undefined>(() => { records.delete(key); return undefined; }),
    createIndex: () => {},
  };

  function makeTx() {
    let completeHandler: (() => void) | undefined;
    const tx = {
      objectStore: (_n: string) => fakeStore,
      get oncomplete() { return completeHandler ?? null; },
      set oncomplete(fn: (() => void) | null) {
        completeHandler = fn ?? undefined;
        Promise.resolve().then(() => Promise.resolve().then(() => completeHandler?.()));
      },
    };
    return tx;
  }

  const fakeDB = {
    transaction: (_n: string, _m: string) => makeTx(),
    objectStoreNames: { contains: () => true },
    createObjectStore: () => fakeStore,
    close: () => {},
  };

  const fakeIndexedDB = {
    open: (_name: string, _version: number) => {
      let successHandler: ((e: Event) => void) | undefined;
      const req = {
        result: fakeDB,
        error: null,
        set onupgradeneeded(_fn: unknown) { /* schema already "exists" */ },
        set onsuccess(fn: ((e: Event) => void) | null) {
          successHandler = fn ?? undefined;
          Promise.resolve().then(() => successHandler?.({} as Event));
        },
        set onerror(_fn: unknown) {},
      };
      return req as unknown as IDBOpenDBRequest;
    },
  };

  return { fakeIndexedDB, records };
}

const APPROVAL_PATH = "/v1/workflow/tasks/42/approve";
const IDEMPOTENCY_KEY = "test-idem-key-offline-home-02";

describe("requestQueue — GAP-OFFLINE-HOME-02", () => {
  const fetchMock = vi.fn();
  let idb: ReturnType<typeof createFakeIDB>;

  beforeEach(() => {
    fetchMock.mockReset();
    idb = createFakeIDB();
    vi.stubGlobal("indexedDB", idb.fakeIndexedDB);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Given: a queued approval persisted while offline,
   * When:  connection returns and flushRequestQueue is called,
   * Then:  exactly one request is sent, carrying the original idempotency key.
   */
  it("sends exactly one request per queued item, reusing the stored idempotency key", async () => {
    idb.records.set(IDEMPOTENCY_KEY, {
      id: IDEMPOTENCY_KEY,
      method: "POST",
      path: APPROVAL_PATH,
      body: { decision: "approved", comment: "LGTM" },
      idempotencyKey: IDEMPOTENCY_KEY,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    });

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => ({}) });

    const result = await flushRequestQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(APPROVAL_PATH);
    const headers = opts.headers as Record<string, string>;
    expect(headers["x-idempotency-key"]).toBe(IDEMPOTENCY_KEY);
    expect(result.flushed).toBe(1);
    expect(result.remaining).toBe(0);
  });

  /**
   * Given: the outbox is empty,
   * When:  flushRequestQueue runs,
   * Then:  no fetch is made and pendingRequestCount returns 0.
   */
  it("makes no request when the outbox is empty", async () => {
    const result = await flushRequestQueue();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.flushed).toBe(0);
    expect(result.remaining).toBe(0);

    const count = await pendingRequestCount();
    expect(count).toBe(0);
  });

  /**
   * Given: a queued item whose server responds with a permanent 4xx,
   * When:  flushRequestQueue runs,
   * Then:  the item is removed (no retry for client errors).
   */
  it("removes items permanently rejected with a 4xx response", async () => {
    idb.records.set(IDEMPOTENCY_KEY, {
      id: IDEMPOTENCY_KEY,
      method: "POST",
      path: APPROVAL_PATH,
      body: {},
      idempotencyKey: IDEMPOTENCY_KEY,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    });

    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, json: () => ({}) });

    const result = await flushRequestQueue();

    expect(result.flushed).toBe(1);
    expect(result.remaining).toBe(0);
  });
});

function seed(idb: { records: Map<string, Row> }, key = IDEMPOTENCY_KEY, retryCount = 0): void {
  idb.records.set(key, {
    id: key,
    method: "POST",
    path: APPROVAL_PATH,
    body: {},
    idempotencyKey: key,
    createdAt: new Date().toISOString(),
    retryCount,
  });
}

describe("requestQueue — CLOS3-S3-03 flush re-entrancy", () => {
  const fetchMock = vi.fn();
  let idb: ReturnType<typeof createFakeIDB>;

  beforeEach(() => {
    fetchMock.mockReset();
    idb = createFakeIDB();
    vi.stubGlobal("indexedDB", idb.fakeIndexedDB);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("concurrent flushes send each queued write once and share one result", async () => {
    seed(idb);
    fetchMock.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: () => ({}) }), 5)),
    );
    const [a, b] = await Promise.all([flushRequestQueue(), flushRequestQueue()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.flushed).toBe(1);
  });

  it("releases the lock after completion so a later flush runs again", async () => {
    seed(idb);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => ({}) });
    await flushRequestQueue();
    seed(idb, "second-key");
    const r = await flushRequestQueue();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.flushed).toBe(1);
  });

  it("releases the lock after a rejection", async () => {
    vi.mocked(resolveNamespace).mockRejectedValueOnce(new Error("no identity"));
    await expect(flushRequestQueue()).rejects.toThrow("no identity");
    seed(idb);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => ({}) });
    const r = await flushRequestQueue();
    expect(r.flushed).toBe(1);
  });
});

describe("requestQueue — CLOS3-S3-04 transient 4xx", () => {
  const fetchMock = vi.fn();
  let idb: ReturnType<typeof createFakeIDB>;

  beforeEach(() => {
    fetchMock.mockReset();
    idb = createFakeIDB();
    vi.stubGlobal("indexedDB", idb.fakeIndexedDB);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([408, 425, 429])("keeps the item queued with retryCount+1 on transient %i", async (status) => {
    seed(idb);
    fetchMock.mockResolvedValueOnce({ ok: false, status, json: () => ({}) });
    const r = await flushRequestQueue();
    expect(r).toEqual({ flushed: 0, remaining: 1 });
    expect(idb.records.get(IDEMPOTENCY_KEY)?.retryCount).toBe(1);
  });

  it.each([400, 409])("still deletes and counts permanent %i rejections", async (status) => {
    seed(idb);
    fetchMock.mockResolvedValueOnce({ ok: false, status, json: () => ({}) });
    const r = await flushRequestQueue();
    expect(r).toEqual({ flushed: 1, remaining: 0 });
  });

  it("dead-letters a transient-4xx item at the retry cap without counting it as flushed", async () => {
    seed(idb, IDEMPOTENCY_KEY, 7);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: () => ({}) });
    const r = await flushRequestQueue();
    expect(r).toEqual({ flushed: 0, remaining: 0 });
  });
});


describe("requestQueue — CLOS3-S3-05 replay timeout", () => {
  const fetchMock = vi.fn();
  let idb: ReturnType<typeof createFakeIDB>;

  beforeEach(() => {
    fetchMock.mockReset();
    idb = createFakeIDB();
    vi.stubGlobal("indexedDB", idb.fakeIndexedDB);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a hung replay aborts after 30 s: flush settles, the item stays queued and retryCount is untouched", async () => {
    vi.useFakeTimers();
    seed(idb);
    seed(idb, "second-key");
    // Honours the abort signal, otherwise never resolves (a hung connection).
    fetchMock.mockImplementation((_url: string, init: { signal?: AbortSignal }) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      }));

    let settled = false;
    const p = flushRequestQueue().then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    const r = await p;

    expect(r).toEqual({ flushed: 0, remaining: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // loop stops, later writes retry on the next flush
    expect(idb.records.get(IDEMPOTENCY_KEY)?.retryCount).toBe(0);
  });

  it("a prompt reply is unaffected and clears its timer", async () => {
    vi.useFakeTimers();
    seed(idb);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => ({}) });
    const r = await flushRequestQueue();
    expect(r).toEqual({ flushed: 1, remaining: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
