import { PageHeader } from "@/app/_components/ds";
import { NewMeetingForm } from "./NewMeetingForm";

export default function NewMeetingPage() {
  return (
    <>
      <PageHeader
        title="Schedule a meeting"
        subtitle="Convene a new committee or board meeting — set the essentials now, refine agenda and attendees afterward."
        back="/meeting/meetings"
        backLabel="Meetings"
      />
      <NewMeetingForm />
    </>
  );
}
