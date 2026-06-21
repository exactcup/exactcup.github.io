#!/usr/bin/env node
/* Bing Webmaster Tools report for ExactCup ONLY.
   Reads the API key from env BING_WEBMASTER_API_KEY (never hardcoded/committed).
   Hardcoded to siteUrl = https://exactcup.github.io/ so it can never read another property.
   Usage: BING_WEBMASTER_API_KEY=... node scripts/bing-report.js  */
"use strict";

const SITE_URL = "https://exactcup.github.io/"; // exactcup only — do not change to another site
const BASE = "https://ssl.bing.com/webmaster/api.svc/json";
const KEY = process.env.BING_WEBMASTER_API_KEY;

function parseMsDate(s) {
  const m = /\/Date\((\d+)/.exec(String(s || ""));
  return m ? new Date(+m[1]).toISOString().slice(0, 10) : String(s);
}
async function call(method, extra) {
  const qs = new URLSearchParams({ apikey: KEY, siteUrl: SITE_URL, ...(extra || {}) });
  const res = await fetch(`${BASE}/${method}?${qs}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) return { error: `non-JSON ${res.status} from ${method}` };
  const j = await res.json();
  return j.d != null ? j.d : j;
}

async function main() {
  if (!KEY) { console.log("Bing: BING_WEBMASTER_API_KEY not set — skipping (set it to enable Bing reporting)."); return; }
  const out = { site: SITE_URL };
  try {
    const traffic = await call("GetRankAndTrafficStats");
    if (Array.isArray(traffic)) {
      const rows = traffic.map((r) => ({ date: parseMsDate(r.Date), impr: r.Impressions || 0, clicks: r.Clicks || 0 }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const sum = (rs) => rs.reduce((a, r) => ({ impr: a.impr + r.impr, clicks: a.clicks + r.clicks }), { impr: 0, clicks: 0 });
      out.totalDays = rows.length;
      out.last7 = sum(rows.slice(-7));
      out.last28 = sum(rows.slice(-28));
    } else out.trafficNote = "no traffic data yet";
    const q = await call("GetQueryStats");
    out.topQueries = Array.isArray(q) ? q.slice(0, 15).map((x) => ({ query: x.Query, impr: x.Impressions, clicks: x.Clicks, pos: x.AvgImpressionPosition })) : [];
    const p = await call("GetPageStats");
    out.topPages = Array.isArray(p) ? p.slice(0, 15).map((x) => ({ page: x.Query || x.Url, impr: x.Impressions, clicks: x.Clicks })) : [];
  } catch (e) {
    out.error = e.message;
  }
  console.log(JSON.stringify(out, null, 2));
}
main();
