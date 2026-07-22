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
  ["/oven-temperature-converter/", "Oven Temperature", "°F ↔ °C ↔ gas mark, with a quick chart."],
  ["/pan-size-converter/", "Pan Size Converter", "Swapping pans? Scale the recipe by pan area."],
  ["/volume-converter/", "Volume Converter", "Cups, tablespoons, teaspoons, mL and fl oz."],
  ["/cups-to-ml/", "Cups to mL", "How many mL in a cup — US, metric & UK cup sizes."],
  ["/portion-calculator/", "Portion Calculator", "How much rice, pasta or potatoes per person."],
  ["/pizza-dough-calculator/", "Pizza Dough Calculator", "Exact flour, water, salt & yeast by baker's %."],
  ["/bakers-percentage-calculator/", "Baker's Percentage Calculator", "Build & scale any bread formula by baker's math."],
  ["/yeast-converter/", "Yeast Converter", "Active dry, instant & fresh yeast — swap by weight."],
  ["/sourdough-hydration-calculator/", "Sourdough Hydration", "True dough hydration with the starter counted right."],
  ["/butter-converter/", "Butter Converter", "Sticks, cups, tablespoons, grams and ounces."],
  ["/butter-to-oil/", "Butter to Oil", "Swap butter for oil: 1 cup butter = 3/4 cup oil."],
  ["/sugar-to-honey/", "Sugar to Honey", "Swap sugar for honey: 1 cup sugar = ½–¾ cup honey."],
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
.btn{display:inline-block;background:var(--accent);color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
.btn:hover{background:#9a3412}
.bp-del{background:none;border:1px solid var(--line);color:var(--muted);border-radius:7px;width:32px;height:32px;cursor:pointer;font-size:17px;line-height:1;padding:0}
.bp-del:hover{border-color:var(--accent);color:var(--accent)}
footer.site{border-top:1px solid var(--line);margin-top:36px;padding:22px 0;color:var(--muted);font-size:14px}
footer.site a{color:var(--muted)}
footer.site .fcol{display:flex;flex-wrap:wrap;gap:6px 14px;margin:10px 0}
footer.site .fcol .fh{width:100%;font-weight:600;color:var(--fg);font-size:13px;margin-bottom:2px}
@media(max-width:520px){h1{font-size:25px}nav a{margin-left:10px}}
`;

function layout(opts) {
  const { title, description, canonical, bodyHtml, jsonLd, cfg } = opts;
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
<p style="font-size:12px">Conversions are approximate; ingredient weights vary by brand, humidity, and how you measure. For best baking results, weigh with a kitchen scale. Open data: <a href="/ingredient-density-data/">ingredient density dataset</a> (CC BY 4.0) · <a href="/embed/">embed our converter</a>.</p>
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

// Genuinely-relevant tool links per ingredient category. Also flows crawl
// equity from the most-crawled cluster (ingredient pages) to the tool pages,
// which are otherwise only linked from the homepage. Every tool page appears in
// at least one category list so the whole tool set gets internal inlinks.
const CATEGORY_TOOLS = {
  flour: [["/pizza-dough-calculator/", "Pizza Dough Calculator"], ["/bakers-percentage-calculator/", "Baker's Percentage Calculator"], ["/sourdough-hydration-calculator/", "Sourdough Hydration Calculator"], ["/yeast-converter/", "Yeast Converter"]],
  sugar: [["/recipe-scaler/", "Recipe Scaler"], ["/recipe-halving-chart/", "Recipe Halving Chart"], ["/volume-converter/", "Volume Converter"], ["/cups-to-ml/", "Cups to mL Converter"]],
  dairy: [["/butter-converter/", "Butter Converter"], ["/recipe-scaler/", "Recipe Scaler"], ["/recipe-halving-chart/", "Recipe Halving Chart"], ["/cups-to-ml/", "Cups to mL Converter"]],
  baking: [["/bakers-percentage-calculator/", "Baker's Percentage Calculator"], ["/oven-temperature-converter/", "Oven Temperature Converter"], ["/air-fryer-conversion-calculator/", "Air Fryer Converter"], ["/pan-size-converter/", "Pan Size Converter"]],
  grain: [["/portion-calculator/", "Portion Calculator"], ["/recipe-scaler/", "Recipe Scaler"], ["/recipe-halving-chart/", "Recipe Halving Chart"]],
};

function ingredientPage(ing) {
  const gpc = ing.gramsPerCup;
  const related = DATA.ingredients.filter((i) => i.category === ing.category && i.slug !== ing.slug).slice(0, 6);
  // Reverse hub + tablespoon converter are relevant to every ingredient; category tools add depth.
  const toolLinks = [["/grams-to-cups/", "Grams to Cups Converter"], ["/tablespoons-to-grams/", "Tablespoons to Grams"], ...(CATEGORY_TOOLS[ing.category] || [])];
  const title = `${ing.name} Cups to Grams Converter | 1 Cup ${ing.name} in Grams`;
  const description = ing.slug === "butter"
    ? `How many grams is a cup of butter? 1 cup = ${g2(gpc)} g, 1 stick = ${g2(gpc / 2)} g, 1/2 cup = ${g2(gpc / 2)} g. Free butter converter with a full cups, sticks, tablespoons and grams chart.`
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
${ing.blurb ? `<h2>Measuring ${esc(ing.name.toLowerCase())} accurately</h2>\n<p>${esc(ing.blurb)}</p>` : ""}
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
<p>Measuring the butter itself — sticks, cups, tablespoons, grams? Use the <a href="/butter-converter/">butter converter</a>. Weighing it? <a href="/cups-to-grams/butter/">1 cup of butter is 227 g</a>, and a cup of <a href="/cups-to-grams/olive-oil/">olive oil is 216 g</a> (<a href="/cups-to-grams/vegetable-oil/">vegetable oil: 218 g</a>). Halving the recipe while you're at it? The <a href="/recipe-halving-chart/">recipe halving chart</a> keeps every measure on a real spoon, and <a href="/tablespoons-in-a-cup/">tablespoons in a cup</a> spells out every cup fraction in spoons. Swapping the sweetener too? The <a href="/sugar-to-honey/">sugar to honey conversion</a> works the same way — a fixed ratio plus a few small recipe adjustments.</p>
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
<p>Just measuring, not substituting? <a href="/cups-to-grams/honey/">1 cup of honey is 340 g</a> and <a href="/cups-to-grams/granulated-sugar/">1 cup of granulated sugar is 200 g</a> — the <a href="/sugar-conversion-chart/">sugar &amp; sweetener chart</a> covers brown sugar, <a href="/cups-to-grams/maple-syrup/">maple syrup (322 g)</a>, molasses and the rest. Swapping fats too? The <a href="/butter-to-oil/">butter to oil conversion</a> works the same way: a fixed ratio plus a couple of honest adjustments. Halving the recipe while you're at it? See the <a href="/recipe-halving-chart/">recipe halving chart</a>.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "sugarhoney" } }) };
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
    ["How much rice per person?", "About 75 g of uncooked rice per person for a main dish, or roughly 50 g as a side. Rice roughly triples in weight as it cooks, so 75 g dry becomes about 200 g on the plate — a generous cup of cooked rice."],
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
<p class="note">Main-dish portions based on standard meal-planning guidance (WRAP / Love Food Hate Waste). Side dishes are roughly half. Adjust for big appetites or leftovers.</p>
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
  ],
  sugar: [
    ["How many grams is 1 cup of sugar?", "One cup of granulated white sugar weighs 200 g. Packed brown sugar is heavier at 213 g, caster sugar is 190 g, and powdered (icing) sugar is much lighter at 113 g."],
    ["Why does brown sugar weigh more than white sugar?", "Brown sugar is packed into the cup and holds moisture from its molasses, so a cup contains more — about 213 g packed versus 200 g for granulated sugar."],
    ["How many grams is 1 cup of honey?", "One cup of honey weighs about 340 g. Other liquid sweeteners are similar and heavy: maple syrup 322 g, corn syrup 328 g, golden syrup and molasses 340 g, agave nectar 336 g."],
    ["How do you measure sticky syrups by the cup?", "Lightly oil or spray the measuring cup first so honey, molasses or maple syrup slide out cleanly, or weigh them straight into the bowl in grams for the most accuracy."],
  ],
  dairy: [
    ["How many grams is 1 cup of milk?", "One cup of milk weighs about 240 g. Most liquid dairy is close to this — buttermilk 227 g, heavy cream 232 g, sour cream 230 g and yogurt 245 g."],
    ["How many grams is 1 cup of butter?", "One cup of butter weighs 227 g, which is 2 sticks. Half a cup is about 113 g — a single stick."],
    ["Is a cup of oil the same weight as a cup of butter?", "No. A cup of vegetable, olive or coconut oil weighs about 216–218 g, a little less than butter's 227 g, because liquid oil is less dense than solid fat."],
    ["How many grams is 1 cup of shredded cheese?", "Shredded cheddar or mozzarella is about 113 g per cup and finely grated parmesan around 100 g. Soft cheeses are much heavier — cream cheese and ricotta are roughly 227–232 g per cup."],
  ],
  baking: [
    ["How many grams is 1 cup of chocolate chips?", "One cup of chocolate chips weighs about 170 g. White chocolate chips are the same weight per cup."],
    ["How many grams is 1 cup of chopped nuts?", "Chopped nuts are roughly 120 g per cup. Whole almonds, hazelnuts and pine nuts are denser at 142 g, pecan halves lighter at 105 g, and chopped walnuts about 113 g."],
    ["How many grams is 1 cup of shredded coconut?", "Shredded coconut is very light — about 80 g per cup — so a cup weighs far less than most other baking add-ins."],
    ["Do seeds weigh the same per cup?", "Roughly. Sesame and poppy seeds are about 142–144 g per cup and chia seeds 148 g, while ground flaxseed is lighter at 100 g."],
  ],
  grain: [
    ["How many grams is 1 cup of uncooked rice?", "One cup of uncooked white rice weighs about 185 g. Quinoa is lighter at 170 g, and couscous about 175 g — all measured dry."],
    ["How many grams is 1 cup of rolled oats?", "Rolled (old-fashioned) oats weigh about 90 g per cup. Steel-cut oats are much denser at 140 g because the grains are cut, not flattened."],
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
  const description = `Free ${cname.toLowerCase()} conversion chart: grams per cup for ${items.slice(0, 4).map((i) => i.name.toLowerCase()).join(", ")} and more. Cups, half-cups and quarter-cups to grams at a glance.`;
  const rows = items.map((i) =>
    `<tr><td><a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a></td><td class="num">${g2(i.gramsPerCup)} g</td><td class="num">${g2(i.gramsPerCup / 2)} g</td><td class="num">${g2(i.gramsPerCup / 4)} g</td></tr>`
  ).join("");
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
<p>Replacing the sugar with honey rather than just measuring it? The <a href="/sugar-to-honey/">sugar to honey conversion chart</a> covers the ½–¾ ratio, the liquid reduction and the baking-soda rule.</p>` : ""}
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
  const description = "Free baker's percentage calculator. Enter your flour weight and ingredients to get baker's percentages instantly, or scale any bread recipe up or down by changing the flour weight.";
  const canonical = "/bakers-percentage-calculator/";
  const faq = [
    ["What is baker's percentage?", "Baker's percentage (also called baker's math) expresses every ingredient in a recipe as a percentage of the total flour weight. Flour is always 100%, and everything else is measured relative to it. It lets bakers compare and scale formulas regardless of batch size."],
    ["How do you calculate baker's percentage?", "Divide the weight of an ingredient by the total flour weight and multiply by 100. For example, 350 g water with 500 g flour is 350 ÷ 500 × 100 = 70% (a 70% hydration dough). Salt of 10 g on 500 g flour is 2%."],
    ["What is hydration in bread baking?", "Hydration is the water (or other liquid) expressed as a baker's percentage of the flour. A lean bread is usually 60–75% hydration; higher hydration gives a more open, airy crumb but stickier dough that is harder to handle."],
    ["Why can baker's percentages add up to more than 100%?", "Because flour alone is the 100% reference, not the whole recipe. Adding water (≈65%), salt (≈2%) and yeast (≈1%) gives a formula total around 168% — that's normal. The total simply tells you the dough weight relative to the flour."],
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
    ["Oven Temperature Converter", "/oven-temperature-converter/", "Fahrenheit to Celsius to gas mark"],
    ["Air Fryer Conversion Calculator", "/air-fryer-conversion-calculator/", "Convert oven recipes to air fryer time and temperature"],
    ["Pan Size Converter", "/pan-size-converter/", "Adjust a recipe when swapping cake pan sizes (by area)"],
    ["Volume Converter", "/volume-converter/", "Cups, tablespoons, teaspoons, fluid ounces, millilitres, litres"],
    ["Cups to mL Converter", "/cups-to-ml/", "1 US cup = 236.59 mL (240 mL on labels); metric cup (UK/AU/NZ) = 250 mL; imperial cup = 284 mL; Japanese cup = 200 mL; chart for every fraction"],
    ["Portion Calculator", "/portion-calculator/", "How much rice, pasta, potatoes etc. per person"],
    ["Pizza Dough Calculator", "/pizza-dough-calculator/", "Flour, water, salt and yeast by baker's percentage"],
    ["Baker's Percentage Calculator", "/bakers-percentage-calculator/", "Build and scale any bread formula using baker's math (every ingredient as a percentage of flour)"],
    ["Yeast Converter", "/yeast-converter/", "Convert between active dry, instant and fresh yeast by weight (ratio 1 : 1.25 : 3); 1 packet = 7 g = 2¼ tsp"],
    ["Sourdough Hydration Calculator", "/sourdough-hydration-calculator/", "True dough hydration including the flour and water in the starter (any starter hydration), salt %, prefermented flour and target-hydration water"],
    ["Butter Converter", "/butter-converter/", "Sticks, cups, tablespoons, grams and ounces"],
    ["Butter to Oil Conversion", "/butter-to-oil/", "Substitute oil for butter at the standard 3:4 volume ratio: 1 cup butter = 3/4 cup oil; 1 stick = 6 tbsp oil; by weight 100 g butter ≈ 71 g oil (butter is ~81% fat + 16% water, USDA); melted-butter recipes are often swapped 1:1; not suited to cookies, creamed cakes, pie crust or laminated pastry"],
    ["Sugar to Honey Conversion", "/sugar-to-honey/", "Substitute honey for granulated sugar: 1 cup sugar = 3/4 cup honey (King Arthur rule; the National Honey Board and Clemson Extension suggest up to 1/2), then per cup of honey used cut other liquid by 1/4 cup, add 1/2 tsp baking soda (honey pH ~3.9) and bake 25 F lower (avoid recipes over 350 F); by weight 100 g sugar ≈ 128 g honey (honey is 340 g/cup vs sugar 200 g/cup); reverse: 1 cup honey = 1 1/4 cups sugar + 1/4 cup liquid"],
  ];
  let out = `# ExactCup\n\n> Free, accurate cooking and baking measurement converters. Cups-to-grams for ${DATA.ingredients.length}+ ingredients (every weight verified against authoritative sources such as the King Arthur Baking ingredient weight chart and USDA), plus recipe scaler, oven temperature, air fryer, pan size, volume, portion and pizza dough calculators. All tools are free, client-side and need no sign-up. Note: 1 US cup = 236.588 ml; weights differ by ingredient because densities differ.\n\n`;
  out += `## Tools\n`;
  tools.forEach((t) => { out += `- [${t[0]}](${b}${t[1]}): ${t[2]}\n`; });
  out += `\n## Ingredient cups-to-grams reference (weight of 1 US cup)\n`;
  DATA.ingredients.forEach((i) => { out += `- [${i.name}](${b}/cups-to-grams/${i.slug}/): 1 cup = ${g2(i.gramsPerCup)} g\n`; });
  out += `\n## Conversion charts by category\n`;
  Object.keys(DATA.categories).forEach((k) => { out += `- [${catName(k)} conversion chart](${b}/${k}-conversion-chart/)\n`; });
  out += `\n## Open data\n- [Ingredient Density Dataset](${b}/ingredient-density-data/): grams per US cup for ${DATA.ingredients.length}+ ingredients, CC BY 4.0, downloadable as [CSV](${b}/ingredient-density-data/ingredient-density.csv) or [JSON](${b}/ingredient-density-data/ingredient-density.json). Please cite ExactCup with a link when using the data.\n`;
  return out;
}

