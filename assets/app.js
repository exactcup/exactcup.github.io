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

  // Reverse master: weight-first (grams -> cups), used by /grams-to-cups/.
  function initRMaster(c) {
    var sel = $("ingredient");
    if (!sel) return;
    var map = {};
    c.ingredients.forEach(function (i) { map[i.slug] = i; });
    function current() { return map[sel.value] || c.ingredients[0]; }
    var grams = $("grams"), unit = $("unit"), amount = $("amount");
    var outA = $("out-amount"), outOz = $("out-oz");
    function factorFor(gpc, u) { return u === "tbsp" ? gpc / 16 : u === "tsp" ? gpc / 48 : gpc; }
    function recompute() {
      var gpc = current().gramsPerCup, g = parseFloat(grams.value);
      if (isNaN(g)) { if (outA) outA.textContent = "—"; if (outOz) outOz.textContent = "—"; if (amount) amount.value = ""; return; }
      var u = unit ? unit.value : "cups", a = g / factorFor(gpc, u);
      if (amount) amount.value = round(a, 3);
      if (outA) outA.textContent = round(a, 3) + " " + u;
      if (outOz) outOz.textContent = round(g / OZ, 2) + " oz";
    }
    sel.addEventListener("change", recompute);
    grams.addEventListener("input", recompute);
    if (unit) unit.addEventListener("change", recompute);
    if (amount) amount.addEventListener("input", function () {
      var gpc = current().gramsPerCup, a = parseFloat(amount.value);
      if (isNaN(a)) return;
      var u = unit ? unit.value : "cups", g = a * factorFor(gpc, u);
      grams.value = round(g, 1);
      if (outA) outA.textContent = round(a, 3) + " " + u;
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

  function initBakers(c) {
    var flour = $("bp-flour"), tbody = $("bp-rows"), addBtn = $("bp-add"),
      totalEl = $("bp-total"), hydEl = $("bp-hyd");
    if (!flour || !tbody) return;
    function fnum(el) { var v = parseFloat(el.value); return isNaN(v) ? NaN : v; }
    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
    function rowHtml(name, pct) {
      return '<tr>' +
        '<td><input class="bp-name" type="text" value="' + esc(name) + '" placeholder="ingredient"></td>' +
        '<td><input class="bp-wt" type="number" inputmode="decimal" step="any" min="0"></td>' +
        '<td><input class="bp-pct" type="number" inputmode="decimal" step="any" min="0" value="' + (pct != null && pct !== "" ? pct : "") + '"></td>' +
        '<td><button type="button" class="bp-del" aria-label="Remove ingredient" title="Remove">×</button></td>' +
        '</tr>';
    }
    function rows() { return tbody.querySelectorAll("tr"); }
    function updateTotals() {
      var f = fnum(flour);
      var totalW = isFinite(f) ? f : 0, totalPct = isFinite(f) ? 100 : 0, any = isFinite(f);
      [].forEach.call(rows(), function (tr) {
        var wt = fnum(tr.querySelector(".bp-wt")), pct = fnum(tr.querySelector(".bp-pct"));
        if (isFinite(wt)) { totalW += wt; any = true; }
        if (isFinite(pct)) totalPct += pct;
      });
      if (totalEl) totalEl.textContent = any ? round(totalW, 0) + " g total dough" : "—";
      if (hydEl) hydEl.textContent = isFinite(f) ? "Formula total: " + round(totalPct, 1) + "% of flour" : "Enter a flour weight to begin";
    }
    function recalcWeightsFromPct() {
      var f = fnum(flour);
      [].forEach.call(rows(), function (tr) {
        var pct = fnum(tr.querySelector(".bp-pct")), wt = tr.querySelector(".bp-wt");
        wt.value = (isFinite(f) && isFinite(pct)) ? round(f * pct / 100, 1) : "";
      });
      updateTotals();
    }
    tbody.addEventListener("input", function (e) {
      var t = e.target, tr = t.parentNode && t.parentNode.parentNode, f = fnum(flour);
      if (!tr) return;
      if (t.className.indexOf("bp-wt") > -1) {
        var wt = fnum(t), pctEl = tr.querySelector(".bp-pct");
        pctEl.value = (isFinite(f) && f > 0 && isFinite(wt)) ? round(wt / f * 100, 2) : "";
        updateTotals();
      } else if (t.className.indexOf("bp-pct") > -1) {
        var pct = fnum(t), wtEl = tr.querySelector(".bp-wt");
        wtEl.value = (isFinite(f) && isFinite(pct)) ? round(f * pct / 100, 1) : "";
        updateTotals();
      }
    });
    tbody.addEventListener("click", function (e) {
      if (e.target.className.indexOf("bp-del") > -1) {
        var tr = e.target.parentNode.parentNode;
        tr.parentNode.removeChild(tr);
        updateTotals();
      }
    });
    flour.addEventListener("input", recalcWeightsFromPct);
    if (addBtn) addBtn.addEventListener("click", function () { tbody.insertAdjacentHTML("beforeend", rowHtml("", "")); });
    (c.rows || []).forEach(function (r) { tbody.insertAdjacentHTML("beforeend", rowHtml(r.name, r.pct)); });
    recalcWeightsFromPct();
  }

  function initYeast() {
    var amount = $("y-amount"), unit = $("y-unit"), from = $("y-from");
    if (!amount || !from) return;
    // Strength-equivalent weight ratio: instant 1 : active dry 1.25 : fresh 3.
    var W = { active: 1.25, instant: 1, fresh: 3 };
    var TSP_G = 3.1, PACKET_G = 7; // dry yeast: ~3.1 g/tsp, 7 g/packet
    function set(id, txt) { var el = $(id); if (el) el.textContent = txt; }
    function calc() {
      var a = parseFloat(amount.value);
      var u = unit ? unit.value : "g";
      var f = from.value;
      var gSrc = isNaN(a) ? NaN : a * (u === "tsp" ? TSP_G : u === "packet" ? PACKET_G : 1);
      ["active", "instant", "fresh"].forEach(function (type) {
        var g = isFinite(gSrc) ? gSrc * (W[type] / W[f]) : NaN;
        set("y-" + type + "-g", isFinite(g) ? round(g, 2) + " g" : "—");
        if (type === "fresh") {
          // fresh yeast is measured by weight, not spoons/packets
          set("y-fresh-t", "—"); set("y-fresh-p", "—");
        } else {
          set("y-" + type + "-t", isFinite(g) ? round(g / TSP_G, 2) + " tsp" : "—");
          set("y-" + type + "-p", isFinite(g) ? round(g / PACKET_G, 2) : "—");
        }
      });
    }
    amount.addEventListener("input", calc);
    if (unit) unit.addEventListener("change", calc);
    from.addEventListener("change", calc);
    calc();
  }

  function initSourdough() {
    var flour = $("sd-flour"), water = $("sd-water"), starter = $("sd-starter"),
      shyd = $("sd-shyd"), salt = $("sd-salt"), target = $("sd-target");
    if (!flour || !water) return;
    function set(id, txt) { var el = $(id); if (el) el.textContent = txt; }
    function num(el) { var v = el ? parseFloat(el.value) : NaN; return isNaN(v) || v < 0 ? 0 : v; }
    function calc() {
      var F = num(flour), W = num(water), S = num(starter), saltG = num(salt);
      var sh = shyd ? parseFloat(shyd.value) : 100;
      if (!isFinite(sh) || sh < 0) sh = 100;
      // A starter at hydration sh% is flour + flour*sh/100 by weight.
      var sf = S / (1 + sh / 100), sw = S - sf;
      var TF = F + sf, TW = W + sw;
      if (TF <= 0) {
        ["sd-hyd", "sd-tf", "sd-tw", "sd-saltpct", "sd-pff", "sd-dough", "sd-target-out"].forEach(function (i) { set(i, "—"); });
        set("sd-hyd", "Enter flour to begin");
        return;
      }
      set("sd-hyd", round(TW / TF * 100, 1) + "% hydration");
      set("sd-tf", round(TF, 0) + " g");
      set("sd-tw", round(TW, 0) + " g");
      set("sd-saltpct", round(saltG / TF * 100, 2) + "%");
      set("sd-pff", round(sf / TF * 100, 1) + "%");
      set("sd-dough", round(F + W + S + saltG, 0) + " g");
      var T = target ? parseFloat(target.value) : NaN;
      if (isFinite(T) && T > 0) {
        var need = T / 100 * TF - sw;
        if (need < 0) { set("sd-target-out", "0 g — the starter alone is wetter than this target"); }
        else {
          var diff = need - W;
          set("sd-target-out", round(need, 0) + " g (" + (diff >= 0 ? "+" : "") + round(diff, 0) + " g vs. current water)");
        }
      } else set("sd-target-out", "—");
    }
    [flour, water, starter, shyd, salt, target].forEach(function (el) { if (el) el.addEventListener("input", calc); });
    calc();
  }

  // Halving/scaling a single kitchen measurement (used by /recipe-halving-chart/).
  // Works in teaspoons internally (1 cup = 16 tbsp = 48 tsp) and renders results
  // the way a cook would measure them: "1/4 cup + 2 tbsp", "2 tbsp + 2 tsp", …
  function initHalve() {
    var amt = $("amt"), unit = $("unit");
    var oh = $("out-half"), ot = $("out-third"), od = $("out-double");
    if (!amt || !oh) return;
    // accepts "3/4", "1 1/2", "0.75", "2"
    function parseAmt(s) {
      s = (s || "").trim();
      var m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
      if (m) return +m[1] + m[2] / m[3];
      m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (m && +m[2] > 0) return m[1] / m[2];
      var f = parseFloat(s);
      return /^\d*\.?\d+$/.test(s) && isFinite(f) ? f : NaN;
    }
    var TSP_FR = [[0.0625, "1/16"], [0.125, "1/8"], [1 / 6, "1/6"], [0.25, "1/4"], [1 / 3, "1/3"], [0.375, "3/8"], [0.5, "1/2"], [2 / 3, "2/3"], [0.75, "3/4"], [5 / 6, "5/6"], [0.875, "7/8"]];
    function fmtTspAmt(x) {
      var whole = Math.floor(x + 1e-9), rest = x - whole, frac = "";
      if (rest > 0.03) {
        for (var i = 0; i < TSP_FR.length; i++) if (Math.abs(rest - TSP_FR[i][0]) < 0.02) { frac = TSP_FR[i][1]; break; }
        if (!frac) return round(x, 2);
      }
      return whole ? whole + (frac ? " " + frac : "") : (frac || "0");
    }
    function fmtTsp(t) {
      if (!(t > 0)) return "0";
      var out = [], whole = Math.floor(t / 48 + 1e-9), rem = t - whole * 48, frac = "";
      var EXACT = [[36, "3/4"], [32, "2/3"], [24, "1/2"], [16, "1/3"], [12, "1/4"]];
      for (var i = 0; i < EXACT.length; i++) if (Math.abs(rem - EXACT[i][0]) < 1e-6) { frac = EXACT[i][1]; rem = 0; break; }
      if (!frac) {
        // otherwise absorb the largest quarter-based cup fraction (thirds only when exact)
        var Q = [[36, "3/4"], [24, "1/2"], [12, "1/4"]];
        for (i = 0; i < Q.length; i++) if (rem >= Q[i][0] - 1e-9) { frac = Q[i][1]; rem -= Q[i][0]; break; }
      }
      if (whole || frac) out.push((whole ? whole + (frac ? " " + frac : "") : frac) + " cup" + (whole > 1 || (whole === 1 && frac) ? "s" : ""));
      var tbsp = Math.floor(rem / 3 + 1e-9);
      rem -= tbsp * 3;
      if (tbsp) out.push(tbsp + " tbsp");
      if (rem > 0.03) out.push(fmtTspAmt(rem) + " tsp");
      if (!out.length) return "a dash (under 1/16 tsp)";
      var s = out.join(" + ");
      // for cup-fraction answers that are also a clean number of tablespoons, say so
      var tb = t / 3;
      if (t <= 24 + 1e-6 && Math.abs(tb - Math.round(tb)) < 1e-6 && Math.round(tb) >= 2 && s.indexOf("cup") > -1 && s.indexOf(" + ") > -1) s += " (= " + Math.round(tb) + " tbsp)";
      return s;
    }
    function toTsp(a, u) { return u === "cups" ? a * 48 : u === "tbsp" ? a * 3 : a; }
    function recompute() {
      var a = parseAmt(amt.value);
      if (isNaN(a) || a < 0) { oh.textContent = "—"; ot.textContent = "One third (1/3×): —"; od.textContent = "Double (2×): —"; return; }
      var t = toTsp(a, unit ? unit.value : "cups");
      oh.textContent = fmtTsp(t / 2);
      ot.textContent = "One third (1/3×): " + fmtTsp(t / 3);
      od.textContent = "Double (2×): " + fmtTsp(t * 2);
    }
    amt.addEventListener("input", recompute);
    if (unit) unit.addEventListener("change", recompute);
    recompute();
  }

  var c = cfg();
  var t = c.type;
  if (t === "ingredient") initIngredient(c);
  else if (t === "master") initMaster(c);
  else if (t === "rmaster") initRMaster(c);
  else if (t === "scaler") initScaler();
  else if (t === "oven") initOven();
  else if (t === "butter") initButter();
  else if (t === "airfryer") initAirfryer();
  else if (t === "pansize") initPansize(c);
  else if (t === "volume") initVolume();
  else if (t === "portion") initPortion(c);
  else if (t === "pizza") initPizza();
  else if (t === "bakers") initBakers(c);
  else if (t === "yeast") initYeast();
  else if (t === "sourdough") initSourdough();
  else if (t === "halve") initHalve();
})();
