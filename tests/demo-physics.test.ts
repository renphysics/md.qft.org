import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { gaussianState, blochState, schwarzschildPotential, schwarzschildPeak, interferenceState } from '../src/lib/demo-physics';
import { DEMO_PRESETS } from '../src/lib/demo-presets';
import { EXAMPLES } from '../src/lib/examples';

function close(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) < tolerance, actual + ' differs from ' + expected);
}

describe('teaching-demo physics', () => {
  it('the free Gaussian preserves normalization while its mean and variance evolve analytically', () => {
    for (const [time, sigma, momentum] of [[0, 1, 1], [6, 0.6, -2], [3, 2.5, 0.7]]) {
      const state = gaussianState(0, time, sigma, momentum);
      const start = state.center - 9 * state.width, step = 18 * state.width / 3000;
      let norm = 0, mean = 0, variance = 0;
      for (let i = 0; i <= 3000; i++) {
        const x = start + i * step;
        const value = gaussianState(x, time, sigma, momentum);
        const weight = i === 0 || i === 3000 ? 0.5 : 1;
        close(value.real * value.real + value.imaginary * value.imaginary, value.density);
        norm += value.density * step * weight;
        mean += x * value.density * step * weight;
        variance += (x - state.center) ** 2 * value.density * step * weight;
      }
      close(norm, 1, 1e-9);
      close(mean, momentum * time, 1e-8);
      close(variance, sigma * sigma + time * time / (4 * sigma * sigma), 1e-8);
    }
  });

  it('Bloch coordinates and state amplitudes stay normalized, including the poles', () => {
    for (const theta of [0, Math.PI / 3, Math.PI / 2, Math.PI]) {
      for (const phi of [0, Math.PI / 4, Math.PI, 2 * Math.PI]) {
        const state = blochState(theta, phi);
        close(state.x ** 2 + state.y ** 2 + state.z ** 2, 1);
        close(state.alpha ** 2 + state.betaReal ** 2 + state.betaImaginary ** 2, 1);
        close(state.probability0 + state.probability1, 1);
        close(state.probability0 - state.probability1, state.z);
      }
    }
    close(blochState(0, 3).probability0, 1);
    close(blochState(Math.PI, 1).probability0, 0);
    close(blochState(Math.PI / 2, 2).probability0, 0.5);
  });

  it('the scalar barrier has the correct horizon, asymptotics, peak, and mass scaling', () => {
    for (const mass of [0.5, 1, 2]) for (const ell of [0, 1, 2, 6]) {
      close(schwarzschildPotential(2 * mass, mass, ell), 0);
      const radius = schwarzschildPeak(mass, ell), dr = mass * 1e-4;
      const middle = schwarzschildPotential(radius, mass, ell);
      assert.ok(radius > 2 * mass && middle > 0);
      assert.ok(schwarzschildPotential(radius - dr, mass, ell) < middle);
      assert.ok(schwarzschildPotential(radius + dr, mass, ell) < middle);
      close(mass * mass * schwarzschildPotential(5 * mass, mass, ell), schwarzschildPotential(5, 1, ell));
      const far = 1e8;
      if (ell) close(far * far * schwarzschildPotential(far, mass, ell), ell * (ell + 1), 2e-6);
      else close(far ** 3 * schwarzschildPotential(far, mass, ell) / (2 * mass), 1, 1e-6);
    }
    close(schwarzschildPeak(1, 0), 8 / 3);
    assert.ok(Number.isNaN(schwarzschildPotential(1, 1, 2)));
  });

  it('two-wave interference factors exactly into an envelope and carrier with the stated speeds', () => {
    for (const mode of ['linear', 'quadratic'] as const) {
      for (const x of [-8.2, 0, 6.9]) for (const t of [0, 2.1, 7.8]) {
        const s = interferenceState(x, t, 2, 0.5, mode);
        close(s.value, s.envelope * s.carrier);
        close(s.envelopeVelocity, mode === 'linear' ? 1.2 : 2);
        close(s.carrierVelocity, mode === 'linear' ? 1.2 : 1 + 0.5 ** 2 / 16);
      }
    }
    const limit = interferenceState(3, 4, 2, 0, 'quadratic');
    close(limit.envelope, 1);
    close(limit.envelopeVelocity, 2);
    close(limit.value, Math.cos(2 * 3 - 2 * 4));
  });
});

