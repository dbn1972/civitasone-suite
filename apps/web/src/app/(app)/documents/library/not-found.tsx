import Link from "next/link";
import { EmptyState } from "../../../_components/ds";

export default function LibraryNotFound() {
  return (
    <div className="wrap">
      <div className="card" style={{ marginTop: 18 }}>
        <EmptyState
          icon="📂"
          title="Folder not found"
          message="This folder doesn't exist or may have been removed."
          action={<Link href="/documents/library" className="btn primary">Back to Library</Link>}
        />
      </div>
    </div>
  );
}
