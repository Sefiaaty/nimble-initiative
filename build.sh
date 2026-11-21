#!/bin/sh
# Builds the extension into docs/ (served by GitHub Pages).
set -e
BASE="${1:-https://sefiaaty.github.io/nimble-initiative}"
rm -rf docs && mkdir docs
npx esbuild src/background.js src/popover.js src/bar.js src/mic.js --bundle --format=esm --minify --outdir=docs --log-level=warning
cp public/*.html public/*.css public/*.svg docs/
mkdir -p docs/portraits && cp public/portraits/* docs/portraits/ 2>/dev/null || true
sed "s#\"/#\"$BASE/#g" public/manifest.json > docs/manifest.json
touch docs/.nojekyll
# Cache-bust: point the pages at this build's files, so a refresh never mixes old and new code.
V=$(cat docs/*.js docs/*.css | sha1sum | cut -c1-8)
sed -i "s#src=\"popover.js\"#src=\"popover.js?v=$V\"#; s#href=\"style.css\"#href=\"style.css?v=$V\"#" docs/index.html
sed -i "s#src=\"background.js\"#src=\"background.js?v=$V\"#" docs/background.html
sed -i "s#src=\"bar.js\"#src=\"bar.js?v=$V\"#; s#href=\"bar.css\"#href=\"bar.css?v=$V\"#" docs/bar.html
sed -i "s#src=\"mic.js\"#src=\"mic.js?v=$V\"#" docs/mic.html
