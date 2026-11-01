/** Dimensionless free Gaussian: hbar = m = 1, initial position variance sigma0^2. */
export function gaussianState(x: number, time: number, sigma0: number, momentum: number) {
  const s = time / (2 * sigma0 * sigma0);
  const width = sigma0 * Math.sqrt(1 + s * s);
  const center = momentum * time;
  const displacement = x - center;
  const density = Math.exp(-displacement * displacement / (2 * width * width))
    / (Math.sqrt(2 * Math.PI) * width);
  const phase = momentum * x - momentum * momentum * time / 2
    + displacement * displacement * s / (4 * sigma0 * sigma0 * (1 + s * s))
    - Math.atan(s) / 2;
  return { density, real: Math.sqrt(density) * Math.cos(phase), imaginary: Math.sqrt(density) * Math.sin(phase), center, width };
}

/** Pure qubit, with the physically irrelevant common phase fixed. Angles are radians. */
export function blochState(theta: number, phi: number) {
  const alpha = Math.cos(theta / 2);
  const betaMagnitude = Math.sin(theta / 2);
  return {
    x: Math.sin(theta) * Math.cos(phi), y: Math.sin(theta) * Math.sin(phi), z: Math.cos(theta),
    alpha, betaReal: betaMagnitude * Math.cos(phi), betaImaginary: betaMagnitude * Math.sin(phi),
    probability0: alpha * alpha, probability1: betaMagnitude * betaMagnitude,
  };
}

/** Massless, minimally coupled scalar on Schwarzschild; G = c = 1 and r >= 2M. */
export function schwarzschildPotential(radius: number, mass: number, ell: number): number {
  if (!(mass > 0) || radius < 2 * mass || !Number.isInteger(ell) || ell < 0) return NaN;
  return (1 - 2 * mass / radius) * (ell * (ell + 1) / (radius * radius) + 2 * mass / (radius * radius * radius));
}

/** The exact exterior maximum of the scalar potential, in areal radius. */
export function schwarzschildPeak(mass: number, ell: number): number {
  const angular = ell * (ell + 1);
  if (!angular) return 8 * mass / 3;
  return mass * (3 * (angular - 1) + Math.sqrt(9 * (angular - 1) * (angular - 1) + 32 * angular)) / (2 * angular);
}

/** Two equal-amplitude waves. The displayed carrier uses the mean frequency exactly. */
export function interferenceState(x: number, time: number, k0: number, deltaK: number, dispersion: 'linear' | 'quadratic') {
  const k1 = k0 - deltaK / 2;
  const k2 = k0 + deltaK / 2;
  const omega1 = dispersion === 'linear' ? 1.2 * k1 : k1 * k1 / 2;
  const omega2 = dispersion === 'linear' ? 1.2 * k2 : k2 * k2 / 2;
  const meanOmega = (omega1 + omega2) / 2;
  const deltaOmega = omega2 - omega1;
  const envelope = Math.cos((deltaK * x - deltaOmega * time) / 2);
  return {
    value: (Math.cos(k1 * x - omega1 * time) + Math.cos(k2 * x - omega2 * time)) / 2,
    envelope, carrier: Math.cos(k0 * x - meanOmega * time), k1, k2, omega1, omega2,
    envelopeVelocity: Math.abs(deltaK) > 1e-10 ? deltaOmega / deltaK : (dispersion === 'linear' ? 1.2 : k0),
    carrierVelocity: meanOmega / k0,
  };
}
