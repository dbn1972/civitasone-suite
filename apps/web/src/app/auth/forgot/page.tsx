import { AuthShell } from "../_components/AuthShell";
import { ForgotForm } from "./ForgotForm";

export const metadata = { title: "Forgot password · CivitasOne" };

export default function Page() {
  return (
    <AuthShell>
      <div className="w-full max-w-md">
        <ForgotForm />
      </div>
    </AuthShell>
  );
}