// Standalone embeddable widget (iframe target for food blogs). Minimal chrome, own HTML (not layout()).
function embedWidgetPage() {
  const canonical = "/embed/cups-to-grams/";
  const opts = DATA.ingredients.map((i) => `<option value="${i.slug}">${esc(i.name)}</option>`).join("");
  const cfg = { type: "master", ingredients: DATA.ingredients.map((i) => ({ slug: i.slug, gramsPerCup: i.gramsPerCup })) };
  const css = `*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1f2328;background:#fff;padding:12px}
.ec-w{max-width:400px;margin:0 auto}label{display:block;font-size:12px;color:#5b6470;font-weight:600;margin:8px 0 3px}
select,input{width:100%;font-size:16px;padding:9px 10px;border:1px solid #e6e8eb;border-radius:8px;font-family:inherit}
.ec-row{display:flex;gap:8px}.ec-row>div{flex:1}
.ec-out{background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px;text-align:center;margin-top:10px}
.ec-big{font-size:26px;font-weight:800;color:#c2410c}.ec-sub{color:#5b6470;font-size:14px}
.ec-attr{text-align:center;font-size:12px;color:#5b6470;margin-top:10px}.ec-attr a{color:#c2410c;text-decoration:none;font-weight:600}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Cups to Grams Converter — ExactCup</title><style>${css}</style></head><body>
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
<script type="application/json" id="cfg">${JSON.stringify(cfg)}</script><script src="/assets/app.js" defer></script>
</body></html>`;
  return { canonical, html };
}

