# Chapter 2: Finance

> Look after your office's money — budgets, bills, payments, and the official account books.

---

## Finance Dashboard

### What you'll see:

When you open **Finance** from the sidebar, the first screen is your Finance Dashboard. It shows a row of summary cards across the top and recent activity below.

`[Screenshot: Finance Dashboard with stat cards and recent transactions]`

### The stat cards explained:

| Card | What it tells you |
|------|------------------|
| **Total Budget** | The total money allocated to your office for this financial year |
| **Spent So Far** | How much has been paid out already |
| **Committed** | Money promised (sanctioned or ordered) but not yet paid |
| **Available Balance** | What's left to spend (Budget minus Spent minus Committed) |
| **Pending Bills** | Number of bills waiting for approval or payment |
| **This Month's Payments** | Total money paid out in the current month |

Below the cards you'll see:
- **Recent Transactions** — the last 10 entries in your books
- **Upcoming Due Dates** — bills or payments coming due soon
- **Quick Actions** — buttons to jump straight to common tasks

---

## Budget

### What you'll see:

Open **Finance → Budget**. You'll see a table of budget lines, each showing the Head of Account, the allocated amount, how much is used, and how much remains. A colour bar on each row shows utilisation at a glance (green = under 75%, amber = 75–90%, red = over 90%).

`[Screenshot: Budget list with Head of Account rows and utilisation bars]`

### Create a new budget allocation

1. Tap the **+ Create Budget** button at the top right.
2. Pick the **Financial Year** (e.g. 2025–26).
3. Choose the **Head of Account** from the dropdown.
4. Enter the **Budget Estimate (BE)** amount in rupees.
5. Optionally add a **Revised Estimate (RE)** if you already have one.
6. Tap **Save**. The new budget line appears in your list.

> The system keeps amounts in paise internally, but shows them in rupees with two decimal places. You always type in rupees.

### View budget utilisation

1. Open **Finance → Budget**.
2. Find the Head of Account you want to check.
3. Tap the row to open the detail view.
4. You'll see: **Allocated**, **Sanctioned**, **Spent**, **Committed**, and **Available**.

### Re-appropriate funds (move money between heads)

1. Open the budget line you want to move money *from*.
2. Tap **Re-appropriate** (at the top right of the detail view).
3. Choose the Head of Account to move money *to*.
4. Enter the amount to transfer.
5. Add a reason (this goes into the audit trail).
6. Tap **Submit for approval**. An approving officer must authorise the move.
7. Once approved, both budget lines update automatically.

---

## Sanctions

### What you'll see:

Open **Finance → Sanctions**. A table lists all sanction orders — each showing the purpose, amount, sanctioning authority, and current status (Draft, Pending Approval, Approved, Rejected).

`[Screenshot: Sanctions list with status badges]`

### Create a new sanction

1. Tap **+ Create Sanction**.
2. Enter the **Purpose** — a short description of what the money is for.
3. Choose the **Head of Account** it draws from.
4. Enter the **Sanction Amount** in rupees.
5. Attach any supporting documents (government order, letter, etc.).
6. Tap **Save as Draft** to save without submitting, or **Submit for Approval** to send it on.

### Submit for approval

