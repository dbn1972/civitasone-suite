import Link from "next/link";
import { EmptyState } from "@/app/_components/ds";

// GAP-THEMES-HOME-03: not-found had no way back. Offer a "Back to Themes" link.
export default function ThemesNotFound() {
  return (
    <div className="page-main">
      <EmptyState
        title="Page not found"
        message="The page you are looking for does not exist or has been moved."
        action={
          <Link href="/themes" className="btn primary">
            Back to Themes
          </Link>
        }
      />
    </div>
  );
}
