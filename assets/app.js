/* ExactCup — shared client calculator logic. Zero dependencies.
   Each page embeds <script type="application/json" id="cfg">…</script> with a `type`. */
(function () {
  "use strict";

  function cfg() {
    var el = document.getElementById("cfg");
    if (!el) return {};
    try { return JSON.parse(el.textContent); } catch (e) { return {}; }
  }
  function $(id) { return document.getElementById(id); }
  function round(n, d) {
    if (!isFinite(n)) return "";
    var f = Math.pow(10, d == null ? 2 : d);
    return String(Math.round(n * f) / f);
  }
  var OZ = 28.349523125;

  // amount in a volume unit -> grams, given grams-per-cup
  function volToGrams(amount, unit, gpc) {
    var perCup = gpc;
    var factor = unit === "tbsp" ? perCup / 16 : unit === "tsp" ? perCup / 48 : perCup;
    return amount * factor;
  }

  function initIngredient(c) {
    var gpc = c.gramsPerCup;
    var amount = $("amount"), unit = $("unit"), grams = $("grams");
    var outG = $("out-grams"), outOz = $("out-oz");
    if (!amount || !grams) return;

    function fromVolume() {
      var a = parseFloat(amount.value);
      if (isNaN(a)) { grams.value = ""; if (outG) outG.textContent = "—"; if (outOz) outOz.textContent = "—"; return; }
      var g = volToGrams(a, unit ? unit.value : "cups", gpc);
      grams.value = round(g, 1);
      if (outG) outG.textContent = round(g, 1) + " g";
      if (outOz) outOz.textContent = round(g / OZ, 2) + " oz";
    }
    function fromGrams() {
      var g = parseFloat(grams.value);
      if (isNaN(g)) { amount.value = ""; return; }
      var u = unit ? unit.value : "cups";
      var factor = u === "tbsp" ? gpc / 16 : u === "tsp" ? gpc / 48 : gpc;
      amount.value = round(g / factor, 3);
      if (outG) outG.textContent = round(g, 1) + " g";
      if (outOz) outOz.textContent = round(g / OZ, 2) + " oz";
    }
    amount.addEventListener("input", fromVolume);
    if (unit) unit.addEventListener("change", fromVolume);
    grams.addEventListener("input", fromGrams);
    fromVolume();
  }

  function initMaster(c) {
    var sel = $("ingredient");
    if (!sel) return;
    var map = {};
    c.ingredients.forEach(function (i) { map[i.slug] = i; });
    function current() { return map[sel.value] || c.ingredients[0]; }
    // reuse ingredient logic but recompute gpc dynamically
    var amount = $("amount"), unit = $("unit"), grams = $("grams");
    var outG = $("out-grams"), outOz = $("out-oz");
    function recompute() {
      var gpc = current().gramsPerCup;
      var a = parseFloat(amount.value);
      if (isNaN(a)) { if (outG) outG.textContent = "—"; if (outOz) outOz.textContent = "—"; grams.value = ""; return; }
      var g = volToGrams(a, unit.value, gpc);
      grams.value = round(g, 1);
      if (outG) outG.textContent = round(g, 1) + " g";
      if (outOz) outOz.textContent = round(g / OZ, 2) + " oz";
    }
    sel.addEventListener("change", recompute);
    amount.addEventListener("input", recompute);
    unit.addEventListener("change", recompute);
    grams.addEventListener("input", function () {
      var gpc = current().gramsPerCup, g = parseFloat(grams.value);
      if (isNaN(g)) return;
      var u = unit.value, factor = u === "tbsp" ? gpc / 16 : u === "tsp" ? gpc / 48 : gpc;
      amount.value = round(g / factor, 3);
      if (outG) outG.textContent = round(g, 1) + " g";
      if (outOz) outOz.textContent = round(g / OZ, 2) + " oz";
    });
    recompute();
  }

  function initScaler() {
    var orig = $("orig-serv"), want = $("want-serv"), list = $("ingredients-list"), out = $("scaled-out");
    if (!orig || !want) return;
    function calc() {
      var o = parseFloat(orig.value), w = parseFloat(want.value);
      var factor = (o > 0 && w > 0) ? w / o : NaN;
      $("scale-factor").textContent = isFinite(factor) ? "×" + round(factor, 3) : "—";
      if (!list) return;
      var lines = (list.value || "").split("\n");
      var res = lines.map(function (ln) {
        if (!ln.trim()) return "";
        var m = ln.match(/^\s*([\d.\/]+)\s*(.*)$/);
        if (!m || !isFinite(factor)) return ln;
        var qty = m[1].indexOf("/") > -1 ? (function (p) { return p[0] / p[1]; })(m[1].split("/").map(Number)) : parseFloat(m[1]);
        if (isNaN(qty)) return ln;
        return round(qty * factor, 3) + " " + m[2];
      });
      out.textContent = res.join("\n").trim() || "—";
    }
    [orig, want, list].forEach(function (el) { if (el) el.addEventListener("input", calc); });
    calc();
  }

  function initOven() {
    var f = $("f"), c = $("c"), gas = $("gas");
    if (!f || !c) return;
    var GAS = { "1/4": 110, "1/2": 120, "1": 140, "2": 150, "3": 170, "4": 180, "5": 190, "6": 200, "7": 220, "8": 230, "9": 240 };
    function fromF() { var v = parseFloat(f.value); if (isNaN(v)) { c.value = ""; return; } c.value = round((v - 32) * 5 / 9, 0); setGas(parseFloat(c.value)); }
    function fromC() { var v = parseFloat(c.value); if (isNaN(v)) { f.value = ""; return; } f.value = round(v * 9 / 5 + 32, 0); setGas(v); }
    function setGas(cval) {
      if (!gas) return;
      var best = "—", bd = 1e9;
      Object.keys(GAS).forEach(function (k) { var d = Math.abs(GAS[k] - cval); if (d < bd) { bd = d; best = k; } });
      gas.textContent = "Gas mark " + best;
    }
    f.addEventListener("input", fromF);
    c.addEventListener("input", fromC);
    fromF();
  }

  function initButter() {
    // base unit: grams. 1 cup = 227 g, 1 stick = 113.5 g (US), 1 tbsp = 14.1875 g
    var G_CUP = 227, G_STICK = 113.5, G_TBSP = G_CUP / 16, G_TSP = G_CUP / 48;
    var fields = { sticks: G_STICK, cups: G_CUP, tbsp: G_TBSP, tsp: G_TSP, grams: 1, oz: OZ };
    var ids = Object.keys(fields);
    var lock = false;
    function setAll(grams, except) {
      lock = true;
      ids.forEach(function (id) {
        if (id === except) return;
        var el = $(id); if (!el) return;
        el.value = isFinite(grams) ? round(grams / fields[id], 3) : "";
      });
      lock = false;
    }
    ids.forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener("input", function () {
        if (lock) return;
        var v = parseFloat(el.value);
        if (isNaN(v)) { setAll(NaN, id); return; }
        setAll(v * fields[id], id);
      });
    });
  }

  var c = cfg();
  var t = c.type;
  if (t === "ingredient") initIngredient(c);
  else if (t === "master") initMaster(c);
  else if (t === "scaler") initScaler();
  else if (t === "oven") initOven();
  else if (t === "butter") initButter();
})();
