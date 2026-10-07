import { SkeletonBar } from "@/app/_components/ds";

/**
 * Loading skeleton for the public, unauthenticated certificate-verify page
 * (GAP-CITIZEN-CERTIFICATES-01/02). Mirrors the page's centred layout so a
 * third party scanning a QR sees a stable frame instead of a white screen
 * while the public verify endpoint is fetched. The page always renders a 200
 * verdict (never notFound()/redirect()), so streaming via loading.tsx is safe.
 */
export default function PublicVerifyLoading() {
  return (
    <main
      role="status"
      aria-busy="true"
      aria-label="Verifying certificate"
      style={{ maxWidth: 560, margin: "48px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}
    >
      <SkeletonBar w="60%" h={26} />
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <SkeletonBar w={180} h={32} style={{ borderRadius: 999 }} />
        <SkeletonBar w="80%" h={16} />
        <SkeletonBar w="70%" h={16} />
        <SkeletonBar w="75%" h={16} />
        <SkeletonBar w="65%" h={16} />
      </div>
    </main>
  );
}
