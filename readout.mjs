/*
  Benchmark failure readout: scoring logic.

  Pure functions over the rows from data.js. No DOM, no network. Every number
  the pages print comes from here, and tests/run-tests.mjs checks them.

  The file has no import or export lines on purpose: it runs as a plain script
  in the browser (so the pages work from file://) and Node loads it as a
  module for the tests. Either way it sets globalThis.BenchReadout.
*/
(function (root) {
  'use strict';

  var BENCH_SIDE = { near_match: true, ref_outdated: true };

  // ---------- small helpers ----------

  function byId(list) {
    var m = {};
    list.forEach(function (x) { m[x.id] = x; });
    return m;
  }
  function apiName(run, id) { return byId(run.apis)[id].name; }
  function isScored(cell) { return cell.verdict !== 'no_reference'; }
  function isSetAside(cell, opts) {
    return !!(opts && opts.setAside) && cell.verdict === 'wrong' && BENCH_SIDE[cell.tag] === true;
  }
  function median(nums) {
    if (!nums.length) return NaN;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function sum(list) { return list.reduce(function (a, b) { return a + b; }, 0); }

  // ---------- formatting ----------

  function round(x, d) { var f = Math.pow(10, d); return Math.round(x * f) / f; }
  function fmtPct(x, d) { return round(x, d === undefined ? 1 : d).toFixed(d === undefined ? 1 : d) + '%'; }
  function fmtPts(x) { return round(Math.abs(x), 1).toFixed(1); }
  function fmtSigned(x) {
    var r = round(x, 1);
    if (r === 0) return '0.0';
    return (r > 0 ? '+' : '-') + Math.abs(r).toFixed(1);
  }
  function fmtMoney(x) { return '$' + x.toFixed(2); }
  function fmtLatency(ms) { return ms < 1000 ? Math.round(ms) + ' ms' : round(ms / 1000, 1).toFixed(1) + ' s'; }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------- scoreboard ----------

  // Counts for one API. Set-aside cells leave both the top and the bottom of every fraction.
  function countCells(cells, opts) {
    var c = { referenceFields: 0, setAside: 0, scored: 0, correct: 0, wrong: 0, missing: 0 };
    cells.forEach(function (cell) {
      if (!isScored(cell)) return;
      c.referenceFields += 1;
      if (cell.verdict === 'correct') c.correct += 1;
      else if (cell.verdict === 'missing') c.missing += 1;
      else c.wrong += 1;
      if (isSetAside(cell, opts)) c.setAside += 1;
    });
    c.scored = c.referenceFields - c.setAside;
    c.wrongScored = c.wrong - c.setAside;
    return c;
  }

  function cellsFor(run, api) {
    if (!run._byApi) {
      run._byApi = {};
      run.cells.forEach(function (c) { (run._byApi[c.api] = run._byApi[c.api] || []).push(c); });
    }
    return run._byApi[api] || [];
  }

  function scoreboard(run, opts) {
    var rows = run.apis.map(function (api) {
      var c = countCells(cellsFor(run, api.id), opts);
      var calls = run.calls.filter(function (x) { return x.api === api.id; });
      var cost = sum(calls.map(function (x) { return x.cost; }));
      return {
        api: api.id, name: api.name, type: api.type,
        referenceFields: c.referenceFields, setAside: c.setAside, scored: c.scored,
        correct: c.correct, wrong: c.wrong, wrongScored: c.wrongScored, missing: c.missing,
        successRate: c.scored ? 100 * c.correct / c.scored : 0,
        accuracy: (c.correct + c.wrongScored) ? 100 * c.correct / (c.correct + c.wrongScored) : 0,
        calls: calls.length, cost: cost,
        costPer1000Correct: c.correct ? cost / c.correct * 1000 : Infinity,
        medianLatencyMs: median(calls.map(function (x) { return x.latencyMs; }))
      };
    });
    var ranked = rows.slice().sort(function (a, b) {
      return b.successRate - a.successRate || b.accuracy - a.accuracy || (a.api < b.api ? -1 : 1);
    });
    ranked.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }

  function leaderOf(board) { return board.filter(function (r) { return r.rank === 1; })[0].api; }

  // Compare to the leader, or to the runner-up when the selected API is the leader.
  function defaultCompare(board, selected) {
    var lead = leaderOf(board);
    if (lead !== selected) return lead;
    return board.filter(function (r) { return r.rank === 2; })[0].api;
  }

  // Rank moves when the possible benchmark-fault cells are set aside.
  function rankChanges(run) {
    var off = scoreboard(run, { setAside: false });
    var on = scoreboard(run, { setAside: true });
    var moves = [];
    off.forEach(function (r) {
      var after = on.filter(function (x) { return x.api === r.api; })[0];
      if (after.rank !== r.rank) moves.push({ api: r.api, name: r.name, from: r.rank, to: after.rank });
    });
    moves.sort(function (a, b) { return (a.to - a.from) - (b.to - b.from) || (a.api < b.api ? -1 : 1); });
    return moves;
  }

  function rankChangeText(run) {
    var moves = rankChanges(run);
    if (!moves.length) return 'No API changes rank.';
    var up = moves.filter(function (m) { return m.to < m.from; });
    var down = moves.filter(function (m) { return m.to > m.from; });
    var parts = up.map(function (m) { return m.name + ' moves from ' + ordinal(m.from) + ' to ' + ordinal(m.to); });
    var downParts = down.map(function (m) { return m.name + ' drops from ' + ordinal(m.from) + ' to ' + ordinal(m.to); });
    return parts.concat(downParts).join('; ') + '.';
  }

  // ---------- sampling noise ----------

  // Standard error of one success rate, in points: sqrt(p(1 - p) / n).
  function standardError(row) {
    var p = row.successRate / 100;
    return row.scored ? 100 * Math.sqrt(p * (1 - p) / row.scored) : 0;
  }

  /*
    Gap between two APIs on the same fields (compare minus selected), in points,
    with the standard error of that gap. Both APIs answer the same fields, so the
    error comes from the fields where exactly one of them was right (a paired
    comparison). Every scored field counts; nothing is set aside here.
  */
  function pairedGap(run, selected, compare) {
    var idx = itemIndex(run);
    var diffs = [];
    run._itemOrder.forEach(function (k) {
      var s = idx[k][selected], c = idx[k][compare];
      if (!isScored(s)) return;
      diffs.push((c.verdict === 'correct' ? 1 : 0) - (s.verdict === 'correct' ? 1 : 0));
    });
    var n = diffs.length;
    var mean = sum(diffs) / n;
    var variance = sum(diffs.map(function (d) { return (d - mean) * (d - mean); })) / (n - 1);
    return { gap: 100 * mean, se: 100 * Math.sqrt(variance / n), fields: n };
  }

  // Pairs of APIs that swap places when the possible benchmark-fault cells are set aside.
  function rankSwaps(run) {
    var off = scoreboard(run, { setAside: false });
    var on = scoreboard(run, { setAside: true });
    var rankOn = {};
    on.forEach(function (r) { rankOn[r.api] = r.rank; });
    var swaps = [];
    off.forEach(function (x) {
      off.forEach(function (y) {
        if (x.rank > y.rank && rankOn[x.api] < rankOn[y.api]) {
          var g = pairedGap(run, x.api, y.api);
          swaps.push({ up: x.api, down: y.api, gap: g.gap, se: g.se, weak: Math.abs(g.gap) < 2 * g.se });
        }
      });
    });
    return swaps;
  }

  function rankNoiseText(run) {
    var swaps = rankSwaps(run);
    if (!swaps.length) return '';
    var s = swaps[0];
    var head = 'Before anything is set aside, ' + apiName(run, s.up) + ' trails ' + apiName(run, s.down) + ' by ' + fmtPts(s.gap) +
      ' points, and the standard error of that gap is ' + fmtPts(s.se) + ' points. ';
    return head + (s.weak
      ? 'A gap under two standard errors could reverse on a fresh sample of similar companies, so the swap is a weak signal on its own.'
      : 'The gap is more than two standard errors, so the swap is unlikely to be sampling noise.');
  }

  // ---------- gap breakdown ----------

  function itemIndex(run) {
    if (!run._byItem) {
      run._byItem = {};
      run._itemOrder = [];
      run.cells.forEach(function (c) {
        if (!run._byItem[c.itemKey]) { run._byItem[c.itemKey] = {}; run._itemOrder.push(c.itemKey); }
        run._byItem[c.itemKey][c.api] = c;
      });
    }
    return run._byItem;
  }

  /*
    Where the gap between two APIs comes from.
    gap = compare API's success rate - selected API's success rate (points).
    A field moves the gap only when exactly one of the two APIs got it right. That
    field lands in the group (slice x reason) of the API that missed it, so the
    groups add up to the gap exactly. With set-aside on, the two APIs are scored on
    slightly different cells; that difference lands in one separate "set-aside
    effect" value so the check still adds up.
  */
  function gapBreakdown(run, selected, compare, opts) {
    var idx = itemIndex(run);
    var sIn = 0, cIn = 0, sCorrect = 0, cCorrect = 0;
    run._itemOrder.forEach(function (k) {
      var s = idx[k][selected], c = idx[k][compare];
      if (!isScored(s)) return;
      if (!isSetAside(s, opts)) sIn += 1;
      if (!isSetAside(c, opts)) cIn += 1;
      if (s.verdict === 'correct') sCorrect += 1;
      if (c.verdict === 'correct') cCorrect += 1;
    });
    var gap = 100 * cCorrect / cIn - 100 * sCorrect / sIn;
    var groups = {};
    var adjustment = 0;
    run._itemOrder.forEach(function (k) {
      var s = idx[k][selected], c = idx[k][compare];
      if (!isScored(s)) return;
      var sc = s.verdict === 'correct', cc = c.verdict === 'correct';
      if (sc && cc) { adjustment += 100 / cIn - 100 / sIn; return; }
      if (!sc && !cc) return;
      var missed = cc ? s : c;
      var value = cc ? 100 / cIn : -100 / sIn;
      if (isSetAside(missed, opts)) { adjustment += value; return; }
      var key = missed.slice + '|' + missed.tag + '|' + missed.api;
      if (!groups[key]) groups[key] = { key: key, slice: missed.slice, tag: missed.tag, missedBy: missed.api, other: cc ? compare : selected, cells: 0, value: 0 };
      groups[key].cells += 1;
      groups[key].value += value;
    });
    var dir = gap >= 0 ? 1 : -1;
    var list = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) {
      return dir * (b.value - a.value) || (a.key < b.key ? -1 : 1);
    });
    var total = sum(list.map(function (g) { return g.value; })) + adjustment;
    var topTwo = list.slice(0, 2).reduce(function (a, g) { return a + g.value; }, 0);
    return {
      selected: selected, compare: compare, gap: gap, groups: list, adjustment: adjustment,
      sumOfParts: total, sumCheck: Math.abs(total - gap) < 0.05,
      topShare: gap !== 0 && list.length ? 100 * list[0].value / gap : 0,
      topTwoShare: gap !== 0 ? 100 * topTwo / gap : 0,
      selectedScored: sIn, compareScored: cIn
    };
  }

  /*
    Bars to draw: the largest groups that push the gap in its own direction, then
    the smaller ones folded into one bar, then one bar for every field the other
    API missed (they pull the gap the other way), then the set-aside effect.
  */
  function gapBars(breakdown, maxBars) {
    var n = maxBars || 7;
    var dir = breakdown.gap >= 0 ? 1 : -1;
    var same = breakdown.groups.filter(function (g) { return g.value * dir > 0; });
    var opposite = breakdown.groups.filter(function (g) { return g.value * dir <= 0; });
    var trailing = dir > 0 ? breakdown.selected : breakdown.compare;
    var ahead = dir > 0 ? breakdown.compare : breakdown.selected;
    function spec(list, missedBy, other) {
      return { kind: 'gap', missedBy: missedBy, other: other, groups: list.map(function (g) { return { slice: g.slice, tag: g.tag }; }) };
    }
    var bars = same.slice(0, n).map(function (g) { return { kind: 'group', group: g, value: g.value, rows: spec([g], g.missedBy, g.other) }; });
    var rest = same.slice(n);
    if (rest.length) {
      bars.push({ kind: 'other', count: rest.length, missedBy: trailing, value: sum(rest.map(function (g) { return g.value; })), rows: spec(rest, trailing, ahead) });
    }
    if (opposite.length) {
      bars.push({
        kind: 'opposite', count: opposite.length, missedBy: ahead, other: trailing,
        cells: sum(opposite.map(function (g) { return g.cells; })), value: sum(opposite.map(function (g) { return g.value; })),
        rows: spec(opposite, ahead, trailing)
      });
    }
    if (Math.abs(breakdown.adjustment) > 1e-9) bars.push({ kind: 'adjustment', value: breakdown.adjustment });
    return bars;
  }

  function barLabel(run, bar) {
    if (bar.kind === 'group') return groupLabel(run, bar.group);
    if (bar.kind === 'other') return bar.count + ' smaller groups · ' + apiName(run, bar.missedBy) + ' missed';
    if (bar.kind === 'opposite') return bar.cells + ' fields ' + apiName(run, bar.missedBy) + ' missed and ' + apiName(run, bar.other) + ' got right';
    return 'Set-aside effect · the two APIs are scored on different cells';
  }

  function groupPhrase(run, group) {
    var slice = byId(run.slices)[group.slice];
    var tag = byId(run.tags)[group.tag];
    return slice.phrase + ' where ' + apiName(run, group.missedBy) + ' ' + tag.phrase;
  }

  function groupLabel(run, group) {
    return byId(run.slices)[group.slice].label + ' · ' + byId(run.tags)[group.tag].label + ' · ' + apiName(run, group.missedBy) + ' missed';
  }

  // The one plain result sentence at the top of the page.
  function headline(run, selected, compare, opts) {
    var b = gapBreakdown(run, selected, compare, opts);
    var S = apiName(run, selected), C = apiName(run, compare);
    if (round(b.gap, 1) === 0 || !b.groups.length) {
      return { text: S + ' and ' + C + ' are level on this run.', breakdown: b, group: null };
    }
    var top = b.groups[0];
    var verb = b.gap > 0 ? 'trails' : 'leads';
    var noun = b.gap > 0 ? 'gap' : 'lead';
    var text = S + ' ' + verb + ' ' + C + ' by ' + fmtPts(b.gap) + ' points; ' + Math.round(b.topShare) + '% of that ' + noun + ' is ' + groupPhrase(run, top) + '.';
    return { text: text, breakdown: b, group: top };
  }

  // Does the headline finding survive once possible benchmark-fault cells are set aside?
  function findingSurvives(run, selected, compare) {
    var off = gapBreakdown(run, selected, compare, { setAside: false });
    var on = gapBreakdown(run, selected, compare, { setAside: true });
    var same = !!(off.groups[0] && on.groups[0] && off.groups[0].key === on.groups[0].key && (off.gap > 0) === (on.gap > 0));
    return { survives: same, off: off, on: on };
  }

  // ---------- failure mode of the field ----------

  function fieldFailure(run, opts) {
    var slices = run.slices.map(function (sl) {
      var apis = run.apis.map(function (api) {
        var cells = cellsFor(run, api.id).filter(function (c) { return c.slice === sl.id && isScored(c) && !isSetAside(c, opts); });
        var byTag = {};
        var failures = 0;
        cells.forEach(function (c) {
          if (c.verdict === 'correct') return;
          failures += 1;
          byTag[c.tag] = (byTag[c.tag] || 0) + 1;
        });
        return { api: api.id, scored: cells.length, failures: failures, rate: cells.length ? 100 * failures / cells.length : 0, byTag: byTag };
      });
      var best = apis.slice().sort(function (a, b) { return a.rate - b.rate || (a.api < b.api ? -1 : 1); })[0];
      var tagTotals = {};
      var allFailures = 0;
      apis.forEach(function (a) {
        Object.keys(a.byTag).forEach(function (t) { tagTotals[t] = (tagTotals[t] || 0) + a.byTag[t]; allFailures += a.byTag[t]; });
      });
      var mainTag = Object.keys(tagTotals).sort(function (x, y) { return tagTotals[y] - tagTotals[x] || (x < y ? -1 : 1); })[0] || null;
      return { slice: sl.id, apis: apis, best: best, mainTag: mainTag, mainTagShare: allFailures ? 100 * tagTotals[mainTag] / allFailures : 0, failures: allFailures };
    });
    var worst = slices.slice().sort(function (a, b) { return b.best.rate - a.best.rate; })[0];
    var maxRate = Math.max.apply(null, slices.map(function (s) { return Math.max.apply(null, s.apis.map(function (a) { return a.rate; })); }));
    return { slices: slices, callout: worst, maxRate: maxRate };
  }

  function fieldCallout(run, ff) {
    var w = ff.callout;
    var sl = byId(run.slices)[w.slice];
    var tag = byId(run.tags)[w.mainTag];
    var topFor = mainTagTopCount(w);
    return sl.label + ' are the failure mode of the field: even the best API there (' + apiName(run, w.best.api) + ') misses ' +
      Math.round(w.best.rate) + '% of fields, and "' + tag.label.toLowerCase() + '" is ' + Math.round(w.mainTagShare) +
      '% of all misses in that slice across the six APIs.' +
      (topFor * 2 >= w.apis.length
        ? ' It is the top reason for ' + topFor + ' of the ' + w.apis.length + ' APIs, so it is a finding about the category, not about one vendor.'
        : '');
  }

  // How many APIs have the slice's main reason as their own top reason there.
  function mainTagTopCount(sliceResult) {
    return sliceResult.apis.filter(function (a) {
      var tags = Object.keys(a.byTag);
      if (!tags.length) return false;
      var top = Math.max.apply(null, tags.map(function (t) { return a.byTag[t]; }));
      return a.byTag[sliceResult.mainTag] === top;
    }).length;
  }

  // ---------- the rows behind a bar ----------

  var FIELD_ORDER = { hq_city: 0, industry: 1, employee_range: 2, founded_year: 3, linkedin_url: 4 };

  /*
    spec: { kind: 'gap', missedBy, other, groups: [{ slice, tag }] }  fields one API missed and the other got right
          { kind: 'field', api, slice, tag }                         every miss of one API in one slice for one reason
  */
  function rowsFor(run, spec, opts, limit) {
    var idx = itemIndex(run);
    var api = spec.kind === 'gap' ? spec.missedBy : spec.api;
    var wanted = {};
    (spec.groups || [{ slice: spec.slice, tag: spec.tag }]).forEach(function (g) { wanted[g.slice + '|' + g.tag] = true; });
    var matches = cellsFor(run, api).filter(function (c) {
      if (!isScored(c) || c.verdict === 'correct' || isSetAside(c, opts)) return false;
      if (!wanted[c.slice + '|' + c.tag]) return false;
      if (spec.kind === 'gap') return idx[c.itemKey][spec.other].verdict === 'correct';
      return true;
    }).sort(function (a, b) {
      return a.company < b.company ? -1 : a.company > b.company ? 1 : FIELD_ORDER[a.field] - FIELD_ORDER[b.field];
    });
    return { total: matches.length, rows: matches.slice(0, limit === undefined ? 8 : limit) };
  }

  // ---------- check before posting ----------

  function setAsideCounts(run) {
    return run.apis.map(function (api) {
      var c = countCells(cellsFor(run, api.id), { setAside: true });
      var near = cellsFor(run, api.id).filter(function (x) { return x.verdict === 'wrong' && x.tag === 'near_match'; }).length;
      return { api: api.id, name: api.name, setAside: c.setAside, nearMatch: near, refOutdated: c.setAside - near };
    });
  }

  // ---------- draft post ----------

  // The largest benchmark-side group (reason x field) decides what changes in v2.
  function v2Change(run) {
    var counts = {};
    run.cells.forEach(function (c) {
      if (c.verdict !== 'wrong' || !BENCH_SIDE[c.tag]) return;
      var k = c.tag + '|' + c.field;
      counts[k] = (counts[k] || 0) + 1;
    });
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); });
    if (!keys.length) return { tag: null, field: null, cells: 0, text: 'nothing; no cells look like the benchmark\'s own fault.' };
    var parts = keys[0].split('|');
    var tag = parts[0], field = parts[1], n = counts[keys[0]];
    var fieldLabel = byId(run.fields)[field].label;
    var text;
    if (tag === 'near_match' && field === 'hq_city') text = 'accept metro-area matches for HQ city; ' + n + ' cells would flip.';
    else if (tag === 'near_match') text = 'accept the neighboring band for ' + fieldLabel.toLowerCase() + ' when headcount sits on an edge; ' + n + ' cells would flip.';
    else text = 're-check ' + n + ' ' + fieldLabel + ' references where an API returned a newer value.';
    return { tag: tag, field: field, cells: n, text: text };
  }

  function draftPost(run, selected, compare, opts) {
    var h = headline(run, selected, compare, opts);
    var b = h.breakdown;
    var S = apiName(run, selected), C = apiName(run, compare);
    var caption = 'Chart: where ' + S + (b.gap >= 0 ? ' loses points to ' : ' gains points on ') + C +
      ', by company type and failure reason; the top two groups are ' + Math.round(b.topTwoShare) + '% of the ' +
      (b.gap >= 0 ? 'gap' : 'lead') + '. ' + run.companies.length + ' fictional companies, ' + run.fields.length + ' fields, synthetic data.';
    var v2 = v2Change(run);
    var lines = [h.text, caption, 'What changes in v2: ' + v2.text];
    return { lines: lines, text: lines.join('\n'), v2: v2 };
  }

  // ---------- checks ----------

  function checks(run, selected, compare, opts) {
    var out = [];
    run.apis.forEach(function (api) {
      var c = countCells(cellsFor(run, api.id), opts);
      var ok = c.correct + c.wrong + c.missing === c.referenceFields && c.scored === c.referenceFields - c.setAside;
      out.push({
        label: api.name + ': correct + wrong + missing = fields with a reference',
        ok: ok,
        detail: c.correct + ' + ' + c.wrong + ' + ' + c.missing + ' = ' + c.referenceFields + (opts && opts.setAside ? ' (' + c.setAside + ' set aside, ' + c.scored + ' scored)' : '')
      });
    });
    var b = gapBreakdown(run, selected, compare, opts);
    out.push({
      label: 'Gap contributions add up to the total gap (' + apiName(run, compare) + ' vs ' + apiName(run, selected) + ')',
      ok: b.sumCheck,
      detail: 'parts ' + b.sumOfParts.toFixed(2) + ' vs gap ' + b.gap.toFixed(2) + ' points (allowed difference 0.05)'
    });
    var blanks = run.items.filter(function (i) { return i.reference === ''; }).length;
    out.push({ label: 'Blank references left out of every denominator', ok: true, detail: blanks + ' of ' + run.items.length + ' reference values' });
    out.push({ label: 'Generator seed', ok: true, detail: String(run.seed) });
    return out;
  }

  // ---------- run 2: what moved between runs ----------

  function cloneCell(c, changes) {
    var n = {};
    Object.keys(c).forEach(function (k) { n[k] = c[k]; });
    Object.keys(changes).forEach(function (k) { n[k] = changes[k]; });
    return n;
  }

  function flipped(before, after) { return (before.verdict === 'correct') !== (after.verdict === 'correct'); }

  // Scoring rule: accept a near match on one field (for example metro area for HQ city).
  function applyScoringRule(cells, rule) {
    var changes = [];
    var next = cells.map(function (c) {
      if (c.verdict === 'wrong' && c.tag === rule.tag && c.field === rule.field) {
        var n = cloneCell(c, { verdict: 'correct', tag: null, reason: 'accepted under the new rule: ' + rule.label });
        changes.push({ before: c, after: n });
        return n;
      }
      return c;
    });
    return { cells: next, changes: changes };
  }

  // Reference refresh: replace the reference, then judge the same answer again.
  function applyReferenceRefresh(cells, refreshes) {
    var byItem = {};
    refreshes.forEach(function (r) { byItem[r.itemKey] = r; });
    var changes = [];
    var next = cells.map(function (c) {
      var r = byItem[c.itemKey];
      if (!r) return c;
      var n;
      if (c.returned === '') n = cloneCell(c, { reference: r.newReference });
      else if (c.returned === r.newReference) n = cloneCell(c, { reference: r.newReference, verdict: 'correct', tag: null, reason: '' });
      else if (c.returned === r.oldReference) {
        n = cloneCell(c, { reference: r.newReference, verdict: 'wrong', tag: 'pre_rebrand', reason: 'returned the LinkedIn page from before the rebrand (' + r.oldName + ')' });
      } else n = cloneCell(c, { reference: r.newReference });
      if (flipped(c, n)) changes.push({ before: c, after: n });
      return n;
    });
    return { cells: next, changes: changes };
  }

  // New answers from a vendor: replace the returned value, then judge it again.
  function applyNewAnswers(cells, answers) {
    var byCell = {};
    answers.forEach(function (a) { byCell[a.cellKey] = a; });
    var changes = [];
    var next = cells.map(function (c) {
      var a = byCell[c.key];
      if (!a) return c;
      var n;
      if (a.returned === '') n = cloneCell(c, { returned: '', verdict: 'missing', tag: 'no_value', reason: 'no value returned' });
      else if (a.returned === c.reference) n = cloneCell(c, { returned: a.returned, verdict: 'correct', tag: null, reason: '' });
      else n = cloneCell(c, { returned: a.returned, verdict: 'wrong' });
      if (flipped(c, n)) changes.push({ before: c, after: n });
      return n;
    });
    return { cells: next, changes: changes };
  }

  function successRates(run, cells) {
    var out = {};
    run.apis.forEach(function (api) {
      var mine = cells.filter(function (c) { return c.api === api.id; });
      var cc = countCells(mine, null);
      out[api.id] = cc.scored ? 100 * cc.correct / cc.scored : 0;
    });
    return out;
  }

  var STEP_LABELS = { scoring: 'Scoring rule changed', reference: 'Reference refreshed', answers: 'API answers changed' };
  var DEFAULT_ORDER = ['scoring', 'reference', 'answers'];

  /*
    Split each API's score change into the three causes by making the changes
    one at a time in a fixed order and measuring the score after each step.
  */
  function attributeRunChange(run, plan, order) {
    var steps = order || DEFAULT_ORDER;
    var apply = {
      scoring: function (cells) { return applyScoringRule(cells, plan.scoringRule); },
      reference: function (cells) { return applyReferenceRefresh(cells, plan.refreshes); },
      answers: function (cells) { return applyNewAnswers(cells, plan.answers); }
    };
    var state = run.cells;
    var start = successRates(run, state);
    var prev = start;
    var parts = {};
    run.apis.forEach(function (a) { parts[a.id] = {}; });
    var flips = [];
    steps.forEach(function (step) {
      var res = apply[step](state);
      var now = successRates(run, res.cells);
      run.apis.forEach(function (a) { parts[a.id][step] = now[a.id] - prev[a.id]; });
      res.changes.forEach(function (ch) { flips.push({ cause: step, before: ch.before, after: ch.after, up: ch.after.verdict === 'correct' }); });
      state = res.cells;
      prev = now;
    });
    var apis = run.apis.map(function (a) {
      return { api: a.id, name: a.name, before: start[a.id], after: prev[a.id], delta: prev[a.id] - start[a.id], parts: parts[a.id] };
    });
    return { order: steps, apis: apis, flips: flips, cells: state };
  }

  // Largest difference in any part when the steps run in reverse order.
  function orderSensitivity(run, plan) {
    var fwd = attributeRunChange(run, plan, DEFAULT_ORDER);
    var rev = attributeRunChange(run, plan, DEFAULT_ORDER.slice().reverse());
    var maxDiff = 0;
    fwd.apis.forEach(function (a, i) {
      DEFAULT_ORDER.forEach(function (s) { maxDiff = Math.max(maxDiff, Math.abs(a.parts[s] - rev.apis[i].parts[s])); });
    });
    return maxDiff;
  }

  function moverLines(run, result, plan) {
    var countBy = { scoring: 0, reference: 0, answers: 0 };
    var answerApis = {};
    result.flips.forEach(function (f) {
      countBy[f.cause] += 1;
      if (f.cause === 'answers') answerApis[f.after.api] = true;
    });
    var answerNames = Object.keys(answerApis).sort().map(function (a) { return apiName(run, a); });
    var ours = function (a) { return a.parts.scoring + a.parts.reference; };
    var byAnswers = result.apis.slice().sort(function (x, y) { return Math.abs(y.parts.answers) - Math.abs(x.parts.answers); })[0];
    var still = result.apis.filter(function (a) { return Math.abs(a.parts.answers) < 1e-9; });
    var byUs = (still.length ? still : result.apis).slice().sort(function (x, y) { return ours(y) - ours(x); })[0];

    var moved = function (x) { return (x < 0 ? ' lost ' : ' gained ') + fmtPts(x) + ' points'; };
    var headlineText = byAnswers.name + moved(byAnswers.delta) + ' between runs, ' + fmtPts(byAnswers.parts.answers) +
      ' of them from its own new answers. ' + byUs.name + moved(byUs.delta) + ' without a single new answer: ' +
      fmtSigned(byUs.parts.scoring) + ' from our scoring rule and ' + fmtSigned(byUs.parts.reference) + ' from refreshed references.';
    var changelog = 'Run 2: ' + plan.scoringRule.pastLabel + ' (' + countBy.scoring + ' cells flipped); refreshed the LinkedIn reference for ' +
      plan.refreshes.length + ' rebranded companies (' + countBy.reference + ' cells flipped); new answers from ' +
      (answerNames.length ? answerNames.join(', ') : 'no API') + ' (' + countBy.answers + ' cells flipped).';
    var post = byAnswers.name + ' ' + fmtSigned(byAnswers.delta) + ' points: ' + fmtSigned(byAnswers.parts.answers) + ' from new answers, ' +
      fmtSigned(ours(byAnswers)) + ' from our rescoring. ' + byUs.name + ' ' + fmtSigned(byUs.delta) + ' with no new answers at all.';
    return { headline: headlineText, changelog: changelog, post: post, counts: countBy };
  }

  root.BenchReadout = {
    BENCH_SIDE: BENCH_SIDE, STEP_LABELS: STEP_LABELS, DEFAULT_ORDER: DEFAULT_ORDER,
    isScored: isScored, isSetAside: isSetAside, median: median, countCells: countCells,
    scoreboard: scoreboard, leaderOf: leaderOf, defaultCompare: defaultCompare,
    rankChanges: rankChanges, rankChangeText: rankChangeText,
    standardError: standardError, pairedGap: pairedGap, rankSwaps: rankSwaps, rankNoiseText: rankNoiseText,
    gapBreakdown: gapBreakdown, gapBars: gapBars, barLabel: barLabel, groupPhrase: groupPhrase, groupLabel: groupLabel,
    headline: headline, findingSurvives: findingSurvives,
    fieldFailure: fieldFailure, fieldCallout: fieldCallout, mainTagTopCount: mainTagTopCount, rowsFor: rowsFor, setAsideCounts: setAsideCounts,
    v2Change: v2Change, draftPost: draftPost, checks: checks,
    applyScoringRule: applyScoringRule, applyReferenceRefresh: applyReferenceRefresh, applyNewAnswers: applyNewAnswers,
    successRates: successRates, attributeRunChange: attributeRunChange, orderSensitivity: orderSensitivity, moverLines: moverLines,
    fmt: { pct: fmtPct, pts: fmtPts, signed: fmtSigned, money: fmtMoney, latency: fmtLatency, ordinal: ordinal, capitalize: capitalize }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
