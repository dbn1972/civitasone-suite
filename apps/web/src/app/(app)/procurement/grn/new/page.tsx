import { cookies } from "next/headers";
import { PageHeader } from "../../../../_components/ds";
import { COOKIE } from "@/lib/auth/config";
import { CreateGRNForm } from "./CreateGRNForm";

/** Decode the `sub` (user id) from the access-token JWT so the inspector is the
 * authenticated user rather than a hardcoded UUID. */
function sessionUserId(): string {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) return "";
  try {
    const parts = token.split(".");
    if (parts.length < 2) return "";
    const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub : "";
  } catch {
    return "";
  }
}

export default function NewGRNPage() {
  return (
    <>
      <PageHeader
        title="New Goods Receipt Note"
        subtitle="Record received quantities and inspection — three-way match is computed automatically."
        back="/procurement/grn"
      />
      <CreateGRNForm inspectorId={sessionUserId()} />
    </>
  );
}
