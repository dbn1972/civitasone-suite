import { getTranslations } from "next-intl/server";
import { SkeletonBar } from "@/app/_components/ds";

/**
 * GAP-CITIZEN-SERVICES-SERVICEKEY-06: the service landing/apply pages are a
 * 640px centred card, but with no segment loading.tsx they fell back to
 * citizen/loading.tsx (a max-w-7xl full-width skeleton), causing a jarring
 * layout jump. This skeleton matches the real card width and shape (title,
 * two stat blocks, a short document list).
 */
export default async function Loading() {
  const t = await getTranslations("msg");
  return (
    <div role="status" aria-label={t("loading")}>
      <div style={{ marginBottom: 16 }}>
        <SkeletonBar w="55%" h={28} />
        <div style={{ marginTop: 8 }}>
          <SkeletonBar w="80%" />
        </div>
      </div>
      <div style={{ display: "grid", gap: 16, maxWidth: 640, margin: "0 auto", width: "100%" }}>
        <div className="card pad" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <SkeletonBar w={120} h={24} />
            <SkeletonBar w={80} h={24} />
          </div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <SkeletonBar w="70%" h={40} />
            <SkeletonBar w="70%" h={40} />
          </div>
          <SkeletonBar w="100%" h={44} />
          <SkeletonBar w="100%" h={44} />
          <SkeletonBar w="100%" h={48} />
        </div>
      </div>
    </div>
  );
}
