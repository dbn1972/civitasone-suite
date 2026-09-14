# Requirements Document

## Introduction

CivitasOne is a multi-tenant government ERP web application whose target operator is a lower-level government office clerk who has received no formal training and has no IT background. The product goal is "true zero-training": a non-specialist can set up an organisation and operate every specialist module (HRMS, Finance, Procurement, Establishment, Payroll, and others) without external instruction.

A product-head-level review identified gaps that stand between the current product and that goal. This specification turns those review findings into verifiable requirements across six areas:

1. **Plain-language labels and jargon reduction** so every screen reads in human terms and specialist government terms are explained in place rather than left unexplained or renamed away.
2. **Standardised label and terminology rules** so platform jargon (for example "Tenant", "maker-checker", "enablement", internal queues) is replaced with everyday words or hidden, while established government terms are retained and explained in place.
3. **Clear, human error messages** so a clerk never sees raw server text, HTTP status codes, stack traces, internal error identifiers, or developer phrasing, and always learns what happened and what to do next.
4. **In-product help that teaches operation** so every enabled module the clerk can see carries a guide, glossary coverage, plain-language titles, guided empty states, task steps, and a "How this works" entry point, with explicit, per-module verifiable coverage for all Major Modules (HRMS, Finance, Procurement, Establishment, Payroll, Grants, Projects, Citizen Services, and Office Admin).
5. **A first-run organisation installation and configuration wizard** that guides the clerk through a true, ordered, resumable, skippable bootstrap of the organisation, captures (or routes into focused guided entry for) the data needed to operate, reports accurate progress, ends in a readiness/finish state, and never fabricates completion.
6. **Safe exploration aids** — an in-app first-run tour and a sample-data ("try it") toggle — so a new office can learn by exploring example records and then clear them in one action.

The requirements are implementation-agnostic. They describe what the system must do for the clerk; the design document will choose the mechanisms (components, routes, storage). The application already provides design-system primitives (PageHeader, EmptyState, DataTable guided-empty props, HelpTip, ConfirmDialog, ModuleHub, PageShell), a partial help layer (helpContent.ts, glossary.ts with explain(), /help hub, FirstRunTour), and a card-list setup page; these are the foundation the requirements build upon.

## Glossary

This glossary defines the system actors and key concepts used in the requirements. It also lists the specialist government terms that the product must explain to clerks in-context. Established government terms are retained (not renamed) and explained.

### System Actors and Concepts

- **System**: The CivitasOne web application as experienced by the clerk.
- **Clerk**: A lower-level government office user with no training and no IT background; the primary operator.
- **Tenant**: A single government organisation instance with its own data, enabled modules, and configuration. The clerk-facing label for a Tenant is "office" or "organisation".
- **Major Modules**: The nine functional areas this specification treats as requiring full, per-module verifiable zero-training coverage: HRMS, Finance, Procurement, Establishment, Payroll, Grants, Projects, Citizen Services, and Office Admin.
- **Enabled Module**: A functional area (for example HRMS, Finance, Procurement) that a tenant has turned on and that a clerk is permitted to see.
- **Disabled Module**: A functional area not turned on for the tenant, which must remain hidden from the clerk.
- **Primary Screen**: A top-level page of a module that a clerk lands on or navigates to as a main destination (module home and main list/detail pages).
- **Plain Subtitle**: A single-line, jargon-free sentence under a screen title that states what the screen is for in human terms.
- **HelpTip**: An in-place "?" affordance that, when activated, reveals a plain-language explanation of a specialist term.
- **Glossary**: The shared store of term definitions surfaced through the explain() facility and HelpTip.
- **Help Guide**: A module-level set of explanatory content and task instructions ("How do I…") for operating that module.
- **How This Works Link**: The entry point on a screen (the PageHeader/ModuleHub help affordance) that opens the relevant Help Guide.
- **Bootstrap Wizard**: The first-run, guided, ordered, resumable flow that sets up the organisation.
- **Wizard Step**: One ordered unit of the Bootstrap Wizard with a defined completion condition.
- **Progress Indicator**: The wizard's display of how many steps are genuinely complete.
- **Guided Empty State**: An empty list/table presentation that explains what the area is for and offers a next action.
- **Sample Data**: Clearly-marked example records the System can add to a Tenant so a Clerk can explore and learn safely, removable in one action.
- **First-Run Tour**: A short, skippable, guided walkthrough shown on a Clerk's first sign-in that explains where the main things are and where to get help.
- **Human Error Message**: A message stating in plain words what happened, what to do next, and a safe action, with no developer or transport detail.

