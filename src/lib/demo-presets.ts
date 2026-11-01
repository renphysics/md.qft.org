import { gaussianState, blochState, schwarzschildPotential, schwarzschildPeak, interferenceState } from './demo-physics';
import { demoSettingFields, normalizeDemoSettings, type DemoSettings } from './demo-settings';

export type DemoPresetId = 'wave-packet' | 'bloch-sphere' | 'effective-potential' | 'interference';
export interface DemoPreset {
  readonly id: DemoPresetId;
  readonly title: string;
  readonly description: string;
  /** A complete, offline HTML document. Every script stays inside the demo sandbox. */
  readonly html: string;
  /** Trusted static illustration used before running, and as a print fallback. */
  readonly poster: string;
}

const demoCss = [
  '*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}',
  'body{background:#fbfaf7;color:#302c2d;font:14px/1.4 system-ui,-apple-system,sans-serif}',
  '.demo{display:grid;grid-template-rows:minmax(90px,1fr) auto auto;gap:9px;height:100%;padding:12px 18px}',
  '.plot{position:relative;min-height:0;border:1px solid #e8e3db;border-radius:8px;background:#fffefa;overflow:hidden}',
  'canvas{display:block;width:100%;height:100%;touch-action:none;outline:none}canvas:focus-visible{box-shadow:inset 0 0 0 3px #7b3c49}',
  '.controls{display:flex;align-items:end;gap:16px;flex-wrap:wrap}',
  '.control{display:flex;flex:1;min-width:110px;flex-direction:column;gap:5px;font-size:12px;color:#625a56}',
  '.control>span{display:flex;gap:8px;justify-content:space-between;align-items:baseline}',
  'output{font-variant-numeric:tabular-nums;font-weight:650;color:#4f3940;white-space:nowrap}',
  'input[type=range]{margin:0;width:100%;height:23px;accent-color:#7b3c49;cursor:pointer}',
  'select,button{font:inherit;color:inherit;border:1px solid #d9d0c7;border-radius:6px;background:#fffefa;min-height:31px;padding:4px 10px}',
  'select{max-width:100%;width:100%;font-size:12px}button{cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap}',
  'button.primary{background:#7b3c49;border-color:#7b3c49;color:white;min-width:62px}',
  'button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #7b3c49;outline-offset:2px}',
  '.actions{display:flex;align-items:center;gap:6px;padding-bottom:1px}',
  '.note{margin:0;font-size:11px;line-height:1.4;color:#716a64;display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 16px}',
  '.note strong{font-weight:600;color:#4c4243}.mono{font-variant-numeric:tabular-nums}',
  '@media(max-width:600px){.demo{padding:8px;gap:6px}.controls{gap:7px 12px}.control{min-width:100px;font-size:11px}.note{font-size:10px}.actions{margin-left:auto}select,button{min-height:29px}.plot{border-radius:5px}}',
].join('\n');

function range(id: string, label: string, min: number, max: number, step: number, value: number): string {
  return '<label class="control" for="' + id + '"><span>' + label + '<output id="' + id + '-value" for="' + id + '"></output></span><input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"></label>';
}

function demoDocument(title: string, controls: string, note: string, script: string, canvasLabel: string): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
    + title + '</title><style>' + demoCss + '</style></head><body><main class="demo"><div class="plot"><canvas id="plot" role="img" aria-label="'
    + canvasLabel + '" tabindex="0">' + canvasLabel + '</canvas></div><div class="controls">' + controls
    + '</div><p class="note">' + note + '</p></main><script>' + script.replace(/<\/script/gi, '<\\/script') + '</script></body></html>';
}

