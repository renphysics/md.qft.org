export interface ExampleDocument { id: string; title: string; description: string; source: string }

export const EXAMPLES: ExampleDocument[] = [
  {
    id: 'quantum',
    title: 'The language of quantum mechanics',
    description: 'A short physics note with equations, a table, and a footnote.',
    source: String.raw`# The language of quantum mechanics

Some ideas are easier to see when the notation has room to breathe.

## A state, and how it changes

A pure state is represented by a vector $|\psi\rangle$ in a Hilbert space. Its time evolution is governed by the **Schrödinger equation**:

$$
i\hbar\frac{\partial}{\partial t}|\psi(t)\rangle
=\hat H|\psi(t)\rangle.
$$

For a time-independent Hamiltonian, an energy eigenstate obeys \(\hat H|n\rangle=E_n|n\rangle\). The solution is especially simple:

\[
|\psi(t)\rangle=e^{-iE_nt/\hbar}|n\rangle.
\]

> The state changes by a phase. The probability of any measurement outcome remains the same.

## From amplitudes to probabilities

For a normalized state and an orthonormal basis, the Born rule gives

$$
p_n=|\langle n|\psi\rangle|^2,
\qquad \sum_n p_n=1.
$$

| Symbol | Meaning |
| :--- | :--- |
| $\lvert\psi\rangle$ | State vector |
| $\hat H$ | Hamiltonian |
| $E_n$ | Energy eigenvalue |
| $\hbar$ | Reduced Planck constant |

## A useful example

The energy levels of the one-dimensional harmonic oscillator are

$$
E_n=\hbar\omega\left(n+\frac12\right),
\qquad n=0,1,2,\ldots
\tag{1}
$$

Even the ground state has a nonzero energy.[^ground]

- [x] Write the equation.
- [x] Check the normalization.
- [ ] Explore a superposition of two energy eigenstates.

[^ground]: This is the oscillator's zero-point energy, measured relative to the minimum of its classical potential.
`,
  },
  {
    id: 'mathematics',
    title: 'An integral worth remembering',
    description: 'A compact derivation with aligned equations and a matrix.',
    source: String.raw`# An integral worth remembering

The Gaussian integral connects analysis, probability, and statistical physics.

## The idea

Let $I=\int_{-\infty}^{\infty} e^{-x^2}\,\mathrm{d}x$. Squaring it turns a one-dimensional integral into a two-dimensional one:

$$
\begin{aligned}
I^2
&=\int_{\mathbb R^2}e^{-(x^2+y^2)}\,\mathrm{d}x\,\mathrm{d}y\\
&=\int_0^{2\pi}\!\mathrm{d}\theta
  \int_0^\infty e^{-r^2}r\,\mathrm{d}r\\
&=\pi.
\end{aligned}
$$

Because \(I>0\), we obtain the familiar result

\[
\boxed{\displaystyle\int_{-\infty}^{\infty}e^{-x^2}\,\mathrm{d}x=\sqrt{\pi}}.
\]

## More than one variable

For a real, symmetric, positive-definite $n\times n$ matrix $A$,

$$
\int_{\mathbb R^n}e^{-\frac12\mathbf x^{\mathsf T}A\mathbf x}\,\mathrm{d}^n x
=\frac{(2\pi)^{n/2}}{\sqrt{\det A}}.
$$

For example, $A=\begin{pmatrix}2&1\\1&2\end{pmatrix}$ has determinant $3$ and positive eigenvalues $1,3$.

> A change of coordinates can make a difficult-looking calculation transparent.

### Try it

- Differentiate the one-variable integral with respect to a positive parameter.
- Recover the second moment of a Gaussian distribution.
- Keep the assumptions on $A$ visible whenever you use the formula.
`,
  },
  {
    id: 'quickstart',
    title: 'A small Markdown field guide',
    description: 'Try headings, lists, code, and both mathematical delimiter styles.',
    source: String.raw`# A small Markdown field guide

Write naturally. Add a little structure when it helps the reader.

## Words and structure

Use **bold** for emphasis, *italics* for a gentle change of voice, and [links](https://qft.org) for a useful next step.

1. Start with the idea.
2. Make the assumptions clear.
3. Let the calculation follow.

> A short paragraph often carries more meaning than a crowded page.

## Mathematics

Inline mathematics works with dollar signs, $e^{i\pi}+1=0$, and with brackets, \(a^2+b^2=c^2\).

For a displayed equation, use either form:

$$
\sum_{n=0}^{\infty}\frac{x^n}{n!}=e^x.
$$

\[
f(x)=\begin{cases}
x^2,&x\geq0,\\
-x,&x<0.
\end{cases}
\]

## A little code

The mathematical notation inside code stays exactly as written:

~~~python
import math

def gaussian(x):
    return math.exp(-x * x)
~~~

Inline code such as @@BACKTICK@@$x$@@BACKTICK@@ stays literal, too.

## Keep a copy

- **Markdown** keeps your editable source.
- **HTML** keeps a portable, typeset document.
- **Print / PDF** opens your browser's print dialog.

Your drafts are saved in this browser. Download a copy when you want to keep or share your work.
`.replaceAll('@@BACKTICK@@', '`'),
  },
];
