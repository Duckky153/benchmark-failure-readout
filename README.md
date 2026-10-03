# Benchmark failure readout

A small static page that takes one benchmark run and explains it. It splits the gap between two APIs into the few groups that cause it, shows the rows behind each group, sets aside the misses that might be the benchmark's own fault, and builds a three-line draft post from the numbers.

Everything is synthetic: six fictional APIs (API A to API F) look up five fields for 200 fictional companies on `.example` domains. The patterns were planted on purpose, so the page shows a method, not a result about any real product. Every number on the page is computed from the rows when the page loads; none is typed in.

## What the main page shows (`index.html`)

1. **Result sentence.** One plain sentence at the top, for example "API C trails API A by N points; X% of that gap is subsidiaries where API C returned the parent company."
2. **Scoreboard.** Success rate, accuracy on returned values, $ per 1,000 correct and median latency for each API. Columns sort; clicking a row explains that API below.
3. **Where the gap comes from.** A bar chart that splits the gap between the selected API and the one it is compared to (the leader by default) into company slice x failure reason groups, largest first, with a check that the bars add up to the gap.
4. **Failure mode of the field.** Failure rate per company slice for all six APIs, as stacked bars by reason, with a callout naming the slice where even the best API fails most.
5. **The rows behind it.** Clicking any bar lists up to 8 of the failing cells behind it: company, field, reference, returned value, reason tag and a one-line reason.
6. **Check before posting.** A switch that sets aside the misses that might be the benchmark's fault. Every score and chart updates, any rank change is stated, and a noise check says whether the gap is bigger than chance.
7. **Draft post.** Three lines built by a fixed template from the numbers: the finding, a chart caption, and what changes in v2. A Copy button copies them.
8. **How it's scored.** Every formula, slice and reason in a sentence, the assumptions, and what is synthetic.
9. **Checks.** A collapsed panel that proves the counts and the gap parts add up, and shows the generator seed.
10. **Questions I'd want answered.** The open questions the page leaves.

## What the second page shows (`moved.html`)

"What moved between runs." Run 2 is run 1 with three planted changes: API C ships an update that fixes most of its subsidiary answers, the LinkedIn reference is refreshed for 10 rebranded companies, and the judge starts accepting a metro area for HQ city.

- For each API, the score change split into three bars: API answers changed, reference refreshed, scoring rule changed.
- A table of every flipped cell, filterable by cause and by API.
- A generated changelog line and post line, for example "API C +N points: M from new answers, K from our rescoring."

`moved.html` links back to `index.html`, but `index.html` does not link to it yet. To link it, add this line under the "Synthetic data" label in `index.html`:

```html
<p class="nav"><a href="moved.html">What moved between runs</a></p>
```

## How it works, one rule per sentence

### Scores

- **Success rate** is correct answers divided by fields with a reference, so a blank counts as a miss.
- **Accuracy on returned values** is correct divided by (correct + wrong), so it only judges the answers an API actually gave; a team writing into a CRM may prefer an API that leaves a blank over one that overwrites good data with a wrong value.
- **$ per 1,000 correct** is total cost divided by correct answers, times 1,000, so a cheap API that rarely answers is not automatically the cheapest.
- **Median latency** is the middle call time, which describes the typical call, not the slow tail.
- **Rank** is by success rate, with accuracy breaking ties.

### Where the gap comes from

- **Gap** is the compared API's success rate minus the selected API's success rate, in points.
- **Gap contribution** for a group is (compared API's correct minus selected API's correct in that group) divided by all fields with a reference, times 100.
- A field only moves the gap when exactly one of the two APIs got it right, and it lands in the group (slice x reason) of the API that missed it, so the bars add up to the gap exactly.
- The grey bar collects the fields the leading API missed and the trailing API got right; they pull the gap the other way.
- "Top two groups = X% of the gap" is the two largest bars divided by the gap.

### Failure mode of the field

- **Failure rate** is (wrong + blank) divided by fields with a reference, for each slice.
- The callout picks the slice where even the best API has its highest failure rate, then names the reason behind most misses there across all six APIs; if that reason is also the top reason for at least half of the APIs, it is a finding about the whole category, not one vendor.

