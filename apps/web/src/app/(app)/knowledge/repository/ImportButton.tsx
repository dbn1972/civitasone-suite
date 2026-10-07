import Link from "next/link";

/**
 * GAP-KNOWLEDGE-REPOSITORY-05: use next/link and drop the dead ?mode=import
 * param. The documents/new page does not support a separate import mode; the
 * button simply opens the new-document form.
 */
export function ImportButton() {
  return (
    <Link href="/knowledge/documents/new" className="btn ghost" style={{ minHeight: 44 }}>
      Import
    </Link>
  );
}
