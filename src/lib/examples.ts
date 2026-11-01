export interface ExampleDocument {
  id: string;
  title: string;
  description: string;
  source: string;
  mode?: 'slides';
  slideTheme?: 'paper' | 'midnight' | 'serif';
  slideRatio?: '16:9' | '4:3';
}

export const EXAMPLES: ExampleDocument[] = [
  {
    id: 'interactive-physics',
    title: 'Physics you can explore',
    description: 'Four live teaching demos: a spreading wave packet, a Bloch sphere, a black-hole barrier, and wave interference.',
    mode: 'slides',
    slideTheme: 'paper',
    slideRatio: '16:9',
    source: [
      '# Physics you can explore',
      '',
      'Change a parameter. Predict what will happen. Then test the prediction.',
      '',
      '- Wave packets and spreading',
      '- Qubits on the Bloch sphere',
      '- Black-hole potential barriers',
      '- Interference and wave speeds',
      '',
      '**Choose Run demo on each slide.**',
      '',
      '---',
      '',
      '## A wave packet in free space',
      '',
      '~~~interactive wave-packet',
      '~~~',
      '',
      '---',
      '',
      '## A pure qubit, made visible',
      '',
      '~~~interactive bloch-sphere',
      '~~~',
      '',
      '---',
      '',
      '## A black-hole potential barrier',
      '',
      '~~~interactive effective-potential',
      '~~~',
      '',
      '---',
      '',
      '## When the envelope overtakes the carrier',
      '',
      '~~~interactive interference',
      '~~~',
      '',
    ].join('\n'),
  },
  {
    id: 'quantum-slides',
    title: 'Quantum phase, in five slides',
    description: 'A ready-to-present physics deck with equations, an interference example, and a short calculation.',
    mode: 'slides',
    slideTheme: 'paper',
    slideRatio: '16:9',
    source: String.raw`# Quantum phase

## From an invisible phase to a measurable signal

Five slides on states, evolution, and interference.

---

## One energy eigenstate

For $\hat H|n\rangle=E_n|n\rangle$, time evolution gives

$$
|\psi(t)\rangle=e^{-iE_nt/\hbar}|n\rangle.
$$

- The state acquires a common phase.
- Measurement probabilities stay unchanged.

---

## Two states can interfere

Take \(E_0=0\), \(E_1=\hbar\omega\), and prepare \(|+\rangle=(|0\rangle+|1\rangle)/\sqrt{2}\).

\[
|\psi(t)\rangle=\frac{|0\rangle+e^{-i\omega t}|1\rangle}{\sqrt{2}},
\qquad
P_+(t)=\cos^2\!\left(\frac{\omega t}{2}\right).
\]

A relative phase becomes a measurable probability.

---

## Check the prediction

Sample one period with \(\omega=1\):

~~~python
import math

for t in (0, math.pi / 2, math.pi, 2 * math.pi):
    probability = math.cos(t / 2) ** 2
    print(round(probability, 3))
~~~

The probabilities are **1, 0.5, 0, 1**.

---

## What to remember

- A common phase leaves measurement probabilities unchanged.
- Relative phases can change interference outcomes.
- The energy difference sets the oscillation period:

$$
T=\frac{2\pi\hbar}{E_1-E_0}=\frac{2\pi}{\omega}.
$$

**Try it:** change the energy gap and predict the new period.
`,
  },
  {
    id: 'study-notes',
    title: 'Understanding exponential change',
    description: 'Turn an explanation into study notes with a worked example, code, and practice questions.',
    source: String.raw`# Understanding exponential change

A short study guide to a pattern that appears whenever a quantity changes at a rate proportional to its current size.

## The idea in one equation

If a quantity $N(t)$ grows at a constant proportional rate $r$, then

$$
\frac{\mathrm dN}{\mathrm dt}=rN,
\qquad N(0)=N_0.
$$

The solution is \(N(t)=N_0e^{rt}\). Positive $r$ gives growth; negative $r$ gives decay.

> **Check the assumption:** the proportional rate is constant. This model does not describe unlimited growth in a resource-limited system.

## A worked example

Suppose a model population doubles every three hours. Its doubling time $T$ satisfies

\[
2N_0=N_0e^{rT}
\quad\Longrightarrow\quad
r=\frac{\ln 2}{T}.
\]

Starting with 100 individuals gives the following model predictions:

| Time | Number of doublings | Population |
| ---: | ---: | ---: |
| 0 hours | 0 | 100 |
| 3 hours | 1 | 200 |
| 6 hours | 2 | 400 |
| 9 hours | 3 | 800 |

### Check it with a few lines of Python

~~~python
import math

initial = 100
doubling_time = 3.0  # hours
rate = math.log(2) / doubling_time

for hours in (0, 3, 6, 9):
    population = initial * math.exp(rate * hours)
    print(hours, round(population))
~~~

## Common mistakes

- Keep the units of time consistent with the units of the rate.
- Distinguish a constant increase from a constant proportional increase.
- State when the model's assumptions are expected to fail.

## Questions to take away

1. How long does this model take to reach 1,600 individuals?
2. What changes if the quantity halves every three hours?
3. Why does the doubling time not depend on the initial population?

**Answer to question 1:** four doublings, or twelve hours.

---

*Make these notes your own: add another example, reorder the sections, and choose Study Notes in the PDF settings.*
`,
  },
  {
    id: 'project-report',
    title: 'A clear project update',
    description: 'An illustrative report with decisions, progress measures, a table, and next steps.',
    source: String.raw`# A clear project update

## Summary

The first version is ready for a small usability study. The next milestone is to verify that a new visitor can complete the main task without help.

*All numbers in this example are illustrative.*

## Progress at a glance

| Workstream | Completed checks | Total checks | Next step |
| :--- | ---: | ---: | :--- |
| Core workflow | 18 | 20 | Resolve two confusing labels |
| Document output | 12 | 15 | Check wide tables and long equations |
| Accessibility | 10 | 15 | Complete keyboard and screen-reader review |
| **Total** | **40** | **50** | **Review the remaining ten checks** |

The completion fraction is

$$
\text{completion}=\frac{40}{50}=0.8=80\%.
$$

This is a count of checks, not a claim that 80% of the effort is finished: different checks can require very different amounts of work.

## Decisions and their reasons

1. **Keep the first task short.** Start with a document and a clear action.
2. **Use representative examples.** Include a long table, mathematics, code, and ordinary prose.
3. **Record observed problems.** Turn each reproducible issue into a specific improvement.

## What we will measure

Let $n$ be the number of participants who attempt the task and $s$ the number who finish it without help. Report the counts alongside the fraction \(s/n\), and describe the difficulties observed during the session.

A small pilot is useful for finding problems; it should not be presented as a precise estimate for every future user.

## Next actions

- [x] Prepare the example documents.
- [x] Write a short task description.
- [ ] Invite participants with different levels of experience.
- [ ] Observe where they hesitate or ask for help.
- [ ] Revise the workflow and repeat the difficult tasks.

> A useful update makes the next decision easier: what is ready, what remains uncertain, and what happens next.
`,
  },
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
