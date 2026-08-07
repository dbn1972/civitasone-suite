# CivitasOne Suite - Project Context

## Project Overview

**CivitasOne Suite** is a comprehensive enterprise resource planning (ERP) web application designed for Indian government organizations, public sector undertakings (PSUs), and small offices. It's a multi-module system built with React, TypeScript, and Tailwind CSS v4.

## Tech Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Routing**: React Router v7
- **Styling**: Tailwind CSS v4.0 (using CSS variables)
- **UI Components**: shadcn/ui-based design system (imported from `@make-kits` packages)
- **Icons**: lucide-react
- **Animations**: Motion (motion/react)
- **State Management**: React Context API (ThemeContext)
- **Form Libraries**: react-hook-form v7.55.0 (when needed)

## Design System

### Theme System
- Located in `/src/styles/theme.css`
- Uses CSS custom properties for tokens
- Supports light/dark mode via `[data-theme="dark"]` attribute
- Design tokens include:
  - Colors: brand, surface, intent (primary, success, warning, danger, info)
  - Typography: text-display, text-h1 through text-h4, text-base, text-body-sm, text-caption
  - Spacing: using standard Tailwind spacing scale
  - Shadows: custom shadow variables
  - Border radius: custom radius variables

### Component Library
- Base UI components in `/src/app/components/ui/`
- Key components: Button, Card, Input, Select, Badge, Textarea, Tabs, etc.
- All components use the design system tokens
- Reusable layout components:
  - `PublicHeader`: Header for marketing/public pages
  - `PublicFooter`: Footer for marketing/public pages
  - `AppShell`: Main application layout with sidebar navigation

## Application Structure

### Public Pages (Marketing Site)
All public pages use `PublicHeader` and `PublicFooter` for consistent navigation.

**Marketing Pages** (`/src/app/pages/marketing/`)
- `/` - LandingPage (hero, features overview, CTA)
- `/features` - Features (detailed feature showcase)
- `/integrations` - Integrations (third-party integrations)
- `/pricing` - Pricing (pricing tiers and comparison)
- `/changelog` - Changelog (release history)
- `/roadmap` - Roadmap (product roadmap with voting)

**Editions Pages** (`/src/app/pages/editions/`)
- `/editions/small-office` - Small Office edition
- `/editions/psu` - PSU edition
- `/editions/government` - Government edition
- `/editions/compare` - CompareEditions (feature comparison table)

**Resources Pages** (`/src/app/pages/resources/`)
- `/resources/documentation` - Documentation (module-based docs)
- `/resources/api` - APIReference (REST API documentation)

**Company Pages** (`/src/app/pages/company/`)
- `/company/about` - About (company info, mission, values)
- `/company/contact` - Contact (contact form and office locations)

**Legal Pages** (`/src/app/pages/legal/`)
- `/legal/terms` - Terms of Service
- `/legal/privacy` - Privacy Policy
- `/legal/cookie-policy` - Cookie Policy
- `/legal/accessibility` - Accessibility Statement
- `/legal/trademarks` - Trademarks

### Authenticated Application
Protected routes under `/app/*` use the `AppShell` component.

**Modules**:
- **Finance**: Invoices, Payments, Reports, Chart of Accounts, Journal Entry
- **HRMS**: Employees, Attendance, Payroll, Leave Management
- **Procurement**: Purchase Orders, Vendors, Approvals
- **CRM**: Pipeline, Contacts, Activities
- **Helpdesk**: Tickets, Reports
- **Reports**: Report Center, Report Builder, Report View
- **Other**: Inventory, Assets, Projects

**Auth Pages**:
- `/auth/login` - Login screen
- `/auth/mfa` - MFA verification
- `/dashboard` - Post-auth dashboard

## Key Features

### Navigation
- **Scroll to Top**: Automatic scroll to top on route changes via `ScrollToTop` component
- **Responsive**: Mobile-first design with hamburger menus
- **Theme Toggle**: Light/dark mode switching

### Design Patterns
- Motion animations on page load (staggered delays)
- Card-based layouts throughout
- Gradient backgrounds for hero/CTA sections
- Badge components for status indicators
- Icon + text patterns for features and stats

### Data Patterns
- Mock data defined as constants (e.g., `ROADMAP_ITEMS`, `FEATURE_COMPARISON`)
- Interface-driven TypeScript for type safety
- Reusable patterns for grids, cards, and tables

## File Organization

```
/src
  /app
    /components        # Reusable components
      /ui              # Base UI components (shadcn/ui)
      PublicHeader.tsx
      PublicFooter.tsx
      AppShell.tsx
      ScrollToTop.tsx
    /pages
      /marketing       # Marketing pages
      /editions        # Edition-specific pages
      /resources       # Documentation and resources
      /company         # Company info pages
      /legal           # Legal pages
      /finance         # Finance module pages
      /hrms            # HRMS module pages
      /procurement     # Procurement module pages
      /crm             # CRM module pages
      /helpdesk        # Helpdesk module pages
      /reports         # Reports module pages
      LandingPage.tsx
      StatusPage.tsx
    /contexts          # React contexts (ThemeContext)
    App.tsx            # Main app with routing
  /styles
    theme.css          # Design tokens
    fonts.css          # Font imports
    globals.css        # Global styles
```

## Design Conventions

### Typography
- Do NOT use Tailwind font size/weight classes (text-2xl, font-bold, etc.)
- Use design system classes: text-h1, text-h2, text-h3, text-h4, text-base, text-body-sm, text-caption
- Default font styling is defined in `/src/styles/theme.css`

### Colors
- Use intent-based colors: intent-primary, intent-success, intent-warning, intent-danger, intent-info
- Surface colors: surface-canvas, surface-raised, surface-sunken
- Text colors: text-primary, text-secondary, text-muted

### Components
- Always use design system components from `/src/app/components/ui/`
- Button variants: primary, secondary, danger, default
- Card component for all container elements
- Badge for status/labels

### Animation
- Use Motion (motion/react) for page transitions
- Stagger delays: initial opacity 0, animate to 1
- Typical pattern: `initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}`

## Important Notes

### Build System
- This is NOT a standard Vite setup
- Do NOT run `vite build` or `npm run build`
- Do NOT create `index.html`
- Entrypoint is auto-generated at runtime
- Dev server is already running

### Best Practices
- Main component file: `src/app/App.tsx` (must have default export)
- Always edit existing files rather than creating new ones when possible
- Use pnpm instead of npm
- Import images with ES modules (not string paths)
- Font imports only in `/src/styles/fonts.css`

### Protected Files
Do not modify:
- `/src/styles/theme.css` (unless changing the design system)
- `package.json` (without confirming dependencies)
- Any files in `node_modules/@make-kits/`

## Current State

### Completed Features
✅ Complete marketing site with consistent header/footer
✅ All public pages (27 pages total)
✅ Scroll-to-top navigation functionality
✅ Light/dark theme support
✅ Responsive design
✅ Motion animations
✅ Design system integration

### Mock Data
All pages use realistic mock data representing:
- Government of India compliance (GFR, e-Office, PFMS, GeM)
- Indian tax laws (GST, TDS, PF, ESI)
- Indian pricing (₹ INR)
- Indian locations (Mumbai, Delhi, Bangalore)
- 7th Pay Commission compliance

## Next Steps (Potential)

- Add real backend integration (Supabase suggested)
- Implement authentication flow
- Add form validation
- Connect to real APIs
- Add loading states
- Implement error boundaries
- Add unit tests
- Add E2E tests
