import type { TemplateView } from "./domain.js";

export type NewTemplateVersion = {
  newId: string;
  oldId: string;
  version: number;
};

/** When a template is updated, create a new row and supersede the old one. */
export function planTemplateVersion(old: TemplateView, newId: string): NewTemplateVersion {
  return { newId, oldId: old.id, version: old.version + 1 };
}

export function isSuperseded(template: TemplateView): boolean {
  return template.supersededBy !== null;
}
