import { useEffect, useState } from "react";

const STORAGE_KEY = "telemoon_theme";

export function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch (_) {}
  // Default to signature TeleMoon dark blue night sky (#0E1220)
  return "dark";
}

export function applyTheme(theme) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute("content", theme === "light" ? "#FAF7F2" : "#0e1220");
    }
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    if (typeof document !== "undefined") {
      const current = document.documentElement.getAttribute("data-theme");
      if (current === "light" || current === "dark") return current;
    }
    return getInitialTheme();
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (newTheme) => {
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch (_) {}
    applyTheme(newTheme);
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  return { theme, toggleTheme, setTheme, isDark: theme === "dark" };
}
