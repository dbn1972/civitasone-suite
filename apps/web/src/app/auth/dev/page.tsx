import { notFound } from "next/navigation";
import { isDevLoginEnabled } from "@/lib/auth/env";
import { AuthShell } from "../_components/AuthShell";
import { DevLoginForm } from "./DevLoginForm";

export const dynamic = "force-dynamic";

export default function Page() {
  if (!isDevLoginEnabled()) notFound();
  return (
    <AuthShell>
      <DevLoginForm />
    </AuthShell>
  );
}
