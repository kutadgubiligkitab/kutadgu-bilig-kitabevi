/*
  Compact public category navigation.
  Groups only link to categories the public directory currently exposes.
  Unmapped public categories stay reachable from «ھەممە تۈرلەر».
*/
(function (root) {
  "use strict";
  if (root.KutadguCategoryNav) return;

  const GROUPS = [
    { id: "literature", label: "ئەدەبىيات", slugs: ["romanlar", "tarikhiy-romanlar", "dunya-edebiyati", "uyghur-adabiyati", "adabiyat-roman", "hekayiler", "sheirlar"] },
    { id: "religion", label: "دىن", slugs: ["dini"] },
    { id: "history", label: "تارىخ ۋە مەدەنىيەت", slugs: ["meshhur-shexisler", "eslime-we-xatiriler"] },
    { id: "language", label: "تىل ۋە مائارىپ", slugs: ["derslik", "dictionary", "grammar"] },
    { id: "family", label: "ئائىلە ۋە بالىلار", slugs: ["children", "terbiye", "taamlar"] },
    { id: "knowledge", label: "ئىلىم ۋە تۇرمۇش", slugs: ["universal", "tibb", "iqtisad"] }
  ];

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function escapeHtml(value) {
    return text(value).replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }

  function slugOf(row) {
    const slug = text(row && (row.slug || String(row.source || "").replace(/\.html$/i, "")));
    return /^[a-z0-9-]+$/i.test(slug) ? slug.toLowerCase() : "";
  }

  function publicRows() {
    const directory = root.KutadguBookCategories;
    const rows = directory && typeof directory.visible === "function" ? directory.visible() : [];
    return (rows || []).filter((row) => row && !row.is_hidden && !row.retired && slugOf(row));
  }

  function model() {
    const rows = publicRows();
    const bySlug = new Map(rows.map((row) => [slugOf(row), row]));
    const used = new Set();
    const groups = GROUPS.map((group) => {
      const leaves = group.slugs.map((slug) => bySlug.get(slug)).filter(Boolean).map((row) => {
        const slug = slugOf(row);
        used.add(slug);
        return { slug, label: text(row.label) || slug, href: "/" + slug };
      });
      return { id: group.id, label: group.label, leaves };
    }).filter((group) => group.leaves.length);
    const unmapped = rows.filter((row) => !used.has(slugOf(row))).map((row) => {
      const slug = slugOf(row);
      return { slug, label: text(row.label) || slug, href: "/" + slug };
    });
    const all = rows.map((row) => {
      const slug = slugOf(row);
      return { slug, label: text(row.label) || slug, href: "/" + slug };
    });
    return { groups, unmapped, all };
  }

  function currentSlug() {
    const path = text(root.location && root.location.pathname).replace(/\/+$/, "");
    const match = path.match(/\/([a-z0-9-]+)$/i);
    return match ? match[1].toLowerCase() : "";
  }

  function ensureCss() {
    if (root.document.querySelector("link[data-kutadgu-category-nav]")) return;
    const link = root.document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/category-nav.css?v=2";
    link.setAttribute("data-kutadgu-category-nav", "1");
    root.document.head.appendChild(link);
  }

  function host() {
    const doc = root.document;
    let nav = doc.querySelector("[data-category-nav]");
    if (!nav) {
      nav = doc.createElement("nav");
      nav.className = "category-nav";
      nav.setAttribute("data-category-nav", "1");
      nav.id = "bookCategories";
    }
    const homeSearch = doc.querySelector(".home-search-card .search-box");
    const catalogSearch = doc.querySelector("#catalogFilterBar .catalog-filter-search");
    const anchor = homeSearch || catalogSearch;
    if (anchor && anchor !== nav) anchor.insertAdjacentElement("afterend", nav);
    else if (!anchor) {
      const grid = doc.querySelector(".books-grid");
      if (grid && grid.parentElement && grid.previousElementSibling !== nav) grid.parentElement.insertBefore(nav, grid);
    }
    return nav;
  }

  function consolidateHubNav() {
    const hub = root.document.querySelector(".category-hub-nav");
    if (!hub) return;
    const back = root.document.querySelector(".back-button")?.getAttribute("href") || "";
    const path = currentSlug() ? "/" + currentSlug() : "";
    hub.querySelectorAll("a").forEach((link) => {
      const href = link.getAttribute("href") || "";
      const keep = href === "/" || href === back || href === path || link.getAttribute("aria-current") === "page";
      if (!keep) link.remove();
    });
  }

  function leafLink(leaf, selected) {
    return `<a class="category-nav-leaf${selected ? " is-selected" : ""}" href="${escapeHtml(leaf.href)}" data-category-slug="${escapeHtml(leaf.slug)}"${selected ? ' aria-current="page"' : ""}>${escapeHtml(leaf.label)}</a>`;
  }

  function render() {
    const doc = root.document;
    if (!doc || !doc.body) return;
    if (!doc.querySelector(".books-grid[data-catalog-source], #newBooksCarousel, #advancedSearchPanel, #searchInput")) return;
    doc.querySelector(".home-search-quick-links")?.remove();
    consolidateHubNav();
    ensureCss();
    const nav = host();
    const data = model();
    const selected = currentSlug();
    const selectedGroup = data.groups.find((group) => group.leaves.some((leaf) => leaf.slug === selected)) || null;
    const openGroup = nav.dataset.openGroup || "";
    const showAll = nav.dataset.showAll === "1";
    const mobileOpen = nav.dataset.mobileOpen === "1";
    const group = data.groups.find((item) => item.id === openGroup) || null;
    const leaves = showAll ? data.all : (group ? group.leaves : []);
    const selectedLeaf = data.all.find((leaf) => leaf.slug === selected);
    const toggleLabel = selectedLeaf ? selectedLeaf.label : "تۈرلەر";
    const allSelected = showAll || (!!selectedLeaf && !selectedGroup);
    nav.classList.toggle("is-mobile-open", mobileOpen);
    nav.classList.toggle("is-open", !!(group || showAll));
    nav.style.setProperty("--category-groups", String(Math.max(data.groups.length, 1)));
    nav.innerHTML = `
      <button type="button" class="category-nav-toggle" aria-expanded="${mobileOpen ? "true" : "false"}" aria-controls="categoryNavPanel">${escapeHtml(toggleLabel)}</button>
      <div class="category-nav-panel" id="categoryNavPanel">
        <div class="category-nav-groups" role="group" aria-label="كىتاب تۈرلىرى">
          <button type="button" class="category-nav-group category-nav-all${allSelected ? " is-selected" : ""}" data-category-all="1" aria-pressed="${showAll ? "true" : "false"}">ھەممە تۈرلەر</button>
          ${data.groups.map((item) => {
            const expanded = item.id === openGroup && !showAll;
            const marked = expanded || (!showAll && selectedGroup && selectedGroup.id === item.id);
            return `<button type="button" class="category-nav-group${marked ? " is-selected" : ""}" data-category-group="${escapeHtml(item.id)}" aria-expanded="${expanded ? "true" : "false"}">${escapeHtml(item.label)}</button>`;
          }).join("")}
        </div>
        <div class="category-nav-leaves" ${leaves.length ? "" : "hidden"}>
          <button type="button" class="category-nav-back" data-category-back="1">قايتىش</button>
          <button type="button" class="category-nav-close" data-category-close="1">يىغىش</button>
          ${leaves.map((leaf) => leafLink(leaf, leaf.slug === selected)).join("")}
        </div>
      </div>`;
    bind(nav);
  }

  function bind(nav) {
    const toggle = nav.querySelector(".category-nav-toggle");
    const focusReturn = nav.dataset.focusReturn || "";
    toggle.addEventListener("click", () => {
      const next = nav.dataset.mobileOpen === "1" ? "" : "1";
      nav.dataset.mobileOpen = next;
      if (!next) {
        nav.dataset.openGroup = "";
        nav.dataset.showAll = "";
      }
      render();
      const fresh = root.document.querySelector("[data-category-nav] .category-nav-toggle");
      if (fresh && next) fresh.focus();
    });
    nav.querySelectorAll("[data-category-group]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.categoryGroup;
        const mobile = root.matchMedia("(max-width: 767px)").matches;
        if (nav.dataset.openGroup === id && nav.dataset.showAll !== "1") {
          nav.dataset.openGroup = "";
          nav.dataset.showAll = "";
          nav.dataset.focusReturn = "group:" + id;
          render();
          root.document.querySelector(`[data-category-nav] [data-category-group="${id}"]`)?.focus();
          return;
        }
        nav.dataset.focusReturn = "group:" + id;
        nav.dataset.openGroup = id;
        nav.dataset.showAll = "";
        if (mobile) nav.dataset.mobileOpen = "1";
        render();
        const fresh = root.document.querySelector("[data-category-nav]");
        (mobile ? fresh.querySelector("[data-category-back]") : fresh.querySelector(".category-nav-leaf"))?.focus();
      });
    });
    nav.querySelector("[data-category-all]")?.addEventListener("click", () => {
      if (nav.dataset.showAll === "1") {
        nav.dataset.showAll = "";
        nav.dataset.openGroup = "";
        nav.dataset.focusReturn = "all";
        render();
        root.document.querySelector("[data-category-nav] [data-category-all]")?.focus();
        return;
      }
      nav.dataset.focusReturn = "all";
      nav.dataset.showAll = "1";
      nav.dataset.openGroup = "";
      if (root.matchMedia("(max-width: 767px)").matches) nav.dataset.mobileOpen = "1";
      render();
      const freshAll = root.document.querySelector("[data-category-nav]");
      const mobileAll = root.matchMedia("(max-width: 767px)").matches;
      (mobileAll ? freshAll.querySelector("[data-category-back]") : freshAll.querySelector(".category-nav-leaf"))?.focus();
    });
    nav.querySelector("[data-category-back]")?.addEventListener("click", () => {
      const backTo = nav.dataset.focusReturn || "";
      nav.dataset.openGroup = "";
      nav.dataset.showAll = "";
      render();
      const fresh = root.document.querySelector("[data-category-nav]");
      const target = backTo === "all"
        ? fresh.querySelector("[data-category-all]")
        : fresh.querySelector(`[data-category-group="${backTo.slice(6)}"]`);
      (target || fresh.querySelector(".category-nav-toggle"))?.focus();
    });
    nav.querySelector("[data-category-close]")?.addEventListener("click", () => {
      const backTo = nav.dataset.focusReturn || (nav.dataset.openGroup ? "group:" + nav.dataset.openGroup : "");
      nav.dataset.openGroup = "";
      nav.dataset.showAll = "";
      render();
      const fresh = root.document.querySelector("[data-category-nav]");
      const target = backTo === "all"
        ? fresh.querySelector("[data-category-all]")
        : fresh.querySelector(`[data-category-group="${backTo.slice(6)}"]`);
      (target || fresh.querySelector(".category-nav-group"))?.focus();
    });
    if (!nav.dataset.escapeBound) {
      nav.dataset.escapeBound = "1";
      root.document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        const current = root.document.querySelector("[data-category-nav]");
        if (!current || (!current.classList.contains("is-open") && current.dataset.mobileOpen !== "1")) return;
        const invoker = current.dataset.focusReturn || (current.dataset.openGroup ? "group:" + current.dataset.openGroup : "");
        current.dataset.mobileOpen = "";
        current.dataset.openGroup = "";
        current.dataset.showAll = "";
        render();
        const fresh = root.document.querySelector("[data-category-nav]");
        const mobile = root.matchMedia("(max-width: 767px)").matches;
        const target = invoker === "all"
          ? fresh.querySelector("[data-category-all]")
          : fresh.querySelector(`[data-category-group="${invoker.slice(6)}"]`);
        (mobile ? fresh.querySelector(".category-nav-toggle") : (target || fresh.querySelector("[data-category-group]")))?.focus();
      });
    }
    void focusReturn;
  }

  function boot() {
    render();
    root.document.addEventListener("kutadgu-categories", render);
  }

  root.KutadguCategoryNav = { GROUPS, model, render, boot };
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(window);
