import { PageShell } from "../../_components/PageShell";
import { ForgotForm } from "./ForgotForm";

export const metadata = { title: "Forgot password · CivitasOne" };

export default function Page() {
  return (
    <PageShell title="Recover account access" description="Reset your credentials through your organisation's single sign-on, or contact IT.">
      <ForgotForm />
    </PageShell>
  );
}
