#!/usr/bin/env node
/* ExactCup static-site generator. Zero dependencies (Node stdlib only).
   Usage: node build.js   ->   outputs to ./dist  */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUT = path.join(ROOT, "dist");
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "ingredients.json"), "utf8"));

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
  ["2/3", 2 / 3], ["3/4", 0.75], ["1", 1], ["1 1/2", 1.5], ["2", 2],
];
function g2(n) { return Math.round(n * 10) / 10; }
function ingBySlug(slug) { return DATA.ingredients.find((i) => i.slug === slug); }
function catName(key) { return DATA.categories[key] || key; }
function popular() {
  return ["all-purpose-flour", "granulated-sugar", "butter", "brown-sugar", "powdered-sugar", "milk"]
    .map(ingBySlug).filter(Boolean);
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
footer.site{border-top:1px solid var(--line);margin-top:36px;padding:22px 0;color:var(--muted);font-size:14px}
footer.site a{color:var(--muted)}
@media(max-width:520px){h1{font-size:25px}nav a{margin-left:10px}}
`;

function layout(opts) {
  const { title, description, canonical, bodyHtml, jsonLd, cfg } = opts;
  const url = SITE.baseUrl + canonical;
  const ld = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : "";
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
<p><a href="/">Home</a> · <a href="/cups-to-grams/">All ingredients</a> · <a href="/oven-temperature-converter/">Oven temps</a> · <a href="/butter-converter/">Butter</a></p>
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

function ingredientPage(ing) {
  const gpc = ing.gramsPerCup;
  const related = DATA.ingredients.filter((i) => i.category === ing.category && i.slug !== ing.slug).slice(0, 6);
  const title = `${ing.name} Cups to Grams Converter | 1 Cup ${ing.name} in Grams`;
  const description = `How many grams is a cup of ${ing.name.toLowerCase()}? 1 cup of ${ing.name.toLowerCase()} = ${g2(gpc)} g. Free instant cups-to-grams converter with a full conversion chart.`;
  const canonical = `/cups-to-grams/${ing.slug}/`;
  const faq = [
    [`How many grams is 1 cup of ${ing.name.toLowerCase()}?`, `1 US cup of ${ing.name.toLowerCase()} weighs about ${g2(gpc)} grams.`],
    [`How many grams is 1 tablespoon of ${ing.name.toLowerCase()}?`, `1 tablespoon of ${ing.name.toLowerCase()} is about ${g2(gpc / 16)} grams (a cup is 16 tablespoons).`],
    [`How many cups is 100 grams of ${ing.name.toLowerCase()}?`, `100 grams of ${ing.name.toLowerCase()} is about ${g2(100 / gpc)} cups.`],
  ];
  const jsonLd = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
  const body = `
<nav style="font-size:13px;color:var(--muted);margin-bottom:6px"><a href="/cups-to-grams/">Cups to Grams</a> › ${esc(ing.name)}</nav>
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
<p class="note">Based on ${g2(gpc)} g per US cup. Weights vary with brand and measuring method — for precise baking, use a scale.</p>
<h2>Frequently asked questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}
<h2>Other ${esc(catName(ing.category)).toLowerCase()}</h2>
<div class="chips">${related.map((r) => `<a href="/cups-to-grams/${r.slug}/">${esc(r.name)}</a>`).join("")}</div>
<p style="margin-top:18px"><a href="/cups-to-grams/">← All ingredient converters</a></p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd, cfg: { type: "ingredient", gramsPerCup: gpc } }) };
}

function masterPage() {
  const title = "Cups to Grams Converter — Every Baking Ingredient | ExactCup";
  const description = "Free cups to grams converter for flour, sugar, butter and 30+ baking ingredients. Pick an ingredient and convert cups, tablespoons and teaspoons to grams instantly.";
  const canonical = "/cups-to-grams/";
  const cats = {};
  DATA.ingredients.forEach((i) => { (cats[i.category] = cats[i.category] || []).push(i); });
  const lists = Object.keys(cats).map((k) =>
    `<h3>${esc(catName(k))}</h3><div class="chips">${cats[k].map((i) => `<a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a>`).join("")}</div>`
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
<p class="note">Why ingredient matters: 1 cup of all-purpose flour ≈ 120 g, but 1 cup of granulated sugar ≈ 200 g and 1 cup of honey ≈ 340 g. Always convert by ingredient, not by a single ratio.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, jsonLd: {
    "@context": "https://schema.org", "@type": "WebApplication", name: "Cups to Grams Converter",
    applicationCategory: "UtilitiesApplication", operatingSystem: "Any", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  }, cfg }) };
}

