import { permanentRedirect } from 'next/navigation'

// GAP-ESTABLISHMENT-FILES-01: /estab/files is a grouping segment whose children
// are /estab/files/[id] (detail) and /estab/files/new (create); the user-facing
// "File Register" list lives at /estab/list. Previously /estab/files had no index
// page, so a hand-typed URL — or a future breadcrumb link — 404'd. This index
// resolves the grouping segment to the canonical list with a permanent (308)
// redirect, keeping breadcrumbs on /estab/files/new link-safe.
export default function EstabFilesPage() {
  permanentRedirect('/estab/list')
}
