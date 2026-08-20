/* Bull Ring — vanilla JS, no build step. Reads local data/league.json only.
   JSON contract unchanged; this revision makes the data itself move. */

(function () {
  "use strict";

  var VIEWS = ["overall", "monthly", "prizes", "grid", "rules"];
  var CHIP_LETTER = { wildcard: "W", bboost: "B", "3xc": "T", freehit: "F", manager: "M" };
  var CHIP_NAME = {
    wildcard: "Wildcard", bboost: "Bench Boost", "3xc": "Triple Captain",
    freehit: "Free Hit", manager: "Manager chip",
  };

  var DATA = null;
  var currentView = "overall";
  var HEAT = { ember: Infinity, gwAvg: {} };

  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) { return String(s == null ? "" : s); }
  function reduceMotion() { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; }

  function currencySymbol() {
    var cur = (DATA && DATA.prizes && DATA.prizes.currency) || "EUR";
    return { EUR: "€", GBP: "£", USD: "$" }[cur] || (cur + " ");
  }
  function money(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    return currencySymbol() + v;
  }

  function firstNameInitial(name) {
    var parts = String(name || "").trim().split(/\s+/);
    if (parts.length < 2) return parts[0] || "";
    return parts[0] + " " + parts[parts.length - 1].charAt(0).toUpperCase() + ".";
  }
  function chipLetter(chip) { return CHIP_LETTER[chip] || chip.charAt(0).toUpperCase(); }

  function memberFor(id) { return (DATA.members || []).find(function (x) { return x.entry_id === id; }); }
  function nameFor(id) { var m = memberFor(id); return m ? firstNameInitial(m.player_name) : ("#" + id); }
  function teamFor(id) { var m = memberFor(id); return m ? m.entry_name : ("#" + id); }

  function markerHTML(m) {
    var out = "";
    if (m.prize_eligible === false) out += '<span class="mark" title="Not in the prize money">no prize</span>';
    if (m.in_league === false) out += '<span class="mark left" title="Left the mini-league; scores still count">left</span>';
    return out;
  }
  function hasScores() { return (DATA.gameweeks || []).some(function (g) { return g.played_count > 0; }); }
  function mutedLine(t) { var p = el("p", "why"); p.textContent = t; return p; }

  /* ---------------------------------------------------------------- Heat scale */

  function prepHeat() {
    var nets = [];
    (DATA.members || []).forEach(function (m) {
      if (m.by_gw) Object.keys(m.by_gw).forEach(function (gw) { nets.push(m.by_gw[gw].net); });
    });
    nets.sort(function (a, b) { return a - b; });
    HEAT.ember = nets.length ? nets[Math.floor(0.9 * (nets.length - 1))] : Infinity;
    HEAT.gwAvg = {};
    (DATA.gameweeks || []).forEach(function (g) { HEAT.gwAvg[g.id] = g.average_net; });
  }
  function heatClass(net, gwId) {
    if (isFinite(HEAT.ember) && net >= HEAT.ember) return "heat-ember";
    var avg = HEAT.gwAvg[gwId];
    if (avg == null) return "heat-0";
    var d = net - avg;
    if (d > 18) return "heat-hot3";
    if (d > 10) return "heat-hot2";
    if (d > 3) return "heat-hot1";
    if (d < -18) return "heat-ice3";
    if (d < -10) return "heat-ice2";
    if (d < -3) return "heat-ice1";
    return "heat-0";
  }

  function formStrip(m) {
    var played = Object.keys(m.by_gw || {}).map(Number).sort(function (a, b) { return a - b; });
    var last5 = played.slice(-5);
    var pad = 5 - last5.length;
    var html = '<span class="form" aria-hidden="true">';
    for (var i = 0; i < pad; i++) html += '<span class="sq blank"></span>';
    last5.forEach(function (gw) { html += '<span class="sq ' + heatClass(m.by_gw[gw].net, gw) + '"></span>'; });
    return html + "</span>";
  }

  function movementMap(members) {
    var finished = (DATA.gameweeks || []).filter(function (g) { return g.finished; }).map(function (g) { return g.id; });
    if (!finished.length) return null;
    var latest = Math.max.apply(null, finished);
    var cur = members.slice().sort(function (a, b) { return b.total_net - a.total_net; });
    var prior = members.map(function (m) {
      var last = (m.by_gw && m.by_gw[latest]) ? m.by_gw[latest].net : 0;
      return { id: m.entry_id, p: m.total_net - last };
    }).sort(function (a, b) { return b.p - a.p; });
    var curRank = {}, priRank = {};
    cur.forEach(function (m, i) { curRank[m.entry_id] = i + 1; });
    prior.forEach(function (m, i) { priRank[m.id] = i + 1; });
    var out = {};
    members.forEach(function (m) { out[m.entry_id] = priRank[m.entry_id] - curRank[m.entry_id]; });
    return out;
  }
  function moveSpan(delta) {
    if (delta == null) return "";
    if (delta > 0) return '<span class="move up" title="Up ' + delta + '">▲' + delta + "</span>";
    if (delta < 0) return '<span class="move down" title="Down ' + (-delta) + '">▼' + (-delta) + "</span>";
    return '<span class="move flat" title="No change">–</span>';
  }

  function noScoresNotice() {
    var d = el("p", "state");
    d.innerHTML = '<span class="lead">No scores yet.</span>First gameweek deadline is Friday.';
    return d;
  }

  /* ---------------------------------------------------------------- Table (overall) */

  function renderOverall() {
    var main = $("#main");
    main.innerHTML = "";
    var members = DATA.members || [];
    if (!members.length) { main.appendChild(noScoresNotice()); return; }
    var scores = hasScores();
    if (!scores) main.appendChild(noScoresNotice());

    main.appendChild(el("h2", "view-title", "Top of the shop"));

    var move = scores ? movementMap(members) : null;
    var table = el("table");
    table.innerHTML =
      "<thead><tr>" +
      '<th scope="col" class="rank">#</th>' +
      '<th scope="col" class="col-name">Manager</th>' +
      '<th scope="col">Form</th><th scope="col">Net</th><th scope="col">Hits</th>' +
      "</tr></thead>";
    var tb = el("tbody");
    members.forEach(function (m, i) {
      var played = m.gws_played > 0;
      var tr = el("tr");
      if (scores && i === 0 && played) tr.className = "leader";
      tr.innerHTML =
        '<td class="rank">' + (i + 1) + "</td>" +
        '<th scope="row" class="col-name"><span class="name-main">' + esc(firstNameInitial(m.player_name)) +
        "</span>" + (move ? " " + moveSpan(move[m.entry_id]) : "") + markerHTML(m) +
        '<span class="team">' + esc(m.entry_name) + "</span></th>" +
        "<td>" + (played ? formStrip(m) : '<span class="muted">—</span>') + "</td>" +
        "<td>" + (played ? "<b>" + m.total_net + "</b>" : '<span class="muted">—</span>') + "</td>" +
        "<td>" + (played ? (m.hits_total ? '<span class="hit">−' + m.hits_total + "</span>" : "0") : '<span class="muted">—</span>') + "</td>";
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    main.appendChild(table);
  }

  /* ---------------------------------------------------------------- Month */

  function gwLabel(p) {
    var n = (p.gameweeks || []).length;
    return n + " gameweek" + (n === 1 ? "" : "s");
  }
  function tiebreakText(w) {
    if (!w || w.resolved_by === "net_points") return "";
    var names = (w.entry_ids || []).map(nameFor).join(" & ");
    switch (w.resolved_by) {
      case "head_to_head": return "Tied on net points — settled on head-to-head gameweek wins.";
      case "highest_single_gw": return "Tied — settled on the highest single gameweek.";
      case "fewest_transfers": return "Tied — settled on fewest transfers.";
      case "split": return "Level after every tiebreak — prize split between " + names + ".";
      default: return "Settled by " + w.resolved_by + ".";
    }
  }

  function periodTable(p) {
    var table = el("table");
    table.innerHTML =
      "<thead><tr>" +
      '<th scope="col" class="rank">#</th><th scope="col" class="col-name">Manager</th>' +
      '<th scope="col">Net</th><th scope="col">GW</th></tr></thead>';
    var tb = el("tbody");
    var winners = (p.winner && p.winner.entry_ids) || [];
    (p.standings || []).forEach(function (r, i) {
      var tr = el("tr");
      if (winners.indexOf(r.entry_id) !== -1) tr.className = "leader";
      tr.innerHTML =
        '<td class="rank">' + (i + 1) + "</td>" +
        '<th scope="row" class="col-name"><span class="name-main">' + esc(firstNameInitial(r.player_name)) +
        "</span>" + markerHTML(r) +
        '<span class="team">' + esc(r.entry_name) + "</span></th>" +
        "<td><b>" + r.net + "</b></td>" +
        '<td class="muted">' + r.gws_played + "</td>";
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    return table;
  }

  function liveCard(p) {
    var leadRow = (p.standings || [])[0];
    var card = el("div", "wcard live");
    var remain = p.remaining_gws;
    var badge = "LIVE — " + (remain > 0 ? remain + " GAMEWEEK" + (remain === 1 ? "" : "S") + " LEFT" : "FINAL SCORES SETTLING");
    card.innerHTML =
      '<div class="bull-gold" aria-hidden="true"></div>' +
      '<div class="wc-body">' +
      '<div class="wc-period">' + esc(p.name) + ' · <span class="live-badge">' + esc(badge) + "</span></div>" +
      '<div class="wc-team">' + esc(leadRow ? leadRow.entry_name : "—") + "</div>" +
      '<div class="wc-line">Leading on <span class="net">' + (leadRow ? leadRow.net : 0) +
      "</span> net · <span class=\"wc-amt\">" + money(p.prize) + "</span> up for grabs</div>" +
      "</div>";
    return card;
  }

  function winnerCard(p) {
    var w = p.winner;
    var ids = (w && w.entry_ids) || [];
    var card = el("div", "wcard");
    var teams = ids.map(teamFor).join(" & ");
    var netRow = (p.standings || []).find(function (r) { return ids.indexOf(r.entry_id) !== -1; });
    var net = netRow ? netRow.net : 0;
    var split = ids.length > 1;
    var why = tiebreakText(w);
    card.innerHTML =
      '<div class="bull-gold" aria-hidden="true"></div>' +
      '<div class="wc-body">' +
      '<div class="wc-period">' + esc(p.name) + " · " + esc(gwLabel(p)) + "</div>" +
      '<div class="wc-team">' + esc(teams || "No winner") + "</div>" +
      '<div class="wc-line"><span class="net">' + net + '</span> net · <span class="wc-amt">' +
      (w ? money(w.amount_each) : money(0)) + (split ? " each" : "") + "</span></div>" +
      (why ? '<div class="wc-why">' + esc(why) + "</div>" : "") +
      "</div>";
    return card;
  }

  function renderMonthly() {
    var main = $("#main");
    main.innerHTML = "";
    var periods = DATA.periods || [];
    if (!periods.length || !hasScores()) { main.appendChild(noScoresNotice()); return; }

    main.appendChild(el("h2", "view-title", "This month"));

    var current = periods.filter(function (p) { return p.is_current; });
    var done = periods.filter(function (p) { return p.complete; });
    var upcoming = periods.filter(function (p) { return !p.is_current && !p.complete; });

    current.forEach(function (p) {
      main.appendChild(liveCard(p));
      var det = el("details", "period");
      det.innerHTML = "<summary>Full standings</summary>";
      var body = el("div", "p-body");
      body.appendChild(periodTable(p));
      det.appendChild(body);
      main.appendChild(det);
    });

    if (done.length) {
      main.appendChild(el("h2", "view-title", "Settled"));
      done.slice().reverse().forEach(function (p) {
        main.appendChild(winnerCard(p));
        var det = el("details", "period");
        det.innerHTML = "<summary>Full table</summary>";
        var body = el("div", "p-body");
        body.appendChild(periodTable(p));
        det.appendChild(body);
        main.appendChild(det);
      });
    }

    if (upcoming.length) {
      main.appendChild(el("h2", "view-title", "To come"));
      upcoming.forEach(function (p) {
        var d = el("div", "period");
        var row = el("div");
        row.style.padding = "var(--sp-3)";
        row.style.display = "flex";
        row.innerHTML =
          '<span style="flex:1"><b>' + esc(p.name) + "</b> <span class=\"muted\">· " + esc(gwLabel(p)) + "</span></span>" +
          '<span class="muted">' + money(p.prize) + "</span>";
        d.appendChild(row);
        main.appendChild(d);
      });
    }
  }

  /* ---------------------------------------------------------------- Money */

  function moneyRow(r) {
    var tr = el("tr");
    var net = r.net_position;
    var netCell = net == null
      ? '<td class="muted">—</td>'
      : "<td>" + (net >= 0
          ? '<span class="net-pos">+' + money(net) + "</span>"
          : '<span class="net-neg">−' + money(Math.abs(net)) + "</span>") + "</td>";
    tr.innerHTML =
      '<th scope="row" class="col-name"><span class="name-main">' + esc(firstNameInitial(r.player_name)) +
      "</span>" + markerHTML(r) +
      '<span class="team">' + esc(r.entry_name) + "</span></th>" +
      '<td class="muted">' + r.periods_won + "</td>" +
      '<td class="' + (r.money_won > 0 ? "money" : "muted") + '">' + money(r.money_won) + "</td>" +
      netCell;
    return tr;
  }

  function renderPrizes() {
    var main = $("#main");
    main.innerHTML = "";
    var rows = DATA.prize_table || [];
    if (!rows.length) { main.appendChild(noScoresNotice()); return; }
    main.appendChild(el("h2", "view-title", "The money"));

    // One table, every member, sorted by money won. The ± buy-in column shows
    // who is up or down without splitting the table.
    var table = el("table");
    table.innerHTML = "<thead><tr>" +
      '<th scope="col" class="col-name">Manager</th>' +
      '<th scope="col">Won</th><th scope="col">Money</th><th scope="col">± buy-in</th>' +
      "</tr></thead>";
    var tb = el("tbody");
    rows.forEach(function (r) { tb.appendChild(moneyRow(r)); });
    table.appendChild(tb);
    main.appendChild(table);

    var op = DATA.overall_prize;
    if (op) {
      var box = el("div", "pending-overall");
      box.innerHTML =
        "<div>Overall — end of season</div>" +
        '<div class="amt">' + money(op.amount) + "</div>" +
        '<div class="sub">' + (op.pending ? "Pending — paid when the season finishes" :
          "Winner: " + esc((op.winner || []).map(nameFor).join(" & "))) + "</div>";
      main.appendChild(box);
    }
  }

  /* ---------------------------------------------------------------- GWs (grid) */

  function renderGrid() {
    var main = $("#main");
    main.innerHTML = "";
    var members = DATA.members || [];
    var gws = (DATA.gameweeks || []).filter(function (g) { return g.played_count > 0; });
    if (!members.length || !gws.length) { main.appendChild(noScoresNotice()); return; }

    main.appendChild(el("h2", "view-title", "Every gameweek"));

    var legend = el("div", "legend");
    legend.innerHTML =
      '<span class="ramp"><i class="sw heat-ice3"></i><i class="sw heat-0"></i><i class="sw heat-hot3"></i><i class="sw heat-ember"></i> cold · average · good · huge</span>' +
      '<span><span class="hit">−4</span> hit</span>' +
      '<span><span class="g">W B T F</span> chips</span>';
    main.appendChild(legend);

    var scroll = el("div", "grid-scroll");
    var table = el("table", "grid");
    var thead = el("thead");
    var htr = el("tr");
    var corner = el("th", "corner"); corner.setAttribute("scope", "col"); corner.textContent = "Manager";
    htr.appendChild(corner);
    gws.forEach(function (g) {
      var th = el("th"); th.setAttribute("scope", "col");
      th.textContent = "GW" + g.id + (g.finished ? "" : "*");
      if (!g.finished) th.title = "Provisional";
      htr.appendChild(th);
    });
    thead.appendChild(htr); table.appendChild(thead);

    var tb = el("tbody");
    members.forEach(function (m) {
      var tr = el("tr");
      var rown = el("th", "rowname"); rown.setAttribute("scope", "row");
      rown.innerHTML = esc(firstNameInitial(m.player_name)) + markerHTML(m);
      tr.appendChild(rown);
      gws.forEach(function (g) {
        var c = m.by_gw ? m.by_gw[g.id] : null;
        var td = el("td", "cell");
        if (!c) { td.className = "cell blank"; td.title = "Didn't play"; td.textContent = ""; tr.appendChild(td); return; }
        td.classList.add(heatClass(c.net, g.id));
        var html = String(c.net);
        if (c.hit) html += ' <span class="h">−' + c.hit + "</span>";
        if (c.chip) html += '<sup class="chip" title="' + esc(CHIP_NAME[c.chip] || c.chip) + '">' + esc(chipLetter(c.chip)) + "</sup>";
        if (c.provisional) html += "*";
        td.innerHTML = html;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    scroll.appendChild(table);
    main.appendChild(scroll);
    main.appendChild(mutedLine("* provisional — the gameweek isn't finalised yet."));
  }

  /* ---------------------------------------------------------------- Rules */

  function gwRange(p) {
    var g = p.gameweeks || [];
    if (!g.length) return "—";
    return g.length > 1 ? "GW" + g[0] + "–GW" + g[g.length - 1] : "GW" + g[0];
  }
  function renderRules() {
    var main = $("#main");
    main.innerHTML = "";
    var pz = DATA.prizes || {};
    var N = DATA.n_eligible || 0;
    var buyIn = pz.buy_in != null ? pz.buy_in : 50;
    var per = pz.monthly_per_player != null ? pz.monthly_per_player : 3;
    var periods = pz.monthly_periods != null ? pz.monthly_periods : 9;
    var overallPer = buyIn - per * periods;

    var wrap = el("div", "rules");
    wrap.innerHTML =
      "<h2>The buy-in</h2>" +
      "<p>" + money(buyIn) + " each. <b>" + N + "</b> playing, so the pot is <b>" + money(buyIn * N) + "</b>.</p>" +
      "<h2>How the money splits</h2>" +
      "<p>" + money(per) + " of everyone's " + money(buyIn) + " goes to each of the nine monthly prizes. The remaining " + money(overallPer) + " goes to the overall winner. Each month is worth <b>" + money(pz.monthly != null ? pz.monthly : per * N) + "</b>, the season <b>" + money(pz.overall != null ? pz.overall : overallPer * N) + "</b>.</p>" +
      "<h2>The nine months</h2>" +
      "<p>August and September count as one period. Then October, November, December, January, February, March, April, May.</p>";

    var table = el("table");
    table.innerHTML = '<thead><tr><th scope="col" class="col-name">Period</th><th scope="col">Gameweeks</th><th scope="col">Count</th></tr></thead>';
    var tb = el("tbody");
    (DATA.periods || []).forEach(function (p) {
      var tr = el("tr");
      tr.innerHTML =
        '<th scope="row" class="col-name">' + esc(p.name) + "</th>" +
        "<td>" + gwRange(p) + "</td><td>" + (p.gameweeks || []).length + "</td>";
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(table);

    var rest = el("div");
    rest.innerHTML =
      "<p>Periods vary in length — December is six gameweeks, March and April three — and every period pays the same regardless.</p>" +
      "<h2>How scores are counted</h2>" +
      "<p>Net points. Transfer hits come off. A 62 with a −4 counts as 58, for the month and the season.</p>" +
      "<h2>Chips</h2>" +
      "<p>No restrictions. Wildcard, bench boost, triple captain and free hit can be played whenever, including to win a month.</p>" +
      "<h2>Ties</h2>" +
      "<p>Settled in order, stopping at the first that separates you:</p>" +
      "<ol><li>Head-to-head — who won more gameweeks against the other in that period</li>" +
      "<li>Highest single gameweek in the period</li><li>Fewest transfers made in the period</li>" +
      "<li>Still level, the prize splits</li></ol>" +
      "<p>The site shows which rule settled a tie and the numbers behind it.</p>" +
      "<h2>Who's in</h2>" +
      "<p>Roster locked at the GW1 deadline. Unpaid by then means no prize money. Leaving the mini-league mid-season doesn't remove your scores — you paid, your team still scores.</p>" +
      "<h2>Payment</h2>" +
      "<p>All " + money(buyIn) + "s to the league admin before the deadline. Eligible once the money's in.</p>";
    wrap.appendChild(rest);
    main.appendChild(wrap);
  }

  /* ---------------------------------------------------------------- Chrome */

  var RENDER = { overall: renderOverall, monthly: renderMonthly, prizes: renderPrizes, grid: renderGrid, rules: renderRules };

  function relTime(iso) {
    if (!iso) return "No update yet";
    var then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    var mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return "Updated just now";
    if (mins < 60) return "Updated " + mins + " minute" + (mins === 1 ? "" : "s") + " ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return "Updated " + hrs + " hour" + (hrs === 1 ? "" : "s") + " ago";
    var days = Math.round(hrs / 24);
    return "Updated " + days + " day" + (days === 1 ? "" : "s") + " ago";
  }

  function figCell(prefix, target, kind, label) {
    return '<div class="fig-cell"><div class="fig ' + kind + '" data-target="' + target +
      '" data-prefix="' + prefix + '">' + prefix + '0</div><div class="fig-label">' + esc(label) + "</div></div>";
  }
  function renderHeader() {
    $("#season").textContent = (DATA.league && DATA.league.season) || "";
    var N = DATA.n_eligible || 0;
    var pz = DATA.prizes || {};
    var sym = currencySymbol();
    var pot = (pz.buy_in != null ? pz.buy_in : 50) * N;
    $("#hero").innerHTML =
      figCell(sym, Math.round(pz.monthly || 0), "money", "Monthly prize") +
      figCell(sym, Math.round(pz.overall || 0), "money", "Overall prize") +
      figCell(sym, Math.round(pot), "money", "Pot") +
      figCell("", N, "count", "Playing");
    $("#last-updated").textContent = relTime(DATA.last_updated);
    animateCounts();
  }
  function animateCounts() {
    var figs = document.querySelectorAll("#hero .fig[data-target]");
    var already = false;
    try { already = sessionStorage.getItem("br_counted") === "1"; } catch (e) {}
    Array.prototype.forEach.call(figs, function (f, i) {
      var target = +f.getAttribute("data-target");
      var pfx = f.getAttribute("data-prefix") || "";
      if (already || reduceMotion()) { f.textContent = pfx + target; return; }
      var start = null, dur = 900, delay = i * 80;
      function step(ts) {
        if (start == null) start = ts;
        var t = Math.min(1, (ts - start) / dur);
        var e = 1 - Math.pow(1 - t, 3);
        f.textContent = pfx + Math.round(target * e);
        if (t < 1) requestAnimationFrame(step); else f.textContent = pfx + target;
      }
      setTimeout(function () { requestAnimationFrame(step); }, delay);
    });
    try { sessionStorage.setItem("br_counted", "1"); } catch (e) {}
  }

  function render() {
    var main = $("#main");
    (RENDER[currentView] || renderOverall)();
    main.classList.remove("fade");
    void main.offsetWidth;
    main.classList.add("fade");
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
    if (VIEWS.indexOf(hash) !== -1) currentView = hash;
  }
  function fail(msg) {
    $("#main").innerHTML = '<p class="state error"><span class="lead">Can\'t load the scores.</span>' + esc(msg) + "</p>";
  }
  function boot() {
    wireTabs();
    fetch("data/league.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("The update job hasn't produced a data file yet."); return r.json(); })
      .then(function (data) { DATA = data; prepHeat(); renderHeader(); render(); })
      .catch(function (e) { fail(e.message); });
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
