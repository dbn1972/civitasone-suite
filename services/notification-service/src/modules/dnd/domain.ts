/**
 * DND (Do Not Disturb) domain logic — timezone-aware window evaluation.
 */

export type DndWindow = {
  startTime: string; // HH:mm or HH:mm:ss
  endTime: string;   // HH:mm or HH:mm:ss
  timezone: string;  // IANA timezone (e.g. "Asia/Kolkata")
  days: string[];    // ["mon","tue","wed","thu","fri","sat","sun"]
  enabled: boolean;
};

export type DndDecision = { action: "deliver" } | { action: "hold"; releaseAt: Date };

const DAY_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/**
 * Evaluate whether a single DND window is active at the given time.
 * Converts `now` to the window's timezone and checks if it falls within
 * the start_time/end_time range on an applicable day.
 */
export function evaluateWindow(window: DndWindow, now: Date = new Date()): boolean {
  if (!window.enabled) return false;

  // Format the current time in the window's timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: window.timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase()?.slice(0, 3) ?? "";
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";

  // Check if today is an active day
  if (!window.days.includes(weekday)) return false;

  // Current time as minutes from midnight
  const nowMinutes = parseInt(hour, 10) * 60 + parseInt(minute, 10);
  const startMinutes = parseTimeToMinutes(window.startTime);
  const endMinutes = parseTimeToMinutes(window.endTime);

  // Handle overnight windows (e.g., 22:00 – 06:00)
  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  } else {
    // Overnight: active from start to midnight, or midnight to end
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }
}

/**
 * Evaluate all DND windows for a user and return a decision.
 * If any window is currently active, returns "hold" with a releaseAt timestamp.
 */
export function isDndActive(windows: DndWindow[], now: Date = new Date()): DndDecision {
  for (const window of windows) {
    if (evaluateWindow(window, now)) {
      const releaseAt = computeReleaseAt(window, now);
      return { action: "hold", releaseAt };
    }
  }
  return { action: "deliver" };
}

/** Parse a time string "HH:mm" or "HH:mm:ss" into total minutes from midnight. */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Compute when the DND window will end (the release time) in UTC.
 * Takes the end_time in the window's timezone and converts to a Date.
 */
function computeReleaseAt(window: DndWindow, now: Date): Date {
  const endMinutes = parseTimeToMinutes(window.endTime);
  const startMinutes = parseTimeToMinutes(window.startTime);

  // Get the current date in the window's timezone
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: window.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateStr = dateFormatter.format(now); // YYYY-MM-DD

  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: window.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const timeParts = timeFormatter.formatToParts(now);
  const currentHour = parseInt(timeParts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const currentMinute = parseInt(timeParts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const currentMinutes = currentHour * 60 + currentMinute;

  // If it's an overnight window and we're past midnight but before end,
  // the release is today at endTime. Otherwise, it's tomorrow at endTime.
  let releaseDate = dateStr;
  if (startMinutes > endMinutes && currentMinutes >= startMinutes) {
    // We're in the "before midnight" portion — release is tomorrow
    const tomorrow = new Date(now.getTime() + 86_400_000);
    releaseDate = dateFormatter.format(tomorrow);
  }

  const endH = String(Math.floor(endMinutes / 60)).padStart(2, "0");
  const endM = String(endMinutes % 60).padStart(2, "0");

  // Build an ISO string in the target timezone and parse it
  // Use a rough conversion: create a date at the end time then adjust for timezone offset
  const targetDateTimeStr = `${releaseDate}T${endH}:${endM}:00`;

  // Create date assuming UTC, then adjust
  const utcAttempt = new Date(targetDateTimeStr + "Z");

  // Get the offset at that time by comparing formatted local to UTC
  const testFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: window.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const testParts = testFormatter.formatToParts(utcAttempt);
  const testH = parseInt(testParts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const testM = parseInt(testParts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const testMinutes = testH * 60 + testM;

  // Offset in minutes: how far ahead the timezone is from UTC
  const offsetMinutes = testMinutes - (utcAttempt.getUTCHours() * 60 + utcAttempt.getUTCMinutes());

  // Subtract the offset to get the actual UTC time when the local clock shows endTime
  return new Date(utcAttempt.getTime() - offsetMinutes * 60_000);
}
