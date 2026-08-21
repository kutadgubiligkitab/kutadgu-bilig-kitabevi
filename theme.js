/* =========================================================
   قۇتادغۇبىلىك كىتابخانىسى — ئورتاق كۈندۈز / كېچە ھالىتى
========================================================= */
(function () {
    "use strict";

    const STORAGE_KEY = "kutadgu-theme";

    function setTheme(isDark) {
        document.body.classList.toggle("dark-mode", isDark);
        localStorage.setItem(STORAGE_KEY, isDark ? "dark" : "light");

        const buttons = document.querySelectorAll(".theme-toggle, .theme-button");
        buttons.forEach(function (button) {
            button.textContent = isDark ? "☀️" : "🌙";
            button.setAttribute(
                "aria-label",
                isDark ? "كۈندۈز ھالىتىگە ئۆتۈش" : "كېچە ھالىتىگە ئۆتۈش"
            );
            button.title = isDark ? "كۈندۈز ھالىتى" : "كېچە ھالىتى";
        });
    }

    function createOrUseThemeButton() {
        let button = document.querySelector(".theme-button, .theme-toggle");

        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "theme-toggle";
            document.body.appendChild(button);
        }

        /* بىرلا كۇنۇپكىنى قالدۇرىمىز */
        document.querySelectorAll(".theme-toggle, .theme-button").forEach(function (other) {
            if (other !== button) other.remove();
        });

        button.addEventListener("click", function () {
            setTheme(!document.body.classList.contains("dark-mode"));
        });

        setTheme(document.body.classList.contains("dark-mode"));
    }

    function init() {
        const saved = localStorage.getItem(STORAGE_KEY);
        const prefersDark =
            window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches;

        /* ساقلانغان تاللاش ئالدى بىلەن؛ بولمىسا كومپيۇتېرنىڭ ھالىتى */
        const isDark = saved ? saved === "dark" : prefersDark;
        document.body.classList.toggle("dark-mode", isDark);

        createOrUseThemeButton();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
