# Accessibility Features - CivitasOne Suite

## Overview
CivitasOne Suite is built with WCAG 2.2 Level AA compliance in mind. This document outlines the accessibility features implemented across the application.

## Theme Support

### Dark Mode / Light Mode
- **Theme Toggle**: Available in the header of all pages
- **System Preference Detection**: Automatically detects user's OS theme preference
- **Persistent Preference**: User's choice is saved to localStorage
- **Three Modes**:
  - Light Mode: High contrast, optimized for daylight viewing
  - Dark Mode: Reduced eye strain for low-light environments
  - System: Follows OS preference automatically

### Implementation
- Theme switcher accessible via keyboard (Tab + Enter/Space)
- Theme applied to `<html>` element with `.dark` or `.light` class
- All colors defined as CSS custom properties for consistent theming
- Smooth transitions between themes

## Keyboard Navigation

### Skip Navigation
- "Skip to main content" link appears on focus
- Allows keyboard users to bypass repeated navigation
- Implemented on all major pages

### Focus Management
- Visible focus indicators on all interactive elements
- Logical tab order throughout the application
- Focus traps in modals and dropdown menus
- No keyboard traps - users can always navigate away

### Keyboard Shortcuts
- Tab: Move forward through interactive elements
- Shift + Tab: Move backward
- Enter/Space: Activate buttons and links
- Escape: Close modals and dropdowns
- Arrow keys: Navigate within dropdown menus

## Semantic HTML

### Document Structure
- Proper heading hierarchy (h1 → h2 → h3 → h4)
- Semantic landmarks:
  - `<header>`: Site header and navigation
  - `<nav>`: Navigation sections
  - `<main>`: Main content area
  - `<article>`: Self-contained content
  - `<section>`: Thematic groupings
  - `<footer>`: Footer information

### ARIA Labels
- All interactive elements have descriptive labels
- Icon-only buttons include `aria-label` attributes
- Form inputs associated with labels
- Dynamic content changes announced to screen readers

## Color and Contrast

### Contrast Ratios
- Text: Minimum 4.5:1 contrast ratio (WCAG AA)
- Large text: Minimum 3:1 contrast ratio
- Interactive elements: Distinct visual states

### Color Independence
- Information never conveyed by color alone
- Icons and text labels accompany color coding
- Status indicators include text descriptions

## Typography

### Font Sizes
- Minimum font size: 14px (0.875rem)
- Body text: 16px (1rem)
- Headings: Proportional scaling
- User can zoom up to 200% without loss of functionality

### Line Height
- Body text: 1.5 line height minimum
- Headings: 1.2-1.5 line height
- Adequate spacing between paragraphs

## Forms and Inputs

### Labels
- All form fields have associated `<label>` elements
- Placeholder text not used as sole label
- Required fields clearly marked

### Error Messages
- Errors announced to screen readers
- Clear, actionable error descriptions
- Error summaries at top of forms

### Input Assistance
- Help text provided where needed
- Input format examples shown
- Validation feedback in real-time

## Images and Media

### Alternative Text
- All images include meaningful `alt` attributes
- Decorative images have empty `alt=""`
- Complex images include long descriptions

### Icons
- Icons paired with text labels
- Icon-only elements include `aria-label`
- Consistent iconography across the application

## Motion and Animation

### Reduced Motion
- Respects `prefers-reduced-motion` setting
- Critical animations can be disabled
- No auto-playing animations

### Animation Timing
- Animations under 5 seconds
- Users can pause, stop, or hide animations
- No content relies solely on animation

## Responsive Design

### Mobile Accessibility
- Touch targets minimum 44x44px
- Adequate spacing between interactive elements
- Horizontal scrolling avoided
- Portrait and landscape support

### Zoom and Reflow
- Content reflows at 400% zoom
- No horizontal scrolling at 320px width
- Readable at all zoom levels

## Screen Reader Support

### Tested With
- NVDA (Windows)
- JAWS (Windows)
- VoiceOver (macOS/iOS)
- TalkBack (Android)

### Features
- Proper heading navigation
- Landmark navigation
- Form field navigation
- Link lists
- Dynamic content updates announced

## Testing

### Automated Testing
- axe DevTools integration
- Lighthouse accessibility audits
- WAVE browser extension checks

### Manual Testing
- Keyboard-only navigation testing
- Screen reader testing
- Color contrast verification
- Focus order verification

## Compliance

### Standards
- WCAG 2.2 Level AA
- Section 508
- EN 301 549
- ADA compliance

### Certifications
- STQC certification for accessibility
- Regular accessibility audits
- Third-party VPAT available

## Reporting Issues

If you encounter accessibility barriers:
1. Email: accessibility@civitasone.com
2. Include page URL and issue description
3. Specify assistive technology used
4. We respond within 2 business days

## Resources

- [WCAG 2.2 Guidelines](https://www.w3.org/WAI/WCAG22/quickref/)
- [Accessibility Statement](/legal/accessibility)
- [Keyboard Shortcuts Guide](/resources/documentation)

## Continuous Improvement

We continuously work to improve accessibility:
- Quarterly accessibility audits
- User feedback incorporation
- Latest WCAG guideline adherence
- Regular staff training

---

Last Updated: May 23, 2026
Version: 3.2.0