### Specialist Government Terms To Be Explained (retained, not renamed)

- **PPO** — Pension Payment Order.
- **DDO** — Drawing and Disbursing Officer (and DDO Code).
- **DBT** — Direct Benefit Transfer.
- **ESI** — Employees' State Insurance.
- **PT** — Professional Tax.
- **IRN** — Invoice Reference Number.
- **UTR** — Unique Transaction Reference.
- **NEFT** — National Electronic Funds Transfer.
- **RTGS** — Real Time Gross Settlement.
- **BE** — Budget Estimate.
- **RE** — Revised Estimate.
- **CPC** — Central Pay Commission (for example, 7th CPC pay matrix).
- **MOM** — Minutes of Meeting.
- **KRA** — Key Result Area.
- **DAK** — Inward/outward correspondence registry.
- **eOffice** — Electronic file/note workflow (already present in glossary).
- **GPF / NPS** — General Provident Fund / National Pension System.
- **APAR** — Annual Performance Appraisal Report.
- **TA-DA** — Travelling Allowance / Daily Allowance.
- **RFQ / GRN / EMD / BG / GeM / Empanelment** — Procurement terms (Request for Quotation, Goods Receipt Note, Earnest Money Deposit, Bank Guarantee, Government e-Marketplace, supplier empanelment).
- **3-way match / voted / charged / PFMS / Form 16A** — Finance terms.

## Requirements

### Requirement 1: Plain-language labels on every primary screen

**User Story:** As a clerk with no training, I want every screen to tell me in plain words what it is for, so that I understand where I am and what I can do without prior knowledge.

#### Acceptance Criteria

1. WHERE a primary screen is displayed to a Clerk, THE System SHALL show a Plain Subtitle of one line that states the purpose of the screen in non-specialist language.
2. WHEN a primary screen displays a specialist government term in a label, heading, tile, or table header, THE System SHALL attach a HelpTip to that term.
3. WHEN a Clerk activates a HelpTip, THE System SHALL display the definition for that term from the Glossary.
4. THE System SHALL retain established government terms and SHALL present an explanation for each rather than replacing the term with an invented label.
5. WHERE the same specialist term appears on more than one screen, THE System SHALL present the identical definition sourced from the Glossary.

### Requirement 2: Glossary completeness for specialist terms

**User Story:** As a clerk, I want every unfamiliar abbreviation to have a definition I can read in place, so that I am never blocked by a term I do not recognise.

#### Acceptance Criteria

1. THE System SHALL provide a Glossary definition for each of the following terms: PPO, DDO, DBT, ESI, PT, IRN, UTR, NEFT, RTGS, BE, RE, CPC, MOM, KRA, and DAK.
2. WHERE a specialist term is shown to a Clerk and a HelpTip is attached, THE System SHALL resolve the term against the Glossary and display its definition.
3. IF a specialist term shown to a Clerk has no Glossary definition, THEN THE System SHALL surface that term as missing coverage to the maintaining team rather than displaying an empty or broken explanation to the Clerk, including specialist terms outside the mandated list in criterion 1.
4. THE System SHALL express each Glossary definition in plain language understandable without IT or domain training.

### Requirement 3: Help guide and "How this works" coverage for every enabled module

**User Story:** As a clerk, I want a "How this works" guide on every module I can open, so that I can learn to operate it without external training.

#### Acceptance Criteria