/** Serialized into each standalone demo; no closure dependencies may be added. */
function createPlotUi() {
  const canvas = document.getElementById('plot') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const colors = { ink: '#3c3535', muted: '#83796f', grid: '#ebe6dd', red: '#8b4053', teal: '#347e83', gold: '#b18b46', fill: '#8b405319' };
  let width = 1000, height = 240;
  let draw = () => {};
  function resize() {
    width = Math.max(120, canvas.clientWidth);
    height = Math.max(60, canvas.clientHeight);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); draw();
  }
  function text(value: string, x: number, y: number, color = colors.muted, align: CanvasTextAlign = 'left', size = 12) {
    ctx.fillStyle = color; ctx.font = size + 'px system-ui,sans-serif'; ctx.textAlign = align;
    ctx.textBaseline = 'middle'; ctx.fillText(value, x, y);
  }
  function number(n: number): string {
    if (Math.abs(n) < 1e-8) return '0';
    if (Math.abs(n) >= 10) return n.toFixed(0);
    return n.toFixed(Math.abs(n) < 0.1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '');
  }
  function axes(xmin: number, xmax: number, ymin: number, ymax: number, xlabel: string, ylabel: string, area?: { left: number; right: number; top: number; bottom: number }) {
    const a = area ?? { left: width < 500 ? 43 : 55, right: width - 20, top: 30, bottom: height - 31 };
    const X = (x: number) => a.left + (x - xmin) / (xmax - xmin) * (a.right - a.left);
    const Y = (y: number) => a.bottom - (y - ymin) / (ymax - ymin) * (a.bottom - a.top);
    ctx.lineWidth = 1; ctx.strokeStyle = colors.grid; ctx.setLineDash([]);
    for (let n = 0; n <= 4; n++) {
      const x = xmin + n * (xmax - xmin) / 4, y = ymin + n * (ymax - ymin) / 4;
      ctx.beginPath(); ctx.moveTo(X(x), a.top); ctx.lineTo(X(x), a.bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a.left, Y(y)); ctx.lineTo(a.right, Y(y)); ctx.stroke();
      text(number(x), X(x), a.bottom + 14, colors.muted, 'center', 10);
      text(number(y), a.left - 8, Y(y), colors.muted, 'right', 10);
    }
    text(xlabel, a.right, height - 9, colors.muted, 'right', 11);
    text(ylabel, a.left, 13, colors.ink, 'left', 12);
    return { ...a, X, Y, xmin, xmax, ymin, ymax };
  }
  function curve(a: ReturnType<typeof axes>, fn: (x: number) => number, color = colors.red, dashed = false, fill = false) {
    ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip(); ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 700; i++) {
      const x = a.xmin + (a.xmax - a.xmin) * i / 700, y = fn(x);
      if (!Number.isFinite(y)) { started = false; continue; }
      if (!started) { ctx.moveTo(a.X(x), a.Y(y)); started = true; } else ctx.lineTo(a.X(x), a.Y(y));
    }
    ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.setLineDash(dashed ? [5, 4] : []); ctx.stroke();
    if (fill) {
      ctx.lineTo(a.right, a.Y(0)); ctx.lineTo(a.left, a.Y(0)); ctx.closePath(); ctx.fillStyle = colors.fill; ctx.fill();
    }
    ctx.restore();
  }
  function bind(id: string, callback: () => void, format: (n: number) => string = n => n.toFixed(2)) {
    const input = document.getElementById(id) as HTMLInputElement;
    const output = document.getElementById(id + '-value');
    function update() { if (output) output.textContent = format(Number(input.value)); }
    input.addEventListener('input', () => { update(); callback(); }); update();
    return { input, value: () => Number(input.value), set(value: number) { input.value = String(value); update(); } };
  }
  new ResizeObserver(resize).observe(canvas);
  return {
    canvas, ctx, colors, text, axes, curve, number, bind,
    get width() { return width; }, get height() { return height; },
    clear() { ctx.clearRect(0, 0, width, height); },
    setDraw(fn: () => void) { draw = fn; resize(); },
  };
}
type PlotUi = ReturnType<typeof createPlotUi>;

function wavePacketDemo(ui: PlotUi, physics: typeof gaussianState) {
  const { ctx, colors } = ui;
  let running = false, frame = 0, previous = 0;
  const play = document.getElementById('play') as HTMLButtonElement;
  const view = document.getElementById('view') as HTMLSelectElement;
  const sigma = ui.bind('sigma', render, n => n.toFixed(2));
  const momentum = ui.bind('momentum', render, n => n.toFixed(1));
  const time = ui.bind('time', () => { pause(); render(); }, n => n.toFixed(2));
  const initialTime = time.value();
  const stateText = document.getElementById('state')!;
  function render() {
    ui.clear();
    const t = time.value(), s = sigma.value(), k = momentum.value(), state = physics(0, t, s, k);
    const density = view.value === 'density';
    const a = ui.axes(-24, 24, density ? 0 : -0.9, density ? 0.75 : 0.9, 'Position x', density ? 'Probability density |ψ|²' : 'Wave function ψ');
    if (density) ui.curve(a, x => physics(x, t, s, k).density, colors.red, false, true);
    else {
      ui.curve(a, x => physics(x, t, s, k).real, colors.red);
      ui.curve(a, x => physics(x, t, s, k).imaginary, colors.teal);
      ui.text('Re ψ', a.right - 68, 13, colors.red, 'right', 11);
      ui.text('Im ψ', a.right, 13, colors.teal, 'right', 11);
    }
    ctx.save(); ctx.strokeStyle = colors.gold; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(a.X(state.center), a.top); ctx.lineTo(a.X(state.center), a.bottom); ctx.stroke(); ctx.restore();
    ui.text('t = ' + t.toFixed(2) + '   σ₀ = ' + s.toFixed(2) + '   k₀ = ' + k.toFixed(1), a.right, a.top + 13, colors.muted, 'right', 10);
    stateText.textContent = 'Center ⟨x⟩ = ' + state.center.toFixed(2) + '  ·  Width σ(t) = ' + state.width.toFixed(2);
    ui.canvas.setAttribute('aria-label', 'Free Gaussian wave packet at time ' + t.toFixed(2) + ', center ' + state.center.toFixed(2) + ', position standard deviation ' + state.width.toFixed(2) + '.');
  }
  function pause() { running = false; play.textContent = 'Play'; play.setAttribute('aria-pressed', 'false'); cancelAnimationFrame(frame); }
  function tick(now: number) {
    if (!running) return;
    const dt = Math.min(0.05, (now - previous) / 1000); previous = now;
    const next = time.value() + dt * 0.7;
    time.set(next > 6 ? 0 : next); render(); frame = requestAnimationFrame(tick);
  }
  play.addEventListener('click', () => {
    if (running) pause();
    else { running = true; previous = performance.now(); play.textContent = 'Pause'; play.setAttribute('aria-pressed', 'true'); frame = requestAnimationFrame(tick); }
  });
  document.getElementById('reset')!.addEventListener('click', () => { pause(); time.set(initialTime); render(); });
  view.addEventListener('change', render); ui.setDraw(render);
}

