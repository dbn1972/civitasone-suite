"use client";

/** Opens statutory print HTML in a new tab (browser print-to-PDF). */
export function PrintDocumentLink({
  href,
  label = "Print",
}: {
  href: string;
  label?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="btn ghost"
      style={{ whiteSpace: "nowrap" }}
    >
      🖨️ {label}
    </a>
  );
}
