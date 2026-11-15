// Run with:  node --test tests/sim.test.js
// Uses only what ships with Node. Nothing to install.
const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../sim.js');
const Params = require('../params.js');

const P = (set) => Object.assign(Params.defaults(), set || {});
const day = (set, seed) => new Sim.Simulation(P(set), seed || 3).run();
const CLEAN = { fastenMin: 10, fastenMode: 12, fastenMax: 14, badReloadPct: 0, visionFaultPct: 0, rackingPct: 0, damagedPct: 0, weatherPerDay: 0, repositionPct: 0, reworkPct: 0 };

test('random distributions have the right averages', () => {
  const rng = Sim.dist.mulberry32(42);
  const n = 200000;
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) { a += Sim.dist.tri(rng, 30, 35, 40); b += Sim.dist.poisson(rng, 0.25); }
  assert.ok(Math.abs(a / n - 35) < 0.05, 'triangular mean');
  assert.ok(Math.abs(b / n - 0.25) < 0.01, 'poisson mean');
});

test('same seed gives the same day, a different seed does not', () => {
  const a = day({}, 7).kpi, b = day({}, 7).kpi, c = day({}, 8).kpi;
  assert.equal(a.panels, b.panels);
  assert.equal(a.time.place, b.time.place);
  assert.notEqual(a.time.place, c.time.place);
});

test('every second of the shift is accounted for, in every scenario', () => {
  for (const sc of Params.SCENARIOS) {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = day(sc.set, seed);
      const sum = Object.values(r.kpi.time).reduce((x, y) => x + y, 0);
      assert.ok(Math.abs(sum - r.end) < 1, sc.name + ' seed ' + seed + ': ' + sum);
      for (const R of r.robots) {
        for (let i = 1; i < R.segs.length; i++) assert.ok(Math.abs(R.segs[i].t0 - R.segs[i - 1].t1) < 1e-6, sc.name + ': gap or overlap in the record');
      }
    }
  }
});

test('no panel is lost or invented', () => {
  for (const sc of Params.SCENARIOS) {
    const r = day(sc.set, 11);
    for (const R of r.robots) {
      // every panel taken from a pallet was placed, set aside as damaged, or is still on the rover
      assert.equal(R.pallets * r.p.panelsPerPallet, R.places.length + R.damaged + R.stack, sc.name);
      const seen = new Set(R.places.map((q) => q.row + ':' + q.idx));
      assert.equal(seen.size, R.places.length, sc.name + ': a slot was filled twice');
    }
  }
});

test('robots never work the same row', () => {
  const r = day({ numRobots: 2 }, 5);
  const rows0 = new Set(r.robots[0].places.map((q) => q.row));
  for (const q of r.robots[1].places) assert.ok(!rows0.has(q.row));
});

test('the simulation never beats the hand calculation', () => {
  const t = Sim.theory(P());
  for (let seed = 1; seed <= 20; seed++) {
    const k = day({}, seed).kpi;
    assert.ok(k.panels <= t.armOnly, 'more panels than an arm that never stops');
    assert.ok(k.panels <= t.perfectDay * 1.03, 'more panels than a perfect day');
  }
});

test('with every stop switched off the day lands on the hand calculation', () => {
  const p = P(CLEAN), t = Sim.theory(p);
  const r = Sim.runDays(p, 20, 1);
  assert.ok(Math.abs(r.panels.mean - t.perfectDay) / t.perfectDay < 0.03, r.panels.mean + ' vs ' + t.perfectDay);
});

test('the robot never gets further ahead of the fastener than allowed', () => {
  const r = day({ cycleMin: 15, cycleMode: 18, cycleMax: 20 }, 9);
  const R = r.robots[0], m = r.p.maxAhead;
  for (let i = m; i < R.places.length; i++) {
    const placedAt = R.places[i].t, started = placedAt - 1;   // when panel i went down, panel i - m was already fastened
    assert.ok(R.fastens[i - m].t1 <= placedAt + 1e-6 && started > 0);
  }
  assert.ok(r.kpi.time.crew > 600, 'a very fast arm should end up waiting on the crew');
});

test('levers move the result the right way', () => {
  const base = Sim.runDays(P(), 20, 1).panels.mean;
  assert.ok(Sim.runDays(P({ staggerBreaks: 1 }), 20, 1).panels.mean > base);
  assert.ok(Sim.runDays(P({ badReloadPct: 0 }), 20, 1).panels.mean > base);
  assert.ok(Sim.runDays(P({ badReloadPct: 60 }), 20, 1).panels.mean < base);
  assert.ok(Sim.runDays(P({ preStage: 1 }), 20, 1).forkWaitMin.mean < 0.01);
  const two = Sim.runDays(P({ numRobots: 2 }), 20, 1);
  assert.ok(two.panels.mean < 2 * base, 'sharing a forklift should cost something');
  assert.ok(two.panels.mean > 1.6 * base);
});

test('a small battery sends the robot to the charger', () => {
  const k = day({ batteryKWh: 15 }, 2).kpi;
  assert.ok(k.charges >= 1);
  assert.ok(k.time.charge > 0);
  assert.equal(day({}, 2).kpi.charges, 0, 'the default battery should last the shift');
});

test('the robot is back at the depot when the shift ends', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const r = day({}, seed), R = r.robots[0], last = R.segs[R.segs.length - 1];
    assert.equal(last.s, 'idle');
    assert.ok(Math.abs(R.x - r.L.depot[0]) < 0.01 && Math.abs(R.z - r.L.depot[1]) < 0.01);
  }
});
