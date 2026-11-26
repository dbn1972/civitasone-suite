/**
 * GAP-ESTAB-FILES-DETAIL-03 (owner decision B23): who may Submit and who may Sign a yellow draft.
 *
 *  - Submit for approval: the draft's AUTHOR only (the officer who wrote it).
 *  - Sign (green):       only the CURRENT APPROVER, i.e. the actor who holds the open
 *                        file_noting workflow task on the file (Section Officer, then Under
 *                        Secretary, then Deputy Secretary; one level is pending at a time).
 *                        A draft that was never submitted has no task, so nobody can sign it.
 *
 * The same predicate gates POST .../submit-for-approval, POST .../notings/:id/sign, their queue
 * consumers, and the allowedActions served on GET /v1/estab/files/:id.
 */
export type NotingLite = {
  id: string; officerId: string; noteType: string; noteStatus: string; eSigned: boolean; createdAt: Date | string; seq?: number;
};

const ts = (n: NotingLite): number => new Date(n.createdAt).getTime();

/** The latest yellow DRAFT (the one Submit acts on), or null. */
export function latestDraft(notings: readonly NotingLite[]): NotingLite | null {
  const drafts = notings.filter((n) => n.noteType === "yellow" && n.noteStatus === "draft");
  return drafts.sort((a, b) => ts(b) - ts(a))[0] ?? null;
}

/**
 * The latest note still awaiting a signature (draft or submitted), or null. Same rule as
 * repo.findLatestUnsignedNoting (highest seq among e_signed = false), which the workflow's
 * level auto-sign uses: the SIGN TARGET is always this note, so an approver holding the file's
 * task cannot sign an arbitrary older note.
 */
export function latestUnsigned(notings: readonly NotingLite[]): NotingLite | null {
  const open = notings.filter((n) => !n.eSigned && n.noteStatus !== "approved");
  return open.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0) || ts(b) - ts(a))[0] ?? null;
}

export function isNotingAuthor(noting: Pick<NotingLite, "officerId">, actorId: string): boolean {
  return noting.officerId === actorId;
}

export type AllowedActions = { canSubmit: boolean; canSign: boolean };

export function computeAllowedActions(args: {
  notings: readonly NotingLite[];
  actorId: string;
  readOnly: boolean;
  /** null = workflow could not answer; treated as "may not sign". */
  holdsOpenTask: boolean | null;
}): AllowedActions {
  if (args.readOnly) return { canSubmit: false, canSign: false };
  const draft = latestDraft(args.notings);
  const unsigned = latestUnsigned(args.notings);
  return {
    canSubmit: draft !== null && isNotingAuthor(draft, args.actorId),
    canSign: unsigned !== null && args.holdsOpenTask === true,
  };
}
