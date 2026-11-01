/** Saved starting values for the four built-in classroom demonstrations. */
export type DemoSettings = Record<string, number | string>;

export interface DemoSettingField {
  readonly key: string;
  readonly label: string;
  readonly type: 'number' | 'select';
  readonly defaultValue: number | string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

const FIELDS: Readonly<Record<string, readonly DemoSettingField[]>> = {
  'wave-packet': [
    { key: 'sigma', label: 'Initial width σ₀', type: 'number', min: 0.6, max: 2.5, step: 0.05, defaultValue: 1 },
    { key: 'momentum', label: 'Mean momentum k₀', type: 'number', min: -2, max: 2, step: 0.1, defaultValue: 1 },
    { key: 'time', label: 'Starting time', type: 'number', min: 0, max: 6, step: 0.01, defaultValue: 0 },
    { key: 'view', label: 'Show', type: 'select', defaultValue: 'density', options: [
      { value: 'density', label: 'Probability |ψ|²' }, { value: 'amplitude', label: 'Real & imaginary ψ' },
    ] },
  ],
  'bloch-sphere': [
    { key: 'theta', label: 'Polar angle θ (degrees)', type: 'number', min: 0, max: 180, step: 1, defaultValue: 60 },
    { key: 'phi', label: 'Relative phase φ (degrees)', type: 'number', min: 0, max: 360, step: 1, defaultValue: 45 },
  ],
  'effective-potential': [
    { key: 'mass', label: 'Mass M / M₀', type: 'number', min: 0.5, max: 2, step: 0.05, defaultValue: 1 },
    { key: 'ell', label: 'Angular number ℓ', type: 'number', min: 0, max: 6, step: 1, defaultValue: 2 },
  ],
  interference: [
    { key: 'k', label: 'Mean wave number k₀', type: 'number', min: 0.8, max: 3, step: 0.05, defaultValue: 2 },
    { key: 'delta', label: 'Separation Δk', type: 'number', min: 0.15, max: 1, step: 0.05, defaultValue: 0.5 },
    { key: 'time', label: 'Starting time', type: 'number', min: 0, max: 12, step: 0.01, defaultValue: 0 },
    { key: 'dispersion', label: 'Dispersion', type: 'select', defaultValue: 'quadratic', options: [
      { value: 'quadratic', label: 'ω = k² / 2' }, { value: 'linear', label: 'ω = 1.2 k' },
    ] },
  ],
};

export function demoSettingFields(preset: string): readonly DemoSettingField[] {
  return Object.hasOwn(FIELDS, preset) ? FIELDS[preset] : [];
}

/** Reject mistakes instead of silently changing the teacher's requested starting state. */
export function normalizeDemoSettings(preset: string, value: unknown = {}): DemoSettings {
  const fields = demoSettingFields(preset);
  if (!fields.length) throw new Error(`Unknown interactive demo “${preset}”.`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Built-in demo settings must be a JSON object.');
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(fields.map(field => field.key));
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`Unknown setting “${key}” for ${preset}.`);
  }
  const result: DemoSettings = {};
  for (const field of fields) {
    const current = Object.hasOwn(input, field.key) ? input[field.key] : field.defaultValue;
    if (field.type === 'number') {
      if (typeof current !== 'number' || !Number.isFinite(current) || current < field.min! || current > field.max!) {
        throw new Error(`${field.label} must be a number between ${field.min} and ${field.max}.`);
      }
      const steps = (current - field.min!) / field.step!;
      if (Math.abs(steps - Math.round(steps)) > 0.000001) {
        throw new Error(`${field.label} must use increments of ${field.step} from ${field.min}.`);
      }
      result[field.key] = current;
    } else {
      if (typeof current !== 'string' || !field.options?.some(option => option.value === current)) {
        throw new Error(`${field.label} must be ${field.options?.map(option => option.value).join(' or ')}.`);
      }
      result[field.key] = current;
    }
  }
  return result;
}