function blochSphereDemo(ui: PlotUi, physics: typeof blochState) {
  const { ctx, colors } = ui;
  const theta = ui.bind('theta', render, n => n.toFixed(0) + '°');
  const phi = ui.bind('phi', render, n => n.toFixed(0) + '°');
  const readout = document.getElementById('state')!;
  let azimuth = -Math.PI / 4, elevation = Math.PI / 9;
  let pointer: { id: number; x: number; y: number } | undefined;
  function project(v: number[], cx: number, cy: number, radius: number) {
    const [x, y, z] = v;
    return {
      x: cx + radius * (-Math.sin(azimuth) * x + Math.cos(azimuth) * y),
      y: cy - radius * (-Math.sin(elevation) * Math.cos(azimuth) * x - Math.sin(elevation) * Math.sin(azimuth) * y + Math.cos(elevation) * z),
      depth: Math.cos(elevation) * Math.cos(azimuth) * x + Math.cos(elevation) * Math.sin(azimuth) * y + Math.sin(elevation) * z,
    };
  }
  function render() {
    ui.clear();
    const w = ui.width, h = ui.height, wide = w > 560;
    const cx = w * (wide ? 0.31 : 0.5), cy = h / 2 + 3, radius = Math.min(h * 0.38, w * 0.31);
    const state = physics(theta.value() * Math.PI / 180, phi.value() * Math.PI / 180);
    ctx.fillStyle = '#f6f1e9'; ctx.strokeStyle = '#ddd3c7'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    for (const plane of [0, 1, 2]) {
      for (let i = 0; i < 100; i++) {
        const a = i * 2 * Math.PI / 100, b = (i + 1) * 2 * Math.PI / 100;
        const vector = (t: number) => plane === 0 ? [Math.cos(t), Math.sin(t), 0] : plane === 1 ? [Math.cos(t), 0, Math.sin(t)] : [0, Math.cos(t), Math.sin(t)];
        const p = project(vector(a), cx, cy, radius), q = project(vector(b), cx, cy, radius);
        ctx.setLineDash(p.depth < 0 ? [2, 3] : []); ctx.strokeStyle = p.depth < 0 ? '#ddd4ca' : '#c0b5a8';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    for (const [v, label] of [[[1.18, 0, 0], 'x'], [[0, 1.18, 0], 'y'], [[0, 0, 1.18], '|0⟩'], [[0, 0, -1.18], '|1⟩']] as [number[], string][]) {
      const p = project(v, cx, cy, radius);
      ctx.strokeStyle = '#c1b6a8'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.stroke();
      ui.text(label, p.x + (label === 'x' || label === 'y' ? 7 : 0), p.y, colors.muted, 'center', 12);
    }
    const point = project([state.x, state.y, state.z], cx, cy, radius), angle = Math.atan2(point.y - cy, point.x - cx);
    ctx.strokeStyle = colors.red; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(point.x, point.y); ctx.stroke();
    ctx.fillStyle = colors.red; ctx.beginPath(); ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x - 10 * Math.cos(angle - 0.4), point.y - 10 * Math.sin(angle - 0.4));
    ctx.lineTo(point.x - 10 * Math.cos(angle + 0.4), point.y - 10 * Math.sin(angle + 0.4)); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI); ctx.fill();
    ui.text('|ψ⟩', point.x + 13, point.y - 10, colors.red, 'left', 13);
    ui.text('Drag the sphere to rotate the view', wide ? 20 : w / 2, 15, colors.muted, wide ? 'left' : 'center', 11);
    if (wide) {
      const x = w * 0.59, y = h * 0.2;
      ui.text('PURE QUBIT STATE', x, y, colors.muted, 'left', 10);
      ui.text('θ = ' + theta.value().toFixed(0) + '°    φ = ' + phi.value().toFixed(0) + '°', x, y + 24, colors.ink, 'left', 15);
      ui.text('P(0) = ' + state.probability0.toFixed(3), x, y + 56, colors.red, 'left', 13);
      ui.text('P(1) = ' + state.probability1.toFixed(3), x, y + 80, colors.teal, 'left', 13);
      const bw = Math.min(180, w - x - 25);
      ctx.fillStyle = colors.teal; ctx.fillRect(x, y + 101, bw, 8);
      ctx.fillStyle = colors.red; ctx.fillRect(x, y + 101, bw * state.probability0, 8);
      ui.text('Changing the view does not change the state.', x, y + 129, colors.muted, 'left', 10);
    }
    const sign = state.betaImaginary < 0 ? ' − ' : ' + ';
    readout.textContent = '|ψ⟩ = ' + state.alpha.toFixed(3) + '|0⟩ + (' + state.betaReal.toFixed(3) + sign + Math.abs(state.betaImaginary).toFixed(3) + 'i)|1⟩.  P(0) = ' + state.probability0.toFixed(3);
    ui.canvas.setAttribute('aria-label', 'Bloch sphere: theta ' + theta.value() + ' degrees, phi ' + phi.value() + ' degrees; probability of zero ' + state.probability0.toFixed(3) + '. Drag or use arrow keys to rotate the camera.');
  }
  ui.canvas.addEventListener('pointerdown', event => {
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; ui.canvas.setPointerCapture(event.pointerId);
  });
  ui.canvas.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    azimuth -= (event.clientX - pointer.x) * 0.009;
    elevation = Math.max(-1.3, Math.min(1.3, elevation + (event.clientY - pointer.y) * 0.009));
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; render();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) ui.canvas.addEventListener(type, () => { pointer = undefined; });
  ui.canvas.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft') azimuth += 0.1;
    if (event.key === 'ArrowRight') azimuth -= 0.1;
    if (event.key === 'ArrowUp') elevation = Math.min(1.3, elevation + 0.1);
    if (event.key === 'ArrowDown') elevation = Math.max(-1.3, elevation - 0.1);
    render();
  });
  document.getElementById('reset-camera')!.addEventListener('click', () => { azimuth = -Math.PI / 4; elevation = Math.PI / 9; render(); });
  ui.setDraw(render);
}

