"use client";
import { useState } from "react";
import { FollowUpModal } from "./FollowUpModal";
import { Button } from "@/app/_components/ds";

export function FollowUpButton({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        + Create Follow-up
      </Button>
      {open && <FollowUpModal accountId={accountId} onClose={() => setOpen(false)} />}
    </>
  );
}