function embedInfoPage() {
  const canonical = "/embed/";
  const title = "Free Embeddable Cups-to-Grams Converter for Your Recipe Blog | ExactCup";
  const description = "Add a free, accurate cups-to-grams converter to your recipe blog or website. Copy-paste one line of HTML — no sign-up, no cost. Just keep the attribution link.";
  const snippet = `<iframe src="${SITE.baseUrl}/embed/cups-to-grams/" width="100%" height="380" style="border:1px solid #e6e8eb;border-radius:12px;max-width:440px" title="Cups to Grams Converter" loading="lazy"></iframe>
<p style="font-size:13px"><a href="${SITE.baseUrl}/cups-to-grams/">Cups to Grams Converter</a> by ExactCup</p>`;
  const body = `
<h1>Free Embeddable Cups-to-Grams Converter</h1>
<p class="lead">Give your readers an accurate, instant cups&#8596;grams converter right inside your recipe posts. Free, no sign-up &mdash; just copy the snippet below.</p>
<h2>Live preview</h2>
<iframe src="${SITE.baseUrl}/embed/cups-to-grams/" width="100%" height="380" style="border:1px solid var(--line);border-radius:12px;max-width:440px" title="Cups to Grams Converter preview" loading="lazy"></iframe>
<h2>Copy this snippet</h2>
<p>Paste it anywhere in your post&#8217;s HTML:</p>
<textarea readonly rows="6" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:13px" onclick="this.select()">${esc(snippet)}</textarea>
<h2>License</h2>
<p>Free to embed on any site, commercial or personal. The only condition: <strong>keep the &ldquo;by ExactCup&rdquo; attribution link</strong> shown under the widget. That link is how we keep the tool free. Thanks!</p>
<p class="note">Covers 80+ ingredients with weights verified against authoritative baking references. The widget updates automatically as we add ingredients &mdash; you never touch the code again.</p>`;
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
  const pages = [homePage(), masterPage(), gramsToCupsPage(), tablespoonsToGramsPage(), tbspInCupPage(), tspInTbspPage(), ouncesInCupPage(), cupsInQuartPage(), halvingChartPage(), scalerPage(), ovenPage(), butterPage(), butterToOilPage(), sugarToHoneyPage(), airFryerPage(), panSizePage(), volumePage(), cupsToMlPage(), portionPage(), pizzaDoughPage(), bakersPercentagePage(), yeastPage(), sourdoughPage(), embedInfoPage(), datasetPage()];
  Object.keys(DATA.categories).forEach((k) => { const p = categoryPage(k); if (p) pages.push(p); });
  DATA.ingredients.forEach((i) => pages.push(ingredientPage(i)));
  pages.forEach((p) => writePage(p.canonical, p.html));
  // bare embeddable widget: written to disk but kept OUT of the sitemap (it's noindex)
  { const ew = embedWidgetPage(); writePage(ew.canonical, ew.html); }

  // assets
  fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "assets", "app.js"), path.join(OUT, "assets", "app.js"));

  // open-data downloads served from our own domain (next to the dataset page)
  { const df = datasetFiles();
    fs.writeFileSync(path.join(OUT, "ingredient-density-data", "ingredient-density.csv"), df.csv);
    fs.writeFileSync(path.join(OUT, "ingredient-density-data", "ingredient-density.json"), df.json); }

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
