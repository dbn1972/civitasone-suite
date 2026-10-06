import Link from "next/link";
import { EmptyState } from "@/app/_components/ds";

export default function LegalNotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="The page you are looking for does not exist or has been moved."
      action={<Link href="/legal" className="btn primary">Back to Legal</Link>}
    />
  );
}