function homePage() {
  const title = "ExactCup — Free Cooking & Baking Measurement Converters";
  const description = "Free, accurate cooking converters: cups to grams for every ingredient, recipe scaler, oven temperature converter, and butter converter. No sign-up.";
  const canonical = "/";
  const tools = [
    ["/cups-to-grams/", "Cups to Grams", "Convert any ingredient — flour, sugar, butter & 30+ more."],
    ["/air-fryer-conversion-calculator/", "Air Fryer Converter", "Turn any oven recipe into air-fryer time & temp."],
    ["/recipe-scaler/", "Recipe Scaler", "Scale a recipe up or down by servings, instantly."],
    ["/oven-temperature-converter/", "Oven Temperature", "°F ↔ °C ↔ gas mark, with a quick chart."],
    ["/pan-size-converter/", "Pan Size Converter", "Swapping pans? Scale the recipe by pan area."],
    ["/volume-converter/", "Volume Converter", "Cups, tablespoons, teaspoons, mL and fl oz."],
    ["/butter-converter/", "Butter Converter", "Sticks, cups, tablespoons, grams and ounces."],
  ];
  const body = `
<h1>Cooking conversions that are actually accurate</h1>
<p class="lead">Free kitchen calculators that respect the difference between a cup of flour and a cup of honey. No sign-up, no fluff.</p>
<div class="grid">
${tools.map(([h, t, d]) => `<a class="card" href="${h}"><div class="t">${esc(t)}</div><div class="d">${esc(d)}</div></a>`).join("")}
</div>
<h2>Popular ingredient converters</h2>
<div class="chips">${popular().map((i) => `<a href="/cups-to-grams/${i.slug}/">${esc(i.name)}</a>`).join("")}</div>
<h2>Why weigh ingredients?</h2>
<p>Measuring by volume (cups) is convenient but imprecise — packed vs. sifted flour can differ by 30%. Weighing in grams is how professional bakers get consistent results. These converters bridge the two so you can follow any recipe, anywhere.</p>`;
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body }) };
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
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, cfg: { type: "scaler" } }) };
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
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, cfg: { type: "oven" } }) };
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
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, cfg: { type: "butter" } }) };
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
  const jsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
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
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, cfg: { type: "pansize", pans: PANS.map(([id, , area]) => ({ id, area })) } }) };
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
  return { canonical, html: layout({ title, description, canonical, bodyHtml: body, cfg: { type: "volume" } }) };
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
  const pages = [homePage(), masterPage(), scalerPage(), ovenPage(), butterPage(), airFryerPage(), panSizePage(), volumePage()];
  DATA.ingredients.forEach((i) => pages.push(ingredientPage(i)));
  pages.forEach((p) => writePage(p.canonical, p.html));

  // assets
  fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "assets", "app.js"), path.join(OUT, "assets", "app.js"));

  // sitemap + robots
  const urls = pages.map((p) => `<url><loc>${SITE.baseUrl}${p.canonical}</loc><changefreq>monthly</changefreq></url>`).join("\n");
  fs.writeFileSync(path.join(OUT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  fs.writeFileSync(path.join(OUT, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${SITE.baseUrl}/sitemap.xml\n`);
  // SPA-less 404
  fs.writeFileSync(path.join(OUT, "404.html"),
    layout({ title: "Page not found | ExactCup", description: "Page not found.", canonical: "/404.html",
      bodyHtml: `<h1>Page not found</h1><p>Try the <a href="/cups-to-grams/">cups to grams converter</a> or head <a href="/">home</a>.</p>` }));

  console.log(`Built ${pages.length} pages + sitemap/robots to ${OUT}`);
}
build();
