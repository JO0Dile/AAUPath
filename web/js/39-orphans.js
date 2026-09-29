// ==========================
// LEFTOVER DATA AFTER A PLAN UPDATE
// ==========================
// Plans get corrected over time — a course is renamed, re-coded, split, or
// dropped. When that happens, anything the student already recorded against
// the OLD course (a grade, a note, assessment marks, a named elective) would
// otherwise point at a course that no longer exists.
//
// The rule here is: never delete it silently. It stays in storage exactly as
// they left it, and instead they get told — what it was, which plan it
// belonged to, and that it's theirs to keep, remove, or re-enter against
// whatever replaced it. Deleting a student's own record because the app
// changed underneath them is the one outcome this must never produce.
(function(){
  var DISMISS_KEY = 'aaup_orphanDismissed';

  // Every store keyed by a full course id (prefix-c-slug). Kept as data so a
  // future per-course store is one line, not a new code path to remember.
  function pidStores(){
    var stores = [
      { key: 'aaup_grades',              en: 'grade',                  ar: 'علامة' },
      { key: 'aaup_courseStatus',        en: 'planning status',        ar: 'حالة تخطيط' },
      { key: 'aaup_ratings',             en: 'difficulty/workload',    ar: 'تقييم الصعوبة' },
      { key: 'aaup_notes',               en: 'personal note',          ar: 'ملاحظة شخصية' },
      { key: 'aaup_customNames',         en: 'elective you named',     ar: 'اسم مادة اختيارية' },
      { key: 'aaup_removedCourses',      en: 'removed-from-plan mark', ar: 'مساق مُزال' },
      { key: 'aaup_assessmentBreakdown', en: 'assessment marks',       ar: 'علامات التقييم' },
      { key: 'aaup_passMarkOverride',    en: 'pass-mark setting',      ar: 'إعداد علامة النجاح' }
    ];
    if(window.__PROGRESS_STORAGE_KEY){
      stores.unshift({ key: window.__PROGRESS_STORAGE_KEY, en: 'completed tick', ar: 'إشارة الإكمال' });
    }
    return stores;
  }

  function readMap(key){
    try{ return JSON.parse(localStorage.getItem(key) || '{}') || {}; }
    catch(e){ return {}; }
  }
  function writeMap(key, m){
    try{ localStorage.setItem(key, JSON.stringify(m)); }catch(e){}
  }

  // A plan only gets judged once it has actually registered its courses.
  // A feed plan that simply hasn't synced yet must never have its data
  // called "leftover" — that's the false positive that would cause exactly
  // the data loss this module exists to prevent.
  function knownPlans(){
    var out = {};
    Object.keys(window.__PLAN_DATA || {}).forEach(function(prefix){
      var info = (window.__PLAN_DATA[prefix] || {}).courseInfo;
      if(info && Object.keys(info).length){ out[prefix] = info; }
    });
    return out;
  }

  function loadDismissed(){ return readMap(DISMISS_KEY); }
  function saveDismissed(m){ writeMap(DISMISS_KEY, m); }

  // Groups every orphaned entry by the course it belonged to, so the student
  // sees "Calculus I — grade, note, assessment marks" rather than eight
  // separate rows for one course.
  function scan(){
    var plans = knownPlans();
    var byPid = {};
    pidStores().forEach(function(store){
      var m = readMap(store.key);
      Object.keys(m).forEach(function(pid){
        var parts = window.__splitCourseId ? window.__splitCourseId(pid) : null;
        if(!parts) return;
        var info = plans[parts.prefix];
        if(!info) return;              // plan not loaded — say nothing
        if(info[parts.slug]) return;   // course still exists — fine
        if(!byPid[pid]){
          byPid[pid] = { pid: pid, prefix: parts.prefix, slug: parts.slug, kinds: [], values: {} };
        }
        byPid[pid].kinds.push(store);
        byPid[pid].values[store.key] = m[pid];
      });
    });
    var dismissed = loadDismissed();
    return Object.keys(byPid).map(function(pid){
      var o = byPid[pid];
      o.dismissed = !!dismissed[pid];
      return o;
    }).sort(function(a, b){ return a.pid.localeCompare(b.pid); });
  }

  function activeCount(){
    return scan().filter(function(o){ return !o.dismissed; }).length;
  }

  // "Keep" — stop nagging about it, but change nothing in storage. The data
  // stays exactly where it was and still exports with everything else.
  function keep(pid){
    var d = loadDismissed();
    d[pid] = true;
    saveDismissed(d);
  }
  function keepAll(){
    var d = loadDismissed();
    scan().forEach(function(o){ d[o.pid] = true; });
    saveDismissed(d);
  }

  // "Remove" — only ever on an explicit click, and only for this one course.
  function remove(pid){
    pidStores().forEach(function(store){
      var m = readMap(store.key);
      if(pid in m){ delete m[pid]; writeMap(store.key, m); }
    });
    var d = loadDismissed();
    delete d[pid];
    saveDismissed(d);
  }

  // A human label for something the app no longer has a course record for.
  // The student's own name for it is the best hint available; otherwise the
  // slug is shown, since that's all that's left of it.
  function labelFor(o){
    var names = readMap('aaup_customNames');
    if(names[o.pid] && String(names[o.pid]).trim()) return String(names[o.pid]);
    return o.slug;
  }

  function planLabel(prefix){
    if(window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.planDisplayInfo){
      try{ return window.AAUP_DASHBOARD.planDisplayInfo(prefix).name || prefix; }catch(e){}
    }
    return prefix;
  }

  // ---- Settings section ----
  function sectionHtml(r){
    var items = scan().filter(function(o){ return !o.dismissed; });
    if(!items.length) return '';
    var esc = window.__escapeHtml;
    var byPlan = {};
    items.forEach(function(o){ (byPlan[o.prefix] = byPlan[o.prefix] || []).push(o); });

    return '<h3 class="mh" style="margin:18px 0 6px;">' + window.AAUP_ICONS.preview('warning', 18) + (r ? 'بيانات من نسخة أقدم من الخطة' : 'Data from an older version of your plan') + '</h3>' +
      '<p class="form-note" style="margin-top:0;">' + (r
        ? 'حدّثنا هذه الخطط، وبعض المساقات التي سجّلت عليها بيانات لم تعد موجودة فيها. لم نحذف شيئًا — بياناتك ما زالت محفوظة كما تركتها. راجعها: إمّا أن تبقيها، أو تزيلها، أو تُدخلها من جديد على المساق الذي حلّ محلّها.'
        : 'These plans were updated, and some courses you recorded data against are no longer in them. Nothing was deleted — your data is still saved exactly as you left it. Review it: keep it, remove it, or re-enter it on whatever course replaced it.') + '</p>' +
      Object.keys(byPlan).map(function(prefix){
        return '<div class="orphan-plan">' +
          '<div class="orphan-plan-name">' + esc(planLabel(prefix)) + '</div>' +
          byPlan[prefix].map(function(o){
            var kinds = o.kinds.map(function(k){ return r ? k.ar : k.en; }).join(r ? '، ' : ', ');
            return '<div class="orphan-item">' +
              '<div class="orphan-text">' +
                '<b>' + esc(labelFor(o)) + '</b>' +
                '<span class="orphan-kinds">' + esc(kinds) + '</span>' +
              '</div>' +
              '<button type="button" class="home-btn orphan-keep" data-pid="' + esc(o.pid) + '">' + (r ? 'إبقاء' : 'Keep') + '</button>' +
              '<button type="button" class="home-btn orphan-remove" data-pid="' + esc(o.pid) + '">' + (r ? 'إزالة' : 'Remove') + '</button>' +
              '</div>';
          }).join('') +
          '</div>';
      }).join('') +
      '<div class="form-actions" style="justify-content:flex-start;">' +
        '<button type="button" class="home-btn" id="orphanKeepAll">' + (r ? 'إبقاء الكل وعدم التذكير' : 'Keep all, stop reminding me') + '</button>' +
      '</div>';
  }

  // onChange re-renders the settings body so the list reflects the click.
  function bindSection(root, onChange){
    if(!root) return;
    root.querySelectorAll('.orphan-keep').forEach(function(btn){
      btn.addEventListener('click', function(){ keep(btn.getAttribute('data-pid')); onChange(); });
    });
    root.querySelectorAll('.orphan-remove').forEach(function(btn){
      btn.addEventListener('click', function(){
        var pid = btn.getAttribute('data-pid');
        // rtl-mode is set on the plan page, never on <body> — so this was
        // always false and this screen was always English.
        var rtl = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
        // Round 7, idea 17: at once, with Undo (every store's value for it
        // is kept until the toast goes).
        var kept = pidStores().map(function(store){ var m = readMap(store.key); return { key: store.key, has: pid in m, v: m[pid] }; });
        remove(pid); onChange();
        var undo = function(){
          kept.forEach(function(k){ if(!k.has) return; var m = readMap(k.key); m[pid] = k.v; writeMap(k.key, m); });
          onChange();
        };
        if(window.__showActionToast) window.__showActionToast(rtl ? 'انشالت البيانات.' : 'Removed.', rtl ? 'تراجع' : 'Undo', undo);
      });
    });
    var all = root.querySelector('#orphanKeepAll');
    if(all){ all.addEventListener('click', function(){ keepAll(); onChange(); }); }
  }

  // Sitting quietly in Settings isn't enough — a student who doesn't go
  // looking would never learn their old records are stranded. One toast per
  // session (not per page view), offering the way straight to the review.
  var announced = false;
  function announce(){
    if(announced) return;
    var n = activeCount();
    if(!n) return;
    announced = true;
    var rtl = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
    var msg = rtl
      ? ('لديك بيانات على ' + n + ' مساق لم تعد موجودة في خطتك المحدّثة — لم نحذف شيئًا.')
      : ('You have saved data on ' + n + ' course' + (n === 1 ? '' : 's') + ' that your updated plan no longer has — nothing was deleted.');
    var label = rtl ? 'مراجعة' : 'Review';
    var openSettings = function(){
      if(window.AAUP_SIDEBAR && window.AAUP_SIDEBAR.openSettings){ window.AAUP_SIDEBAR.openSettings(); }
    };
    if(window.__showActionToast){ window.__showActionToast(msg, label, openSettings); }
    else if(window.__showToast){ window.__showToast(msg); }
  }

  window.AAUP_ORPHANS = {
    scan: scan, activeCount: activeCount,
    keep: keep, keepAll: keepAll, remove: remove,
    labelFor: labelFor, planLabel: planLabel,
    sectionHtml: sectionHtml, bindSection: bindSection,
    announce: announce
  };

  // Deferred: plans register their courses during load, and retakes replay
  // after that — scanning too early would flag courses that are about to
  // exist.
  function init(){ setTimeout(announce, 2500); }
  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }
})();
