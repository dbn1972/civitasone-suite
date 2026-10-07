import { redirect } from "next/navigation";

// GAP-ANALYTICS-LIST-01 (+ LIST-02/03/04): this route was a second, generic
// view over the SAME GET /api/v1/analytics/dashboards endpoint that
// /analytics/dashboards renders — different stats, different badge behaviour,
// implementation-leaking copy ("loaded from the Analytics service API") and a
// raw truncated id column. Rather than maintain two divergent views of one
// dataset, redirect to the canonical Dashboards page so existing bookmarks
// keep working. The hub tile for this route was removed (HOME-01) and the
// generic moduleLoader export it used was deleted from _data/loaders.ts.
export default function Page() {
  redirect("/analytics/dashboards");
}
