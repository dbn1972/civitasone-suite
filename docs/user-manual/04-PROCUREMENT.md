# Chapter 4: Procurement

> Buy goods and services the right way — from a request to choosing a supplier to receiving the delivery.

---

## Indents (Purchase Requests)

### What you'll see:

Open **Procurement → Indents**. A table lists all purchase requests with columns for indent number, date, requested by, items summary, estimated cost, and status (Draft, Pending Approval, Approved, Converted to PO, Rejected).

`[Screenshot: Indents list with status filters at the top]`

### Create an indent

1. Tap the **+ Create Indent** button at the top right.
2. Enter a short **Description** of what you need and why.
3. Add items:
   - Tap **+ Add Item**.
   - Type the **Item Name** (or search from the catalogue).
   - Enter the **Quantity** and **Unit** (e.g. 50 Nos., 10 Reams).
   - Enter the **Estimated Unit Price** (if you know it).
   - Repeat for each item you need.
4. Pick the **Required By Date**.
5. Choose the **Head of Account** the money will come from.
6. Tap **Save as Draft** to review later, or **Submit for Approval** to send it on.

### Approve an indent (for approving officers)

1. Open **Procurement → Indents → Pending Approval**.
2. Tap the indent to review — check items, quantities, and estimated cost.
3. Confirm the budget is available (the system shows the available balance for the chosen Head of Account).
4. Tap **Approve** (or **Reject** with a reason).
5. You'll see a confirmation: "Indent approved."

### Convert an indent to a Purchase Order

1. Open an approved indent.
2. Tap **Convert to PO** at the top right.
3. The system pre-fills a Purchase Order with the items from the indent.
4. Select the **Vendor** and confirm prices.
5. Complete and submit the PO (see the Purchase Orders section below).

---

## Vendors

### What you'll see:

Open **Procurement → Vendors**. A directory of all vendors (suppliers) your office works with. Each row shows the vendor name, GSTIN, category, empanelment status, and rating.

`[Screenshot: Vendor directory with search and category filter]`

### Empanel a new vendor

1. Tap **+ Add Vendor**.
2. Fill in the vendor's details:
   - **Business Name** and **Contact Person**
   - **GSTIN** (if registered for GST)
   - **PAN** number
   - **Address**, **Phone**, **Email**
   - **Bank Account** details (account number, IFSC, bank name)
   - **Category** (e.g. Stationery, IT Equipment, Civil Works)
3. Attach supporting documents (registration certificate, PAN card copy).
4. Tap **Submit for Empanelment**.
5. An officer reviews and approves. Once approved, the vendor can be used in purchase orders.

### Rate a vendor

1. Open the vendor's profile.
2. Tap the **Ratings** tab.
3. Tap **+ Add Rating**.
4. Score them on: **Delivery Timeliness**, **Quality**, **Communication** (1–5 stars each).
5. Add a short comment if you like.
6. Tap **Save**. The average rating shows on their profile.

### Blacklist a vendor

1. Open the vendor's profile.
2. Tap **Actions → Blacklist**.
3. Enter the **Reason** (e.g. fraud, repeated non-delivery) and attach evidence.
4. Pick the **Blacklist Duration** (temporary or permanent).
5. Tap **Submit for Approval**.
6. Once approved, the vendor cannot be selected for new POs. Their profile shows a red **Blacklisted** badge.

> Blacklisting is a serious action with an audit trail. Only authorised officers can approve it.

---

## Purchase Orders

### What you'll see:

Open **Procurement → Purchase Orders**. A table shows all POs with: PO number, vendor, total amount, delivery date, and status (Draft, Issued, Partially Delivered, Fully Delivered, Closed, Cancelled).

`[Screenshot: Purchase Orders list with delivery status column]`

### Create a Purchase Order

1. Tap **+ Create PO** (or convert from an approved indent).
2. Select the **Vendor** from the empanelled list.
3. Add line items:
   - **Item Name**, **Quantity**, **Unit Price**, **GST Rate**.
   - The system calculates the line total and taxes automatically.
