/* Bull Ring — vanilla JS, no build step. Reads the local data/league.json only.
   JSON contract unchanged from fetch.py; this is a presentation rebuild. */

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

  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) { return String(s == null ? "" : s); }

  function money(n) {
    var cur = (DATA && DATA.prizes && DATA.prizes.currency) || "EUR";
    var sym = { EUR: "€", GBP: "£", USD: "$" }[cur] || (cur + " ");
    var v = Math.round((Number(n) || 0) * 100) / 100;
    return sym + v;
  }

  function firstNameInitial(name) {
    var parts = String(name || "").trim().split(/\s+/);
    if (parts.length < 2) return parts[0] || "";
    return parts[0] + " " + parts[parts.length - 1].charAt(0).toUpperCase() + ".";
  }

  function chipLetter(chip) { return CHIP_LETTER[chip] || chip.charAt(0).toUpperCase(); }

  function markerHTML(m) {
    var out = "";
    if (m.prize_eligible === false) out += '<span class="mark" title="Not in the prize money">no prize</span>';
    if (m.in_league === false) out += '<span class="mark left" title="Left the mini-league; scores still count">left</span>';
    return out;
  }

  function hasScores() {
    return (DATA.gameweeks || []).some(function (g) { return g.played_count > 0; });
  }

  function nameFor(id) {
    var m = (DATA.members || []).find(function (x) { return x.entry_id === id; });
    return m ? firstNameInitial(m.player_name) : ("#" + id);
  }

  /* ---------------------------------------------------------------- No-scores state */

  function noScoresNotice() {
    var d = el("p", "state");
    d.innerHTML = '<span class="lead">No scores yet.</span>' +
      "First gameweek deadline is Friday.";
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

    var table = el("table");
    table.innerHTML =
      "<thead><tr>" +
      '<th scope="col" class="rank">#</th>' +
      '<th scope="col" class="col-name">Manager</th>' +
      '<th scope="col">Net</th><th scope="col">Hits</th><th scope="col">GW</th>' +
      "</tr></thead>";
    var tb = el("tbody");
    members.forEach(function (m, i) {
      var played = m.gws_played > 0;
      var tr = el("tr");
      if (scores && i === 0 && played) tr.className = "leader";
      tr.innerHTML =
        '<td class="rank">' + (i + 1) + "</td>" +
        '<th scope="row" class="col-name"><span class="name-main">' + esc(firstNameInitial(m.player_name)) +
        "</span>" + markerHTML(m) +
        '<span class="team">' + esc(m.entry_name) + "</span></th>" +
        "<td>" + (played ? "<b>" + m.total_net + "</b>" : '<span class="muted">—</span>') + "</td>" +
        "<td>" + (played ? (m.hits_total ? '<span class="hit">−' + m.hits_total + "</span>" : "0") : '<span class="muted">—</span>') + "</td>" +
        '<td class="muted">' + (played ? m.gws_played : "—") + "</td>";
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

  function tiebreakWhy(w) {
    if (!w || w.resolved_by === "net_points") return "";
    var names = (w.entry_ids || []).map(nameFor).join(" & ");
    var txt;
    switch (w.resolved_by) {
      case "head_to_head": txt = "Tied on net points — settled on <b>head-to-head gameweek wins</b>."; break;
      case "highest_single_gw": txt = "Tied — settled on the <b>highest single gameweek</b>."; break;
      case "fewest_transfers": txt = "Tied — settled on <b>fewest transfers</b>."; break;
      case "split": txt = "Level after every tiebreak — prize <b>split</b> between " + esc(names) + "."; break;
      default: txt = "Settled by " + esc(w.resolved_by) + ".";
    }
    var d = el("p", "why"); d.innerHTML = txt; return d.outerHTML;
  }

  function renderMonthly() {
    var main = $("#main");
    main.innerHTML = "";
    var periods = DATA.periods || [];
    if (!periods.length || !hasScores()) { main.appendChild(noScoresNotice()); return; }

    var current = periods.filter(function (p) { return p.is_current; });
    var done = periods.filter(function (p) { return p.complete; });
    var upcoming = periods.filter(function (p) { return !p.is_current && !p.complete; });

    current.forEach(function (p) {
      var lead = ((p.winner && p.winner.entry_ids) || []).map(nameFor).join(" & ");
      var hero = el("div", "hero-period");
      hero.innerHTML =
        '<div class="p-name">' + esc(p.name) + "</div>" +
        '<div class="amt">' + money(p.prize) + "</div>" +
        '<div class="sub"><b>' + gwLabel(p) + "</b> this period" +
        (p.remaining_gws > 0 ? " · " + p.remaining_gws + " to play" : " · final scores settling") +
        (lead ? " · leading " + esc(lead) : "") + "</div>";
      main.appendChild(hero);
      main.appendChild(periodTable(p));
    });

    if (done.length) {
      main.appendChild(el("h2", "view-title", "Settled"));
      done.slice().reverse().forEach(function (p) {
        var winners = (p.winner && p.winner.entry_ids) || [];
        var names = winners.map(nameFor).join(" & ");
        var split = winners.length > 1;
        var d = el("details", "period");
        var sum = el("summary");
        sum.innerHTML =
          '<span class="grow"><span class="p-name">' + esc(p.name) + "</span> " +
          '<span class="p-meta">· ' + gwLabel(p) + "</span><br>" +
          '<span class="p-meta">' + (names ? esc(names) : "no winner") +
          (split ? " · split" : "") + "</span></span>" +
          '<span class="win-amt">' + (p.winner ? money(p.winner.amount_each) : money(0)) +
          (split ? " ea" : "") + "</span>";
        d.appendChild(sum);
        var body = el("div", "p-body");
        body.innerHTML = tiebreakWhy(p.winner);
        body.appendChild(periodTable(p));
        d.appendChild(body);
        main.appendChild(d);
      });
    }

    if (upcoming.length) {
      main.appendChild(el("h2", "view-title", "To come"));
      upcoming.forEach(function (p) {
        var d = el("div", "period");
        var sum = el("div"); sum.className = "";
        var row = el("div"); row.style.padding = "var(--sp-3)";
        row.style.display = "flex";
        row.innerHTML =
          '<span class="grow"><span class="p-name">' + esc(p.name) + "</span> " +
          '<span class="p-meta">· ' + gwLabel(p) + "</span></span>" +
          '<span class="p-meta">' + money(p.prize) + "</span>";
        d.appendChild(row);
        main.appendChild(d);
      });
    }
  }

  /* ---------------------------------------------------------------- Money (sol y sombra) */

  function moneyRow(r, band) {
    var tr = el("tr", band);
    var net = r.net_position;
    tr.innerHTML =
      '<th scope="row" class="col-name"><span class="name-main">' + esc(firstNameInitial(r.player_name)) +
      "</span>" + markerHTML(r) +
      '<span class="team">' + esc(r.entry_name) + "</span></th>" +
      '<td class="muted">' + r.periods_won + "</td>" +
      '<td class="money">' + money(r.money_won) + "</td>" +
      "<td>" + (net >= 0
        ? '<span class="net-pos">+' + money(net) + "</span>"
        : '<span class="net-neg">−' + money(Math.abs(net)) + "</span>") + "</td>";
    return tr;
  }

  function moneyHead() {
    return "<thead><tr>" +
      '<th scope="col" class="col-name">Manager</th>' +
      '<th scope="col">Won</th><th scope="col">Money</th><th scope="col">± buy-in</th>' +
      "</tr></thead>";
  }

  function renderPrizes() {
    var main = $("#main");
    main.innerHTML = "";
    var rows = DATA.prize_table || [];
    var eligible = rows.filter(function (r) { return r.prize_eligible && r.net_position != null; });
    var ineligible = rows.filter(function (r) { return !r.prize_eligible; });

    if (!rows.length) { main.appendChild(noScoresNotice()); return; }

    if (eligible.length) {
      var sol = eligible.filter(function (r) { return r.net_position >= 0; });
      var sombra = eligible.filter(function (r) { return r.net_position < 0; });
      var wrap = el("div", "solsombra");

      wrap.appendChild(bandLabel("Sol · in profit", "sol"));
      if (sol.length) {
        var t1 = el("table"); t1.innerHTML = moneyHead();
        var b1 = el("tbody"); sol.forEach(function (r) { b1.appendChild(moneyRow(r, "sol")); });
        t1.appendChild(b1); wrap.appendChild(t1);
      } else {
        wrap.appendChild(mutedLine("Nobody's in profit yet."));
      }

      var be = el("div", "breakeven");
      wrap.appendChild(be);

      wrap.appendChild(bandLabel("Sombra · down on the year", "sombra"));
      if (sombra.length) {
        var t2 = el("table"); t2.innerHTML = moneyHead();
        var b2 = el("tbody"); sombra.forEach(function (r) { b2.appendChild(moneyRow(r, "sombra")); });
        t2.appendChild(b2); wrap.appendChild(t2);
      } else {
        wrap.appendChild(mutedLine("Nobody's in shade — everyone's up."));
      }
      main.appendChild(wrap);
    } else {
      main.appendChild(noScoresNotice());
    }

    if (ineligible.length) {
      main.appendChild(el("h2", "view-title", "Not in the money"));
      var t3 = el("table"); t3.innerHTML =
        '<thead><tr><th scope="col" class="col-name">Manager</th><th scope="col">Net so far</th></tr></thead>';
      var b3 = el("tbody");
      ineligible.forEach(function (r) {
        var member = (DATA.members || []).find(function (x) { return x.entry_id === r.entry_id; });
        var net = member && member.gws_played > 0 ? member.total_net : null;
        var tr = el("tr", "sombra");
        tr.innerHTML =
          '<th scope="row" class="col-name"><span class="name-main">' + esc(firstNameInitial(r.player_name)) + "</span>" +
          markerHTML(r) + '<span class="team">' + esc(r.entry_name) + "</span></th>" +
          "<td>" + (net != null ? net : '<span class="muted">—</span>') + "</td>";
        b3.appendChild(tr);
      });
      t3.appendChild(b3); main.appendChild(t3);
    }

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

  function bandLabel(t, cls) { return el("div", "band-label" + (cls ? " " + cls : ""), t); }
  function mutedLine(t) { var p = el("p", "why"); p.textContent = t; return p; }

  /* ---------------------------------------------------------------- GWs (grid) */

  function cellStep(net, avg) {
    if (avg == null) return "";
    var d = net - avg;
    var mag = Math.abs(d);
    var lvl = mag > 16 ? 3 : mag > 7 ? 2 : 1;
    if (d > 2) return "up" + lvl;
    if (d < -2) return "dn" + lvl;
    return "";
  }

  function renderGrid() {
    var main = $("#main");
    main.innerHTML = "";
    var members = DATA.members || [];
    var gws = (DATA.gameweeks || []).filter(function (g) { return g.played_count > 0; });
    if (!members.length || !gws.length) { main.appendChild(noScoresNotice()); return; }

    var legend = el("div", "legend");
    legend.innerHTML =
      '<span><i class="sw up"></i>above GW average</span>' +
      '<span><i class="sw dn"></i>below GW average</span>' +
      '<span><span class="hit">−4</span> hit taken</span>' +
      '<span><span class="g">W B T F</span> chips</span>';
    main.appendChild(legend);

    var avg = {};
    gws.forEach(function (g) { avg[g.id] = g.average_net; });

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
        if (!c) { td.className = "cell blank"; td.textContent = ""; tr.appendChild(td); return; }
        var step = cellStep(c.net, avg[g.id]);
        if (step) td.classList.add(step);
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
    var pot = buyIn * N;

    var wrap = el("div", "rules");
    wrap.innerHTML =
      "<h2>The buy-in</h2>" +
      "<p>" + money(buyIn) + " each. <b class='num-figure'>" + N + "</b> playing, so the pot is <b class='num-figure'>" + money(pot) + "</b>.</p>" +

      "<h2>How the money splits</h2>" +
      "<p>" + money(per) + " of everyone's " + money(buyIn) + " goes to each of the nine monthly prizes. The remaining " + money(overallPer) + " goes to the overall winner.</p>" +
      "<p>That makes each month worth <b class='num-figure'>" + money(pz.monthly != null ? pz.monthly : per * N) + "</b> and the season worth <b class='num-figure'>" + money(pz.overall != null ? pz.overall : overallPer * N) + "</b>.</p>" +

      "<h2>The nine months</h2>" +
      "<p>August and September count as one period. Then October, November, December, January, February, March, April and May.</p>";

    var table = el("table");
    table.innerHTML = '<thead><tr><th scope="col" class="col-name">Period</th><th scope="col">Gameweeks</th><th scope="col">Count</th></tr></thead>';
    var tb = el("tbody");
    (DATA.periods || []).forEach(function (p) {
      var tr = el("tr");
      tr.innerHTML =
        '<th scope="row" class="col-name">' + esc(p.name) + "</th>" +
        "<td>" + gwRange(p) + "</td>" +
        "<td>" + (p.gameweeks || []).length + "</td>";
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(table);

    var rest = el("div");
    rest.innerHTML =
      "<p>Periods vary in length — December is six gameweeks, March and April are three — and every period is worth the same regardless.</p>" +

      "<h2>How scores are counted</h2>" +
      "<p>Net points. Transfer hits come off your score. A 62 with a −4 hit counts as 58, for the month and for the season.</p>" +

      "<h2>Chips</h2>" +
      "<p>No restrictions. Wildcards, bench boosts, triple captains and free hits can all be played whenever you like, including to win a month.</p>" +

      "<h2>Ties</h2>" +
      "<p>Settled in this order, stopping at the first one that separates you:</p>" +
      "<ol><li>Head-to-head — who won more gameweeks against the other in that period</li>" +
      "<li>Highest single gameweek in the period</li>" +
      "<li>Fewest transfers made in the period</li>" +
      "<li>If still level, the prize is split</li></ol>" +
      "<p>The site shows which rule settled any tie and the numbers behind it.</p>" +

      "<h2>Who's in</h2>" +
      "<p>The roster locked at the GW1 deadline. Anyone who hadn't paid by then isn't in the prize money. If you leave the mini-league during the season your scores still count — you paid, your team still scores.</p>" +

      "<h2>Payment</h2>" +
      "<p>All " + money(buyIn) + "s to the league admin before the deadline. The site only counts you as eligible once the money's in.</p>";
    wrap.appendChild(rest);
    main.appendChild(wrap);
  }

  /* ---------------------------------------------------------------- Chrome */

  var RENDER = {
    overall: renderOverall, monthly: renderMonthly, prizes: renderPrizes,
    grid: renderGrid, rules: renderRules,
  };

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

  function renderHeader() {
    $("#season").textContent = (DATA.league && DATA.league.season) || "";
    var N = DATA.n_eligible || 0;
    var pz = DATA.prizes || {};
    // Hero: three figures — monthly / overall (money, gold) and count (bone).
    $("#hero").innerHTML =
      figCell(money(pz.monthly || 0), "A month", "money") +
      figCell(money(pz.overall || 0), "Overall", "money") +
      figCell(String(N), "Playing", "count");
    $("#last-updated").textContent = relTime(DATA.last_updated);
  }

  function figCell(value, label, kind) {
    return '<div class="fig-cell"><div class="fig ' + kind + '">' + esc(value) +
      '</div><div class="fig-label">' + esc(label) + "</div></div>";
  }

  function render() {
    var main = $("#main");
    (RENDER[currentView] || renderOverall)();
    main.classList.remove("fade");
    void main.offsetWidth;   /* restart the fade */
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
    $("#main").innerHTML =
      '<p class="state error"><span class="lead">Can\'t load the scores.</span>' + esc(msg) + "</p>";
  }

  function boot() {
    wireTabs();
    fetch("data/league.json", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("The update job hasn't produced a data file yet.");
        return r.json();
      })
      .then(function (data) {
        DATA = data;
        renderHeader();
        render();
      })
      .catch(function (e) { fail(e.message); });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
