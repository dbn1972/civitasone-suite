export interface Chapter {
  slug: string;
  title: string;
  icon: string;
  description: string;
  content: string;
}

export const chapters: Chapter[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    icon: "🚀",
    description: "First login, setup wizard, language, help",
    content: `# Chapter 1: Getting Started

> Everything you need to go from "I just got my login" to "I know my way around."

---

## Your First Login

### What you'll see:

When you open CivitasOne for the first time in your browser, you'll land on a sign-in page with the CivitasOne logo, a language chooser at the top right, and two fields: your email address and password.

### Steps to sign in:

1. Type your official email address in the **Email** field.
2. Type the temporary password you received (check your email from your IT admin).
3. Tap the blue **Sign in** button.
4. If your office uses two-step verification (MFA), you'll be asked for a code from your authenticator app. Enter it and tap **Verify**.
5. On your very first login, the system asks you to set a new password. Pick something you'll remember — at least 8 characters with a mix of letters and numbers.
6. Tap **Set password**. You're in!

> If you forget your password later, tap **Forgot password?** on the sign-in page. A reset link goes to your email.

---

## The Welcome Tour (4 Steps)

Right after your first sign-in, a friendly overlay appears — a short guided tour that highlights the main parts of the screen. It has four steps:

1. **The sidebar** — This is your menu. Every module you have access to appears here.
2. **The top bar** — Shows your name, your office, notifications (the bell icon), and the language switcher.
3. **Quick actions** — The "+" button lets you jump straight to common tasks like "Create bill" or "Apply leave."
4. **Help & AI assistant** — The "?" icon opens help tips, and the **Ask CivitasOne** button opens an AI chat.

---

## The Setup Wizard (8 Steps)

If you are the first person in your office to sign in (the admin), you'll see the **Setup Wizard**:

1. **Tell us about your office** — Name, address, organisation type
2. **Add your branch offices** — Branch name, address, parent office
3. **Set up departments** — Teams within your office
4. **Invite your team** — Name, email, role assignment
5. **Choose the parts you use** — Toggle modules on/off
6. **Set your financial year and accounts** — Financial year, Chart of Accounts
7. **Set up leave rules** — Leave types and days per year
8. **Set up pay structure** — Salary components (Basic, DA, HRA, deductions)

---

## Choosing Your Language

| Language | Label shown |
|----------|------------|
| English | English |
| Hindi | हिन्दी |
| Tamil | தமிழ் |
| Telugu | తెలుగు |
| Kannada | ಕನ್ನಡ |

To switch: tap the **Language** dropdown in the top bar and choose your preferred language. The entire interface changes instantly.

---

## How to Get Help

1. **Tooltip help** — Hover over "?" icons for field explanations
2. **Help Centre** — Tap "?" in the bottom-left for guides and walkthroughs
3. **AI Assistant** — Tap "Ask" for plain-language answers
4. **Keyboard shortcuts** — Press "?" on desktop to see shortcuts (Ctrl+K = search, Ctrl+/ = AI, Ctrl+N = create new)
`,
  },
  {
    slug: "finance",
    title: "Finance",
    icon: "💰",
    description: "Budgets, bills, payments, GL, reports",
    content: `# Chapter 2: Finance

> Look after your office's money — budgets, bills, payments, and the official account books.

---

## Finance Dashboard

When you open **Finance** from the sidebar, the first screen is your Finance Dashboard with summary cards:

| Card | What it tells you |
|------|------------------|
| **Total Budget** | Total money allocated for this financial year |
| **Spent So Far** | How much has been paid out already |
| **Committed** | Money promised but not yet paid |
| **Available Balance** | What's left to spend |
| **Pending Bills** | Bills waiting for approval or payment |
| **This Month's Payments** | Total money paid out this month |

---

## Budget

### Create a new budget allocation

1. Tap **+ Create Budget** at the top right.
2. Pick the **Financial Year** (e.g. 2025–26).
3. Choose the **Head of Account** from the dropdown.
4. Enter the **Budget Estimate (BE)** amount in rupees.
5. Optionally add a **Revised Estimate (RE)**.
6. Tap **Save**.

### Re-appropriate funds

1. Open the budget line you want to move money from.
2. Tap **Re-appropriate**.
3. Choose the destination Head of Account.
4. Enter the amount and reason.
5. Submit for approval.

---

## Bills

### Create a new bill

1. Tap **+ Create Bill**.
2. Choose the **Vendor** from your vendor list.
3. Enter the **Bill Amount** and the vendor's invoice number.
4. Pick the **Head of Account**.
5. Link to a **Sanction** and optionally a **Purchase Order**.
6. Attach the original bill document.
7. Tap **Save** or **Submit**.

### 3-way match

Before a bill is paid, the system checks three things agree:
- The **Purchase Order** (what you ordered)
- The **GRN** (what was delivered)
- The **Bill** (what the vendor is charging)

---

## Payments

### Initiate a payment

1. Tap **+ Initiate Payment**.
2. Confirm payee bank details.
3. Choose mode: NEFT, RTGS, or Cheque.
4. Review amount and deductions (TDS, GST TDS calculated automatically).
5. Submit for Approval.

---

## General Ledger

### Post a journal entry

1. Tap **+ Journal Entry**.
2. Enter Date and Narration.
3. Add Debit line (account + amount).
4. Add Credit line (account + amount).
5. Debits must equal credits.
6. Tap **Post**.

> Most entries are created automatically. Manual entries are for adjustments or corrections.
`,
  },
  {
    slug: "hr-payroll",
    title: "HR & Payroll",
    icon: "👥",
    description: "Leave, attendance, payroll, recruitment, APAR",
    content: `# Chapter 3: HR & Payroll

> Manage your people — joining, attendance, leave, transfers, salaries, and yearly reviews.

---

## Employee Directory

Open **HR** from the sidebar. The first screen shows the **Employee Directory** — a searchable list of everyone in your office.

### Search for someone

1. Type a name, employee ID, or designation in the **Search** bar.
2. Results filter as you type.
3. Use the **Department** dropdown to narrow to one team.
4. Tap a person's row to open their full profile.

### Employee profile tabs

- **Personal** — name, date of birth, contact, emergency contacts
- **Service** — joining date, current posting, promotion history, transfer history
- **Pay** — current pay level, allowances, bank account
- **Leave** — balances for each leave type
- **Documents** — uploaded ID proofs, appointment orders

---

## Leave Management

### Apply for leave

1. Tap **+ Apply Leave**.
2. Choose the **Leave Type** (Casual, Earned, Half Pay, etc.).
3. Pick **From Date** and **To Date**.
4. If half-day, tick the checkbox.
5. Type a short **Reason**.
6. Tap **Submit**.

### Approve or reject leave

1. Open **HR → Leave → Pending Approvals**.
2. Tap the request to view details.
3. Check the person's leave balance.
4. Tap **Approve** or **Reject** (with reason).

---

## Attendance

### GPS check-in (mobile)

1. Open the CivitasOne mobile app.
2. Tap **Check In** on the home screen.
3. Allow location access. Your GPS location is captured.
4. Take a selfie when prompted.
5. Tap **Submit**. At day's end, repeat with **Check Out**.

---

## Payroll

### Run monthly payroll

1. Tap **+ New Payroll Run**.
2. Pick the **Month and Year**.
3. The system calculates salaries based on pay structure, attendance, and leave.
4. Review the summary.
5. Tap **Submit for Approval**.
6. After approval, generate payslips and bank files.
`,
  },
  {
    slug: "procurement",
    title: "Procurement",
    icon: "🛒",
    description: "Indents, POs, vendors, GRN, tenders",
    content: `# Chapter 4: Procurement

> Buy goods and services the right way — from a request to choosing a supplier to receiving the delivery.

---

## Indents (Purchase Requests)

### Create an indent

1. Tap **+ Create Indent**.
2. Enter a short **Description** of what you need.
3. Add items: name, quantity, unit, estimated unit price.
4. Pick the **Required By Date**.
5. Choose the **Head of Account**.
6. Tap **Submit for Approval**.

### Approve an indent

1. Open **Procurement → Indents → Pending Approval**.
2. Review items, quantities, estimated cost.
3. Confirm budget availability.
4. Tap **Approve** or **Reject**.

### Convert to Purchase Order

1. Open an approved indent.
2. Tap **Convert to PO**.
3. Select the Vendor and confirm prices.
4. Complete and submit the PO.

---

## Vendors

### Empanel a new vendor

1. Tap **+ Add Vendor**.
2. Fill in: Business Name, GSTIN, PAN, Address, Phone, Email, Bank Account, Category.
3. Attach supporting documents.
4. Tap **Submit for Empanelment**.

### Rate a vendor

Score on Delivery Timeliness, Quality, Communication (1–5 stars each).

---

## Purchase Orders

### Create a PO

1. Tap **+ Create PO**.
2. Select the **Vendor**.
3. Add items with quantities and agreed prices.
4. Set delivery date and terms.
5. Link to budget head and sanction.
6. Submit for approval.

---

## Goods Received Note (GRN)

### Record goods received

1. Open the PO.
2. Tap **Record GRN**.
3. Enter quantity received per item.
4. Note any damaged or short items.
5. Tap **Save**. Stock updates automatically.
`,
  },
  {
    slug: "projects-grants",
    title: "Projects & Grants",
    icon: "📋",
    description: "Tasks, milestones, Gantt, disbursement, UCs",
    content: `# Chapter 5: Projects & Grants

> Plan and track projects — phases, tasks, milestones, and spending. Disburse grant money and track how it's used.

---

## Projects

### Create a new project

1. Tap **+ New Project**.
2. Enter **Project Name** and **Description**.
3. Set **Start Date** and **Expected End Date**.
4. Enter the **Total Budget**.
5. Choose the **Head of Account**.
6. Assign a **Project Manager**.
7. Tap **Create**.

### Add milestones

1. Open the project → **Milestones** tab.
2. Tap **+ Add Milestone**.
3. Enter name, target date, budget allocated.

### Break work into phases and tasks

1. Open project → **Work Breakdown** tab.
2. Add phases, then add tasks within each phase.
3. Each task: name, assigned to, start/due date, status.

### Gantt view

Horizontal timeline chart with colour-coded bars:
- Green = on track
- Amber = at risk
- Red = delayed

Dependencies between tasks show as arrows.

---

## Grants

### Create a grant

1. Tap **+ New Grant**.
2. Enter scheme name, grantee, sanctioned amount.
3. Set disbursement schedule.
4. Tap **Save**.

### Disburse funds

1. Open the grant.
2. Tap **+ Disburse**.
3. Enter amount, instalment number, bank details.
4. Submit for approval.

### Track Utilisation Certificates

1. Open grant → **UCs** tab.
2. View submitted UCs and their status.
3. Approve or return with remarks.
`,
  },
  {
    slug: "establishment",
    title: "Establishment",
    icon: "🏛️",
    description: "eOffice files, meetings, vehicles, RTI",
    content: `# Chapter 6: Establishment

> Run the office's day-to-day paperwork — files and notes, meetings, vehicles, and RTI responses.

---

## eOffice Files

### Create a new file

1. Tap **+ Create File**.
2. Enter the **Subject**.
3. Choose the **File Category** (General, Confidential, Secret).
4. Pick the **Department**.
5. Tap **Create**. A unique file number is generated.

### Add a note to a file

1. Open the file → **Note Sheet** tab.
2. Tap **+ Add Note**.
3. Type your note with recommendation or decision.
4. Attach documents if needed.
5. Tap **Save Note**.

### Forward a file

1. Open the file.
2. Tap **Forward**.
3. Search for the person or desk.
4. Add a forwarding remark.
5. Tap **Send**.

---

## Meetings

### Schedule a meeting

1. Tap **+ New Meeting**.
2. Enter Title, Date, Start/End Time, Venue.
3. Choose Chairperson and add Attendees.
4. Add the Agenda.
5. Tap **Send Invites**.

### Record Minutes of Meeting

1. After the meeting, open the record.
2. Tap **+ Record Minutes**.
3. For each agenda item: Discussion, Decision, Action Items.
4. Tap **Save & Circulate**.

---

## Vehicle Management

### Book an office vehicle

1. Open **Establishment → Vehicles**.
2. Tap **+ Book Vehicle**.
3. Enter purpose, date, time, destination.
4. Tap **Submit**. The transport officer approves.
`,
  },
  {
    slug: "citizen-helpdesk",
    title: "Citizen Services & Helpdesk",
    icon: "🎫",
    description: "RTI, grievances, service requests, SLA tracking",
    content: `# Chapter 7: Citizen Services & Helpdesk

> Handle requests from the public — RTI, grievances, service requests — and manage internal helpdesk tickets.

---

## Filing a Request (Citizen Side)

Citizens see three main options on the public portal:

### RTI Request

1. Tap **File RTI Request**.
2. Fill in Name, Address, Phone, Email.
3. Type what information is being requested.
4. Choose the Department.
5. Pay the fee online or upload receipt.
6. Tap **Submit**. Response expected within 30 days.

### Grievance

1. Tap **Lodge Grievance**.
2. Fill in personal details.
3. Describe the complaint.
4. Choose the Category (water, roads, electricity, etc.).
5. Attach photos or documents.
6. Tap **Submit**.

### Service Request

1. Tap **Apply for Service**.
2. Choose the Service Type (birth certificate, trade licence, NOC, etc.).
3. Fill in the application form.
4. Upload required documents and pay fee.
5. Tap **Submit**.

---

## Tracking Status

Citizens enter their Application Number to see a timeline:
- **Submitted** → **Assigned** → **In Progress** → **Response/Decision**

SLA deadlines:
- RTI: 30 days
- Grievance: 15–30 days
- Service Request: varies by type

---

## Handling Requests (Officer Side)

Officers see all incoming requests in tabs: RTI, Grievances, Service Requests. Each shows application number, citizen name, SLA deadline, and status.

### Process a request

1. Open the request.
2. Review the details and attached documents.
3. Add internal notes (not visible to citizen).
4. Take action: respond, forward, or escalate.
5. Update the status.
`,
  },
  {
    slug: "stock-assets",
    title: "Stock & Assets",
    icon: "📦",
    description: "Inventory, asset register, depreciation, audits",
    content: `# Chapter 8: Stock & Assets

> Keep track of what your office owns and stores — goods in stock, furniture, equipment, vehicles, and buildings.

---

## Stock Management

### Receive goods

**Using barcode scanner (mobile):**
1. Open CivitasOne app → **Stock Scanner**.
2. Tap **Receive Goods**.
3. Scan the barcode on each item.
4. Enter the Quantity received.
5. Link to the GRN or PO.
6. Tap **Confirm**. Stock updates instantly.

**Manual entry (web):**
1. Open **Stock → Receive**.
2. Search for the item.
3. Enter Quantity, link to PO/GRN.
4. Enter Batch Number and Expiry Date if applicable.
5. Tap **Save**.

### Adjust stock quantity

1. Open the item.
2. Tap **Adjust Quantity**.
3. Choose reason: Physical Count, Damaged, Expired, Transfer, Other.
4. Enter the corrected quantity.
5. Add a remark.
6. Submit for approval.

---

## Assets

### Register a new asset

1. Tap **+ Register Asset**.
2. Enter: Asset Name, Category, Purchase Date, Purchase Value, Vendor, Location, Custodian.
3. System generates an **Asset Tag Number**.
4. Enter serial number if applicable.
5. Tap **Save**.

### Track depreciation

Assets depreciate automatically based on category rules. View current book value in the asset register.

### Physical verification

1. Open **Assets → Verification**.
2. Start a new verification drive.
3. Scan asset tags or manually check each item.
4. Mark as: Found, Not Found, Damaged.
5. Submit the verification report.
`,
  },
  {
    slug: "small-business",
    title: "Small Business",
    icon: "🏪",
    description: "Invoices, expenses, payments, GST, customers",
    content: `# Chapter 9: Small Business

> Run your small office or MSME with simple tools — invoices, payments, expenses, and customer records.

---

## Dashboard

Your Business Dashboard shows:

| Card | What it means |
|------|--------------|
| **Today's Sales** | Total invoices created today |
| **Today's Expenses** | Total expenses recorded today |
| **Today's Profit/Loss** | Sales minus Expenses |
| **Outstanding Receivable** | Money customers owe you |
| **Outstanding Payable** | Money you owe suppliers |
| **Cash in Hand** | Current available balance |

Quick actions: + Invoice, + Expense, + Payment In, View Reports.

---

## Invoicing

### Create an invoice

1. Tap **+ Create Invoice**.
2. Pick the **Customer**.
3. Add items: name, quantity, rate, GST rate (0–28%).
4. System calculates line totals and GST automatically.
5. Add notes and discount if needed.
6. Tap **Save & Send**.

### GST handling

- GST splits into CGST + SGST (same state) or IGST (different state) automatically.
- Your GSTIN and customer's GSTIN appear on the printed invoice.

### Share via WhatsApp

1. After saving, tap **Share → WhatsApp**.
2. PDF is generated and WhatsApp opens with customer's number.
3. Tap Send.

---

## Expenses

### Record an expense

1. Tap **+ New Expense**.
2. Enter amount, category, description.
3. Choose payment mode (Cash, UPI, Bank Transfer).
4. Attach receipt photo.
5. Tap **Save**.

---

## Reports

- **Profit & Loss** — weekly/monthly income vs expenses
- **GST Summary** — input/output GST for filing
- **Outstanding** — who owes you, who you owe
`,
  },
  {
    slug: "admin-settings",
    title: "Admin & Settings",
    icon: "⚙️",
    description: "Users, roles, modules, branding, feature flags",
    content: `# Chapter 10: Admin & Settings

> Set up your office — manage users, roles, modules, branding, and system configuration.

---

## Module Configuration

### Turn modules on or off

1. Open **Admin → Settings → Modules**.
2. Find the module you want to change.
3. Flip the toggle to On or Off.
4. Tap **Save Changes**.

> Turning a module off doesn't delete data — it just hides it. Turn it back on anytime.

---

## User Management

### Invite a new user

1. Tap **+ Invite User**.
2. Enter Name and Email.
3. Choose a Role: Admin, Officer, Clerk, or View Only.
4. Pick Department and Branch.
5. Tap **Send Invite**.

### Roles explained

| Role | What they can do |
|------|-----------------|
| **Admin** | Everything, including manage other users |
| **Officer** | Approve and manage within their modules |
| **Clerk** | Create and submit, but not approve |
| **View Only** | See data but not change anything |

### Deactivate a user

1. Open user profile.
2. Tap **Actions → Deactivate**.
3. Confirm. They can no longer sign in but records remain.

---

## Feature Flags

Control which new features are visible to users without deploying new code:
- Gradually roll out features to a percentage of users
- Quick kill switch for problematic features
- A/B testing new workflows

---

## Branding & Theme

1. Open **Admin → Settings → Branding**.
2. Upload your office logo.
3. Choose primary colour.
4. Set the display name.
5. Tap **Save**. All users see the updated branding.
`,
  },
  {
    slug: "mobile-app",
    title: "Mobile App",
    icon: "📱",
    description: "Install, offline mode, biometric, push notifications",
    content: `# Chapter 11: Mobile App

> CivitasOne in your pocket — attendance, approvals, bill tracking, stock scanning, and more.

---

## Installing the App

### Android

1. Open **Play Store**.
2. Search **CivitasOne**.
3. Tap **Install**.
4. Open the app.

### iPhone

1. Open **App Store**.
2. Search **CivitasOne**.
3. Tap **Get**.
4. Open the app.

> Requires Android 10+ or iOS 15+. Older phones can use the web browser.

---

## Signing In

1. Enter your Email and Password.
2. Tap **Sign In**.
3. Enter MFA code if required.

### Biometric lock

After first sign-in, enable fingerprint/Face ID for quick unlock. Your data stays encrypted via PKCE authentication.

---

## Offline Mode

When internet is lost, an orange bar appears: "You're offline — changes will sync when you're back online."

| Feature | Offline |
|---------|---------|
| Viewing recent data | ✅ Cached pages load |
| GPS attendance | ✅ Saved locally, syncs later |
| Stock scanner | ✅ Scans save locally |
| Approvals | ✅ Queued, sent when online |
| Creating new records | ✅ Saved in draft |

---

## Key Mobile Features

- **GPS Check-in** — Tap Check In, allow location, selfie, submit
- **Approve on the go** — Swipe to approve/reject from notifications
- **Stock Scanner** — Scan barcodes to receive or issue goods
- **Push Notifications** — Real-time alerts for approvals, SLA deadlines
- **Quick Actions** — Apply leave, view payslip, check budget from home screen
`,
  },
  {
    slug: "glossary",
    title: "Glossary",
    icon: "📖",
    description: "Every specialist term explained in plain language",
    content: `# Chapter 12: Glossary

> Every specialist term in CivitasOne, explained in one plain sentence.

---

## A

**Advance** — Money paid out before work is complete, to be adjusted later with a Utilisation Certificate.

**APAR** — Annual Performance Appraisal Report — the yearly assessment of a government officer's work.

**Approving Officer** — The person who checks and authorises a submission before it goes through.

**Asset Tag** — A barcode sticker placed on a physical item so the system can identify it.

**Audit Trail** — A complete record of who did what and when — kept automatically for every action.

## B

**Balance Sheet** — A report showing what your office owns (assets) and owes (liabilities).

**BE (Budget Estimate)** — The money planned for the year before any revision.

**Bill** — A document from a vendor requesting payment for goods or services delivered.

**Budget** — Money set aside for a purpose in a financial year, under a Head of Account.

## C

**CGST** — Central Goods and Services Tax — the central government's share of GST.

**Challan** — A deposit slip used to pay money into the government treasury.

**Chart of Accounts** — The complete list of account heads under which money is recorded.

## D

**DAK** — Incoming and outgoing post or correspondence.

**DBT** — Direct Benefit Transfer — money sent straight to a beneficiary's bank account.

**DDO** — Drawing and Disbursing Officer — the official who draws and pays out government money.

**Depreciation** — The yearly reduction in an asset's value as it ages.

## G

**GFR** — General Financial Rules — the government rules governing financial procedures.

**GRN** — Goods Received Note — confirmation that ordered goods were delivered.

**GST** — Goods and Services Tax — India's indirect tax on supply of goods and services.

## H

**HoA** — Head of Account — the classification code under which money is budgeted and spent.

## I

**IFSC** — Indian Financial System Code — identifies a bank branch for electronic transfers.

**IGST** — Integrated GST — applies to inter-state transactions.

## N

**NEFT** — National Electronic Funds Transfer — a bank-to-bank payment method.

**NPS** — National Pension System — the defined-contribution pension scheme.

## P

**PFMS** — Public Financial Management System — the government's online payment and tracking portal.

**PO** — Purchase Order — a formal order to a vendor to supply goods or services.

## R

**RE (Revised Estimate)** — The updated budget figure after mid-year revision.

**RTGS** — Real Time Gross Settlement — immediate high-value bank transfers.

**RTI** — Right to Information — a citizen's legal right to request government information.

## S

**Sanction** — Formal authorisation to spend money for a specific purpose.

**SGST** — State Goods and Services Tax — the state's share of GST.

**SLA** — Service Level Agreement — the promised time within which a request will be handled.

## T

**TDS** — Tax Deducted at Source — tax withheld from a payment before it reaches the payee.

**Tenant** — In CivitasOne, each office is a "tenant" — a completely separate space with its own data.

## U

**UC** — Utilisation Certificate — proof that advance money or grant money was used correctly.

**UTR** — Unique Transaction Reference — the bank's reference number for a payment.
`,
  },
];
