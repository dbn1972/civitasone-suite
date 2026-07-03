# Chapter 11: Mobile App

> CivitasOne in your pocket — attendance, approvals, bill tracking, stock scanning, and more, right from your phone.

---

## Installing the App

### What you'll see:

The CivitasOne app is available on both Android and iOS. It looks like a blue shield icon with "C1" inside.

`[Screenshot: App icon in Google Play Store / Apple App Store]`

### On Android (Google Play Store)

1. Open the **Play Store** on your phone.
2. Search for **CivitasOne**.
3. Tap the app (blue shield icon, published by "CivitasOne Technologies").
4. Tap **Install**. Wait for the download to finish.
5. Tap **Open**. You'll see the sign-in screen.

### On iPhone (Apple App Store)

1. Open the **App Store** on your phone.
2. Search for **CivitasOne**.
3. Tap **Get** (or the download icon).
4. Authenticate with Face ID / Touch ID / Apple ID password.
5. Once installed, tap **Open**.

> The app needs Android 10+ or iOS 15+. If your phone is older, you can still use CivitasOne through your phone's web browser.

---

## Signing In

### What you'll see:

The sign-in screen shows the CivitasOne logo, an **Email** field, a **Password** field, and a **Sign In** button. There's also a "Forgot password?" link.

`[Screenshot: Mobile app sign-in screen]`

### Steps

1. Enter your **Email** (the same one you use on the web).
2. Enter your **Password**.
3. Tap **Sign In**.
4. If your office uses MFA (two-step verification), enter the code from your authenticator app.
5. You're in! The app remembers you until you sign out.

### Biometric lock

After your first successful sign-in, the app asks: "Would you like to use fingerprint/Face ID to unlock?"

1. Tap **Enable** (or skip if you prefer typing your password each time).
2. Next time you open the app, just use your fingerprint or face to unlock — no need to type your password again.

> Biometric lock doesn't replace your password — it's a convenience feature. Your data is still encrypted and secure (using PKCE authentication behind the scenes).

### What is PKCE?

You don't need to worry about the technical details, but in simple terms: PKCE is a secure way for the app to prove your identity to the server without ever storing your password on the phone. It keeps your account safe even if you lose your phone.

---

## Offline Mode

### What you'll see:

When your phone loses internet (no WiFi, no mobile data), you'll notice a small orange bar at the top of the app saying: **"You're offline — changes will sync when you're back online."**

`[Screenshot: App with offline indicator bar at the top]`

### What works offline

| Feature | Offline behaviour |
|---------|------------------|
| Viewing recent data | ✅ Cached pages load normally |
| GPS attendance (check-in) | ✅ Saved locally, syncs later |
| Stock scanner | ✅ Scans save locally, upload when online |
| Creating expenses | ✅ Saved as draft, syncs later |
| Approvals | ❌ Needs internet (because the server processes approvals) |
| Sending invoices | ❌ Needs internet |
| AI assistant | ❌ Needs internet |

### What happens when you come back online

1. The orange bar disappears.
2. Any actions you took offline (attendance, scans, expenses) sync automatically.
3. You'll see a brief notification: "3 items synced" (or however many).
4. If there was a conflict (e.g. someone else edited the same record while you were offline), you'll get a prompt to review.

> Don't worry about losing work — the app is designed to save everything locally and upload it when connectivity returns.

---

## GPS Attendance

### What you'll see:

