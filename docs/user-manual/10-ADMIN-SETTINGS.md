# Chapter 10: Admin & Settings

> Set up your office — manage users, roles, modules, branding, and system configuration. This chapter is for office administrators.

---

## Module Configuration

### What you'll see:

Open **Admin → Settings → Modules**. A grid of module cards (Finance, HR, Procurement, Projects, Grants, Establishment, Citizen Services, Stock, Assets, Small Business, etc.), each with a toggle switch.

`[Screenshot: Module grid with toggle switches — some on, some off]`

### Turn modules on or off

1. Open **Admin → Settings → Modules**.
2. Find the module you want to change.
3. Flip the **toggle** to On (blue) or Off (grey).
4. Tap **Save Changes**.
5. The module appears or disappears from everyone's sidebar immediately.

> Turning a module off doesn't delete any data — it just hides it from the interface. You can turn it back on any time and everything will be there.

---

## User Management

### What you'll see:

Open **Admin → Users**. A table of all people in your office: name, email, role, department, status (Active, Invited, Deactivated), and last login date.

`[Screenshot: User list with role column and status badges]`

### Invite a new user

1. Tap **+ Invite User**.
2. Enter their **Name** and **Email** (official email).
3. Choose a **Role** from the dropdown:
   - **Admin** — can do everything, including manage other users
   - **Officer** — can approve and manage within their modules
   - **Clerk** — can create and submit, but not approve
   - **View Only** — can see data but not change anything
4. Pick their **Department** and **Branch** (if applicable).
5. Tap **Send Invite**. They'll get an email with a link to create their account.
6. Their status shows as **Invited** until they accept.

### Assign or change roles

1. Open the user's row in the user list.
2. Tap the **Role** dropdown.
3. Pick the new role.
4. Tap **Save**. Their permissions change immediately.

> Roles follow the "maker-checker" principle: one person submits, a different person approves. The system enforces this — you can't approve your own submissions.

### Deactivate a user

1. Open the user's profile.
2. Tap **Actions → Deactivate**.
3. Confirm. The person can no longer sign in, but their historical records remain intact.
4. To reactivate later: open their profile → **Actions → Reactivate**.

---

## Feature Flags

### What you'll see:

Open **Admin → Feature Flags**. A table showing all feature flags: name, status (Active/Inactive), rollout percentage, and description.

`[Screenshot: Feature flags list with rollout percentage sliders]`

### What are feature flags?

Feature flags let you control which new features are visible to users — without deploying new code. Useful for:
- Gradually rolling out a new feature to a small percentage of users first.
- Quickly turning off a problematic feature (kill switch).
- A/B testing a new workflow.

### Create a feature flag

1. Tap **+ Create Flag**.
2. Enter a **Name** (e.g. "new-leave-form").
3. Add a **Description** (what this feature does).
4. Set the **Rollout %** — what percentage of users should see it (0% = nobody, 100% = everyone).
5. Tap **Save**. The flag is created in "Inactive" state.
6. Tap **Activate** when you're ready to start the rollout.

### Kill switch (emergency off)

1. Open the feature flag.
2. Tap **Deactivate** (or set rollout to 0%).
3. The feature is hidden immediately for all users.

> Feature flags are meant for administrators only. Regular users don't see this section.

---

## Webhooks

### What you'll see:

Open **Admin → Webhooks**. A list of registered webhook URLs — each showing the URL, event type it listens to, status (Active/Failed), and last delivery time.

`[Screenshot: Webhook list with event type and delivery status]`

### What are webhooks?

Webhooks are notifications sent to an external system when something happens in CivitasOne (e.g. "a bill was approved" → notify your accounting software). This is for offices that connect CivitasOne to other tools.

### Register a webhook URL

1. Tap **+ Add Webhook**.
2. Enter the **URL** (the address of the system that should receive the notification).
3. Choose the **Event** that triggers it (e.g. "bill.approved", "payment.completed", "employee.created").
4. Optionally add a **Secret Key** (used to verify the notification is genuine).
5. Tap **Save**.

### Test a webhook

1. Open the webhook.
2. Tap **Send Test**. The system sends a sample notification to your URL.
3. Check whether your receiving system got it.
4. The result appears: **Success** (green) or **Failed** (red with error details).

### View delivery log

1. Open the webhook.
2. Tap the **Delivery Log** tab.
3. You'll see every notification sent: date/time, event, HTTP response code, and whether it succeeded.
4. Failed deliveries show the error. CivitasOne retries failed webhooks up to 3 times.

---

## Data Export

### What you'll see:

Open **Admin → Data Export**. A simple form to request a full export of your office's data.

`[Screenshot: Data export page with module selection and request button]`

### Request an export

1. Choose which **Modules** to include (or select "All").
2. Choose the **Format**: CSV (spreadsheets) or JSON (structured data).
3. Choose the **Date Range** (or "All Time").
4. Tap **Request Export**.
5. The system prepares the file in the background — this may take a few minutes for large offices.
6. You'll get a notification when it's ready.

