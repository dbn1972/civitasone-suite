export function computeRtiDeadline(createdAt: Date): Date {
  const deadline = new Date(createdAt);
  deadline.setDate(deadline.getDate() + 30);
  return deadline;
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
