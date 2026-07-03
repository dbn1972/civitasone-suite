export const COMMANDS = {
  createToken: "themes.token.create",
  upsertBranding: "themes.branding.upsert",
  createTemplate: "themes.template.create",
} as const;

export const EVENTS = {
  tokenCreated: "themes.token.created",
  brandingUpserted: "themes.branding.upserted",
  templateCreated: "themes.template.created",
} as const;

export const SERVICE = "themes";
export const RESOURCE = "token";
