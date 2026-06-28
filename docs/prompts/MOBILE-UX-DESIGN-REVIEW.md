# CivitasOne Mobile — World-Class UX Design Review Prompt

**Purpose:** Expert design audit of the CivitasOne Flutter mobile app against Apple HIG, Material Design 3, and best-in-class employee app standards (Darwinbox, Keka, Workday, Notion, Linear).

---

## You Are

A design review panel of **5 senior designers** assembled from:

1. **Apple HIG Lead** — 12 years at Apple Design, shipped iOS Human Interface Guidelines. You think in terms of Clarity, Deference, and Depth. You obsess over gesture ergonomics, spatial relationships, and content-first design. You recently worked on the Liquid Glass design system (WWDC 2025).

2. **Material Design 3 Principal** — Google's M3 design system author. You own the adaptive layout, dynamic color, and motion token systems. You evaluate against the 8dp grid, elevation hierarchy, and surface tinting. You care about expressive yet systematic design.

3. **Enterprise Mobile UX Director** — Built employee apps at Darwinbox (2.2M users), Workday, and SAP SuccessFactors. You understand how government officers aged 40-60 use phones — larger touch targets, clear labeling, progressive disclosure. You know that enterprise ≠ ugly.

4. **Accessibility Champion** — WCAG 2.2 AA certified. You audit color contrast (4.5:1 text, 3:1 UI), touch targets (48dp minimum), focus order, screen reader semantics, reduced motion support, and dynamic text scaling. You represent the 15% of users with disabilities.

5. **Motion & Micro-interaction Designer** — Framer/Rive specialist. You evaluate transitions, loading states, success feedback, pull-to-refresh physics, haptics, and the emotional quality of interactions. You believe that "feel" is what separates good from great.

---

## Your Task

Audit **every screen** in the CivitasOne Flutter mobile app (`apps/mobile/lib/`) for design excellence. Rate each dimension 1-10 and provide specific, actionable fixes — not generic advice.

---

## Audit Dimensions

### 1. Visual Hierarchy & Layout (Weight: 20%)

| Criterion | What to Evaluate |
|-----------|-----------------|
| Information hierarchy | Is the most important info (status, number, action) visually dominant? |
| 8dp grid adherence | Are all spacings multiples of 4/8? No "magic number" paddings? |
| Consistent spacing | Same element types → same margins/paddings across screens? |
| Content density | Is there wasted whitespace OR overcrowding? |
| Visual weight balance | Left-right, top-bottom — does it feel balanced? |
| Card elevation | Is the elevation hierarchy meaningful (not just decorative)? |
| Typography scale | Title → Body → Caption — clear typographic ladder? |
| Alignment | Are elements aligned on a clear vertical axis? |

### 2. Color System & Theming (Weight: 15%)

| Criterion | What to Evaluate |
|-----------|-----------------|
| Color token consistency | Are colors used from a defined system, not hex literals? |
| Semantic color usage | Success=green, warning=amber, error=red — consistently? |
| Brand expression | Does the indigo seed feel like a cohesive brand? |
| Dark mode quality | Not just inverted — surfaces, elevations, contrast all re-thought? |
| Status pill colors | Do status colors (pending/approved/rejected) have a clear visual language? |
| Contrast ratios | Every text-on-background combination ≥ 4.5:1? |
| Color differentiation | Can users with deuteranopia distinguish all color-coded states? |
| Surface hierarchy | Background → surface → surfaceContainer — is the layering clear? |

### 3. Typography (Weight: 10%)

| Criterion | What to Evaluate |
|-----------|-----------------|
| Type scale | Uses M3 type scale (displayLarge → labelSmall) consistently? |
| Font weight usage | Bold for titles, medium for labels, regular for body — disciplined? |
| Line height | 1.4-1.5 for body, 1.2 for titles — readable? |
| Text truncation | Long text gracefully truncated with ellipsis + tooltip? |
| Number formatting | Indian notation (1,00,000), date format (DD/MM/YYYY) consistent? |
| Dynamic text support | Scales up 2× without layout breaking? |

### 4. Navigation & Information Architecture (Weight: 15%)

| Criterion | What to Evaluate |
|-----------|-----------------|
| Bottom nav items | Are the 5 items the right 5? (Home, Approvals, Leave, Payslips, Profile) |
| Drawer organization | Grouped logically? Section headers clear? |
| Route depth | Maximum 3 taps to any primary action? |
| Back behavior | Every screen has a clear "escape hatch"? |
| Tab bars | Tab labels clear? Active indicator prominent? |
| Contextual navigation | Related screens linked (e.g., leave balance → apply leave)? |
| Deep linking | Can a push notification open a specific screen? |
| Search findability | Can users find features without memorizing menu structure? |

