# Workflow Prompt — Build Screen (Next.js)

**Use when:** Implementing an approved Figma Make screen in `apps/web`.

---

## Fill these placeholders

```
SCREEN NAME: {{screen-name}}
ROUTE: {{/path}}
ROUTE GROUP: {{(app) | (public) | (auth)}}
FIGMA FRAME: {{link}}
FIGMA PROMPT FILE: figma-prompts/{{module}}/{{file}}.md
ISSUE: {{GitHub issue link}}

PRIMARY ROLE: {{from Vol 1 role matrix}}
PERMISSION KEY required to view: {{e.g. finance.journal.read}}

UI-KIT COMPONENTS USED: {{list}}
NEW UI-KIT COMPONENTS NEEDED: {{list — if any, open ui-kit PR FIRST}}

SERVICE ENDPOINTS CALLED:
- GET  {{path}} via {{service-name}} — for {{purpose}}
- POST {{path}} via {{service-name}} — for {{purpose}}

SERVER COMPONENTS vs CLIENT COMPONENTS:
- Server (default): {{data fetching, initial render, SEO}}
- Client (only where needed): {{interactivity — forms, drag-drop, real-time}}

DATA FETCHING:
- Initial load: server component fetches via service API with JWT from cookie
- Mutations: server action calls service API, then revalidatePath
- Real-time updates (if any): SSE / WebSocket — describe

STATES TO IMPLEMENT (all required):
- default
- loading (Suspense boundary with Skeleton)
- empty (EmptyState component slot)
- error (ErrorState with correlation ID)
- success (Toast or Banner)
- permission-denied (if user lacks role)

A11Y CHECKS:
- All interactive elements keyboard reachable
- Focus order matches visual order
- Live regions for dynamic updates
- ARIA labels on icon-only buttons
- axe-core passes with 0 violations on this route

I18N:
- All strings via next-intl using key namespace {{module}}.{{screen}}.*
- Date/money/number formatting via tenant locale

THEMING:
- Uses tokens only — no hex literals
- Tenant brand color overridable via CSS custom properties

TESTS (Playwright):
- Happy path: load screen with seeded tenant, perform primary action, verify outcome
- Empty state: load with no data
- Error state: mock API failure, verify ErrorState shows correlation ID
- Permission denied: load with role lacking permission
- A11y: run axe-core check
- Mobile (375px): primary flow works on mobile viewport
```

---

## Output instructions for Claude

Produce these files:

1. `apps/web/src/app/{{route-group}}/{{route}}/page.tsx` — server component
2. `apps/web/src/app/{{route-group}}/{{route}}/loading.tsx` — Suspense fallback
3. `apps/web/src/app/{{route-group}}/{{route}}/error.tsx` — error boundary
4. `apps/web/src/app/{{route-group}}/{{route}}/_components/*.tsx` — client components scoped to this route
5. `apps/web/src/app/{{route-group}}/{{route}}/_actions.ts` — server actions for mutations
6. `apps/web/src/i18n/messages/en-IN/{{module}}.{{screen}}.json` — translation keys
7. `apps/web/tests/e2e/{{module}}/{{screen}}.spec.ts` — Playwright tests

After writing files, run:
```
pnpm --filter @civitasone/web typecheck
pnpm --filter @civitasone/web lint
pnpm --filter @civitasone/web test:e2e -- {{screen}}.spec.ts
```

---

## Anti-patterns

- Don't call the database from a React component — always go through service API
- Don't put secrets in client components — environment vars must start `NEXT_PUBLIC_` only if safe
- Don't use `useEffect` for initial data fetching — use server components
- Don't hardcode colors / spacing / font sizes — use ui-kit tokens
- Don't bypass ui-kit components — if missing, add to kit first
- Don't disable lint or type errors — fix the cause
