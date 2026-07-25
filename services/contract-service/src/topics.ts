export const COMMANDS = {
  contractCreate:         "contract.contract.create",
  contractApprove:        "contract.contract.approve",
  contractActivate:       "contract.contract.activate",
  contractClose:          "contract.contract.close",
  contractTerminate:      "contract.contract.terminate",
  contractAmend:          "contract.contract.amend",
  contractSubmitApproval: "contract.contract.submit_approval",
  rcCreate:               "contract.rate_contract.create",
  clauseCreate:           "contract.clause.create",
  clauseUpdate:           "contract.clause.update",
  clauseArchive:          "contract.clause.archive",
  templateCreate:         "contract.template.create",
  templateUpdate:         "contract.template.update",
  templateDelete:         "contract.template.delete",
  templateClauseAdd:      "contract.template.clause_add",
  templateClauseUpdate:   "contract.template.clause_update",
  templateClauseRemove:   "contract.template.clause_remove",
  obligationCreate:       "contract.obligation.create",
  obligationUpdate:       "contract.obligation.update",
  renewalCreate:          "contract.renewal.create",
  renewalUpdate:          "contract.renewal.update",
  approvalLevelCreate:    "contract.approval_level.create",
  approvalLevelUpdate:    "contract.approval_level.update",
  approvalLevelDelete:    "contract.approval_level.delete",
  esignCreate:            "contract.esign.create",
  esignSign:              "contract.esign.sign",
  esignCheckDeadline:     "contract.esign.check_deadline",
} as const;

export const EVENTS = {
  contractCreated:    "contract.contract.created",
  contractApproved:   "contract.contract.approved",
  contractActivated:  "contract.contract.activated",
  contractClosed:     "contract.contract.closed",
  contractTerminated: "contract.contract.terminated",
  contractAmended:    "contract.contract.amended",
  clauseCreated:      "contract.clause.created",
  clauseUpdated:      "contract.clause.updated",
  clauseArchived:     "contract.clause.archived",
  templateCreated:    "contract.template.created",
  templateUpdated:    "contract.template.updated",
  templateArchived:   "contract.template.archived",
  obligationCreated:  "contract.obligation.created",
  obligationUpdated:  "contract.obligation.updated",
  renewalCreated:     "contract.renewal.created",
  renewalUpdated:     "contract.renewal.updated",
  approvalLevelCreated: "contract.approval_level.created",
  approvalLevelUpdated: "contract.approval_level.updated",
  approvalLevelDeleted: "contract.approval_level.deleted",
  esignCreated:         "contract.esign.created",
  esignSigned:          "contract.esign.signed",
  esignCompleted:       "contract.esign.completed",
  esignEscalated:       "contract.esign.escalated",
  contractExpiryAlert: "contract.expiry.alert",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {
  // eOffice (estab-service) award decision callback — source_ref_type "contract_award".
  awardFileDecided: "contract.award.file_decided",
} as const;

export const SERVICE = "contract";
