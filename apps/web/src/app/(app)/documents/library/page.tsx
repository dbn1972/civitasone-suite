import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { EmptyState, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { getDocumentFiles, getDocumentFolders, getDocumentStats } from "../_data/loaders";
import type { FileSummary, FolderSummary } from "../_data/types";
import { toHumanError } from "@/lib/messages";

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeIcon(mime: string | null): string {
  if (!mime) return "📄";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.includes("pdf")) return "📋";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) return "📊";
  if (mime.includes("word") || mime.includes("document")) return "📝";
  if (mime.includes("zip") || mime.includes("compressed")) return "🗜️";
  return "📄";
}

function priorityPill(status: string) {
  if (status === "active") return "good";
  if (status === "deleted") return "bad";
  return "mut";
}

function FolderRow({ folder }: { folder: FolderSummary }) {
  return (
    <tr>
      <td>📁 <strong>{folder.name}</strong></td>
      <td>{folder.path}</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td>
        <Link href={`/documents/library?folderId=${folder.id}`} className="btn" style={{ padding: "4px 10px", fontSize: 13 }}>
          Open
        </Link>
      </td>
    </tr>
  );
}

function FileRow({ file }: { file: FileSummary }) {
  return (
    <tr>
      <td>{mimeIcon(file.mimeType)} {file.name}</td>
      <td><span className="pill mut">{file.mimeType ?? "—"}</span></td>
      <td>{formatBytes(file.sizeBytes)}</td>
      <td>{file.tags.length > 0 ? file.tags.join(", ") : "—"}</td>
      <td><span className={`pill ${priorityPill(file.status)}`}>{file.status}</span></td>
      <td>v{file.version}</td>
    </tr>
  );
}

export default async function DocumentLibraryPage({
  searchParams,
}: {
  searchParams: { folderId?: string };
}) {
  const folderId = searchParams.folderId;

  const [
    { data: files, source: fSource },
    { data: folders, source: foldersSource },
    { data: stats, source: statsSource },
  ] = await Promise.all([
    getDocumentFiles(folderId),
    getDocumentFolders(),
    getDocumentStats(),
  ]);

  // UX-013: each loader can fail independently -- a folders-fetch failure
  // must not render the same "empty folder, upload the first file" prompt
  // as a genuinely empty directory.
  const errored = fSource === "error" || foldersSource === "error";

  const currentFolders = folderId
    ? folders.filter((f) => f.parentId === folderId)
    : folders.filter((f) => f.parentId == null);

  return (
    <div className="wrap">
      {fSource === "error" && <DataSourceBadge source={fSource} />}

      <PageHeader
        title="Document Library"
        subtitle="Browse folders and files. Use e-Office Inbox for workflow items."
        actions={
          <>
            <Link href="/documents/new" className="btn primary" style={{ minHeight: 44 }}>+ Upload File</Link>
            <Link href="/documents/inbox" className="btn" style={{ minHeight: 44 }}>e-Office Inbox</Link>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📂" iconBg="var(--panel)" label="Total Files" value={fSource === "error" ? "—" : files.length.toLocaleString("en-IN")} />
        <StatCard icon="🗂️" iconBg="var(--panel)" label="Folders" value={foldersSource === "error" ? "—" : folders.length.toLocaleString("en-IN")} />
        <StatCard icon="📥" iconBg="var(--panel)" label="Inbox" value={statsSource === "error" ? "—" : stats.inboxCount.toLocaleString("en-IN")} />
        <StatCard icon="⚡" iconBg="var(--panel)" label="Urgent" value={statsSource === "error" ? "—" : stats.urgentCount.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>
            {folderId ? (
              <>
                <Link href="/documents/library" style={{ color: "var(--ink2)" }}>Library</Link>
                {" / "}
                {folders.find((f) => f.id === folderId)?.name ?? folderId}
              </>
            ) : (
              "Library — Root"
            )}
          </h3>
        </div>

        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "document library" })} />
        ) : currentFolders.length === 0 && files.length === 0 ? (
          <EmptyState icon="📂" title="Empty folder" message="No files or sub-folders here yet. Upload the first file." />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Size</th>
                  <th scope="col">Tags</th>
                  <th scope="col">Status</th>
                  <th scope="col">Version</th>
                </tr>
              </thead>
              <tbody>
                {currentFolders.map((f) => <FolderRow key={f.id} folder={f} />)}
                {files.map((f) => <FileRow key={f.id} file={f} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
