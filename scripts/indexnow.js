#!/usr/bin/env node
/* Submit URLs to IndexNow (Bing, Yandex, etc.) for instant crawl/index.
   Usage:
     node scripts/indexnow.js                 # submit every URL in dist/sitemap.xml
     node scripts/indexnow.js <url> [<url>...] # submit specific URLs
   Requires dist/ to be built (run `node build.js` first) so the sitemap exists. */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HOST = "exactcup.github.io";
const BASE = "https://" + HOST;
const KEY = fs.readFileSync(path.join(ROOT, "data", "indexnow-key.txt"), "utf8").trim();

function urlsFromSitemap() {
  const xml = fs.readFileSync(path.join(ROOT, "dist", "sitemap.xml"), "utf8");
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function main() {
  let urls = process.argv.slice(2);
  if (!urls.length) urls = urlsFromSitemap();
  if (!urls.length) { console.error("No URLs to submit."); process.exit(1); }
  const body = { host: HOST, key: KEY, keyLocation: `${BASE}/${KEY}.txt`, urlList: urls };
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const txt = await res.text().catch(() => "");
  console.log(`IndexNow: HTTP ${res.status} — submitted ${urls.length} URL(s)` + (txt ? ` | ${txt.slice(0, 120)}` : ""));
  // 200 and 202 both mean accepted
  process.exit(res.status === 200 || res.status === 202 ? 0 : 2);
}
main().catch((e) => { console.error("IndexNow error:", e.message); process.exit(1); });
