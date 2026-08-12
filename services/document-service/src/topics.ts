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
} as const;

export const SERVICE  = "document";
export const RESOURCE = "file";
