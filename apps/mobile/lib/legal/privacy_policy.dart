/// Privacy Policy for CivitasOne Suite Mobile Application.
/// Compliant with: DPDP Act 2023 (India), IT Act 2000, CERT-In guidelines.
const String privacyPolicyText = '''
PRIVACY POLICY — CivitasOne Suite

Last Updated: June 2026

1. INTRODUCTION

This Privacy Policy describes how your organization ("Data Fiduciary") collects, uses, stores, and protects your personal data through the CivitasOne Suite mobile application ("App"). CivitasOne is a platform provider — your employer is the data controller.

This policy complies with the Digital Personal Data Protection Act, 2023 (DPDP Act), Information Technology Act, 2000, and CERT-In security guidelines.

2. DATA WE COLLECT

2.1 Employee Data (provided by your organization):
• Full name, employee code, designation, department
• Email address, phone number
• Date of birth, gender, address
• Photograph (for ID card and profile)
• Bank account details (for payroll)
• PAN, Aadhaar (masked), PF number

2.2 Data Generated Through App Usage:
• Leave applications and approvals
• Attendance records (check-in time, GPS coordinates for geo-fenced attendance)
• Payslip views and downloads
• Grievances filed
• Travel requests and expense claims
• Goal progress and pulse survey responses
• Kudos/recognition given and received

2.3 Device & Technical Data:
• Device model, operating system version
• App version
• Device identifier (for session management)
• Root/jailbreak detection status
• Screen lock and biometric availability
• IP address at time of access

2.4 Biometric Data:
• Face verification data (processed on-device or via secure API, not stored in raw form)
• Fingerprint/face unlock (processed by device OS, never transmitted to server)

3. PURPOSE OF DATA PROCESSING

We process your data only for:
• Employee self-service (leave, payslip, profile management)
• Attendance and time tracking
• Payroll processing
• Organizational communication (announcements, social feed)
• Performance management (goals, appraisals)
• Security and access control (ID card verification, device trust)
• Compliance with statutory requirements (IT returns, PF, ESI)

4. LEGAL BASIS FOR PROCESSING

• Employment contract (legitimate purpose under DPDP Act Section 7)
• Statutory compliance (Income Tax Act, EPF Act, ESI Act)
• Legitimate interest of employer (attendance, security)
• Consent (for optional features like pulse surveys, social feed participation)

5. DATA STORAGE AND SECURITY

5.1 On-Device Storage:
• All local data is encrypted using AES-256 (SQLCipher)
• Encryption keys stored in iOS Keychain / Android Keystore (hardware-backed)
• Data wiped completely on logout
• Per-account database isolation (no cross-tenant data leakage)

5.2 Server Storage:
• Data stored in PostgreSQL with encryption at rest
• Tenant isolation enforced at database level (one DB per service)
• All data stored within India (no cross-border transfer)
• Access protected by role-based access control (RBAC)

5.3 In-Transit:
• All communication over HTTPS/TLS 1.3
• API authentication via PKCE OAuth 2.0 (no secrets on device)
• Device trust verification on every session

6. DATA RETENTION

• Active employee data: retained during employment + 8 years post-exit (per record retention rules)
• Attendance logs: 3 years
• Payroll records: 8 years (Income Tax Act requirement)
• Grievance records: 5 years post-resolution
• Device activity logs: 1 year
• Deleted on employee request (Right to Erasure) subject to statutory retention requirements

7. YOUR RIGHTS (DPDP Act)

Under the Digital Personal Data Protection Act, 2023, you have the right to:
• Access your personal data held by the organization
• Correct inaccurate data
• Erase data (subject to statutory retention periods)
• Withdraw consent for optional processing
• Nominate a person to exercise rights on your behalf
• Grievance redressal (within 30 days)

To exercise these rights, contact your organization's Data Protection Officer or file a request through the App's grievance module.

8. DATA SHARING

Your data is shared only with:
• Your employer (Data Fiduciary) — for HR and payroll purposes
• Statutory authorities — as required by law (IT dept, EPFO, ESIC)
• No data is sold to third parties
• No data is used for advertising
• No cross-border data transfer

9. CHILDREN'S DATA

This App is not intended for persons under 18 years of age. We do not knowingly collect data from minors.

10. COOKIES AND TRACKING

The mobile app does not use cookies. Analytics data (feature usage counts) is collected in aggregate form without personally identifying individual users.

11. CHANGES TO THIS POLICY

We may update this policy to reflect changes in law or functionality. Material changes will be notified via the App's notification system.

12. GRIEVANCE OFFICER

For privacy-related concerns:
• Use the in-app Grievance module
• Contact your organization's Data Protection Officer
• Email: privacy@civitasone.gov.in

13. GOVERNING LAW

This policy is governed by the laws of India, including the Digital Personal Data Protection Act, 2023, and the Information Technology Act, 2000.
''';
