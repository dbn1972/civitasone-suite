export const BREAK_GLASS_TTL_MS = 2 * 60 * 60 * 1000;

export function breakGlassExpiresAt(openedAt: Date): Date {
  return new Date(openedAt.getTime() + BREAK_GLASS_TTL_MS);
}

export function isBreakGlassExpired(expiresAt: Date, now = new Date()): boolean {
  return now >= expiresAt;
}
