// ==========================
// PLAN HEALTH — one grade for how the degree is going
//
// Pace, load balance and prerequisite risk are three things this app can
// already work out and nobody was reading separately. The dashboard led with
// a table of numbers — 54%, 2.97, 12/40 — and left the reader to decide what
// any of it meant. This leads with the judgement instead, and shows the three
// parts underneath so the judgement can be argued with.
//
// WHAT THIS IS AND IS NOT
// It is the app's own read of what the student has entered, against the
// advisory plan the university published. It is NOT an academic standing, not
// a registrar figure, and it is deliberately not called one anywhere in the
// UI. Nothing here is stored or sent; it is recomputed on every render from
// the same data the rest of the dashboard reads.
//
// THE THREE PARTS
//
// pace     — how much of what the plan schedules through the terms you have
//            started have you actually finished. Measured against the plan's
//            own sequence rather than a calendar, because the app does not
//            know the date you enrolled and will not guess at it.
//
// balance  — how evenly your own finished hours are spread across those
//            terms. A student alternating 21H and 9H is carrying the same
//            total as one doing 15H twice and having a much worse time.
//            Personal, not a property of the plan: two students on the same
//            plan get different balance scores.
//
// risk     — whether what is left still FITS. If four terms remain and
//            something is still five prerequisites deep, the plan cannot be
//            finished on time no matter how well the other two are going, and
//            that is the single most useful thing this screen can say.
//
// Each scores 2 (good), 1 (watch) or 0 (problem); the six-point total maps to
// a letter. A student with nothing marked gets no grade at all — see
// emptyHtml(), which asks for the one action that produces one.
// ==========================
(function(){
  'use strict';

  var GRADES = [
    { min: 6, letter: 'A',  en: 'on track',            ar: 'ماشي تمام' },
    { min: 5, letter: 'A-', en: 'on track',            ar: 'ماشي تمام' },
    { min: 4, letter: 'B+', en: 'mostly on track',     ar: 'ماشي بمعظمه' },
    { min: 3, letter: 'B',  en: 'watch one thing',     ar: 'انتبه لإشي واحد' },
    { min: 2, letter: 'C+', en: 'two things to fix',   ar: 'إشيين بدهم ترتيب' },
    { min: 1, letter: 'C',  en: 'behind the plan',     ar: 'متأخر عن الخطة' },
    { min: 0, letter: 'D',  en: 'well behind the plan', ar: 'متأخر كثير عن الخطة' }
  ];

  function tx(rtl, en, ar){ return rtl ? ar : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s == null ? '' : s)) : String(s); }

  // ---------------------------------------------------------------------
  // The plan, term by term, with the plan's hours and the student's.
  function terms(prefix){
    var plans = window.AAUP_IMPORTED ? window.AAUP_IMPORTED.loadImportedPlans() : {};
    var plan = plans[prefix];
    if(!plan || !plan.structure || !Array.isArray(plan.structure.years)) return null;
    var progress = window.__getProgress ? window.__getProgress() : {};
    var out = [];
    plan.structure.years.forEach(function(y, i){
      ['s1', 's2'].concat(y.hasSummer ? ['s3'] : []).forEach(function(sem){
        var here = (plan.courses || []).filter(function(c){
          return c.yearId === y.id && c.semester === sem;
        });
        if(!here.length) return;
        var planned = 0, mine = 0;
        here.forEach(function(c){
          var h = parseFloat(c.creditHours) || 0;
          planned += h;
          if(progress[prefix + '-c-' + c.id]) mine += h;
        });
        out.push({ yearNum: i + 1, sem: sem, planned: planned, mine: mine });
      });
    });
    return out.length ? out : null;
  }

  // ---------------------------------------------------------------------
  // pace: finished hours against what the plan schedules through the last
  // term you have touched. "Touched", not "reached by date" — the app has no
  // enrolment date and inventing one would make this number a guess.
  function pace(ts){
    var last = -1;
    ts.forEach(function(t, i){ if(t.mine > 0) last = i; });
    if(last < 0) return null;
    var scheduled = 0, done = 0;
    for(var i = 0; i <= last; i++){ scheduled += ts[i].planned; done += ts[i].mine; }
    if(!scheduled) return null;
    var ratio = done / scheduled;
    return {
      ratio: ratio,
      score: ratio >= 0.95 ? 2 : ratio >= 0.8 ? 1 : 0,
      done: done, scheduled: scheduled, through: last + 1
    };
  }

  // balance: how evenly your finished hours sit across the terms you have
  // worked through. Spread is measured against your own mean, so it says
  // nothing about whether you are carrying a lot — only about whether the
  // amount keeps changing. Terms with nothing finished are included: a term
  // you sat out IS the unevenness.
  function balance(ts){
    var last = -1;
    ts.forEach(function(t, i){ if(t.mine > 0) last = i; });
    if(last < 1) return null;                       // one term has no spread
    var mine = ts.slice(0, last + 1).map(function(t){ return t.mine; });
    var mean = mine.reduce(function(a, b){ return a + b; }, 0) / mine.length;
    if(mean <= 0) return null;
    var variance = mine.reduce(function(a, h){ return a + (h - mean) * (h - mean); }, 0) / mine.length;
    var cv = Math.sqrt(variance) / mean;            // coefficient of variation
    // A third of the mean is roughly one course's worth of swing on a normal
    // 15H term — normal. Two thirds is a term twice the size of another.
    return {
      cv: cv, mean: mean,
      score: cv <= 0.33 ? 2 : cv <= 0.66 ? 1 : 0,
      worst: worstTerm(ts.slice(0, last + 1), mean)
    };
  }

  function worstTerm(ts, mean){
    var w = null;
    ts.forEach(function(t){
      var d = Math.abs(t.mine - mean);
      if(!w || d > w.d) w = { d: d, yearNum: t.yearNum, sem: t.sem, mine: t.mine };
    });
    return w;
  }

  // risk: does what is left still fit in the terms that are left? Depth is
  // the longest chain of not-yet-finished prerequisites in front of a course
  // (js/28-imported.js chainDepth), which is exactly the number of terms it
  // still needs, so comparing the two is a like-for-like check.
  function risk(prefix, ts){
    if(!window.AAUP_IMPORTED || !window.AAUP_IMPORTED.chainDepth) return null;
    var progress = window.__getProgress ? window.__getProgress() : {};
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    var last = -1;
    ts.forEach(function(t, i){ if(t.mine > 0) last = i; });
    var termsLeft = ts.length - (last + 1);
    var deepest = 0, deepestSlug = '';
    Object.keys(info).forEach(function(slug){
      if(progress[prefix + '-c-' + slug]) return;
      var d = window.AAUP_IMPORTED.chainDepth(prefix, slug);
      if(d > deepest){ deepest = d; deepestSlug = slug; }
    });
    // Depth 0 courses can all be taken in the next term, so a plan whose
    // remaining work is all depth 0 fits in one term however much of it
    // there is — depth is about ORDER, and the hours are what pace measures.
    var needs = deepest + 1;                        // terms this chain still takes
    return {
      deepest: deepest, slug: deepestSlug, termsLeft: termsLeft, needs: needs,
      score: termsLeft <= 0 ? (deepest === 0 ? 2 : 0)
           : needs < termsLeft ? 2 : needs === termsLeft ? 1 : 0
    };
  }

  // ---------------------------------------------------------------------
  function compute(prefix){
    var ts = terms(prefix);
    if(!ts) return null;
    var p = pace(ts), b = balance(ts), r = risk(prefix, ts);
    if(!p) return null;                             // nothing marked: no grade
    // A single-term student has no balance to measure. Scoring the missing
    // part as good would inflate the grade, so the total is taken over the
    // parts that exist and scaled — a two-part grade is still a grade.
    var parts = [p, b, r].filter(Boolean);
    var got = parts.reduce(function(a, x){ return a + x.score; }, 0);
    var max = parts.length * 2;
    var six = Math.round(got / max * 6);
    var g = GRADES.filter(function(x){ return six >= x.min; })[0] || GRADES[GRADES.length - 1];
    return { grade: g, pace: p, balance: b, risk: r, terms: ts };
  }

  // ---------------------------------------------------------------------
  // Each part as a sentence saying what it means for the student, with a
  // coloured dot for how it is going. The chips this replaced ("pace",
  // "prereq risk") named the measurement and left the meaning to the reader.
  var SEM_EN = { s1: 'first semester', s2: 'second semester', s3: 'summer' };
  var SEM_AR = { s1: 'الفصل الأول', s2: 'الفصل الثاني', s3: 'الصيفي' };

  function courseName(prefix, slug, rtl){
    var info = (((window.__PLAN_DATA || {})[prefix] || {}).courseInfo || {})[slug] || {};
    if(rtl && info.ar) return info.ar;
    var plan = window.AAUP_IMPORTED ? window.AAUP_IMPORTED.loadImportedPlans()[prefix] : null;
    var c = plan && (plan.courses || []).filter(function(x){ return x.id === slug; })[0];
    return (c && c.name) || slug;
  }

  function line(score, text, action){
    var cls = score === 2 ? 'good' : score === 1 ? 'watch' : 'bad';
    return '<li class="ph-line ph-line-' + cls + '"><span class="ph-dot" aria-hidden="true"></span>' +
      '<span class="ph-text">' + text + '</span>' + (action || '') + '</li>';
  }

  function linesHtml(prefix, h, rtl){
    var out = [];
    var p = h.pace;
    var done = Math.round(p.done), sch = Math.round(p.scheduled);
    out.push(line(p.score, p.score === 2
      ? esc(tx(rtl, 'You’re keeping pace: ' + done + ' of the ' + sch + ' hours planned so far are done.',
                    'ماشي على الخطة: خلّصت ' + done + ' من ' + sch + ' ساعة مخططة لحد هلأ.'))
      : esc(tx(rtl, 'You’re behind the plan: ' + done + ' of the ' + sch + ' hours planned so far are done.',
                    'متأخر عن الخطة: خلّصت ' + done + ' من ' + sch + ' ساعة مخططة لحد هلأ.'))));
    var b = h.balance;
    if(b){
      var w = b.worst;
      var where = w ? tx(rtl, 'Year ' + w.yearNum + ' ' + SEM_EN[w.sem], SEM_AR[w.sem] + ' بالسنة ' + w.yearNum) : '';
      out.push(line(b.score, b.score === 2
        ? esc(tx(rtl, 'Your load is even from one semester to the next.', 'حملك متوازن من فصل لفصل.'))
        : esc(tx(rtl, 'Your load jumps around. ' + where + ' had ' + Math.round(w.mine) + ' hours, far from your usual ' + Math.round(b.mean) + '.',
                      'حملك مش ثابت. ' + where + ' كان فيه ' + Math.round(w.mine) + ' ساعة، بعيد عن معدلك ' + Math.round(b.mean) + '.'))));
    }
    var r = h.risk;
    if(r){
      if(r.score === 2 || !r.slug){
        out.push(line(r.score, esc(tx(rtl, 'Everything left still fits in the semesters you have.',
                                           'كل اللي باقي بيزبط بالفصول اللي ضايلة.'))));
      } else {
        var nm = '<b>' + esc(courseName(prefix, r.slug, rtl)) + '</b>';
        out.push(line(r.score, tx(rtl,
          nm + ' is at the end of a chain of ' + r.needs + ' semesters, and ' + r.termsLeft + ' are left. Start its chain next semester or you’ll finish late.',
          nm + ' آخر سلسلة طولها ' + r.needs + ' فصول، وضايل ' + r.termsLeft + '. ابدأ سلسلته الفصل الجاي وإلا رح تتأخر بالتخرج.'),
          '<button type="button" class="ph-act" data-ph-course="' + esc(prefix) + '|' + esc(r.slug) + '">' + esc(tx(rtl, 'See it', 'شوفه')) + '</button>'));
      }
    }
    return '<ul class="ph-lines">' + out.join('') + '</ul>';
  }

  // The block on the dashboard. Returns '' when there is nothing to grade —
  // the caller shows the empty state instead.
  function cardHtml(prefix, rtl){
    var h = compute(prefix);
    if(!h) return '';
    return '<div class="dash-card ph-card">' +
      '<div class="ph-head">' +
        '<span class="ph-grade">' + esc(h.grade.letter) + '</span>' +
        '<span class="ph-head-text">' +
          '<span class="ph-lbl">' + tx(rtl, 'plan health', 'حالة الخطة') + '</span>' +
          '<span class="ph-verdict">' + esc(tx(rtl, h.grade.en, h.grade.ar)) + '</span>' +
        '</span>' +
      '</div>' +
      linesHtml(prefix, h, rtl) +
      '<p class="ph-note">' + tx(rtl,
        'This app’s own read of what you have entered, against the published advisory plan — not an academic standing.',
        'قراءة التطبيق لما أدخلته أنت، مقابل الخطة الإرشادية المنشورة — مش تقييم أكاديمي رسمي.') +
      '</p></div>';
  }

  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-ph-course]');
    if(!b || !window.AAUP_IMPORTED) return;
    var parts = b.getAttribute('data-ph-course').split('|');
    window.AAUP_IMPORTED.openCourseModal(parts[0], parts[1]);
  });

  window.AAUP_PLAN_HEALTH = { compute: compute, cardHtml: cardHtml };
})();
