# Chapter 7: Citizen Services & Helpdesk

> Handle requests from the public — RTI, grievances, service requests — and manage internal helpdesk tickets.

---

## Filing a Request (Citizen Side)

### What you'll see:

Citizens access the public portal (your office's website or the CivitasOne citizen portal). They see a clean landing page with three main options: **File RTI Request**, **Lodge Grievance**, and **Apply for Service**. Each has a simple form.

`[Screenshot: Citizen portal landing page with three request type cards]`

### RTI Request — step by step (from the citizen's view)

1. The citizen taps **File RTI Request**.
2. They fill in their **Name**, **Address**, **Phone**, and **Email**.
3. They type exactly what information they're asking for.
4. They choose the **Department** they think holds the information.
5. They pay the fee online (if applicable) or upload a fee receipt.
6. They tap **Submit**. A confirmation screen shows the **Application Number** and expected response date (30 days).

### Grievance — step by step

1. The citizen taps **Lodge Grievance**.
2. They fill in personal details.
3. They describe the **Complaint** — what happened, when, and where.
4. They choose the **Category** (water, roads, electricity, sanitation, etc.).
5. They can attach photos or documents as evidence.
6. They tap **Submit**. They receive an **Application Number** and SLA date.

### Service Request — step by step

1. The citizen taps **Apply for Service**.
2. They choose the **Service Type** from a catalogue (e.g. birth certificate, trade licence, NOC).
3. They fill in the application form specific to that service.
4. They upload required documents.
5. They pay any applicable fee.
6. They tap **Submit** and get a tracking number.

---

## Tracking Status (Citizen Side)

### What you'll see:

On the citizen portal, there's a **Track Your Request** section. The citizen enters their Application Number (or signs in to see all their requests).

`[Screenshot: Tracking page showing request timeline with status markers]`

### The timeline view

1. The citizen enters their **Application Number** and taps **Track**.
2. A vertical timeline appears showing every stage:
   - **Submitted** — date the request was received
   - **Assigned** — which section/officer is handling it
   - **In Progress** — work is being done
   - **Response/Decision** — the final outcome
3. Each stage shows the date it happened.
4. If the SLA deadline is approaching or passed, a warning appears.

### SLA (Service Level Agreement)

Each request type has a defined time limit:
- **RTI**: 30 days (45 days if transferred to another department)
- **Grievance**: As per office rules (commonly 15–30 days)
- **Service Request**: Varies by service type (shown at the time of application)

The citizen can see the SLA countdown on their tracking page. If the deadline passes without resolution, the request is automatically escalated.

---

## Handling Requests (Officer Side)

### What you'll see:

Open **Citizen Services** from the sidebar. You'll see all incoming requests assigned to your section: RTI, Grievances, and Service Requests in separate tabs. Each shows the application number, citizen name, subject, date received, SLA deadline, and status.

`[Screenshot: Officer view of citizen requests with SLA countdowns]`

### Process an RTI request

1. Open the RTI request from your queue.
2. Read what the citizen is asking for.
3. If you have the information, tap **Prepare Response** and type/attach the answer.
4. If another section should handle it, tap **Transfer** and select the right section (the 30-day clock resets to 45 days for the citizen).
5. Submit for PIO (Public Information Officer) approval.
6. Once approved, the response is sent to the citizen.

### Resolve a grievance

1. Open the grievance from your queue.
2. Read the complaint details and any attached evidence.
3. Investigate — you may need to coordinate with field staff or other sections.
4. Tap **+ Add Update** to record intermediate progress (the citizen sees these updates on their timeline).
5. When resolved, tap **Close** and type the resolution details.
6. The citizen is notified that their complaint is resolved.

### Process a service request

1. Open the service request.
2. Check the application and uploaded documents.
3. If documents are incomplete, tap **Request More Information** — the citizen gets a notification to upload the missing items.
4. If everything is in order, process the application per your department's rules.
5. Once done (certificate issued, licence granted, etc.), tap **Complete** and attach the output document.
6. The citizen can download their document from the portal.

---

## Helpdesk Tickets

### What you'll see:

Open **Helpdesk** from the sidebar. This is for internal support tickets (IT issues, facility problems, etc.) raised by staff. A table shows all tickets: ticket number, subject, raised by, priority (Low/Medium/High/Critical), assigned to, and status (Open, In Progress, Waiting, Resolved, Closed).

`[Screenshot: Helpdesk ticket list with priority colour coding]`

### Create a ticket

1. Tap **+ New Ticket**.
2. Enter a **Subject** (e.g. "Printer not working in Room 204").
3. Choose the **Category** (IT, Facilities, HR Query, Finance Query, etc.).
4. Set the **Priority**:
   - **Low** — can wait a few days
   - **Medium** — should be fixed this week
   - **High** — affecting work today
   - **Critical** — complete work stoppage
5. Describe the problem in the **Description** field.
6. Attach screenshots or photos if helpful.
7. Tap **Submit**. You'll get a ticket number and the ticket goes to the relevant support team.

### Assign a ticket (for support staff)

1. Open **Helpdesk → Unassigned** (or filter by your category).
2. Tap a ticket to read the details.
3. Tap **Assign to Me** (if you'll handle it) or **Assign To** → select a team member.
4. The ticket moves to **In Progress** and the raiser is notified.

### Escalate a ticket

1. Open the ticket.
2. If you can't resolve it at your level, tap **Escalate**.
3. Choose the escalation level (e.g. L2, Manager, External Vendor).
4. Add a note explaining why it needs escalation.
5. Tap **Send**. The ticket moves up and the new handler is notified.

### Resolve and close

1. Fix the issue.
2. Open the ticket and tap **Resolve**.
3. Add a **Resolution Note** — what was done to fix it.
4. Tap **Save**. The raiser gets a notification.
5. The raiser can **Confirm Resolution** (ticket closes) or **Re-open** if the problem isn't actually fixed.

---

## SLA Management

### What you'll see:

Open **Helpdesk → SLA Dashboard** (or **Citizen Services → SLA Overview**). A dashboard shows:
- Total requests/tickets by status
- SLA compliance percentage (what % were resolved within the time limit)
- Overdue items highlighted in red
- Average resolution time

`[Screenshot: SLA dashboard with compliance percentage and overdue count]`

### How SLA works

- Every request type and ticket priority has a defined resolution time.
- The system starts the clock when the request is received.
- If the deadline approaches (e.g. 80% of time used), the assigned person gets a warning notification.
- If the deadline passes, the item is auto-escalated to the next level and shows as **Overdue**.
- Managers can see SLA compliance reports for their team.

### Typical SLA times

| Type | Priority / Category | Target Time |
|------|-------------------|-------------|
| RTI | Standard | 30 days |
| Grievance | Standard | 15–30 days (office policy) |
| Service Request | Varies | Per published citizen charter |
| Helpdesk — Critical | Work stoppage | 4 hours |
| Helpdesk — High | Affecting work | 1 business day |
| Helpdesk — Medium | Inconvenient | 3 business days |
| Helpdesk — Low | Can wait | 5 business days |

> SLA times are configurable by your admin. The defaults above are starting points — your office may set different ones.

---

## Common Questions

**Q: A citizen says they didn't get a response, but we sent one.**
A: Open the request and check the **Activity Log**. It shows when the response was sent and to which email/phone. The citizen may need to check their spam folder.

**Q: A grievance was assigned to the wrong section.**
A: Open it and tap **Transfer** to move it to the correct section. Add a note explaining the transfer.

**Q: A helpdesk ticket has been open for weeks with no resolution.**
A: Check if it's been escalated. If not, tap **Escalate**. If it has, contact the escalation handler directly. The SLA dashboard will flag it as overdue.

**Q: Can citizens see who is handling their request?**
A: They see the **Section/Department** handling it, but not the individual officer's name (for privacy). They can see progress updates you add.

**Q: How do I set up SLA times for my office?**
A: Go to **Admin → Settings → SLA Configuration**. You can set resolution times for each request type and priority level.

**Q: A ticket was resolved but the person re-opened it. What now?**
A: The ticket goes back to **Open** status and the SLA clock restarts. Investigate again — if it's a different issue, ask the person to create a new ticket.

---

*End of Chapter 7 — Next: [Chapter 8: Stock & Assets](./08-STOCK-ASSETS.md)*
