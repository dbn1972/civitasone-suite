/** Topic + event names owned by inventory-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createItem: "inventory.item.create",
} as const;

export const EVENTS = {
  itemCreated: "inventory.item.created",
} as const;

export const SERVICE = "inventory";
export const RESOURCE = "item";