1. WHERE a module is enabled for the Tenant and visible to the Clerk, THE System SHALL provide a Help Guide for that module.
2. WHERE a module home or primary screen is displayed for an enabled module, THE System SHALL present a How This Works Link that opens the module's Help Guide.
3. THE System SHALL provide a dedicated Help Guide for each of the Major Modules (HRMS, Finance, Procurement, Establishment, Payroll, Grants, Projects, Citizen Services, and Office Admin), and SHALL provide these guides regardless of whether the corresponding module is enabled for the Tenant.
4. THE System SHALL provide the Payroll Help Guide as a standalone guide rather than as content folded inside the HRMS guide.
5. WHERE a module is disabled for the Tenant, THE System SHALL omit that module's Help Guide and How This Works Link from the Clerk's view.
6. THE System SHALL provide Establishment with a How This Works Link on its module home even though Establishment is presented through the module-hub layout, and SHALL present this link regardless of whether Establishment is enabled for the Tenant.
7. WHERE a Help Guide is displayed for a Major Module, THE System SHALL present the guide's purpose summary, a "How do I…" task list, and a "words explained" section for that module's specialist terms.

### Requirement 4: Task-oriented operability guidance per module

**User Story:** As a clerk, I want each module to show me the core tasks and how to do them, so that I can complete real work the first time I open it.

#### Acceptance Criteria

1. WHERE a Help Guide is opened for an enabled module, THE System SHALL present a "How do I…" task list covering the module's core tasks.
2. WHERE a list or table on a primary screen has no records, THE System SHALL display a Guided Empty State that explains the area's purpose and offers a next action.
3. IF the Guided Empty State cannot be displayed, THEN THE System SHALL display a basic plain-language empty message rather than leaving the screen blank.
4. THE System SHALL provide, for each of the Major Modules (HRMS, Finance, Procurement, Establishment, Payroll, Grants, Projects, Citizen Services, and Office Admin), task guidance sufficient for a Clerk to discover and complete at least one core task of that module.
5. WHEN a Clerk follows a task entry from the "How do I…" task list, THE System SHALL direct the Clerk to the screen where that task is performed.
6. WHERE a primary screen of a Major Module is displayed, THE System SHALL present a plain-language title and a Plain Subtitle that name the real thing the screen handles rather than developer or transport phrasing.

### Requirement 5: No developer or transport detail in error messages

**User Story:** As a clerk, I want errors explained in plain words, so that I am never confronted with technical text I cannot understand.

#### Acceptance Criteria

1. IF an error is presented to a Clerk, THEN THE System SHALL exclude raw server response text, HTTP status codes, stack traces, and underlying error messages from the displayed content.
2. IF a data source or connection is unavailable, THEN THE System SHALL describe the condition in human terms for all Clerks rather than displaying phrasing such as "API unavailable" or "Live API".
3. WHERE an internal reference identifier is needed for support, THE System SHALL present it with a plain-language label that explains its purpose to the Clerk.
4. THE System SHALL present internal process names in plain language rather than developer terminology when shown to a Clerk.

### Requirement 6: Actionable, recoverable error messages

**User Story:** As a clerk, I want every error to tell me what to do next, so that I can recover on my own instead of getting stuck.

#### Acceptance Criteria

1. IF an error is presented to a Clerk, THEN THE System SHALL state what happened in plain words.
2. IF an error is presented to a Clerk, THEN THE System SHALL state what the Clerk can do next in plain words.
3. IF an error is presented to a Clerk, THEN THE System SHALL offer at least one safe action from among retry, go back, and open help.
4. WHILE the System is operating in a degraded or offline state, THE System SHALL describe that state in human terms and SHALL indicate what the Clerk can still do.
5. WHEN a submitted action is accepted for later processing rather than completed immediately, THE System SHALL inform the Clerk in plain words that the action was received and what happens next.

### Requirement 7: Guided, ordered organisation bootstrap wizard

**User Story:** As a clerk setting up a new organisation, I want a step-by-step wizard that walks me through setup in order, so that I can bootstrap the organisation without knowing the right sequence in advance.

#### Acceptance Criteria

