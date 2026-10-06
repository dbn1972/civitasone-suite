import { PageHeader } from "../../../_components/ds";
import { getDocumentFolders } from "../_data/loaders";
import { UploadDocumentForm, type FolderOption } from "./UploadDocumentForm";

export default async function UploadDocumentPage({
  searchParams,
}: {
  searchParams: { folderId?: string };
}) {
  const { data: folders } = await getDocumentFolders();
  const options: FolderOption[] = folders.map((f) => ({ id: f.id, name: f.name, path: f.path }));
  const defaultFolderId =
    searchParams.folderId && folders.some((f) => f.id === searchParams.folderId)
      ? searchParams.folderId
      : null;

  return (
    <div className="wrap">
      <PageHeader
        title="Upload Document"
        subtitle="Attach a file and register it in the document library."
      />

      <div className="card" style={{ maxWidth: 560, marginTop: 18 }}>
        <div className="card-h"><h3>File Details</h3></div>
        <UploadDocumentForm folders={options} defaultFolderId={defaultFolderId} />
      </div>
    </div>
  );
}
