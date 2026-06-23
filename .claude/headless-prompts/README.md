# CivitasOne Headless Prompts

Cleaned up 2026-06-22. Only active work lives at the top level; all completed
campaign rounds are under `archive/` (nothing deleted — fully reversible).

## Active

| Folder | Purpose |
|--------|---------|
| `cursor-handoff/` | **Current handoff.** Agent-ready fixes for Cursor / `claude -p`. Start at `06-FIX-PROMPTS.md` (P0→P1 prompts), then `01-P1-FIXES.md` / `02-P2-FIXES.md`. Track in `05-COMPLETION-SCORECARD.md`. |
| `uat-round2/` | Latest authoritative UAT round. `CTO-REPORT-ROUND2.md` = current scorecard & verdict; `UAT-ROUND2-WORLD-CLASS.md` = reusable world-class UAT prompt; `STATUS.tsv` = run log. |

## Archive (completed rounds — reference only)

| Folder | Round | Date |
|--------|-------|------|
| `archive/round1-build/` | Initial module build prompts (01–22) | Jun 20 |
| `archive/web-ui/` | Web UI expansion prompts (30–40) | Jun 20 |
| `archive/remediation/` | R00–R40 remediation round | Jun 20 |
| `archive/redesign/` | D00–D40 design round | Jun 21 |
| `archive/fixes-r1/` | FIX-1…4 data-shape fixes | Jun 21 |
| `archive/uat-fixes-r1/` | UAT round 1 fixes (FIX-00…11) | Jun 21 |
| `archive/logs/` | Old orchestration execution logs | Jun 20 |
| `archive/scripts/` | Round-1 orchestrators (`orchestrate.sh`, `run-all.sh`) | Jun 20 |

## How to run a prompt

```bash
ssh cloudsphere-ec2
cd ~/CivitasOne/civitasone-suite
export PATH="$HOME/.npm-global/bin:$PATH"
claude -p "$(cat .claude/headless-prompts/cursor-handoff/06-FIX-PROMPTS.md)" --dangerously-skip-permissions
```
