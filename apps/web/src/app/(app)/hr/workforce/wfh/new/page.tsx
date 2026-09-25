import { redirect } from "next/navigation";

// The WFH request form (WFHRequestForm) is embedded inline on the canonical
// list page (see hr/wfh/page.tsx's "New Request" card), matching every other
// module's "create" pattern of a form on the list itself rather than a
// separate route. This route previously did not exist at all, so
// /hr/workforce/wfh/new 404'd -- a dead link for anyone who guessed the
// conventional "/new" suffix (and for e2e/specs/workforce.spec.ts's
// "dedicated /wfh/new route renders the WFH request form" test, REL-023).
//
// HRMS peripheral medium findings, item 1: /hr/workforce/wfh (this route's
// parent) is itself now a redirect stub to /hr/wfh, so this repoints
// straight at the canonical page instead of chaining through that redirect.
export default function WfhNewRedirect() {
  redirect("/hr/wfh");
}
