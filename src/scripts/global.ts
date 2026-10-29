function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach(button => {
    button.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  });
  document.dispatchEvent(new CustomEvent('qft:theme', { detail: theme }));
}
let initial: 'light' | 'dark' = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
try { const stored = localStorage.getItem('qft-markdown:theme'); if (stored === 'light' || stored === 'dark') initial = stored; } catch { /* Preferences remain usable in memory. */ }
applyTheme(initial);
document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try { localStorage.setItem('qft-markdown:theme', theme); } catch { /* Nonessential preference. */ }
}));
