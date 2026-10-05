import Link from "next/link";
import { EmptyState } from "@/app/_components/ds";

export default function CrmNotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="The page you are looking for does not exist or has been moved."
      action={
        <Link className="btn primary" href="/crm">
          Back to CRM
        </Link>
      }
    />
  );
}