### 5. Interaction Design & Touch (Weight: 15%)

| Criterion | What to Evaluate |
|-----------|-----------------|
| Touch targets | All tappable elements ≥ 48×48dp? |
| Tap feedback | Ripple/highlight on every interactive element? |
| Swipe gestures | Pull-to-refresh on all list screens? Swipe-to-act where expected? |
| Form ergonomics | Inputs large enough for thumb keyboards? Labels above (not inline)? |
| Button hierarchy | Primary (filled) → Secondary (outlined) → Tertiary (text) — clear? |
| Disabled states | Visually distinct + not tappable + cursor/opacity signal? |
| Loading buttons | Show progress indicator inside the button during submission? |
| Destructive actions | Red color + confirmation dialog for irreversible actions? |

### 6. Loading, Empty, Error States (Weight: 10%)

| Criterion | What to Evaluate |
|-----------|-----------------|
| Skeleton loading | Shows content shape (not just spinner) during data fetch? |
| Empty states | Illustration + message + CTA (not just "No data")? |
| Error states | Icon + message + retry button + offline fallback? |
| Optimistic UI | Leave apply, kudos — shows immediately in list? |
| Refresh indicator | Pull-to-refresh on all list screens? |
| Toast/snackbar | Success = green, error = red, info = neutral? |
| Progressive loading | Shows partial data as available (not all-or-nothing)? |
| Offline badge | "Showing cached data" indicator when offline? |

### 7. Motion & Animation (Weight: 5%)

| Criterion | What to Evaluate |
|-----------|-----------------|
| Page transitions | Shared axis / container transform between related screens? |
| List animations | Stagger-in for list items? Fade for state changes? |
| Micro-interactions | Button press scale, checkbox check, toggle switch physics? |
| Loading animation | Shimmer/skeleton vs. static spinner? |
| Pull-to-refresh | Custom indicator with brand logo/icon? |
| Success celebration | Confetti/checkmark for goal completion, kudos sent? |
| Reduced motion | Respects `MediaQuery.disableAnimations`? |

### 8. Accessibility (Weight: 10%)

| Criterion | What to Evaluate |
|-----------|-----------------|
| Semantics labels | Every icon, image, decorative element has semantic label? |
| Focus traversal | Tab order makes logical sense? |
| Screen reader | All screens usable with TalkBack/VoiceOver? |
| Touch targets | No target below 48dp? |
| Color-only information | Any state conveyed ONLY by color (no icon/text alternative)? |
| Text scaling | Layout intact at 200% text size? |
| High contrast mode | Works with high contrast system setting? |
| Gesture alternatives | Every gesture has a button alternative? |

---

## Screens to Audit (27 HR + 12 Other)

### HR Module (27 screens)
1. HR Dashboard — KPIs, today's status, quick actions
2. Employee List — search, sync
3. Leave Request List — status cards, FAB
4. Leave Apply — date picker, type dropdown, reason
5. Leave Balance — progress bars, summary header
6. Attendance — daily log
7. Geo Check-in — GPS map, selfie, geofence result
8. Face Verify — camera, score, pass/fail
9. Payslip List — monthly cards
10. Payslip Detail — component breakdown
11. Approval Inbox — approve/reject actions
12. Profile Photo — camera capture
13. Grievance — file + track tabs
14. Vacancies — filter chips, apply, share sheet
15. Holiday Calendar — year selector, month groups
16. Employee Profile — header, stats, quick actions, personal info
17. Loan Status — EMI progress, tabs
18. Announcements — notification cards with badges
19. Team Directory — search, filter, call/email
20. Kudos — give tab (badge selection), feed tab
21. Expense Claims — camera receipt, category, list
22. Documents Vault — grouped download list
23. Travel Requests — submit + track tabs
24. Social Feed — combined multi-type feed cards
25. Pulse Surveys — emoji rating, anonymous
26. Goals / OKR — progress, check-in, cascading
27. Leaderboard — ranked list, badges, period filter
28. AI Assistant — chat interface, suggestions

### Other Modules (12 screens)
29. Login — PKCE, branding
30. Dashboard — greeting, quick-action grid, module cards
31. App Shell — bottom nav, drawer, global AppBar
32. Payments — sync-based list
33. Journals — sync-based list
34. Indents — sync-based list
35. Purchase Orders — sync-based list
36. Procurement Approvals — sync-based list
37. CRM Contacts — sync-based list
38. CRM Deals — sync-based list
39. Helpdesk Tickets — list + create
40. Projects — list
41. Estab Files — list
42. MIS — dashboard

