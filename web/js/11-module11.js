(function(){
  var BUILD_ID = '1974f0d0a52d';
  var STORAGE_KEY = 'aaup-ai-study-plans-progress-' + BUILD_ID;
  // Exposed so the data export/import/reset module (added later in this
  // file) reads and writes the exact same key — one definition, no risk of
  // the two ever drifting apart if BUILD_ID changes.
  window.__PROGRESS_STORAGE_KEY = STORAGE_KEY;
  var PLANS = ['robotics','cybersecurity','medical','cs'];
  window.__PLANS = PLANS;

  // How many ".course.dept" items each plan actually requires (matches each
  // plan's own "pool-note" text). Marking more than this in a plan's elective
  // pool is fine, but the progress bar only ever needs this many to hit 100%.
  var DEPT_REQUIRED = {
    robotics: 6,       // 6 of 7 department electives
    cybersecurity: 3,  // 3 department elective slots, chosen from the pool of 8
    // 5 of the 13 specialization electives this plan lists. Derived, not
    // guessed: counting each lecture+lab pair once, the mandatory hours are
    // 14 (Univ. Req.) + 6 (Univ. Elec.) + 18 (College Req.) + 70 (Spec. Req.)
    // + 6 (Free Elec.) = 114 against a published 129 CH degree, leaving
    // exactly 15H — 5 electives at 3H. The old "3 of the 10 offered" was
    // both counts wrong and left the plan reading 123 CH.
    medical: 5,
    cs: 3,              // students select 3 of the 13 offered
    // Feed/imported plans can add their own entry here too — needed whenever
    // a plan has more than one dept-tagged elective slot at the SAME credit
    // value: the audit's fallback heuristic (Object.keys(deptCrCounts).length)
    // counts DISTINCT credit-hour VALUES as a stand-in for distinct required
    // courses, which silently collapses to 1 when every slot costs the same
    // (e.g. 5 "Specialized Elective" slots all worth 3H look like just one).
    // Birzeit Cyber Security: 5 "SP. Elective" slots placed in the grid, all
    // individually required (not a bigger pool to pick from) — 5 x 3H = 15H,
    // matching the source's stated "Program Elective Courses: 15 credit hours".
    'birzeit-cyber-security': 5,
    // AAUP AI & Data Science: real "pick N of M named electives" pools —
    // this is the mechanism's original use case (same shape as the CS plan).
    'aaup-ai-innovation': 2,               // pick 2 of 4 Specialization Electives (6H)
    'aaup-statistics-data-science': 4,     // pick 4 of 13 Specialization Electives (12H)
    'aaup-ai-fintech': 2,                  // pick 2 of 5 Specialization Electives (6H)
    'aaup-financial-engineering': 4,       // pick 4 of 16 Specialization Electives (12H)
    'aaup-finance-data-science': 2         // pick 2 of 8 Specialization Electives (6H)
  };
  window.__DEPT_REQUIRED = DEPT_REQUIRED;

  function loadProgress(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    }catch(e){ return {}; }
  }
  var progress = loadProgress();
  // What storage held the last time this tab read or wrote it. The difference
  // between this and `progress` is exactly the set of courses THIS tab has
  // changed since then — which is what makes the merge below possible.
  var baseline = JSON.parse(JSON.stringify(progress));
  // Exposed read/save access so the GPA Calculator and Degree Audit module
  // (which needs to know completion state, but lives in its own IIFE) always
  // reads the exact same live data instead of keeping a second copy.
  window.__getProgress = function(){ return progress; };
  // Persisting is exported too, for the one caller that writes progress for a
  // plan that is NOT on screen: Change Major ticking off the courses that
  // carried across (js/62-change-plan.js). It goes through the same merge
  // below rather than writing localStorage itself, so a second tab's ticks
  // survive it like everything else.
  window.__saveProgress = function(){ saveProgress(); };

  // saveProgress used to write this tab's whole in-memory blob over whatever
  // was in storage. Two tabs open (a completely ordinary thing — the plan in
  // one, the dashboard in another) meant the second tab to save silently
  // erased every course the first had ticked, because its snapshot was taken
  // before those ticks existed. Verified: tab A completed 3 courses, tab B
  // then completed 3 others, and after a reload ALL of tab A's were gone.
  //
  // So a save now asserts only what this tab actually changed. Re-read the
  // current stored value, replay just our own additions and removals onto it,
  // and keep every key we never touched exactly as the other tab left it.
  function saveProgress(){
    var merged = loadProgress();
    Object.keys(progress).forEach(function(k){
      if(progress[k] && !baseline[k]) merged[k] = progress[k];   // we added it
    });
    Object.keys(baseline).forEach(function(k){
      if(baseline[k] && !progress[k]) delete merged[k];          // we removed it
    });
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); }
    catch(e){ /* storage unavailable; continue silently */ }
    // Adopt the merged result in place — `progress` is handed out by reference
    // through __getProgress(), so it must be mutated, never reassigned.
    Object.keys(progress).forEach(function(k){ if(!(k in merged)) delete progress[k]; });
    Object.keys(merged).forEach(function(k){ progress[k] = merged[k]; });
    baseline = JSON.parse(JSON.stringify(merged));
  }

  // A sibling tab writing progress used to leave this one showing stale state
  // until it was reloaded by hand. Adopt their change and repaint instead.
  window.addEventListener('storage', function(e){
    if(e.key !== STORAGE_KEY) return;
    var incoming = loadProgress();
    Object.keys(progress).forEach(function(k){ if(!(k in incoming)) delete progress[k]; });
    Object.keys(incoming).forEach(function(k){ progress[k] = incoming[k]; });
    baseline = JSON.parse(JSON.stringify(incoming));
    if(window.__redraw){
      Object.keys(window.__redraw).forEach(function(p){
        try{ window.__redraw[p](); }catch(err){}
      });
    }
  });

  // ---------- badge / availability helpers ----------
  // The plan's own class while a plan is on screen — render() sets it from
  // the app-wide setting, so the two always agree — and the setting itself
  // everywhere else, so a screen opened with no plan behind it (Settings,
  // the plan picker) is in the language the student chose rather than
  // defaulting to English.
  function isRtl(prefix){
    var page = document.getElementById('page-' + prefix);
    if(page) return page.classList.contains('rtl-mode');
    return !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
  }
  window.__isRtl = isRtl;

  // Labels for the small status badge shown on each course, in both languages.
  function badgeLabel(kind, rtl){
    if(kind === 'completed') return rtl ? 'مكتمل' : 'Completed';
    if(kind === 'available') return rtl ? 'متاح' : 'Available';
    return '';
  }

  // Sets the single .course-badge span on a course to reflect its current
  // state (completed / newly available / neither), in the active language.
  function updateCourseBadge(el, rtl){
    var badge = el.querySelector('.course-badge');
    if(!badge) return;
    if(el.classList.contains('completed')){
      badge.className = 'course-badge badge-completed';
      badge.textContent = badgeLabel('completed', rtl);
      badge.style.display = 'inline-block';
    } else if(el.classList.contains('available')){
      badge.className = 'course-badge badge-available';
      badge.textContent = badgeLabel('available', rtl);
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  // Recalculates, for every course in a plan, whether all of its
  // prerequisites are now completed (i.e. it just became available to take).
  // Completed courses are never themselves marked "available". Courses with
  // no prerequisites at all are available from the start. Runs after every
  // completion toggle, reset, and on initial load, so the glow/badge always
  // Some courses gate on total credit-hours completed, not on any specific
  // prerequisite course — e.g. CS Senior Project I can only be taken once the
  // student has finished 90 credit hours. slug -> required completed credits.
  var CREDIT_GATES = {
    cs: { 'senior-proj-1': 90 }
  };

  // Total credit-hours the student has actually completed in this plan, used
  // by the credit gates above. Department electives are a pick-N pool, so only
  // the required number of completed picks (largest first) count — the same
  // rule the progress bar and audit already use, so the gate agrees with the
  // "X / 134 credit hours completed" figure shown in My Progress.
  function completedCredits(prefix){
    var page = document.getElementById('page-' + prefix);
    var planData = window.__PLAN_DATA && window.__PLAN_DATA[prefix];
    var info = (planData && planData.courseInfo) || {};
    if(!page) return 0;
    var required = DEPT_REQUIRED[prefix];
    var sum = 0, deptDone = [];
    page.querySelectorAll('.course[id]:not(.course-removed)').forEach(function(el){
      if(!progress[el.id]) return;
      var parts = splitCourseId(el.id);
      var meta = parts && info[parts.slug];
      var cr = meta ? (parseFloat(meta.cr) || 0) : 0;
      if(el.classList.contains('dept')){ deptDone.push(cr); }
      else { sum += cr; }
    });
    deptDone.sort(function(a, b){ return b - a; });
    var cap = (typeof required === 'number') ? required : deptDone.length;
    for(var i = 0; i < Math.min(cap, deptDone.length); i++){ sum += deptDone[i]; }
    return sum;
  }

  // reflects the current progress.
  function computeAvailability(prefix){
    var page = document.getElementById('page-' + prefix);
    if(!page) return;
    var planData = window.__PLAN_DATA && window.__PLAN_DATA[prefix];
    var needsMap = (planData && planData.needsMap) || {};
    var rtl = isRtl(prefix);
    var gates = CREDIT_GATES[prefix] || {};
    var doneCredits = null; // computed lazily, only if a gate needs it
    var courses = page.querySelectorAll('.course[id]:not(.course-removed)');

    function meetsOwnPrereqs(slug){
      var needs = needsMap[slug] || [];
      return needs.every(function(reqSlug){ return !!progress[prefix + '-c-' + reqSlug]; });
    }

    // A lecture and its lab are ONE registered course at AAUP — same
    // catalogue number, same credit value, drawn as two cards only because
    // they meet at different times. So they have to unlock together, and
    // they did not: the catalogue lists prerequisites per printed row, and
    // Programming Fundamentals Lab's row states none while Programming
    // Fundamentals' row requires Intro to CS. Read literally that made the
    // lab "open to you" sitting directly under its own lecture reading
    // "closed to you" — an offer a student cannot actually act on, since
    // neither half can be registered without the other.
    //
    // The prerequisite DATA is left exactly as the catalogue printed it.
    // What changes is the question asked of it: a paired course is open when
    // BOTH halves' prerequisites are met.
    // Looks for the other half as a CARD, not as a courseInfo entry: this
    // runs on first paint too, and on that pass __registerPlanData has not
    // necessarily populated courseInfo yet — an empty map made every course
    // look unpaired, so the very render a student sees first was the one
    // that still showed the lab open under a closed lecture. The cards are
    // in the DOM by definition, since this is iterating them.
    function pairSlugOf(slug){
      var other = /-lab$/.test(slug) ? slug.replace(/-lab$/, '') : slug + '-lab';
      return page.querySelector('[id="' + prefix + '-c-' + other + '"]') ? other : null;
    }

    courses.forEach(function(el){
      var isDone = !!progress[el.id];
      var available = false;
      if(!isDone){
        var parts = splitCourseId(el.id);
        var slug = parts && parts.slug;
        available = !!slug && meetsOwnPrereqs(slug);
        var pair = slug && pairSlugOf(slug);
        if(available && pair && !progress[prefix + '-c-' + pair]){
          available = meetsOwnPrereqs(pair);
        }
        // Credit-hour gate (e.g. Senior Project I needs 90 completed hours):
        // even with every course prerequisite met, stay locked until enough
        // total credit-hours are done.
        if(available && parts && gates[parts.slug]){
          if(doneCredits === null){ doneCredits = completedCredits(prefix); }
          if(doneCredits < gates[parts.slug]){ available = false; }
        }
      }
      el.classList.toggle('available', available);
      updateCourseBadge(el, rtl);
    });
  }


  // ---------- top progress bar (the original, simple widget) ----------
  function updateWidget(prefix){
    var page = document.getElementById('page-' + prefix);
    if(!page) return;
    var courses = page.querySelectorAll('.course[id]:not(.course-removed)');

    // Department electives are a pool to choose from, not a checklist every
    // single item must be marked off. Only DEPT_REQUIRED[prefix] of them
    // (whichever ones the student actually took) count toward the total.
    var required = DEPT_REQUIRED[prefix];
    var deptTotal = 0, deptDone = 0, otherTotal = 0, otherDone = 0;
    courses.forEach(function(el){
      var isDone = !!progress[el.id];
      if(el.classList.contains('dept')){
        deptTotal++;
        if(isDone) deptDone++;
      } else {
        otherTotal++;
        if(isDone) otherDone++;
      }
    });
    var deptNeeded = (typeof required === 'number') ? required : deptTotal;
    var total = otherTotal + deptNeeded;
    var done = otherDone + Math.min(deptDone, deptNeeded);

    var fill = document.getElementById(prefix + '-progressFill');
    var text = document.getElementById(prefix + '-progressText');
    var pct = total ? Math.round(done / total * 100) : 0;
    if(fill){ fill.style.width = pct + '%'; }
    if(text){
      text.textContent = isRtl(prefix)
        ? (done + ' / ' + total + ' مكتمل (' + pct + '٪)')
        : (done + ' / ' + total + ' completed (' + pct + '%)');
    }

    // Recalculate which courses just became available now that completion
    // state may have changed, and refresh every course's status badge.
    computeAvailability(prefix);

    // Richer credit-hour / elective / "what's next" panel, kept in sync
    // with the same completion data as the bar above.
    renderMyProgressPanel(prefix);
    nextCoursesRenderer(prefix);

    // Checking off a course can unlock an achievement — check right away
    // rather than waiting for the student to open the Achievements modal.
    if(window.AAUP_ACHIEVEMENTS){ window.AAUP_ACHIEVEMENTS.refreshUnlocks(prefix); }

    // Completion just changed, so which years count as "finished" may have
    // too — keep the collapse toggle and any collapsed years in sync.
    if(window.__refreshCollapse){ window.__refreshCollapse(prefix); }
    // A whole semester may have just been finished — celebrate it.
    if(window.__celebrateCheck){ window.__celebrateCheck(prefix); }
  }

  // Per-plan copy so cybersecurity's still-unconfirmed elective-hour total
  // (see the sidebar Notes panel) reads as a caveat rather than a hard fact.

  // ---------- credit-hour & elective statistics ----------
  var ELECTIVE_NOTES = {
    robotics: {
      en: 'Choose at least 6 of the 7 department electives offered (18 of 21H).',
      ar: 'أكمل 6 مساقات على الأقل من أصل 7 اختياريات تخصصية معروضة (18 من 21 ساعة).'
    },
    cybersecurity: {
      en: '3 elective slots are built into the plan; the exact hour total is still pending department confirmation.',
      ar: '3 اختياريات مضمّنة في الخطة؛ العدد الدقيق للساعات لم يُعتمد رسميًا بعد من القسم.'
    },
    medical: {
      en: 'Choose 3 of the 10 electives offered (9 of 30H).',
      ar: 'اختر 3 مساقات من أصل 10 اختياريات معروضة (9 من 30 ساعة).'
    },
    cs: {
      en: 'Choose 3 of the 13 electives offered (9 of 39H).',
      ar: 'اختر 3 مساقات من أصل 13 اختياريًا معروضًا (9 من 39 ساعة).'
    }
  };

  // Single source of truth for every number shown in the enhanced sidebar
  // panel (credit hours, course counts, elective sub-progress). Mirrors the
  // exact same dept-pool-capping logic as the bar above, just in more detail.
  function computeStats(prefix){
    var page = document.getElementById('page-' + prefix);
    var data = window.__PLAN_DATA[prefix] || {};
    var info = data.courseInfo || {};
    var courses = page ? Array.prototype.slice.call(page.querySelectorAll('.course[id]:not(.course-removed)')) : [];
    var required = DEPT_REQUIRED[prefix];

    var seenNum = {};
    var coreCreditsTotal = 0, coreCreditsDone = 0, coreCoursesTotal = 0, coreCoursesDone = 0;
    var deptCreditsDone = 0, deptDoneCount = 0, deptCount = 0;
    var deptCrCounts = {};
    var grades = window.AAUP_GPA ? window.AAUP_GPA.loadGrades() : {};

    courses.forEach(function(el){
      var parts = splitCourseId(el.id);
      if(!parts) return;
      // Once a course has been superseded by an auto-scheduled retake, it
      // no longer represents an active requirement or a completed one —
      // the retake alone counts from here on, so neither its "required"
      // nor "completed" credit hours should be counted twice.
      if(window.__isSupersededByRetake && window.__isSupersededByRetake(prefix, parts.slug)) return;
      var meta = info[parts.slug];
      var cr = meta ? (parseFloat(meta.cr) || 0) : 0;
      // Checked "done" tracks whether the course was TAKEN — an F grade
      // means it was taken but not passed, so it still shouldn't count
      // toward completed credit hours even though the box may be ticked.
      var pidHere = window.AAUP_GPA ? window.AAUP_GPA.primaryId(prefix, parts.slug) : el.id;
      var notPassed = window.AAUP_GPA && window.AAUP_GPA.isNonPassing;
      var isDone = !!progress[el.id] && !(notPassed && notPassed(grades[pidHere]));

      if(el.classList.contains('dept')){
        deptCount++;
        deptCrCounts[cr] = (deptCrCounts[cr] || 0) + 1;
        if(isDone){ deptDoneCount++; deptCreditsDone += cr; }
        return;
      }

      // A course and its lab share one REAL course number — count the
      // credit hours once, not once per checkbox. Generic elective slots
      // (uni/free/dept/spec-elective-N) all use the placeholder num "-",
      // which is not a real shared identifier, so those always dedupe by
      // their own unique slug instead — otherwise every "University
      // Elective (N)" slot would collapse into a single course.
      var dedupeKey = (meta && meta.num && meta.num !== '-') ? meta.num : parts.slug;
      if(seenNum[dedupeKey]) return;
      seenNum[dedupeKey] = true;

      coreCoursesTotal++;
      coreCreditsTotal += cr;
      var altSlug = parts.slug.slice(-4) === '-lab' ? parts.slug.slice(0, -4) : parts.slug + '-lab';
      var doneHere = isDone || (!!progress[prefix + '-c-' + altSlug] && !(notPassed && notPassed(grades[pidHere])));
      if(doneHere){ coreCoursesDone++; coreCreditsDone += cr; }
    });

    // Most common elective credit value, used as the "per elective" weight
    // when turning the required course COUNT into a required HOUR total.
    var creditUnit = 3, bestCount = 0;
    Object.keys(deptCrCounts).forEach(function(k){
      if(deptCrCounts[k] > bestCount){ bestCount = deptCrCounts[k]; creditUnit = parseFloat(k); }
    });

    var deptNeeded = (typeof required === 'number') ? required : deptCount;
    var electiveReqCredits = deptNeeded * creditUnit;
    var electiveDoneCourses = Math.min(deptDoneCount, deptNeeded);
    var electiveDoneCredits = Math.min(deptCreditsDone, electiveReqCredits);

    var totalCredits = coreCreditsTotal + electiveReqCredits;
    var doneCredits = coreCreditsDone + electiveDoneCredits;
    var totalCourses = coreCoursesTotal + deptNeeded;
    var doneCourses = coreCoursesDone + electiveDoneCourses;

    return {
      totalCredits: totalCredits, doneCredits: doneCredits,
      remainingCredits: Math.max(0, totalCredits - doneCredits),
      totalCourses: totalCourses, doneCourses: doneCourses,
      remainingCourses: Math.max(0, totalCourses - doneCourses),
      pct: totalCredits ? Math.round(doneCredits / totalCredits * 100) : 0,
      electiveDoneCredits: electiveDoneCredits, electiveReqCredits: electiveReqCredits,
      electiveDoneCourses: electiveDoneCourses, electiveReqCourses: deptNeeded,
      electivePct: electiveReqCredits ? Math.round(electiveDoneCredits / electiveReqCredits * 100) : 0
    };
  }
  // Exposed so the Achievements module (Halfway to Graduation, Graduation
  // Ready) reuses this exact same credit-hour math instead of a third copy.
  window.__computeStats = computeStats;
  // Exposed so a dynamically-created course card (e.g. an auto-scheduled
  // retake) gets the same checkbox/badge wiring as every static one,
  // without duplicating that logic elsewhere.
  // Exposed so setting a grade of F can force-uncheck completion (failing
  // a course means the requirement isn't satisfied, regardless of whether
  // the checkbox was already ticked) without duplicating toggle/cascade
  // logic in another module.
  window.__toggleCourse = toggleCourse;
  window.__injectCheckboxes = injectCheckboxes;

  var RING_R = 34, RING_C = 2 * Math.PI * 34;


  // ---------- My Progress sidebar panel + What Can I Take Next ----------
  function renderMyProgressPanel(prefix){
    var panel = document.getElementById(prefix + '-myProgressPanel');
    if(!panel) return;
    var rtl = isRtl(prefix);
    var s = computeStats(prefix);

    var ringFill = document.getElementById(prefix + '-ringFill');
    if(ringFill){
      ringFill.style.strokeDasharray = RING_C.toFixed(1);
      ringFill.style.strokeDashoffset = (RING_C * (1 - s.pct / 100)).toFixed(1);
    }
    var setText = function(id, val){ var el = document.getElementById(id); if(el) el.textContent = val; };
    setText(prefix + '-ringPct', s.pct + '%');
    setText(prefix + '-creditsDoneTxt', s.doneCredits);
    setText(prefix + '-creditsTotalTxt', s.totalCredits);
    setText(prefix + '-creditsRemainingTxt', s.remainingCredits);
    setText(prefix + '-coursesDoneTxt', s.doneCourses);
    setText(prefix + '-coursesRemainingTxt', s.remainingCourses);
    setText(prefix + '-electiveDoneTxt', s.electiveDoneCredits);
    setText(prefix + '-electiveReqTxt', s.electiveReqCredits);
    setText(prefix + '-electiveCourseTxt', s.electiveDoneCourses + '/' + s.electiveReqCourses);
    var fill = document.getElementById(prefix + '-electiveFill');
    if(fill){ fill.style.width = Math.min(100, s.electivePct) + '%'; }
    var note = ELECTIVE_NOTES[prefix];
    setText(prefix + '-electiveNote', note ? (rtl ? note.ar : note.en) : '');
  }

  // Fills each plan's welcome line with the globally-saved student name
  // (shared across every plan page — see the STUDENT INFORMATION section).
  function renderWelcomeMessages(){
    var info = window.AAUP_STUDENT ? window.AAUP_STUDENT.get() : null;
    PLANS.forEach(function(prefix){
      var el = document.getElementById(prefix + '-welcomeMsg');
      if(!el) return;
      var rtl = isRtl(prefix);
      if(info && info.name){
        el.textContent = (rtl ? 'أهلاً، ' : 'Welcome, ') + info.name + ' ';
      } else {
        el.textContent = rtl ? 'أهلاً بك! ' : 'Welcome! ';
      }
    });
  }
  window.__renderWelcomeMessages = renderWelcomeMessages;

  // Swappable rather than hardcoded, so a later module (js/50-whats-next.js)
  // can take over what fills this card without this file needing to know
  // that module exists. If nothing patches it, the flat list right below
  // keeps working exactly as before — there is no scenario where the card
  // silently goes blank because a later script failed to load.
  var nextCoursesRenderer = renderNextCourses;
  window.__patchNextCoursesRenderer = function(fn){ nextCoursesRenderer = fn; };

  function renderNextCourses(prefix){
    var body = document.getElementById(prefix + '-nextCoursesBody');
    if(!body) return;
    var page = document.getElementById('page-' + prefix);
    var data = window.__PLAN_DATA[prefix] || {};
    var info = data.courseInfo || {};
    var rtl = isRtl(prefix);
    var available = page ? Array.prototype.slice.call(page.querySelectorAll('.course.available[id]')) : [];

    if(available.length === 0){
      body.innerHTML = '<p class="ncp-empty">' + (rtl
        ? 'لا توجد مساقات جديدة متاحة الآن — أكمل بعض المتطلبات السابقة أولاً.'
        : 'Nothing new is unlocked yet — complete a few prerequisites first.') + '</p>';
      return;
    }

    var CAP = 8;
    var shown = available.slice(0, CAP);
    var html = '<div class="next-courses-list">';
    shown.forEach(function(el){
      var parts = splitCourseId(el.id);
      var meta = parts && info[parts.slug];
      var name = meta ? (rtl ? meta.ar : meta.name) : el.textContent.trim();
      var cr = meta ? meta.cr : '';
      html += '<button type="button" class="next-course-chip" data-course-id="' + el.id + '">' +
        '<span>' + name + '</span>' +
        (cr ? '<span class="ncc-cr">' + cr + 'H</span>' : '') +
        '</button>';
    });
    html += '</div>';
    if(available.length > CAP){
      html += '<p class="ncp-empty" style="margin-top:8px;">+' + (available.length - CAP) +
        (rtl ? ' مساقًا إضافيًا متاحًا' : ' more available') + '</p>';
    }
    body.innerHTML = html;

    body.querySelectorAll('.next-course-chip').forEach(function(chip){
      chip.addEventListener('click', function(){
        var id = chip.getAttribute('data-course-id');
        var parts = splitCourseId(id);
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


  // ---------- checkbox toggling, prerequisite cascade, pair-sync ----------
  function updateAllWidgets(){ PLANS.forEach(updateWidget); }

  function setCourseState(el, done){
    el.classList.toggle('completed', done);
    var box = el.querySelector('.course-check');
    if(box) box.setAttribute('aria-checked', done ? 'true' : 'false');
  }

  // Splits e.g. "robotics-c-elective-swarm-robotics" into
  // prefix "robotics" and slug "elective-swarm-robotics" (a course slug can
  // itself contain "-c-", so only the first split is treated as the divider).
  function splitCourseId(id){
    var idx = id.indexOf('-c-');
    if(idx === -1) return null;
    return { prefix: id.slice(0, idx), slug: id.slice(idx + 3) };
  }
  window.__splitCourseId = splitCourseId;

  // Completing a course implies its prerequisites are done too (e.g. marking
  // Calculus II also marks Calculus I; marking Machine Learning also marks
  // Linear Algebra, Data Science and Analytics, Fundamentals of AI, etc.,
  // walking the whole chain back). Uses each plan's own PREREQS data,
  // registered via window.__registerPlanData.
  function cascadeMarkPrereqs(prefix, slug, visited){
    var planData = window.__PLAN_DATA && window.__PLAN_DATA[prefix];
    var needs = planData && planData.needsMap && planData.needsMap[slug];
    if(!needs) return;
    needs.forEach(function(reqSlug){
      if(visited[reqSlug]) return;
      visited[reqSlug] = true;
      var fullId = prefix + '-c-' + reqSlug;
      var reqEl = document.getElementById(fullId);
      if(reqEl && !progress[fullId]){
        progress[fullId] = true;
        setCourseState(reqEl, true);
      }
      cascadeMarkPrereqs(prefix, reqSlug, visited);
    });
  }

  // A lecture course and its lab sit together inside a shared ".pair-group"
  // wrapper (see the "Connected — e.g. a course and its lab" legend entry),
  // but that wrapper covers two different real relationships. Most pairs
  // (Programming Fundamentals + its lab, Introduction to CS + its lab) are
  // literally one registration/one catalog number split across two display
  // rows, so completing one correctly completes both. English lecture/lab
  // pairs are genuinely separate courses with their own catalog numbers —
  // a student can pass one without the other yet, and each carries its own
  // grade — so ".pair-group.independent-grades" opts a wrapper out of the
  // auto-complete-together behavior entirely, without touching how any
  // other existing pair already works.
  function getPairSibling(el){
    var group = el.closest ? el.closest('.pair-group') : null;
    if(!group || group.classList.contains('independent-grades')) return null;
    var courses = group.querySelectorAll('.course[id]:not(.course-removed)');
    for(var i = 0; i < courses.length; i++){
      if(courses[i] !== el) return courses[i];
    }
    return null;
  }

  // Un-completing a course means any course that was unlocked *by* it (i.e.
  // every course that lists it as a prerequisite, walked forward through the
  // whole chain) can no longer be considered complete either — e.g.
  // un-marking Linear Algebra also un-marks Machine Learning. Mirrors
  // cascadeMarkPrereqs but walks unlocksMap forward instead of needsMap back.
  function cascadeUnmarkDependents(prefix, slug, visited){
    var planData = window.__PLAN_DATA && window.__PLAN_DATA[prefix];
    var unlocks = planData && planData.unlocksMap && planData.unlocksMap[slug];
    if(!unlocks) return;
    unlocks.forEach(function(depSlug){
      if(visited[depSlug]) return;
      visited[depSlug] = true;
      var fullId = prefix + '-c-' + depSlug;
      var depEl = document.getElementById(fullId);
      if(depEl && progress[fullId]){
        delete progress[fullId];
        setCourseState(depEl, false);
        unmarkPairSibling(depEl);
      }
      cascadeUnmarkDependents(prefix, depSlug, visited);
    });
  }

  // Un-marks a course's paired lecture/lab sibling, if it's currently marked.
  function unmarkPairSibling(el){
    var sib = getPairSibling(el);
    if(sib && progress[sib.id]){
      delete progress[sib.id];
      setCourseState(sib, false);
    }
  }

  function toggleCourse(el){
    var done = !progress[el.id];
    if(done){
      progress[el.id] = true;
      setCourseState(el, true);
      var parts = splitCourseId(el.id);
      if(parts){ cascadeMarkPrereqs(parts.prefix, parts.slug, {}); }

      // A course and its lab are completed together.
      var sib = getPairSibling(el);
      if(sib && !progress[sib.id]){
        progress[sib.id] = true;
        setCourseState(sib, true);
        var sibParts = splitCourseId(sib.id);
        if(sibParts){ cascadeMarkPrereqs(sibParts.prefix, sibParts.slug, {}); }
      }
    } else {
      delete progress[el.id];
      setCourseState(el, false);

      // Anything that depended on this course is no longer actually
      // complete, so un-check the whole chain of courses that follow it.
      var undoneParts = splitCourseId(el.id);
      if(undoneParts){ cascadeUnmarkDependents(undoneParts.prefix, undoneParts.slug, {}); }

      // A course and its lab are un-completed together.
      unmarkPairSibling(el);
    }
    saveProgress();
    updateWidget(el.id.split('-c-')[0]);
  }


  // ---------- initial render (checkbox injection into static markup) ----------
  function injectCheckboxes(){
    document.querySelectorAll('.course[id]:not(.course-removed)').forEach(function(el){
      if(el.querySelector('.course-check')) return;
      var box = document.createElement('span');
      box.className = 'course-check';
      box.setAttribute('role', 'checkbox');
      box.setAttribute('tabindex', '0');
      box.setAttribute('aria-checked', 'false');
      box.setAttribute('aria-label', isRtl(el.id.split('-c-')[0])
        ? 'ضع علامة إنجاز على المساق' : 'Mark course as completed');
      box.textContent = '\u2713';
      box.addEventListener('click', function(e){
        e.stopPropagation();
        toggleCourse(el);
      });
      box.addEventListener('keydown', function(e){
        if(e.key === 'Enter' || e.key === ' '){
          e.preventDefault();
          e.stopPropagation();
          toggleCourse(el);
        }
      });
      el.appendChild(box);

      if(!el.querySelector('.course-badge')){
        var badge = document.createElement('span');
        badge.className = 'course-badge';
        el.appendChild(badge);
      }

      setCourseState(el, !!progress[el.id]);
    });
  }

  // A self-contained "are you sure?" dialog, built and torn down on demand.
  // We avoid window.confirm() here: some embedded/sandboxed viewers block
  // native dialogs entirely (confirm() silently returns undefined instead of
  // throwing), which made the reset button look like it did nothing at all.

  // ---------- reusable confirm dialog (used by reset, data wipe, plan-editor sync) ----------
  function showConfirmDialog(message, onConfirm, rtl, onCancel){
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    // Above every other layer, not below them. At 999 this sat one below
    // .modal-overlay's own 1000, so a confirm raised from inside a modal —
    // "Remove" in the leftover-data review, "Remove course" in edit mode,
    // "Reset all data" in Settings — opened behind the screen that raised it
    // and could be neither seen nor clicked. The button looked dead.
    overlay.style.zIndex = '1500';

    var card = document.createElement('div');
    card.className = 'modal-card';
    card.style.maxWidth = '360px';
    card.style.textAlign = 'center';

    var text = document.createElement('p');
    text.textContent = message;
    text.style.margin = '10px 0 18px';
    text.style.color = 'var(--text)';
    text.style.fontSize = '13.5px';
    text.style.whiteSpace = 'pre-line';

    var actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '10px';
    actions.style.justifyContent = 'center';

    var confirmed = false;
    function close(){
      if(overlay.parentNode){ overlay.parentNode.removeChild(overlay); }
      document.removeEventListener('keydown', onKeydown);
      if(!confirmed && onCancel){ onCancel(); }
    }
    function onKeydown(e){
      if(e.key === 'Escape') close();
    }

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'pw-reset';
    cancelBtn.textContent = rtl ? 'إلغاء' : 'Cancel';
    cancelBtn.addEventListener('click', close);

    var okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'pw-reset';
    okBtn.style.borderColor = 'var(--accent)';
    okBtn.style.color = 'var(--text)';
    okBtn.textContent = rtl ? 'تأكيد' : 'OK';
    okBtn.addEventListener('click', function(){
      confirmed = true;
      close();
      onConfirm();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    card.appendChild(text);
    card.appendChild(actions);
    overlay.appendChild(card);
    overlay.addEventListener('click', function(e){
      if(e.target === overlay) close();
    });
    card.addEventListener('click', function(e){ e.stopPropagation(); });

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeydown);
    okBtn.focus();
  }
  // Shared by the data export/import/reset module below, so there's only
  // ever one confirm-dialog implementation in the whole file.
  window.__showConfirmDialog = showConfirmDialog;


  // ---------- reset button + page init ----------
  function bindResetButtons(){
    PLANS.forEach(function(prefix){
      var btn = document.getElementById(prefix + '-progressReset');
      if(!btn) return;
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var page = document.getElementById('page-' + prefix);
        var msg = isRtl(prefix)
          ? 'هل تريد مسح كل التقدم المحفوظ لهذه الخطة؟'
          : 'Clear all saved progress for this plan?';
        showConfirmDialog(msg, function(){
          var courses = page ? page.querySelectorAll('.course[id]:not(.course-removed)') : [];
          courses.forEach(function(el){
            delete progress[el.id];
            setCourseState(el, false);
          });
          saveProgress();
          updateWidget(prefix);
        }, isRtl(prefix));
      });
    });
  }

  function init(){
    injectCheckboxes();
    bindResetButtons();
    updateAllWidgets();
    renderWelcomeMessages();
  }

  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }

  // Keep the "My Progress" summary text in sync when a plan's language is toggled.
  var _origToggleLang = window.toggleLang;
  if(typeof _origToggleLang === 'function'){
    window.toggleLang = function(prefix){
      _origToggleLang(prefix);
      updateWidget(prefix);
    };
  }

  // Exposed so other modules (removing/restoring a course from the plan)
  // can recompute the whole progress / availability / panel / achievement
  // UI exactly the way ticking a checkbox already does.
  window.__refreshPlanUI = function(prefix){
    updateWidget(prefix);
    if(window.__refreshCollapse){ window.__refreshCollapse(prefix); }
    if(window.__refreshWorkloadSummary){ window.__refreshWorkloadSummary(prefix); }
  };
})();
