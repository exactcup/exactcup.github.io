# ExactCup

Free, accurate cooking & baking measurement converters — cups to grams for every ingredient, recipe scaler, oven temperature converter, and butter converter.

Static site, zero runtime dependencies. Pages are pre-rendered from a data file for speed and SEO.

## Build

```bash
node build.js   # outputs static site to ./dist
```

## Structure

- `build.js` — static-site generator (Node stdlib only)
- `data/ingredients.json` — ingredient gram-per-cup weight table
- `assets/app.js` — client-side calculator logic
- `dist/` — generated output (gitignored; built in CI)

Deployed to GitHub Pages via `.github/workflows/deploy.yml` on every push to `main`.
