import { getTranslations } from "next-intl/server";
import { SkeletonBar } from "@/app/_components/ds";

/**
 * GAP-CITIZEN-SERVICES-SERVICEKEY-06: segment loading skeleton for the
 * application-tracking page (timeline card), matching the 640px card width so
 * there is no layout shift when the status loads.
 */
export default async function Loading() {
  const t = await getTranslations("msg");
  return (
    <div role="status" aria-label={t("loading")}>
      <div style={{ marginBottom: 16 }}>
        <SkeletonBar w="45%" h={28} />
        <div style={{ marginTop: 8 }}>
          <SkeletonBar w="70%" />
        </div>
      </div>
      <div style={{ display: "grid", gap: 16, maxWidth: 640, margin: "0 auto", width: "100%" }}>
        <div className="card pad" style={{ display: "grid", gap: 16 }}>
          <SkeletonBar w="40%" h={24} />
          <SkeletonBar w="100%" h={56} />
          <SkeletonBar w="100%" h={56} />
          <SkeletonBar w="100%" h={56} />
          <SkeletonBar w="60%" h={44} />
        </div>
      </div>
    </div>
  );
}
