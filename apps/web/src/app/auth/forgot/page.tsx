import { AuthShell } from "../../_components/AuthShell";
import { ForgotForm } from "./ForgotForm";

export const metadata = { title: "Forgot password · CivitasOne" };

/**
 * GAP-AUTH-FORGOT-05: replaced PageShell (bg-slate-50, left-aligned h1) with
 * the shared AuthShell centred dark card so that all three auth screens share
 * one visual language.
 */
export default function Page() {
  return (
    <AuthShell>
      <div className="text-center mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-2">
          CivitasOne Suite
        </p>
        <h1 className="text-2xl font-bold text-slate-900">Recover account access</h1>
        <p className="mt-1 text-sm text-slate-500">
          Reset your credentials through your organisation&apos;s single sign-on, or contact IT.
        </p>
      </div>
      <ForgotForm />
    </AuthShell>
  );
}
