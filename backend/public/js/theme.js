// Theme toggle management (light / dark)
const THEME_STORAGE_KEY = 'doc-class-theme';
const DEFAULT_THEME = 'dark';

// Read saved theme from localStorage or return default
function getStoredTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch (error) {
    console.warn('Could not read theme from localStorage:', error);
  }
  return DEFAULT_THEME;
}

// Apply theme attribute to document and update toggle button state
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);

  const toggleBtn = document.getElementById('theme-toggle');
  if (!toggleBtn) return;

  const nextLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  toggleBtn.setAttribute('aria-label', nextLabel);
  toggleBtn.setAttribute('title', nextLabel);
}

// Persist and apply theme selection
function setTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn('Could not save theme to localStorage:', error);
  }
  applyTheme(theme);
}

// Toggle between light and dark theme
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
}

// Initialize theme switcher event listener
function initThemeToggle() {
  applyTheme(getStoredTheme());

  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleTheme);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initThemeToggle);
} else {
  initThemeToggle();
}

