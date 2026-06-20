# CivitasOne Suite

> Enterprise Resource Planning (ERP) web application for Indian government organizations, PSUs, and small offices.

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Start dev server (already running in this environment)
pnpm dev
```

## 📚 Documentation

- **[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)** - Complete project overview, tech stack, architecture, and conventions
- **[CLAUDE_PROMPT.md](CLAUDE_PROMPT.md)** - Prompts and examples for working with Claude Code
- **[SHARE_WITH_CLAUDE.md](SHARE_WITH_CLAUDE.md)** - Guide for sharing this project with Claude Code

## 🏗️ Tech Stack

- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite
- **Routing**: React Router v7
- **Styling**: Tailwind CSS v4 (custom design tokens)
- **Components**: shadcn/ui (@make-kits packages)
- **Icons**: lucide-react
- **Animations**: Motion (motion/react)

## 📁 Project Structure

```
src/
├── app/
│   ├── components/          # Reusable components
│   │   ├── ui/              # Base UI components (Button, Card, etc.)
│   │   ├── PublicHeader.tsx # Header for public pages
│   │   ├── PublicFooter.tsx # Footer for public pages
│   │   ├── AppShell.tsx     # App layout wrapper
│   │   └── ScrollToTop.tsx  # Auto-scroll on navigation
│   ├── pages/               # Page components
│   │   ├── marketing/       # Marketing pages (Features, Pricing, etc.)
│   │   ├── editions/        # Edition pages (SmallOffice, PSU, Government)
│   │   ├── resources/       # Resources (Documentation, API)
│   │   ├── company/         # Company pages (About, Contact)
│   │   ├── legal/           # Legal pages (Terms, Privacy, etc.)
│   │   ├── finance/         # Finance module pages
│   │   ├── hrms/            # HRMS module pages
│   │   └── ...              # Other modules
│   ├── contexts/            # React contexts (ThemeContext)
│   └── App.tsx              # Main app with routing
└── styles/
    ├── theme.css            # Design system tokens
    ├── fonts.css            # Font imports
    └── globals.css          # Global styles
```

## 🎨 Design System

### Typography
Use design system classes, **NOT** Tailwind typography classes:
```tsx
// ✅ Correct
<h1 className="text-display">Title</h1>
<p className="text-body-sm">Body text</p>

// ❌ Wrong
<h1 className="text-4xl font-bold">Title</h1>
<p className="text-sm">Body text</p>
```

Available classes: `text-display`, `text-h1`, `text-h2`, `text-h3`, `text-h4`, `text-base`, `text-body-sm`, `text-caption`

### Colors
Use intent-based colors:
- **Intent**: `intent-primary`, `intent-success`, `intent-warning`, `intent-danger`, `intent-info`
- **Surface**: `surface-canvas`, `surface-raised`, `surface-sunken`
- **Text**: `text-primary`, `text-secondary`, `text-muted`

### Components
Import from UI component library:
```tsx
import { Button, Card, Badge, Input } from '../components/ui';
```

## 🔧 Key Conventions

### Public Pages
All public pages must use `PublicHeader` and `PublicFooter`:
```tsx
import { PublicHeader } from '../../components/PublicHeader';
import { PublicFooter } from '../../components/PublicFooter';

export function MyPage() {
  return (
    <div className="min-h-screen bg-surface-canvas">
      <PublicHeader />
      {/* Page content */}
      <PublicFooter />
    </div>
  );
}
```

### Animations
Use Motion for page animations:
```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: 0.1 }}
>
  Content
</motion.div>
```

### Navigation
- ScrollToTop component automatically scrolls to top on route changes
- Use `useNavigate()` hook for programmatic navigation
- All routes defined in `src/app/App.tsx`

## 📄 Pages

### Public Pages (27 total)
- **Marketing**: Landing, Features, Integrations, Pricing, Changelog, Roadmap
- **Editions**: Small Office, PSU, Government, Compare Editions
- **Resources**: Documentation, API Reference
- **Company**: About, Contact
- **Legal**: Terms, Privacy, Cookie Policy, Accessibility, Trademarks

### App Pages (Authenticated)
- **Finance**: Invoices, Payments, Reports, Chart of Accounts, Journal Entry
- **HRMS**: Employees, Attendance, Payroll, Leave Management
- **Procurement**: Purchase Orders, Vendors, Approvals
- **CRM**: Pipeline, Contacts, Activities
- **Helpdesk**: Tickets, Reports
- **Reports**: Report Center, Builder, View
- **Other**: Inventory, Assets, Projects

## 🎯 Features

- ✅ Responsive design (mobile-first)
- ✅ Light/dark theme support
- ✅ Scroll-to-top navigation
- ✅ Motion animations
- ✅ Complete design system
- ✅ 27 public pages
- ✅ Multi-module app structure
- ✅ Mock data for all features

## 🇮🇳 India-Specific Features

- GFR (General Financial Rules) compliance
- e-Office integration
- GeM (Government e-Marketplace) integration
- PFMS (Public Financial Management System) integration
- GST & TDS compliance
- 7th Pay Commission support
- RTI (Right to Information) compliance
- PF, ESI, TDS statutory compliance

## 🚧 Important Notes

### Build System
This project uses a **custom build system**:
- ❌ Do NOT run `vite build` or `npm run build`
- ❌ Do NOT create `index.html`
- ✅ Dev server is already running
- ✅ Entry point is auto-generated

### Best Practices
- Use **pnpm** instead of npm
- Main component: `src/app/App.tsx` (must have default export)
- Font imports only in `/src/styles/fonts.css`
- Edit existing files rather than creating new ones when possible
- Never modify files in `node_modules/@make-kits/`

## 🤖 Working with Claude Code

### First Time Setup
When starting a new Claude Code session:

```
Read PROJECT_CONTEXT.md for complete project details.

This is CivitasOne Suite, a React ERP application for Indian government organizations.

Key conventions:
- Use design system classes (text-h1, text-body-sm, etc.) NOT Tailwind typography
- All public pages use PublicHeader + PublicFooter
- Motion animations with staggered delays
- Card-based layouts throughout

I need help with: [YOUR TASK]
```

### Common Tasks
See **[CLAUDE_PROMPT.md](CLAUDE_PROMPT.md)** for detailed prompts for:
- Adding new pages
- Creating components
- Modifying design system
- Fixing styling issues
- Adding animations
- Navigation and routing
- Backend integration

### Sharing Project
See **[SHARE_WITH_CLAUDE.md](SHARE_WITH_CLAUDE.md)** for:
- How to zip and share the project
- Git repository sharing
- Sharing specific files only
- Quick context prompts

## 📝 License

Proprietary - CivitasOne Technologies Pvt. Ltd.

## 📧 Contact

- Email: sales@civitasone.com
- Website: [CivitasOne Suite](/)
- Support: support@civitasone.com

---

**Built with ❤️ for Digital India**
