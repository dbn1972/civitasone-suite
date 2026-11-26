import { redirect } from "next/navigation";

// D3 (CITIZEN-FEEDBACK-03): feedback has no endpoint of its own; the citizen
// surveys module is the feedback channel. Keep the old URL working.
export default function CitizenFeedbackPage(): never {
  redirect("/citizen/surveys");
}