1. WHEN a Clerk begins first-run setup, THE System SHALL present the Bootstrap Wizard as an ordered sequence of Wizard Steps.
2. THE Bootstrap Wizard SHALL present each Wizard Step with a plain-language title, a plain-language explanation of its purpose, and at least one example of valid input.
3. THE Bootstrap Wizard SHALL capture the setup data within the wizard flow, or route the Clerk into a focused guided entry screen for that step and return the Clerk to the wizard afterwards, rather than only linking to an unrelated hub page.
4. THE Bootstrap Wizard SHALL cover the following setup areas: organisation profile, branch and office hierarchy, departments, roles and people, module enablement, financial year and chart of accounts, leave policies, and payroll pay structure.
5. WHERE a Wizard Step is not required for the Clerk to proceed, THE System SHALL offer a skip or do-later option for that step.
6. WHEN a Clerk completes a Wizard Step, THE System SHALL allow the Clerk to advance to the next ordered step.
7. WHEN all required Wizard Steps are complete, THE System SHALL present a readiness/finish state that confirms the organisation is ready and offers the Clerk a next destination.
8. THE Bootstrap Wizard SHALL present, beside each input that captures setup data, at least one concrete example of valid input.

### Requirement 8: Accurate, honest wizard progress

**User Story:** As a clerk, I want the wizard to show progress that reflects what is truly done, so that I can trust the setup status and know what remains.

#### Acceptance Criteria

1. THE System SHALL mark a Wizard Step as complete only when that step's defined completion condition is satisfied by actual Tenant data.
2. THE System SHALL compute the Progress Indicator from the genuinely completed Wizard Steps.
3. IF the Progress Indicator computation fails, THEN THE System SHALL display the last successfully computed progress value and SHALL continue normal operation.
4. IF the System cannot determine a Wizard Step's completion state, THEN THE System SHALL inform the Clerk that the status is unknown rather than displaying the step as complete or as "to do" without explanation.
5. THE System SHALL reflect the completion state of every Wizard Step in the Progress Indicator, including organisation profile and departments.

### Requirement 9: Resumable and re-enterable wizard

**User Story:** As a clerk who gets interrupted, I want to leave the wizard and come back where I left off, so that I do not lose work or have to start over.

#### Acceptance Criteria

1. WHEN a Clerk leaves the Bootstrap Wizard before finishing, THE System SHALL preserve the completion state of the steps already done.
2. WHEN a Clerk returns to the Bootstrap Wizard, THE System SHALL resume at the next incomplete Wizard Step.
3. THE System SHALL allow a Clerk to re-enter a previously completed Wizard Step to review or change its data.
4. THE System SHALL determine each Wizard Step's completion state from actual Tenant data on re-entry and SHALL NOT present a step as complete on the basis of a prior visit alone.

### Requirement 10: Friendly handling of wizard failures

**User Story:** As a clerk, I want the wizard to handle problems gracefully, so that a backend hiccup does not block or confuse me during setup.

#### Acceptance Criteria

1. IF a backend call fails while loading a Wizard Step, THEN THE System SHALL inform the Clerk in plain words that the information could not be loaded and SHALL offer a retry.
2. IF a backend call fails while saving a Wizard Step, THEN THE System SHALL inform the Clerk in plain words that the data was not saved and SHALL NOT mark the step complete.
3. IF a Wizard Step's data cannot be loaded, THEN THE System SHALL avoid silently showing the step as "to do" and SHALL surface that the status could not be determined.
4. WHILE a Wizard Step fails to load or save, THE System SHALL keep the Clerk able to retry, move to another step, or open help.

### Requirement 11: Accessibility of help and wizard interfaces

**User Story:** As a clerk who may rely on a keyboard or assistive technology, I want the new help and wizard interfaces to be fully usable, so that I can complete setup and learning without a mouse or with assistive tools.

#### Acceptance Criteria

1. THE System SHALL make all HelpTip, Help Guide, and Bootstrap Wizard interfaces operable by keyboard alone.
2. WHEN a dialog or step panel in the help or wizard interfaces receives focus, THE System SHALL manage focus so that keyboard focus is placed within the active element and constrained to it while open.
3. THE System SHALL provide accessible names and roles for the HelpTip, How This Works Link, and Wizard Step controls so that assistive technology can identify them.
4. THE System SHALL meet WCAG 2.2 AA for all new help and wizard user interface elements.

### Requirement 12: Consistent terminology and tone

**User Story:** As a clerk, I want consistent wording across the product, so that the same thing is always called the same thing and I am not confused by varied phrasing.

#### Acceptance Criteria

