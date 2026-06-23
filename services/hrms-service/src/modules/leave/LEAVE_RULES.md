# CivitasOne HRMS — Leave Rules (Indian Central Government / PSU / Contractual)

## 1. Leave Master — by Employee Type

| Leave Type | Code | Permanent (Govt) | Permanent (PSU) | Contractual | Carry Forward | Encashment |
|------------|------|:---------:|:---------:|:-----------:|:----:|:---------:|
| Casual Leave | CL | 8 days/yr | 12 days/yr | 8 days/yr | No | No |
| Earned Leave | EL | 30 days/yr | 30 days/yr | 0 | Yes (max 300) | Yes |
| Half Pay Leave | HPL | 20 days/yr | 20 days/yr | 0 | Yes (unlimited) | No |
| Commuted Leave | COML | 0 (converted from HPL) | 0 | 0 | No | No |
| Maternity Leave | ML | 180 days | 180 days | 0 | No | No |
| Paternity Leave | PL | 15 days | 15 days | 0 | No | No |
| Child Care Leave | CCL | 730 days (entire service) | 0 | 0 | No | No |
| Study Leave | SL | 24 months | 12 months | 0 | No | No |
| Special CL (disability) | SCL | 10 days/yr | 10 days/yr | 0 | No | No |
| Compensatory Off | CO | Actual worked | Actual worked | Actual worked | Lapse in 30 days | No |

## 2. Validation Rules

### R1: Balance Check
- Leave cannot be applied if balance < days requested
- For EL: minimum balance after deduction must be ≥ 0
- For HPL: commuted leave debits 2 HPL per 1 commuted day

### R2: Minimum Service Requirement
- EL: Only after 1 year of continuous service
- CCL: Only for women employees with < 2 surviving children
- Study Leave: Only after 5 years of continuous service

### R3: Holiday-Aware Calculation
- CL: Count CALENDAR days (includes holidays/weekends)
- EL: Count WORKING days only (exclude weekends + gazetted holidays from DB)
- HPL: Count CALENDAR days

### R4: Joining/Probation Rules
- Probationers: Only CL allowed during probation period
- Contractual: Only CL allowed (no EL/HPL/ML/PL)
- Deputation: Follow parent org's leave rules

### R5: Maximum Continuous Limits
- CL: Max 8 continuous days (including prefixed/suffixed holidays)
- EL: Max 180 continuous days
- HPL: Max 180 continuous days

### R6: Prefix/Suffix Holiday Rule
- If leave is suffixed/prefixed by a holiday, the holiday is counted as leave
- Exception: CL of 1 day does not attract prefix/suffix rule

### R7: Sandwich Rule
- If leave is taken between two holidays (sandwich), those holidays count as leave
- Applied to CL only

### R8: Fiscal Year Rules
- CL: Jan–Dec cycle, lapses on Dec 31
- EL: Credited Jan 1 (advance) or earned monthly (1/12 per month)
- Carry forward: EL accumulates; max 300 days total

## 3. Approval Workflow by Employee Type

| Employee Type | Level 1 | Level 2 | Level 3 |
|---------------|---------|---------|---------|
| Permanent (Officer) | Reporting Officer | HOD | — |
| Permanent (Gazetted) | HOD | Director/Secretary | — |
| Contractual | Project Lead | HR Admin | — |
| Deputation | Host Org RO | Host Org HOD | Parent Org copy |

