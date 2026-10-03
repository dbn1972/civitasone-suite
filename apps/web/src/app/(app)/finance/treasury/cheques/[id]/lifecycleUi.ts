/**
 * GAP-FINANCE-TREASURY-CHEQUES-03: the bank-outcome actions finance-service accepts from each
 * cheque / DD state (instruments/commands.ts): present from issued; clear and bounce from issued or
 * presented. Terminal states offer nothing. (Cancel is a separate control: InstrumentActions.)
 */
export type LifecycleAction = "present" | "clear" | "bounce";

export function availableLifecycleActions(status: string | null | undefined): LifecycleAction[] {
  switch ((status ?? "").trim().toLowerCase()) {
    case "issued": return ["present", "clear", "bounce"];
    case "presented": return ["clear", "bounce"];
    default: return [];
  }
}
