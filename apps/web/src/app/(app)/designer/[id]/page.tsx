import { redirect } from "next/navigation";
import { getDesignerServiceById } from "../_data/designerLoader";

/**
 * GAP-DESIGNER-HOME-02 / GAP-DESIGNER-DETAIL-01: this route is a status-aware
 * entry point, not a blind redirect to the draft wizard. Opening a published
 * (or in-review) service in the B1 draft wizard presents it as editable with
 * no read-only context, inviting unintended edits. We route non-draft
 * definitions to the review view instead, and keep the draft/rejected wizard
 * for editable states. If the status cannot be determined (loader error), we
 * fail closed to the draft wizard — the existing, safe default.
 */
export default async function DesignerServiceEntry({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      qs.set(key, value);
    } else if (Array.isArray(value)) {
      // GAP-DESIGNER-DETAIL-02: forward multi-value params (?a=1&a=2) intact.
      for (const v of value) qs.append(key, v);
    }
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  const { data: service, source } = await getDesignerServiceById(params.id);

  // Published / submitted / in_review open read-only in the review view.
  // Draft / rejected (editable) and any unknown/error state open the wizard.
  const readOnlyStatuses = new Set(["published", "submitted", "in_review"]);
  if (source !== "error" && service && readOnlyStatuses.has(service.status)) {
    redirect(`/designer/${params.id}/review${suffix}`);
  }

  redirect(`/designer/${params.id}/b1${suffix}`);
}
