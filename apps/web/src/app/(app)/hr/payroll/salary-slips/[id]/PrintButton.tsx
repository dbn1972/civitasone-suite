"use client";

import { useTranslations } from "next-intl";
import { Button } from "../../../../../_components/ds";

export function PrintButton() {
  const t = useTranslations("printButton");
  return (
    <Button
      type="button"
      onClick={() => window.print()}
      style={{ minHeight: 40 }}
    >
      {t("printSavePdfBtn")}
    </Button>
  );
}