### Check before posting

- **Set aside** removes two reasons, "near match judged wrong" (a metro area for a city, or the neighboring headcount band) and "reference may be outdated" (the answer is newer than the reference), from both the top and the bottom of every fraction.
- With set aside on, two APIs can be scored on slightly different cells; that small difference gets its own grey bar so the check still adds up.
- **Rank change** compares the ranks before and after the switch.
- **Does it survive?** asks whether the largest group and the direction of the gap stay the same once the set-aside cells are out.
- **Standard error** is how far a score or gap could move by chance on a fresh sample of similar companies; for one rate it is the square root of p x (1 - p) / n, and for a gap between two APIs it comes from the fields where exactly one of them was right, because both answer the same fields.
- A gap smaller than two standard errors is called a weak signal; in this run the headline gap passes easily and the API F / API D rank swap does not.

### Draft post

- Line 1 is the result sentence.
- Line 2 is a chart caption with the top-two share and the size of the run.
- Line 3, "What changes in v2", comes from the largest group of possible benchmark-fault misses (reason x field), for example "accept metro-area matches for HQ city; N cells would flip."

### Run 2 (second page)

- The three changes are made one at a time in a fixed order (scoring rule, then references, then answers), and each step is credited with the score change it causes.
- When two changes touch the same cell, the first one gets the credit; in this run they touch different cells, and the page shows that reversing the order gives the same split.
- Refreshing a reference can lower a vendor's score, because an API that returned the old LinkedIn page was being counted right against the old reference.

### The data

- `data.js` is a seeded generator (mulberry32, seed 20261002), so the same seed always gives the same rows.
- The `PLANTED_RATES` table at the top of `data.js` says what share of each API's fields in each slice are right, blank, or wrong for each reason, and the generator deals out exactly those shares.
- About 5% of reference values are blank and are left out of every denominator.
- For 10 rebranded companies the LinkedIn reference still holds the old page, so an API that returns the new page is judged wrong there; that is the "reference may be outdated" case, and run 2 fixes it.

## Assumptions

- Each API gets one call per company and returns all five fields; cost is a flat price per call, paid whether or not the answers are right.
- A returned value is right only when it matches the reference exactly; every synthetic value uses one format, so formatting never causes a miss.
- Every field counts the same.
- Each miss has one reason. The generator writes the reasons here; on a real run they would come from a judge model or a person, and a sample would need checking by hand.
- Possible benchmark-fault misses are set aside by their tag, not after a person re-checks each cell.
- Latency is drawn at random around each API's typical time; the slow tail is not modeled.

## How to run

Open `index.html` in a browser. It works straight from the file system and from any static host; there is no build step, no library and no network call.

To run the tests (Node 18 or newer, nothing to install):

```
node tests/run-tests.mjs
```

The tests check the generator, the scoring math against hand-made rows, every planted pattern, that every page number adds up, the run 2 attribution, and the site files themselves (no network loads, labels present, no dashes).

## Files

- `index.html`, `moved.html`: the two pages.
- `data.js`: the synthetic data generator and the planted rates.
- `readout.mjs`: all the scoring logic as pure functions, shared by both pages and the tests. It has no import or export lines, so the browser can load it as a plain script and Node can load it as a module.
- `app.js`, `moved.js`, `ui.js`: drawing and wiring for the pages.
- `style.css`: styles, with light and dark themes.
- `tests/run-tests.mjs`: the test runner.

## Limits

- Synthetic data only. The rates were planted, so the page proves the method, not anything about real APIs.
- The judge is exact matching, and the reasons come from the generator rather than from a model or a person.
- One run with one seed, 200 companies and five fields. Standard errors are shown for the gap and the rank swap, but the scoreboard has no error bars.
- Every field has equal weight, and cost ignores retries, rate limits and volume pricing.
- The run 2 split depends on the order of the changes when they overlap; in this run they do not.
- The page needs JavaScript, because every number is computed when it loads.

Built by Dakshit Raj with Claude Code and Codex.
