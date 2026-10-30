import { scopedStorageKey } from '../lib/storage-scope';

const THEME_KEY = scopedStorageKey('qft-markdown:theme');

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach(button => {
    button.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  });
  document.dispatchEvent(new CustomEvent('qft:theme', { detail: theme }));
}
let initial: 'light' | 'dark' = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
try { const stored = localStorage.getItem(THEME_KEY); if (stored === 'light' || stored === 'dark') initial = stored; } catch { /* Preferences remain usable in memory. */ }
applyTheme(initial);
document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* Nonessential preference. */ }
}));
