"use client";
/**
 * MergeButton — toolbar entry point that reveals the MergeDialog for a list
 * page (contacts / leads / accounts). Kept tiny so server list pages can drop
 * it in without becoming client components themselves.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ds";
import { MergeDialog, type MergeOption } from "./MergeDialog";
import type { DqEntity } from "@/lib/crm/dataQuality";

export function MergeButton({
  entity,
  options,
  label = "Merge duplicates",
}: {
  entity: DqEntity;
  options: MergeOption[];
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ minHeight: 44 }}
      >
        {label}
      </Button>
      <MergeDialog
        entity={entity}
        options={options}
        open={open}
        onClose={() => setOpen(false)}
        onMerged={() => router.refresh()}
      />
    </>
  );
}