4. Set the **Delivery Date** and **Delivery Address**.
5. Add **Terms & Conditions** (or use your office's standard template).
6. Review the **Total Amount** (base + GST).
7. Tap **Submit for Approval**.
8. Once approved, tap **Issue PO** to send it to the vendor.

### Dispatch and track

1. Open the issued PO.
2. If the vendor sends dispatch details, tap **Record Dispatch**.
3. Enter the **Dispatch Date**, **Courier/Transporter**, and **Tracking Number** (if any).
4. The PO status changes to **In Transit**.
5. Check back for delivery — or proceed to GRN when goods arrive.

---

## GRN (Goods Received Note)

### What you'll see:

Open **Procurement → GRN** (or open a PO and tap **Receive Goods**). A form shows the expected items from the PO and fields to record what actually arrived.

`[Screenshot: GRN form with expected vs received quantities]`

### Receive goods

1. Open the PO the delivery is against.
2. Tap **+ Create GRN**.
3. For each item:
   - Enter the **Received Quantity**.
   - If it matches the ordered quantity, move on.
   - If less arrived, the difference is noted as short.
4. Enter the **Challan/Invoice Number** from the delivery note.
5. Tap **Save**.

### Inspect and accept/reject

1. Open the GRN.
2. For each item, mark the **Inspection Result**: **Accepted**, **Partially Accepted**, or **Rejected**.
3. For rejected items, add a **Reason** (damaged, wrong specification, etc.).
4. Tap **Complete Inspection**.
5. Accepted quantities are added to your stock. Rejected items trigger a return or credit note.

> The GRN feeds into the 3-way match (see Finance → Bills). When you create a bill against this PO, the system checks that the billed quantity doesn't exceed the accepted GRN quantity.

---

## Tenders

### What you'll see:

Open **Procurement → Tenders**. A list of all tender processes: tender number, title, type (Open/Limited/Single), last date, and status (Draft, Published, Under Evaluation, Awarded, Cancelled).

`[Screenshot: Tenders list with type and status columns]`

### Publish a tender

1. Tap **+ Create Tender**.
2. Enter the **Title** and **Description** of what you're procuring.
3. Choose the **Tender Type**:
   - **Open** — any qualified vendor can bid
   - **Limited** — only invited vendors
   - **Single** — directed to one vendor (with justification)
4. Set the **Estimated Value**.
5. Set dates: **Published Date**, **Last Date for Queries**, **Last Date for Submission**, **Opening Date**.
6. Add the **Tender Documents** (scope of work, technical specs, terms).
7. Set the **EMD Amount** (Earnest Money Deposit) if required.
8. Tap **Publish**. The tender appears on your public tender portal.

### Evaluate bids

1. After the submission deadline, open the tender.
2. Tap **Open Technical Bids**. You'll see each vendor's technical submission.
3. Use the evaluation criteria to score each bid.
4. Mark bids as **Technically Qualified** or **Not Qualified**.
5. For qualified bidders, tap **Open Financial Bids**.
6. Compare prices. The system can rank them automatically (L1, L2, L3…).
7. Record your evaluation in the **Evaluation Sheet**.

### Award the tender

1. After evaluation, tap **Award Tender**.
2. Select the winning bidder (usually L1 — the lowest qualifying bid).
3. Enter any negotiated terms.
4. Tap **Issue Award Letter**. The vendor and other bidders are notified.
5. The tender status changes to **Awarded**.
6. You can now create a Purchase Order against this awarded tender.

---

## Common Questions

**Q: Can I edit an indent after it's approved?**
A: No — once approved, an indent is locked. If you need changes, you can cancel it (with reason) and create a new one.

**Q: A vendor says they weren't empanelled. How do I check?**
A: Go to **Procurement → Vendors** and search their name. If they're not in the list, they need to be added through the empanelment process.

**Q: The PO total doesn't match what I expected.**
A: Check the GST rate on each line item. The system adds GST to the base price. Also check for any TDS deductions applied.

**Q: Goods arrived but some are damaged. What do I do?**
A: Create the GRN, enter the full received quantity, then in the inspection step mark the damaged items as **Rejected** with a reason. This creates a record for follow-up with the vendor.

**Q: How do I know if a tender got enough bids?**
A: Open the tender after the submission deadline. The system shows the number of bids received. Your office rules determine the minimum number required.

**Q: Can I cancel a published tender?**
A: Yes — tap **Cancel Tender**, enter a reason, and submit for approval. A cancellation notice is sent to all bidders.

---

*End of Chapter 4 — Next: [Chapter 5: Projects & Grants](./05-PROJECTS-GRANTS.md)*
