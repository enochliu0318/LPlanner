/* 深浅色主题切换：跟随上次选择（localStorage 持久化） */

const THEME_KEY = "lesson_planner_theme";

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.textContent = theme === "dark" ? "☀️ 浅色模式" : "🌙 深色模式";
    btn.title = theme === "dark" ? "切换到浅色主题" : "切换到深色主题";
  }
}

// 初始化（head 内的内联脚本已提前设置 data-theme，避免闪烁；这里只负责按钮交互）
applyTheme(currentTheme());

document.getElementById("theme-toggle")?.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});
