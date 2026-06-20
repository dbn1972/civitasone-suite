/** Topic + event names owned by telephony-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createCall: "telephony.call.create",
} as const;

export const EVENTS = {
  callCreated: "telephony.call.created",
} as const;

export const SERVICE = "telephony";
export const RESOURCE = "call";
