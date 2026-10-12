// ==========================
// WHAT-IF GPA — "my grade is C+, my new grade is A-".
//
// Two questions students actually ask, and the app could answer neither:
//   1. if I retake this course and get a better grade, what does my GPA
//      become?
//   2. if I take these courses next semester and get these grades, what does
//      my GPA become?
// and the one behind both of them: what would I have to average to reach the
// GPA I want?
//
// Nothing here recomputes the GPA itself. It hands a scenario to
// AAUP_GPA.gpaFor — the same function the dashboard and the Degree Audit
// use — so the "now" and the "if" numbers can never be computed by two
// different sets of rules. That includes AAUP's repeat policy: a retake with
// a grade replaces the original in the cumulative, and this screen inherits
// that rather than restating it.
//
// It changes nothing. No grade is saved, no course is ticked; closing the
// screen throws the scenario away.
// ==========================
(function(){
  'use strict';

  var TX = {
    title:   { en: 'What if…', ar: 'ماذا لو…' },
    lead:    { en: 'Try a retake, or plan next semester’s grades, and watch what your GPA does. Nothing here is saved — it is a sandbox.',
               ar: 'جرّب إعادة مساق، أو خطّط علامات الفصل الجاي، وشوف شو بصير بمعدلك. ما بينحفظ إشي — هاي مساحة تجربة.' },
    now:     { en: 'Now', ar: 'الآن' },
    ifThis:  { en: 'If this happens', ar: 'لو صار هيك' },
    noGpa:   { en: 'no grades yet', ar: 'ما في علامات بعد' },
    retake:  { en: 'Retake a course', ar: 'إعادة مساق' },
    retakeIcon: 'refresh',
    retakeLead: { en: 'Your graded courses, worst first. A retake’s grade replaces the original in the cumulative GPA.',
               ar: 'مساقاتك اللي إلها علامات، الأسوأ أولًا. علامة الإعادة بتحلّ محل الأصلية بالمعدل التراكمي.' },
    next:    { en: 'Next semester', ar: 'الفصل القادم' },
    nextIcon: 'book',
    nextLead:{ en: 'The courses in your semester plan. Give each one the grade you are aiming for.',
               ar: 'مساقات خطة فصلك. اعطِ كل واحد العلامة اللي بتستهدفها.' },
    nextEmpty:{ en: 'Nothing picked yet — build a semester in “Plan My Next Semester” and it shows up here.',
               ar: 'ما اخترت إشي — جهّز فصلك من «خطط لفصلي القادم» وبيظهر هون.' },
    target:  { en: 'Reach a GPA', ar: 'توصل لمعدل' },
    targetIcon: 'target',
    targetLead: { en: 'What you would have to average across the courses above to land on this.',
               ar: 'شو لازم يكون متوسطك بالمساقات فوق حتى توصل لهالرقم.' },
    keep:    { en: 'keep', ar: 'خليها' },
    nograde: { en: '— no grade —', ar: '— بلا علامة —' },
    reset:   { en: 'Clear the scenario', ar: 'امسح التجربة' },
    counted: { en: '{n}H counted', ar: '{n} ساعة محسوبة' },
    needAvg: { en: 'You would need about a {g} average across those {n}H.',
               ar: 'بدك متوسط حوالي {g} على هالـ {n} ساعة.' },
    needAll: { en: 'Even straight A’s in those {n}H would land you at {gpa} — this target needs more hours than you have planned.',
               ar: 'حتى لو أخذت A بكل الـ {n} ساعة رح توصل {gpa} — هذا الهدف بدو ساعات أكثر من اللي مخطط إلها.' },
    already: { en: 'You are already above that.', ar: 'أنت أصلًا فوق هذا الرقم.' },
    needNone:{ en: 'Pick some courses above first — a target needs hours to work with.',
               ar: 'اختر مساقات فوق الأول — الهدف بدو ساعات يشتغل عليها.' },
    more:    { en: 'Show all {n} graded courses', ar: 'اعرض كل الـ {n} مساق' },
    less:    { en: 'Show fewer', ar: 'اعرض أقل' }
  };
  function t(k, r){ return r ? TX[k].ar : TX[k].en; }
  function esc(s){
    var v = String(s == null ? '' : s);
    if(window.__cleanText) return window.__cleanText(v);
    return window.__escapeHtml ? window.__escapeHtml(v) : v;
  }

  // The scenario: which graded courses get a different grade, and which
  // planned courses get one at all. Memory only, thrown away on close.
  var retakes = {};     // pid -> grade
  var planned = {};     // pid -> grade
  var target = 3.0;
  var current = null;   // the plan this scenario belongs to
  // A student in their last year has fifty graded courses, and a list of
  // fifty pushes everything else off the screen. The worst few are the ones
  // anyone retakes, so show those and let the rest be asked for.
  var RETAKE_SHOWN = 8;
  var showAllRetakes = false;

  function gradeOptions(sel, rtl, keepLabel){
    var order = window.AAUP_GPA.GRADE_ORDER.filter(function(g){
      return window.AAUP_GPA.GRADE_POINTS[g] !== undefined;   // W has no points
    });
    return '<option value="">' + esc(keepLabel) + '</option>' +
      order.map(function(g){
        return '<option value="' + g + '"' + (sel === g ? ' selected' : '') + '>' + g +
          ' (' + window.AAUP_GPA.GRADE_POINTS[g].toFixed(2) + ')</option>';
      }).join('');
  }

  // Every graded course on this plan, worst grade first — the order a
  // student actually reads this list in.
  function gradedCourses(prefix){
    var page = document.getElementById('page-' + prefix);
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    var grades = window.AAUP_GPA.loadGrades();
    var progress = window.__getProgress();
    if(!page) return [];
    var seen = {}, out = [];
    page.querySelectorAll('.course[id]:not(.course-removed)').forEach(function(el){
      var parts = window.__splitCourseId(el.id);
      if(!parts) return;
      var meta = info[parts.slug];
      if(!meta) return;
      var pid = window.AAUP_GPA.primaryId(prefix, parts.slug);
      if(pid !== el.id) return;
      if(seen[pid]) return;
      seen[pid] = true;
      if(!progress[pid]) return;
      var g = grades[pid];
      if(!window.AAUP_GPA.isRealGrade(g)) return;
      out.push({ pid: pid, name: meta.name || meta.ar || parts.slug, ar: meta.ar || '',
                 cr: parseFloat(meta.cr) || 0, grade: g });
    });
    return out.sort(function(a, b){
      return window.AAUP_GPA.GRADE_POINTS[a.grade] - window.AAUP_GPA.GRADE_POINTS[b.grade];
    });
  }

  // What the semester builder is currently holding, so the two screens are
  // one plan rather than two lists that disagree.
  function plannedCourses(prefix){
    if(!window.AAUP_ADVISOR || !window.AAUP_ADVISOR.picked) return [];
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    return window.AAUP_ADVISOR.picked(prefix).map(function(slug){
      var meta = info[slug] || {};
      return { pid: prefix + '-c-' + slug, slug: slug,
               name: meta.name || meta.ar || slug, ar: meta.ar || '',
               cr: parseFloat(meta.cr) || 0 };
    });
  }

  function scenario(){
    var replace = {};
    Object.keys(retakes).forEach(function(pid){ if(retakes[pid]) replace[pid] = retakes[pid]; });
    Object.keys(planned).forEach(function(pid){ if(planned[pid]) replace[pid] = planned[pid]; });
    return { replace: replace };
  }

  function figures(prefix){
    var nowGpa = window.AAUP_GPA.gpaFor(prefix);
    var ifGpa = window.AAUP_GPA.gpaFor(prefix, null, scenario());
    return { now: nowGpa, next: ifGpa };
  }

  function fmt(g){ return (g == null || !isFinite(g)) ? '—' : g.toFixed(2); }

  // ---- the target maths ---------------------------------------------------
  // Everything the scenario does NOT already fix is held constant, and the
  // hours the student is planning are the only lever. Solve for the average
  // grade point those hours need to carry.
  function targetAdvice(prefix, rtl){
    var pl = plannedCourses(prefix);
    var hours = pl.reduce(function(s, c){ return s + c.cr; }, 0);
    if(!hours) return '<p class="wi-msg">' + t('needNone', rtl) + '</p>';

    // The base is the scenario WITHOUT the planned courses: their grades are
    // the unknown being solved for. The formula itself now lives in
    // AAUP_GPA.neededAverage — shared with the Degree Audit's own target
    // box, so the two screens can never quietly disagree.
    var base = window.AAUP_GPA.gpaFor(prefix, null, { replace: onlyRetakes() });
    var basePoints = (base.gpa || 0) * base.credits;
    var need = window.AAUP_GPA.neededAverage(basePoints, base.credits, hours, target);
    var d = window.AAUP_GPA.describeNeeded(need, hours, basePoints, base.credits);

    if(d.status === 'already'){
      return '<p class="wi-msg wi-ok">' + t('already', rtl) + '</p>';
    }
    if(d.status === 'impossible'){
      return '<p class="wi-msg wi-warn">' + t('needAll', rtl)
        .replace('{n}', hours).replace('{gpa}', fmt(d.bestCase)) + '</p>';
    }
    // d.status === 'reachable' — named as a letter, so the answer reads
    // "a B+ average", not "3.19 grade points".
    return '<p class="wi-msg">' + t('needAvg', rtl)
      .replace('{g}', d.letter + ' (' + d.need.toFixed(2) + ')').replace('{n}', hours) + '</p>';
  }
  function onlyRetakes(){
    var out = {};
    Object.keys(retakes).forEach(function(pid){ if(retakes[pid]) out[pid] = retakes[pid]; });
    return out;
  }

  // ---- rendering ----------------------------------------------------------
  function headHtml(prefix, rtl){
    var f = figures(prefix);
    var delta = (f.now.gpa != null && f.next.gpa != null) ? (f.next.gpa - f.now.gpa) : null;
    var cls = delta == null || Math.abs(delta) < 0.005 ? '' : delta > 0 ? ' wi-up' : ' wi-down';
    return '<div class="wi-head' + cls + '">' +
      '<div class="wi-fig"><span>' + t('now', rtl) + '</span><b>' + fmt(f.now.gpa) + '</b>' +
        '<small>' + t('counted', rtl).replace('{n}', f.now.credits) + '</small></div>' +
      '<div class="wi-arrow' + (rtl ? ' wi-arrow-rtl' : '') + '" aria-hidden="true">' + window.AAUP_ICONS.preview('chevronRight', 18) + '</div>' +
      '<div class="wi-fig"><span>' + t('ifThis', rtl) + '</span><b>' + fmt(f.next.gpa) + '</b>' +
        '<small>' + (delta == null ? t('noGpa', rtl)
          : (delta >= 0 ? '+' : '') + delta.toFixed(2)) + '</small></div>' +
      '</div>';
  }

  function rowHtml(c, kind, value, rtl, keepLabel){
    return '<label class="wi-row">' +
      '<span class="wi-row-name">' + esc(rtl ? (c.ar || c.name) : c.name) + '</span>' +
      '<span class="wi-row-cr">' + window.__hrs(c.cr) + '</span>' +
      (c.grade ? '<span class="wi-row-old">' + esc(c.grade) + '</span>' : '') +
      '<select class="wi-sel" data-wi-kind="' + kind + '" data-wi-pid="' + esc(c.pid) + '">' +
        gradeOptions(value, rtl, keepLabel) + '</select>' +
      '</label>';
  }

  // Where this screen draws. Its own overlay when opened on its own, or the
  // Degree Audit's body when the audit hosts it as a mode — see idea 17:
  // what-if and the audit are both about one number, so what-if stopped
  // being a destination of its own and became the audit's other mode.
  var hostId = 'whatifBody';
  var hosted = false;

  function render(prefix){
    var body = document.getElementById(hostId);
    if(!body) return;
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    var graded = gradedCourses(prefix);
    var pl = plannedCourses(prefix);

    body.innerHTML =
      // Hosted inside the audit, the back bar and the title belong to the
      // screen around it; on its own it still carries both.
      (hosted ? '' :
        (window.__backBarHTML ? window.__backBarHTML('', 'whatifOverlay', rtl) : '') +
        '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('target', 20) + t('title', rtl) + '</h2>') +
      '<p class="form-note" style="margin-top:0;">' + t('lead', rtl) + '</p>' +
      '<div id="wiHead">' + headHtml(prefix, rtl) + '</div>' +
      '<h3 class="wi-h3">' + window.AAUP_ICONS.preview('refresh', 16) + t('retake', rtl) + '</h3>' +
      '<p class="form-note" style="margin-top:0;">' + t('retakeLead', rtl) + '</p>' +
      (graded.length
        ? '<div class="wi-list">' +
          (showAllRetakes ? graded : graded.slice(0, RETAKE_SHOWN)).map(function(c){
            return rowHtml(c, 'retake', retakes[c.pid] || '', rtl, t('keep', rtl));
          }).join('') + '</div>' +
          (graded.length > RETAKE_SHOWN
            ? '<button type="button" class="wi-more" id="wiMore">' +
              (showAllRetakes ? t('less', rtl) : t('more', rtl).replace('{n}', graded.length)) +
              '</button>'
            : '')
        : '<p class="wi-msg">' + t('noGpa', rtl) + '</p>') +
      '<h3 class="wi-h3">' + window.AAUP_ICONS.preview('book', 16) + t('next', rtl) + '</h3>' +
      '<p class="form-note" style="margin-top:0;">' + t('nextLead', rtl) + '</p>' +
      (pl.length
        ? '<div class="wi-list">' + pl.map(function(c){
            return rowHtml(c, 'planned', planned[c.pid] || '', rtl, t('nograde', rtl));
          }).join('') + '</div>'
        : '<p class="wi-msg">' + t('nextEmpty', rtl) + '</p>') +
      '<h3 class="wi-h3">' + window.AAUP_ICONS.preview('target', 16) + t('target', rtl) + '</h3>' +
      '<p class="form-note" style="margin-top:0;">' + t('targetLead', rtl) + '</p>' +
      '<div class="wi-target">' +
        '<input type="number" id="wiTarget" min="0" max="4" step="0.05" value="' + target + '">' +
        '<div id="wiAdvice">' + targetAdvice(prefix, rtl) + '</div>' +
      '</div>' +
      '<div class="wi-actions"><button type="button" class="home-btn" id="wiReset">' +
        window.AAUP_ICONS.preview('undo', 14) + t('reset', rtl) + '</button></div>';

    bindBody(prefix, rtl);
  }

  function refresh(prefix, rtl){
    var head = document.getElementById('wiHead');
    var advice = document.getElementById('wiAdvice');
    if(head) head.innerHTML = headHtml(prefix, rtl);
    if(advice) advice.innerHTML = targetAdvice(prefix, rtl);
  }

  function bindBody(prefix, rtl){
    var body = document.getElementById(hostId);
    if(!body) return;
    body.querySelectorAll('.wi-sel').forEach(function(sel){
      sel.addEventListener('change', function(){
        var pid = sel.getAttribute('data-wi-pid');
        var bag = sel.getAttribute('data-wi-kind') === 'retake' ? retakes : planned;
        if(sel.value) bag[pid] = sel.value; else delete bag[pid];
        refresh(prefix, rtl);
      });
    });
    var tg = document.getElementById('wiTarget');
    if(tg){
      tg.addEventListener('input', function(){
        var v = parseFloat(tg.value);
        target = (isFinite(v) && v >= 0 && v <= 4) ? v : target;
        refresh(prefix, rtl);
      });
    }
    var more = document.getElementById('wiMore');
    if(more) more.addEventListener('click', function(){
      showAllRetakes = !showAllRetakes;
      render(prefix);
    });
    var reset = document.getElementById('wiReset');
    if(reset){
      reset.addEventListener('click', function(){
        retakes = {}; planned = {};
        render(prefix);
      });
    }
  }

  function open(prefix){
    var overlay = document.getElementById('whatifOverlay');
    if(!overlay) return;
    hostId = 'whatifBody'; hosted = false;
    if(current !== prefix){ retakes = {}; planned = {}; current = prefix; }
    render(prefix);
    overlay.classList.add('open');
  }

  // Draw the same screen into somebody else's element. The scenario (which
  // retakes, which planned grades, the target) is the module's own state, so
  // it survives switching back and forth between the audit's two modes.
  function mount(prefix, elId){
    if(!document.getElementById(elId)) return;
    hostId = elId; hosted = true;
    if(current !== prefix){ retakes = {}; planned = {}; current = prefix; }
    render(prefix);
  }

  function bind(){
    var overlay = document.getElementById('whatifOverlay');
    if(!overlay) return;
    var close = function(){ overlay.classList.remove('open'); };
    var btn = document.getElementById('whatifClose');
    if(btn) btn.addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && overlay.classList.contains('open')) close();
    });
    var card = overlay.querySelector('.modal-card');
    if(card) card.addEventListener('click', function(e){ e.stopPropagation(); });
  }
  if(document.readyState === 'complete'){ bind(); }
  else { window.addEventListener('load', bind); }

  window.AAUP_WHATIF = { open: open, mount: mount };
})();
