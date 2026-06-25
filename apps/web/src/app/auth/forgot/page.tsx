import { PageShell } from "../../_components/PageShell";
import { ForgotForm } from "./ForgotForm";

export const metadata = { title: "Forgot password · CivitasOne" };

export default function Page() {
  return (
    <PageShell title="Forgot Password" description="Enter your email and we will send reset instructions.">
      <ForgotForm />
    </PageShell>
  );
}
