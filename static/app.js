(function () {
  "use strict";

  var CCY_NAMES = { EUR: "Euro", JPY: "Yen", MXN: "Peso", GBP: "Pound", CNY: "Yuan" };
  var SERIES_VARS = ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5"];

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function fmtPct(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return n.toFixed(digits == null ? 1 : digits);
  }

  function setText(el, text) {
    el.textContent = text == null ? "" : String(text);
  }

  // --------------------------- Ticker strip ---------------------------
  function renderTicker(kalshi, polymarket) {
    var strip = document.getElementById("tickerStrip");
    strip.innerHTML = "";

    var items = []
      .concat((kalshi || []).map(function (m) { return Object.assign({}, m); }))
      .concat((polymarket || []).map(function (m) { return Object.assign({}, m); }));

    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "ticker-loading";
      empty.textContent = "No live market data available right now — try reloading in a few minutes.";
      strip.appendChild(empty);
      return;
    }

    items.sort(function (a, b) {
      var am = Math.abs(a.change || 0), bm = Math.abs(b.change || 0);
      if (bm !== am) return bm - am;
      return (b.volume || 0) - (a.volume || 0);
    });

    items.forEach(function (m) {
      var a = document.createElement("a");
      a.className = "ticker-item";
      a.href = m.url || "#";
      a.target = "_blank";
      a.rel = "noopener";

      var src = document.createElement("div");
      src.className = "ticker-source";
      setText(src, m.source === "kalshi" ? "Kalshi" : "Polymarket");
      a.appendChild(src);

      var title = document.createElement("div");
      title.className = "ticker-title";
      setText(title, m.title || m.label || "");
      a.appendChild(title);

      var stats = document.createElement("div");
      stats.className = "ticker-stats";

      var prob = document.createElement("span");
      prob.className = "ticker-prob";
      setText(prob, m.probability == null ? "—" : fmtPct(m.probability, 0) + "%");
      stats.appendChild(prob);

      var chg = document.createElement("span");
      if (m.change === null || m.change === undefined) {
        chg.className = "ticker-change flat";
        setText(chg, "vol " + compactNumber(m.volume));
      } else if (m.change > 0) {
        chg.className = "ticker-change up";
        setText(chg, "▲ " + fmtPct(Math.abs(m.change), 1) + "pt");
      } else if (m.change < 0) {
        chg.className = "ticker-change down";
        setText(chg, "▼ " + fmtPct(Math.abs(m.change), 1) + "pt");
      } else {
        chg.className = "ticker-change flat";
        setText(chg, "flat");
      }
      stats.appendChild(chg);

      a.appendChild(stats);

      if (m.change !== null && m.change !== undefined) {
        var vol = document.createElement("div");
        vol.className = "ticker-vol";
        setText(vol, "vol " + compactNumber(m.volume));
        a.appendChild(vol);
      }

      strip.appendChild(a);
    });
  }

  function compactNumber(n) {
    n = n || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return Math.round(n).toString();
  }

  // ------------------------------ FX chart ------------------------------
  var fxState = { dates: [], series: {}, pairs: [] };

  function buildFxChart(fx) {
    var pairs = Object.keys(fx.series || {});
    fxState = { dates: fx.dates || [], series: fx.series || {}, pairs: pairs };

    setText(document.getElementById("fxAsOf"), fx.as_of ? "As of " + fx.as_of : "");

    renderLegend(pairs);
    renderTable(fx.table || []);
    drawChart();

    window.addEventListener("resize", debounce(drawChart, 150));
  }

  function renderLegend(pairs) {
    var legend = document.getElementById("fxLegend");
    legend.innerHTML = "";
    pairs.forEach(function (ccy, i) {
      var item = document.createElement("div");
      item.className = "fx-legend-item";

      var sw = document.createElement("span");
      sw.className = "fx-legend-swatch";
      sw.style.background = cssVar(SERIES_VARS[i % SERIES_VARS.length]);
      item.appendChild(sw);

      var label = document.createElement("span");
      setText(label, ccy + " — " + (CCY_NAMES[ccy] || ""));
      item.appendChild(label);

      legend.appendChild(item);
    });
  }

  function renderTable(rows) {
    var wrap = document.getElementById("fxTable");
    wrap.innerHTML = "";
    var table = document.createElement("table");
    table.className = "fx-table";

    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    ["Currency", "Now", "3 months ago", "1 year ago", "1yr % chg"].forEach(function (h) {
      var th = document.createElement("th");
      setText(th, h);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      var pctChg = (row.now != null && row.one_year_ago)
        ? ((row.now - row.one_year_ago) / row.one_year_ago * 100)
        : null;

      [
        row.currency + " (" + (CCY_NAMES[row.currency] || "") + ")",
        row.now,
        row.three_months_ago,
        row.one_year_ago,
        pctChg == null ? "—" : (pctChg > 0 ? "+" : "") + fmtPct(pctChg, 1) + "%",
      ].forEach(function (val, i) {
        var td = document.createElement("td");
        setText(td, typeof val === "number" ? val.toFixed(4) : val);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  var PAD = { left: 10, right: 58, top: 16, bottom: 26 };
  var VB_W = 880, VB_H = 320;

  function drawChart() {
    var svg = document.getElementById("fxChart");
    var dates = fxState.dates, pairs = fxState.pairs, series = fxState.series;
    if (!dates.length || !pairs.length) return;

    svg.setAttribute("viewBox", "0 0 " + VB_W + " " + VB_H);
    svg.innerHTML = "";

    var allVals = [];
    pairs.forEach(function (ccy) {
      (series[ccy] || []).forEach(function (v) { if (v != null) allVals.push(v); });
    });
    var min = Math.min.apply(null, allVals.concat([100]));
    var max = Math.max.apply(null, allVals.concat([100]));
    var span = max - min || 1;
    min -= span * 0.08;
    max += span * 0.08;

    var plotW = VB_W - PAD.left - PAD.right;
    var plotH = VB_H - PAD.top - PAD.bottom;
    var n = dates.length;

    function xAt(i) { return PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW); }
    function yAt(v) { return PAD.top + plotH - ((v - min) / (max - min)) * plotH; }

    var ns = "http://www.w3.org/2000/svg";
    function el(tag, attrs) {
      var e = document.createElementNS(ns, tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    }

    // Gridlines (horizontal, hairline, recessive) + baseline at 100
    var gridColor = cssVar("--border");
    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var v = min + (max - min) * (t / ticks);
      var y = yAt(v);
      svg.appendChild(el("line", {
        x1: PAD.left, x2: VB_W - PAD.right, y1: y, y2: y,
        stroke: gridColor, "stroke-width": 1,
      }));
      var txt = el("text", {
        x: VB_W - PAD.right + 8, y: y + 3, fill: cssVar("--text-muted"),
        "font-size": 10, "font-family": "var(--font-mono)",
      });
      txt.textContent = Math.round(v);
      svg.appendChild(txt);
    }

    // Series lines
    var endDots = [];
    pairs.forEach(function (ccy, i) {
      var vals = series[ccy] || [];
      var color = cssVar(SERIES_VARS[i % SERIES_VARS.length]);
      var d = "";
      var lastPt = null;
      for (var j = 0; j < vals.length; j++) {
        if (vals[j] == null) continue;
        var x = xAt(j), y = yAt(vals[j]);
        d += (d ? "L" : "M") + x.toFixed(2) + "," + y.toFixed(2);
        lastPt = { x: x, y: y, v: vals[j] };
      }
      if (d) {
        svg.appendChild(el("path", {
          d: d, fill: "none", stroke: color, "stroke-width": 2,
          "stroke-linecap": "round", "stroke-linejoin": "round",
        }));
      }
      if (lastPt) {
        endDots.push({ ccy: ccy, color: color, pt: lastPt });
      }
    });

    // End dots (8px, surface ring) + direct labels (text-secondary, never series color)
    var surface = cssVar("--surface-1");
    endDots.forEach(function (e2) {
      svg.appendChild(el("circle", {
        cx: e2.pt.x, cy: e2.pt.y, r: 6, fill: surface, stroke: e2.color, "stroke-width": 2,
      }));
      var label = el("text", {
        x: e2.pt.x + 10, y: e2.pt.y + 4, fill: cssVar("--text-secondary"),
        "font-size": 11, "font-family": "var(--font-mono)", "font-weight": 600,
      });
      label.textContent = e2.ccy;
      svg.appendChild(label);
    });

    // Hover layer: crosshair + wide hit rect
    var crosshair = el("line", {
      x1: 0, x2: 0, y1: PAD.top, y2: VB_H - PAD.bottom,
      stroke: cssVar("--text-muted"), "stroke-width": 1, "stroke-dasharray": "2,3",
      opacity: 0,
    });
    svg.appendChild(crosshair);

    var hit = el("rect", {
      x: PAD.left, y: PAD.top, width: plotW, height: plotH,
      fill: "transparent", style: "cursor:crosshair",
    });
    hit.setAttribute("tabindex", "0");
    svg.appendChild(hit);

    var tooltip = document.getElementById("fxTooltip");

    function showAtIndex(idx) {
      idx = Math.max(0, Math.min(n - 1, idx));
      var x = xAt(idx);
      crosshair.setAttribute("x1", x);
      crosshair.setAttribute("x2", x);
      crosshair.setAttribute("opacity", 1);

      tooltip.innerHTML = "";
      var dateRow = document.createElement("div");
      dateRow.className = "tt-date";
      setText(dateRow, dates[idx]);
      tooltip.appendChild(dateRow);

      pairs.forEach(function (ccy, i) {
        var v = (series[ccy] || [])[idx];
        var row = document.createElement("div");
        row.className = "tt-row";
        var key = document.createElement("span");
        key.className = "tt-key";
        key.style.background = cssVar(SERIES_VARS[i % SERIES_VARS.length]);
        row.appendChild(key);
        var name = document.createElement("span");
        setText(name, ccy);
        row.appendChild(name);
        var val = document.createElement("span");
        val.className = "tt-val";
        setText(val, v == null ? "—" : v.toFixed(1));
        row.appendChild(val);
        tooltip.appendChild(row);
      });

      var rect = svg.getBoundingClientRect();
      var px = rect.left + (x / VB_W) * rect.width;
      var py = rect.top + (yAt(100) / VB_H) * rect.height;
      tooltip.style.left = (px - rect.left) + "px";
      tooltip.style.top = (py - rect.top) + "px";
      tooltip.hidden = false;
    }

    function hideTooltip() {
      crosshair.setAttribute("opacity", 0);
      tooltip.hidden = true;
    }

    hit.addEventListener("pointermove", function (ev) {
      var rect = svg.getBoundingClientRect();
      var relX = (ev.clientX - rect.left) / rect.width * VB_W;
      var idx = Math.round(((relX - PAD.left) / plotW) * (n - 1));
      showAtIndex(idx);
    });
    hit.addEventListener("pointerleave", hideTooltip);

    var kbIndex = n - 1;
    hit.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowLeft") { kbIndex = Math.max(0, kbIndex - 1); showAtIndex(kbIndex); ev.preventDefault(); }
      else if (ev.key === "ArrowRight") { kbIndex = Math.min(n - 1, kbIndex + 1); showAtIndex(kbIndex); ev.preventDefault(); }
    });
    hit.addEventListener("blur", hideTooltip);
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  // ------------------------------ Table toggle ------------------------------
  document.getElementById("fxTableToggle").addEventListener("click", function () {
    var chartWrap = document.getElementById("fxChartWrap");
    var legend = document.getElementById("fxLegend");
    var table = document.getElementById("fxTable");
    var showingTable = !table.hidden;
    if (showingTable) {
      table.hidden = true;
      chartWrap.hidden = false;
      legend.hidden = false;
      this.textContent = "View as table";
      this.setAttribute("aria-pressed", "false");
    } else {
      table.hidden = false;
      chartWrap.hidden = true;
      legend.hidden = true;
      this.textContent = "View as chart";
      this.setAttribute("aria-pressed", "true");
    }
  });

  // ------------------------------ Boot ------------------------------
  function setStatus(state, text) {
    var dot = document.getElementById("statusDot");
    dot.className = "status-dot " + state;
    setText(document.getElementById("statusText"), text);
  }

  fetch("/api/snapshot")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      renderTicker(data.kalshi, data.polymarket);
      buildFxChart(data.fx || {});
      var genDate = new Date(data.generated_at * 1000);
      setText(document.getElementById("generatedAt"), "Snapshot generated " + genDate.toLocaleString());
      setStatus("live", "Live — updated " + genDate.toLocaleTimeString());
    })
    .catch(function (err) {
      setStatus("stale", "Couldn't load live data — try reloading.");
      var strip = document.getElementById("tickerStrip");
      strip.innerHTML = "";
      var e = document.createElement("div");
      e.className = "ticker-loading";
      e.textContent = "Couldn't load live data right now.";
      strip.appendChild(e);
      console.error(err);
    });
})();
