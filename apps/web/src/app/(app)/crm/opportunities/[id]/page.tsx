import { redirect } from "next/navigation";

/**
 * OP-003 — the opportunities segment has no separate read-only detail view; the
 * single editable record screen is the edit form, so the base record URL
 * redirects there (GAP-CRM-OPPORTUNITIES-06). Keeping this route avoids a 404
 * when something links to /crm/opportunities/:id directly.
 */
export default async function Page(props: { params: Promise<{ id: string }> }) {
 const params = await props.params;
 redirect(`/crm/opportunities/${params.id}/edit`);
}