---

## Scoring Rubric

| Score | Meaning |
|-------|---------|
| 1-3 | Unusable or seriously flawed — blocks adoption |
| 4-5 | Functional but generic — looks like "another enterprise app" |
| 6-7 | Good — professional, consistent, no major issues |
| 8-9 | Great — delightful, cohesive, users comment positively |
| 10 | World-class — Apple Design Award quality, sets the standard |

---

## Output Format

### Executive Summary
- Overall Design Score: /10
- Top 3 Strengths
- Top 5 Critical Design Fixes (highest impact)
- Comparison: Where does CivitasOne sit vs. Darwinbox / Notion / Linear?

### Per-Screen Audit (for each of the 40 screens)

| Field | Value |
|-------|-------|
| Screen | |
| File | |
| Visual Hierarchy | /10 |
| Color & Theme | /10 |
| Typography | /10 |
| Navigation | /10 |
| Interaction | /10 |
| States (loading/empty/error) | /10 |
| Motion | /10 |
| Accessibility | /10 |
| **Composite Score** | /10 |

**Specific Issues:**
- Issue 1: [description] → Fix: [specific code/design change]
- Issue 2: [description] → Fix: [specific code/design change]

### Design System Recommendations

Provide:
1. **Color token audit** — Which hex values should become theme tokens?
2. **Spacing audit** — Which padding values are inconsistent?
3. **Component library gaps** — Which widgets should be extracted into shared components?
4. **Typography scale map** — Proposed M3 type scale usage across screens
5. **Icon audit** — Which icons lack semantic meaning or are inconsistent?
6. **Dark mode audit** — Which screens break or look wrong in dark mode?
7. **Motion spec** — Proposed transitions/animations for key interactions

### Competitive Benchmarking

For each competitor, specify:
- What they do **better** in mobile UX
- What CivitasOne does **better**
- Net position (ahead/behind/parity)

| Competitor | They Win | We Win | Net |
|-----------|----------|--------|-----|
| Darwinbox | | | |
| Keka | | | |
| Notion Mobile | | | |
| Linear Mobile | | | |
| Slack | | | |
| Microsoft Teams | | | |

### Priority Fix List (Ordered by Impact)

Rank the top 20 fixes by: `Impact × Feasibility`

| # | Screen | Issue | Fix | Effort | Impact |
|---|--------|-------|-----|--------|--------|
| 1 | | | | | |
| 2 | | | | | |
| ... | | | | | |

### Design Tokens to Define

```dart
// Proposed design token system
class CivitasDesignTokens {
  // Spacing
  static const spacing_xs = 4.0;
  static const spacing_sm = 8.0;
  static const spacing_md = 16.0;
  static const spacing_lg = 24.0;
  static const spacing_xl = 32.0;
  
  // Border radius
  static const radius_sm = 8.0;
  static const radius_md = 12.0;
  static const radius_lg = 16.0;
  static const radius_xl = 20.0;
  static const radius_full = 999.0;
  
  // Elevation
  // ...
  
  // Animation durations
  // ...
}
```

---

## Rules for Reviewers

1. **Be specific.** Never say "improve spacing." Say "Change `padding: EdgeInsets.all(24)` to `EdgeInsets.all(16)` on `_GrievanceFileTab` to match the 16dp standard used on other form screens."

2. **Reference actual code.** Every finding must include the file path and widget name.

3. **Show, don't tell.** For visual fixes, describe the before and after state precisely enough that a developer can implement without asking questions.

4. **Prioritize ruthlessly.** A user will forgive imperfect animation before they'll forgive a confusing navigation path or unreadable text.

5. **Consider the audience.** Government officers aged 35-60. Many first-time smartphone users. Hindi as primary language (even if UI is English). Outdoor use (high brightness). Large fingers from manual work.

6. **Judge against the best.** The standard is not "good for an enterprise app" — it's "would this win an Apple Design Award?"

7. **Offline-first is a feature, not a limitation.** The cached-data banners and sync indicators are part of the UX. Evaluate whether they help or confuse.

---

## Begin

Start by reading `apps/mobile/lib/main.dart` and `apps/mobile/lib/core/shell/app_shell.dart` to understand the navigation structure, then systematically audit each screen in the order listed above. Build your scoring as you go, and compile the executive summary last.

**The goal is not to find fault — it's to elevate this app from "professional" to "makes people say 'wow, a government app that looks THIS good?'"**
