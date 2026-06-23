/** Strip dangerous HTML/script content from string inputs */
export function sanitizeString(val: string): string {
  return val
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .trim();
}

/** Deep sanitize all string values in an object */
export function sanitizeInput<T>(obj: T): T {
  if (typeof obj === "string") return sanitizeString(obj) as unknown as T;
  if (Array.isArray(obj)) return obj.map(sanitizeInput) as unknown as T;
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = sanitizeInput(v);
    }
    return result as T;
  }
  return obj;
}
