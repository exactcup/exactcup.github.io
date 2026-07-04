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
  ["/air-fryer-conversion-calculator/", "Air Fryer Converter", "Turn any oven recipe into air-fryer time & temp."],
  ["/recipe-scaler/", "Recipe Scaler", "Scale a recipe up or down by servings, instantly."],
  ["/oven-temperature-converter/", "Oven Temperature", "°F ↔ °C ↔ gas mark, with a quick chart."],
  ["/pan-size-converter/", "Pan Size Converter", "Swapping pans? Scale the recipe by pan area."],
  ["/volume-converter/", "Volume Converter", "Cups, tablespoons, teaspoons, mL and fl oz."],
  ["/portion-calculator/", "Portion Calculator", "How much rice, pasta or potatoes per person."],
  ["/pizza-dough-calculator/", "Pizza Dough Calculator", "Exact flour, water, salt & yeast by baker's %."],
  ["/bakers-percentage-calculator/", "Baker's Percentage Calculator", "Build & scale any bread formula by baker's math."],
  ["/yeast-converter/", "Yeast Converter", "Active dry, instant & fresh yeast — swap by weight."],
  ["/sourdough-hydration-calculator/", "Sourdough Hydration", "True dough hydration with the starter counted right."],
  ["/butter-converter/", "Butter Converter", "Sticks, cups, tablespoons, grams and ounces."],
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
<p style="font-size:12px">Conversions are approximate; ingredient weights vary by brand, humidity, and how you measure. For best baking results, weigh with a kitchen scale.</p>
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
  sugar: [["/recipe-scaler/", "Recipe Scaler"], ["/volume-converter/", "Volume Converter"]],
  dairy: [["/butter-converter/", "Butter Converter"], ["/recipe-scaler/", "Recipe Scaler"]],
  baking: [["/bakers-percentage-calculator/", "Baker's Percentage Calculator"], ["/oven-temperature-converter/", "Oven Temperature Converter"], ["/air-fryer-conversion-calculator/", "Air Fryer Converter"], ["/pan-size-converter/", "Pan Size Converter"]],
  grain: [["/portion-calculator/", "Portion Calculator"], ["/recipe-scaler/", "Recipe Scaler"]],
};

function ingredientPage(ing) {
  const gpc = ing.gramsPerCup;
  const related = DATA.ingredients.filter((i) => i.category === ing.category && i.slug !== ing.slug).slice(0, 6);
  // Reverse hub is relevant to every ingredient; category tools add depth.
  const toolLinks = [["/grams-to-cups/", "Grams to Cups Converter"], ...(CATEGORY_TOOLS[ing.category] || [])];
  const title = `${ing.name} Cups to Grams Converter | 1 Cup ${ing.name} in Grams`;
  const description = ing.slug === "butter"
    ? `How many grams is a cup of butter? 1 cup = ${g2(gpc)} g, 1 stick = ${g2(gpc / 2)} g, 1/2 cup = ${g2(gpc / 2)} g. Free butter converter with a full cups, sticks, tablespoons and grams chart.`
    : `How many grams is a cup of ${ing.name.toLowerCase()}? 1 cup of ${ing.name.toLowerCase()} = ${g2(gpc)} g. Free instant cups-to-grams converter with a full conversion chart.`;
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
<p>Use the <a href="/cups-to-grams/">cups to grams converter</a> to turn a cup measurement into grams, or jump to a category chart above. Looking for butter in sticks? Try the <a href="/butter-converter/">butter converter</a>.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg }) };
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
<p class="note">Tip: scaling works for most ingredients, but baking times, pan sizes, and leavening (baking soda/powder) don't always scale linearly. Adjust with judgment for big changes.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: appLd("Recipe Scaler", description, canonical), cfg: { type: "scaler" } }) };
}

function ovenPage() {
  const title = "Oven Temperature Converter — °F to °C to Gas Mark | ExactCup";
  const description = "Convert oven temperatures between Fahrenheit, Celsius and gas mark instantly, with a full conversion chart for common baking temperatures.";
  const canonical = "/oven-temperature-converter/";
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
<p class="note">For fan/convection ovens, reduce the Celsius temperature by about 20°C (or ~25°F) from conventional recipes.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: appLd("Oven Temperature Converter", description, canonical), cfg: { type: "oven" } }) };
}

