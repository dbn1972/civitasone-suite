import { getTranslations } from "next-intl/server";
import { AdminAccessDenied, sessionHasAnyRole } from "../../_components/AdminAccessGate";
import { BULK_SCAN_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { getBulkScanBatch, getBulkScanBatchFiles, getBulkScanProfiles, getBulkScanSettings } from "@/app/_data/bulkScanLoaders";
import { getDocumentFolders } from "@/app/(app)/documents/_data/loaders";
import { isUuid } from "@/lib/bulkScan/batchForm";
import { NewBatchForm } from "../_components/NewBatchForm";

export default async function NewBulkScanBatchPage({ searchParams }: { searchParams?: { batch?: string } }) {
  if (!sessionHasAnyRole(BULK_SCAN_ADMIN_ROLES)) {
    const t = await getTranslations("bulkScan");
    return <AdminAccessDenied title={t("new.title")} area={t("list.area")} roles={BULK_SCAN_ADMIN_ROLES} />;
  }
  // ?batch=<id> resumes uploading into an existing batch (after a reload or a failed upload).
  const resumeId = isUuid(searchParams?.batch) ? searchParams.batch : null;
  const [settings, profiles, folders, resumeBatch, resumeFiles] = await Promise.all([
    getBulkScanSettings(),
    getBulkScanProfiles(),
    getDocumentFolders(),
    resumeId ? getBulkScanBatch(resumeId) : Promise.resolve(null),
    // Every file the server knows about for the batch, so already-uploaded files are not sent twice.
    resumeId ? getBulkScanBatchFiles(resumeId, { limit: 500 }) : Promise.resolve(null),
  ]);
  return (
    <NewBatchForm
      settings={settings} profiles={profiles}
      folders={{ ...folders, data: folders.data.map((f) => ({ id: f.id, name: f.name, path: f.path })) }}
      resume={resumeBatch && resumeFiles ? { batch: resumeBatch, files: resumeFiles } : null}
    />
  );
}
