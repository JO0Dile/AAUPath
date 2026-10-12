// ==========================
// WHAT'S NEXT
// ==========================
// Upgrades the "What Can I Take Next" card (js/36-dashboard.js) from a flat
// list of unlocked courses into a ranked one with a reason attached to each,
// plus a small simulation of what taking the top picks would do to overall
// progress.
//
// The flat list answered "what am I allowed to take" but not "which of these
// actually matters" — eight unlocked courses in file order gives no signal
// that one of them is the only thing standing between you and three more
// courses next year, and another is a free elective nothing depends on.
// Ranking by how much a course actually unlocks (and saying so) is the
// difference.
//
// Every number here is computed from data the app already trusts — the same
// unlocksMap prerequisite graph js/49-course-detail.js reads, and the same
// dept-elective-aware total/done arithmetic js/11-module11.js's progress bar
// uses. Nothing is estimated or fabricated: there is no way to know a future
// grade, so there is no GPA-effect figure here, only credit hours and counts
// that are true today.
(function(){
  'use strict';

  function esc(s){ return window.__escapeHtml(s == null ? '' : String(s)); }
  function isRtl(prefix){ return window.__isRtl ? window.__isRtl(prefix) : false; }
  function splitId(id){ return window.__splitCourseId ? window.__splitCourseId(id) : null; }

  var CAT_ORDER = ['skills', 'core', 'math', 'dept', 'eng', 'uni', 'free'];
  var CAT_LABEL = {
    en: { skills:'Skills', core:'Core', math:'Math', dept:'Department',
          eng:'English', uni:'University', free:'Free elective' },
    ar: { skills:'مهارات', core:'إجباري', math:'رياضيات', dept:'تخصص',
          eng:'إنجليزي', uni:'متطلب جامعة', free:'متطلب حر' }
  };

  var T = {
    en: {
      empty: 'Nothing new is unlocked yet — complete a few prerequisites first.',
      // 9 · Two different empty screens were sharing one sentence. A student
      // with nothing marked has not "completed a few prerequisites first" —
      // they have not started, and the thing to do about it is different.
      emptyNewTitle: 'Nothing to recommend yet',
      emptyNewBody: 'Tick the courses you have already passed and this fills with what they open, ranked by how much each one unlocks.',
      emptyNewAction: 'Open my plan',
      emptyStuckTitle: 'Nothing new is open to you',
      emptyStuckBody: 'Everything still ahead of you is waiting on a course you have not finished. The plan shows which one each is waiting for.',
      emptyStuckAction: 'Open my plan',
      ready: 'Ready now', opensN: function(n){ return 'Opens ' + n; },
      reasonMany: function(names, extra){
        return 'Unlocks ' + names + (extra ? ' and ' + extra + ' more' : '') + '.';
      },
      reasonNone: 'Nothing waits on it — but it still counts.',
      more: function(n){ return '+' + n + ' more available'; },
      ifYouTake: 'If you take these',
      barCh: 'Credit hours', barChSub: function(a,b){ return a + ' of ' + b + ' CH currently available'; },
      barDept: 'Department requirement', barDegree: 'Degree completion after', barLab: 'Courses with a lab',
      worth: 'Worth knowing',
      doNext: 'Do this next',
      // One line. This was two clauses explaining a ranking the card's own
      // "Opens N" tag already states.
      doNextWhy: function(name, n){
        return n ? ('Opens ' + n + ' more course' + (n === 1 ? '' : 's') + ' than anything else.')
                 : 'The strongest thing open to you right now.';
      },
      doNextAdd: 'Show me why',
      oweDept: function(n){ return 'You still need ' + n + ' more department elective hours.'; },
      oweFree: function(n){ return 'You still owe ' + n + ' free elective hours.'; },
      deadEnds: function(n){ return n + ' unlocked course' + (n === 1 ? '' : 's') + ' nothing depends on — fit in anytime.'; },
      onPlan: 'See the rest on your plan'
    },
    ar: {
      empty: 'لا توجد مساقات جديدة متاحة الآن — أكمل بعض المتطلبات السابقة أولاً.',
      emptyNewTitle: 'ما في توصيات بعد',
      emptyNewBody: 'علّم المساقات اللي خلّصتها ومنعبيلك هون اللي بتفتحه، مرتّبة حسب شو بتفتح كل وحدة.',
      emptyNewAction: 'افتح خطتي',
      emptyStuckTitle: 'ما في إشي جديد متاح إلك',
      emptyStuckBody: 'كل اللي قدامك مستني مساق ما خلّصته. الخطة بتوريك كل واحد مستني شو.',
      emptyStuckAction: 'افتح خطتي',
      ready: 'متاح الآن', opensN: function(n){ return 'يفتح ' + n; },
      reasonMany: function(names, extra){
        return 'يفتح المجال أمام ' + names + (extra ? ' و' + extra + ' أخرى' : '') + '.';
      },
      reasonNone: 'لا يوجد مساق آخر بانتظاره الآن، لكنه لا يزال يُحتسب ضمن الخطة.',
      more: function(n){ return '+' + n + ' مساقًا إضافيًا متاحًا'; },
      ifYouTake: 'إذا أخذت هذه المساقات',
      barCh: 'الساعات المعتمدة', barChSub: function(a,b){ return a + ' من ' + b + ' س.م المتاحة حالياً'; },
      barDept: 'متطلب التخصص الاختياري', barDegree: 'نسبة الإنجاز بعدها', barLab: 'مساقات بها مختبر',
      worth: 'يستحق المعرفة',
      doNext: 'ابدأ بهذا',
      doNextWhy: function(name, n){
        return n
          ? 'من بين كل المتاح لك، ' + name + ' يفتح أكبر قدر مما تبقّى — ' + n + ' مساقات.'
          : name + ' هو أقوى ما يمكنك أخذه الآن.';
      },
      doNextAdd: 'اعرض السبب',
      oweDept: function(n){ return 'ما زلت بحاجة إلى ' + n + ' ساعة تخصص اختياري إضافية.'; },
      oweFree: function(n){ return 'ما زلت مديناً بـ ' + n + ' ساعة متطلب حر.'; },
      deadEnds: function(n){ return n + ' مساقاً آخر متاحاً لا ينتظره أي مساق آخر — مناسب لأخذه في أي وقت يناسبك.'; },
      onPlan: 'اعرض الباقي على خطتك'
    }
  };

  // Same dept-elective-pool arithmetic js/11-module11.js's progress bar uses
  // (only that many .dept courses count toward "done", however many are
  // ticked), reimplemented here read-only so the simulation below can never
  // disagree with the bar the student is already looking at.
  function planTotals(prefix){
    var page = document.getElementById('page-' + prefix);
    if(!page) return null;
    var progress = window.__getProgress ? window.__getProgress() : {};
    var required = window.__DEPT_REQUIRED ? window.__DEPT_REQUIRED[prefix] : null;
    var courses = page.querySelectorAll('.course[id]:not(.course-removed)');
    var deptTotal = 0, deptDone = 0, otherTotal = 0, otherDone = 0;
    courses.forEach(function(el){
      var done = !!progress[el.id];
      if(el.classList.contains('dept')){ deptTotal++; if(done) deptDone++; }
      else { otherTotal++; if(done) otherDone++; }
    });
    var deptNeeded = (typeof required === 'number') ? required : deptTotal;
    return {
      total: otherTotal + deptNeeded,
      done: otherDone + Math.min(deptDone, deptNeeded),
      deptDone: deptDone, deptNeeded: deptNeeded
    };
  }

  function categoryOf(el){
    for(var i = 0; i < CAT_ORDER.length; i++){
      if(el.classList.contains(CAT_ORDER[i])) return CAT_ORDER[i];
    }
    return null;
  }

  // The unlocked-and-not-yet-taken courses, each carrying how many further
  // courses wait on it. window.__PLAN_DATA's unlocksMap is the same
  // prerequisite graph the course detail panel reads, so "opens 3" here and
  // the chips it links to are always describing the same edges.
  function candidates(prefix){
    var page = document.getElementById('page-' + prefix);
    if(!page) return [];
    var data = window.__PLAN_DATA[prefix] || {};
    var info = data.courseInfo || {};
    var progress = window.__getProgress ? window.__getProgress() : {};
    // "Available" on its own includes courses already passed — this list was
    // offering 5 finished courses out of 12 as things to take next, and the
    // "+N more available" / "x of y CH" numbers underneath counted them too.
    // Same shared definition the advisor uses: unlocked AND not yet passed.
    var els = window.__openCourses(prefix);

    return els.map(function(el){
      var parts = splitId(el.id);
      var meta = parts && info[parts.slug];
      var unlocks = (parts && data.unlocksMap && data.unlocksMap[parts.slug]) || [];
      // Only count what taking THIS course would still change today — a
      // dependent already passed some other way is not this course's doing.
      var stillWaiting = unlocks.filter(function(u){
        var uid = parts.prefix + '-c-' + u;
        return !progress[uid] && info[u];
      });
      return {
        id: el.id, prefix: parts ? parts.prefix : prefix, slug: parts ? parts.slug : null,
        name: meta ? meta.name : el.textContent.trim(),
        nameAr: meta ? meta.ar : '',
        code: meta ? meta.num : '',
        cr: meta ? (parseFloat(meta.cr) || 0) : 0,
        category: categoryOf(el),
        opens: stillWaiting.length,
        opensNames: stillWaiting.map(function(u){ return info[u] ? info[u].name : u; }),
        opensNamesAr: stillWaiting.map(function(u){ return info[u] ? (info[u].ar || info[u].name) : u; })
      };
    }).sort(function(a, b){
      if(b.opens !== a.opens) return b.opens - a.opens;
      if(b.cr !== a.cr) return b.cr - a.cr;
      return a.name.localeCompare(b.name);
    });
  }

  function reasonFor(c, rtl, t){
    if(!c.opens) return t.reasonNone;
    var names = rtl ? c.opensNamesAr : c.opensNames;
    // n is a course name straight from courseInfo, already HTML-escaped once
    // by the shared sanitizer when the plan was registered — esc()'ing it
    // again turned a real "&" into a literal "&amp;" on screen.
    // One name, not two. Two full course names plus "and N more" ran to a
    // three-line sentence on a phone card that already carries an "Opens N"
    // tag saying the same count.
    var shown = names.slice(0, 1).map(function(n){ return '<strong>' + n + '</strong>'; });
    var extra = names.length > 1 ? (names.length - 1) : 0;
    var joiner = rtl ? '، ' : ', ';
    return t.reasonMany(shown.join(joiner), extra || '');
  }

  function cardHTML(c, rtl, t, rank){
    var name = rtl && c.nameAr ? c.nameAr : c.name;
    var cat = c.category ? (CAT_LABEL[rtl ? 'ar' : 'en'][c.category] || '') : '';
    return '<button type="button" class="wn-card' + (rank === 0 ? ' is-top' : '') +
      '" data-wn-id="' + esc(c.id) + '">' +
      '<span class="wn-rank" aria-hidden="true">' + (rank + 1) + '</span>' +
      '<div class="wn-card-head"><h4>' + name + '</h4>' +
        (c.opens ? '<span class="wn-tag wn-tag-hot">' + esc(t.opensN(c.opens)) + '</span>' : '') + '</div>' +
      '<div class="wn-sub">' + [c.code, c.cr ? c.cr + ' CH' : '', cat].filter(Boolean).map(esc).join(' · ') + '</div>' +
      '<p class="wn-reason">' + reasonFor(c, rtl, t) + '</p>' +
      '</button>';
  }

  function chipHTML(c, rtl){
    var name = rtl && c.nameAr ? c.nameAr : c.name;
    return '<button type="button" class="next-course-chip" data-wn-id="' + esc(c.id) + '">' +
      '<span>' + name + '</span>' + (c.cr ? '<span class="ncc-cr">' + esc(window.__hrs(c.cr)) + '</span>' : '') +
      '</button>';
  }

  function bar(label, pct, sub){
    var p = Math.max(0, Math.min(100, pct));
    return '<div class="wn-bar-row"><div class="wn-bar-top"><span>' + label + '</span>' +
      (sub ? '<b>' + sub + '</b>' : '<b>' + Math.round(p) + '%</b>') + '</div>' +
      '<div class="wn-bar-track"><i style="width:' + p + '%"></i></div></div>';
  }

  // Four bars, matching the approved layout — but every denominator here is
  // something the app already has, not the mockup's "12-18 CH advised" (no
  // plan declares a recommended per-term load, so that number would have
  // been invented). Credit hours are measured against everything currently
  // available to pick from, not an assumed full course load; the lab count
  // reads the same theoretical/practical split js/49-course-detail.js's
  // Details panel already shows for a single course.
  function simulationHTML(prefix, top, list, totals, rtl, t){
    var deptRoomLeft = Math.max(0, totals.deptNeeded - totals.deptDone);
    var simDone = totals.done, deptUsed = 0, simCh = 0, labCount = 0;
    var info = ((window.__PLAN_DATA[prefix] || {}).courseInfo) || {};
    top.forEach(function(c){
      simCh += c.cr;
      if(c.category === 'dept'){
        if(deptUsed < deptRoomLeft){ simDone++; deptUsed++; }
      } else {
        simDone++;
      }
      var meta = c.slug && info[c.slug];
      if(meta && parseFloat(meta.pr) > 0) labCount++;
    });
    var beforePct = totals.total ? (totals.done / totals.total * 100) : 0;
    var afterPct = totals.total ? (Math.min(simDone, totals.total) / totals.total * 100) : 0;
    var availableCh = list.reduce(function(s, c){ return s + c.cr; }, 0) || 1;

    var deptStat = totals.deptNeeded
      ? bar(t.barDept, Math.min(100, (deptUsed + totals.deptDone) / totals.deptNeeded * 100))
      : '';

    // Closed by default. These two panels are worth a look, not worth
    // reading every time the dashboard opens — and stacked open under the
    // course cards they were most of the screen's text. Same tap-to-open
    // pattern the My Path categories and the Course Library shelves use.
    return '<div class="wn-panel wn-sim" data-wn-panel>' +
      '<button type="button" class="wn-lbl" aria-expanded="false">' + t.ifYouTake +
        '<span class="wn-lbl-chev" aria-hidden="true">\u203a</span></button>' +
      '<div class="wn-panel-body">' +
      bar(t.barCh, simCh / availableCh * 100, t.barChSub(simCh, availableCh)) +
      deptStat +
      bar(t.barDegree, afterPct, Math.round(beforePct) + '% → ' + Math.round(afterPct) + '%') +
      bar(t.barLab, top.length ? (labCount / top.length * 100) : 0, labCount + ' / ' + top.length) +
      '</div></div>';
  }

  // Real, checkable facts rather than the mockup's illustrative ones — an
  // elective-hours reminder from the same category totals js/51-gpa-studio.js
  // reads, and how many of the OTHER unlocked courses are dead ends (nothing
  // depends on them), which is exactly the "safe to take anytime" signal a
  // ranked list otherwise leaves implicit.
  function worthKnowingHTML(prefix, rest, rtl, t){
    var lines = [];
    if(window.AAUP_AUDIT && window.AAUP_AUDIT.computeAudit){
      window.AAUP_AUDIT.computeAudit(prefix).forEach(function(r){
        if(r.missing <= 0) return;
        if(r.cat === 'dept') lines.push(t.oweDept(r.missing));
        if(r.cat === 'free') lines.push(t.oweFree(r.missing));
      });
    }
    var deadEnds = rest.filter(function(c){ return !c.opens; }).length;
    if(deadEnds) lines.push(t.deadEnds(deadEnds));
    if(!lines.length) return '';
    return '<div class="wn-panel wn-worth" data-wn-panel>' +
      '<button type="button" class="wn-lbl" aria-expanded="false">' + t.worth +
        '<span class="wn-lbl-count">' + lines.length + '</span>' +
        '<span class="wn-lbl-chev" aria-hidden="true">\u203a</span></button>' +
      '<div class="wn-panel-body">' +
      lines.map(function(l){ return '<p class="wn-worth-line">' + esc(l) + '</p>'; }).join('') +
      '</div></div>';
  }

  var TOP_N = 3, TOTAL_CAP = 8;

  // containerId defaults to the sidebar panel this started in
  // (js/11-module11.js's "My Progress" card on the full study-plan page),
  // but the Dashboard — the screen every student actually lands on after
  // choosing a plan — has its OWN "What Can I Take Next" card with a
  // different id, and calls this directly rather than through the sidebar
  // hook below. Same function, same data, two mount points.
  // mode 'lead' renders only the single strongest recommendation, the two
  // collapsed panels, and a way onto the plan. The full ranked list — three
  // cards plus the chips — is what the plan already shows under "You are
  // here" (js/78-you-are-here.js) and what Plan My Next Semester shows in
  // full, so the Dashboard had it a third time. It does not any more: it
  // answers the question in one line and points at the screen where the
  // answer is acted on. The panels stay here because this is the only place
  // they exist.
  function render(prefix, containerId, mode){
    var lead_only = mode === 'lead';
    var body = document.getElementById(containerId || (prefix + '-nextCoursesBody'));
    if(!body) return;
    var rtl = isRtl(prefix);
    var t = T[rtl ? 'ar' : 'en'];
    var all = candidates(prefix);
    var list = all.slice(0, TOTAL_CAP);

    if(!list.length){
      // Has this student marked anything at all? That is what separates
      // "you have not started" from "you are blocked", and they need
      // different sentences and the same button.
      var progress = window.__getProgress ? window.__getProgress() : {};
      var started = Object.keys(progress).some(function(k){
        return progress[k] && k.indexOf(prefix + '-c-') === 0;
      });
      body.innerHTML = window.AAUP_EMPTY
        ? window.AAUP_EMPTY.card({
            rtl: rtl, icon: started ? 'lock' : 'planpin',
            title: started ? t.emptyStuckTitle : t.emptyNewTitle,
            body: started ? t.emptyStuckBody : t.emptyNewBody,
            action: started ? t.emptyStuckAction : t.emptyNewAction,
            onclick: "AAUP_DASHBOARD.openStudyPlan('" + prefix + "')"
          })
        : '<p class="ncp-empty">' + t.empty + '</p>';
      return;
    }

    var top = list.slice(0, TOP_N);
    var rest = list.slice(TOP_N);

    // One recommendation, first, in a sentence. The three stat tiles, the
    // ranked cards, the chips and the two meters below are all useful, but
    // none of them says what to do in the next five minutes — so a student
    // who opens the dashboard for thirty seconds leaves with nothing.
    var lead = top[0];
    var html = '';
    if(lead){
      var leadName = rtl && lead.nameAr ? lead.nameAr : lead.name;
      html += '<button type="button" class="wn-lead" data-wn-id="' + esc(lead.id) + '">' +
        '<span class="wn-lead-label">' + esc(t.doNext) + '</span>' +
        '<span class="wn-lead-name">' + leadName +
        (lead.cr ? ' <span class="wn-lead-cr">' + esc(window.__hrs(lead.cr)) + '</span>' : '') + '</span>' +
        '<span class="wn-lead-why">' + esc(t.doNextWhy(leadName, lead.opens || 0)) + '</span>' +
        '<span class="wn-lead-cta">' + esc(t.doNextAdd) + window.AAUP_ICONS.preview('chevronRight', 13) + '</span>' +
        '</button>';
    }
    if(!lead_only){
      html += '<div class="wn-cards">' +
        top.map(function(c, i){ return cardHTML(c, rtl, t, i); }).join('') + '</div>';

      if(rest.length){
        html += '<div class="next-courses-list wn-rest">' +
          rest.map(function(c){ return chipHTML(c, rtl); }).join('') + '</div>';
      }
      var overflow = all.length - list.length;
      if(overflow > 0){
        html += '<p class="ncp-empty" style="margin-top:8px;">' + esc(t.more(overflow)) + '</p>';
      }
    }

    // Both cards only mean something once there is a real total to compare
    // against — an imported plan with no page rendered has none.
    var totals = planTotals(prefix);
    if(totals && totals.total){
      html += '<div class="wn-grid">' +
        simulationHTML(prefix, top, list, totals, rtl, t) +
        worthKnowingHTML(prefix, rest, rtl, t) +
        '</div>';
    }

    if(lead_only){
      html += '<button type="button" class="home-btn wn-on-plan" data-wn-on-plan>' +
        esc(t.onPlan) + window.AAUP_ICONS.preview('chevronRight', 13) + '</button>';
    }

    body.innerHTML = html;

    var onPlanBtn = body.querySelector('[data-wn-on-plan]');
    if(onPlanBtn){
      onPlanBtn.addEventListener('click', function(){
        if(window.AAUP_DASHBOARD) window.AAUP_DASHBOARD.openStudyPlan(prefix);
      });
    }

    body.querySelectorAll('[data-wn-panel] > .wn-lbl').forEach(function(head){
      head.addEventListener('click', function(){
        var panel = head.parentElement;
        var open = panel.classList.toggle('wn-panel-open');
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });

    body.querySelectorAll('[data-wn-id]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-wn-id');
        var parts = splitId(id);
        if(!parts) return;
        if(window.__selectCourse){ window.__selectCourse(parts.prefix, parts.slug); }
        var el = document.getElementById(id);
        if(el){
          el.classList.add('jump-highlight');
          setTimeout(function(){ el.classList.remove('jump-highlight'); }, 2000);
        }
      });
    });
  }

  window.AAUP_WHATS_NEXT = { render: render };

  // js/11-module11.js calls renderNextCourses(prefix) on every progress
  // change; redirect it here rather than touching that file's own render
  // loop, so a module load order problem degrades to the old flat list
  // (still defined there) instead of a blank card.
  var tries = 0;
  (function patch(){
    if(window.__patchNextCoursesRenderer){ window.__patchNextCoursesRenderer(render); return; }
    if(tries++ > 40) return; // ~4s of retrying at 100ms, then give up quietly
    setTimeout(patch, 100);
  })();
})();
