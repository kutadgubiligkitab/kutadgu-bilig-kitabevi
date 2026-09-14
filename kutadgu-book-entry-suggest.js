/**
 * Shared book-entry typeahead + advisory title-similarity helpers.
 * Author/translator/publisher: contains-match suggestions (never auto-replace).
 * Title: advisory similar-title warning only (never autocomplete).
 */
(function (root) {
  'use strict';

  var MAX_SUGGESTIONS = 8;
  var TITLE_MIN_CHARS = 2;
  var TITLE_DEBOUNCE_MS = 180;
  var FETCH_PAGE = 1000;
  var FETCH_CAP = 4000;
  var SUGGEST_FIELDS = 'id,title,author,translator,publisher,isbn';
  var caches = Object.create(null);
  var comboSeq = 0;

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function compareKey(value) {
    return normalizeText(value).toLocaleLowerCase();
  }

  function uniqueValuesFromRows(rows, field) {
    var seen = Object.create(null);
    var out = [];
    var list = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < list.length; i += 1) {
      var raw = list[i] && list[i][field];
      var text = normalizeText(raw);
      if (!text) continue;
      var key = compareKey(text);
      if (seen[key]) continue;
      seen[key] = true;
      out.push(text);
    }
    return out;
  }

  function filterContains(items, query, limit) {
    var cap = limit == null ? MAX_SUGGESTIONS : limit;
    var needle = compareKey(query);
    if (!needle) return [];
    var list = Array.isArray(items) ? items : [];
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var text = normalizeText(list[i]);
      if (!text) continue;
      if (compareKey(text).indexOf(needle) === -1) continue;
      out.push(text);
      if (out.length >= cap) break;
    }
    return out;
  }

  function titlesLookSimilar(a, b) {
    var left = compareKey(a);
    var right = compareKey(b);
    if (!left || !right) return false;
    if (left === right) return true;
    if (left.length >= TITLE_MIN_CHARS && right.indexOf(left) !== -1) return true;
    if (right.length >= TITLE_MIN_CHARS && left.indexOf(right) !== -1) return true;
    return false;
  }

  function filterTitleMatches(rows, query, options) {
    var opts = options || {};
    var needle = normalizeText(query);
    if (compareKey(needle).length < TITLE_MIN_CHARS) return [];
    var excludeId = opts.excludeId == null ? '' : String(opts.excludeId);
    var cap = opts.limit == null ? 6 : opts.limit;
    var list = Array.isArray(rows) ? rows : [];
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var row = list[i] || {};
      if (excludeId && String(row.id || '') === excludeId) continue;
      if (!titlesLookSimilar(needle, row.title)) continue;
      out.push({
        id: row.id || '',
        title: normalizeText(row.title),
        author: normalizeText(row.author),
        isbn: normalizeText(row.isbn)
      });
      if (out.length >= cap) break;
    }
    return out;
  }

  function loadSuggestionRows(client, options) {
    var opts = options || {};
    var cacheKey = opts.cacheKey || 'default';
    if (Object.prototype.hasOwnProperty.call(caches, cacheKey)) {
      return Promise.resolve(caches[cacheKey]);
    }
    if (!client || typeof client.from !== 'function') {
      caches[cacheKey] = [];
      return Promise.resolve([]);
    }
    var pageSize = opts.pageSize || FETCH_PAGE;
    var cap = opts.maxRows || FETCH_CAP;
    var collected = [];

    function nextPage(from) {
      if (collected.length >= cap) return Promise.resolve(collected);
      var to = from + pageSize - 1;
      return client
        .from('books')
        .select(SUGGEST_FIELDS)
        .range(from, to)
        .then(function (res) {
          if (res && res.error) throw res.error;
          var batch = (res && res.data) || [];
          collected = collected.concat(batch);
          if (!batch.length || batch.length < pageSize) return collected;
          return nextPage(from + pageSize);
        });
    }

    return nextPage(0)
      .then(function (rows) {
        caches[cacheKey] = rows;
        return rows;
      })
      .catch(function () {
        caches[cacheKey] = [];
        return [];
      });
  }

  function clearSuggestionCache(cacheKey) {
    if (cacheKey) delete caches[cacheKey];
    else {
      Object.keys(caches).forEach(function (key) {
        delete caches[key];
      });
    }
  }

  function ensureComboWrap(input) {
    if (input.parentElement && input.parentElement.classList.contains('kutadgu-combo')) {
      return input.parentElement;
    }
    var wrap = document.createElement('div');
    wrap.className = 'kutadgu-combo';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    return wrap;
  }

  function attachCombobox(input, getItems) {
    if (!input || !input.parentNode || input.dataset.kutadguComboBound === '1') return null;
    input.dataset.kutadguComboBound = '1';
    comboSeq += 1;
    var listId = 'kutadgu-combo-list-' + comboSeq;
    var wrap = ensureComboWrap(input);
    var list = document.createElement('ul');
    list.id = listId;
    list.className = 'kutadgu-combo-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('dir', 'rtl');
    list.hidden = true;
    wrap.appendChild(list);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');

    var activeIndex = -1;
    var visible = [];

    function close() {
      list.hidden = true;
      list.innerHTML = '';
      activeIndex = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function setActive(index) {
      var options = list.querySelectorAll('[role="option"]');
      if (!options.length) {
        activeIndex = -1;
        input.removeAttribute('aria-activedescendant');
        return;
      }
      if (index < 0) index = options.length - 1;
      if (index >= options.length) index = 0;
      activeIndex = index;
      for (var i = 0; i < options.length; i += 1) {
        var on = i === activeIndex;
        options[i].classList.toggle('is-active', on);
        options[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      input.setAttribute('aria-activedescendant', options[activeIndex].id);
      if (options[activeIndex].scrollIntoView) {
        options[activeIndex].scrollIntoView({ block: 'nearest' });
      }
    }

    function applyValue(value) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      close();
    }

    function render() {
      var items = typeof getItems === 'function' ? getItems() : [];
      visible = filterContains(items, input.value, MAX_SUGGESTIONS);
      list.innerHTML = '';
      if (!visible.length || !normalizeText(input.value)) {
        close();
        return;
      }
      visible.forEach(function (text, idx) {
        var li = document.createElement('li');
        li.id = listId + '-opt-' + idx;
        li.className = 'kutadgu-combo-option';
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.textContent = text;
        li.addEventListener('mousedown', function (event) {
          event.preventDefault();
          applyValue(text);
        });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      setActive(0);
    }

    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('keydown', function (event) {
      if (list.hidden) {
        if (event.key === 'ArrowDown' && normalizeText(input.value)) {
          event.preventDefault();
          render();
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive(activeIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive(activeIndex - 1);
      } else if (event.key === 'Enter') {
        if (activeIndex >= 0 && visible[activeIndex]) {
          event.preventDefault();
          applyValue(visible[activeIndex]);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });

    document.addEventListener('mousedown', function (event) {
      if (!wrap.contains(event.target)) close();
    });

    return {
      close: close,
      render: render,
      getVisible: function () { return visible.slice(); }
    };
  }

  function attachTitleWarning(input, getRows, options) {
    if (!input || input.dataset.kutadguTitleWarnBound === '1') return null;
    var opts = options || {};
    var box = opts.box;
    if (!box) {
      if (!input.insertAdjacentElement || typeof document === 'undefined' || !document.createElement) return null;
      box = document.createElement('div');
      box.className = 'kutadgu-title-warn';
      input.insertAdjacentElement('afterend', box);
    }
    input.dataset.kutadguTitleWarnBound = '1';
    box.hidden = true;
    box.setAttribute('role', 'status');
    var timer = null;

    function renderMatches() {
      var rows = typeof getRows === 'function' ? getRows() : [];
      var excludeId = typeof opts.getExcludeId === 'function' ? opts.getExcludeId() : opts.excludeId;
      var matches = filterTitleMatches(rows, input.value, { excludeId: excludeId });
      if (!matches.length) {
        box.hidden = true;
        box.innerHTML = '';
        return;
      }
      var items = matches.map(function (row) {
        var bits = [row.title];
        if (row.author) bits.push(row.author);
        if (row.isbn) bits.push(row.isbn);
        return '<li><span class="kutadgu-title-warn-title">' + escapeHtml(row.title) +
          '</span>' +
          (row.author ? '<span class="kutadgu-title-warn-meta"> · ' + escapeHtml(row.author) + '</span>' : '') +
          (row.isbn ? '<span class="kutadgu-title-warn-meta"> · ' + escapeHtml(row.isbn) + '</span>' : '') +
          '</li>';
      }).join('');
      box.innerHTML =
        '<p class="kutadgu-title-warn-msg">بۇ نامغا ئوخشايدىغان كىتاب بار، قايتا تەكشۈرۈپ بېقىڭ.</p>' +
        '<ul class="kutadgu-title-warn-list">' + items + '</ul>';
      box.hidden = false;
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(renderMatches, TITLE_DEBOUNCE_MS);
    }

    input.addEventListener('input', schedule);
    input.addEventListener('blur', renderMatches);
    return { render: renderMatches, box: box };
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var api = {
    MAX_SUGGESTIONS: MAX_SUGGESTIONS,
    SUGGEST_FIELDS: SUGGEST_FIELDS,
    normalizeText: normalizeText,
    uniqueValuesFromRows: uniqueValuesFromRows,
    filterContains: filterContains,
    filterTitleMatches: filterTitleMatches,
    titlesLookSimilar: titlesLookSimilar,
    loadSuggestionRows: loadSuggestionRows,
    clearSuggestionCache: clearSuggestionCache,
    attachCombobox: attachCombobox,
    attachTitleWarning: attachTitleWarning
  };

  root.KutadguBookEntrySuggest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
