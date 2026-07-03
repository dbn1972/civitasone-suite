#!/usr/bin/env bash
# Generates CivitasOne-User-Manual.pdf from docs/user-manual/*.md
# Requires: pandoc (apt install pandoc texlive-latex-recommended texlive-xetex)
set -euo pipefail
cd "$(dirname "$0")/../../docs/user-manual"
cat 00-INDEX.md 01-GETTING-STARTED.md 02-FINANCE.md 03-HR-PAYROLL.md \
    04-PROCUREMENT.md 05-PROJECTS-GRANTS.md 06-ESTABLISHMENT.md \
    07-CITIZEN-HELPDESK.md 08-STOCK-ASSETS.md 09-SMALL-BUSINESS.md \
    10-ADMIN-SETTINGS.md 11-MOBILE-APP.md 12-GLOSSARY.md | \
pandoc -f markdown -o ../../apps/web/public/docs/CivitasOne-User-Manual.pdf \
  --pdf-engine=xelatex \
  --variable=geometry:margin=2.5cm \
  --variable=fontsize:11pt \
  --variable=mainfont:"Noto Sans" \
  --toc --toc-depth=2 \
  -V title="CivitasOne User Manual" \
  -V author="CivitasOne Documentation Team" \
  -V date="July 2026"
echo "✅ PDF generated at apps/web/public/docs/CivitasOne-User-Manual.pdf"
