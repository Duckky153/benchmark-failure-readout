/*
  Second page: what moved between run 1 and run 2. Every number comes from
  readout.mjs at load time.
*/
(function () {
  'use strict';

  var D = window.BenchData, R = window.BenchReadout, U = window.BenchUI, F = R.fmt;
  var el = U.el, svg = U.svg;

  var run = D.generate(D.SEED);
  var plan = D.planRun2(run);
  var result = R.attributeRunChange(run, plan);
  var lines = R.moverLines(run, result, plan);
  var sensitivity = R.orderSensitivity(run, plan);
  var FIELD = index(run.fields), API = index(run.apis);
  var CAUSES = R.DEFAULT_ORDER;
  var PAGE = 25;

  var state = { cause: 'all', api: 'all', showAll: false };

  function index(list) { var m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; }
  function verdictWord(v) { return v === 'correct' ? 'right' : (v === 'missing' ? 'blank' : 'wrong'); }

  function renderHeadline() {
    U.byId('moved-headline').textContent = lines.headline;
  }

  function renderChanges() {
    var ch = plan.changes;
    var broken = run.cells.filter(function (c) { return c.api === ch.answerUpdate.api && c.verdict === 'wrong' && c.tag === ch.answerUpdate.tag; }).length;
    var list = U.clear(U.byId('changes-list'));
    [
      [API[ch.answerUpdate.api].name + ' ships an update.', ' ' + plan.answers.length + ' of its ' + broken +
        ' subsidiary answers that returned the parent company now return the subsidiary\'s own value. (Vendor side.)'],
      ['References refreshed.', ' The LinkedIn reference for ' + plan.refreshes.length +
        ' rebranded companies is updated from the old page to the new one, and every API\'s answer is judged again. (Benchmark side.)'],
      ['Scoring rule changed.', ' The judge now accepts a metro area for HQ city. In run 1 that cost ' + lines.counts.scoring +
        ' cells across the six APIs. (Benchmark side.)']
    ].forEach(function (p) { list.appendChild(el('li', null, [el('strong', { text: p[0] }), p[1]])); });
  }

  function renderLegend() {
    var box = U.clear(U.byId('cause-legend'));
    CAUSES.forEach(function (c) {
      box.appendChild(el('span', null, [el('i', { 'class': 'sw sw-' + c, 'aria-hidden': 'true' }), R.STEP_LABELS[c]]));
    });
  }

  function renderChart() {
    var box = U.clear(U.byId('split-chart'));
    var W = U.widthOf(box, 640);
    var labelW = 52, valueW = 56, rowH = 32, barH = 16;
    var plotW = Math.max(80, W - labelW - valueW);
    var lo = 0, hi = 0;
    result.apis.forEach(function (a) {
      var pos = 0, neg = 0;
      CAUSES.forEach(function (c) { if (a.parts[c] > 0) pos += a.parts[c]; else neg += a.parts[c]; });
      hi = Math.max(hi, pos); lo = Math.min(lo, neg);
    });
    if (hi - lo < 1e-9) hi = 1;
    var X = function (v) { return labelW + (v - lo) / (hi - lo) * plotW; };
    var H = result.apis.length * rowH + 8;
    var root = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Score change by cause for each API' });
    result.apis.forEach(function (a, i) {
      var y = i * rowH + (rowH - barH) / 2 + 4;
      root.appendChild(svg('text', { x: 0, y: y + 12, text: a.name }));
      var pos = 0, neg = 0;
      CAUSES.forEach(function (c) {
        var v = a.parts[c];
        if (Math.abs(v) < 1e-9) return;
        var from = v > 0 ? pos : neg + v;
        var to = v > 0 ? pos + v : neg;
        if (v > 0) pos += v; else neg += v;
        var rect = svg('rect', { 'class': 'fill-' + c, x: X(from), y: y, width: Math.max(1, X(to) - X(from)), height: barH });
        rect.appendChild(svg('title', { text: a.name + ', ' + R.STEP_LABELS[c] + ': ' + F.signed(v) + ' points' }));
        root.appendChild(rect);
      });
      root.appendChild(svg('line', { x1: X(a.delta), x2: X(a.delta), y1: y - 4, y2: y + barH + 4, 'stroke-width': 2, 'class': 'tick' }));
      root.appendChild(svg('text', { x: W, y: y + 12, 'text-anchor': 'end', 'class': 'muted', text: F.signed(a.delta) }));
    });
    root.appendChild(svg('line', { 'class': 'zero', x1: X(0), x2: X(0), y1: 0, y2: H }));
    box.appendChild(root);
  }

  function renderTable() {
    var table = U.clear(U.byId('split-table'));
    var cols = ['API', 'Run 1', 'Run 2', 'Change'].concat(CAUSES.map(function (c) { return R.STEP_LABELS[c]; }));
    table.appendChild(el('thead', null, el('tr', null, cols.map(function (c, i) { return el('th', { scope: 'col', 'class': i ? 'num' : null, text: c }); }))));
    table.appendChild(el('tbody', null, result.apis.map(function (a) {
      return el('tr', null, [
        el('td', null, el('strong', { text: a.name })),
        el('td', { 'class': 'num', text: F.pct(a.before) }),
        el('td', { 'class': 'num', text: F.pct(a.after) }),
        el('td', { 'class': 'num', text: F.signed(a.delta) })
      ].concat(CAUSES.map(function (c) { return el('td', { 'class': 'num', text: F.signed(a.parts[c]) }); })));
    })));

    U.byId('order-note').textContent = 'Assumption: the changes are made one at a time in a fixed order (scoring rule, then references, then answers), and each step gets the score change it causes. When two changes touch the same cell, whichever comes first gets the credit. ' +
      (sensitivity < 0.005
        ? 'In this run the three changes touch different cells, so running them in reverse order gives the same split.'
        : 'In this run, reversing the order moves some parts by up to ' + sensitivity.toFixed(2) + ' points.');

    var lowered = result.apis.filter(function (a) { return a.parts.reference < -0.005; });
    var note = U.byId('refresh-note');
    if (lowered.length) {
      note.textContent = 'Refreshing references lowered ' + lowered.length + ' of the ' + result.apis.length + ' APIs (' +
        lowered.map(function (a) { return a.name + ' ' + F.signed(a.parts.reference); }).join(', ') +
        '). They had been returning the old LinkedIn page, which the outdated reference counted as right. A fix on our side can cost a vendor points, so the changelog should say which side moved.';
      note.hidden = false;
    }
  }

  function renderFlips() {
    var filters = U.clear(U.byId('cause-filters'));
    var counts = { all: result.flips.length };
    CAUSES.forEach(function (c) { counts[c] = result.flips.filter(function (f) { return f.cause === c; }).length; });
    ['all'].concat(CAUSES).forEach(function (c) {
      filters.appendChild(el('button', {
        type: 'button', 'aria-pressed': state.cause === c ? 'true' : 'false',
        text: (c === 'all' ? 'All causes' : R.STEP_LABELS[c]) + ' (' + counts[c] + ')',
        on: { click: function () { state.cause = c; state.showAll = false; renderFlips(); } }
      }));
    });

    var sel = U.byId('flip-api');
    if (!sel.options.length) {
      sel.appendChild(el('option', { value: 'all', text: 'All APIs' }));
      run.apis.forEach(function (a) { sel.appendChild(el('option', { value: a.id, text: a.name })); });
      sel.addEventListener('change', function () { state.api = sel.value; state.showAll = false; renderFlips(); });
    }

    var shown = result.flips.filter(function (f) {
      return (state.cause === 'all' || f.cause === state.cause) && (state.api === 'all' || f.after.api === state.api);
    });
    var up = shown.filter(function (f) { return f.up; }).length;
    U.byId('flip-count').textContent = shown.length + ' flipped cells: ' + up + ' wrong to right, ' + (shown.length - up) + ' right to wrong.';

    var table = U.clear(U.byId('flip-table'));
    table.appendChild(el('thead', null, el('tr', null, ['API', 'Company', 'Field', 'Reference', 'Before', 'After', 'Cause'].map(function (h) {
      return el('th', { scope: 'col', text: h });
    }))));
    var rows = state.showAll ? shown : shown.slice(0, PAGE);
    table.appendChild(el('tbody', null, rows.map(function (f) {
      var b = f.before, a = f.after;
      var mono = a.field === 'linkedin_url';
      var refText = a.reference + (b.reference !== a.reference ? ' (was ' + b.reference + ')' : '');
      return el('tr', null, [
        el('td', { 'class': 'nowrap', text: API[a.api].name }),
        el('td', { text: a.company }),
        el('td', { text: FIELD[a.field].label }),
        el('td', { 'class': mono ? 'mono' : null, text: refText }),
        el('td', { 'class': mono ? 'mono' : null, text: verdictWord(b.verdict) + ': ' + (b.returned === '' ? '(blank)' : b.returned) }),
        el('td', { 'class': mono ? 'mono' : null, text: verdictWord(a.verdict) + ': ' + (a.returned === '' ? '(blank)' : a.returned) }),
        el('td', null, el('span', { 'class': 'tag-chip' }, [el('i', { 'class': 'sw sw-' + f.cause, 'aria-hidden': 'true' }), R.STEP_LABELS[f.cause]]))
      ]);
    })));
    var more = U.byId('flip-more');
    more.hidden = state.showAll || shown.length <= PAGE;
    more.textContent = 'Show all ' + shown.length;
    more.onclick = function () { state.showAll = true; renderFlips(); };
  }

  function renderLines() {
    var box = U.clear(U.byId('lines-text'));
    box.appendChild(el('p', null, [el('strong', { text: 'Changelog: ' }), lines.changelog]));
    box.appendChild(el('p', null, [el('strong', { text: 'Post: ' }), lines.post]));
    U.byId('copy-lines').onclick = function () {
      U.copyText(lines.changelog + '\n\n' + lines.post, box, U.byId('copy-lines-status'));
    };
  }

  function renderChecks() {
    var list = U.clear(U.byId('moved-checks-list'));
    var items = result.apis.map(function (a) {
      var parts = CAUSES.reduce(function (s, c) { return s + a.parts[c]; }, 0);
      return {
        ok: Math.abs(a.before + parts - a.after) < 0.05,
        label: a.name + ': run 1 + the three parts = run 2',
        detail: a.before.toFixed(2) + ' + ' + parts.toFixed(2) + ' = ' + a.after.toFixed(2)
      };
    });
    var byCause = CAUSES.reduce(function (s, c) { return s + lines.counts[c]; }, 0);
    items.push({ ok: byCause === result.flips.length, label: 'Flips by cause add up to all flips', detail: byCause + ' = ' + result.flips.length });
    items.push({ ok: true, label: 'Largest change in any part if the order is reversed', detail: sensitivity.toFixed(4) + ' points' });
    items.push({ ok: true, label: 'Generator seed', detail: String(run.seed) + ' (run 2 picks the fixed answers with seed ' + (run.seed + 2) + ')' });
    items.forEach(function (c) {
      list.appendChild(el('li', null, [
        el('span', { 'class': c.ok ? 'ok' : 'fail', text: c.ok ? 'OK ' : 'FAILED ' }),
        c.label,
        el('span', { 'class': 'detail', text: c.detail })
      ]));
    });
  }

  renderHeadline();
  renderChanges();
  renderLegend();
  renderChart();
  renderTable();
  renderFlips();
  renderLines();
  renderChecks();

  var lastWidth = window.innerWidth;
  window.addEventListener('resize', U.debounce(function () {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    renderChart();
  }, 150));
})();