### Download the export

1. Open **Admin → Data Export → My Exports**.
2. Find your export (shows status: Preparing, Ready, Expired).
3. Tap **Download**. The file downloads to your computer.
4. Export links expire after 7 days for security.

---

## Custom Domain

### What you'll see:

Open **Admin → Settings → Custom Domain**. A form showing your current domain (e.g. youroffice.civitasone.in) and an option to use your own.

`[Screenshot: Custom domain settings with DNS verification status]`

### Register your custom domain

1. Tap **Set Custom Domain**.
2. Enter your domain (e.g. erp.youroffice.gov.in).
3. The system shows you **DNS Records** you need to add:
   - A CNAME record pointing to CivitasOne's servers.
   - A TXT record for verification.
4. Go to your domain registrar (where you bought the domain) and add these records.
5. Come back and tap **Verify DNS**. The system checks if the records are set correctly.
6. Once verified, the system provisions an **SSL certificate** (takes a few minutes).
7. Status changes to **Active**. Your team can now access CivitasOne at your custom domain.

---

## Scheduled Jobs

### What you'll see:

Open **Admin → Scheduled Jobs**. A list of automated tasks that run on a schedule (e.g. "Send leave balance reminder every Monday", "Run depreciation on March 31").

`[Screenshot: Scheduled jobs list with next run time and status]`

### Create a scheduled job

1. Tap **+ New Job**.
2. Choose the **Action** from the list (e.g. "Send Reminder", "Generate Report", "Run Payroll Summary").
3. Set the **Schedule**: Daily, Weekly (pick day), Monthly (pick date), or Yearly (pick date).
4. Set the **Time** it should run.
5. Add **Recipients** (who gets the result or notification).
6. Tap **Save**. The job appears in the list with its next scheduled run.

### Pause or resume a job

1. Open the job.
2. Tap **Pause**. The job won't run until you resume it.
3. To restart, tap **Resume**.

### View job history

1. Open the job.
2. Tap the **History** tab.
3. Each past run shows: date/time, result (Success/Failed), and any output or error message.

---

## Usage & Quotas

### What you'll see:

Open **Admin → Usage & Quotas**. A dashboard showing how much of your plan you're using: number of users, storage space, API calls, and SMS/email notifications.

`[Screenshot: Usage dashboard with progress bars for each quota]`

### Monitor usage

| Metric | What it means |
|--------|--------------|
| **Users** | Active user accounts vs. your plan limit |
| **Storage** | Documents and attachments uploaded vs. storage limit |
| **API Calls** | Requests to CivitasOne from external systems (webhooks, integrations) |
| **Notifications** | Email and SMS sent this month vs. monthly limit |

### Upgrade

If you're approaching a limit, a banner appears: "You're using 90% of your user quota." Tap **Upgrade** to see available plans and request an increase.

---

## Branding

### What you'll see:

Open **Admin → Settings → Branding**. A form where you can customise how CivitasOne looks for your office.

`[Screenshot: Branding settings with logo upload and colour picker]`

### Customise your office's look

1. **Logo** — Tap **Upload Logo** and choose your office emblem or logo (PNG or SVG, max 2 MB). It appears on the login page, sidebar, and printed documents.
2. **Primary Colour** — Pick a colour using the colour picker (or enter a hex code like #1a5276). This changes buttons, links, and highlights across the interface.
3. **Secondary Colour** — An accent colour for less prominent elements.
4. **Email From Address** — Set the "From" name and email for notifications (e.g. "Office of the Commissioner <noreply@youroffice.gov.in>").
5. Tap **Save**. Changes apply immediately across the system.

> Branding changes are cosmetic — they don't affect how the system works, just how it looks.

---

## Common Questions

**Q: I invited someone but they say they didn't get the email.**
A: Check the email address is correct (Admin → Users → check their entry). If correct, ask them to check their spam folder. You can also tap **Resend Invite**.

**Q: A user left the office. Should I delete their account?**
A: No — deactivate, don't delete. Deactivation stops their access but keeps all their records (files they created, approvals they gave). This is important for audit.

**Q: I turned off a module by mistake. Is the data lost?**
A: No. Turning a module off just hides it. Turn it back on and all data is intact.

**Q: What happens if we exceed our user quota?**
A: You won't be able to invite new users until you upgrade your plan or deactivate existing users.

**Q: Can I have different branding for different branches?**
A: Currently, branding is office-wide (one look for everyone). If your branches need distinct identities, set them up as separate tenants.

**Q: The webhook keeps failing. How do I troubleshoot?**
A: Open the webhook → Delivery Log. Check the error code. Common issues: the receiving URL is down (503), wrong secret key (401), or the URL changed (404). Fix the issue on the receiving end and tap **Retry Failed**.

---

*End of Chapter 10 — Next: [Chapter 11: Mobile App](./11-MOBILE-APP.md)*
