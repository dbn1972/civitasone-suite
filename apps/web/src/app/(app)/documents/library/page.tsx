import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmptyState, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { getDocumentFiles, getDocumentFolders, getDocumentStats } from "../_data/loaders";
import type { FileSummary, FolderSummary } from "../_data/types";
import { toHumanError } from "@/lib/messages";
import { humanizeStatus } from "@/lib/formatters";
import { FileActions } from "./FileActions";

// GAP-DOCUMENTS-LIBRARY-07: strings come from the `documentsLibrary` i18n
// namespace (next-intl is the single i18n system for apps/web — see
// src/i18n/config.ts); en/hi parity is enforced by the i18n parity check.
type T = Awaited<ReturnType<typeof getTranslations>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * GAP-DOCUMENTS-LIBRARY-06: a short human label for a MIME type ("Word" instead
 * of "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
 * so a long vnd.* string doesn't blow out the column. The full MIME stays in the
 * cell's `title` for anyone who needs it.
 */
export function mimeLabel(mime: string | null): string {
  if (!mime) return "—";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "Excel";
  if (mime === "text/csv" || mime.endsWith("/csv")) return "CSV";
  if (mime.includes("wordprocessing") || mime.includes("msword")) return "Word";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "PowerPoint";
  if (mime.startsWith("image/")) return "Image";
  if (mime.includes("zip") || mime.includes("compressed")) return "ZIP";
  if (mime === "text/plain") return "Text";
  const slash = mime.lastIndexOf("/");
  return slash >= 0 ? mime.slice(slash + 1).toUpperCase() : mime;
}

/** GAP-DOCUMENTS-LIBRARY-06: renamed from the misleading `priorityPill` (file status, not priority). */
export function fileStatusTone(status: string) {
  if (status === "active") return "good";
  if (status === "deleted") return "bad";
  return "mut";
}

function FolderRow({ folder, t }: { folder: FolderSummary; t: T }) {
  return (
    <tr>
      <td>
        <Link href={`/documents/library?folderId=${folder.id}`}>📁 <strong>{folder.name}</strong></Link>
        {folder.path && folder.path !== "/" && (
          <div style={{ fontSize: 12, color: "var(--ink2)" }}>{folder.path}</div>
        )}
      </td>
      <td>{t("typeFolder")}</td>
      <td><span className="sr-only">{t("notApplicable")}</span>—</td>
      <td><span className="sr-only">{t("notApplicable")}</span>—</td>
      <td><span className="sr-only">{t("notApplicable")}</span>—</td>
      <td><span className="sr-only">{t("notApplicable")}</span>—</td>
      <td><span className="sr-only">{t("notApplicable")}</span>—</td>
    </tr>
  );
}

function FileRow({ file }: { file: FileSummary }) {
  return (
    <tr>
      <td>{mimeIcon(file.mimeType)} {file.name}</td>
      <td><span className="pill mut" title={file.mimeType ?? undefined}>{mimeLabel(file.mimeType)}</span></td>
      <td>{formatBytes(file.sizeBytes)}</td>
      <td>{file.tags.length > 0 ? file.tags.join(", ") : "—"}</td>
      <td><span className={`pill ${fileStatusTone(file.status)}`}>{humanizeStatus(file.status)}</span></td>
      <td>v{file.version}</td>
      <td><FileActions fileId={file.id} name={file.name} status={file.status} /></td>
    </tr>
  );
}

export default async function DocumentLibraryPage({
  searchParams,
}: {
  searchParams: { folderId?: string; showDeleted?: string };
}) {
  const folderId = searchParams.folderId;
  const showDeleted = searchParams.showDeleted === "1";
  const t = await getTranslations("documentsLibrary");

  // GAP-DOCUMENTS-LIBRARY-04: a malformed folderId is a bad URL, not a fetch
  // failure — 404 before we even call the API.
  if (folderId !== undefined && !UUID_RE.test(folderId)) notFound();

  const [
    { data: files, source: fSource },
    { data: folders, source: foldersSource },
    { data: stats, source: statsSource },
  ] = await Promise.all([
    getDocumentFiles(folderId),
    getDocumentFolders(),
    getDocumentStats(),
  ]);

  // GAP-DOCUMENTS-LIBRARY-04: a well-formed but unknown/deleted/foreign folderId
  // is a 404 — but ONLY when the folders list actually loaded. A folders-fetch
  // failure must stay a transient error with a retry (handled below), never a
  // 404 (see LIBRARY-05).
  if (folderId !== undefined && foldersSource === "api" && !folders.some((f) => f.id === folderId)) {
    notFound();
  }

  // UX-013: each loader can fail independently -- a folders-fetch failure
  // must not render the same "empty folder, upload the first file" prompt
  // as a genuinely empty directory.
  const errored = fSource === "error" || foldersSource === "error";

  const currentFolders = folderId
    ? folders.filter((f) => f.parentId === folderId)
    : folders.filter((f) => f.parentId == null);

  // GAP-DOCUMENTS-LIBRARY-02: deleted files are hidden by default (official
  // records retention), shown only behind an explicit toggle.
  const visibleFiles = showDeleted ? files : files.filter((f) => f.status !== "deleted");
  const deletedCount = files.filter((f) => f.status === "deleted").length;

  const base = folderId ? `/documents/library?folderId=${folderId}` : "/documents/library";
  const toggleHref = showDeleted ? base : `${base}${folderId ? "&" : "?"}showDeleted=1`;

  return (
    <div className="wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <Link href="/documents/new" className="btn primary" style={{ minHeight: 44 }}>{t("uploadAction")}</Link>
            <Link href="/documents/inbox" className="btn" style={{ minHeight: 44 }}>{t("inboxAction")}</Link>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📂" iconBg="var(--panel)" label={t("statFiles")} value={fSource === "error" ? "—" : visibleFiles.length.toLocaleString("en-IN")} />
        <StatCard icon="🗂️" iconBg="var(--panel)" label={t("statSubfolders")} value={foldersSource === "error" ? "—" : currentFolders.length.toLocaleString("en-IN")} />
        <StatCard icon="📥" iconBg="var(--panel)" label={t("statInboxAll")} value={statsSource === "error" ? "—" : stats.inboxCount.toLocaleString("en-IN")} />
        <StatCard icon="⚡" iconBg="var(--panel)" label={t("statUrgentAll")} value={statsSource === "error" ? "—" : stats.urgentCount.toLocaleString("en-IN")} />
      </StatGrid>

      {/* GAP-DOCUMENTS-LIBRARY-05: one inline note when the counts loader failed,
          instead of a stray badge that duplicates the error card below. */}
      {statsSource === "error" && (
        <p role="status" style={{ color: "var(--ink2)", fontSize: 13, marginTop: 8 }}>{t("countsUnavailable")}</p>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>
            {folderId ? (
              <>
                <Link href="/documents/library" style={{ color: "var(--ink2)" }}>{t("breadcrumbLibrary")}</Link>
                {" / "}
                {folders.find((f) => f.id === folderId)?.name ?? t("folderFallback")}
              </>
            ) : (
              t("rootHeading")
            )}
          </h3>
          {!errored && (deletedCount > 0 || showDeleted) && (
            <Link href={toggleHref} className="btn" style={{ padding: "4px 10px", fontSize: 13 }}>
              {showDeleted ? t("hideDeleted") : t("showDeleted", { count: deletedCount })}
            </Link>
          )}
        </div>

        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: t("errorArea") })} />
        ) : currentFolders.length === 0 && visibleFiles.length === 0 ? (
          <EmptyState icon="📂" title={t("emptyTitle")} message={t("emptyMessage")} />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">{t("colName")}</th>
                  <th scope="col">{t("colType")}</th>
                  <th scope="col">{t("colSize")}</th>
                  <th scope="col">{t("colTags")}</th>
                  <th scope="col">{t("colStatus")}</th>
                  <th scope="col">{t("colVersion")}</th>
                  <th scope="col">{t("colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {currentFolders.map((f) => <FolderRow key={f.id} folder={f} t={t} />)}
                {visibleFiles.map((f) => <FileRow key={f.id} file={f} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
