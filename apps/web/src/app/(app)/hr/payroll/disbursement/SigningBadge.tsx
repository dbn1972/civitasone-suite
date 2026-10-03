"use client";

import { useTranslations } from "next-intl";
import { signedBadgeKind } from "./signingState";

/**
 * "Signed (PGP)" / "Signed (XML-DSig)" / "Signed (PKCS#7)" / "Unsigned (dev
 * only)". Anything the server did not explicitly state as signed with a
 * known format is shown as unsigned.
 */
export function SigningBadge({ format, signed }: { format: string | null | undefined; signed: boolean }) {
  const t = useTranslations("bankFileSigning");
  const kind = signedBadgeKind(format, signed);
  const label = {
    pgp: t("badgeSignedPgp"),
    xml: t("badgeSignedXml"),
    pkcs7: t("badgeSignedPkcs7"),
    unsigned: t("badgeUnsigned"),
  }[kind];
  return kind === "unsigned" ? (
    <span role="status" className="pill bad" style={{ fontWeight: 700 }}>{label}</span>
  ) : (
    <span className="pill good">{label}</span>
  );
}
