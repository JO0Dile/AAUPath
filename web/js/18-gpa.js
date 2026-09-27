// ==========================
// GPA CALCULATOR
// ==========================
(function(){
  // Verified against AAUP's own published scale via two independent
  // AAUP-specific calculator tools (un-web.com/tools/aauj and calcweb.ai/aauj)
  // that both show the same table: the standard 11-tier, 0.33-step 4.0 system
  // (A, A-, B+, B, B-, C+, C, C-, D+, D, F). F is treated as 0.00 here — one
  // of the two sources listed "0.35" for F, which conflicts with its own
  // standing table (whose floor is 0.00) and with universal convention, so
  // that specific figure reads as a transcription slip rather than a real
  // AAUP rule. If you have the official bylaws PDF handy, it's worth a
  // cross-check: aaup.edu's own "Instructions for granting the Bachelor's
  // degree" document (search its filename on aaup.edu/sites/default/files).
  // Verified against a real AAUP transcript, which lists the point values
  // directly (C+ = 2.33, A- = 3.67, B+ = 3.33 ...) — the standard American
  // scale, with one AAUP-specific twist: F is worth 0.35, not 0. That's
  // provable, not just read off the page: with F = 0, no combination of
  // credit hours can reproduce that transcript's semester GPA; with
  // F = 0.35, it reproduces exactly. Since confirmed directly against
  // AAUP's own official grade-scale table (every value below matches it
  // exactly, including F/FA at 0.35 and the 90-100/87-89/... numeric
  // ranges now encoded in NUMERIC_GRADE_RANGES below).
  // FA (failed for absence — a doctor withdrew the student) counts exactly
  // like F: 0.35, and it drags the GPA down the same way. W (withdrew) does
  // NOT count at all — it's excluded from the GPA entirely and just marks the
  // course for a clean retake, so it is deliberately absent from GRADE_POINTS.
  var GRADE_POINTS = {
    'A': 4.00, 'A-': 3.67, 'B+': 3.33, 'B': 3.00, 'B-': 2.67,
    'C+': 2.33, 'C': 2.00, 'C-': 1.67, 'D+': 1.33, 'D': 1.00, 'F': 0.35, 'FA': 0.35
  };
  // TR (transferred, idea 8): a course taken at another university or
  // elsewhere and credited here. It is passed, so its hours count, but it
  // has no points, so like W it never enters the GPA.
  var GRADE_ORDER = ['A','A-','B+','B','B-','C+','C','C-','D+','D','F','FA','W','TR'];
  // `g in GRADE_POINTS` walked the prototype chain, so a stored grade of
  // "constructor", "toString", "valueOf", "__proto__", "hasOwnProperty" (or any
  // other inherited name) passed the guard and then multiplied a credit-hour
  // count by a FUNCTION. The result was a NaN GPA shown on the dashboard and in
  // the audit, with the standing silently reading "Probation" because every
  // NaN comparison is false. Grades reach this code from localStorage, which a
  // student can edit, an import can write, and a sync can rewrite — so the
  // check has to be own-property only.
  function isRealGrade(g){
    return typeof g === 'string' && Object.prototype.hasOwnProperty.call(GRADE_POINTS, g);
  }
  // Official numeric-score -> letter-grade ranges (AAUP's own published
  // table). Used only for the optional "enter your numeric score" input in
  // the grade UI — a student who knows their exact percentage (e.g. their
  // own lecture/lab-weighted total, which this app doesn't know the split
  // for on every course) can type the number instead of picking a letter,
  // and it resolves to the correct letter automatically. Ordered highest
  // floor first so the first match wins.
  //
  // AAUP actually runs TWO different numeric scales depending on the
  // course's college — Engineering programs pass D at 60, while the
  // Faculty of Artificial Intelligence and Data Science's own scale passes
  // D at 50 (confirmed against an official AAUP grade-scale screenshot for
  // each). Every other tier shifts down to match. Which table applies is a
  // per-course choice (see numericScaleFor / PASS_MARK_OVERRIDE below) —
  // it defaults by plan but a student can flip any individual course.
  var ENGINEERING_NUMERIC_GRADE_RANGES = [
    { min: 90, max: 100, grade: 'A' },
    { min: 87, max: 89,  grade: 'A-' },
    { min: 84, max: 86,  grade: 'B+' },
    { min: 80, max: 83,  grade: 'B' },
    { min: 76, max: 79,  grade: 'B-' },
    { min: 72, max: 75,  grade: 'C+' },
    { min: 69, max: 71,  grade: 'C' },
    { min: 66, max: 68,  grade: 'C-' },
    { min: 63, max: 65,  grade: 'D+' },
    { min: 60, max: 62,  grade: 'D' },
    { min: 0,  max: 59,  grade: 'F' }
  ];
  var AI_NUMERIC_GRADE_RANGES = [
    { min: 90, max: 100, grade: 'A' },
    { min: 86, max: 89,  grade: 'A-' },
    { min: 80, max: 85,  grade: 'B+' },
    { min: 76, max: 79,  grade: 'B' },
    { min: 72, max: 75,  grade: 'B-' },
    { min: 68, max: 71,  grade: 'C+' },
    { min: 64, max: 67,  grade: 'C' },
    { min: 59, max: 63,  grade: 'C-' },
    { min: 54, max: 58,  grade: 'D+' },
    { min: 50, max: 53,  grade: 'D' },
    { min: 0,  max: 49,  grade: 'F' }
  ];
  // Kept for backward compatibility — the Engineering table was the only
  // one that existed before, so anything still reading NUMERIC_GRADE_RANGES
  // directly (rather than going through letterForScore/numericScaleFor)
  // keeps working exactly as before.
  var NUMERIC_GRADE_RANGES = ENGINEERING_NUMERIC_GRADE_RANGES;

  // Which plans default to the AI college's numeric scale. Only robotics
  // (Artificial Intelligence and Robotics) is directly confirmed via a
  // student's own AAUP course-result screenshot; the other AI-branded
  // plans built alongside it live in the same Faculty of Artificial
  // Intelligence and Data Science, so they share the default too — but
  // it's only ever a default, never asserted as verified per-plan, and
  // every single course can be flipped to the other scale regardless.
  var AI_SCALE_DEFAULT_PLANS = {
    'robotics': 1,
    'aaup-ai-innovation': 1,
    'aaup-statistics-data-science': 1,
    'aaup-ai-fintech': 1,
    'aaup-financial-engineering': 1,
    'aaup-finance-data-science': 1
  };
  // Per-course override of which numeric scale to use — independent for
  // every course, exactly like the pair-mode override above, because in
  // practice the pass mark isn't uniform even within one plan (a shared
  // English course might pass at 50 while a major course passes at 60).
  function loadPassMarkOverrides(){ return loadMap('aaup_passMarkOverride'); }
  function savePassMarkOverrides(m){ saveMap('aaup_passMarkOverride', m); }
  function numericScaleFor(prefix, pid){
    var override = loadPassMarkOverrides()[pid];
    if(override === 'ai' || override === 'engineering') return override;
    return AI_SCALE_DEFAULT_PLANS[prefix] ? 'ai' : 'engineering';
  }
  function rangesForScale(scale){
    return scale === 'ai' ? AI_NUMERIC_GRADE_RANGES : ENGINEERING_NUMERIC_GRADE_RANGES;
  }
  // prefix/pid are optional — omitting them keeps the old Engineering-only
  // behavior for any caller that hasn't been updated to pass them.
  function letterForScore(score, prefix, pid){
    var n = parseFloat(score);
    if(isNaN(n)) return null;
    n = Math.max(0, Math.min(100, n));
    var ranges = (prefix && pid) ? rangesForScale(numericScaleFor(prefix, pid)) : ENGINEERING_NUMERIC_GRADE_RANGES;
    for(var i = 0; i < ranges.length; i++){
      var r = ranges[i];
      if(n >= r.min && n <= r.max) return r.grade;
    }
    return null;
  }
  // Grades that mean the course was NOT passed and needs a retake (it doesn't
  // satisfy its requirement and doesn't count toward completion).
  var NON_PASSING = { 'F': true, 'FA': true, 'W': true };
  // Grades that count as a failure against academic standing (F and FA hit the
  // GPA; W is a clean withdrawal, so it isn't a "fail").
  var FAIL_GRADES = { 'F': true, 'FA': true };
  // Same prototype-chain trap as isRealGrade above: NON_PASSING['constructor']
  // is a function, so `!!NON_PASSING[g]` reported a garbage grade as a failed
  // course and held its dependents locked.
  function own(map, k){
    return typeof k === 'string' && Object.prototype.hasOwnProperty.call(map, k);
  }
  function isNonPassing(g){ return own(NON_PASSING, g); }
  function isFailGrade(g){ return own(FAIL_GRADES, g); }
  // Dropdown label: the two special grades get a short descriptor so students
  // know what they mean; ordinary letter grades show as-is.
  // The long form, for a <select> option where a row of text is the whole
  // control and there is room to explain.
  function gradeLabel(g){
    if(g === 'W') return 'W — Withdrawn (not counted)';
    if(g === 'FA') return 'FA — Absence fail (counts as F)';
    if(g === 'TR') return 'TR — Transferred (hours count, not in the GPA)';
    return g;
  }
  // The short form, for anywhere the grade is a CHIP. gradeLabel's sentence
  // inside a 30px chip wrapped one character per line and made the row a
  // thousand pixels tall (js/51-gpa-studio.js) — the explanation belongs in a
  // footnote under the grid, not inside the button.
  function gradeShort(g){ return g; }

  function loadMap(key){
    return window.AAUP_STORAGE.getJSON(key, {});
  }
  function saveMap(key, obj){
    window.AAUP_STORAGE.setJSON(key, obj);
  }

  // Whether a lecture and its lab share one grade defaults to whether they
  // share one real catalog number (the AAUP course list already encodes
  // that as courseInfo.num). A student can override that default per pair
  // via the "connect course" toggle on the card — e.g. their own transcript
  // grades a pair independently even though the catalog number matches, or
  // vice versa — without needing that toggle to know anything about num
  // matching itself; it just flips this stored map and both primaryId() and
  // the checkbox-completion cascade (getPairSibling, which reads the same
  // .independent-grades class this map is kept in sync with) follow it.
  function loadPairModeOverrides(){ return loadMap('aaup_pairModeOverride'); }
  function savePairModeOverrides(m){ saveMap('aaup_pairModeOverride', m); }
  function pairOverrideKey(prefix, baseSlug){ return prefix + '|' + baseSlug; }

  // A lecture+lab pair is one real course — grade/status/credit accounting
  // resolves to the non-"-lab" half by default (when the catalog numbers
  // match), unless a stored override says otherwise for this specific pair.
  function primaryId(prefix, slug){
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    var base = slug.slice(-4) === '-lab' ? slug.slice(0, -4) : null;
    if(base && info[base] && info[slug]){
      var override = loadPairModeOverrides()[pairOverrideKey(prefix, base)];
      var merge = override ? (override === 'same') : (info[base].num === info[slug].num);
      if(merge){ return prefix + '-c-' + base; }
    }
    return prefix + '-c-' + slug;
  }

  // categoryFilter(el) -> boolean, or null/undefined for "every graded course".
  //
  // `scenario` is how the What-if screen (js/63-whatif.js) asks "what would
  // my GPA be IF…" without a second implementation of these rules drifting
  // away from this one — which is the only way the two numbers a student
  // compares can ever be computed differently:
  //   scenario.replace  { [primaryId]: grade }  a different grade for a
  //                     course, including one not passed yet (a retake, or a
  //                     course being planned)
  //   scenario.add      [{ cr, grade }]         hypothetical courses that are
  //                     not on this plan's page at all
  function gpaFor(prefix, categoryFilter, scenario){
    var replace = (scenario && scenario.replace) || {};
    var extra = (scenario && scenario.add) || [];
    var hasReplacement = function(pid){ return Object.prototype.hasOwnProperty.call(replace, pid); };
    var grades = loadMap('aaup_grades');
    var progress = window.__getProgress ? window.__getProgress() : {};
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    var page = document.getElementById('page-' + prefix);
    var courses = page ? Array.prototype.slice.call(page.querySelectorAll('.course[id]:not(.course-removed)')) : [];
    var seenNum = {};
    var points = 0, credits = 0;

    courses.forEach(function(el){
      var parts = window.__splitCourseId(el.id);
      if(!parts) return;
      var meta = info[parts.slug];
      if(!meta) return;
      var pid = primaryId(prefix, parts.slug);
      if(pid !== el.id) return; // count each real course once, via its primary half
      // "-" is a placeholder num shared by every generic elective slot, not
      // a real identifier — never dedupe on it, or every "University
      // Elective (N)" would collapse into one course for GPA purposes.
      var dedupeKey = (meta.num && meta.num !== '-') ? meta.num : parts.slug;
      if(seenNum[dedupeKey]) return;
      seenNum[dedupeKey] = true;

      if(categoryFilter && !categoryFilter(el)) return;
      if(!progress[pid] && !hasReplacement(pid)) return;
      var g = hasReplacement(pid) ? replace[pid] : grades[pid];
      if(!isRealGrade(g)) return;

      // AAUP's repeat policy: once a course has been retaken AND the
      // retake has its own grade, the ORIGINAL attempt is excluded from
      // the cumulative GPA — the new grade replaces it. (It still counts
      // inside its own semester's GPA below, which is why a transcript's
      // early-semester GPAs stay low while the cumulative recovers.)
      // This is provable from a real transcript: semester GPAs of 1.91
      // and 1.82 can never average to a cumulative of 2.22 unless
      // something gets excluded — and the repeated original is that
      // something. Until the retake actually has a grade, the F stays.
      if(window.AAUP_RETAKES && window.AAUP_RETAKES.isSuperseded(prefix, parts.slug)){
        var retakeSlug = window.AAUP_RETAKES.retakeSlugFor(prefix, parts.slug);
        var retakePid = prefix + '-c-' + retakeSlug;
        var retakeGrade = hasReplacement(retakePid) ? replace[retakePid] : grades[retakePid];
        if(isRealGrade(retakeGrade)) return;
      }

      var cr = parseFloat(meta.cr) || 0;
      points += GRADE_POINTS[g] * cr;
      credits += cr;
    });

    extra.forEach(function(x){
      if(!isRealGrade(x.grade)) return;
      var cr = parseFloat(x.cr) || 0;
      points += GRADE_POINTS[x.grade] * cr;
      credits += cr;
    });

    return { gpa: credits ? (points / credits) : null, credits: credits };
  }

  // Per-semester GPA breakdown: groups graded courses by the semester row
  // they sit in. Unlike the cumulative above, a semester's own GPA keeps
  // EVERY attempt made that semester (an F stays in its semester forever,
  // exactly as on a university transcript) — replacement only affects the
  // cumulative. Returns [{label, ar, gpa, credits}] in plan order.
  function semesterGpas(prefix){
    var grades = loadMap('aaup_grades');
    var progress = window.__getProgress ? window.__getProgress() : {};
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    var page = document.getElementById('page-' + prefix);
    if(!page) return [];
    var out = [];
    var rows = Array.prototype.slice.call(page.querySelectorAll('.course-row[id]'));
    rows.forEach(function(row){
      var m = /-y(\d+)-s(\d+)$/.exec(row.id);
      if(!m) return;
      var points = 0, credits = 0, seenNum = {};
      row.querySelectorAll('.course[id]:not(.course-removed)').forEach(function(el){
        var parts = window.__splitCourseId(el.id);
        if(!parts) return;
        var meta = info[parts.slug];
        if(!meta) return;
        var pid = primaryId(prefix, parts.slug);
        if(pid !== el.id) return;
        var dedupeKey = (meta.num && meta.num !== '-') ? meta.num : parts.slug;
        if(seenNum[dedupeKey]) return;
        seenNum[dedupeKey] = true;
        if(!progress[pid]) return;
        var g = grades[pid];
        if(!isRealGrade(g)) return;
        var cr = parseFloat(meta.cr) || 0;
        points += GRADE_POINTS[g] * cr;
        credits += cr;
      });
      if(credits > 0){
        var semLabel = m[2] === '3' ? 'Summer' : 'Semester ' + m[2];
        var semAr = m[2] === '3' ? 'الصيفي' : 'الفصل ' + m[2];
        out.push({
          label: 'Year ' + m[1] + ' — ' + semLabel,
          ar: 'السنة ' + m[1] + ' — ' + semAr,
          gpa: points / credits, credits: credits
        });
      }
    });
    return out;
  }

  // ---------------------------------------------------------------------
  // "What would I need to average?" — shared by the Degree Audit's target
  // box (whole remaining degree) and What-if's target box (just the planned
  // semester). One formula, so the two screens can never quietly disagree
  // about what "you need a 3.87 average" actually means.
  //
  // Solve target = (basePoints + need*extraHours) / (baseCredits+extraHours)
  // for need.
  function neededAverage(basePoints, baseCredits, extraHours, target){
    if(!extraHours || extraHours <= 0) return null;
    return (target * (baseCredits + extraHours) - basePoints) / extraHours;
  }

  // Turns a raw "need" grade-point value into what a student actually reads:
  // already there, a nameable letter average, or physically out of reach —
  // classified against the real 4.0-scale letters, not just printed as a
  // number nobody has ever seen on a transcript.
  function describeNeeded(need, extraHours, basePoints, baseCredits){
    if(need === null) return { status: 'none' };
    if(need <= GRADE_POINTS.F) return { status: 'already', need: need };
    if(need > 4){
      var best = (basePoints + 4 * extraHours) / (baseCredits + extraHours);
      return { status: 'impossible', need: need, bestCase: best };
    }
    var order = GRADE_ORDER.filter(function(g){ return GRADE_POINTS[g] !== undefined; })
      .sort(function(a, b){ return GRADE_POINTS[a] - GRADE_POINTS[b]; });
    var letter = order[order.length - 1];
    for(var i = 0; i < order.length; i++){
      if(GRADE_POINTS[order[i]] >= need - 0.001){ letter = order[i]; break; }
    }
    return { status: 'reachable', need: need, letter: letter };
  }

  function standingFor(gpa){
    // NaN fails every comparison below, so an unguarded NaN used to fall
    // through to "Probation" — the worst possible label, invented from data
    // that simply wasn't a number. Treat it as "no grades" instead.
    if(gpa === null || typeof gpa !== 'number' || !isFinite(gpa)) return { label: 'No grades yet', cls: 'standing-none', ar: 'لا توجد علامات بعد' };
    if(gpa >= 3.0) return { label: 'Good Standing', cls: 'standing-good', ar: 'وضع أكاديمي جيد' };
    if(gpa >= 2.0) return { label: 'Warning', cls: 'standing-warning', ar: 'إنذار' };
    return { label: 'Probation', cls: 'standing-probation', ar: 'فصل / إنذار أكاديمي' };
  }

  window.AAUP_GPA = {
    GRADE_POINTS: GRADE_POINTS, GRADE_ORDER: GRADE_ORDER,
    isNonPassing: isNonPassing, isFailGrade: isFailGrade,
    gradeLabel: gradeLabel, gradeShort: gradeShort,
    // Exported so no caller has to write `g in GRADE_POINTS` again — that
    // check is prototype-chain unsafe for grades that came from storage.
    isRealGrade: isRealGrade,
    letterForScore: letterForScore, NUMERIC_GRADE_RANGES: NUMERIC_GRADE_RANGES,
    ENGINEERING_NUMERIC_GRADE_RANGES: ENGINEERING_NUMERIC_GRADE_RANGES,
    AI_NUMERIC_GRADE_RANGES: AI_NUMERIC_GRADE_RANGES,
    numericScaleFor: numericScaleFor,
    loadPassMarkOverrides: loadPassMarkOverrides,
    savePassMarkOverrides: savePassMarkOverrides,
    loadGrades: function(){ return loadMap('aaup_grades'); },
    saveGrades: function(m){ saveMap('aaup_grades', m); },
    // Per-course assessment breakdown ({[pid]: [{label, score, max}, ...]}) —
    // AAUP shows a course's mid-term/lab/quiz/assignment marks separately
    // (with the max for each set by the individual instructor, never fixed),
    // never the final exam mark itself, so this mirrors that: whatever
    // components the student adds, summed for a running percentage.
    loadAssessmentBreakdown: function(){ return loadMap('aaup_assessmentBreakdown'); },
    saveAssessmentBreakdown: function(m){ saveMap('aaup_assessmentBreakdown', m); },
    loadStatuses: function(){ return loadMap('aaup_courseStatus'); },
    saveStatuses: function(m){ saveMap('aaup_courseStatus', m); },
    primaryId: primaryId,
    gpaFor: gpaFor,
    semesterGpas: semesterGpas,
    neededAverage: neededAverage,
    describeNeeded: describeNeeded,
    standingFor: standingFor,
    loadPairModeOverrides: loadPairModeOverrides,
    savePairModeOverrides: savePairModeOverrides,
    pairOverrideKey: pairOverrideKey
  };
})();
