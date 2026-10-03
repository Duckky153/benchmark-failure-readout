/*
  Benchmark failure readout: synthetic data.

  Everything in this file is invented: six fictional APIs (API A to API F),
  200 fictional companies on .example domains, and the rates that decide how
  each API answers. The page proves a method, not a result about any real
  product.

  How it works: for each API and company slice, PLANTED_RATES says what share
  of scored fields get each outcome. The generator deals out exactly those
  shares (rounded) in a seeded random order, so the same seed always gives the
  same rows and every pattern on the page traces back to the table below.

  This file runs as a plain browser script (so the page works from file://)
  and is also loaded by the Node tests. It sets globalThis.BenchData.
*/
(function (root) {
  'use strict';

  var SEED = 20261002;

  // Outcome columns, in the order used by every PLANTED_RATES row.
  var OUTCOMES = ['correct', 'no_value', 'parent_company', 'pre_rebrand', 'same_name', 'stale_value', 'near_match', 'ref_outdated'];

  // PLANTED_RATES: share of scored fields per outcome, per API and slice. Rows sum to 1.
  // correct = right answer; blank = no value returned; the rest are reasons for a wrong answer.
  var PLANTED_RATES = {
    //                     correct blank  parent rebrand same   stale  near   ref-old
    A: { well_documented: [0.96,   0.01,  0,     0,      0,     0.01,  0.01,  0.01],
         long_tail:       [0.88,   0.05,  0,     0,      0.04,  0.01,  0.01,  0.01],
         subsidiary:      [0.90,   0.02,  0.05,  0,      0,     0.01,  0.01,  0.01],
         rebrand:         [0.70,   0.04,  0,     0.20,   0,     0.02,  0.02,  0.02] },
    B: { well_documented: [0.95,   0.02,  0,     0,      0,     0.01,  0.01,  0.01],
         long_tail:       [0.64,   0.31,  0,     0,      0.03,  0.01,  0.005, 0.005],
         subsidiary:      [0.87,   0.06,  0.04,  0,      0,     0.01,  0.01,  0.01],
         rebrand:         [0.72,   0.12,  0,     0.12,   0,     0.02,  0.01,  0.01] },
    C: { well_documented: [0.94,   0.01,  0,     0,      0,     0.03,  0.01,  0.01],
         long_tail:       [0.78,   0.05,  0,     0,      0.10,  0.05,  0.01,  0.01],
         subsidiary:      [0.63,   0.02,  0.29,  0,      0,     0.04,  0.01,  0.01],
         rebrand:         [0.64,   0.04,  0,     0.26,   0,     0.03,  0.02,  0.01] },
    D: { well_documented: [0.90,   0.02,  0,     0,      0.03,  0.03,  0.01,  0.01],
         long_tail:       [0.70,   0.08,  0,     0,      0.14,  0.06,  0.01,  0.01],
         subsidiary:      [0.70,   0.03,  0.20,  0,      0.03,  0.02,  0.01,  0.01],
         rebrand:         [0.62,   0.05,  0,     0.22,   0.04,  0.05,  0.01,  0.01] },
    E: { well_documented: [0.85,   0.08,  0,     0,      0.02,  0.03,  0.01,  0.01],
         long_tail:       [0.40,   0.52,  0,     0,      0.04,  0.03,  0.005, 0.005],
         subsidiary:      [0.62,   0.18,  0.14,  0,      0.02,  0.02,  0.01,  0.01],
         rebrand:         [0.55,   0.17,  0,     0.22,   0.02,  0.02,  0.01,  0.01] },
    F: { well_documented: [0.87,   0.02,  0,     0,      0.02,  0.03,  0.05,  0.01],
         long_tail:       [0.66,   0.08,  0,     0,      0.12,  0.07,  0.05,  0.02],
         subsidiary:      [0.70,   0.03,  0.15,  0,      0.03,  0.03,  0.05,  0.01],
         rebrand:         [0.62,   0.05,  0,     0.20,   0.03,  0.04,  0.05,  0.01] }
  };

  // About this share of reference values are blank. Blank references are not scored for anyone.
  var BLANK_REFERENCE_RATE = 0.05;

  // In run 1, the LinkedIn reference for this many rebranded companies still holds the old page.
  // An API that returns the new page is judged wrong there. Run 2 refreshes these references.
  var STALE_REFERENCE_COMPANIES = 10;

  // The three planted changes between run 1 and run 2 (used by the second page).
  var RUN2_CHANGES = {
    scoringRule: { tag: 'near_match', field: 'hq_city', label: 'accept metro-area matches for HQ city', pastLabel: 'accepted metro-area matches for HQ city' },
    referenceRefresh: { field: 'linkedin_url', label: 'refresh the LinkedIn reference for rebranded companies' },
    answerUpdate: { api: 'C', tag: 'parent_company', fixShare: 0.8, label: 'API C ships an update for subsidiaries' }
  };

  var APIS = [
    { id: 'A', name: 'API A', type: 'Company dataset', pricePerCall: 0.08, medianMs: 300, spread: 0.30 },
    { id: 'B', name: 'API B', type: 'Sales database', pricePerCall: 0.02, medianMs: 650, spread: 0.30 },
    { id: 'C', name: 'API C', type: 'Agentic research', pricePerCall: 0.05, medianMs: 18000, spread: 0.45 },
    { id: 'D', name: 'API D', type: 'Search plus extraction', pricePerCall: 0.005, medianMs: 4000, spread: 0.40 },
    { id: 'E', name: 'API E', type: 'Budget lookup', pricePerCall: 0.002, medianMs: 250, spread: 0.30 },
    { id: 'F', name: 'API F', type: 'Answer API', pricePerCall: 0.01, medianMs: 3000, spread: 0.40 }
  ];

  var SLICES = [
    { id: 'well_documented', label: 'Well documented', count: 60, phrase: 'well-documented companies', about: '1,000+ staff with plenty of public data.' },
    { id: 'long_tail', label: 'Long tail', count: 60, phrase: 'long-tail companies', about: '10 to 200 staff with little public data.' },
    { id: 'subsidiary', label: 'Subsidiaries', count: 50, phrase: 'subsidiaries', about: 'Companies owned by a larger parent group.' },
    { id: 'rebrand', label: 'Recent rebrands', count: 30, phrase: 'recent rebrands', about: 'Companies that changed their name in the last two years.' }
  ];

  var FIELDS = [
    { id: 'hq_city', label: 'HQ city' },
    { id: 'industry', label: 'Industry' },
    { id: 'employee_range', label: 'Employee range' },
    { id: 'founded_year', label: 'Founded year' },
    { id: 'linkedin_url', label: 'LinkedIn URL' }
  ];

  // side: 'vendor' = the API got it wrong; 'benchmark' = the benchmark itself may be wrong.
  // phrase completes "API X ..." in generated sentences.
  var TAGS = [
    { id: 'parent_company', label: 'Returned parent company', side: 'vendor', phrase: 'returned the parent company',
      about: 'The API gave the parent group\'s value for a subsidiary.' },
    { id: 'pre_rebrand', label: 'Pre-rebrand record', side: 'vendor', phrase: 'returned the pre-rebrand record',
      about: 'The API gave the old LinkedIn page or industry from before the company renamed itself.' },
    { id: 'same_name', label: 'Same-name company', side: 'vendor', phrase: 'matched a different company with the same name',
      about: 'The API matched another company that shares the name.' },
    { id: 'stale_value', label: 'Stale value', side: 'vendor', phrase: 'returned a stale value',
      about: 'The API gave an older value, like a previous HQ or a smaller headcount band.' },
    { id: 'no_value', label: 'No value returned', side: 'vendor', phrase: 'returned nothing',
      about: 'The API left the field blank.' },
    { id: 'near_match', label: 'Near match judged wrong', side: 'benchmark', phrase: 'gave a near match that was judged wrong',
      about: 'Close enough that a person might accept it: a metro area for a city, or the neighboring headcount band.' },
    { id: 'ref_outdated', label: 'Reference may be outdated', side: 'benchmark', phrase: 'gave an answer newer than the reference',
      about: 'The API\'s answer is newer than the reference, so the benchmark may be the one that is wrong.' }
  ];

  // Which fields each wrong-answer reason can land on, with relative weights.
  var TAG_FIELDS = {
    parent_company: { hq_city: 1, industry: 1, employee_range: 1, founded_year: 1, linkedin_url: 1 },
    pre_rebrand: { linkedin_url: 0.6, industry: 0.4 },
    near_match: { hq_city: 0.75, employee_range: 0.25 },
    ref_outdated: { employee_range: 0.6, hq_city: 0.4 },
    stale_value: { employee_range: 0.6, hq_city: 0.4 },
    same_name: { hq_city: 1, industry: 1, employee_range: 1, founded_year: 1, linkedin_url: 1 },
    no_value: { hq_city: 1, industry: 1, employee_range: 1, founded_year: 1, linkedin_url: 1 }
  };
  // Constrained reasons are dealt first so they get the fields they need.
  var DEAL_ORDER = ['parent_company', 'pre_rebrand', 'near_match', 'ref_outdated', 'stale_value', 'same_name', 'no_value'];

  var BANDS = ['1-10', '11-50', '51-200', '201-500', '501-1,000', '1,001-5,000', '5,001-10,000', '10,001+'];

  var CITIES = [
    ['Cambridge', 'MA', 'Boston metro area'], ['Somerville', 'MA', 'Boston metro area'],
    ['Palo Alto', 'CA', 'San Francisco Bay Area'], ['San Mateo', 'CA', 'San Francisco Bay Area'],
    ['Oakland', 'CA', 'San Francisco Bay Area'], ['Santa Monica', 'CA', 'Los Angeles metro area'],
    ['Pasadena', 'CA', 'Los Angeles metro area'], ['Bellevue', 'WA', 'Seattle metro area'],
    ['Redmond', 'WA', 'Seattle metro area'], ['Evanston', 'IL', 'Chicago metro area'],
    ['Plano', 'TX', 'Dallas-Fort Worth area'], ['Irving', 'TX', 'Dallas-Fort Worth area'],
    ['Hoboken', 'NJ', 'New York metro area'], ['Brooklyn', 'NY', 'New York metro area'],
    ['Boulder', 'CO', 'Denver metro area'], ['Tempe', 'AZ', 'Phoenix metro area'],
    ['Alpharetta', 'GA', 'Atlanta metro area'], ['Reston', 'VA', 'Washington DC metro area'],
    ['Bethesda', 'MD', 'Washington DC metro area'], ['Cary', 'NC', 'Raleigh-Durham area'],
    ['Round Rock', 'TX', 'Austin metro area'], ['Edina', 'MN', 'Minneapolis-St. Paul area'],
    ['Lehi', 'UT', 'Salt Lake City metro area'], ['Dearborn', 'MI', 'Detroit metro area']
  ].map(function (c) { return { label: c[0] + ', ' + c[1], state: c[1], metro: c[2] }; });

  var INDUSTRIES = [
    ['Freight and logistics', 'Freight'], ['Payments', 'Pay'], ['Industrial equipment', 'Machines'],
    ['Healthcare staffing', 'Health'], ['Cybersecurity', 'Security'], ['Commercial real estate', 'Properties'],
    ['Food distribution', 'Foods'], ['Marketing analytics', 'Analytics'], ['Insurance', 'Insurance'],
    ['Construction software', 'Build'], ['Energy services', 'Energy'], ['Specialty retail', 'Goods'],
    ['Developer tools', 'Labs'], ['HR software', 'People']
  ].map(function (p) { return { name: p[0], word: p[1] }; });

  var PARENT_INDUSTRIES = ['Diversified holdings', 'Industrial conglomerate', 'Private equity platform', 'Diversified services'];
  var PARENT_WORDS = ['Group', 'Holdings', 'Industries'];

  var NAME_START = ['Ab', 'Bel', 'Cor', 'Dav', 'Esk', 'Fen', 'Gar', 'Hal', 'Isk', 'Jor', 'Kel', 'Lun', 'Mar', 'Nor', 'Ost',
    'Pel', 'Quen', 'Ros', 'Sal', 'Tor', 'Ulv', 'Ven', 'Wyn', 'Yar', 'Zel'];
  var NAME_MID = ['', 'a', 'e', 'i', 'o', 'an', 'en', 'or'];
  var NAME_END = ['dra', 'vik', 'ton', 'mere', 'lio', 'nex', 'vale', 'tis', 'quin', 'bry', 'mont', 'dell', 'rix', 'wick', 'stead'];

  // ---------- seeded randomness ----------

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
  function pick(rng, list) { return list[Math.floor(rng() * list.length)]; }
  function shuffle(rng, list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
    return list;
  }
  function gaussian(rng) {
    var u = 1 - rng(), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function pickOther(rng, list, current) {
    for (var tries = 0; tries < 50; tries++) {
      var c = pick(rng, list);
      if (c !== current) return c;
    }
    return list[(list.indexOf(current) + 1) % list.length];
  }
  function slug(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function linkedin(name) { return 'linkedin.example/company/' + slug(name); }

  // Split n into whole counts by share, using largest remainders so the counts add up to n.
  function largestRemainder(shares, n) {
    var raw = shares.map(function (s) { return s * n; });
    var counts = raw.map(Math.floor);
    var left = n - counts.reduce(function (a, b) { return a + b; }, 0);
    var order = raw.map(function (r, i) { return { i: i, rem: r - Math.floor(r) }; })
      .sort(function (x, y) { return y.rem - x.rem || x.i - y.i; });
    for (var k = 0; k < left; k++) counts[order[k % order.length].i] += 1;
    return counts;
  }

  // ---------- companies ----------

  function makeNamer(rng) {
    var used = {};
    return function () {
      for (var tries = 0; tries < 500; tries++) {
        var w = pick(rng, NAME_START) + pick(rng, NAME_MID) + pick(rng, NAME_END);
        if (!used[w]) { used[w] = true; return w; }
      }
      throw new Error('ran out of names');
    };
  }

  function makeCompanies(rng) {
    var nextWord = makeNamer(rng);
    var companies = [];
    var n = 0;
    function id() { n += 1; return 'c' + String(n).padStart(3, '0'); }

    function base(slice, name, industry, bandLo, bandHi, yearLo, yearHi) {
      var city = pick(rng, CITIES);
      return {
        id: id(), slice: slice, name: name, domain: slug(name) + '.example',
        industry: industry.name, city: city, band: randInt(rng, bandLo, bandHi),
        founded: randInt(rng, yearLo, yearHi), linkedin: linkedin(name)
      };
    }

    var i;
    for (i = 0; i < 60; i++) {
      var ind = pick(rng, INDUSTRIES);
      companies.push(base('well_documented', nextWord() + ' ' + ind.word, ind, 5, 7, 1950, 2005));
    }
    for (i = 0; i < 60; i++) {
      var ind2 = pick(rng, INDUSTRIES);
      companies.push(base('long_tail', nextWord() + ' ' + ind2.word, ind2, 1, 2, 2012, 2022));
    }

    // 50 subsidiaries spread across 12 parent groups; each parent uses distinct industries.
    var parents = [];
    for (i = 0; i < 12; i++) {
      var pw = nextWord();
      var pname = pw + ' ' + PARENT_WORDS[i % PARENT_WORDS.length];
      parents.push({
        word: pw, name: pname, industry: PARENT_INDUSTRIES[i % PARENT_INDUSTRIES.length],
        city: pick(rng, CITIES), band: randInt(rng, 6, 7), founded: randInt(rng, 1890, 1975),
        linkedin: linkedin(pname), used: {}
      });
    }
    for (i = 0; i < 50; i++) {
      var p = parents[i % parents.length];
      var sind;
      do { sind = pick(rng, INDUSTRIES); } while (p.used[sind.word]);
      p.used[sind.word] = true;
      var sub = base('subsidiary', p.word + ' ' + sind.word, sind, 2, 4, 1998, 2018);
      if (sub.city.label === p.city.label) sub.city = pickOther(rng, CITIES, p.city);
      sub.parent = { name: p.name, industry: p.industry, city: p.city, band: p.band, founded: p.founded, linkedin: p.linkedin };
      companies.push(sub);
    }

    // 30 recent rebrands; about 60% also changed industry when they renamed.
    for (i = 0; i < 30; i++) {
      var newInd = pick(rng, INDUSTRIES);
      var pivoted = rng() < 0.6;
      var oldInd = pivoted ? pickOther(rng, INDUSTRIES, newInd) : newInd;
      var oldName = nextWord() + ' ' + oldInd.word;
      var rb = base('rebrand', nextWord() + ' ' + newInd.word, newInd, 1, 3, 2014, 2021);
      rb.rebrand = { oldName: oldName, oldLinkedin: linkedin(oldName), oldIndustry: pivoted ? oldInd.name : null, year: randInt(rng, 2024, 2026) };
      companies.push(rb);
    }
    return companies;
  }

  // The current, true value of a field.
  function truth(co, field) {
    switch (field) {
      case 'hq_city': return co.city.label;
      case 'industry': return co.industry;
      case 'employee_range': return BANDS[co.band];
      case 'founded_year': return String(co.founded);
      default: return co.linkedin;
    }
  }
  function parentValue(co, field) {
    var p = co.parent;
    switch (field) {
      case 'hq_city': return p.city.label;
      case 'industry': return p.industry;
      case 'employee_range': return BANDS[p.band];
      case 'founded_year': return String(p.founded);
      default: return p.linkedin;
    }
  }
  function oldValue(co, field) {
    if (!co.rebrand) return null;
    if (field === 'linkedin_url') return co.rebrand.oldLinkedin;
    if (field === 'industry') return co.rebrand.oldIndustry;
    return null;
  }

  // Can this wrong-answer reason land on this company's field?
  function eligible(tag, field, co) {
    if (!TAG_FIELDS[tag][field]) return false;
    if (tag === 'parent_company') return co.slice === 'subsidiary';
    if (tag === 'pre_rebrand') return co.slice === 'rebrand' && oldValue(co, field) !== null;
    if (field === 'employee_range' && tag === 'ref_outdated') return co.band < BANDS.length - 1;
    if (field === 'employee_range' && tag === 'stale_value') return co.band > 0;
    return true;
  }

  // The value an API returns for a given behavior, plus the judge's one-line reason.
  function answerFor(rng, behavior, field, co) {
    var t = truth(co, field);
    var other;
    switch (behavior) {
      case 'correct':
        return { returned: t, reason: '' };
      case 'no_value':
        return { returned: '', reason: 'no value returned' };
      case 'parent_company': {
        var what = { hq_city: 'HQ', industry: 'industry', employee_range: 'headcount', founded_year: 'founding year', linkedin_url: 'LinkedIn page' }[field];
        return { returned: parentValue(co, field), reason: 'returned the parent group\'s ' + what + ' (' + co.parent.name + ')' };
      }
      case 'pre_rebrand':
        return {
          returned: oldValue(co, field),
          reason: (field === 'linkedin_url' ? 'returned the LinkedIn page from before the rebrand' : 'returned the industry from before the rebrand') +
            ' (' + co.rebrand.oldName + ')'
        };
      case 'same_name': {
        var twin = pickOther(rng, CITIES, co.city);
        var r = 'matched a different company with the same name, based in ' + twin.label;
        if (field === 'hq_city') return { returned: twin.label, reason: r };
        if (field === 'industry') return { returned: pickOther(rng, INDUSTRIES.map(function (x) { return x.name; }), co.industry), reason: r };
        if (field === 'employee_range') return { returned: BANDS[pickOther(rng, [0, 1, 2, 3, 4, 5, 6, 7], co.band)], reason: r };
        if (field === 'founded_year') {
          other = co.founded;
          while (other === co.founded) other = randInt(rng, 1960, 2023);
          return { returned: String(other), reason: r };
        }
        return { returned: co.linkedin + '-' + twin.state.toLowerCase(), reason: r };
      }
      case 'stale_value':
        if (field === 'hq_city') return { returned: pickOther(rng, CITIES, co.city).label, reason: 'returned a previous HQ city' };
        return { returned: BANDS[co.band - 1], reason: 'returned an older, smaller headcount band' };
      case 'near_match':
        if (field === 'hq_city') return { returned: co.city.metro, reason: 'returned the metro area, not the city' };
        other = co.band === 0 ? 1 : (co.band === BANDS.length - 1 ? co.band - 1 : co.band + (rng() < 0.5 ? -1 : 1));
        return { returned: BANDS[other], reason: 'returned the neighboring band; headcount sits near the edge' };
      case 'ref_outdated':
        if (field === 'hq_city') return { returned: pickOther(rng, CITIES, co.city).label, reason: 'returned a newer HQ city than the reference has' };
        return { returned: BANDS[co.band + 1], reason: 'returned a larger band, dated after the reference was built' };
      default:
        throw new Error('unknown behavior ' + behavior);
    }
  }

  // Deal behaviors to one API's scored items within one slice.
  function deal(rng, items, rates, companyById, shortfall) {
    var counts = largestRemainder(rates, items.length);
    var behavior = new Array(items.length);
    DEAL_ORDER.forEach(function (tag) {
      var k = counts[OUTCOMES.indexOf(tag)];
      if (!k) return;
      var weights = TAG_FIELDS[tag];
      var pools = {};
      items.forEach(function (it, idx) {
        if (behavior[idx]) return;
        if (!eligible(tag, it.field, companyById[it.companyId])) return;
        (pools[it.field] = pools[it.field] || []).push(idx);
      });
      Object.keys(pools).forEach(function (f) { shuffle(rng, pools[f]); });
      for (var j = 0; j < k; j++) {
        var open = Object.keys(weights).filter(function (f) { return pools[f] && pools[f].length; });
        if (!open.length) { shortfall.push(tag); continue; }
        var total = open.reduce(function (s, f) { return s + weights[f]; }, 0);
        var roll = rng() * total, chosen = open[open.length - 1];
        for (var q = 0; q < open.length; q++) {
          roll -= weights[open[q]];
          if (roll < 0) { chosen = open[q]; break; }
        }
        behavior[pools[chosen].pop()] = tag;
      }
    });
    for (var i = 0; i < behavior.length; i++) if (!behavior[i]) behavior[i] = 'correct';
    return behavior;
  }

  // Judge a returned value against the reference. Run 1 and run 2 share these rules.
  function judge(item, returned, behavior, reason) {
    if (item.reference === '') return { verdict: 'no_reference', tag: null, reason: '' };
    if (returned === '') return { verdict: 'missing', tag: 'no_value', reason: 'no value returned' };
    if (returned === item.reference) return { verdict: 'correct', tag: null, reason: '' };
    if (item.staleReference && returned === item.truth) {
      return { verdict: 'wrong', tag: 'ref_outdated', reason: 'returned the page after the rebrand; the reference still has the old one' };
    }
    return { verdict: 'wrong', tag: behavior, reason: reason };
  }

  function generate(seed) {
    if (seed === undefined) seed = SEED;
    var rng = mulberry32(seed);
    var companies = makeCompanies(rng);
    var companyById = {};
    companies.forEach(function (c) { companyById[c.id] = c; });

    var items = [];
    companies.forEach(function (co) {
      FIELDS.forEach(function (f) {
        var t = truth(co, f.id);
        items.push({
          key: co.id + '|' + f.id, companyId: co.id, company: co.name, slice: co.slice, field: f.id,
          truth: t, reference: rng() < BLANK_REFERENCE_RATE ? '' : t, staleReference: false, oldReference: null
        });
      });
    });

    // Pick the rebranded companies whose LinkedIn reference is still the old page.
    var itemByKey = {};
    items.forEach(function (it) { itemByKey[it.key] = it; });
    var pool = companies.filter(function (c) {
      return c.slice === 'rebrand' && itemByKey[c.id + '|linkedin_url'].reference !== '';
    });
    shuffle(rng, pool).slice(0, STALE_REFERENCE_COMPANIES).forEach(function (c) {
      var it = itemByKey[c.id + '|linkedin_url'];
      it.reference = c.rebrand.oldLinkedin;
      it.staleReference = true;
      it.oldReference = c.rebrand.oldLinkedin;
      c.staleReference = true;
    });

    var cells = [];
    var shortfall = [];
    APIS.forEach(function (api) {
      SLICES.forEach(function (sl) {
        var sliceItems = items.filter(function (it) { return it.slice === sl.id; });
        var scored = sliceItems.filter(function (it) { return it.reference !== ''; });
        var behaviors = deal(rng, scored, PLANTED_RATES[api.id][sl.id], companyById, shortfall);
        var byKey = {};
        scored.forEach(function (it, idx) { byKey[it.key] = behaviors[idx]; });
        sliceItems.forEach(function (it) {
          var co = companyById[it.companyId];
          var b = byKey[it.key] || 'correct';
          var ans = answerFor(rng, b, it.field, co);
          var j = judge(it, ans.returned, b, ans.reason);
          cells.push({
            key: api.id + '|' + it.key, itemKey: it.key, api: api.id, companyId: co.id, company: co.name,
            slice: co.slice, field: it.field, reference: it.reference, returned: ans.returned,
            verdict: j.verdict, tag: j.tag, reason: j.reason
          });
        });
      });
    });

    var calls = [];
    APIS.forEach(function (api) {
      companies.forEach(function (co) {
        calls.push({ api: api.id, companyId: co.id, latencyMs: Math.round(api.medianMs * Math.exp(api.spread * gaussian(rng))), cost: api.pricePerCall });
      });
    });

    return {
      seed: seed, apis: APIS, slices: SLICES, fields: FIELDS, tags: TAGS,
      companies: companies, items: items, cells: cells, calls: calls, shortfall: shortfall
    };
  }

  // The concrete inputs for run 2, derived from run 1 with the three planted changes.
  function planRun2(run) {
    var rng = mulberry32(run.seed + 2);
    var ch = RUN2_CHANGES;
    var refreshes = run.items.filter(function (it) { return it.staleReference; }).map(function (it) {
      var co = run.companies.filter(function (c) { return c.id === it.companyId; })[0];
      return { itemKey: it.key, newReference: it.truth, oldReference: it.oldReference, oldName: co.rebrand.oldName };
    });
    var broken = run.cells.filter(function (c) {
      return c.api === ch.answerUpdate.api && c.verdict === 'wrong' && c.tag === ch.answerUpdate.tag;
    });
    var fixed = shuffle(rng, broken.slice()).slice(0, Math.round(broken.length * ch.answerUpdate.fixShare));
    var answers = fixed.map(function (c) {
      var it = run.items.filter(function (x) { return x.key === c.itemKey; })[0];
      return { cellKey: c.key, returned: it.truth };
    });
    return { scoringRule: ch.scoringRule, refreshes: refreshes, answers: answers, changes: ch };
  }

  root.BenchData = {
    SEED: SEED, OUTCOMES: OUTCOMES, PLANTED_RATES: PLANTED_RATES, BLANK_REFERENCE_RATE: BLANK_REFERENCE_RATE,
    STALE_REFERENCE_COMPANIES: STALE_REFERENCE_COMPANIES, RUN2_CHANGES: RUN2_CHANGES,
    APIS: APIS, SLICES: SLICES, FIELDS: FIELDS, TAGS: TAGS, TAG_FIELDS: TAG_FIELDS, BANDS: BANDS,
    mulberry32: mulberry32, largestRemainder: largestRemainder, generate: generate, planRun2: planRun2
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
