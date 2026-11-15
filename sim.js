/*
 * Discrete event simulation of one shift of a robot assisted solar
 * installation crew.
 *
 * No dependencies. Works in a browser (window.SolarSim) and in Node (require).
 * Time inside the engine is seconds from the start of the shift.
 *
 * How it works, in one paragraph: the engine keeps a list of future events
 * sorted by time (a panel is set down, a forklift arrives, a break ends). It
 * jumps from one event to the next and writes down what every robot and
 * forklift was doing between them. That record is the only output. The
 * numbers on the page are sums over it, and the 3D view plays it back, so
 * the two cannot disagree.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SolarSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- random numbers and distributions ----------

  // Small seeded generator so a day can be repeated exactly.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Triangular: a minimum, a most likely value and a maximum.
  function tri(rng, a, c, b) {
    if (b <= a) return a;
    c = Math.min(b, Math.max(a, c));
    const u = rng();
    const f = (c - a) / (b - a);
    return u < f
      ? a + Math.sqrt(u * (b - a) * (c - a))
      : b - Math.sqrt((1 - u) * (b - a) * (b - c));
  }
  const triMean = (a, c, b) => (a + Math.min(b, Math.max(a, c)) + b) / 3;
  const uni = (rng, a, b) => a + (b - a) * rng();

  // Poisson: how many times a rare thing happens in a day.
  function poisson(rng, mean) {
    const l = Math.exp(-mean);
    let k = 0, q = 1;
    do { k++; q *= rng(); } while (q > l);
    return k - 1;
  }

  // The spreads used around each "typical" value, kept in one place so the
  // hand calculation uses exactly the same averages as the engine.
  const SPREAD = {
    advance: [0.6, 1, 1.5],
    align: [0.5, 1, 2],
    reposition: [20, 40, 90],        // seconds
    reloadGood: [0.75, 1, 1.5],
    forkLoad: [0.67, 1, 2],
    swap: [0.6, 1, 1.5],
    vision: [0.5, 1.5, 5],           // minutes
    racking: [2, 4, 10],             // minutes
    damaged: [1, 2, 4],              // minutes
    rework: [30, 60, 120],           // seconds of extra crew time
    weather: [0.5, 1, 3],
  };
  const mean3 = (s, k) => triMean(s[0] * k, s[1] * k, s[2] * k);

  // ---------- event list and a tiny process kernel ----------

  class Heap {
    constructor() { this.h = []; this.seq = 0; }
    get size() { return this.h.length; }
    push(t, fn) {
      const h = this.h, e = { t, s: this.seq++, fn };
      let i = h.length;
      h.push(e);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (h[p].t < e.t || (h[p].t === e.t && h[p].s < e.s)) break;
        h[i] = h[p]; i = p;
      }
      h[i] = e;
    }
    pop() {
      const h = this.h, top = h[0], last = h.pop();
      if (h.length) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= h.length) break;
          if (c + 1 < h.length && (h[c + 1].t < h[c].t || (h[c + 1].t === h[c].t && h[c + 1].s < h[c].s))) c++;
          if (last.t < h[c].t || (last.t === h[c].t && last.s < h[c].s)) break;
          h[i] = h[c]; i = c;
        }
        h[i] = last;
      }
      return top;
    }
  }

  // Each robot and each forklift delivery is a small script (a generator).
  // A script hands back either a number (wait this many seconds) or
  // something with a wait() method (a signal or a request for a forklift).
  class Kernel {
    constructor() { this.now = 0; this.q = new Heap(); }
    spawn(gen) { this.step(gen); }
    step(gen, val) {
      const r = gen.next(val);
      if (r.done) return;
      const y = r.value;
      if (typeof y === 'number') this.q.push(this.now + Math.max(0, y), () => this.step(gen));
      else y.wait((v) => this.step(gen, v));
    }
    run(until) {
      while (this.q.size) {
        const e = this.q.pop();
        if (e.t > until) break;
        this.now = e.t;
        e.fn();
      }
    }
  }
  class Signal {
    constructor() { this.fired = false; this.w = []; }
    wait(cb) { if (this.fired) cb(); else this.w.push(cb); }
    fire() { if (this.fired) return; this.fired = true; const w = this.w; this.w = []; for (const cb of w) cb(); }
  }
  class Pool {   // a set of identical resources, first come first served
    constructor(n) { this.free = []; for (let i = n - 1; i >= 0; i--) this.free.push(i); this.q = []; }
    request() { const self = this; return { wait(cb) { if (self.free.length) cb(self.free.pop()); else self.q.push(cb); } }; }
    release(id) { if (this.q.length) this.q.shift()(id); else this.free.push(id); }
  }

  // ---------- site layout ----------
  // Rows run north (+z). Row r sits at x = r * pitch. The rover drives in the
  // aisle just east of the row it is working on. The access road runs east to
  // west along the south end of the block.

  function layout(p) {
    const slot = p.panelWid + 0.02;                 // panel plus the gap to the next
    const rowLen = p.panelsPerRow * slot;
    const aisle = p.panelLen / 2 + 1.35;            // tube to rover centre line
    const roadZ = -16, headS = -7, headN = rowLen + 7;
    const L = {
      slot, rowLen, aisle, roadZ, headS, headN, pitch: p.rowPitch, rows: p.numRows, n: p.panelsPerRow,
      staging: [-p.stagingDistance, roadZ + 8],
      depot: [-p.depotDistance, roadZ - 9],
      panel(row, idx) { return [row * p.rowPitch, (idx + 0.5) * slot]; },
      aisleX(row) { return row * p.rowPitch + aisle; },
      // z of the rover when it serves panels j..j+m-1 of a row (j counts in travel order)
      stopZ(dir, j, m) {
        const a = dir > 0 ? j : p.panelsPerRow - 1 - j;
        const b = dir > 0 ? j + m - 1 : p.panelsPerRow - j - m;
        return ((a + b) / 2 + 0.5) * slot;
      },
      rowChange(row, dir, zFrom, zTo) {
        const h = dir > 0 ? headN : headS;
        return [[this.aisleX(row), zFrom], [this.aisleX(row), h], [this.aisleX(row + 1), h], [this.aisleX(row + 1), zTo]];
      },
      fromDepot(row, z) { const ax = this.aisleX(row); return [this.depot.slice(), [this.depot[0], roadZ], [ax, roadZ], [ax, z]]; },
      toDepot(x, z) { return [[x, z], [x, roadZ], [this.depot[0], roadZ], this.depot.slice()]; },
      // The forklift has to reach the back of the rover. When the rover is
      // heading south its back faces north, so the forklift goes round by the
      // next aisle and the north end of the row.
      forkPath(row, dir, z) {
        const ax = this.aisleX(row), zt = z - dir * 4.3, s = this.staging;
        if (dir > 0) return [s.slice(), [s[0], roadZ], [ax, roadZ], [ax, zt]];
        return [s.slice(), [s[0], roadZ], [ax + p.rowPitch, roadZ], [ax + p.rowPitch, headN], [ax, headN], [ax, zt]];
      },
    };
    return L;
  }
  function pathLen(path) {
    let d = 0;
    for (let i = 1; i < path.length; i++) d += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    return d;
  }

  const STATES = ['place', 'crew', 'break', 'reload', 'travel', 'fault', 'weather', 'charge', 'idle'];
  const STATE_LABEL = {
    place: 'Placing', crew: 'Waiting on the crew', break: 'Crew breaks', reload: 'Reloading', travel: 'Travelling',
    fault: 'Faulted', weather: 'Weather hold', charge: 'Charging', idle: 'Idle',
  };

  // ---------- the simulation of one day ----------

  class Simulation {
    constructor(p, seed) {
      this.p = p;
      this.seed = seed >>> 0;
      this.L = layout(p);
      this.end = p.shiftHours * 3600;
      this.k = new Kernel();
      this.fork = new Pool(p.numForklifts);
      this.forklifts = [];
      for (let i = 0; i < p.numForklifts; i++) this.forklifts.push({ id: i, segs: [] });
      // One random stream per purpose. A change to, say, reload settings then
      // leaves the cycle times of the day untouched, which makes scenario
      // comparisons fair (same luck, different policy).
      this.shared = mulberry32(this.seed * 7919 + 11);
      this.robots = [];
      const per = Math.floor(p.numRows / p.numRobots);
      for (let i = 0; i < p.numRobots; i++) {
        const s = (n) => mulberry32(this.seed * 7919 + 101 * (i + 1) + n);
        this.robots.push({
          id: i, row0: i * per, rowEnd: (i + 1) * per, row: i * per, dir: 1, j: 0, stopLeft: 0,
          x: this.L.depot[0], z: this.L.depot[1],
          stack: p.panelsPerPallet, placed: 0, damaged: 0, rework: 0, pallets: 1, reloads: 0, badReloads: 0,
          kwh: p.batteryKWh, minSoc: 1, charges: 0,
          segs: [], places: [], fastens: [], crewFree: 0, req: null, rolled: false, pend: [], staged: [],
          rng: { cycle: s(1), fasten: s(2), reload: s(3), fault: s(4), move: s(5), fork: s(6) },
          breaks: this.breakPlan(), wi: 0, zoneDone: false,
        });
      }
      this.weather = this.weatherPlan();
    }

    breakPlan() {
      const p = this.p, T = this.end, out = [];
      if (p.shortBreakMin > 0) out.push({ at: T * 0.25, dur: p.shortBreakMin * 60, kind: 'short break' });
      if (p.lunchMin > 0) out.push({ at: T * 0.5, dur: p.lunchMin * 60, kind: 'lunch' });
      if (p.shortBreakMin > 0) out.push({ at: T * 0.75, dur: p.shortBreakMin * 60, kind: 'short break' });
      return out;
    }
    weatherPlan() {
      const p = this.p, r = this.shared, out = [];
      const n = poisson(r, p.weatherPerDay);
      for (let i = 0; i < n; i++) {
        const s = SPREAD.weather, m = p.weatherMode * 60;
        out.push({ at: uni(r, p.startupMin * 60, this.end * 0.92), dur: tri(r, s[0] * m, s[1] * m, s[2] * m), kind: ['wind', 'rain', 'heat'][Math.floor(r() * 3)] });
      }
      return out.sort((a, b) => a.at - b.at);
    }
    // During staggered breaks one person is away for twice the break length in total.
    solo(t) {
      if (!this.p.staggerBreaks) return 1;
      for (const b of this.breakPlan()) if (t >= b.at && t < b.at + 2 * b.dur) return this.p.soloSlowdown;
      return 1;
    }

    draw(s) { const p = this.p; return s === 'place' ? p.drawPlaceKW : s === 'travel' ? p.drawDriveKW : s === 'charge' ? 0 : p.drawIdleKW; }

    *spend(R, s, dur, info) {
      const t0 = this.k.now;
      const seg = Object.assign({ s, t0, t1: t0 + dur, x: R.x, z: R.z, d: R.dir, soc: R.kwh / this.p.batteryKWh }, info);
      R.segs.push(seg);
      R.kwh -= (dur / 3600) * this.draw(s);
      R.minSoc = Math.min(R.minSoc, R.kwh / this.p.batteryKWh);
      yield dur;
      if (seg.path) { const e = seg.path[seg.path.length - 1]; R.x = e[0]; R.z = e[1]; }
      return seg;
    }
    *drive(R, path, kind, extra) {
      return yield* this.spend(R, 'travel', pathLen(path) / this.p.driveSpeed + (extra || 0), { kind, path });
    }

    // When the whole crew stops, fastening that was waiting or half done resumes afterwards.
    shiftCrew(R, T, D) {
      for (let i = R.fastens.length - 1; i >= 0; i--) {
        const f = R.fastens[i];
        if (f.t1 <= T) break;
        if (f.t0 >= T) f.t0 += D;
        f.t1 += D;
      }
      if (R.crewFree > T) R.crewFree += D;
    }

    homeTime(R) { return pathLen(this.L.toDepot(R.x, R.z)) / this.p.driveSpeed + this.p.wrapUpMin * 60; }

    *holds(R) {
      const p = this.p, now = this.k.now;
      for (const b of R.breaks) {
        if (b.done || now < b.at) continue;
        b.done = true;
        if (p.staggerBreaks) continue;
        yield* this.spend(R, 'break', b.dur, { kind: b.kind });
        this.shiftCrew(R, now, b.dur);
        return true;
      }
      while (R.wi < this.weather.length && now >= this.weather[R.wi].at) {
        const w = this.weather[R.wi++], left = w.at + w.dur - now;
        if (left <= 1) continue;
        yield* this.spend(R, 'weather', left, { kind: w.kind });
        this.shiftCrew(R, now, left);
        return true;
      }
      if (R.kwh / p.batteryKWh <= p.reservePct / 100) {
        const back = this.L.toDepot(R.x, R.z), x = R.x, z = R.z;
        yield* this.drive(R, back, 'to charger');
        const need = 0.9 * p.batteryKWh - R.kwh;
        const seg = yield* this.spend(R, 'charge', (need / p.chargeKW) * 3600, {});
        R.kwh += need; R.charges++; seg.soc1 = R.kwh / p.batteryKWh;
        if (this.k.now + pathLen(back) / p.driveSpeed * 2 + p.wrapUpMin * 60 + 300 < this.end) {
          yield* this.drive(R, back.slice().reverse(), 'from charger');
          R.x = x; R.z = z;
        } else R.stopNow = true;
        return true;
      }
      return false;
    }

    // Where the rover will be standing when the pallet it is working from runs out.
    reloadSpot(R) {
      const p = this.p, L = this.L;
      let row = R.row, dir = R.dir, j = R.j + Math.max(0, R.stack - 1);
      while (j >= p.panelsPerRow && row + 1 < R.rowEnd) { j -= p.panelsPerRow; row++; dir = -dir; }
      j = Math.min(j, p.panelsPerRow - 1);
      const k = Math.floor(j / p.panelsPerStop) * p.panelsPerStop;
      return { row, dir, z: L.stopZ(dir, k, Math.min(p.panelsPerStop, p.panelsPerRow - k)) };
    }

    requestPallet(R) {
      const req = { arrived: new Signal(), swapDone: new Signal(), spot: this.reloadSpot(R), t: this.k.now, fork: -1, R };
      this.k.spawn(this.delivery(req));
      return req;
    }

    *fspend(F, s, dur, info) {
      const seg = Object.assign({ s, t0: this.k.now, t1: this.k.now + dur }, info);
      F.segs.push(seg);
      yield dur;
      return seg;
    }
    *delivery(req) {
      const p = this.p, L = this.L, R = req.R;
      const id = yield this.fork.request();
      const F = this.forklifts[id];
      req.fork = id;
      if (!req.swapDone.fired) {
        const s = SPREAD.forkLoad, m = p.forkliftLoadMin * 60;
        yield* this.fspend(F, 'load', tri(R.rng.fork, s[0] * m, s[1] * m, s[2] * m), { r: R.id });
        const path = L.forkPath(req.spot.row, req.spot.dir, req.spot.z);
        const t = pathLen(path) / p.forkliftSpeed;
        yield* this.fspend(F, 'out', t, { r: R.id, path });
        req.tArr = this.k.now;
        req.arrived.fire();
        if (p.preStage) {
          const e = path[path.length - 1];
          const st = { t0: this.k.now + 20, t1: Infinity, x: e[0] - 1.9, z: e[1] + req.spot.dir * 4.3 };
          R.staged.push(st); req.staged = st;
          yield* this.fspend(F, 'drop', 20, { r: R.id, x: e[0], z: e[1], d: req.spot.dir });
        } else {
          const seg = { s: 'swap', t0: this.k.now, t1: Infinity, r: R.id, x: path[path.length - 1][0], z: path[path.length - 1][1], d: req.spot.dir };
          F.segs.push(seg);
          yield req.swapDone;
          seg.t1 = this.k.now;
        }
        yield* this.fspend(F, 'back', t, { r: R.id, path: path.slice().reverse() });
      }
      this.fork.release(id);
    }

    *reload(R) {
      const p = this.p;
      const req = R.req || this.requestPallet(R);
      R.req = null;
      if (!req.arrived.fired) {
        const seg = { s: 'reload', kind: 'waiting for the forklift', t0: this.k.now, t1: Infinity, x: R.x, z: R.z, d: R.dir, soc: R.kwh / p.batteryKWh, n: 0 };
        R.segs.push(seg);
        yield req.arrived;
        seg.t1 = this.k.now;
        R.kwh -= ((seg.t1 - seg.t0) / 3600) * p.drawIdleKW;
      }
      const bad = R.rng.reload() < p.badReloadPct / 100;
      const g = p.preStage ? SPREAD.swap : SPREAD.reloadGood, m = (p.preStage ? p.swapMin : p.reloadGoodMin) * 60;
      const good = tri(R.rng.reload, g[0] * m, g[1] * m, g[2] * m);
      const badDur = uni(R.rng.reload, p.reloadBadLo * 60, Math.max(p.reloadBadLo, p.reloadBadHi) * 60);
      yield* this.spend(R, 'reload', bad ? badDur : good, { kind: bad ? 'bad reload' : 'swap', bad, fork: req.fork, n: 0 });
      R.stack = p.panelsPerPallet; R.pallets++; R.reloads++; if (bad) R.badReloads++;
      if (req.staged) req.staged.t1 = this.k.now;
      req.swapDone.fire();
      if (p.preStage) R.req = this.requestPallet(R);
    }

    afterPick(R) {
      R.stack--; R.rolled = false;
      if (!R.req && !this.p.preStage && R.stack > 0 && R.stack <= this.p.callAhead) R.req = this.requestPallet(R);
    }

    *robot(R) {
      const p = this.p, L = this.L, k = this.k, N = p.panelsPerRow;
      const pps = Math.max(1, Math.round(p.panelsPerStop));
      yield* this.spend(R, 'idle', p.startupMin * 60, { kind: 'briefing and checks' });
      R.stopLeft = Math.min(pps, N);
      yield* this.drive(R, L.fromDepot(R.row, L.stopZ(1, 0, R.stopLeft)), 'from depot');
      if (p.preStage) R.req = this.requestPallet(R);

      for (;;) {
        if (R.stopNow || k.now + 80 + this.homeTime(R) > this.end) break;
        if (yield* this.holds(R)) continue;
        if (R.zoneDone) break;
        if (R.stack === 0) {
          if (k.now + 240 + this.homeTime(R) > this.end) break;
          yield* this.reload(R);
          continue;
        }
        if (R.stopLeft === 0) {
          const solo = this.solo(k.now);
          if (R.j >= N) {
            if (R.row + 1 >= R.rowEnd) { R.zoneDone = true; continue; }
            const zTo = L.stopZ(-R.dir, 0, Math.min(pps, N));
            const a = SPREAD.align, m = p.rowAlignMode;
            yield* this.drive(R, L.rowChange(R.row, R.dir, R.z, zTo), 'to the next row', tri(R.rng.move, a[0] * m, a[1] * m, a[2] * m) * solo);
            R.row++; R.dir = -R.dir; R.j = 0;
          } else {
            const m = Math.min(pps, N - R.j), z = L.stopZ(R.dir, R.j, m);
            const a = SPREAD.advance, t = tri(R.rng.move, a[0] * p.advanceMode, a[1] * p.advanceMode, a[2] * p.advanceMode) * solo;
            yield* this.spend(R, 'travel', t, { kind: 'moving forward', path: [[R.x, R.z], [R.x, z]] });
          }
          R.stopLeft = Math.min(pps, N - R.j);
          if (R.rng.move() < p.repositionPct / 100) {
            const s = SPREAD.reposition;
            yield* this.spend(R, 'travel', tri(R.rng.move, s[0], s[1], s[2]), { kind: 'second try at the stop' });
          }
          continue;
        }
        // The robot may only get so far ahead of the person fastening.
        if (R.placed >= p.maxAhead) {
          const need = R.fastens[R.placed - p.maxAhead].t1;
          if (need > k.now + 1e-6) { yield* this.spend(R, 'crew', need - k.now, { kind: 'fastening to catch up' }); continue; }
        }
        if (!R.rolled) {
          R.rolled = true; R.pend = [];
          const f = R.rng.fault;
          if (f() < p.damagedPct / 100) R.pend.push('damaged panel');
          else {
            if (f() < p.visionFaultPct / 100) R.pend.push('vision or placement fault');
            if (f() < p.rackingPct / 100) R.pend.push('racking out of tolerance');
          }
        }
        if (R.pend.length) {
          const kind = R.pend.shift();
          const s = kind === 'damaged panel' ? SPREAD.damaged : kind === 'racking out of tolerance' ? SPREAD.racking : SPREAD.vision;
          yield* this.spend(R, 'fault', tri(R.rng.fault, s[0], s[1], s[2]) * 60, { kind, n: R.stack });
          if (kind === 'damaged panel') { R.damaged++; this.afterPick(R); }
          continue;
        }
        // Pick and place one panel.
        const idx = R.dir > 0 ? R.j : N - 1 - R.j;
        yield* this.spend(R, 'place', tri(R.rng.cycle, p.cycleMin, p.cycleMode, p.cycleMax), { row: R.row, idx, n: R.stack });
        const now = k.now;
        R.places.push({ t: now, row: R.row, idx });
        const rw = R.rng.fasten() < p.reworkPct / 100;
        if (rw) R.rework++;
        const t0 = Math.max(now, R.crewFree);
        const dur = tri(R.rng.fasten, p.fastenMin, p.fastenMode, p.fastenMax) * this.solo(t0) + (rw ? tri(R.rng.fasten, SPREAD.rework[0], SPREAD.rework[1], SPREAD.rework[2]) : 0);
        R.crewFree = t0 + dur;
        R.fastens.push({ t0, t1: t0 + dur, row: R.row, idx, rw });
        R.placed++; R.j++; R.stopLeft--;
        this.afterPick(R);
      }

      if (R.req) R.req.swapDone.fire();           // let the forklift go
      if (pathLen(this.L.toDepot(R.x, R.z)) > 1) yield* this.drive(R, L.toDepot(R.x, R.z), 'to depot');
      if (k.now < this.end) yield* this.spend(R, 'idle', this.end - k.now, { kind: R.zoneDone ? 'block finished' : 'wrap up' });
    }

    run() {
      for (const R of this.robots) this.k.spawn(this.robot(R));
      this.k.run(this.end + 3600);
      return this.results();
    }

    results() {
      const p = this.p, T = this.end, nR = this.robots.length;
      const time = {}, sub = {};
      for (const s of STATES) time[s] = 0;
      let panels = 0, damaged = 0, rework = 0, reloads = 0, bad = 0, forkWait = 0, minSoc = 1, charges = 0;
      const perRobot = [];
      for (const R of this.robots) {
        R.segs = R.segs.filter((g) => g.t0 < T);
        for (const g of R.segs) {
          if (g.t1 > T) g.t1 = T;
          const d = g.t1 - g.t0;
          time[g.s] += d;
          const key = g.s + ': ' + (g.kind || '');
          sub[key] = (sub[key] || 0) + d;
          if (g.s === 'reload' && g.kind === 'waiting for the forklift') forkWait += d;
        }
        R.places = R.places.filter((q) => q.t <= T);
        R.fastens = R.fastens.filter((f) => f.t0 < T);
        for (const st of R.staged) if (st.t1 > T) st.t1 = T;
        panels += R.places.length; damaged += R.damaged; rework += R.rework; reloads += R.reloads; bad += R.badReloads;
        minSoc = Math.min(minSoc, R.minSoc); charges += R.charges;
        perRobot.push(R.places.length);
      }
      for (const F of this.forklifts) {
        F.segs = F.segs.filter((g) => g.t0 < T);
        for (const g of F.segs) if (g.t1 > T) g.t1 = T;
      }
      for (const s of STATES) time[s] /= nR;
      for (const key in sub) sub[key] /= nR;
      let forkBusy = 0;
      for (const F of this.forklifts) for (const g of F.segs) forkBusy += g.t1 - g.t0;

      // Overall equipment effectiveness, per robot.
      const breaks = p.staggerBreaks ? 0 : (p.lunchMin + 2 * p.shortBreakMin) * 60;
      const routine = (p.startupMin + p.wrapUpMin) * 60;
      const planned = T - breaks - routine;
      const availLoss = time.fault + time.weather + time.reload + time.charge + Math.max(0, time.idle - routine);
      const runT = Math.max(1, planned - availLoss);
      const ideal = triMean(p.cycleMin, p.cycleMode, p.cycleMax) + mean3(SPREAD.advance, p.advanceMode) / Math.max(1, Math.round(p.panelsPerStop));
      const A = runT / planned, Pf = Math.min(1.5, ((panels / nR) * ideal) / runT);
      const Q = panels + damaged > 0 ? (panels - rework) / (panels + damaged) : 1;

      const kpi = {
        panels, perRobot, damaged, rework, reloads, badReloads: bad,
        mw: (panels * p.panelWatts) / 1e6,
        time, sub,
        runningH: time.place / 3600,
        runningReloadH: (time.place + time.travel + time.reload) / 3600,
        shiftH: p.shiftHours,
        forkWaitMin: forkWait / nR / 60,
        forkBusyPct: (100 * forkBusy) / (T * this.forklifts.length),
        minSoc, charges,
        perRunHour: panels / nR / Math.max(1e-9, time.place / 3600),
        oee: { A, P: Pf, Q, oee: A * Pf * Q, planned, runT, ideal },
        perPersonHour: panels / (2 * nR * p.shiftHours),
      };
      return { p, seed: this.seed, L: this.L, end: T, robots: this.robots, forklifts: this.forklifts, weather: this.weather, kpi };
    }
  }

  // ---------- hand calculation ----------
  // The most panels a robot could place if nothing ever went wrong, built up
  // one step at a time from the averages of the same distributions.

  function theory(p) {
    const T = p.shiftHours * 3600;
    const pps = Math.max(1, Math.round(p.panelsPerStop));
    const cycle = triMean(p.cycleMin, p.cycleMode, p.cycleMax);
    const adv = mean3(SPREAD.advance, p.advanceMode) / pps;
    const L = layout(p);
    const rowMove = (2 * (7 + L.slot * pps / 2) + p.rowPitch) / p.driveSpeed + mean3(SPREAD.align, p.rowAlignMode);
    const row = rowMove / p.panelsPerRow;
    const reload = (p.preStage ? mean3(SPREAD.swap, p.swapMin) : mean3(SPREAD.reloadGood, p.reloadGoodMin)) * 60 / p.panelsPerPallet;
    const planned = (p.staggerBreaks ? 0 : (p.lunchMin + 2 * p.shortBreakMin) * 60) + (p.startupMin + p.wrapUpMin) * 60;
    const depot = 2 * (p.depotDistance + L.aisle + 25) / p.driveSpeed;
    const all = cycle + adv + row + reload;
    const fasten = triMean(p.fastenMin, p.fastenMode, p.fastenMax) + (p.reworkPct / 100) * triMean(SPREAD.rework[0], SPREAD.rework[1], SPREAD.rework[2]);
    return {
      T, cycle, adv, row, reload, all, planned, depot, fasten,
      armOnly: T / cycle,
      physical: T / all,
      perfectDay: Math.max(0, T - planned - depot) / all,
      crewLimit: Math.max(0, T - planned - depot) / fasten,
      ratePerRunHour: 3600 / (cycle + adv + row),
    };
  }

  // What a manual crew would do in the same shift. A simple calculation, not a simulation.
  function manual(p) {
    const worked = p.shiftHours - (p.lunchMin + 2 * p.shortBreakMin + p.startupMin + p.wrapUpMin) / 60;
    const weather = (p.weatherPerDay * mean3(SPREAD.weather, p.weatherMode)) / 60;
    const hours = Math.max(0, worked - weather);
    const panels = p.crewSize * p.manualRate * hours;
    return { panels, hours, perPersonHour: panels / (p.crewSize * p.shiftHours), lo: p.crewSize * 3 * hours, hi: p.crewSize * 13 * hours };
  }

  // ---------- many days ----------

  function stat(v) {
    const s = v.slice().sort((a, b) => a - b), n = s.length;
    const q = (f) => s[Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))))];
    return { mean: v.reduce((a, b) => a + b, 0) / n, min: s[0], max: s[n - 1], p10: q(0.1), p90: q(0.9) };
  }

  function runDays(p, days, seed0) {
    const n = days || p.days, s0 = seed0 || p.seed, runs = [];
    for (let i = 0; i < n; i++) runs.push(new Simulation(p, s0 + i).run().kpi);
    const pick = (f) => stat(runs.map(f));
    const time = {}, sub = {};
    for (const s of STATES) time[s] = pick((r) => r.time[s]);
    for (const r of runs) for (const key in r.sub) sub[key] = (sub[key] || 0) + r.sub[key] / n;
    return {
      n, runs,
      panels: pick((r) => r.panels), mw: pick((r) => r.mw), runningH: pick((r) => r.runningH), runningReloadH: pick((r) => r.runningReloadH),
      perRunHour: pick((r) => r.perRunHour), reloads: pick((r) => r.reloads), badReloads: pick((r) => r.badReloads),
      forkWaitMin: pick((r) => r.forkWaitMin), forkBusyPct: pick((r) => r.forkBusyPct), minSoc: pick((r) => r.minSoc), charges: pick((r) => r.charges),
      damaged: pick((r) => r.damaged), rework: pick((r) => r.rework), perPersonHour: pick((r) => r.perPersonHour),
      A: pick((r) => r.oee.A), P: pick((r) => r.oee.P), Q: pick((r) => r.oee.Q), oee: pick((r) => r.oee.oee),
      time, sub,
    };
  }

  return {
    Simulation, runDays, theory, manual, layout, pathLen, STATES, STATE_LABEL, SPREAD,
    dist: { mulberry32, tri, triMean, uni, poisson },
  };
});
