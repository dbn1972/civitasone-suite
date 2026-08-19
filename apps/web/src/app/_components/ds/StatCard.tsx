interface StatCardProps {
  icon: string;
  iconBg?: string;
  label: string;
  value: string | number;
  delta?: string;
  up?: boolean;
}

export function StatCard({ icon, iconBg, label, value, delta, up }: StatCardProps) {
  return (
    <div className="stat">
      <div className="top">
        <div />
        <div className="ic" style={{ background: iconBg ?? "#eef2ff", lineHeight: 1 }} aria-hidden>{icon}</div>
      </div>
      <div className="lab">{label}</div>
      <div className="val">{value}</div>
      {delta && (
        <div
          className={`delta ${up ? "up" : "down"}`}
          aria-label={`${up ? "Increase" : "Decrease"} of ${delta}`}
        >
          <span aria-hidden="true">{up ? "↑" : "↓"}</span> {delta}
        </div>
      )}
    </div>
  );
}
