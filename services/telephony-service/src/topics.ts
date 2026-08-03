/** Topic + event names owned by telephony-service. {service}.{entity}.{action} */
export const COMMANDS = {
  // call lifecycle
  createCall: "telephony.call.create",
  ringCall: "telephony.call.ring",
  answerCall: "telephony.call.answer",
  completeCall: "telephony.call.complete",
  missCall: "telephony.call.miss",
  abandonCall: "telephony.call.abandon",
  // routing / enrichment (no state change)
  assignCall: "telephony.call.assign",
  recordIvrHit: "telephony.call.ivr_hit",
  batchIvrHits: "telephony.ivr.batch_hits",
  linkCall: "telephony.call.link",
  attachRecording: "telephony.call.recording",
  // queue + agent administration
  createQueue: "telephony.queue.create",
  upsertAgent: "telephony.agent.upsert",
  setAgentStatus: "telephony.agent.status",
  // DID mapping administration
  createDidMapping: "telephony.did.create",
  deleteDidMapping: "telephony.did.delete",
} as const;

export const EVENTS = {
  callCreated: "telephony.call.created",
  callRinging: "telephony.call.ringing",
  callAnswered: "telephony.call.answered",
  callCompleted: "telephony.call.completed",
  callMissed: "telephony.call.missed",
  callAbandoned: "telephony.call.abandoned",
  callAssigned: "telephony.call.assigned",
  callLinked: "telephony.call.linked",
  callIvrRecorded: "telephony.call.ivr_recorded",
  callRecordingAttached: "telephony.call.recording_attached",
  callTranscriptionCompleted: "telephony.call.transcription_completed",
  queueCreated: "telephony.queue.created",
  agentUpserted: "telephony.agent.upserted",
  agentStatusChanged: "telephony.agent.status_changed",
  didMappingCreated: "telephony.did.created",
  didMappingDeleted: "telephony.did.deleted",
} as const;

export const SERVICE = "telephony";
export const RESOURCE = "call";
export const QUEUE_RESOURCE = "queue";
export const AGENT_RESOURCE = "agent";
export const DID_RESOURCE = "did-mapping";
export const DID_ACTIVE_MAPPINGS_CACHE = "global:did-mappings:active";
