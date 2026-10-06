import { redirect } from "next/navigation";

/**
 * GAP-TELEPHONY-LIST-05 (and LIST-01/02/03): the legacy /telephony/list view
 * rendered the generic ModuleListPage over the call payload. The generic row
 * mapper (loaders.ts mapModuleRows) requires a name/title/subject/label/code
 * field that call rows do not carry, so every row was dropped and the page
 * always showed "No records" — a broken duplicate of /telephony/calls that
 * also exposed implementation wording and raw UUID columns.
 *
 * It is now a permanent redirect to the real Call Log so existing bookmarks and
 * the nav manifest entry still resolve, with no empty/duplicate screen.
 */
export default function Page() {
  redirect("/telephony/calls");
}
