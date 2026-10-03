/*
  Main page: draws the readout from the rows. Every number comes from
  readout.mjs at load time; nothing here is typed in by hand.
*/
(function () {
  'use strict';

  var D = window.BenchData, R = window.BenchReadout, U = window.BenchUI, F = R.fmt;
  var el = U.el, svg = U.svg;

  var run = D.generate(D.SEED);
  var TAG = index(run.tags), SLICE = index(run.slices), FIELD = index(run.fields), API = index(run.apis);
  var TAG_ORDER = ['parent_company', 'pre_rebrand', 'same_name', 'stale_value', 'no_value', 'near_match', 'ref_outdated'];

  var state = { selected: 'C', compare: null, setAside: false, sortKey: 'rank', sortDir: 1, rows: null };

  function index(list) { var m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; }
  function opts() { return { setAside: state.setAside }; }
  function compareFor(board) {
    if (!state.compare || state.compare === state.selected) return R.defaultCompare(board, state.selected);
    return state.compare;
  }

  // ---------- 1. result sentence ----------

  function renderHeadline(board, cmp) {
    U.byId('headline').textContent = R.headline(run, state.selected, cmp, opts()).text;
    var note = U.byId('headline-note');
    if (state.setAside) {
      var n = board.reduce(function (s, r) { return s + r.setAside; }, 0);
      note.textContent = 'Set-aside view: ' + n + ' cells that might be the benchmark\'s own fault are left out of every score.';
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  // ---------- 2. scoreboard ----------

  var COLUMNS = [
    { key: 'rank', label: '#', num: false, dir: 1 },
    { key: 'api', label: 'API', num: false, dir: 1 },
    { key: 'successRate', label: 'Success rate', num: true, dir: -1 },
    { key: 'accuracy', label: 'Accuracy on returned values', num: true, dir: -1 },
    { key: 'costPer1000Correct', label: '$ per 1,000 correct', num: true, dir: 1 },
    { key: 'medianLatencyMs', label: 'Median latency', num: true, dir: 1 },
    { key: 'setAside', label: 'Set aside', num: true, dir: -1, onlySetAside: true }
  ];

  function renderScoreboard(board) {
    var perApi = board[0].referenceFields;
    U.byId('scoreboard-lede').textContent = run.apis.length + ' fictional APIs looked up ' + run.fields.length + ' fields for ' +
      run.companies.length + ' fictional companies, one call per company, ' + perApi + ' fields with a reference each. Click a row to explain that API below; click a column name to sort.';

    var cols = COLUMNS.filter(function (c) { return !c.onlySetAside || state.setAside; });
    var head = el('tr', null, cols.map(function (c) {
      var active = state.sortKey === c.key;
      var btn = el('button', {
        type: 'button', 'class': 'sort-btn',
        'aria-label': 'Sort by ' + c.label,
        on: { click: function () {
          if (state.sortKey === c.key) state.sortDir = -state.sortDir;
          else { state.sortKey = c.key; state.sortDir = c.dir; }
          render();
        } }
      }, [c.label, active ? el('span', { 'class': 'arrow', 'aria-hidden': 'true', text: state.sortDir > 0 ? '▲' : '▼' }) : null]);
      return el('th', { 'class': c.num ? 'num' : null, scope: 'col', 'aria-sort': active ? (state.sortDir > 0 ? 'ascending' : 'descending') : null }, btn);
    }));

    var rows = board.slice().sort(function (a, b) {
      var k = state.sortKey;
      var x = a[k], y = b[k];
      if (x === y) return a.rank - b.rank;
      return (x < y ? -1 : 1) * state.sortDir;
    });

    var body = el('tbody', null, rows.map(function (r) {
      var select = function () { selectApi(r.api); };
      var cells = {
        rank: el('td', { 'class': 'rank', text: String(r.rank) }),
        api: el('td', null, [el('strong', { text: r.name }), el('span', { 'class': 'type', text: r.type })]),
        successRate: el('td', { 'class': 'num', text: F.pct(r.successRate) }),
        accuracy: el('td', { 'class': 'num', text: F.pct(r.accuracy) }),
        costPer1000Correct: el('td', { 'class': 'num', text: F.money(r.costPer1000Correct) }),
        medianLatencyMs: el('td', { 'class': 'num', text: F.latency(r.medianLatencyMs) }),
        setAside: el('td', { 'class': 'num', text: String(r.setAside) })
      };
      var tr = el('tr', {
        'class': r.api === state.selected ? 'selected' : null, tabindex: '0',
        'aria-selected': r.api === state.selected ? 'true' : 'false',
        on: { click: select, keydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } } }
      }, cols.map(function (c) { return cells[c.key]; }));
      return tr;
    }));

    var table = U.clear(U.byId('score-table'));
    table.appendChild(el('caption', { 'class': 'defs', text: 'Scoreboard for six fictional APIs' }));
    table.appendChild(el('thead', null, head));
    table.appendChild(body);
  }

  function selectApi(api) {
    state.selected = api;
    if (state.compare === api) state.compare = null;
    state.rows = null;
    render();
  }

  // ---------- 3. where the gap comes from ----------

  function renderSelectors(board, cmp) {
    var lead = R.leaderOf(board);
    var selApi = U.clear(U.byId('sel-api'));
    run.apis.forEach(function (a) {
      selApi.appendChild(el('option', { value: a.id, selected: a.id === state.selected, text: a.name }));
    });
    var selCmp = U.clear(U.byId('sel-compare'));
    run.apis.forEach(function (a) {
      if (a.id === state.selected) return;
      selCmp.appendChild(el('option', { value: a.id, selected: a.id === cmp, text: a.name + (a.id === lead ? ' (leader)' : '') }));
    });
  }

  function chartLabel(bar) {
    if (bar.kind === 'group') return SLICE[bar.group.slice].label + ' · ' + TAG[bar.group.tag].label.toLowerCase();
    if (bar.kind === 'other') return bar.count + ' smaller groups';
    if (bar.kind === 'opposite') return bar.cells + ' fields ' + API[bar.missedBy].name + ' missed, ' + API[bar.other].name + ' got right';
    return 'Set-aside effect (different cells scored)';
  }

  function renderGap(board, cmp) {
    var b = R.gapBreakdown(run, state.selected, cmp, opts());
    var bars = R.gapBars(b, 7);
    var trailing = b.gap >= 0 ? state.selected : cmp;
    var ahead = b.gap >= 0 ? cmp : state.selected;
    U.byId('gap-lede').textContent = 'Each blue bar is one company slice and one reason: fields ' + API[trailing].name + ' missed and ' +
      API[ahead].name + ' got right, as points of the ' + F.pts(b.gap) + '-point gap. The grey bar runs the other way. Click a bar to see its rows.';

    var box = U.clear(U.byId('gap-chart'));
    var W = U.widthOf(box, 640);
    var narrow = W < 560;
    var labelW = narrow ? 0 : Math.min(330, Math.round(W * 0.42));
    var valueW = 58;
    var rowH = narrow ? 46 : 30;
    var barH = 16;
    var x0 = narrow ? 0 : labelW + 10;
    var plotW = Math.max(60, W - x0 - valueW);
    var vals = bars.map(function (x) { return x.value; });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
    if (hi - lo < 1e-9) hi = lo + 1;
    var X = function (v) { return x0 + (v - lo) / (hi - lo) * plotW; };
    var H = bars.length * rowH + 8;
    var root = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Gap contributions by slice and reason' });

    bars.forEach(function (bar, i) {
      var top = i * rowH + 4;
      var by = narrow ? top + 20 : top + (rowH - barH) / 2;
      var g = svg('g');
      var cls = bar.kind === 'adjustment' ? 'bar-adj' : (bar.kind === 'opposite' ? 'bar-neg' : 'bar-pos');
      g.appendChild(svg('rect', { 'class': 'hit', x: 0, y: top, width: W, height: rowH - 2, rx: 4 }));
      var label = chartLabel(bar);
      g.appendChild(svg('text', { x: 0, y: narrow ? top + 13 : by + 12, text: label }));
      var xa = X(Math.min(0, bar.value)), xb = X(Math.max(0, bar.value));
      g.appendChild(svg('rect', { 'class': cls, x: xa, y: by, width: Math.max(1, xb - xa), height: barH, rx: 2 }));
      g.appendChild(svg('text', { x: W, y: by + 12, 'text-anchor': 'end', 'class': 'muted', text: F.signed(bar.value) }));
      if (bar.rows) {
        U.clickable(g, label + ', ' + F.signed(bar.value) + ' points. Show rows.', function () {
          state.rows = { spec: bar.rows, title: R.barLabel(run, bar) };
          renderRows();
          if (window.innerWidth < 760) U.byId('rows').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
      root.appendChild(g);
    });
    // On narrow screens labels sit above the bars, so the zero line is drawn only beside each bar.
    if (narrow) {
      bars.forEach(function (bar, i) {
        var by = i * rowH + 4 + 20;
        root.appendChild(svg('line', { 'class': 'zero', x1: X(0), x2: X(0), y1: by - 3, y2: by + barH + 3 }));
      });
    } else {
      root.appendChild(svg('line', { 'class': 'zero', x1: X(0), x2: X(0), y1: 0, y2: H }));
    }
    box.appendChild(root);

    U.byId('gap-summary').textContent = b.groups.length >= 2
      ? 'Top two groups = ' + Math.round(b.topTwoShare) + '% of the ' + (b.gap >= 0 ? 'gap' : 'lead') + '.'
      : '';
    var drawn = bars.reduce(function (s, x) { return s + x.value; }, 0);
    var check = U.clear(U.byId('gap-check'));
    var ok = Math.abs(drawn - b.gap) < 0.05;
    check.appendChild(el('span', { 'class': ok ? 'ok' : 'fail', text: ok ? 'Check passed: ' : 'Check failed: ' }));
    check.appendChild(document.createTextNode('the bars add up to ' + drawn.toFixed(2) + ' points and the gap is ' +
      b.gap.toFixed(2) + ' points (' + API[cmp].name + ' ' + F.pct(scoreOf(board, cmp)) + ' minus ' +
      API[state.selected].name + ' ' + F.pct(scoreOf(board, state.selected)) + ').'));
    return bars;
  }

  function scoreOf(board, api) { return board.filter(function (r) { return r.api === api; })[0].successRate; }

  // ---------- 4. failure mode of the field ----------

  function renderLegend() {
    var box = U.clear(U.byId('legend'));
    TAG_ORDER.forEach(function (t) {
      var tag = TAG[t];
      box.appendChild(el('span', null, [el('i', { 'class': 'sw sw-' + t, 'aria-hidden': 'true' }),
        tag.label + (tag.side === 'benchmark' ? ' (maybe the benchmark)' : '')]));
    });
  }

  function renderField() {
    var ff = R.fieldFailure(run, opts());
    U.byId('field-callout').textContent = R.fieldCallout(run, ff);
    var scaleMax = Math.max(10, Math.ceil(ff.maxRate / 10) * 10);
    var box = U.clear(U.byId('field-panels'));
    ff.slices.forEach(function (s) {
      var sl = SLICE[s.slice];
      var companies = run.companies.filter(function (c) { return c.slice === s.slice; }).length;
      var panel = el('div', { 'class': 'panel' }, [
        el('h3', { text: sl.label + ' (' + companies + ' companies)' }),
        el('p', { text: sl.about + ' Best: ' + API[s.best.api].name + ', ' + Math.round(s.best.rate) + '% failed.' })
      ]);
      box.appendChild(panel);
      var W = U.widthOf(panel, 420) - 24;
      var labelW = 46, valueW = 40, rowH = 24, barH = 14;
      var plotW = Math.max(60, W - labelW - valueW);
      var H = s.apis.length * rowH + 22;
      var root = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': sl.label + ' failure rates by API and reason' });
      [0, 0.5, 1].forEach(function (f) {
        var x = labelW + f * plotW;
        root.appendChild(svg('line', { 'class': 'axis', x1: x, x2: x, y1: 0, y2: H - 18 }));
        root.appendChild(svg('text', { x: x, y: H - 4, 'text-anchor': f === 0 ? 'start' : (f === 1 ? 'end' : 'middle'), 'class': 'muted', text: Math.round(f * scaleMax) + '%' }));
      });
      s.apis.forEach(function (a, i) {
        var y = i * rowH + 4;
        root.appendChild(svg('text', { x: 0, y: y + barH - 2, 'font-weight': a.api === s.best.api ? '700' : null, text: API[a.api].name }));
        var x = labelW;
        TAG_ORDER.forEach(function (t) {
          var n = a.byTag[t] || 0;
          if (!n) return;
          var w = (100 * n / a.scored) / scaleMax * plotW;
          var seg = svg('g');
          seg.appendChild(svg('rect', { 'class': 'hit', x: x, y: y - 2, width: Math.max(w, 2), height: barH + 4 }));
          seg.appendChild(svg('rect', { 'class': 'fill-' + t, x: x, y: y, width: Math.max(w, 1), height: barH }));
          var label = API[a.api].name + ', ' + sl.label + ', ' + TAG[t].label + ': ' + n + ' of ' + a.scored + ' fields';
          seg.appendChild(svg('title', { text: label }));
          U.clickable(seg, label + '. Show rows.', function () {
            state.rows = { spec: { kind: 'field', api: a.api, slice: s.slice, tag: t }, title: API[a.api].name + ' · ' + sl.label + ' · ' + TAG[t].label };
            renderRows();
            if (window.innerWidth < 760) U.byId('rows').scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
          root.appendChild(seg);
          x += w;
        });
        root.appendChild(svg('text', { x: W, y: y + barH - 2, 'text-anchor': 'end', 'class': 'muted', text: Math.round(a.rate) + '%' }));
      });
      panel.appendChild(root);
    });
  }

  // ---------- 5. the rows behind it ----------

  var lastBars = [];

  function renderRows() {
    if (!state.rows && lastBars[0] && lastBars[0].rows) {
      state.rows = { spec: lastBars[0].rows, title: R.barLabel(run, lastBars[0]), auto: true };
    }
    var title = U.byId('rows-title');
    var table = U.clear(U.byId('rows-table'));
    if (!state.rows) { title.textContent = 'Click any bar to see the rows behind it.'; return; }
    var res = R.rowsFor(run, state.rows.spec, opts(), 8);
    title.textContent = state.rows.title + ': showing ' + res.rows.length + ' of ' + res.total + ' failing cells' +
      (state.rows.auto ? ' (the largest bar; click any other bar to switch).' : '.');
    if (!res.rows.length) {
      table.appendChild(el('tbody', null, el('tr', null, el('td', { text: 'No rows left in this group with the current settings.' }))));
      return;
    }
    table.appendChild(el('thead', null, el('tr', null, ['Company', 'Field', 'Reference', 'Returned', 'Tag', 'Reason'].map(function (h) {
      return el('th', { scope: 'col', text: h });
    }))));
    table.appendChild(el('tbody', null, res.rows.map(function (c) {
      var mono = c.field === 'linkedin_url';
      return el('tr', null, [
        el('td', { text: c.company }),
        el('td', { text: FIELD[c.field].label }),
        el('td', { 'class': mono ? 'mono' : null, text: c.reference }),
        c.returned === '' ? el('td', { 'class': 'blank', text: '(blank)' }) : el('td', { 'class': mono ? 'mono' : null, text: c.returned }),
        el('td', null, el('span', { 'class': 'tag-chip' }, [el('i', { 'class': 'sw sw-' + c.tag, 'aria-hidden': 'true' }), TAG[c.tag].label])),
        el('td', { text: c.reason })
      ]);
    })));
  }

  // ---------- 6. check before posting ----------

  function renderCheck(cmp) {
    var box = U.clear(U.byId('check-result'));
    var counts = R.setAsideCounts(run);
    var total = counts.reduce(function (s, c) { return s + c.setAside; }, 0);
    var survive = R.findingSurvives(run, state.selected, cmp);
    var grid = el('div', { 'class': 'result-grid' });
    grid.appendChild(el('p', null, [el('strong', { text: 'Cells set aside per API (' + total + ' in all): ' })]));
    grid.appendChild(el('ul', { 'class': 'pill-list' }, counts.map(function (c) {
      return el('li', { title: c.nearMatch + ' near matches, ' + c.refOutdated + ' possibly outdated references' }, [el('b', { text: c.name + ' ' }), String(c.setAside)]);
    })));
    grid.appendChild(el('p', null, [el('strong', { text: 'Rank change: ' }), R.rankChangeText(run)]));
    var off = survive.off, on = survive.on;
    var text;
    if (survive.survives) {
      text = 'The finding holds. ' + R.fmt.capitalize(R.groupPhrase(run, off.groups[0])) + ' stay the largest group: ' +
        Math.round(off.topShare) + '% of the ' + (off.gap >= 0 ? 'gap' : 'lead') + ' with every cell counted, ' + Math.round(on.topShare) +
        '% with the set-aside cells left out (' + F.pts(off.gap) + ' points becomes ' + F.pts(on.gap) + ').';
    } else {
      text = 'The finding changes once the set-aside cells are left out, so it is not ready to post as written.';
    }
    grid.appendChild(el('p', null, [el('strong', { text: 'Does it survive? ' }), text]));
    var pg = R.pairedGap(run, state.selected, cmp);
    var noise = 'With every cell counted, the gap between ' + API[state.selected].name + ' and ' + API[cmp].name + ' is ' + F.pts(pg.gap) +
      ' points with a standard error of ' + F.pts(pg.se) + ' points, so it is ' +
      (Math.abs(pg.gap) >= 2 * pg.se ? 'well beyond sampling noise. ' : 'within sampling noise and not ready to post. ') + R.rankNoiseText(run);
    grid.appendChild(el('p', null, [el('strong', { text: 'Is it noise? ' }), noise]));
    box.appendChild(grid);
  }

  // ---------- 7. draft post ----------

  function renderPost(cmp) {
    var post = R.draftPost(run, state.selected, cmp, opts());
    var box = U.clear(U.byId('post-text'));
    post.lines.forEach(function (line) { box.appendChild(el('p', { text: line })); });
    U.byId('copy-status').textContent = '';
    U.byId('copy-post').onclick = function () {
      U.copyText(post.lines.join('\n\n'), box, U.byId('copy-status'));
    };
  }

  // ---------- 8. how it's scored ----------

  function renderHow(board) {
    var box = U.clear(U.byId('how-body'));
    box.className = 'how';
    var blanks = run.items.filter(function (i) { return i.reference === ''; }).length;
    var stale = run.companies.filter(function (c) { return c.staleReference; }).length;
    var perApi = board[0].referenceFields;
    var calls = board[0].calls;

    function dl(pairs) {
      var list = el('dl');
      pairs.forEach(function (p) { list.appendChild(el('dt', { text: p[0] })); list.appendChild(el('dd', { text: p[1] })); });
      return list;
    }

    box.appendChild(el('h3', { text: 'Scores' }));
    box.appendChild(dl([
      ['Success rate', 'Correct answers divided by fields with a reference (' + perApi + ' per API). A blank counts as a miss.'],
      ['Accuracy on returned values', 'Correct divided by (correct + wrong). Blanks are left out, so this only judges the answers an API actually gave. Someone writing into a CRM may prefer an API that leaves a blank over one that overwrites good data with a wrong value.'],
      ['$ per 1,000 correct', 'Total cost of all ' + calls + ' calls divided by correct answers, times 1,000, so a cheap API that rarely answers is not automatically the cheapest.'],
      ['Median latency', 'The middle call time across the ' + calls + ' calls. It describes the typical call, not the slow tail.'],
      ['Gap contribution', '(compare API correct minus selected API correct) divided by all fields with a reference, times 100, for each slice and reason. Only fields where exactly one of the two was right move it, and each lands in the group of the reason the other one missed, so the bars add up to the gap.'],
      ['Failure rate', '(wrong + blank) divided by fields with a reference, for each slice.'],
      ['Standard error', 'How far a score or gap could move by chance on a fresh sample of similar companies. For one success rate it is the square root of p x (1 - p) / n. For the gap between two APIs it comes from the fields where exactly one of them was right, since both answer the same fields. A gap under two standard errors is a weak signal.'],
      ['Set aside', 'Near matches and possibly outdated references leave both the top and the bottom of that API\'s fractions. Two APIs can then be scored on slightly different cells; that difference gets its own grey bar so the check still adds up.']
    ]));

    var maxSe = Math.max.apply(null, board.map(R.standardError));
    box.appendChild(el('h3', { text: 'Assumptions' }));
    box.appendChild(el('ul', { 'class': 'assumptions' }, [
      'Each API gets one call per company and returns all ' + run.fields.length + ' fields from it. Cost is the API\'s flat price per call, paid whether or not the answers are right.',
      'A returned value is right only when it matches the reference exactly. Every synthetic value uses one format, so formatting never causes a miss.',
      'Every field counts the same: an HQ city weighs as much as a LinkedIn URL.',
      'Each miss has one reason. Here the generator writes the reason; on a real run it would come from a judge model or a person, and a sample of reasons would need checking by hand.',
      'The two "maybe the benchmark" reasons are set aside by their tag, not after a person re-checks each cell.',
      'Blank references are left out for every API, so all ' + run.apis.length + ' are scored on the same fields.',
      'Latency is drawn at random around each API\'s typical time, so the median means something but the slow tail is not modeled.',
      'No error bars on the scoreboard. The largest standard error of a success rate here is ' + F.pts(maxSe) + ' points, so APIs a point or two apart are not clearly ranked.'
    ].map(function (t) { return el('li', { text: t }); })));

    box.appendChild(el('h3', { text: 'Company slices' }));
    box.appendChild(dl(run.slices.map(function (s) {
      var n = run.companies.filter(function (c) { return c.slice === s.id; }).length;
      return [s.label + ' (' + n + ')', s.about];
    })));

    box.appendChild(el('h3', { text: 'Reasons for a miss' }));
    box.appendChild(dl(TAG_ORDER.map(function (t) {
      var tag = TAG[t];
      return [tag.label, tag.about + (tag.side === 'benchmark' ? ' Might be the benchmark\'s fault.' : ' The API\'s fault.')];
    })));

    box.appendChild(el('h3', { text: 'What is synthetic' }));
    box.appendChild(el('p', { text: 'Every company, API, price and rate is invented. The ' + run.companies.length +
      ' companies use .example domains. ' + blanks + ' of the ' + run.items.length + ' reference values (' +
      F.pct(100 * blanks / run.items.length) + ') are blank and are not scored for anyone. In ' + stale +
      ' rebranded companies the LinkedIn reference still holds the old page, so an API that returns the new page is judged wrong; that is planted on purpose. Each API\'s outcomes in each slice are dealt from the table at the top of data.js (seed ' +
      run.seed + '), so every pattern on this page was put there deliberately. The page proves the method, not any real vendor result.' }));

    box.appendChild(el('p', { 'class': 'lede', text: 'Planted share of right answers and blanks per slice (the rest are wrong answers, split by reason in data.js):' }));
    var head = el('tr', null, [el('th', { scope: 'col', text: 'API' })].concat(run.slices.map(function (s) { return el('th', { scope: 'col', text: s.label }); })));
    var rows = run.apis.map(function (a) {
      return el('tr', null, [el('td', { text: a.name + ' · ' + a.type })].concat(run.slices.map(function (s) {
        var r = D.PLANTED_RATES[a.id][s.id];
        return el('td', { text: Math.round(r[0] * 100) + '% right, ' + Math.round(r[1] * 100) + '% blank' });
      })));
    });
    box.appendChild(el('div', { 'class': 'table-wrap' }, el('table', { 'class': 'planted' }, [el('thead', null, head), el('tbody', null, rows)])));
  }

  // ---------- 9. checks ----------

  function renderChecks(cmp) {
    var list = U.clear(U.byId('checks-list'));
    R.checks(run, state.selected, cmp, opts()).forEach(function (c) {
      list.appendChild(el('li', null, [
        el('span', { 'class': c.ok ? 'ok' : 'fail', text: c.ok ? 'OK ' : 'FAILED ' }),
        c.label,
        el('span', { 'class': 'detail', text: c.detail })
      ]));
    });
  }

  // ---------- wiring ----------

  function render() {
    var board = R.scoreboard(run, opts());
    var cmp = compareFor(board);
    renderHeadline(board, cmp);
    renderScoreboard(board);
    renderSelectors(board, cmp);
    lastBars = renderGap(board, cmp);
    renderField();
    renderRows();
    renderCheck(cmp);
    renderPost(cmp);
    renderHow(board);
    renderChecks(cmp);
  }

  function renderCharts() {
    var board = R.scoreboard(run, opts());
    lastBars = renderGap(board, compareFor(board));
    renderField();
  }

  U.byId('sel-api').addEventListener('change', function (e) { selectApi(e.target.value); });
  U.byId('sel-compare').addEventListener('change', function (e) {
    state.compare = e.target.value;
    state.rows = null;
    render();
  });
  U.byId('toggle-setaside').addEventListener('change', function (e) {
    state.setAside = e.target.checked;
    if (state.rows && state.rows.auto) state.rows = null;
    render();
  });
  var lastWidth = window.innerWidth;
  window.addEventListener('resize', U.debounce(function () {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    renderCharts();
  }, 150));

  renderLegend();
  U.byId('toggle-setaside').checked = false;
  render();
})();
