"use client";

import { Button } from "../../../../../_components/ds";

export function PrintButton() {
  return (
    <Button
      type="button"
      onClick={() => window.print()}
      style={{ minHeight: 40 }}
    >
      🖨️ Print / Save PDF
    </Button>
  );
}
