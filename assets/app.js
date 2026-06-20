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

  function initAirfryer() {
    var of = $("oven-f"), ot = $("oven-time"), af = $("af-temp"), at = $("af-time");
    if (!of || !ot) return;
    function calc() {
      var f = parseFloat(of.value), tm = parseFloat(ot.value);
      af.textContent = isNaN(f) ? "—" : Math.round(f - 25) + " °F";
      at.textContent = isNaN(tm) ? "—" : round(tm * 0.8, 0) + " min";
    }
    of.addEventListener("input", calc);
    ot.addEventListener("input", calc);
    calc();
  }

  function initPansize(c) {
    var from = $("pan-from"), to = $("pan-to"), out = $("pan-out"), note = $("pan-note");
    if (!from || !to) return;
    var areas = {};
    c.pans.forEach(function (p) { areas[p.id] = p.area; });
    function calc() {
      var a1 = areas[from.value], a2 = areas[to.value];
      if (!a1 || !a2) { out.textContent = "—"; return; }
      var r = a2 / a1;
      out.textContent = "×" + round(r, 2);
      var pct = Math.round((r - 1) * 100);
      note.textContent = r === 1 ? "Same size — no change needed." :
        "Your new pan holds " + (pct > 0 ? pct + "% more" : (-pct) + "% less") +
        ". Multiply each ingredient by " + round(r, 2) + ". Keep the temperature the same; " +
        (r > 1 ? "a thinner batter may bake a little faster" : "a deeper batter may need a few extra minutes") + " — check for doneness.";
    }
    from.addEventListener("change", calc);
    to.addEventListener("change", calc);
    calc();
  }

  function initVolume() {
    // base unit: ml
    var U = { cups: 236.588, tbsp: 14.7868, tsp: 4.92892, floz: 29.5735, ml: 1, l: 1000 };
    var ids = Object.keys(U), lock = false;
    function setAll(ml, except) {
      lock = true;
      ids.forEach(function (id) {
        if (id === except) return;
        var el = $(id); if (!el) return;
        el.value = isFinite(ml) ? round(ml / U[id], 3) : "";
      });
      lock = false;
    }
    ids.forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener("input", function () {
        if (lock) return;
        var v = parseFloat(el.value);
        setAll(isNaN(v) ? NaN : v * U[id], id);
      });
    });
  }

  function initPortion(c) {
    var food = $("food"), people = $("people"), out = $("portion-out"), note = $("portion-note");
    if (!food || !people) return;
    var map = {};
    c.foods.forEach(function (f) { map[f.slug] = f; });
    function calc() {
      var f = map[food.value], n = parseFloat(people.value);
      if (!f || isNaN(n) || n <= 0) { out.textContent = "—"; if (note) note.textContent = ""; return; }
      out.textContent = round(f.g * n, 0) + " g  (" + f.g + " g/person)";
      if (note) note.textContent = f.note || "";
    }
    food.addEventListener("change", calc);
    people.addEventListener("input", calc);
    calc();
  }

  function initPizza() {
    var balls = $("balls"), bw = $("ball-weight"), hyd = $("hydration"),
      salt = $("salt-pct"), yeast = $("yeast-pct"), oil = $("oil-pct");
    if (!balls || !bw) return;
    function set(id, v, d) { var el = $(id); if (el) el.textContent = isFinite(v) ? round(v, d) + " g" : "—"; }
    function calc() {
      var n = parseFloat(balls.value), w = parseFloat(bw.value);
      var h = parseFloat(hyd.value) || 0, s = parseFloat(salt.value) || 0,
        y = parseFloat(yeast.value) || 0, o = oil ? parseFloat(oil.value) || 0 : 0;
      if (isNaN(n) || isNaN(w) || n <= 0 || w <= 0) { ["out-flour","out-water","out-salt","out-yeast","out-oil","out-total"].forEach(function(i){set(i,NaN);}); return; }
      var total = n * w;
      var flour = total / (1 + h / 100 + s / 100 + y / 100 + o / 100);
      set("out-flour", flour, 0); set("out-water", flour * h / 100, 0);
      set("out-salt", flour * s / 100, 1); set("out-yeast", flour * y / 100, 1);
      set("out-oil", flour * o / 100, 1); set("out-total", total, 0);
    }
    [balls, bw, hyd, salt, yeast, oil].forEach(function (el) { if (el) el.addEventListener("input", calc); });
    calc();
  }

  var c = cfg();
  var t = c.type;
  if (t === "ingredient") initIngredient(c);
  else if (t === "master") initMaster(c);
  else if (t === "scaler") initScaler();
  else if (t === "oven") initOven();
  else if (t === "butter") initButter();
  else if (t === "airfryer") initAirfryer();
  else if (t === "pansize") initPansize(c);
  else if (t === "volume") initVolume();
  else if (t === "portion") initPortion(c);
  else if (t === "pizza") initPizza();
})();
