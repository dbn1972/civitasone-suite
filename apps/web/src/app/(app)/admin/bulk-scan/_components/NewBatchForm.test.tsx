import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { NewBatchForm } from "./NewBatchForm";
import { settingsObject } from "@/lib/bulkScan/fixtures";
import { mapBatch, mapBatchFiles, mapSettings } from "@/lib/bulkScan/mappers";
import { BATCH, file, jsonResponse, renderIntl } from "./testHelpers";
import type { PutFn, PutResult } from "@/lib/bulkScan/xhrPut";

const settings = { data: mapSettings({ settings: { ...settingsObject(), limits: { maxFileBytes: 5000, maxFilesPerBatch: 10, maxBatchBytes: 100000 } }, version: 1, degraded: false, pendingRequests: [] }), source: "api" as const };
const base = { settings, profiles: { data: [], source: "api" as const }, folders: { data: [], source: "api" as const } };
const UUID = "123e4567-e89b-42d3-a456-426614174000";

const pdf = (name: string, body = "%PDF-1.4 content"): File => new File([body], name, { type: "application/pdf" });
function select(files: File[]): void {
  fireEvent.change(screen.getByTestId("file-input"), { target: { files } });
}

describe("NewBatchForm: creation form", () => {
  const f = vi.fn();
  beforeEach(() => { f.mockReset(); vi.stubGlobal("fetch", f); });
  afterEach(() => vi.unstubAllGlobals());

  it("validates before submitting: a name is required and nothing is sent", () => {
    renderIntl(<NewBatchForm {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
    expect(screen.getByText("Enter a batch name.")).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects a link target the tenant has not enabled", () => {
    const s = { ...settings, data: mapSettings({ settings: { ...settingsObject(), allowedLinkTargets: ["hr_employee"] }, version: 1, degraded: false, pendingRequests: [] }) };
    renderIntl(<NewBatchForm {...base} settings={s} />);
    const sel = screen.getByLabelText("Link to a record");
    expect(within(sel).queryByRole("option", { name: "Finance payment" })).not.toBeInTheDocument();
    expect(within(sel).getByRole("option", { name: "HR employee file" })).toBeInTheDocument();
  });

  it("creates the batch (202), waits for it to exist, then opens the uploader", async () => {
    f.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url.endsWith("/batches") && init?.method === "POST") return jsonResponse(202, { id: UUID, status: "accepted" });
      if (url.endsWith(`/batches/${UUID}`)) return f.mock.calls.filter((c) => String(c[0]).endsWith(`/batches/${UUID}`)).length < 2 ? jsonResponse(404, { code: "NOT_FOUND" }) : jsonResponse(200, { ...BATCH, id: UUID, name: "Intake", fileCount: 0, totalBytes: 0, counts: {} });
      return jsonResponse(500, {});
    });
    renderIntl(<NewBatchForm {...base} />);
    fireEvent.change(screen.getByLabelText(/Batch name/), { target: { value: "Intake" } });
    fireEvent.change(screen.getByLabelText("Default tags"), { target: { value: "hr, 2019" } });
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
    expect(await screen.findByText("Drag files or folders here", {}, { timeout: 4000 })).toBeInTheDocument();
    const post = f.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toEqual({ name: "Intake", defaultTags: ["hr", "2019"] });
  });
});

