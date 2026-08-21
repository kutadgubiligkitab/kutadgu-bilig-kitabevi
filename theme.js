/* =========================================
   قۇتادغۇبىلىك كىتابخانىسى
   كۈندۈز / كېچە ھالىتى
========================================= */

(function () {

    const savedTheme = localStorage.getItem("kutadgu-theme");

    if (savedTheme === "dark") {
        document.body.classList.add("dark-mode");
    }


    function createThemeButton() {

        const nav =
            document.querySelector(".nav-links") ||
            document.querySelector("nav");

        if (!nav) return;

        /* ئاللىقاچان بار بولسا قايتا قوشمايدۇ */

        if (document.querySelector(".theme-toggle")) {
            updateIcon();
            return;
        }


        const button = document.createElement("button");

        button.type = "button";

        button.className = "theme-toggle";

        button.setAttribute(
            "aria-label",
            "كۈندۈز / كېچە ھالىتى"
        );


        button.addEventListener("click", function () {

            document.body.classList.toggle("dark-mode");

            const isDark =
                document.body.classList.contains("dark-mode");


            localStorage.setItem(
                "kutadgu-theme",
                isDark ? "dark" : "light"
            );


            updateIcon();

        });


        nav.appendChild(button);

        updateIcon();


        function updateIcon() {

            const isDark =
                document.body.classList.contains("dark-mode");

            button.textContent =
                isDark ? "☀️" : "🌙";
        }

    }


    /* بەت يۈكلەنگەندە */

    if (document.readyState === "loading") {

        document.addEventListener(
            "DOMContentLoaded",
            createThemeButton
        );

    } else {

        createThemeButton();

    }

})();