function potentialDemo(ui: PlotUi, potential: typeof schwarzschildPotential, peak: typeof schwarzschildPeak) {
  const { ctx, colors } = ui;
  const mass = ui.bind('mass', render, n => n.toFixed(2));
  const ell = ui.bind('ell', render, n => n.toFixed(0));
  const initialMass = mass.value(), initialEll = ell.value();
  const readout = document.getElementById('state')!;
  function render() {
    ui.clear();
    const m = mass.value(), l = ell.value(), rPeak = peak(m, l), vPeak = potential(rPeak, m, l);
    const refPeak = potential(peak(1, l), 1, l);
    const a = ui.axes(0, 18, 0, Math.max(vPeak, refPeak) * 1.25, 'Areal radius r / M₀', 'Scalar potential M₀² Vℓ');
    ctx.fillStyle = '#d7d0c54d'; ctx.fillRect(a.left, a.top, a.X(2 * m) - a.left, a.bottom - a.top);
    ui.curve(a, r => potential(r, 1, l), '#aaa096', true); ui.curve(a, r => potential(r, m, l), colors.red);
    ctx.fillStyle = colors.red; ctx.beginPath(); ctx.arc(a.X(rPeak), a.Y(vPeak), 4, 0, 2 * Math.PI); ctx.fill();
    ui.text('r₊ = ' + (2 * m).toFixed(2), a.X(2 * m) + 5, a.top + 14, colors.muted, 'left', 10);
    ui.text('Peak at r = ' + rPeak.toFixed(2), a.X(rPeak) + 10, a.Y(vPeak) - 10, colors.red, 'left', 11);
    ui.text('Solid: M = ' + m.toFixed(2) + '   ℓ = ' + l, a.right, a.top + 14, colors.red, 'right', 11);
    ui.text('Dashed: reference M₀ = 1', a.right, a.top + 32, colors.muted, 'right', 10);
    readout.textContent = 'rpeak / M₀ = ' + rPeak.toFixed(3) + '  ·  M₀² Vpeak = ' + vPeak.toFixed(4);
    ui.canvas.setAttribute('aria-label', 'Schwarzschild massless scalar potential, mass ' + m.toFixed(2) + ' reference masses, angular number ' + l + ', horizon ' + (2 * m).toFixed(2) + ', maximum at radius ' + rPeak.toFixed(3) + '.');
  }
  document.getElementById('reset')!.addEventListener('click', () => { mass.set(initialMass); ell.set(initialEll); render(); }); ui.setDraw(render);
}

