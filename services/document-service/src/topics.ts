export const COMMANDS = {
  // Files
  fileUpload:    "document.file.upload",
  fileDelete:    "document.file.delete",
  fileMove:      "document.file.move",
  fileTag:       "document.file.tag",

  // Folders
  folderCreate:  "document.folder.create",
  folderRename:  "document.folder.rename",
  folderMove:    "document.folder.move",

  // Workflow (dak/file)
  dakCreate:     "document.dak.create",
  dakForward:    "document.dak.forward",
  dakAcknowledge:"document.dak.acknowledge",
  notingCreate:  "document.noting.create",
  approvalSubmit:"document.approval.submit",
  approvalDecide:"document.approval.decide",

  // Sharing
  shareCreate:   "document.share.create",
  shareRevoke:   "document.share.revoke",

  // Bulk scan (modules/bulk-scan) - operator/API commands
  bulkBatchCreate:  "document.bulkscan.batch.create",
  bulkBatchCancel:  "document.bulkscan.batch.cancel",
  bulkFilesRegister:"document.bulkscan.files.register",
  bulkFilesComplete:"document.bulkscan.files.complete",
  bulkFileRetry:    "document.bulkscan.file.retry",
  bulkFileSkip:     "document.bulkscan.file.skip",
  bulkSettingsPropose: "document.bulkscan.settings.propose",
  bulkSettingsApprove: "document.bulkscan.settings.approve",
  bulkSettingsReject:  "document.bulkscan.settings.reject",
  bulkProfileCreate:   "document.bulkscan.profile.create",
  bulkProfileUpdate:   "document.bulkscan.profile.update",
  bulkProfileDelete:   "document.bulkscan.profile.delete",
  bulkProfileChangePropose: "document.bulkscan.profile.change.propose",
  // Bulk scan - review / filing / links (modules/bulk-scan review + link consumers)
  bulkReviewEdit:    "document.bulkscan.review.edit",
  bulkReviewApprove: "document.bulkscan.review.approve",
  bulkReviewReject:  "document.bulkscan.review.reject",
  bulkLinkApprove:   "document.bulkscan.link.approve",
  bulkLinkReject:    "document.bulkscan.link.reject",
  bulkLinkUnlink:    "document.bulkscan.link.unlink",
  // Bulk scan - internal pipeline steps (published via the outbox by the pipeline itself)
  bulkStepScan:     "document.bulkscan.step.scan",
  bulkStepOcr:      "document.bulkscan.step.ocr",
} as const;

export const EVENTS = {
  fileUploaded:       "document.file.uploaded",
  fileDeleted:        "document.file.deleted",
  fileMoved:          "document.file.moved",
  folderCreated:      "document.folder.created",
  folderRenamed:      "document.folder.renamed",
  dakCreated:         "document.dak.created",
  dakForwarded:       "document.dak.forwarded",
  dakAcknowledged:    "document.dak.acknowledged",
  notingCreated:      "document.noting.created",
  approvalSubmitted:  "document.approval.submitted",
  approvalDecided:    "document.approval.decided",
  shareCreated:       "document.share.created",
  shareRevoked:       "document.share.revoked",
  bulkBatchCreated:   "document.bulkscan.batch.created",
  bulkBatchCancelled: "document.bulkscan.batch.cancelled",
  bulkBatchCompleted: "document.bulkscan.batch.completed",
  bulkFileQuarantined:"document.bulkscan.file.quarantined",
  bulkFileExtracted:  "document.bulkscan.file.extracted",
  bulkFileFailed:     "document.bulkscan.file.failed",
  bulkFileFiled:      "document.bulkscan.file.filed",
  bulkFileReturnedToReview: "document.bulkscan.file.returned_to_review",
  bulkFileRetentionDeleted: "document.bulkscan.file.retention_deleted",
  bulkLinkRequested:  "document.bulkscan.link.requested",
  bulkLinkLinked:     "document.bulkscan.link.linked",
  bulkLinkUnlinked:   "document.bulkscan.link.unlinked",
  bulkSettingsChangeRequested: "document.bulkscan.settings.change_requested",
  bulkSettingsChanged:         "document.bulkscan.settings.changed",
} as const;

export const SERVICE  = "document";
export const RESOURCE = "file";
