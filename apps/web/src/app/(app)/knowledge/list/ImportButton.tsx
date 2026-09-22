"use client";

import { Button } from "@/app/_components/ds";

export function ImportButton() {
  return (
    <Button
      variant="ghost"
      style={{ minHeight: 44 }}
      onClick={() => {
        window.location.href = "/knowledge/documents/new?mode=import";
      }}
    >
      Import
    </Button>
  );
}
