# Chapter 9: Small Business

> Run your small office or MSME with simple tools — invoices, payments, expenses, and customer records. No accounting degree needed.

---

## Dashboard

### What you'll see:

When you sign into CivitasOne in Small Business mode, the first screen is your **Business Dashboard**. It's designed to show you the health of your business at a glance — no clutter, just the numbers that matter today.

`[Screenshot: Small Business dashboard with daily P&L cards and quick action buttons]`

### What the dashboard shows:

| Card | What it means |
|------|--------------|
| **Today's Sales** | Total of invoices created today |
| **Today's Expenses** | Total expenses recorded today |
| **Today's Profit/Loss** | Sales minus Expenses for today |
| **Outstanding Receivable** | Money customers owe you (unpaid invoices) |
| **Outstanding Payable** | Money you owe suppliers (unpaid bills) |
| **Cash in Hand** | Your current available balance |

### Quick actions (buttons below the cards):

- **+ Invoice** — create a new invoice fast
- **+ Expense** — record a payment you made
- **+ Payment In** — record money received
- **View Reports** — see weekly/monthly summaries

---

## Invoicing

### What you'll see:

Tap **Invoices** in the sidebar (or the **+ Invoice** quick action). You'll see a list of all your invoices — showing invoice number, customer name, date, amount, and status (Draft, Sent, Paid, Overdue).

`[Screenshot: Invoice list with status badges and overdue highlighted in red]`

### Create an invoice

1. Tap **+ Create Invoice**.
2. Pick the **Customer** from your list (or tap **+ New Customer** to add one on the spot).
3. Add items:
   - Tap **+ Add Item**.
   - Type the **Item/Service Name** (or pick from your saved items).
   - Enter the **Quantity** and **Rate** (price per unit).
   - Choose the **GST Rate** (0%, 5%, 12%, 18%, 28% — or Exempt).
   - The system calculates the line total and GST automatically.
   - Repeat for each item/service.
4. The **Total** updates at the bottom: Subtotal + GST = Grand Total.
5. Add optional fields: **Notes** (e.g. "Payment due within 15 days"), **Discount** (flat or percentage).
6. Tap **Save as Draft** to review later, or **Save & Send** to send it immediately.

### Add GST to items

- When adding an item, the **GST Rate** dropdown lets you pick the applicable rate.
- The invoice splits GST into **CGST + SGST** (same state) or **IGST** (different state) automatically, based on your and the customer's state.
- Your GSTIN and the customer's GSTIN appear on the printed invoice.
- If you're not registered for GST, choose "Exempt" and no tax lines appear.

### Share an invoice via WhatsApp

1. After saving the invoice, tap **Share**.
2. Choose **WhatsApp**.
3. The system generates a PDF and opens WhatsApp with the customer's number pre-filled and the PDF attached.
4. Tap **Send** in WhatsApp.

> You can also share via **Email**, **SMS (link)**, or **Copy Link**. The link lets the customer view the invoice online and pay (if you have online payments enabled).

---

## Payments

### What you'll see:

Open **Payments**. Two tabs: **Received** (money in) and **Paid** (money out). Each entry shows the date, party name, amount, mode (Cash/UPI/Bank Transfer/Cheque), and linked invoice or expense.

`[Screenshot: Payments list with Received and Paid tabs]`

### Record a payment received

1. Tap **+ Payment In** (or open an invoice and tap **Record Payment**).
2. Pick the **Customer**.
3. Enter the **Amount** received.
4. Choose the **Mode**: Cash, UPI, Bank Transfer, Cheque.
5. Enter the **Date** (defaults to today).
6. Link it to an **Invoice** (optional but recommended — it marks the invoice as Paid).
7. Add a **Reference** (e.g. UPI transaction ID or cheque number).
8. Tap **Save**. The payment appears in your records and the customer's balance updates.

### Record a payment made

1. Tap **+ Payment Out**.
2. Pick the **Vendor/Supplier** (or type a name).
3. Enter the **Amount** paid.
4. Choose the **Mode**: Cash, UPI, Bank Transfer, Cheque.
5. Enter the **Date**.
6. Link it to an **Expense** or **Purchase Bill** if applicable.
7. Add a **Reference**.
8. Tap **Save**.

