/** Mirror of apps/web designerConstants.hiddenBlocksForPattern (FN-33). */
export function hiddenBlocksForPattern(pattern: string): Set<string> {
  switch (pattern) {
    case "booking":
      return new Set(["b3"]);
    case "collection":
      return new Set(["b3", "b4", "b6"]);
    case "grievance":
      return new Set(["b5"]);
    default:
      return new Set();
  }
}
