export const COMMANDS = {
  contractCreate:         "contract.contract.create",
  contractApprove:        "contract.contract.approve",
  contractActivate:       "contract.contract.activate",
  contractClose:          "contract.contract.close",
  contractTerminate:      "contract.contract.terminate",
  contractAmend:          "contract.contract.amend",
  contractSubmitApproval: "contract.contract.submit_approval",
  rcCreate:               "contract.rate_contract.create",
} as const;

export const EVENTS = {
  contractCreated:    "contract.contract.created",
  contractApproved:   "contract.contract.approved",
  contractActivated:  "contract.contract.activated",
  contractClosed:     "contract.contract.closed",
  contractTerminated: "contract.contract.terminated",
  contractAmended:    "contract.contract.amended",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {
  // eOffice (estab-service) award decision callback — source_ref_type "contract_award".
  awardFileDecided: "contract.award.file_decided",
} as const;

export const SERVICE = "contract";
