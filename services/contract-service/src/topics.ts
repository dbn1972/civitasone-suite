export const COMMANDS = {
  contractCreate:    "contract.contract.create",
  contractApprove:   "contract.contract.approve",
  contractActivate:  "contract.contract.activate",
  contractClose:     "contract.contract.close",
  contractTerminate: "contract.contract.terminate",
  contractAmend:     "contract.contract.amend",
  rcCreate:          "contract.rate_contract.create",
} as const;

export const EVENTS = {
  contractCreated:    "contract.contract.created",
  contractApproved:   "contract.contract.approved",
  contractActivated:  "contract.contract.activated",
  contractClosed:     "contract.contract.closed",
  contractTerminated: "contract.contract.terminated",
  contractAmended:    "contract.contract.amended",
} as const;

export const SERVICE = "contract";
