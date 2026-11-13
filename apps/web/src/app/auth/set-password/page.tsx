import { AuthShell } from "../../_components/AuthShell";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata = { title: "Set your password · CivitasOne" };

export default function Page() {
  return (
    <AuthShell>
      <div className="text-center mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-2">CivitasOne Suite</p>
        <h1 className="text-2xl font-bold text-slate-900">Set your password</h1>
        <p className="mt-1 text-sm text-slate-500">Choose the password you will use to sign in.</p>
      </div>
      <SetPasswordForm />
    </AuthShell>
  );
}
