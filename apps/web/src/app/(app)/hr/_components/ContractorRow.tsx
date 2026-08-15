/**
 * ContractorRow — row component for contractor details in a table.
 * GFR 2017 Chapter 8: contractor management compliance.
 */
import { StatusPill } from "@/app/_components/ds";

export interface ContractorRowProps {
  name: string;
  agency: string;
  department: string;
  designation: string;
  contractFrom: string;
  contractTo: string;
  status: string;
}

function daysRemaining(contractTo: string): number | null {
  if (!contractTo || contractTo === "—") return null;
  const parts = contractTo.split("/");
  if (parts.length === 3) {
    const [dd, mm, yyyy] = parts;
    const end = new Date(`${yyyy}-${mm}-${dd}`);
    if (isNaN(end.getTime())) return null;
    return Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }
  return null;
}

export function ContractorRow({ name, agency, department, designation, contractFrom, contractTo, status }: ContractorRowProps) {
  const days = daysRemaining(contractTo);
  const isExpiringSoon = days !== null && days <= 30 && days >= 0;
  const isExpired = days !== null && days < 0;

  return (
    <tr
      style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}
      aria-label={`${name}, ${agency}`}
    >
      <td style={tdStyle}>{name}</td>
      <td style={tdStyle}>{agency}</td>
      <td style={tdStyle}>{department}</td>
      <td style={tdStyle}>{designation}</td>
      <td style={tdStyle}>{contractFrom}</td>
      <td style={tdStyle}>
        <span>{contractTo}</span>
        {isExpiringSoon && (
          <span
            role="img"
            aria-label={`Expires in ${days} days`}
            style={{ marginLeft: 6, fontSize: 11, color: "var(--orange, #d97706)", fontWeight: 600 }}
          >
            ⚠ {days}d left
          </span>
        )}
        {isExpired && (
          <span
            role="img"
            aria-label="Contract expired"
            style={{ marginLeft: 6, fontSize: 11, color: "var(--red, #dc2626)", fontWeight: 600 }}
          >
            ✕ Expired
          </span>
        )}
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
        <StatusPill status={status} />
      </td>
    </tr>
  );
}

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 14,
  verticalAlign: "middle",
};