1. THE System SHALL source term definitions for HelpTip and help content from the shared Glossary so that wording is consistent across screens.
2. WHERE a concept is named on multiple screens, THE System SHALL use the same label and the same explanation for that concept.
3. THE System SHALL apply a consistent, plain-language tone across help content, error messages, and wizard steps.

### Requirement 13: Multi-tenant safety of help and wizard

**User Story:** As a clerk, I want help and setup to reflect only the modules my organisation uses, so that I am not shown features that do not apply to me.

#### Acceptance Criteria

1. WHERE a module is disabled for the Tenant, THE System SHALL exclude that module from help listings, glossary surfacing tied to that module, and wizard module-related steps shown to the Clerk.
2. THE System SHALL present Help Guides and How This Works Links only for modules enabled for the Clerk's Tenant, and SHALL always present them for every enabled module.
3. WHEN the Bootstrap Wizard presents module enablement, THE System SHALL scope subsequent module-dependent setup to the modules the Tenant has enabled.
4. THE System SHALL confine all help and wizard data displayed to a Clerk to the Clerk's own Tenant.

### Requirement 14: Standardised labels and jargon replacement

**User Story:** As a clerk, I want platform jargon replaced with everyday words and internal plumbing hidden, so that I read familiar terms instead of technical ones I do not understand.

#### Acceptance Criteria

1. WHERE a Clerk-facing label would otherwise display the platform term "Tenant", THE System SHALL display "office" or "organisation" instead.
2. WHERE a Clerk-facing label names a maker-checker workflow action, THE System SHALL label the action "Send for approval" rather than naming the workflow pattern.
3. WHERE module enablement is presented to a Clerk, THE System SHALL describe the action as turning a module on or off rather than using the term "enablement".
4. THE System SHALL hide internal message-queue mechanisms, including outbox and dead-letter queue, from the Clerk's view.
5. THE System SHALL retain established government terms (for example Sanction, Indent, UC, GRN) and SHALL attach a HelpTip to each rather than replacing the term with an invented label.
6. WHERE a screen description would otherwise use developer phrasing (for example "Read-only list loaded from the service API"), THE System SHALL present a plain-language description of the screen's purpose instead.
7. WHERE a concept that has a defined standard label appears on more than one screen, THE System SHALL use that same standard label on every screen.

### Requirement 15: Sample data ("try it") toggle

**User Story:** As a clerk exploring a new office, I want to switch on safe example records and clear them in one click, so that I can learn by doing without affecting real data.

#### Acceptance Criteria

1. WHERE a Clerk chooses to explore with Sample Data, THE System SHALL add clearly-marked example records to the Clerk's own Tenant.
2. WHILE Sample Data is present, THE System SHALL visibly mark each example record as sample data so the Clerk can distinguish it from real records.
3. WHEN a Clerk clears Sample Data, THE System SHALL remove the Tenant's sample records in a single action.
4. WHEN a Clerk clears Sample Data, THE System SHALL retain records the Clerk created that are not Sample Data.
5. BEFORE clearing Sample Data, THE System SHALL state in plain words what will be removed and confirm the action with the Clerk.
6. IF clearing Sample Data fails, THEN THE System SHALL inform the Clerk in plain words that the example records were not removed and SHALL offer a retry.
7. THE System SHALL confine Sample Data creation and removal to the Clerk's own Tenant.

### Requirement 16: In-app first-run tour

**User Story:** As a clerk signing in for the first time, I want a short guided tour, so that I quickly learn where the main things are and where to get help.

#### Acceptance Criteria

1. WHEN a Clerk signs in for the first time, THE System SHALL present the First-Run Tour.
2. THE First-Run Tour SHALL explain, in plain language, where modules are found, how to begin setup, and how to reach help.
3. THE System SHALL allow the Clerk to skip the First-Run Tour at any point.
4. WHEN a Clerk completes or skips the First-Run Tour, THE System SHALL record that the tour has been seen and SHALL NOT present the First-Run Tour automatically on subsequent sign-ins.
5. THE System SHALL allow a Clerk to replay the First-Run Tour on demand from the help area.
6. THE System SHALL make the First-Run Tour operable by keyboard alone, with managed focus and an accessible name and role for its controls.
