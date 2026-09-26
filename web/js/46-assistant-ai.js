// ==========================
// SMART ASSISTANT — the online brain
// ==========================
// The offline assistant (js/42-assistant.js) matches phrasing it recognises.
// This one actually understands the question: it sends it to a language model
// through the app's own Worker (ai/cloudflare-worker.js), along with the real
// data the app has loaded, and can operate the app in reply.
//
// Three things this module is responsible for, in order of importance:
//
//   1. GROUNDING. The model is never asked a question on its own. Every
//      request carries a block built here from live state — the plan, its
//      courses, prerequisites, credit hours, the student's progress, and what
//      the app's features do. The model is told to answer from that and
//      nothing else. Grounding is what keeps a fluent model from inventing a
//      prerequisite, which is the failure that actually costs a student a
//      semester.
//
//   2. NUMBERS COME FROM CODE, NOT FROM THE MODEL. GPA, credit totals, which
//      courses are unlocked, which prerequisites are missing — all computed by
//      the app's own modules and handed over as facts. The model's job is to
//      understand and explain, not to do arithmetic on someone's degree.
//
//   3. NOTHING WRITES WITHOUT A HUMAN. The model can navigate and teach on its
//      own. When it wants to change a student's record it can only *propose*,
//      and the proposal is built by the offline engine's own code, so it
//      carries the same prerequisite warnings. The student taps to accept.
//
// If any of this is unavailable — no Worker configured, no connection, daily
// free quota spent — the caller falls back to the offline engine and the chat
// keeps working.
(function () {
  var MODE_KEY = 'aaup_ai_mode';      // 'on' | 'off' | unset (never asked)
  var MAX_TURNS = 6;                  // conversation turns sent for context
  var MAX_COURSES = 200;              // grounding cap; the largest plan is ~86
  var TIMEOUT_MS = 25000;

  var history = [];                   // [{role, content}]

  function url() { return window.APP_AI_URL || ''; }
  function configured() { return !!url(); }

  // Circuit breaker for an endpoint that is not there.
  //
  // APP_AI_URL is set to the Worker's future address before the Worker is
  // deployed, and a Worker can also be deleted, renamed, or be down. Without
  // this, every single question would spend its timeout waiting on a host
  // that will never answer, and a student would sit watching three dots for
  // twenty seconds before getting a reply the app had available instantly.
  //
  // A few consecutive transport failures and the online brain is dropped for
  // the rest of the session — answers come straight from the on-device
  // engine, no wait, no repeated failures. Toggling smart mode resets it, so
  // a student who knows the Worker just came back can retry immediately.
  var consecutiveFailures = 0;
  var UNREACHABLE_AFTER = 3;
  function unreachable() { return consecutiveFailures >= UNREACHABLE_AFTER; }

  function mode() {
    try { return localStorage.getItem(MODE_KEY) || ''; } catch (e) { return ''; }
  }
  function setMode(v) {
    try { localStorage.setItem(MODE_KEY, v); } catch (e) {}
    consecutiveFailures = 0; // an explicit toggle is a request to try again
  }
  function asked() { return mode() === 'on' || mode() === 'off'; }
  function enabled() { return configured() && mode() === 'on' && navigator.onLine !== false && !unreachable(); }

  // ---------------------------------------------------------------
  // GROUNDING
  // ---------------------------------------------------------------
  function featureDigest() {
    var KB = window.AAUP_ASSISTANT_KB;
    if (!KB || !KB.topics) return '';
    // Title plus the English body of every topic. This is the same material
    // the offline assistant answers from — it stops being the answer and
    // becomes the reference the model reads.
    return KB.topics.map(function (t) {
      return '- ' + t.title.en + ': ' + (t.body.en || []).join(' ');
    }).join('\n');
  }

  function catalogueSummary() {
    var unis = window.APP_UNIVERSITIES || {};
    var names = Object.keys(unis).map(function (k) {
      return ((unis[k].name || {}).en || k);
    });
    if (!names.length) return '';
    var plans = (window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()) || {};
    return 'Universities in this app: ' + names.join(', ') + '.\n' +
           'Total study plans loaded: ' + Object.keys(plans).length + '.';
  }

  function currentScreen() {
    var dash = document.getElementById('dashboard');
    if (dash && dash.offsetParent !== null) return 'the Dashboard';
    var pages = document.querySelectorAll('.plan-page, #importedPlanView');
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].offsetParent !== null) return 'the Study Plan page';
    }
    var home = document.getElementById('home');
    if (home && home.offsetParent !== null) return 'the plan picker (home)';
    return 'the app';
  }

  function planSummary() {
    var A = window.AAUP_ASSISTANT;
    var prefix = A && A.currentPlan();
    if (!prefix) return 'No study plan is open right now. The student is on ' + currentScreen() + '.';

    var lines = [];
    var info = (A.planData(prefix).courseInfo) || {};
    var needsMap = A.planData(prefix).needsMap || {};
    var unlocksMap = A.planData(prefix).unlocksMap || {};

    var plans = (window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()) || {};
    var plan = plans[prefix] || {};
    var display = (window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.planDisplayInfo)
      ? window.AAUP_DASHBOARD.planDisplayInfo(prefix) : { name: prefix };

    lines.push('OPEN STUDY PLAN: ' + display.name);
    if (plan.college && plan.college.en) lines.push('Faculty: ' + plan.college.en);
    if (plan.degreeHours) {
      lines.push('Official degree total: ' + plan.degreeHours + ' credit hours.');
    } else {
      lines.push('Official degree total: NOT CONFIRMED for this plan. Do not state a total or a completion percentage from any other source.');
    }
    if (plan.gradingScale && plan.gradingScale.passMark != null) {
      lines.push('Pass mark for this plan: ' + plan.gradingScale.passMark +
                 (plan.gradingScale.name ? ' (' + plan.gradingScale.name + ')' : ''));
    }
    lines.push('The student is currently looking at ' + currentScreen() + '.');

    // Progress and GPA — computed by the app's own modules, never left to the
    // model to work out.
    if (window.AAUP_AUDIT) {
      var total = 0, done = 0;
      try {
        window.AAUP_AUDIT.computeAudit(prefix).forEach(function (r) { total += r.total; done += r.completed; });
      } catch (e) { total = 0; }
      if (total) {
        lines.push('PROGRESS: ' + done + ' of ' + total + ' credit hours completed (' +
                   Math.round(done / total * 100) + '%), ' + (total - done) + ' remaining.');
      }
    }
    var gpa = window.AAUP_GPA ? window.AAUP_GPA.gpaFor(prefix, null) : null;
    lines.push('GPA: ' + (gpa && gpa.gpa != null ? gpa.gpa : 'no grades entered yet, so there is no GPA.'));

    // Courses, one compact line each: everything needed to answer "what does
    // X need", "why is X locked", "what can I take".
    var slugs = Object.keys(info).slice(0, MAX_COURSES);
    lines.push('');
    lines.push('COURSES (name | code | credit hours | status | prerequisites):');
    slugs.forEach(function (slug) {
      var meta = info[slug] || {};
      var needs = (needsMap[slug] || []).map(function (s) { return A.courseName(prefix, s, 'en'); });
      lines.push('- ' + A.courseName(prefix, slug, 'en') +
        (meta.ar ? ' / ' + meta.ar : '') +
        ' | ' + (meta.num && meta.num !== '-' ? meta.num : 'no code') +
        ' | ' + A.creditsOf(prefix, slug) + 'h' +
        ' | ' + A.courseState(prefix, slug) +
        ' | ' + (needs.length ? needs.join(', ') : 'none') +
        ((unlocksMap[slug] || []).length ? ' | unlocks ' + unlocksMap[slug].length + ' course(s)' : ''));
    });
    if (Object.keys(info).length > MAX_COURSES) {
      lines.push('(…' + (Object.keys(info).length - MAX_COURSES) + ' more courses not listed)');
    }
    return lines.join('\n');
  }

  function buildContext() {
    return [
      catalogueSummary(),
      '',
      planSummary(),
      '',
      'APP FEATURES (what each part of this app does):',
      featureDigest()
    ].join('\n');
  }

  // ---------------------------------------------------------------
  // STRUCTURAL EDITS
  // ---------------------------------------------------------------
  // Adding, removing and moving courses. Every one of these describes the
  // change and hands back a confirm block — the app writes nothing until the
  // student taps. The writes themselves go through AAUP_IMPORTED's own
  // functions, so a course the assistant adds is identical in every way to
  // one added through the + button: same duplicate check, same prerequisite
  // reduction, same auto-link, same re-render.

  function slugify(name) {
    var base = String(name || '').toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
      .replace(/(^-|-$)/g, '');
    return base || ('course-' + Math.random().toString(36).slice(2, 7));
  }

  // Free the id if that slug is taken, so "University Elective" can be added
  // three times without the second one silently failing the duplicate check.
  function freeSlug(prefix, base) {
    var info = window.AAUP_ASSISTANT.planData(prefix).courseInfo || {};
    if (!info[base]) return base;
    for (var n = 2; n < 40; n++) {
      if (!info[base + '-' + n]) return base + '-' + n;
    }
    return base + '-' + Date.now().toString(36);
  }

  function semesterLabel(sem, lang) {
    if (lang === 'ar') return sem === 3 ? 'الفصل الصيفي' : (sem === 2 ? 'الفصل الثاني' : 'الفصل الأول');
    return sem === 3 ? 'the summer semester' : (sem === 2 ? 'semester 2' : 'semester 1');
  }

  function planOf(prefix) {
    var plans = (window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()) || {};
    return plans[prefix];
  }

  // A year the plan does not have yet cannot receive a course. Rather than
  // failing, say so — adding years is its own feature with its own button.
  function hasYear(prefix, yearId) {
    var p = planOf(prefix);
    if (!p || !p.structure || !p.structure.years) return true; // unknown shape: let the app decide
    return p.structure.years.some(function (y) { return y.id === yearId; });
  }

  function proposeAddCourse(prefix, args, lang) {
    if (!prefix) return null;
    var name = String(args.name || '').trim();
    if (!name) return null;
    var year = parseInt(args.year, 10) || 1;
    var sem = parseInt(args.semester, 10) || 1;
    if (sem < 1 || sem > 3) sem = 1;
    var yearId = 'y' + year;
    var credits = Number(args.creditHours);
    if (!(credits >= 0) || credits > 12) credits = 3;
    var category = ['core', 'math', 'dept', 'uni', 'free', 'skills', 'eng'].indexOf(args.category) !== -1
      ? args.category : 'core';

    if (!hasYear(prefix, yearId)) {
      return {
        lines: [lang === 'ar'
          ? 'خطتك لا تحتوي على سنة ' + year + ' بعد. أضف السنة أولًا من «وضع التعديل»، ثم اطلب مني إضافة المساق.'
          : 'Your plan does not have a Year ' + year + ' yet. Add the year first from Edit Mode, then ask me again.'],
        title: null, guide: 'editPlan', confirm: null, chips: null
      };
    }

    return {
      lines: [
        lang === 'ar'
          ? 'سأضيف «' + name + '» إلى السنة ' + year + '، ' + semesterLabel(sem, lang) + '.'
          : 'I will add “' + name + '” to Year ' + year + ', ' + semesterLabel(sem, lang) + '.',
        (lang === 'ar' ? 'الساعات المعتمدة: ' : 'Credit hours: ') + credits,
        lang === 'ar'
          ? 'تُضاف إلى نسختك من الخطة على هذا الجهاز فقط، ويمكنك حذفها أو تعديلها لاحقًا.'
          : 'It goes into your copy of the plan on this device only, and you can edit or remove it later.'
      ],
      title: null, guide: null, chips: null,
      confirm: {
        label: lang === 'ar' ? 'أضف المساق' : 'Add the course',
        warn: null,
        run: function () {
          var IMP = window.AAUP_IMPORTED;
          if (!IMP || !IMP.addCourseDirect) {
            return lang === 'ar' ? 'تعذّرت إضافة المساق.' : 'That course could not be added.';
          }
          var id = freeSlug(prefix, slugify(name));
          IMP.addCourseDirect(prefix, yearId, 's' + sem, name, '', id, credits, category, []);
          return lang === 'ar'
            ? 'تم — أُضيف «' + name + '» إلى السنة ' + year + '.'
            : 'Done — “' + name + '” is now in Year ' + year + '.';
        }
      }
    };
  }

  function proposeRemoveCourse(prefix, args, lang) {
    if (!prefix || !args.course) return null;
    var A = window.AAUP_ASSISTANT;
    var slug = A.findCourse(prefix, args.course);
    if (!slug) return null;
    var name = A.courseName(prefix, slug, lang);
    var unlocks = (A.planData(prefix).unlocksMap || {})[slug] || [];

    return {
      lines: [
        lang === 'ar' ? 'سأحذف «' + name + '» من خطتك.' : 'I will remove “' + name + '” from your plan.',
        lang === 'ar'
          ? 'يُحذف من نسختك على هذا الجهاز فقط، ولا يمكن التراجع عن ذلك.'
          : 'This affects your copy on this device only, and cannot be undone.'
      ],
      title: null, guide: null, chips: null,
      confirm: {
        label: lang === 'ar' ? 'احذف المساق' : 'Remove it',
        // Removing a course that others depend on strands their arrows, so
        // the app cleans those up — the student should know that first.
        warn: unlocks.length
          ? (lang === 'ar'
              ? unlocks.length + ' مساقًا يعتمد عليه كمتطلب سابق؛ ستُحذف تلك الروابط أيضًا.'
              : unlocks.length + ' course' + (unlocks.length > 1 ? 's list' : ' lists') +
                ' it as a prerequisite; those links are removed too.')
          : null,
        run: function () {
          var IMP = window.AAUP_IMPORTED;
          if (!IMP || !IMP.removeCourse) {
            return lang === 'ar' ? 'تعذّر حذف المساق.' : 'That course could not be removed.';
          }
          IMP.removeCourse(prefix, slug);
          return lang === 'ar' ? 'تم حذف «' + name + '».' : '“' + name + '” has been removed.';
        }
      }
    };
  }

  function proposeMoveCourse(prefix, args, lang) {
    if (!prefix || !args.course) return null;
    var A = window.AAUP_ASSISTANT;
    var slug = A.findCourse(prefix, args.course);
    if (!slug) return null;
    var name = A.courseName(prefix, slug, lang);
    var year = parseInt(args.year, 10) || 1;
    var sem = parseInt(args.semester, 10) || 1;
    if (sem < 1 || sem > 3) sem = 1;
    if (!hasYear(prefix, 'y' + year)) {
      return {
        lines: [lang === 'ar'
          ? 'لا توجد سنة ' + year + ' في خطتك. أضفها أولًا من «وضع التعديل».'
          : 'There is no Year ' + year + ' in your plan. Add it first from Edit Mode.'],
        title: null, guide: 'editPlan', confirm: null, chips: null
      };
    }

    return {
      lines: [
        lang === 'ar'
          ? 'سأنقل «' + name + '» إلى السنة ' + year + '، ' + semesterLabel(sem, lang) + '.'
          : 'I will move “' + name + '” to Year ' + year + ', ' + semesterLabel(sem, lang) + '.'
      ],
      title: null, guide: null, chips: null,
      confirm: {
        label: lang === 'ar' ? 'انقل المساق' : 'Move it',
        warn: lang === 'ar'
          ? 'إن كسر النقل ترتيب المتطلبات السابقة فسيرفضه التطبيق ويبقي المساق مكانه.'
          : 'If the move would break prerequisite order, the app rejects it and leaves the course where it is.',
        run: function () {
          var IMP = window.AAUP_IMPORTED;
          if (!IMP || !IMP.persistCourseMove) {
            return lang === 'ar' ? 'تعذّر نقل المساق.' : 'That course could not be moved.';
          }
          IMP.persistCourseMove(prefix, slug, prefix + '-y' + year + '-s' + sem);
          return lang === 'ar'
            ? 'تم نقل «' + name + '» إلى السنة ' + year + '.'
            : '“' + name + '” has been moved to Year ' + year + '.';
        }
      }
    };
  }

  // ---------------------------------------------------------------
  // ACTIONS
  // ---------------------------------------------------------------
  // What the model is allowed to do. Navigation and walkthroughs run
  // immediately — the worst case is a student on a page they did not ask for,
  // one tap from going back. The two that touch saved data return a proposal
  // instead, built by the offline engine so it carries the same prerequisite
  // warnings, and the chat renders it as a confirmation card.
  function runAction(action, lang) {
    var A = window.AAUP_ASSISTANT;
    var UI = window.AAUP_ASSISTANT_UI;
    var prefix = A && A.currentPlan();
    var args = action.args || {};

    switch (action.name) {
      case 'open_page': {
        if (!prefix && args.page !== 'home' && args.page !== 'settings') return null;
        var D = window.AAUP_DASHBOARD;
        try {
          if (args.page === 'dashboard' && D) D.open(prefix);
          else if (args.page === 'study_plan' && D) D.openStudyPlan(prefix);
          else if (args.page === 'audit' && window.AAUP_AUDIT) window.AAUP_AUDIT.open(prefix);
          else if (args.page === 'achievements' && window.AAUP_ACHIEVEMENTS) window.AAUP_ACHIEVEMENTS.open(prefix);
          else if (args.page === 'advisor' && window.AAUP_ADVISOR) window.AAUP_ADVISOR.open(prefix);
          else if (args.page === 'overview' && window.AAUP_OVERVIEW) window.AAUP_OVERVIEW.open(prefix);
          else if (args.page === 'settings' && window.AAUP_SIDEBAR) window.AAUP_SIDEBAR.openSettings();
          else if (args.page === 'home' && window.AAUP_TASK_HOME) window.AAUP_TASK_HOME.show();
        } catch (e) { return null; }
        return null;
      }

      case 'start_walkthrough': {
        // "Let me show you — watch the screen", followed by nothing at all,
        // was the single worst thing this assistant did. It happened whenever
        // the model named a walkthrough that could not run from the screen the
        // student was on, because the failure was silent.
        //
        // So: check first. If it can run, run it (deferred a beat so the
        // model's sentence is read before the page dims). If it cannot, say so
        // and answer the question in words instead — never promise a
        // spotlight that is not coming.
        if (!UI || !window.AAUP_ASSISTANT_KB.guides[args.guide]) return unguidable(args.guide, lang);
        if (!UI.canGuide(args.guide)) return unguidable(args.guide, lang);
        setTimeout(function () { UI.startGuide(args.guide, lang, true); }, 700);
        return null;
      }

      case 'highlight_course': {
        if (!prefix || !args.course) return null;
        var slug = A.findCourse(prefix, args.course);
        if (!slug) return null;
        try {
          if (window.__selectCourse) window.__selectCourse(prefix, slug);
          else {
            var el = document.getElementById(prefix + '-c-' + slug);
            if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        } catch (e) { /* the course may not be rendered right now */ }
        return null;
      }

      case 'propose_mark_course': {
        if (!prefix || !args.course) return null;
        var target = A.findCourse(prefix, args.course);
        // The model named a course that is not in this plan. Saying nothing
        // is better than confirming a change to something that does not
        // exist, so the proposal is simply dropped and its own sentence stands.
        if (!target) return null;
        return A.proposeMark(prefix, target, args.completed !== false, lang);
      }

      case 'propose_add_course':
        return proposeAddCourse(prefix, args, lang);

      case 'propose_remove_course':
        return proposeRemoveCourse(prefix, args, lang);

      case 'propose_move_course':
        return proposeMoveCourse(prefix, args, lang);

      case 'propose_reset_progress':
        return prefix ? A.proposeReset(prefix, lang) : null;

      case 'open_fix_panel':
        if (window.AAUP_FIX) window.AAUP_FIX.open();
        return null;

      default:
        return null;
    }
  }

  // What to say when the model calls a tool and says nothing else. Not a
  // fallback for a broken reply — this is the common case, and the sentence
  // has to make the action make sense on its own.
  var ACTION_SAYS = {
    open_page: { en: 'Here you go.', ar: 'تفضّل.' },
    start_walkthrough: { en: 'Let me show you — watch the screen.', ar: 'سأريك — راقب الشاشة.' },
    highlight_course: { en: 'Here it is on your plan.', ar: 'ها هو في خطتك.' },
    open_fix_panel: { en: 'Let me run a check on the app.', ar: 'سأجري فحصًا للتطبيق.' },
    propose_mark_course: { en: 'Here’s what that would change:', ar: 'إليك ما سيتغيّر:' },
    propose_reset_progress: { en: 'Here’s what that would change:', ar: 'إليك ما سيتغيّر:' }
  };
  function actionSentence(name, lang) {
    var s = ACTION_SAYS[name];
    if (!s) return lang === 'ar' ? 'تم.' : 'Done.';
    return s[lang] || s.en;
  }

  // Which knowledge-base topic explains, in words, what each walkthrough
  // would have shown. Used when the walkthrough cannot run from here.
  var GUIDE_TOPIC = {
    addCourse: 'editplan', editPlan: 'editplan', backup: 'export', gpa: 'gpa',
    markCourse: 'completed', settings: 'settings', findPlan: 'start',
    nextSemester: 'available', audit: 'audit', achievements: 'achievements',
    searchCourse: 'search', legend: 'legend', newPlan: 'newplan',
    switchPlan: 'universities', menu: 'menu', fix: 'fixbutton'
  };

  // A walkthrough that cannot start from this screen. Answers the question in
  // words instead, and says plainly why there is nothing to watch — the model
  // has usually already said "let me show you", and leaving that unanswered is
  // what made the assistant look broken.
  function unguidable(guideId, lang) {
    var KB = window.AAUP_ASSISTANT_KB;
    var topic = null;
    var wanted = GUIDE_TOPIC[guideId];
    if (wanted) {
      topic = KB.topics.filter(function (t) { return t.id === wanted; })[0] || null;
    }
    var lines = [lang === 'ar'
      ? 'لا أستطيع الإشارة إليه من هذه الشاشة، لكن إليك الطريقة:'
      : 'I can’t point at that from this screen, but here’s how:'];
    if (topic) {
      lines = lines.concat((topic.body[lang] || topic.body.en) || []);
    }
    lines.push(lang === 'ar'
      ? 'افتح خطتك الدراسية ثم اطلب مني أن أريك مجددًا.'
      : 'Open your study plan and ask me to show you again.');
    return { lines: lines, title: null, guide: guideId, confirm: null, chips: null };
  }

  // ---------------------------------------------------------------
  // TRANSPORT
  // ---------------------------------------------------------------
  function post(body) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    var opts = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    };
    if (controller) opts.signal = controller.signal;
    if (window.APP_AI_SECRET) opts.headers['x-app-secret'] = window.APP_AI_SECRET;

    return fetch(url(), opts).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || ('HTTP ' + res.status));
          err.status = res.status;
          err.payload = data;
          throw err;
        }
        return data;
      });
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  // Returns the same reply shape the offline engine produces, so the chat
  // window renders both identically and knows nothing about which brain
  // answered.
  function ask(text, lang) {
    history.push({ role: 'user', content: text });
    if (history.length > MAX_TURNS * 2) history = history.slice(-MAX_TURNS * 2);

    return post({ messages: history, context: buildContext(), lang: lang })
      .then(function (data) {
        consecutiveFailures = 0;
        var answer = String(data.text || '').trim();
        history.push({ role: 'assistant', content: answer });

        var reply = {
          lines: answer ? answer.split(/\n{2,}/).map(function (s) { return s.trim(); }).filter(Boolean) : [],
          title: null, guide: null, confirm: null, chips: null,
          provider: data.provider, model: data.model
        };

        // At most one action is honoured. The prompt asks for one; enforcing
        // it here means a confused reply cannot navigate three times and
        // propose two edits in a single turn.
        var action = (data.actions || [])[0];
        if (action) {
          var proposal = runAction(action, lang);
          if (proposal) {
            if (action.name === 'start_walkthrough') {
              // The model's line was a promise to show something that cannot
              // be shown. Replace it rather than stack a contradiction on it.
              reply.lines = proposal.lines;
              reply.guide = proposal.guide;
            } else {
              // The proposal's own text is the authoritative description of
              // the change — exact wording, exact prerequisite warnings,
              // generated by the offline engine rather than by the model. It
              // REPLACES the model's sentence rather than following it: the
              // model has just said "I will add X to year 1" and the proposal
              // says the same thing again, which reads as a stutter.
              reply.lines = proposal.lines;
              reply.confirm = proposal.confirm;
              if (proposal.guide) reply.guide = proposal.guide;
            }
          }
        }

        // A tool call frequently arrives with NO text beside it — the model
        // treats "call the tool" as the whole reply. Falling through to the
        // "not part of this website" line there would be badly wrong: it
        // would deny knowing something while simultaneously doing it. Each
        // action carries its own sentence for exactly this case.
        if (!reply.lines.length && action) {
          reply.lines = [actionSentence(action.name, lang)];
        }
        if (!reply.lines.length) {
          reply.lines = [window.AAUP_ASSISTANT.say('notHere', lang)];
        }
        return reply;
      })
      .catch(function (e) {
        // Drop the unanswered turn so the next question is not sent with a
        // dangling user message the model never replied to.
        history.pop();
        // A reply from the Worker — even an error one — proves the address is
        // right, so 429 (quota) and 503 (providers down) must not trip the
        // breaker. Only "nothing answered at all" counts.
        var answered = e && e.payload && e.payload.error;
        if (answered) { consecutiveFailures = 0; } else { consecutiveFailures++; }
        throw e;
      });
  }

  // A short, honest note for why the smart brain did not answer this time.
  function fallbackNote(e, lang) {
    var status = e && e.status;
    var payload = (e && e.payload) || {};
    if (status === 429) {
      if (payload.scope === 'minute') {
        return lang === 'ar'
          ? 'أسئلة كثيرة بسرعة — أجبتك من المساعد المدمج. انتظر قليلًا ثم جرّب مجددًا.'
          : 'Too many questions at once — that answer came from the built-in assistant. Wait a moment and try again.';
      }
      return lang === 'ar'
        ? 'انتهت حصة اليوم من المساعد الذكي (وهي مجانية ومحدودة). أجبتك من المساعد المدمج، ويعود الذكي غدًا.'
        : 'Today’s free quota for the smart assistant is used up. That answer came from the built-in one; the smart one returns tomorrow.';
    }
    if (navigator.onLine === false) {
      return lang === 'ar'
        ? 'لا يوجد اتصال، فأجبتك من المساعد المدمج الذي يعمل دون إنترنت.'
        : 'No connection, so that came from the built-in assistant, which works offline.';
    }
    return lang === 'ar'
      ? 'تعذّر الوصول إلى المساعد الذكي، فأجبتك من المساعد المدمج.'
      : 'Couldn’t reach the smart assistant, so that came from the built-in one.';
  }

  window.AAUP_ASSISTANT_AI = {
    ask: ask,
    enabled: enabled,
    configured: configured,
    asked: asked,
    mode: mode,
    setMode: setMode,
    fallbackNote: fallbackNote,
    resetHistory: function () { history = []; },
    unreachable: unreachable,
    // exposed for verification
    buildContext: buildContext,
    runAction: runAction
  };
})();
