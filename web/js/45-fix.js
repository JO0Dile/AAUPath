// ==========================
// FIX PANEL
// ==========================
// The 🛠 button in the bottom-left corner, and the panel behind it: runs
// every analyzer in js/44-fix-analyzers.js, explains what it found, repairs
// what it safely can, and keeps a restorable history of every repair.
//
// Three rules this module exists to enforce, whatever an analyzer asks for:
//
//   1. Nothing is changed without being shown first. Every repair is
//      described — problem, cause, what will change — and waits for a tap.
//   2. Nothing is changed without a backup. A snapshot of the app's saved
//      data is taken immediately before a repair runs, and Undo puts it back
//      exactly, including keys the repair deleted.
//   3. Nothing outside the app's own data is touched. Repairs write to
//      localStorage and the offline cache. They never touch a source file —
//      a browser cannot, and a repair tool that could rewrite the app while
//      the app is running is not a repair tool.
(function () {
  var REG = window.AAUP_FIX_ANALYZERS;
  var HISTORY_KEY = 'aaup_fix_history';
  var MAX_HISTORY = 12;

  var state = { findings: [], scanning: false, scanned: false, showHistory: false, errors: [] };

  function el(id) { return document.getElementById(id); }
  function lang() { return (window.__anyVisiblePageIsRtl && window.__anyVisiblePageIsRtl()) ? 'ar' : 'en'; }
  function pick(o) {
    if (o == null) return '';
    if (typeof o === 'string') return o;
    return o[lang()] || o.en || '';
  }

  var L = {
    title: { en: 'Fix', ar: 'الإصلاح' },
    subtitle: { en: 'Checks this app and your saved data, and repairs what it safely can.',
                ar: 'يفحص التطبيق وبياناتك المحفوظة ويصلح ما يمكن إصلاحه بأمان.' },
    scan: { en: 'Run a check', ar: 'ابدأ الفحص' },
    rescan: { en: 'Check again', ar: 'أعد الفحص' },
    scanning: { en: 'Checking…', ar: 'جارٍ الفحص…' },
    clean: { en: 'No problems found. Everything checks out.', ar: 'لا توجد مشاكل. كل شيء سليم.' },
    found: { en: 'problems found', ar: 'مشكلة' },
    critical: { en: 'Critical', ar: 'حرِج' },
    warning: { en: 'Warning', ar: 'تحذير' },
    info: { en: 'Note', ar: 'ملاحظة' },
    problem: { en: 'Problem', ar: 'المشكلة' },
    cause: { en: 'Cause', ar: 'السبب' },
    files: { en: 'Files involved', ar: 'الملفات المعنية' },
    suggestion: { en: 'Suggested fix', ar: 'الإصلاح المقترح' },
    difficulty: { en: 'Difficulty', ar: 'الصعوبة' },
    easy: { en: 'easy', ar: 'سهل' },
    medium: { en: 'medium', ar: 'متوسط' },
    hard: { en: 'hard', ar: 'صعب' },
    apply: { en: 'Apply fix', ar: 'طبّق الإصلاح' },
    applying: { en: 'Applying…', ar: 'جارٍ التطبيق…' },
    applied: { en: 'Fixed', ar: 'تم الإصلاح' },
    undo: { en: 'Undo', ar: 'تراجع' },
    changes: { en: 'View changes', ar: 'عرض التغييرات' },
    manual: { en: 'Needs a change in the project files — cannot be repaired from the browser.',
              ar: 'يحتاج تعديلًا في ملفات المشروع — ولا يمكن إصلاحه من المتصفح.' },
    copy: { en: 'Copy', ar: 'نسخ' },
    copied: { en: 'Copied', ar: 'تم النسخ' },
    history: { en: 'Repair history', ar: 'سجل الإصلاحات' },
    noHistory: { en: 'No repairs have been applied on this device.', ar: 'لم يُطبَّق أي إصلاح على هذا الجهاز.' },
    restore: { en: 'Restore', ar: 'استعادة' },
    restored: { en: 'Restored. Reload the page to see it.', ar: 'تمت الاستعادة. أعد تحميل الصفحة لرؤيتها.' },
    undone: { en: 'Undone.', ar: 'تم التراجع.' },
    noChanges: { en: 'This repair changed nothing that is saved on your device.',
                 ar: 'لم يغيّر هذا الإصلاح شيئًا محفوظًا على جهازك.' },
    added: { en: 'added', ar: 'أُضيف' },
    removed: { en: 'removed', ar: 'حُذف' },
    changed: { en: 'changed', ar: 'تغيّر' },
    close: { en: 'Close', ar: 'إغلاق' },
    analyzerFailed: { en: 'checks could not run', ar: 'فحوص لم تُنفَّذ' }
  };

  // ---------------------------------------------------------------
  // BACKUPS
  // ---------------------------------------------------------------
  function snapshot() {
    var snap = {};
    REG.helpers.localKeys().forEach(function (k) {
      if (!REG.helpers.isAppKey(k)) return;
      if (k === HISTORY_KEY) return; // the log must not back itself up
      try { snap[k] = localStorage.getItem(k); } catch (e) {}
    });
    return snap;
  }

  function diff(before, after) {
    var out = [];
    Object.keys(before).forEach(function (k) {
      if (!(k in after)) out.push({ key: k, kind: 'removed' });
      else if (before[k] !== after[k]) out.push({ key: k, kind: 'changed' });
    });
    Object.keys(after).forEach(function (k) {
      if (!(k in before)) out.push({ key: k, kind: 'added' });
    });
    return out;
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') || []; }
    catch (e) { return []; }
  }

  function saveHistory(list) {
    // Backups are bounded twice: by count, and by total size. A student's
    // storage quota is shared with their actual plans and progress — a
    // repair log that grew until saving a plan started failing would be a
    // repair tool causing the exact damage it exists to undo.
    var trimmed = list.slice(-MAX_HISTORY);
    while (trimmed.length) {
      var payload = JSON.stringify(trimmed);
      if (payload.length < 300000) {
        try { localStorage.setItem(HISTORY_KEY, payload); return trimmed; }
        catch (e) { /* over quota — drop the oldest and retry */ }
      }
      trimmed.shift();
    }
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
    return [];
  }

  function record(entry) {
    var list = loadHistory();
    list.push(entry);
    return saveHistory(list);
  }

  function restore(entry) {
    if (!entry || !entry.before) return;
    // Keys the repair added must go, keys it removed must come back, keys it
    // changed must revert — restoring only what was saved would leave the
    // additions behind.
    var current = snapshot();
    Object.keys(current).forEach(function (k) {
      if (!(k in entry.before)) { try { localStorage.removeItem(k); } catch (e) {} }
    });
    Object.keys(entry.before).forEach(function (k) {
      try { localStorage.setItem(k, entry.before[k]); } catch (e) {}
    });
  }

  // ---------------------------------------------------------------
  // SCANNING
  // ---------------------------------------------------------------
  function scan() {
    if (state.scanning) return Promise.resolve();
    state.scanning = true;
    state.findings = [];
    state.errors = [];
    render();

    var done = 0;
    var total = REG.list.length;

    return Promise.all(REG.list.map(function (analyzer) {
      var result;
      // A throwing analyzer is a bug in the checker, not in the app. It is
      // counted and reported, never allowed to abort the whole scan.
      try { result = Promise.resolve(analyzer.run()); }
      catch (e) { result = Promise.reject(e); }
      return result.then(function (findings) {
        (findings || []).forEach(function (f) {
          f.analyzer = analyzer.id;
          state.findings.push(f);
        });
      }, function (e) {
        state.errors.push(analyzer.id + ': ' + (e && e.message ? e.message : String(e)));
      }).then(function () {
        done++;
        var prog = el('fixProgress');
        if (prog) prog.textContent = done + ' / ' + total;
      });
    })).then(function () {
      var order = { critical: 0, warning: 1, info: 2 };
      state.findings.sort(function (a, b) { return order[a.severity] - order[b.severity]; });
      state.scanning = false;
      state.scanned = true;
      render();
    });
  }

  // ---------------------------------------------------------------
  // RENDERING
  // ---------------------------------------------------------------
  // Built with createElement rather than innerHTML: analyzer findings quote
  // file names, storage keys, and course ids that can have come from another
  // student's plan through the feed.
  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function field(label, value) {
    var row = node('div', 'fix-field');
    row.appendChild(node('span', 'fix-field-label', pick(label)));
    row.appendChild(node('span', 'fix-field-value', value));
    return row;
  }

  function renderFinding(f) {
    var card = node('div', 'fix-card fix-sev-' + f.severity);

    var head = node('div', 'fix-card-head');
    head.appendChild(node('span', 'fix-chip fix-chip-' + f.severity, pick(L[f.severity])));
    head.appendChild(node('span', 'fix-card-title', pick(f.title)));
    card.appendChild(head);

    var body = node('div', 'fix-card-body');
    body.appendChild(field(L.problem, pick(f.problem)));
    body.appendChild(field(L.cause, pick(f.cause)));
    if (f.files && f.files.length) body.appendChild(field(L.files, f.files.join(', ')));
    body.appendChild(field(L.suggestion, pick(f.suggestion)));
    body.appendChild(field(L.difficulty, pick(L[f.difficulty] || L.medium)));

    if (f.code) {
      var pre = node('pre', 'fix-code', f.code);
      body.appendChild(pre);
      var copy = node('button', 'fix-btn fix-btn-ghost', pick(L.copy));
      copy.type = 'button';
      copy.addEventListener('click', function () {
        var write = (navigator.clipboard && navigator.clipboard.writeText)
          ? navigator.clipboard.writeText(f.code)
          : Promise.reject();
        write.then(function () { copy.textContent = pick(L.copied); },
                   function () {
                     // Clipboard blocked (it needs a secure context and a
                     // permission) — select the text instead so the student
                     // can copy it by hand.
                     var range = document.createRange();
                     range.selectNodeContents(pre);
                     var sel = window.getSelection();
                     sel.removeAllRanges();
                     sel.addRange(range);
                   });
      });
      body.appendChild(copy);
    }

    var actions = node('div', 'fix-card-actions');
    if (f.fix) {
      var apply = node('button', 'fix-btn fix-btn-primary', pick(L.apply));
      apply.type = 'button';
      apply.addEventListener('click', function () { applyFix(f, card, apply); });
      actions.appendChild(apply);
    } else {
      actions.appendChild(node('span', 'fix-manual', pick(L.manual)));
    }
    body.appendChild(actions);

    card.appendChild(body);
    return card;
  }

  function applyFix(f, card, button) {
    button.disabled = true;
    button.textContent = pick(L.applying);
    var before = snapshot();

    Promise.resolve()
      .then(function () { return f.fix(); })
      .then(function (result) {
        var after = snapshot();
        var entry = {
          id: 'fx' + Date.now().toString(36),
          at: Date.now(),
          findingId: f.id,
          title: pick(f.title),
          note: result && result.note ? pick(result.note) : '',
          before: before,
          changes: diff(before, after)
        };
        record(entry);

        button.remove();
        card.classList.add('fix-done');
        var done = node('div', 'fix-result');
        done.appendChild(node('span', 'fix-chip fix-chip-done', '✓ ' + pick(L.applied)));
        if (entry.note) done.appendChild(node('span', 'fix-result-note', entry.note));

        var undo = node('button', 'fix-btn fix-btn-ghost', pick(L.undo));
        undo.type = 'button';
        undo.addEventListener('click', function () {
          restore(entry);
          undo.disabled = true;
          done.appendChild(node('span', 'fix-result-note', pick(L.undone)));
        });

        var view = node('button', 'fix-btn fix-btn-ghost', pick(L.changes));
        view.type = 'button';
        view.addEventListener('click', function () {
          if (card.querySelector('.fix-diff')) return;
          card.appendChild(renderDiff(entry.changes));
        });

        done.appendChild(undo);
        done.appendChild(view);
        card.querySelector('.fix-card-body').appendChild(done);
      })
      .catch(function (e) {
        button.disabled = false;
        button.textContent = pick(L.apply);
        card.querySelector('.fix-card-body').appendChild(
          node('div', 'fix-result-note', (e && e.message ? e.message : String(e)))
        );
      });
  }

  function renderDiff(changes) {
    var box = node('div', 'fix-diff');
    if (!changes || !changes.length) {
      box.appendChild(node('p', null, pick(L.noChanges)));
      return box;
    }
    changes.forEach(function (c) {
      var row = node('div', 'fix-diff-row');
      row.appendChild(node('span', 'fix-diff-kind fix-diff-' + c.kind, pick(L[c.kind])));
      row.appendChild(node('code', null, c.key));
      box.appendChild(row);
    });
    return box;
  }

  function renderHistory() {
    var box = node('div', 'fix-history');
    box.appendChild(node('h3', null, pick(L.history)));
    var list = loadHistory().slice().reverse();
    if (!list.length) {
      box.appendChild(node('p', 'fix-empty', pick(L.noHistory)));
      return box;
    }
    list.forEach(function (entry) {
      var row = node('div', 'fix-hist-row');
      var when = new Date(entry.at);
      row.appendChild(node('div', 'fix-hist-when', when.toLocaleString()));
      row.appendChild(node('div', 'fix-hist-title', entry.title));
      if (entry.note) row.appendChild(node('div', 'fix-hist-note', entry.note));
      row.appendChild(node('div', 'fix-hist-note',
        (entry.changes || []).length + ' ' + (lang() === 'ar' ? 'تغييرًا محفوظًا' : 'saved item(s) changed')));

      var restoreBtn = node('button', 'fix-btn fix-btn-ghost', pick(L.restore));
      restoreBtn.type = 'button';
      restoreBtn.addEventListener('click', function () {
        restore(entry);
        restoreBtn.disabled = true;
        row.appendChild(node('div', 'fix-hist-note', pick(L.restored)));
      });
      row.appendChild(restoreBtn);

      var viewBtn = node('button', 'fix-btn fix-btn-ghost', pick(L.changes));
      viewBtn.type = 'button';
      viewBtn.addEventListener('click', function () {
        if (row.querySelector('.fix-diff')) return;
        row.appendChild(renderDiff(entry.changes));
      });
      row.appendChild(viewBtn);

      box.appendChild(row);
    });
    return box;
  }

  function render() {
    var body = el('fixBody');
    if (!body) return;
    body.innerHTML = '';
    body.setAttribute('dir', lang() === 'ar' ? 'rtl' : 'ltr');

    body.appendChild(node('p', 'fix-sub', pick(L.subtitle)));

    var bar = node('div', 'fix-bar');
    var run = node('button', 'fix-btn fix-btn-primary',
      state.scanning ? pick(L.scanning) : (state.scanned ? pick(L.rescan) : pick(L.scan)));
    run.type = 'button';
    run.disabled = state.scanning;
    run.addEventListener('click', function () { scan(); });
    bar.appendChild(run);
    if (state.scanning) {
      var p = node('span', 'fix-progress', '0 / ' + REG.list.length);
      p.id = 'fixProgress';
      bar.appendChild(p);
    }
    var histBtn = node('button', 'fix-btn fix-btn-ghost', pick(L.history));
    histBtn.type = 'button';
    histBtn.addEventListener('click', function () { state.showHistory = !state.showHistory; render(); });
    bar.appendChild(histBtn);
    body.appendChild(bar);

    if (state.showHistory) { body.appendChild(renderHistory()); }

    if (state.scanning) return;

    if (state.scanned) {
      if (!state.findings.length) {
        body.appendChild(node('p', 'fix-clean', pick(L.clean)));
      } else {
        var counts = { critical: 0, warning: 0, info: 0 };
        state.findings.forEach(function (f) { counts[f.severity]++; });
        var summary = node('div', 'fix-summary');
        ['critical', 'warning', 'info'].forEach(function (sev) {
          if (!counts[sev]) return;
          summary.appendChild(node('span', 'fix-chip fix-chip-' + sev, counts[sev] + ' ' + pick(L[sev])));
        });
        body.appendChild(summary);
        state.findings.forEach(function (f) { body.appendChild(renderFinding(f)); });
      }
    }

    if (state.errors.length) {
      body.appendChild(node('p', 'fix-empty', state.errors.length + ' ' + pick(L.analyzerFailed) + ': ' + state.errors.join('; ')));
    }
  }

  // ---------------------------------------------------------------
  // PANEL
  // ---------------------------------------------------------------
  function open() {
    var panel = el('fixPanel');
    if (!panel) return;
    panel.classList.add('open');
    var launcher = el('fixLauncher');
    if (launcher) launcher.setAttribute('aria-expanded', 'true');
    render();
    if (!state.scanned && !state.scanning) scan();
  }

  function close() {
    var panel = el('fixPanel');
    if (panel) panel.classList.remove('open');
    var launcher = el('fixLauncher');
    if (launcher) launcher.setAttribute('aria-expanded', 'false');
  }

  function toggle() {
    var panel = el('fixPanel');
    if (panel && panel.classList.contains('open')) close(); else open();
  }

  function bind() {
    var launcher = el('fixLauncher');
    if (launcher) launcher.addEventListener('click', toggle);
    var closeBtn = el('fixClose');
    if (closeBtn) closeBtn.addEventListener('click', close);
    var title = el('fixTitle');
    // innerHTML, not textContent: this overwrote the icon the markup carries,
    // putting a raw 🛠 back on a panel whose every other glyph is drawn.
    if (title) {
      title.innerHTML = (window.AAUP_ICONS ? window.AAUP_ICONS.preview('gear', 15) : '') +
        window.__escapeHtml(pick(L.title));
    }
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var panel = el('fixPanel');
      if (panel && panel.classList.contains('open')) close();
    });
  }

  if (document.readyState === 'complete') { bind(); }
  else { window.addEventListener('load', bind); }

  window.AAUP_FIX = {
    open: open, close: close, toggle: toggle, scan: scan,
    findings: function () { return state.findings.slice(); },
    history: loadHistory
  };
})();
