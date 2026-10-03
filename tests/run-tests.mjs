// Plain Node tests for the benchmark failure readout. Run: node tests/run-tests.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
await import(pathToFileURL(join(site, 'data.js')).href);
await import(pathToFileURL(join(site, 'readout.mjs')).href);
const D = globalThis.BenchData;
const R = globalThis.BenchReadout;

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ok   ' + name);
  } catch (err) {
    failures.push(name);
    console.log('  FAIL ' + name + '\n       ' + String(err && err.message ? err.message : err).split('\n').join('\n       '));
  }
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const row = (board, api) => board.find((r) => r.api === api);

const run = D.generate(D.SEED);
const off = { setAside: false };
const on = { setAside: true };
const boardOff = R.scoreboard(run, off);
const boardOn = R.scoreboard(run, on);

// ---------------------------------------------------------------- generator
console.log('generator');

test('same seed gives identical rows; a different seed does not', () => {
  const again = D.generate(D.SEED);
  assert.equal(JSON.stringify(again.cells), JSON.stringify(run.cells));
  assert.equal(JSON.stringify(again.calls), JSON.stringify(run.calls));
  assert.notEqual(JSON.stringify(D.generate(D.SEED + 1).cells), JSON.stringify(run.cells));
});

test('seed is 20261002 and mulberry32 is deterministic', () => {
  assert.equal(D.SEED, 20261002);
  const a = D.mulberry32(7), b = D.mulberry32(7);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('every planted-rate row sums to 1 and every outcome could be dealt', () => {
  for (const api of Object.keys(D.PLANTED_RATES)) {
    for (const slice of Object.keys(D.PLANTED_RATES[api])) {
      const rates = D.PLANTED_RATES[api][slice];
      assert.equal(rates.length, D.OUTCOMES.length, api + ' ' + slice);
      assert.ok(near(rates.reduce((s, x) => s + x, 0), 1, 1e-9), api + ' ' + slice + ' sums to ' + rates.reduce((s, x) => s + x, 0));
    }
  }
  assert.deepEqual(run.shortfall, []);
});

test('largestRemainder splits into whole counts that add up', () => {
  const counts = D.largestRemainder([0.333, 0.333, 0.334], 10);
  assert.equal(counts.reduce((s, x) => s + x, 0), 10);
  assert.deepEqual(D.largestRemainder([0.5, 0.25, 0.25], 8), [4, 2, 2]);
});

test('shape: 6 APIs, 200 companies in 60/60/50/30 slices, 5 fields, one cell per API per field', () => {
  assert.equal(run.apis.length, 6);
  assert.equal(run.companies.length, 200);
  const bySlice = {};
  run.companies.forEach((c) => { bySlice[c.slice] = (bySlice[c.slice] || 0) + 1; });
  assert.deepEqual(bySlice, { well_documented: 60, long_tail: 60, subsidiary: 50, rebrand: 30 });
  assert.equal(run.fields.length, 5);
  assert.equal(run.items.length, 1000);
  assert.equal(run.cells.length, 6000);
  assert.equal(run.calls.length, 1200);
});

test('fictional companies: unique names, .example domains', () => {
  const names = new Set(run.companies.map((c) => c.name));
  assert.equal(names.size, 200);
  run.companies.forEach((c) => assert.match(c.domain, /^[a-z0-9-]+\.example$/));
  run.cells.filter((c) => c.field === 'linkedin_url' && c.returned).forEach((c) => assert.match(c.returned, /^linkedin\.example\/company\//));
});

test('about 5% of references are blank and those cells are never scored', () => {
  const blanks = run.items.filter((i) => i.reference === '');
  assert.ok(blanks.length >= 30 && blanks.length <= 70, 'blank references: ' + blanks.length);
  const blankKeys = new Set(blanks.map((i) => i.key));
  run.cells.forEach((c) => assert.equal(c.verdict === 'no_reference', blankKeys.has(c.itemKey)));
  boardOff.forEach((r) => assert.equal(r.referenceFields, 1000 - blanks.length));
});

test('verdicts agree with the values: right means equal, blank means empty, wrong means different', () => {
  run.cells.forEach((c) => {
    if (c.verdict === 'correct') assert.equal(c.returned, c.reference, c.key);
    if (c.verdict === 'missing') { assert.equal(c.returned, '', c.key); assert.equal(c.tag, 'no_value'); }
    if (c.verdict === 'wrong') {
      assert.notEqual(c.returned, '', c.key);
      assert.notEqual(c.returned, c.reference, c.key);
      assert.ok(c.reason.length > 10, c.key);
    }
  });
});

test('reasons only land where they make sense', () => {
  run.cells.filter((c) => c.verdict === 'wrong').forEach((c) => {
    if (c.tag === 'parent_company') assert.equal(c.slice, 'subsidiary', c.key);
    if (c.tag === 'pre_rebrand') { assert.equal(c.slice, 'rebrand', c.key); assert.ok(['linkedin_url', 'industry'].includes(c.field), c.key); }
    if (c.tag === 'near_match') assert.ok(['hq_city', 'employee_range'].includes(c.field), c.key);
    if (c.tag === 'stale_value') assert.ok(['hq_city', 'employee_range'].includes(c.field), c.key);
  });
});

test('ten rebranded companies start with an outdated LinkedIn reference', () => {
  const stale = run.items.filter((i) => i.staleReference);
  assert.equal(stale.length, D.STALE_REFERENCE_COMPANIES);
  stale.forEach((i) => { assert.equal(i.field, 'linkedin_url'); assert.equal(i.slice, 'rebrand'); assert.notEqual(i.reference, i.truth); });
});

// ---------------------------------------------------------------- scoring math on a hand-made run
console.log('scoring math (hand-made rows)');

function fixture() {
  const mk = (api, item, slice, verdict, tag) => ({
    key: api + '|' + item, itemKey: item, api, company: 'Co ' + item, companyId: item, slice, field: 'hq_city',
    reference: verdict === 'no_reference' ? '' : 'ref', returned: verdict === 'correct' ? 'ref' : (verdict === 'missing' ? '' : 'other'),
    verdict, tag: tag || null, reason: tag ? 'because' : ''
  });
  return {
    seed: 1, apis: [{ id: 'X', name: 'API X', type: 't' }, { id: 'Y', name: 'API Y', type: 't' }],
    slices: [{ id: 's1', label: 'Slice one', phrase: 'slice-one companies' }, { id: 's2', label: 'Slice two', phrase: 'slice-two companies' }],
    fields: [{ id: 'hq_city', label: 'HQ city' }], tags: D.TAGS, companies: [], items: [],
    cells: [
      mk('X', 'i1', 's1', 'correct'), mk('X', 'i2', 's1', 'correct'), mk('X', 'i3', 's1', 'wrong', 'parent_company'),
      mk('X', 'i4', 's2', 'missing', 'no_value'), mk('X', 'i5', 's2', 'wrong', 'near_match'), mk('X', 'i6', 's2', 'no_reference'),
      mk('Y', 'i1', 's1', 'correct'), mk('Y', 'i2', 's1', 'wrong', 'same_name'), mk('Y', 'i3', 's1', 'correct'),
      mk('Y', 'i4', 's2', 'correct'), mk('Y', 'i5', 's2', 'correct'), mk('Y', 'i6', 's2', 'no_reference')
    ],
    calls: [
      { api: 'X', latencyMs: 100, cost: 0.01 }, { api: 'X', latencyMs: 300, cost: 0.01 }, { api: 'X', latencyMs: 200, cost: 0.01 },
      { api: 'Y', latencyMs: 10, cost: 0.02 }, { api: 'Y', latencyMs: 40, cost: 0.02 }, { api: 'Y', latencyMs: 20, cost: 0.02 }, { api: 'Y', latencyMs: 30, cost: 0.02 }
    ]
  };
}

test('success rate, accuracy, $ per 1,000 correct and median latency', () => {
  const b = R.scoreboard(fixture(), off);
  const x = row(b, 'X'), y = row(b, 'Y');
  assert.equal(x.referenceFields, 5);
  assert.ok(near(x.successRate, 40));
  assert.ok(near(x.accuracy, 50));
  assert.ok(near(x.costPer1000Correct, 15));
  assert.equal(x.medianLatencyMs, 200);
  assert.ok(near(y.successRate, 80));
  assert.ok(near(y.accuracy, 80));
  assert.ok(near(y.costPer1000Correct, 20));
  assert.equal(y.medianLatencyMs, 25);
  assert.equal(y.rank, 1);
  assert.equal(x.rank, 2);
});

test('set-aside removes near matches from the top and the bottom', () => {
  const x = row(R.scoreboard(fixture(), on), 'X');
  assert.equal(x.setAside, 1);
  assert.equal(x.scored, 4);
  assert.ok(near(x.successRate, 50));
  assert.ok(near(x.accuracy, 200 / 3));
});

test('gap breakdown matches a hand calculation', () => {
  const b = R.gapBreakdown(fixture(), 'X', 'Y', off);
  assert.ok(near(b.gap, 40));
  assert.deepEqual(b.groups.map((g) => [g.key, Math.round(g.value * 1e6) / 1e6]), [
    ['s1|parent_company|X', 20], ['s2|near_match|X', 20], ['s2|no_value|X', 20], ['s1|same_name|Y', -20]
  ]);
  assert.equal(b.adjustment, 0);
  assert.ok(near(b.topShare, 50));
  assert.ok(near(b.topTwoShare, 100));
});

test('gap breakdown with set-aside still adds up, with the difference in its own value', () => {
  const b = R.gapBreakdown(fixture(), 'X', 'Y', on);
  assert.ok(near(b.gap, 30));
  assert.ok(near(b.adjustment, 15));
  const sameName = b.groups.find((g) => g.key === 's1|same_name|Y');
  assert.ok(near(sameName.value, -25));
  assert.equal(b.groups.find((g) => g.tag === 'near_match'), undefined);
  assert.ok(near(b.sumOfParts, 30));
});

test('standard error of one rate and of a paired gap match a hand calculation', () => {
  const f = fixture();
  const x = row(R.scoreboard(f, off), 'X');
  assert.ok(near(R.standardError(x), 100 * Math.sqrt(0.4 * 0.6 / 5)));
  // Y minus X per field: 0, -1, 1, 1, 1 -> mean 0.4, sample variance 0.8, standard error sqrt(0.8 / 5) = 0.4.
  const g = R.pairedGap(f, 'X', 'Y');
  assert.equal(g.fields, 5);
  assert.ok(near(g.gap, 40));
  assert.ok(near(g.se, 40));
});

test('formatting helpers', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(R.fmt.ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
  assert.equal(R.fmt.latency(250), '250 ms');
  assert.equal(R.fmt.latency(17920), '17.9 s');
  assert.equal(R.fmt.signed(1.24), '+1.2');
  assert.equal(R.fmt.signed(-0.32), '-0.3');
  assert.equal(R.fmt.signed(-0.04), '0.0');
  assert.equal(R.fmt.money(5.249), '$5.25');
  assert.equal(R.median([3, 1, 2]), 2);
  assert.equal(R.median([4, 1, 3, 2]), 2.5);
});

// ---------------------------------------------------------------- planted patterns
console.log('planted patterns');

test('API A leads at about 88%', () => {
  assert.equal(R.leaderOf(boardOff), 'A');
  const a = row(boardOff, 'A').successRate;
  assert.ok(a >= 86 && a <= 90, 'A = ' + a);
});

test('API C sits near 78%, and 60-65% of its gap to A is subsidiaries where it returned the parent company', () => {
  const c = row(boardOff, 'C').successRate;
  assert.ok(c >= 76 && c <= 80, 'C = ' + c);
  const b = R.gapBreakdown(run, 'C', 'A', off);
  assert.equal(b.groups[0].key, 'subsidiary|parent_company|C');
  assert.ok(b.topShare >= 58 && b.topShare <= 67, 'share = ' + b.topShare);
});

test('API B has the highest accuracy on returned values but leaves the most blanks on the long tail', () => {
  const b = row(boardOff, 'B');
  assert.ok(b.accuracy >= 90 && b.accuracy <= 95, 'B accuracy = ' + b.accuracy);
  boardOff.filter((r) => r.api !== 'B').forEach((r) => assert.ok(b.accuracy > r.accuracy, 'B vs ' + r.api));
  const blankRate = (api, slice) => {
    const cs = run.cells.filter((c) => c.api === api && c.slice === slice && c.verdict !== 'no_reference');
    return cs.filter((c) => c.verdict === 'missing').length / cs.length;
  };
  assert.ok(blankRate('B', 'long_tail') > 0.25);
  ['well_documented', 'subsidiary', 'rebrand'].forEach((s) => assert.ok(blankRate('B', 'long_tail') > blankRate('B', s)));
  assert.ok(blankRate('B', 'long_tail') > blankRate('A', 'long_tail'));
});

test('API E is cheapest and fastest, and on the long tail it mostly leaves blanks rather than being wrong', () => {
  const e = row(boardOff, 'E');
  boardOff.filter((r) => r.api !== 'E').forEach((r) => {
    assert.ok(e.cost < r.cost, 'cost vs ' + r.api);
    assert.ok(e.medianLatencyMs < r.medianLatencyMs, 'latency vs ' + r.api);
  });
  const lt = run.cells.filter((c) => c.api === 'E' && c.slice === 'long_tail');
  const missing = lt.filter((c) => c.verdict === 'missing').length;
  const wrong = lt.filter((c) => c.verdict === 'wrong').length;
  assert.ok(missing >= 3 * wrong, missing + ' blank vs ' + wrong + ' wrong');
});

test('about 5% of API F\'s scored cells are near matches; setting them aside moves F up exactly one rank', () => {
  const f = row(boardOff, 'F');
  const nearCount = run.cells.filter((c) => c.api === 'F' && c.verdict === 'wrong' && c.tag === 'near_match').length;
  const share = nearCount / f.referenceFields;
  assert.ok(share >= 0.04 && share <= 0.07, 'share = ' + share);
  const moves = R.rankChanges(run);
  assert.deepEqual(moves.map((m) => [m.api, m.from, m.to]), [['F', 5, 4], ['D', 4, 5]]);
  assert.equal(R.rankChangeText(run), 'API F moves from 5th to 4th; API D drops from 4th to 5th.');
});

test('every API is weak on recent rebrands: a failure of the whole field', () => {
  const ff = R.fieldFailure(run, off);
  assert.equal(ff.callout.slice, 'rebrand');
  assert.equal(ff.callout.mainTag, 'pre_rebrand');
  const rb = ff.slices.find((s) => s.slice === 'rebrand');
  const wd = ff.slices.find((s) => s.slice === 'well_documented');
  rb.apis.forEach((a, i) => {
    assert.ok(a.rate > wd.apis[i].rate, a.api);
    assert.ok((a.byTag.pre_rebrand || 0) / a.scored >= 0.08, a.api + ' pre-rebrand share');
  });
  assert.ok(R.mainTagTopCount(rb) >= 3);
  assert.match(R.fieldCallout(run, ff), /^Recent rebrands are the failure mode of the field: even the best API there \(API [A-F]\) misses \d+% of fields/);
});

// ---------------------------------------------------------------- page numbers
console.log('page numbers');

test('the result sentence is computed from the rows', () => {
  const h = R.headline(run, 'C', 'A', off);
  const m = h.text.match(/^API C trails API A by (\d+\.\d) points; (\d+)% of that gap is subsidiaries where API C returned the parent company\.$/);
  assert.ok(m, h.text);
  assert.equal(m[1], (Math.round(h.breakdown.gap * 10) / 10).toFixed(1));
  assert.equal(Number(m[2]), Math.round(h.breakdown.topShare));
  assert.ok(near(h.breakdown.gap, row(boardOff, 'A').successRate - row(boardOff, 'C').successRate));
});

test('gap parts add up to the gap for every pair of APIs, with and without set-aside', () => {
  for (const o of [off, on]) {
    const board = R.scoreboard(run, o);
    for (const s of run.apis) {
      for (const c of run.apis) {
        if (s.id === c.id) continue;
        const b = R.gapBreakdown(run, s.id, c.id, o);
        assert.ok(near(b.sumOfParts, b.gap, 1e-9), s.id + ' vs ' + c.id);
        assert.ok(b.sumCheck);
        assert.ok(near(b.gap, row(board, c.id).successRate - row(board, s.id).successRate, 1e-9));
        const bars = R.gapBars(b, 7);
        assert.ok(near(bars.reduce((t, x) => t + x.value, 0), b.gap, 1e-9));
        if (!o.setAside) assert.ok(Math.abs(b.adjustment) < 1e-12);
      }
    }
  }
});

test('noise check: the headline gap is real, the F/D swap is not clearly real', () => {
  const g = R.pairedGap(run, 'C', 'A');
  assert.ok(near(g.gap, row(boardOff, 'A').successRate - row(boardOff, 'C').successRate, 1e-9));
  assert.ok(g.gap > 4 * g.se, 'gap ' + g.gap + ' se ' + g.se);
  const swaps = R.rankSwaps(run);
  assert.deepEqual(swaps.map((x) => [x.up, x.down, x.weak]), [['F', 'D', true]]);
  assert.match(R.rankNoiseText(run), /^Before anything is set aside, API F trails API D by \d+\.\d points, and the standard error of that gap is \d+\.\d points\. A gap under two standard errors could reverse/);
  boardOff.forEach((r) => assert.ok(R.standardError(r) > 0.5 && R.standardError(r) < 2.5, r.api));
});

test('the finding survives the check before posting', () => {
  const s = R.findingSurvives(run, 'C', 'A');
  assert.equal(s.survives, true);
  assert.ok(s.on.topShare >= 55);
});

test('rows behind a gap bar: up to 8, all from that group, total matches the bar', () => {
  const b = R.gapBreakdown(run, 'C', 'A', off);
  const bars = R.gapBars(b, 7);
  const res = R.rowsFor(run, bars[0].rows, off, 8);
  assert.equal(res.total, b.groups[0].cells);
  assert.equal(res.rows.length, 8);
  res.rows.forEach((c) => {
    assert.equal(c.api, 'C'); assert.equal(c.slice, 'subsidiary'); assert.equal(c.tag, 'parent_company');
    assert.equal(run.cells.find((x) => x.api === 'A' && x.itemKey === c.itemKey).verdict, 'correct');
  });
  const opposite = bars.find((x) => x.kind === 'opposite');
  assert.equal(R.rowsFor(run, opposite.rows, off, 1000).total, opposite.cells);
});

test('rows behind a field segment match the chart count', () => {
  const ff = R.fieldFailure(run, off);
  const rb = ff.slices.find((s) => s.slice === 'rebrand').apis.find((a) => a.api === 'D');
  const res = R.rowsFor(run, { kind: 'field', api: 'D', slice: 'rebrand', tag: 'pre_rebrand' }, off, 8);
  assert.equal(res.total, rb.byTag.pre_rebrand);
  assert.ok(res.rows.length <= 8);
});

test('set-aside counts per API add up and F has the most', () => {
  const counts = R.setAsideCounts(run);
  counts.forEach((c) => assert.equal(c.setAside, row(boardOn, c.api).setAside));
  const top = counts.slice().sort((a, b) => b.setAside - a.setAside)[0];
  assert.equal(top.api, 'F');
});

test('draft post: three template lines; v2 comes from the largest benchmark-side group', () => {
  const p = R.draftPost(run, 'C', 'A', off);
  assert.equal(p.lines.length, 3);
  assert.equal(p.lines[0], R.headline(run, 'C', 'A', off).text);
  assert.match(p.lines[1], /^Chart: where API C loses points to API A, by company type and failure reason; the top two groups are \d+% of the gap\. 200 fictional companies, 5 fields, synthetic data\.$/);
  const nearHq = run.cells.filter((c) => c.verdict === 'wrong' && c.tag === 'near_match' && c.field === 'hq_city').length;
  assert.equal(p.v2.tag, 'near_match');
  assert.equal(p.v2.field, 'hq_city');
  assert.equal(p.v2.cells, nearHq);
  assert.equal(p.lines[2], 'What changes in v2: accept metro-area matches for HQ city; ' + nearHq + ' cells would flip.');
});

test('every check on the page passes, with and without set-aside', () => {
  for (const o of [off, on]) R.checks(run, 'C', 'A', o).forEach((c) => assert.ok(c.ok, c.label + ': ' + c.detail));
});

// ---------------------------------------------------------------- run 2
console.log('run 2: what moved');

const plan = D.planRun2(run);
const moved = R.attributeRunChange(run, plan);

test('run 2 plan: ten refreshed references and 80% of API C\'s parent-company answers fixed', () => {
  assert.equal(plan.refreshes.length, 10);
  const broken = run.cells.filter((c) => c.api === 'C' && c.verdict === 'wrong' && c.tag === 'parent_company').length;
  assert.equal(plan.answers.length, Math.round(broken * 0.8));
  assert.deepEqual(D.planRun2(run), plan);
});

test('for every API, run 1 plus the three parts equals run 2', () => {
  moved.apis.forEach((a) => {
    const parts = R.DEFAULT_ORDER.reduce((s, k) => s + a.parts[k], 0);
    assert.ok(near(a.before + parts, a.after, 1e-9), a.api);
    assert.ok(near(a.before, row(boardOff, a.api).successRate, 1e-9), a.api);
  });
});

test('only API C changes its answers; the scoring rule only helps', () => {
  moved.apis.forEach((a) => {
    if (a.api === 'C') assert.ok(a.parts.answers > 3, 'C answers part ' + a.parts.answers);
    else assert.ok(Math.abs(a.parts.answers) < 1e-12, a.api);
    assert.ok(a.parts.scoring >= 0, a.api);
    const n = run.cells.filter((c) => c.api === a.api && c.verdict === 'wrong' && c.tag === 'near_match' && c.field === 'hq_city').length;
    assert.ok(near(a.parts.scoring, 100 * n / row(boardOff, a.api).referenceFields, 1e-9), a.api);
  });
});

test('flips by cause match the plan, and the order does not matter in this run', () => {
  const by = { scoring: 0, reference: 0, answers: 0 };
  moved.flips.forEach((f) => { by[f.cause] += 1; });
  assert.equal(by.scoring, R.v2Change(run).cells);
  assert.equal(by.answers, plan.answers.length);
  assert.ok(by.reference > 0 && by.reference <= 60);
  assert.ok(R.orderSensitivity(run, plan) < 1e-9);
});

test('generated changelog and post lines carry the computed numbers', () => {
  const l = R.moverLines(run, moved, plan);
  const c = moved.apis.find((a) => a.api === 'C');
  assert.match(l.headline, /^API C gained \d+\.\d points between runs, \d+\.\d of them from its own new answers\. API [A-F] (gained|lost) \d+\.\d points without a single new answer/);
  assert.ok(l.changelog.startsWith('Run 2: accepted metro-area matches for HQ city (' + R.v2Change(run).cells + ' cells flipped)'));
  assert.ok(l.post.startsWith('API C ' + R.fmt.signed(c.delta) + ' points: ' + R.fmt.signed(c.parts.answers) + ' from new answers, '));
});

test('reference refresh re-judges answers both ways; blanks stay blank', () => {
  const r = [{ itemKey: 'k', newReference: 'new', oldReference: 'old', oldName: 'Old Co' }];
  const base = { key: 'A|k', itemKey: 'k', api: 'A', reference: 'old' };
  const out = R.applyReferenceRefresh([
    Object.assign({}, base, { returned: 'old', verdict: 'correct', tag: null }),
    Object.assign({}, base, { key: 'B|k', api: 'B', returned: 'new', verdict: 'wrong', tag: 'ref_outdated' }),
    Object.assign({}, base, { key: 'C|k', api: 'C', returned: '', verdict: 'missing', tag: 'no_value' })
  ], r);
  assert.deepEqual(out.cells.map((c) => [c.verdict, c.tag, c.reference]), [['wrong', 'pre_rebrand', 'new'], ['correct', null, 'new'], ['missing', 'no_value', 'new']]);
  assert.equal(out.changes.length, 2);
});

test('new answers and the scoring rule re-judge only the cells they touch', () => {
  const cells = [
    { key: 'C|a', itemKey: 'a', api: 'C', field: 'hq_city', reference: 'x', returned: 'p', verdict: 'wrong', tag: 'parent_company' },
    { key: 'C|b', itemKey: 'b', api: 'C', field: 'hq_city', reference: 'x', returned: 'metro', verdict: 'wrong', tag: 'near_match' },
    { key: 'C|c', itemKey: 'c', api: 'C', field: 'employee_range', reference: 'x', returned: 'y', verdict: 'wrong', tag: 'near_match' }
  ];
  const a = R.applyNewAnswers(cells, [{ cellKey: 'C|a', returned: 'x' }]);
  assert.equal(a.cells[0].verdict, 'correct');
  assert.equal(a.cells[1], cells[1]);
  const s = R.applyScoringRule(cells, D.RUN2_CHANGES.scoringRule);
  assert.deepEqual(s.cells.map((c) => c.verdict), ['wrong', 'correct', 'wrong']);
});

// ---------------------------------------------------------------- the files themselves
console.log('site files');

const read = (f) => readFileSync(join(site, f), 'utf8');
const siteFiles = readdirSync(site).filter((f) => /\.(html|css|js|mjs|md)$/.test(f));

test('both pages load plain scripts (works from file://) and nothing from the network', () => {
  for (const page of ['index.html', 'moved.html']) {
    const html = read(page);
    assert.ok(!/type=["']module["']/.test(html), page + ' uses a module script');
    const srcs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    srcs.forEach((s) => assert.ok(!/^[a-z]+:\/\//i.test(s) && !s.startsWith('//'), page + ' loads ' + s));
  }
  for (const f of siteFiles.filter((x) => !x.endsWith('.md'))) {
    const urls = (read(f).match(/https?:\/\/[^\s'"<>)]+/g) || []).filter((u) => u !== 'http://www.w3.org/2000/svg');
    assert.deepEqual(urls, [], f);
  }
});

test('labels: synthetic data, footer credit, and the open questions', () => {
  for (const page of ['index.html', 'moved.html']) {
    const html = read(page);
    assert.ok(html.includes('Synthetic data. Fictional APIs.'), page);
    assert.ok(html.includes('Synthetic data. Fictional APIs and companies. Built by Dakshit Raj with Claude Code and Codex.'), page);
  }
  const index = read('index.html');
  [
    'When the judge\'s reason and a human label disagree on a near match, which one does a public post go with?',
    'If the scored set stays private, which example rows can a post show?',
    'Does a vendor see a failure finding before it goes out?',
    'Do posts go out with each release (new vendor, data refresh) or only when a finding is strong enough?'
  ].forEach((q) => assert.ok(index.includes(q), q));
  assert.ok(index.lastIndexOf('Questions I\'d want answered') > index.indexOf('id="checks"'));
});

test('the second page links back; any link to it from the first page is relative', () => {
  assert.ok(read('moved.html').includes('href="index.html"'));
  const index = read('index.html');
  if (index.includes('moved.html')) assert.ok(index.includes('href="moved.html"'));
});

test('README explains the rules and the test command', () => {
  const readme = read('README.md');
  ['node tests/run-tests.mjs', 'Success rate', 'Gap contribution', 'Set aside', 'Assumptions', 'Limits', 'moved.html'].forEach((s) => assert.ok(readme.includes(s), s));
});

test('no em dashes or en dashes in any site file', () => {
  for (const f of siteFiles.concat(['tests/run-tests.mjs'])) {
    const text = read(f);
    const emDash = String.fromCharCode(0x2014), enDash = String.fromCharCode(0x2013);
    assert.ok(!text.includes(emDash) && !text.includes(enDash), f);
  }
});

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