1. Open the sanction (if it's in Draft status).
2. Review the details.
3. Tap **Submit for Approval**.
4. The sanction moves to the approving officer's queue. You'll see the status change to **Pending Approval**.

### Track sanction status

1. Open **Finance → Sanctions**.
2. Use the status filter at the top: **All**, **Draft**, **Pending**, **Approved**, **Rejected**.
3. Tap any row to see the full approval trail — who submitted, who approved, and when.

> Once a sanction is approved, its amount is "committed" against the budget. You'll see the Available Balance in the budget go down.

---

## Bills

### What you'll see:

Open **Finance → Bills**. A table shows all bills with columns for bill number, vendor, amount, date, and status (Draft, Submitted, Verified, Paid, Rejected).

`[Screenshot: Bills list with vendor names and status column]`

### Create a new bill

1. Tap the **+ Create Bill** button at the top right.
2. Choose the **Vendor** from your vendor list (or type a name to search).
3. Enter the **Bill Amount** and the vendor's bill/invoice number.
4. Pick the **Head of Account** the payment comes from.
5. Link it to a **Sanction** (so the system knows the spending is authorised).
6. Link it to a **Purchase Order** if there is one (this enables the 3-way match).
7. Attach the original bill document (scan or PDF).
8. Tap **Save** to keep it as a draft, or **Submit** to send it for verification.

### 3-way match (what it means)

Before a bill is paid, the system checks three things agree:
- The **Purchase Order** (what you ordered)
- The **GRN** — Goods Received Note (what was delivered)
- The **Bill** (what the vendor is charging)

If all three match, you'll see a green **✓ Matched** badge. If they don't match, you'll see a warning explaining the difference (e.g. "Billed quantity exceeds delivered quantity").

> You only see the 3-way match when the bill is linked to both a PO and a GRN. For bills without a purchase order (like utility bills), this step is skipped.

### Submit for payment

1. Open the bill.
2. Check that the status is **Verified** (an officer has reviewed it).
3. Tap **Submit for Payment**.
4. The bill enters the payment queue.

---

## Payments

### What you'll see:

Open **Finance → Payments**. A table shows all payment records: payee, amount, date, mode (NEFT/RTGS/cheque), status, and UTR number (once paid).

`[Screenshot: Payments list with UTR column]`

### Initiate a payment

1. Tap **+ Initiate Payment** (or open a verified bill and tap **Pay**).
2. Confirm the payee's bank details (account number, IFSC). These come from the vendor record.
3. Choose the payment mode: **NEFT**, **RTGS**, or **Cheque**.
4. Review the amount and deductions (TDS, GST TDS, etc. are calculated automatically).
5. Tap **Submit for Approval**.

### Approve a payment

1. Open **Finance → Payments** and filter by **Pending Approval**.
2. Open the payment you need to approve.
3. Review the details — amount, payee, linked bill, deductions.
4. Tap **Approve** (or **Reject** with a reason).
5. Once approved, the payment is released to the bank.

### Check the UTR (payment trace)

1. Open the payment record.
2. Once the bank processes it, the **UTR** (Unique Transaction Reference) appears in the record.
3. Share this number with the vendor if they ask "Where's my payment?"

> Payments to the bank happen in batches. There may be a short delay between approval and the UTR appearing.

---

## General Ledger

### What you'll see:

Open **Finance → General Ledger**. You'll see a list of journal entries — each showing the date, narration (description), debit account, credit account, and amount.

`[Screenshot: General Ledger entry list with debit/credit columns]`

### View entries

1. Open **Finance → General Ledger**.
2. Use the date filter to narrow down to a period.
3. Use the account filter to see entries for a specific Head of Account.
4. Tap any entry to see the full detail — both sides (debit and credit) and the source (which bill, payment, or receipt created it).

### Post a journal entry

1. Tap **+ Journal Entry**.
2. Enter the **Date** and a short **Narration** (what this entry is for).
3. Add the **Debit** line: pick the account and enter the amount.
4. Add the **Credit** line: pick the account and enter the same amount.
5. The total debits must equal total credits — the system won't let you save if they don't balance.
6. Tap **Post**. The entry is recorded and the ledger balances update.

> Most entries are created automatically (when bills are paid, receipts come in, etc.). You only post manual journal entries for adjustments or corrections.

### Reverse an entry

1. Open the journal entry you need to reverse.
2. Tap **Reverse**.
3. Add a reason for the reversal.
4. Tap **Confirm**. The system creates a new entry with the debits and credits swapped, cancelling out the original.

---

## Advances & Utilisation Certificates

### What you'll see:

Open **Finance → Advances & UCs**. Two tabs: **Advances** (money given out in advance) and **Utilisation Certificates** (proof that the advance was used correctly).

`[Screenshot: Advances tab showing outstanding advances with due dates]`

### Create an advance

1. Tap **+ Create Advance**.
2. Choose who the advance is for (employee, vendor, or grantee).
3. Enter the **Amount** and the **Purpose**.
4. Link it to a **Sanction** (authorising the spend).
5. Set the **Due Date** — when the UC or adjustment is expected.
6. Tap **Submit for Approval**.
7. Once approved and paid, the advance appears as outstanding until settled.

### Submit a Utilisation Certificate (UC)

1. Open the advance record, or go to the **UCs** tab and tap **+ Submit UC**.
2. Enter how the money was actually spent — itemised if possible.
3. Attach supporting documents (receipts, bills, completion certificates).
4. If there's any unspent balance, mention it — it will be returned.
5. Tap **Submit for Approval**.
6. Once the approver accepts the UC, the advance is marked as settled.

---

## Treasury

### What you'll see:

Open **Finance → Treasury**. Three sections: **Challans** (deposit slips), **Deposits**, and **Refunds**.

`[Screenshot: Treasury dashboard with challan list]`

### Create a challan

1. Tap **+ Create Challan**.
2. Enter the **Head of Account** money is being deposited under.
3. Enter the **Amount** and the **Depositor** name (who is paying in).
4. Choose the **Treasury / Bank** where the deposit will be made.
5. Tap **Generate**. The system creates a challan number.
6. Print the challan and take it to the bank/treasury with the payment.

### Record a deposit

1. Once the bank confirms the deposit, open the challan.
2. Tap **Mark as Deposited**.
3. Enter the bank's receipt number and date.
4. The amount is credited to the relevant head in your books.

### Process a refund

1. Open **Treasury → Refunds** and tap **+ Refund**.
2. Search for the original deposit/challan being refunded.
3. Enter the refund amount and reason.
4. Tap **Submit for Approval**.
5. Once approved, the refund is processed and a payment is initiated to the original depositor.

---

## GST

### What you'll see:

Open **Finance → GST**. Two main views: **Input GST** (tax you paid on purchases) and **Output GST** (tax you collected on services/receipts). A summary card shows the net position.

`[Screenshot: GST dashboard with Input and Output totals]`

### View input/output GST

1. Open the **Input GST** tab to see all GST paid on bills and purchases.
2. Open the **Output GST** tab to see GST collected.
3. Each row shows the invoice number, GSTIN of the other party, taxable amount, and GST components (CGST, SGST/UTGST, IGST).

### Reconcile GST

1. Tap the **Reconcile** button.
2. The system compares your records with the data from the GST portal (GSTR-2A/2B).
3. Matched entries show a green tick. Mismatches show in red with the difference highlighted.
4. For mismatches, you can: **Accept** (update your record), **Flag** (send for review), or **Ignore** (with a reason).
5. Once all entries are reviewed, tap **Mark as Reconciled** for the period.

---

## Reports

### What you'll see:

Open **Finance → Reports**. A menu of standard financial reports with buttons to generate each one.

`[Screenshot: Reports menu showing Trial Balance, Balance Sheet, Cash Flow, and others]`

### Trial Balance

1. Tap **Trial Balance**.
2. Pick the date range (e.g. 1 Apr 2025 to 31 Mar 2026).
3. Tap **Generate**. The report shows all accounts with their debit and credit totals.
4. The grand total of debits must equal the grand total of credits. If it doesn't, something needs correcting.

### Balance Sheet

1. Tap **Balance Sheet**.
2. Pick the date (usually the last day of the financial year).
3. Tap **Generate**. You'll see Assets on one side, Liabilities on the other. They must balance.

### Cash Flow Statement

1. Tap **Cash Flow**.
2. Pick the period.
3. Tap **Generate**. The report shows money coming in (receipts) and going out (payments), grouped by type.

> All reports can be downloaded as PDF or Excel. Tap the **Download** button at the top right of any generated report.

---

## Common Questions

**Q: A bill shows "Mismatch" in the 3-way match. What do I do?**
A: Open the bill and check the linked PO and GRN. Common causes: the vendor billed a different quantity or price. Correct the bill or raise it with the vendor.

**Q: I posted a wrong journal entry. Can I delete it?**
A: No — posted entries can't be deleted (that's an audit rule). Instead, use the **Reverse** button to create a correcting entry.

**Q: The budget shows "over-committed." What does that mean?**
A: More money has been sanctioned or ordered against that head than was allocated. You'll need a re-appropriation or supplementary budget before new spending can be approved.

**Q: How do I see who approved a payment?**
A: Open the payment record and scroll down to **Approval Trail**. It shows every person who touched it and when.

**Q: TDS is calculated wrong on a bill.**
A: Check the vendor's TDS category in their profile (Finance → Vendors → edit vendor). The rate comes from their category. Update it and the bill recalculates.

**Q: Where are my PFMS integration reports?**
A: Open **Finance → Reports → PFMS Reports**. These show payment data formatted for upload to the PFMS portal.

---

*End of Chapter 2 — Next: [Chapter 3: HR & Payroll](./03-HR-PAYROLL.md)*
