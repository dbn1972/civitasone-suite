/** Topic + event names owned by location-service. */
export const COMMANDS = {
  createLocation: "location.location.create",
} as const;

export const EVENTS = {
  locationCreated: "location.location.created",
} as const;

export const SERVICE = "location";
export const RESOURCE = "location";
