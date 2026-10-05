/**
 * Collect files from a drag-and-drop (files AND folders via webkitGetAsEntry) or from a directory <input>
 * (webkitdirectory fallback). Pure of React: it takes the DataTransfer-like object, so it is unit-testable with fakes.
 */
export interface DroppedFile {
  file: File;
  /** path relative to the dropped root, folders included ("Scans/2019/page1.pdf") */
  relPath: string;
}

interface FsReader { readEntries(ok: (entries: FsEntry[]) => void, fail: (e: unknown) => void): void }
export interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (f: File) => void, fail: (e: unknown) => void): void;
  createReader?(): FsReader;
}
interface ItemLike { kind: string; webkitGetAsEntry?: () => FsEntry | null; getAsFile?: () => File | null }
export interface DataTransferLike { items?: ArrayLike<ItemLike> | null; files?: ArrayLike<File> | null }

/** OS junk that is never a scan. */
const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\._.*)$/i;
export const MAX_COLLECTED_FILES = 20000;

const readFile = (e: FsEntry): Promise<File | null> => new Promise((res) => {
  if (!e.file) return res(null);
  e.file((f) => res(f), () => res(null));
});

async function readAll(reader: FsReader): Promise<FsEntry[]> {
  const out: FsEntry[] = [];
  // readEntries returns at most ~100 entries per call; keep reading until it yields an empty batch.
  for (;;) {
    const batch = await new Promise<FsEntry[]>((res) => reader.readEntries((x) => res(x), () => res([])));
    if (batch.length === 0) return out;
    out.push(...batch);
  }
}

async function walk(entry: FsEntry, prefix: string, out: DroppedFile[]): Promise<void> {
  if (out.length >= MAX_COLLECTED_FILES) return;
  if (entry.isFile) {
    if (JUNK.test(entry.name)) return;
    const f = await readFile(entry);
    if (f) out.push({ file: f, relPath: `${prefix}${entry.name}` });
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    for (const child of await readAll(entry.createReader())) await walk(child, `${prefix}${entry.name}/`, out);
  }
}

export async function collectFromDataTransfer(dt: DataTransferLike): Promise<DroppedFile[]> {
  const out: DroppedFile[] = [];
  const items = dt.items ? Array.from(dt.items) : [];
  // The DataTransfer is only valid synchronously: take every entry / file BEFORE the first await.
  const entries: FsEntry[] = [];
  const plain: File[] = [];
  for (const it of items) {
    if (it.kind !== "file") continue;
    const entry = typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
    else {
      const f = it.getAsFile?.();
      if (f) plain.push(f);
    }
  }
  if (entries.length === 0 && plain.length === 0 && dt.files) plain.push(...Array.from(dt.files));
  for (const e of entries) await walk(e, "", out);
  for (const f of plain) if (!JUNK.test(f.name)) out.push({ file: f, relPath: f.name });
  return out.slice(0, MAX_COLLECTED_FILES);
}

/** Files from <input type=file multiple> or <input webkitdirectory>. */
export function collectFromFileList(files: ArrayLike<File> | null | undefined): DroppedFile[] {
  if (!files) return [];
  return Array.from(files)
    .filter((f) => !JUNK.test(f.name))
    .map((f) => ({ file: f, relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name }))
    .slice(0, MAX_COLLECTED_FILES);
}
