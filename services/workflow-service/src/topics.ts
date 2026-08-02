export const COMMANDS = {
  createInstance: "workflow.instance.create",
  completeTask: "workflow.task.complete",
  cancelInstance: "workflow.instance.cancel",
  suspendInstance: "workflow.instance.suspend",
  resumeInstance: "workflow.instance.resume",
  deliverMessage: "workflow.message.deliver",
  correlateMessage: "workflow.message.correlate",
  broadcastSignal: "workflow.signal.broadcast",
  // CQRS (designer lift) — BPMN visual designer definition writes.
  createDesignerDefinition: "workflow.designer.definition.create",
  updateDesignerDefinition: "workflow.designer.definition.update",
  deleteDesignerDefinition: "workflow.designer.definition.delete",
  importDesignerDefinition: "workflow.designer.definition.import",
  createDefinition: "workflow.definition.create",
  deployDefinition: "workflow.definition.deploy",
  cloneDefinitionTemplate: "workflow.definition.clone",
  rollbackDefinition: "workflow.definition.rollback",
  importBpmnDefinition: "workflow.definition.bpmn_import",
  createDmnTable: "workflow.dmn.table.create",
  updateDmnTable: "workflow.dmn.table.update",
  deleteDmnTable: "workflow.dmn.table.delete",
  upsertRoleMember: "workflow.role_member.upsert",
  createMatrixRule: "workflow.assignment.matrix.create",
  deactivateMatrixRule: "workflow.assignment.matrix.deactivate",
  createSubstitution: "workflow.assignment.substitution.create",
  deactivateSubstitution: "workflow.assignment.substitution.deactivate",
  createDecision: "workflow.decision.create",
  deployDecision: "workflow.decision.deploy",
} as const;

export const EVENTS = {
  instanceCreated: "workflow.instance.created",
  taskCompleted: "workflow.task.completed",
  taskAssigned: "workflow.task.assigned",
  instanceCancelled: "workflow.instance.cancelled",
  instanceRejected: "workflow.instance.rejected",
  instanceSuspended: "workflow.instance.suspended",
  instanceResumed: "workflow.instance.resumed",
  messageDelivered: "workflow.message.delivered",
  messageReceived: "workflow.message.received",
  signalDelivered: "workflow.signal.delivered",
  signalReceived: "workflow.signal.received",
  messageTimeout: "workflow.message.timeout",
  // CAP-026 — a committee/quorum decision settled.
  committeeDecided: "workflow.committee.decided",
  // CAP-025 — a request exceeded the actor's authority and was escalated.
  authorityEscalated: "workflow.authority.escalated",
  // CAP-029 — instance finalization / reversal.
  instanceFinalized: "workflow.instance.finalized",
  instanceReversed: "workflow.instance.reversed",
  // CQRS (designer lift) — BPMN visual designer definition lifecycle events.
  designerDefinitionCreated: "workflow.designer.definition.created",
  designerDefinitionUpdated: "workflow.designer.definition.updated",
  designerDefinitionDeleted: "workflow.designer.definition.deleted",
  designerDefinitionImported: "workflow.designer.definition.imported",
  definitionCreated: "workflow.definition.created",
  definitionDeployed: "workflow.definition.deployed",
  definitionCloned: "workflow.definition.cloned",
  definitionRolledBack: "workflow.definition.rolled_back",
  definitionBpmnImported: "workflow.definition.bpmn_imported",
  dmnTableCreated: "workflow.dmn.table.created",
  dmnTableUpdated: "workflow.dmn.table.updated",
  dmnTableDeleted: "workflow.dmn.table.deleted",
  roleMemberUpserted: "workflow.role_member.upserted",
  matrixRuleCreated: "workflow.assignment.matrix.created",
  matrixRuleDeactivated: "workflow.assignment.matrix.deactivated",
  substitutionCreated: "workflow.assignment.substitution.created",
  substitutionDeactivated: "workflow.assignment.substitution.deactivated",
  decisionCreated: "workflow.decision.created",
  decisionDeployed: "workflow.decision.deployed",
} as const;

/** Cross-service commands dispatched when a workflow task completes. */
export const DISPATCH = {
  leaveApprove: "hrms.leave.approve",
  payrollRunApprove: "payroll.run.approve",
  indentApprove: "procurement.indent.approve",
  poApprove: "procurement.po.approve",
  fileApprove: "estab.file.approve",
  fileReject: "estab.file.reject",
  fileLevelApproved: "estab.file.level_approved",
  assetDisposeApprove: "asset.dispose.approve",
} as const;

export const SERVICE = "workflow";
export const INSTANCE_RESOURCE = "instance";
export const TASK_RESOURCE = "task";

/** Events consumed from other services. */
export const CONSUMED_EVENTS = {
  tenantCreated: "tenant.tenant.created",
} as const;