On the app's home screen, there's a large **Check In** button (or **Check Out** if you've already checked in today). Below it, today's attendance status: time in, time out, and hours worked.

`[Screenshot: GPS attendance screen with Check In button and today's status]`

### Check in with selfie

1. Tap the **Check In** button.
2. The app asks for **Location Permission** (first time only). Tap **Allow**.
3. Your GPS location is captured. The app shows your location on a mini-map.
4. If your office has a geo-fence, the app checks you're within the boundary. If yes, you'll see a green tick.
5. The **camera** opens for a selfie. Look at the screen and tap the capture button.
6. The app verifies the selfie matches your profile photo (face verification).
7. Tap **Confirm Check In**.
8. You'll see: "Checked in at 9:15 AM" with your location noted.

### Check out

1. At the end of your day, open the app.
2. Tap **Check Out**. The same process: location + selfie.
3. You'll see: "Checked out at 5:45 PM. Hours worked: 8h 30m."

### What if I'm outside the geo-fence?

If you're on field duty or working from another location:
- The app shows an amber warning: "You're outside the office boundary."
- You can still check in, but it's marked as **"Field/WFH"** instead of "Office."
- Your supervisor may need to approve field check-ins (depends on your office's rules).

> If location isn't working, make sure Location Services are turned on in your phone's settings. The app needs "Precise" location, not "Approximate."

---

## Digital ID Card

### What you'll see:

Open the app → tap your profile photo (top right) → **My ID Card**. A digital version of your office identity card appears — with your photo, name, designation, office name, employee ID, and a QR code.

`[Screenshot: Digital ID card with QR code and NFC indicator]`

### Show your QR code

1. Open **My ID Card**.
2. The QR code is displayed at the bottom of the card.
3. A security guard or receptionist can scan it with their phone to verify your identity.
4. When scanned, it shows your name, designation, and that you're an active employee of your office.

### Share via NFC

If your phone supports NFC (most modern phones do):

1. Open **My ID Card**.
2. Tap **Share via NFC**.
3. Hold your phone near the receiving device (another phone or an NFC reader).
4. Your ID details transfer wirelessly.

> The digital ID doesn't replace your physical ID card — it's a convenient backup, especially useful for inter-office visits.

---

## Bill Tracker

### What you'll see:

Open the app → **Bills** (or search for "Bills" in the quick search). A list of your bills shows with the same info as the web: bill number, vendor, amount, status.

`[Screenshot: Mobile bill tracker with timeline view]`

### Search for a bill

1. Tap the **Search** icon at the top.
2. Type the bill number, vendor name, or amount.
3. Results filter as you type. Tap a bill to see details.

### Timeline view

1. Open a bill.
2. Tap the **Timeline** tab.
3. You'll see every step the bill has gone through:
   - Created (date, by whom)
   - Submitted for verification (date)
   - Verified (date, by whom)
   - Submitted for payment (date)
   - Paid (date, UTR number)
4. If the bill is stuck, you can see exactly where.

---

## Stock Scanner

### What you'll see:

Open the app → **Scanner** (barcode icon on the home screen). The camera opens with a scanning frame.

`[Screenshot: Stock scanner with camera viewfinder active]`

### Scan a barcode

1. Point your camera at the barcode (on the item or the delivery note).
2. Hold steady — the app reads it automatically (beep or vibration).
3. The item details appear: name, current stock, location.

### Goods receipt (via scanner)

1. Tap **Scanner → Receive Goods**.
2. Link to a **PO** (enter the PO number or scan the PO barcode).
3. Scan each item as it arrives.
4. Enter the quantity for each scanned item.
5. Tap **Complete Receipt**. Stock levels update.

### Quick stock adjustment

1. Tap **Scanner** → scan the item.
2. Tap **Adjust**.
3. Enter the new count and reason.
4. Tap **Submit**. Goes for approval.

---

## Small Business Mode (on Mobile)

### What you'll see:

If your office is in Small Business mode, the mobile app home screen shows the same quick actions as the web: **+ Invoice**, **+ Expense**, **+ Payment In**, plus your daily sales/expense summary.

`[Screenshot: Small business mobile home screen with daily summary]`

### Create an invoice from your phone

1. Tap **+ Invoice**.
2. Pick the customer (or add a new one).
3. Add items: name, quantity, rate, GST rate.
4. Tap **Save & Share**.
5. Choose how to share: WhatsApp, Email, or copy link.

### Record a payment received

1. Tap **+ Payment In**.
2. Pick customer, enter amount, choose mode (UPI/Cash/Transfer).
3. Tap **Save**. Done — takes seconds.

### Capture an expense on the go

1. Tap **+ Expense**.
2. Snap a photo of the receipt.
3. The app reads the amount and vendor (confirm or correct).
4. Pick the category.
5. Tap **Save**. Your expense log stays up to date even when you're running around.

---

## Common Questions

**Q: The app says "Session expired." What do I do?**
A: Just sign in again. Sessions expire after a period of inactivity for security. With biometric lock enabled, it's a quick fingerprint/face scan to get back in.

**Q: My selfie keeps getting rejected during attendance check-in.**
A: Make sure there's good lighting on your face. Remove sunglasses or a mask (if safe to do so). If your hairstyle or appearance has changed significantly, ask HR to update your profile photo.

**Q: I checked in but forgot to check out. What happens?**
A: The system may mark your checkout as missing. Apply for regularisation from the app (HR → Regularisation → request for that day).

**Q: The scanner can't read a barcode.**
A: Try cleaning the barcode sticker. Make sure the camera lens is clean. If the barcode is damaged, type the number manually using the keyboard icon in the scanner screen.

**Q: Can I use the app on a tablet?**
A: Yes! The app works on tablets (iPad or Android tablets) and adapts to the larger screen.

**Q: Offline changes aren't syncing after I got internet back.**
A: Force-close the app and re-open it. If still stuck, go to the app's Settings → **Force Sync**. This pushes any queued changes.

**Q: How much storage does the app use?**
A: The app itself is small (about 50 MB). Cached data varies — if you view a lot of documents, it may grow. You can clear the cache from Settings → **Clear Cache** without losing your account.

---

*End of Chapter 11 — Next: [Chapter 12: Glossary](./12-GLOSSARY.md)*
