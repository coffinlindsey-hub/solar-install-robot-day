/*
 * The 3D view.
 *
 * It draws nothing of its own accord. setDay() is handed the record the
 * engine produced for one shift, and setTime() poses every robot, forklift,
 * person and panel for a moment in that record. Scrubbing backwards works
 * for the same reason.
 *
 * Everything is built from simple shapes and textures painted in code, so
 * there are no image or model files. The machines are generic.
 */
(function (root) {
  'use strict';
  const T = root.THREE;

  const STATE_COLOR = {
    place: '#1baf7a', travel: '#2a78d6', crew: '#eda100', break: '#9a988e', reload: '#6250d6',
    fault: '#e34948', weather: '#3f6f8f', charge: '#c2578f', idle: '#c9c8c0',
  };
  const TILT = 22 * Math.PI / 180;        // tracker angle while panels go on (assumption, looks only)
  const RECLINE = 55 * Math.PI / 180;     // how far the pallet leans back on the rover
  const PT = 0.0355;                      // pallet height per panel

  // ---------- small helpers ----------
  const lerp = (a, b, f) => a + (b - a) * f;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const ease = (f) => { f = clamp01(f); return f * f * (3 - 2 * f); };
  function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(c, repeat) {
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  function findSeg(segs, t, hint) {
    let i = hint || 0;
    if (i >= segs.length) i = segs.length - 1;
    if (i < 0) return -1;
    if (segs[i].t0 <= t && t < segs[i].t1) return i;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].t0 <= t) lo = m; else hi = m - 1; }
    return lo;
  }
  function alongPath(path, f) {
    let total = 0; const d = [];
    for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); d.push(l); total += l; }
    let s = clamp01(f) * total;
    for (let i = 0; i < d.length; i++) {
      if (s <= d[i] || i === d.length - 1) {
        const g = d[i] > 0 ? Math.min(1, s / d[i]) : 0, a = path[i], b = path[i + 1];
        return { x: lerp(a[0], b[0], g), z: lerp(a[1], b[1], g), yaw: d[i] > 0.01 ? Math.atan2(b[0] - a[0], b[1] - a[1]) : null, dist: clamp01(f) * total };
      }
      s -= d[i];
    }
    return { x: path[0][0], z: path[0][1], yaw: null, dist: 0 };
  }
  function box(w, h, d, mat, x, y, z, parent, shadow) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (shadow !== false) m.castShadow = true;
    if (parent) parent.add(m);
    return m;
  }
  function cyl(r1, r2, h, mat, x, y, z, parent, seg) {
    const m = new T.Mesh(new T.CylinderGeometry(r1, r2, h, seg || 16), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    if (parent) parent.add(m);
    return m;
  }

  // ---------- painted textures ----------
  function panelTexture() {
    const c = canvas(1024, 512), g = c.getContext('2d');
    g.fillStyle = '#b9bdc0'; g.fillRect(0, 0, 1024, 512);                 // aluminium frame
    const fx = 9, fy = 9, w = 1024 - 2 * fx, h = 512 - 2 * fy;
    g.fillStyle = '#d9dde0'; g.fillRect(fx, fy, w, h);                     // backing seen between cells
    const cols = 24, rows = 6, gap = 2, mid = 7;
    const cw = (w - mid - gap * (cols + 1)) / cols, ch = (h - gap * (rows + 1)) / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = fx + gap + i * (cw + gap) + (i >= cols / 2 ? mid : 0), y = fy + gap + j * (ch + gap);
        const gr = g.createLinearGradient(x, y, x + cw, y + ch);
        gr.addColorStop(0, '#101a33'); gr.addColorStop(1, '#0a1226');
        g.fillStyle = gr; g.fillRect(x, y, cw, ch);
        g.strokeStyle = 'rgba(150,170,200,0.16)'; g.lineWidth = 1;
        for (let b = 1; b < 6; b++) { g.beginPath(); g.moveTo(x, y + (ch * b) / 6); g.lineTo(x + cw, y + (ch * b) / 6); g.stroke(); }
      }
    }
    return tex(c);
  }
  function panelBackTexture() {
    const c = canvas(512, 256), g = c.getContext('2d');
    g.fillStyle = '#aeb3b6'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#262c3a'; g.fillRect(5, 5, 502, 246);
    g.strokeStyle = 'rgba(190,200,215,0.35)';
    for (let i = 1; i < 24; i++) { g.beginPath(); g.moveTo(5 + (502 * i) / 24, 5); g.lineTo(5 + (502 * i) / 24, 251); g.stroke(); }
    for (let j = 1; j < 6; j++) { g.beginPath(); g.moveTo(5, 5 + (246 * j) / 6); g.lineTo(507, 5 + (246 * j) / 6); g.stroke(); }
    g.fillStyle = '#15181f'; g.fillRect(246, 110, 20, 36);
    return tex(c);
  }
  function woodTexture() {
    const c = canvas(256, 256), g = c.getContext('2d'), r = rnd(5);
    for (let i = 0; i < 6; i++) {
      const y = (i * 256) / 6, l = 58 + r() * 10;
      g.fillStyle = `hsl(${32 + r() * 6}, ${38 + r() * 10}%, ${l}%)`; g.fillRect(0, y, 256, 256 / 6 - 3);
      g.fillStyle = 'rgba(60,40,20,0.55)'; g.fillRect(0, y + 256 / 6 - 3, 256, 3);
      g.strokeStyle = 'rgba(90,60,30,0.25)';
      for (let k = 0; k < 9; k++) { const yy = y + 3 + r() * 34; g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(80, yy + r() * 4 - 2, 170, yy + r() * 4 - 2, 256, yy); g.stroke(); }
    }
    return tex(c, [1, 1]);
  }
  function stackSideTexture() {
    const c = canvas(8, 16), g = c.getContext('2d');
    g.fillStyle = '#b4b8bb'; g.fillRect(0, 0, 8, 16);
    g.fillStyle = '#5d6165'; g.fillRect(0, 13, 8, 3);
    const t = tex(c, [1, 31]); t.magFilter = T.NearestFilter; return t;
  }
  function tireTexture() {
    const c = canvas(256, 64), g = c.getContext('2d');
    g.fillStyle = '#1b1b1c'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#0c0c0d';
    for (let i = 0; i < 16; i++) { g.save(); g.translate(i * 16 + 8, 32); g.rotate(0.5); g.fillRect(-3, -40, 6, 80); g.restore(); }
    g.fillStyle = 'rgba(110,90,60,0.25)'; g.fillRect(0, 0, 256, 64);
    return tex(c, [3, 1]);
  }
  function skyTexture() {
    const c = canvas(2048, 1024), g = c.getContext('2d'), r = rnd(11);
    const gr = g.createLinearGradient(0, 0, 0, 1024);
    gr.addColorStop(0, '#6c7b8e'); gr.addColorStop(0.3, '#8e9bab'); gr.addColorStop(0.46, '#b9c3cb'); gr.addColorStop(0.5, '#cfd5d6'); gr.addColorStop(0.51, '#8a8a78'); gr.addColorStop(1, '#6f705f');
    g.fillStyle = gr; g.fillRect(0, 0, 2048, 1024);
    // layered soft blobs make a broken overcast deck
    for (let i = 0; i < 900; i++) {
      const y = 40 + Math.pow(r(), 0.55) * 470, x = r() * 2048, near = (510 - y) / 510;
      const s = (14 + r() * 120) * (0.25 + near), dark = r() < 0.5;
      const b = g.createRadialGradient(0, 0, 0, 0, 0, s);
      const a = 0.1 + r() * 0.22;
      b.addColorStop(0, dark ? `rgba(70,78,92,${a * 1.2})` : `rgba(255,255,255,${a * 1.5})`);
      b.addColorStop(1, dark ? 'rgba(120,128,138,0)' : 'rgba(225,230,234,0)');
      g.fillStyle = b;
      for (const ox of [0, 2048, -2048]) {
        g.save(); g.translate(x + ox, y); g.scale(2.6, 0.55 + near * 0.5); g.beginPath(); g.arc(0, 0, s, 0, 7); g.fill(); g.restore();
      }
    }
    const t = tex(c); t.anisotropy = 1; return t;
  }
  function noiseTile(base, spots, n, size) {
    const c = canvas(size || 512, size || 512), g = c.getContext('2d'), r = rnd(n);
    const S = c.width;
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const x = r() * S, y = r() * S, s = 2 + r() * 14;
      g.fillStyle = spots[Math.floor(r() * spots.length)];
      g.globalAlpha = 0.1 + r() * 0.3;
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.beginPath(); g.ellipse(x + dx, y + dy, s, s * (0.4 + r() * 0.6), r() * 3, 0, 7); g.fill(); }
    }
    g.globalAlpha = 1;
    return c;
  }

  // ---------- the scene ----------
  class SolarScene {
    constructor(host) {
      this.host = host;
      this.mobile = Math.min(root.innerWidth, root.innerHeight) < 700 || /Mobi|Android/i.test(navigator.userAgent);
      const r = this.renderer = new T.WebGLRenderer({ antialias: !this.mobile, powerPreference: 'high-performance', preserveDrawingBuffer: false });
      this.maxPR = Math.min(root.devicePixelRatio || 1, this.mobile ? 1.5 : 2);
      this.pr = this.maxPR;
      r.setPixelRatio(this.pr);
      r.outputColorSpace = T.SRGBColorSpace;
      r.toneMapping = T.ACESFilmicToneMapping;
      r.toneMappingExposure = 0.95;
      r.shadowMap.enabled = true;
      r.shadowMap.type = T.PCFSoftShadowMap;
      host.appendChild(r.domElement);
      r.domElement.style.display = 'block';

      this.scene = new T.Scene();
      this.scene.fog = new T.Fog(0xcfd4d3, 420, 2600);
      this.camera = new T.PerspectiveCamera(42, 1, 0.5, 6000);

      this.tx = {
        panel: panelTexture(), back: panelBackTexture(), wood: woodTexture(), stack: stackSideTexture(), tire: tireTexture(),
      };
      this.mat = this.materials();
      this.buildSky();
      this.buildLights();

      this.site = null; this.siteKey = '';
      this.rigs = []; this.forks = []; this.people = [];
      this.dyn = new T.Group(); this.scene.add(this.dyn);
      this.day = null; this.t = 0; this.focus = 0;
      this.view = { name: 'follow', theta: 2.25, phi: 1.12, radius: 15, target: new T.Vector3(), pan: new T.Vector3() };
      this.goal = { theta: 2.25, phi: 1.12, radius: 15 };
      this.blend = 1;
      this.expanded = false; this.wheelZoom = false;
      this.fx = this.buildWeatherFx();
      this.bindInput();
      this.frameMs = 16; this.slowFrames = 0;
      this.resize();
    }

    materials() {
      const s = (o) => new T.MeshStandardMaterial(o);
      const glass = s({ map: this.tx.panel, roughness: 0.22, metalness: 0.35, envMapIntensity: 0.9 });
      const back = s({ map: this.tx.back, roughness: 0.6, metalness: 0.1 });
      const alu = s({ color: 0xb9bdc0, roughness: 0.45, metalness: 0.7 });
      return {
        glass, back, alu,
        panel: [alu, alu, glass, back, alu, alu],
        steel: s({ color: 0xa9aeb1, roughness: 0.55, metalness: 0.75 }),
        white: s({ color: 0xeceeee, roughness: 0.5, metalness: 0.15 }),
        whiteArm: s({ color: 0xf2f3f2, roughness: 0.38, metalness: 0.1 }),
        dark: s({ color: 0x1f2124, roughness: 0.7, metalness: 0.3 }),
        mid: s({ color: 0x4a4e52, roughness: 0.6, metalness: 0.4 }),
        tire: s({ map: this.tx.tire, color: 0xffffff, roughness: 0.95, metalness: 0 }),
        wood: s({ map: this.tx.wood, roughness: 0.9, metalness: 0 }),
        cup: s({ color: 0x2f7fd0, roughness: 0.5, metalness: 0.1 }),
        stack: [s({ map: this.tx.stack, roughness: 0.6, metalness: 0.5 }), null, glass, back, null, null],
        vest: s({ color: 0xd7ee2a, roughness: 0.8, metalness: 0, emissive: 0x3a4200, emissiveIntensity: 0.5 }),
        stripe: s({ color: 0xff7a1a, roughness: 0.8 }),
        jeans: s({ color: 0x2c3a52, roughness: 0.9 }),
        skin: s({ color: 0xc89a7a, roughness: 0.8 }),
        hat: s({ color: 0xf4f4f0, roughness: 0.4 }),
        boot: s({ color: 0x3a2c22, roughness: 0.9 }),
        yellow: s({ color: 0xe0a21a, roughness: 0.55, metalness: 0.2 }),
        cab: s({ color: 0x20262b, roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.75 }),
        container: s({ color: 0x5d7f93, roughness: 0.7, metalness: 0.3 }),
        cone: s({ color: 0xff6a1a, roughness: 0.7 }),
      };
    }

    buildSky() {
      const m = new T.MeshBasicMaterial({ map: skyTexture(), side: T.BackSide, fog: false, depthWrite: false, toneMapped: false });
      this.sky = new T.Mesh(new T.SphereGeometry(4500, 40, 20), m);
      this.sky.rotation.y = 1.1;
      this.scene.add(this.sky);
      // Reflections on glass and paint come from the same sky.
      const env = new T.Scene();
      env.add(new T.Mesh(new T.SphereGeometry(50, 24, 12), m));
      const pm = new T.PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromScene(env, 0.04).texture;
      pm.dispose();
    }
    buildLights() {
      this.hemi = new T.HemisphereLight(0xe6edf2, 0x6d6c58, 1.15);
      this.scene.add(this.hemi);
      const d = this.sun = new T.DirectionalLight(0xfff6ea, 1.55);
      d.castShadow = true;
      const S = this.mobile ? 1024 : 2048;
      d.shadow.mapSize.set(S, S);
      const c = d.shadow.camera; c.left = -34; c.right = 34; c.top = 34; c.bottom = -34; c.near = 1; c.far = 220;
      d.shadow.bias = -0.0004; d.shadow.normalBias = 0.04; d.shadow.radius = 5;
      this.scene.add(d); this.scene.add(d.target);
    }
    buildWeatherFx() {
      const n = 1800, pos = new Float32Array(n * 3), r = rnd(3);
      for (let i = 0; i < n; i++) { pos[i * 3] = (r() - 0.5) * 60; pos[i * 3 + 1] = r() * 24; pos[i * 3 + 2] = (r() - 0.5) * 60; }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
      const pts = new T.Points(g, new T.PointsMaterial({ color: 0xdfe8f0, size: 0.09, transparent: true, opacity: 0.7, depthWrite: false }));
      pts.visible = false; pts.frustumCulled = false;
      this.scene.add(pts);
      return { pts, kind: null, amt: 0 };
    }

    // ---------- the site: ground, racking, context ----------
    buildSite(day) {
      const p = day.p, L = day.L;
      const key = [p.numRows, p.panelsPerRow, p.rowPitch, p.panelLen, p.panelWid, p.axisHeight, p.stagingDistance, p.depotDistance].join('|');
      if (key === this.siteKey) return;
      this.siteKey = key;
      if (this.site) { this.scene.remove(this.site); this.site.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
      const S = this.site = new T.Group(); this.scene.add(S);
      const W = (p.numRows - 1) * p.rowPitch, RL = L.rowLen, H = p.axisHeight, M = this.mat;
      const dummy = new T.Object3D();
      const r = rnd(21);

      // ground: a tiled far field, plus one painted patch for the working area
      const far = new T.Mesh(new T.PlaneGeometry(9000, 9000), new T.MeshStandardMaterial({ map: tex(noiseTile('#74745c', ['#687050', '#807c62', '#5f6648', '#8a8468'], 4), [1100, 1100]), roughness: 1, metalness: 0 }));
      far.rotation.x = -Math.PI / 2; far.position.y = -0.03; far.receiveShadow = false; far.material.depthWrite = false; far.renderOrder = -2; S.add(far);

      const x0 = Math.min(-p.depotDistance, -p.stagingDistance) - 60, x1 = W + 150, z0 = L.roadZ - 60, z1 = RL + 210;
      const gw = x1 - x0, gh = z1 - z0, GS = this.mobile ? 2048 : 4096;
      const c = canvas(GS, GS), g = c.getContext('2d');
      const X = (x) => ((x - x0) / gw) * GS, Z = (z) => ((z - z0) / gh) * GS, sx = GS / gw, sz = GS / gh;
      g.fillStyle = g.createPattern(noiseTile('#72735b', ['#66704e', '#827e64', '#5c6646', '#8c866a', '#6c7650'], 9, 256), 'repeat');
      g.fillRect(0, 0, GS, GS);
      const blot = (x, z, rx, rz, col, a) => { g.globalAlpha = a; g.fillStyle = col; g.beginPath(); g.ellipse(X(x), Z(z), rx * sx, rz * sz, 0, 0, 7); g.fill(); g.globalAlpha = 1; };
      for (let i = 0; i < 900; i++) blot(x0 + r() * gw, z0 + r() * gh, 2 + r() * 9, 2 + r() * 7, r() < 0.5 ? '#5d6a3e' : '#8d8662', 0.08 + r() * 0.1);
      const dirt = (xa, za, xb, zb, col, a, rough) => {
        g.globalAlpha = a; g.fillStyle = col; g.fillRect(X(xa), Z(za), (xb - xa) * sx, (zb - za) * sz); g.globalAlpha = 1;
        const n = Math.round(((xb - xa) * (zb - za)) / (rough || 14));
        for (let i = 0; i < n; i++) blot(xa + r() * (xb - xa), za + r() * (zb - za), 0.5 + r() * 1.6, 0.4 + r() * 1.2, r() < 0.5 ? '#6b5a44' : '#9a8a6c', 0.12 + r() * 0.2);
      };
      dirt(-10, L.headS - 4, W + 12, L.headN + 4, '#84735a', 0.5, 30);                        // graded working block
      dirt(x0, L.roadZ - 3.6, x1, L.roadZ + 3.6, '#a8997c', 0.95, 60);                         // access road
      dirt(x0, L.roadZ - 0.9, x1, L.roadZ - 0.6, '#8f8168', 0.5, 99); dirt(x0, L.roadZ + 0.6, x1, L.roadZ + 0.9, '#8f8168', 0.5, 99);
      dirt(-8, L.headS - 3, W + 10, L.headS + 3, '#857359', 0.7, 12);                          // headlands
      dirt(-8, L.headN - 3, W + 10, L.headN + 3, '#857359', 0.7, 12);
      for (let i = 0; i < p.numRows; i++) {                                                    // worked aisles
        const ax = L.aisleX(i);
        dirt(ax - 1.25, L.headS, ax + 1.25, L.headN, '#7a6850', 0.62, 7);
        dirt(ax - 0.95, L.headS, ax - 0.5, L.headN, '#5f5140', 0.45, 99); dirt(ax + 0.5, L.headS, ax + 0.95, L.headN, '#5f5140', 0.45, 99);
      }
      dirt(L.staging[0] - 16, L.staging[1] - 3, L.staging[0] + 16, L.staging[1] + 9, '#9c9482', 0.9, 6);   // staging pad
      dirt(L.depot[0] - 9, L.depot[1] - 7, L.depot[0] + 9, L.depot[1] + 4, '#9c9482', 0.9, 6);            // depot pad
      // fade the patch into the far field
      g.globalCompositeOperation = 'destination-out';
      const fade = (a, b, c2, d2) => { const q = g.createLinearGradient(a, b, c2, d2); q.addColorStop(0, 'rgba(0,0,0,1)'); q.addColorStop(1, 'rgba(0,0,0,0)'); return q; };
      const e = GS * 0.06;
      g.fillStyle = fade(0, 0, e, 0); g.fillRect(0, 0, e, GS); g.fillStyle = fade(GS, 0, GS - e, 0); g.fillRect(GS - e, 0, e, GS);
      g.fillStyle = fade(0, 0, 0, e); g.fillRect(0, 0, GS, e); g.fillStyle = fade(0, GS, 0, GS - e); g.fillRect(0, GS - e, GS, e);
      g.globalCompositeOperation = 'source-over';
      const gt = tex(c); gt.anisotropy = 8;
      const patch = new T.Mesh(new T.PlaneGeometry(gw, gh), new T.MeshStandardMaterial({ map: gt, transparent: true, roughness: 1, metalness: 0 }));
      patch.rotation.x = -Math.PI / 2; patch.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      patch.material.depthWrite = false; patch.renderOrder = -1; patch.receiveShadow = true; S.add(patch);

      // a fine tiled layer on top, so the ground still has grain when the camera is close
      const dc = canvas(512, 512), dg = dc.getContext('2d'), dr = rnd(31);
      for (let i = 0; i < 5200; i++) {
        const x = dr() * 512, y = dr() * 512, k = dr();
        dg.fillStyle = k < 0.4 ? 'rgba(40,34,24,0.5)' : k < 0.7 ? 'rgba(214,204,176,0.45)' : 'rgba(70,92,48,0.55)';
        if (k < 0.7) { dg.beginPath(); dg.ellipse(x, y, 0.6 + dr() * 2.2, 0.5 + dr() * 1.4, dr() * 3, 0, 7); dg.fill(); }
        else { dg.fillRect(x, y, 1.2, 3 + dr() * 6); }
      }
      const dt2 = tex(dc, [gw / 7, gh / 7]); dt2.anisotropy = 8;
      const grain = new T.Mesh(new T.PlaneGeometry(gw * 0.9, gh * 0.9), new T.MeshStandardMaterial({ map: dt2, transparent: true, opacity: 0.7, roughness: 1, metalness: 0, depthWrite: false }));
      grain.rotation.x = -Math.PI / 2; grain.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2); grain.renderOrder = -0.5; grain.receiveShadow = true; S.add(grain);

      // racking of the working block: posts, torque tubes, rails
      const postEvery = 7, postsPerRow = Math.floor(p.panelsPerRow / postEvery) + 1;
      const posts = new T.InstancedMesh(new T.BoxGeometry(0.16, H + 0.5, 0.11), M.steel, p.numRows * postsPerRow);
      const caps = new T.InstancedMesh(new T.BoxGeometry(0.26, 0.2, 0.2), M.steel, p.numRows * postsPerRow);
      const tubes = new T.InstancedMesh(new T.CylinderGeometry(0.075, 0.075, RL + 0.3, 14), M.steel, p.numRows);
      const rails = new T.InstancedMesh(new T.BoxGeometry(0.95, 0.045, 0.05), M.steel, p.numRows * (p.panelsPerRow + 1));
      let a = 0, b = 0;
      for (let i = 0; i < p.numRows; i++) {
        const x = i * p.rowPitch;
        for (let k = 0; k < postsPerRow; k++) {
          const z = Math.min(RL - 0.1, k * postEvery * L.slot + 0.02);
          dummy.rotation.set(0, 0, 0); dummy.position.set(x, (H + 0.5) / 2 - 0.5 - 0.1, z); dummy.updateMatrix(); posts.setMatrixAt(a, dummy.matrix);
          dummy.position.set(x, H - 0.02, z); dummy.updateMatrix(); caps.setMatrixAt(a++, dummy.matrix);
        }
        dummy.rotation.set(Math.PI / 2, 0, 0); dummy.position.set(x, H, RL / 2); dummy.updateMatrix(); tubes.setMatrixAt(i, dummy.matrix);
        for (let k = 0; k <= p.panelsPerRow; k++) {
          dummy.rotation.set(0, 0, -TILT); dummy.position.set(x + Math.sin(TILT) * 0.085, H + Math.cos(TILT) * 0.085, k * L.slot - 0.01); dummy.updateMatrix(); rails.setMatrixAt(b++, dummy.matrix);
        }
      }
      for (const m of [posts, caps, tubes]) { m.castShadow = true; S.add(m); }
      rails.castShadow = false; S.add(rails); this.rails = rails;

      // blocks finished on earlier days, drawn as one strip per row
      const strip = new T.BoxGeometry(p.panelLen, 0.03, RL);
      const stripTex = this.stripTexture(p.panelsPerRow);
      const stripMat = [M.alu, M.alu, new T.MeshStandardMaterial({ map: stripTex, roughness: 0.22, metalness: 0.35, envMapIntensity: 0.9 }), M.back, M.alu, M.alu];
      const blocks = [[W + 16, 0], [W + 16, RL + 26], [0, RL + 26], [-W - 16, RL + 26], [2 * W + 32, 0], [2 * W + 32, RL + 26], [0, 2 * RL + 52], [W + 16, 2 * RL + 52]];
      const strips = new T.InstancedMesh(strip, stripMat, blocks.length * p.numRows);
      const tubes2 = new T.InstancedMesh(new T.BoxGeometry(0.15, 0.15, RL), M.steel, blocks.length * p.numRows);
      const posts2 = new T.InstancedMesh(new T.BoxGeometry(0.16, H, 0.11), M.steel, blocks.length * p.numRows * 5);
      let q = 0, q2 = 0;
      for (const bl of blocks) for (let i = 0; i < p.numRows; i++) {
        const x = bl[0] + i * p.rowPitch, z = bl[1] + RL / 2;
        dummy.rotation.set(0, 0, -TILT); dummy.position.set(x + Math.sin(TILT) * 0.13, H + Math.cos(TILT) * 0.13, z); dummy.updateMatrix(); strips.setMatrixAt(q, dummy.matrix);
        dummy.rotation.set(0, 0, 0); dummy.position.set(x, H, z); dummy.updateMatrix(); tubes2.setMatrixAt(q++, dummy.matrix);
        for (let k = 0; k < 5; k++) { dummy.position.set(x, H / 2, bl[1] + (k / 4) * (RL - 0.2) + 0.1); dummy.updateMatrix(); posts2.setMatrixAt(q2++, dummy.matrix); }
      }
      S.add(strips); S.add(tubes2); S.add(posts2);

      // pallets waiting at the staging area and along the row ends
      const crates = [];
      for (let i = 0; i < 12; i++) crates.push([L.staging[0] - 12 + (i % 6) * 4.4, L.staging[1] + 2 + Math.floor(i / 6) * 3.4, 0]);
      for (let i = 1; i < p.numRows; i += 3) crates.push([L.aisleX(i) + 2.6, L.headS - 4.6 + r() * 0.6, (r() - 0.5) * 0.2]);
      const cb = new T.InstancedMesh(new T.BoxGeometry(2.4, 1.25, 1.2), [M.wood, M.wood, M.glass, M.wood, M.wood, M.wood], crates.length);
      crates.forEach((cr, i) => { dummy.rotation.set(0, cr[2], 0); dummy.position.set(cr[0], 0.63, cr[1]); dummy.updateMatrix(); cb.setMatrixAt(i, dummy.matrix); });
      cb.castShadow = true; S.add(cb);

      // charging depot: a container, a canopy and a charger post
      const D = new T.Group(); D.position.set(L.depot[0], 0, L.depot[1]); S.add(D);
      box(6.1, 2.6, 2.44, M.container, -5.5, 1.3, -3.5, D);
      box(7, 0.12, 5, M.steel, 0, 3.3, -1.2, D);
      for (const px of [-3.3, 3.3]) for (const pz of [-3.5, 1.1]) box(0.12, 3.3, 0.12, M.steel, px, 1.65, pz, D);
      box(0.5, 1.5, 0.35, M.white, 2.6, 0.75, -3.2, D); box(0.3, 0.2, 0.05, new T.MeshStandardMaterial({ color: 0x1baf7a, emissive: 0x1baf7a, emissiveIntensity: 1.5 }), 2.6, 1.25, -3.0, D, false);
      for (let i = 0; i < 6; i++) { const cn = cyl(0.03, 0.14, 0.5, M.cone, L.staging[0] - 15 + i * 6, 0.25, L.staging[1] - 2.4, S, 8); cn.castShadow = false; }
    }
    stripTexture(n) {
      // one texture for a whole finished row: the panel picture repeated along the row
      const t = this.tx.panel.clone();
      t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(1, n); t.needsUpdate = true;
      return t;
    }

    // ---------- machines and people ----------
    buildRig(p) {
      const M = this.mat, G = new T.Group();
      const body = new T.Group(); G.add(body);
      // hull
      box(1.62, 0.5, 3.1, M.white, 0, 0.92, 0.1, body);
      box(1.5, 0.22, 2.7, M.white, 0, 1.24, 0.05, body);
      box(1.66, 0.16, 3.14, M.dark, 0, 0.62, 0.1, body);
      box(1.2, 0.3, 0.25, M.dark, 0, 0.8, 1.72, body);                         // front bumper
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 7; i++) box(0.02, 0.1, 0.24, M.dark, sx * 0.815, 1.0, -0.95 + i * 0.36, body, false);   // side vents
        box(0.3, 0.08, 0.04, new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 1.2 }), sx * 0.5, 0.98, 1.66, body, false);
      }
      for (const sx of [-1, 1]) box(0.5, 0.05, 3.5, M.dark, sx * 0.95, 0.97, -0.17, body);       // fenders over the wheels
      box(0.7, 0.16, 0.5, M.mid, 0, 1.43, 1.1, body);                                             // equipment box
      box(1.3, 0.06, 0.02, M.dark, 0, 1.0, 1.66, body, false);
      // rear deck that carries the pallet
      box(1.5, 0.12, 2.0, M.dark, 0, 0.5, -2.4, body);
      for (const sx of [-0.6, 0.6]) box(0.1, 0.1, 2.1, M.mid, sx, 0.62, -2.3, body);
      // wheels
      const wheels = [];
      const wg = new T.CylinderGeometry(0.46, 0.46, 0.4, 20); wg.rotateZ(Math.PI / 2);
      const hg = new T.CylinderGeometry(0.2, 0.2, 0.42, 12); hg.rotateZ(Math.PI / 2);
      for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
        const w = new T.Mesh(wg, M.tire); w.position.set(sx * 0.93, 0.46, 1.25 - i * 0.95); w.castShadow = true; body.add(w);
        w.add(new T.Mesh(hg, M.mid)); wheels.push(w);
      }
      // sensor mast and status light
      box(0.07, 0.9, 0.07, M.dark, 0.6, 1.8, 1.25, body);
      box(0.22, 0.1, 0.12, M.dark, 0.6, 2.28, 1.27, body);
      const beaconMat = new T.MeshStandardMaterial({ color: 0x222222, emissive: 0x1baf7a, emissiveIntensity: 2.4, roughness: 0.3 });
      box(0.06, 0.7, 0.06, M.dark, -0.6, 1.7, 1.25, body);
      const beacon = cyl(0.09, 0.09, 0.2, beaconMat, -0.6, 2.15, 1.25, body, 12); beacon.castShadow = false;
      const glow = new T.Sprite(new T.SpriteMaterial({ map: this.glowTex(), color: 0x1baf7a, transparent: true, opacity: 0.85, depthWrite: false, blending: T.AdditiveBlending }));
      glow.scale.set(0.9, 0.9, 1); glow.position.set(-0.6, 2.15, 1.25); body.add(glow);
      // state ring on the ground
      const ring = new T.Mesh(new T.RingGeometry(3.3, 3.55, 48), new T.MeshBasicMaterial({ color: 0x1baf7a, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.04, -0.8); G.add(ring);
      // floating label
      const lc = canvas(512, 96), label = new T.Sprite(new T.SpriteMaterial({ map: tex(lc), transparent: true, depthTest: false, sizeAttenuation: false, fog: false }));
      label.scale.set(0.3, 0.05625, 1); label.position.set(0, 4.4, -0.6); label.renderOrder = 10; G.add(label);

      // pallet crate, leaning back on the rear deck
      const crate = new T.Group(); crate.position.set(0, 1.0, -2.9); crate.rotation.x = RECLINE; body.add(crate);
      const pal = new T.Group(); crate.add(pal);
      box(2.36, 0.07, 1.22, M.wood, 0, -0.045, 0, pal);
      for (const sx of [-1.05, 0, 1.05]) box(0.14, 0.1, 1.22, M.wood, sx, -0.13, 0, pal);
      box(2.36, 0.5, 0.06, M.wood, 0, 0.2, 0.62, pal);                                           // lower lip the stack rests against
      for (const sx of [-1.21, 1.21]) { box(0.05, 0.14, 1.22, M.wood, sx, 0.25, 0, pal); box(0.05, 0.14, 1.22, M.wood, sx, 0.7, 0, pal); box(0.06, 1.15, 0.1, M.wood, sx, 0.5, -0.5, pal); box(0.06, 1.15, 0.1, M.wood, sx, 0.5, 0.5, pal); }
      const stack = new T.Mesh(new T.BoxGeometry(p.panelLen, 1, p.panelWid), this.stackMats(p.panelsPerPallet));
      stack.castShadow = true; pal.add(stack);
      for (const sx of [-0.55, 0.55]) { const st = box(0.08, 0.08, 1.5, M.mid, sx, 0.75, -2.15, body); st.rotation.x = RECLINE; }

      // arm: turntable, upper arm, forearm, wrist, gripper frame
      const L1 = 1.45, L2 = 1.55, base = new T.Group(); base.position.set(0, 1.35, -0.2); body.add(base);
      cyl(0.34, 0.38, 0.3, M.whiteArm, 0, 0.15, 0, base, 20);
      const turn = new T.Group(); turn.position.y = 0.3; base.add(turn);
      cyl(0.3, 0.33, 0.28, M.whiteArm, 0, 0.14, 0, turn, 20);
      box(0.5, 0.5, 0.46, M.whiteArm, 0, 0.5, 0, turn);
      const shoulder = new T.Group(); shoulder.position.set(0, 0.55, 0); turn.add(shoulder);
      const j2 = cyl(0.24, 0.24, 0.62, M.whiteArm, 0, 0, 0, shoulder, 18); j2.rotation.z = Math.PI / 2;
      box(0.2, 0.26, L1, M.whiteArm, 0.22, 0, L1 / 2, shoulder);
      box(0.12, 0.12, 0.5, M.dark, 0.36, 0.05, 0.4, shoulder, false);                             // cable carrier
      const elbow = new T.Group(); elbow.position.set(0, 0, L1); shoulder.add(elbow);
      const j3 = cyl(0.19, 0.19, 0.6, M.whiteArm, 0, 0, 0, elbow, 18); j3.rotation.z = Math.PI / 2;
      box(0.26, 0.3, 0.5, M.whiteArm, -0.02, 0.02, -0.1, elbow);
      const fore = cyl(0.1, 0.13, L2 - 0.2, M.whiteArm, 0, 0, L2 / 2, elbow, 14); fore.rotation.x = Math.PI / 2;
      const wrist = new T.Group(); wrist.position.set(0, 0, L2); elbow.add(wrist);
      const ws = new T.Mesh(new T.SphereGeometry(0.14, 14, 10), M.whiteArm); ws.castShadow = true; wrist.add(ws);
      cyl(0.09, 0.09, 0.18, M.mid, 0, -0.14, 0, wrist, 12);
      // gripper: wide frame with suction cups, panel centre sits 0.33 below the wrist
      const gr = new T.Group(); gr.position.y = -0.24; wrist.add(gr);
      box(1.7, 0.05, 0.06, M.steel, 0, 0, 0, gr);
      for (const sx of [-0.8, -0.27, 0.27, 0.8]) box(0.05, 0.05, 0.86, M.steel, sx, 0, 0, gr);
      for (const sz of [-0.42, 0.42]) box(1.7, 0.04, 0.04, M.steel, 0, 0, sz, gr);
      for (const sx of [-0.8, -0.27, 0.27, 0.8]) for (const sz of [-0.42, 0.42]) { cyl(0.02, 0.02, 0.07, M.dark, sx, -0.045, sz, gr, 6); const cu = cyl(0.045, 0.07, 0.035, M.cup, sx, -0.085, sz, gr, 10); cu.castShadow = false; }
      box(0.12, 0.1, 0.16, M.dark, 0.5, 0.07, 0.1, gr, false);                                    // camera box
      const held = new T.Mesh(new T.BoxGeometry(p.panelLen, 0.03, p.panelWid), M.panel);
      held.position.y = -0.33; held.castShadow = true; held.visible = false; wrist.add(held);

      this.dyn.add(G);
      return { G, body, wheels, beaconMat, glow, ring, label, lc, labelText: '', crate, pal, stack, base, turn, shoulder, elbow, wrist, held, L1, L2, yaw: 0, hint: 0, last: null };
    }
    stackMats(n) {
      const side = this.mat.stack[0].clone(); side.map = this.tx.stack.clone(); side.map.needsUpdate = true;
      return [side, side, this.mat.glass, this.mat.back, side, side];
    }
    glowTex() {
      if (this._glow) return this._glow;
      const c = canvas(64, 64), g = c.getContext('2d'), q = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      q.addColorStop(0, 'rgba(255,255,255,1)'); q.addColorStop(0.25, 'rgba(255,255,255,0.5)'); q.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = q; g.fillRect(0, 0, 64, 64);
      return (this._glow = tex(c));
    }
    setLabel(rig, text, color) {
      if (rig.labelText === text) return;
      rig.labelText = text;
      const g = rig.lc.getContext('2d');
      g.clearRect(0, 0, 512, 96);
      g.font = '600 40px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      const w = Math.min(500, g.measureText(text).width + 86), x = (512 - w) / 2;
      g.fillStyle = 'rgba(16,18,20,0.82)';
      g.beginPath(); g.roundRect(x, 14, w, 68, 34); g.fill();
      g.fillStyle = color; g.beginPath(); g.arc(x + 36, 48, 13, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, x + 62, 50, 420);
      rig.label.material.map.needsUpdate = true;
    }

    buildPerson() {
      const M = this.mat, G = new T.Group();
      const hip = new T.Group(); hip.position.y = 0.92; G.add(hip);
      const legs = [], arms = [];
      for (const sx of [-1, 1]) {
        const leg = new T.Group(); leg.position.set(sx * 0.1, 0, 0); hip.add(leg);
        cyl(0.075, 0.065, 0.82, M.jeans, 0, -0.41, 0, leg, 8); box(0.11, 0.1, 0.26, M.boot, 0, -0.87, 0.05, leg);
        legs.push(leg);
      }
      const torso = cyl(0.19, 0.16, 0.6, M.vest, 0, 0.32, 0, hip, 10); torso.scale.z = 0.7;
      for (const y of [0.2, 0.42]) { const s = cyl(0.196, 0.185, 0.045, M.stripe, 0, y, 0, hip, 10); s.scale.z = 0.71; s.castShadow = false; }
      for (const sx of [-1, 1]) {
        const arm = new T.Group(); arm.position.set(sx * 0.25, 0.56, 0); hip.add(arm);
        cyl(0.05, 0.045, 0.6, M.vest, 0, -0.3, 0, arm, 8); const h = new T.Mesh(new T.SphereGeometry(0.05, 8, 6), M.skin); h.position.y = -0.62; arm.add(h);
        arms.push(arm);
      }
      const head = new T.Mesh(new T.SphereGeometry(0.115, 12, 10), M.skin); head.position.y = 0.78; head.castShadow = true; hip.add(head);
      const hat = new T.Mesh(new T.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.hat); hat.position.y = 0.81; hat.castShadow = true; hip.add(hat);
      const brim = cyl(0.16, 0.16, 0.015, M.hat, 0, 0.815, 0.04, hip, 12); brim.castShadow = false;
      this.dyn.add(G);
      return { G, legs, arms, x: 0, z: 0, yaw: 0, phase: 0, init: false };
    }
    posePerson(P, tx, tz, faceYaw, working, simDt) {
      if (!P.init) { P.x = tx; P.z = tz; P.init = true; }
      const dx = tx - P.x, dz = tz - P.z, d = Math.hypot(dx, dz);
      const step = Math.min(d, 1.5 * Math.max(0.02, simDt));
      let walking = false;
      if (d > 0.05) { if (d > 60) { P.x = tx; P.z = tz; } else { P.x += (dx / d) * step; P.z += (dz / d) * step; P.yaw = Math.atan2(dx, dz); walking = d > 0.25; P.phase += Math.min(0.6, step * 3.2); } }
      if (!walking && faceYaw != null) P.yaw = faceYaw;
      P.G.position.set(P.x, 0, P.z); P.G.rotation.y = P.yaw;
      const s = walking ? Math.sin(P.phase) * 0.55 : 0;
      P.legs[0].rotation.x = s; P.legs[1].rotation.x = -s;
      if (working && !walking) { const w = Math.sin(performance.now() / 160) * 0.12; P.arms[0].rotation.x = -2.2 + w; P.arms[1].rotation.x = -2.0 - w; }
      else { P.arms[0].rotation.x = -s * 0.8; P.arms[1].rotation.x = s * 0.8; }
    }

    buildFork() {
      const M = this.mat, G = new T.Group();
      box(1.5, 0.7, 2.6, M.yellow, 0, 0.95, 0, G);
      box(1.1, 0.9, 1.0, M.cab, 0, 1.75, -0.3, G); box(1.16, 0.06, 1.06, M.yellow, 0, 2.23, -0.3, G);
      for (const sx of [-0.52, 0.52]) for (const sz of [-0.78, 0.18]) box(0.06, 0.9, 0.06, M.dark, sx, 1.75, sz, G, false);
      box(1.3, 0.5, 0.6, M.dark, 0, 0.9, -1.45, G);
      const wg = new T.CylinderGeometry(0.5, 0.5, 0.36, 18); wg.rotateZ(Math.PI / 2);
      const wheels = [];
      for (const sx of [-0.85, 0.85]) for (const sz of [-0.85, 0.9]) { const w = new T.Mesh(wg, M.tire); w.position.set(sx, 0.5, sz); w.castShadow = true; G.add(w); wheels.push(w); }
      for (const sx of [-0.4, 0.4]) box(0.1, 2.3, 0.12, M.dark, sx, 1.4, 1.42, G);
      const car = new T.Group(); car.position.set(0, 0.5, 1.5); G.add(car);
      box(1.0, 0.5, 0.06, M.dark, 0, 0.25, 0, car);
      for (const sx of [-0.35, 0.35]) box(0.1, 0.05, 1.2, M.dark, sx, 0, 0.6, car);
      const load = new T.Group(); load.position.set(0, 0.1, 0.72); car.add(load);
      box(2.36, 0.14, 1.2, M.wood, 0, 0.07, 0, load);
      const st = new T.Mesh(new T.BoxGeometry(2.278, 1, 1.134), this.stackMats(31)); st.castShadow = true; load.add(st);
      const beaconMat = new T.MeshStandardMaterial({ color: 0x222222, emissive: 0xff9a1a, emissiveIntensity: 2 });
      cyl(0.07, 0.07, 0.12, beaconMat, 0.4, 2.32, -0.6, G, 10);
      this.dyn.add(G);
      return { G, wheels, car, load, st, hint: 0, yaw: 0, dist: 0 };
    }

    // ---------- a new day ----------
    setDay(day) {
      this.day = day;
      const p = day.p, L = day.L;
      this.buildSite(day);
      // machines are rebuilt each time because panel size or pallet count may have changed
      while (this.dyn.children.length) this.dyn.remove(this.dyn.children[0]);
      if (this.panelMeshes) for (const m of this.panelMeshes) { this.scene.remove(m); m.dispose(); }
      if (this.stagedMesh) { this.scene.remove(this.stagedMesh); }
      this.rigs = []; this.forks = []; this.people = []; this.panelMeshes = [];
      const dummy = new T.Object3D(), geo = new T.BoxGeometry(p.panelLen, 0.03, p.panelWid);
      const off = 0.075 + 0.045 + 0.02;
      this.panelOff = off;
      day.robots.forEach((R, ri) => {
        const rig = this.buildRig(p);
        // per segment: pallet count at its start, release time of each placed panel, distance driven so far
        let n = p.panelsPerPallet, dist = 0;
        const rel = [];
        for (const s of R.segs) {
          s.n0 = n; s.d0 = dist;
          if (s.s === 'place') { n--; rel.push(s.t0 + 0.86 * (s.t1 - s.t0)); }
          else if (s.s === 'fault' && s.kind === 'damaged panel') n--;
          else if (s.s === 'reload' && s.kind !== 'waiting for the forklift') n = p.panelsPerPallet;
          if (s.path) dist += root.SolarSim.pathLen(s.path);
        }
        rig.rel = rel; rig.R = R;
        const mesh = new T.InstancedMesh(geo, this.mat.panel, Math.max(1, R.places.length));
        R.places.forEach((q, i) => {
          const c = L.panel(q.row, q.idx);
          dummy.rotation.set(0, 0, -TILT); dummy.position.set(c[0] + Math.sin(TILT) * off, p.axisHeight + Math.cos(TILT) * off, c[1]); dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
        this.scene.add(mesh); this.panelMeshes.push(mesh); rig.mesh = mesh;
        this.rigs.push(rig);
        this.people.push({ op: this.buildPerson(), fa: this.buildPerson(), fh: 0 });
      });
      day.forklifts.forEach(() => this.forks.push(this.buildFork()));
      // pallets set down beside the row ahead of time (only in the staged pallet scenario)
      const staged = []; day.robots.forEach((R) => R.staged.forEach((s) => staged.push(s)));
      this.staged = staged;
      this.stagedMesh = new T.InstancedMesh(new T.BoxGeometry(2.4, 1.25, 1.2), [this.mat.wood, this.mat.wood, this.mat.glass, this.mat.wood, this.mat.wood, this.mat.wood], Math.max(1, staged.length));
      this.stagedMesh.castShadow = true; this.stagedMesh.count = 0; this.stagedMesh.frustumCulled = false; this.scene.add(this.stagedMesh);
      if (this.focus >= this.rigs.length) this.focus = 0;
      this.lastT = null;
      this.setView(this.view.name, true);
    }

    // ---------- posing everything for time t ----------
    setTime(t, simDt) {
      const day = this.day; if (!day) return;
      this.t = t;
      const p = day.p, L = day.L;
      const dt = simDt == null ? 0.05 : Math.abs(simDt);
      const blink = Math.floor(performance.now() / 350) % 2;
      const jumped = this.lastT == null || Math.abs(t - this.lastT) > Math.max(20, dt * 4);
      this.lastT = t;
      if (jumped) for (const pp of this.people) { pp.op.init = false; pp.fa.init = false; }
      let wx = null;

      this.rigs.forEach((rig, ri) => {
        const R = rig.R, i = rig.hint = findSeg(R.segs, t, rig.hint), s = R.segs[i];
        const f = s.t1 > s.t0 ? clamp01((t - s.t0) / (s.t1 - s.t0)) : 0;
        let x = s.x, z = s.z, yaw = s.d > 0 ? 0 : Math.PI, dist = s.d0;
        if (s.path) {
          const a = alongPath(s.path, s.kind === 'moving forward' ? ease(f) : f);
          x = a.x; z = a.z; dist += a.dist;
          if (a.yaw != null && s.kind !== 'moving forward') yaw = a.yaw;
          if (s.kind === 'to the next row' && f > 0.93) yaw = s.d > 0 ? Math.PI : 0;
        } else if (s.kind === 'second try at the stop') { z += Math.sin(f * Math.PI * 2) * 0.7 * s.d; dist += Math.abs(Math.sin(f * Math.PI * 2)) * 0.7; }
        rig.G.position.set(x, 0, z); rig.G.rotation.y = yaw; rig.x = x; rig.z = z; rig.yawNow = yaw; rig.seg = s;
        for (const w of rig.wheels) w.rotation.x = dist / 0.46;

        // state look: status light, ground ring, label
        const col = new T.Color(STATE_COLOR[s.s]);
        const flash = (s.s === 'fault' || (s.s === 'reload' && s.bad)) && blink;
        rig.beaconMat.emissive.copy(col); rig.beaconMat.emissiveIntensity = flash ? 0.3 : 2.6;
        rig.glow.material.color.copy(col); rig.glow.material.opacity = flash ? 0.15 : 0.85;
        rig.ring.material.color.copy(col); rig.ring.material.opacity = s.s === 'place' ? 0.35 : flash ? 0.25 : 0.7;
        const name = root.SolarSim.STATE_LABEL[s.s];
        this.setLabel(rig, (day.robots.length > 1 ? 'Robot ' + (ri + 1) + ': ' : '') + name + (s.kind && s.s !== 'place' && s.s !== 'crew' ? ' (' + s.kind + ')' : ''), STATE_COLOR[s.s]);
        if (s.s === 'weather') wx = s.kind;

        // pallet stack
        let n = s.n0, held = false, target = null;
        const side = s.d > 0 ? -1 : 1;                         // which side of the rover the row is on
        if (s.s === 'place') {
          if (f >= 0.3) n = s.n0 - 1;
          held = f >= 0.3 && f < 0.86;
        }
        let crateVis = true;
        if (s.s === 'reload' && s.kind !== 'waiting for the forklift') { crateVis = f > 0.55 || f < 0.3; n = f > 0.55 ? p.panelsPerPallet : 0; }
        rig.pal.visible = crateVis; rig.swapF = s.s === 'reload' && s.kind !== 'waiting for the forklift' ? f : -1;
        rig.stack.visible = n > 0;
        if (n > 0) { rig.stack.scale.y = n * PT; rig.stack.position.y = (n * PT) / 2; rig.stack.material[0].map.repeat.y = n; }
        rig.held.visible = held;

        // arm
        const home = { pos: new T.Vector3(side * 0.75, 3.0, -0.75), q: new T.Quaternion().setFromEuler(new T.Euler(0.25, 0, 0)) };
        let pose = home;
        if (s.s === 'place') {
          const nrm = new T.Vector3(0, Math.cos(RECLINE), Math.sin(RECLINE));
          const pickC = new T.Vector3(0, 1.0, -2.9).addScaledVector(nrm, (s.n0 - 0.5) * PT);
          const qPick = new T.Quaternion().setFromEuler(new T.Euler(RECLINE, 0, 0));
          const pick = { pos: pickC, q: qPick }, pickUp = { pos: pickC.clone().addScaledVector(nrm, 0.55), q: qPick };
          const c = L.panel(s.row, s.idx);
          const wl = new T.Vector3(c[0] + Math.sin(TILT) * this.panelOff, p.axisHeight + Math.cos(TILT) * this.panelOff, c[1]);
          rig.G.updateMatrixWorld(); const local = rig.G.worldToLocal(wl.clone());
          const qPlace = new T.Quaternion().setFromEuler(new T.Euler(0, 0, side * TILT));
          const pn = new T.Vector3(0, 1, 0).applyQuaternion(qPlace);
          const place = { pos: local, q: qPlace }, placeUp = { pos: local.clone().addScaledVector(pn, 0.5), q: qPlace };
          const high = { pos: new T.Vector3(side * 1.25, 3.25, -1.0), q: new T.Quaternion().setFromEuler(new T.Euler(0.3, 0, side * 0.1)) };
          const keys = [[0, home], [0.2, pickUp], [0.3, pick], [0.4, pickUp], [0.55, high], [0.74, placeUp], [0.86, place], [0.92, placeUp], [1, home]];
          for (let k = 1; k < keys.length; k++) if (f <= keys[k][0] || k === keys.length - 1) { pose = this.mix(keys[k - 1][1], keys[k][1], ease((f - keys[k - 1][0]) / (keys[k][0] - keys[k - 1][0])), rig); break; }
        } else if (s.s === 'fault' && s.kind !== 'damaged panel') {
          pose = { pos: new T.Vector3(side * 1.9, 2.75, 0.3), q: new T.Quaternion().setFromEuler(new T.Euler(0, 0, side * TILT)) };
        } else if (s.s === 'travel' && s.kind !== 'moving forward' && s.kind !== 'second try at the stop') {
          pose = { pos: new T.Vector3(0, 2.55, 0.9), q: new T.Quaternion() };
        }
        this.solveArm(rig, pose);

        rig.mesh.count = this.countBefore(rig.rel, t);

        // people
        const pp = this.people[ri];
        const atDepot = s.kind === 'briefing and checks' || s.kind === 'wrap up' || s.s === 'charge';
        const resting = s.s === 'break' || s.s === 'weather';
        const fw = Math.sin(yaw), fz = Math.cos(yaw);
        const sideW = -side;                                              // operator walks on the open side
        let ox = x + fz * sideW * 1.9 + fw * 0.6, oz = z - fw * sideW * 1.9 + fz * 0.6;
        if (resting) { ox = x + fz * sideW * 2.4 + fw * 3.4; oz = z - fw * sideW * 2.4 + fz * 3.4; }
        if (atDepot) { ox = L.depot[0] + 1.5; oz = L.depot[1] + 2.5; }
        this.posePerson(pp.op, ox, oz, Math.atan2(x - ox, z - oz), false, dt);
        let fxp = ox + 0.9, fzp = oz + 0.5, fy = Math.atan2(x - fxp, z - fzp), working = false;
        if (R.fastens.length && !atDepot && !resting) {
          pp.fh = findSeg(R.fastens, t, pp.fh);
          const fa = R.fastens[pp.fh];
          if (t >= R.fastens[0].t0 - 30) {
            const c = L.panel(fa.row, fa.idx);
            fxp = c[0] + 1.32; fzp = c[1]; fy = -Math.PI / 2; working = t >= fa.t0 && t < fa.t1;
          }
        } else if (atDepot) { fxp = L.depot[0] - 0.2; fzp = L.depot[1] + 2.9; }
        this.posePerson(pp.fa, fxp, fzp, fy, working, dt);
      });

      // forklifts
      this.forks.forEach((F, fi) => {
        const segs = day.forklifts[fi].segs;
        let x = L.staging[0] + 4 + fi * 4, z = L.staging[1] - 1, yaw = Math.PI / 2, loaded = false, lift = 0;
        if (segs.length) {
          const i = F.hint = findSeg(segs, t, F.hint), s = segs[i];
          if (t >= s.t0 && t < s.t1) {
            const f = clamp01((t - s.t0) / Math.max(1e-6, s.t1 - s.t0));
            if (s.s === 'load') { loaded = f > 0.5; lift = f > 0.5 ? 0.4 : 0; }
            else if (s.path) {
              const a = alongPath(s.path, f); x = a.x; z = a.z; if (a.yaw != null) yaw = a.yaw; F.dist = a.dist;
              loaded = s.s === 'out'; lift = 0.4;
            } else {
              x = s.x; z = s.z; yaw = s.d > 0 ? 0 : Math.PI;
              const rig = this.rigs[s.r];
              if (s.s === 'swap' && rig) {
                // stand behind the rover and hand the pallet over
                const rz = rig.z - Math.cos(rig.yawNow) * 5.9, rx = rig.x - Math.sin(rig.yawNow) * 5.9;
                x = rx; z = rz; yaw = rig.yawNow;
                const sf = rig.swapF;
                loaded = sf < 0.55; lift = sf >= 0.3 && sf < 0.55 ? 0.9 : 0.4;
              } else if (s.s === 'drop') { loaded = f < 0.5; lift = 0.2; }
            }
          }
        }
        F.G.position.set(x, 0, z); F.G.rotation.y = yaw;
        F.load.visible = loaded; F.car.position.y = 0.3 + lift;
        if (loaded) { F.st.scale.y = 31 * PT; F.st.position.y = 0.14 + (31 * PT) / 2; F.st.material[0].map.repeat.y = 31; }
        for (const w of F.wheels) w.rotation.x = F.dist / 0.5;
      });

      // staged pallets
      if (this.staged.length) {
        const d = new T.Object3D(); let k = 0;
        for (const s of this.staged) if (t >= s.t0 && t < s.t1) { d.position.set(s.x + 4.2, 0.63, s.z); d.rotation.set(0, Math.PI / 2, 0); d.updateMatrix(); this.stagedMesh.setMatrixAt(k++, d.matrix); }
        this.stagedMesh.count = k; this.stagedMesh.instanceMatrix.needsUpdate = true;
      }
      this.setWeather(wx);
    }
    countBefore(arr, t) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) lo = m + 1; else hi = m; } return lo; }

    // Blend two gripper poses. Positions move around the arm's turntable rather
    // than straight through it, which is how a real arm swings.
    mix(a, b, f, rig) {
      const bx = rig.base.position.x, bz = rig.base.position.z;
      const pa = a.pos, pb = b.pos;
      const ra = Math.hypot(pa.x - bx, pa.z - bz), rb = Math.hypot(pb.x - bx, pb.z - bz);
      let ta = Math.atan2(pa.x - bx, pa.z - bz), tb = Math.atan2(pb.x - bx, pb.z - bz);
      if (ra < 0.25) ta = tb; if (rb < 0.25) tb = ta;
      let d = tb - ta; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const th = ta + d * f, r = lerp(ra, rb, f);
      return { pos: new T.Vector3(bx + Math.sin(th) * r, lerp(pa.y, pb.y, f), bz + Math.cos(th) * r), q: a.q.clone().slerp(b.q, f) };
    }
    // Given where the panel centre should be and how it is tilted (in rover
    // coordinates), turn the joints so the gripper is there.
    solveArm(rig, pose) {
      const up = new T.Vector3(0, 1, 0).applyQuaternion(pose.q);
      const w = pose.pos.clone().addScaledVector(up, 0.33);
      const bx = rig.base.position.x, by = rig.base.position.y + 0.85, bz = rig.base.position.z;
      const dx = w.x - bx, dz = w.z - bz, h = w.y - by;
      const yaw = Math.atan2(dx, dz), r = Math.hypot(dx, dz);
      const L1 = rig.L1, L2 = rig.L2;
      const d = Math.max(Math.abs(L1 - L2) + 0.05, Math.min(L1 + L2 - 0.02, Math.hypot(r, h)));
      const el = Math.atan2(h, r) + Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
      const inner = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
      const bend = Math.PI - inner;
      rig.turn.rotation.y = yaw; rig.shoulder.rotation.x = -el; rig.elbow.rotation.x = bend;
      const parent = new T.Quaternion().setFromEuler(new T.Euler(bend - el, yaw, 0, 'YXZ'));
      rig.wrist.quaternion.copy(parent.invert().multiply(pose.q));
    }

    setWeather(kind) {
      const fx = this.fx;
      const on = !!kind;
      fx.amt = lerp(fx.amt, on ? 1 : 0, 0.08);
      if (kind) fx.kind = kind;
      const k = fx.kind, a = fx.amt;
      this.hemi.intensity = 1.15 * (1 - (k === 'rain' ? 0.38 : k === 'wind' ? 0.15 : -0.12) * a);
      this.sun.intensity = 1.55 * (1 - (k === 'rain' ? 0.75 : k === 'wind' ? 0.3 : -0.5) * a);
      this.sun.color.setHex(k === 'heat' && a > 0.05 ? 0xffe2b0 : 0xfff6ea);
      this.scene.fog.near = lerp(420, k === 'heat' ? 300 : 60, a); this.scene.fog.far = lerp(2600, k === 'rain' ? 700 : k === 'wind' ? 1100 : 1900, a);
      this.scene.fog.color.setHex(k === 'wind' && a > 0.3 ? 0xcabfa6 : 0xcfd4d3);
      const show = a > 0.05 && (k === 'rain' || k === 'wind');
      fx.pts.visible = show;
      if (show) {
        const pos = fx.pts.geometry.attributes.position, n = pos.count, tg = this.view.target;
        const vy = k === 'rain' ? -0.55 : -0.02, vx = k === 'rain' ? 0.08 : 0.9;
        for (let i = 0; i < n; i++) {
          let x = pos.getX(i) + vx, y = pos.getY(i) + vy;
          if (y < 0) y += 24; if (x > 30) x -= 60;
          pos.setX(i, x); pos.setY(i, y);
        }
        pos.needsUpdate = true;
        fx.pts.position.set(tg.x, 0, tg.z);
        fx.pts.material.color.setHex(k === 'rain' ? 0xdfe8f0 : 0xb9a988); fx.pts.material.size = k === 'rain' ? 0.08 : 0.14; fx.pts.material.opacity = 0.7 * a;
      }
    }

    // ---------- camera ----------
    setView(name, snap) {
      const v = this.view, day = this.day; v.name = name; v.pan.set(0, 0, 0);
      if (name === 'drone' && day) {
        const W = (day.p.numRows - 1) * day.p.rowPitch;
        this.goal = { theta: 2.45, phi: 0.98, radius: Math.max(W, day.L.rowLen) * (this.aspect < 1 ? 1.5 : 0.85) };
      } else if (name === 'arm') this.goal = { theta: 2.05, phi: 1.2, radius: this.aspect < 1 ? 11 : 8.5 };
      else this.goal = { theta: 2.3, phi: 1.13, radius: this.aspect < 1 ? 22 : 16 };
      if (snap) { v.theta = this.goal.theta; v.phi = this.goal.phi; v.radius = this.goal.radius; this.snapTarget = true; }
      this.blend = 0;
    }
    setFocus(i) { this.focus = Math.max(0, Math.min(this.rigs.length - 1, i)); this.snapTarget = false; }
    updateCamera() {
      const v = this.view, day = this.day; if (!day) return;
      if (this.blend < 1) {
        this.blend = Math.min(1, this.blend + 0.035);
        const k = 0.09;
        v.theta = lerp(v.theta, this.goal.theta, k); v.phi = lerp(v.phi, this.goal.phi, k); v.radius = lerp(v.radius, this.goal.radius, k);
      }
      const rig = this.rigs[this.focus], want = new T.Vector3();
      if (v.name === 'drone') { const W = (day.p.numRows - 1) * day.p.rowPitch; want.set(W / 2 - 10, 0, day.L.rowLen / 2 - 12); }
      else if (rig) want.set(rig.x - Math.sin(rig.yawNow) * 0.9, v.name === 'arm' ? 2.1 : 1.4, rig.z - Math.cos(rig.yawNow) * 0.9);
      if (this.snapTarget || v.target.distanceTo(want) > 400) { v.target.copy(want); this.snapTarget = false; }
      else v.target.lerp(want, v.name === 'drone' ? 0.08 : 0.2);
      const tg = v.target.clone().add(v.pan);
      const sp = Math.sin(v.phi);
      this.camera.position.set(tg.x + v.radius * sp * Math.sin(v.theta), Math.max(0.6, tg.y + v.radius * Math.cos(v.phi)), tg.z + v.radius * sp * Math.cos(v.theta));
      this.camera.lookAt(tg);
      // the shadow box follows whatever is being watched
      const st = rig ? new T.Vector3(rig.x, 0, rig.z) : tg;
      this.sun.target.position.copy(st); this.sun.position.set(st.x + 45, 80, st.z - 38);
      this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
      // far from the camera the small parts are dropped first
      if (this.rails) this.rails.visible = v.radius < 170;
    }

    bindInput() {
      const el = this.renderer.domElement, v = this.view, ptr = new Map();
      el.style.touchAction = 'pan-y'; el.style.cursor = 'grab';
      let pinch = 0;
      el.addEventListener('pointerdown', (e) => { ptr.set(e.pointerId, [e.clientX, e.clientY]); try { el.setPointerCapture(e.pointerId); } catch (_) {} this.wheelZoom = true; el.style.cursor = 'grabbing'; this.blend = 1; pinch = 0; });
      const up = (e) => { ptr.delete(e.pointerId); el.style.cursor = 'grab'; pinch = 0; };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      el.addEventListener('pointermove', (e) => {
        const q = ptr.get(e.pointerId); if (!q) return;
        const dx = e.clientX - q[0], dy = e.clientY - q[1]; q[0] = e.clientX; q[1] = e.clientY;
        if (ptr.size === 1) {
          if (e.shiftKey || e.buttons === 2) {
            const s = v.radius * 0.0016, c = Math.cos(v.theta), sn = Math.sin(v.theta);
            v.pan.x -= (dx * c + dy * sn) * s; v.pan.z -= (-dx * sn + dy * c) * s;
          } else {
            v.theta -= dx * 0.006;
            if (e.pointerType !== 'touch' || this.expanded) v.phi = Math.max(0.12, Math.min(1.5, v.phi - dy * 0.005));
          }
        } else if (ptr.size === 2) {
          const a = [...ptr.values()], d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]);
          if (pinch) v.radius = Math.max(3.5, Math.min(900, v.radius * (pinch / d)));
          pinch = d;
          v.phi = Math.max(0.12, Math.min(1.5, v.phi - dy * 0.0025));
        }
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      document.addEventListener('pointerdown', (e) => { if (!this.host.contains(e.target)) this.wheelZoom = false; });
      el.addEventListener('wheel', (e) => {
        if (!(this.expanded || e.ctrlKey || e.shiftKey || this.wheelZoom)) return;   // let the page scroll
        e.preventDefault(); this.blend = 1;
        v.radius = Math.max(3.5, Math.min(900, v.radius * Math.exp(e.deltaY * 0.0012)));
      }, { passive: false });
    }
    setExpanded(on) { this.expanded = on; this.renderer.domElement.style.touchAction = on ? 'none' : 'pan-y'; }

    resize() {
      const w = this.host.clientWidth || 800, h = this.host.clientHeight || 450;
      this.aspect = w / h;
      this.renderer.setSize(w, h, false);
      this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
      this.camera.aspect = w / h; this.camera.fov = w / h < 1 ? 52 : 42; this.camera.updateProjectionMatrix();
    }
    render(ms) {
      this.updateCamera();
      this.renderer.render(this.scene, this.camera);
      // If the device is struggling, give up sharpness first, then shadows. Features stay.
      if (ms) {
        this.frameMs = this.frameMs * 0.95 + ms * 0.05;
        if (this.frameMs > 30) this.slowFrames++; else this.slowFrames = Math.max(0, this.slowFrames - 2);
        if (this.slowFrames > 90) {
          this.slowFrames = 0; this.frameMs = 16;
          if (this.pr > 1) { this.pr = Math.max(1, this.pr - 0.5); this.renderer.setPixelRatio(this.pr); this.resize(); }
          else if (this.renderer.shadowMap.enabled) { this.renderer.shadowMap.enabled = false; this.sun.castShadow = false; this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { if (m) m.needsUpdate = true; }); }); }
        }
      }
    }
  }

  root.SolarScene = SolarScene;
  root.SolarScene.STATE_COLOR = STATE_COLOR;
  root.SolarScene.findSeg = findSeg;
})(typeof self !== 'undefined' ? self : this);
