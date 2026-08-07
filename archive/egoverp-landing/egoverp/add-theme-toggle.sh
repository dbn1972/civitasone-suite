#!/bin/bash

# Script to add ThemeToggle to all marketing pages

PAGES=(
  "src/app/pages/marketing/Features.tsx"
  "src/app/pages/marketing/Integrations.tsx"
  "src/app/pages/marketing/Changelog.tsx"
  "src/app/pages/marketing/Roadmap.tsx"
  "src/app/pages/resources/Documentation.tsx"
  "src/app/pages/resources/APIReference.tsx"
  "src/app/pages/company/About.tsx"
  "src/app/pages/company/Contact.tsx"
)

for page in "${PAGES[@]}"; do
  echo "Updating $page..."

  # Check if import already exists
  if ! grep -q "import { ThemeToggle }" "$page"; then
    # Add import after the last import from lucide-react or react-router
    sed -i "/from 'react-router';/a import { ThemeToggle } from '../../components/ThemeToggle';" "$page" 2>/dev/null || \
    sed -i "/from '..\/..\/components\/ThemeToggle';/a import { ThemeToggle } from '../../components/ThemeToggle';" "$page" 2>/dev/null
  fi

  echo "  ✓ Import added to $page"
done

echo "Done! ThemeToggle imports added to all pages."
