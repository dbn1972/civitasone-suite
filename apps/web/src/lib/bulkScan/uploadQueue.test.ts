import { describe, it, expect } from "vitest";
import {
  matchPendingUploads, pendingForReissue, awaitingComplete, expiryFrom, initialUploadState, isSettled, matchServerFiles, nextToUpload, pendingForUrls, retryableCount, summarize, toManifest,
  unfinishedFromManifest, uploadReducer, URL_EXPIRED_KEY, type UploadAction, type UploadState,
} from "./uploadQueue";
import type { Candidate } from "./uploadValidation";

const cand = (name: string, size = 100, reject: Candidate["reject"] = null): Candidate => ({ key: `${name}|${size}`, name, relPath: name, size, mime: "application/pdf", reject });
const run = (actions: UploadAction[], from: UploadState = initialUploadState): UploadState => actions.reduce(uploadReducer, from);
const urls = (names: string[], expiresAt = 10_000_000): UploadAction => ({
  type: "urls", assignments: names.map((n) => ({ key: `${n}|100`, fileId: `id-${n}`, url: `https://s3/${n}`, headers: {}, expiresAt })),
});

describe("upload queue state machine", () => {
  it("marks client-rejected files invalid and never schedules them", () => {
    const s = run([{ type: "add", candidates: [cand("a"), cand("bad", 100, "ENCRYPTED_PDF")] }]);
    expect(s.items.map((i) => i.status)).toEqual(["pending", "invalid"]);
    expect(pendingForUrls(s).map((i) => i.name)).toEqual(["a"]);
  });
  it("does not add the same file twice", () => {
    const s = run([{ type: "add", candidates: [cand("a")] }, { type: "add", candidates: [cand("a")] }]);
    expect(s.items).toHaveLength(1);
  });
  it("bounds concurrency: never more than N uploading at once", () => {
    const names = ["a", "b", "c", "d", "e"];
    let s = run([{ type: "add", candidates: names.map((n) => cand(n)) }, urls(names)]);
    const first = nextToUpload(s, 3);
    expect(first.map((i) => i.name)).toEqual(["a", "b", "c"]);
    s = run(first.map((i) => ({ type: "start" as const, key: i.key })), s);
    expect(nextToUpload(s, 3)).toHaveLength(0);
    s = run([{ type: "putOk", key: "a|100" }], s);
    expect(nextToUpload(s, 3).map((i) => i.name)).toEqual(["d"]);
  });
  it("walks pending -> ready -> uploading -> uploaded -> completed", () => {
    let s = run([{ type: "add", candidates: [cand("a")] }, urls(["a"]), { type: "start", key: "a|100" }, { type: "progress", key: "a|100", loaded: 40 }]);
    expect(s.items[0]).toMatchObject({ status: "uploading", loaded: 40, attempts: 1 });
    s = run([{ type: "putOk", key: "a|100" }], s);
    expect(awaitingComplete(s).map((i) => i.fileId)).toEqual(["id-a"]);
    s = run([{ type: "completeOk", keys: ["a|100"] }], s);
    expect(s.items[0]!.status).toBe("completed");
    expect(isSettled(s)).toBe(true);
  });
  it("the PUT outcome is applied even if the start update was applied late or never (no dependence on update ordering)", () => {
    const ready = run([{ type: "add", candidates: [cand("a"), cand("b")] }, urls(["a", "b"])]);
    expect(run([{ type: "putOk", key: "a|100" }], ready).items[0]!.status).toBe("uploaded");
    const failed = run([{ type: "putFailed", key: "b|100", errorKey: "upload.putFailed" }], ready);
    expect(failed.items[1]).toMatchObject({ status: "failed", failedStage: "put" });
    expect(run([{ type: "progress", key: "a|100", loaded: 10 }], ready).items[0]).toMatchObject({ status: "uploading", loaded: 10 });
  });
  it("retry after a PUT failure reuses a still-valid URL, but asks for a new one when it expired", () => {
    const base = run([{ type: "add", candidates: [cand("a"), cand("b")] }, urls(["a", "b"], 1_000_000), { type: "start", key: "a|100" }, { type: "start", key: "b|100" }]);
    const failed = run([{ type: "putFailed", key: "a|100", errorKey: "upload.putFailed" }, { type: "putFailed", key: "b|100", errorKey: URL_EXPIRED_KEY }], base);
    expect(retryableCount(failed)).toBe(2);
    const retried = run([{ type: "retryFailed", now: 500_000 }], failed);
    expect(retried.items.find((i) => i.name === "a")).toMatchObject({ status: "ready", fileId: "id-a" });
    expect(retried.items.find((i) => i.name === "b")).toMatchObject({ status: "pending", fileId: "id-b", url: null });
    expect(pendingForReissue(retried).map((i) => i.name)).toEqual(["b"]);
    expect(pendingForUrls(retried)).toHaveLength(0);
    const late = run([{ type: "retryFailed", now: 2_000_000 }], failed);
    expect(late.items.find((i) => i.name === "a")?.status).toBe("pending");
  });
  it("re-issued URL makes the item ready again without a second registration", () => {
    const s = run([{ type: "add", candidates: [cand("a")] }, urls(["a"], 1), { type: "start", key: "a|100" }, { type: "putFailed", key: "a|100", errorKey: URL_EXPIRED_KEY }, { type: "retryFailed", now: 5 }, { type: "reissued", key: "a|100", url: "https://s3/new", headers: {}, expiresAt: 9_999_999 }]);
    expect(s.items[0]).toMatchObject({ status: "ready", fileId: "id-a", url: "https://s3/new" });
  });
  it("resume adopts a server row still in pending_upload for a re-selected file", () => {
    const s = run([{ type: "add", candidates: [cand("a"), cand("b")] }]);
    const m = matchPendingUploads(s, [{ id: "srv-a", originalName: "a", sizeBytes: 100, state: "pending_upload" }, { id: "srv-b", originalName: "b", sizeBytes: 100, state: "queued" }]);
    expect(m).toEqual([{ key: "a|100", fileId: "srv-a" }]);
    const after = run([{ type: "adoptPending", matches: m }], s);
    expect(pendingForUrls(after).map((i) => i.name)).toEqual(["b"]);
    expect(pendingForReissue(after).map((i) => i.fileId)).toEqual(["srv-a"]);
  });
  it("a failed confirm retries the confirm only, never the upload; a URL failure goes back to pending", () => {
    let s = run([{ type: "add", candidates: [cand("a"), cand("b")] }, { type: "urlFailed", keys: ["b|100"], errorKey: "apiError.network" }, urls(["a"]), { type: "start", key: "a|100" }, { type: "putOk", key: "a|100" }, { type: "completeFailed", keys: ["a|100"], errorKey: "apiError.server" }]);
    expect(s.items.map((i) => i.failedStage)).toEqual(["complete", "url"]);
    s = run([{ type: "retryFailed", now: 0 }], s);
    expect(s.items.map((i) => i.status)).toEqual(["uploaded", "pending"]);
  });
  it("resume: files the server already holds are marked on_server and skipped; pending_upload rows are not", () => {
    const s = run([{ type: "add", candidates: [cand("a"), cand("b"), cand("c")] }]);
    const matches = matchServerFiles(s, [
      { id: "s1", originalName: "a", sizeBytes: 100, state: "queued" },
      { id: "s2", originalName: "b", sizeBytes: 100, state: "pending_upload" },
      { id: "s3", originalName: "c", sizeBytes: 999, state: "filed" },
    ]);
    expect(matches).toEqual([{ key: "a|100", fileId: "s1" }]);
    const after = run([{ type: "onServer", matches }], s);
    expect(after.items.map((i) => i.status)).toEqual(["on_server", "pending", "pending"]);
    expect(pendingForUrls(after).map((i) => i.name)).toEqual(["b", "c"]);
  });
  it("same name + size on two local files but one server row is ambiguous: nothing is guessed (the other would be lost), unless the previous session recorded which path was uploaded", () => {
    const s = run([{ type: "add", candidates: [{ ...cand("a"), key: "x/a|100", relPath: "x/a" }, { ...cand("a"), key: "y/a|100", relPath: "y/a" }] }]);
    const row = [{ id: "s1", originalName: "a", sizeBytes: 100, state: "queued" }];
    expect(matchServerFiles(s, row)).toEqual([]);
    expect(matchServerFiles(s, row, { uploadedKeys: new Set(["y/a|100"]) })).toEqual([{ key: "y/a|100", fileId: "s1" }]);
  });
  it("same name + size with as many server rows as local files: every local file is on the server, each row used once", () => {
    const s = run([{ type: "add", candidates: [{ ...cand("a"), key: "x/a|100", relPath: "x/a" }, { ...cand("a"), key: "y/a|100", relPath: "y/a" }] }]);
    const m = matchServerFiles(s, [{ id: "s1", originalName: "a", sizeBytes: 100, state: "queued" }, { id: "s2", originalName: "a", sizeBytes: 100, state: "filed" }]);
    expect(m.map((x) => x.key).sort()).toEqual(["x/a|100", "y/a|100"]);
    expect(new Set(m.map((x) => x.fileId)).size).toBe(2);
  });
  it("resume matches by content hash when both sides have one: right file even when names collide, and a different hash is never matched by name + size", () => {
    const s = run([{ type: "add", candidates: [{ ...cand("a"), key: "x/a|100", sha256: "h1" }, { ...cand("a"), key: "y/a|100", sha256: "h2" }, { ...cand("b"), sha256: "h9" }] }]);
    const m = matchServerFiles(s, [
      { id: "s-h2", originalName: "a", sizeBytes: 100, state: "queued", sha256: "h2" },
      { id: "s-b", originalName: "b", sizeBytes: 100, state: "queued", sha256: "other" },
    ]);
    expect(m).toEqual([{ key: "y/a|100", fileId: "s-h2" }]);
  });
  it("a server row without a hash still matches a hashed local file by name + size (hash is used only where known)", () => {
    const s = run([{ type: "add", candidates: [{ ...cand("a"), sha256: "h1" }] }]);
    expect(matchServerFiles(s, [{ id: "s1", originalName: "a", sizeBytes: 100, state: "queued" }])).toEqual([{ key: "a|100", fileId: "s1" }]);
  });
  it("error detail (app-standard copy + reference) is kept with the failure and cleared by a retry", () => {
    let s = run([{ type: "add", candidates: [cand("a")] }, { type: "urlFailed", keys: ["a|100"], errorKey: "apiError.generic", detail: { message: "We could not save.", reference: "ref-1" } }]);
    expect(s.items[0]!.errorDetail).toEqual({ message: "We could not save.", reference: "ref-1" });
    s = run([{ type: "retryFailed", now: 0 }], s);
    expect(s.items[0]!.errorDetail).toBeNull();
  });
  it("progress maths: bytes over valid files only, 100% when everything is done", () => {
    const s = run([{ type: "add", candidates: [cand("a", 100), cand("b", 300), cand("bad", 999, "FILE_TOO_LARGE")] }, { type: "urls", assignments: [{ key: "b|300", fileId: "i", url: "https://x", headers: {}, expiresAt: 1 }] }, { type: "start", key: "b|300" }, { type: "progress", key: "b|300", loaded: 150 }]);
    expect(summarize(s)).toMatchObject({ total: 3, invalid: 1, totalBytes: 400, sentBytes: 150, percent: 37 });
  });
  it("manifest keeps unfinished entries only, for reload", () => {
    const s = run([{ type: "add", candidates: [cand("a"), cand("b")] }, urls(["a"]), { type: "start", key: "a|100" }, { type: "putOk", key: "a|100" }, { type: "completeOk", keys: ["a|100"] }]);
    expect(unfinishedFromManifest(toManifest(s)).map((m) => m.name)).toEqual(["b"]);
  });
  it("expiry helper", () => { expect(expiryFrom(1000, 900)).toBe(901_000); });
  it("remove only drops files that never started uploading", () => {
    const s = run([{ type: "add", candidates: [cand("a"), cand("b")] }, urls(["a"]), { type: "start", key: "a|100" }]);
    expect(run([{ type: "remove", key: "a|100" }, { type: "remove", key: "b|100" }], s).items.map((i) => i.name)).toEqual(["a"]);
  });
});