### Timeline view

1. Open **Payments → Timeline**.
2. You'll see a day-by-day view of all money in and money out — like a simple bank statement.
3. Green rows are money received. Red rows are money paid.
4. The running balance shows at the end of each day.
5. Filter by date range, customer, or vendor.

---

## Expenses

### What you'll see:

Open **Expenses**. A list of all business expenses — date, category, description, amount, and mode of payment. A monthly total appears at the top.

`[Screenshot: Expenses list with category tags and monthly total card]`

### Capture a receipt

1. Tap **+ Add Expense**.
2. Tap **Snap Receipt** (on mobile) to take a photo of the bill/receipt.
   - The system reads the amount and vendor name automatically (if the receipt is clear enough).
   - Confirm or correct the auto-filled details.
3. Or enter manually: **Amount**, **Vendor/Description**, **Date**.
4. Choose a **Category**: Rent, Utilities, Travel, Materials, Salary, Marketing, Miscellaneous, etc.
5. Pick the **Payment Mode**: Cash, UPI, Bank Transfer, Cheque.
6. Tap **Save**. The expense is recorded and the receipt photo is attached.

### Categorise expenses

- Every expense has a **Category**. This helps you see where your money goes.
- You can create custom categories in **Settings → Expense Categories**.
- When viewing expenses, filter by category to see, for example, all travel costs this month.

### Monthly view

1. Open **Expenses → Monthly Summary**.
2. A bar chart shows spending per category for the current month.
3. Below it, a table lists the top categories by amount.
4. Tap any category to drill down to the individual expenses.
5. Use the month picker at the top to view previous months.

---

## Customers

### What you'll see:

Open **Customers**. A directory of everyone you sell to — showing name, phone, outstanding balance, and last transaction date.

`[Screenshot: Customer list with outstanding balance column]`

### Add a new customer

1. Tap **+ Add Customer**.
2. Enter the **Name** (person or business).
3. Add **Phone** and **Email** (at least one is required for sending invoices).
4. Enter **Address** (used on invoices).
5. Add **GSTIN** (if they have one — this affects whether IGST or CGST/SGST applies).
6. Pick the **State** (important for GST).
7. Tap **Save**.

### View a customer's ledger

1. Open the customer's profile.
2. Tap the **Ledger** tab.
3. You'll see a complete history: every invoice, payment, and credit note — in chronological order.
4. The **Running Balance** column shows what they owed at each point.
5. The current **Outstanding Balance** is shown prominently at the top.

### Check outstanding balance

1. Open **Customers** and sort by **Outstanding** (descending).
2. The top of the list shows customers who owe you the most.
3. Tap a customer to see their unpaid invoices.
4. From there, you can tap **Send Reminder** to nudge them about overdue payments.

> The reminder goes as a WhatsApp message or SMS with a polite note and the amount due.

---

## Common Questions

**Q: I made a mistake on an invoice I already sent. Can I edit it?**
A: If it's not yet paid, you can open it and tap **Edit**. If it's already paid or if it has a GST filing, create a **Credit Note** instead (Invoice → Create Credit Note).

**Q: How do I see my profit for the month?**
A: Open the Dashboard — the **Monthly Summary** shows total sales, total expenses, and the difference (profit or loss). For a detailed view, tap **View Reports → Profit & Loss**.

**Q: I accept payments via UPI. Does CivitasOne track those?**
A: Yes — when recording a payment, choose "UPI" as the mode and enter the UPI transaction ID. The system doesn't connect to your bank automatically, so you record payments as they come in.

**Q: Can I use this for multiple businesses?**
A: Each business is a separate "tenant" (workspace). You can switch between them from the top bar → **Switch Organisation**.

**Q: I'm not registered for GST. Can I still use invoicing?**
A: Absolutely. When creating invoices, choose "Exempt" for the GST rate. No tax lines will appear on your invoices.

**Q: How do I see what a specific customer owes me?**
A: Open their profile → **Ledger** tab. The outstanding balance is shown at the top. You can also filter the Invoices list by that customer and look for unpaid ones.

---

*End of Chapter 9 — Next: [Chapter 10: Admin & Settings](./10-ADMIN-SETTINGS.md)*
