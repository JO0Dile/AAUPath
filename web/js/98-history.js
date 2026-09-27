// ==========================
// RECENT CHANGES — your last ten changes to a plan, each with its own Undo
// (idea 4). The toast Undo only lasts a few seconds; this is the way back
// after that.
//
// Changes are saved from many places (the tick, the grade keypad, the
// status buttons, the grades screen, Mark all done, drag-and-drop, Remove),
// so rather than hook each of them this keeps a small snapshot of the
// things a student changes — ticks, grades, statuses, removed courses, and
// where each course sits — and compares it after every tap or key. What
// differs becomes one entry. Undo writes the old values back through the
// app's own save functions, so nothing else needs to know this exists.
// ==========================
(function(){
  'use strict';

  var KEY = 'aaup_history';
  var MAX = 10;
  var snap = null, snapPrefix = null, timer = null, muted = false;

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s)) : String(s); }
  function S(){ return window.AAUP_STORAGE; }
  function current(){ return window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.getSelected ? window.AAUP_DASHBOARD.getSelected() : null; }
  function plan(prefix){
    var all = window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans ? window.AAUP_IMPORTED.loadImportedPlans() : {};
    return all[prefix] || null;
  }

  function pick(map, prefix){
    var out = {}, head = prefix + '-c-';
    Object.keys(map || {}).forEach(function(k){ if(k.indexOf(head) === 0 && map[k]) out[k] = map[k]; });
    return out;
  }
  function take(prefix){
    var p = plan(prefix), where = {};
    ((p && p.courses) || []).forEach(function(c){ where[c.id] = (c.yearId || '') + '|' + (c.semester || ''); });
    var G = window.AAUP_GPA;
    return {
      progress: pick(window.__getProgress ? window.__getProgress() : {}, prefix),
      grades: pick(G && G.loadGrades ? G.loadGrades() : {}, prefix),
      statuses: pick(G && G.loadStatuses ? G.loadStatuses() : {}, prefix),
      removed: pick(S() ? S().getJSON('aaup_removedCourses', {}) : {}, prefix),
      where: where
    };
  }

  function diffMaps(a, b){
    var keys = {}, out = [];
    Object.keys(a).forEach(function(k){ keys[k] = 1; });
    Object.keys(b).forEach(function(k){ keys[k] = 1; });
    Object.keys(keys).forEach(function(k){
      var x = a[k] || '', y = b[k] || '';
      if(x !== y) out.push({ k: k, before: x, after: y });
    });
    return out;
  }

  function load(){ var m = S() ? S().getJSON(KEY, {}) : {}; return (m && typeof m === 'object') ? m : {}; }
  function list(prefix){ var l = load()[prefix]; return Array.isArray(l) ? l : []; }
  function push(prefix, entry){
    var m = load();
    var l = Array.isArray(m[prefix]) ? m[prefix] : [];
    l.unshift(entry);
    m[prefix] = l.slice(0, MAX);
    if(S()) S().setJSON(KEY, m);
  }

  function check(){
    timer = null;
    var prefix = current();
    if(!prefix || !plan(prefix)) return;
    var now = take(prefix);
    if(!snap || snapPrefix !== prefix || muted){ snap = now; snapPrefix = prefix; return; }
    var at = Date.now();
    ['progress', 'grades', 'statuses', 'removed', 'where'].forEach(function(kind){
      var d = diffMaps(snap[kind], now[kind]);
      // A new plan loading adds every course's place at once; that is not a
      // change anyone made.
      if(kind === 'where') d = d.filter(function(x){ return x.before && x.after; });
      if(d.length) push(prefix, { at: at, kind: kind, items: d });
    });
    snap = now;
  }
  function soon(){ if(timer) clearTimeout(timer); timer = setTimeout(check, 400); }
  ['click', 'keyup', 'change', 'pointerup'].forEach(function(ev){ document.addEventListener(ev, soon, true); });
  if(document.readyState === 'complete') setTimeout(check, 1500);
  else window.addEventListener('load', function(){ setTimeout(check, 1500); });

  // ---- words -----------------------------------------------------------
  function names(prefix){
    var out = {};
    ((plan(prefix) || {}).courses || []).forEach(function(c){ out[c.id] = { en: c.name, ar: c.ar || c.name }; });
    return out;
  }
  function slugOf(prefix, k){ return k.indexOf(prefix + '-c-') === 0 ? k.slice(prefix.length + 3) : k; }
  function nameOf(prefix, k, r, nm){ var n = nm[slugOf(prefix, k)]; return n ? (r ? n.ar : n.en) : slugOf(prefix, k); }
  var STATUS = { in_progress: ['in progress', 'قيد الإنجاز'], planned: ['planned', 'مخطط'], '': ['not started', 'لم يبدأ'] };
  function whereTx(v, r){
    var parts = String(v || '').split('|'), y = parts[0].replace(/^y/, ''), s = parts[1];
    var sem = { s1: ['first semester', 'الفصل الأول'], s2: ['second semester', 'الفصل الثاني'], s3: ['summer', 'الصيفي'] }[s] || ['', ''];
    return r ? ('السنة ' + y + ' · ' + sem[1]) : ('Year ' + y + ' · ' + sem[0]);
  }
  function describe(prefix, e, r){
    var nm = names(prefix), it = e.items, one = it.length === 1, n0 = nameOf(prefix, it[0].k, r, nm);
    if(e.kind === 'progress'){
      var on = it.filter(function(x){ return x.after; }).length;
      if(one) return r ? (n0 + ' ← ' + (it[0].after ? 'منجز' : 'مش منجز')) : (n0 + ' → ' + (it[0].after ? 'passed' : 'not passed'));
      return r ? ('علّمت ' + it.length + ' مساق ' + (on ? 'منجز' : 'مش منجز')) : ((on ? 'Marked ' : 'Unmarked ') + it.length + ' courses' + (on ? ' passed' : ''));
    }
    if(e.kind === 'grades'){
      if(!one) return r ? ('غيّرت ' + it.length + ' علامات') : ('Changed ' + it.length + ' grades');
      return it[0].after ? (r ? ('العلامة ' + it[0].after + ' لـ' + n0) : ('Grade ' + it[0].after + ' for ' + n0))
                         : (r ? ('مسحت علامة ' + n0) : ('Cleared the grade for ' + n0));
    }
    if(e.kind === 'statuses'){
      if(!one) return r ? ('غيّرت حالة ' + it.length + ' مساقات') : ('Changed ' + it.length + ' statuses');
      var st = STATUS[it[0].after || ''] || STATUS[''];
      return r ? (n0 + ' ← ' + st[1]) : (n0 + ' → ' + st[0]);
    }
    if(e.kind === 'removed'){
      return it[0].after ? (r ? ('شلت ' + n0) : ('Removed ' + n0)) : (r ? ('رجّعت ' + n0) : ('Brought back ' + n0));
    }
    if(e.kind === 'where'){
      return r ? ('نقلت ' + n0 + ' لـ' + whereTx(it[0].after, true)) : ('Moved ' + n0 + ' to ' + whereTx(it[0].after, false));
    }
    return '';
  }
  function ago(t, r){
    var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if(s < 60) return r ? 'هلأ' : 'just now';
    var m = Math.floor(s / 60); if(m < 60) return r ? ('قبل ' + m + ' د') : (m + ' min ago');
    var h = Math.floor(m / 60); if(h < 24) return r ? ('قبل ' + h + ' س') : (h + 'h ago');
    return new Date(t).toLocaleDateString(r ? 'ar' : 'en', { day: 'numeric', month: 'short' });
  }

  // ---- undo --------------------------------------------------------------
  function undo(prefix, index){
    var m = load(), l = Array.isArray(m[prefix]) ? m[prefix] : [];
    var e = l[index];
    if(!e) return;
    muted = true;
    try{
      var G = window.AAUP_GPA;
      if(e.kind === 'progress'){
        var prog = window.__getProgress();
        e.items.forEach(function(x){ if(x.before) prog[x.k] = x.before; else delete prog[x.k]; });
        if(window.__saveProgress) window.__saveProgress();
      } else if(e.kind === 'grades' || e.kind === 'statuses'){
        var map = e.kind === 'grades' ? G.loadGrades() : G.loadStatuses();
        e.items.forEach(function(x){ if(x.before) map[x.k] = x.before; else delete map[x.k]; });
        if(e.kind === 'grades') G.saveGrades(map); else G.saveStatuses(map);
      } else if(e.kind === 'removed'){
        e.items.forEach(function(x){ window.AAUP_REMOVED.setRemoved(prefix, slugOf(prefix, x.k), !!x.before); });
      } else if(e.kind === 'where'){
        e.items.forEach(function(x){
          var parts = String(x.before).split('|');
          window.AAUP_IMPORTED.persistCourseMove(prefix, x.k, prefix + '-y' + parts[0].replace(/^y/, '') + '-s' + String(parts[1]).replace(/^s/, ''));
        });
      }
    }catch(err){}
    l.splice(index, 1);
    m[prefix] = l;
    if(S()) S().setJSON(KEY, m);
    if(window.AAUP_IMPORTED && window.AAUP_IMPORTED.refresh) window.AAUP_IMPORTED.refresh(prefix);
    snap = take(prefix); snapPrefix = prefix;
    muted = false;
    render(prefix);
    if(window.__showToast) window.__showToast(ar() ? 'رجعت زي ما كانت' : 'Undone');
  }

  // ---- the window ----------------------------------------------------------
  function overlayEl(){
    var el = document.getElementById('historyOverlay');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'historyOverlay';
    el.className = 'modal-overlay';
    el.innerHTML = '<div class="modal-card hist-card" role="dialog" aria-modal="true" aria-labelledby="histTitle"><div class="modal-body" id="histBody"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function(e){
      if(e.target === el || e.target.closest('[data-hist-close]')){ el.classList.remove('open'); return; }
      var b = e.target.closest('[data-hist-undo]');
      if(b) undo(b.getAttribute('data-hist-prefix'), parseInt(b.getAttribute('data-hist-undo'), 10));
    });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') el.classList.remove('open'); });
    return el;
  }
  function render(prefix){
    var body = document.getElementById('histBody');
    if(!body) return;
    var r = ar(), l = list(prefix);
    body.innerHTML =
      '<div class="hist-head"><h2 class="mh" id="histTitle" style="margin:0;">' + window.AAUP_ICONS.preview('clock', 20) + (r ? 'آخر التغييرات' : 'Recent changes') + '</h2>' +
      '<button type="button" class="btn-quiet btn-sm" data-hist-close>' + (r ? 'إغلاق' : 'Close') + '</button></div>' +
      (l.length
        ? '<div class="hist-list">' + l.map(function(e, i){
            return '<div class="hist-row"><div class="hist-tx"><b>' + esc(describe(prefix, e, r)) + '</b><span>' + esc(ago(e.at, r)) + '</span></div>' +
              '<button type="button" class="btn-quiet btn-sm" data-hist-undo="' + i + '" data-hist-prefix="' + esc(prefix) + '">' + (r ? 'تراجع' : 'Undo') + '</button></div>';
          }).join('') + '</div>'
        : (window.__emptyState ? window.__emptyState({ icon: 'clock', title: r ? 'ما في تغييرات بعد' : 'No changes yet', text: r ? 'أي إشي بتغيّره بخطتك رح يظهر هون، ومعه تراجع.' : 'Anything you change on your plan shows here, with an Undo.' }) : ''));
  }
  function open(prefix){
    prefix = prefix || current();
    if(!prefix) return;
    check();
    overlayEl().classList.add('open');
    render(prefix);
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-pw-history]');
    if(b) open(b.getAttribute('data-pw-history'));
  });

  window.AAUP_HISTORY = { open: open, list: list };
})();
