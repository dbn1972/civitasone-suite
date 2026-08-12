export type ActionType = "cleaning" | "repair" | "replacement" | "desilting";

export const VALID_ACTION_TYPES: ActionType[] = ["cleaning", "repair", "replacement", "desilting"];

export function isValidActionType(type: string): type is ActionType {
  return VALID_ACTION_TYPES.includes(type as ActionType);
}
