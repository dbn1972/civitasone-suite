# eOffice / CSMOP Compliance Prompt Set

Authored prompts that derive the GoI office-procedure gap analysis from the
written **Central Secretariat Manual of Office Procedure (CSMOP)** baseline and
drive the remediation wave for `estab-service`.

| Prompt | Procedural area | Gap | Remediation | Severity |
|--------|-----------------|-----|-------------|:--------:|
| [00](./00-master-office-procedure-audit.md) | Master receipt→archival audit | — | — | — |
| [01](./01-org-hierarchy.md) | Organisation hierarchy | #1 | R1 | High |
| [02](./02-file-type-taxonomy.md) | File-type taxonomy | #2 | R2 | High |
| [03](./03-dfa-hardening.md) | Drafting / DFA | #3 | R3 | High |
| [04](./04-record-room.md) | Record room | #4 | R4 | Medium |
| [05](./05-archival-nai.md) | Archival & NAI transfer | #5 | R5 | Medium |
| [06](./06-records-officer.md) | Records Officer & review | #7 | R6 | Medium |
| [07](./07-structured-referencing.md) | Structured referencing | #6 | R7 | Medium |
| [08](./08-eoffice-parity.md) | NIC eOffice parity | #8 | R8 | Medium |
| [09](./09-diary-numbering.md) | Diary / DAK numbering | #9 | R9 | Low |
| [10](./10-conditional-approval.md) | Conditional approval | #10 | R10 | Low |

Source gap analysis: [`../../EOFFICE-GOI-PROCEDURE-GAP-ANALYSIS-2026-06-30.md`](../../EOFFICE-GOI-PROCEDURE-GAP-ANALYSIS-2026-06-30.md)

## Remediation order (by severity, then dependency)
1. **R3** DFA gapless numbering + versioning (High, self-contained) ✅ done
2. **R1** Org-hierarchy module (High) ✅ done
3. **R2** File-type taxonomy (High) ✅ done
4. **R9** System diary numbering + duplicate-subject warning (Low, cheap) ✅ done
5. **R10** Conditional/partial approval (Low, cheap) ✅ done
6. **R4** Record room (Medium) ✅ done
7. **R5** Archival & NAI (Medium) ✅ done
8. **R6** Records Officer & annual review (Medium, depends on R1)
9. **R7** Structured referencing (Medium) ✅ done
10. **R8** eOffice parity (Medium, template shared with R3)

Each fix ships a forward migration (`0018_`…), GRANTs to `estab_svc`, Vitest
coverage, clean typecheck, and a green estab suite before commit.