function interferenceDemo(ui: PlotUi, physics: typeof interferenceState) {
  const { ctx, colors } = ui;
  const mode = document.getElementById('dispersion') as HTMLSelectElement;
  const k = ui.bind('k', render, n => n.toFixed(2));
  const delta = ui.bind('delta', render, n => n.toFixed(2));
  const time = ui.bind('time', () => { pause(); render(); }, n => n.toFixed(2));
  const initialTime = time.value();
  const play = document.getElementById('play') as HTMLButtonElement, readout = document.getElementById('state')!;
  let running = false, previous = 0, frame = 0;
  function render() {
    ui.clear();
    const dispersion = mode.value as 'linear' | 'quadratic', t = time.value(), k0 = k.value(), dk = delta.value();
    const state = physics(0, t, k0, dk, dispersion), wide = ui.width > 670;
    const a = ui.axes(-16, 16, -1.15, 1.15, 'Position x', 'Two waves · normalized sum', wide ? { left: 48, right: ui.width * 0.69, top: 30, bottom: ui.height - 31 } : undefined);
    ui.curve(a, x => Math.abs(physics(x, t, k0, dk, dispersion).envelope), colors.gold, true);
    ui.curve(a, x => -Math.abs(physics(x, t, k0, dk, dispersion).envelope), colors.gold, true);
    ui.curve(a, x => physics(x, t, k0, dk, dispersion).value, colors.red);
    ui.text('t = ' + t.toFixed(2), a.right, a.top + 13, colors.muted, 'right', 10);
    if (wide) {
      const maxK = 3.6, omega = (q: number) => dispersion === 'linear' ? 1.2 * q : q * q / 2;
      const b = ui.axes(0, maxK, 0, omega(maxK), 'Wave number k', 'Dispersion ω(k)', { left: ui.width * 0.79, right: ui.width - 18, top: 30, bottom: ui.height - 31 });
      ui.curve(b, omega, colors.teal);
      ctx.lineWidth = 1.5; ctx.strokeStyle = colors.gold; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(b.X(state.k1), b.Y(state.omega1)); ctx.lineTo(b.X(state.k2), b.Y(state.omega2)); ctx.stroke(); ctx.setLineDash([]);
      for (const [q, w] of [[state.k1, state.omega1], [state.k2, state.omega2]]) {
        ctx.fillStyle = colors.red; ctx.beginPath(); ctx.arc(b.X(q), b.Y(w), 3.5, 0, 2 * Math.PI); ctx.fill();
      }
    }
    readout.textContent = 'Envelope Δω/Δk = ' + state.envelopeVelocity.toFixed(3) + '  ·  Carrier ω̄/k₀ = ' + state.carrierVelocity.toFixed(3);
    ui.canvas.setAttribute('aria-label', 'Interference of two waves with ' + dispersion + ' dispersion at time ' + t.toFixed(2) + '. Envelope velocity ' + state.envelopeVelocity.toFixed(3) + ', carrier velocity ' + state.carrierVelocity.toFixed(3) + '.');
  }
  function pause() { running = false; play.textContent = 'Play'; play.setAttribute('aria-pressed', 'false'); cancelAnimationFrame(frame); }
  function tick(now: number) {
    if (!running) return;
    const dt = Math.min(0.05, (now - previous) / 1000); previous = now;
    const next = time.value() + dt; time.set(next > 12 ? 0 : next); render(); frame = requestAnimationFrame(tick);
  }
  play.addEventListener('click', () => {
    if (running) pause();
    else { running = true; previous = performance.now(); play.textContent = 'Pause'; play.setAttribute('aria-pressed', 'true'); frame = requestAnimationFrame(tick); }
  });
  document.getElementById('reset')!.addEventListener('click', () => { pause(); time.set(initialTime); render(); });
  mode.addEventListener('change', render); ui.setDraw(render);
}

function polyline(fn: (x: number) => number, xmin: number, xmax: number, ymin: number, ymax: number): string {
  const points: string[] = [];
  for (let i = 0; i <= 350; i++) {
    const x = xmin + (xmax - xmin) * i / 350, y = fn(x);
    if (!Number.isFinite(y)) continue;
    points.push((65 + 900 * i / 350).toFixed(2) + ',' + (259 - 205 * (y - ymin) / (ymax - ymin)).toFixed(2));
  }
  return points.join(' ');
}

