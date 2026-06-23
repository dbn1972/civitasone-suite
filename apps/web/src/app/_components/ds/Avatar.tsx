interface AvatarProps {
  name: string;
  color?: string;
  size?: "sm" | "lg" | "xl";
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Avatar({ name, color = "#4f46e5", size }: AvatarProps) {
  const cls = ["av", size ?? ""].filter(Boolean).join(" ");
  return (
    <div className={cls} style={{ background: color }} title={name}>
      {initials(name)}
    </div>
  );
}
