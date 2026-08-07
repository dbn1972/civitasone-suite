# Claude Code Prompt for CivitasOne Suite

## Quick Start Prompt

```
I'm working on CivitasOne Suite, an ERP web application for Indian government organizations. 

Read PROJECT_CONTEXT.md for complete details.

Tech stack:
- React 18 + TypeScript + Vite
- React Router v7
- Tailwind CSS v4 (custom tokens in /src/styles/theme.css)
- shadcn/ui components from @make-kits packages
- Motion animations (motion/react)

Key conventions:
- Use design system classes (text-h1, text-h2, etc.) NOT Tailwind typography (text-2xl, font-bold)
- Use intent-based colors (intent-primary, intent-success, etc.)
- All public pages must use PublicHeader and PublicFooter components
- ScrollToTop component ensures pages load at top on navigation
- Main app file: src/app/App.tsx

Current structure:
- 27 public pages (marketing, editions, resources, company, legal)
- Authenticated app routes under /app/* with AppShell layout
- Design tokens in /src/styles/theme.css
- Reusable components in /src/app/components/

Please help me with: [YOUR TASK HERE]
```

## Detailed Prompts for Specific Tasks

### 1. Adding a New Public Page

```
I need to add a new public page to CivitasOne Suite.

Context:
- All public pages use PublicHeader and PublicFooter components
- Follow the pattern in existing pages like /src/app/pages/marketing/Features.tsx
- Use Motion animations with staggered delays
- Use design system components from /src/app/components/ui/
- Card-based layouts with gradients for CTAs

Task:
Create a new page at /src/app/pages/[category]/[PageName].tsx for [describe page purpose].

The page should include:
- PublicHeader at top, PublicFooter at bottom
- Hero section with motion animations
- [Specific sections needed]
- CTA section with gradient background

Don't forget to add the route to /src/app/App.tsx.
```

### 2. Adding a New App Module Page

```
I need to add a new page to the authenticated app area.

Context:
- App pages live under /src/app/pages/[module]/
- They're wrapped in AppShell component via /app/* routes
- Use the same design system components and conventions
- Reference existing modules like finance or hrms for patterns

Task:
Create [module]/[PageName].tsx that includes:
- [Describe functionality]
- Uses components from /src/app/components/ui/
- Follows the existing data table / form / dashboard patterns

Add the route to App.tsx under the /app/* Route element.
```

### 3. Modifying the Design System

```
I want to update the design system styling.

Context:
- Design tokens are in /src/styles/theme.css
- Uses CSS custom properties (--token-name format)
- Supports light/dark modes via [data-theme="dark"] selector
- Typography classes: text-display, text-h1 through text-h4, text-base, text-body-sm, text-caption

Task:
[Describe what you want to change - colors, spacing, typography, etc.]

Important: Make sure changes work in both light and dark modes.
```

### 4. Adding New Components

```
I need to create a new reusable component.

Context:
- Base UI components are in /src/app/components/ui/
- Layout components are in /src/app/components/
- All components use design system tokens
- Follow shadcn/ui patterns for component API design

Task:
Create a [ComponentName] component that:
- [Describe functionality]
- Accepts these props: [list props]
- Uses design tokens for styling
- Works in light/dark mode

Place it in /src/app/components/[ComponentName].tsx (or /ui/ if it's a base component).
```

### 5. Fixing Styling Issues

```
I'm having a styling issue on [page/component].

Context:
- We use Tailwind CSS v4 with custom design tokens
- Do NOT use text-2xl, font-bold, etc. - use text-h1, text-h2, text-body-sm, etc.
- Colors should use intent-* or surface-* or text-* classes
- Theme is controlled via [data-theme] attribute on root element

Issue:
[Describe the problem]

Expected:
[Describe what it should look like]

Check /src/styles/theme.css for available tokens and classes.
```

### 6. Adding Animations

```
I want to add animations to [page/component].

Context:
- We use Motion (motion/react) for animations
- Typical pattern: motion.div with initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
- Use staggered delays for multiple elements: transition={{ delay: 0.1 * index }}
- See existing pages like /src/app/pages/marketing/Features.tsx for examples

Task:
Add animations to [describe what should animate and how].
```

### 7. Navigation and Routing

```
I need help with routing/navigation.

Context:
- React Router v7
- Public routes are direct Route elements
- App routes are nested under /app/* with AppShell wrapper
- ScrollToTop component auto-scrolls on navigation
- useNavigate() hook for programmatic navigation

Task:
[Describe routing need - new route, navigation, scroll behavior, etc.]
```

### 8. Integrating Backend/API

```
I want to connect [feature] to a backend.

Context:
- Currently all data is mock/static
- For Supabase integration, there's a /supabase skill available
- For general APIs, create mock data structures first
- Use environment variables for API keys (never hardcode)

Task:
[Describe what needs to be connected]

Show me:
1. The API integration code
2. Loading states
3. Error handling
4. How to update the mock data to real data
```

## Common Issues and Solutions

### Issue: "Page doesn't scroll to top when navigating"
**Solution**: The ScrollToTop component is already included in App.tsx. Make sure it's inside BrowserRouter.

### Issue: "Styling looks wrong / not using design system"
**Solution**: 
- Check you're using text-h1, text-body-sm, etc. (NOT text-2xl, font-bold)
- Use intent-primary, intent-success, etc. for colors
- Check /src/styles/theme.css for available classes

### Issue: "Component not found"
**Solution**: 
- UI components are in /src/app/components/ui/
- Make sure @make-kits packages are installed
- Check imports use correct path

### Issue: "Dark mode not working"
**Solution**:
- Theme toggle sets [data-theme="dark"] on root element
- Make sure CSS has dark mode variants defined
- Check theme.css has [data-theme="dark"] selectors

### Issue: "Build errors"
**Solution**:
- This project has a special build system - don't run vite build
- Check for JSX syntax errors (unclosed tags, mismatched brackets)
- Verify all imports are correct

## File Paths Reference

Quick reference for common files:

```
src/app/App.tsx                      # Main router
src/app/components/PublicHeader.tsx  # Public page header
src/app/components/PublicFooter.tsx  # Public page footer
src/app/components/AppShell.tsx      # App layout wrapper
src/app/components/ScrollToTop.tsx   # Auto-scroll on navigation
src/app/components/ui/               # Base UI components
src/styles/theme.css                 # Design tokens
src/styles/fonts.css                 # Font imports
src/styles/globals.css               # Global styles
src/app/contexts/ThemeContext.tsx    # Theme state management
```

## Example: Complete Workflow

```
I want to add a new "Careers" page to the company section.

Steps:
1. Read /src/app/pages/company/About.tsx to understand the pattern
2. Create /src/app/pages/company/Careers.tsx with:
   - Import PublicHeader, PublicFooter
   - Hero section with motion animations
   - Job listings in Card components
   - CTA section at bottom
3. Add route to /src/app/App.tsx: 
   <Route path="/company/careers" element={<Careers />} />
4. Update PublicFooter to include Careers link (if not already there)
5. Test navigation and scroll-to-top behavior

Show me the complete code for the Careers page following the existing patterns.
```
