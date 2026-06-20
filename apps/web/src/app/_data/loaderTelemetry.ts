export type LoaderFallbackReason =
  | "no_base_url"
  | "http_error"
  | "network_error"
  | "invalid_payload";

export interface LoaderFallbackEvent {
  key: string;
  reason: LoaderFallbackReason;
  statusCode?: number;
  path: string;
  timestamp: string;
}

const events: LoaderFallbackEvent[] = [];
const MAX_EVENTS = 200;

export function recordLoaderFallback(event: LoaderFallbackEvent): void {
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

export function getLoaderFallbackEvents(): LoaderFallbackEvent[] {
  return [...events];
}
