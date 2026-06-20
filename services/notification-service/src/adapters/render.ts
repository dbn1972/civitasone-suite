/** Replace `{{key}}` placeholders in template bodies. */
export function renderBody(body: string, variables?: Record<string, string>): string {
  if (!variables) return body;
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);
}
