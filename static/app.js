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

  // --------------------------- Headlines --------------------------------
  function relativeTime(iso) {
    if (!iso) return "";
    var then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    var mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.round(hrs / 24);
    return days + "d ago";
  }

  function renderHeadlines(headlines) {
    var list = document.getElementById("headlinesList");
    list.innerHTML = "";

    if (!headlines || !headlines.length) {
      var empty = document.createElement("li");
      empty.className = "headlines-loading";
      empty.textContent = "No headlines available right now — try reloading in a few minutes.";
      list.appendChild(empty);
      return;
    }

    headlines.forEach(function (h) {
      var li = document.createElement("li");
      li.className = "headline-item";

      var meta = document.createElement("div");
      meta.className = "headline-meta";
      var src = document.createElement("span");
      src.className = "hl-source";
      setText(src, h.source || "");
      meta.appendChild(src);
      var time = document.createElement("span");
      time.className = "hl-time";
      setText(time, relativeTime(h.published));
      meta.appendChild(time);
      li.appendChild(meta);

      var a = document.createElement("a");
      a.className = "headline-title";
      a.href = h.url || "#";
      a.target = "_blank";
      a.rel = "noopener";
      setText(a, h.title || "");
      li.appendChild(a);

      list.appendChild(li);
    });
  }

  function compactNumber(n) {
    n = n || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return Math.round(n).toString();
  }

  // ------------------------------ FX charts (small multiples) ------------------------------
  var fxState = { dates: [], series: {}, pairs: [] };
  var FX_DECIMALS = { JPY: 2 };
  function decimalsFor(ccy) { return FX_DECIMALS[ccy] != null ? FX_DECIMALS[ccy] : 4; }

  function buildFxChart(fx) {
    var pairs = Object.keys(fx.series || {});
    fxState = { dates: fx.dates || [], series: fx.series || {}, pairs: pairs };

    setText(document.getElementById("fxAsOf"), fx.as_of ? "As of " + fx.as_of : "");

    renderTable(fx.table || []);
    renderFxGrid();

    window.addEventListener("resize", debounce(renderFxGrid, 150));
  }

  function renderFxGrid() {
    var grid = document.getElementById("fxChartsGrid");
    grid.innerHTML = "";
    fxState.pairs.forEach(function (ccy, i) {
      grid.appendChild(buildFxCard(ccy, i));
    });
  }

  function lastValue(vals) {
    for (var i = vals.length - 1; i >= 0; i--) {
      if (vals[i] != null) return vals[i];
    }
    return null;
  }

  function buildFxCard(ccy, i) {
    var vals = fxState.series[ccy] || [];
    var color = cssVar(SERIES_VARS[i % SERIES_VARS.length]);
    var decimals = decimalsFor(ccy);

    var card = document.createElement("div");
    card.className = "fx-card";

    var head = document.createElement("div");
    head.className = "fx-card-head";

    var idWrap = document.createElement("div");
    idWrap.className = "fx-card-id";
    var swatch = document.createElement("span");
    swatch.className = "fx-card-swatch";
    swatch.style.background = color;
    idWrap.appendChild(swatch);
    var titleEl = document.createElement("span");
    titleEl.className = "fx-card-title";
    setText(titleEl, "USD → " + ccy + " (" + (CCY_NAMES[ccy] || "") + ")");
    idWrap.appendChild(titleEl);
    head.appendChild(idWrap);

    var nowEl = document.createElement("span");
    nowEl.className = "fx-card-now";
    var lv = lastValue(vals);
    setText(nowEl, lv == null ? "—" : lv.toFixed(decimals));
    head.appendChild(nowEl);

    card.appendChild(head);

    var vizRoot = document.createElement("div");
    vizRoot.className = "viz-root";
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", ccy + " exchange rate over the trailing year");
    svg.setAttribute("class", "fx-mini-chart");
    vizRoot.appendChild(svg);

    var tooltip = document.createElement("div");
    tooltip.className = "fx-tooltip";
    tooltip.hidden = true;
    vizRoot.appendChild(tooltip);

    card.appendChild(vizRoot);

    drawMiniChart(svg, tooltip, fxState.dates, vals, color, decimals, ccy);

    return card;
  }

  var MINI_PAD = { left: 8, right: 50, top: 12, bottom: 20 };
  var MINI_VB_W = 420, MINI_VB_H = 170;

  function drawMiniChart(svg, tooltip, dates, vals, color, decimals, ccy) {
    var n = dates.length;
    svg.setAttribute("viewBox", "0 0 " + MINI_VB_W + " " + MINI_VB_H);
    svg.innerHTML = "";
    if (!n) return;

    var present = [];
    vals.forEach(function (v) { if (v != null) present.push(v); });
    if (!present.length) return;

    var min = Math.min.apply(null, present);
    var max = Math.max.apply(null, present);
    var span = max - min || Math.abs(max || 1) * 0.01;
    min -= span * 0.12;
    max += span * 0.12;

    var plotW = MINI_VB_W - MINI_PAD.left - MINI_PAD.right;
    var plotH = MINI_VB_H - MINI_PAD.top - MINI_PAD.bottom;

    function xAt(idx) { return MINI_PAD.left + (n <= 1 ? 0 : (idx / (n - 1)) * plotW); }
    function yAt(v) { return MINI_PAD.top + plotH - ((v - min) / (max - min)) * plotH; }

    var ns = "http://www.w3.org/2000/svg";
    function el(tag, attrs) {
      var e = document.createElementNS(ns, tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    }

    var gridColor = cssVar("--border");
    var ticks = 3;
    for (var t = 0; t <= ticks; t++) {
      var v = min + (max - min) * (t / ticks);
      var y = yAt(v);
      svg.appendChild(el("line", {
        x1: MINI_PAD.left, x2: MINI_VB_W - MINI_PAD.right, y1: y, y2: y,
        stroke: gridColor, "stroke-width": 1,
      }));
      var txt = el("text", {
        x: MINI_VB_W - MINI_PAD.right + 6, y: y + 3, fill: cssVar("--text-muted"),
        "font-size": 9, "font-family": "var(--font-mono)",
      });
      txt.textContent = v.toFixed(Math.min(decimals, 2));
      svg.appendChild(txt);
    }

    var d = "";
    var lastPt = null;
    for (var j = 0; j < vals.length; j++) {
      if (vals[j] == null) continue;
      var x = xAt(j), y2 = yAt(vals[j]);
      d += (d ? "L" : "M") + x.toFixed(2) + "," + y2.toFixed(2);
      lastPt = { x: x, y: y2 };
    }
    if (d) {
      svg.appendChild(el("path", {
        d: d, fill: "none", stroke: color, "stroke-width": 2,
        "stroke-linecap": "round", "stroke-linejoin": "round",
      }));
    }

    var surface = cssVar("--surface-1");
    if (lastPt) {
      svg.appendChild(el("circle", {
        cx: lastPt.x, cy: lastPt.y, r: 5, fill: surface, stroke: color, "stroke-width": 2,
      }));
    }

    var crosshair = el("line", {
      x1: 0, x2: 0, y1: MINI_PAD.top, y2: MINI_VB_H - MINI_PAD.bottom,
      stroke: cssVar("--text-muted"), "stroke-width": 1, "stroke-dasharray": "2,3",
      opacity: 0,
    });
    svg.appendChild(crosshair);

    var hit = el("rect", {
      x: MINI_PAD.left, y: MINI_PAD.top, width: plotW, height: plotH,
      fill: "transparent", style: "cursor:crosshair",
    });
    hit.setAttribute("tabindex", "0");
    svg.appendChild(hit);

    function showAtIndex(idx) {
      idx = Math.max(0, Math.min(n - 1, idx));
      var x = xAt(idx);
      crosshair.setAttribute("x1", x);
      crosshair.setAttribute("x2", x);
      crosshair.setAttribute("opacity", 1);

      var v = vals[idx];
      tooltip.innerHTML = "";
      var dateRow = document.createElement("div");
      dateRow.className = "tt-date";
      setText(dateRow, dates[idx]);
      tooltip.appendChild(dateRow);

      var row = document.createElement("div");
      row.className = "tt-row";
      var key = document.createElement("span");
      key.className = "tt-key";
      key.style.background = color;
      row.appendChild(key);
      var name = document.createElement("span");
      setText(name, ccy);
      row.appendChild(name);
      var val = document.createElement("span");
      val.className = "tt-val";
      setText(val, v == null ? "—" : v.toFixed(decimals));
      row.appendChild(val);
      tooltip.appendChild(row);

      var rect = svg.getBoundingClientRect();
      var px = rect.left + (x / MINI_VB_W) * rect.width;
      var py = rect.top + (yAt(v == null ? (min + max) / 2 : v) / MINI_VB_H) * rect.height;
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
      var relX = (ev.clientX - rect.left) / rect.width * MINI_VB_W;
      var idx = Math.round(((relX - MINI_PAD.left) / plotW) * (n - 1));
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

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  // ------------------------------ Table toggle ------------------------------
  document.getElementById("fxTableToggle").addEventListener("click", function () {
    var grid = document.getElementById("fxChartsGrid");
    var table = document.getElementById("fxTable");
    var showingTable = !table.hidden;
    if (showingTable) {
      table.hidden = true;
      grid.hidden = false;
      this.textContent = "View as table";
      this.setAttribute("aria-pressed", "false");
    } else {
      table.hidden = false;
      grid.hidden = true;
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
      renderHeadlines(data.headlines);
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
