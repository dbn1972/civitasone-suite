export const COMMANDS = {
  createToken: "themes.token.create",
  upsertBrandConfig: "themes.brand.upsert",
  applyBrandPreset: "themes.brand.apply-preset",
  upsertBranding: "themes.branding.upsert",
  createTemplate: "themes.template.create",
} as const;

export const EVENTS = {
  tokenCreated: "themes.token.created",
  brandConfigUpserted: "themes.brand.upserted",
  brandPresetApplied: "themes.brand.preset-applied",
  brandingUpserted: "themes.branding.upserted",
  templateCreated: "themes.template.created",
} as const;

export const SERVICE = "themes";
export const RESOURCE = "token";
