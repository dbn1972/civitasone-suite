import { redirect } from "next/navigation";

// The WFH request form (WFHRequestForm) is embedded inline on the list page
// (see ../page.tsx's <Card title="New WFH Request">), matching every other
// module's "create" pattern of a form on the list itself rather than a
// separate route. This route previously did not exist at all, so
// /hr/workforce/wfh/new 404'd -- a dead link for anyone who guessed the
// conventional "/new" suffix (and for e2e/specs/workforce.spec.ts's
// "dedicated /wfh/new route renders the WFH request form" test, REL-023).
export default function WfhNewRedirect() {
  redirect("/hr/workforce/wfh");
}
