export const OPERATION_TYPES = [
  "capture",
  "sterilize",
  "vaccinate",
  "relocate",
  "shelter",
  "carcass_removal",
  "treatment",
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];
