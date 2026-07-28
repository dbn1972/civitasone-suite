# ERP HRMS & ATS Functional Verification Checklist

> **Source:** ERP-HRMS-ATS-Functional-Verification-Checklist.xlsx  
> **Scope:** 811 detailed checklist lines across 37 modules, plus 20 end-to-end scenarios.

---

## Purpose

A consolidated, line-by-line checklist to verify HRMS, ATS and connected ERP functionality for Government organisations, PSU/CPSEs, Section 8 companies, legacy Section 25 companies and private companies.

## How to Use

- Filter the Master Checklist by Module, Priority, organisation applicability or Status.
- Enter evidence, defect, owner, target date and remarks.
- Use one row per independently demonstrable feature.

## Applicability Codes

| Code | Meaning |
|------|---------|
| M | Mandatory/core |
| C | Conditional based on policy/employee group |
| O | Optional/good practice |
| N | Normally not applicable |

## Status Values

Not Tested, Pass, Fail, Partial, Blocked, Not Applicable.

## Sign-off Values

Pending, Accepted, Accepted with Conditions, Rejected.

## Acceptance Approach

Test positive, negative, boundary, retrospective/effective-date, role/security, audit, notification and downstream-integration behaviour for each critical item.

## Section 25 Note

The workbook keeps a separate legacy Section 25 column for historical entity classification. Current non-profit company configuration should be legally validated and normally aligned to the applicable Section 8 framework.

## Scope Boundary

This is a comprehensive functional and operational verification checklist, not a substitute for legal, tax, labour, service-rule or organisation-policy review.

## Source Documents Reviewed

- Scope HRMS(1).docx
- Scope ATS (1)(1).docx
- Comprehensive_eHRMS_Scope_Consolidated(1).docx

---

## Checklist Size

**811 detailed checklist lines** across **37 modules**, plus **20 end-to-end scenarios**.

---

## Module Coverage Summary

| Module | Total Lines |
|--------|------------|
| AI-enabled HR Capabilities | 16 |
| Asset Management | 11 |
| Attendance & Time Management | 35 |
| Configuration, UAT & Go-Live | 12 |
| Contract & Engagement Management | 11 |
| Data Migration & Cutover | 12 |
| Employee Master & Digital Service Book | 29 |
| Employee Movement | 15 |
| Employee Self-Service (ESS) | 14 |
| Engagement, Surveys & Recognition | 10 |
| Enterprise Integrations | 22 |
| Government Organisation Controls | 12 |
| Grievance, POSH, Discipline & Vigilance | 29 |
| HR Analytics & Dashboards | 26 |
| Learning & Development | 13 |
| Leave Management | 27 |
| Manager Self-Service (MSS) | 11 |
| Non-Functional & Operational Readiness | 22 |
| Organisation & Position Management | 10 |
| Organisation & Tenant Setup | 25 |
| PSU / CPSE Controls | 12 |
| Payroll & Compensation | 53 |
| Performance, KRA & APAR | 37 |
| Pre-Joining & Onboarding | 28 |
| Private Company Controls | 12 |
| Probation & Confirmation | 10 |
| Project & Resource Management | 12 |
| Recruitment & ATS | 120 |
| Retirement & Pension | 10 |
| Section 8 / Legacy Section 25 Controls | 12 |
| Security, Privacy & Audit | 26 |
| Separation & Exit | 23 |
| Statutory Compliance & Tax | 26 |
| Talent, Competency & Succession | 12 |
| Travel & Expense | 12 |
| Workflow, Notifications & SLA | 22 |
| Workforce Planning & Position Control | 22 |

---

## End-to-End Scenarios (20)

| ID | Scenario | Applicable Organisation |
|----|----------|------------------------|
| E2E-001 | Recruitment to payroll | Government, PSU, Section 8/25, Private |
| E2E-002 | Contract hire renewal | All |
| E2E-003 | Government promotion | Government |
| E2E-004 | CPSE executive appraisal and PRP | PSU/CPSE |
| E2E-005 | Section 8 grant-funded resource | Section 8 / legacy Section 25 |
| E2E-006 | Leave to payroll | All |
| E2E-007 | Attendance and overtime | Government/PSU/Private |
| E2E-008 | Employee transfer | Government/PSU/All configurable |
| E2E-009 | Resignation and F&F | All |
| E2E-010 | Retirement/pension | Government/selected PSU |
| E2E-011 | POSH case confidentiality | All |
| E2E-012 | Disciplinary case | Government/PSU/All configurable |
| E2E-013 | Payroll correction | All |
| E2E-014 | Manager change during pending approvals | All |
| E2E-015 | Integration outage | All |
| E2E-016 | Data subject/employee correction request | All |
| E2E-017 | Rehire | All |
| E2E-018 | Organisation restructure | All |
| E2E-019 | Bulk recruitment | Government/PSU/Private |
| E2E-020 | Disaster recovery payroll continuity | All |

---

## Organisation Profiles

| Organisation Type | Core HR/ATS | Distinctive Configuration | Highest-Risk Verification Areas |
|-------------------|-------------|---------------------------|-------------------------------|
| Government | Full employee lifecycle plus establishment/service matters | Sanctioned posts, cadre/service, reservation roster, pay matrix, service book, APAR, transfer/deputation, conduct/vigilance, pension, eOffice/DDO/competent authority | Historical/effective-dated service data, authority mapping, roster/seniority, pay fixation/arrears, restricted cases, pension readiness |
| PSU / CPSE | Full employee lifecycle, industrial/plant and corporate requirements | CDA/IDA groups, board/below-board levels, PRP, APAR/ACR, DPE-linked governance, conduct/discipline, plant shifts, delegated powers | PRP and pay rules, board approvals, shift/overtime, industrial relations, confidential appraisal/discipline |
| Section 8 | Full HRMS/ATS with non-profit/project funding controls | Programme/grant/donor/project mapping, consultant and field workforce, grant-period validation, restricted funding allocation, board/donor approval | Grant cost allocation, contract validity, donor restrictions, timesheet evidence, data confidentiality |
| Section 25 (legacy) | Historical classification of pre-2013 non-profit entity | Retain legacy registration reference and reporting label; use current legal/policy configuration validated by counsel/CS | Incorrectly maintaining two conflicting policy engines; historical document traceability |
| Private | Full HRMS/ATS with market-driven workforce and compensation flexibility | CTC, variable pay, incentives, ESOP reference, hybrid work, PIP, multi-location/multi-country, billability/profit centre | Compensation privacy, incentive accuracy, access provisioning, high-volume recruitment, flexible attendance |

---

## Reference Sources

| Source | Type | Reference |
|--------|------|-----------|
| Scope HRMS(1).docx | User-provided document | Uploaded in conversation |
| Scope ATS (1)(1).docx | User-provided document | Uploaded in conversation |
| Comprehensive_eHRMS_Scope_Consolidated(1).docx | User-provided document | Uploaded in conversation |
| Companies Act, 2013 - Section 8 | Official law portal | https://www.indiacode.nic.in |
| Department of Public Enterprises - Guidelines | Official Government website | https://www.dpe.gov.in/documents/guidelines |
| DPE - APAR and ACR Matters | Official Government website | https://www.dpe.gov.in/documents/guidelines/l-apar-and-acr-matters |
| DPE - Conduct, Discipline and Appeal Rules | Official Government website | https://www.dpe.gov.in/documents/guidelines/conduct-discipline-and-appeal-rules |

---

*Full 811-line checklist details are in the original Excel workbook. This markdown serves as the navigational summary and reference index.*