describe("NewBatchForm: uploads", () => {
  const f = vi.fn();
  beforeEach(() => { f.mockReset(); vi.stubGlobal("fetch", f); });
  afterEach(() => vi.unstubAllGlobals());

  const resume = (files: unknown[] = []) => ({
    batch: { data: mapBatch({ ...BATCH, id: UUID, fileCount: files.length, totalBytes: 0, counts: {} }), source: "api" as const },
    files: { data: mapBatchFiles({ data: files, pagination: { hasMore: false, pageSize: 500 } })!, source: "api" as const },
  });

  function server(): void {
    let n = 0;
    f.mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url.endsWith("/files/upload-urls")) {
        const body = JSON.parse(init!.body!) as { files: Array<{ name: string }> };
        return jsonResponse(202, { id: "r", status: "accepted", data: { uploads: body.files.map((x) => ({ fileId: `id-${++n}`, name: x.name, method: "PUT", url: `https://s3.example/${x.name}`, headers: { "content-type": "application/pdf" }, expiresInSeconds: 900 })) } });
      }
      if (/\/files\/[^/]+\/upload-url$/.test(url)) return jsonResponse(200, { data: { fileId: url.split("/files/")[1]!.split("/")[0], method: "PUT", url: `https://s3.example/reissued-${url.split("/files/")[1]!.split("/")[0]}`, headers: {}, expiresInSeconds: 900 } });
      if (url.endsWith("/files/complete")) return jsonResponse(202, { id: "c", status: "accepted" });
      return jsonResponse(500, {});
    });
  }

  it("pre-validates magic bytes and limits client-side and never uploads rejected files", async () => {
    server();
    const put: PutFn = vi.fn(async () => ({ ok: true as const }));
    renderIntl(<NewBatchForm {...base} resume={resume()} put={put} />);
    select([pdf("good.pdf"), new File(["just text"], "fake.pdf", { type: "application/pdf" }), pdf("huge.pdf", "%PDF-1.4" + "x".repeat(6000)), pdf("locked.pdf", "%PDF-1.4 /Encrypt 5 0 R")]);
    expect(await screen.findByText("Not a PDF, TIFF, JPEG or PNG file.")).toBeInTheDocument();
    expect(screen.getByText("Larger than the allowed file size.")).toBeInTheDocument();
    expect(screen.getByText("Password-protected PDF.")).toBeInTheDocument();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect((put as ReturnType<typeof vi.fn>).mock.calls[0]![0].url).toBe("https://s3.example/good.pdf");
  });

  it("uploads with at most 3 in flight, then confirms with files/complete", async () => {
    server();
    let running = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];
    const put: PutFn = vi.fn(({ onProgress }) => new Promise<PutResult>((resolve) => {
      running++; peak = Math.max(peak, running);
      onProgress(5);
      resolvers.push(() => { running--; resolve({ ok: true }); });
    }));
    renderIntl(<NewBatchForm {...base} resume={resume()} put={put} />);
    select(["a", "b", "c", "d", "e"].map((n) => pdf(`${n}.pdf`)));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(3));
    expect(peak).toBe(3);
    resolvers.splice(0).forEach((r) => r());
    await waitFor(() => expect(put).toHaveBeenCalledTimes(5));
    resolvers.splice(0).forEach((r) => r());
    expect(peak).toBe(3);
    await waitFor(() => expect(screen.getByText(/5 done, 0 in progress, 0 failed/)).toBeInTheDocument());
    const completes = f.mock.calls.filter((c) => String(c[0]).endsWith("/files/complete")).flatMap((c) => (JSON.parse(c[1].body) as { files: Array<{ fileId: string }> }).files.map((x) => x.fileId));
    expect(completes.sort()).toEqual(["id-1", "id-2", "id-3", "id-4", "id-5"]);
    expect(screen.getByRole("progressbar", { name: "Overall upload progress" })).toHaveAttribute("aria-valuenow", "100");
  });

  it("a failed upload can be retried and continues without redoing the others", async () => {
    server();
    let first = true;
    const put: PutFn = vi.fn(async ({ url }) => (url.endsWith("flaky.pdf") && first ? ((first = false), { ok: false as const, status: 500 }) : { ok: true as const }));
    renderIntl(<NewBatchForm {...base} resume={resume()} put={put} />);
    select([pdf("flaky.pdf"), pdf("fine.pdf")]);
    const retry = await screen.findByRole("button", { name: "Retry 1 failed" });
    expect(screen.getByText("The upload was interrupted. Retry to continue.")).toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText(/2 done, 0 in progress, 0 failed/)).toBeInTheDocument());
    expect(put).toHaveBeenCalledTimes(3);
    // the retry reused the still-valid presigned URL: only one upload-urls request in total
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith("/upload-urls"))).toHaveLength(1);
  });

  it("resume: files already on the server are not uploaded again and the operator is told what is left", async () => {
    server();
    const put: PutFn = vi.fn(async () => ({ ok: true as const }));
    const r = resume([file("s1", "queued", { originalName: "done.pdf", sizeBytes: "%PDF-1.4 content".length }), file("s2", "pending_upload", { originalName: "todo.pdf", sizeBytes: 16 })]);
    renderIntl(<NewBatchForm {...base} resume={r} put={put} />);
    expect(screen.getByText("Some files still need uploading")).toBeInTheDocument();
    select([pdf("done.pdf"), pdf("todo.pdf")]);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect((put as ReturnType<typeof vi.fn>).mock.calls[0]![0].url).toBe("https://s3.example/reissued-s2");
    expect(await screen.findByText("Already on server")).toBeInTheDocument();
  });

  it("resume uses the re-issue route for a pending_upload row instead of registering the file again", async () => {
    server();
    const put: PutFn = vi.fn(async () => ({ ok: true as const }));
    renderIntl(<NewBatchForm {...base} resume={resume([file("srv-todo", "pending_upload", { originalName: "todo.pdf", sizeBytes: 16 })])} put={put} />);
    select([pdf("todo.pdf")]);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect((put as ReturnType<typeof vi.fn>).mock.calls[0]![0].url).toBe("https://s3.example/reissued-srv-todo");
    expect(f.mock.calls.some((c) => String(c[0]).endsWith("/upload-urls"))).toBe(false);
    expect(f.mock.calls.some((c) => String(c[0]).endsWith("/files/srv-todo/upload-url"))).toBe(true);
    await waitFor(() => expect(f.mock.calls.some((c) => String(c[0]).endsWith("/files/complete"))).toBe(true));
    expect(JSON.parse(f.mock.calls.find((c) => String(c[0]).endsWith("/files/complete"))![1].body)).toEqual({ files: [{ fileId: "srv-todo" }] });
  });

  it("outside development a plain-http presigned URL is refused with a human error and nothing is PUT; loopback http and https are fine", async () => {
    vi.stubEnv("NODE_ENV", "production");
    f.mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url.endsWith("/files/upload-urls")) {
        const body = JSON.parse(init!.body!) as { files: Array<{ name: string }> };
        return jsonResponse(202, { data: { uploads: body.files.map((x, n) => ({ fileId: `id-${n}`, method: "PUT", url: `http://s3.example/${x.name}`, headers: {}, expiresInSeconds: 900 })) } });
      }
      return jsonResponse(500, {});
    });
    const put: PutFn = vi.fn(async () => ({ ok: true as const }));
    renderIntl(<NewBatchForm {...base} resume={resume()} put={put} />);
    select([pdf("plain.pdf")]);
    expect(await screen.findByText(/upload address is not secure \(https\)/)).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("resume by content hash: a same-name, same-size file whose content differs from the server row is uploaded, the identical one is not", async () => {
    const { webcrypto, createHash } = await import("node:crypto");
    vi.stubGlobal("crypto", webcrypto);
    const sha = (b: string): string => createHash("sha256").update(b).digest("hex");
    server();
    const put: PutFn = vi.fn(async () => ({ ok: true as const }));
    const same = "%PDF-1.4 AAAA";
    const other = "%PDF-1.4 BBBB";
    const r = resume([file("srv-1", "queued", { originalName: "x.pdf", sizeBytes: same.length, sha256: sha(same) }), file("srv-2", "queued", { originalName: "y.pdf", sizeBytes: same.length, sha256: sha(same) })]);
    renderIntl(<NewBatchForm {...base} resume={r} put={put} />);
    select([pdf("x.pdf", same), pdf("y.pdf", other)]);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect((put as ReturnType<typeof vi.fn>).mock.calls[0]![0].url).toBe("https://s3.example/y.pdf");
    expect(await screen.findByText("Already on server")).toBeInTheDocument();
  });

  it("NOT_PENDING_UPLOAD on re-issue means the file already moved on: shown as already on the server", async () => {
    f.mockImplementation(async (url: string) => (/upload-url$/.test(url) ? jsonResponse(409, { code: "NOT_PENDING_UPLOAD" }) : jsonResponse(500, {})));
    const put: PutFn = vi.fn(async () => ({ ok: true as const }));
    renderIntl(<NewBatchForm {...base} resume={resume([file("srv-x", "pending_upload", { originalName: "x.pdf", sizeBytes: 16 })])} put={put} />);
    select([pdf("x.pdf")]);
    expect(await screen.findByText("Already on server")).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it("the folder input and drop zone are keyboard reachable buttons", () => {
    renderIntl(<NewBatchForm {...base} resume={resume()} />);
    expect(screen.getByRole("button", { name: "Choose files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a folder" })).toBeInTheDocument();
    expect(screen.getByTestId("dir-input")).toHaveAttribute("webkitdirectory");
  });

  it("an unknown resume batch is a not-found state, a failed load an error", () => {
    const missing = { batch: { data: null, source: "error" as const, status: 404 }, files: { data: mapBatchFiles({ data: [] })!, source: "error" as const } };
    const { unmount } = renderIntl(<NewBatchForm {...base} resume={missing} />);
    expect(screen.getByText("Batch not found")).toBeInTheDocument();
    unmount();
    renderIntl(<NewBatchForm {...base} resume={{ ...missing, batch: { data: null, source: "error", status: 500 } }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
