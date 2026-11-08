export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

/**
 * Runs inline in <head> before first paint: applies the saved theme, or the
 * system preference when nothing is saved, and keeps following the system
 * until the user picks one with the toggle.
 */
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");function s(){var t=null;try{t=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}return t==="dark"||t==="light"?t:null}function a(){var t=s()||(m.matches?"dark":"light");d.classList.toggle("dark",t==="dark");d.style.colorScheme=t}a();m.addEventListener("change",function(){if(!s())a()})})()`;

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page only.
  }
}