function plotPoster(label: string, xlabel: string, ylabel: string, curves: string, ticks: string): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 310" role="img" aria-label="' + label + '">'
    + '<rect width="1000" height="310" rx="12" fill="#fbfaf7"/><g stroke="#e7e0d6" stroke-width="1">'
    + '<path d="M65 54H965M65 105H965M65 157H965M65 208H965M65 259H965M65 54V259M290 54V259M515 54V259M740 54V259M965 54V259"/></g>'
    + '<g font-family="system-ui,sans-serif" fill="#776d63" font-size="15"><text x="65" y="28" fill="#403637" font-size="18">' + ylabel + '</text>'
    + '<text x="965" y="299" text-anchor="end">' + xlabel + '</text>' + ticks + '</g>' + curves + '</svg>';
}

function wavePoster(settings: DemoSettings = normalizeDemoSettings('wave-packet')): string {
  const sigma = Number(settings.sigma), momentum = Number(settings.momentum), time = Number(settings.time), density = settings.view === 'density';
  const state = (x: number) => gaussianState(x, time, sigma, momentum);
  const points = polyline(x => density ? state(x).density : state(x).real, -24, 24, density ? 0 : -0.9, density ? 0.75 : 0.9);
  const curves = (density ? '<polygon points="65,259 ' + points + ' 965,259" fill="#8b405317"/>' : '')
    + '<polyline points="' + points + '" fill="none" stroke="#8b4053" stroke-width="3"/>'
    + (density ? '' : '<polyline points="' + polyline(x => state(x).imaginary, -24, 24, -0.9, 0.9) + '" fill="none" stroke="#347e83" stroke-width="3"/>');
  return plotPoster('A normalized Gaussian wave packet with initial width ' + sigma + ', mean momentum ' + momentum + ', time ' + time + '.', 'Position x', (density ? '|ψ(x)|²' : 'Re ψ (red) · Im ψ (teal)') + ' · σ₀ = ' + sigma + ', k₀ = ' + momentum + ', t = ' + time,
    curves, '<text x="65" y="280" text-anchor="middle">−24</text><text x="515" y="280" text-anchor="middle">0</text><text x="965" y="280" text-anchor="middle">24</text>');
}

function spherePoster(settings: DemoSettings = normalizeDemoSettings('bloch-sphere')): string {
  const cx = 310, cy = 160, radius = 110, azimuth = -Math.PI / 4, elevation = Math.PI / 9;
  const p = (x: number, y: number, z: number) => ({
    x: cx + radius * (-Math.sin(azimuth) * x + Math.cos(azimuth) * y),
    y: cy - radius * (-Math.sin(elevation) * Math.cos(azimuth) * x - Math.sin(elevation) * Math.sin(azimuth) * y + Math.cos(elevation) * z),
    depth: Math.cos(elevation) * Math.cos(azimuth) * x + Math.cos(elevation) * Math.sin(azimuth) * y + Math.sin(elevation) * z,
  });
  let lines = '';
  for (let plane = 0; plane < 3; plane++) {
    for (let i = 0; i < 100; i++) {
      const vec = (a: number) => plane === 0 ? p(Math.cos(a), Math.sin(a), 0) : plane === 1 ? p(Math.cos(a), 0, Math.sin(a)) : p(0, Math.cos(a), Math.sin(a));
      const a = vec(i * Math.PI / 50), b = vec((i + 1) * Math.PI / 50);
      lines += '<path d="M' + a.x.toFixed(2) + ' ' + a.y.toFixed(2) + 'L' + b.x.toFixed(2) + ' ' + b.y.toFixed(2) + '" fill="none" stroke="' + (a.depth < 0 ? '#dbd2c6' : '#bfb1a0') + '"' + (a.depth < 0 ? ' stroke-dasharray="2 3"' : '') + '/>';
    }
  }
  const theta = Number(settings.theta), phi = Number(settings.phi);
  const state = blochState(theta * Math.PI / 180, phi * Math.PI / 180), tip = p(state.x, state.y, state.z);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 310" role="img" aria-label="Bloch sphere at theta ' + theta + ' degrees and phi ' + phi + ' degrees, probability zero ' + state.probability0.toFixed(3) + '.">'
    + '<rect width="1000" height="310" rx="12" fill="#fbfaf7"/><circle cx="310" cy="160" r="110" fill="#f2ece3" stroke="#d7ccbe"/>'
    + lines + '<path d="M310 160L' + tip.x.toFixed(2) + ' ' + tip.y.toFixed(2) + '" stroke="#8b4053" stroke-width="4"/><circle cx="' + tip.x.toFixed(2) + '" cy="' + tip.y.toFixed(2) + '" r="6" fill="#8b4053"/>'
    + '<g font-family="system-ui,sans-serif"><text x="310" y="32" text-anchor="middle" font-size="18" fill="#71665a">|0⟩</text><text x="310" y="295" text-anchor="middle" font-size="18" fill="#71665a">|1⟩</text>'
    + '<text x="540" y="84" font-size="14" fill="#88796c">A PURE QUBIT</text><text x="540" y="121" font-size="26" fill="#3c3535">θ = ' + theta + '°   φ = ' + phi + '°</text>'
    + '<text x="540" y="168" font-size="20" fill="#8b4053">P(0) = ' + state.probability0.toFixed(3) + '</text><text x="540" y="201" font-size="20" fill="#347e83">P(1) = ' + state.probability1.toFixed(3) + '</text>'
    + '<text x="540" y="248" font-size="15" fill="#776d63">Rotate the view. Adjust the quantum state.</text></g></svg>';
}

