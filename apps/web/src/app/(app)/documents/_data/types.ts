/** document-service — web view models. */

export type FileSummary = {
  id:        string;
  name:      string;
  folderId:  string | null;
  mimeType:  string | null;
  sizeBytes: number | null;
  tags:      string[];
  status:    string;
  version:   number;
  updatedAt: string;
};

export type FolderSummary = {
  id:       string;
  name:     string;
  parentId: string | null;
  path:     string;
};

export type DakSummary = {
  id:         string;
  subject:    string;
  priority:   string;
  status:     string;
  assignedTo: string | null;
  dueDate:    string | null;
  createdAt:  string;
};

/** A single dak with its body, for the inbox detail route (GAP-DOCUMENTS-INBOX-01/04). */
export type DakDetail = DakSummary & {
  body: string | null;
};

export type InboxSummary = {
  data:  DakSummary[];
  meta:  { total: number };
};

export type DocumentStats = {
  inboxCount:   number;
  pendingCount: number;
  urgentCount:  number;
  /** Inbox-scoped counts (GAP-DOCUMENTS-INBOX-02) — accurate even when the inbox list is paginated. */
  inboxUrgentCount:    number;
  inboxPendingCount:   number;
  inboxForwardedCount: number;
};
