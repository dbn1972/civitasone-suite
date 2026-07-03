# Chapter 8: Stock & Assets

> Keep track of what your office owns and stores — goods in stock, furniture, equipment, vehicles, and buildings.

---

## Stock Management

### What you'll see:

Open **Stock** from the sidebar. The main screen shows your stock items in a searchable table: item name, category, current quantity, unit, reorder level, and location (store/branch). Items below their reorder level are highlighted in amber.

`[Screenshot: Stock list with quantity column and low-stock warnings]`

### Receive goods (via scanner or manual)

**Using the barcode scanner (recommended for large deliveries):**

1. Open the CivitasOne mobile app → **Stock Scanner**.
2. Tap **Receive Goods**.
3. Scan the barcode on each item (or on the delivery note if it has a combined barcode).
4. The app looks up the item and shows its name and description.
5. Enter the **Quantity** received.
6. Link it to the **GRN** or **Purchase Order** (search by PO number).
7. Tap **Confirm**. The stock quantity updates instantly.

**Manual entry (from the web):**

1. Open **Stock → Receive**.
2. Tap **+ Receive Stock**.
3. Search for the item by name or code.
4. Enter the **Quantity** received.
5. Link to the **PO/GRN** if applicable.
6. Enter the **Batch Number** and **Expiry Date** (if the item has them — e.g. stationery ink, medical supplies).
7. Tap **Save**. Stock levels update.

### Adjust stock quantity

If you find a difference during a physical check (items missing, damaged, or extra):

1. Open the item in the stock list.
2. Tap **Adjust Quantity**.
3. Choose the reason: **Physical Count Correction**, **Damaged**, **Expired**, **Transfer**, or **Other**.
4. Enter the **Adjusted Quantity** (the correct count after checking).
5. Add a **Remark** explaining the difference.
6. Tap **Submit for Approval** (stock adjustments need officer approval for audit purposes).
7. Once approved, the stock record updates.

### Check stock levels

1. Open **Stock** and browse the list, or use the **Search** bar.
2. Each item shows **Available**, **Reserved** (committed to a project or order), and **Total**.
3. Items below the **Reorder Level** show an amber **Low Stock** badge.
4. Tap an item to see its full history: every receipt, issue, adjustment, and current balance.

> You can set the reorder level for each item. When stock falls below it, the system sends a notification to the store keeper and can automatically generate a draft indent (if your office enables this).

---

## Assets

### What you'll see:

Open **Assets** from the sidebar. A register of all office assets: asset tag number, name, category (Furniture, IT Equipment, Vehicle, Building, Land, etc.), location, custodian, purchase value, current book value, and status (In Use, Under Repair, Disposed).

`[Screenshot: Asset register with categories and book value column]`

### Register a new asset

1. Tap **+ Register Asset**.
2. Enter the asset details:
   - **Asset Name** (e.g. "HP LaserJet Printer")
   - **Category** (IT Equipment, Furniture, Vehicle, etc.)
   - **Purchase Date** and **Purchase Value**
   - **Vendor** (where it was bought from)
   - **Location** (room/branch)
   - **Custodian** (person responsible for it)
3. The system generates an **Asset Tag Number** automatically.
4. If the item has a serial number, enter it in the **Serial Number** field.
5. Tap **Save**. The asset appears in your register.
6. Print the asset tag (a barcode label) and stick it on the physical item.

### Depreciate assets

Depreciation reduces an asset's value in the books each year (because things wear out).

1. Open **Assets → Depreciation**.
2. Tap **Run Depreciation** for the current year.
3. The system calculates the depreciation for each asset using the method set for its category (Straight Line or Written Down Value).
4. Review the results — each row shows the asset, opening value, depreciation amount, and closing book value.
5. Tap **Post to Accounts**. The depreciation entries go to the General Ledger.

> Depreciation usually runs once at the end of the financial year. Your admin sets the rates for each category (e.g. computers at 40%, furniture at 10%).

### Verify assets (physical verification)

1. Open **Assets → Verification**.
2. Tap **+ New Verification Drive**.
3. Choose what to verify: all assets, a specific location, or a category.
4. The system generates a checklist.
5. Visit each location and confirm:
   - Is the asset physically present? (**Found** / **Not Found**)
   - Is it in working condition? (**Working** / **Not Working** / **Damaged**)
6. For each asset, scan its barcode tag (on mobile) or tick it manually.
7. Tap **Complete Verification**.
8. The system flags discrepancies: missing items, items in wrong locations, etc.

### Dispose of an asset

1. Open the asset record.
2. Tap **Actions → Dispose**.
3. Choose the **Disposal Method**: Auction, Write Off, Transfer, Scrap.
4. Enter the **Disposal Date** and **Sale Value** (if auctioned — enter ₹0 for write-offs).
5. Add the **Reason** for disposal (obsolete, beyond repair, etc.).
6. Attach any documentation (condemnation report, auction record).
7. Tap **Submit for Approval**.
8. Once approved, the asset status changes to **Disposed** and its book value goes to zero.

---

## Barcode Scanning

### What you'll see:

On the CivitasOne mobile app, there's a **Scanner** option on the home screen (a barcode icon). When you tap it, your phone's camera opens with a scanning frame.

`[Screenshot: Mobile app scanner screen with camera viewfinder and scan frame]`

### How to use the mobile scanner

1. Open the CivitasOne app on your phone.
2. Tap the **Scanner** icon.
3. Point your camera at the barcode or QR code on the item/asset tag.
4. Hold steady — the app reads it automatically (you'll hear a beep or feel a vibration).
5. The item details appear on screen: name, category, location, custodian, and current status.
6. From here you can:
   - **Receive** — add incoming stock against a GRN.
   - **Issue** — record that you're giving the item to someone.
   - **Verify** — mark it as found during a verification drive.
   - **View History** — see all movements for this item.

### Tips for scanning

> Hold your phone about 15–20 cm from the barcode. Make sure there's enough light. If the sticker is damaged or faded, you can type the tag number manually instead.

### What barcodes are used for

- **Stock items** — each item type has a barcode. Scanning speeds up receipt and issue.
- **Asset tags** — each physical asset has a unique barcode label. Scanning identifies the exact asset.
- **GRN verification** — scan items as they arrive to cross-check against the purchase order.

---

## Common Questions

**Q: Stock shows a different quantity than what's physically in the store.**
A: Do a stock adjustment (Stock → item → Adjust Quantity). Choose "Physical Count Correction" and enter the correct number. This goes for approval and creates an audit record.

**Q: How do I move stock from one branch to another?**
A: Open the item → **Transfer**. Choose the destination branch and quantity. The sending branch's stock goes down and the receiving branch's stock goes up once they confirm receipt.

**Q: An asset tag fell off. How do I print a new one?**
A: Open the asset record → tap **Print Tag**. Stick the new barcode label on the item.

**Q: The depreciation amount looks wrong for an asset.**
A: Check the asset's category and the depreciation rate set for that category (Admin → Settings → Asset Categories). Also confirm the purchase value and date are correct.

**Q: We auctioned old furniture. Where do I record the sale amount?**
A: In the disposal process, choose "Auction" and enter the sale value. The system records the gain or loss and posts it to accounts.

**Q: Can I see all assets assigned to one person?**
A: Yes — open **Assets** and filter by **Custodian**. Or open the person's employee profile → **Assets** tab.

---

*End of Chapter 8 — Next: [Chapter 9: Small Business](./09-SMALL-BUSINESS.md)*