function potentialPoster(settings: DemoSettings = normalizeDemoSettings('effective-potential')): string {
  const mass = Number(settings.mass), ell = Number(settings.ell);
  const ymax = Math.max(schwarzschildPotential(schwarzschildPeak(mass, ell), mass, ell), schwarzschildPotential(schwarzschildPeak(1, ell), 1, ell)) * 1.25;
  const points = polyline(r => schwarzschildPotential(r, mass, ell), 0, 18, 0, ymax);
  const reference = polyline(r => schwarzschildPotential(r, 1, ell), 0, 18, 0, ymax);
  return plotPoster('Massless scalar Schwarzschild potential, mass ' + mass + ', angular number ' + ell + '.', 'Areal radius r / M₀', 'M₀² Vℓ(r) · M / M₀ = ' + mass + ', ℓ = ' + ell,
    '<rect x="65" y="54" width="' + 100 * mass + '" height="205" fill="#d7d0c54d"/><polyline points="' + reference + '" fill="none" stroke="#aaa096" stroke-width="2" stroke-dasharray="6 5"/><polyline points="' + points + '" fill="none" stroke="#8b4053" stroke-width="3"/>',
    '<text x="65" y="280" text-anchor="middle">0</text><text x="515" y="280" text-anchor="middle">9</text><text x="965" y="280" text-anchor="middle">18</text><text x="51" y="263" text-anchor="end">0</text><text x="51" y="60" text-anchor="end">' + ymax.toFixed(2) + '</text>');
}

function interferencePoster(settings: DemoSettings = normalizeDemoSettings('interference')): string {
  const k = Number(settings.k), delta = Number(settings.delta), time = Number(settings.time), dispersion = settings.dispersion as 'linear' | 'quadratic';
  const curve = (fn: (x: number) => number, color: string, dash = false) => '<polyline points="' + polyline(fn, -16, 16, -1.15, 1.15) + '" fill="none" stroke="' + color + '" stroke-width="' + (dash ? 2 : 3) + '"' + (dash ? ' stroke-dasharray="7 5"' : '') + '/>';
  return plotPoster('Two-wave interference with ' + dispersion + ' dispersion, mean wave number ' + k + ' and separation ' + delta + ', at time ' + time + '.', 'Position x', 'Interference · ' + (dispersion === 'quadratic' ? 'ω = k²/2' : 'ω = 1.2k') + ', k₀ = ' + k + ', Δk = ' + delta + ', t = ' + time,
    curve(x => Math.abs(interferenceState(x, time, k, delta, dispersion).envelope), '#b18b46', true)
    + curve(x => -Math.abs(interferenceState(x, time, k, delta, dispersion).envelope), '#b18b46', true)
    + curve(x => interferenceState(x, time, k, delta, dispersion).value, '#8b4053'),
    '<text x="65" y="280" text-anchor="middle">−16</text><text x="515" y="280" text-anchor="middle">0</text><text x="965" y="280" text-anchor="middle">16</text><text x="51" y="162" text-anchor="end">0</text>');
}

// tsx's development transform may preserve inner function names through this
// helper. The serialized demo must remain independent of the module loader.
const uiScript = 'const __name = value => value; const ui = (' + createPlotUi.toString() + ')();';

