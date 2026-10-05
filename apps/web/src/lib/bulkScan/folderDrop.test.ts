import { describe, it, expect } from "vitest";
import { collectFromDataTransfer, collectFromFileList, type FsEntry } from "./folderDrop";

const file = (name: string): File => new File(["x"], name);
const fileEntry = (name: string): FsEntry => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(file(name)) });
const dirEntry = (name: string, children: FsEntry[], batch = 2): FsEntry => ({
  isFile: false, isDirectory: true, name,
  createReader: () => {
    let i = 0;
    return { readEntries: (ok) => { const out = children.slice(i, i + batch); i += batch; ok(out); } };
  },
});

describe("folder drop", () => {
  it("walks nested folders, reads entries in batches until empty, and keeps relative paths", async () => {
    const tree = dirEntry("Scans", [fileEntry("a.pdf"), fileEntry("b.pdf"), fileEntry("c.pdf"), dirEntry("2019", [fileEntry("d.pdf")])]);
    const out = await collectFromDataTransfer({ items: [{ kind: "file", webkitGetAsEntry: () => tree }] });
    expect(out.map((o) => o.relPath).sort()).toEqual(["Scans/2019/d.pdf", "Scans/a.pdf", "Scans/b.pdf", "Scans/c.pdf"]);
  });
  it("drops OS junk files and mixes loose files with folders", async () => {
    const out = await collectFromDataTransfer({ items: [
      { kind: "file", webkitGetAsEntry: () => dirEntry("D", [fileEntry(".DS_Store"), fileEntry("Thumbs.db"), fileEntry("x.pdf")]) },
      { kind: "file", webkitGetAsEntry: () => fileEntry("loose.png") },
      { kind: "string" },
    ] });
    expect(out.map((o) => o.relPath).sort()).toEqual(["D/x.pdf", "loose.png"]);
  });
  it("falls back to getAsFile / files when webkitGetAsEntry is unavailable", async () => {
    expect((await collectFromDataTransfer({ items: [{ kind: "file", getAsFile: () => file("a.pdf") }] })).map((o) => o.relPath)).toEqual(["a.pdf"]);
    expect((await collectFromDataTransfer({ files: [file("b.pdf")] })).map((o) => o.relPath)).toEqual(["b.pdf"]);
  });
  it("directory <input> fallback uses webkitRelativePath", () => {
    const f = Object.assign(file("p.pdf"), { webkitRelativePath: "Folder/sub/p.pdf" });
    expect(collectFromFileList([f, file(".DS_Store")]).map((o) => o.relPath)).toEqual(["Folder/sub/p.pdf"]);
    expect(collectFromFileList(null)).toEqual([]);
  });
});
