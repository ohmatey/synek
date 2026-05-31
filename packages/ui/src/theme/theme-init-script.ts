// Cookie name used to persist the user's theme preference.
// Read/written on both server and client.
export const THEME_COOKIE = 'synek-theme'

// Inline script string injected into <head> BEFORE React hydrates.
// Reads the cookie + OS preference, sets `data-theme` on <html>, and sets
// `color-scheme` on the root style so native UI (scrollbars, form controls,
// form autofill) matches. Synchronous — runs before first paint.
//
// Stays tiny on purpose: ships in every HTML response. Don't grow it.
export const themeInitScript = `(() => {
  try {
    const ck = document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=([^;]+)/);
    const pref = ck ? decodeURIComponent(ck[1]) : 'system';
    const sys = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    const resolved = pref === 'light' || pref === 'dark' ? pref : sys;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  } catch {}
})();`
