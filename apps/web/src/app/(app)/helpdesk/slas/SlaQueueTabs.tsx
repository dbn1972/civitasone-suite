"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Segmented } from "../../../_components/ds";

export type SlaBucket = "breached" | "due_soon" | "within_sla";

const BUCKET_LABELS: Record<SlaBucket, string> = {
  breached: "Breached",
  due_soon: "Due Soon",
  within_sla: "Within SLA",
};

const OPTIONS = Object.values(BUCKET_LABELS);
const VALUES = Object.keys(BUCKET_LABELS) as SlaBucket[];

/**
 * GAP-HELPDESK-SLAS-01: client Segmented that drives the ?bucket= searchParam
 * so the server page re-renders with the selected bucket's rows. Making the
 * stat cards links too (StatCard.href) means both the tabs and the cards
 * navigate to the same destination — intuitive and accessible.
 */
export function SlaQueueTabs({ current }: { current: SlaBucket }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(label: string) {
    const idx = OPTIONS.indexOf(label);
    if (idx < 0) return;
    const next = VALUES[idx]!;
    const params = new URLSearchParams(searchParams.toString());
    params.set("bucket", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <Segmented
        options={OPTIONS}
        value={BUCKET_LABELS[current]}
        onChange={handleChange}
      />
    </div>
  );
}
