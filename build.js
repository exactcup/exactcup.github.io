#!/usr/bin/env node
/* ExactCup static-site generator. Zero dependencies (Node stdlib only).
   Usage: node build.js   ->   outputs to ./dist  */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

// Honest sitemap lastmod: date of the last git commit (when content actually
// changed). Falls back to today only if git is unavailable. Avoids churning the
// date on no-op rebuilds, which keeps the freshness signal trustworthy.
const LASTMOD = (() => {
  try {
    return execSync("git log -1 --format=%cs", { cwd: __dirname }).toString().trim();
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
})();
const TODAY = new Date().toISOString().slice(0, 10);

// Per-page <lastmod>: each page carries the date its OWN content last changed,
// not one global date for the whole site. We hash each page's meaningful content
// (title/description/body/JSON-LD/cfg — deliberately excluding the shared
// header/footer/CSS chrome) and keep a committed manifest of hash→date. A page's
// date only advances when that page's hash changes, so adding/editing one page no
// longer churns the freshness signal for all the others. PAGE_CONTENT is filled
// by layout() as pages render; the manifest is read/written in build().
const DATES_FILE = path.join(__dirname, "data", "page-dates.json");
const PAGE_CONTENT = {};

const ROOT = __dirname;
const OUT = path.join(ROOT, "dist");
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "ingredients.json"), "utf8"));
const BLURBS = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "blurbs.json"), "utf8")); }
  catch (e) { return {}; }
})();
DATA.ingredients.forEach((i) => { if (BLURBS[i.slug]) i.blurb = BLURBS[i.slug]; });
const INDEXNOW_KEY = (() => {
  try { return fs.readFileSync(path.join(ROOT, "data", "indexnow-key.txt"), "utf8").trim(); }
  catch (e) { return ""; }
})();

const SITE = {
  brand: "ExactCup",
  // Live deploy URL (GitHub Pages org site). Update if a custom domain is added later.
  baseUrl: "https://exactcup.github.io",
  tagline: "Accurate cooking measurement converters",
  year: 2026,
  // Google Search Console verification token (META method). Public value, safe to commit.
  googleVerify: process.env.GOOGLE_SITE_VERIFICATION || "OVnKY9jVyIyKPGL2wpvNqm9oeGChGYS8wqvzK7KxaXw",
};

// ---------- helpers ----------
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const OZ = 28.349523125;
const FRACTIONS = [
  ["1/8", 0.125], ["1/4", 0.25], ["1/3", 1 / 3], ["1/2", 0.5],
  ["2/3", 2 / 3], ["3/4", 0.75], ["1", 1], ["1 1/4", 1.25], ["1 1/3", 4 / 3],
  ["1 1/2", 1.5], ["1 3/4", 1.75], ["2", 2], ["3", 3],
];
function g2(n) { return Math.round(n * 10) / 10; }
function ingBySlug(slug) { return DATA.ingredients.find((i) => i.slug === slug); }
function catName(key) { return DATA.categories[key] || key; }
function popular() {
  return ["all-purpose-flour", "granulated-sugar", "butter", "brown-sugar", "powdered-sugar", "milk"]
    .map(ingBySlug).filter(Boolean);
}

// Canonical list of every calculator/tool page: [url, short label, homepage description].
// Used by the homepage grid AND the sitewide footer so every crawled page links to
// every tool (aids discovery of the tool pages, which lag the ingredient cluster in indexing).
const ALL_TOOLS = [
  ["/cups-to-grams/", "Cups to Grams", "Convert any ingredient — flour, sugar, butter & 30+ more."],
  ["/grams-to-cups/", "Grams to Cups", "Have a weight? Turn grams back into cups by ingredient."],
  ["/tablespoons-to-grams/", "Tablespoons to Grams", "How many grams in a tablespoon of any ingredient."],
  ["/tablespoons-in-a-cup/", "Tablespoons in a Cup", "16 tbsp in a cup — plus every fraction & full chart."],
  ["/teaspoons-in-a-tablespoon/", "Teaspoons in a Tablespoon", "3 tsp in a tbsp — half measures & world spoon sizes."],
  ["/ounces-in-a-cup/", "Ounces in a Cup", "8 fl oz in a cup — and fluid vs dry ounces, explained."],
  ["/cups-in-a-quart/", "Cups in a Quart", "4 cups in a quart, 16 in a gallon — the full US ladder."],
  ["/air-fryer-conversion-calculator/", "Air Fryer Converter", "Turn any oven recipe into air-fryer time & temp."],
  ["/recipe-scaler/", "Recipe Scaler", "Scale a recipe up or down by servings, instantly."],
  ["/recipe-halving-chart/", "Recipe Halving Chart", "Half of 3/4 cup, 1/3 cup & every other measure."],
  ["/kitchen-conversion-chart/", "Printable Kitchen Chart", "Every must-know conversion on one printable page."],
  ["/oven-temperature-converter/", "Oven Temperature", "°F ↔ °C ↔ gas mark, with a quick chart."],
  ["/pan-size-converter/", "Pan Size Converter", "Swapping pans? Scale the recipe by pan area."],
  ["/volume-converter/", "Volume Converter", "Cups, tablespoons, teaspoons, mL and fl oz."],
  ["/cups-to-ml/", "Cups to mL", "How many mL in a cup — US, metric & UK cup sizes."],
  ["/portion-calculator/", "Portion Calculator", "How much rice, pasta or potatoes per person."],
  ["/dry-to-cooked/", "Dry to Cooked Converter", "1 cup dry rice ≈ 3 cups cooked — grain & pasta yields."],
  ["/pizza-dough-calculator/", "Pizza Dough Calculator", "Exact flour, water, salt & yeast by baker's %."],
  ["/bakers-percentage-calculator/", "Baker's Percentage Calculator", "Build & scale any bread formula by baker's math."],
  ["/yeast-converter/", "Yeast Converter", "Active dry, instant & fresh yeast — swap by weight."],
  ["/sourdough-hydration-calculator/", "Sourdough Hydration", "True dough hydration with the starter counted right."],
  ["/butter-converter/", "Butter Converter", "Sticks, cups, tablespoons, grams and ounces."],
  ["/butter-to-oil/", "Butter to Oil", "Swap butter for oil: 1 cup butter = 3/4 cup oil."],
  ["/sugar-to-honey/", "Sugar to Honey", "Swap sugar for honey: 1 cup sugar = ½–¾ cup honey."],
  ["/cake-flour-substitute/", "Cake Flour Substitute", "Make cake flour: swap 2 tbsp cornstarch into each cup of flour."],
  ["/cornstarch-to-flour/", "Cornstarch to Flour", "Thickener swap both ways: 1 tbsp cornstarch = 2 tbsp flour."],
  ["/baking-powder-substitute/", "Baking Powder Substitute", "Per tsp: ¼ tsp baking soda + ½ tsp cream of tartar."],
];

// ---------- structured data (JSON-LD) helpers ----------
// BreadcrumbList from [name, relativeUrl] pairs (last item is the current page).
function breadcrumbLd(items) {
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map(([name, rel], i) => ({
      "@type": "ListItem", position: i + 1, name,
      item: SITE.baseUrl + rel,
    })),
  };
}
// WebApplication entry for a free client-side calculator tool.
function appLd(name, description, canonical) {
  return {
    "@context": "https://schema.org", "@type": "WebApplication",
    name, description, url: SITE.baseUrl + canonical,
    applicationCategory: "UtilitiesApplication", operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}
function faqLd(faq) {
  return {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
}

const CSS = `
:root{--bg:#fff;--fg:#1f2328;--muted:#5b6470;--line:#e6e8eb;--accent:#c2410c;--accent2:#fff7ed;--card:#fafafa;--radius:12px}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
header.site{border-bottom:1px solid var(--line)}
.wrap{max-width:760px;margin:0 auto;padding:0 18px}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;height:60px}
.brand{font-weight:800;font-size:20px;color:var(--fg);letter-spacing:-.3px}
.brand span{color:var(--accent)}
nav a{color:var(--muted);font-size:14px;margin-left:16px}
main{padding:26px 0 10px}
h1{font-size:30px;line-height:1.2;letter-spacing:-.5px;margin:.2em 0 .4em}
h2{font-size:21px;margin:1.6em 0 .5em;letter-spacing:-.3px}
h3{font-size:17px;margin:1.2em 0 .4em}
p{margin:.6em 0}.lead{font-size:18px;color:var(--muted)}
.calc{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin:18px 0}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.field{flex:1;min-width:120px}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:4px;font-weight:600}
input,select,textarea{width:100%;font-size:16px;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:#fff;font-family:inherit}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);border-color:var(--accent)}
.result{background:var(--accent2);border:1px solid #fed7aa;border-radius:var(--radius);padding:16px;margin-top:14px;text-align:center}
.result .big{font-size:30px;font-weight:800;color:var(--accent)}
.result .sub{color:var(--muted);font-size:15px}
table{width:100%;border-collapse:collapse;margin:14px 0;font-size:15px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.03em}
td.num{font-variant-numeric:tabular-nums}
.tw{overflow-x:auto;margin:14px 0}.tw table{margin:0;min-width:640px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.chips a{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 13px;font-size:14px;color:var(--fg)}
.chips a:hover{border-color:var(--accent);text-decoration:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:16px 0}
.card{display:block;border:1px solid var(--line);border-radius:var(--radius);padding:16px;color:var(--fg)}
.card:hover{border-color:var(--accent);text-decoration:none}
.card .t{font-weight:700;margin-bottom:3px}.card .d{color:var(--muted);font-size:14px}
details{border:1px solid var(--line);border-radius:9px;padding:6px 14px;margin:8px 0}
summary{font-weight:600;cursor:pointer;padding:6px 0}
.note{font-size:13px;color:var(--muted);border-left:3px solid var(--line);padding-left:12px;margin:14px 0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:var(--card);border:1px solid var(--line);border-radius:5px;padding:1px 5px}
pre{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:12px 14px;overflow-x:auto;margin:12px 0;line-height:1.5}
pre code{background:none;border:0;padding:0}
.btn{display:inline-block;background:var(--accent);color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
.btn:hover{background:#9a3412}
.bp-del{background:none;border:1px solid var(--line);color:var(--muted);border-radius:7px;width:32px;height:32px;cursor:pointer;font-size:17px;line-height:1;padding:0}
.bp-del:hover{border-color:var(--accent);color:var(--accent)}
footer.site{border-top:1px solid var(--line);margin-top:36px;padding:22px 0;color:var(--muted);font-size:14px}
footer.site a{color:var(--muted)}
footer.site .fcol{display:flex;flex-wrap:wrap;gap:6px 14px;margin:10px 0}
footer.site .fcol .fh{width:100%;font-weight:600;color:var(--fg);font-size:13px;margin-bottom:2px}
@media(max-width:520px){h1{font-size:25px}nav a{margin-left:10px}}
.print-only{display:none}
@media print{
header.site,footer.site,.no-print,details{display:none !important}
.print-only{display:block}
main{padding:0}.wrap{max-width:none;padding:0}
h1{font-size:20px;margin:0 0 2px}h2{font-size:13px;margin:8px 0 2px}
table{font-size:10px;margin:4px 0}th,td{padding:2px 6px}
a{color:inherit;text-decoration:none}
.print-cols{columns:2;column-gap:22px}.print-cols section{break-inside:avoid}
}
`;

function layout(opts) {
  const { title, description, canonical, bodyHtml, jsonLd, cfg } = opts;
  // Social share card: pages can pass their own og (image/w/h/alt); default is the site card.
  const og = opts.og || { image: "/assets/og-default.png", w: 1200, h: 630, alt: "ExactCup — accurate cups to grams for 80+ ingredients" };
  // Capture the page's meaningful content for per-page lastmod hashing (see DATES_FILE).
  PAGE_CONTENT[canonical] = JSON.stringify([title, description, bodyHtml, jsonLd, cfg]);
  const url = SITE.baseUrl + canonical;
  const ldList = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
  const ld = ldList.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("");
  const cfgScript = cfg ? `<script type="application/json" id="cfg">${JSON.stringify(cfg)}</script><script src="/assets/app.js" defer></script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE.baseUrl}${og.image}">
<meta property="og:image:width" content="${og.w}">
<meta property="og:image:height" content="${og.h}">
<meta property="og:image:alt" content="${esc(og.alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE.baseUrl}${og.image}">
<meta name="robots" content="index,follow,max-image-preview:large">
${SITE.googleVerify ? `<meta name="google-site-verification" content="${esc(SITE.googleVerify)}">` : ""}
<style>${CSS}</style>
${ld}
</head>
<body>
<header class="site"><div class="wrap">
<a class="brand" href="/">Exact<span>Cup</span></a>
<nav>
<a href="/cups-to-grams/">Cups&nbsp;→&nbsp;Grams</a>
<a href="/recipe-scaler/">Scaler</a>
<a href="/oven-temperature-converter/">Oven&nbsp;Temp</a>
</nav>
</div></header>
<main><div class="wrap">
${bodyHtml}
</div></main>
<footer class="site"><div class="wrap">
<p><strong>${SITE.brand}</strong> — ${SITE.tagline}.</p>
<nav class="fcol"><span class="fh">Calculators &amp; converters</span>${ALL_TOOLS.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join("")}</nav>
<nav class="fcol"><span class="fh">Conversion charts</span><a href="/cups-to-grams/">All ingredients</a>${Object.keys(DATA.categories).map((k) => `<a href="/${k}-conversion-chart/">${esc(catName(k))}</a>`).join("")}</nav>
<p style="font-size:12px">Conversions are approximate; ingredient weights vary by brand, humidity, and how you measure. For best baking results, weigh with a kitchen scale. Open data: <a href="/ingredient-density-data/">ingredient density dataset</a> (CC BY 4.0) · <a href="/embed/">embed our converter</a> &middot; <a href="/api/">free JSON API</a>.</p>
</div></footer>
${cfgScript}
</body>
</html>`;
}

// ---------- page builders ----------
function conversionTable(gpc) {
  const rows = FRACTIONS.map(([label, c]) => {
    const g = gpc * c;
    return `<tr><td>${label} cup</td><td class="num">${g2(g)} g</td><td class="num">${g2(g / OZ)} oz</td><td class="num">${g2(c * 16)} tbsp</td></tr>`;
  }).join("");
  return `<table><thead><tr><th>Cups</th><th>Grams</th><th>Ounces</th><th>Tablespoons</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Butter is sold in US sticks — a huge distinct query class ("1 1/2 sticks of
// butter in grams", "2 sticks in cups"). Only rendered on the butter page.
// 1 stick = 1/2 cup = 8 tbsp = gpc/2 grams (113.5 g at 227 g/cup).
const BUTTER_STICKS = [
  ["½ stick", 0.5, "¼ cup"],
  ["1 stick", 1, "½ cup"],
  ["1½ sticks", 1.5, "¾ cup"],
  ["2 sticks", 2, "1 cup"],
  ["3 sticks", 3, "1½ cups"],
  ["4 sticks (1 lb)", 4, "2 cups"],
];
function butterSticksTable(gpc) {
  const rows = BUTTER_STICKS.map(([label, s, cup]) => {
    const g = s * gpc / 2;
    return `<tr><td>${label}</td><td>${cup}</td><td class="num">${g2(s * 8)}</td><td class="num">${g2(g)} g</td><td class="num">${g2(g / OZ)} oz</td></tr>`;
  }).join("");
  return `<table><thead><tr><th>Sticks</th><th>Cups</th><th>Tbsp</th><th>Grams</th><th>Ounces</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Round gram amounts people actually search ("250g flour in cups").
const GRAM_AMOUNTS = [10, 25, 50, 75, 100, 125, 150, 200, 250, 300, 500];
// Cups to 2 dp (reverse direction reads better as a decimal than a fraction).
function cups2(n) { return Math.round(n * 100) / 100; }
function gramsToCupsTable(gpc) {
  const rows = GRAM_AMOUNTS.map((g) => {
    const cups = g / gpc;
    return `<tr><td>${g} g</td><td class="num">${cups2(cups)} cups</td><td class="num">${g2(cups * 16)} tbsp</td><td class="num">${g2(g / OZ)} oz</td></tr>`;
  }).join("");
  return `<table><thead><tr><th>Grams</th><th>Cups</th><th>Tablespoons</th><th>Ounces</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Rice is bought by variety name but weighed by grain length. USDA FoodData
// Central publishes cup weights per grain class (long 185 g, medium 195 g,
// short 200 g, brown long 185 g, brown medium 190 g, wild 160 g, instant 95 g);
// basmati and jasmine are long-grain, arborio/carnaroli and sushi rice are
// short/medium. Only rendered on the white-rice page. Half-cup and 100 g
// columns are computed, never typed.
const RICE_TYPES = [
  ["White rice, long-grain (this page)", 185, false],
  ["Basmati (long-grain)", 185, true],
  ["Jasmine (long-grain)", 185, true],
  ["White rice, medium-grain (Calrose)", 195, false],
  ["White rice, short-grain / sushi rice", 200, false],
  ["Arborio, carnaroli & risotto rice", 200, true],
  ["Brown rice, long-grain", 185, false],
  ["Brown rice, medium-grain", 190, false],
  ["Wild rice (a grass seed, not rice)", 160, false],
  ["Instant / precooked rice, dry", 95, false],
];
// Chocolate is sold by piece size, and the piece size is what changes the cup
// weight (chips bridge and trap air; smaller and larger pieces pack differently).
// Every figure is USDA FoodData Central, measured per cup: semisweet chips
// "1 cup chips (6 oz package)" 168 g, "1 cup mini chips" 173 g, "1 cup large
// chips" 182 g (#167976); milk chocolate "1 cup chips" 168 g (#167587); white
// chocolate "1 cup chips" 170 g (#167571); unsweetened baking chocolate
// "1 cup, grated" 132 g (#167568); cocoa powder 86 g (#169593). Rows carrying a
// slug pull their weight from ingredients.json so this table can never drift
// from the pages it links to. Only rendered on the chocolate-chips page.
const CHOCOLATE_TYPES = [
  ["Chocolate chips, standard (semisweet or dark)", { slug: "chocolate-chips" }, null],
  ["Mini chocolate chips", 173, null],
  ["Chocolate chunks / large chips", 182, null],
  ["Milk chocolate chips", 168, null],
  ["White chocolate chips", { slug: "white-chocolate-chips" }, "/cups-to-grams/white-chocolate-chips/"],
  ["Chocolate, grated or shaved from a bar", 132, null],
  ["Cocoa powder, unsweetened", { slug: "cocoa-powder" }, "/cups-to-grams/cocoa-powder/"],
];
function chocolateTypesTable() {
  const rows = CHOCOLATE_TYPES.map(([label, w, href]) => {
    const g = typeof w === "number" ? w : ingBySlug(w.slug).gramsPerCup;
    const cell = href ? `<a href="${href}">${label}</a>` : label;
    return `<tr><td>${cell}</td><td class="num">${g2(g)} g</td><td class="num">${g2(g / 2)} g</td><td class="num">${g2(g / 4)} g</td><td class="num">${cups2(100 / g)} cups</td></tr>`;
  }).join("");
  return `<table><thead><tr><th>Chocolate</th><th>1 US cup</th><th>1/2 cup</th><th>1/4 cup</th><th>100 g =</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// US chocolate-chip bag sizes, taken from the package weights printed in USDA's
// Branded Foods data (Nestle and store brands: 6 oz/170 g, 9 oz/255 g,
// 10 oz/283 g, 12 oz/340 g, 24 oz/680 g). Grams and cups are both computed —
// ounces x 28.3495, then divided by the page's cup weight — so the classic
// "one 12 oz bag = 2 cups" falls out of the data rather than being asserted.
const CHIP_BAGS = [6, 9, 10, 12, 24];
function chipBagsTable(gpc) {
  const rows = CHIP_BAGS.map((oz) => {
    const g = oz * OZ;
    const c = cups2(g / gpc);
    return `<tr><td>${oz} oz bag</td><td class="num">${Math.round(g)} g</td><td class="num">${c} cup${c === 1 ? "" : "s"}</td><td class="num">${g2(g / gpc * 16)} tbsp</td></tr>`;
  }).join("");
  return `<table><thead><tr><th>Bag size</th><th>Grams</th><th>Cups</th><th>Tablespoons</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function riceTypesTable() {
  const rows = RICE_TYPES.map(([label, g, approx]) =>
    `<tr><td>${label}</td><td class="num">${approx ? "~" : ""}${g2(g)} g</td><td class="num">${approx ? "~" : ""}${g2(g / 2)} g</td><td class="num">${cups2(100 / g)} cups</td></tr>`
  ).join("");
  return `<table><thead><tr><th>Rice (uncooked)</th><th>1 US cup</th><th>1/2 cup</th><th>100 g =</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Genuinely-relevant tool links per ingredient category. Also flows crawl
// equity from the most-crawled cluster (ingredient pages) to the tool pages,
// which are otherwise only linked from the homepage. Every tool page appears in
// at least one category list so the whole tool set gets internal inlinks.
const CATEGORY_TOOLS = {
  flour: [["/pizza-dough-calculator/", "Pizza Dough Calculator"], ["/bakers-percentage-calculator/", "Baker's Percentage Calculator"], ["/sourdough-hydration-calculator/", "Sourdough Hydration Calculator"], ["/yeast-converter/", "Yeast Converter"]],
  sugar: [["/sugar-to-honey/", "Sugar to Honey Conversion"], ["/recipe-scaler/", "Recipe Scaler"], ["/recipe-halving-chart/", "Recipe Halving Chart"], ["/volume-converter/", "Volume Converter"], ["/cups-to-ml/", "Cups to mL Converter"]],
  dairy: [["/butter-converter/", "Butter Converter"], ["/butter-to-oil/", "Butter to Oil Conversion"], ["/recipe-scaler/", "Recipe Scaler"], ["/recipe-halving-chart/", "Recipe Halving Chart"], ["/cups-to-ml/", "Cups to mL Converter"]],
  baking: [["/bakers-percentage-calculator/", "Baker's Percentage Calculator"], ["/oven-temperature-converter/", "Oven Temperature Converter"], ["/air-fryer-conversion-calculator/", "Air Fryer Converter"], ["/pan-size-converter/", "Pan Size Converter"]],
  grain: [["/portion-calculator/", "Portion Calculator"], ["/recipe-scaler/", "Recipe Scaler"], ["/recipe-halving-chart/", "Recipe Halving Chart"]],
};

function ingredientPage(ing) {
  const gpc = ing.gramsPerCup;
  const related = DATA.ingredients.filter((i) => i.category === ing.category && i.slug !== ing.slug).slice(0, 6);
  // Reverse hub + tablespoon converter are relevant to every ingredient; category tools add depth.
  // The cake-flour substitute is linked only from the two flours it's actually made of,
  // and the thickener converter only from the starches (+ AP flour) people thicken with.
  const toolLinks = [
    ...(ing.slug === "cake-flour" || ing.slug === "all-purpose-flour" ? [["/cake-flour-substitute/", "Cake Flour Substitute"]] : []),
    ...(["cornstarch", "arrowroot-powder", "tapioca-flour", "all-purpose-flour"].includes(ing.slug) ? [["/cornstarch-to-flour/", "Cornstarch to Flour Thickener"]] : []),
    ["/grams-to-cups/", "Grams to Cups Converter"], ["/tablespoons-to-grams/", "Tablespoons to Grams"], ...(CATEGORY_TOOLS[ing.category] || [])];
  const title = `${ing.name} Cups to Grams Converter | 1 Cup ${ing.name} in Grams`;
  const description = ing.slug === "butter"
    ? `How many grams is a cup of butter? 1 cup = ${g2(gpc)} g, 1 stick = ${g2(gpc / 2)} g, 1/2 cup = ${g2(gpc / 2)} g. Free butter converter with a full cups, sticks, tablespoons and grams chart.`
    : ing.slug === "semolina"
    ? `How many grams is a cup of semolina (rava, sooji)? 1 cup = ${g2(gpc)} g, 1/2 cup = ${g2(gpc / 2)} g, 1/4 cup = ${g2(gpc / 4)} g. Free cups-to-grams converter with a full conversion chart.`
    : ing.slug === "vegetable-oil"
    ? `How many grams is a cup of oil? 1 cup of vegetable oil = ${g2(gpc)} g, 1/2 cup = ${g2(gpc / 2)} g, 1/4 cup = ${g2(gpc / 4)} g — and all common cooking oils weigh about the same. Free converter with a full chart.`
    : ing.slug === "tahini"
    ? `How many grams is a cup of tahini? 1 cup = ${g2(gpc)} g, 1/2 cup = ${g2(gpc / 2)} g, 1/4 cup = ${g2(gpc / 4)} g — hulled or unhulled. Free cups-to-grams converter with a full conversion chart.`
    : ing.slug === "buttermilk"
    ? `How many grams does 1 cup of buttermilk weigh? About ${g2(gpc)} g (USDA measures 245 g), 1/2 cup = ${g2(gpc / 2)} g. Free converter, full chart, plus the milk + lemon juice substitute ratio.`
    : ing.slug === "heavy-cream"
    ? `How many grams is a cup of heavy cream? 1 cup = ${g2(gpc)} g, 1/2 cup = ${g2(gpc / 2)} g, 1/4 cup = ${g2(gpc / 4)} g. Free converter and chart — plus half-and-half, whipping and double cream weights.`
    : ing.slug === "white-rice"
    ? `How many grams is a cup of rice? 1 cup = ${g2(gpc)} g, 1/2 cup = ${g2(gpc / 2)} g, 100 g = ${cups2(100 / gpc)} cups. Full chart plus basmati, jasmine, arborio, brown and sushi rice weights.`
    : ing.slug === "chocolate-chips"
    ? `How many grams is a cup of chocolate chips? 1 cup = ${g2(gpc)} g, 1/2 cup = ${g2(gpc / 2)} g, and a 12 oz bag = ${cups2(12 * OZ / gpc)} cups. Full chart plus mini chips, chunks and every bag size in grams.`
    : ing.slug === "rolled-oats"
    ? `How many grams is a cup of oats? 1 cup = ${g2(gpc)} g, 1/2 cup = ${g2(gpc / 2)} g — rolled or quick. A 250 mL metric (NZ/AU) cup = ${Math.round(gpc / 236.588 * 250)} g. Full chart plus jumbo, porridge and steel-cut oat weights.`
    : `How many grams is a cup of ${ing.name.toLowerCase()}? 1 cup = ${g2(gpc)} g, 1/2 cup = ${g2(gpc / 2)} g, 1/4 cup = ${g2(gpc / 4)} g. Free cups-to-grams converter with a full conversion chart.`;
  const canonical = `/cups-to-grams/${ing.slug}/`;
  const low = ing.name.toLowerCase();
  const faq = [
    [`How many grams is 1 cup of ${low}?`, `1 US cup of ${low} weighs about ${g2(gpc)} grams.`],
    [`How many grams is 3/4 cup of ${low}?`, `Three quarters of a US cup of ${low} is about ${g2(gpc * 0.75)} grams (12 tablespoons).`],
    [`How many grams is 2/3 cup of ${low}?`, `2/3 of a US cup of ${low} is about ${g2(gpc * 2 / 3)} grams.`],
    [`How many grams is 1/2 cup of ${low}?`, `Half a US cup of ${low} is about ${g2(gpc / 2)} grams — half of the ${g2(gpc)} g in a full cup.`],
    [`How many grams is 1/3 cup of ${low}?`, `A third of a US cup of ${low} is about ${g2(gpc / 3)} grams.`],
    [`How many grams is 1/4 cup of ${low}?`, `A quarter US cup of ${low} is about ${g2(gpc / 4)} grams (4 tablespoons).`],
    [`How many grams is 1 tablespoon of ${low}?`, `1 tablespoon of ${low} is about ${g2(gpc / 16)} grams (a cup is 16 tablespoons).`],
    [`How many grams is 1 1/4 cups of ${low}?`, `1 1/4 US cups of ${low} weigh about ${g2(gpc * 1.25)} grams.`],
    [`How many grams is 1 1/2 cups of ${low}?`, `1 1/2 US cups of ${low} weigh about ${g2(gpc * 1.5)} grams — one full cup (${g2(gpc)} g) plus half a cup (${g2(gpc / 2)} g).`],
    [`How many grams is 2 cups of ${low}?`, `2 US cups of ${low} weigh about ${g2(gpc * 2)} grams.`],
    [`How many cups is 100 grams of ${low}?`, `100 grams of ${low} is about ${cups2(100 / gpc)} cups.`],
    [`How many cups is 250 grams of ${low}?`, `250 grams of ${low} is about ${cups2(250 / gpc)} cups (at ${g2(gpc)} g per cup).`],
    [`How many cups is 500 grams of ${low}?`, `500 grams of ${low} is about ${cups2(500 / gpc)} cups.`],
  ];
  if (ing.slug === "butter") {
    faq.push(
      [`How many grams is 1 cup of melted butter?`, `The same as solid: melting does not change the weight, so 1 cup of butter is about ${g2(gpc)} grams whether melted or solid (1/2 cup melted is about ${g2(gpc / 2)} g). For accuracy, measure the butter solid, then melt it.`],
      [`How many grams is 1 stick of butter?`, `1 US stick of butter is 1/2 cup — about ${g2(gpc / 2)} grams (8 tablespoons, 4 oz).`],
      [`How many grams is 1 1/2 sticks of butter?`, `1 1/2 sticks of butter is 3/4 cup — about ${g2(gpc * 0.75)} grams (12 tablespoons).`],
      [`How many grams is 2 sticks of butter?`, `2 sticks of butter is 1 cup — about ${g2(gpc)} grams (16 tablespoons, 8 oz).`],
      [`How many sticks of butter is 1 cup?`, `1 cup of butter is 2 sticks — each US stick is 1/2 cup, or about ${g2(gpc / 2)} grams.`],
    );
  }
  if (ing.slug === "corn-syrup") {
    const dens = (gpc / 236.588).toFixed(2);
    faq.push(
      [`What is the density of corn syrup in g/mL?`, `About ${dens} g/mL: a US cup is 236.59 mL and weighs about ${g2(gpc)} grams of corn syrup, so ${g2(gpc)} ÷ 236.59 ≈ ${dens} g/mL (${dens} g/cm³). Corn syrup is roughly 1.4 times as dense as water, which is why a cup of it weighs far more than a cup of water.`],
      [`How many grams is 100 mL of corn syrup?`, `100 mL of corn syrup weighs about ${Math.round(gpc / 236.588 * 100)} grams (at about ${dens} g/mL). A full US cup (236.59 mL) is about ${g2(gpc)} g.`],
    );
  }
  if (ing.slug === "vegetable-oil") {
    const dens = (gpc / 236.588).toFixed(2);
    faq.push(
      [`How many grams is 1 cup of oil?`, `About ${g2(gpc)} grams for any common liquid cooking oil. Per USDA data, vegetable, canola, soybean, corn, sunflower and melted coconut oil all weigh 218 g per US cup, with olive and peanut oil just behind at 216 g — so if a recipe only says "oil", the chart on this page applies within a gram or two.`],
      [`Do all cooking oils weigh the same per cup?`, `Very nearly. Every common liquid cooking oil falls between 216 and 218 grams per US cup (a density of 0.91–0.92 g/mL): vegetable, canola, soybean, corn, sunflower and melted coconut oil at 218 g, olive and peanut oil at 216 g. The differences are smaller than normal measuring error, so oils can be swapped by volume without re-weighing.`],
      [`Does a cup of oil weigh the same as a cup of water?`, `No — oil is lighter. A US cup of water weighs about 237 grams, while a cup of cooking oil weighs about ${g2(gpc)} grams (density ~${dens} g/mL). That density gap is exactly why oil floats on water, and why you can't use the water rule "1 mL = 1 g" for oil.`],
      [`How many grams is 100 mL of oil?`, `About ${Math.round(gpc / 236.588 * 100)} grams (at ~${dens} g/mL). To convert any millilitre amount of oil to grams, multiply the mL by ${dens}; a full US cup is 236.59 mL, or about ${g2(gpc)} g.`],
      [`Why do some baking charts say 1 cup of oil is 198 grams?`, `That figure is a rounding artifact, not a different measurement. King Arthur's ingredient chart lists vegetable oil as a rounded 7 oz (198 g) and uses the old 8-oz-cup convention (it lists water at 227 g, though a US cup of water really weighs 236.6 g). Measured density puts every common cooking oil at 0.91–0.92 g/mL, which works out to 216–218 g per US cup — the USDA value this page uses. 198 g/cup would imply a density of 0.84 g/mL, which no cooking oil has.`],
    );
  }
  if (ing.slug === "semolina") {
    const metricCup = Math.round(gpc / 236.588 * 250);
    faq.push(
      [`How many grams is 1 cup of rava (sooji)?`, `Rava and sooji are the Indian names for semolina, so the same weights apply: 1 US cup of rava is about ${g2(gpc)} grams, 1/2 cup about ${g2(gpc / 2)} g, 1/4 cup about ${g2(gpc / 4)} g. Measuring with a 250 mL metric cup instead? A level cup holds about ${metricCup} g.`],
      [`Is rava the same as semolina?`, `Yes. Rava (the South Indian name) and sooji or suji (the North Indian name) are granulated wheat semolina — the same ingredient this page converts. Whether the recipe is upma, kesari, sheera or rava dosa, the chart above applies.`],
      [`Is idli rava the same as semolina?`, `No — this is the one "rava" that is not semolina. Idli rava (rice rava) is ground parboiled rice: it is gluten-free, behaves completely differently, and weighs more per cup (roughly 180 g per US cup). Don't swap it with wheat rava in either direction.`],
      [`Does fine or coarse rava change the weight per cup?`, `Somewhat — grind changes how the grains pack, which is why published values genuinely spread from about 158 to 180 grams per US cup (King Arthur 163 g, USDA 167 g, Bob's Red Mill's label works out to 180 g). We use 163 g. For anything where the flour-to-liquid ratio matters, a kitchen scale beats any cup value.`],
      [`Is Cream of Wheat (farina) the same as semolina?`, `Not exactly. Farina — the product in the Cream of Wheat box — is granulated common wheat, while true semolina is milled from durum. Farina is an accepted stand-in for fine sooji in Indian sweets like kesari and halwa, but it is not a good substitute for durum semolina in pasta.`],
    );
  }
  if (ing.slug === "tahini") {
    const metricCup = Math.round(gpc / 236.588 * 250);
    faq.push(
      [`How many grams is 1/2 cup of hulled tahini?`, `About ${g2(gpc / 2)} grams — the same as any tahini. Hulled and unhulled tahini show no consistently documented weight difference per cup: brand nutrition labels for both types use the identical 30 g per 2-tablespoon serving. A 1/4 cup of hulled tahini is about ${g2(gpc / 4)} g and 1/3 cup about ${g2(gpc / 3)} g. Measuring with a 250 mL metric cup? A level cup holds about ${metricCup} g.`],
      [`Do hulled and unhulled tahini weigh the same per cup?`, `For kitchen purposes, yes — use the same chart for both. USDA's two tahini entries differ slightly (15 g per tablespoon for the common roasted hulled type vs 14 g for unroasted whole-seed), but real hulled and unhulled brands print identical serving weights, so the gap is smaller than measuring error. What genuinely differs is character: unhulled tahini is darker, coarser and noticeably more bitter, and the hulls carry several times the calcium of hulled tahini.`],
      [`Why do some charts say a cup of tahini is 240 grams?`, `Published weights honestly spread from about 224 to 256 grams per US cup. USDA lists 15 g per tablespoon (240 g/cup) and most brand labels round to 30 g per 2 tablespoons (also 240 g/cup), while King Arthur's ingredient chart lists 128 g per half-cup — the 256 g/cup this page uses. A real jar can swing more than that with oil separation, so stir thoroughly before measuring and weigh when the ratio matters.`],
      [`Is tahini the same as Chinese sesame paste?`, `No. Chinese sesame paste (zhi ma jiang) is made from deeply roasted unhulled seeds — much darker, thicker and stronger-tasting than tahini, which is ground from raw or lightly toasted hulled seeds. Tahini plus a little toasted sesame oil can stand in for it in noodle sauces, but the swap doesn't work in reverse. Black tahini is simply tahini made from black sesame seeds: earthier in flavor, but it measures the same (labels print the same 30 g per 2 tbsp).`],
      [`How much tahini does a cup of sesame seeds make?`, `About 1/2 cup, or roughly ${g2(gpc / 2)} grams. A US cup of sesame seeds weighs about 142 g and blends down to around half its volume of paste; the 2–4 tablespoons of neutral oil most homemade recipes add to loosen it can bring the yield closer to 3/4 cup.`],
    );
  }
  if (ing.slug === "buttermilk") {
    const metricCup = Math.round(gpc / 236.588 * 250);
    faq.push(
      [`How much does 1 cup of buttermilk weigh in grams?`, `About ${g2(gpc)} grams by King Arthur's ingredient chart — the value this page uses — while USDA's measured figure is 245 g per US cup, so published weights honestly run ${g2(gpc)}–245 g. A tablespoon of buttermilk is about 15 g, and a 250 mL metric cup holds about ${metricCup} g. For batters where the acid must balance the baking soda, weighing beats the cup either way.`],
      [`How much butter is in a cup of buttermilk?`, `None — zero grams. Despite the name, buttermilk contains no butter: modern commercial buttermilk is simply milk fermented with lactic-acid bacteria, and at roughly 1% fat it is actually leaner than whole milk (3.25%). The name survives from traditional buttermilk, the thin liquid left behind after churning cream into butter — the butter went into the butter, not the buttermilk.`],
      [`How do I substitute milk for buttermilk?`, `Stir 1 tablespoon (15 g) of lemon juice or white vinegar into 1 cup of milk and let it stand 5–15 minutes until slightly thickened, then use it cup for cup. No acid on hand? King Arthur's alternative is 1 3/4 teaspoons of cream of tartar dissolved in 1 cup of milk. America's Test Kitchen found plain yogurt thinned with milk (or kefir, straight) mimics real buttermilk's thickness better — especially in pancakes, where thin "clabbered milk" gives flatter results.`],
      [`Is buttermilk heavier than milk?`, `For kitchen purposes they weigh the same. USDA lists buttermilk at 245 g per US cup and whole milk at 244 g — a difference far smaller than measuring error — and King Arthur's chart gives both the same 8 oz (${g2(gpc)} g) figure. Buttermilk only pours thicker because fermentation sets some of the milk proteins, not because it is denser.`],
      [`How much baking soda does a cup of buttermilk neutralize?`, `The classic rule is about 1/2 teaspoon of baking soda per cup of buttermilk, and working recipes range from roughly 1/4 to 1/2 teaspoon — buttermilk's acidity (pH about 4.4–4.8) is what activates the soda. That is also why you can't swap plain milk in without adjusting the leavening: with no acid to react, the soda neither lifts nor loses its soapy taste.`],
    );
  }
  if (ing.slug === "heavy-cream") {
    faq.push(
      [`How much does a cup of half-and-half weigh?`, `About 242 grams per US cup — USDA's measured figure (2 tablespoons is about 30 g, matching brand labels). So 1/2 cup of half-and-half is about 121 g and 3 cups about 726 g. Half-and-half is a blend of milk and cream at 10.5–18% milkfat, and for weighing purposes it behaves like every other fluid dairy: within a few grams of the ${g2(gpc)} g this page uses per cup.`],
      [`Do heavy cream, whipping cream and half-and-half all weigh the same per cup?`, `For kitchen purposes, yes — use one chart for all of them. USDA's measured cup weights sit within 238–242 g across the whole family (heavy cream 238 g, whipping cream 239 g, light cream 240 g, half-and-half 242 g), while King Arthur's chart rounds every fluid dairy to 227 g (8 oz). This page uses a mid-range 232 g; the whole published spread of 227–242 g is smaller than ordinary measuring error. What actually separates the creams is milkfat, not weight.`],
      [`What is the difference between heavy cream and whipping cream?`, `Milkfat, by legal definition. Under FDA standards of identity, heavy cream (also labeled heavy whipping cream) must be at least 36% milkfat, while plain "whipping cream" is light whipping cream at 30–36%. Both whip — anything at 30% or above will — but heavy cream whips up stiffer, holds its peaks longer, and is the safer choice for piping. By weight they are interchangeable: about ${g2(gpc)} g per cup either way.`],
      [`Is double cream the same as heavy cream?`, `Close, but not identical. Double cream is the UK's richest everyday cream at a minimum of 48% milkfat — well above US heavy cream's 36% minimum — while UK "whipping cream" (35% minimum) is the nearer match to American heavy cream. Double cream stands in for heavy cream cup for cup and weighs about the same, but its extra fat means it whips noticeably faster and over-whips into grainy near-butter more easily, so watch the mixer.`],
      [`How many grams is a cup of whipped cream?`, `About 120 grams — half the weight of a cup of liquid cream. Whipping folds in air, doubling the volume without changing the weight: USDA lists 1 cup of fluid heavy whipping cream as yielding 2 cups whipped, at about 120 g per whipped cup. Plan on 1 cup of liquid cream for every 2 cups of whipped cream a recipe needs. And it must be real whipping or heavy cream: below about 30% milkfat (half-and-half, light cream), the foam won't hold.`],
    );
  }
  if (ing.slug === "rolled-oats") {
    const metricCup = Math.round(gpc / 236.588 * 250);
    const halfMetricCup = Math.round(gpc / 236.588 * 125);
    faq.push(
      [`How many grams is 1 cup of oats?`, `About ${g2(gpc)} grams for old-fashioned rolled or quick oats measured in a US cup — the value this page uses. Published figures honestly spread from 80 to 98 g per cup (Quaker's label works out to 80 g, USDA lists 81 g, King Arthur 89 g, Bob's Red Mill 98 g), so any value in that band is defensible. Steel-cut oats are a different story at about 160 g per cup, and a 250 mL metric cup of rolled oats holds about ${metricCup} g.`],
      [`How much does half a cup of wholemeal oats weigh in NZ?`, `About ${halfMetricCup} grams. New Zealand (and Australian) recipes use the 250 mL metric cup, so a full metric cup of rolled oats is about ${metricCup} g and half a metric cup about ${halfMetricCup} g. The "wholegrain" or "wholemeal" oats on NZ packs like Harraways are ordinary wholegrain rolled oats — all rolled oats keep the bran and germ — so they weigh the same. Using a US half cup instead? That's about ${g2(gpc / 2)} g.`],
      [`Do quick oats weigh the same as old-fashioned rolled oats?`, `Yes — use the same chart for both. King Arthur's ingredient chart lists old-fashioned and quick-cooking oats as a single entry (89 g per cup), and Quaker's labels give both the identical 40 g per half-cup serving. Quick oats are just rolled oats cut smaller and rolled thinner, which changes cooking time and baked texture, not weight per cup. Instant oatmeal is sold in packets instead — typically 28 g each.`],
      [`What are jumbo oats and porridge oats in grams?`, `They're UK names on the same family tree. Jumbo oats are thick flakes rolled from the whole groat — the match for US old-fashioned or thick-rolled oats, and the thick flakes run heavier (King Arthur's own thick-rolled oats weigh 113 g per cup). Porridge oats are the standard smaller UK flake, rolled from cut groats — use the regular ~${g2(gpc)} g chart. Pinhead oatmeal is steel-cut oats (about 160 g per cup), and Scottish oatmeal is stone-ground, not flaked.`],
      [`How much does a cup of cooked oatmeal weigh?`, `About 234 grams per US cup (USDA, cooked with water) — much more than the ${g2(gpc)} g of a cup of dry oats, because oatmeal is mostly absorbed water. One cup of dry rolled oats (${g2(gpc)} g) cooks up to roughly 2 cups of porridge. When a US baking recipe calls for "1 cup oatmeal" in cookies or crumble, it means dry rolled oats, not cooked porridge.`],
    );
  }
  if (ing.slug === "chocolate-chips") {
    const bag12 = 12 * OZ;
    faq.push(
      [`How many grams is half a cup of chocolate chips?`, `About ${g2(gpc / 2)} grams — half of the ${g2(gpc)} g in a full US cup. A third of a cup is about ${g2(gpc / 3)} g and a quarter cup about ${g2(gpc / 4)} g, which matches the 42 g that Nestle's own label prints for a 1/4-cup serving. Piece size shifts it a little: USDA measures mini chips at 173 g per cup and large chips or chunks at 182 g, against 168 g for standard morsels, so half a cup of chunks is nearer 91 g.`],
      [`How many cups is 440 grams of chocolate chips?`, `About ${cups2(440 / gpc)} cups — call it 2 1/2 cups plus a tablespoon and a half. At ${g2(gpc)} g per US cup, 440 g is roughly ${g2(440 / OZ)} oz, so it is one standard 12 oz bag (${cups2(bag12 / gpc)} cups) plus about ${cups2((440 - bag12) / gpc)} of a cup more.`],
      [`How many cups is a 12 oz bag of chocolate chips?`, `Exactly ${cups2(bag12 / gpc)} cups. A 12 oz bag holds ${Math.round(bag12)} g and a US cup of chips weighs about ${g2(gpc)} g (6 oz) — which is why so many cookie recipes call for "1 bag" and "2 cups" interchangeably. The other US sizes: a 6 oz bag is 1 cup, a 9 oz bag ${cups2(9 * OZ / gpc)} cups, a 10 oz bag ${cups2(10 * OZ / gpc)} cups and a 24 oz bag ${cups2(24 * OZ / gpc)} cups.`],
      [`Do mini chips and chocolate chunks weigh the same as regular chocolate chips?`, `Close, but not identical — and the difference is not in the direction most people guess. USDA measured all three: standard chips 168 g per cup, mini chips 173 g, and large chips or chunks 182 g. Both the smaller and the bigger pieces pack heavier than a standard morsel, because standard chips are the shape that bridges and traps the most air. All of it sits inside a 15-gram band, so for a cookie dough the swap is free; for ganache or a bark where the chocolate-to-cream ratio matters, weigh.`],
      [`Why does the bag say 1 tablespoon of chocolate chips is 15 grams?`, `Because the tablespoon on a nutrition label does not scale up to a cup. Nearly every brand prints a serving of 1 tablespoon at 14–15 g (Nestle, Wegmans, Publix, Target and the store brands all do), but 16 of those would be 224–240 g — far more than the ${g2(gpc)} g a measured cup actually holds. Nestle's own 3 oz bag settles it by printing the other unit: 1/4 cup = 42 g, or 168 g per cup, matching USDA's measured figure. Chips simply cannot level in a spoon the way they settle in a cup, so when a recipe calls for cups, use the cup line on the chart above.`],
      [`How many grams is 1 square of baking chocolate?`, `About 29 grams — the classic Baker's square is 1 oz, and USDA lists it at 29 g. So a recipe calling for 4 squares of unsweetened chocolate wants roughly 116 g, which you can replace with the same weight of chips only if the sweetness works out (chips are sweetened, baking squares are not). Chopping a bar changes its cup weight completely: USDA measures grated chocolate at just 132 g per cup against 182 g for chunks, so a "cup of chopped chocolate" can swing 50 g on chop size alone. Weigh bars; don't cup them.`],
    );
  }
  if (ing.slug === "white-rice") {
    const cookerCup = Math.round(gpc / 236.588 * 180);
    const cookerCupShort = Math.round(200 / 236.588 * 180);
    faq.push(
      [`How many grams is half a cup of rice?`, `About ${g2(gpc / 2)} grams of uncooked long-grain white rice — half of the ${g2(gpc)} g in a full US cup (USDA). Grain length shifts it a little: half a cup of medium-grain rice is about 97.5 g and short-grain or sushi rice about 100 g, while brown long-grain rice matches white at ${g2(gpc / 2)} g. Using a 250 mL metric cup (UK, Australia, New Zealand)? Half of one holds about ${Math.round(gpc / 236.588 * 125)} g.`],
      [`How many cups is 100 grams of rice?`, `About ${cups2(100 / gpc)} cups of uncooked long-grain white rice — a half cup plus roughly 1 tablespoon. For other kinds: 100 g of medium-grain rice is about ${cups2(100 / 195)} cups, short-grain or sushi rice about ${cups2(100 / 200)} cups, brown medium-grain about ${cups2(100 / 190)} cups, and dry instant rice about ${cups2(100 / 95)} cups (it is by far the lightest per cup). All of these are uncooked weights.`],
      [`Do basmati and jasmine rice weigh the same as regular white rice?`, `Yes, near enough to use one chart. Both are long-grain varieties, and USDA measures rice by grain length rather than variety name: long-grain white rice is ${g2(gpc)} g per US cup, so basmati and jasmine both land at about ${g2(gpc)} g (brand labels using a 1/4-cup serving mostly print 45–50 g, which works out to 180–200 g per cup). Risotto rices — arborio and carnaroli — are the short and medium-grain end, closer to 195–200 g per cup.`],
      [`How much rice does a rice cooker cup hold?`, `A rice-cooker cup is 180 mL — the Japanese gō, not a US cup — so it is about 3/4 of a US cup and holds roughly ${cookerCup} g of long-grain rice or ${cookerCupShort} g of short-grain Japanese rice. That is why a "5-cup" cooker is not five US cups: rice-cooker capacities count 180 mL cups of uncooked rice. Use the cup that came with the machine, since its water lines are calibrated to it.`],
      [`Should I weigh rice before or after rinsing?`, `Before. Rinsing washes off surface starch but also leaves water clinging to and soaking into the grains — published soaking figures put the weight gain at roughly 20% once rice sits in water — so drained rice weighs unpredictably more than the recipe means. Measure or weigh dry (${g2(gpc)} g per cup), then rinse. For the same reason, keep rinsing water out of your cooking-water measurement.`],
      [`How many grams is 1 cup of instant rice?`, `About 95 grams (USDA) — barely half the ${g2(gpc)} g of regular uncooked rice. Instant or "minute" rice is pre-cooked and dehydrated, so its grains are puffed and full of air. Never swap it by weight with regular rice: a cup of instant rice is about the same amount of food as half a cup of regular rice, and it needs far less water and time.`],
    );
  }
  const jsonLd = [
    faqLd(faq),
    breadcrumbLd([
      ["Cups to Grams", "/cups-to-grams/"],
      [catName(ing.category), `/${ing.category}-conversion-chart/`],
      [ing.name, canonical],
    ]),
  ];
  const body = `
<nav style="font-size:13px;color:var(--muted);margin-bottom:6px"><a href="/cups-to-grams/">Cups to Grams</a> › <a href="/${ing.category}-conversion-chart/">${esc(catName(ing.category))}</a> › ${esc(ing.name)}</nav>
<h1>${esc(ing.name)}: Cups to Grams</h1>
<p class="lead">1 cup of ${ing.name.toLowerCase()} weighs about <strong>${g2(gpc)} grams</strong>. Convert any amount instantly below.</p>
<div class="calc">
  <div class="row">
    <div class="field"><label for="amount">Amount</label><input id="amount" type="number" inputmode="decimal" value="1" min="0" step="any"></div>
    <div class="field" style="max-width:140px"><label for="unit">Unit</label><select id="unit"><option value="cups">cups</option><option value="tbsp">tablespoons</option><option value="tsp">teaspoons</option></select></div>
    <div class="field"><label for="grams">Grams</label><input id="grams" type="number" inputmode="decimal" step="any"></div>
  </div>
  <div class="result"><div class="big" id="out-grams">—</div><div class="sub" id="out-oz">—</div></div>
</div>
<h2>${esc(ing.name)} conversion chart</h2>
${conversionTable(gpc)}
<p class="note">Based on ${g2(gpc)} g per US cup. Weights vary with brand and measuring method — for precise baking, use a scale.</p>${ing.slug === "butter" ? `
<h2>Butter sticks to grams and cups</h2>
<p>US butter is sold in sticks. One stick is 1/2 cup (8 tablespoons) and weighs about ${g2(gpc / 2)} grams. Here is how the common stick amounts convert.</p>
${butterSticksTable(gpc)}
<p class="note">1 US stick = 1/2 cup = 8 tbsp = ${g2(gpc / 2)} g = 4 oz. A 1 lb box holds 4 sticks (2 cups). European butter is usually sold in 250 g blocks instead of sticks.</p>` : ""}
<h2>Grams to cups: ${esc(ing.name.toLowerCase())}</h2>
<p>Working backwards from a weight? Here is how common gram amounts of ${ing.name.toLowerCase()} convert to cups (at ${g2(gpc)} g per cup).</p>
${gramsToCupsTable(gpc)}
${ing.blurb ? `<h2>Measuring ${esc(ing.name.toLowerCase())} accurately</h2>\n<p>${esc(ing.blurb)}</p>` : ""}${ing.slug === "semolina" ? `
<h2>Semolina, rava and sooji: the same ingredient</h2>
<p>If your recipe says <strong>rava</strong>, <strong>sooji</strong> or <strong>suji</strong>, this page applies as written: they are the Indian names for granulated wheat semolina — <em>sooji/suji</em> in the North, <em>rava</em> in the South. So <strong>1 cup of rava is about ${g2(gpc)} g</strong>, 1/2 cup about ${g2(gpc / 2)} g, 1/4 cup about ${g2(gpc / 4)} g, and the full chart above works for upma, kesari, sheera and rava dosa alike. Using a 250 mL metric cup rather than the US cup? Figure about ${Math.round(gpc / 236.588 * 250)} g per level cup.</p>
<p>Grade names vary by region, so go by the dish: fine grades (chiroti rava, fine sooji) are for smooth sweets — kesari, sheera/halwa, rava laddu — while medium and coarser grades (upma or Bombay rava, and the browner bansi rava) are for upma and rava dosa. Grind also changes how the grains pack, which is why published cup weights honestly spread from about <strong>158 to 180 g per US cup</strong> (King Arthur 163 g, USDA 167 g, Bob's Red Mill's label works out to 180 g). We use 163 g; when the ratio matters, weigh.</p>
<p>Two look-alikes to watch. <strong>Idli rava is not semolina</strong> — it's ground parboiled rice, gluten-free and heavier (roughly 180 g per cup), so never swap it with wheat rava. And American <strong>Cream of Wheat (farina)</strong> is granulated common wheat, not durum: fine for Indian sweets in place of fine sooji, wrong for durum-semolina pasta. One last trap — Indian rava is often sold pre-roasted, Western semolina never is, so dry-roast plain semolina before making upma or kesari.</p>` : ""}${ing.slug === "vegetable-oil" ? `
<h2>Recipe just says "oil"? Every cooking oil weighs about the same</h2>
<p>If a recipe calls for plain <strong>oil</strong> — no type given — this page applies as written. Per USDA data, every common liquid cooking oil weighs between <strong>216 and 218 g per US cup</strong> (a density of 0.91–0.92 g/mL), a spread smaller than ordinary measuring error. So <strong>1 cup of oil is about ${g2(gpc)} g</strong>, 1/2 cup about ${g2(gpc / 2)} g and 1/4 cup about ${g2(gpc / 4)} g, whether you pour vegetable, canola, sunflower or corn oil.</p>
<table><thead><tr><th>Oil</th><th>Grams per US cup</th><th>g/mL</th></tr></thead><tbody>
<tr><td>Vegetable / soybean oil</td><td class="num">218 g</td><td class="num">0.92</td></tr>
<tr><td>Canola oil</td><td class="num">218 g</td><td class="num">0.92</td></tr>
<tr><td>Sunflower oil</td><td class="num">218 g</td><td class="num">0.92</td></tr>
<tr><td>Corn oil</td><td class="num">218 g</td><td class="num">0.92</td></tr>
<tr><td><a href="/cups-to-grams/coconut-oil/">Coconut oil</a> (melted)</td><td class="num">218 g</td><td class="num">0.92</td></tr>
<tr><td><a href="/cups-to-grams/olive-oil/">Olive oil</a></td><td class="num">216 g</td><td class="num">0.91</td></tr>
<tr><td>Peanut oil</td><td class="num">216 g</td><td class="num">0.91</td></tr>
</tbody></table>
<p>Note that oil is <em>lighter than water</em>: a US cup of water weighs about 237 g against oil's ~${g2(gpc)} g, which is why oil floats and why the handy water rule "1 mL = 1 g" overshoots for oil — multiply millilitres by 0.92 instead (100 mL ≈ ${Math.round(gpc / 236.588 * 100)} g). You may also meet <strong>198 g per cup</strong> on some baking charts: that's King Arthur's rounded 7-oz figure under the old 8-oz-cup convention, not a real density — measured, no cooking oil is that light.</p>
<p>Using oil <em>in place of butter</em>? That swap isn't 1:1 — the standard rule is 3 parts oil per 4 parts butter, so 1 stick of butter becomes 6 tablespoons (about 81 g) of oil. The <a href="/butter-to-oil/">butter to oil conversion</a> has the full chart in cups, grams and mL.</p>` : ""}${ing.slug === "tahini" ? `
<h2>Hulled, unhulled and black tahini: what changes (and what doesn't)</h2>
<p>Recipes rarely say which tahini they mean, and for the math it doesn't matter: <strong>hulled and unhulled tahini measure the same</strong>, so the chart above applies to both. <strong>1/2 cup of hulled tahini is about ${g2(gpc / 2)} g</strong>, 1/4 cup about ${g2(gpc / 4)} g, 1/3 cup about ${g2(gpc / 3)} g. USDA's two entries hint at a small gap (15 g per tablespoon for the common roasted hulled type, 14 g for unroasted whole-seed), but hulled and unhulled brands print identical serving weights — the difference is smaller than ordinary measuring error. Using a 250 mL metric cup rather than the US cup? Figure about ${Math.round(gpc / 236.588 * 250)} g per level cup.</p>
<p>What does change is the character. Unhulled (whole-seed) tahini is darker, coarser and distinctly bitter because the hulls come along for the grind — and those hulls carry several times the calcium, iron and fiber of hulled tahini. Hulled is the mild, pourable style most hummus and cookie recipes assume. On the weight itself, published values honestly spread from about <strong>224 to 256 g per US cup</strong>: USDA works out to 240 g, most brand labels round to 240 g (30 g per 2 tbsp), and King Arthur's chart gives 256 g — the value we use. A settled jar splits into a light sesame-oil layer (about 0.92 g/mL) over dense solids, so an unstirred scoop can land either side of any published average. Stir until homogeneous, or better, weigh.</p>
<p>Two look-alikes to watch. <strong>Chinese sesame paste (zhi ma jiang) is not tahini</strong> — it's ground from deeply roasted unhulled seeds, so it's darker, thicker and far more intense; tahini plus a splash of toasted sesame oil approximates it, but the swap fails in reverse. <strong>Black tahini</strong> is true tahini made from black sesame — earthier tasting, same weight per cup. Making your own? A cup of <a href="/cups-to-grams/sesame-seeds/">sesame seeds</a> (about 142 g) blends down to roughly 1/2 cup of tahini, a bit more once you add oil to loosen it.</p>` : ""}${ing.slug === "buttermilk" ? `
<h2>No, there's no butter in buttermilk (and how to fake it with milk)</h2>
<p>Searching for the ratio of milk to butter in a cup of buttermilk? The honest answer is that <strong>buttermilk contains no butter at all</strong> — a cup of it is all cultured milk, zero grams butter. Modern commercial buttermilk is milk fermented with lactic-acid bacteria, typically around 1% fat — <em>leaner</em> than the whole <a href="/cups-to-grams/milk/">milk</a> it's made from (3.25%). The name is a fossil: traditional buttermilk was the thin liquid left over after churning cream into butter. On weight, <strong>1 cup of buttermilk is about ${g2(gpc)} g</strong> by King Arthur's chart convention (the value this page uses), while USDA's measured figure is <strong>245 g</strong> — so published weights honestly run ${g2(gpc)}–245 g per US cup. A tablespoon is about 15 g; a 250 mL metric cup holds about ${Math.round(gpc / 236.588 * 250)} g.</p>
<p>Out of buttermilk? The standard substitute is <strong>1 tablespoon (15 g) of lemon juice or white vinegar per 1 cup of milk</strong>, left to stand 5–15 minutes until it thickens slightly, used cup for cup. (Sources split on a trivial detail: King Arthur stirs the acid into a full cup of milk, while university extension charts put the acid in first and fill to the 1-cup line — the difference is one tablespoon of liquid and won't change a bake.) King Arthur's no-acid alternative is <strong>1 3/4 teaspoons of cream of tartar</strong> dissolved in a cup of milk. Worth knowing: America's Test Kitchen rates this "clabbered milk" the <em>weakest</em> of the substitutes — thinner batter, flatter pancakes — and prefers plain yogurt thinned with milk, or kefir straight across. Whatever you use, don't swap in plain milk untouched: in King Arthur's bake-off it produced the densest, palest results of all.</p>
<p>The acidity is the point, not a side effect. Buttermilk sits around pH 4.4–4.8, and that sourness is what fires the baking soda in pancakes, biscuits and soda bread — the classic pairing is about <strong>1/2 teaspoon of baking soda per cup of buttermilk</strong> (working recipes range roughly 1/4 to 1/2 tsp). It's the same acid-plus-soda chemistry behind <a href="/baking-powder-substitute/">substituting for baking powder</a>: lose the acid and the leavening math changes with it.</p>` : ""}${ing.slug === "heavy-cream" ? `
<h2>Heavy, whipping, half-and-half or double: every dairy cream weighs about the same</h2>
<p>Cartons use half a dozen names for fluid cream, but on the scale they are nearly interchangeable: every published weight falls between about <strong>227 and 242 g per US cup</strong> — a spread smaller than ordinary measuring error. USDA's measured figures cluster tightly (heavy cream 238 g, whipping cream 239 g, light cream 240 g, half-and-half 242 g), while King Arthur's chart rounds all fluid dairy, <a href="/cups-to-grams/milk/">milk</a> through heavy cream, to 227 g (8 oz). This page uses a mid-range <strong>${g2(gpc)} g</strong>, so <strong>half a cup of any dairy cream is about ${g2(gpc / 2)} g</strong>, a tablespoon about 15 g, and a 250 mL metric cup about ${Math.round(gpc / 236.588 * 250)} g. What genuinely separates the creams is milkfat, which US law defines exactly:</p>
<table><thead><tr><th>Cream</th><th>US milkfat (FDA)</th><th>USDA grams per cup</th></tr></thead><tbody>
<tr><td>Half-and-half</td><td class="num">10.5–18%</td><td class="num">242 g</td></tr>
<tr><td>Light cream (coffee / table cream)</td><td class="num">18–30%</td><td class="num">240 g</td></tr>
<tr><td>Whipping cream (light whipping)</td><td class="num">30–36%</td><td class="num">239 g</td></tr>
<tr><td>Heavy cream / heavy whipping cream</td><td class="num">36%+</td><td class="num">238 g</td></tr>
</tbody></table>
<p>British recipe in hand? UK names run on a different ladder: <strong>single cream</strong> is 18% fat minimum, <strong>whipping cream</strong> 35%, and <strong>double cream</strong> a rich 48% — so double cream is the usual stand-in for US heavy cream but noticeably fatter, and it whips faster (and over-whips into grainy near-butter sooner). Half-and-half, at the other end, is simply a blend of milk and cream; if a recipe calls for it, equal parts whole milk and light cream get you there, and 3 cups weigh about 726 g (USDA).</p>
<p>Whipping changes volume, not weight: air is free. USDA's own entry lists <strong>1 cup of fluid heavy whipping cream as yielding 2 cups whipped</strong>, which is why <strong>a cup of whipped cream weighs only about 120 g</strong> — and why recipes distinguish "1 cup cream, whipped" from "1 cup whipped cream" (the first gives you twice as much). One hard floor to remember: cream needs roughly <strong>30% milkfat or more to whip</strong> at all, so heavy and whipping cream foam up while half-and-half and light cream never will, no matter how long the mixer runs.</p>` : ""}${ing.slug === "rolled-oats" ? `
<h2>Quick, jumbo, porridge or wholegrain: which oats does your recipe mean?</h2>
<p>If a recipe just says <strong>oats</strong>, it almost always means these — old-fashioned rolled oats — and the chart above applies. <strong>1 cup of oats is about ${g2(gpc)} g</strong>, and quick-cooking oats weigh the same: King Arthur's chart lists old-fashioned and quick as one entry (89 g per cup), and Quaker's labels give both an identical 40 g per half-cup. Published cup weights honestly spread from about <strong>80 to 98 g</strong> (Quaker 80 g, USDA 81 g, King Arthur 89 g, Bob's Red Mill 98 g) because oat flakes bridge and trap air in the cup — we use ${g2(gpc)} g, mid-range. When the oat-to-liquid ratio matters, weigh.</p>
<table><thead><tr><th>Oat type</th><th>Grams per US cup</th></tr></thead><tbody>
<tr><td>Old-fashioned / rolled oats (this page)</td><td class="num">${g2(gpc)} g</td></tr>
<tr><td>Quick-cooking oats (same flake, cut smaller)</td><td class="num">${g2(gpc)} g</td></tr>
<tr><td>Thick-rolled / jumbo oats</td><td class="num">~113 g</td></tr>
<tr><td><a href="/cups-to-grams/steel-cut-oats/">Steel-cut oats</a> (pinhead, Irish)</td><td class="num">~160 g</td></tr>
<tr><td>Oat bran (raw, USDA)</td><td class="num">~94 g</td></tr>
<tr><td><a href="/cups-to-grams/oat-flour/">Oat flour</a> (spooned)</td><td class="num">92 g</td></tr>
<tr><td>Muesli (USDA average — mixes vary)</td><td class="num">~85 g</td></tr>
<tr><td>Oatmeal / porridge, cooked with water</td><td class="num">~234 g</td></tr>
</tbody></table>
<p>Measuring with a <strong>250 mL metric cup</strong> — the standard in New Zealand and Australia? A level metric cup of rolled oats holds about <strong>${Math.round(gpc / 236.588 * 250)} g</strong>, and half a metric cup about ${Math.round(gpc / 236.588 * 125)} g. The <strong>wholegrain (or "wholemeal") oats</strong> on NZ and Australian packs — Harraways, Uncle Tobys — are ordinary wholegrain rolled oats, not a different product: every rolled oat keeps its bran and germ, so the same weights apply. One more Down-Under trap: the Australian tablespoon is 20 mL (4 teaspoons), not the 15 mL US/NZ/UK spoon.</p>
<p>British bags use their own ladder of names. <strong>Porridge oats</strong> are the standard UK flake — rolled from cut groats, so smaller and faster-cooking than US old-fashioned, but measured with the same ~${g2(gpc)} g chart. <strong>Jumbo oats</strong> are thick flakes rolled from the whole groat (the US "thick-rolled" match — figure ~113 g per cup, King Arthur's own thick-rolled weight). <strong>Pinhead oatmeal</strong> is what Americans call <a href="/cups-to-grams/steel-cut-oats/">steel-cut oats</a>, and <strong>Scottish oatmeal</strong> is stone-ground meal in coarse, medium and fine grades. Cooking porridge rather than baking? A cup of dry oats (${g2(gpc)} g) swells to about 2 cups of cooked oatmeal at ~234 g per cup — the <a href="/dry-to-cooked/">dry-to-cooked converter</a> does that math for any amount.</p>` : ""}${ing.slug === "chocolate-chips" ? `
<h2>Half a cup, a whole bag, or 440 g: chocolate chips both ways</h2>
<p>Chocolate is the one baking ingredient people convert in <em>both</em> directions — a recipe asks for cups, but the chocolate arrives in a bag marked in grams or ounces. Both answers come off the same number: <strong>1 cup of chocolate chips is about ${g2(gpc)} g</strong>, so <strong>half a cup is about ${g2(gpc / 2)} g</strong>, a third of a cup ${g2(gpc / 3)} g, a quarter cup ${g2(gpc / 4)} g — and going the other way, <strong>440 g of chocolate chips is about ${cups2(440 / gpc)} cups</strong> (2 1/2 cups plus a tablespoon and a half), while 200 g is ${cups2(200 / gpc)} cups and 500 g is ${cups2(500 / gpc)} cups. The number that makes all of this easy to remember: <strong>a cup of chips weighs 6 oz</strong>, exactly the size of the smallest bag.</p>
${chipBagsTable(gpc)}
<p class="note">Bag sizes are the package weights printed on US chip bags (USDA Branded Foods). Grams and cups are computed from the ounce size at ${g2(gpc)} g per cup — the familiar "one 12 oz bag = 2 cups" falls straight out of it.</p>
<p>That bag ladder is why so many cookie recipes treat <strong>"1 bag" and "2 cups" as the same instruction</strong>: a 12 oz bag really does hold ${Math.round(12 * OZ)} g, or ${cups2(12 * OZ / gpc)} cups. Check the bag before you trust it, though: 10 oz (${Math.round(10 * OZ)} g, only ${cups2(10 * OZ / gpc)} cups) and 9 oz bags sit on the same shelf as the 12 oz standard, so an older recipe written around a 12 oz bag comes up as much as half a cup short if you tip in one smaller bag and call it done.</p>
<h2>Chips, minis, chunks or grated: what each kind weighs per cup</h2>
<p>Piece size, not chocolate type, is what moves the cup weight — and it moves in a direction most bakers guess wrong. USDA measured all three chip sizes: standard morsels come in <strong>lightest at 168 g per cup</strong>, with mini chips at 173 g and large chips or chunks at 182 g. The classic teardrop morsel is simply the shape that bridges best and traps the most air. Milk, semisweet and dark chips land within a couple of grams of each other, and so do white chocolate chips. This page uses ${g2(gpc)} g (6 oz), mid-band.</p>
${chocolateTypesTable()}
<p class="note">USDA FoodData Central measured cup weights (semisweet chips, mini chips and large chips; milk and white chocolate chips; grated baking chocolate). Rows linking to another page pull that page's own weight, so the numbers can't drift apart. Half-cup, quarter-cup and 100 g figures are computed.</p>
<p>Two rows behave differently from the rest. <strong>Grated or shaved chocolate is far lighter at about 132 g per cup</strong> — shavings are mostly air — while chunks hacked off the same bar run 182 g, so "1 cup of chopped chocolate" can swing 50 g on how finely you chop. That is the one case where you should ignore the cup entirely and weigh the bar (a standard Baker's square is 1 oz, 29 g). And <a href="/cups-to-grams/cocoa-powder/">cocoa powder</a>, at ${g2(ingBySlug("cocoa-powder").gramsPerCup)} g per cup, weighs half what chips do: it is a fluffy, sift-able powder, not a solid, so never swap the two by volume.</p>
<p>One last trap, and it catches almost everyone: <strong>don't multiply the tablespoon on the bag up to a cup</strong>. Brand labels put a serving at 1 tablespoon and 14–15 g, which would make a cup 224–240 g — nowhere near the ${g2(gpc)} g a measured cup holds. Nestle's own smaller bag prints the other unit and lands right on the data: 1/4 cup = 42 g, or 168 g per cup. Chips can't level in a spoon the way they settle in a cup, so use the cup line when a recipe says cups, and a scale when the chocolate-to-dough ratio actually matters — the <a href="/grams-to-cups/">grams to cups converter</a> and the <a href="/recipe-scaler/">recipe scaler</a> handle any amount in between.</p>` : ""}${ing.slug === "white-rice" ? `
<h2>Basmati, jasmine, arborio or sushi rice: what a cup of each weighs</h2>
<p>Rice is bought by variety name but weighed by grain length, and that is the whole trick to converting it. USDA publishes cup weights by grain class, not brand: <strong>long-grain white rice is ${g2(gpc)} g per US cup</strong> (the value this page uses), medium-grain 195 g and short-grain 200 g. So <strong>half a cup of rice is about ${g2(gpc / 2)} g</strong>, a quarter cup about ${g2(gpc / 4)} g, and <strong>100 g of rice is about ${cups2(100 / gpc)} cups</strong> — a half cup plus a tablespoon. Basmati and jasmine are long-grain, so they take the ${g2(gpc)} g line; arborio, carnaroli and Japanese sushi rice sit at the plump short and medium-grain end.</p>
${riceTypesTable()}
<p class="note">Uncooked weights. USDA FoodData Central for the grain classes; basmati, jasmine and risotto rices are mapped to their grain class (brand labels printing a 1/4-cup serving mostly run 45–52 g, or 180–208 g per cup). Half-cup and 100 g figures are computed from the cup weight.</p>
<p>Two rows above are worth a second look. <strong>Brown rice weighs the same as white</strong> at the same grain length (${g2(gpc)} g per cup long-grain, 190 g medium) — the bran adds cooking time and water, not weight — so recipes swap by volume or weight without recalculating. <strong>Instant rice is the outlier at about 95 g per cup</strong>, roughly half of regular rice: it is pre-cooked and dried, so its grains are puffed and airy. Swapping it cup for cup by weight is the single most common rice-conversion mistake. Wild rice, at 160 g per cup, is not really rice at all — it is the seed of an aquatic grass.</p>
<p>Cooking rather than baking? A <strong>rice-cooker cup is 180 mL</strong> (the Japanese <em>gō</em>), about three-quarters of a US cup — roughly <strong>${Math.round(gpc / 236.588 * 180)} g</strong> of long-grain rice or ${Math.round(200 / 236.588 * 180)} g of short-grain, which is why a "5-cup" cooker holds less than five US cups. A 250 mL metric cup (UK, Australia, New Zealand) holds about ${Math.round(gpc / 236.588 * 250)} g. And weigh rice <em>dry, before rinsing</em>: rinsed grains hold surface and absorbed water (soaking can add around 20% to the weight), so a drained cup is no longer ${g2(gpc)} g. Want the cooked amount instead? A cup of dry rice cooks up to roughly 3 cups — the <a href="/dry-to-cooked/">dry-to-cooked converter</a> does that math both ways, and the <a href="/portion-calculator/">portion calculator</a> turns it into grams of dry rice per person.</p>` : ""}
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
<h2>Other ${esc(catName(ing.category)).toLowerCase()}</h2>
<div class="chips">${related.map((r) => `<a href="/cups-to-grams/${r.slug}/">${esc(r.name)}</a>`).join("")}</div>
<p style="margin-top:10px"><a href="/${ing.category}-conversion-chart/">See the full ${esc(catName(ing.category).toLowerCase())} conversion chart →</a></p>
<h2>Related tools</h2>
<div class="chips">${toolLinks.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join("")}</div>
<p style="margin-top:10px"><a href="/cups-to-grams/">← All ingredient converters</a></p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "ingredient", gramsPerCup: gpc } }) };
}

function masterPage() {
  const title = "Cups to Grams Converter — Every Baking Ingredient | ExactCup";
  const description = "Free cups to grams converter for flour, sugar, butter and 30+ baking ingredients. Pick an ingredient and convert cups, tablespoons and teaspoons to grams instantly.";
  const canonical = "/cups-to-grams/";
  const cats = {};
  DATA.ingredients.forEach((i) => { (cats[i.category] = cats[i.category] || []).push(i); });
  const lists = Object.keys(cats).map((k) =>
    `<h3><a href="/${k}-conversion-chart/">${esc(catName(k))}</a></h3><div class="chips">${cats[k].map((i) => `<a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a>`).join("")}</div>`
  ).join("");
  const opts = DATA.ingredients.map((i) => `<option value="${i.slug}">${esc(i.name)}</option>`).join("");
  const cfg = { type: "master", ingredients: DATA.ingredients.map((i) => ({ slug: i.slug, gramsPerCup: i.gramsPerCup })) };
  const body = `
<h1>Cups to Grams Converter</h1>
<p class="lead">Because a cup of flour and a cup of honey are <em>not</em> the same weight. Pick your ingredient for an accurate conversion.</p>
<div class="calc">
  <div class="field" style="margin-bottom:10px"><label for="ingredient">Ingredient</label><select id="ingredient">${opts}</select></div>
  <div class="row">
    <div class="field"><label for="amount">Amount</label><input id="amount" type="number" inputmode="decimal" value="1" min="0" step="any"></div>
    <div class="field" style="max-width:140px"><label for="unit">Unit</label><select id="unit"><option value="cups">cups</option><option value="tbsp">tablespoons</option><option value="tsp">teaspoons</option></select></div>
    <div class="field"><label for="grams">Grams</label><input id="grams" type="number" inputmode="decimal" step="any"></div>
  </div>
  <div class="result"><div class="big" id="out-grams">—</div><div class="sub" id="out-oz">—</div></div>
</div>
<h2>Browse all ingredients</h2>
${lists}
<p style="margin-top:10px">Working backwards from a weight? Use the <a href="/grams-to-cups/">grams to cups converter</a>.</p>
<p class="note">Why ingredient matters: 1 cup of all-purpose flour ≈ 120 g, but 1 cup of granulated sugar ≈ 200 g and 1 cup of honey ≈ 340 g. Always convert by ingredient, not by a single ratio.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: {
    "@context": "https://schema.org", "@type": "WebApplication", name: "Cups to Grams Converter",
    applicationCategory: "UtilitiesApplication", operatingSystem: "Any", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  }, cfg }) };
}

// Reverse hub: grams -> cups. Mirrors the master converter but weight-first,
// targeting the large "Ng <ingredient> in cups" / "grams to cups" query class.
function gramsToCupsPage() {
  const title = "Grams to Cups Converter — Every Baking Ingredient | ExactCup";
  const description = "Free grams to cups converter for flour, sugar, butter and 30+ ingredients. Enter a weight in grams and get the exact cups — because every ingredient converts differently.";
  const canonical = "/grams-to-cups/";
  const cats = {};
  DATA.ingredients.forEach((i) => { (cats[i.category] = cats[i.category] || []).push(i); });
  const lists = Object.keys(cats).map((k) =>
    `<h3><a href="/${k}-conversion-chart/">${esc(catName(k))}</a></h3><div class="chips">${cats[k].map((i) => `<a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a>`).join("")}</div>`
  ).join("");
  const opts = DATA.ingredients.map((i) => `<option value="${i.slug}">${esc(i.name)}</option>`).join("");
  // "100 g in cups" across popular ingredients — shows why the answer depends on the ingredient.
  const refRows = popular().map((i) =>
    `<tr><td><a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a></td><td class="num">${cups2(100 / i.gramsPerCup)} cups</td></tr>`
  ).join("");
  const faq = [
    ["How do I convert grams to cups?", "Divide the weight in grams by the weight of one cup of that ingredient. For example, 1 cup of all-purpose flour is about 120 g, so 240 g of flour is 240 ÷ 120 = 2 cups. Pick your ingredient above and the calculator does the math for you."],
    ["Is grams to cups the same for every ingredient?", "No — this is the key thing. A cup of flour weighs about 120 g, but a cup of granulated sugar is about 200 g and a cup of honey about 340 g. So 100 g is a very different number of cups depending on the ingredient. Always convert by ingredient, never with a single ratio."],
    ["How many cups is 100 grams?", "It depends on the ingredient: 100 g of all-purpose flour is about 0.83 cups, 100 g of granulated sugar about 0.5 cups, and 100 g of butter about 0.44 cups. Choose your ingredient above for an exact figure."],
    ["How many cups is 250 grams of flour?", "About 2.08 cups of all-purpose flour, based on 120 g per cup. For sugar (200 g per cup) 250 g is about 1.25 cups."],
    ["Why does my recipe give weights in grams?", "Weighing is more accurate than measuring by volume — packed versus sifted flour can differ by 30%. Recipes written in grams remove that guesswork. This converter lets you turn those gram weights back into cups when you don't have a scale."],
  ];
  const jsonLd = [
    appLd("Grams to Cups Converter", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Grams to Cups", canonical]]),
  ];
  const cfg = { type: "rmaster", ingredients: DATA.ingredients.map((i) => ({ slug: i.slug, gramsPerCup: i.gramsPerCup })) };
  const body = `
<h1>Grams to Cups Converter</h1>
<p class="lead">Got a weight in grams and no kitchen scale? Pick your ingredient and turn grams into cups instantly — accurately, because a cup of flour and a cup of sugar are <em>not</em> the same weight.</p>
<div class="calc">
  <div class="field" style="margin-bottom:10px"><label for="ingredient">Ingredient</label><select id="ingredient">${opts}</select></div>
  <div class="row">
    <div class="field"><label for="grams">Grams</label><input id="grams" type="number" inputmode="decimal" value="100" min="0" step="any"></div>
    <div class="field" style="max-width:150px"><label for="unit">Convert to</label><select id="unit"><option value="cups">cups</option><option value="tbsp">tablespoons</option><option value="tsp">teaspoons</option></select></div>
    <div class="field"><label for="amount">Amount</label><input id="amount" type="number" inputmode="decimal" step="any"></div>
  </div>
  <div class="result"><div class="big" id="out-amount">—</div><div class="sub" id="out-oz">—</div></div>
</div>
<h2>Why 100 g isn't always the same number of cups</h2>
<p>Grams measure weight; cups measure volume. The same weight fills a different number of cups for each ingredient because their densities differ. Here is what <strong>100 g</strong> looks like across some common ingredients:</p>
<table><thead><tr><th>Ingredient</th><th>100 g in cups</th></tr></thead><tbody>${refRows}</tbody></table>
<p class="note">For a full grams-to-cups chart of any single ingredient (10 g up to 500 g), open its page below.</p>
<h2>Pick an ingredient</h2>
${lists}
<h2>Prefer to go the other way?</h2>
<p>Use the <a href="/cups-to-grams/">cups to grams converter</a> to turn a cup measurement into grams, or the <a href="/tablespoons-to-grams/">tablespoons to grams converter</a> for spoon amounts. Jump to a category chart above, or looking for butter in sticks? Try the <a href="/butter-converter/">butter converter</a> — and if you're out of butter, the <a href="/butter-to-oil/">butter to oil chart</a> shows the ¾-rule substitution.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg }) };
}

// Tablespoons -> grams hub. Same ingredient data, unit-first entry point targeting the
// large "how many grams in a tablespoon of X" / "tbsp to grams" head-term class.
// Reuses the master widget (type "master") with the unit defaulting to tablespoons.
function tablespoonsToGramsPage() {
  const title = "Tablespoons to Grams Converter — By Ingredient | ExactCup";
  const description = "How many grams in a tablespoon? It depends on the ingredient: 1 tbsp flour ≈ 7.5 g, sugar ≈ 12.5 g, butter ≈ 14.2 g, honey ≈ 21 g. Free tbsp-to-grams converter for 80+ ingredients.";
  const canonical = "/tablespoons-to-grams/";
  const cats = {};
  DATA.ingredients.forEach((i) => { (cats[i.category] = cats[i.category] || []).push(i); });
  const lists = Object.keys(cats).map((k) =>
    `<h3><a href="/${k}-conversion-chart/">${esc(catName(k))}</a></h3><div class="chips">${cats[k].map((i) => `<a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a>`).join("")}</div>`
  ).join("");
  const opts = DATA.ingredients.map((i) => `<option value="${i.slug}">${esc(i.name)}</option>`).join("");
  // "1 tbsp in grams" across a curated set of common ingredients (1 tbsp = 1 cup / 16).
  const refSlugs = ["all-purpose-flour", "granulated-sugar", "brown-sugar", "powdered-sugar", "butter", "cocoa-powder", "honey", "milk", "olive-oil", "water"];
  const refRows = refSlugs.map(ingBySlug).filter(Boolean).map((i) =>
    `<tr><td><a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a></td><td class="num">${g2(i.gramsPerCup / 16)} g</td></tr>`
  ).join("");
  const gFlour = g2(ingBySlug("all-purpose-flour").gramsPerCup / 16);
  const gSugar = g2(ingBySlug("granulated-sugar").gramsPerCup / 16);
  const gButter = g2(ingBySlug("butter").gramsPerCup / 16);
  const gHoney = g2(ingBySlug("honey").gramsPerCup / 16);
  const gCocoa = g2(ingBySlug("cocoa-powder").gramsPerCup / 16);
  const faq = [
    ["How many grams is 1 tablespoon?", `There is no single answer — it depends on the ingredient, because a tablespoon is a measure of volume and grams measure weight. One US tablespoon of all-purpose flour is about ${gFlour} g, of granulated sugar about ${gSugar} g, of butter about ${gButter} g, of cocoa powder about ${gCocoa} g and of honey about ${gHoney} g. Pick your ingredient above for an exact figure.`],
    ["How many grams is 1 tablespoon of butter?", `1 US tablespoon of butter is about ${gButter} g. There are 8 tablespoons in a stick of butter (113.5 g) and 16 tablespoons in a cup.`],
    ["How many grams is 1 tablespoon of flour?", `1 US tablespoon of all-purpose flour is about ${gFlour} g. Spoon the flour into the tablespoon and level it off rather than scooping, which packs it and adds weight.`],
    ["How many grams is 1 tablespoon of sugar?", `1 US tablespoon of granulated sugar is about ${gSugar} g. Brown sugar is a little heavier at about ${g2(ingBySlug("brown-sugar").gramsPerCup / 16)} g per tablespoon when lightly packed.`],
    ["How many tablespoons are in a cup?", "A US cup holds 16 tablespoons, and each tablespoon is 3 teaspoons — so a cup is 48 teaspoons. That is why 1 tablespoon of an ingredient weighs one sixteenth of what a full cup weighs."],
    ["Is a tablespoon the same size everywhere?", "Not quite. This converter uses the US tablespoon of 14.79 ml. A UK/international metric tablespoon is 15 ml (close enough to ignore) but an Australian tablespoon is 20 ml — about a third larger — so scale accordingly if your recipe is Australian."],
  ];
  const jsonLd = [
    appLd("Tablespoons to Grams Converter", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Tablespoons to Grams", canonical]]),
  ];
  const cfg = { type: "master", ingredients: DATA.ingredients.map((i) => ({ slug: i.slug, gramsPerCup: i.gramsPerCup })) };
  const body = `
<h1>Tablespoons to Grams Converter</h1>
<p class="lead">How many grams is a tablespoon? It depends entirely on what you are measuring. Pick your ingredient and convert tablespoons (or teaspoons and cups) to grams instantly — a tablespoon of flour and a tablespoon of honey are nowhere near the same weight.</p>
<div class="calc">
  <div class="field" style="margin-bottom:10px"><label for="ingredient">Ingredient</label><select id="ingredient">${opts}</select></div>
  <div class="row">
    <div class="field"><label for="amount">Amount</label><input id="amount" type="number" inputmode="decimal" value="1" min="0" step="any"></div>
    <div class="field" style="max-width:150px"><label for="unit">Unit</label><select id="unit"><option value="tbsp" selected>tablespoons</option><option value="tsp">teaspoons</option><option value="cups">cups</option></select></div>
    <div class="field"><label for="grams">Grams</label><input id="grams" type="number" inputmode="decimal" step="any"></div>
  </div>
  <div class="result"><div class="big" id="out-grams">—</div><div class="sub" id="out-oz">—</div></div>
</div>
<h2>1 tablespoon in grams, by ingredient</h2>
<p>Grams per tablespoon are just one sixteenth of the grams per cup, so lighter, fluffier ingredients weigh far less per spoon than dense or wet ones. Here is <strong>1 level US tablespoon</strong> for some everyday ingredients:</p>
<table><thead><tr><th>Ingredient</th><th>1 tbsp in grams</th></tr></thead><tbody>${refRows}</tbody></table>
<p class="note">1 US tablespoon = 3 teaspoons = 1/16 cup = 14.79 ml. For a full chart of any single ingredient, open its page below.</p>
<h2>Pick an ingredient</h2>
${lists}
<h2>Need a different conversion?</h2>
<p>Working in cups instead? Use the <a href="/cups-to-grams/">cups to grams converter</a>. Have a weight already? The <a href="/grams-to-cups/">grams to cups converter</a> goes the other way. Just counting spoons — how many tablespoons are in a cup? See the <a href="/tablespoons-in-a-cup/">tablespoons in a cup</a> chart. For pure volume swaps (tbsp ↔ tsp ↔ mL) see the <a href="/volume-converter/">volume converter</a>, and for butter in sticks try the <a href="/butter-converter/">butter converter</a>.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg }) };
}

// Targets the "half of 3/4 cup" / "how to halve a recipe" query class. All values
// are pure US-unit arithmetic (1 cup = 16 tbsp = 48 tsp) — no ingredient data involved.
function halvingChartPage() {
  const title = "What Is Half of 3/4 Cup? Recipe Halving Chart | ExactCup";
  const description = "Half of 3/4 cup is 6 tbsp (1/4 cup + 2 tbsp); half of 1/3 cup is 2 tbsp + 2 tsp. Free chart with half and one-third of every common kitchen measurement, plus a halve-anything calculator.";
  const canonical = "/recipe-halving-chart/";
  // [original, half, one-third] — hand-verified via 1 cup = 48 tsp arithmetic and
  // kept consistent with the initHalve() formatter in app.js.
  const ROWS = [
    ["2 cups", "1 cup", "2/3 cup"],
    ["1 3/4 cups", "3/4 cup + 2 tbsp", "1/2 cup + 1 tbsp + 1 tsp"],
    ["1 1/2 cups", "3/4 cup", "1/2 cup"],
    ["1 1/3 cups", "2/3 cup", "1/4 cup + 3 tbsp + 1/3 tsp"],
    ["1 1/4 cups", "1/2 cup + 2 tbsp", "1/4 cup + 2 tbsp + 2 tsp"],
    ["1 cup", "1/2 cup", "1/3 cup"],
    ["3/4 cup", "1/4 cup + 2 tbsp (= 6 tbsp)", "1/4 cup"],
    ["2/3 cup", "1/3 cup", "3 tbsp + 1 2/3 tsp"],
    ["1/2 cup", "1/4 cup", "2 tbsp + 2 tsp"],
    ["1/3 cup", "2 tbsp + 2 tsp", "1 tbsp + 2 1/3 tsp"],
    ["1/4 cup", "2 tbsp", "1 tbsp + 1 tsp"],
    ["1/8 cup (2 tbsp)", "1 tbsp", "2 tsp"],
    ["1 tbsp", "1 1/2 tsp", "1 tsp"],
    ["1 tsp", "1/2 tsp", "1/3 tsp"],
    ["1/2 tsp", "1/4 tsp", "1/6 tsp (generous 1/8)"],
    ["1/4 tsp", "1/8 tsp", "a pinch (1/12 tsp)"],
    ["1/8 tsp", "1/16 tsp (a pinch)", "a small pinch"],
  ];
  const tableRows = ROWS.map(([o, h, t]) => `<tr><td>${esc(o)}</td><td class="num">${esc(h)}</td><td class="num">${esc(t)}</td></tr>`).join("");
  const faq = [
    ["What is half of 3/4 cup?", "Half of 3/4 cup is 6 tablespoons — easiest to measure as 1/4 cup plus 2 tablespoons (about 89 ml). A US cup holds 16 tablespoons, so 3/4 cup is 12 tablespoons and half of that is 6."],
    ["What is half of 1/3 cup?", "Half of 1/3 cup is 2 tablespoons plus 2 teaspoons (about 39 ml). 1/3 cup equals 5 1/3 tablespoons, so half is 2 2/3 tablespoons — that is 2 tablespoons + 2 teaspoons."],
    ["What is half of 1/4 cup?", "Half of 1/4 cup is 2 tablespoons (about 30 ml), because 1/4 cup is exactly 4 tablespoons."],
    ["What is half of 2/3 cup?", "Half of 2/3 cup is 1/3 cup (about 79 ml). Thirds halve neatly: half of 1 1/3 cups is 2/3 cup, and half of 2 2/3 cups is 1 1/3 cups."],
    ["What is half of 1 1/2 cups?", "Half of 1 1/2 cups is 3/4 cup. In tablespoons: 1 1/2 cups is 24 tablespoons, and half of that is 12 tablespoons, which is 3/4 cup."],
    ["How do you halve an egg?", "Crack the egg, beat it until the yolk and white are fully blended, then use half by weight or volume. A large egg is about 50 g out of the shell, so half is about 25 g — roughly 1 tablespoon + 2 teaspoons of beaten egg. A kitchen scale makes this painless."],
    ["Does halving a recipe change the baking time?", "Usually, yes. A half batch in a smaller pan bakes faster — start checking at around two-thirds of the original time. Keep the oven temperature the same. If you keep the original pan, the layer will be thinner and bake faster still."],
    ["What is the easiest way to halve an awkward measurement?", "Switch to weight. Cup and spoon measures get clumsy in halves and thirds, but grams never do: convert the amount to grams, divide by two, and weigh it. It is both easier and more accurate than juggling spoon fractions."],
  ];
  const jsonLd = [
    appLd("Recipe Halving Calculator", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Recipe Halving Chart", canonical]]),
  ];
  const body = `
<h1>Recipe Halving Chart — Half of Any Measurement</h1>
<p class="lead">Half of 3/4 cup is 6 tablespoons, but half of 1/3 cup is the genuinely awkward 2 tablespoons + 2 teaspoons. Type any amount to halve it (or take a third, or double it) — or scroll down for the full chart.</p>
<div class="calc">
  <div class="row">
    <div class="field"><label for="amt">Amount (fractions welcome — 3/4, 1 1/2…)</label><input id="amt" type="text" inputmode="decimal" value="3/4" autocomplete="off"></div>
    <div class="field" style="max-width:170px"><label for="unit">Unit</label><select id="unit"><option value="cups" selected>cups</option><option value="tbsp">tablespoons</option><option value="tsp">teaspoons</option></select></div>
  </div>
  <div class="result"><div class="sub">Half (1/2×)</div><div class="big" id="out-half">—</div><div class="sub" id="out-third">One third (1/3×): —</div><div class="sub" id="out-double">Double (2×): —</div></div>
</div>
<h2>Halving chart: half and a third of every common measure</h2>
<p>Everything on this chart follows from one fact: a US cup holds <strong>16 tablespoons</strong>, and each tablespoon holds <strong>3 teaspoons</strong> (48 teaspoons per cup). Any awkward half converts cleanly into spoons.</p>
<table><thead><tr><th>Original amount</th><th>Half (1/2×)</th><th>One third (1/3×)</th></tr></thead><tbody>${tableRows}</tbody></table>
<p class="note">US customary measures. Doubling is the easy direction: double 3/4 cup = 1 1/2 cups, double 2/3 cup = 1 1/3 cups, double 1/3 cup = 2/3 cup.</p>
<h2>Halving a whole recipe?</h2>
<p>This page halves one measurement at a time. To cut an entire ingredient list in half in one go, paste it into the <a href="/recipe-scaler/">recipe scaler</a> and set the servings to half — it rescales every line at once.</p>
<h2>The scale trick for awkward amounts</h2>
<p>Halves of thirds and thirds of quarters are where volume measures fall apart — and where a kitchen scale shines. Convert the original amount to grams with the <a href="/cups-to-grams/">cups to grams converter</a>, divide by two, and weigh it. 3/4 cup of flour is 90 g, so half is exactly 45 g — no spoon gymnastics.</p>
<h2>Baking notes when you halve</h2>
<p>Ingredients scale linearly, but pans and time do not. A half batch wants a pan with about half the area — the <a href="/pan-size-converter/">pan size converter</a> matches pan sizes for you — and it will bake in less time at the same temperature, so start checking early. Eggs are the other snag; see the FAQ below for the clean way to halve one.</p>
<h2>Need a different conversion?</h2>
<p>For spoon-and-cup volume swaps (cups &#8596; tbsp &#8596; tsp &#8596; mL) use the <a href="/volume-converter/">volume converter</a>. Halving spoon amounts specifically — like half of a tablespoon (1&#189; tsp)? The <a href="/teaspoons-in-a-tablespoon/">teaspoons in a tablespoon</a> page walks the whole spoon ladder down. Working in weights? The <a href="/cups-to-grams/">cups to grams</a> and <a href="/grams-to-cups/">grams to cups</a> converters cover 80+ ingredients.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "halve" } }) };
}

// Printable one-page kitchen conversion chart — the linkable flagship reference.
// Ingredient weights derive from the verified densities in ingredients.json and the
// oven rows match the oven-temperature page. The global @media print CSS strips the
// site chrome and flows .print-cols into two columns so the chart lands on one sheet.
function kitchenChartPage() {
  const title = "Printable Kitchen Conversion Chart — Cups, Grams, Oven Temps | ExactCup";
  const description = "Free printable kitchen conversion chart: cups to tablespoons, fl oz and mL, ingredient weights in grams per cup, oven temperatures (°F, °C, gas mark), butter sticks and ounces to grams — all on one page. No sign-up.";
  const canonical = "/kitchen-conversion-chart/";
  const STICK = ingBySlug("butter").gramsPerCup / 2; // 113.5 g, from the verified dataset
  // Curated everyday ingredients for the print chart; the full list lives on /cups-to-grams/.
  const PRINT_INGS = ["all-purpose-flour", "bread-flour", "cake-flour", "whole-wheat-flour", "granulated-sugar", "brown-sugar", "powdered-sugar", "butter", "milk", "heavy-cream", "vegetable-oil", "honey", "maple-syrup", "cocoa-powder", "cornstarch", "rolled-oats", "white-rice", "chocolate-chips"].map(ingBySlug).filter(Boolean);
  const ingRows = PRINT_INGS.map((i) => `<tr><td><a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a></td><td class="num">${g2(i.gramsPerCup)} g</td><td class="num">${g2(i.gramsPerCup / OZ)} oz</td></tr>`).join("");
  // 1 US cup = 16 tbsp = 8 fl oz = 236.588 mL — every row follows from that.
  const VOL = [
    ["1 cup", "16 tbsp", "8 fl oz", "237 mL"],
    ["3/4 cup", "12 tbsp", "6 fl oz", "177 mL"],
    ["2/3 cup", "10 tbsp + 2 tsp", "5 1/3 fl oz", "158 mL"],
    ["1/2 cup", "8 tbsp", "4 fl oz", "118 mL"],
    ["1/3 cup", "5 tbsp + 1 tsp", "2 2/3 fl oz", "79 mL"],
    ["1/4 cup", "4 tbsp", "2 fl oz", "59 mL"],
    ["1/8 cup", "2 tbsp", "1 fl oz", "30 mL"],
    ["1 tbsp", "3 tsp", "1/2 fl oz", "15 mL"],
    ["1 tsp", "1/3 tbsp", "1/6 fl oz", "5 mL"],
  ].map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("");
  const BIG = [
    ["1 gallon", "4 quarts", "16 cups", "3.79 L"],
    ["1 quart", "2 pints", "4 cups", "946 mL"],
    ["1 pint", "2 cups", "16 fl oz", "473 mL"],
    ["1 cup", "1/2 pint", "8 fl oz", "237 mL"],
  ].map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("");
  // Same values as the oven-temperature page, extended one step each way.
  const OVEN = [[250, 120, "1/2"], [275, 140, "1"], [300, 150, "2"], [325, 170, "3"], [350, 180, "4"], [375, 190, "5"], [400, 200, "6"], [425, 220, "7"], [450, 230, "8"], [475, 240, "9"]]
    .map(([f, c, g]) => `<tr><td class="num">${f}°F</td><td class="num">${c}°C</td><td>Gas ${g}</td></tr>`).join("");
  const BUTTER = [["1/2 stick", "1/4 cup", "4 tbsp", 0.5], ["1 stick", "1/2 cup", "8 tbsp", 1], ["2 sticks", "1 cup", "16 tbsp", 2], ["4 sticks (1 lb)", "2 cups", "32 tbsp", 4]]
    .map(([s, c, t, n]) => `<tr><td>${esc(s)}</td><td class="num">${esc(c)}</td><td class="num">${esc(t)}</td><td class="num">${g2(n * STICK)} g</td></tr>`).join("");
  const WEIGHT = [["1/2 oz", 0.5], ["1 oz", 1], ["2 oz", 2], ["4 oz (1/4 lb)", 4], ["8 oz (1/2 lb)", 8], ["12 oz (3/4 lb)", 12], ["16 oz (1 lb)", 16]]
    .map(([l, n]) => `<tr><td>${esc(l)}</td><td class="num">${Math.round(n * OZ)} g</td></tr>`).join("");
  const faq = [
    ["How many tablespoons are in a cup?", "There are 16 US tablespoons in a cup, and 3 teaspoons in a tablespoon (48 teaspoons per cup). So 3/4 cup is 12 tablespoons, 1/2 cup is 8, and 1/4 cup is 4. The awkward ones are the thirds: 1/3 cup is 5 tablespoons + 1 teaspoon and 2/3 cup is 10 tablespoons + 2 teaspoons."],
    ["How many mL are in a cup?", "A US cup is 236.588 mL — 237 mL in practice, and US nutrition labels round it to 240 mL. The metric cup used in the UK, Australia and New Zealand is 250 mL, about 5% bigger, which matters over several cups."],
    ["Why is a cup of flour 120 g but a cup of honey 340 g?", "Because a cup measures volume, not weight, and every ingredient has a different density. That is why the ingredient table on this chart lists a separate gram weight per cup for each ingredient — one cups-to-grams number for all ingredients does not exist."],
    ["How do I print this chart?", "Click the Print button at the top (or press Ctrl+P / Cmd+P). The page is print-optimized: the site header, footer and everything below the chart are stripped automatically, and the tables flow into two columns so the whole chart fits on one portrait page in plain black and white."],
    ["Is this chart free to print and share?", "Yes — print it for your kitchen, classroom, cookbook club or commercial kitchen, and share copies freely. If you republish it online, please credit ExactCup with a link; the underlying ingredient-density data is open under CC BY 4.0."],
    ["Are these US or UK measurements?", "The cups, tablespoons and fluid ounces are US customary (UK and US tablespoons are both 15 mL, but the Australian tablespoon is 20 mL). For UK cooks the chart includes gas marks in the oven table and grams everywhere; note the UK/Australian metric cup is 250 mL rather than the US 237 mL."],
  ];
  const jsonLd = [faqLd(faq), breadcrumbLd([["Kitchen Conversion Chart", canonical]])];
  const body = `
<h1>Kitchen Conversion Chart</h1>
<p class="lead no-print">All the must-know kitchen conversions on one page: cups to tablespoons, fluid ounces and mL; everyday ingredient weights in grams; oven temperatures; butter sticks; ounces to grams. Built to print &mdash; hit the button and it comes out as a clean one-page chart for the fridge or recipe binder.</p>
<p class="no-print"><button class="btn" onclick="window.print()">Print this chart</button>&ensp;<span style="font-size:13px;color:var(--muted)">Free to print and share &mdash; black-and-white friendly, fits one page.</span></p>
<div class="print-cols">
<section><h2>Volume equivalents (US)</h2>
<table><thead><tr><th>Cups</th><th>Spoons</th><th>Fl oz</th><th>mL</th></tr></thead><tbody>${VOL}</tbody></table></section>
<section><h2>Cups, pints, quarts &amp; gallons</h2>
<table><tbody>${BIG}</tbody></table></section>
<section><h2>Butter</h2>
<table><thead><tr><th>Sticks</th><th>Cups</th><th>Tbsp</th><th>Grams</th></tr></thead><tbody>${BUTTER}</tbody></table></section>
<section><h2>Ingredient weights (1 US cup)</h2>
<table><thead><tr><th>Ingredient</th><th>Grams</th><th>Ounces</th></tr></thead><tbody>${ingRows}</tbody></table></section>
<section><h2>Oven temperatures</h2>
<table><thead><tr><th>°F</th><th>°C</th><th>Gas mark</th></tr></thead><tbody>${OVEN}</tbody></table>
<p class="note" style="margin:4px 0">Fan/convection oven: reduce by about 20&deg;C (25&deg;F).</p></section>
<section><h2>Ounces to grams</h2>
<table><tbody>${WEIGHT}</tbody></table></section>
</div>
<p class="print-only" style="font-size:10px;margin-top:8px">Ingredient weights are nominal &mdash; how you fill the cup matters, so weigh when accuracy counts. Free chart by ExactCup &middot; interactive converters for 80+ ingredients at exactcup.github.io/kitchen-conversion-chart/</p>
<div class="no-print">
<h2>How to use this chart</h2>
<p>The volume table is universal &mdash; 1/2 cup is 8 tablespoons whether it holds milk or flour, because those are all volume units. The <strong>ingredient weights</strong> table is the one that changes per ingredient: it gives the weight in grams of one level US cup, using the same verified densities as our <a href="/cups-to-grams/">cups to grams converter</a> (which covers ${DATA.ingredients.length}+ ingredients and every fraction of a cup, both <a href="/grams-to-cups/">directions</a>). For brown sugar that means packed into the cup; for flour, spooned in and leveled &mdash; scooping straight from the bag compacts flour by up to 30%, which is why serious bakers <a href="/ingredient-density-data/">weigh instead</a>.</p>
<p>Halving a recipe and stuck on half of 3/4 cup? That is its own chart: the <a href="/recipe-halving-chart/">recipe halving chart</a>. Scaling the whole ingredient list, use the <a href="/recipe-scaler/">recipe scaler</a>; converting an oven recipe for the air fryer, the <a href="/air-fryer-conversion-calculator/">air fryer converter</a>. The butter rows come from the <a href="/butter-converter/">butter converter</a>, which also handles odd amounts like 1 1/2 sticks in grams, and the temperature rows from the <a href="/oven-temperature-converter/">oven temperature converter</a>.</p>
<h2>Pin or share this chart</h2>
<figure style="margin:14px 0">
<a href="/assets/kitchen-conversion-chart-pin.png"><img src="/assets/kitchen-conversion-chart-pin.png" alt="Kitchen conversion chart: cup, tablespoon, fluid ounce and mL volume equivalents, grams per cup for flour, sugar, brown sugar, butter, honey and cocoa, oven temperatures in Fahrenheit, Celsius and gas mark, and butter stick weights — free printable from ExactCup" width="1000" height="1500" loading="lazy" style="width:100%;max-width:320px;height:auto;border:1px solid var(--line);border-radius:var(--radius)"></a>
<figcaption style="font-size:13px;color:var(--muted)">Save or pin this preview &mdash; the printable version comes out of the Print button above, crisp and black-and-white friendly.</figcaption>
</figure>
<h2>Want this on your own site?</h2>
<p>The interactive version of this chart is <a href="/embed/">free to embed</a> &mdash; one HTML snippet adds a live cups&#8596;grams converter to any recipe post. And the ingredient densities behind it are published as an <a href="/ingredient-density-data/">open dataset (CC BY 4.0)</a>, free to reuse with attribution.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
</div>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd,
    og: { image: "/assets/og-kitchen-conversion-chart.png", w: 1200, h: 630, alt: "Free printable kitchen conversion chart: volume equivalents, grams per cup, oven temperatures" } }) };
}

function homePage() {
  const title = "ExactCup — Free Cooking & Baking Measurement Converters";
  const description = "Free, accurate cooking converters: cups to grams for every ingredient, recipe scaler, oven temperature converter, and butter converter. No sign-up.";
  const canonical = "/";
  const tools = ALL_TOOLS;
  const body = `
<h1>Cooking conversions that are actually accurate</h1>
<p class="lead">Free kitchen calculators that respect the difference between a cup of flour and a cup of honey. No sign-up, no fluff.</p>
<div class="grid">
${tools.map(([h, t, d]) => `<a class="card" href="${h}"><div class="t">${esc(t)}</div><div class="d">${esc(d)}</div></a>`).join("")}
</div>
<h2>Popular ingredient converters</h2>
<div class="chips">${popular().map((i) => `<a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a>`).join("")}</div>
<h2>Conversion charts by category</h2>
<div class="chips">${Object.keys(DATA.categories).map((k) => `<a href="/${k}-conversion-chart/">${esc(catName(k))}</a>`).join("")}</div>
<h2>Why weigh ingredients?</h2>
<p>Measuring by volume (cups) is convenient but imprecise — packed vs. sifted flour can differ by 30%. Weighing in grams is how professional bakers get consistent results. These converters bridge the two so you can follow any recipe, anywhere.</p>`;
  const jsonLd = {
    "@context": "https://schema.org", "@type": "WebSite",
    name: SITE.brand, url: SITE.baseUrl + "/",
    description: SITE.tagline,
  };
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd }) };
}

function scalerPage() {
  const title = "Recipe Scaler — Scale Recipes Up or Down by Servings | ExactCup";
  const description = "Free recipe scaler: enter original and desired servings and instantly rescale every ingredient quantity. Handles fractions.";
  const canonical = "/recipe-scaler/";
  const faq = [
    ["How do I double a recipe?", "Multiply every ingredient by 2 (this tool does it for you). Most ingredients double cleanly, but taste and adjust strong seasonings — salt, spices, garlic and chilli often need a little less than double. Scale baking soda and baking powder too, but for very large batches add slightly under, as too much leavening can taste soapy."],
    ["Does the baking time change when I scale a recipe?", "Not in proportion. A bigger or deeper batch takes longer, but rarely twice as long. Keep the oven temperature the same, start checking at the original time, and judge by doneness rather than the clock."],
    ["What parts of a recipe don't scale linearly?", "Salt, spices, leavening, alcohol and bake time. Pan size matters too: a doubled cake needs more pan area or it overflows — use the pan size converter to pick a pan, so the batter depth (and bake time) stays similar."],
    ["How do I scale a recipe that uses eggs?", "Eggs come whole, so round to the nearest egg or use half of a beaten egg (about 25 g) when the maths lands between. For example, 1.5× a 2-egg recipe means 3 eggs; 1.5× a 3-egg recipe means 4 eggs plus half a beaten one."],
    ["Is it better to scale by weight or by cups?", "By weight. Grams scale exactly and avoid the rounding errors of fractional cups — half of ¾ cup is easy to weigh but fiddly to measure. Convert your cups to grams first with the cups to grams converter, then scale."],
  ];
  const body = `
<h1>Recipe Scaler</h1>
<p class="lead">Cooking for more (or fewer) people? Enter the servings and rescale the whole ingredient list at once.</p>
<div class="calc">
  <div class="row">
    <div class="field"><label for="orig-serv">Original servings</label><input id="orig-serv" type="number" inputmode="decimal" value="4" min="0" step="any"></div>
    <div class="field"><label for="want-serv">Desired servings</label><input id="want-serv" type="number" inputmode="decimal" value="6" min="0" step="any"></div>
    <div class="field" style="max-width:140px"><label>Scale</label><div class="result" style="margin:0;padding:11px"><span class="big" id="scale-factor" style="font-size:20px">—</span></div></div>
  </div>
  <div style="margin-top:12px"><label for="ingredients-list">Ingredients (one per line, e.g. "2 cups flour")</label>
  <textarea id="ingredients-list" rows="6">2 cups flour
1 cup sugar
3 eggs
1/2 cup butter</textarea></div>
  <div style="margin-top:12px"><label>Scaled recipe</label><pre id="scaled-out" style="white-space:pre-wrap;background:var(--accent2);border:1px solid #fed7aa;border-radius:12px;padding:14px;margin:0">—</pre></div>
</div>
<p class="note">Tip: scaling works for most ingredients, but baking times, pan sizes, and leavening (baking soda/powder) don't always scale linearly. Adjust with judgment for big changes.</p>
<p>Just cutting a recipe in half? The <a href="/recipe-halving-chart/">recipe halving chart</a> shows half (and a third) of every common cup and spoon measure — like half of 3/4 cup — as amounts you can actually measure.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: [appLd("Recipe Scaler", description, canonical), faqLd(faq)], cfg: { type: "scaler" } }) };
}

function ovenPage() {
  const title = "Oven Temperature Converter — °F to °C to Gas Mark | ExactCup";
  const description = "Convert oven temperatures between Fahrenheit, Celsius and gas mark instantly, with a full conversion chart for common baking temperatures.";
  const canonical = "/oven-temperature-converter/";
  const faq = [
    ["What is 350°F in Celsius?", "350°F is 177°C, which recipes almost always round to 180°C — it is also gas mark 4, the most common baking temperature. To convert any temperature yourself: subtract 32, then multiply by 5/9."],
    ["How do I adjust the temperature for a fan (convection) oven?", "Lower the temperature by about 20°C (25°F) from what a conventional recipe states, because the fan circulates heat and cooks faster. Alternatively keep the temperature and shorten the time by 10–15%. Our chart lists conventional temperatures."],
    ["What temperature is gas mark 4 (or gas mark 6)?", "Gas mark 4 is 350°F / 180°C and gas mark 6 is 400°F / 200°C. Each gas mark step is 25°F (about 14°C), so gas mark 1 is 275°F and gas mark 8 is 450°F."],
    ["What do 'slow', 'moderate' and 'hot' oven mean?", "Old recipes describe the oven in words: a slow oven is about 300–325°F (150–170°C), a moderate oven is 350–375°F (180–190°C), and a hot oven is 400–450°F (200–230°C). A very hot oven is 475°F+ (245°C+)."],
    ["Do I change the oven temperature when I change pan size?", "No — keep the temperature the same and adjust the time instead. A wider, shallower pan bakes faster and a deeper pan slower; use the pan size converter to match pans, then start checking for doneness a few minutes early."],
  ];
  const chart = [[275, 140, "1"], [300, 150, "2"], [325, 170, "3"], [350, 180, "4"], [375, 190, "5"], [400, 200, "6"], [425, 220, "7"], [450, 230, "8"]]
    .map(([f, c, g]) => `<tr><td class="num">${f}°F</td><td class="num">${c}°C</td><td>Gas ${g}</td></tr>`).join("");
  const body = `
<h1>Oven Temperature Converter</h1>
<p class="lead">Convert between °F, °C and UK gas mark — for recipes from anywhere.</p>
<div class="calc">
  <div class="row">
    <div class="field"><label for="f">Fahrenheit (°F)</label><input id="f" type="number" inputmode="decimal" value="350" step="any"></div>
    <div class="field"><label for="c">Celsius (°C)</label><input id="c" type="number" inputmode="decimal" step="any"></div>
    <div class="field" style="max-width:160px"><label>Gas mark</label><div class="result" style="margin:0;padding:11px"><span class="big" id="gas" style="font-size:18px">—</span></div></div>
  </div>
</div>
<h2>Oven temperature chart</h2>
<table><thead><tr><th>Fahrenheit</th><th>Celsius</th><th>Gas mark</th></tr></thead><tbody>${chart}</tbody></table>
<p class="note">For fan/convection ovens, reduce the Celsius temperature by about 20°C (or ~25°F) from conventional recipes.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: [appLd("Oven Temperature Converter", description, canonical), faqLd(faq)], cfg: { type: "oven" } }) };
}

// Every number on this page is derived from the verified butter density in
// ingredients.json (227 g/cup → 1 stick = 113.5 g, 1 tbsp = 14.2 g). Google
// serves the stick-conversion query cluster ("1 1/2 sticks of butter in cups")
// on this URL, so it answers sticks↔cups↔grams explicitly in all directions.
function butterPage() {
  const gpc = ingBySlug("butter").gramsPerCup; // 227
  const STICK = gpc / 2, TBSP = gpc / 16;
  const title = "Butter Converter — Sticks, Cups, Tablespoons & Grams | ExactCup";
  const description = `Convert butter between sticks, cups, tablespoons, grams and ounces instantly. 1 stick = 1/2 cup = 8 tbsp = ${g2(STICK)} g; 1 1/2 sticks = 3/4 cup = ${Math.round(1.5 * STICK)} g. Charts in every direction.`;
  const canonical = "/butter-converter/";
  const f = (lab, id, ph) => `<div class="field"><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" step="any" placeholder="${ph}"></div>`;
  // Render counts that land on kitchen fractions (½, ⅓ …) the way a cook says them.
  const FRACS = [[0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"]];
  const fmtFrac = (x) => {
    const whole = Math.floor(x + 1e-9), rest = x - whole;
    for (const [v, s] of FRACS) if (Math.abs(rest - v) < 0.01) return (whole || "") + s;
    return rest < 0.01 ? String(whole) : String(cups2(x));
  };
  const fmtSticks = (s) => `${fmtFrac(s)} stick${s > 1 ? "s" : ""}`;
  // Tablespoon count from a cup amount; thirds of a cup get the "+ tsp" form.
  const fmtTbsp = (c) => {
    const tsp = Math.round(c * 48), tbsp = Math.floor(tsp / 3), rem = tsp - tbsp * 3;
    return rem ? `${tbsp} tbsp + ${rem} tsp` : `${tbsp} tbsp`;
  };
  // Sticks chart: ¼ → 4 sticks with cups, tbsp, grams, oz.
  const stickRows = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4].map((s) => {
    const c = s / 2;
    return `<tr><td>${fmtSticks(s)}${s === 4 ? " (1 lb)" : ""}</td><td>${fmtFrac(c)} cup${c > 1 ? "s" : ""}</td><td class="num">${fmtTbsp(c)}</td><td class="num">${g2(s * STICK)} g</td><td class="num">${g2(s * STICK / OZ)} oz</td></tr>`;
  }).join("\n");
  // Cups → sticks (the reverse direction people also search: "1 1/2 cups butter in sticks").
  const cupRows = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.25, 1.5, 2].map((c) => {
    return `<tr><td>${fmtFrac(c)} cup${c > 1 ? "s" : ""}</td><td>${fmtSticks(c * 2)}</td><td class="num">${fmtTbsp(c)}</td><td class="num">${g2(c * gpc)} g</td></tr>`;
  }).join("\n");
  // Grams → sticks/cups/tbsp for metric cooks (250 g European block etc.).
  const gramRows = [50, 100, 125, 150, 200, 250, 500].map((g) => {
    const lab = g === 250 ? "250 g (1 block)" : `${g} g`;
    return `<tr><td>${lab}</td><td class="num">${cups2(g / STICK)}</td><td class="num">${cups2(g / gpc)}</td><td class="num">${g2(g / TBSP)}</td></tr>`;
  }).join("\n");
  const faq = [
    ["How many cups is 1 1/2 sticks of butter?", `1 1/2 sticks of butter is 3/4 cup — 12 tablespoons, about ${Math.round(1.5 * STICK)} grams or 6 ounces.`],
    ["How many sticks is 1 1/2 cups of butter?", `1 1/2 cups of butter is 3 sticks — 24 tablespoons, about ${g2(3 * STICK)} grams. Each stick is 1/2 cup, so double the cups to get sticks.`],
    ["How much is half a stick of butter?", `Half a stick is 1/4 cup — 4 tablespoons, about ${Math.round(STICK / 2)} grams or 2 ounces. On the wrapper, that's the line at the 4-tablespoon mark.`],
    ["Is a stick of butter 4 ounces?", `Yes — one US stick weighs 4 ounces (1/4 pound, ${g2(STICK)} g). It also measures 1/2 cup by volume. A standard 1 lb box holds 4 sticks.`],
    ["How many tablespoons are in a stick of butter?", `8 tablespoons. US wrappers print the tablespoon marks, so you can slice off exactly what you need — each tablespoon is about ${g2(TBSP)} grams.`],
    ["How many sticks is 250 g of butter (a European block)?", `250 g is about ${cups2(250 / STICK)} sticks — just over 1 cup (${cups2(250 / gpc)} cups, or 1 cup plus roughly 1 1/2 tablespoons).`],
    ["How many sticks is 200 g of butter?", `200 g is almost exactly 1 3/4 sticks (1 3/4 sticks = ${g2(1.75 * STICK)} g) — that's 14 tablespoons, or just under 1 cup.`],
    ["What is 2/3 cup of butter in sticks?", `2/3 cup is 1 1/3 sticks — 10 tablespoons plus 2 teaspoons, about ${Math.round(gpc * 2 / 3)} grams. It's easiest to take 1 stick plus a third of a second one (cut at just past the 5-tbsp mark).`],
    ["Does melted butter measure the same as solid butter?", "By weight, identical — melting changes nothing. By volume it's very close: 1 cup of solid butter yields roughly 1 cup melted. Recipes mean the state written: \"1/2 cup butter, melted\" = measure solid, then melt."],
    ["Why are some butter sticks short and fat?", `Both shapes hold exactly the same amount — 1/2 cup, ${g2(STICK)} g. The long thin \"Elgin\" stick is standard in the eastern US; many West Coast dairies use a shorter, stubbier mold. The wrapper markings still divide it into 8 tablespoons.`],
    ["Do these conversions work for European butter?", `Yes for measuring — a gram is a gram. European-style butters (Kerrygold, Plugrá) have a bit more butterfat (82–84% vs the US minimum 80%), which matters for flavor, not for conversion. A US-sold 8 oz half-pound block is exactly 2 sticks; a 250 g block is about ${cups2(250 / STICK)} sticks.`],
    ["How many sticks of butter are in a pound?", `4 sticks. One pound of butter is 2 cups, or ${g2(4 * STICK)} g — so a US 1 lb box (4 sticks) equals 2 cups.`],
  ];
  const body = `
<h1>Butter Converter</h1>
<p class="lead">US butter sticks, cups, tablespoons, grams and ounces — type any field and the rest update.</p>
<div class="calc">
  <div class="row">${f("Sticks", "sticks", "1")}${f("Cups", "cups", "0.5")}${f("Tablespoons", "tbsp", "8")}</div>
  <div class="row" style="margin-top:10px">${f("Teaspoons", "tsp", "24")}${f("Grams", "grams", "113.5")}${f("Ounces", "oz", "4")}</div>
</div>
<p class="note">The key fact: <strong>1 stick = ½ cup = 8 tbsp = ${g2(STICK)} g = 4 oz</strong>, and a 1 lb box holds 4 sticks (2 cups, ${g2(4 * STICK)} g).</p>
<h2>Butter sticks conversion chart</h2>
<table><thead><tr><th>Sticks</th><th>Cups</th><th>Tablespoons</th><th>Grams</th><th>Ounces</th></tr></thead><tbody>
${stickRows}
</tbody></table>
<h2>Cups of butter to sticks</h2>
<p>Recipe written in cups, butter sold in sticks? Sticks are just cups doubled — every ½ cup is one stick. The awkward thirds land between the wrapper marks, so they're spelled out in spoons:</p>
<table><thead><tr><th>Cups</th><th>Sticks</th><th>Tablespoons</th><th>Grams</th></tr></thead><tbody>
${cupRows}
</tbody></table>
<h2>Grams of butter to sticks and cups</h2>
<p>Metric recipe, US butter? Divide grams by ${g2(STICK)} to get sticks. The classic case is the European 250 g block — just over 1 cup:</p>
<table><thead><tr><th>Grams</th><th>Sticks</th><th>Cups</th><th>Tablespoons</th></tr></thead><tbody>
${gramRows}
</tbody></table>
<h2>Reading the wrapper</h2>
<p>Every US stick wrapper is printed with 8 tablespoon marks — slice straight through wrapper and all at the line you need instead of packing soft butter into a measuring cup. Each mark is 1 tbsp ≈ ${g2(TBSP)} g. Long eastern-style sticks and the shorter, stubbier West Coast sticks carry the same markings and hold the same ½ cup.</p>
<p>Out of butter entirely? The <a href="/butter-to-oil/">butter to oil conversion chart</a> shows how to replace butter with olive or vegetable oil — use ¾ of the amount — and which bakes the swap works in.</p>
<h2>Need a different conversion?</h2>
<p>Weighing other ingredients too? The <a href="/cups-to-grams/butter/">butter cups-to-grams page</a> has every cup fraction from ⅛ to 3 cups, and the <a href="/grams-to-cups/">grams to cups converter</a> goes weight-first across 80+ ingredients. Halving a recipe with 1½ sticks in it? The <a href="/recipe-halving-chart/">recipe halving chart</a> keeps every measure on a real spoon.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: [appLd("Butter Converter", description, canonical), faqLd(faq)], cfg: { type: "butter" } }) };
}

// Butter → oil substitution. The standard published ratio (NAOOA / Bertolli /
// Bob's Red Mill charts) is 3:4 by volume — 3 parts oil per 4 parts butter —
// because butter is only ~81% fat with ~16% water (USDA FoodData Central 173410),
// while oil is all fat. Every value below is computed from that single ratio and
// the verified densities in ingredients.json (butter 227 g/cup, olive oil 216
// g/cup); nothing is typed by hand.
function butterToOilPage() {
  const B_GPC = 227, O_GPC = 216, TSP_ML = 4.92892159375, CUP_ML = 236.5882365;
  const OIL = 0.75; // 3:4 — oil per butter, by volume
  const rnd = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  // Render a teaspoon count the way a cook measures it: "1/4 cup + 2 tbsp".
  const fmtNum = (x) => {
    const FR = [[0.25, "¼"], [0.5, "½"], [0.75, "¾"]];
    const whole = Math.floor(x + 1e-9), rest = x - whole;
    let frac = "";
    if (rest > 0.03) {
      for (const [v, s] of FR) if (Math.abs(rest - v) < 0.02) { frac = s; break; }
      if (!frac) return String(rnd(x, 2));
    }
    return whole ? whole + frac : (frac || "0");
  };
  const fmtTsp = (t) => {
    const parts = [];
    const cups = Math.floor(t / 48 + 1e-9);
    let rem = t - cups * 48, frac = "";
    const EXACT = [[36, "¾"], [32, "⅔"], [24, "½"], [16, "⅓"], [12, "¼"]];
    for (const [v, s] of EXACT) if (Math.abs(rem - v) < 1e-6) { frac = s; rem = 0; break; }
    if (!frac) for (const [v, s] of [[36, "¾"], [24, "½"], [12, "¼"]]) if (rem >= v - 1e-9) { frac = s; rem -= v; break; }
    if (cups || frac) parts.push((cups ? cups + (frac ? " " + frac : "") : frac) + " cup" + (cups > 1 || (cups === 1 && frac) ? "s" : ""));
    if (rem >= 3 && Math.abs(rem * 2 / 3 - Math.round(rem * 2 / 3)) < 1e-9) {
      parts.push(fmtNum(rem / 3) + " tbsp"); rem = 0;
    } else {
      const tbsp = Math.floor(rem / 3 + 1e-9); rem -= tbsp * 3;
      if (tbsp) parts.push(tbsp + " tbsp");
    }
    if (rem > 0.03) parts.push(fmtNum(rem) + " tsp");
    return parts.join(" + ");
  };
  const title = "Butter to Oil Conversion Chart — 1 Cup Butter = 3/4 Cup Oil | ExactCup";
  const description = "Substitute oil for butter at the standard 3:4 ratio — 1 cup butter = 3/4 cup oil, 1 stick = 6 tbsp. Converter + charts in cups, grams and mL, and when not to swap.";
  const canonical = "/butter-to-oil/";
  // Butter (in tsp) → oil, matching the published NAOOA/Bertolli chart rows exactly.
  const chartRows = [
    ["1 tsp", 1], ["1 tbsp", 3], ["2 tbsp", 6], ["¼ cup (½ stick)", 12], ["⅓ cup", 16],
    ["½ cup (1 stick)", 24], ["⅔ cup", 32], ["¾ cup (1½ sticks)", 36], ["1 cup (2 sticks)", 48], ["2 cups (4 sticks)", 96],
  ].map(([lab, t]) => {
    const o = t * OIL;
    return `<tr><td>${lab}</td><td>${fmtTsp(o)}</td><td class="num">${rnd(o * TSP_ML, 1)} mL</td><td class="num">${rnd(o / 48 * O_GPC, 0)} g</td></tr>`;
  }).join("\n");
  // Metric: butter grams → oil grams/mL. Oil is lighter per cup AND you use less
  // of it, so by weight the factor is 0.75 × 216/227 ≈ 0.71.
  const gRows = [
    ["50 g", 50], ["100 g", 100], ["113.5 g (1 stick)", 113.5], ["150 g", 150],
    ["200 g", 200], ["227 g (1 cup)", 227], ["250 g (1 block)", 250],
  ].map(([lab, bg]) => {
    const cups = bg / B_GPC * OIL;
    return `<tr><td>${lab}</td><td class="num">${rnd(cups * O_GPC, 0)} g</td><td class="num">${rnd(cups * CUP_ML, 0)} mL</td><td>${fmtTsp(cups * 48)}</td></tr>`;
  }).join("\n");
  // Reverse: oil → butter is ×4/3 (rows chosen so every answer lands on a clean measure).
  const revRows = [
    ["2 tbsp", 6], ["¼ cup", 12], ["½ cup", 24], ["¾ cup", 36], ["1 cup", 48],
  ].map(([lab, t]) => {
    const b = t / OIL;
    return `<tr><td>${lab}</td><td>${fmtTsp(b)}${b === 48 ? " (2 sticks)" : ""}</td><td class="num">${rnd(b / 48 * B_GPC, 1)} g</td></tr>`;
  }).join("\n");
  const faq = [
    ["How much oil do I use instead of 1 cup of butter?", "Use 3/4 cup of oil for 1 cup of butter. The standard substitution ratio is 3:4 — three parts oil for every four parts butter, by volume — because butter is only about 80% fat, while oil is all fat."],
    ["How much oil equals 1 stick of butter?", "1 stick of butter is 1/2 cup, so use 6 tablespoons of oil (that's 1/4 cup + 2 tablespoons, about 89 mL or 81 g). For half a stick (1/4 cup butter), use 3 tablespoons of oil."],
    ["Is substituting oil for butter a 1:1 swap?", "The standard published charts say no — use 3/4 as much oil. But when a recipe calls for melted butter (brownies, many quick breads), plenty of bakers swap oil 1:1 by volume and accept a slightly richer, moister result. Both conventions exist; the 3:4 ratio matches the fat content, the 1:1 swap matches the liquid volume."],
    ["Why do you use less oil than butter?", "Because butter isn't pure fat. Per USDA data, butter is about 81% fat and 16% water (the rest is milk solids). Oil is 100% fat, so 3/4 cup of oil delivers roughly the same fat as a full cup of butter."],
    ["Can I use oil instead of butter in cake?", "Only partly, for classic creamed cakes. Creaming butter and sugar traps the air that leavens the cake, and oil can't hold air — King Arthur Baking recommends replacing just 25% (up to 50%) of the butter with oil for a moister crumb while still creaming normally. Cakes mixed like quick breads (with melted fat) take a full swap well."],
    ["Can I use oil instead of butter in cookies?", "It's not recommended. Cookies rely on solid fat for structure and spread control — in King Arthur Baking's cookie-chemistry testing, all-oil cookies came out tender but greasy and flat. Use butter, or a recipe written for oil."],
    ["Can I use oil instead of butter in brownies?", "Yes — brownies are the best-case swap, because most recipes call for melted butter anyway and don't depend on creaming. Use 3/4 the amount of oil (or swap 1:1 for extra-moist brownies), and expect to lose a little buttery flavor."],
    ["100 grams of butter is how much oil?", "About 71 g of oil, or 78 mL — almost exactly 1/3 cup. By weight the factor is ~0.71, not 0.75, because oil is also slightly lighter than butter per cup (216 vs 227 g)."],
    ["Which oil should I use in place of butter?", "A neutral oil (canola, vegetable, sunflower) keeps the flavor closest to the original. Olive oil works beautifully in chocolate, citrus and spice bakes and in anything savory — that's the swap the 3:4 chart was originally published for."],
    ["Can I substitute butter for oil — the other direction?", "Yes: use 1/3 more butter than the oil called for (multiply by 4/3), melted and cooled slightly — so 1/2 cup oil becomes 2/3 cup butter. Butter brings water along, so the crumb will be a bit firmer and drier; for the moistest result many bakers just swap melted butter 1:1 for oil."],
    ["Does the 3:4 butter-to-oil ratio work by weight?", "No — the ratio is by volume (cups and tablespoons). By weight, use about 71% of the butter's weight in oil (100 g butter ≈ 71 g oil), because a cup of oil also weighs slightly less than a cup of butter."],
    ["Can I use oil in pie crust or puff pastry?", "No. Flaky pastry depends on cold solid fat forming layers that steam apart in the oven — a liquid oil just coats the flour and turns the crust mealy. Stick with butter (or another solid fat) for pie crusts, croissants and puff pastry."],
  ];
  const jsonLd = [
    appLd("Butter to Oil Converter", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Butter to Oil", canonical]]),
  ];
  const body = `
<h1>Butter to Oil Conversion</h1>
<p class="lead">The standard substitution is <strong>3 parts oil for every 4 parts butter</strong> — so 1 cup of butter becomes <strong>¾ cup of oil</strong>, and 1 stick becomes <strong>6 tablespoons</strong>. Enter any butter amount to get the oil equivalent.</p>
<div class="calc">
  <div class="row">
    <div class="field"><label for="bo-amt">Butter amount</label><input id="bo-amt" type="text" inputmode="decimal" value="1" placeholder="e.g. 1/2 or 0.5"></div>
    <div class="field"><label for="bo-unit">Unit</label><select id="bo-unit"><option value="cups">cups</option><option value="sticks">sticks</option><option value="tbsp">tablespoons</option><option value="grams">grams</option></select></div>
  </div>
  <div class="result"><div class="big" id="bo-out">—</div><div class="sub" id="bo-sub"></div></div>
</div>
<p class="note">The 3:4 ratio is by <strong>volume</strong>, not weight — see the grams table below for metric amounts. It's the ratio published by the North American Olive Oil Association and echoed by Bertolli and Bob's Red Mill; it works for any liquid oil, olive or neutral.</p>
<h2>Butter to oil conversion chart</h2>
<table><thead><tr><th>Butter</th><th>Oil</th><th>Oil (mL)</th><th>Oil (g, olive)</th></tr></thead><tbody>
${chartRows}
</tbody></table>
<h2>Why only ¾ as much oil?</h2>
<p>Butter is not pure fat: per <strong>USDA FoodData Central</strong>, it's about <strong>81% fat and 16% water</strong>, with a little milk solids making up the rest. Oil is 100% fat. Using the full volume of oil would make the batter noticeably greasier, so the standard charts scale it down to ¾ — which almost exactly matches the fat you're replacing. The water butter loses isn't usually missed in moist batters; in drier doughs it can be (see the "when it works" list below).</p>
<h2>Butter to oil in grams</h2>
<p>Baking by weight? Two things stack: you use ¾ of the volume, <em>and</em> a cup of oil weighs slightly less than a cup of butter (216 g vs 227 g). Net factor: <strong>multiply the butter weight by ~0.71</strong>.</p>
<table><thead><tr><th>Butter</th><th>Oil (g)</th><th>Oil (mL)</th><th>Oil (measured)</th></tr></thead><tbody>
${gRows}
</tbody></table>
<h2>When the swap works — and when it doesn't</h2>
<p><strong>Swap freely:</strong> muffins, quick breads (banana, zucchini, pumpkin), pancakes and waffles, brownies and other melted-butter recipes, moist dense cakes, pizza dough and focaccia. Anywhere the recipe melts the butter anyway, oil behaves almost identically.</p>
<p><strong>Think twice:</strong> recipes that <em>cream butter and sugar</em> — the creaming step traps the air that lifts the bake, and oil can't hold air. For those cakes, <strong>King Arthur Baking</strong> suggests replacing only 25–50% of the butter with oil and creaming the rest normally. <strong>Don't swap:</strong> cookies (all-oil cookies bake up greasy and flat), pie crust, croissants and puff pastry — flaky textures need cold solid fat.</p>
<h2>The 3:4 rule vs the 1:1 melted-butter swap</h2>
<p>You'll meet two honest conventions. The <strong>3:4 chart ratio</strong> (this page) matches the <em>fat</em> content and is the safe default. When a recipe already calls for <em>melted</em> butter, many bakers simply pour in the same volume of oil — a <strong>1:1</strong> swap that matches the <em>liquid</em> and gives a slightly richer, moister result. Either produces a good bake in melted-butter recipes; pick one and note what you did.</p>
<h2>Oil to butter — the reverse</h2>
<p>Going the other way, multiply the oil by 4/3 and use melted butter:</p>
<table><thead><tr><th>Oil</th><th>Butter</th><th>Butter (g)</th></tr></thead><tbody>
${revRows}
</tbody></table>
<p class="note">Butter brings ~16% water with it, so an oil recipe made with butter bakes up slightly firmer and drier — many bakers swap melted butter 1:1 for oil and accept that trade for the flavor.</p>
<h2>Need a different conversion?</h2>
<p>Measuring the butter itself — sticks, cups, tablespoons, grams? Use the <a href="/butter-converter/">butter converter</a>. Weighing it? <a href="/cups-to-grams/butter/">1 cup of butter is 227 g</a>, and a cup of <a href="/cups-to-grams/olive-oil/">olive oil is 216 g</a> (<a href="/cups-to-grams/vegetable-oil/">vegetable oil: 218 g</a>). Halving the recipe while you're at it? The <a href="/recipe-halving-chart/">recipe halving chart</a> keeps every measure on a real spoon, and <a href="/tablespoons-in-a-cup/">tablespoons in a cup</a> spells out every cup fraction in spoons. Swapping the sweetener too? The <a href="/sugar-to-honey/">sugar to honey conversion</a> works the same way — a fixed ratio plus a few small recipe adjustments. The other swap charts on the site: the <a href="/cake-flour-substitute/">cake flour substitute</a> (2 tbsp cornstarch into every cup of all-purpose flour), the <a href="/cornstarch-to-flour/">cornstarch to flour thickener conversion</a> (cornstarch thickens twice as hard, so use half as much) and the <a href="/baking-powder-substitute/">baking powder substitute</a> (¼ tsp baking soda + ½ tsp cream of tartar per teaspoon of powder).</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "butteroil" } }) };
}

// Sugar → honey substitution. The published guidance genuinely disagrees on the
// ratio — King Arthur says ¾ cup honey per cup of sugar; the National Honey Board
// says replace up to HALF the sugar; Clemson Extension says start at ½ — so the
// page shows both conventions side by side instead of pretending there's one rule.
// The three adjustments (liquid −¼ cup, baking soda +½ tsp, oven −25°F) are per
// cup of HONEY used, per NHB/Clemson. Note: soda is ½ tsp, NOT the ¼ tsp many
// circulating charts copy from each other.
function sugarToHoneyPage() {
  const H_GPC = 340, S_GPC = 200; // site-verified g per US cup (USDA: honey 339, sugar 200; KA: 336/198)
  const R = 0.75; // King Arthur rule — honey per sugar, by volume
  const rnd = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  // Render a teaspoon count the way a cook measures it: "¼ cup + 2 tbsp".
  const fmtNum = (x) => {
    const FR = [[0.25, "¼"], [0.5, "½"], [0.75, "¾"]];
    const whole = Math.floor(x + 1e-9), rest = x - whole;
    let frac = "";
    if (rest > 0.03) {
      for (const [v, s] of FR) if (Math.abs(rest - v) < 0.02) { frac = s; break; }
      if (!frac) return String(rnd(x, 2));
    }
    return whole ? whole + frac : (frac || "0");
  };
  const fmtTsp = (t) => {
    const parts = [];
    const cups = Math.floor(t / 48 + 1e-9);
    let rem = t - cups * 48, frac = "";
    const EXACT = [[36, "¾"], [32, "⅔"], [24, "½"], [16, "⅓"], [12, "¼"]];
    for (const [v, s] of EXACT) if (Math.abs(rem - v) < 1e-6) { frac = s; rem = 0; break; }
    if (!frac) for (const [v, s] of [[36, "¾"], [24, "½"], [12, "¼"]]) if (rem >= v - 1e-9) { frac = s; rem -= v; break; }
    if (cups || frac) parts.push((cups ? cups + (frac ? " " + frac : "") : frac) + " cup" + (cups > 1 || (cups === 1 && frac) ? "s" : ""));
    if (rem >= 3 && Math.abs(rem * 2 / 3 - Math.round(rem * 2 / 3)) < 1e-9) {
      parts.push(fmtNum(rem / 3) + " tbsp"); rem = 0;
    } else {
      const tbsp = Math.floor(rem / 3 + 1e-9); rem -= tbsp * 3;
      if (tbsp) parts.push(tbsp + " tbsp");
    }
    if (rem > 0.03) parts.push(fmtNum(rem) + " tsp");
    return parts.join(" + ");
  };
  const title = "Sugar to Honey Conversion Chart — Substitute Honey for Sugar | ExactCup";
  const description = "How much honey replaces 1 cup of sugar? ½–¾ cup (≈255 g by the ¾ rule). Then cut liquid ¼ cup and add ½ tsp baking soda per cup of honey, and bake 25°F lower.";
  const canonical = "/sugar-to-honey/";
  // Sugar (in tsp) → honey under both published conventions.
  const chartRows = [
    ["1 tbsp", 3], ["2 tbsp", 6], ["¼ cup", 12], ["⅓ cup", 16], ["½ cup", 24],
    ["⅔ cup", 32], ["¾ cup", 36], ["1 cup", 48], ["1½ cups", 72], ["2 cups", 96],
  ].map(([lab, s]) => {
    const h = s * R;
    return `<tr><td>${lab}</td><td>${fmtTsp(h)}</td><td>${fmtTsp(s * 0.5)}</td><td class="num">${rnd(h / 48 * H_GPC, 0)} g</td></tr>`;
  }).join("\n");
  // Metric: honey is used at ¾ the volume but is much denser than sugar
  // (340 vs 200 g/cup), so by WEIGHT you need MORE honey: 0.75 × 340/200 = 1.275.
  const gRows = [
    ["50 g", 50], ["100 g", 100], ["150 g", 150], ["200 g (1 cup)", 200], ["250 g", 250], ["300 g", 300],
  ].map(([lab, sg]) => {
    const hc = sg / S_GPC * R;
    return `<tr><td>${lab}</td><td class="num">${rnd(hc * H_GPC, 0)} g</td><td>${fmtTsp(hc * 48)}</td></tr>`;
  }).join("\n");
  // Reverse: 1 cup honey → 1¼ cups sugar + ¼ cup extra liquid (USU Extension FN255).
  const revRows = [
    ["¼ cup", 12], ["½ cup", 24], ["¾ cup", 36], ["1 cup", 48],
  ].map(([lab, h]) => {
    const s = h * 1.25;
    return `<tr><td>${lab}</td><td>${fmtTsp(s)}</td><td class="num">${rnd(s / 48 * S_GPC, 0)} g</td><td>${fmtTsp(h * 0.25)}</td></tr>`;
  }).join("\n");
  const faq = [
    ["How much honey do I use instead of 1 cup of sugar?", "Between 1/2 and 3/4 cup. King Arthur Baking's rule is a generous 3/4 cup of honey per cup of sugar; the National Honey Board and Clemson Extension are more conservative and suggest replacing sugar with about half its amount in honey (or replacing only half the sugar). The chart on this page shows both. Whichever you pick, also cut the recipe's liquid, add a little baking soda and lower the oven — see the three adjustments."],
    ["How much honey equals 1/2 cup of sugar?", "By the 3/4 rule, 6 tablespoons of honey (1/4 cup + 2 tbsp, about 128 g). By the conservative 1/2 rule, 1/4 cup (about 85 g)."],
    ["Do I need to reduce the liquid when I bake with honey?", "Yes. Honey is about 17% water (USDA), so reduce the recipe's other liquid by 1/4 cup for every 1 cup of honey used — that's the National Honey Board and Clemson Extension figure; King Arthur says 3–4 tablespoons, which is the same range. If the recipe has no added liquid at all, King Arthur suggests adding 3–4 tablespoons of extra flour per cup of honey instead."],
    ["How much baking soda do I add per cup of honey?", "1/2 teaspoon per cup of honey — that's the figure both the National Honey Board and Clemson Extension publish. Many circulating charts say 1/4 teaspoon, but that's not what the primary sources recommend. The soda neutralizes honey's acidity (average pH 3.9) and helps the bake rise and brown evenly. Skip the extra soda if the recipe already uses buttermilk, sour milk or sour cream — they do the same job."],
    ["Why do I lower the oven temperature by 25°F?", "Honey's fructose caramelizes and scorches at lower temperatures than granulated sugar, so honey-sweetened bakes brown much faster. Reduce the oven by 25°F (about 15°C), and take King Arthur's ceiling seriously: avoid using honey in recipes baked above 350°F — it scorches."],
    ["Is honey sweeter than sugar?", "Yes, modestly. The National Honey Board puts it at 1 to 1.5 times sweeter than sugar on a dry-weight basis, mostly because fructose predominates. Per cup the gap is bigger: a cup of honey weighs 340 g and is about 82% sugars (roughly 278 g), versus 200 g in a cup of granulated sugar — which is why you use less honey by volume."],
    ["Can I substitute honey for sugar 1:1?", "Sweetening tea, coffee, oatmeal or yogurt — sure, to taste; nothing needs to be balanced. In baking, no authoritative chart endorses a 1:1 volume swap: you'd be adding more sweetness, more water and faster browning at once. For a tablespoon or two the difference hardly matters, but for 1/4 cup and up, scale it down and make the three adjustments."],
    ["How many grams is a cup of honey?", "About 340 g — USDA lists 339 g per cup and King Arthur 336 g (12 oz); brands vary slightly. One tablespoon is 21 g. Note that a cup of honey weighs about 12 ounces on a scale even though it's 8 fluid ounces by volume — fluid ounces and weight ounces are different things."],
    ["How much honey replaces 100 g of sugar?", "About 128 g of honey. It surprises people: honey replaces sugar at 3/4 the VOLUME, but honey is much denser (340 vs 200 g per cup), so by weight you need about 1.28× as many grams — more honey on the scale, less in the measuring cup."],
    ["My recipe calls for 1 cup of honey — how much sugar do I use instead?", "Going the other direction, use 1 1/4 cups of granulated sugar plus 1/4 cup of extra liquid (water, milk — whatever the recipe uses) for each cup of honey, per Utah State University Extension. You can also leave out any baking soda the recipe added specifically to offset the honey."],
    ["How does honey change the texture and flavor of a bake?", "Expect a moister, slightly denser crumb, a darker color, and a floral note that depends on the honey (clover is mild; buckwheat is bold). Honey is hygroscopic — it pulls in moisture — so honey-sweetened bakes stay soft for days. Cookies are the biggest change: they spread more and turn soft and cakey rather than crisp."],
    ["Is honey safe for everyone?", "One firm exception: never give honey in any form to babies under 12 months — it can contain Clostridium botulinum spores, which baking does not reliably destroy. For everyone else, honey behaves like any other sugar in the diet."],
  ];
  const jsonLd = [
    appLd("Sugar to Honey Converter", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Sugar to Honey", canonical]]),
  ];
  const body = `
<h1>Sugar to Honey Conversion</h1>
<p class="lead">To replace 1 cup of granulated sugar, use <strong>½ to ¾ cup of honey</strong> — then cut the recipe's liquid by ¼ cup and add ½ tsp of baking soda per cup of honey, and bake 25°F lower. Enter any sugar amount to get the honey equivalent and the adjustments, scaled.</p>
<div class="calc">
  <div class="row">
    <div class="field"><label for="sh-amt">Sugar amount</label><input id="sh-amt" type="text" inputmode="decimal" value="1" placeholder="e.g. 1/2 or 0.5"></div>
    <div class="field"><label for="sh-unit">Unit</label><select id="sh-unit"><option value="cups">cups</option><option value="tbsp">tablespoons</option><option value="grams">grams</option></select></div>
  </div>
  <div class="result"><div class="big" id="sh-out">—</div><div class="sub" id="sh-sub"></div><div class="sub" id="sh-adj"></div></div>
</div>
<p class="note">Honest disclosure: the sources disagree on the ratio. The <strong>¾-cup rule</strong> (used by the converter) is <strong>King Arthur Baking's</strong>; the <strong>National Honey Board</strong> itself suggests replacing only <em>up to half</em> the sugar, and <strong>Clemson Extension</strong> says to start with <em>half</em> the amount in honey. Less honey = a safer, drier, less sweet result; ¾ = the fuller flavor most charts use. Both work — the chart shows both.</p>
<h2>Sugar to honey conversion chart</h2>
<table><thead><tr><th>Sugar</th><th>Honey — ¾ rule (King Arthur)</th><th>Honey — ½ rule (NHB / Clemson)</th><th>Honey (g, ¾ rule)</th></tr></thead><tbody>
${chartRows}
</tbody></table>
<h2>The three adjustments that make it work</h2>
<p>Swapping the sweetener is the easy part — honey also brings <strong>water</strong> and <strong>acid</strong> with it, and it <strong>browns faster</strong>. For every <strong>1 cup of honey</strong> that goes into the recipe:</p>
<table><thead><tr><th>Adjustment</th><th>Amount</th><th>Why</th></tr></thead><tbody>
<tr><td>Cut other liquid</td><td>−¼ cup</td><td>Honey is ~17% water (USDA)</td></tr>
<tr><td>Add baking soda</td><td>+½ tsp</td><td>Neutralizes honey's acidity (average pH 3.9)</td></tr>
<tr><td>Lower the oven</td><td>−25°F</td><td>Fructose scorches at lower temperatures</td></tr>
</tbody></table>
<p class="note">Two fine points from the sources: if the recipe has <em>no</em> added liquid, King Arthur suggests adding 3–4 tbsp of flour per cup of honey instead of cutting liquid; and skip the extra baking soda when the recipe already uses buttermilk, sour milk or sour cream. Watch for a widespread copy-paste error: many charts say ¼ tsp of soda, but the National Honey Board and Clemson Extension both say <strong>½ tsp per cup of honey</strong>. And King Arthur's ceiling: don't use honey in recipes baked above 350°F.</p>
<h2>Why do you use less honey than sugar?</h2>
<p>Two reasons. Honey is <strong>sweeter</strong> — the National Honey Board puts it at 1 to 1.5× the sweetness of sugar on a dry-weight basis, because fructose (its dominant sugar) tastes sweeter than sucrose. And a cup of honey simply <strong>contains more sugar</strong>: it weighs 340 g and is about 82% sugars, so a cup carries roughly 278 g of actual sugars versus 200 g in a cup of granulated. Scale the volume down to ½–¾ and the sweetness lands about right.</p>
<h2>Sugar to honey by weight (grams)</h2>
<p>Here's the counter-intuitive part for metric bakers: honey replaces sugar at ¾ the <em>volume</em>, but honey is far denser (340 vs 200 g per cup) — so by <em>weight</em> you need <strong>about 1.28× as many grams of honey</strong>. Less in the cup, more on the scale.</p>
<table><thead><tr><th>Sugar</th><th>Honey (g)</th><th>Honey (measured)</th></tr></thead><tbody>
${gRows}
</tbody></table>
<h2>When the swap works — and when it doesn't</h2>
<p><strong>Swap happily:</strong> quick breads (banana, zucchini, pumpkin), muffins, snack cakes, granola, yeast breads (honey feeds the yeast), marinades, glazes, dressings, sauces and drinks. Honey's moisture-holding (hygroscopic) nature keeps these soft for days.</p>
<p><strong>Think twice:</strong> crisp cookies — honey makes them spread more and bake up soft and cakey; delicate white or sponge cakes — the extra browning and floral flavor take over; and anything built on sugar's <em>crystals</em> — creamed-butter structure, meringue, royal icing, candy and caramel work because granulated sugar is dry and crystalline, and a liquid sweetener changes the chemistry entirely.</p>
<h2>Honey to sugar — the reverse</h2>
<p>Recipe written for honey but you only have sugar? Use <strong>1¼ cups of sugar plus ¼ cup of extra liquid per cup of honey</strong> (Utah State University Extension):</p>
<table><thead><tr><th>Honey</th><th>Sugar</th><th>Sugar (g)</th><th>Extra liquid</th></tr></thead><tbody>
${revRows}
</tbody></table>
<h2>Need a different conversion?</h2>
<p>Just measuring, not substituting? <a href="/cups-to-grams/honey/">1 cup of honey is 340 g</a> and <a href="/cups-to-grams/granulated-sugar/">1 cup of granulated sugar is 200 g</a> — the <a href="/sugar-conversion-chart/">sugar &amp; sweetener chart</a> covers brown sugar, <a href="/cups-to-grams/maple-syrup/">maple syrup (322 g)</a>, molasses and the rest. Swapping fats too? The <a href="/butter-to-oil/">butter to oil conversion</a> works the same way: a fixed ratio plus a couple of honest adjustments — as do the <a href="/cake-flour-substitute/">cake flour substitute</a> (2 tbsp cornstarch per cup of all-purpose flour) and the <a href="/cornstarch-to-flour/">cornstarch to flour thickener conversion</a> (half as much cornstarch as flour). And the ½ tsp of baking soda this page adds per cup of honey? The <a href="/baking-powder-substitute/">baking powder substitute</a> page covers that whole soda-vs-powder chemistry, both directions. Halving the recipe while you're at it? See the <a href="/recipe-halving-chart/">recipe halving chart</a>.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "sugarhoney" } }) };
}

// Cake flour substitute. The 14-tbsp rule is unanimous across the primary
// sources (King Arthur, America's Test Kitchen, Bob's Red Mill): per 1 cup of
// cake flour, 14 tbsp AP flour (= ¾ cup + 2 tbsp = ⅞ cup = 1 cup minus 2 tbsp
// — all the same amount) + 2 tbsp cornstarch. KA gives it by weight as
// 105 g + 14 g and says the blend subs for cake flour by equal weight or
// volume. Two honest wrinkles the page discloses: a no-cornstarch variant
// (1 cup minus 2 tbsp AP, Virginia Cooperative Extension) is a real published
// convention, and a garbled "¾ cup AP + 2 tbsp cornstarch" version (12 tbsp of
// flour instead of 14) circulates — it even appears on a university extension
// page. All chart values are computed from the site-verified densities
// (AP flour 120 g/cup, cornstarch 112 g/cup — both matching the KA chart).
function cakeFlourSubstitutePage() {
  const AP_GPC = 120, CS_GPC = 112; // g per US cup, site-verified (= KA chart)
  const AP_TSP = 42 / 48, CS_TSP = 6 / 48; // per tsp of cake flour: AP + cornstarch fractions
  const AP_G = 105, CS_G = 14; // KA's per-cup weights; blend = 119 g per cup of cake flour
  const rnd = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  const fmtNum = (x) => {
    const FR = [[0.25, "¼"], [0.5, "½"], [0.75, "¾"]];
    const whole = Math.floor(x + 1e-9), rest = x - whole;
    let frac = "";
    if (rest > 0.03) {
      for (const [v, s] of FR) if (Math.abs(rest - v) < 0.02) { frac = s; break; }
      if (!frac) return String(rnd(x, 2));
    }
    return whole ? whole + frac : (frac || "0");
  };
  const fmtTsp = (t) => {
    const parts = [];
    const cups = Math.floor(t / 48 + 1e-9);
    let rem = t - cups * 48, frac = "";
    const EXACT = [[36, "¾"], [32, "⅔"], [24, "½"], [16, "⅓"], [12, "¼"]];
    for (const [v, s] of EXACT) if (Math.abs(rem - v) < 1e-6) { frac = s; rem = 0; break; }
    if (!frac) for (const [v, s] of [[36, "¾"], [24, "½"], [12, "¼"]]) if (rem >= v - 1e-9) { frac = s; rem -= v; break; }
    if (cups || frac) parts.push((cups ? cups + (frac ? " " + frac : "") : frac) + " cup" + (cups > 1 || (cups === 1 && frac) ? "s" : ""));
    if (rem >= 3 && Math.abs(rem * 2 / 3 - Math.round(rem * 2 / 3)) < 1e-9) {
      parts.push(fmtNum(rem / 3) + " tbsp"); rem = 0;
    } else {
      const tbsp = Math.floor(rem / 3 + 1e-9); rem -= tbsp * 3;
      if (tbsp) parts.push(tbsp + " tbsp");
    }
    if (rem > 0.03) parts.push(fmtNum(rem) + " tsp");
    return parts.join(" + ");
  };
  // grams: whole numbers read best, but keep a decimal on small cornstarch amounts
  const gFmt = (g) => (g < 10 ? rnd(g, 1) : Math.round(g)) + " g";
  const title = "Cake Flour Substitute — Make Cake Flour from All-Purpose Flour | ExactCup";
  const description = "No cake flour? Per cup, whisk ¾ cup + 2 tbsp all-purpose flour (105 g) with 2 tbsp cornstarch (14 g). Chart and calculator for any amount, in cups or grams.";
  const canonical = "/cake-flour-substitute/";
  // Cake flour needed (in tsp) → AP flour + cornstarch, measured and in grams.
  const chartRows = [
    ["¼ cup", 12], ["⅓ cup", 16], ["½ cup", 24], ["⅔ cup", 32], ["¾ cup", 36],
    ["1 cup", 48], ["1¼ cups", 60], ["1½ cups", 72], ["2 cups", 96], ["3 cups", 144],
  ].map(([lab, t]) => {
    const ap = t * AP_TSP, cs = t * CS_TSP;
    return `<tr><td>${lab}</td><td>${fmtTsp(ap)}</td><td class="num">${gFmt(ap / 48 * AP_GPC)}</td><td>${fmtTsp(cs)}</td><td class="num">${gFmt(cs / 48 * CS_GPC)}</td></tr>`;
  }).join("\n");
  // By weight: KA's 105 g + 14 g blend (119 g) stands in for a cup of cake
  // flour by EQUAL WEIGHT, so a recipe's grams split 105:14 across the blend.
  const gRows = [100, 150, 200, 250, 300, 500].map((g) => {
    const ap = g * AP_G / (AP_G + CS_G), cs = g * CS_G / (AP_G + CS_G);
    return `<tr><td>${g} g</td><td class="num">${Math.round(ap)} g</td><td class="num">${Math.round(cs)} g</td></tr>`;
  }).join("\n");
  // Reverse: recipe written for AP flour, baker wants the finer cake-flour crumb.
  // Swans Down + Utah State Extension: 1 cup + 2 tbsp cake flour per cup of AP.
  const revRows = [
    ["½ cup", 24], ["1 cup", 48], ["1½ cups", 72], ["2 cups", 96],
  ].map(([lab, ap]) => {
    const cake = ap * 54 / 48;
    return `<tr><td>${lab}</td><td>${fmtTsp(cake)}</td><td class="num">${Math.round(cake / 48 * AP_GPC)} g</td></tr>`;
  }).join("\n");
  const faq = [
    ["How do I make 1 cup of cake flour from all-purpose flour?", "Measure 1 cup of all-purpose flour, remove 2 tablespoons, then add 2 tablespoons of cornstarch and whisk to combine. That's 3/4 cup + 2 tbsp of flour (105 g) plus 2 tbsp of cornstarch (14 g) — the same rule King Arthur Baking, America's Test Kitchen and Bob's Red Mill all publish. Use the blend in place of cake flour, measure for measure."],
    ["Is it 3/4 cup or 7/8 cup of all-purpose flour?", "Both — they're the same amount. 3/4 cup + 2 tablespoons, 7/8 cup, and 1 cup minus 2 tablespoons are all exactly 14 tablespoons. Watch out for a garbled version in circulation (it even appears on a university extension page): a plain '3/4 cup of all-purpose flour plus 2 tablespoons of cornstarch' silently drops 2 tablespoons of flour and shorts the recipe by an eighth of a cup."],
    ["Can I substitute all-purpose flour without adding cornstarch?", "You can — it's a real published convention, not a mistake. Virginia Cooperative Extension's substitution chart says 1 cup minus 2 tablespoons of all-purpose flour per cup of cake flour, with no cornstarch. It reduces the amount of flour rather than the protein percentage, so the crumb lands a little closer to an everyday all-purpose bake. If you have cornstarch, the blend gets you closer to true cake flour."],
    ["Do I sift or whisk the flour and cornstarch together?", "King Arthur Baking says simply whisk them together. Bob's Red Mill goes the other way and advises sifting — as many as five times — for the fluffiest cakes. Sifting distributes the cornstarch evenly and adds air, but no primary source treats it as mandatory; whisking thoroughly is the accepted minimum."],
    ["Why does adding cornstarch make all-purpose flour act like cake flour?", "Dilution. Cornstarch is essentially protein-free, so cutting all-purpose flour with it lowers the blend's overall protein content toward cake flour's. Less protein means less gluten develops when the batter is mixed, and that's what gives cake-flour bakes their fine, tender crumb. King Arthur, America's Test Kitchen and Bob's Red Mill all describe it the same way."],
    ["What is the protein difference between cake flour and all-purpose flour?", "Classic bleached cake flour (Swans Down style) runs about 6–9% protein versus roughly 10–12% for all-purpose — the ranges America's Test Kitchen and Bob's Red Mill publish. One nuance: King Arthur's unbleached cake flour is 10% protein against their 11.7% all-purpose, a much smaller gap. Either way, cake flour is the lowest-protein wheat flour on the shelf."],
    ["How do I make cake flour by weight?", "For every 100 g of cake flour a recipe calls for, whisk together 88 g of all-purpose flour and 12 g of cornstarch. That's King Arthur's 105 g + 14 g per-cup blend scaled down — they state it substitutes for cake flour by equal weight or volume. (Cook's Illustrated publishes a starchier mix — about 20 g of cornstarch per 100 g of flour — proof the ratio has some slack.)"],
    ["How much does a cup of cake flour weigh?", "It depends on the brand more than people expect. King Arthur lists its unbleached cake flour at 120 g per cup — the same as its all-purpose flour. Bob's Red Mill and Swans Down package labels work out to about 112 g per cup. This site's charts use the King Arthur 120 g convention."],
    ["How much cornstarch do I add to 2 cups of all-purpose flour?", "Swap 2 tablespoons per cup: remove 4 tablespoons (1/4 cup) of flour from the 2 cups, then add 4 tablespoons of cornstarch. By weight that's 210 g of all-purpose flour + 28 g of cornstarch standing in for 2 cups of cake flour. The chart above spells out every common amount."],
    ["Can I use self-rising flour instead of cake flour?", "No. Self-rising flour is flour with baking powder (about 1 1/2 tsp per cup) and salt already mixed in, so swapping it for cake flour adds leavening and salt the recipe never asked for — on top of the wrong protein level. Use the flour-plus-cornstarch blend instead."],
    ["My recipe calls for all-purpose flour — can I use cake flour instead?", "Going that direction, use 1 cup plus 2 tablespoons of cake flour for every cup of all-purpose — the rule published by both Swans Down and Utah State University Extension. Expect a more delicate result, and don't push it into sturdy bakes: King Arthur cautions that cake flour swapped 1:1 into a recipe built for all-purpose can mean sunken cakes or cookies that fall apart."],
    ["Does the substitute work for angel food or chiffon cake?", "It's weakest there. The blend is great in everyday butter cakes, cupcakes, muffins and snack cakes. The most delicate high-egg-white bakes — angel food, chiffon, pure white cakes — are usually developed around real bleached cake flour, which America's Test Kitchen notes produces a loftier cake. The substitute will still bake up fine, just a little less tall with a slightly coarser crumb."],
  ];
  const jsonLd = [
    appLd("Cake Flour Substitute Calculator", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Cake Flour Substitute", canonical]]),
  ];
  const body = `
<h1>Cake Flour Substitute</h1>
<p class="lead">No cake flour? For every <strong>1 cup of cake flour</strong>, whisk together <strong>¾ cup + 2 tbsp of all-purpose flour</strong> (105 g) and <strong>2 tbsp of cornstarch</strong> (14 g) — the rule King Arthur Baking, America's Test Kitchen and Bob's Red Mill all agree on. Enter any amount to get the blend, measured or in grams.</p>
<div class="calc">
  <div class="row">
    <div class="field"><label for="cf-amt">Cake flour needed</label><input id="cf-amt" type="text" inputmode="decimal" value="1" placeholder="e.g. 1/2 or 1 1/2"></div>
    <div class="field"><label for="cf-unit">Unit</label><select id="cf-unit"><option value="cups">cups</option><option value="tbsp">tablespoons</option><option value="grams">grams</option></select></div>
  </div>
  <div class="result"><div class="big" id="cf-out">—</div><div class="sub" id="cf-sub"></div><div class="sub" id="cf-adj"></div></div>
</div>
<p class="note">One amount, three phrasings: <strong>¾ cup + 2 tbsp</strong>, <strong>⅞ cup</strong> and <strong>1 cup minus 2 tbsp</strong> are all exactly <strong>14 tablespoons</strong> of flour — sources word the same rule differently. But watch for a garbled copy that circulates widely (even on a university extension page): plain <em>"¾ cup of all-purpose flour plus 2 tbsp cornstarch"</em> quietly drops 2 tablespoons of flour and shorts the recipe.</p>
<h2>Cake flour substitute chart</h2>
<table><thead><tr><th>Cake flour needed</th><th>All-purpose flour</th><th>Flour (g)</th><th>Cornstarch</th><th>Cornstarch (g)</th></tr></thead><tbody>
${chartRows}
</tbody></table>
<p class="note">Whisk the two together thoroughly before using (King Arthur's instruction). Bob's Red Mill suggests sifting the blend — up to five times — for the airiest cakes; sifting isn't mandatory, but it does distribute the cornstarch evenly.</p>
<h2>Why the cornstarch works</h2>
<p>Cake flour is simply <strong>lower-protein</strong> flour: classic bleached cake flour runs about <strong>6–9% protein</strong> against roughly <strong>10–12%</strong> for all-purpose (King Arthur's unbleached cake flour is a narrower 10% vs 11.7%). Cornstarch contains essentially no protein, so replacing part of the flour with it <strong>dilutes the blend's protein</strong> toward cake-flour territory. Less protein → less gluten when the batter is mixed → the fine, tender, melt-away crumb cake flour is famous for. The cornstarch also brings some extra tenderness of its own.</p>
<h2>Cake flour substitute by weight (grams)</h2>
<p>Baking by scale? King Arthur's blend is <strong>105 g all-purpose flour + 14 g cornstarch</strong> per cup of cake flour, and they state it substitutes <em>by equal weight or volume</em> — so for a metric recipe, split the recipe's cake-flour grams roughly <strong>88% flour : 12% cornstarch</strong>:</p>
<table><thead><tr><th>Cake flour called for</th><th>All-purpose flour</th><th>Cornstarch</th></tr></thead><tbody>
${gRows}
</tbody></table>
<p class="note">Honest footnote for scale bakers: Cook's Illustrated publishes a noticeably starchier blend — about 20 g of cornstarch per 100 g of flour — while its sibling America's Test Kitchen page matches the King Arthur ratio. The rule has slack; more cornstarch leans more tender.</p>
<h2>The no-cornstarch variant</h2>
<p>Older substitution charts — still published by <strong>Virginia Cooperative Extension</strong> — skip the cornstarch entirely: use <strong>1 cup minus 2 tbsp of all-purpose flour</strong> per cup of cake flour and stop there. That version reduces the <em>amount</em> of flour (and so total gluten) rather than the protein <em>percentage</em>, and it works acceptably in sturdy cakes. If there's cornstarch in the pantry, the blend above gets closer to the real thing.</p>
<h2>The reverse: using cake flour in an all-purpose recipe</h2>
<p>Going the other way — the recipe says all-purpose, and you'd like a finer crumb — use <strong>1 cup + 2 tbsp of cake flour per cup of all-purpose</strong> (the Swans Down and Utah State University Extension rule; cake flour is lighter, so it takes a little more of it):</p>
<table><thead><tr><th>All-purpose called for</th><th>Cake flour to use</th><th>Cake flour (g)</th></tr></thead><tbody>
${revRows}
</tbody></table>
<p class="note">Keep the swap to tender bakes. King Arthur cautions that cake flour pushed 1:1 into a recipe developed for all-purpose can give sunken cakes and bars, or cookies too delicate to hold together. And if the recipe calls for cake flour and you'd rather just use plain all-purpose 1:1 (by weight), that works too — expect a slightly coarser, sturdier crumb.</p>
<h2>Where the substitute shines — and where it doesn't</h2>
<p><strong>Use it confidently:</strong> butter and oil cakes, cupcakes, snack cakes, muffins, pancakes and biscuits — anywhere cake flour is there for tenderness.</p>
<p><strong>Think twice:</strong> angel food, chiffon and pure white cakes, which are usually developed around real <em>bleached</em> cake flour (America's Test Kitchen notes it produces a loftier cake than unbleached flour). The blend still bakes up fine there — just a touch shorter and coarser. And <strong>don't reach for self-rising flour</strong>: it's flour plus baking powder and salt, which the recipe didn't ask for.</p>
<h2>Need a different conversion?</h2>
<p>Just weighing, not substituting? <a href="/cups-to-grams/cake-flour/">1 cup of cake flour is 120 g</a> and <a href="/cups-to-grams/all-purpose-flour/">1 cup of all-purpose flour is 120 g</a> (<a href="/cups-to-grams/cornstarch/">cornstarch: 112 g</a>) — the <a href="/flour-conversion-chart/">flour conversion chart</a> covers every flour on the site. Using the cornstarch to thicken a sauce instead? The <a href="/cornstarch-to-flour/">cornstarch to flour thickener conversion</a> is the mirror-image page: there, cornstarch replaces flour at half the amount. Swapping other ingredients? The <a href="/butter-to-oil/">butter to oil conversion</a> and the <a href="/sugar-to-honey/">sugar to honey conversion</a> work the same way: a fixed ratio plus honest adjustments — and if the self-rising-flour warning above caught you, the <a href="/baking-powder-substitute/">baking powder substitute</a> untangles powder vs soda (about 1½ tsp of powder per cup is what self-rising flour carries). Halving the recipe while you're at it? See the <a href="/recipe-halving-chart/">recipe halving chart</a>.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "cakeflour" } }) };
}

function cornstarchFlourPage() {
  const FL_GPC = 120, CS_GPC = 112; // g per US cup, site-verified (= KA chart)
  const rnd = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  const fmtNum = (x) => {
    const FR = [[0.25, "¼"], [0.5, "½"], [0.75, "¾"]];
    const whole = Math.floor(x + 1e-9), rest = x - whole;
    let frac = "";
    if (rest > 0.03) {
      for (const [v, s] of FR) if (Math.abs(rest - v) < 0.02) { frac = s; break; }
      if (!frac) return String(rnd(x, 2));
    }
    return whole ? whole + frac : (frac || "0");
  };
  const fmtTsp = (t) => {
    const parts = [];
    const cups = Math.floor(t / 48 + 1e-9);
    let rem = t - cups * 48, frac = "";
    const EXACT = [[36, "¾"], [32, "⅔"], [24, "½"], [16, "⅓"], [12, "¼"]];
    for (const [v, s] of EXACT) if (Math.abs(rem - v) < 1e-6) { frac = s; rem = 0; break; }
    if (!frac) for (const [v, s] of [[36, "¾"], [24, "½"], [12, "¼"]]) if (rem >= v - 1e-9) { frac = s; rem -= v; break; }
    if (cups || frac) parts.push((cups ? cups + (frac ? " " + frac : "") : frac) + " cup" + (cups > 1 || (cups === 1 && frac) ? "s" : ""));
    if (rem >= 3 && Math.abs(rem * 2 / 3 - Math.round(rem * 2 / 3)) < 1e-9) {
      parts.push(fmtNum(rem / 3) + " tbsp"); rem = 0;
    } else {
      const tbsp = Math.floor(rem / 3 + 1e-9); rem -= tbsp * 3;
      if (tbsp) parts.push(tbsp + " tbsp");
    }
    if (rem > 0.03) parts.push(fmtNum(rem) + " tsp");
    return parts.join(" + ");
  };
  const gFmt = (g) => (g < 10 ? rnd(g, 1) : Math.round(g)) + " g";
  // grams from an amount in teaspoons, per ingredient
  const flG = (t) => gFmt(t / 48 * FL_GPC), csG = (t) => gFmt(t / 48 * CS_GPC);
  const title = "Cornstarch to Flour Ratio — Thickener Conversion Chart & Calculator | ExactCup";
  const description = "Swap thickeners either way: 1 tbsp cornstarch = 2 tbsp flour — cornstarch has twice the thickening power (Argo's rule). Chart, calculator and per-cup dosing.";
  const canonical = "/cornstarch-to-flour/";
  // Recipe calls for flour → use half as much cornstarch (2:1 by volume; unanimous
  // across Argo, Bob's Red Mill, ATK, USU + Illinois Extension — sauces/gravies only).
  const chartRows = [
    ["1 tsp", 1], ["2 tsp", 2], ["1 tbsp", 3], ["2 tbsp", 6], ["3 tbsp", 9],
    ["¼ cup", 12], ["⅓ cup", 16], ["½ cup", 24], ["1 cup", 48],
  ].map(([lab, t]) => `<tr><td>${lab}</td><td class="num">${flG(t)}</td><td>${fmtTsp(t / 2)}</td><td class="num">${csG(t / 2)}</td></tr>`).join("\n");
  const revRows = [
    ["1 tsp", 1], ["1½ tsp", 1.5], ["2 tsp", 2], ["1 tbsp", 3], ["2 tbsp", 6], ["3 tbsp", 9], ["¼ cup", 12],
  ].map(([lab, t]) => `<tr><td>${lab}</td><td class="num">${csG(t)}</td><td>${fmtTsp(t * 2)}</td><td class="num">${flG(t * 2)}</td></tr>`).join("\n");
  const faq = [
    ["Can I use flour instead of cornstarch to thicken a sauce?", "Yes — use twice as much. Flour has about half the thickening power of cornstarch, so replace every tablespoon of cornstarch with 2 tablespoons of all-purpose flour. Argo, Bob's Red Mill, America's Test Kitchen and Utah State University Extension all publish this same 2:1 rule. Flour also needs more cooking than cornstarch to lose its raw taste, and the sauce will finish opaque rather than glossy."],
    ["How much cornstarch equals 1/4 cup of flour?", "2 tablespoons. That's Argo's own worked example of the rule: cornstarch has twice the thickening power of flour, so use half as much. Spoon by spoon, 1 tablespoon of flour is replaced by 1 1/2 teaspoons of cornstarch."],
    ["How much cornstarch does it take to thicken 1 cup of liquid?", "1 tablespoon of cornstarch per cup of liquid for a medium-bodied sauce or gravy — the University of Illinois Extension figure, and exactly the proportion in Argo's gravy recipe and Bob's Red Mill's white sauce. Doing it with flour instead, use 2 tablespoons per cup. Use about half that for a thin sauce and about one-and-a-half times for a thick one."],
    ["Is 1 tablespoon of flour really equal to 1 1/2 teaspoons of cornstarch?", "Yes — and it's the same rule, not a different one. 1 1/2 teaspoons is exactly half a tablespoon, so '1 tbsp flour = 1 1/2 tsp cornstarch' is the standard 2:1 ratio restated in teaspoons. Some sites present the two phrasings as if they were competing ratios; they are identical."],
    ["Do you have to boil a cornstarch-thickened sauce?", "Yes — briefly. Argo's instruction is to bring the mixture to a full boil, stirring constantly, and boil for 1 minute, at which point the starch granules have swelled to full capacity; Bob's Red Mill says the same. The popular warning to 'never boil cornstarch' garbles the real caveats, which are significant overcooking and rough stirring — not the one-minute boil itself."],
    ["Why did my cornstarch sauce thin out again?", "Argo documents three causes: significant overcooking (thickened mixtures can thin as they cool), excessive or rough stirring (it physically breaks the swollen starch cells), and acidic ingredients like lemon juice or vinegar (they reduce the starch's thickening ability or stop it thickening at all). Freezing does it too — ice ruptures the starch network."],
    ["Is the cornstarch-to-flour ratio the same by weight?", "Almost, but not exactly. A tablespoon of cornstarch weighs 7 g and a tablespoon of all-purpose flour 7.5 g (King Arthur's chart: 112 g vs 120 g per cup), so halving by volume means multiplying the weight by 7/15 — about 47%, not 50%. Replace 100 g of flour thickener with about 47 g of cornstarch; going the other way, 100 g of cornstarch becomes about 214 g of flour."],
    ["Which makes better gravy — cornstarch or flour?", "Flour is the traditional choice: a roux-based gravy is opaque and matte, tastes rounder, and America's Test Kitchen notes flour-thickened sauces hold up longer than cornstarch ones. Cornstarch is faster (no roux), gluten-free, and gives a glossy, translucent finish — the look of many Chinese-style sauces and fruit fillings. For a classic opaque gravy, flour; for speed, shine or gluten-free, cornstarch."],
    ["Can I freeze gravy thickened with flour or cornstarch?", "Both weep. America's Test Kitchen froze and thawed both kinds and found each one separates as the starch structure breaks down — the fix is to bring the thawed gravy to a full boil and whisk hard, which re-emulsifies it. Clemson Extension's cleaner answer: freeze the broth unthickened and make the gravy fresh, or thicken with waxy rice flour, which survives freezing."],
    ["Does the 2:1 ratio work for pie fillings?", "No — pie is the exception. King Arthur's pie-thickener guide sets the amounts per fruit, and the flour-to-cornstarch ratio swings from about 3.5:1 for apples to roughly 1:1 for peaches, because sugar, acidity and a long bake all change how each starch performs. Use the 2:1 rule for sauces, gravies and soups, and a fruit-specific chart for pie."],
    ["Is cornstarch gluten-free?", "Yes — Argo states its cornstarch is gluten-free (it's pure starch from corn, no wheat). That makes the swap in this calculator the standard way to make gravy gluten-free: use half as much cornstarch in place of the flour. Arrowroot, potato starch and tapioca starch are gluten-free alternatives too."],
    ["What about arrowroot, potato starch or tapioca instead?", "Per 1 tablespoon of cornstarch: arrowroot 1 to 1 1/2 tablespoons (Utah State Extension says equal amounts; America's Test Kitchen says 1 1/2× — a genuine disagreement; ATK also warns arrowroot turns slimy with dairy), potato starch 1 to 1 1/2 tablespoons (same split), tapioca starch an equal amount (ATK — and it survives slow cooking better than flour or cornstarch), granular quick tapioca 2 tablespoons (Utah State)."],
  ];
  const jsonLd = [
    appLd("Cornstarch to Flour Thickener Converter", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Cornstarch to Flour", canonical]]),
  ];
  const body = `
<h1>Cornstarch to Flour: the Thickener Conversion</h1>
<p class="lead">Out of cornstarch — or thickening gluten-free and out of flour? For sauces, gravies and soups the rule is simple: <strong>1 tbsp cornstarch = 2 tbsp all-purpose flour</strong>. Cornstarch has <strong>twice the thickening power</strong> of flour, so use half as much — Argo, Bob's Red Mill, America's Test Kitchen and Utah State Extension all publish the same 2:1 rule. Enter what the recipe calls for:</p>
<div class="calc">
  <div class="field" style="margin-bottom:10px"><label for="th-dir">Direction</label><select id="th-dir"><option value="f2c">Recipe calls for flour → I'll use cornstarch</option><option value="c2f">Recipe calls for cornstarch → I'll use flour</option></select></div>
  <div class="row">
    <div class="field"><label for="th-amt">Amount in the recipe</label><input id="th-amt" type="text" inputmode="decimal" value="2" placeholder="e.g. 1/4 or 1 1/2"></div>
    <div class="field"><label for="th-unit">Unit</label><select id="th-unit"><option value="tbsp">tablespoons</option><option value="tsp">teaspoons</option><option value="cups">cups</option><option value="grams">grams</option></select></div>
  </div>
  <div class="result"><div class="big" id="th-out">—</div><div class="sub" id="th-sub"></div><div class="sub" id="th-adj"></div></div>
</div>
<p class="note">Seen <em>"1 tbsp flour = 1½ tsp cornstarch"</em> and wondered if it's a different rule? It isn't — 1½ tsp is exactly half a tablespoon, so it's the same 2:1 ratio restated in teaspoons. Why does pure starch beat flour? Flour is only about <strong>75% starch</strong> (America's Test Kitchen); the rest is protein and other solids that dilute its thickening power.</p>
<h2>Flour to cornstarch conversion chart</h2>
<p>The recipe thickens with flour and you're reaching for cornstarch — use <strong>half as much</strong>:</p>
<table><thead><tr><th>Flour called for</th><th>Flour (g)</th><th>Cornstarch instead</th><th>Cornstarch (g)</th></tr></thead><tbody>
${chartRows}
</tbody></table>
<h2>Cornstarch to flour conversion chart</h2>
<p>The recipe thickens with cornstarch and you only have flour — use <strong>twice as much</strong>:</p>
<table><thead><tr><th>Cornstarch called for</th><th>Cornstarch (g)</th><th>Flour instead</th><th>Flour (g)</th></tr></thead><tbody>
${revRows}
</tbody></table>
<h2>How much thickener per cup of liquid?</h2>
<p>Starting from scratch rather than converting a recipe? The extension-service dosing for a <strong>medium-bodied</strong> sauce or gravy is <strong>1 tbsp cornstarch — or 2 tbsp flour — per 1 cup of liquid</strong> (University of Illinois Extension; Argo's gravy recipe and Bob's Red Mill's white sauce use exactly these proportions):</p>
<table><thead><tr><th>Consistency (per 1 cup liquid)</th><th>All-purpose flour</th><th>Cornstarch</th></tr></thead><tbody>
<tr><td>Thin (soup-like)</td><td>1 tbsp (${flG(3)})</td><td>1½ tsp (${csG(1.5)})</td></tr>
<tr><td>Medium (gravy, white sauce)</td><td>2 tbsp (${flG(6)})</td><td>1 tbsp (${csG(3)})</td></tr>
<tr><td>Thick (binding, croquettes)</td><td>3 tbsp (${flG(9)})</td><td>1½ tbsp (${csG(4.5)})</td></tr>
</tbody></table>
<p class="note">The medium row is the extension-verified figure; the thin and thick rows follow the classic white-sauce ladder (1 tbsp flour per cup for thin, 3 for thick — the Betty Crocker convention) with cornstarch at half throughout.</p>
<h2>By weight: it's 47%, not 50%</h2>
<p>The 2:1 rule is a <strong>volume</strong> rule. A tablespoon of cornstarch weighs <strong>7 g</strong> while a tablespoon of all-purpose flour weighs <strong>7.5 g</strong> (King Arthur's chart: <a href="/cups-to-grams/cornstarch/">112 g per cup of cornstarch</a> vs <a href="/cups-to-grams/all-purpose-flour/">120 g per cup of flour</a>) — so by weight, replace flour with <strong>about 47% as much cornstarch</strong>, not 50%: <strong>100 g flour → ≈47 g cornstarch</strong>, and in reverse <strong>100 g cornstarch → ≈214 g flour</strong>. The calculator above does this automatically when you pick grams.</p>
<h2>Technique: slurry vs roux</h2>
<p><strong>Cornstarch — cold slurry, end of cooking.</strong> Stir the cornstarch into a little <em>cold</em> liquid until completely smooth (hot liquid makes it clump), stir the slurry into the simmering pot, then — Argo's instruction — bring it to a <strong>full boil, stirring constantly, and boil 1 minute</strong> so the granules swell to full capacity. Then reduce the heat: prolonged hard cooking or rough whisking will thin it back out.</p>
<p><strong>Flour — roux, or slurry plus a longer simmer.</strong> The classic route is a roux: equal parts flour and fat (butter), cooked together before the liquid goes in — King Arthur's tested gravy cooks the roux about <strong>4 minutes</strong> (light golden, nutty-smelling) and then simmers the gravy ~15 minutes to thicken fully and lose any raw-flour taste. The shortcut is beurre manié — equal parts flour and <em>softened</em> butter kneaded to a paste, whisked into boiling liquid a spoonful at a time, 2–3 minutes' simmer each (America's Test Kitchen).</p>
<h2>Which thickener should you use?</h2>
<p><strong>Reach for cornstarch</strong> when you want speed (no roux), a <strong>glossy, translucent</strong> finish — stir-fry sauces, fruit sauces, pudding — or a gluten-free result. <strong>Reach for flour</strong> for classic <strong>opaque, matte</strong> gravies and cream sauces, anything that simmers a while, and sauces you'll reheat: America's Test Kitchen notes cornstarch-thickened sauces break down more quickly than flour-thickened ones.</p>
<p>Honest caveats, all documented: <strong>acid</strong> (lemon, lime, vinegar) weakens or defeats cornstarch (Argo); <strong>freezing</strong> makes <em>both</em> weep — ATK tested flour and cornstarch gravies and both separated when thawed (a full boil plus hard whisking rescues them; Clemson Extension's advice is to freeze the broth unthickened, or use waxy rice flour); and neither belongs in <strong>home canning</strong> — extension services say to thicken after opening, not before processing.</p>
<h2>The pie-filling exception</h2>
<p>Don't carry the 2:1 rule into fruit pie. King Arthur's pie-thickener guide doses per fruit, and the flour-to-cornstarch ratio there runs from about <strong>3.5:1 for apples</strong> down to <strong>1:1 for peaches</strong> — sugar, acidity and an hour in the oven change how each starch behaves. The 2:1 rule is for sauces, gravies and soups; for pie, follow a fruit-specific chart.</p>
<h2>Other thickeners, per 1 tbsp of cornstarch</h2>
<table><thead><tr><th>Thickener</th><th>Instead of 1 tbsp cornstarch</th><th>Notes</th></tr></thead><tbody>
<tr><td>All-purpose flour</td><td>2 tbsp</td><td>Unanimous: Argo, Bob's Red Mill, ATK, Utah State Extension</td></tr>
<tr><td><a href="/cups-to-grams/arrowroot-powder/">Arrowroot</a></td><td>1–1½ tbsp</td><td>Sources genuinely disagree: Utah State says equal; ATK says 1½×. ATK: avoid with dairy (turns slimy)</td></tr>
<tr><td>Potato starch</td><td>1–1½ tbsp</td><td>Same split (Utah State 1:1; ATK 1–1½×). Add late; pull off the heat once thick</td></tr>
<tr><td><a href="/cups-to-grams/tapioca-flour/">Tapioca starch / flour</a></td><td>1 tbsp</td><td>ATK: equal volume — and it holds up in a slow cooker, unlike flour or cornstarch</td></tr>
<tr><td>Quick (granular) tapioca</td><td>2 tbsp</td><td>Utah State. Not the same thing as tapioca starch — the granules need a 15–30 min rest</td></tr>
</tbody></table>
<h2>Need a different conversion?</h2>
<p>Just weighing, not swapping? <a href="/cups-to-grams/cornstarch/">1 cup of cornstarch is 112 g</a> and <a href="/cups-to-grams/all-purpose-flour/">1 cup of all-purpose flour is 120 g</a> — the <a href="/flour-conversion-chart/">flour &amp; starch chart</a> covers arrowroot, tapioca and every flour on the site. Fun mirror image: the <a href="/cake-flour-substitute/">cake flour substitute</a> runs the same two ingredients the other way — cornstarch stirred <em>into</em> flour to weaken it for tender cakes. More swaps: <a href="/butter-to-oil/">butter to oil</a>, <a href="/sugar-to-honey/">sugar to honey</a> and the <a href="/baking-powder-substitute/">baking powder substitute</a>. And <a href="/teaspoons-in-a-tablespoon/">teaspoons in a tablespoon</a> spells out the spoon math used here (1 tbsp = 3 tsp).</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "thickener" } }) };
}

// ---------- Baking Powder Substitute (/baking-powder-substitute/) ----------
// Both directions between the two leaveners. Powder -> soda: 1 tsp baking powder
// = 1/4 tsp baking soda + 1/2 tsp cream of tartar (KA, ATK, Arm & Hammer,
// McCormick; USU + Texas A&M extensions carry the older USDA 5/8-tsp-tartar
// version). Soda -> powder: 1 tsp soda = 3 tsp powder (unanimous across KA,
// Bob's Red Mill, Arm & Hammer, McCormick — no primary source says 4x).
function bakingPowderSubstitutePage() {
  // teaspoons -> cook-friendly mixed fraction in eighths, promoting to tbsp at
  // 3 tsp; leavener amounts never reach cups.
  const FR8 = ["⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"];
  const mix = (x) => {
    const e = Math.round(x * 8), whole = Math.floor(e / 8), rem = e % 8;
    const frac = rem ? FR8[rem - 1] : "";
    return whole ? whole + (frac ? " " + frac : "") : (frac || "0");
  };
  const t8 = (t) => {
    if (t >= 3) {
      const tbsp = Math.floor(t / 3 + 1e-9), rem = t - tbsp * 3;
      return tbsp + " tbsp" + (Math.round(rem * 8) ? " + " + mix(rem) + " tsp" : "");
    }
    return mix(t) + " tsp";
  };
  const title = "Baking Powder Substitute — Baking Soda Conversion Chart & Calculator | ExactCup";
  const description = "Out of baking powder? Per tsp use ¼ tsp baking soda + ½ tsp cream of tartar. Out of soda? Use 3× the powder (1 tsp = 1 tbsp). Chart, calculator and every acid option.";
  const canonical = "/baking-powder-substitute/";
  const pRows = [
    ["½ tsp", 0.5], ["1 tsp", 1], ["1½ tsp", 1.5], ["2 tsp", 2], ["1 tbsp (3 tsp)", 3], ["4 tsp", 4],
  ].map(([lab, p]) => `<tr><td>${lab}</td><td>${t8(p / 4)}</td><td>${t8(p / 2)}</td></tr>`).join("\n");
  const sRows = [
    ["¼ tsp", 0.25], ["½ tsp", 0.5], ["¾ tsp", 0.75], ["1 tsp", 1], ["1½ tsp", 1.5], ["2 tsp", 2],
  ].map(([lab, s]) => `<tr><td>${lab}</td><td>${t8(s * 3)}</td></tr>`).join("\n");
  const faq = [
    ["Can I use baking soda instead of baking powder?", "Yes, if you add an acid. For every teaspoon of baking powder the recipe calls for, use 1/4 teaspoon of baking soda plus 1/2 teaspoon of cream of tartar — the substitution King Arthur, America's Test Kitchen, Arm & Hammer and McCormick all publish. No cream of tartar? Pair the 1/4 teaspoon of soda with 1/2 cup of buttermilk or yogurt, or with lemon juice or vinegar. Plain baking soda alone won't work: without an acid it makes no gas, and unreacted soda tastes soapy."],
    ["Can I use baking powder instead of baking soda?", "Yes — use three times as much. Replace every teaspoon of baking soda with 3 teaspoons (1 tablespoon) of baking powder; King Arthur, Bob's Red Mill, Arm & Hammer and McCormick all publish the same 3x rule. King Arthur's caveat: that much baking powder can leave a slightly bitter note. Bob's Red Mill also suggests swapping the recipe's acidic liquid (buttermilk) for a non-acidic one (milk), since baking powder brings its own acid along."],
    ["How much baking soda equals 1 tablespoon of baking powder?", "3/4 teaspoon of baking soda plus 1 1/2 teaspoons of cream of tartar. The rule is 1/4 teaspoon of soda plus 1/2 teaspoon of cream of tartar per teaspoon of baking powder, and a tablespoon is 3 teaspoons — so multiply everything by three."],
    ["Is it 1/2 teaspoon of cream of tartar or 5/8?", "Both figures circulate, and both are legitimate. King Arthur, America's Test Kitchen, Arm & Hammer and McCormick all say 1/2 teaspoon of cream of tartar per 1/4 teaspoon of baking soda; Utah State and Texas A&M extension services carry the older USDA-lineage figure of 5/8 teaspoon, which is closer to the exact chemistry. The 1/2-teaspoon version is the rounded, kitchen-friendly one — either rises fine."],
    ["What if I don't have cream of tartar either?", "Use a liquid acid with the same 1/4 teaspoon of baking soda per teaspoon of powder replaced. The sources genuinely disagree on the amount: King Arthur says 1/2 teaspoon of lemon juice or white vinegar, Arm & Hammer and McCormick say 1 teaspoon, and Utah State Extension stirs 1/2 tablespoon into milk to make 1/2 cup. Or skip the measuring spoon: 1/2 cup of buttermilk, yogurt or sour cream plus the 1/4 teaspoon of soda (America's Test Kitchen) — count that half cup as part of the recipe's liquid, not an addition."],
    ["How do I make homemade baking powder?", "Mix 1 part baking soda with 2 parts cream of tartar — for one teaspoon's worth, 1/4 teaspoon of soda and 1/2 teaspoon of cream of tartar (Bob's Red Mill; King Arthur adds 1/4 teaspoon of cornstarch, which keeps a stored batch dry and free-flowing). One big caveat: homemade powder is single-acting — it fires as soon as it gets wet, with no second rise in the oven — so mix the batter and bake it right away, as America's Test Kitchen instructs."],
    ["Are baking soda and baking powder the same thing?", "No. Baking soda is pure sodium bicarbonate and only makes gas when it meets an acid in the batter — buttermilk, yogurt, lemon, brown sugar, molasses. Baking powder is a complete kit: baking soda plus one or two dry acids plus a starch buffer (Arm & Hammer). That's why they can't swap 1:1 — a teaspoon of baking powder contains only about a quarter teaspoon of actual soda."],
    ["Why do I need 3 times as much baking powder to replace baking soda?", "Because baking powder is mostly not baking soda — the dry acid and starch dilute it, so teaspoon for teaspoon it has only about a quarter of the leavening power (Arm & Hammer puts the equivalence at 1 teaspoon of powder = 1/4 teaspoon of soda). Watch a common garble: some sites say 'soda is 3-4x stronger' and turn that into a 4x substitution — every primary source that publishes a ratio (King Arthur, Bob's Red Mill, Arm & Hammer, McCormick) says 3x."],
    ["How much baking soda or baking powder per cup of flour?", "The working rules of thumb: about 1/4 teaspoon of baking soda per cup of flour (Arm & Hammer), or 1 to 1 1/4 teaspoons of baking powder per cup (food scientist Shirley Corriher's rule) — the same one-to-four relationship as the substitution ratio. Treat them as ceilings as much as minimums: extra soda doesn't buy extra rise, it buys a soapy taste and a dark, coarse crumb."],
    ["How much does a teaspoon of baking powder or baking soda weigh?", "The published figures honestly disagree. King Arthur's ingredient chart has baking powder at 4 g per teaspoon and baking soda at 6 g (listed as 1/2 tsp = 3 g); USDA data puts both at about 4.6 g per teaspoon; and Arm & Hammer's and Clabber Girl's own nutrition labels both work out to 4.8 g (1/8 tsp = 0.6 g). At leavener quantities the spread is well under a gram — measure with the spoon, not the scale."],
    ["How much baking soda does it take to neutralize 1 cup of buttermilk?", "About 1/2 teaspoon. The number falls straight out of the substitution rule: 1/4 teaspoon of soda balances 1/2 cup of buttermilk (America's Test Kitchen, Utah State Extension), so a full cup takes 1/2 teaspoon. That's why recipes with both buttermilk and baking powder often add a pinch of soda — it's there to neutralize the dairy, not to leaven."],
    ["How do I test whether my baking soda or baking powder is still good?", "Two different tests — don't mix them up. Baking soda: stir 1/2 teaspoon into a few tablespoons of vinegar; it should fizz hard immediately. Baking powder: stir 1/2 teaspoon into a few tablespoons of hot water — water, not vinegar, because powder brings its own acid; it should fizz visibly. Arm & Hammer gives unopened baking soda a three-year shelf life; once opened, the working consensus for either leavener is 6-12 months."],
  ];
  const jsonLd = [
    appLd("Baking Powder Substitute Calculator", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Baking Powder Substitute", canonical]]),
  ];
  const body = `
<h1>Baking Powder ↔ Baking Soda: the Substitution</h1>
<p class="lead">Out of baking powder — or out of baking soda? They are <strong>not</strong> interchangeable 1:1, but each can stand in for the other. Per teaspoon of baking powder: <strong>¼ tsp baking soda + ½ tsp cream of tartar</strong> (King Arthur, America's Test Kitchen, Arm &amp; Hammer and McCormick all publish this rule). Per teaspoon of baking soda: <strong>3 tsp (1 tbsp) of baking powder</strong>. Enter what the recipe calls for:</p>
<div class="calc">
  <div class="field" style="margin-bottom:10px"><label for="bp-dir">Direction</label><select id="bp-dir"><option value="p2s">Recipe calls for baking powder → I'll use baking soda + cream of tartar</option><option value="s2p">Recipe calls for baking soda → I'll use baking powder</option></select></div>
  <div class="row">
    <div class="field"><label for="bp-amt">Amount in the recipe</label><input id="bp-amt" type="text" inputmode="decimal" value="1" placeholder="e.g. 1/2 or 1 1/2"></div>
    <div class="field"><label for="bp-unit">Unit</label><select id="bp-unit"><option value="tsp">teaspoons</option><option value="tbsp">tablespoons</option></select></div>
  </div>
  <div class="result"><div class="big" id="bp-out">—</div><div class="sub" id="bp-sub"></div><div class="sub" id="bp-adj"></div></div>
</div>
<p class="note">Why the lopsided ratios? A teaspoon of baking powder contains only about <strong>¼ teaspoon of actual baking soda</strong> — the rest is dry acid and a starch buffer (Arm &amp; Hammer). So replacing soda takes 3× the volume of powder, while replacing powder takes just a quarter of the soda <em>plus</em> the acid the powder would have brought along. One honest dissent: Sally's Baking Addiction declines to publish any swap and says just don't; the ratios here are from the primary sources that do publish one, caveats attached.</p>
<h2>Baking powder → baking soda + cream of tartar</h2>
<p>The recipe calls for baking powder and the tin is empty. Per teaspoon of powder, use <strong>¼ tsp baking soda + ½ tsp cream of tartar</strong>:</p>
<table><thead><tr><th>Baking powder called for</th><th>Baking soda</th><th>Cream of tartar</th></tr></thead><tbody>
${pRows}
</tbody></table>
<p class="note">Two fine points. The mix is <strong>single-acting</strong> — it starts fizzing the moment it gets wet and has no oven-triggered second rise — so get the batter into the oven right away (America's Test Kitchen's instruction). And you may meet <strong>⅝ tsp of cream of tartar</strong> in older charts: that's the USDA-lineage figure Utah State and Texas A&amp;M extensions still carry, slightly closer to the exact chemistry; the ½ tsp everyone else prints is the rounded kitchen version. Both work.</p>
<h2>No cream of tartar? Every acid that works</h2>
<p>All of these pair with the same <strong>¼ tsp of baking soda</strong> to replace 1 tsp of baking powder:</p>
<table><thead><tr><th>Acid</th><th>Amount (per ¼ tsp soda)</th><th>Notes</th></tr></thead><tbody>
<tr><td>Cream of tartar</td><td>½ tsp</td><td>The standard: King Arthur, ATK, Arm &amp; Hammer, McCormick (older USDA figure: ⅝ tsp)</td></tr>
<tr><td>Lemon juice or white vinegar</td><td>½–1 tsp</td><td>Sources genuinely disagree: King Arthur ½ tsp; Arm &amp; Hammer &amp; McCormick 1 tsp; Utah State ½ tbsp stirred into milk to make ½ cup</td></tr>
<tr><td>Buttermilk, yogurt or sour cream</td><td>½ cup</td><td>ATK &amp; Utah State. Count it as part of the recipe's liquid, not an addition</td></tr>
<tr><td>Molasses</td><td>¼–½ cup</td><td>Utah State — acidic enough to fire the soda; reduce other sweetener to match</td></tr>
</tbody></table>
<h2>Baking soda → baking powder: use 3×</h2>
<p>The recipe calls for baking soda and you only have powder — use <strong>three times as much</strong>. The 3× rule is unanimous across King Arthur, Bob's Red Mill, Arm &amp; Hammer and McCormick (no primary source says 4×; that garble comes from misreading "soda is 3–4× stronger" as a dosing instruction):</p>
<table><thead><tr><th>Baking soda called for</th><th>Baking powder instead</th></tr></thead><tbody>
${sRows}
</tbody></table>
<p class="note">Caveats from the sources themselves: King Arthur warns a slightly bitter, off-putting taste can result from that much powder; Bob's Red Mill suggests swapping acidic liquids (buttermilk) for non-acidic ones (milk), since the powder brings its own acid. And a fun catch — McCormick's own chart prints <strong>2½ tsp</strong> in its ¾-tsp row, where 3× is 2¼ tsp; the rest of their table follows the rule. Charts get copied; arithmetic doesn't lie.</p>
<h2>Homemade baking powder</h2>
<p>Making powder rather than substituting per-teaspoon: mix <strong>1 part baking soda with 2 parts cream of tartar</strong> — Bob's Red Mill's ratio; King Arthur's per-teaspoon version adds ¼ tsp of cornstarch to every ¼ + ½ tsp, which absorbs moisture so a stored batch doesn't fire in the jar. It behaves like the substitution above: <strong>single-acting</strong>, so bake promptly — commercial double-acting powder rises once at mixing and again in the oven's heat, and the homemade blend only does the first.</p>
<h2>What's actually in the tin</h2>
<p><strong>Baking soda</strong> is pure sodium bicarbonate. <strong>Baking powder</strong> is soda plus one or two dry acids plus a starch — and here's a detail most charts miss: America's best-selling powder (Clabber Girl) lists <em>cornstarch, sodium bicarbonate, sodium aluminum sulfate and monocalcium phosphate</em> — no cream of tartar at all. The tartar version is the homemade and premium recipe; "aluminum-free" brands such as Rumford and Bob's Red Mill lean on monocalcium phosphate instead. <strong>Double-acting</strong> (nearly all US retail powder) means two rises: the first when the powder dissolves into the batter, the second when the batter heats in the oven — which is why store-bought batters can wait and homemade-powder batters can't.</p>
<h2>How much per cup of flour?</h2>
<p>Building or rescuing a recipe rather than converting one: the rules of thumb are <strong>¼ tsp of baking soda per cup of flour</strong> (Arm &amp; Hammer) or <strong>1 to 1¼ tsp of baking powder per cup of flour</strong> (food scientist Shirley Corriher's rule) — the same 1:4 relationship as the substitution ratio, which is a nice sanity check. More leavener than that doesn't mean more lift: excess soda survives the bake unreacted and tastes soapy.</p>
<h2>By weight: the sources disagree</h2>
<p>Weighing leaveners is honestly messy, so we show the spread rather than pretending there isn't one: King Arthur's chart weighs a teaspoon of baking powder at <strong>4 g</strong> and baking soda at <strong>6 g</strong>; USDA data puts both at about <strong>4.6 g</strong>; and the Arm &amp; Hammer and Clabber Girl nutrition labels both work out to <strong>4.8 g</strong> per teaspoon (⅛ tsp = 0.6 g). The differences come down to how hard the spoon is packed — and at these quantities they're under a gram, so this is the one place on this site we'll tell you to <strong>skip the scale and use the spoon</strong>.</p>
<h2>Is it still good?</h2>
<p>Leaveners fade rather than spoil, and each has its own test. <strong>Baking soda:</strong> stir ½ tsp into a few tablespoons of <em>vinegar</em> — it should fizz hard instantly. <strong>Baking powder:</strong> stir ½ tsp into a few tablespoons of <em>hot water</em> — water, not vinegar, because the powder carries its own acid and vinegar would make even dead powder fizz. Arm &amp; Hammer's stated shelf life for soda is three years unopened; once open, the working consensus for either is 6–12 months. If a test barely bubbles, the substitution charts above won't save the bake — fresh leavener will.</p>
<h2>Need a different conversion?</h2>
<p>Swapping the sweetener too? The <a href="/sugar-to-honey/">sugar to honey conversion</a> leans on this exact chemistry — it adds ½ tsp of baking soda per cup of honey to neutralize the honey's acidity. The <a href="/cake-flour-substitute/">cake flour substitute</a> is the reason self-rising flour isn't one (it's flour with about 1½ tsp of baking powder per cup already inside), and the <a href="/butter-to-oil/">butter to oil</a> and <a href="/cornstarch-to-flour/">cornstarch to flour</a> pages run the same fixed-ratio-plus-caveats format. Swapping the <em>other</em> leavener? The <a href="/yeast-converter/">yeast converter</a> moves between active dry, instant and fresh. And <a href="/teaspoons-in-a-tablespoon/">teaspoons in a tablespoon</a> spells out the spoon math used here (1 tbsp = 3 tsp).</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "leavener" } }) };
}

// ---------- Dry to Cooked (/dry-to-cooked/) ----------
// Grain/pasta yield converter. Weight factors derived from USDA FoodData Central
// (SR Legacy) two independent ways — kcal ratio and dry-solids ratio — which agree
// within ±0.02 for every food (verified 2026-08-04). Dry g/cup values reuse the
// site's own verified densities where the ingredient exists (rice 185, quinoa 170,
// oats 90, couscous 175, bulgur 140, pearl barley 213) so this page can never
// disagree with the ingredient pages. Cooked g/cup = USDA portion weights.
// Couscous is the one method-dependent food: USDA's cooked entry (157 g/cup,
// 72.6% water) is a wetter prep than any 1:1¼ package method produces, so its
// factor (2.7) and cooked density (188) are mass-balanced from the package
// method (175 g + 296 g water fully absorbed → ~2½ cups) and disclosed as such.
function dryToCookedPage() {
  // slug, name, dry g/cup (null = shape-dependent, weight only), cooked g/cup (USDA),
  // weight factor cooked÷dry (USDA-derived), published volume yield + source, widget note
  const FOODS = [
    ["white-rice", "White rice (long-grain)", 185, 158, 2.8, "3–3½ cups (USA Rice / Mahatma)", "Volume roughly triples; weight is ×2.8 (USDA) — not the ×3 often quoted."],
    ["brown-rice", "Brown rice (long-grain)", 185, 202, 2.98, "2¾–3 cups (USDA / Whole Grains Council)", "Absorbs more water than white rice — heavier cooked cup (202 g), slightly less volume."],
    ["quinoa", "Quinoa", 170, 185, 3.06, "about 3 cups (Whole Grains Council)", "The “quinoa quadruples” claim is a myth — USDA and the Whole Grains Council both say ~3×."],
    ["pasta-long", "Pasta — long (spaghetti, linguine)", null, 124, 2.37, "2 oz dry → about 1 cup (Barilla)", "The classic 2 oz → 1 cup rule holds for long shapes."],
    ["pasta-short", "Pasta — short (penne, rotini, elbows)", null, 107, 2.37, "2 oz dry → about 1¼ cups (Barilla / USDA)", "Short shapes trap air — 2 oz cooks up to ~1¼ cups, not 1."],
    ["rolled-oats", "Rolled oats → oatmeal", 90, 234, 5.35, "about 2 cups (Quaker method)", "Oatmeal is ×5.4 by weight — the biggest jump of any grain (it's mostly absorbed water)."],
    ["couscous", "Couscous (instant)", 175, 188, 2.7, "2–2½ cups (package method)", "Package method (1 : 1¼ water). USDA's wetter test kitchen prep yields more — see FAQ."],
    ["pearl-barley", "Pearl barley", 213, 157, 2.87, "3½–4 cups (Bob's Red Mill)", "Pearled, not hulled — hulled barley cooks up less."],
    ["bulgur", "Bulgur", 140, 182, 4.1, "about 3 cups (Whole Grains Council)", "×4.1 by weight — bulgur soaks up more water than any grain here except oats."],
    ["wild-rice", "Wild rice", 160, 164, 3.53, "3–4 cups (MN Wild Rice Council)", "Yield varies with how far the kernels are allowed to bloom open."],
  ];
  const OZG = 28.349523125;
  const rnd1 = (x) => Math.round(x * 10) / 10;
  const gR = (g) => (g >= 100 ? Math.round(g / 5) * 5 : Math.round(g));
  // cook-friendly cups: snap to the nearest quarter or third when close, else 1 decimal
  const fmtC = (x) => {
    const SNAP = [[1 / 3, "⅓"], [2 / 3, "⅔"], [0.25, "¼"], [0.5, "½"], [0.75, "¾"]];
    const whole = Math.floor(x + 1e-9), rest = x - whole;
    let frac = "";
    if (rest > 0.04) {
      for (const [v, s] of SNAP) if (Math.abs(rest - v) < 0.06) { frac = s; break; }
      if (!frac) return rnd1(x) + " cups";
    }
    const n = whole ? whole + frac : (frac || "0");
    const plural = whole > 1 || (whole === 1 && frac) || (!whole && !frac);
    return n + (plural ? " cups" : " cup");
  };
  const F = Object.fromEntries(FOODS.map((f) => [f[0], { name: f[1], dry: f[2], cooked: f[3], w: f[4] }]));
  // computed helpers, all from the constants above — nothing hand-typed
  const cupDryToCooked = (slug) => { const f = F[slug]; const g = f.dry * f.w; return { g, cups: g / f.cooked }; };
  const g100 = (slug) => { const f = F[slug]; const g = 100 * f.w; return { g, cups: g / f.cooked }; };
  const title = "Dry to Cooked Rice, Pasta & Grain Converter — Yields in Cups & Grams | ExactCup";
  const description = "How much cooked rice does 1 cup of dry make? About 3 cups (≈520 g). Dry ↔ cooked calculator for rice, pasta, quinoa, oats & more — USDA-derived yields, both directions.";
  const canonical = "/dry-to-cooked/";
  const grainRows = FOODS.filter((f) => f[2]).map(([slug, name, dry, , , pub]) => {
    const y = cupDryToCooked(slug);
    return `<tr><td>${esc(name)}</td><td class="num">${dry} g</td><td class="num">≈ ${gR(y.g)} g</td><td>≈ ${fmtC(y.cups)}</td><td>${esc(pub)}</td></tr>`;
  }).join("\n");
  const g100Rows = FOODS.map(([slug, name]) => {
    const y = g100(slug);
    return `<tr><td>${esc(name)}</td><td class="num">≈ ${gR(y.g)} g</td><td>≈ ${fmtC(y.cups)}</td></tr>`;
  }).join("\n");
  // dry white rice needed for N cups cooked
  const revRows = [1, 2, 3, 4, 6].map((c) => {
    const f = F["white-rice"];
    const cookedG = c * f.cooked, dryG = cookedG / f.w;
    return `<tr><td>${c} cup${c > 1 ? "s" : ""} cooked</td><td class="num">${gR(cookedG)} g</td><td class="num">≈ ${gR(dryG)} g</td><td>≈ ${fmtC(dryG / f.dry)}</td></tr>`;
  }).join("\n");
  // pasta: 2 oz dry through both shape classes
  const pastaCooked = 2 * OZG * F["pasta-long"].w;
  const faq = [
    ["How much cooked rice does 1 cup of dry rice make?", "About 3 cups of cooked rice, weighing roughly 520 g. The sources honestly disagree on the exact figure: the USA Rice Federation's culinary guide says 1 cup dry makes 3 cups cooked, while Mahatma's package (2 cups water to 1 cup rice) says 3 1/2 cups. USDA densities land between them: 185 g of dry long-grain rice becomes about 520 g cooked, which fills about 3 1/4 cups at 158 g per cooked cup."],
    ["How many cups of cooked grains is 100 g of dry grains?", "Depends on the grain, because each absorbs a different amount of water. 100 g of dry white rice cooks up to about 280 g — roughly 1 3/4 cups. Quinoa: about 305 g, 1 2/3 cups. Brown rice: about 300 g, 1 1/2 cups. Dry pasta: about 235 g, close to 2 cups of long shapes. Rolled oats are the outlier: 100 g of oats makes about 535 g of oatmeal, around 2 1/4 cups. The full table above covers all ten foods."],
    ["Does rice really triple when it cooks?", "By volume, roughly yes — 1 cup dry makes about 3 to 3 1/2 cups cooked. By weight, no: USDA composition data puts cooked long-grain white rice at about 2.8 times its dry weight, and the USA Rice Federation itself only claims rice 'more than doubles' in weight. The widely repeated 'rice triples in weight' line garbles the volume figure into a weight claim — worth knowing if you portion by the scale."],
    ["How much dry rice do I need for 2 cups of cooked rice?", "About 115 g of dry rice — a scant 2/3 cup. Two cups of cooked white rice weigh about 316 g, and dividing by the 2.8 cooked-to-dry weight factor gives 113 g dry. For 4 cups cooked, start from about 225 g (1 1/4 cups) dry. The calculator above runs this direction for every grain — choose 'I want cooked, how much dry?'."],
    ["Is 2 oz of dry pasta really 1 cup cooked?", "Only for long shapes. Barilla's own serving guidance says 2 oz of spaghetti or linguine cooks to about 1 cup — and USDA weights agree (57 g dry × 2.37 = 135 g, almost exactly one 124 g cup of cooked spaghetti). But short shapes trap air between pieces: the same 2 oz of penne, rotini or elbows fills about 1 1/4 cups (USDA weighs a cup of cooked penne at just 107 g). The one-cup rule undercounts short pasta by about 25%."],
    ["Why can't I measure dry pasta in cups?", "Because the shape changes the weight more than the portion does. USDA weighs 1 cup of dry elbows at 122 g but 1 cup of dry shells at only 64 g — nearly a 2:1 spread for the 'same' cup. That's why this converter takes dry pasta in grams or ounces only. Cooked pasta is more consistent, so cups work fine on that side."],
    ["How much quinoa equals 250 g of cooked white rice?", "For the same volume on the plate, cook about 95 g (a generous 1/2 cup) of dry quinoa. The math: 250 g of cooked rice fills about 1.6 cups; the same volume of cooked quinoa weighs about 293 g (quinoa's cooked cup is heavier, 185 g vs 158 g), and dividing by quinoa's 3.06 weight factor gives roughly 95 g dry. If you just want the same 250 g weight of cooked quinoa instead, cook about 80 g dry."],
    ["Why does oatmeal weigh five times more than the dry oats?", "Because a bowl of oatmeal is mostly absorbed water. USDA weighs dry rolled oats at 81–90 g per cup but cooked oatmeal at 234 g per cup, and the standard Quaker method (1/2 cup oats + 1 cup water) turns 45 g of oats into roughly a 240 g bowl — a weight factor of about 5.4, the biggest of any food on this page. Volume is far tamer: 1 cup of dry oats makes about 2 cups of oatmeal."],
    ["How much does 1 cup of dry couscous make?", "About 2 to 2 1/2 cups, using the standard package method (1 cup couscous + 1 1/4 cups water, cover, 5 minutes off the heat). Honest footnote: USDA's own yield line says 1 dry cup makes 528 g — nearer 3 cups — but its cooked entry is 72.6% water, a wetter preparation than the package method can physically produce (175 g of couscous plus 296 g of water is 471 g even if every drop is absorbed). We publish the number your kitchen will actually reproduce."],
    ["Does brown rice make more or less than white rice?", "Slightly less volume from the same dry cup, surprisingly. Brown rice absorbs more water by weight (×2.98 vs ×2.8), but its cooked cup is much heavier — 202 g vs 158 g (USDA) — so 1 cup dry yields about 2 3/4 cups cooked against white rice's 3 to 3 1/2. The Whole Grains Council rounds both to 3 cups, which is fair as a kitchen answer."],
    ["Should I measure rice cooked or uncooked for a recipe?", "Measure dry unless the recipe clearly says otherwise — most recipes, package directions and nutrition labels are written for dry weight. If you're tracking portions, weighing dry is also far more repeatable: cooked weight swings with the water ratio, the pot and how long it sits, which is exactly why published yield figures disagree. Our portion calculator works in dry weight for the same reason (about 75 g of dry rice per person as a main)."],
    ["How much dry rice or pasta per person?", "The standard planning figures are about 75 g of dry rice per person for a main dish (roughly 200–210 g cooked) and 85–100 g of dry pasta (2 oz is the official US serving; 100 g is the generous real-world one). Halve them for sides. The portion calculator covers rice, pasta, couscous, quinoa and more, per number of people."],
  ];
  const jsonLd = [
    appLd("Dry to Cooked Grain & Pasta Yield Converter", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Dry to Cooked", canonical]]),
  ];
  const foodOpts = FOODS.map(([slug, name]) => `<option value="${slug}">${esc(name)}</option>`).join("");
  const cfg = { type: "yield", foods: FOODS.map(([slug, name, dry, cooked, w, , note]) => ({ slug, name, dryGpc: dry, cookedGpc: cooked, w, note })) };
  const body = `
<h1>Dry to Cooked: Rice, Pasta &amp; Grain Yield Converter</h1>
<p class="lead">Recipes measure grains dry, plates hold them cooked — this converts between the two, in both directions. The quick answers: <strong>1 cup of dry rice makes about 3 cups cooked</strong> (≈520 g), <strong>2 oz of dry spaghetti makes about 1 cup</strong>, and by <em>weight</em> cooked rice is about <strong>2.8× its dry weight</strong> (USDA) — not the 3× that gets repeated around the internet. Pick a food:</p>
<div class="calc">
  <div class="field" style="margin-bottom:10px"><label for="yl-food">Food</label><select id="yl-food">${foodOpts}</select></div>
  <div class="field" style="margin-bottom:10px"><label for="yl-dir">Direction</label><select id="yl-dir"><option value="d2c">I have dry — how much cooked?</option><option value="c2d">I want cooked — how much dry?</option></select></div>
  <div class="row">
    <div class="field"><label for="yl-amt">Amount</label><input id="yl-amt" type="text" inputmode="decimal" value="1" placeholder="e.g. 1/2 or 1 1/2"></div>
    <div class="field" style="max-width:160px"><label for="yl-unit">Unit</label><select id="yl-unit"><option value="cups">cups</option><option value="grams">grams</option><option value="oz">ounces</option></select></div>
  </div>
  <div class="result"><div class="big" id="yl-out">—</div><div class="sub" id="yl-sub"></div><div class="sub" id="yl-note"></div></div>
</div>
<p class="note">Yields are honest approximations — the water ratio, the pot and resting time all move the result, which is why even primary sources disagree (see the last column below). Weight factors are derived from USDA FoodData Central composition data; dry cup weights match our <a href="/grain-conversion-chart/">verified grain chart</a>.</p>
<h2>What 1 cup of dry grain makes</h2>
<table><thead><tr><th>Grain (1 cup dry)</th><th>Dry weight</th><th>Cooked weight</th><th>Cooked volume</th><th>Published yield</th></tr></thead><tbody>
${grainRows}
</tbody></table>
<p class="note">Where our computed volume and the published figure differ slightly (brown rice, quinoa), the published one assumes a slightly wetter or fluffier result — both are inside normal kitchen variation.</p>
<h2>100 g dry → cooked</h2>
<p>The scale-user's version — what 100 g of dry grain turns into, by weight and volume:</p>
<table><thead><tr><th>Food (100 g dry)</th><th>Cooked weight</th><th>Cooked volume</th></tr></thead><tbody>
${g100Rows}
</tbody></table>
<h2>Pasta: the 2 oz rule, corrected</h2>
<p>The standard US serving of dry pasta is <strong>2 oz (57 g)</strong>, and the famous rule says that's 1 cup cooked. USDA weights show it's really two rules: 57 g of any shape cooks to about <strong>${gR(pastaCooked)} g</strong>, but that fills <strong>≈ ${fmtC(pastaCooked / F["pasta-long"].cooked)} of long pasta</strong> (spaghetti, 124 g/cup) and <strong>≈ ${fmtC(pastaCooked / F["pasta-short"].cooked)} of short shapes</strong> (penne and rotini pack just 107 g into a cup). And skip measuring <em>dry</em> pasta by the cup entirely — USDA weighs a dry cup of elbows at 122 g but a dry cup of shells at 64 g. Grams or ounces only.</p>
<h2>How much dry rice for the cooked amount you want</h2>
<p>Cooking backwards from a recipe that wants cooked rice (fried rice, rice salad, stuffing):</p>
<table><thead><tr><th>Cooked white rice wanted</th><th>Cooked weight</th><th>Dry rice needed</th><th>Dry volume</th></tr></thead><tbody>
${revRows}
</tbody></table>
<h2>Volume triples. Weight doesn't.</h2>
<p>The most-repeated wrong number in this corner of the kitchen is <em>"rice triples in weight when cooked."</em> It doesn't: USDA composition data (checked two independent ways — calorie ratio and dry-solids ratio) puts cooked white rice at <strong>×2.8 its dry weight</strong>, and the USA Rice Federation itself only says rice <em>"more than doubles."</em> The <em>volume</em> roughly triples — that's the true half of the saying. The gap matters the moment you portion with a scale: 100 g of dry rice is ~280 g cooked, not 300. Each grain has its own factor — quinoa ×3.06, pasta ×2.37, bulgur ×4.1, and oatmeal an outlier <strong>×5.4</strong> — which is exactly what the calculator above applies.</p>
<h2>Need a different conversion?</h2>
<p>Feeding a crowd? The <a href="/portion-calculator/">portion calculator</a> gives dry grams per person for rice, pasta and more — pair it with this page to see the cooked pile. Weighing the dry grain first? The <a href="/grain-conversion-chart/">grain conversion chart</a> has cups-to-grams for every grain here, with <a href="/cups-to-grams/white-rice/">white rice</a>, <a href="/cups-to-grams/quinoa/">quinoa</a> and <a href="/cups-to-grams/rolled-oats/">rolled oats</a> each getting a full converter. Scaling the whole recipe up or down instead? Use the <a href="/recipe-scaler/">recipe scaler</a>.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg }) };
}

function airFryerPage() {
  const title = "Air Fryer Conversion Calculator — Oven to Air Fryer Time & Temp | ExactCup";
  const description = "Convert any oven recipe to an air fryer instantly. Lower the temperature by 25°F and reduce the time by about 20%. Free calculator with a conversion chart.";
  const canonical = "/air-fryer-conversion-calculator/";
  const faq = [
    ["How do you convert oven temperature to an air fryer?", "Lower the oven temperature by 25°F (about 15°C) and reduce the cooking time by roughly 20%. Always check for doneness early."],
    ["Do you preheat an air fryer?", "Most air fryers benefit from a 2-3 minute preheat, though many small models don't require it. Check your manual."],
    ["Can you put foil in an air fryer?", "Yes, but don't block the airflow — keep foil weighted down and away from the heating element, and never cover the whole basket."],
  ];
  const chart = [[350, 325, 20, 16], [375, 350, 25, 20], [400, 375, 30, 24], [425, 400, 35, 28], [450, 425, 40, 32]]
    .map(([of, af, ot, at]) => `<tr><td class="num">${of}°F / ${ot}min</td><td class="num">${af}°F</td><td class="num">${at} min</td></tr>`).join("");
  const jsonLd = [faqLd(faq), appLd("Air Fryer Conversion Calculator", description, canonical)];
  const body = `
<h1>Air Fryer Conversion Calculator</h1>
<p class="lead">Got an oven recipe? Enter its temperature and time to get the air-fryer settings. Rule of thumb: <strong>−25°F and about 20% less time</strong>.</p>
<div class="calc">
  <div class="row">
    <div class="field"><label for="oven-f">Oven temp (°F)</label><input id="oven-f" type="number" inputmode="decimal" value="400" step="any"></div>
    <div class="field"><label for="oven-time">Oven time (min)</label><input id="oven-time" type="number" inputmode="decimal" value="30" step="any"></div>
  </div>
  <div class="result"><div class="big"><span id="af-temp">—</span> · <span id="af-time">—</span></div><div class="sub">Air fryer temperature &amp; time</div></div>
</div>
<h2>Oven to air fryer chart</h2>
<table><thead><tr><th>Oven (temp / time)</th><th>Air fryer temp</th><th>Air fryer time</th></tr></thead><tbody>${chart}</tbody></table>
<p class="note">Air fryers run hotter and circulate air, so food cooks faster. Check 5 minutes before the calculated time the first time you make a recipe, then adjust.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "airfryer" } }) };
}

function panSizePage() {
  const PANS = [
    ["r6", '6" round', Math.PI * 9], ["r7", '7" round', Math.PI * 12.25], ["r8", '8" round', Math.PI * 16],
    ["r9", '9" round', Math.PI * 20.25], ["r10", '10" round', Math.PI * 25], ["s8", '8×8" square', 64],
    ["s9", '9×9" square', 81], ["r11x7", '11×7" rectangle', 77], ["r9x13", '9×13" rectangle', 117],
    ["jelly", '10×15" jelly roll', 150], ["loaf85", '8.5×4.5" loaf', 38.25], ["loaf9", '9×5" loaf', 45],
  ];
  const opts = (sel) => PANS.map(([id, name]) => `<option value="${id}"${id === sel ? " selected" : ""}>${esc(name)}</option>`).join("");
  const title = "Cake Pan Size Converter — Swap Pan Sizes & Adjust Recipes | ExactCup";
  const description = "Need a different pan? This converter shows how to scale your recipe when swapping cake pan sizes (e.g. 9×13 to 8×8), based on pan area. Free instant calculator.";
  const canonical = "/pan-size-converter/";
  const faq = [
    ["Can I use a 9×13 pan instead of two 9-inch round pans?", "Almost — a 9×13 pan holds about 117 sq in of batter and two 9-inch rounds hold about 127 sq in combined, so a two-layer 9-inch recipe fits a single 9×13 as a slightly thinner sheet cake. Keep the temperature the same and start checking a few minutes early."],
    ["How do I swap a round pan for a square pan?", "Compare their areas. An 8-inch square (64 sq in) holds about the same as a 9-inch round (64 sq in), so you can swap those two with no change to the recipe. An 8-inch round is smaller (50 sq in), so moving up to an 8-inch square gives you a thinner bake unless you scale the recipe up."],
    ["Do I change the bake time when I change pan size?", "Yes. A wider, shallower pan bakes faster; a smaller, deeper pan bakes slower. Leave the oven temperature alone and adjust the time — start checking 5–10 minutes before the original time and go by a clean skewer, not the clock."],
    ["How full should I fill a cake pan?", "About halfway to two-thirds full. Overfilling makes the batter dome or spill and undercook in the middle; underfilling gives a flat, dry cake. Matching the pan's area to the recipe (what this converter does) keeps the depth right."],
    ["Why scale by area instead of by diameter?", "Because batter fills area, not width. A 10-inch round isn't 25% bigger than an 8-inch round — it's about 56% bigger, because area grows with the square of the radius. Scaling by area is what keeps the batter depth, and therefore the bake time, consistent."],
  ];
  const rows = PANS.map(([id, name, area]) => `<tr><td>${esc(name)}</td><td class="num">${g2(area)} sq in</td></tr>`).join("");
  const body = `
<h1>Cake Pan Size Converter</h1>
<p class="lead">Only have a different pan? Pick what the recipe calls for and what you've got — I'll tell you how to scale the ingredients.</p>
<div class="calc">
  <div class="row">
    <div class="field"><label for="pan-from">Recipe calls for</label><select id="pan-from">${opts("r9x13")}</select></div>
    <div class="field"><label for="pan-to">You want to use</label><select id="pan-to">${opts("s8")}</select></div>
  </div>
  <div class="result"><div class="big" id="pan-out">—</div><div class="sub" id="pan-note">Ingredient multiplier</div></div>
</div>
<h2>Common pan sizes (by area)</h2>
<table><thead><tr><th>Pan</th><th>Area</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note">This scales by pan area (and so by batter volume). For big jumps, also adjust bake time and check doneness — depth changes how heat reaches the center.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: [appLd("Cake Pan Size Converter", description, canonical), faqLd(faq)], cfg: { type: "pansize", pans: PANS.map(([id, , area]) => ({ id, area })) } }) };
}

function volumePage() {
  const title = "Cups to Tablespoons to Teaspoons Converter (+ mL, fl oz) | ExactCup";
  const description = "Free volume converter for cooking: cups, tablespoons, teaspoons, fluid ounces, milliliters and liters. Type any field and the rest update instantly.";
  const canonical = "/volume-converter/";
  const faq = [
    ["How many tablespoons are in a cup?", "16 tablespoons in a US cup. So ½ cup is 8 tablespoons, ⅓ cup is 5 tablespoons plus 1 teaspoon, and ¼ cup is 4 tablespoons. This is handy when you can't find your measuring cups but have measuring spoons."],
    ["How many teaspoons are in a tablespoon?", "3 teaspoons in 1 tablespoon — the US, UK and metric systems all agree here, which makes a cup 48 teaspoons. The one exception is Australia, where a tablespoon is 20 mL (4 teaspoons) rather than 15 mL."],
    ["Is a dry measuring cup the same as a liquid one?", "The volume is identical — a US cup is 236.6 mL whether it holds flour or milk. Only the vessel differs: liquid cups have a spout and headroom for pouring, while dry cups are filled to the brim and leveled off. For dry ingredients, weighing is more accurate than either."],
    ["How many fluid ounces are in a cup?", "8 US fluid ounces in a US cup. Don't confuse fluid ounces (a volume) with ounces (a weight): a cup of flour is 8 fl oz by volume but only about 4.25 oz by weight, because flour is lighter than water."],
    ["Are US and metric cups the same?", "No. A US cup is 236.6 mL, while the metric cup used in the UK, Australia and New Zealand is 250 mL — about 5% larger. It rarely matters for soups but adds up in baking. See the dedicated cups to mL converter for the full breakdown."],
  ];
  const f = (lab, id, ph) => `<div class="field"><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" step="any" placeholder="${ph}"></div>`;
  const body = `
<h1>Volume Converter (Cups · Tbsp · Tsp · mL)</h1>
<p class="lead">Convert cooking volumes any direction. 1 cup = 16 tablespoons = 48 teaspoons = 8 fl oz ≈ 237 mL. Type any box.</p>
<div class="calc">
  <div class="row">${f("Cups", "cups", "1")}${f("Tablespoons", "tbsp", "16")}${f("Teaspoons", "tsp", "48")}</div>
  <div class="row" style="margin-top:10px">${f("Fluid ounces", "floz", "8")}${f("Milliliters", "ml", "237")}${f("Liters", "l", "0.237")}</div>
</div>
<p class="note">These are volume conversions (US customary). To convert a volume to grams, the ingredient matters — use the <a href="/cups-to-grams/">cups to grams converter</a>.</p>
<h2>Quick reference</h2>
<table><thead><tr><th>Cups</th><th>Tbsp</th><th>Tsp</th><th>mL</th></tr></thead><tbody>
<tr><td>1 cup</td><td class="num">16</td><td class="num">48</td><td class="num">237</td></tr>
<tr><td>¾ cup</td><td class="num">12</td><td class="num">36</td><td class="num">177</td></tr>
<tr><td>½ cup</td><td class="num">8</td><td class="num">24</td><td class="num">118</td></tr>
<tr><td>⅓ cup</td><td class="num">5⅓</td><td class="num">16</td><td class="num">79</td></tr>
<tr><td>¼ cup</td><td class="num">4</td><td class="num">12</td><td class="num">59</td></tr>
</tbody></table>
<p>Just need to know how many tablespoons or teaspoons are in a cup fraction? The <a href="/tablespoons-in-a-cup/">tablespoons in a cup</a> page spells out every fraction (including the awkward ⅓ and ⅔ cup). Going bigger — pints, quarts and gallons? See <a href="/cups-in-a-quart/">how many cups are in a quart</a> for the full US ladder. Converting cups to millilitres specifically — or cooking from a UK, Australian or Japanese recipe where a "cup" is a different size? See the dedicated <a href="/cups-to-ml/">cups to mL converter &amp; chart</a>.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: [appLd("Volume Converter", description, canonical), faqLd(faq)], cfg: { type: "volume" } }) };
}

// Targets the "how many ml in a cup" / "3/4 cup in ml" query class. Pure unit
// arithmetic from the exact US-customary definition (1 cup = 236.5882365 mL);
// the international cup sizes are fixed legal/standard definitions.
function cupsToMlPage() {
  const ML = 236.5882365; // 1 US customary cup, exact by definition (8 × 29.5735295625 mL)
  const title = "How Many mL in a Cup? Cups to mL Converter & Chart | ExactCup";
  const description = "1 US cup = 236.6 mL (recipes and labels round to 240 mL); 1/2 cup = 118 mL, 3/4 cup = 177 mL. A metric cup (UK, Australia) is 250 mL. Free converter + full chart.";
  const canonical = "/cups-to-ml/";
  const exact = (c) => Math.round(c * ML);
  const rnd = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  const rows = [
    ["⅛ cup", 1 / 8], ["¼ cup", 1 / 4], ["⅓ cup", 1 / 3], ["½ cup", 1 / 2],
    ["⅔ cup", 2 / 3], ["¾ cup", 3 / 4], ["1 cup", 1], ["1¼ cups", 1.25],
    ["1⅓ cups", 4 / 3], ["1½ cups", 1.5], ["1¾ cups", 1.75], ["2 cups", 2],
    ["3 cups", 3], ["4 cups", 4],
  ].map(([lab, c]) =>
    `<tr><td>${lab}</td><td class="num">${rnd(c * 8, 2)}</td><td class="num">${exact(c)} mL</td><td class="num">${Math.round(c * 240)} mL</td></tr>`
  ).join("\n");
  const revRows = [50, 100, 125, 150, 200, 250, 300, 375, 400, 500, 750, 1000].map((ml) =>
    `<tr><td>${ml} mL</td><td class="num">${rnd(ml / ML, 2)} cups</td><td class="num">${rnd(ml / 14.7868, 1)} tbsp</td></tr>`
  ).join("\n");
  const faq = [
    ["How many mL are in a cup?", `A US customary cup is exactly 236.588 mL — in practice, 237 mL, and US nutrition labels and most recipe writers round it to 240 mL. A metric cup, used in the UK, Australia, New Zealand and Canada, is 250 mL. This page (and US recipes generally) uses the US cup.`],
    ["Is a cup 240 mL or 250 mL?", `Both, depending on where the recipe was written. The US cup is 236.588 mL, rounded to 240 mL on nutrition labels; the metric cup used in the UK, Australia and New Zealand is 250 mL. The difference is only about 5%, which rarely matters for cooking — but for baking large quantities it can add up, so check the recipe's origin.`],
    ["How many mL is half a cup?", `Half a US cup is ${exact(0.5)} mL (recipes often round it to 120 mL). Half a 250 mL metric cup is 125 mL.`],
    ["How many mL is 3/4 cup?", `3/4 of a US cup is ${exact(0.75)} mL, commonly rounded to 180 mL. With a 250 mL metric cup it is 187.5 mL.`],
    ["How many mL is 2/3 cup?", `2/3 of a US cup is ${exact(2 / 3)} mL, commonly rounded to 160 mL.`],
    ["How many cups is 250 mL?", `250 mL is ${rnd(250 / ML, 2)} US cups — one US cup plus about 2½ teaspoons, so for most recipes you can treat 250 mL as 1 cup. In metric-cup countries (UK, Australia, New Zealand), 250 mL is exactly 1 cup.`],
    ["How many cups is 500 mL?", `500 mL is ${rnd(500 / ML, 2)} US cups — about 2 cups plus 2 tablespoons — or exactly 2 metric cups.`],
    ["Are UK and Australian cups the same as US cups?", `No. Modern UK and Australian recipes use the 250 mL metric cup, about 5% larger than the 236.6 mL US cup. Very old British cookbooks may use the imperial cup of 284 mL (10 imperial fluid ounces), and a Japanese cup is 200 mL — so it pays to know where a recipe comes from.`],
    ["Do millilitres of an ingredient equal grams?", `Only for water and thin water-like liquids (1 mL of water weighs 1 g, so 1 US cup of water is about 237 g). Denser liquids like honey weigh more per mL, and oils slightly less. To convert a cup of any ingredient to grams, use the cups to grams converter.`],
  ];
  const jsonLd = [
    appLd("Cups to mL Converter", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Cups to mL", canonical]]),
  ];
  const f = (lab, id, ph) => `<div class="field"><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" step="any" placeholder="${ph}"></div>`;
  const body = `
<h1>Cups to mL Converter</h1>
<p class="lead">1 US cup = 236.588 mL — call it 237 mL, or the 240 mL that recipes and nutrition labels round to. Type either box to convert any amount both ways.</p>
<div class="calc">
  <div class="row">${f("Cups", "cups", "1")}${f("Milliliters", "ml", "237")}${f("Fluid ounces", "floz", "8")}</div>
</div>
<p class="note">Uses the US customary cup. Converting a UK or Australian recipe? Multiply its cups by 250 mL instead — see the cup-size table below.</p>
<h2>Cups to mL conversion chart</h2>
<p>The "exact" column uses the US customary cup (236.588 mL); the "rounded" column uses the 240 mL convention you'll see on US nutrition labels — the version most recipe writers intend.</p>
<table><thead><tr><th>Cups</th><th>fl oz</th><th>mL (exact)</th><th>mL (rounded)</th></tr></thead><tbody>
${rows}
</tbody></table>
<h2>mL to cups</h2>
<p>Going the other way — a European recipe lists millilitres and you only have US cup measures:</p>
<table><thead><tr><th>Millilitres</th><th>US cups</th><th>Tablespoons</th></tr></thead><tbody>
${revRows}
</tbody></table>
<h2>Not every "cup" is the same size</h2>
<p>A "cup" is a different legal size depending on the country the recipe was written in:</p>
<table><thead><tr><th>Cup standard</th><th>Size</th><th>Used in</th></tr></thead><tbody>
<tr><td>US customary cup</td><td class="num">236.59 mL</td><td>US recipes (this page's converter)</td></tr>
<tr><td>US legal cup</td><td class="num">240 mL</td><td>US nutrition labels; common recipe rounding</td></tr>
<tr><td>Metric cup</td><td class="num">250 mL</td><td>UK (modern), Australia, New Zealand, Canada</td></tr>
<tr><td>Imperial cup</td><td class="num">284.13 mL</td><td>Old pre-metric British cookbooks (10 imp fl oz)</td></tr>
<tr><td>Japanese cup</td><td class="num">200 mL</td><td>Japan (rice-cooker cups are 180 mL)</td></tr>
</tbody></table>
<p class="note">The US-vs-metric gap is ~5% — fine for soups and sauces, worth correcting when you're baking or scaling a recipe up.</p>
<h2>Need a different conversion?</h2>
<p>The <a href="/volume-converter/">volume converter</a> also handles tablespoons, teaspoons and litres, and if your recipe uses fluid ounces, see <a href="/ounces-in-a-cup/">how many ounces are in a cup</a>. Converting to weight instead? Millilitres only equal grams for water — for flour, sugar, butter and 80+ other ingredients use the <a href="/cups-to-grams/">cups to grams converter</a> or the reverse <a href="/grams-to-cups/">grams to cups converter</a>. And if you're halving a recipe, the <a href="/recipe-halving-chart/">recipe halving chart</a> shows half of every cup measure in spoons you can actually use.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "volume" } }) };
}

// "How many tablespoons in a cup?" — owns the highest-volume US kitchen-measurement
// query class (tbsp/tsp in a cup, and every cup fraction). Pure US-unit arithmetic
// (1 cup = 16 tbsp = 48 tsp = 8 fl oz), so zero data-source risk — every value below is
// computed from those definitions, not typed by hand. Live widget reuses initVolume (no new JS).
function tbspInCupPage() {
  const title = "How Many Tablespoons in a Cup? (16) — Full Conversion Chart | ExactCup";
  const description = "There are 16 tablespoons in a US cup, and 3 teaspoons in a tablespoon. Free chart for every cup fraction: 1/4 cup = 4 tbsp, 1/3 cup = 5 tbsp + 1 tsp, 1/2 cup = 8 tbsp.";
  const canonical = "/tablespoons-in-a-cup/";
  const rnd = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  // Render a whole number of teaspoons the way a cook measures it: tbsp + leftover tsp.
  const tspToSpoons = (tsp) => {
    const tbsp = Math.floor(tsp / 3), rem = tsp - tbsp * 3;
    const parts = [];
    if (tbsp) parts.push(`${tbsp} tbsp`);
    if (rem) parts.push(`${rem} tsp`);
    return parts.join(" + ") || "0";
  };
  // Cup fractions → tbsp/tsp/fl oz. 48 tsp per cup, 8 fl oz per cup — exact integers for these.
  const fracs = [
    ["1/16 cup", 1 / 16], ["1/8 cup", 1 / 8], ["1/4 cup", 1 / 4], ["1/3 cup", 1 / 3],
    ["1/2 cup", 1 / 2], ["2/3 cup", 2 / 3], ["3/4 cup", 3 / 4], ["1 cup", 1],
  ];
  const fracRows = fracs.map(([lab, c]) => {
    const tsp = Math.round(c * 48);
    const tbspExact = c * 16;
    const tbspCell = Number.isInteger(tbspExact) ? `${tbspExact} tbsp` : tspToSpoons(tsp);
    return `<tr><td>${lab}</td><td class="num">${tbspCell}</td><td class="num">${tsp} tsp</td><td class="num">${rnd(c * 8, 2)} fl oz</td></tr>`;
  }).join("\n");
  // Larger US liquid-volume ladder.
  const ladder = [
    ["1 teaspoon (tsp)", "⅓ tbsp", "—", "4.93"],
    ["1 tablespoon (tbsp)", "3 tsp", "½ fl oz", "14.79"],
    ["1 fluid ounce (fl oz)", "2 tbsp", "1 fl oz", "29.57"],
    ["¼ cup", "4 tbsp", "2 fl oz", "59"],
    ["⅓ cup", "5 tbsp + 1 tsp", "2⅔ fl oz", "79"],
    ["½ cup", "8 tbsp", "4 fl oz", "118"],
    ["1 cup", "16 tbsp", "8 fl oz", "237"],
    ["1 pint", "2 cups", "16 fl oz", "473"],
    ["1 quart", "4 cups", "32 fl oz", "946"],
    ["1 gallon", "16 cups", "128 fl oz", "3785"],
  ].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="num">${r[2]}</td><td class="num">${r[3]} mL</td></tr>`).join("\n");
  const faq = [
    ["How many tablespoons are in a cup?", "There are 16 tablespoons in one US cup. So half a cup is 8 tablespoons, a quarter cup is 4 tablespoons, and three-quarters of a cup is 12 tablespoons. (This is the US customary cup; see the note below on Australian and metric tablespoons.)"],
    ["How many teaspoons are in a tablespoon?", "There are 3 teaspoons in 1 tablespoon. That also means 48 teaspoons in a cup (16 tablespoons × 3), and 6 teaspoons in a fluid ounce."],
    ["How many tablespoons are in 1/4 cup?", "A quarter cup is 4 tablespoons, or 12 teaspoons. If you're missing a 1/4-cup measure, just count out 4 level tablespoons."],
    ["How many tablespoons are in 1/3 cup?", "A third of a cup is 5 tablespoons plus 1 teaspoon (16 teaspoons total). It's the one cup fraction that doesn't divide into a whole number of tablespoons, which is why it trips people up — measure 5 tablespoons and then add a single teaspoon."],
    ["How many tablespoons are in 1/2 cup?", "Half a cup is 8 tablespoons, or 24 teaspoons — also 4 fluid ounces. A single stick of butter is exactly this: 8 tablespoons or 1/2 cup."],
    ["How many tablespoons are in 2/3 cup?", "Two-thirds of a cup is 10 tablespoons plus 2 teaspoons (32 teaspoons total) — another fraction that doesn't land on a whole tablespoon. Measure 10 tablespoons, then add 2 teaspoons."],
    ["How many tablespoons are in 3/4 cup?", "Three-quarters of a cup is 12 tablespoons, or 36 teaspoons — 6 fluid ounces."],
    ["How many teaspoons are in a cup?", "There are 48 teaspoons in a US cup (16 tablespoons × 3 teaspoons each)."],
    ["Is an Australian or metric tablespoon the same as a US tablespoon?", "No. A US tablespoon is 14.79 mL (3 US teaspoons), and the UK/European metric tablespoon is 15 mL — close enough to treat as the same. But the Australian tablespoon is 20 mL, equal to 4 teaspoons, so an Australian recipe's cup holds about 12.5 of its own tablespoons. If you're following an Australian recipe with US spoons, use 4 US teaspoons per listed tablespoon."],
    ["How many tablespoons are in a stick of butter?", "One US stick of butter is 8 tablespoons — that's 1/2 cup or 4 ounces (about 113 g). Two sticks make a full cup. For sticks, grams and ounces in every direction, see the butter converter."],
  ];
  const jsonLd = [
    appLd("Tablespoons in a Cup Converter", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Tablespoons in a Cup", canonical]]),
  ];
  const f = (lab, id, ph) => `<div class="field"><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" step="any" placeholder="${ph}"></div>`;
  const body = `
<h1>How Many Tablespoons in a Cup?</h1>
<p class="lead">There are <strong>16 tablespoons in 1 US cup</strong>, and <strong>3 teaspoons in 1 tablespoon</strong> (so 48 teaspoons in a cup). Lost a measuring cup? Type any amount below to convert between cups, tablespoons and teaspoons.</p>
<div class="calc">
  <div class="row">${f("Cups", "cups", "1")}${f("Tablespoons", "tbsp", "16")}${f("Teaspoons", "tsp", "48")}</div>
</div>
<p class="note">US customary measures. The metric tablespoon (15 mL) is close enough to swap; the Australian 20 mL tablespoon is not — see the FAQ.</p>
<h2>Tablespoons &amp; teaspoons in every cup fraction</h2>
<p>The two awkward ones are a third and two-thirds of a cup — they don't divide into whole tablespoons, so the chart spells out the extra teaspoons.</p>
<table><thead><tr><th>Cup amount</th><th>Tablespoons</th><th>Teaspoons</th><th>Fluid oz</th></tr></thead><tbody>
${fracRows}
</tbody></table>
<h2>Full US volume equivalents</h2>
<p>From a teaspoon all the way up to a gallon — how the common US kitchen measures nest inside each other:</p>
<table><thead><tr><th>Measure</th><th>Equals</th><th>Fluid oz</th><th>Millilitres</th></tr></thead><tbody>
${ladder}
</tbody></table>
<p class="note">1 US cup = 8 fl oz = 236.588 mL. mL values are rounded. A US "cup" differs from a metric or imperial cup — see the <a href="/cups-to-ml/">cups to mL converter</a> for those sizes.</p>
<h2>Quick reference</h2>
<ul>
<li><strong>1 cup</strong> = 16 tbsp = 48 tsp = 8 fl oz</li>
<li><strong>¾ cup</strong> = 12 tbsp = 36 tsp</li>
<li><strong>⅔ cup</strong> = 10 tbsp + 2 tsp</li>
<li><strong>½ cup</strong> = 8 tbsp = 24 tsp = 1 stick of butter</li>
<li><strong>⅓ cup</strong> = 5 tbsp + 1 tsp</li>
<li><strong>¼ cup</strong> = 4 tbsp = 12 tsp</li>
<li><strong>1 tbsp</strong> = 3 tsp = ½ fl oz</li>
</ul>
<h2>Need a different conversion?</h2>
<p>This page counts spoons; it doesn't weigh them. Zoomed in on just the spoons — half a tablespoon, dessertspoons, dashes and pinches? See <a href="/teaspoons-in-a-tablespoon/">how many teaspoons are in a tablespoon</a>. Because a tablespoon of flour and a tablespoon of honey weigh very different amounts, use the <a href="/tablespoons-to-grams/">tablespoons to grams converter</a> for weight, or the <a href="/cups-to-grams/">cups to grams converter</a> for a full cup. Working with metric volumes? The <a href="/volume-converter/">volume converter</a> adds millilitres, fluid ounces and litres, and the <a href="/cups-to-ml/">cups to mL page</a> covers US, metric and imperial cup sizes. Recipe in fluid ounces? See <a href="/ounces-in-a-cup/">how many ounces are in a cup</a> — including why dry ounces are a different thing. Halving a recipe? The <a href="/recipe-halving-chart/">recipe halving chart</a> shows half of every measure in spoons you can actually use.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "volume" } }) };
}

// "How many teaspoons in a tablespoon?" — the spoon-level companion to
// tablespoons-in-a-cup (which is cup-fraction-focused). Owns the tsp↔tbsp question class:
// half a tablespoon, the tsp-vs-Tbsp abbreviation trap, and spoon sizes worldwide.
// Pure unit arithmetic (1 US tbsp = 3 tsp; 1 US tsp = 4.92892159375 mL exactly), so zero
// data-source risk — every value is computed from those definitions, not typed by hand.
function tspInTbspPage() {
  const TSP_ML = 4.92892159375; // 1 US teaspoon in mL, exact by definition (1/6 US fl oz)
  const title = "How Many Teaspoons in a Tablespoon? (3) — Chart & Half Measures | ExactCup";
  const description = "There are 3 teaspoons in 1 US tablespoon — so 1/2 tbsp = 1 1/2 tsp and 2 tbsp = 6 tsp. Free chart with mL, half measures, and US vs UK vs Australian spoon sizes.";
  const canonical = "/teaspoons-in-a-tablespoon/";
  const rnd = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  // Tablespoons → teaspoons / fl oz / mL. 3 tsp and 1/2 fl oz per tbsp — exact.
  const tbspRows = [
    ["½ tbsp", 0.5, "1½ tsp"], ["1 tbsp", 1, "3 tsp"], ["1½ tbsp", 1.5, "4½ tsp"],
    ["2 tbsp (⅛ cup)", 2, "6 tsp"], ["3 tbsp", 3, "9 tsp"], ["4 tbsp (¼ cup)", 4, "12 tsp"],
    ["6 tbsp", 6, "18 tsp"], ["8 tbsp (½ cup)", 8, "24 tsp"], ["12 tbsp (¾ cup)", 12, "36 tsp"],
    ["16 tbsp (1 cup)", 16, "48 tsp"],
  ].map(([lab, t, tspLab]) =>
    `<tr><td>${lab}</td><td class="num">${tspLab}</td><td class="num">${rnd(t / 2, 2)} fl oz</td><td class="num">${rnd(t * 3 * TSP_ML, 1)} mL</td></tr>`
  ).join("\n");
  // Teaspoons → tablespoons, with thirds spelled out as fractions where they occur.
  const tspRows = [
    [1, "⅓ tbsp"], [2, "⅔ tbsp"], [3, "1 tbsp"], [4, "1 tbsp + 1 tsp"], [5, "1 tbsp + 2 tsp"],
    [6, "2 tbsp"], [8, "2 tbsp + 2 tsp"], [9, "3 tbsp"], [12, "4 tbsp (¼ cup)"],
    [24, "8 tbsp (½ cup)"], [48, "16 tbsp (1 cup)"],
  ].map(([tsp, lab]) =>
    `<tr><td>${tsp} tsp</td><td>${lab}</td><td class="num">${rnd(tsp * TSP_ML, 1)} mL</td></tr>`
  ).join("\n");
  // Halving down the spoon ladder — every half lands on a real measuring spoon.
  const halfRows = [
    ["1 tbsp (3 tsp)", "1½ tsp"], ["½ tbsp (1½ tsp)", "¾ tsp"], ["1 tsp", "½ tsp"],
    ["½ tsp", "¼ tsp"], ["¼ tsp", "⅛ tsp"], ["⅛ tsp", "1/16 tsp — the “pinch” on mini spoon sets"],
  ].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("\n");
  // Spoon sizes by standard. mL values: US customary computed from TSP_ML; the rest are
  // defined round numbers (metric/label 5 & 15 mL; Australian tbsp 20 mL; dessertspoon 10 mL).
  const sizeRows = [
    ["US customary (this page)", `${rnd(TSP_ML, 2)} mL`, `${rnd(TSP_ML * 3, 2)} mL (3 tsp)`],
    ["US nutrition labels (FDA)", "5 mL", "15 mL (3 tsp)"],
    ["Metric — UK, EU, Canada, NZ", "5 mL", "15 mL (3 tsp)"],
    ["Australia", "5 mL", "20 mL (4 tsp)"],
  ].map((r) => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td></tr>`).join("\n");
  const faq = [
    ["How many teaspoons are in a tablespoon?", "There are 3 teaspoons in 1 US tablespoon. The same is true of UK, European, Canadian and New Zealand metric spoons (5 mL and 15 mL). The one exception is Australia, where the tablespoon is 20 mL — 4 teaspoons."],
    ["How many teaspoons are in half a tablespoon?", "Half a tablespoon is 1 1/2 teaspoons. That's the measurement you need most often when halving a recipe — measure 1 teaspoon plus a 1/2 teaspoon."],
    ["How many teaspoons are in 2 tablespoons?", "2 tablespoons is 6 teaspoons, which is also 1 fluid ounce or 1/8 cup. In general, multiply tablespoons by 3 to get teaspoons."],
    ["Does tsp mean teaspoon or tablespoon?", "tsp (or a lowercase t) means teaspoon; tbsp, Tbsp or a capital T means tablespoon. Mixing them up triples the amount (or cuts it to a third) — the most common place it hurts is salt, baking soda and baking powder. If a handwritten recipe just says a capital T, read it as tablespoon."],
    ["How many milliliters are in a teaspoon and a tablespoon?", "A US teaspoon is 4.93 mL and a US tablespoon is 14.79 mL. In practice, recipes treat them as 5 mL and 15 mL — the exact values used by metric spoons and US nutrition labels — and the difference (about 1.4%) is far too small to matter in cooking."],
    ["Is an Australian tablespoon different?", "Yes. The Australian tablespoon is 20 mL, which is 4 teaspoons — one-third bigger than a US or metric tablespoon. Following an Australian recipe with US spoons? Use 4 teaspoons (or 1 tablespoon plus 1 teaspoon) for each listed tablespoon. Australian teaspoons are the usual 5 mL."],
    ["What is a dessertspoon?", "A dessertspoon is a UK, Australian and NZ measure of 10 mL — exactly 2 teaspoons, or two-thirds of a metric tablespoon. It sits between the teaspoon and tablespoon and shows up in older British recipes."],
    ["Can I use a regular eating spoon instead of a measuring spoon?", "Not for anything that matters. Flatware varies a lot — an eating teaspoon can hold anywhere from about half to one-and-a-half times a measuring teaspoon depending on the set. For salt, leaveners and spices, use actual measuring spoons, leveled off."],
    ["How much is a dash, a pinch and a smidgen?", "There's no official definition, but the mini measuring-spoon sets sold under those names have settled on: dash = 1/8 teaspoon, pinch = 1/16 teaspoon, smidgen = 1/32 teaspoon. In older recipes they simply meant \"a small amount, to taste.\""],
    ["How many teaspoons are in 1/4 cup?", "A quarter cup is 12 teaspoons, or 4 tablespoons. A full cup is 48 teaspoons (16 tablespoons). See the tablespoons-in-a-cup chart for every cup fraction."],
    ["How many teaspoons are in a fluid ounce?", "There are 6 teaspoons (2 tablespoons) in 1 US fluid ounce."],
    ["How many teaspoons are in a packet of yeast?", "A standard US packet of active dry or instant yeast holds 2 1/4 teaspoons (7 g — about 3/4 tablespoon). See the yeast converter to swap between yeast types."],
  ];
  const jsonLd = [
    appLd("Teaspoons in a Tablespoon Converter", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Teaspoons in a Tablespoon", canonical]]),
  ];
  const f = (lab, id, ph) => `<div class="field"><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" step="any" placeholder="${ph}"></div>`;
  const body = `
<h1>How Many Teaspoons in a Tablespoon?</h1>
<p class="lead">There are <strong>3 teaspoons in 1 US tablespoon</strong> — so half a tablespoon is <strong>1½ teaspoons</strong>, and 2 tablespoons make 6 teaspoons. Type any amount below to convert between tablespoons, teaspoons and millilitres.</p>
<div class="calc">
  <div class="row">${f("Tablespoons", "tbsp", "1")}${f("Teaspoons", "tsp", "3")}${f("Millilitres", "ml", "14.79")}</div>
</div>
<p class="note">US customary spoons (tsp ${rnd(TSP_ML, 2)} mL, tbsp ${rnd(TSP_ML * 3, 2)} mL). Metric 5/15 mL spoons are interchangeable with them; the Australian 20 mL tablespoon is not — see the spoon-sizes table below.</p>
<h2>Tablespoons to teaspoons chart</h2>
<table><thead><tr><th>Tablespoons</th><th>Teaspoons</th><th>Fluid oz</th><th>Millilitres</th></tr></thead><tbody>
${tbspRows}
</tbody></table>
<h2>Teaspoons to tablespoons</h2>
<p>Going the other way, divide by 3. When it doesn't divide evenly, measure the whole tablespoons and add the leftover teaspoons:</p>
<table><thead><tr><th>Teaspoons</th><th>Tablespoons</th><th>Millilitres</th></tr></thead><tbody>
${tspRows}
</tbody></table>
<h2>Halving spoon measurements</h2>
<p>Because a tablespoon is 3 teaspoons, every half lands on a spoon you actually own:</p>
<table><thead><tr><th>Half of…</th><th>…is</th></tr></thead><tbody>
${halfRows}
</tbody></table>
<p>Halving a whole recipe? The <a href="/recipe-halving-chart/">recipe halving chart</a> does this for every cup and spoon measure at once.</p>
<h2>tsp vs tbsp: don't triple the salt</h2>
<p>The abbreviations are the real trap: <strong>tsp</strong> (or lowercase <strong>t</strong>) is a teaspoon; <strong>tbsp</strong>, <strong>Tbsp</strong> or capital <strong>T</strong> is a tablespoon — three times as much. Misreading one for the other is how a bake ends up with triple the baking soda. When a recipe is ambiguous, the capital letter means the bigger spoon.</p>
<h2>Spoon sizes around the world</h2>
<table><thead><tr><th>Standard</th><th>Teaspoon</th><th>Tablespoon</th></tr></thead><tbody>
${sizeRows}
</tbody></table>
<p class="note">The US customary and 5/15 mL metric spoons differ by ~1.4% — swap them freely. The UK/AU <strong>dessertspoon</strong> is 10 mL = 2 tsp. Only the Australian 20 mL tablespoon needs converting: use 4 tsp per Australian tbsp.</p>
<h2>Quick reference</h2>
<ul>
<li><strong>1 tbsp</strong> = 3 tsp = ½ fl oz = ${rnd(TSP_ML * 3, 2)} mL</li>
<li><strong>½ tbsp</strong> = 1½ tsp</li>
<li><strong>1 tsp</strong> = ⅓ tbsp = ${rnd(TSP_ML, 2)} mL</li>
<li><strong>2 tbsp</strong> = 6 tsp = 1 fl oz = ⅛ cup</li>
<li><strong>4 tbsp</strong> = 12 tsp = ¼ cup</li>
<li><strong>16 tbsp</strong> = 48 tsp = 1 cup</li>
<li><strong>1 dessertspoon</strong> (UK/AU) = 2 tsp = 10 mL</li>
</ul>
<h2>Need a different conversion?</h2>
<p>Scaling up from spoons to cups? See <a href="/tablespoons-in-a-cup/">how many tablespoons are in a cup</a> (16 — with every cup fraction, including the awkward ⅓ and ⅔). This page measures volume, not weight — a tablespoon of flour and a tablespoon of honey weigh very different amounts, so for grams use the <a href="/tablespoons-to-grams/">tablespoons to grams converter</a>. The <a href="/volume-converter/">volume converter</a> adds cups, fluid ounces and litres, and the <a href="/cups-to-ml/">cups to mL page</a> covers international cup sizes. For butter, 1 stick = 8 tablespoons — the <a href="/butter-converter/">butter converter</a> handles sticks, grams and ounces.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "volume" } }) };
}

// "How many ounces in a cup?" — the other giant US kitchen-measurement question class.
// The fluid-ounce side is pure US-unit arithmetic (1 cup = 8 fl oz, 1 fl oz = 29.5735 mL);
// the dry-ounce side (weight of a cup) is computed from the verified gramsPerCup values in
// ingredients.json (1 oz = 28.3495 g), so nothing on this page is typed by hand.
function ouncesInCupPage() {
  const OZ_G = 28.3495; // 1 avoirdupois ounce, exact by definition (28.349523125 g)
  const ML = 236.5882365; // 1 US cup in mL, exact by definition
  const title = "How Many Ounces in a Cup? (8 fl oz) — Fluid vs Dry Oz | ExactCup";
  const description = "There are 8 fluid ounces in a US cup: 1/2 cup = 4 fl oz, 3/4 cup = 6 fl oz. Dry ounces are weight — a cup of flour weighs 4.2 oz, sugar 7.1 oz, butter 8 oz.";
  const canonical = "/ounces-in-a-cup/";
  const rnd = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  // Cup fractions → fl oz / tbsp / mL. 8 fl oz and 16 tbsp per cup.
  const fracRows = [
    ["1/8 cup", 1 / 8], ["1/4 cup", 1 / 4], ["1/3 cup", 1 / 3], ["1/2 cup", 1 / 2],
    ["2/3 cup", 2 / 3], ["3/4 cup", 3 / 4], ["1 cup", 1], ["1 1/2 cups", 1.5], ["2 cups", 2],
  ].map(([lab, c]) =>
    `<tr><td>${lab}</td><td class="num">${rnd(c * 8, 2)} fl oz</td><td class="num">${rnd(c * 16, 1)} tbsp</td><td class="num">${Math.round(c * ML)} mL</td></tr>`
  ).join("\n");
  // Common fl-oz amounts → cups; call out the named measures (pint/quart/gallon).
  const named = { 16: "1 pint", 32: "1 quart", 64: "1/2 gallon", 128: "1 gallon" };
  const revRows = [1, 2, 4, 6, 8, 12, 16, 24, 32, 64, 128].map((oz) => {
    const c = oz / 8;
    return `<tr><td>${oz} fl oz</td><td class="num">${rnd(c, 3)} ${c === 1 ? "cup" : "cups"}</td><td>${named[oz] || ""}</td></tr>`;
  }).join("\n");
  // Weight of 1 cup for common ingredients — straight from the verified dataset.
  const wSlugs = ["all-purpose-flour", "granulated-sugar", "brown-sugar", "powdered-sugar", "butter", "milk", "water", "vegetable-oil", "honey", "chocolate-chips", "rolled-oats", "cocoa-powder"];
  const weightRows = wSlugs.map((slug) => {
    const i = ingBySlug(slug);
    return `<tr><td><a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a></td><td class="num">${rnd(i.gramsPerCup / OZ_G, 1)} oz</td><td class="num">${g2(i.gramsPerCup)} g</td></tr>`;
  }).join("\n");
  const flourCups8oz = rnd(8 * OZ_G / ingBySlug("all-purpose-flour").gramsPerCup, 1);
  const faq = [
    ["How many ounces are in a cup?", "There are 8 US fluid ounces in 1 US cup. So half a cup is 4 fl oz, a quarter cup is 2 fl oz, and three-quarters of a cup is 6 fl oz. That's for liquids, measured by volume — for dry ingredients, \"ounces\" on a recipe or package usually means weight, and a cup of flour, sugar or oats each weighs a different number of ounces (see the dry-ounce chart on this page)."],
    ["How many cups is 8 oz?", "8 fluid ounces of any liquid is exactly 1 cup. But 8 ounces by weight depends on the ingredient: 8 oz of all-purpose flour is about " + flourCups8oz + " cups, while 8 oz of butter is exactly 1 cup (2 sticks). If a recipe says \"8 oz\" of a dry ingredient, it almost always means weight — use a scale, or an ingredient-specific converter."],
    ["What's the difference between fluid ounces and dry ounces?", "A fluid ounce measures volume (how much space something fills); an ounce measures weight. They only line up for water-like liquids: a fluid ounce of water weighs just about 1 ounce (1.043 oz to be exact). For anything else the two diverge — a cup of flour fills 8 fl oz of space but weighs only about 4.2 oz."],
    ["How many ounces are in half a cup?", "Half a US cup is 4 fluid ounces, which is also 8 tablespoons or about 118 mL. By weight, half a cup of butter is 4 oz (one stick), but half a cup of flour is only about 2.1 oz."],
    ["How many ounces are in 1/4 cup?", "A quarter cup is 2 fluid ounces, or 4 tablespoons (about 59 mL)."],
    ["How many ounces are in 1/3 cup?", "A third of a cup is about 2.67 fluid ounces — 5 tablespoons plus 1 teaspoon, or about 79 mL."],
    ["How many ounces are in 3/4 cup?", "Three-quarters of a cup is 6 fluid ounces, or 12 tablespoons (about 177 mL)."],
    ["How many cups is 16 oz?", "16 fluid ounces is 2 cups — that's 1 US pint. By weight, 16 oz is 1 pound, and how many cups that fills depends on the ingredient: a pound of flour is about 3.8 cups, a pound of granulated sugar about 2.3 cups, and a pound of butter exactly 2 cups (4 sticks)."],
    ["Does a cup of water weigh 8 ounces?", "Almost, but not exactly — a US cup of water weighs about 8.35 oz (236.6 g), because a fluid ounce of water weighs slightly more than a weight ounce. The neat \"a pint's a pound\" rhyme is off by about 4%. Butter is the ingredient where the numbers really do match: 1 cup = 8 oz = 2 sticks."],
    ["How many cups is an 8 oz block of cream cheese?", "One 8 oz (227 g) block of cream cheese is just about 1 cup — cream cheese weighs roughly 232 g per cup, so a standard block is 0.98 cups. Recipes that call for a cup of cream cheese mean one block."],
    ["Are UK fluid ounces the same as US fluid ounces?", "Close but not identical. An imperial (UK) fluid ounce is 28.41 mL versus 29.57 mL for the US fluid ounce — about 4% smaller. Old British recipes also use the 10-fl-oz imperial cup and the 20-fl-oz imperial pint, so a UK pint (568 mL) is bigger than a US pint (473 mL)."],
    ["How many ounces is a coffee cup?", "A \"cup\" on a coffee maker is usually only 5 or 6 fluid ounces, not the 8 fl oz measuring cup — and a typical coffee mug actually holds 8–12 fl oz. Coffee-maker cups are a marketing measure, so don't use them for recipes."],
  ];
  const jsonLd = [
    appLd("Ounces in a Cup Converter", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Ounces in a Cup", canonical]]),
  ];
  const f = (lab, id, ph) => `<div class="field"><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" step="any" placeholder="${ph}"></div>`;
  const body = `
<h1>How Many Ounces in a Cup?</h1>
<p class="lead">There are <strong>8 fluid ounces in 1 US cup</strong> — so ½ cup = 4 fl oz and ¼ cup = 2 fl oz. That answer is for liquids. For dry ingredients, "ounces" means <em>weight</em>, and every ingredient weighs something different per cup — both answers are below.</p>
<div class="calc">
  <div class="row">${f("Cups", "cups", "1")}${f("Fluid ounces", "floz", "8")}${f("Milliliters", "ml", "237")}</div>
</div>
<p class="note">US customary measures: 1 cup = 8 fl oz = 236.588 mL. The converter is for volume (fluid ounces) — for weight, see the dry-ounce chart below.</p>
<h2>Fluid ounces in every cup fraction</h2>
<table><thead><tr><th>Cup amount</th><th>Fluid oz</th><th>Tablespoons</th><th>Millilitres</th></tr></thead><tbody>
${fracRows}
</tbody></table>
<h2>Ounces to cups</h2>
<p>Going the other way — a drink or can size in fluid ounces, converted to cups:</p>
<table><thead><tr><th>Fluid ounces</th><th>Cups</th><th>Also known as</th></tr></thead><tbody>
${revRows}
</tbody></table>
<h2>Fluid ounces vs dry ounces — the trap</h2>
<p>A <strong>fluid ounce</strong> is a volume (space); an <strong>ounce</strong> is a weight. A cup of <em>anything</em> is 8 fl oz of volume, but what it <em>weighs</em> depends entirely on the ingredient. This is why "8 oz of flour" (weight — about ${flourCups8oz} cups) is very different from "8 fl oz of flour" (1 cup — only about 4.2 oz of weight). Here's what 1 cup actually weighs:</p>
<table><thead><tr><th>Ingredient (1 cup)</th><th>Weight (oz)</th><th>Grams</th></tr></thead><tbody>
${weightRows}
</tbody></table>
<p class="note">Weights from our <a href="/ingredient-density-data/">verified ingredient density dataset</a>. Butter is the tidy one: 1 cup = 8 oz by weight too (2 sticks of 4 oz each). Water is close at 8.35 oz. Everything else diverges.</p>
<h2>Quick reference</h2>
<ul>
<li><strong>1 cup</strong> = 8 fl oz = 16 tbsp = 237 mL</li>
<li><strong>¾ cup</strong> = 6 fl oz</li>
<li><strong>⅔ cup</strong> = 5⅓ fl oz</li>
<li><strong>½ cup</strong> = 4 fl oz</li>
<li><strong>⅓ cup</strong> = 2⅔ fl oz</li>
<li><strong>¼ cup</strong> = 2 fl oz</li>
<li><strong>1 pint</strong> = 16 fl oz = 2 cups · <strong>1 quart</strong> = 32 fl oz = 4 cups · <strong>1 gallon</strong> = 128 fl oz = 16 cups</li>
</ul>
<h2>Need a different conversion?</h2>
<p>Converting a dry ingredient by weight? Use the <a href="/cups-to-grams/">cups to grams converter</a> (or the reverse <a href="/grams-to-cups/">grams to cups</a>) — it covers 80+ ingredients. Counting spoons instead of ounces? See <a href="/tablespoons-in-a-cup/">how many tablespoons are in a cup</a>. Scaling up past the cup — 32 fl oz to quarts, 128 to gallons? See <a href="/cups-in-a-quart/">how many cups are in a quart</a>. Working in millilitres, or with UK/Australian cup sizes? The <a href="/cups-to-ml/">cups to mL page</a> has every cup standard, and the <a href="/volume-converter/">volume converter</a> handles tsp through litres. For butter specifically — sticks, cups, ounces and grams — use the <a href="/butter-converter/">butter converter</a>.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "volume" } }) };
}

// "How many cups in a quart / pint / gallon?" — completes the US-measurement question
// trilogy (tablespoons-in-a-cup, ounces-in-a-cup). Everything here is US-customary
// definition arithmetic — 1 gallon = 4 quarts = 8 pints = 16 cups = 128 fl oz, and
// 1 US cup = 236.5882365 mL exactly — so no ingredient data is involved.
function cupsInQuartPage() {
  const CUP_ML = 236.5882365;
  const title = "How Many Cups in a Quart? (4) — Pints & Gallons Chart | ExactCup";
  const description = "There are 4 cups in a US quart, 2 cups in a pint and 16 cups in a gallon. Free converter plus charts: quarts to cups, the full gallon ladder, and quarts vs liters.";
  const canonical = "/cups-in-a-quart/";
  const rnd = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  // The nesting ladder, one row per named US measure. Columns all derive from cups.
  const ladder = [
    ["1 cup", 1], ["1 pint", 2], ["1 quart", 4], ["1/2 gallon", 8], ["1 gallon", 16],
  ].map(([lab, c]) =>
    `<tr><td>${lab}</td><td class="num">${c} ${c === 1 ? "cup" : "cups"}</td><td class="num">${rnd(c / 2, 2)} pt</td><td class="num">${rnd(c / 4, 2)} qt</td><td class="num">${c * 8} fl oz</td><td class="num">${rnd(c * CUP_ML / 1000, 2)} L</td></tr>`
  ).join("\n");
  // Quarts → cups for the amounts people actually look up.
  const qNamed = { 0.5: "1 pint", 2: "1/2 gallon", 4: "1 gallon", 8: "2 gallons" };
  const qRows = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 8].map((q) => {
    const c = q * 4;
    return `<tr><td>${q} ${q === 1 ? "quart" : "quarts"}</td><td class="num">${c} ${c === 1 ? "cup" : "cups"}</td><td class="num">${q * 32} fl oz</td><td class="num">${rnd(c * CUP_ML / 1000, 2)} L</td><td>${qNamed[q] || ""}</td></tr>`;
  }).join("\n");
  const impQtCups = rnd(1136.5225 / CUP_ML, 1); // imperial quart (40 imp fl oz) in US cups
  const dryQtCups = rnd(1101.22 / CUP_ML, 2); // US dry quart (67.2 cu in) in US liquid cups
  const faq = [
    ["How many cups are in a quart?", "There are 4 cups in 1 US quart. So 2 quarts is 8 cups, and half a quart (1 pint) is 2 cups. A quart is also 32 fluid ounces, or about 946 mL — just under a liter."],
    ["How many cups are in a gallon?", "There are 16 cups in 1 US gallon — a gallon is 4 quarts, and each quart is 4 cups. That's also 128 fluid ounces, or about 3.79 liters."],
    ["How many cups are in a half gallon?", "There are 8 cups in half a gallon — that's 2 quarts, 64 fluid ounces, or about 1.89 liters. A standard half-gallon carton of milk pours 8 full cups."],
    ["How many cups are in a pint?", "There are 2 cups in 1 US pint (16 fluid ounces). A pint of ice cream is 2 cups — about 4 half-cup scoops."],
    ["How many pints are in a quart?", "There are 2 pints in 1 quart. The whole ladder doubles and doubles again: 2 cups make a pint, 2 pints make a quart, and 4 quarts make a gallon."],
    ["How many quarts are in a gallon?", "There are 4 quarts in 1 US gallon — the name literally comes from \"quarter of a gallon.\" That makes 2 quarts in a half gallon and 8 pints in a gallon."],
    ["How many ounces are in a quart?", "There are 32 fluid ounces in 1 US quart (4 cups × 8 fl oz each). A gallon is 128 fl oz and a pint is 16 fl oz. Note these are fluid ounces (volume) — what a quart weighs depends on what's in it."],
    ["Is a quart the same as a liter?", "Close, but no. A US liquid quart is 0.946 liters, so a liter is about 5.7% bigger than a quart. If a recipe calls for a quart and you only have metric measures, use 950 mL. (An imperial quart is different again — 1.136 liters.)"],
    ["How many cups are in 2 quarts?", "2 quarts is 8 cups — the same as half a gallon or 64 fluid ounces. Most large soup and stock recipes land around this size."],
    ["Is a dry quart the same as a liquid quart?", "No. Berries and produce in the US are often sold by the dry quart, which is about 1.101 liters — roughly " + dryQtCups + " liquid cups, not 4. The 4-cups-per-quart rule on this page is for the liquid quart used in recipes and drinks."],
    ["Are UK pints and quarts the same as US ones?", "No — imperial measures are bigger. A UK pint is 20 imperial fluid ounces (568 mL, about 2.4 US cups) versus 16 US fl oz for a US pint, and a UK quart is 1.136 liters (about " + impQtCups + " US cups) versus 0.946 liters. That's why a British pint of beer is noticeably larger than an American one."],
    ["How do I remember cups, pints, quarts and gallons?", "Think in doublings: 2 cups = 1 pint, 2 pints = 1 quart, and 4 quarts = 1 gallon. Many cooks picture the \"gallon man\" diagram — a big G holding four Qs, each Q holding two Ps, each P holding two Cs."],
  ];
  const jsonLd = [
    appLd("Cups in a Quart Converter", description, canonical),
    faqLd(faq),
    breadcrumbLd([["Cups in a Quart", canonical]]),
  ];
  const f = (lab, id, ph) => `<div class="field"><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" step="any" placeholder="${ph}"></div>`;
  const body = `
<h1>How Many Cups in a Quart?</h1>
<p class="lead">There are <strong>4 cups in 1 US quart</strong>. The rest of the ladder: <strong>2 cups in a pint</strong>, <strong>8 cups in a half gallon</strong>, and <strong>16 cups in a gallon</strong>. Type any amount below to convert between all four.</p>
<div class="calc">
  <div class="row">${f("Cups", "cups", "4")}${f("Pints", "pints", "2")}${f("Quarts", "quarts", "1")}${f("Gallons", "gallons", "0.25")}</div>
</div>
<p class="note">US customary liquid measures: 1 quart = 4 cups = 32 fl oz = 946 mL. UK/imperial pints and quarts are larger — see the FAQ.</p>
<h2>Cups, pints, quarts and gallons</h2>
<p>Every named US liquid measure, side by side. Each row is the same amount expressed five ways:</p>
<table><thead><tr><th>Measure</th><th>Cups</th><th>Pints</th><th>Quarts</th><th>Fluid oz</th><th>Liters</th></tr></thead><tbody>
${ladder}
</tbody></table>
<h2>Quarts to cups</h2>
<table><thead><tr><th>Quarts</th><th>Cups</th><th>Fluid oz</th><th>Liters</th><th>Also known as</th></tr></thead><tbody>
${qRows}
</tbody></table>
<h2>The trick: everything doubles</h2>
<p>The US liquid ladder is easy to keep in your head because each step (almost) just doubles: <strong>2 cups make a pint, 2 pints make a quart, and 4 quarts make a gallon</strong> — "quart" literally means a quarter of a gallon. Schoolkids learn it as the <em>gallon man</em>: a big G with four Qs inside, two Ps inside each Q, and two Cs inside each P. Multiply it out and you get the numbers on this page: 4 cups per quart, 16 cups per gallon, 8 pints per gallon.</p>
<h2>Quick reference</h2>
<ul>
<li><strong>1 pint</strong> = 2 cups = 16 fl oz ≈ 473 mL</li>
<li><strong>1 quart</strong> = 2 pints = 4 cups = 32 fl oz ≈ 946 mL</li>
<li><strong>1/2 gallon</strong> = 2 quarts = 8 cups = 64 fl oz ≈ 1.89 L</li>
<li><strong>1 gallon</strong> = 4 quarts = 8 pints = 16 cups = 128 fl oz ≈ 3.79 L</li>
<li><strong>1 liter</strong> ≈ 1.06 quarts ≈ 4.23 cups</li>
</ul>
<h2>Need a different conversion?</h2>
<p>Going smaller instead of bigger? See <a href="/tablespoons-in-a-cup/">how many tablespoons are in a cup</a> (16) or <a href="/ounces-in-a-cup/">how many ounces are in a cup</a> (8 fl oz — plus the fluid-vs-dry-ounce trap). Working in metric? The <a href="/cups-to-ml/">cups to mL page</a> covers US, metric and imperial cup sizes, and the <a href="/volume-converter/">volume converter</a> handles teaspoons through liters. Converting an ingredient to weight — how much a quart of flour or milk actually weighs? That depends on the ingredient: use the <a href="/cups-to-grams/">cups to grams converter</a>.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "volume" } }) };
}

function portionPage() {
  const FOODS = [
    ["white-rice", "White Rice (uncooked)", 75, "Uncooked weight. Side dish: about half (~50 g)."],
    ["pasta", "Pasta (dried)", 100, "Dried weight. Side dish: about half (50–75 g)."],
    ["potatoes", "Potatoes (raw)", 200, "Raw, peeled. Side dish: about half (100–150 g)."],
    ["couscous", "Couscous (dry)", 80, "Dry weight. Side dish: about half (~50 g)."],
    ["quinoa", "Quinoa (dry)", 75, "Dry weight. Side dish: about half (~45 g)."],
    ["bulgur", "Bulgur (dry)", 75, "Dry weight. Side dish: about half."],
    ["dried-lentils", "Dried Lentils", 100, "Dry weight. Soup/side: 50–60 g."],
    ["egg-noodles", "Egg Noodles (dry)", 100, "Dry weight. Side dish: about half (~56 g)."],
    ["mashed-potatoes", "Mashed Potatoes", 250, "Raw potato weight before mashing. Side: ~125–150 g."],
    ["polenta-cornmeal", "Polenta / Cornmeal (dry)", 80, "Dry weight. Side dish: about half (~45 g)."],
  ];
  const title = "How Much Rice/Pasta Per Person? Portion Calculator | ExactCup";
  const description = "How much rice, pasta, potatoes or couscous per person? Free portion calculator for meal planning — pick a food and number of people for exact amounts.";
  const canonical = "/portion-calculator/";
  const faq = [
    ["How much rice per person?", "About 75 g of uncooked rice per person for a main dish, or roughly 50 g as a side. Cooked, that 75 g roughly triples in volume and comes out at about 210 g on the plate (rice is about 2.8 times its dry weight once cooked) — a generous cup of cooked rice."],
    ["How much dried pasta per person?", "About 100 g of dried pasta per person for a main course, or 50–75 g as a starter or side. Fresh pasta is heavier and wetter, so use around 115–125 g per person for a main."],
    ["How much mashed potato per person?", "Around 200–250 g of raw, peeled potato per person makes a generous main-dish serving of mash once you add butter and milk. For a lighter side, 150 g is plenty."],
    ["How much couscous or quinoa per person?", "About 75–80 g dry per person as a main, or half that as a side. Both roughly triple in volume when cooked, so a little goes a long way — measure dry to avoid over-catering."],
    ["Are these portions for a main or a side dish?", "The calculator and table show main-dish portions, based on standard meal-planning guidance (WRAP / Love Food Hate Waste). For a side dish alongside meat or other components, use about half. Scale up for big appetites or planned leftovers."],
  ];
  const opts = FOODS.map(([slug, name]) => `<option value="${slug}">${esc(name)}</option>`).join("");
  const rows = FOODS.map(([slug, name, g]) => `<tr><td>${esc(name)}</td><td class="num">${g} g</td></tr>`).join("");
  const body = `
<h1>Portion Calculator — How Much Per Person?</h1>
<p class="lead">No more cooking too much (or too little). Pick a food and how many people you're feeding.</p>
<div class="calc">
  <div class="row">
    <div class="field"><label for="food">Food</label><select id="food">${opts}</select></div>
    <div class="field" style="max-width:160px"><label for="people">People</label><input id="people" type="number" inputmode="numeric" value="4" min="1" step="1"></div>
  </div>
  <div class="result"><div class="big" id="portion-out">—</div><div class="sub" id="portion-note"></div></div>
</div>
<h2>Per-person serving guide (main dish)</h2>
<table><thead><tr><th>Food</th><th>Per person</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note">Main-dish portions based on standard meal-planning guidance (WRAP / Love Food Hate Waste). Side dishes are roughly half. Adjust for big appetites or leftovers. All grain and pasta portions are <strong>dry</strong> weights — the <a href="/dry-to-cooked/">dry to cooked converter</a> shows what they turn into on the plate (75 g of dry rice ≈ 210 g cooked).</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: [appLd("Portion Calculator", description, canonical), faqLd(faq)], cfg: { type: "portion", foods: FOODS.map(([slug, , g, note]) => ({ slug, g, note })) } }) };
}

// Per-category FAQ for the conversion-chart hubs. Values are drawn from the verified
// gram-per-cup weights in ingredients.json (the same numbers rendered in each chart).
const CATEGORY_FAQ = {
  flour: [
    ["How many grams is 1 cup of flour?", "One cup of all-purpose flour weighs about 120 g. Bread flour and cake flour are also 120 g per cup, while whole wheat and self-rising flour are 113 g. Starches differ more: cornstarch is 112 g and coconut flour 128 g."],
    ["Do all flours weigh the same per cup?", "No. Most wheat flours are close to 120 g per cup, but density varies a lot: almond flour is only 96 g and oat flour 92 g, while semolina is 163 g. Always convert by the specific flour rather than using one ratio."],
    ["How do you measure a cup of flour accurately?", "Spoon the flour into the cup and level it off with a knife — don't dip the cup and scoop, which packs the flour and can add 20% more weight. For real accuracy, weigh it in grams."],
    ["Is a cup of bread flour the same as all-purpose flour?", "By weight, yes — both are about 120 g per cup. They differ in protein content, not density, so you can swap the weights directly."],
    ["What is the difference between half a cup of bread flour and half a cup of whole wheat flour?", "Half a cup of bread flour is 60 g and half a cup of whole wheat flour is 56.5 g, so whole wheat is about 3.5 g lighter. Over a full cup the gap is 7 g — 120 g of bread flour against 113 g of whole wheat. All-purpose flour weighs the same as bread flour, so the same comparison holds for it."],
    ["Is whole wheat flour heavier than white flour?", "No — it is lighter by the cup. A cup of whole wheat flour is 113 g against 120 g for all-purpose or bread flour. The bran and germ flakes left in whole wheat are coarse and irregular, so they hold the cup open instead of settling tightly the way fine white flour does."],
    ["Which flour weighs the most per cup?", "Semolina, at 163 g per cup — 43 g more than all-purpose flour. Coconut flour and arrowroot powder come next at 128 g. The lightest entries on this chart are cocoa powder at 85 g and oat flour at 92 g."],
    ["How much does half a cup of flour weigh?", "Half a cup of all-purpose, bread or cake flour is 60 g. Whole wheat, self-rising and tapioca flour are 56.5 g, cornstarch 56 g, rye flour 53 g, almond flour 48 g, oat flour 46 g and cocoa powder 42.5 g. Coconut flour and arrowroot powder are heavier at 64 g."],
    ["Can I substitute one flour for another cup for cup?", "Not safely by volume. Swap by weight instead — measure the grams the recipe calls for, then weigh the same grams of the replacement. A cup-for-cup swap quietly changes how much flour is in the bowl: putting whole wheat in place of all-purpose by the cup removes about 7 g, and almond flour removes 24 g."],
  ],
  sugar: [
    ["How many grams is 1 cup of sugar?", "One cup of granulated white sugar weighs 200 g. Packed brown sugar is heavier at 213 g, caster sugar is 190 g, and powdered (icing) sugar is much lighter at 113 g."],
    ["Why does brown sugar weigh more than white sugar?", "Brown sugar is packed into the cup and holds moisture from its molasses, so a cup contains more — about 213 g packed versus 200 g for granulated sugar."],
    ["How many grams is 1 cup of honey?", "One cup of honey weighs about 340 g. Other liquid sweeteners are similar and heavy: maple syrup 322 g, corn syrup 328 g, golden syrup and molasses 340 g, agave nectar 336 g."],
    ["How do you measure sticky syrups by the cup?", "Lightly oil or spray the measuring cup first so honey, molasses or maple syrup slide out cleanly, or weigh them straight into the bowl in grams for the most accuracy."],
    ["How many grams is 3/4 cup of sugar?", "Three-quarters of a cup of granulated sugar is 150 g. Packed brown sugar is 159.8 g, caster sugar 142.5 g and powdered (icing) sugar only 84.8 g. The full fraction chart on this page has every other cup fraction."],
    ["How many grams is 1/3 cup of sugar?", "A third of a cup of granulated sugar is about 66.7 g. Packed brown sugar is 71 g, caster sugar 63.3 g and powdered sugar 37.7 g. For liquid sweeteners a third of a cup is much heavier: honey 113.3 g, corn syrup 109.3 g, maple syrup 107.3 g."],
    ["How many grams of sugar are actually in a cup of sugar?", "About 200 g — essentially all of it. USDA FoodData Central measures granulated sugar at 99.8 g of sugars per 100 g, so a 200 g cup is roughly 200 g of sugars. Brown sugar is 97 g per 100 g (about 207 g in a packed 213 g cup) and powdered sugar 97.8 g per 100 g, the balance being the cornstarch added to keep it from caking."],
    ["How many grams of sugar are in a cup of honey?", "About 279 g. A cup of honey weighs 340 g and USDA measures honey at 82.1 g of sugars per 100 g — the rest is mostly water. So a cup of honey carries roughly 40% more actual sugar than a cup of granulated sugar, even though honey is 'only' 82% sugars by weight."],
    ["Should brown sugar be packed when you measure it?", "Yes — nearly every recipe assumes a packed cup, pressed down with the back of a spoon until it holds the cup's shape when turned out. The gap is enormous: USDA measures a packed cup at 220 g and an unpacked one at just 145 g, so a loosely filled cup is about a third short. This chart uses King Arthur's packed figure of 213 g; 213–220 g is the honest range for a packed cup."],
    ["Does sifting powdered sugar change how many grams are in a cup?", "Yes — not because sifting changes the sugar, but because it changes how much fits in the cup. USDA measures a sifted cup at 100 g against 120 g unsifted; King Arthur lists 113 g unsifted, the figure used here. Recipe wording matters: '1 cup sifted confectioners' sugar' means sift first and then measure (about 100 g), while '1 cup confectioners' sugar, sifted' means measure first and sift after (113–120 g). Weighing removes the ambiguity."],
    ["Is caster sugar the same as granulated sugar?", "Chemically yes — caster (superfine) sugar is the same sucrose, milled to finer crystals so it dissolves faster, which is why meringues and delicate cakes call for it. By the cup the weights differ slightly: King Arthur lists baker's special/superfine sugar at 190 g per cup against 198–200 g for granulated. They substitute for each other cup for cup in most recipes, but if you are weighing, use each sugar's own figure."],
  ],
  dairy: [
    ["How many grams is 1 cup of milk?", "One cup of milk weighs about 240 g. Most liquid dairy is close to this — buttermilk 227 g, heavy cream 232 g, sour cream 230 g and yogurt 245 g."],
    ["How many grams is 1 cup of butter?", "One cup of butter weighs 227 g, which is 2 sticks. Half a cup is about 113 g — a single stick."],
    ["Is a cup of oil the same weight as a cup of butter?", "No. A cup of vegetable, olive or coconut oil weighs about 216–218 g, a little less than butter's 227 g, because liquid oil is less dense than solid fat."],
    ["How many grams is 1 cup of shredded cheese?", "Shredded cheddar or mozzarella is about 113 g per cup and finely grated parmesan around 100 g. Soft cheeses are much heavier — cream cheese and ricotta are roughly 227–232 g per cup."],
    ["How many cups does an 8 oz block of cheese make shredded?", "About 2 cups. The producer rule of thumb — published by Cabot and matching King Arthur's chart and USDA's measured 113 g cup — is that 4 oz of block cheese shreds into 1 cup, so 8 oz gives 2 cups and a 1 lb block about 4 cups. It holds for cheddar, jack, mozzarella and Swiss shredded on a box grater; bagged pre-shredded cheese is fluffier, and USDA measures a cup of bagged part-skim mozzarella at only 86 g."],
    ["Is grated cheese the same as shredded cheese when measuring by the cup?", "No — the grate size changes the cup weight dramatically. America's Test Kitchen's yields for hard cheese: 1 oz comes to about 1/2 cup rasp-grated (microplane), 1/3 cup on a medium grater, or 1/4 cup coarsely shredded. That means a cup of fluffy microplaned parmesan weighs around 57 g while canister-style fine grated parmesan is 100 g or more, and coarse shreds about 113 g. When a recipe says \"grated\", weight in grams is the only unambiguous measure."],
    ["How much grated parmesan does a wedge of parmesan make?", "By weight nothing changes — 100 g of wedge is 100 g grated. By volume, America's Test Kitchen's rule gives about 1/2 cup per ounce microplaned or 1/3 cup per ounce on a medium grater, so a typical 4 oz wedge makes roughly 2 cups of fluffy microplaned parmesan or about 1 1/3 cups medium-grated."],
    ["How much does a cup of ricotta or cottage cheese weigh?", "Ricotta is 227 g per cup on King Arthur's chart (the value this site uses), while USDA measures 246 g — an honest published range of 227–246 g depending on how firmly it's packed. Cottage cheese depends on the curd: USDA measures 210 g for large curd and 225 g for small curd, not packed. Both are wet, clumpy cheeses, so press lightly to close air gaps or simply weigh."],
  ],
  baking: [
    ["How many grams is 1 cup of chocolate chips?", "One cup of chocolate chips weighs about 170 g. White chocolate chips are the same weight per cup."],
    ["How many grams is 1 cup of chopped nuts?", "Chopped nuts are roughly 120 g per cup. Whole almonds, hazelnuts and pine nuts are denser at 142 g, pecan halves lighter at 105 g, and chopped walnuts about 113 g."],
    ["How many grams is 1 cup of shredded coconut?", "Shredded coconut is very light — about 80 g per cup — so a cup weighs far less than most other baking add-ins."],
    ["Do seeds weigh the same per cup?", "Roughly. Sesame and poppy seeds are about 142–144 g per cup and chia seeds 148 g, while ground flaxseed is lighter at 100 g."],
    ["How many cups is 100 g of nuts or seeds?", "It depends on the nut. 100 g of ground flaxseed is exactly 1 cup, shredded coconut 1.25 cups, pecan halves about 0.95 cups, chopped walnuts or cashews about 0.88 cups, generic chopped nuts about 0.83 cups, and dense whole nuts and small seeds — almonds, hazelnuts, pine nuts, sesame, chia — only about 0.68–0.7 cups. The reverse-lookup table above has every value."],
    ["How many grams is half a cup of nuts and seeds?", "For mixed chopped nuts, about 60 g. Whole almonds, hazelnuts, pine nuts and sesame seeds are about 71 g per half cup, chia seeds 74 g, chopped walnuts and cashews about 57 g, pecan halves 53 g, and ground flaxseed 50 g."],
  ],
  grain: [
    ["How many grams is 1 cup of uncooked rice?", "One cup of uncooked white rice weighs about 185 g. Quinoa is lighter at 170 g, and couscous about 175 g — all measured dry."],
    ["How many grams is 1 cup of rolled oats?", "Rolled (old-fashioned) oats weigh about 90 g per cup. Steel-cut oats are much denser at about 160 g because the grains are cut, not flattened."],
    ["How many grams is 1 cup of water?", "One cup of water weighs about 237 g (close to 240 ml, or 8 fluid ounces). Water is the reference most other liquids are measured against."],
    ["How much does 1 cup of breadcrumbs weigh?", "Dry breadcrumbs are about 108 g per cup, but light, airy panko is only 50 g — so always convert by the specific type of crumb."],
  ],
};

function categoryPage(key) {
  const items = DATA.ingredients.filter((i) => i.category === key);
  if (!items.length) return null;
  const cname = catName(key);
  const canonical = `/${key}-conversion-chart/`;
  // SEO <title> can surface concrete searchable terms in place of a short/vague category label
  // (e.g. "Grains & Misc" → "Grains, Rice & Oats"); visible H1/breadcrumb keep the category label.
  // Each override lists only ingredients the chart actually contains, so the title stays honest.
  const titleName = {
    grain: "Grains, Rice & Oats",
    dairy: "Milk, Butter & Cheese",
    baking: "Chocolate Chips, Nuts & Seeds",
  }[key] || cname;
  const title = `${titleName} Conversion Chart — Cups to Grams | ExactCup`;
  // dairy gets a hand-written description surfacing the cheese cup-equivalents table
  // (targets the observed query class "cheese cup equivalents chart").
  const description = key === "sugar"
    ? `Free sugar conversion chart: grams per cup for granulated, brown, caster and powdered sugar, honey, maple syrup and molasses — plus every cup fraction (3/4 cup of sugar is 150 g), tablespoons, and how many grams of sugar a cup actually contains.`
    : key === "dairy"
    ? `Free dairy conversion chart: grams per cup for butter, milk, cream, yogurt and every cheese — plus a cheese cup equivalents table (4 oz block = 1 cup shredded = 113 g; grated parmesan, crumbled feta, cream cheese and more).`
    : key === "baking"
    ? `Free baking conversion chart: grams per cup for chocolate chips, nuts and seeds — plus a 100 g in cups reverse table (100 g of almonds ≈ 0.7 cups, chopped nuts ≈ 0.83, flaxseed = 1 cup). Cups, half-cups and quarter-cups at a glance.`
    : key === "flour"
    ? `Free flour conversion chart: grams per cup for all-purpose, bread, cake, whole wheat, almond and coconut flour — plus every flour compared side by side against all-purpose (half a cup of bread flour is 60 g, whole wheat 56.5 g).`
    : `Free ${cname.toLowerCase()} conversion chart: grams per cup for ${items.slice(0, 4).map((i) => i.name.toLowerCase()).join(", ")} and more. Cups, half-cups and quarter-cups to grams at a glance.`;
  const rows = items.map((i) =>
    `<tr><td><a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a></td><td class="num">${g2(i.gramsPerCup)} g</td><td class="num">${g2(i.gramsPerCup / 2)} g</td><td class="num">${g2(i.gramsPerCup / 4)} g</td></tr>`
  ).join("");
  // Weight lookup by slug, so prose can interpolate the same verified numbers the tables
  // render — the text can never drift out of step with the chart.
  const w = (slug) => (items.find((i) => i.slug === slug) || {}).gramsPerCup;
  // Category-specific FAQ — answers the real questions each chart ranks for, and feeds
  // FAQPage JSON-LD (rich results). Every gram value below is pulled straight from the
  // verified ingredients.json weights shown in the chart above, so the two never disagree.
  const faq = CATEGORY_FAQ[key] || [];
  const jsonLd = [breadcrumbLd([
    ["Cups to Grams", "/cups-to-grams/"],
    [cname, canonical],
  ])];
  if (faq.length) jsonLd.push(faqLd(faq));
  // Live converter scoped to this category's ingredients — reuses the shared "master"
  // widget (initMaster reads cfg.ingredients + fixed IDs), so no new JS. Gives the
  // best-ranking page TYPE a working tool for any amount, not just a static table.
  const opts = items.map((i) => `<option value="${i.slug}">${esc(i.name)}</option>`).join("");
  const cfg = { type: "master", ingredients: items.map((i) => ({ slug: i.slug, gramsPerCup: i.gramsPerCup })) };
  const body = `
<nav style="font-size:13px;color:var(--muted);margin-bottom:6px"><a href="/cups-to-grams/">Cups to Grams</a> › ${esc(cname)}</nav>
<h1>${esc(cname)} Conversion Chart</h1>
<p class="lead">Convert any amount of ${esc(cname.toLowerCase())} to grams below, or scan the full chart. Click any ingredient for its own converter.</p>
<div class="calc">
  <div class="field" style="margin-bottom:10px"><label for="ingredient">Ingredient</label><select id="ingredient">${opts}</select></div>
  <div class="row">
    <div class="field"><label for="amount">Amount</label><input id="amount" type="number" inputmode="decimal" value="1" min="0" step="any"></div>
    <div class="field" style="max-width:140px"><label for="unit">Unit</label><select id="unit"><option value="cups">cups</option><option value="tbsp">tablespoons</option><option value="tsp">teaspoons</option></select></div>
    <div class="field"><label for="grams">Grams</label><input id="grams" type="number" inputmode="decimal" step="any"></div>
  </div>
  <div class="result"><div class="big" id="out-grams">—</div><div class="sub" id="out-oz">—</div></div>
</div>
<h2>${esc(cname)} conversion chart</h2>
<table><thead><tr><th>Ingredient</th><th>1 cup</th><th>½ cup</th><th>¼ cup</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note">Remember: every ${esc(cname.toLowerCase().replace(/s$/, ""))} has a different density, so always convert by ingredient rather than using one ratio. For other amounts, open the individual converter.</p>${key === "sugar" ? `
<p>Replacing the sugar with honey rather than just measuring it? The <a href="/sugar-to-honey/">sugar to honey conversion chart</a> covers the ½–¾ ratio, the liquid reduction and the baking-soda rule.</p>
<h2 id="sugar-to-grams">Converting sugar to grams: every cup fraction</h2>
<p>The chart above gives the three headline amounts. This one gives every fraction a recipe actually asks for — three-quarters, two-thirds, a third — plus a single tablespoon, for all ${items.length} sugars and syrups on the page. Start with the one everybody looks up: <strong>1 cup of granulated sugar is ${g2(w("granulated-sugar"))}&nbsp;g, ¾ cup is ${g2(w("granulated-sugar") * 0.75)}&nbsp;g, ⅔ cup is ${g2(w("granulated-sugar") * 2 / 3)}&nbsp;g and 1 tablespoon is ${g2(w("granulated-sugar") / 16)}&nbsp;g.</strong> Packed brown sugar runs a little heavier all the way down the column, and powdered sugar is barely half the weight of granulated.</p>
<div class="tw"><table><thead><tr><th>Sugar or syrup</th><th>1 cup</th><th>&frac34; cup</th><th>&frac23; cup</th><th>&frac12; cup</th><th>&frac13; cup</th><th>&frac14; cup</th><th>1 tbsp</th></tr></thead><tbody>${
  items.map((i) => `<tr><td><a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a></td>` +
    [1, 0.75, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 16].map((f) => `<td class="num">${g2(i.gramsPerCup * f)} g</td>`).join("") +
    `</tr>`).join("")
}</tbody></table></div>
<p class="note">Every cell is computed from the same verified grams-per-cup weight as the chart above (&frac34; cup = weight &times; 0.75, 1 tbsp = weight &divide; 16), so the two tables can never disagree. Brown sugar is packed; powdered sugar unsifted — see the section below for why those two words move the number so much. For an amount that is not in the table, the converter at the top of the page takes any number, and the <a href="/tablespoons-to-grams/">tablespoons to grams converter</a> handles spoon amounts.</p>
<h2 id="grams-of-sugar-in-a-cup">How many grams of sugar are actually in a cup?</h2>
<p>Two different questions hide inside that one. <em>What does a cup weigh</em> is the chart above — ${g2(w("granulated-sugar"))}&nbsp;g for granulated. <em>How much of that weight is sugar</em> is a composition question, and for dry sugars the answer is: nearly all of it. USDA FoodData Central measures granulated sugar at 99.8&nbsp;g of sugars per 100&nbsp;g, so a cup is about ${Math.round(w("granulated-sugar") * 0.998)}&nbsp;g of sugars and the two questions collapse into the same answer. The sweeteners where they come apart are the ones carrying water or an additive.</p>
<div class="tw"><table><thead><tr><th>Sweetener</th><th>1 cup weighs</th><th>Sugars per 100 g</th><th>Sugars in 1 cup</th></tr></thead><tbody>${
  [["granulated-sugar", 99.8], ["caster-sugar", 99.8], ["brown-sugar", 97.0], ["powdered-sugar", 97.8], ["honey", 82.1], ["maple-syrup", 60.5]]
    .map(([slug, pct]) => {
      const it = items.find((x) => x.slug === slug);
      return `<tr><td><a href="/cups-to-grams/${slug}/">${esc(it.name)}</a></td><td class="num">${g2(it.gramsPerCup)} g</td><td class="num">${pct} g</td><td class="num">&asymp;${Math.round(it.gramsPerCup * pct / 100)} g</td></tr>`;
    }).join("")
}</tbody></table></div>
<p class="note">Composition figures are USDA FoodData Central (SR Legacy) measured values: granulated sugar 99.8&nbsp;g sugars per 100&nbsp;g (#169655), brown sugar 97.0 (#168833), powdered sugar 97.8 (#169656 &mdash; the balance is the cornstarch added to stop it caking), honey 82.1 (#169640), maple syrup 60.5 (#169661). Caster sugar is the same sucrose as granulated, milled finer, so it carries the same 99.8%. The last column multiplies this page\u2019s cup weight by that percentage. These are composition numbers from the same source as the weights — not nutrition advice.</p>
<p>The counterintuitive result: <strong>syrups are watered-down sugar, yet a cup of them can deliver more sugar, not less.</strong> Honey is only 82% sugars by weight, but a cup holds ${g2(w("honey"))}&nbsp;g of it, so the cup carries about ${Math.round(w("honey") * 0.821)}&nbsp;g of sugars — roughly ${Math.round((w("honey") * 0.821 / (w("granulated-sugar") * 0.998) - 1) * 100)}% more than a cup of granulated sugar. Maple syrup goes the other way: a ${g2(w("maple-syrup"))}&nbsp;g cup is only 60.5% sugars, or about ${Math.round(w("maple-syrup") * 0.605)}&nbsp;g — slightly <em>less</em> sugar than a cup of granulated, and the rest is water. It is the reason honey and syrup swaps are never one-for-one; the <a href="/sugar-to-honey/">sugar to honey conversion</a> works through the ratio and the liquid adjustment it forces.</p>
<h2 id="packed-sifted">Packed, loose or sifted — where cup measures of sugar go wrong</h2>
<p>Granulated and caster sugar are forgiving: the crystals barely compress, so scoop, fill and sweep the top level and you land within a percent or two (King Arthur lists 198&nbsp;g a cup, USDA measures 200 — that is the whole disagreement). Two sugars on this chart are not forgiving at all.</p>
<p><strong>Brown sugar is measured packed.</strong> Press it into the cup with the back of a spoon until it holds the cup\u2019s shape when you turn it out — nearly every recipe written in cups assumes exactly that. The gap is the largest on this page: USDA measures a packed cup at 220&nbsp;g and an <em>unpacked</em> cup at just 145&nbsp;g. A loosely filled cup is about a third short, which is enough to change a cookie dough\u2019s texture outright. This chart uses King Arthur\u2019s packed figure, ${g2(w("brown-sugar"))}&nbsp;g; treat 213–220&nbsp;g as the honest range for a packed cup, and note that light and dark brown sugar weigh the same — only the molasses content differs.</p>
<p><strong>Powdered sugar changes with sifting</strong> — not because sifting changes the sugar, but because it changes how much of it fits in the cup. USDA measures a sifted cup at 100&nbsp;g against 120&nbsp;g unsifted; King Arthur lists 113&nbsp;g unsifted, the figure used here. Which is why recipe wording matters: “1 cup <em>sifted</em> confectioners\u2019 sugar” means sift first, then measure (about 100&nbsp;g), while “1 cup confectioners\u2019 sugar, sifted” means measure first and sift afterwards (113–120&nbsp;g). That is a 15–20% difference in a frosting from a comma. Weighing settles it.</p>
<p>Coconut sugar and any sugar that has hardened in the bag are the third case: break the lumps up before measuring &mdash; a clump props the cup open and leaves less sugar in it than the chart assumes. For everything else on this chart, the honest summary is that <a href="/cups-to-grams/granulated-sugar/">granulated sugar</a> is safe to measure by the cup, <a href="/cups-to-grams/brown-sugar/">brown</a> and <a href="/cups-to-grams/powdered-sugar/">powdered sugar</a> are worth weighing, and syrups are worth weighing simply because so much of them stays behind in the cup. Scaling a recipe up or down at the same time? The <a href="/recipe-scaler/">recipe scaler</a> does the arithmetic on every ingredient at once.</p>` : ""}${key === "flour" ? `
<h2 id="flour-vs-flour">Which flour weighs more? Every flour against all-purpose</h2>
<p>Comparing two flours before you swap them? Start with the pair people ask about most: <strong>half a cup of bread flour is ${g2(w("bread-flour") / 2)}&nbsp;g and half a cup of whole wheat flour is ${g2(w("whole-wheat-flour") / 2)}&nbsp;g</strong> &mdash; whole wheat is about ${g2((w("bread-flour") - w("whole-wheat-flour")) / 2)}&nbsp;g lighter, or ${g2(w("bread-flour") - w("whole-wheat-flour"))}&nbsp;g over a full cup (${g2(w("bread-flour"))}&nbsp;g against ${g2(w("whole-wheat-flour"))}&nbsp;g). That catches most bakers out, because whole wheat <em>feels</em> like the heartier flour. The bran and germ flakes left in it are coarse and irregular, so they hold the cup open instead of settling tight the way fine white flour does.</p>
<p>The table below lines every flour and starch on this page up against all-purpose, so you can compare any pair at a glance &mdash; full cup, half cup, and the gap per cup.</p>
<table><thead><tr><th>Flour or starch</th><th>1 cup</th><th>&frac12; cup</th><th>vs 1 cup all-purpose</th></tr></thead><tbody>${
  items.slice().sort((a, b) => b.gramsPerCup - a.gramsPerCup).map((i) => {
    const d = i.gramsPerCup - w("all-purpose-flour");
    const pct = Math.round((d / w("all-purpose-flour")) * 100);
    const cell = i.slug === "all-purpose-flour"
      ? "the reference"
      : d === 0
      ? "same as all-purpose"
      : `${d > 0 ? "+" : "&minus;"}${g2(Math.abs(d))} g (${d > 0 ? "+" : "&minus;"}${Math.abs(pct)}%)`;
    return `<tr><td><a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a></td><td class="num">${g2(i.gramsPerCup)} g</td><td class="num">${g2(i.gramsPerCup / 2)} g</td><td class="num">${cell}</td></tr>`;
  }).join("")
}</tbody></table>
<p class="note">Every figure is computed from the same verified grams-per-cup weights as the chart above (half cup = weight &divide; 2; the last column = weight &minus; ${g2(w("all-purpose-flour"))}&nbsp;g), so the two tables can never disagree. The ${g2(w("all-purpose-flour"))}&nbsp;g all-purpose / ${g2(w("whole-wheat-flour"))}&nbsp;g whole wheat pair is King Arthur Baking's published chart &mdash; the reference most US recipes are written against.</p>
<p><strong>Bread flour and all-purpose flour weigh exactly the same:</strong> ${g2(w("bread-flour"))}&nbsp;g a cup, both of them. What separates them is protein, not density &mdash; bread flour carries more, which builds more gluten and a chewier crumb. Because the weights match, you can swap them gram for gram and cup for cup and only the texture changes. <a href="/cups-to-grams/cake-flour/">Cake flour</a> is the same ${g2(w("cake-flour"))}&nbsp;g on this chart but far softer and lower in protein, so it is not interchangeable by feel &mdash; see the <a href="/cake-flour-substitute/">cake flour substitute</a>, which is 2 tablespoons of cornstarch swapped into every cup of all-purpose.</p>
<p><strong>How you fill the cup swamps most of these differences.</strong> Dipping the measuring cup straight into the bag packs the flour and can add around 20% &mdash; roughly 25&nbsp;g on a ${g2(w("all-purpose-flour"))}&nbsp;g cup. That one habit is more than three times the ${g2(w("bread-flour") - w("whole-wheat-flour"))}&nbsp;g bread-flour-to-whole-wheat gap, and bigger than the gap between all-purpose and almost every other flour on this chart. Spoon the flour in and level it off, or skip the argument entirely and weigh it.</p>
<p>Putting whole wheat in place of white flour? Do it <strong>by weight, not by cup</strong> &mdash; a cup-for-cup swap quietly takes ${g2(w("all-purpose-flour") - w("whole-wheat-flour"))}&nbsp;g of flour out of the recipe and leaves the dough wetter than intended. Whole wheat's bran also keeps soaking up water as the dough sits, so replace part of the white flour rather than all of it the first time and expect a denser crumb. The <a href="/cups-to-grams/whole-wheat-flour/">whole wheat flour converter</a> and <a href="/cups-to-grams/bread-flour/">bread flour converter</a> handle any amount. Thickening a sauce rather than baking? The <a href="/cornstarch-to-flour/">cornstarch to flour thickener conversion</a> swaps between them: cornstarch has twice the thickening power, so use half as much.</p>` : ""}${key === "grain" ? `
<p>These weights are all for <strong>dry, uncooked</strong> grain — cooking changes both the weight and the volume, and each grain differently. The <a href="/dry-to-cooked/">dry to cooked converter</a> turns any dry amount into its cooked yield (and back): 1 cup of dry rice makes about 3 cups cooked, 100 g of dry rice about 280 g cooked, and oatmeal comes out at more than five times the weight of the dry oats.</p>` : ""}${key === "baking" ? `
<h2 id="nuts-seeds-100g">Nuts &amp; seeds: 100 g in cups (reverse lookup)</h2>
<p>Recipe gives you a weight and you only have measuring cups? Because every nut and seed packs differently, <strong>100&nbsp;g is a different number of cups for each one</strong> &mdash; from a level cup of ground flaxseed down to barely two-thirds of a cup of chia seeds. The handy anchor: 100&nbsp;g of ground flaxseed is exactly 1 cup, and most <em>whole</em> nuts and small seeds land near &frac23;&ndash;&frac34; cup per 100&nbsp;g.</p>
<table><thead><tr><th>Nut / seed</th><th>100 g in cups</th><th>50 g in cups</th></tr></thead><tbody>${
  items.filter((i) => ["shredded-coconut", "ground-flaxseed", "pecan-halves", "walnuts-chopped", "cashews", "chopped-nuts", "whole-almonds", "hazelnuts", "pine-nuts", "sesame-seeds", "poppy-seeds", "chia-seeds"].includes(i.slug))
    .sort((a, b) => a.gramsPerCup - b.gramsPerCup)
    .map((i) => `<tr><td><a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a></td><td class="num">${cups2(100 / i.gramsPerCup)} ${cups2(100 / i.gramsPerCup) === 1 ? "cup" : "cups"}</td><td class="num">${cups2(50 / i.gramsPerCup)} cups</td></tr>`).join("")
}</tbody></table>
<p class="note">Computed from the same verified grams-per-cup weights as the chart above (100 &divide; grams per cup), so the two tables always agree. For any other gram amount, use the <a href="/grams-to-cups/">grams to cups converter</a> &mdash; every ingredient here is in its dropdown.</p>` : ""}${key === "dairy" ? `
<h2 id="cheese-equivalents">Cheese cup equivalents: blocks, shreds, grates and crumbles</h2>
<p>The rule printed on cheese producers' own sites (Cabot spells it out) and matched by King Arthur's weight chart: <strong>a 4&nbsp;oz piece of block cheese shreds into about 1 cup (113&nbsp;g)</strong>. So an 8&nbsp;oz block makes 2 cups shredded and a 1&nbsp;lb block 4 cups. USDA's measured cup weights agree for hand-shredded <a href="/cups-to-grams/shredded-cheddar/">cheddar</a> (113&nbsp;g) and low-moisture <a href="/cups-to-grams/shredded-mozzarella/">mozzarella</a> (112&ndash;113&nbsp;g) &mdash; but the rule quietly fails as soon as the cheese isn't shredded on a box grater. Here is the whole family, as actually measured:</p>
<table><thead><tr><th>Cheese, as measured</th><th>1 cup weighs</th><th>&asymp; cheese used</th></tr></thead><tbody>
<tr><td>Shredded cheddar, jack, mozzarella or Swiss (box grater)</td><td class="num">113 g</td><td class="num">4 oz</td></tr>
<tr><td>Bagged pre-shredded mozzarella (part-skim)</td><td class="num">86 g</td><td class="num">3 oz</td></tr>
<tr><td><a href="/cups-to-grams/grated-parmesan/">Grated parmesan</a> (canister-style, fine)</td><td class="num">100 g</td><td class="num">3&frac12; oz</td></tr>
<tr><td>Parmesan, microplane-grated (fluffy)</td><td class="num">&asymp;57 g</td><td class="num">2 oz</td></tr>
<tr><td>Hard cheese, medium grate</td><td class="num">&asymp;85 g</td><td class="num">3 oz</td></tr>
<tr><td>Crumbled feta</td><td class="num">150 g</td><td class="num">5&frac13; oz</td></tr>
<tr><td>Crumbled blue cheese</td><td class="num">135 g</td><td class="num">4&frac34; oz</td></tr>
<tr><td>Diced or cubed cheddar</td><td class="num">132 g</td><td class="num">4&frac23; oz</td></tr>
<tr><td><a href="/cups-to-grams/cream-cheese/">Cream cheese</a></td><td class="num">232 g</td><td class="num">8-oz brick &asymp; 1 cup</td></tr>
<tr><td><a href="/cups-to-grams/ricotta-cheese/">Ricotta</a></td><td class="num">227 g</td><td class="num">8 oz</td></tr>
<tr><td><a href="/cups-to-grams/cottage-cheese/">Cottage cheese</a></td><td class="num">226 g</td><td class="num">8 oz</td></tr>
</tbody></table>
<p class="note">Sources: USDA FoodData Central measured cup weights (shredded cheddar 113&nbsp;g, diced 132&nbsp;g, crumbled feta 150&nbsp;g, crumbled blue 135&nbsp;g, cream cheese 232&nbsp;g; the 86&nbsp;g figure is USDA's separate entry for <em>bagged</em> pre-shredded part-skim mozzarella, which is fluffier and carries anti-caking starch); King Arthur's chart for the 113&nbsp;g shredded family and 100&nbsp;g grated parmesan; America's Test Kitchen for the grate-style yields &mdash; 1&nbsp;oz of hard cheese makes about &frac12; cup rasp-grated, &frac13; cup on a medium grater, or &frac14; cup coarse. Two honest disagreements: ricotta is King Arthur's 227&nbsp;g here, while USDA measures 246&nbsp;g; and USDA's crumbled feta (150&nbsp;g) is well above what King Arthur's chart implies (&asymp;114&nbsp;g). Soft-cheese cups vary with how firmly you pack &mdash; when the recipe is fussy, weigh.</p>` : ""}
${faq.length ? `<h2>Frequently asked questions</h2>\n${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}` : ""}
<h2>Other conversion charts</h2>
<div class="chips">${Object.keys(DATA.categories).filter((k) => k !== key).map((k) => `<a href="/${k}-conversion-chart/">${esc(catName(k))}</a>`).join("")}</div>
<p style="margin-top:16px"><a href="/cups-to-grams/">← All ingredient converters</a></p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg }) };
}

function pizzaDoughPage() {
  const title = "Pizza Dough Calculator — Flour, Water, Salt & Yeast by Baker's % | ExactCup";
  const description = "Free pizza dough calculator. Enter how many dough balls, their weight and hydration, and get exact flour, water, salt, yeast and oil amounts in grams.";
  const canonical = "/pizza-dough-calculator/";
  const faq = [
    ["What hydration should pizza dough be?", "Neapolitan dough is typically 60–65% hydration; New-York style around 62–65%; high-hydration/airy doughs can reach 70%+. Beginners should start near 62%."],
    ["How much does a pizza dough ball weigh?", "A typical 12-inch pizza uses a 250–280 g ball. Personal pizzas use ~180–220 g, large pizzas ~300 g."],
    ["How much salt and yeast go in pizza dough?", "Salt is usually about 2–3% of the flour weight, and instant dry yeast roughly 0.2–0.5% for a slow rise (more for a fast same-day dough)."],
  ];
  const jsonLd = [faqLd(faq), appLd("Pizza Dough Calculator", description, canonical)];
  const f = (lab, id, val, step) => `<div class="field"><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" value="${val}" step="${step || "any"}" min="0"></div>`;
  const r = (lab, id) => `<tr><td>${lab}</td><td class="num" id="${id}">—</td></tr>`;
  const body = `
<h1>Pizza Dough Calculator</h1>
<p class="lead">Get exact dough quantities using baker's percentages. Set your dough balls and hydration — I'll do the flour, water, salt, yeast and oil.</p>
<div class="calc">
  <div class="row">${f("Dough balls", "balls", 4, 1)}${f("Weight each (g)", "ball-weight", 250, 5)}${f("Hydration (%)", "hydration", 62)}</div>
  <div class="row" style="margin-top:10px">${f("Salt (%)", "salt-pct", 2.5)}${f("Yeast (%)", "yeast-pct", 0.3)}${f("Oil (%)", "oil-pct", 0)}</div>
  <table style="margin-top:14px"><thead><tr><th>Ingredient</th><th>Amount</th></tr></thead><tbody>
  ${r("Flour", "out-flour")}${r("Water", "out-water")}${r("Salt", "out-salt")}${r("Yeast", "out-yeast")}${r("Oil", "out-oil")}
  <tr><td><strong>Total dough</strong></td><td class="num" id="out-total"><strong>—</strong></td></tr>
  </tbody></table>
</div>
<p class="note">Percentages are baker's percentages (relative to flour weight) — the standard way pizzaioli and bakers scale dough. Adjust hydration up for a lighter, airier crust; down for an easier-to-handle dough.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
<p style="margin-top:16px">Need to weigh by cups? Use the <a href="/cups-to-grams/all-purpose-flour/">flour cups-to-grams converter</a>.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "pizza" } }) };
}

function bakersPercentagePage() {
  const title = "Baker's Percentage Calculator — Bread Formula by Weight | ExactCup";
  const description = "Free baker's percentage calculator. Enter your flour weight and ingredients to get baker's percentages instantly, or scale any bread formula. Includes gluten-free baker's math: psyllium husk 5–7% of the flour blend, 100–135% hydration.";
  const canonical = "/bakers-percentage-calculator/";
  const faq = [
    ["What is baker's percentage?", "Baker's percentage (also called baker's math) expresses every ingredient in a recipe as a percentage of the total flour weight. Flour is always 100%, and everything else is measured relative to it. It lets bakers compare and scale formulas regardless of batch size."],
    ["How do you calculate baker's percentage?", "Divide the weight of an ingredient by the total flour weight and multiply by 100. For example, 350 g water with 500 g flour is 350 ÷ 500 × 100 = 70% (a 70% hydration dough). Salt of 10 g on 500 g flour is 2%."],
    ["What is hydration in bread baking?", "Hydration is the water (or other liquid) expressed as a baker's percentage of the flour. A lean bread is usually 60–75% hydration; higher hydration gives a more open, airy crumb but stickier dough that is harder to handle."],
    ["Why can baker's percentages add up to more than 100%?", "Because flour alone is the 100% reference, not the whole recipe. Adding water (≈65%), salt (≈2%) and yeast (≈1%) gives a formula total around 168% — that's normal. The total simply tells you the dough weight relative to the flour."],
    ["How do you figure out the baker's percentage of psyllium husk in gluten-free bread?", "The same way as any other ingredient: divide the psyllium weight by the total weight of the gluten-free flour blend — every flour AND starch in the recipe added together — and multiply by 100. A loaf with 20 g of psyllium husk over 320 g of combined buckwheat flour, potato starch and rice flour is 20 ÷ 320 × 100 ≈ 6% psyllium. The starches count inside the 100% flour reference; the psyllium itself does not — like water or salt, it sits on top."],
    ["How much psyllium husk should I use in gluten-free bread?", "About 5–7% of the flour-blend weight is the mainstream guidance — The Loopy Whisk's published rule is 5–7 g of whole psyllium husk per 100 g of gluten-free flour mix, and Gluten Free Alchemist says most of her recipes fall at 5.5–6%. Working the numbers from published artisan gluten-free loaves lands in the same band, roughly 5–6.5%. Food-science studies have tested far higher levels (up to about 17% of flour weight, mainly for shelf life), but home formulas stay near 5–7%."],
    ["Can I use psyllium husk powder instead of whole psyllium husk?", "Yes, but use less: the powder's finer particles bind more water per gram. The Loopy Whisk's rule is 85% of the whole-husk weight (so 17 g of powder replaces 20 g of husk); Gluten Free Alchemist says about 90%. Swapping 1:1 gives a stiffer, drier dough. Going the other way, multiply a powder amount by about 1.15 to get whole husk. Texture preference genuinely splits the experts — whole husk tends toward a more open crumb, while some bakers prefer fine powder for an even one."],
    ["Why do gluten-free bread recipes have more than 100% hydration?", "It's not a typo. Psyllium and gluten-free flours and starches absorb far more water than wheat flour, so psyllium-based gluten-free doughs typically run about 100–135% hydration — computed from published loaves: King Arthur's gluten-free artisan bread is 113%, The Loopy Whisk's loaves 106–122%, Aran Goyoaga's up to 133% — versus roughly 60–85% for wheat doughs. Percentages over 100 are fine because the flour, not the whole dough, is the reference."],
    ["Can I substitute xanthan gum for psyllium husk in gluten-free bread?", "Not in a shaped, free-standing loaf. Psyllium's soluble fiber binds many times its weight in water into an elastic gel that stands in for the gluten network, letting the dough be kneaded, shaped and hold gas — The Loopy Whisk (a chemistry PhD) is blunt that xanthan gum cannot replace it. The exception is batter-style pan loaves: Artisan Bread in Five's stored-dough mix lists ground psyllium or xanthan interchangeably at about 2% of flour weight. Note too that some commercial blends (King Arthur's gluten-free bread and pizza flours) already build psyllium and xanthan into the flour itself — which is why recipes using those blends add none."],
  ];
  const jsonLd = [faqLd(faq), appLd("Baker's Percentage Calculator", description, canonical)];
  // Seed a classic lean-bread formula at 500 g flour.
  const cfg = { type: "bakers", rows: [
    { name: "Water", pct: 70 },
    { name: "Salt", pct: 2 },
    { name: "Instant yeast", pct: 1 },
  ] };
  const ref = [
    ["Flour", "100% (the reference)"],
    ["Water — lean bread", "60–75%"],
    ["Salt", "1.8–2.2%"],
    ["Instant dry yeast", "0.5–1%"],
    ["Fresh (cake) yeast", "1.5–3%"],
    ["Sourdough starter / levain", "15–25%"],
    ["Sugar — enriched dough", "5–12%"],
    ["Butter or oil — enriched dough", "5–20%"],
    ["Milk (in place of water)", "60–70%"],
  ].map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${esc(v)}</td></tr>`).join("");
  const gfRef = [
    ["Gluten-free flour blend (all flours + starches)", "100% (the reference)"],
    ["Psyllium husk, whole", "5–7%"],
    ["Psyllium husk powder", "4.5–6% (85–90% of the husk amount)"],
    ["Water", "100–135%"],
    ["Salt", "1.8–2.2%"],
    ["Instant dry yeast", "0.5–1.5%"],
  ].map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${esc(v)}</td></tr>`).join("");
  const body = `
<h1>Baker's Percentage Calculator</h1>
<p class="lead">Work in baker's math like a pro. Set your flour weight, type ingredient weights <em>or</em> percentages, and everything stays in sync. Change the flour to scale the whole recipe.</p>
<div class="calc">
  <div class="field" style="max-width:240px;margin-bottom:12px"><label for="bp-flour">Total flour weight (g) = 100%</label><input id="bp-flour" type="number" inputmode="decimal" value="500" min="0" step="any"></div>
  <table><thead><tr><th>Ingredient</th><th>Weight (g)</th><th>Baker's %</th><th></th></tr></thead><tbody id="bp-rows"></tbody></table>
  <button id="bp-add" type="button" class="btn" style="margin-top:4px">+ Add ingredient</button>
  <div class="result"><div class="big" id="bp-total">—</div><div class="sub" id="bp-hyd">—</div></div>
</div>
<p class="note">Edit any weight to see its percentage, or any percentage to get the weight. Adjust the flour weight to scale the entire formula up or down — the percentages (and so the dough's character) stay identical.</p>
<h2>How baker's percentage works</h2>
<p>Baker's percentage is the standard way bakers write and scale formulas. Every ingredient is measured as a percentage of the <strong>total flour weight</strong>, which is fixed at 100%. The formula is simple:</p>
<p class="note" style="border-left-color:var(--accent)"><strong>Ingredient % = (ingredient weight ÷ total flour weight) × 100</strong></p>
<p>So a dough with 1000 g flour and 650 g water is at 65% hydration, whether you bake one loaf or fifty. To scale, you only change the flour weight — every other ingredient follows from its percentage. This is why professional recipes are written in percentages, not cups.</p>
<h2>Typical baker's percentages</h2>
<table><thead><tr><th>Ingredient</th><th>Typical baker's %</th></tr></thead><tbody>${ref}</tbody></table>
<p class="note">Ranges are typical starting points for common breads — adjust to your flour, climate and the crumb you want. Salt is almost always near 2% of the flour; hydration is the main lever for crumb structure.</p>
<h2>Baker's percentage in gluten-free bread (psyllium husk)</h2>
<p>Baker's math works exactly the same in gluten-free baking, with one convention to know: the <strong>100% is the whole gluten-free flour blend</strong> — every flour <em>and</em> every starch in the recipe added together. A loaf built on 130 g buckwheat flour, 100 g potato starch and 90 g brown rice flour has a 320 g flour reference; the tapioca or potato starch is not a separate ingredient percentage, it is part of the flour. Psyllium husk, water, salt and yeast are then expressed on top of that 100%, just like in a wheat formula.</p>
<p>So to figure out the baker's percentage of psyllium husk in a gluten-free bread, divide the psyllium weight by the total blend weight: 20 g of psyllium in the 320 g blend above is 20 ÷ 320 × 100 ≈ <strong>6.3%</strong>. That is a typical amount — published guidance clusters at <strong>5–7% whole psyllium husk</strong> (The Loopy Whisk's stated rule; Gluten Free Alchemist puts most of her loaves at 5.5–6%, and working the numbers from Aran Goyoaga's and other published artisan gluten-free recipes lands at 5–6.5%). Using the finer <strong>psyllium husk powder</strong>, reduce to 85–90% of the whole-husk weight — the powder binds more water per gram.</p>
<p>Psyllium is what makes a kneadable gluten-free dough possible: its soluble fiber binds many times its weight in water into a sticky, elastic gel that stands in for the gluten network, so the dough can hold gas, be shaped, and rise. That extra absorption is also why gluten-free hydration numbers look wild — <strong>100–135% water</strong> is the normal range for psyllium-based loaves, versus roughly 60–85% for wheat bread. One honesty note: some commercial blends, like King Arthur's gluten-free bread and pizza flours, already contain psyllium and xanthan inside the blend — recipes written for them add no separate psyllium, and adding your own on top would double the binder.</p>
<table><thead><tr><th>Gluten-free ingredient</th><th>Typical baker's %</th></tr></thead><tbody>${gfRef}</tbody></table>
<p class="note">Computed from published gluten-free formulas (The Loopy Whisk, Gluten Free Alchemist, Aran Goyoaga, King Arthur's gluten-free artisan loaves). Method varies honestly between experts: some pre-mix the psyllium and water into a gel before adding it, others whisk the dry psyllium straight into the flour — both approaches have published, well-tested results.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
<p style="margin-top:16px">Making pizza? The <a href="/pizza-dough-calculator/">pizza dough calculator</a> applies baker's math to a target number of dough balls. Baking sourdough? The <a href="/sourdough-hydration-calculator/">sourdough hydration calculator</a> counts the flour and water in your starter. Weighing flour from cups? Use the <a href="/cups-to-grams/all-purpose-flour/">flour cups-to-grams converter</a>.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg }) };
}

function yeastPage() {
  const title = "Yeast Converter — Active Dry, Instant & Fresh Yeast | ExactCup";
  const description = "Free yeast converter: swap active dry, instant (rapid-rise) and fresh (cake) yeast by weight. 1 packet = 7 g = 2¼ tsp. Get grams, teaspoons and packets instantly.";
  const canonical = "/yeast-converter/";
  const faq = [
    ["How much instant yeast equals active dry yeast?", "Instant yeast is a little more active than active dry, so by weight you use about 20–25% less: roughly 0.8 g of instant for every 1 g of active dry (and 1.25 g of active dry for every 1 g of instant). For everyday home baking, King Arthur and the major US brands say you can also just swap them 1:1 — with active dry, add about 15 minutes to the rise time. Use the strength-based amount when a precise or commercial formula matters."],
    ["How do I convert fresh yeast to dry yeast?", "Fresh (cake) yeast is much weaker by weight because it contains water. Multiply the fresh amount by about 0.4 to get active dry yeast, or by about 0.33 (one third) to get instant yeast. So 30 g of fresh yeast ≈ 12 g active dry ≈ 10 g instant."],
    ["How much yeast is in a packet?", "A standard packet (sachet) of dry yeast is 7 g, which is ¼ oz or about 2¼ teaspoons. This is true for both active dry and instant yeast. One 7 g packet is enough to raise up to about 4 cups (500 g) of flour."],
    ["Can I substitute active dry for instant yeast 1:1?", "Yes — for normal recipes King Arthur Baking, Red Star and Fleischmann's all say active dry and instant are interchangeable one-for-one by weight or volume. The only differences: active dry rises a little slower (add ~15 min), and in a bread machine you should reduce instant by 25% when it replaces active dry. This converter uses the strength-equivalent amounts (instant ≈ 25% stronger) for when you want the exact leavening power matched."],
    ["Do I need to dissolve active dry yeast first?", "Modern active dry yeast can usually be mixed straight into the flour, but many bakers still 'bloom' it in warm (about 105–110°F / 40–43°C) liquid for 5–10 minutes to check it's alive. Instant yeast never needs blooming — add it directly to the dry ingredients. Fresh yeast is crumbled into the dough or dissolved in a little warm liquid."],
  ];
  const jsonLd = [faqLd(faq), appLd("Yeast Converter", description, canonical)];
  // Strength-equivalent weight ratio: instant 1 : active dry 1.25 : fresh 3.
  const factors = [
    ["Active dry → Instant", "0.8"],
    ["Instant → Active dry", "1.25"],
    ["Fresh → Active dry", "0.42"],
    ["Fresh → Instant", "0.33"],
    ["Active dry → Fresh", "2.4"],
    ["Instant → Fresh", "3.0"],
  ].map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">× ${v}</td></tr>`).join("");
  const body = `
<h1>Yeast Converter</h1>
<p class="lead">Swap between <strong>active dry</strong>, <strong>instant</strong> (rapid-rise) and <strong>fresh</strong> (cake) yeast. Enter how much you have and which type — get the equivalent of all three in grams, teaspoons and packets.</p>
<div class="calc">
  <div class="row">
    <div class="field"><label for="y-amount">Amount</label><input id="y-amount" type="number" inputmode="decimal" value="7" min="0" step="any"></div>
    <div class="field" style="max-width:150px"><label for="y-unit">Unit</label><select id="y-unit"><option value="g">grams</option><option value="tsp">teaspoons</option><option value="packet">packets (7 g)</option></select></div>
    <div class="field"><label for="y-from">Yeast you have</label><select id="y-from"><option value="active">Active dry yeast</option><option value="instant">Instant / rapid-rise</option><option value="fresh">Fresh / cake yeast</option></select></div>
  </div>
  <table style="margin-top:14px"><thead><tr><th>Equivalent in…</th><th>Grams</th><th>Teaspoons</th><th>Packets</th></tr></thead><tbody>
    <tr><td>Active dry</td><td class="num" id="y-active-g">—</td><td class="num" id="y-active-t">—</td><td class="num" id="y-active-p">—</td></tr>
    <tr><td>Instant / rapid-rise</td><td class="num" id="y-instant-g">—</td><td class="num" id="y-instant-t">—</td><td class="num" id="y-instant-p">—</td></tr>
    <tr><td>Fresh / cake</td><td class="num" id="y-fresh-g">—</td><td class="num" id="y-fresh-t">—</td><td class="num" id="y-fresh-p">—</td></tr>
  </tbody></table>
</div>
<p class="note">Teaspoons and packets are for the dry yeasts (≈ 3.1 g per tsp, 7 g per packet). Fresh yeast is soft and crumbly, so it is best measured by weight.</p>
<h2>Yeast conversion factors (by weight)</h2>
<p>These factors match the <em>leavening power</em> of each yeast — instant yeast is roughly 25% more active than active dry, and fresh yeast is about a third as strong as instant because of its water content.</p>
<table><thead><tr><th>Convert</th><th>Multiply by</th></tr></thead><tbody>${factors}</tbody></table>
<p class="note">Based on the standard strength ratio instant : active dry : fresh ≈ 1 : 1.25 : 3 by weight.</p>
<h2>The simple 1:1 rule for active dry and instant</h2>
<p>For everyday baking you don't have to be exact. King Arthur Baking, Red Star and Fleischmann's all say <strong>active dry and instant yeast can be swapped one-for-one</strong> by weight or volume. The practical differences:</p>
<ul>
<li><strong>Active dry rises a little slower</strong> — add about 15 minutes to each rise.</li>
<li><strong>In a bread machine</strong>, reduce instant yeast by 25% when it replaces active dry.</li>
<li><strong>Instant goes in dry</strong>; active dry can be bloomed in warm liquid first (optional with modern yeast).</li>
</ul>
<p>The calculator above uses the strength-equivalent amounts (instant ≈ 25% less than active dry) for when you want the leavening power matched precisely — for example in a tested, weighed formula.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
<p style="margin-top:16px">Building a bread formula? Use the <a href="/bakers-percentage-calculator/">baker's percentage calculator</a> or the <a href="/pizza-dough-calculator/">pizza dough calculator</a>. Need to weigh flour from cups? Try the <a href="/cups-to-grams/all-purpose-flour/">flour cups-to-grams converter</a>.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "yeast" } }) };
}

function sourdoughPage() {
  const title = "Sourdough Hydration Calculator (Starter Included) | ExactCup";
  const description = "Free sourdough hydration calculator. Enter flour, water and starter — at any starter hydration — to get your dough's true hydration, salt % and prefermented flour, plus the exact water for a target hydration.";
  const canonical = "/sourdough-hydration-calculator/";
  const faq = [
    ["What is sourdough hydration?", "Hydration is the total water in your dough expressed as a baker's percentage of the total flour — including the water and flour inside your starter. A dough with 550 g total flour and 400 g total water is at 400 ÷ 550 × 100 ≈ 73% hydration. Higher hydration gives a more open, moist crumb; lower hydration gives a tighter crumb and easier-to-handle dough."],
    ["Do you include the starter when calculating hydration?", "Yes — for the true (overall) hydration you must count the starter's contents. A starter kept at 100% hydration is half flour and half water by weight, so adding 100 g of it adds 50 g flour and 50 g water to the dough. Ignoring the starter overstates your hydration on stiff starters and understates the flour in the recipe. This calculator splits the starter for you at whatever hydration you keep it."],
    ["What hydration should sourdough bread be?", "Most sourdough loaves are between 65% and 80% hydration. Around 65–70% is the easiest to shape and a good starting point; 75%+ gives a more open crumb but a stickier, harder-to-handle dough. Whole-wheat and rye flours absorb more water, so doughs with them are usually pushed a few points higher."],
    ["What hydration is a sourdough starter?", "Most bakers keep their starter at 100% hydration — fed with equal weights of flour and water. Stiff starters (like an Italian lievito madre) are kept around 50–65% hydration, and some bakers use liquid starters above 100%. Enter whatever ratio you feed yours; the math adjusts automatically."],
    ["How much salt goes in sourdough bread?", "Salt is typically about 2% of the total flour weight (a range of 1.8–2.2% is common) — that's 10–11 g for a dough with 550 g of total flour. The calculator shows your salt percentage against total flour, including the flour in the starter."],
    ["How do I change my dough's hydration?", "Enter your target percentage in the calculator and it returns exactly how much water the recipe needs: required water = target % × total flour − water already in the starter. Add the difference (or hold back water during mixing if you're above target)."],
    ["How much sourdough starter should I use?", "A typical loaf uses starter at 10–20% of the flour weight — 100 g starter per 500 g flour (20%) is the most common default, and anything up to about a third is normal (King Arthur's no-knead loaf runs above 30%). The amount is a throttle: more starter ferments the dough faster, less slows it down — bakers often drop from 20% to 10% to stretch bulk fermentation overnight or to cope with a hot kitchen. The prefermented-flour line in the calculator is the precise version of this number."],
    ["Why is my sourdough so sticky and wet?", "Usually the hydration is too high for your flour: all-purpose and softer European-style flours absorb less water than 12–14%-protein bread flour, and doughs without much whole wheat or rye feel wetter at the same percentage. Two other culprits: gluten that isn't developed yet (build strength with stretch-and-folds rather than adding flour) and over-fermentation, which breaks the gluten down and leaves the dough slack and gluey. First fix: drop hydration about 5 points — roughly 25 g less water per 500 g flour — and handle the dough with wet hands instead of dusting in extra flour."],
    ["Can I still bake sourdough that's too sticky to shape?", "Yes. A wetter-than-planned dough usually bakes into a flatter loaf that's still perfectly good to eat. Give it structure by baking it in a loaf pan, or spread it into an oiled pan and bake it as focaccia. An overnight rest in the fridge (cold retard) also firms up wet dough noticeably and makes it easier to score."],
    ["What is a typical sourdough ratio?", "In baker's percentages: 100% flour, 70–75% water, about 20% starter and 2% salt. Tartine's famous country bread is literally this ratio — 1,000 g flour, 750 g water, 200 g leaven, 20 g salt. The ratio table above scales it to your batch size."],
    ["What do feeding ratios like 1:1:1 or 1:5:5 mean?", "That's starter : flour : water by weight for feeding a starter — 1:1:1 means equal parts of all three. Bigger ratios give the microbes more food per gram of starter, so the starter takes longer to peak: roughly 4–6 hours at 1:1:1 in a warm kitchen versus 10–12 hours at 1:4:4 — which is why a 1:4:4 feed before bed is ready to bake with the next morning."],
    ["Can I make pizza dough with my sourdough starter?", "Yes — sourdough pizza dough is typically drier than bread dough. King Arthur's sourdough pizza crust works out to about 62% hydration versus roughly 72% for their basic loaf, and pizza doughs in general sit around 55–70%. Enter your starter and flour here to check the hydration, then size and scale the dough balls with our pizza dough calculator."],
  ];
  const jsonLd = [faqLd(faq), appLd("Sourdough Hydration Calculator", description, canonical)];
  const f = (lab, id, val, max) => `<div class="field"${max ? ` style="max-width:${max}px"` : ""}><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" value="${val}" min="0" step="any"></div>`;
  const r = (lab, id) => `<tr><td>${lab}</td><td class="num" id="${id}">—</td></tr>`;
  const ref = [
    ["65–68%", "Beginner-friendly: easy to shape, tighter crumb, good sandwich loaves"],
    ["70–75%", "The classic range for everyday artisan sourdough"],
    ["76–82%", "Open, airy crumb; sticky dough that needs confident handling"],
    ["83%+", "Ciabatta-style very wet doughs; usually pan-baked or heavily floured"],
  ].map(([k, v]) => `<tr><td class="num">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
  const body = `
<h1>Sourdough Hydration Calculator</h1>
<p class="lead">Get your dough's <strong>true hydration</strong> — with the flour and water inside your starter counted correctly, at any starter hydration. Plus salt percentage, prefermented flour and the exact water for a target hydration.</p>
<div class="calc">
  <div class="row">${f("Flour (g)", "sd-flour", 500)}${f("Water (g)", "sd-water", 350)}${f("Starter (g)", "sd-starter", 100)}</div>
  <div class="row" style="margin-top:10px">${f("Starter hydration (%)", "sd-shyd", 100)}${f("Salt (g)", "sd-salt", 10)}</div>
  <div class="result"><div class="big" id="sd-hyd">—</div><div class="sub">true hydration, starter included</div></div>
  <table style="margin-top:14px"><tbody>
  ${r("Total flour (incl. starter)", "sd-tf")}${r("Total water (incl. starter)", "sd-tw")}${r("Salt (baker's %)", "sd-saltpct")}${r("Prefermented flour", "sd-pff")}${r("Total dough weight", "sd-dough")}
  </tbody></table>
  <div class="row" style="margin-top:14px">${f("Target hydration (%)", "sd-target", 75, 200)}<div class="field"><label>Water needed for target</label><div class="num" id="sd-target-out" style="padding:10px 2px;font-weight:600">—</div></div></div>
</div>
<p class="note">A 100%-hydration starter is equal parts flour and water by weight, so 100 g of it contributes 50 g flour + 50 g water. Keep a stiff starter? Set its hydration and the split adjusts.</p>
<h2>How sourdough hydration is calculated</h2>
<p>Hydration is a baker's percentage: <strong>total water ÷ total flour × 100</strong>. The catch with sourdough is that your starter is part flour, part water. For a starter of weight S at hydration h:</p>
<p class="note" style="border-left-color:var(--accent)"><strong>starter flour = S ÷ (1 + h/100) &nbsp;·&nbsp; starter water = S − starter flour</strong></p>
<p>So 500 g flour + 350 g water + 100 g of 100%-hydration starter is really 550 g flour and 400 g water — <strong>72.7% hydration</strong>, not the 70% you'd get by ignoring the starter. The difference grows with bigger starter amounts and stiff starters.</p>
<h2>What hydration should you aim for?</h2>
<table><thead><tr><th>Hydration</th><th>What you get</th></tr></thead><tbody>${ref}</tbody></table>
<p class="note">Flour matters as much as the number: whole-wheat and rye absorb more water, and strong bread flour handles high hydration far better than all-purpose. When trying a new flour, change hydration a few points at a time.</p>
<h2>Typical sourdough ratios</h2>
<p>A basic sourdough loaf, in baker's percentages (each ingredient as a share of the flour weight):</p>
<table><thead><tr><th>Ingredient</th><th>Baker's %</th><th>For 500 g flour</th></tr></thead><tbody>
<tr><td>Flour</td><td class="num">100%</td><td class="num">500 g</td></tr>
<tr><td>Water</td><td class="num">70–75%</td><td class="num">350–375 g</td></tr>
<tr><td>Starter (100% hydration)</td><td class="num">15–25% (20% typical)</td><td class="num">75–125 g</td></tr>
<tr><td>Salt</td><td class="num">1.8–2.2%</td><td class="num">9–11 g</td></tr>
</tbody></table>
<p class="note">Tartine's country bread is the textbook example: 1,000 g flour, 750 g water, 200 g leaven, 20 g salt = exactly 100 / 75 / 20 / 2. Feeding ratios like 1:1:1 or 1:4:4 are a different thing — that's starter : flour : water for feeding the starter itself, and bigger ratios simply take longer to peak.</p>
<p>Making pizza instead of bread? Sourdough pizza dough runs drier — King Arthur's sourdough crust comes out around 62% hydration. Check your dough here, then size the dough balls with the <a href="/pizza-dough-calculator/">pizza dough calculator</a>.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
<p style="margin-top:16px">Building the full formula? Use the <a href="/bakers-percentage-calculator/">baker's percentage calculator</a>. Swapping yeast types in a hybrid dough? See the <a href="/yeast-converter/">yeast converter</a>. Weighing flour from cups? Try the <a href="/cups-to-grams/bread-flour/">bread flour</a> or <a href="/cups-to-grams/whole-wheat-flour/">whole wheat flour</a> converters.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "sourdough" } }) };
}

// llms.txt — structured index + verified data for AI assistants (ChatGPT, Perplexity, Claude…)
function llmsTxt() {
  const b = SITE.baseUrl;
  const tools = [
    ["Cups to Grams Converter", "/cups-to-grams/", "Convert any ingredient between cups, tablespoons, teaspoons and grams"],
    ["Grams to Cups Converter", "/grams-to-cups/", "Reverse direction: enter a weight in grams and get cups, by ingredient"],
    ["Tablespoons to Grams Converter", "/tablespoons-to-grams/", "How many grams in a tablespoon of any ingredient (1 tbsp = 1/16 cup); tbsp/tsp/cups to grams"],
    ["Tablespoons in a Cup", "/tablespoons-in-a-cup/", "How many tablespoons/teaspoons in a cup and every fraction: 1 cup = 16 tbsp = 48 tsp; 1/3 cup = 5 tbsp + 1 tsp; 2/3 cup = 10 tbsp + 2 tsp; 1 tbsp = 3 tsp"],
    ["Teaspoons in a Tablespoon", "/teaspoons-in-a-tablespoon/", "How many teaspoons in a tablespoon: 1 US tbsp = 3 tsp = 14.79 mL (1/2 tbsp = 1 1/2 tsp; 2 tbsp = 6 tsp = 1 fl oz); Australian tbsp = 20 mL = 4 tsp; dessertspoon = 10 mL = 2 tsp; dash = 1/8 tsp, pinch = 1/16 tsp"],
    ["Ounces in a Cup", "/ounces-in-a-cup/", "How many ounces in a cup: 1 US cup = 8 fl oz (1/2 cup = 4 fl oz, 3/4 cup = 6 fl oz); fluid oz (volume) vs dry oz (weight) explained — 1 cup of flour weighs 4.2 oz, sugar 7.1 oz, butter 8 oz"],
    ["Cups in a Quart", "/cups-in-a-quart/", "How many cups in a quart, pint and gallon: 1 quart = 4 cups = 2 pints = 32 fl oz = 0.946 L; 1 gallon = 4 quarts = 16 cups = 128 fl oz; 1 pint = 2 cups; half gallon = 8 cups"],
    ["Recipe Scaler", "/recipe-scaler/", "Scale a recipe up or down by servings"],
    ["Recipe Halving Chart", "/recipe-halving-chart/", "Half and one-third of any kitchen measurement (half of 3/4 cup = 6 tbsp; half of 1/3 cup = 2 tbsp + 2 tsp)"],
    ["Printable Kitchen Conversion Chart", "/kitchen-conversion-chart/", "One-page printable chart: cups to tbsp/fl oz/mL (1 cup = 16 tbsp = 8 fl oz = 237 mL), everyday ingredient weights in grams per cup, oven temperatures °F/°C/gas mark, butter sticks and ounces to grams"],
    ["Oven Temperature Converter", "/oven-temperature-converter/", "Fahrenheit to Celsius to gas mark"],
    ["Air Fryer Conversion Calculator", "/air-fryer-conversion-calculator/", "Convert oven recipes to air fryer time and temperature"],
    ["Pan Size Converter", "/pan-size-converter/", "Adjust a recipe when swapping cake pan sizes (by area)"],
    ["Volume Converter", "/volume-converter/", "Cups, tablespoons, teaspoons, fluid ounces, millilitres, litres"],
    ["Cups to mL Converter", "/cups-to-ml/", "1 US cup = 236.59 mL (240 mL on labels); metric cup (UK/AU/NZ) = 250 mL; imperial cup = 284 mL; Japanese cup = 200 mL; chart for every fraction"],
    ["Portion Calculator", "/portion-calculator/", "How much rice, pasta, potatoes etc. per person"],
    ["Dry to Cooked Converter", "/dry-to-cooked/", "Dry-to-cooked yields for rice, pasta, quinoa, oats and grains, both directions: 1 cup dry white rice (185 g) = about 3 cups / 520 g cooked (weight factor x2.8 per USDA, volume triples but weight does not); brown rice x2.98 (1 cup dry = about 2 3/4 cups cooked); quinoa x3.06 (about 3 cups); 2 oz (57 g) dry pasta = about 1 cup cooked long shapes (spaghetti) but 1 1/4 cups short shapes (penne/rotini); rolled oats x5.4 (1 cup dry oats = about 2 cups oatmeal); couscous 1 cup dry = 2-2 1/2 cups by the package method; pearl barley 1 cup = 3 1/2-4 cups; bulgur x4.1 (about 3 cups); wild rice 3-4 cups; reverse: 2 cups cooked rice needs about 115 g dry"],
    ["Pizza Dough Calculator", "/pizza-dough-calculator/", "Flour, water, salt and yeast by baker's percentage"],
    ["Baker's Percentage Calculator", "/bakers-percentage-calculator/", "Build and scale any bread formula using baker's math (every ingredient as a percentage of flour)"],
    ["Yeast Converter", "/yeast-converter/", "Convert between active dry, instant and fresh yeast by weight (ratio 1 : 1.25 : 3); 1 packet = 7 g = 2¼ tsp"],
    ["Sourdough Hydration Calculator", "/sourdough-hydration-calculator/", "True dough hydration including the flour and water in the starter (any starter hydration), salt %, prefermented flour and target-hydration water"],
    ["Butter Converter", "/butter-converter/", "Sticks, cups, tablespoons, grams and ounces"],
    ["Butter to Oil Conversion", "/butter-to-oil/", "Substitute oil for butter at the standard 3:4 volume ratio: 1 cup butter = 3/4 cup oil; 1 stick = 6 tbsp oil; by weight 100 g butter ≈ 71 g oil (butter is ~81% fat + 16% water, USDA); melted-butter recipes are often swapped 1:1; not suited to cookies, creamed cakes, pie crust or laminated pastry"],
    ["Sugar to Honey Conversion", "/sugar-to-honey/", "Substitute honey for granulated sugar: 1 cup sugar = 3/4 cup honey (King Arthur rule; the National Honey Board and Clemson Extension suggest up to 1/2), then per cup of honey used cut other liquid by 1/4 cup, add 1/2 tsp baking soda (honey pH ~3.9) and bake 25 F lower (avoid recipes over 350 F); by weight 100 g sugar ≈ 128 g honey (honey is 340 g/cup vs sugar 200 g/cup); reverse: 1 cup honey = 1 1/4 cups sugar + 1/4 cup liquid"],
    ["Cake Flour Substitute", "/cake-flour-substitute/", "Make cake flour from all-purpose flour: per 1 cup cake flour use 14 tbsp AP flour (3/4 cup + 2 tbsp = 7/8 cup = 1 cup minus 2 tbsp, 105 g) + 2 tbsp cornstarch (14 g), whisked — the King Arthur / America's Test Kitchen / Bob's Red Mill rule; by weight 100 g cake flour = 88 g AP flour + 12 g cornstarch; no-cornstarch variant (Virginia Extension): 1 cup minus 2 tbsp AP flour; reverse (cake flour in an AP recipe): 1 cup + 2 tbsp cake flour per cup AP (Swans Down / Utah State); protein: bleached cake flour ~6-9% vs AP ~10-12%; self-rising flour is NOT a cake flour substitute (contains baking powder + salt)"],
    ["Cornstarch to Flour Thickener", "/cornstarch-to-flour/", "Substitute cornstarch and flour for thickening sauces, gravies and soups: 1 tbsp cornstarch = 2 tbsp all-purpose flour (cornstarch has twice the thickening power — Argo / Bob's Red Mill / America's Test Kitchen / Utah State Extension; 1 tbsp flour = 1 1/2 tsp cornstarch is the same rule in teaspoons); dosing per 1 cup liquid: 1 tbsp cornstarch or 2 tbsp flour for a medium sauce (Illinois Extension); by weight 100 g flour ≈ 47 g cornstarch (7 vs 7.5 g/tbsp); cornstarch = cold slurry + boil 1 minute (Argo), flour = roux ~4 min + ~15 min simmer (King Arthur); acid weakens cornstarch, both weep after freezing (boil + whisk to fix, per ATK); ratio does NOT hold for pie fillings (fruit-dependent, King Arthur); per 1 tbsp cornstarch: arrowroot 1-1.5 tbsp, potato starch 1-1.5 tbsp, tapioca starch 1 tbsp, granular tapioca 2 tbsp"],
    ["Baking Powder Substitute", "/baking-powder-substitute/", "Substitute between baking powder and baking soda: 1 tsp baking powder = 1/4 tsp baking soda + 1/2 tsp cream of tartar (King Arthur / America's Test Kitchen / Arm & Hammer / McCormick; older USDA-lineage figure: 5/8 tsp cream of tartar per Utah State + Texas A&M extensions); liquid-acid variants per 1/4 tsp soda: lemon juice or white vinegar 1/2-1 tsp (sources disagree), or 1/2 cup buttermilk/yogurt/sour cream (ATK), or 1/4-1/2 cup molasses (Utah State); reverse: 1 tsp baking soda = 3 tsp (1 tbsp) baking powder — 3x rule unanimous, no primary source says 4x; homemade baking powder = 1 part soda : 2 parts cream of tartar (+1 part cornstarch to store), single-acting so bake immediately; rules of thumb per cup flour: 1/4 tsp soda or 1-1 1/4 tsp powder; 1/2 tsp soda neutralizes 1 cup buttermilk; weights per tsp disputed: KA powder 4 g / soda 6 g, USDA both 4.6 g, manufacturer labels 4.8 g; freshness tests: soda + vinegar should fizz, powder + hot water should fizz"],
  ];
  let out = `# ExactCup\n\n> Free, accurate cooking and baking measurement converters. Cups-to-grams for ${DATA.ingredients.length}+ ingredients (every weight verified against authoritative sources such as the King Arthur Baking ingredient weight chart and USDA), plus recipe scaler, oven temperature, air fryer, pan size, volume, portion and pizza dough calculators. All tools are free, client-side and need no sign-up. Note: 1 US cup = 236.588 ml; weights differ by ingredient because densities differ.\n\n`;
  out += `## Tools\n`;
  tools.forEach((t) => { out += `- [${t[0]}](${b}${t[1]}): ${t[2]}\n`; });
  out += `\n## Ingredient cups-to-grams reference (weight of 1 US cup)\n`;
  DATA.ingredients.forEach((i) => { out += `- [${i.name}](${b}/cups-to-grams/${i.slug}/): 1 cup = ${g2(i.gramsPerCup)} g\n`; });
  out += `\n## Conversion charts by category\n`;
  Object.keys(DATA.categories).forEach((k) => { out += `- [${catName(k)} conversion chart](${b}/${k}-conversion-chart/)\n`; });
  out += `\n## Open data\n- [Ingredient Density Dataset](${b}/ingredient-density-data/): grams per US cup for ${DATA.ingredients.length}+ ingredients, CC BY 4.0, downloadable as [CSV](${b}/ingredient-density-data/ingredient-density.csv) or [JSON](${b}/ingredient-density-data/ingredient-density.json). Please cite ExactCup with a link when using the data.\n`;
  out += `- [Ingredient Density API](${b}/api/): free JSON API over the same data — no key, no sign-up, CORS enabled. \`${b}${API_BASE}ingredients.json\` for all ${DATA.ingredients.length} ingredients, \`${b}${API_BASE}ingredients/{slug}.json\` for one (with precomputed cups→grams, tablespoons→grams and grams→cups tables), \`${b}${API_BASE}units.json\` for volume units in mL. CC BY 4.0 with attribution.\n`;
  return out;
}

// Standalone embeddable widget (iframe target for food blogs). Minimal chrome, own HTML (not layout()).
function embedWidgetPage() {
  const canonical = "/embed/cups-to-grams/";
  const opts = DATA.ingredients.map((i) => `<option value="${i.slug}">${esc(i.name)}</option>`).join("");
  const cfg = { type: "master", ingredients: DATA.ingredients.map((i) => ({ slug: i.slug, gramsPerCup: i.gramsPerCup })) };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Cups to Grams Converter — ExactCup</title><style>${EMBED_CSS}</style></head><body>
<div class="ec-w">
<label for="ingredient">Ingredient</label><select id="ingredient">${opts}</select>
<div class="ec-row" style="margin-top:2px">
<div><label for="amount">Amount</label><input id="amount" type="number" inputmode="decimal" value="1" min="0" step="any"></div>
<div><label for="unit">Unit</label><select id="unit"><option value="cups">cups</option><option value="tbsp">tbsp</option><option value="tsp">tsp</option></select></div>
<div><label for="grams">Grams</label><input id="grams" type="number" inputmode="decimal" step="any"></div>
</div>
<div class="ec-out"><div class="ec-big" id="out-grams">—</div><div class="ec-sub" id="out-oz">—</div></div>
<div class="ec-attr"><a href="${SITE.baseUrl}/cups-to-grams/" target="_blank" rel="noopener">Cups to Grams Converter</a> by ExactCup</div>
</div>
<script>(function(){var m=location.search.match(/[?&]ingredient=([a-z0-9-]+)/);if(m){var s=document.getElementById("ingredient");if(s&&s.querySelector('option[value="'+m[1]+'"]'))s.value=m[1];}})();</script>
<script type="application/json" id="cfg">${JSON.stringify(cfg)}</script><script src="/assets/app.js" defer></script>
</body></html>`;
  return { canonical, html };
}

// Shared minimal CSS for the bare embed widgets (iframe targets).
const EMBED_CSS = `*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1f2328;background:#fff;padding:12px}
.ec-w{max-width:400px;margin:0 auto}label{display:block;font-size:12px;color:#5b6470;font-weight:600;margin:8px 0 3px}
select,input{width:100%;font-size:16px;padding:9px 10px;border:1px solid #e6e8eb;border-radius:8px;font-family:inherit}
.ec-row{display:flex;gap:8px}.ec-row>div{flex:1}
.ec-out{background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px;text-align:center;margin-top:10px}
.ec-big{font-size:26px;font-weight:800;color:#c2410c}.ec-sub{color:#5b6470;font-size:14px}
.ec-attr{text-align:center;font-size:12px;color:#5b6470;margin-top:10px}.ec-attr a{color:#c2410c;text-decoration:none;font-weight:600}`;

// Grams-first variant (grams -> cups/tbsp/tsp), for blogs whose posts run in that
// direction. Same rmaster logic as /grams-to-cups/, same ?ingredient= preset.
function embedGramsWidgetPage() {
  const canonical = "/embed/grams-to-cups/";
  const opts = DATA.ingredients.map((i) => `<option value="${i.slug}">${esc(i.name)}</option>`).join("");
  const cfg = { type: "rmaster", ingredients: DATA.ingredients.map((i) => ({ slug: i.slug, gramsPerCup: i.gramsPerCup })) };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Grams to Cups Converter — ExactCup</title><style>${EMBED_CSS}</style></head><body>
<div class="ec-w">
<label for="ingredient">Ingredient</label><select id="ingredient">${opts}</select>
<div class="ec-row" style="margin-top:2px">
<div><label for="grams">Grams</label><input id="grams" type="number" inputmode="decimal" value="100" min="0" step="any"></div>
<div><label for="unit">Convert to</label><select id="unit"><option value="cups">cups</option><option value="tbsp">tbsp</option><option value="tsp">tsp</option></select></div>
</div>
<div class="ec-out"><div class="ec-big" id="out-amount">—</div><div class="ec-sub" id="out-oz">—</div></div>
<div class="ec-attr"><a href="${SITE.baseUrl}/grams-to-cups/" target="_blank" rel="noopener">Grams to Cups Converter</a> by ExactCup</div>
</div>
<script>(function(){var m=location.search.match(/[?&]ingredient=([a-z0-9-]+)/);if(m){var s=document.getElementById("ingredient");if(s&&s.querySelector('option[value="'+m[1]+'"]'))s.value=m[1];}})();</script>
<script type="application/json" id="cfg">${JSON.stringify(cfg)}</script><script src="/assets/app.js" defer></script>
</body></html>`;
  return { canonical, html };
}

// Butter variant: sticks/cups/tbsp/tsp/grams/oz, all bidirectional (initButter).
function embedButterWidgetPage() {
  const canonical = "/embed/butter-converter/";
  const cfg = { type: "butter" };
  const f = (lab, id, val) => `<div><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" step="any" min="0"${val != null ? ` value="${val}"` : ""}></div>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Butter Converter — Sticks, Cups & Grams — ExactCup</title><style>${EMBED_CSS}</style></head><body>
<div class="ec-w">
<div class="ec-row">${f("Sticks", "sticks", 1)}${f("Cups", "cups")}${f("Tbsp", "tbsp")}</div>
<div class="ec-row">${f("Grams", "grams")}${f("Ounces", "oz")}${f("Tsp", "tsp")}</div>
<div class="ec-attr"><a href="${SITE.baseUrl}/butter-converter/" target="_blank" rel="noopener">Butter Converter — Sticks, Cups &amp; Grams</a> by ExactCup</div>
</div>
<script type="application/json" id="cfg">${JSON.stringify(cfg)}</script><script src="/assets/app.js" defer></script>
<script>window.addEventListener("load",function(){var s=document.getElementById("sticks");if(s)s.dispatchEvent(new Event("input"));});</script>
</body></html>`;
  return { canonical, html };
}

function embedInfoPage() {
  const canonical = "/embed/";
  const title = "Free Embeddable Converter Widgets for Your Recipe Blog — Cups to Grams, Grams to Cups, Butter | ExactCup";
  const description = "Add a free, accurate converter to your recipe blog: cups-to-grams, grams-to-cups, or a butter sticks/cups/grams widget. Copy-paste one line of HTML — no sign-up, no cost. Just keep the attribution link.";
  const iframeSnip = (src, height, titleAttr) => `<iframe src="${src}" width="100%" height="${height}" style="border:1px solid #e6e8eb;border-radius:12px;max-width:440px" title="${titleAttr}" loading="lazy"></iframe>`;
  const c2gSnippet = `${iframeSnip(`${SITE.baseUrl}/embed/cups-to-grams/`, 380, "Cups to Grams Converter")}
<p style="font-size:13px"><a href="${SITE.baseUrl}/cups-to-grams/">Cups to Grams Converter</a> by ExactCup</p>`;
  const g2cSnippet = `${iframeSnip(`${SITE.baseUrl}/embed/grams-to-cups/`, 380, "Grams to Cups Converter")}
<p style="font-size:13px"><a href="${SITE.baseUrl}/grams-to-cups/">Grams to Cups Converter</a> by ExactCup</p>`;
  const butterSnippet = `${iframeSnip(`${SITE.baseUrl}/embed/butter-converter/`, 260, "Butter Converter — Sticks, Cups and Grams")}
<p style="font-size:13px"><a href="${SITE.baseUrl}/butter-converter/">Butter Converter &mdash; Sticks, Cups &amp; Grams</a> by ExactCup</p>`;
  const ebOpts = DATA.ingredients.map((i) => `<option value="${i.slug}">${esc(i.name)}</option>`).join("");
  const presetPicker = (id) => `
<p style="margin-bottom:4px"><label for="${id}" style="font-size:13px;font-weight:600">Preset ingredient (optional)</label> &mdash; the widget opens on this ingredient; the preview and snippet update automatically. Readers can still switch to any of the ${DATA.ingredients.length}+ ingredients.</p>
<select id="${id}" style="max-width:440px;width:100%"><option value="">None &mdash; general converter</option>${ebOpts}</select>`;
  const body = `
<h1>Free Embeddable Converter Widgets</h1>
<p class="lead">Give your readers an accurate, instant converter right inside your recipe posts. Three widgets, all free, no sign-up &mdash; copy the snippet for the one that fits your post (in WordPress: paste into a <strong>Custom&nbsp;HTML</strong> block). Weights come from ${DATA.ingredients.length}+ ingredient densities verified against authoritative baking references, and widgets update automatically as we add ingredients &mdash; you never touch the code again.</p>

<h2>1. Cups to grams converter</h2>
<p>Volume-first: readers enter cups/tbsp/tsp and get grams. Best for US-style recipe posts.</p>
<iframe id="eb-preview" src="${SITE.baseUrl}/embed/cups-to-grams/" width="100%" height="380" style="border:1px solid var(--line);border-radius:12px;max-width:440px" title="Cups to Grams Converter preview" loading="lazy"></iframe>
${presetPicker("eb-ing")}
<p style="margin-top:12px;margin-bottom:4px"><strong>Copy this snippet:</strong></p>
<textarea readonly id="eb-snippet" rows="6" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:13px" onclick="this.select()">${esc(c2gSnippet)}</textarea>

<h2>2. Grams to cups converter</h2>
<p>Weight-first: readers enter grams and get cups, tablespoons or teaspoons. Best for metric recipes and &ldquo;grams to cups&rdquo; conversion posts.</p>
<iframe id="eb-preview-g" src="${SITE.baseUrl}/embed/grams-to-cups/" width="100%" height="380" style="border:1px solid var(--line);border-radius:12px;max-width:440px" title="Grams to Cups Converter preview" loading="lazy"></iframe>
${presetPicker("eb-ing-g")}
<p style="margin-top:12px;margin-bottom:4px"><strong>Copy this snippet:</strong></p>
<textarea readonly id="eb-snippet-g" rows="6" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:13px" onclick="this.select()">${esc(g2cSnippet)}</textarea>

<h2>3. Butter converter (sticks &#8596; cups &#8596; grams)</h2>
<p>Type in any field &mdash; sticks, cups, tablespoons, teaspoons, grams or ounces &mdash; and the rest fill in. Best for baking posts that call for butter by the stick.</p>
<iframe src="${SITE.baseUrl}/embed/butter-converter/" width="100%" height="260" style="border:1px solid var(--line);border-radius:12px;max-width:440px" title="Butter Converter preview" loading="lazy"></iframe>
<p style="margin-top:12px;margin-bottom:4px"><strong>Copy this snippet:</strong></p>
<textarea readonly rows="6" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:13px" onclick="this.select()">${esc(butterSnippet)}</textarea>

<h2>License</h2>
<p>Free to embed on any site, commercial or personal. The only condition: <strong>keep the &ldquo;by ExactCup&rdquo; attribution link</strong> shown under the widget. That link is how we keep the tools free. Thanks!</p>
<script type="application/json" id="eb-data">${JSON.stringify(DATA.ingredients.map((i) => ({ s: i.slug, n: i.name })))}</script>
<script>(function(){
var el=document.getElementById("eb-data");if(!el)return;
var names={};JSON.parse(el.textContent).forEach(function(i){names[i.s]=i.n;});
var base="${SITE.baseUrl}";
function wire(selId,taId,pvId,path,anchorSuffix,anchorDefault){
var sel=document.getElementById(selId),ta=document.getElementById(taId),pv=document.getElementById(pvId);
if(!sel||!ta)return;
sel.addEventListener("change",function(){
var slug=sel.value;
var src=base+"/embed/"+path+"/"+(slug?"?ingredient="+slug:"");
var href=slug?base+"/cups-to-grams/"+slug+"/":base+"/"+path+"/";
var text=slug?names[slug]+" "+anchorSuffix:anchorDefault;
ta.value='<iframe src="'+src+'" width="100%" height="380" style="border:1px solid #e6e8eb;border-radius:12px;max-width:440px" title="'+anchorDefault+'" loading="lazy"></iframe>\\n<p style="font-size:13px"><a href="'+href+'">'+text+'</a> by ExactCup</p>';
if(pv)pv.src=src;
});
}
wire("eb-ing","eb-snippet","eb-preview","cups-to-grams","cups to grams converter","Cups to Grams Converter");
wire("eb-ing-g","eb-snippet-g","eb-preview-g","grams-to-cups","grams to cups converter","Grams to Cups Converter");
})();</script>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body }) };
}

// Canonical citable home of the ingredient-density data. Serves the CSV/JSON from
// our own domain (written in build()) and carries schema.org/Dataset JSON-LD so it
// surfaces in Google Dataset Search — the page people cite/link when they use the data.
function datasetPage() {
  const canonical = "/ingredient-density-data/";
  const title = "Ingredient Density Dataset — Grams per Cup for 80+ Ingredients (Open Data) | ExactCup";
  const description = "Free open dataset (CC BY 4.0) of cooking ingredient densities: grams per US cup for 80+ ingredients, verified against King Arthur Baking and USDA references. Download as CSV or JSON.";
  const csvUrl = canonical + "ingredient-density.csv";
  const jsonUrl = canonical + "ingredient-density.json";
  const cats = {};
  DATA.ingredients.forEach((i) => { (cats[i.category] = cats[i.category] || []).push(i); });
  const tables = Object.keys(cats).map((k) =>
    `<h3>${esc(catName(k))}</h3><table><thead><tr><th>Ingredient</th><th>Grams per US cup</th><th>Ounces per US cup</th></tr></thead><tbody>${
      cats[k].map((i) => `<tr><td><a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a></td><td class="num">${g2(i.gramsPerCup)} g</td><td class="num">${g2(i.gramsPerCup / OZ)} oz</td></tr>`).join("")
    }</tbody></table>`
  ).join("");
  const citation = `ExactCup (${SITE.year}). Ingredient Density Dataset — grams per US cup. ${SITE.baseUrl}${canonical} (CC BY 4.0)`;
  const jsonLd = [{
    "@context": "https://schema.org", "@type": "Dataset",
    name: "Ingredient Density Dataset — Grams per US Cup",
    description: `Densities of ${DATA.ingredients.length}+ common cooking and baking ingredients expressed as the weight in grams of one US customary cup (236.588 mL). Verified against the King Arthur Baking ingredient weight chart and USDA FoodData Central.`,
    url: SITE.baseUrl + canonical,
    sameAs: "https://github.com/exactcup/ingredient-density-dataset",
    license: "https://creativecommons.org/licenses/by/4.0/",
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: SITE.brand, url: SITE.baseUrl },
    keywords: ["ingredient density", "cups to grams", "baking measurements", "cooking conversions", "food data"],
    variableMeasured: "grams per US cup (236.588 mL)",
    distribution: [
      { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: SITE.baseUrl + csvUrl },
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: SITE.baseUrl + jsonUrl },
    ],
  }, breadcrumbLd([["Ingredient Density Dataset", canonical]])];
  const body = `
<h1>Ingredient Density Dataset</h1>
<p class="lead">The open data behind ExactCup: the weight in <strong>grams of one US cup</strong> (236.588&nbsp;mL) for ${DATA.ingredients.length}+ cooking and baking ingredients. Free to use under CC&nbsp;BY&nbsp;4.0 &mdash; download it, build with it, cite it.</p>
<p>
<a class="btn" href="${csvUrl}" download>Download CSV</a>&nbsp;
<a class="btn" href="${jsonUrl}" download>Download JSON</a>&nbsp;
<a href="https://github.com/exactcup/ingredient-density-dataset" rel="noopener">GitHub repo &rarr;</a>
</p>
<h2>Why this data exists</h2>
<p>Cups measure volume; grams measure weight. Because every ingredient has a different density, &ldquo;1 cup&rdquo; is a different weight for every ingredient &mdash; a cup of all-purpose flour is about 120&nbsp;g while a cup of honey is about 340&nbsp;g. Reliable volume&#8594;weight conversion therefore needs a per-ingredient density table. This is that table, in the form most useful for cooking: grams per US cup.</p>
<h2>Method &amp; sources</h2>
<p>Values follow authoritative baking references &mdash; primarily the <strong>King Arthur Baking Ingredient Weight Chart</strong>, cross-checked against <strong>USDA FoodData Central</strong> and standard culinary references. Real-world weights vary by brand, humidity, and measuring method (packed vs. sifted flour can differ by 30%), so treat these as reliable nominal values (&plusmn;~5%). Fields: <code>slug</code>, <code>name</code>, <code>category</code>, <code>grams_per_us_cup</code>, <code>aliases</code>.</p>
<h2>The data</h2>
${tables}
<h2>License &amp; how to cite</h2>
<p><strong>CC BY 4.0</strong> &mdash; free to use, share, and adapt, including commercially. The only requirement is attribution: credit ExactCup with a link. Suggested citation:</p>
<textarea readonly rows="3" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:13px" onclick="this.select()">${esc(citation)}</textarea>
<h2>Prefer an API to a download?</h2>
<p>The same data is served as a <a href="/api/">free JSON API</a> &mdash; no key, no sign-up, CORS enabled &mdash; with one endpoint per ingredient (<code>/api/v1/ingredients/honey.json</code>) plus precomputed cups&#8594;grams tables and a unit table for metric and imperial cups. Same CC&nbsp;BY&nbsp;4.0 terms.</p>
<p class="note">Want the interactive version instead of raw data? Use the <a href="/cups-to-grams/">cups to grams converter</a>, or <a href="/embed/">embed the free converter widget</a> on your own site.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd }) };
}

// CSV/JSON files served from our own domain (same schema as the GitHub dataset repo).
function datasetFiles() {
  const rows = DATA.ingredients.map((i) => ({
    slug: i.slug, name: i.name, category: catName(i.category),
    grams_per_us_cup: i.gramsPerCup, aliases: i.aliases || [],
  }));
  const csvField = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = "slug,name,category,grams_per_us_cup,aliases\n" +
    rows.map((r) => [r.slug, r.name, r.category, r.grams_per_us_cup, r.aliases.join("; ")].map(csvField).join(",")).join("\n") + "\n";
  return { csv, json: JSON.stringify(rows, null, 2) + "\n" };
}

// ---------- public JSON API ----------
// A free, key-less, CORS-enabled read API over the same verified density data that
// powers the converters. GitHub Pages serves these as static files with
// `access-control-allow-origin: *` and no rate limit, so they work from any
// browser/app directly. Versioned under /api/v1/ so paths can stay stable.
const API_VERSION = "v1";
const API_BASE = "/api/" + API_VERSION + "/";
// Volume units expressed in millilitres — lets a client convert ANY volume unit to
// weight with one multiply, using an ingredient's grams_per_ml.
const API_ML = {
  milliliter: 1,
  liter: 1000,
  us_cup: 236.5882365,
  us_tablespoon: 14.78676478125,
  us_teaspoon: 4.92892159375,
  us_fluid_ounce: 29.5735295625,
  us_pint: 473.176473,
  us_quart: 946.352946,
  us_gallon: 3785.411784,
  metric_cup: 250,
  imperial_cup: 284.130625,
  imperial_fluid_ounce: 28.4130625,
  imperial_pint: 568.26125,
  australian_tablespoon: 20,
};
const API_WEIGHT_G = { gram: 1, kilogram: 1000, ounce: OZ, pound: OZ * 16 };
const API_LICENSE = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" };
const API_ATTRIBUTION = {
  required: true,
  text: "Ingredient density data by ExactCup",
  url: SITE.baseUrl + "/",
  html: '<a href="' + SITE.baseUrl + '/">Ingredient density data by ExactCup</a>',
};
function rnd(n, p) { const f = Math.pow(10, p); return Math.round(n * f) / f; }

function apiIngredient(i) {
  const gpc = i.gramsPerCup;
  return {
    slug: i.slug,
    name: i.name,
    category: i.category,
    category_name: catName(i.category),
    aliases: i.aliases || [],
    grams_per_us_cup: gpc,
    grams_per_us_tablespoon: rnd(gpc / 16, 3),
    grams_per_us_teaspoon: rnd(gpc / 48, 3),
    grams_per_ml: rnd(gpc / API_ML.us_cup, 4),
    ounces_per_us_cup: rnd(gpc / OZ, 3),
    url: SITE.baseUrl + "/cups-to-grams/" + i.slug + "/",
  };
}
// Per-ingredient document: the summary object plus precomputed tables, so a client
// that only needs "how many grams is 2/3 cup" never has to do arithmetic.
function apiIngredientDetail(i) {
  const gpc = i.gramsPerCup;
  const o = apiIngredient(i);
  o.conversions = {
    cups_to_grams: FRACTIONS.map(([label, n]) => ({ cups: label, grams: g2(n * gpc) })),
    tablespoons_to_grams: [1, 2, 3, 4, 6, 8, 12, 16].map((n) => ({ tablespoons: n, grams: g2(n * gpc / 16) })),
    grams_to_cups: [10, 25, 50, 100, 125, 150, 200, 250, 300, 500, 1000].map((g) => ({ grams: g, cups: rnd(g / gpc, 3) })),
  };
  o.source = SITE.baseUrl + "/ingredient-density-data/";
  o.license = API_LICENSE;
  o.attribution = API_ATTRIBUTION;
  return o;
}
const API_ENDPOINTS = [
  [API_BASE + "index.json", "This document: API metadata, license and the endpoint list."],
  [API_BASE + "ingredients.json", "Every ingredient with its density (grams per US cup, tablespoon, teaspoon and mL)."],
  [API_BASE + "ingredients/{slug}.json", "One ingredient, plus precomputed cups→grams, tablespoons→grams and grams→cups tables."],
  [API_BASE + "categories.json", "Ingredient categories with the slugs in each."],
  [API_BASE + "units.json", "Volume units in mL and weight units in grams, so you can convert any unit yourself."],
];
function apiRootDoc() {
  return {
    name: "ExactCup Ingredient Density API",
    version: API_VERSION,
    description: "Free read-only JSON API giving the weight in grams of one US cup (and per tablespoon, teaspoon and mL) for " +
      DATA.ingredients.length + " cooking and baking ingredients. No API key, no sign-up, CORS enabled.",
    documentation: SITE.baseUrl + "/api/",
    auth: null,
    https: true,
    cors: true,
    rate_limit: null,
    updated: LASTMOD,
    ingredient_count: DATA.ingredients.length,
    license: API_LICENSE,
    attribution: API_ATTRIBUTION,
    dataset: SITE.baseUrl + "/ingredient-density-data/",
    source_repository: "https://github.com/exactcup/ingredient-density-dataset",
    endpoints: API_ENDPOINTS.map(([path, description]) => ({ path, url: SITE.baseUrl + path, description })),
  };
}
// Map of output path (relative to dist/) -> file contents.
function apiFiles() {
  const files = {};
  const J = (o) => JSON.stringify(o, null, 2) + "\n";
  const meta = { updated: LASTMOD, license: API_LICENSE, attribution: API_ATTRIBUTION, documentation: SITE.baseUrl + "/api/" };
  files[API_BASE + "index.json"] = J(apiRootDoc());
  files[API_BASE + "ingredients.json"] = J(Object.assign({
    count: DATA.ingredients.length,
    unit: "grams per US customary cup (236.588 mL)",
  }, meta, { ingredients: DATA.ingredients.map(apiIngredient) }));
  files[API_BASE + "categories.json"] = J(Object.assign({}, meta, {
    categories: Object.keys(DATA.categories).map((k) => ({
      key: k, name: catName(k),
      url: SITE.baseUrl + "/" + k + "-conversion-chart/",
      ingredient_count: DATA.ingredients.filter((i) => i.category === k).length,
      slugs: DATA.ingredients.filter((i) => i.category === k).map((i) => i.slug),
    })),
  }));
  files[API_BASE + "units.json"] = J(Object.assign({}, meta, {
    volume_ml: API_ML,
    weight_grams: API_WEIGHT_G,
    formula: {
      volume_to_weight: "grams = volume_amount * volume_ml[unit] * grams_per_ml",
      weight_to_volume: "volume_amount = grams / grams_per_ml / volume_ml[unit]",
      note: "grams_per_ml comes from the ingredient object. Densities are nominal values for level, unpacked measures (brown sugar is packed); real weights vary by brand, humidity and technique by roughly 5%.",
    },
  }));
  DATA.ingredients.forEach((i) => { files[API_BASE + "ingredients/" + i.slug + ".json"] = J(apiIngredientDetail(i)); });
  return files;
}

// Human-facing docs for the API above. Indexed, linked sitewide — this is the page
// developers cite when they use the data.
function apiDocsPage() {
  const canonical = "/api/";
  const title = "Free Cups-to-Grams JSON API — Ingredient Density API (No Key) | ExactCup";
  const description = "Free JSON API for ingredient densities: grams per US cup, tablespoon, teaspoon and mL for 80+ cooking ingredients. No API key, no sign-up, CORS enabled, CC BY 4.0.";
  const sample = JSON.stringify((() => {
    const d = apiIngredientDetail(ingBySlug("honey") || DATA.ingredients[0]);
    // Full object, with only the long conversion tables trimmed for readability.
    return Object.assign({}, d, {
      conversions: { cups_to_grams: d.conversions.cups_to_grams.slice(3, 6), "…": "…" },
    });
  })(), null, 2);
  const endpointRows = API_ENDPOINTS.map(([p, d]) =>
    `<tr><td><code>GET ${esc(p)}</code></td><td>${esc(d)}</td></tr>`).join("");
  const fieldRows = [
    ["slug", "Stable identifier, also the URL segment on this site."],
    ["name", "Display name, e.g. “All-Purpose Flour”."],
    ["category / category_name", "One of " + Object.keys(DATA.categories).length + " groups (flour, sugar, dairy, baking, grain)."],
    ["aliases", "Other names the ingredient goes by (“plain flour”, “confectioners sugar”) — useful for matching recipe text."],
    ["grams_per_us_cup", "The core value: weight in grams of one level US customary cup (236.588 mL)."],
    ["grams_per_us_tablespoon / grams_per_us_teaspoon", "The same density divided by 16 and 48."],
    ["grams_per_ml", "Density in g/mL — multiply by any volume in mL to get grams."],
    ["ounces_per_us_cup", "Weight in avoirdupois ounces per US cup."],
    ["url", "The human page for that ingredient on ExactCup."],
  ].map(([f, d]) => `<tr><td><code>${esc(f)}</code></td><td>${esc(d)}</td></tr>`).join("");
  const faq = [
    ["Do I need an API key?", "No. There is no key, no sign-up and no account. The endpoints are plain JSON files served over HTTPS from a CDN with permissive CORS headers, so you can fetch them straight from browser JavaScript, a server, a shell script or a spreadsheet."],
    ["Is there a rate limit?", "There is no application rate limit — the files are static and cached by the CDN, so normal use costs nothing. Please cache responses on your side rather than re-fetching per request; the data changes rarely, and every response includes an 'updated' date you can check."],
    ["Can I use it in a commercial app?", "Yes. The data is licensed CC BY 4.0, which permits commercial use, redistribution and adaptation. The only condition is attribution: credit ExactCup with a link, in your app's about/credits screen or near where the numbers appear."],
    ["Where do the numbers come from?", "The same verified dataset behind the ExactCup converters: values follow the King Arthur Baking ingredient weight chart, cross-checked against USDA FoodData Central and standard culinary references. They are nominal weights for level, unpacked measures (brown sugar packed), accurate to roughly 5% in real kitchens."],
    ["How do I convert grams back to cups?", "Divide by the density: cups = grams / grams_per_us_cup. Each per-ingredient document also ships a precomputed grams_to_cups table for common weights (100 g, 250 g, 500 g…), so simple apps need no arithmetic at all."],
    ["Does it support metric or UK cups?", "Yes — units.json lists every volume unit in millilitres, including the 250 mL metric cup used in the UK, Australia and New Zealand, the 284 mL imperial cup and the 20 mL Australian tablespoon. Multiply the unit's mL value by grams_per_ml to get grams."],
    ["Will the URLs keep working?", "The /api/v1/ paths are meant to be stable: new fields may be added, but existing fields and paths will not be removed or renamed inside v1. Anything breaking would ship as /api/v2/."],
  ];
  const jsonLd = [
    {
      "@context": "https://schema.org", "@type": "WebAPI",
      name: "ExactCup Ingredient Density API",
      description: description,
      url: SITE.baseUrl + canonical,
      documentation: SITE.baseUrl + canonical,
      provider: { "@type": "Organization", name: SITE.brand, url: SITE.baseUrl },
      license: API_LICENSE.url,
      isAccessibleForFree: true,
      termsOfService: SITE.baseUrl + canonical,
    },
    faqLd(faq),
    breadcrumbLd([["Ingredient Density API", canonical]]),
  ];
  const body = `
<h1>Ingredient Density API</h1>
<p class="lead">A free JSON API for the question &ldquo;how many grams is one cup of&nbsp;___?&rdquo; &mdash; ${DATA.ingredients.length} cooking and baking ingredients, with grams per US cup, tablespoon, teaspoon and mL. No API key, no sign-up, CORS enabled, CC&nbsp;BY&nbsp;4.0.</p>
<h2>Quick start</h2>
<pre><code>curl ${SITE.baseUrl}${API_BASE}ingredients/honey.json</code></pre>
<pre><code>${esc(sample)}</code></pre>
<h2>Endpoints</h2>
<div class="tw"><table><thead><tr><th>Endpoint</th><th>Returns</th></tr></thead><tbody>${endpointRows}</tbody></table></div>
<p>Base URL: <code>${SITE.baseUrl}${API_BASE}</code> &mdash; start at <a href="${API_BASE}index.json">index.json</a>, which lists everything above. Browse the raw files: <a href="${API_BASE}ingredients.json">ingredients.json</a> &middot; <a href="${API_BASE}categories.json">categories.json</a> &middot; <a href="${API_BASE}units.json">units.json</a>.</p>
<h2>The ingredient object</h2>
<div class="tw"><table><thead><tr><th>Field</th><th>Meaning</th></tr></thead><tbody>${fieldRows}</tbody></table></div>
<h2>Converting any unit</h2>
<p>Because <code>grams_per_ml</code> is included, one multiply converts <em>any</em> volume unit &mdash; US cups, metric cups, imperial fluid ounces, Australian tablespoons &mdash; using the mL table in <a href="${API_BASE}units.json">units.json</a>:</p>
<pre><code>const [ing, units] = await Promise.all([
  fetch("${SITE.baseUrl}${API_BASE}ingredients/all-purpose-flour.json").then(r =&gt; r.json()),
  fetch("${SITE.baseUrl}${API_BASE}units.json").then(r =&gt; r.json()),
]);

// 1.5 metric cups of flour, in grams
const grams = 1.5 * units.volume_ml.metric_cup * ing.grams_per_ml;
// -&gt; ${g2(1.5 * 250 * rnd((ingBySlug("all-purpose-flour") || DATA.ingredients[0]).gramsPerCup / API_ML.us_cup, 4))} g</code></pre>
<p>Python is just as short:</p>
<pre><code>import requests
d = requests.get("${SITE.baseUrl}${API_BASE}ingredients/granulated-sugar.json").json()
print(d["conversions"]["cups_to_grams"])   # [{"cups": "1/8", "grams": ...}, ...]</code></pre>
<h2>Terms of use</h2>
<ul>
<li><strong>Free, no key, no limit.</strong> Static files on a CDN. Cache them &mdash; don&rsquo;t proxy a fetch per page view.</li>
<li><strong>Licence: CC BY 4.0.</strong> Commercial use, redistribution and adaptation are all fine.</li>
<li><strong>Attribution required.</strong> Credit ExactCup with a link wherever the numbers appear:</li>
</ul>
<textarea readonly rows="2" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:13px" onclick="this.select()">${esc(API_ATTRIBUTION.html)}</textarea>
<ul>
<li><strong>Accuracy.</strong> Nominal values (&plusmn;~5% in real kitchens) &mdash; see the <a href="/ingredient-density-data/">dataset page</a> for method and sources. Don&rsquo;t use them where a precise weight is safety-critical.</li>
<li><strong>Versioning.</strong> Fields may be added inside <code>${API_BASE}</code>; nothing existing gets removed or renamed. Breaking changes would ship as <code>/api/v2/</code>.</li>
</ul>
<h2>Prefer something ready-made?</h2>
<p>If you want the numbers rather than the plumbing: the same data is downloadable as <a href="/ingredient-density-data/">CSV or JSON</a>, there are <a href="/embed/">free embeddable converter widgets</a> for websites, and the <a href="/cups-to-grams/">cups to grams converter</a> covers every fraction of a cup by hand.</p>
<h2>FAQ</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd }) };
}

// ---------- write ----------
function writePage(canonical, html) {
  const dir = path.join(OUT, canonical.replace(/^\//, ""));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
}
function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

function build() {
  rmrf(OUT);
  fs.mkdirSync(OUT, { recursive: true });
  const pages = [homePage(), masterPage(), gramsToCupsPage(), tablespoonsToGramsPage(), tbspInCupPage(), tspInTbspPage(), ouncesInCupPage(), cupsInQuartPage(), halvingChartPage(), kitchenChartPage(), scalerPage(), ovenPage(), butterPage(), butterToOilPage(), sugarToHoneyPage(), cakeFlourSubstitutePage(), cornstarchFlourPage(), bakingPowderSubstitutePage(), dryToCookedPage(), airFryerPage(), panSizePage(), volumePage(), cupsToMlPage(), portionPage(), pizzaDoughPage(), bakersPercentagePage(), yeastPage(), sourdoughPage(), embedInfoPage(), datasetPage(), apiDocsPage()];
  Object.keys(DATA.categories).forEach((k) => { const p = categoryPage(k); if (p) pages.push(p); });
  DATA.ingredients.forEach((i) => pages.push(ingredientPage(i)));
  pages.forEach((p) => writePage(p.canonical, p.html));
  // bare embeddable widgets: written to disk but kept OUT of the sitemap (noindex)
  [embedWidgetPage(), embedGramsWidgetPage(), embedButterWidgetPage()].forEach((ew) => writePage(ew.canonical, ew.html));

  // assets
  fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "assets", "app.js"), path.join(OUT, "assets", "app.js"));
  // share images (og cards + Pinterest pin), pre-rendered by scripts/make-images.js
  fs.readdirSync(path.join(ROOT, "assets")).filter((f) => f.endsWith(".png"))
    .forEach((f) => fs.copyFileSync(path.join(ROOT, "assets", f), path.join(OUT, "assets", f)));

  // open-data downloads served from our own domain (next to the dataset page)
  { const df = datasetFiles();
    fs.writeFileSync(path.join(OUT, "ingredient-density-data", "ingredient-density.csv"), df.csv);
    fs.writeFileSync(path.join(OUT, "ingredient-density-data", "ingredient-density.json"), df.json); }

  // free public JSON API: static, CORS-enabled endpoints under /api/v1/
  { const af = apiFiles();
    Object.keys(af).forEach((rel) => {
      const out = path.join(OUT, rel.replace(/^\//, ""));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, af[rel]);
    });
    console.log(`Wrote ${Object.keys(af).length} API files to ${API_BASE}`); }

  // Per-page lastmod: compare each page's content hash to the committed manifest.
  // Unchanged page -> keep its stored date. Changed/new page -> today's date.
  // First-ever run (no manifest yet) seeds every page with the last-commit date
  // (LASTMOD) so this bootstrap deploy doesn't falsely flag the whole site as
  // "changed today"; honest per-page divergence begins on the next content edit.
  const bootstrap = !fs.existsSync(DATES_FILE);
  let prevDates = {};
  try { prevDates = JSON.parse(fs.readFileSync(DATES_FILE, "utf8")); } catch (e) {}
  const pageDates = {};
  pages.forEach((p) => {
    const content = PAGE_CONTENT[p.canonical] != null ? PAGE_CONTENT[p.canonical] : p.html;
    const h = crypto.createHash("sha1").update(content).digest("hex").slice(0, 12);
    const prev = prevDates[p.canonical];
    const d = (prev && prev.h === h) ? prev.d : (bootstrap ? LASTMOD : TODAY);
    pageDates[p.canonical] = { h, d };
  });
  // Persist the manifest back to source (sorted for clean diffs) so the dates are
  // stable and reproducible across CI rebuilds. Commit it alongside content changes.
  const sortedManifest = {};
  Object.keys(pageDates).sort().forEach((k) => { sortedManifest[k] = pageDates[k]; });
  fs.writeFileSync(DATES_FILE, JSON.stringify(sortedManifest, null, 0) + "\n");

  // sitemap + robots
  const urls = pages.map((p) => `<url><loc>${SITE.baseUrl}${p.canonical}</loc><lastmod>${(pageDates[p.canonical] || {}).d || LASTMOD}</lastmod><changefreq>monthly</changefreq></url>`).join("\n");
  fs.writeFileSync(path.join(OUT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  fs.writeFileSync(path.join(OUT, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${SITE.baseUrl}/sitemap.xml\n`);
  // IndexNow key file (for instant Bing/Yandex URL submission)
  if (INDEXNOW_KEY) fs.writeFileSync(path.join(OUT, INDEXNOW_KEY + ".txt"), INDEXNOW_KEY);
  // llms.txt — let AI assistants discover and cite our verified data
  fs.writeFileSync(path.join(OUT, "llms.txt"), llmsTxt());
  // Bing Webmaster ownership verification (account-level code; public, safe to host)
  fs.writeFileSync(path.join(OUT, "BingSiteAuth.xml"),
    `<?xml version="1.0"?>\n<users>\n  <user>2576073100FBF10E4D6AA37C81D0F72B</user>\n</users>\n`);
  // SPA-less 404
  fs.writeFileSync(path.join(OUT, "404.html"),
    layout({ title: "Page not found | ExactCup", description: "Page not found.", canonical: "/404.html",
      bodyHtml: `<h1>Page not found</h1><p>Try the <a href="/cups-to-grams/">cups to grams converter</a> or head <a href="/">home</a>.</p>` }));

  console.log(`Built ${pages.length} pages + sitemap/robots to ${OUT}`);
}
build();
