"use client";

import Link from "next/link";
import { ErrorState } from "../../_components/ds";

export default function ApprovalsError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      title="Something went wrong"
      message="We couldn't load your approvals. This is usually a temporary issue."
      retry={reset}
      back="/dashboard"
      help="/help/approvals"
    />
  );
}
