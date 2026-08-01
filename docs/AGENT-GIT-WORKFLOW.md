# Agent Git Workflow — Multi-Agent Repository

This repository is worked on by **more than one AI agent concurrently**, plus humans.
This document is the shared contract. It is version controlled deliberately: the
machine-local agent configs (`.kiro/steering/`, `.claude/`) are not shared, so the rule
would otherwise live on one laptop and be lost with it.

Audience: any agent or human operating on this repo, and anyone configuring one.

---

## The incident this prevents

Work was destroyed on 2026-08-01. Worth recording precisely, because the obvious diagnosis
is the wrong one.

- One agent committed directly to `main` **in the shared main worktree**
  (`/home/ec2-user/CivitasOne/civitasone-suite`).
- Another agent periodically synced that same worktree with
  `git reset --hard origin/main` after merging its own PRs — a reasonable thing to do to an
  integration checkout you believe you own.
- The reflog recorded 5+ consecutive `reset: moving to origin/main`. Each discarded the
  first agent's uncommitted edits and orphaned two of its commits. A committed script, a
  documentation correction and a `packages/db` fix were lost and had to be reconstructed —
  once from reflog, once by hand.

**The root cause was not the reset.** It was two agents sharing one worktree on one branch.
Branch and worktree isolation is what prevents this; asking the other agent to be gentler
does not.

A second, quieter symptom of the same cause: PR numbers **#320, #321, #323 and #324** were
each used twice, because both agents assumed "the next number" instead of reading the
remote.

---

## Rules

### 1. `main` is read-only

`main` is an integration branch and a shared view. Treat any checkout of it as somebody
else's. No commits, no edits, no staging — regardless of how small the change is.

### 2. One isolated worktree per task

```bash
git fetch origin
git worktree add <worktree-root>/<agent>-<topic> -b <agent>/<topic> origin/main
```

A separate **worktree**, not merely a separate branch. A branch alone is not protection:
`git reset --hard origin/main` resets whichever branch happens to be checked out, so
sharing the worktree still loses the work.

Conventions in use:

| Agent | Worktree | Branch |
|---|---|---|
| Claude Code | `/home/ec2-user/wt/<topic>` | `feat/<topic>`, `fix/<topic>` |
| Kiro | `/home/ec2-user/CivitasOne/wt/kiro-<topic>` | `kiro/<topic>` |

Kiro's worktrees live under `CivitasOne/` rather than `/home/ec2-user/wt/` for a concrete
reason: Kiro's file-editing tools are sandboxed to the workspace root
(`/home/ec2-user/CivitasOne`). A worktree outside it can be reached by shell but not by the
normal edit tools, which quietly pushes the agent into writing files via heredocs. Keep
each agent's worktrees somewhere that agent can actually edit.

Remove the worktree once merged: `git worktree remove <path>`.

### 3. Never `git reset --hard` a worktree you do not exclusively own

Including `main`. Sync with a command that **fails instead of discarding**:

```bash
git fetch origin && git merge --ff-only origin/main
```

If it refuses, there is local work to deal with. Discovering that is the entire point.

### 4. Commit early and push early

Uncommitted work in this repo is not safe. Do not batch a session into one commit at the
end. Commit each coherent step as soon as it verifies, and push the branch as soon as the
first commit exists — a pushed commit survives any local reset.

### 5. Branch → push → PR → merge

```bash
git add <specific paths>     # never `git add .` — another agent's files may be dirty
git commit                   # explain WHY, not just WHAT
git push -u origin <agent>/<topic>
gh pr create --fill --base main
```

`git add .` is specifically dangerous here: concurrent agents leave unrelated modified and
untracked files in the tree, and a broad add sweeps them into the wrong commit.

An agent must not merge its own unreviewed work into `main`. That is the maker approving
its own change, which this repo's engineering standards already forbid for humans. Merge
only when the change has been approved, or the user has asked for it explicitly.

If `gh` is not authenticated (check `gh auth status`), do **not** silently merge instead.
Push the branch and hand over the compare link:

```
https://github.com/dbn1972/civitasone-suite/compare/main...<agent>/<topic>?expand=1
```

### 6. Read the PR number, never guess it

```bash
gh pr list --limit 1 --state all --json number
```

If it cannot be determined, **omit the number** from the commit message rather than
inventing one. A wrong number in permanent history is worse than no number.

### 7. Sub-agents must not touch git

When work is delegated, state explicitly that the sub-agent may not run `git add`,
`commit`, `branch`, `checkout`, `push`, `stash` or `reset`. The supervising agent owns all
git operations and stages by explicit path.

Give each sub-agent a **disjoint file allowlist**. Two sub-agents editing one file — even
harmlessly, like two route registrations in the same `app.ts` — forces a manual merge and
is the first thing that breaks as parallelism grows.

### 8. Verify independently; do not trust reports

Re-run typecheck and tests yourself rather than believing a report. In this repo that habit
has repeatedly caught real problems reports had missed or misattributed:

- a `packages/db` change that *appeared* to break helpdesk was pre-existing flake — proved
  by running the suite three times with the change and three times without, where both
  configurations flaked;
- a tracker update silently skipped 8 rows because their identifiers were multi-word and
  did not match the pattern being replaced;
- a file reported as "vanished by a concurrent process" had in fact never been committed.

Where a claim concerns the database, query the database — not the code that talks to it.

---

## Checklist

Before writing code:

- [ ] `git fetch origin`
- [ ] Task worktree created from `origin/main` on `<agent>/<topic>`
- [ ] Current branch is **not** `main`

Before finishing:

- [ ] Typecheck and tests run, output actually read
- [ ] Coverage gate met for touched services (≥80% lines)
- [ ] Staged by explicit path, not `git add .`
- [ ] Commit message explains WHY; no invented PR number
- [ ] Branch pushed with `-u`
- [ ] PR opened, or the compare URL handed over with an explanation
- [ ] Anything found but **not** fixed is reported, with the reason
