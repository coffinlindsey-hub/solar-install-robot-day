/*
 * The page: runs the engine, hands one day to the 3D view, and draws the
 * tables and bars from the same results.
 */
(function () {
  'use strict';
  const Sim = window.SolarSim, Par = window.SolarParams;
  const COLOR = window.SolarScene.STATE_COLOR, LABEL = Sim.STATE_LABEL, findSeg = window.SolarScene.findSeg;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const n0 = (x) => (Math.round(x) || 0).toLocaleString('en-US');
  const unit = (d) => (d.unit === '%' || d.unit === 'x' ? d.def + d.unit : d.def + (d.unit ? ' ' + d.unit : ''));
  const n1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  const n2 = (x) => x.toFixed(2);
  const pct = (x) => Math.round(x * 100) + '%';
  const hrs = (s) => n1(s / 3600);

  const S = { p: Par.defaults(), scen: 'base', agg: null, day: null, t: 0, playing: false, speed: 20, A: null, pick: 'typical', all: null, first: true };
  let scene = null;

  const WHY = {
    reload: 'Driven by the share of bad reloads, how long a good swap takes, and whether the forklift is there when the pallet runs out.',
    break: 'The robot stops whenever its crew stops. Staggering breaks keeps it running, at a slower pace while one person covers both jobs.',
    travel: 'Moving forward after every stop, turning into the next row, and the drive from and to the depot.',
    fault: 'Vision or placement faults, racking that is out of tolerance, and damaged panels. Rare per panel, but each one stops the robot for minutes.',
    crew: 'The robot is not allowed to get more than a few loose panels ahead of the person fastening.',
    weather: 'Wind, rain or heat holds. Most days have none. A day that has one loses a lot.',
    charge: 'Only happens when the battery cannot last the shift.',
    idle: 'Start of shift briefing and checks, and the wrap up at the end.',
  };

  // ---------- running the model ----------
  function recompute(keepTime) {
    const p = S.p, t0 = performance.now();
    S.agg = Sim.runDays(p);
    const runs = S.agg.runs, mean = S.agg.panels.mean;
    let idx = 0;
    if (S.pick === 'best') runs.forEach((r, i) => { if (r.panels > runs[idx].panels) idx = i; });
    else if (S.pick === 'worst') runs.forEach((r, i) => { if (r.panels < runs[idx].panels) idx = i; });
    else runs.forEach((r, i) => { if (Math.abs(r.panels - mean) < Math.abs(runs[idx].panels - mean)) idx = i; });
    S.dayIdx = idx;
    S.day = new Sim.Simulation(p, p.seed + idx).run();
    const ms = Math.round(performance.now() - t0);
    $('runNote').textContent = S.agg.n + ' simulated days in ' + ms + ' ms';
    $('scrub').max = S.day.end;
    if (!keepTime || S.t > S.day.end) {
      const first = S.day.robots[0].segs.find((s) => s.s === 'place');
      S.t = first ? Math.max(0, first.t0 - 20) : 0;
    }
    if (scene) scene.setDay(S.day);
    $('robotBtn').hidden = S.day.robots.length < 2;
    $('hOf').textContent = 'of ' + p.shiftHours + ' h';
    $('dayNote').textContent = 'Showing day ' + (idx + 1) + ' of ' + S.agg.n + ': ' + n0(S.day.kpi.panels) + ' panels. The average is ' + n0(mean) + '.';
    drawStrip(); drawAll(); tick(0, true);
  }
  let timer = null;
  function later() { clearTimeout(timer); timer = setTimeout(() => recompute(true), 220); }

  // ---------- the stage ----------
  function focus() { return scene ? scene.focus : 0; }
  function drawStrip() {
    const c = $('strip'), w = c.clientWidth || 600, dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr); c.height = Math.round(14 * dpr);
    const g = c.getContext('2d'), R = S.day.robots[Math.min(focus(), S.day.robots.length - 1)], T = S.day.end;
    g.clearRect(0, 0, c.width, c.height);
    for (const s of R.segs) {
      g.fillStyle = COLOR[s.s];
      const x = (s.t0 / T) * c.width, x2 = (s.t1 / T) * c.width;
      g.fillRect(x, 0, Math.max(0.6, x2 - x), c.height);
    }
  }
  function panelsAt(t) {
    let n = 0;
    for (const R of S.day.robots) { let lo = 0, hi = R.places.length; while (lo < hi) { const m = (lo + hi) >> 1; if (R.places[m].t <= t) lo = m + 1; else hi = m; } n += lo; }
    return n;
  }
  let lastHud = '';
  function hud() {
    const d = S.day, t = S.t, R = d.robots[Math.min(focus(), d.robots.length - 1)];
    const s = R.segs[findSeg(R.segs, t, 0)];
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = Math.floor(t % 60);
    $('hClock').textContent = S.speed <= 5 ? h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') : h + ':' + String(m).padStart(2, '0');
    const key = s.s + '|' + (s.kind || '');
    if (key !== lastHud) {
      lastHud = key;
      $('hState').firstElementChild.style.background = COLOR[s.s];
      $('hState').lastElementChild.textContent = LABEL[s.s] + (s.kind && s.s !== 'crew' ? ': ' + s.kind : '');
    }
    const n = panelsAt(t);
    $('hPanels').textContent = n0(n);
    $('hMw').textContent = n2((n * d.p.panelWatts) / 1e6);
    const f = s.t1 > s.t0 ? (t - s.t0) / (s.t1 - s.t0) : 0;
    $('hStack').textContent = s.s === 'place' && f >= 0.3 ? s.n0 - 1 : s.n0;
    $('hSoc').textContent = pct(Math.max(0, s.soc - (s.s === 'charge' ? 0 : f * (s.t1 - s.t0) / 3600 * (s.s === 'place' ? d.p.drawPlaceKW : s.s === 'travel' ? d.p.drawDriveKW : d.p.drawIdleKW) / d.p.batteryKWh)));
    $('scrub').value = t;
  }
  let prev = 0, visible = true;
  function tick(now, force) {
    const dt = Math.min(0.25, (now - prev) / 1000 || 0); prev = now;
    let simDt = 0;
    if (S.playing) {
      simDt = dt * S.speed; S.t += simDt;
      if (S.t >= S.day.end) { S.t = S.day.end; setPlaying(false); }
    }
    if (scene && (visible || force)) { scene.setTime(Math.min(S.t, S.day.end - 0.001), S.playing ? simDt : 0.05); scene.render(S.playing || force ? dt * 1000 : 0); }
    hud();
  }
  function frame(now) { if (!document.hidden) tick(now); requestAnimationFrame(frame); }
  function setPlaying(on) {
    if (on && S.t >= S.day.end - 1) S.t = 0;
    S.playing = on; $('playBtn').textContent = on ? 'Pause' : 'Play';
    if (on) $('hint').style.opacity = 0;
  }

  // ---------- results ----------
  function tile(k, v, s, extra) { return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (extra || '') + '<div class="s">' + s + '</div></div>'; }
  function range(st, f) { return 'lowest ' + f(st.min) + ', highest ' + f(st.max); }

  function drawTiles() {
    const a = S.agg, p = S.p, nR = p.numRobots, both = nR > 1 ? ' (both robots)' : '';
    const soc = a.minSoc.min, charged = a.runs.filter((r) => r.charges > 0).length;
    $('tiles').innerHTML =
      tile('Panels per day' + both, n0(a.panels.mean), range(a.panels, n0)) +
      tile('Megawatts per day', n2(a.mw.mean) + ' <small>MW</small>', range(a.mw, n2) + ', at ' + p.panelWatts + ' W a panel') +
      tile('Robot running hours', n1(a.runningH.mean) + ' <small>of ' + p.shiftHours + ' h shift</small>', 'Hours the robot is placing panels' + (nR > 1 ? ', per robot' : '') + '. With travelling and reloads: ' + n1(a.runningReloadH.mean) + ' h.',
        '<div class="meter"><b style="width:' + (100 * a.runningH.mean / p.shiftHours).toFixed(1) + '%"></b></div>') +
      tile('Panels per running hour', n0(a.perRunHour.mean), 'Panels divided by hours spent placing') +
      tile('Panels per person hour', n1(a.perPersonHour.mean), 'Two people per robot, over the whole paid shift') +
      tile('Battery', charged ? charged + ' <small>of ' + a.n + ' days needed a charge</small>' : pct(soc) + ' <small>left at worst</small>', charged ? 'A charge does not last the shift with these settings.' : 'One charge lasts the shift on every simulated day.');
  }

  function lossList() {
    const a = S.agg;
    return Sim.STATES.filter((s) => s !== 'place').map((s) => ({ s, t: a.time[s].mean })).sort((x, y) => y.t - x.t);
  }
  function drawLoss() {
    const a = S.agg, p = S.p, T = p.shiftHours * 3600, th = Sim.theory(p), L = lossList(), top = L[0];
    const panels = (t) => n0(t / (th.cycle + th.adv));
    $('loss').innerHTML = '<h3>Biggest loss: ' + LABEL[top.s].toLowerCase() + ', ' + hrs(top.t) + ' hours a day</h3>' +
      '<p>That is ' + pct(top.t / T) + ' of the shift, worth about ' + panels(top.t) + ' panels' + (p.numRobots > 1 ? ' per robot' : '') + '. ' + WHY[top.s] +
      ' Next: ' + LABEL[L[1].s].toLowerCase() + ' (' + hrs(L[1].t) + ' h) and ' + LABEL[L[2].s].toLowerCase() + ' (' + hrs(L[2].t) + ' h). The robot is placing panels for ' + hrs(a.time.place.mean) + ' of ' + p.shiftHours + ' hours.</p>';
  }

  function stackBar(time, T, thin) {
    let h = '<div class="stack' + (thin ? ' thin' : '') + '">';
    for (const s of Sim.STATES) {
      const t = time[s]; if (t <= 0) continue;
      h += '<i style="flex:' + t.toFixed(1) + ' 0 0;background:' + COLOR[s] + '" title="' + LABEL[s] + ': ' + hrs(t) + ' h">' + (!thin && t / T > 0.075 ? '<span>' + LABEL[s] + ' ' + hrs(t) + '</span>' : '') + '</i>';
    }
    return h + '</div>';
  }
  function drawBreakdown() {
    const a = S.agg, T = S.p.shiftHours * 3600, mean = {}, shown = S.day.kpi.time;
    for (const s of Sim.STATES) mean[s] = a.time[s].mean;
    let h = '<div class="stacklab"><b>Average day</b></div>' + stackBar(mean, T) +
      '<div class="stacklab">The day shown in the 3D view</div>' + stackBar(shown, T, true);
    h += '<div class="scroll"><table class="tbl" style="margin-top:14px"><thead><tr><th>State</th><th>Hours, average</th><th>Share of shift</th><th>Lowest day</th><th>Highest day</th><th>Day shown</th></tr></thead><tbody>';
    for (const s of Sim.STATES) {
      h += '<tr><td><i class="sw" style="background:' + COLOR[s] + '"></i>' + LABEL[s] + '</td><td>' + n2(a.time[s].mean / 3600) + '</td><td>' + pct(a.time[s].mean / T) + '</td><td>' + n2(a.time[s].min / 3600) + '</td><td>' + n2(a.time[s].max / 3600) + '</td><td>' + n2(shown[s] / 3600) + '</td></tr>';
    }
    h += '<tr class="sum"><td>Shift</td><td>' + n2(T / 3600) + '</td><td>100%</td><td></td><td></td><td>' + n2(T / 3600) + '</td></tr></tbody></table></div>';
    const keys = Object.keys(a.sub).filter((k) => a.sub[k] > 30 && !k.endsWith(': ')).sort((x, y) => a.sub[y] - a.sub[x]);
    h += '<details class="explain"><summary>What is inside each state</summary><div class="scroll"><table class="tbl"><thead><tr><th>Detail</th><th>Minutes a day, average</th></tr></thead><tbody>';
    for (const k of keys) { const st = k.split(': ')[0]; h += '<tr><td><i class="sw" style="background:' + COLOR[st] + '"></i>' + LABEL[st] + ': ' + k.split(': ')[1] + '</td><td>' + n1(a.sub[k] / 60) + '</td></tr>'; }
    h += '</tbody></table></div></details>';
    $('breakdown').innerHTML = h;
  }

  function drawHand() {
    const a = S.agg, p = S.p, th = Sim.theory(p), nR = p.numRobots, sim = a.panels.mean / nR;
    const row = (name, how, v, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + name + '<br><small>' + how + '</small></td><td>' + n0(v) + '</td></tr>';
    let h = '<div class="scroll"><table class="tbl"><thead><tr><th>Step</th><th>Panels per robot per day</th></tr></thead><tbody>';
    h += row('1. The arm never stops', p.shiftHours + ' h, divided by an average pick and place of ' + n1(th.cycle) + ' s', th.armOnly);
    h += row('2. Add what the work itself needs', 'Per panel: ' + n1(th.adv) + ' s moving forward, ' + n1(th.row) + ' s changing rows, ' + n1(th.reload) + ' s of clean reload. Total ' + n1(th.all) + ' s', th.physical);
    h += row('3. Take out planned time', n0(th.planned / 60) + ' min of breaks, briefing and wrap up, and ' + n0(th.depot / 60) + ' min driving from and to the depot. This is a perfect day.', th.perfectDay);
    h += row('4. Simulation, average of ' + a.n + ' days', 'Lowest ' + n0(a.panels.min / nR) + ', highest ' + n0(a.panels.max / nR), sim, 'hl');
    h += '</tbody></table></div>';
    const gap = th.armOnly - sim;
    h += '<p class="explain"><b>Where the ' + n0(gap) + ' panels between step 1 and the simulation went.</b> Every second the robot is not placing costs one panel per ' + n1(th.cycle) + ' s.</p>';
    h += '<div class="scroll"><table class="tbl"><thead><tr><th>Time not placing</th><th>Hours a day</th><th>Panels not placed</th></tr></thead><tbody>';
    let tot = 0;
    for (const x of lossList()) { if (x.t < 1) continue; const lost = x.t / th.cycle; tot += lost; h += '<tr><td><i class="sw" style="background:' + COLOR[x.s] + '"></i>' + LABEL[x.s] + '</td><td>' + n2(x.t / 3600) + '</td><td>' + n0(lost) + '</td></tr>'; }
    h += '<tr><td>Left over: cycle times drawn slower or faster than average, panels in progress at a stop</td><td></td><td>' + n0(gap - tot) + '</td></tr>';
    h += '<tr class="sum"><td>Total gap</td><td></td><td>' + n0(gap) + '</td></tr></tbody></table></div>';
    const util = sim * th.fasten / Math.max(1, a.time.place.mean + a.time.travel.mean + a.time.crew.mean);
    h += '<p class="explain"><b>The ceiling nobody sees: the person fastening.</b> One person needs ' + n1(th.fasten) + ' s a panel on average, so in the same working time they could fasten about ' + n0(th.crewLimit) + ' panels. The robot delivers a panel every ' + n1(th.cycle + th.adv) + ' s while it is moving along a row. When those two numbers get close, the robot starts waiting. Right now the fastener is busy ' + pct(Math.min(1, util)) + ' of the time the robot is working.</p>';
    $('hand').innerHTML = h;
  }

  function drawOee() {
    const a = S.agg, p = S.p, k = S.day.kpi.oee;
    const planned = k.planned / 3600;
    $('oee').innerHTML = '<div class="oee">' +
      tile('Availability', pct(a.A.mean), 'Running time divided by planned time. Planned time is the shift minus breaks, briefing and wrap up (' + n1(planned) + ' h). Lost to: reloads, faults, weather, charging.') +
      tile('Performance', pct(a.P.mean), 'Panels placed, times the ideal ' + n1(k.ideal) + ' s each, divided by running time. Lost to: waiting on the crew, row changes, second tries, the drive to and from the depot.') +
      tile('Quality', pct(a.Q.mean), 'Panels right first time, divided by panels picked. Lost to: panels the crew had to reseat, and damaged panels set aside.') +
      tile('OEE', pct(a.oee.mean), 'Availability x performance x quality. Lowest day ' + pct(a.oee.min) + ', highest ' + pct(a.oee.max) + '.') +
      '</div><p class="explain"><b>Example with these numbers:</b> ' + pct(a.A.mean) + ' x ' + pct(a.P.mean) + ' x ' + pct(a.Q.mean) + ' = ' + pct(a.oee.mean) + '. The smallest of the three is where the day is lost. ' +
      (a.A.mean < a.P.mean ? 'Here that is availability: the robot is fast when it runs, but it is stopped for reloads, faults and weather.' : 'Here that is performance: the robot is running but below its ideal rate, mostly waiting on the crew or travelling.') +
      ' Breaks sit outside OEE because they are planned, which is why staggering them shows up as more planned time, not as better availability.</p>';
  }

  function drawManual() {
    const a = S.agg, p = S.p, m = Sim.manual(p), nR = p.numRobots;
    const same = p.crewSize * 1, robotPerCrew = a.panels.mean / nR;
    const max = Math.max(a.panels.max / nR, m.hi, 1) * 1.05;
    const w = (v) => (100 * v / max).toFixed(1) + '%';
    let h = '';
    h += '<div class="hbar"><div class="nm">Robot with a crew of 2<small>simulated, per robot</small></div><div class="track"><b class="main" style="width:' + w(robotPerCrew) + '"></b><u style="left:' + w(a.panels.min / nR) + ';width:' + (100 * (a.panels.max - a.panels.min) / nR / max).toFixed(1) + '%"></u></div><div class="u"><b>' + n0(robotPerCrew) + '</b> panels a day<br>' + n1(robotPerCrew / (2 * p.shiftHours)) + ' per person hour</div></div>';
    h += '<div class="hbar"><div class="nm">Manual crew of ' + same + '<small>at ' + p.manualRate + ' panels per person hour worked</small></div><div class="track"><b style="width:' + w(m.panels) + '"></b><em style="left:' + w(m.lo) + ';width:' + (100 * (m.hi - m.lo) / max).toFixed(1) + '%"></em></div><div class="u"><b>' + n0(m.panels) + '</b> panels a day<br>' + n1(m.perPersonHour) + ' per person hour</div></div>';
    const ratio = robotPerCrew / 2 / (m.panels / p.crewSize);
    h += '<p class="explain">The orange band on each bar is a range. For the robot it is the lowest to highest simulated day. For the manual crew it is the published range, about 3 to 13 panels per person hour, which gives ' + n0(m.lo) + ' to ' + n0(m.hi) + ' panels for this crew. At the rate set here, each person with the robot installs <b>' + n1(ratio) + ' times</b> what each person in the manual crew does. That multiple depends heavily on which manual rate you believe, so it is worth asking where a quoted rate was measured.</p>';
    $('manual').innerHTML = h;
  }

  function cmpTable(A, B, nameA, nameB) {
    const rows = [
      ['Panels per day', A.panels.mean, B.panels.mean, n0, 1], ['Megawatts per day', A.mw.mean, B.mw.mean, n2, 1],
      ['Robot running hours', A.runningH.mean, B.runningH.mean, n1, 1], ['Panels per person hour', A.perPersonHour.mean, B.perPersonHour.mean, n1, 1],
      ['OEE', A.oee.mean * 100, B.oee.mean * 100, (x) => Math.round(x) + '%', 1],
    ];
    for (const s of Sim.STATES) rows.push(['Hours ' + LABEL[s].toLowerCase(), A.time[s].mean / 3600, B.time[s].mean / 3600, n2, s === 'place' ? 1 : -1]);
    rows.push(['Minutes waiting for the forklift, per robot', A.forkWaitMin.mean, B.forkWaitMin.mean, n1, -1]);
    let h = '<div class="scroll"><table class="tbl"><thead><tr><th></th><th>A: ' + nameA + '</th><th>B: ' + nameB + '</th><th>Change</th></tr></thead><tbody>';
    for (const r of rows) {
      const d = r[2] - r[1], big = Math.abs(d) > Math.max(0.005, Math.abs(r[1]) * 0.01);
      const cls = !big ? '' : d * r[4] > 0 ? 'up' : 'dn';
      h += '<tr><td>' + r[0] + '</td><td>' + r[3](r[1]) + '</td><td>' + r[3](r[2]) + '</td><td class="' + cls + '">' + (!big ? '' : d > 0 ? '+' : '−') + r[3](Math.abs(d)).replace('%', ' pts') + (r[0] === 'Panels per day' && r[1] > 0 ? ' <small>(' + (d >= 0 ? '+' : '−') + Math.abs(Math.round(100 * d / r[1])) + '%)</small>' : '') + '</td></tr>';
    }
    return h + '</tbody></table></div>';
  }
  function scenName() { const s = Par.SCENARIOS.find((x) => x.id === S.scen); return s ? s.name : 'Custom settings'; }
  function drawCompare() {
    $('clearA').hidden = !S.A;
    if (!S.A) { $('compare').innerHTML = '<p class="fine">Nothing saved yet. Press "Save this as A", then pick another scenario or change a parameter.</p>'; return; }
    const T = S.p.shiftHours * 3600, ma = {}, mb = {};
    for (const s of Sim.STATES) { ma[s] = S.A.agg.time[s].mean; mb[s] = S.agg.time[s].mean; }
    $('compare').innerHTML = '<div class="stacklab"><b>A: ' + S.A.name + '</b>, ' + n0(S.A.agg.panels.mean) + ' panels a day</div>' + stackBar(ma, T) +
      '<div class="stacklab"><b>B: ' + scenName() + '</b>, ' + n0(S.agg.panels.mean) + ' panels a day</div>' + stackBar(mb, T) +
      '<div style="height:12px"></div>' + cmpTable(S.A.agg, S.agg, S.A.name, scenName());
  }
  function drawAllScen() {
    if (!S.all) return;
    const base = S.all[0].agg.panels.mean, max = Math.max.apply(null, S.all.map((x) => x.agg.panels.max)) * 1.04;
    let h = '';
    for (const x of S.all) {
      const a = x.agg, d = a.panels.mean - base, per = x.sc.set.numRobots ? ' (' + n0(a.panels.mean / x.sc.set.numRobots) + ' per robot)' : '';
      h += '<div class="hbar"><div class="nm">' + x.sc.name + '<small>' + x.sc.why + '</small></div><div class="track"><b class="main" style="width:' + (100 * a.panels.mean / max).toFixed(1) + '%"></b><u style="left:' + (100 * a.panels.min / max).toFixed(1) + '%;width:' + (100 * (a.panels.max - a.panels.min) / max).toFixed(1) + '%"></u></div><div class="u"><b>' + n0(a.panels.mean) + '</b> panels' + per + '<br>' + (x.sc.id === 'base' ? 'baseline' : (d >= 0 ? '+' : '−') + n0(Math.abs(d)) + ', ' + (d >= 0 ? '+' : '−') + Math.abs(Math.round(100 * d / base)) + '%') + '</div></div>';
    }
    h += '<p class="explain">Each bar is the average of ' + S.all[0].agg.n + ' days at the default settings with only that one change. The orange band is the lowest to highest day. The bands overlap a lot: on any single day, luck with weather and reloads matters as much as most of these changes.</p>';
    $('allScen').innerHTML = h;
  }

  function drawAll() { drawTiles(); drawLoss(); drawBreakdown(); drawHand(); drawOee(); drawManual(); drawCompare(); markParams(); }

  // ---------- controls ----------
  function buildScen() {
    const row = $('scenRow'); row.innerHTML = '';
    Par.SCENARIOS.forEach((sc, i) => {
      const b = el('button', 'btn small ghost', (i + 1) + '. ' + sc.name);
      b.dataset.id = sc.id;
      b.onclick = () => { S.p = Object.assign(Par.defaults(), sc.set); S.scen = sc.id; syncParams(); markScen(); recompute(true); };
      row.appendChild(b);
    });
    markScen();
  }
  function markScen() {
    for (const b of $('scenRow').children) b.classList.toggle('on', b.dataset.id === S.scen);
    const sc = Par.SCENARIOS.find((x) => x.id === S.scen);
    $('scenWhy').textContent = sc ? sc.why : 'Custom settings. Pick a scenario to go back to a prebuilt one.';
  }
  function buildParams() {
    const host = $('params'), groups = {};
    for (const d of Par.DEFS) (groups[d.group] = groups[d.group] || []).push(d);
    for (const g in groups) {
      const det = el('details', 'grp'), sum = el('summary', '', g + ' <small>' + groups[g].length + ' numbers</small>'), box = el('div', 'prms');
      det.appendChild(sum); det.appendChild(box);
      for (const d of groups[g]) {
        const r = el('div', 'prm'); r.id = 'prm-' + d.key;
        const src = d.src ? Par.SOURCES[d.src] : null;
        const onoff = d.unit === 'on/off';
        r.innerHTML = '<label for="in-' + d.key + '">' + d.label + '</label>' +
          (onoff ? '<select id="in-' + d.key + '"><option value="0">Off</option><option value="1">On</option></select>'
            : '<input id="in-' + d.key + '" type="number" inputmode="decimal" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '">') +
          '<div class="meta"><span class="tag ' + d.tag + '">' + d.tag + '</span>Default ' + (onoff ? (d.def ? 'on' : 'off') : unit(d)) + '. ' + (d.note || '') +
          (src ? ' <a href="' + src.url + '" target="_blank" rel="noopener">' + src.label + '</a>' : '') + '</div>';
        box.appendChild(r);
        const inp = r.querySelector('input,select');
        inp.addEventListener('change', () => {
          let v = parseFloat(inp.value);
          if (!isFinite(v)) v = d.def;
          v = Math.max(d.min, Math.min(d.max, v));
          if (d.step >= 1) v = Math.round(v);
          inp.value = v; S.p[d.key] = v; S.scen = 'custom'; markScen(); later();
        });
      }
      host.appendChild(det);
    }
    syncParams();
  }
  function syncParams() { for (const d of Par.DEFS) { const i = $('in-' + d.key); if (i) i.value = S.p[d.key]; } }
  function markParams() { for (const d of Par.DEFS) { const r = $('prm-' + d.key); if (r) r.classList.toggle('changed', S.p[d.key] !== d.def); } }

  function buildStatic() {
    $('legend').innerHTML = Sim.STATES.map((s) => '<span><i style="background:' + COLOR[s] + '"></i>' + LABEL[s] + '</span>').join('');
    const ul = $('assumptions');
    for (const d of Par.DEFS) if (d.tag === 'assumption') ul.appendChild(el('li', '', d.label + ': <b>' + unit(d) + '</b>' + (d.note ? '. ' + d.note : '')));
    const extra = [
      'Breaks and holds start when the task in hand is finished, never in the middle of one.',
      'The fastener is one person who works through placed panels in order.',
      'The forklift serves requests first come, first served, and returns to staging after every delivery.',
      'When the rover is heading south its pallet faces north, so the forklift drives round the end of the row to reach it.',
      'A weather hold stops every robot on the site at the same time.',
      'Tracker tilt while panels go on is drawn at 22 degrees. This is for looks only and changes no number.',
      'The public manual rates of 3 to 13 panels per person hour are worked out from published crew totals, crew sizes and shift lengths.',
    ];
    for (const x of extra) ul.appendChild(el('li', '', x));
    const so = $('sources');
    for (const k in Par.SOURCES) { const s = Par.SOURCES[k]; so.appendChild(el('li', '', '<a href="' + s.url + '" target="_blank" rel="noopener">' + s.label + '</a>. ' + s.says)); }
  }

  function wire() {
    $('playBtn').onclick = () => setPlaying(!S.playing);
    $('speedSel').onchange = (e) => { S.speed = +e.target.value; };
    $('scrub').addEventListener('input', (e) => { S.t = +e.target.value; });
    $('daySel').onchange = (e) => { S.pick = e.target.value; recompute(false); };
    for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => {
      if (scene) scene.setView(b.dataset.view);
      for (const o of document.querySelectorAll('[data-view]')) o.classList.toggle('on', o === b);
    };
    $('robotBtn').onclick = () => { if (!scene) return; scene.setFocus((scene.focus + 1) % S.day.robots.length); $('robotBtn').textContent = 'Robot ' + (scene.focus + 1); drawStrip(); lastHud = ''; };
    $('fullBtn').onclick = () => {
      const card = document.querySelector('.stagecard'), on = !card.classList.contains('expanded');
      card.classList.toggle('expanded', on); document.body.classList.toggle('locked', on);
      $('fullBtn').textContent = on ? 'Close' : 'Full screen';
      if (scene) { scene.setExpanded(on); scene.resize(); } drawStrip();
    };
    $('saveA').onclick = () => { S.A = { name: scenName(), agg: S.agg }; drawCompare(); };
    $('clearA').onclick = () => { S.A = null; drawCompare(); };
    $('resetBtn').onclick = () => { S.p = Par.defaults(); S.scen = 'base'; syncParams(); markScen(); recompute(true); };
    document.addEventListener('keydown', (e) => {
      if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!S.playing); }
      if (e.code === 'Escape' && document.querySelector('.stagecard.expanded')) $('fullBtn').click();
    });
    new ResizeObserver(() => { if (scene) scene.resize(); if (S.day) drawStrip(); }).observe($('host'));
    new IntersectionObserver((en) => { visible = en[0].isIntersecting; }).observe($('stage'));
  }

  // ---------- start ----------
  buildScen(); buildParams(); buildStatic(); wire();
  try { scene = new window.SolarScene($('host')); }
  catch (e) { $('host').innerHTML = '<div class="nogl">This browser could not start the 3D view. The numbers below still work.</div>'; }
  recompute(false);
  requestAnimationFrame(frame);
  setPlaying(true);
  setTimeout(() => {
    S.all = Par.SCENARIOS.map((sc) => ({ sc, agg: Sim.runDays(Object.assign(Par.defaults(), sc.set)) }));
    drawAllScen();
  }, 400);
})();