export const DEMO_PRESETS: readonly DemoPreset[] = [
  {
    id: 'wave-packet', title: 'Free Gaussian wave packet',
    description: 'Adjust width, momentum, and time. Watch a normalized quantum packet drift and spread.',
    html: demoDocument('Free Gaussian wave packet',
      range('sigma', 'Initial width σ₀', 0.6, 2.5, 0.05, 1) + range('momentum', 'Mean momentum k₀', -2, 2, 0.1, 1)
      + range('time', 'Time t', 0, 6, 0.01, 0)
      + '<label class="control" for="view"><span>Show</span><select id="view"><option value="density">Probability |ψ|²</option><option value="amplitude">Real &amp; imaginary ψ</option></select></label>'
      + '<div class="actions"><button class="primary" id="play" aria-pressed="false">Play</button><button id="reset">Reset time</button></div>',
      '<span>ℏ = m = 1 · σ(t) = σ₀√[1 + t²/(4σ₀⁴)] · σ₀ is the initial position standard deviation.</span><strong id="state" class="mono"></strong>',
      uiScript + '(' + wavePacketDemo.toString() + ')(ui,' + gaussianState.toString() + ');',
      'Probability density of a free Gaussian wave packet. Controls change its initial width, momentum, and time.'),
    poster: wavePoster(),
  },
  {
    id: 'bloch-sphere', title: 'A qubit on the Bloch sphere',
    description: 'Rotate the sphere with a pointer. Change θ and φ to explore a pure state and its measurement probabilities.',
    html: demoDocument('A qubit on the Bloch sphere',
      range('theta', 'Polar angle θ', 0, 180, 1, 60) + range('phi', 'Relative phase φ', 0, 360, 1, 45)
      + '<div class="actions"><button id="reset-camera">Reset view</button></div>',
      '<span>θ and φ change the state. Drag or focus the sphere and use arrow keys to rotate the view.</span><strong id="state" class="mono"></strong>',
      uiScript + '(' + blochSphereDemo.toString() + ')(ui,' + blochState.toString() + ');',
      'Interactive Bloch sphere for a pure qubit. Drag or use arrow keys to rotate the camera.'),
    poster: spherePoster(),
  },
  {
    id: 'effective-potential', title: 'A black-hole potential barrier',
    description: 'Change the Schwarzschild mass and angular number to explore the radial potential for a massless scalar.',
    html: demoDocument('Schwarzschild scalar potential',
      range('mass', 'Mass M / M₀', 0.5, 2, 0.05, 1) + range('ell', 'Angular number ℓ', 0, 6, 1, 2)
      + '<div class="actions"><button id="reset">Reset parameters</button></div>',
      '<span>Vℓ = (1 − 2M/r)[ℓ(ℓ + 1)/r² + 2M/r³] · G = c = 1 · shaded: r ≤ 2M · M₀ is fixed.</span><strong id="state" class="mono"></strong>',
      uiScript + '(' + potentialDemo.toString() + ')(ui,' + schwarzschildPotential.toString() + ',' + schwarzschildPeak.toString() + ');',
      'Schwarzschild scalar effective potential outside the horizon. A dashed curve shows reference mass one.'),
    poster: potentialPoster(),
  },
  {
    id: 'interference', title: 'Interference and wave speeds',
    description: 'Compare carrier and envelope motion for linear or quadratic dispersion, with adjustable wave numbers.',
    html: demoDocument('Interference and wave speeds',
      '<label class="control" for="dispersion"><span>Dispersion</span><select id="dispersion"><option value="quadratic">ω = k² / 2</option><option value="linear">ω = 1.2 k</option></select></label>'
      + range('k', 'Mean wave number k₀', 0.8, 3, 0.05, 2) + range('delta', 'Separation Δk', 0.15, 1, 0.05, 0.5)
      + range('time', 'Time t', 0, 12, 0.01, 0)
      + '<div class="actions"><button class="primary" id="play" aria-pressed="false">Play</button><button id="reset">Reset time</button></div>',
      '<span>Equal waves: [cos(k₁x − ω₁t) + cos(k₂x − ω₂t)] / 2. Dashed curves bound the interference envelope.</span><strong id="state" class="mono"></strong>',
      uiScript + '(' + interferenceDemo.toString() + ')(ui,' + interferenceState.toString() + ');',
      'Two-wave interference and its dispersion relation. Gold dashed curves show the envelope.'),
    poster: interferencePoster(),
  },
];

export function findDemoPreset(id: string): DemoPreset | undefined {
  return DEMO_PRESETS.find(preset => preset.id === id);
}

/** Apply validated source settings to trusted markup, before any sandbox script runs. */
export function configureDemoPreset(id: string, value: unknown = {}): DemoPreset {
  const preset = findDemoPreset(id);
  if (!preset) throw new Error(`Unknown interactive demo “${id}”.`);
  const settings = normalizeDemoSettings(id, value);
  let html = preset.html;
  for (const field of demoSettingFields(id)) {
    const current = settings[field.key];
    if (field.type === 'number') {
      const pattern = new RegExp('(<input\\b[^>]*\\bid="' + field.key + '"[^>]*\\bvalue=")[^"]*(")');
      html = html.replace(pattern, (_match, before: string, after: string) => before + current + after);
    } else {
      const pattern = new RegExp('(<select\\b[^>]*\\bid="' + field.key + '"[^>]*>)([\\s\\S]*?)(</select>)');
      html = html.replace(pattern, (_match, before: string, options: string, after: string) => before + options
        .replace(/\sselected(?:="[^"]*")?/g, '')
        .replace(new RegExp('<option value="' + current + '"'), '<option value="' + current + '" selected') + after);
    }
  }
  const poster = id === 'wave-packet' ? wavePoster(settings) : id === 'bloch-sphere' ? spherePoster(settings)
    : id === 'effective-potential' ? potentialPoster(settings) : interferencePoster(settings);
  return { ...preset, html, poster };
}
