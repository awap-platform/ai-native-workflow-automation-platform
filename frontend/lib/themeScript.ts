/**
 * Pre-paint theme bootstrap. Injected with the per-request CSP nonce so the
 * correct `.dark` class is present before the first paint and no hydration
 * warning is produced. Kept as a plain string because it must run before React.
 */
export const themeBootstrapScript = `(function(){try{var key="awap_theme";var stored=window.localStorage.getItem(key);var theme=stored==="light"||stored==="dark"||stored==="system"?stored:"system";var dark=theme==="dark"||(theme==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var resolved=dark?"dark":"light";document.documentElement.classList.toggle("dark",dark);document.documentElement.dataset.theme=resolved;}catch(e){}})();`;