function butterPage() {
  const title = "Butter Converter — Sticks, Cups, Tablespoons & Grams | ExactCup";
  const description = "Convert butter between sticks, cups, tablespoons, teaspoons, grams and ounces instantly. 1 stick of butter = 113 g = 8 tablespoons = 1/2 cup.";
  const canonical = "/butter-converter/";
  const f = (lab, id, ph) => `<div class="field"><label for="${id}">${lab}</label><input id="${id}" type="number" inputmode="decimal" step="any" placeholder="${ph}"></div>`;
  const body = `
<h1>Butter Converter</h1>
<p class="lead">US butter sticks, cups, tablespoons, grams and ounces — type any field and the rest update.</p>
<div class="calc">
  <div class="row">${f("Sticks", "sticks", "1")}${f("Cups", "cups", "0.5")}${f("Tablespoons", "tbsp", "8")}</div>
  <div class="row" style="margin-top:10px">${f("Teaspoons", "tsp", "24")}${f("Grams", "grams", "113.5")}${f("Ounces", "oz", "4")}</div>
</div>
<h2>Butter conversion chart</h2>
<table><thead><tr><th>Butter</th><th>Tablespoons</th><th>Grams</th><th>Ounces</th></tr></thead><tbody>
<tr><td>1 stick (½ cup)</td><td class="num">8</td><td class="num">113.5 g</td><td class="num">4 oz</td></tr>
<tr><td>½ stick (¼ cup)</td><td class="num">4</td><td class="num">57 g</td><td class="num">2 oz</td></tr>
<tr><td>2 sticks (1 cup)</td><td class="num">16</td><td class="num">227 g</td><td class="num">8 oz</td></tr>
</tbody></table>
<p class="note">Based on US butter: 1 cup = 227 g, 1 stick = 113.5 g. European butter is often sold in 250 g blocks.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: appLd("Butter Converter", description, canonical), cfg: { type: "butter" } }) };
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
<p class="note">This scales by pan area (and so by batter volume). For big jumps, also adjust bake time and check doneness — depth changes how heat reaches the center.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: appLd("Cake Pan Size Converter", description, canonical), cfg: { type: "pansize", pans: PANS.map(([id, , area]) => ({ id, area })) } }) };
}

function volumePage() {
  const title = "Cups to Tablespoons to Teaspoons Converter (+ mL, fl oz) | ExactCup";
  const description = "Free volume converter for cooking: cups, tablespoons, teaspoons, fluid ounces, milliliters and liters. Type any field and the rest update instantly.";
  const canonical = "/volume-converter/";
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
</tbody></table>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: appLd("Volume Converter", description, canonical), cfg: { type: "volume" } }) };
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
<p class="note">Main-dish portions based on standard meal-planning guidance (WRAP / Love Food Hate Waste). Side dishes are roughly half. Adjust for big appetites or leftovers.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: appLd("Portion Calculator", description, canonical), cfg: { type: "portion", foods: FOODS.map(([slug, , g, note]) => ({ slug, g, note })) } }) };
}

function categoryPage(key) {
  const items = DATA.ingredients.filter((i) => i.category === key);
  if (!items.length) return null;
  const cname = catName(key);
  const canonical = `/${key}-conversion-chart/`;
  const title = `${cname} Conversion Chart — Cups to Grams | ExactCup`;
  const description = `Free ${cname.toLowerCase()} conversion chart: grams per cup for ${items.slice(0, 4).map((i) => i.name.toLowerCase()).join(", ")} and more. Cups, half-cups and quarter-cups to grams at a glance.`;
  const rows = items.map((i) =>
    `<tr><td><a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a></td><td class="num">${g2(i.gramsPerCup)} g</td><td class="num">${g2(i.gramsPerCup / 2)} g</td><td class="num">${g2(i.gramsPerCup / 4)} g</td></tr>`
  ).join("");
  const jsonLd = breadcrumbLd([
    ["Cups to Grams", "/cups-to-grams/"],
    [cname, canonical],
  ]);
  const body = `
<nav style="font-size:13px;color:var(--muted);margin-bottom:6px"><a href="/cups-to-grams/">Cups to Grams</a> › ${esc(cname)}</nav>
<h1>${esc(cname)} Conversion Chart</h1>
<p class="lead">Grams per cup for common ${esc(cname.toLowerCase())}. Click any ingredient for a full converter and chart.</p>
<table><thead><tr><th>Ingredient</th><th>1 cup</th><th>½ cup</th><th>¼ cup</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note">Remember: every ${esc(cname.toLowerCase().replace(/s$/, ""))} has a different density, so always convert by ingredient rather than using one ratio. For other amounts, open the individual converter.</p>
<h2>Other conversion charts</h2>
<div class="chips">${Object.keys(DATA.categories).filter((k) => k !== key).map((k) => `<a href="/${k}-conversion-chart/">${esc(catName(k))}</a>`).join("")}</div>
<p style="margin-top:16px"><a href="/cups-to-grams/">← All ingredient converters</a></p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd }) };
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
    ["Recipe Scaler", "/recipe-scaler/", "Scale a recipe up or down by servings"],
    ["Oven Temperature Converter", "/oven-temperature-converter/", "Fahrenheit to Celsius to gas mark"],
    ["Air Fryer Conversion Calculator", "/air-fryer-conversion-calculator/", "Convert oven recipes to air fryer time and temperature"],
    ["Pan Size Converter", "/pan-size-converter/", "Adjust a recipe when swapping cake pan sizes (by area)"],
    ["Volume Converter", "/volume-converter/", "Cups, tablespoons, teaspoons, fluid ounces, millilitres, litres"],
    ["Portion Calculator", "/portion-calculator/", "How much rice, pasta, potatoes etc. per person"],
    ["Pizza Dough Calculator", "/pizza-dough-calculator/", "Flour, water, salt and yeast by baker's percentage"],
    ["Baker's Percentage Calculator", "/bakers-percentage-calculator/", "Build and scale any bread formula using baker's math (every ingredient as a percentage of flour)"],
    ["Yeast Converter", "/yeast-converter/", "Convert between active dry, instant and fresh yeast by weight (ratio 1 : 1.25 : 3); 1 packet = 7 g = 2¼ tsp"],
    ["Sourdough Hydration Calculator", "/sourdough-hydration-calculator/", "True dough hydration including the flour and water in the starter (any starter hydration), salt %, prefermented flour and target-hydration water"],
    ["Butter Converter", "/butter-converter/", "Sticks, cups, tablespoons, grams and ounces"],
  ];
  let out = `# ExactCup\n\n> Free, accurate cooking and baking measurement converters. Cups-to-grams for ${DATA.ingredients.length}+ ingredients (every weight verified against authoritative sources such as the King Arthur Baking ingredient weight chart and USDA), plus recipe scaler, oven temperature, air fryer, pan size, volume, portion and pizza dough calculators. All tools are free, client-side and need no sign-up. Note: 1 US cup = 236.588 ml; weights differ by ingredient because densities differ.\n\n`;
  out += `## Tools\n`;
  tools.forEach((t) => { out += `- [${t[0]}](${b}${t[1]}): ${t[2]}\n`; });
  out += `\n## Ingredient cups-to-grams reference (weight of 1 US cup)\n`;
  DATA.ingredients.forEach((i) => { out += `- [${i.name}](${b}/cups-to-grams/${i.slug}/): 1 cup = ${g2(i.gramsPerCup)} g\n`; });
  out += `\n## Conversion charts by category\n`;
  Object.keys(DATA.categories).forEach((k) => { out += `- [${catName(k)} conversion chart](${b}/${k}-conversion-chart/)\n`; });
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
  const pages = [homePage(), masterPage(), gramsToCupsPage(), scalerPage(), ovenPage(), butterPage(), airFryerPage(), panSizePage(), volumePage(), portionPage(), pizzaDoughPage(), bakersPercentagePage(), yeastPage(), sourdoughPage(), embedInfoPage()];
  Object.keys(DATA.categories).forEach((k) => { const p = categoryPage(k); if (p) pages.push(p); });
  DATA.ingredients.forEach((i) => pages.push(ingredientPage(i)));
  pages.forEach((p) => writePage(p.canonical, p.html));
  // bare embeddable widget: written to disk but kept OUT of the sitemap (it's noindex)
  { const ew = embedWidgetPage(); writePage(ew.canonical, ew.html); }

  // assets
  fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "assets", "app.js"), path.join(OUT, "assets", "app.js"));

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
