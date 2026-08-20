/* FPL Mini-League Tracker — vanilla JS, no build step, no dependencies.
   Reads the local data/league.json only; never touches the FPL API. */

(function () {
  "use strict";

  var CHIP_ICONS = {
    wildcard: "🃏",
    bboost: "🪑",
    "3xc": "👑",
    freehit: "🎟️",
    manager: "🧑‍💼",
  };
  var CHIP_NAMES = {
    wildcard: "Wildcard",
    bboost: "Bench Boost",
    "3xc": "Triple Captain",
    freehit: "Free Hit",
    manager: "Manager chip",
  };

  var DATA = null;
  var currentView = "overall";

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) { return String(s == null ? "" : s); }

  function money(amount) {
    var cur = (DATA && DATA.prizes && DATA.prizes.currency) || "EUR";
    var sym = { EUR: "€", GBP: "£", USD: "$" }[cur] || (cur + " ");
    var n = Number(amount) || 0;
    var s = (Math.round(n * 100) / 100).toString();
    return sym + s;
  }

  function chipMarker(chip) {
    if (!chip) return "";
    var icon = CHIP_ICONS[chip] || "✦";
    var name = CHIP_NAMES[chip] || chip;
    var s = el("span", "chip");
    s.textContent = icon;
    s.title = name;
    return s.outerHTML;
  }

  function markers(m) {
    var out = "";
    if (m.prize_eligible === false) out += '<span class="pill inelig" title="Not eligible for prize money">no prize</span>';
    if (m.in_league === false) out += '<span class="pill left" title="No longer in the mini-league">left</span>';
    return out;
  }

  /* ---------------------------------------------------------------- Views */

  function renderOverall() {
    var main = $("#main");
    main.innerHTML = "";
    var members = DATA.members || [];
    if (!members.length) {
      main.appendChild(emptyState());
      return;
    }
    var card = el("div", "card");
    var tbl = el("table", "tbl");
    tbl.innerHTML =
      "<thead><tr>" +
      '<th class="rank">#</th>' +
      '<th class="name">Manager</th>' +
      "<th>Net</th><th>Hits</th><th>GW</th>" +
      "</tr></thead>";
    var tb = el("tbody");
    members.forEach(function (m, i) {
      var tr = el("tr");
      if (i === 0) tr.className = "leader";
      tr.innerHTML =
        '<td class="rank">' + (i + 1) + "</td>" +
        '<td class="name"><b>' + esc(m.player_name) + "</b>" + markers(m) +
        '<span class="team">' + esc(m.entry_name) + "</span></td>" +
        "<td><b>" + m.total_net + "</b></td>" +
        '<td class="' + (m.hits_total ? "neg" : "muted") + '">' +
        (m.hits_total ? "-" + m.hits_total : "0") + "</td>" +
        '<td class="muted">' + m.gws_played + "</td>";
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    card.appendChild(tbl);
    main.appendChild(card);
  }

  function periodStandingsTable(p) {
    var tbl = el("table", "tbl");
    tbl.innerHTML =
      "<thead><tr>" +
      '<th class="rank">#</th><th class="name">Manager</th><th>Net</th><th>GW</th>' +
      "</tr></thead>";
    var tb = el("tbody");
    var winnerIds = (p.winner && p.winner.entry_ids) || [];
    (p.standings || []).forEach(function (r, i) {
      var tr = el("tr");
      if (winnerIds.indexOf(r.entry_id) !== -1) tr.className = "leader";
      tr.innerHTML =
        '<td class="rank">' + (i + 1) + "</td>" +
        '<td class="name"><b>' + esc(r.player_name) + "</b>" +
        markers(r) +
        '<span class="team">' + esc(r.entry_name) + "</span></td>" +
        "<td><b>" + r.net + "</b></td>" +
        '<td class="muted">' + r.gws_played + "</td>";
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    return tbl;
  }

  function nameFor(entryId) {
    var m = (DATA.members || []).find(function (x) { return x.entry_id === entryId; });
    return m ? m.player_name : ("#" + entryId);
  }

  function tiebreakExplanation(winner) {
    if (!winner) return "";
    var by = winner.resolved_by;
    var ids = winner.entry_ids || [];
    if (by === "net_points") return "";
    var names = ids.map(nameFor).join(" & ");
    var d = winner.detail || {};
    var txt;
    switch (by) {
      case "head_to_head":
        txt = "Tied on net points — resolved on <b>head-to-head gameweek wins</b>.";
        break;
      case "highest_single_gw":
        txt = "Tied — resolved on <b>highest single gameweek</b>.";
        break;
      case "fewest_transfers":
        txt = "Tied — resolved on <b>fewest transfers</b>.";
        break;
      case "split":
        txt = "Still tied after all tiebreaks — prize <b>split</b> between " + esc(names) + ".";
        break;
      default:
        txt = "Resolved by " + esc(by) + ".";
    }
    return '<div class="why">' + txt + "</div>";
  }

  function renderMonthly() {
    var main = $("#main");
    main.innerHTML = "";
    var periods = DATA.periods || [];
    if (!periods.length) { main.appendChild(emptyState()); return; }

    var current = periods.filter(function (p) { return p.is_current; });
    var completed = periods.filter(function (p) { return p.complete; });
    var upcoming = periods.filter(function (p) { return !p.is_current && !p.complete; });

    if (current.length) {
      main.appendChild(el("div", "section-title", "Live now"));
      current.forEach(function (p) {
        var banner = el("div", "prize-banner");
        var lead = (p.winner && p.winner.entry_ids || []).map(nameFor).join(" & ");
        banner.innerHTML =
          "<div><b>" + esc(p.name) + "</b></div>" +
          '<div class="amt">' + money(p.prize) + "</div>" +
          '<div class="sub">' +
          (p.remaining_gws > 0
            ? p.remaining_gws + " gameweek" + (p.remaining_gws === 1 ? "" : "s") + " remaining"
            : "final gameweek scores settling") +
          (lead ? " · leading: <b>" + esc(lead) + "</b>" : "") +
          "</div>";
        main.appendChild(banner);
        var card = el("div", "card");
        card.appendChild(periodStandingsTable(p));
        main.appendChild(card);
      });
    }

    if (completed.length) {
      main.appendChild(el("div", "section-title", "Completed"));
      completed.slice().reverse().forEach(function (p) {
        main.appendChild(collapsedPeriod(p));
      });
    }

    if (upcoming.length) {
      main.appendChild(el("div", "section-title", "Upcoming"));
      upcoming.forEach(function (p) {
        var card = el("div", "card");
        var head = el("div", "card-head");
        head.innerHTML =
          '<span class="grow"><b>' + esc(p.name) + "</b></span>" +
          '<span class="muted">' + money(p.prize) + "</span>";
        card.appendChild(head);
        main.appendChild(card);
      });
    }
  }

  function collapsedPeriod(p) {
    var card = el("details", "card");
    var winnerIds = (p.winner && p.winner.entry_ids) || [];
    var names = winnerIds.map(nameFor).join(" & ");
    var isSplit = winnerIds.length > 1;
    var amt = p.winner ? money(p.winner.amount_each * (isSplit ? 1 : 1)) : money(0);
    var summary = el("summary", "card-head");
    summary.innerHTML =
      '<span class="chevron">▸</span>' +
      '<span class="grow"><b>' + esc(p.name) + "</b>" +
      (names ? " — " + esc(names) : " — no winner") +
      (isSplit ? '<span class="pill split">split</span>' : "") + "</span>" +
      '<span class="win-amt">' + amt + (isSplit ? " ea" : "") + "</span>";
    card.appendChild(summary);
    var body = el("div", "card-body");
    body.innerHTML = tiebreakExplanation(p.winner);
    body.appendChild(periodStandingsTable(p));
    card.appendChild(body);
    return card;
  }

  function renderPrizes() {
    var main = $("#main");
    main.innerHTML = "";
    var rows = DATA.prize_table || [];
    if (!rows.length) { main.appendChild(emptyState()); return; }

    var info = el("div", "header-meta");
    info.style.margin = "0 4px 10px";
    info.innerHTML =
      "N = <b>" + DATA.n_eligible + "</b> eligible" +
      (DATA.roster_locked ? " (locked)" : "") +
      " · monthly <b>" + money(DATA.prizes.monthly) + "</b>" +
      " · overall <b>" + money(DATA.prizes.overall) + "</b>";
    main.appendChild(info);

    var card = el("div", "card");
    var tbl = el("table", "tbl");
    tbl.innerHTML =
      "<thead><tr>" +
      '<th class="name">Manager</th><th>Won</th><th>€ Won</th><th>Net</th>' +
      "</tr></thead>";
    var tb = el("tbody");
    rows.forEach(function (r) {
      var tr = el("tr");
      var net = r.net_position;
      var netCell;
      if (!r.prize_eligible) netCell = '<td class="muted">—</td>';
      else netCell = '<td class="' + (net >= 0 ? "pos" : "neg") + '">' +
        (net >= 0 ? "+" : "") + money(net) + "</td>";
      tr.innerHTML =
        '<td class="name"><b>' + esc(r.player_name) + "</b>" + markers(r) +
        '<span class="team">' + esc(r.entry_name) + "</span></td>" +
        '<td class="muted">' + r.periods_won + "</td>" +
        "<td><b>" + money(r.money_won) + "</b></td>" +
        netCell;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    card.appendChild(tbl);
    main.appendChild(card);

    // Overall prize pending row.
    var op = DATA.overall_prize;
    if (op) {
      var banner = el("div", "prize-banner");
      banner.innerHTML =
        "<div><b>Overall — end of season</b></div>" +
        '<div class="amt">' + money(op.amount) + "</div>" +
        '<div class="sub">' +
        (op.pending ? "Pending — awarded when the season finishes" :
          "Winner: <b>" + esc((op.winner || []).map(nameFor).join(" & ")) + "</b>") +
        "</div>";
      main.appendChild(banner);
    }
  }

  function cellClass(net, avg) {
    if (avg == null) return "cell-avg";
    if (net > avg + 6) return "cell-good";
    if (net < avg - 6) return "cell-bad";
    return "cell-avg";
  }

  function renderGrid() {
    var main = $("#main");
    main.innerHTML = "";
    var members = DATA.members || [];
    var gws = (DATA.gameweeks || []).filter(function (g) { return g.played_count > 0; });
    if (!members.length || !gws.length) { main.appendChild(emptyState()); return; }

    var legend = el("div", "legend");
    legend.innerHTML =
      '<span><i class="swatch" style="background:rgba(55,214,122,.35)"></i>above GW avg</span>' +
      '<span><i class="swatch" style="background:rgba(229,85,110,.35)"></i>below GW avg</span>' +
      '<span class="neg">62 (-4) = hit taken</span>' +
      "<span>🃏 WC · 🪑 BB · 👑 TC · 🎟️ FH</span>";
    main.appendChild(legend);

    var wrap = el("div", "grid-wrap");
    var tbl = el("table", "grid");
    var avgById = {};
    gws.forEach(function (g) { avgById[g.id] = g.average_net; });

    var thead = el("thead");
    var htr = el("tr");
    htr.appendChild(cornerTh());
    gws.forEach(function (g) {
      var th = el("th");
      th.innerHTML = "GW" + g.id + (g.finished ? "" : "*");
      if (!g.finished) th.title = "Provisional — not finished";
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    tbl.appendChild(thead);

    var tb = el("tbody");
    members.forEach(function (m) {
      var tr = el("tr");
      var th = el("th", "rowname");
      th.innerHTML = esc(m.player_name) + markers(m) + "<small>" + esc(m.entry_name) + "</small>";
      tr.appendChild(th);
      gws.forEach(function (g) {
        var cell = m.by_gw ? m.by_gw[g.id] : null;
        var td = el("td", "cell");
        if (!cell) {
          td.className = "cell cell-blank";
          td.textContent = "·";
          tr.appendChild(td);
          return;
        }
        td.className = "cell " + cellClass(cell.net, avgById[g.id]);
        var html = "<b>" + cell.net + "</b>";
        if (cell.hit) html += ' <span class="hit">(-' + cell.hit + ")</span>";
        if (cell.chip) html += chipMarker(cell.chip);
        if (cell.provisional) html += "*";
        td.innerHTML = html;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    main.appendChild(wrap);
    main.appendChild(el("div", "why", "* = provisional (gameweek not finalised; FPL still adjusting bonus points)."));
  }

  function cornerTh() {
    var th = el("th", "corner");
    th.textContent = "Manager";
    return th;
  }

  function emptyState() {
    var d = el("div", "notice");
    d.innerHTML = "Nothing to show yet.<br>The season hasn’t started or no data has been fetched.";
    return d;
  }

  /* -------------------------------------------------------------- Chrome */

  function renderHeader() {
    $("#league-name").textContent = (DATA.league && DATA.league.name) || "FPL Tracker";
    $("#season").textContent = (DATA.league && DATA.league.season) || "";
    var meta = $("#header-meta");
    var gw = DATA.current_gw ? "GW " + DATA.current_gw : "pre-season";
    meta.innerHTML =
      "<span>" + gw + "</span>" +
      "<span>N = <b>" + DATA.n_eligible + "</b>" + (DATA.roster_locked ? " (locked)" : "") + "</span>" +
      "<span>Monthly <b>" + money(DATA.prizes.monthly) + "</b></span>" +
      "<span>Overall <b>" + money(DATA.prizes.overall) + "</b></span>";
    if (DATA.last_updated) {
      var dt = new Date(DATA.last_updated);
      $("#last-updated").textContent = "Last updated " + dt.toLocaleString();
    }
  }

  function render() {
    var views = {
      overall: renderOverall,
      monthly: renderMonthly,
      prizes: renderPrizes,
      grid: renderGrid,
    };
    (views[currentView] || renderOverall)();
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
      t.setAttribute("aria-selected", t.dataset.view === currentView ? "true" : "false");
    });
  }

  function wireTabs() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
      t.addEventListener("click", function () {
        currentView = t.dataset.view;
        if (history.replaceState) history.replaceState(null, "", "#" + currentView);
        render();
      });
    });
    var hash = (location.hash || "").replace("#", "");
    if (["overall", "monthly", "prizes", "grid"].indexOf(hash) !== -1) currentView = hash;
  }

  function fail(msg) {
    $("#main").innerHTML = '<div class="notice error">' + esc(msg) + "</div>";
  }

  function boot() {
    wireTabs();
    fetch("data/league.json", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("data/league.json not found (HTTP " + r.status + ")");
        return r.json();
      })
      .then(function (data) {
        DATA = data;
        renderHeader();
        render();
      })
      .catch(function (err) {
        fail("Could not load league data: " + err.message +
          ". The fetch job may not have run yet.");
      });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
