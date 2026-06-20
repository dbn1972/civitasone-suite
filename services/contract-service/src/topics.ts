export const COMMANDS = {
  contractCreate: "contract.contract.create",
  contractAmend:  "contract.contract.amend",
  rcCreate:       "contract.rate_contract.create",
} as const;

export const EVENTS = {
  contractCreated: "contract.contract.created",
  contractAmended: "contract.contract.amended",
} as const;

export const SERVICE = "contract";
