# How to Share This Project with Claude Code

## Option 1: Share Entire Project (Recommended)

### If using Claude Code Desktop/Web:
1. **Zip the project**:
   ```bash
   cd /path/to/project
   zip -r civitasone-suite.zip . -x "node_modules/*" -x ".git/*" -x "dist/*"
   ```

2. **Start new Claude Code session**

3. **Upload and extract**:
   ```
   I've attached civitasone-suite.zip containing a React ERP application.
   
   Please:
   1. Extract it to the current directory
   2. Read PROJECT_CONTEXT.md for full project details
   3. Run: pnpm install
   
   Then I need help with: [YOUR TASK]
   ```

### If sharing via Git:
1. **Push to repository**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - CivitasOne Suite"
   git remote add origin [YOUR_REPO_URL]
   git push -u origin main
   ```

2. **In new Claude Code session**:
   ```
   Clone the CivitasOne Suite repository from [YOUR_REPO_URL].
   
   After cloning:
   1. Read PROJECT_CONTEXT.md for complete context
   2. Run: pnpm install
   
   I need help with: [YOUR TASK]
   ```

## Option 2: Share Key Files Only (Faster)

### Essential Files to Share:
```
PROJECT_CONTEXT.md           # Full project documentation
CLAUDE_PROMPT.md            # Claude Code usage guide
package.json                # Dependencies
src/app/App.tsx             # Main router
src/styles/theme.css        # Design system
src/app/components/PublicHeader.tsx
src/app/components/PublicFooter.tsx
src/app/components/ScrollToTop.tsx
```

### Example Files for Reference:
```
src/app/pages/marketing/Features.tsx    # Public page example
src/app/pages/company/About.tsx         # Another public page
src/app/pages/finance/FinanceInvoices.tsx  # App page example
```

### In new Claude Code session:
```
I'm working on CivitasOne Suite. I'll share the key files:

[Attach PROJECT_CONTEXT.md]
[Attach CLAUDE_PROMPT.md]
[Attach package.json]
[Attach any specific files you need help with]

Context: This is a React + TypeScript ERP application. Read PROJECT_CONTEXT.md for full details.

I need help with: [YOUR TASK]
```

## Option 3: Quick Context Prompt (No Files)

### Use this prompt to get started without sharing files:

```
I'm working on CivitasOne Suite, an ERP web application for Indian government organizations.

**Tech Stack:**
- React 18 + TypeScript + Vite
- React Router v7 for routing  
- Tailwind CSS v4 with custom design tokens (CSS variables)
- shadcn/ui components from @make-kits npm packages
- Motion (motion/react) for animations
- lucide-react for icons

**Design System:**
- All tokens in /src/styles/theme.css as CSS custom properties
- Typography classes: text-display, text-h1, text-h2, text-h3, text-h4, text-base, text-body-sm, text-caption
- Color classes: intent-primary, intent-success, intent-warning, intent-danger, intent-info
- Surface classes: surface-canvas, surface-raised, surface-sunken
- Text classes: text-primary, text-secondary, text-muted
- NEVER use Tailwind typography (text-2xl, font-bold) - always use design system classes

**Project Structure:**
- 27 public pages (marketing, editions, resources, company, legal)
- All public pages use PublicHeader + PublicFooter components
- Authenticated app under /app/* routes with AppShell layout
- ScrollToTop component ensures pages start at top on navigation
- Main router: src/app/App.tsx (must export default)

**Key Conventions:**
- Use Motion for page animations: initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
- Card-based layouts throughout
- Gradient CTAs: bg-gradient-to-br from-brand-primary to-brand-accent
- Icon + text patterns everywhere
- Mock data as constants in each file

**Current Pages:**
Public routes: /, /features, /pricing, /roadmap, /integrations, /changelog
Editions: /editions/small-office, /editions/psu, /editions/government, /editions/compare
Resources: /resources/documentation, /resources/api
Company: /company/about, /company/contact
Legal: /legal/terms, /legal/privacy, /legal/cookie-policy, /legal/accessibility, /legal/trademarks

**What I need help with:**
[YOUR SPECIFIC REQUEST]
```

## Option 4: Share Specific Component/Page

If you only need help with a specific part:

```
I'm working on CivitasOne Suite (React + TypeScript ERP app).

Here's the component I need help with:
[Paste code]

Context:
- Uses design system tokens: text-h1, intent-primary, surface-raised, etc.
- Uses Motion animations: initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
- UI components from /src/app/components/ui/
- Public pages use PublicHeader + PublicFooter

Issue/Request:
[Describe what you need]
```

## Recommended Workflow

### For New Features:
1. Share PROJECT_CONTEXT.md and CLAUDE_PROMPT.md
2. Share example files similar to what you want to build
3. Describe the new feature clearly
4. Ask Claude to follow existing patterns

### For Bug Fixes:
1. Share the specific file with the issue
2. Share PROJECT_CONTEXT.md for conventions
3. Describe the bug and expected behavior
4. Include any error messages

### For Design Changes:
1. Share src/styles/theme.css
2. Share PROJECT_CONTEXT.md
3. Describe the desired changes
4. Specify if it should work in light/dark mode

## Important Notes

⚠️ **Do not share**:
- `node_modules/` folder
- `.git/` folder  
- `dist/` or build output
- Any API keys or secrets

✅ **Always share**:
- PROJECT_CONTEXT.md (complete project documentation)
- CLAUDE_PROMPT.md (usage guide)
- Relevant source files
- package.json (for dependencies)

📝 **Best Practice**:
Start every new Claude Code session by having Claude read PROJECT_CONTEXT.md first. This ensures it understands the project conventions, tech stack, and file structure.

## Quick Commands

**Zip project without node_modules:**
```bash
zip -r civitasone-suite.zip . -x "node_modules/*" -x ".git/*" -x "dist/*" -x "*.log"
```

**List project structure:**
```bash
tree -I 'node_modules|dist|.git' -L 3
```

**Find all page components:**
```bash
find src/app/pages -name "*.tsx" | grep -v test
```

**Count lines of code:**
```bash
find src -name "*.tsx" -o -name "*.ts" | xargs wc -l
```