/** Exercise the actual script serialized into an exported demo, with a tiny DOM. */
function runDemo(html: string) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'A self-contained demo script is required.');
  const painted: string[] = [];
  const context = new Proxy({}, {
    get(_target, property) { return property === 'fillText' ? (text: string) => painted.push(text) : () => {}; },
    set() { return true; },
  });
  class Element {
    value = '';
    textContent = '';
    clientWidth = 1040;
    clientHeight = 270;
    width = 0;
    height = 0;
    attributes = new Map<string, string>();
    listeners = new Map<string, Array<(event: unknown) => void>>();
    getContext() { return context; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    setPointerCapture() {}
    addEventListener(type: string, listener: (event: unknown) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    dispatch(type: string, event: unknown = {}) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
  }
  const elements = new Map<string, Element>();
  for (const match of html.matchAll(/<[a-z]+[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element();
    element.value = match[0].match(/\bvalue="([^"]+)"/)?.[1] ?? '';
    elements.set(match[1], element);
  }
  if (elements.has('view')) elements.get('view')!.value = 'density';
  if (elements.has('dispersion')) elements.get('dispersion')!.value = 'quadratic';
  const frames = new Map<number, (time: number) => void>();
  let frameId = 0;
  const environment = {
    document: { getElementById(id: string) { assert.ok(elements.has(id), 'Missing element ' + id); return elements.get(id)!; } },
    window: { devicePixelRatio: 1 },
    ResizeObserver: class { observe() {} },
    requestAnimationFrame(fn: (time: number) => void) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id: number) { frames.delete(id); },
    performance: { now: () => 0 },
  };
  new vm.Script(script).runInNewContext(environment, { timeout: 2000 });
  return { elements, painted, frames };
}

describe('portable interactive teaching examples', () => {
  it('every supplied HTML demo initializes without module-loader globals or external resources', () => {
    assert.deepEqual(DEMO_PRESETS.map(demo => demo.id), ['wave-packet', 'bloch-sphere', 'effective-potential', 'interference']);
    for (const preset of DEMO_PRESETS) {
      assert.doesNotMatch(preset.html, /\b(?:src|href)\s*=\s*["']https?:\/\//i);
      assert.doesNotMatch(preset.html, /\bon(?:click|input|load)\s*=/i);
      assert.match(preset.poster, /<svg\b[^>]*viewBox="0 0 1000 310"/);
      assert.doesNotMatch(preset.poster, /<script|\bid=|\bon[a-z]+=/i);
      const demo = runDemo(preset.html);
      assert.ok(demo.painted.length > 5, preset.id + ' should paint a plot and its labels.');
      assert.ok(demo.elements.get('state')!.textContent.length > 15, preset.id + ' should expose the numerical state.');
    }
  });

  it('changing actual controls updates the numerical readouts and animation progresses', () => {
    const wave = runDemo(DEMO_PRESETS[0].html);
    const time = wave.elements.get('time')!;
    time.value = '3'; time.dispatch('input');
    assert.match(wave.elements.get('state')!.textContent, /Center ⟨x⟩ = 3\.00/);
    wave.elements.get('play')!.dispatch('click');
    assert.equal(wave.elements.get('play')!.textContent, 'Pause');
    [...wave.frames.values()][0](50);
    assert.ok(Number(time.value) > 3);
    wave.elements.get('play')!.dispatch('click');
    assert.equal(wave.elements.get('play')!.textContent, 'Play');
    const bloch = runDemo(DEMO_PRESETS[1].html);
    bloch.elements.get('theta')!.value = '180'; bloch.elements.get('theta')!.dispatch('input');
    assert.match(bloch.elements.get('state')!.textContent, /P\(0\) = 0\.000/);
    const potential = runDemo(DEMO_PRESETS[2].html);
    potential.elements.get('mass')!.value = '2'; potential.elements.get('mass')!.dispatch('input');
    assert.match(potential.elements.get('state')!.textContent, /rpeak \/ M₀ = 5\.903/);
    const waves = runDemo(DEMO_PRESETS[3].html);
    waves.elements.get('dispersion')!.value = 'linear'; waves.elements.get('dispersion')!.dispatch('change');
    assert.match(waves.elements.get('state')!.textContent, /Envelope Δω\/Δk = 1\.200.*Carrier ω̄\/k₀ = 1\.200/);
  });

  it('the classroom example includes all four demos in Slides mode', () => {
    const example = EXAMPLES.find(item => item.id === 'interactive-physics');
    assert.ok(example);
    assert.equal(example.mode, 'slides');
    for (const preset of DEMO_PRESETS) assert.ok(example.source.includes('~~~interactive ' + preset.id));
    assert.equal(example.source.split('\n---\n').length, 5);
  });
});
