// ==========================
// COURSE DETAIL
// ==========================
// The panel that opens when a course is tapped, anywhere in the app.
//
// What it replaced was a list of six label/value rows — course number, name,
// credit hours, prerequisite, theoretical, practical — and then the grade
// controls. Every fact was there and none of it answered the question a
// student actually opens a course to ask, which is never "how many theoretical
// hours is this". It is "can I take this, and what happens if I don't".
//
// The prerequisite row was the worst of it. It printed the names of the
// courses this one needs, with no indication of whether you had passed them,
// so the one field that decides whether the course is even available to you
// was the one you had to work out yourself.
//
// So the panel leads with the answer, in one sentence (round 7, idea 15):
//
//   "You can take this now: Calculus I ✓ is passed. It opens …"
//   Status and grade            — unchanged, still js/21-course-modal-extras.js
//   Prerequisites and what it opens   } folded, one tap to open
//   Student thoughts                  }
//   Details (number, hours…)          }
//
// It renders the same on a phone and a desktop.
//
// This module only builds markup and answers questions about state. It stores
// nothing and decides nothing: grades, progress and prerequisites all stay
// where they were (js/11-module11.js, js/21-course-modal-extras.js,
// js/02-shared-cross.js), because those are load-bearing and this is a view.
(function(){
  'use strict';

  function esc(s){ return window.__escapeHtml(s == null ? '' : String(s)); }

  var L = {
    en: {
      why: 'Why you can take this now',
      whyLocked: 'Why this is locked',
      whyDone: 'You have passed this',
      opens: 'What it opens',
      noOpens: 'Nothing else in this plan waits on it.',
      noNeeds: 'No prerequisites — you can take this in any term it is offered.',
      details: 'Details',
      ch: 'Credit hours', chShort: 'CH', th: 'Theoretical', pr: 'Practical',
      cat: 'Category', ar: 'Arabic name', code: 'Course code',
      term: 'Planned term', unscheduled: 'not scheduled',
      // The card only has room for two words. This is where they are
      // explained: the published plan required the course but did not say
      // when, so the app placed it as early as its own prerequisites allow.
      termSuggested: 'suggested — the plan requires this course but does not say which term',
      passed: 'Passed', open: 'Unlocked', locked: 'Locked', progress: 'In progress',
      needAll: 'Still needed:', haveAll: 'All prerequisites passed.',
      opensCount: function(n){ return 'Taking this keeps ' + n + ' later course' + (n === 1 ? '' : 's') + ' on schedule.'; },
      credits: 'Hours', unlocksN: 'Unlocks', status: 'Status', needsN: 'Needs', none: 'None',
      year: function(n){ return 'Year ' + n; }, sem: { s1: 'First semester', s2: 'Second semester', s3: 'Summer' },
      viewTree: 'Show in course tree',
      pin: 'Pin to Home', unpin: 'Unpin from Home',
      more: 'More actions',
      remove: 'Remove from my plan…',
      restore: 'Restore to my plan',
      removeAsk: function(n){ return 'Remove ' + n + ' from your plan? It won\u2019t count toward your requirements. Use it if you tested out of it or never took it.'; },
      removedMsg: function(n){ return n + ' removed from your plan'; },
      said: function(n){ return n === 1 ? '1 student wrote about this' : n + ' students wrote about this'; },
      readAll: 'Read them',
      saidNone: 'Student thoughts about this course',
      writeFirst: 'Be the first to write'
    },
    ar: {
      why: 'لماذا يمكنك أخذ هذا المساق الآن',
      whyLocked: 'لماذا هذا المساق مغلق',
      whyDone: 'لقد أنجزت هذا المساق',
      opens: 'ماذا يفتح لك',
      noOpens: 'لا يوجد مساق في الخطة ينتظر هذا المساق.',
      noNeeds: 'لا توجد متطلبات سابقة — يمكنك أخذه في أي فصل يُطرح فيه.',
      details: 'التفاصيل',
      ch: 'الساعات المعتمدة', chShort: 'س.م', th: 'نظري', pr: 'عملي',
      cat: 'التصنيف', ar: 'الاسم بالعربية', code: 'رقم المساق',
      term: 'الفصل المقرر', unscheduled: 'غير مجدول',
      termSuggested: 'مقترح — الخطة بتطلب المساق بس ما بتحدد فصله',
      passed: 'منجز', open: 'متاح', locked: 'مغلق', progress: 'قيد الدراسة',
      needAll: 'ما زال مطلوباً:', haveAll: 'جميع المتطلبات السابقة منجزة.',
      opensCount: function(n){ return 'أخذه الآن يبقي ' + n + ' مساقاً لاحقاً في موعده.'; },
      credits: 'الساعات', unlocksN: 'يفتح', status: 'الحالة', needsN: 'يحتاج', none: 'ولا شي',
      year: function(n){ return 'سنة ' + n; }, sem: { s1: 'الفصل الأول', s2: 'الفصل الثاني', s3: 'الصيفي' },
      viewTree: 'اعرضه في شجرة المساقات',
      pin: 'ثبّته بالرئيسية', unpin: 'شيله من الرئيسية',
      more: 'خيارات أكثر',
      remove: 'أزِله من خطتي…',
      restore: 'رجّعه لخطتي',
      removeAsk: function(n){ return 'تشيل ' + n + ' من خطتك؟ ما رح ينحسب من متطلباتك. استعمل هذا إذا تجاوزته بامتحان أو ما أخذته.'; },
      removedMsg: function(n){ return 'انشال ' + n + ' من خطتك'; },
      said: function(n){ return n === 1 ? 'طالب واحد كتب عن هذا المساق' : n + ' طلاب كتبوا عن هذا المساق'; },
      readAll: 'اقرأها',
      saidNone: 'أفكار الطلاب عن هذا المساق',
      writeFirst: 'كون أول واحد يكتب'
    }
  };

  var CATS = {
    en: { skills:'Skills', core:'Core', math:'Math', dept:'Department',
          eng:'English', uni:'University', free:'Free elective' },
    ar: { skills:'مهارات', core:'إجباري', math:'رياضيات', dept:'تخصص',
          eng:'إنجليزي', uni:'متطلب جامعة', free:'متطلب حر' }
  };

  // A course is "passed" if the progress map says so. The id used there is the
  // primary one, because a lecture and its lab share a single grade — asking
  // about the lab half directly would report it unfinished forever.
  function isPassed(prefix, slug){
    var progress = window.__getProgress ? window.__getProgress() : {};
    var pid = (window.AAUP_GPA && window.AAUP_GPA.primaryId)
      ? window.AAUP_GPA.primaryId(prefix, slug)
      : (prefix + '-c-' + slug);
    return !!progress[pid];
  }

  // Returns HTML-safe text: courseInfo (name/ar) already passed through the
  // shared sanitizer's clean()/__cleanText when the plan was registered, so
  // callers must NOT esc() this again — that turned a real "&" into a
  // literal "&amp;" on screen (e.g. "Elementary Probability &amp; Statistics").
  function courseName(prefix, slug, rtl){
    var info = ((window.__PLAN_DATA[prefix] || {}).courseInfo || {})[slug] || {};
    if(rtl && info.ar) return info.ar;
    return info.name || info.en || slug;
  }

  function statusOf(prefix, slug){
    if(isPassed(prefix, slug)) return 'passed';
    var needs = ((window.__PLAN_DATA[prefix] || {}).needsMap || {})[slug] || [];
    var missing = needs.filter(function(n){ return !isPassed(prefix, n); });
    return missing.length ? 'locked' : 'open';
  }

  // Every prerequisite as a chip carrying its own state, so "why is this
  // locked" is answered by looking rather than by reading a paragraph.
  function chainHTML(prefix, slug, rtl, t){
    var needs = ((window.__PLAN_DATA[prefix] || {}).needsMap || {})[slug] || [];
    if(!needs.length) return '<p class="cd-note">' + t.noNeeds + '</p>';
    var missing = needs.filter(function(n){ return !isPassed(prefix, n); });
    var chips = needs.map(function(n){
      var ok = isPassed(prefix, n);
      return '<button type="button" class="cd-chip' + (ok ? ' is-ok' : ' is-missing') + '"' +
        ' data-goto="' + esc(n) + '">' + courseName(prefix, n, rtl) +
        (ok ? ' ✓' : '') + '</button>';
    }).join('');
    return '<p class="cd-note">' + (missing.length
        ? t.needAll + ' <strong>' + missing.map(function(n){ return courseName(prefix, n, rtl); }).join('، ') + '</strong>'
        : t.haveAll) + '</p>' +
      '<div class="cd-chain">' + chips +
      '<span class="cd-arrow">' + (rtl ? '←' : '→') + '</span>' +
      '<span class="cd-chip is-self">' + courseName(prefix, slug, rtl) + '</span></div>';
  }

  function opensHTML(prefix, slug, rtl, t){
    var unlocks = ((window.__PLAN_DATA[prefix] || {}).unlocksMap || {})[slug] || [];
    if(!unlocks.length) return '<p class="cd-note">' + t.noOpens + '</p>';
    return '<p class="cd-note">' + t.opensCount(unlocks.length) + '</p>' +
      '<div class="cd-chain">' + unlocks.map(function(u){
        return '<button type="button" class="cd-chip" data-goto="' + esc(u) + '">' +
          courseName(prefix, u, rtl) + '</button>';
      }).join('') + '</div>';
  }

  // 57 · WHAT CLOSES IF YOU DROP THIS
  //
  // Only on a course the student has actually passed, because that is the only
  // time the question is live. Transitive, because the second-order effects
  // are the ones that catch people out: dropping Statistics does not just
  // close Machine Learning, it closes what sits behind Machine Learning too.
  // Nothing is shown when nothing closes — silence is the honest answer, and
  // a line saying "0 courses" is noise on most of the plan.
  // Arabic counts a noun three different ways: dual for two, plural genitive
  // for three to ten, singular accusative from eleven up. "8 مساقًا" is the
  // eleven-and-up form on a count of eight, which reads as a mistake to any
  // Arabic speaker, so the count picks the form.
  function arCloses(n){
    if(n === 1) return 'يُغلق مساقًا واحدًا بعده: ';
    if(n === 2) return 'يُغلق مساقين بعده: ';
    if(n <= 10) return 'يُغلق ' + n + ' مساقات بعده: ';
    return 'يُغلق ' + n + ' مساقًا بعده: ';
  }

  function dropsHTML(prefix, slug, rtl){
    var done = window.__getProgress && window.__getProgress()[prefix + '-c-' + slug];
    if(!done) return '';
    var closes = (window.AAUP_IMPORTED && window.AAUP_IMPORTED.closesIfDropped)
      ? window.AAUP_IMPORTED.closesIfDropped(prefix, slug) : [];
    if(!closes.length) return '';
    var names = closes.slice(0, 4).map(function(u){ return courseName(prefix, u, rtl); });
    var more = closes.length - names.length;
    return '<div class="cd-sec cd-drop"><div class="cd-lbl">' +
      (rtl ? 'لو تركت هذا المساق' : 'If you drop this') + '</div>' +
      '<p class="cd-note">' + (rtl ? arCloses(closes.length)
        : (closes.length + ' later course' + (closes.length === 1 ? '' : 's') + ' close' +
           (closes.length === 1 ? 's' : '') + ': ')) +
      names.join(rtl ? '\u060c ' : ', ') + (more > 0 ? ' +' + more : '') +
      '</p></div>';
  }

  function row(k, v){
    if(v == null || v === '' || v === '-') return '';
    return '<div class="cd-row"><span>' + k + '</span><b>' + esc(v) + '</b></div>';
  }

  // The category chip above the name; phones only (hidden on wide screens).
  function catChipHTML(course, cats){
    var cat = course && course.category;
    if(!cat) return '';
    return '<span class="cd-catchip cd-catchip-' + esc(cat) + '">' + esc(cats[cat] || cat) + '</span>';
  }

  // What students said about THIS course, from the major's Student Thoughts
  // wall (js/59-thoughts.js, already cached on this device): posts that name
  // the course, its Arabic name or its number. Nothing when none do, and
  // nothing is fetched just for this.
  function saidHTML(prefix, slug, rtl, t, info){
    if(!window.AAUP_THOUGHTS || !window.AAUP_THOUGHTS.wallFor) return '';
    var name = String(info.name || '').trim();
    var arName = String(info.ar || '').trim();
    var num = String(info.num || '').trim();
    if(!name && !arName) return '';
    // The same rule the course's own Thoughts page uses (js/59-thoughts.js):
    // posts written from this course, or naming it.
    var course = { slug: slug, name: name, ar: arName, num: num };
    var hits = window.AAUP_THOUGHTS.forCourse ? window.AAUP_THOUGHTS.forCourse(prefix, course) : [];
    var open = '<button type="button" class="cd-said' + (hits.length ? '' : ' cd-said-empty') + '" data-cd-said="' + esc(prefix) + '" data-cd-said-course="' + esc(JSON.stringify(course)) + '">';
    // Always offered, so the first post about a course can be written from it.
    if(!hits.length){
      return open + '<span class="cd-said-top"><b>' + esc(t.saidNone) + '</b><span>' + esc(t.writeFirst) + ' ›</span></span></button>';
    }
    var quote = String(hits[0].text || '');
    if(quote.length > 110) quote = quote.slice(0, 107) + '…';
    return open +
      '<span class="cd-said-top"><b>' + esc(t.said(hits.length)) + '</b><span>' + esc(t.readAll) + ' ›</span></span>' +
      '<span class="cd-said-quote">“' + esc(quote) + '”</span></button>';
  }

  // Round 7, idea 15 · ONE SENTENCE FIRST
  //
  // The window used to open on three number tiles, a chip, a heading and a
  // chain before it said whether you could take the course. Now its first
  // line says that, and what the course opens, in words; everything else is
  // folded underneath. Names here are already HTML-safe (see courseName).
  function listOf(names, rtl){
    if(names.length < 2) return names.join('');
    if(rtl) return names.slice(0, -1).join('، ') + ' و' + names[names.length - 1];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  function leadHTML(prefix, slug, rtl, pid){
    var data = window.__PLAN_DATA[prefix] || {};
    var needs = (data.needsMap || {})[slug] || [];
    var unlocks = (data.unlocksMap || {})[slug] || [];
    var nm = function(s){ return courseName(prefix, s, rtl); };
    var b = function(s){ return '<b>' + s + '</b>'; };
    var statuses = (window.AAUP_GPA && window.AAUP_GPA.loadStatuses) ? window.AAUP_GPA.loadStatuses() : {};
    var taking = function(s){
      var p = (window.AAUP_GPA && window.AAUP_GPA.primaryId) ? window.AAUP_GPA.primaryId(prefix, s) : (prefix + '-c-' + s);
      return statuses[p] === 'in_progress';
    };
    var opens = '';
    if(unlocks.length){
      var shown = unlocks.slice(0, 2).map(function(u){ return b(nm(u)); });
      var more = unlocks.length - shown.length;
      opens = rtl
        ? ' بتفتحلك ' + (more > 0 ? shown.join('، ') + ' و' + more + ' كمان' : listOf(shown, true)) + '.'
        : ' It opens ' + (more > 0 ? shown.join(', ') + ' and ' + more + ' more' : listOf(shown, false)) + '.';
    }
    var st = statusOf(prefix, slug), s;
    if(st === 'passed'){
      var g = (window.AAUP_GPA && window.AAUP_GPA.loadGrades) ? window.AAUP_GPA.loadGrades()[pid] : '';
      var gl = g && window.AAUP_GPA.gradeLabel ? window.AAUP_GPA.gradeLabel(g) : g;
      s = g
        ? (rtl ? 'نجحت فيها بـ <span class="cd-ok">' + esc(gl) + '</span>، وبتنحسب بمعدلك.' : 'Passed with <span class="cd-ok">' + esc(gl) + '</span>. It counts toward your GPA.')
        : (rtl ? 'نجحت في هاي المادة.' : 'You passed this.');
    } else if(statuses[pid] === 'in_progress'){
      s = (rtl ? 'بتاخدها هلق.' : 'You’re taking this now.') + opens;
    } else if(st === 'locked'){
      var missing = needs.filter(function(n){ return !isPassed(prefix, n); });
      var now = missing.filter(taking);
      s = rtl
        ? 'مش هلق: لازم تنجح بـ ' + listOf(missing.map(function(n){ return '<span class="cd-warn">' + nm(n) + '</span>'; }), true) + ' أول.'
        : 'Not yet: pass ' + listOf(missing.map(function(n){ return '<span class="cd-warn">' + nm(n) + '</span>'; }), false) + ' first.';
      if(now.length) s += rtl ? ' بتاخد ' + listOf(now.map(function(n){ return b(nm(n)); }), true) + ' هلق.'
                              : ' You’re taking ' + listOf(now.map(function(n){ return b(nm(n)); }), false) + ' now.';
    } else {
      var have = needs.map(function(n){ return '<span class="cd-ok">' + nm(n) + ' ✓</span>'; });
      s = rtl
        ? 'بتقدر تاخدها هلق' + (have.length ? ': ' + listOf(have, true) + (have.length > 1 ? ' ناجح فيهم.' : ' ناجح فيها.') : '.')
        : 'You can take this now' + (have.length ? ': ' + listOf(have, false) + (have.length > 1 ? ' are passed.' : ' is passed.') : '.');
      s += opens;
    }
    return '<p class="cd-lead">' + s + '</p>';
  }

  // course is the plan's own record (credit hours, term); info is the
  // registered course table (number, theoretical/practical split, Arabic name).
  function build(prefix, slug, course, rtl){
    var t = L[rtl ? 'ar' : 'en'];
    var cats = CATS[rtl ? 'ar' : 'en'];
    var info = ((window.__PLAN_DATA[prefix] || {}).courseInfo || {})[slug] || {};
    var st = statusOf(prefix, slug);
    var name = courseName(prefix, slug, rtl);

    // "Year 1 · First semester", not "Y1 · S1".
    var ym = course && course.yearId ? /(\d+)/.exec(String(course.yearId)) : null;
    var term = course && course.yearId
      ? (ym ? t.year(ym[1]) : String(course.yearId).toUpperCase()) +
        (course.semester ? ' · ' + (t.sem[String(course.semester).toLowerCase()] || String(course.semester).toUpperCase()) : '')
      : t.unscheduled;

    var whyTitle = st === 'passed' ? t.whyDone : st === 'locked' ? t.whyLocked : t.why;
    var pid = (window.AAUP_GPA && window.AAUP_GPA.primaryId) ? window.AAUP_GPA.primaryId(prefix, slug) : (prefix + '-c-' + slug);
    var hrs = course && course.creditHours != null ? (parseFloat(course.creditHours) || 0) : null;
    var num = info.num || (course && course.courseNumber);
    var staffCourse = { id: slug, semester: course && course.semester };

    // One sentence, then the status buttons (js/21 fills .cd-extras), then
    // the rest folded: prerequisites and what it opens, student thoughts,
    // details. The number lives in Details, where you copy it.
    return '<div class="cd" dir="' + (rtl ? 'rtl' : 'ltr') + '">' +
      '<div class="cd-head">' +
        '<div class="cd-title">' + catChipHTML(course, cats) + '<h3>' + name + '</h3>' +
          '<div class="cd-sub">' +
            [hrs != null ? (rtl ? (hrs === 2 ? 'ساعتين' : hrs + (hrs >= 3 && hrs <= 10 ? ' ساعات' : ' ساعة')) : hrs + (hrs === 1 ? ' hour' : ' hours')) : '', term].filter(Boolean).map(esc).join(' · ') +
            // Round 10: "Fall only" when the college says so.
            (window.AAUP_STAFF_CONTENT ? window.AAUP_STAFF_CONTENT.subChipHtml(staffCourse) : '') +
          '</div></div>' +
        moreMenuHTML(prefix, slug, pid, t) +
      '</div>' +
      '<div class="cd-body">' +
        '<div class="cd-main">' +
          leadHTML(prefix, slug, rtl, pid) +
          // Round 10: what the professor or dean wrote about this course.
          (window.AAUP_STAFF_CONTENT ? window.AAUP_STAFF_CONTENT.courseHtml(staffCourse) : '') +
          '<div class="cd-extras"></div>' +
          // 52 · The English placement question, asked on the three courses
          // it decides rather than as a gate in front of the whole app.
          // Empty for every other course, and once it has been answered.
          (window.AAUP_ENGLISH && window.AAUP_ENGLISH.askHereHtml
            ? window.AAUP_ENGLISH.askHereHtml(prefix, slug, rtl) : '') +
          '<details class="cd-fold"><summary>' + esc(rtl ? 'المتطلبات وشو بتفتح' : 'Prerequisites and what it opens') + '</summary>' +
            '<div class="cd-fold-body">' +
              '<div class="cd-sec"><div class="cd-lbl">' + whyTitle + '</div>' + chainHTML(prefix, slug, rtl, t) + '</div>' +
              '<div class="cd-sec"><div class="cd-lbl">' + t.opens + '</div>' + opensHTML(prefix, slug, rtl, t) + '</div>' +
              dropsHTML(prefix, slug, rtl) +
              // 41 · One tap to say an arrow is wrong. Empty on a course with
              // no prerequisites — there is nothing there to be wrong about.
              (window.AAUP_PREREQ_REPORT
                ? window.AAUP_PREREQ_REPORT.lineHtml(prefix, slug, rtl) : '') +
            '</div></details>' +
          saidHTML(prefix, slug, rtl, t, info) +
          '<details class="cd-fold"><summary>' + esc(t.details) +
            (num ? ' <span class="cd-fold-hint">· ' + esc(num) + '</span>' : '') + '</summary>' +
            '<div class="cd-fold-body cd-side">' +
              row(t.code, num) +
              row(t.ch, hrs) +
              row(t.th, info.th) +
              row(t.pr, info.pr) +
              row(t.cat, cats[(course && course.category) || ''] || '') +
              (!rtl && info.ar ? row(t.ar, info.ar) : '') +
              row(t.term, term) +
              (course && course.termSuggested ? '<p class="cd-note">' + esc(t.termSuggested) + '</p>' : '') +
            '</div></details>' +
        '</div>' +
      '</div>' +
      '</div>';
  }

  // Rarely-needed actions live behind one small button in the corner, so the
  // red Remove can't be hit by accident while scrolling the course.
  function moreMenuHTML(prefix, slug, pid, t){
    var removed = window.AAUP_REMOVED && window.AAUP_REMOVED.isRemoved(prefix, slug);
    var ic = function(k){ return window.AAUP_ICONS ? window.AAUP_ICONS.preview(k, 15) : ''; };
    return '<div class="cd-more">' +
      '<button type="button" class="cd-more-btn" id="cdMoreBtn" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(t.more) + '">' +
        '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>' +
      '</button>' +
      '<div class="cd-menu" id="cdMenu" role="menu" hidden>' +
        '<button type="button" role="menuitem" data-cd-view-tree="' + esc(pid) + '">' + ic('map') + '<span>' + esc(t.viewTree) + '</span></button>' +
        (window.AAUP_PINS
          ? '<button type="button" role="menuitem" data-cd-pin="' + (window.AAUP_PINS.has(prefix, slug) ? '0' : '1') + '">' + ic('planpin') + '<span class="cd-menu-lab">' +
            esc(window.AAUP_PINS.has(prefix, slug) ? t.unpin : t.pin) + '</span></button>'
          : '') +
        (window.AAUP_REMOVED
          ? (removed
            ? '<button type="button" role="menuitem" data-cd-remove="0">' + ic('undo') + '<span>' + esc(t.restore) + '</span></button>'
            : '<button type="button" role="menuitem" class="cd-menu-danger" data-cd-remove="1">' + ic('trash') + '<span>' + esc(t.remove) + '</span></button>')
          : '') +
      '</div></div>';
  }

  // Wires the swipe-dot indicator for #cdSlides and the "View in course
  // tree" action — called by the caller (js/28-imported.js openCourseModal)
  // right after the built HTML is inserted, same pattern as
  // __bindCourseModalExtras. No-ops harmlessly on desktop: .cd-slides
  // there is a normal stacked block with no scroll, so the scroll listener
  // just never fires.
  function bind(prefix, slug, container){
    if(!container) return;
    // 52 · Answering the English placement from inside the course popup. The
    // answer removes courses from the plan, so the popup closes and the plan
    // redraws — leaving the popup open on a course that may have just left
    // the grid is the one outcome that must not happen.
    var engBlock = container.querySelector('.eng-opts-inline');
    if(engBlock && window.AAUP_ENGLISH && window.AAUP_ENGLISH.answerFromClick){
      engBlock.addEventListener('click', function(e){
        var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
        if(!window.AAUP_ENGLISH.answerFromClick(prefix, e.target, rtl)) return;
        var ov = container.closest('.modal-overlay');
        if(ov) ov.classList.remove('open');
        if(window.__refreshPlanUI) window.__refreshPlanUI(prefix);
      });
    }
    var moreBtn = container.querySelector('#cdMoreBtn');
    var menu = container.querySelector('#cdMenu');
    if(moreBtn && menu){
      var setOpen = function(open){ menu.hidden = !open; moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
      moreBtn.addEventListener('click', function(e){ e.stopPropagation(); setOpen(menu.hidden); });
      container.addEventListener('click', function(e){ if(!menu.hidden && !e.target.closest('.cd-more')) setOpen(false); });
      var pinBtn = menu.querySelector('[data-cd-pin]');
      if(pinBtn){
        pinBtn.addEventListener('click', function(){
          setOpen(false);
          var on = pinBtn.getAttribute('data-cd-pin') === '1';
          window.AAUP_PINS.set(prefix, slug, on);
          var rtl2 = window.__isRtl ? window.__isRtl(prefix) : false;
          var t2 = L[rtl2 ? 'ar' : 'en'];
          pinBtn.setAttribute('data-cd-pin', on ? '0' : '1');
          var lab = pinBtn.querySelector('.cd-menu-lab');
          if(lab) lab.textContent = on ? t2.unpin : t2.pin;
          if(window.__showToast) window.__showToast(on ? (rtl2 ? 'انثبّت بالرئيسية' : 'Pinned to Home') : (rtl2 ? 'انشال من الرئيسية' : 'Unpinned'));
        });
      }
      var rmBtn = menu.querySelector('[data-cd-remove]');
      if(rmBtn){
        rmBtn.addEventListener('click', function(){
          setOpen(false);
          var slugNow = slug;
          var removing = rmBtn.getAttribute('data-cd-remove') === '1';
          var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
          var t = L[rtl ? 'ar' : 'en'];
          var h3 = container.querySelector('.cd-head h3');
          var nm = h3 ? h3.textContent : slugNow;
          var go = function(){
            window.AAUP_REMOVED.setRemoved(prefix, slugNow, removing);
            var ov = container.closest('.modal-overlay');
            if(ov) ov.classList.remove('open');
            // A removed card leaves the plan, so the way back is right here.
            if(removing && window.__showUnlockToast){
              window.__showUnlockToast(t.removedMsg(nm), '', {
                undo: function(){ window.AAUP_REMOVED.setRemoved(prefix, slugNow, false); },
                undoLabel: rtl ? 'تراجع' : 'Undo'
              });
            }
          };
          // Round 7, idea 17: the toast after it offers Undo, so no question first.
          go();
        });
      }
    }
    var saidBtn = container.querySelector('[data-cd-said]');
    if(saidBtn){
      // Opens on top of the course, so going back lands on the course again.
      saidBtn.addEventListener('click', function(){
        if(window.AAUP_THOUGHTS){
          var c = null;
          try{ c = JSON.parse(saidBtn.getAttribute('data-cd-said-course') || 'null'); }catch(e){}
          window.AAUP_THOUGHTS.open(saidBtn.getAttribute('data-cd-said'), c ? { course: c } : null);
        }
      });
    }
    var viewTreeBtn = container.querySelector('[data-cd-view-tree]');
    if(viewTreeBtn){
      viewTreeBtn.addEventListener('click', function(){
        var overlay = container.closest('.modal-overlay');
        if(overlay) overlay.classList.remove('open');
        var pid = viewTreeBtn.getAttribute('data-cd-view-tree');
        var el = pid && document.getElementById(pid);
        if(el){
          setTimeout(function(){
            if(window.__revealYearFor){
              var pfx = (pid || '').split('-c-')[0];
              window.__revealYearFor(pfx, el);
            }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('cd-highlight');
            setTimeout(function(){ el.classList.remove('cd-highlight'); }, 1600);
          }, 50);
        }
      });
    }
  }

  window.AAUP_COURSE_DETAIL = { build: build, bind: bind, status: statusOf, isPassed: isPassed };
})();
