import { redirect } from "next/navigation";

/** See /hr/appraisals/page.tsx -- redirects to the real, maintained APAR flow. */
export default function NewAppraisalPageRedirect() {
  redirect("/hr/apar/new");
}
