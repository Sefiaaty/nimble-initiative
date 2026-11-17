#!/bin/sh
# Builds the extension into docs/ (served by GitHub Pages).
set -e
BASE="${1:-https://sefiaaty.github.io/nimble-initiative}"
rm -rf docs && mkdir docs
npx esbuild src/background.js src/popover.js --bundle --format=esm --minify --outdir=docs --log-level=warning
cp public/*.html public/*.css public/*.svg docs/
sed "s#\"/#\"$BASE/#g" public/manifest.json > docs/manifest.json
touch docs/.nojekyll
