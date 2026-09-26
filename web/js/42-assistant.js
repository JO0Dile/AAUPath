// ==========================
// ASSISTANT ENGINE
// ==========================
// Turns a student's question into an answer, using only two sources:
//
//   1. the knowledge base in js/41-assistant-kb.js (what this app does), and
//   2. live state already in the page (the plan registry, the prerequisite
//      graph, the student's own progress and grades).
//
// There is no third source. No model, no API, no network, no training data —
// which is exactly why it cannot invent a prerequisite or a credit-hour total
// for a student's degree. Anything it cannot answer from (1) or (2) gets
// "that isn't part of this website" instead of a guess.
//
// The trade is real and deliberate: this understands far less free-form
// phrasing than a language model would. It is the right trade here. A wrong
// answer about which course unlocks which does not read as wrong — the
// student just registers for the wrong semester.
(function () {
  var KB = window.AAUP_ASSISTANT_KB;

  // ---------------------------------------------------------------
  // TEXT
  // ---------------------------------------------------------------
  // Arabic is typed a dozen different ways for the same word: with or
  // without hamza, with ة or ه, with diacritics pasted in from a PDF. Fold
  // all of that together before matching, or half the Arabic questions miss.
  // The letter folds below are written as literal Arabic because that is
  // what makes them readable. The one exception is the zero-width/bidi
  // class, which is invisible as literal text and so uses escapes.
  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[ً-ْـ]/g, '')      // diacritics + tatweel
      .replace(/[أإآٱ]/g, 'ا') // hamza forms of alef
      .replace(/ى/g, 'ي')               // alef maqsura  -> ya
      .replace(/ة/g, 'ه')               // ta marbuta    -> ha
      .replace(/ؤ/g, 'و')               // hamza on waw  -> waw
      .replace(/ئ/g, 'ي')               // hamza on ya   -> ya
      .replace(/[\u200B-\u200F]/g, '')       // zero-width + bidi marks
      .replace(/[^\w؀-ۿ\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hasArabic(s) { return /[؀-ۿ]/.test(String(s || '')); }

  // Answer in the language the student wrote in; fall back to whatever the
  // app is currently showing.
  function langFor(text) {
    if (hasArabic(text)) return 'ar';
    if (/[a-z]/i.test(String(text || ''))) return 'en';
    return (window.__anyVisiblePageIsRtl && window.__anyVisiblePageIsRtl()) ? 'ar' : 'en';
  }

  function pick(obj, lang) { return obj ? (obj[lang] || obj.en || '') : ''; }

  // Whole-phrase containment, but word-bounded for Latin text so "war" does
  // not match "toward" and "sex" does not match "sextant". Arabic has no
  // equivalent boundary problem here, so it matches as a substring.
  function contains(haystack, phrase) {
    if (!phrase) return false;
    if (hasArabic(phrase)) return haystack.indexOf(phrase) !== -1;
    var re = new RegExp('(^|\\s)' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)');
    return re.test(haystack);
  }

  // ---------------------------------------------------------------
  // LIVE STATE
  // ---------------------------------------------------------------
  function currentPlan() {
    var prefix = window.AAUP_DASHBOARD ? window.AAUP_DASHBOARD.getSelected() : null;
    if (prefix && window.__PLAN_DATA && window.__PLAN_DATA[prefix]) return prefix;
    // Nothing selected (or the selection is not registered) — fall back to a
    // plan that is actually on screen, so an answer is still possible.
    var keys = Object.keys(window.__PLAN_DATA || {});
    for (var i = 0; i < keys.length; i++) {
      var el = document.getElementById('page-' + keys[i]);
      if (el && el.offsetParent !== null) return keys[i];
    }
    return prefix && window.__PLAN_DATA && window.__PLAN_DATA[prefix] ? prefix : null;
  }

  function planData(prefix) { return (window.__PLAN_DATA || {})[prefix] || {}; }
  function courseEl(prefix, slug) { return document.getElementById(prefix + '-c-' + slug); }
  function progress() { return (window.__getProgress && window.__getProgress()) || {}; }

  function courseName(prefix, slug, lang) {
    var meta = (planData(prefix).courseInfo || {})[slug];
    if (!meta) return slug;
    return (lang === 'ar' && meta.ar) ? meta.ar : (meta.name || slug);
  }

  function courseState(prefix, slug) {
    var el = courseEl(prefix, slug);
    if (!el) return 'unknown';
    if (progress()[el.id]) return 'completed';
    if (el.classList.contains('available')) return 'available';
    return 'locked';
  }

  // Find the course a student meant, by whole words rather than substrings.
  //
  // Word-based matching is what makes Roman numerals work. "Calculus I" and
  // "Calculus II" differ by one character, and any substring approach either
  // matches both or matches the wrong one — while stripping filler words out
  // of the question first (an earlier attempt) deletes the lone "I" that IS
  // the course name. Requiring every word of the course name to appear in the
  // question handles both: "mark calculus i as completed" matches Calculus I
  // and cannot match Calculus II, because "ii" is not in the question.
  function findCourse(prefix, query) {
    var info = planData(prefix).courseInfo || {};
    var q = normalize(query);
    if (!q) return null;

    var asked = {};
    q.split(' ').forEach(function (w) { if (w) asked[w] = true; });

    var best = null, bestScore = 0;
    Object.keys(info).forEach(function (slug) {
      var meta = info[slug] || {};
      var candidates = [meta.name, meta.ar, slug.replace(/-/g, ' ')];
      if (meta.num && meta.num !== '-') candidates.push(String(meta.num));
      candidates.forEach(function (raw) {
        if (!raw) return;
        var c = normalize(raw);
        if (!c) return;
        var words = c.split(' ').filter(Boolean);
        if (!words.length) return;

        var score = 0;
        if (c === q) {
          score = 1000 + c.length;
        } else if (words.every(function (w) { return asked[w]; })) {
          // A longer, more specific name beats a shorter one contained in it,
          // so "Physics Lab" wins over "Physics" when both would match.
          // One-word names need some length before they count, or a course
          // called "AI" would match any question containing that fragment.
          if (words.length > 1 || c.length >= 4) score = 100 + c.length * 2 + words.length * 5;
        }
        if (score > bestScore) { bestScore = score; best = slug; }
      });
    });
    return best;
  }

  function creditsOf(prefix, slug) {
    var meta = (planData(prefix).courseInfo || {})[slug] || {};
    return parseFloat(meta.cr) || 0;
  }

  // ---------------------------------------------------------------
  // REPLY BUILDER
  // ---------------------------------------------------------------
  function reply(lines, extra) {
    var out = { lines: [].concat(lines), title: null, guide: null, confirm: null, chips: null };
    if (extra) { Object.keys(extra).forEach(function (k) { out[k] = extra[k]; }); }
    return out;
  }
  function say(key, lang, extra) { return reply([pick(KB.say[key], lang)], extra); }

  // ---------------------------------------------------------------
  // GUARDS
  // ---------------------------------------------------------------
  // Attempts to extract the assistant's own instructions, or to talk it into
  // a different role. Answered with a fixed line and no further processing —
  // there is nothing behind this to leak anyway, but the behaviour should be
  // the same either way.
  var PROBE = ['system prompt', 'your prompt', 'your instructions', 'initial instructions',
    'ignore previous', 'ignore all previous', 'ignore your', 'forget your instructions',
    'you are now', 'pretend you are', 'act as', 'roleplay', 'jailbreak', 'developer mode you',
    'reveal your', 'show me your rules', 'what are your rules', 'repeat the words above',
    'التعليمات', 'تجاهل التعليمات', 'تظاهر انك', 'انت الان'];

  function isProbe(q) {
    for (var i = 0; i < PROBE.length; i++) { if (contains(q, normalize(PROBE[i]))) return true; }
    return false;
  }

  function isOutOfScope(q) {
    var lists = [KB.outOfScope.en, KB.outOfScope.ar];
    for (var l = 0; l < lists.length; l++) {
      for (var i = 0; i < lists[l].length; i++) {
        if (contains(q, normalize(lists[l][i]))) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------
  // TOPIC MATCHING
  // ---------------------------------------------------------------
  // Longer tags score higher, so "what can i take" beats a stray "take".
  function matchTopic(q) {
    var best = null, bestScore = 0;
    KB.topics.forEach(function (topic) {
      var score = 0;
      ['en', 'ar'].forEach(function (l) {
        (topic.tags[l] || []).forEach(function (tag) {
          var t = normalize(tag);
          if (t && contains(q, t)) score += t.split(' ').length * 2 + Math.min(t.length, 12) / 6;
        });
      });
      if (score > bestScore) { bestScore = score; best = topic; }
    });
    return bestScore >= 2 ? best : null;
  }

  function topicReply(topic, lang) {
    return reply(pick(topic.body, lang), { title: pick(topic.title, lang), guide: topic.guide || null });
  }

  // ---------------------------------------------------------------
  // LIVE-DATA ANSWERS
  // ---------------------------------------------------------------
  function listUniversities(lang) {
    var unis = window.APP_UNIVERSITIES || {};
    var names = Object.keys(unis).map(function (k) {
      var u = unis[k] || {};
      return (lang === 'ar' && u.name && u.name.ar) ? u.name.ar : ((u.name && u.name.en) || k);
    });
    if (!names.length) return say('notHere', lang);
    return reply(names, {
      title: lang === 'ar' ? 'الجامعات في هذا التطبيق' : 'Universities in this app',
      guide: 'findPlan'
    });
  }

  // Every plan the app knows about — official plans arrive through the same
  // sync/merge path a student's own plans do, so this one store holds both.
  function allPlans() {
    return (window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()) || {};
  }

  function listPlans(lang) {
    var registry = allPlans();
    var ids = Object.keys(registry);
    if (!ids.length) return say('notHere', lang);
    var withCourses = ids.filter(function (id) {
      var p = registry[id];
      return p && p.courses && p.courses.length;
    });
    return reply([
      lang === 'ar'
        ? ids.length + ' خطة دراسية متوفرة في التطبيق، منها ' + withCourses.length + ' بمساقات كاملة.'
        : ids.length + ' study plans are loaded, ' + withCourses.length + ' of them with full course lists.',
      lang === 'ar'
        ? 'اختر جامعتك من الشاشة الرئيسية لرؤية خطط كليتك.'
        : 'Pick your university on the home screen to see the plans for your college.'
    ], { guide: 'findPlan' });
  }

  function answerPrereqs(prefix, slug, lang) {
    var needs = (planData(prefix).needsMap || {})[slug] || [];
    var name = courseName(prefix, slug, lang);
    if (!needs.length) {
      return reply([
        lang === 'ar'
          ? name + ' لا يحتاج أي متطلب سابق — يمكن أخذه مباشرة.'
          : name + ' has no prerequisites — it can be taken right away.'
      ]);
    }
    var done = progress();
    var lines = needs.map(function (req) {
      var ok = !!done[prefix + '-c-' + req];
      return (ok ? '✓ ' : '○ ') + courseName(prefix, req, lang);
    });
    lines.unshift(lang === 'ar'
      ? name + ' يحتاج ' + needs.length + ' متطلبًا سابقًا:'
      : name + ' needs ' + needs.length + ' prerequisite' + (needs.length > 1 ? 's' : '') + ':');
    return reply(lines);
  }

  function answerWhyLocked(prefix, slug, lang) {
    var name = courseName(prefix, slug, lang);
    var state = courseState(prefix, slug);
    if (state === 'completed') {
      return reply([lang === 'ar' ? name + ' مكتمل بالفعل.' : name + ' is already marked completed.']);
    }
    if (state === 'available') {
      return reply([lang === 'ar'
        ? name + ' ليس مقفلًا — كل متطلباته مكتملة ويمكنك أخذه الآن.'
        : name + ' is not locked — every prerequisite is done, so you can take it now.']);
    }
    var needs = (planData(prefix).needsMap || {})[slug] || [];
    var done = progress();
    var missing = needs.filter(function (req) { return !done[prefix + '-c-' + req]; });
    if (!missing.length) {
      return reply([
        lang === 'ar'
          ? name + ' متطلباته السابقة مكتملة، لكنه ما زال مقفلًا — بعض المساقات تشترط أيضًا حدًا أدنى من الساعات المعتمدة المنجزة.'
          : name + ' has all its prerequisites done but is still locked — some courses also require a minimum number of completed credit hours.'
      ]);
    }
    var lines = missing.map(function (req) { return '○ ' + courseName(prefix, req, lang); });
    lines.unshift(lang === 'ar'
      ? name + ' مقفل لأن هذه المتطلبات لم تكتمل بعد:'
      : name + ' is locked because these are not completed yet:');
    return reply(lines);
  }

  function answerUnlocks(prefix, slug, lang) {
    var unlocks = (planData(prefix).unlocksMap || {})[slug] || [];
    var name = courseName(prefix, slug, lang);
    if (!unlocks.length) {
      return reply([lang === 'ar'
        ? name + ' لا يفتح أي مساق لاحق في هذه الخطة.'
        : name + ' is not a prerequisite for anything else in this plan.']);
    }
    var lines = unlocks.map(function (s) { return '→ ' + courseName(prefix, s, lang); });
    lines.unshift(lang === 'ar'
      ? name + ' يفتح ' + unlocks.length + ' مساقًا:'
      : name + ' unlocks ' + unlocks.length + ' course' + (unlocks.length > 1 ? 's' : '') + ':');
    return reply(lines);
  }

  function answerCourse(prefix, slug, lang) {
    var meta = (planData(prefix).courseInfo || {})[slug] || {};
    var name = courseName(prefix, slug, lang);
    var state = courseState(prefix, slug);
    var stateLabel = {
      completed: { en: 'Completed', ar: 'مكتمل' },
      available: { en: 'Available now', ar: 'متاح الآن' },
      locked: { en: 'Locked', ar: 'مقفل' },
      unknown: { en: 'Not on the current page', ar: 'غير موجود في الصفحة الحالية' }
    }[state];
    var needs = (planData(prefix).needsMap || {})[slug] || [];
    var unlocks = (planData(prefix).unlocksMap || {})[slug] || [];
    var lines = [];
    if (meta.num && meta.num !== '-') lines.push((lang === 'ar' ? 'رقم المساق: ' : 'Course number: ') + meta.num);
    lines.push((lang === 'ar' ? 'الساعات المعتمدة: ' : 'Credit hours: ') + creditsOf(prefix, slug));
    lines.push((lang === 'ar' ? 'الحالة: ' : 'Status: ') + pick(stateLabel, lang));
    var sep = lang === 'ar' ? '، ' : ', ';
    lines.push((lang === 'ar' ? 'المتطلبات السابقة: ' : 'Prerequisites: ') +
      (needs.length ? needs.map(function (s) { return courseName(prefix, s, lang); }).join(sep) : (lang === 'ar' ? 'لا يوجد' : 'none')));
    if (unlocks.length) {
      lines.push((lang === 'ar' ? 'يفتح: ' : 'Unlocks: ') +
        unlocks.map(function (s) { return courseName(prefix, s, lang); }).join(sep));
    }
    return reply(lines, { title: name });
  }

  function answerAvailable(prefix, lang) {
    var page = document.getElementById('page-' + prefix);
    var els = page ? page.querySelectorAll('.course.available[id]') : [];
    if (!els.length) {
      return reply([lang === 'ar'
        ? 'لا يوجد مساق متاح الآن — أكمل بعض المتطلبات السابقة أولًا.'
        : 'Nothing is unlocked right now — complete a few prerequisites first.']);
    }
    var total = 0;
    Array.prototype.forEach.call(els, function (el) {
      var parts = window.__splitCourseId(el.id);
      if (parts) total += creditsOf(prefix, parts.slug);
    });

    var lines = [];
    Array.prototype.slice.call(els, 0, 12).forEach(function (el) {
      var parts = window.__splitCourseId(el.id);
      if (!parts) return;
      var cr = creditsOf(prefix, parts.slug);
      lines.push('• ' + courseName(prefix, parts.slug, lang) + ' (' + cr + (lang === 'ar' ? ' ساعة)' : 'H)'));
    });
    lines.unshift(lang === 'ar'
      ? els.length + ' مساقًا متاحًا لك الآن، بمجموع ' + total + ' ساعة:'
      : els.length + ' course' + (els.length > 1 ? 's are' : ' is') + ' available to you now, ' +
        total + ' credit hours in total:');
    if (els.length > 12) {
      lines.push(lang === 'ar' ? '…و' + (els.length - 12) + ' غيرها.' : '…and ' + (els.length - 12) + ' more.');
    }
    return reply(lines, { guide: 'nextSemester' });
  }

  function answerProgress(prefix, lang) {
    if (!window.AAUP_AUDIT) return say('notHere', lang);
    var totalCr = 0, doneCr = 0;
    window.AAUP_AUDIT.computeAudit(prefix).forEach(function (r) { totalCr += r.total; doneCr += r.completed; });
    var pct = totalCr ? Math.round(doneCr / totalCr * 100) : 0;
    var lines = [];
    if (totalCr) {
      lines.push(lang === 'ar'
        ? 'أنجزت ' + doneCr + ' من ' + totalCr + ' ساعة معتمدة (' + pct + '%).'
        : 'You have completed ' + doneCr + ' of ' + totalCr + ' credit hours (' + pct + '%).');
      lines.push(lang === 'ar'
        ? 'المتبقّي: ' + (totalCr - doneCr) + ' ساعة.'
        : (totalCr - doneCr) + ' credit hours to go.');
    } else {
      lines.push(lang === 'ar'
        ? 'لم يُثبَّت مجموع ساعات هذه الخطة بعد، فلا يمكنني حساب نسبة مئوية دون اختراع رقم.'
        : 'This plan’s official credit total is not confirmed yet, so I can’t give a percentage without inventing a number.');
    }
    var gpa = window.AAUP_GPA ? window.AAUP_GPA.gpaFor(prefix, null) : null;
    if (gpa && gpa.gpa != null) {
      lines.push((lang === 'ar' ? 'معدّلك التراكمي: ' : 'Your GPA: ') + gpa.gpa);
    } else {
      lines.push(lang === 'ar'
        ? 'لم تُدخل أي علامات بعد، فلا يوجد معدّل لعرضه.'
        : 'No grades entered yet, so there is no GPA to show.');
    }
    return reply(lines, { title: lang === 'ar' ? 'تقدّمك' : 'Your progress', guide: 'audit' });
  }

  function answerGpa(prefix, lang) {
    var gpa = window.AAUP_GPA ? window.AAUP_GPA.gpaFor(prefix, null) : null;
    if (!gpa || gpa.gpa == null) {
      return reply([
        lang === 'ar'
          ? 'لا يوجد معدّل بعد — أدخل علامة واحدة على الأقل.'
          : 'No GPA yet — enter a grade for at least one course.',
        lang === 'ar'
          ? 'افتح أي مساق وأدخل علامتك، وسيُحسب المعدّل فورًا.'
          : 'Open any course, enter your grade, and it calculates immediately.'
      ], { guide: 'gpa' });
    }
    return reply([
      (lang === 'ar' ? 'معدّلك التراكمي الحالي: ' : 'Your current GPA is ') + gpa.gpa,
      lang === 'ar'
        ? 'محسوب من المساقات التي أدخلت لها علامات فقط، بوزن ساعاتها المعتمدة.'
        : 'Calculated from graded courses only, weighted by their credit hours.'
    ], { guide: 'gpa' });
  }

  function answerPassMark(prefix, lang) {
    var scale = null;
    try {
      var p = allPlans()[prefix];
      scale = p && p.gradingScale;
    } catch (e) { scale = null; }
    if (!scale || scale.passMark == null) return say('notHere', lang);
    return reply([
      (lang === 'ar' ? 'علامة النجاح في خطتك: ' : 'The pass mark for your plan is ') + scale.passMark +
      (scale.name ? ' (' + scale.name + ')' : '')
    ]);
  }

  // ---------------------------------------------------------------
  // EDITING — always explained first, never applied silently
  // ---------------------------------------------------------------
  // Every editing answer returns a `confirm` block. The chat window renders
  // it as a button; nothing changes until the student presses it. That is
  // the whole point: an assistant that can tick off courses is an assistant
  // that can quietly wreck a student's record, so it always says what it is
  // about to do, warns when the change conflicts with the prerequisite
  // graph, and waits.
  function proposeMark(prefix, slug, wantDone, lang) {
    var el = courseEl(prefix, slug);
    if (!el) return say('courseUnknown', lang);
    var name = courseName(prefix, slug, lang);
    var isDone = !!progress()[el.id];
    if (isDone === wantDone) {
      return reply([lang === 'ar'
        ? name + ' بالفعل ' + (wantDone ? 'مكتمل' : 'غير مكتمل') + ' — لا حاجة لتغيير شيء.'
        : name + ' is already marked ' + (wantDone ? 'completed' : 'not completed') + ' — nothing to change.']);
    }

    var lines = [];
    var warn = null;
    if (wantDone) {
      var needs = (planData(prefix).needsMap || {})[slug] || [];
      var missing = needs.filter(function (r) { return !progress()[prefix + '-c-' + r]; });
      lines.push(lang === 'ar'
        ? 'سأعلّم ' + name + ' كمكتمل.'
        : 'I will mark ' + name + ' as completed.');
      if (missing.length) {
        // Not a refusal — a student really may have transfer credit or an
        // exception. It is a warning, and the app's own cascade behaviour
        // is spelled out so the result is never a surprise.
        warn = lang === 'ar'
          ? 'تنبيه: ' + missing.length + ' من متطلباته السابقة غير مكتملة (' +
            missing.map(function (s) { return courseName(prefix, s, lang); }).join('، ') +
            '). سيعلّمها التطبيق كمكتملة أيضًا، لأن اجتياز مساق يعني اجتياز متطلباته.'
          : 'Heads up: ' + missing.length + ' of its prerequisites ' +
            (missing.length > 1 ? 'are' : 'is') + ' not completed (' +
            missing.map(function (s) { return courseName(prefix, s, lang); }).join(', ') +
            '). The app will mark those completed too, since passing a course implies passing what it required.';
      }
      lines.push(lang === 'ar'
        ? 'سيؤثر ذلك على تقدّمك والمساقات المتاحة لك والإنجازات.'
        : 'This affects your progress, what unlocks next, and achievements.');
    } else {
      var unlocks = (planData(prefix).unlocksMap || {})[slug] || [];
      var affected = unlocks.filter(function (s) { return !!progress()[prefix + '-c-' + s]; });
      lines.push(lang === 'ar'
        ? 'سأزيل علامة الإكمال عن ' + name + '.'
        : 'I will remove the completed mark from ' + name + '.');
      if (affected.length) {
        warn = lang === 'ar'
          ? 'تنبيه: ' + affected.length + ' مساقًا يعتمد عليه ومعلَّم كمكتمل (' +
            affected.map(function (s) { return courseName(prefix, s, lang); }).join('، ') +
            ') وستُزال علامته أيضًا، لأنه لا يمكن أن يكون مكتملًا بدون متطلبه.'
          : 'Heads up: ' + affected.length + ' course' + (affected.length > 1 ? 's that depend' : ' that depends') +
            ' on it ' + (affected.length > 1 ? 'are' : 'is') + ' also marked completed (' +
            affected.map(function (s) { return courseName(prefix, s, lang); }).join(', ') +
            ') and will be unmarked too, since it can’t be complete without its prerequisite.';
      }
    }

    return reply(lines, {
      confirm: {
        label: lang === 'ar' ? 'نفّذ التغيير' : 'Apply this change',
        warn: warn,
        run: function () {
          var target = courseEl(prefix, slug);
          if (!target || !window.__toggleCourse) {
            return lang === 'ar' ? 'تعذّر تنفيذ التغيير.' : 'That change could not be applied.';
          }
          window.__toggleCourse(target);
          if (window.__refreshPlanUI) { try { window.__refreshPlanUI(prefix); } catch (e) {} }
          return lang === 'ar'
            ? 'تم. ' + name + ' الآن ' + (wantDone ? 'مكتمل' : 'غير مكتمل') + '.'
            : 'Done. ' + name + ' is now marked ' + (wantDone ? 'completed' : 'not completed') + '.';
        }
      }
    });
  }

  function proposeReset(prefix, lang) {
    var done = progress();
    var count = Object.keys(done).filter(function (k) { return k.indexOf(prefix + '-c-') === 0; }).length;
    if (!count) {
      return reply([lang === 'ar'
        ? 'لا يوجد تقدّم مسجَّل في هذه الخطة لمسحه.'
        : 'There is no saved progress in this plan to clear.']);
    }
    return reply([
      lang === 'ar'
        ? 'سأزيل علامة الإكمال عن ' + count + ' مساقًا في هذه الخطة.'
        : 'I will clear the completed mark from ' + count + ' course' + (count > 1 ? 's' : '') + ' in this plan.',
      lang === 'ar'
        ? 'لن تُمسّ علاماتك ولا ملاحظاتك ولا الخطط الأخرى.'
        : 'Your grades, notes, and other plans are not touched.'
    ], {
      confirm: {
        label: lang === 'ar' ? 'امسح تقدّم هذه الخطة' : 'Clear this plan’s progress',
        warn: lang === 'ar'
          ? 'لا يمكن التراجع عن هذا. صدّر نسخة احتياطية أولًا إن كنت غير متأكد.'
          : 'This cannot be undone. Export a backup first if you are unsure.',
        run: function () {
          var p = progress();
          Object.keys(p).forEach(function (k) {
            if (k.indexOf(prefix + '-c-') !== 0) return;
            var el = document.getElementById(k);
            if (el && window.__toggleCourse && p[k]) { window.__toggleCourse(el); }
          });
          if (window.__refreshPlanUI) { try { window.__refreshPlanUI(prefix); } catch (e) {} }
          return lang === 'ar' ? 'تم مسح تقدّم هذه الخطة.' : 'This plan’s progress has been cleared.';
        }
      }
    });
  }

  // Structural edits (adding, removing, and moving courses) are real
  // features with their own validation, undo, and drag interface. Pointing
  // the student at that is honest and safer than reimplementing a weaker
  // copy of it behind a chat prompt.
  function editHandoff(lang, what) {
    return reply([
      lang === 'ar'
        ? 'يمكنك ' + what.ar + ' من «وضع التعديل» في خطتك — وهناك يتحقق التطبيق من ترتيب المتطلبات ويتيح التراجع عن كل خطوة.'
        : 'You can ' + what.en + ' from Edit Mode on your plan — that is where the app validates prerequisite order and lets you undo each step.',
      lang === 'ar'
        ? 'التعديل الكامل متاح في الخطط التي أنشأتها بنفسك؛ أما الخطط الرسمية فيمكنك تصحيح خطوط المتطلبات فيها.'
        : 'Full editing is available on plans you created yourself; on official plans you can correct prerequisite lines.'
    ], { title: lang === 'ar' ? 'تعديل الخطة' : 'Editing your plan' });
  }

  // ---------------------------------------------------------------
  // INTENT DETECTION
  // ---------------------------------------------------------------
  function any(q, list) {
    for (var i = 0; i < list.length; i++) { if (contains(q, normalize(list[i]))) return true; }
    return false;
  }

  var ASK_GUIDE = ['how do i', 'how can i', 'how to', 'where is', 'where can i', 'where do i',
    'show me', 'i cant find', 'i can t find', 'cannot find', 'take me to', 'open the',
    'كيف', 'وين', 'اين', 'أين', 'ارني', 'أرني', 'ما بلاقي', 'لا اجد'];

  // "How does X work" is a request to have X explained, not to be given the
  // student's current value of X. Without this distinction "how is my GPA
  // calculated" is answered with a number — or, with no plan open, with
  // "open a plan first", which answers a question nobody asked.
  var ASK_EXPLAIN = ['how is', 'how does', 'how are', 'how do you', 'explain', 'what is the difference',
    'what does it mean', 'what do you mean', 'why does', 'كيف يتم', 'كيف يحسب', 'اشرح', 'ماذا يعني'];

  // ---------------------------------------------------------------
  // ASK
  // ---------------------------------------------------------------
  function ask(text) {
    var lang = langFor(text);
    var q = normalize(text);
    if (!q) return say('greeting', lang);

    if (isProbe(q)) return say('secret', lang);
    if (isOutOfScope(q)) return say('outOfScope', lang);

    if (any(q, ['hi', 'hello', 'hey', 'salam', 'مرحبا', 'اهلا', 'أهلا', 'السلام عليكم'])) {
      return say('greeting', lang, { chips: suggestions(lang) });
    }
    if (any(q, ['thanks', 'thank you', 'thx', 'شكرا', 'شكرًا', 'يعطيك العافيه'])) {
      return say('thanks', lang);
    }

    var prefix = currentPlan();
    var needsPlan = null;

    // --- catalogue-level questions (work without a plan open) -------------
    if (any(q, ['what universities', 'which universities', 'list universities', 'universities are', 'ما الجامعات', 'اي جامعات', 'الجامعات المتوفره'])) {
      return listUniversities(lang);
    }
    if (any(q, ['how many plans', 'what plans', 'which majors', 'list majors', 'how many majors', 'كم خطه', 'ما التخصصات', 'كم تخصص'])) {
      return listPlans(lang);
    }

    // --- "how do I…" / "where is…" / "explain…" --------------------------
    // Before anything that reads the student's own state, because those
    // lookups match on the same words: "how do I export my progress" would
    // otherwise be captured by the my-progress reader and answered with a
    // credit-hour count instead of instructions.
    var framedAsHowTo = any(q, ASK_GUIDE) || any(q, ASK_EXPLAIN);
    if (framedAsHowTo) {
      var howToTopic = matchTopic(q);
      if (howToTopic) {
        var howToReply = topicReply(howToTopic, lang);
        // "How do I" and "where is" want to be shown; "how does it work"
        // wants to be told.
        if (howToTopic.guide && any(q, ASK_GUIDE)) howToReply.autoGuide = true;
        return howToReply;
      }
    }

    // --- editing (asked first: "mark X done" also contains course words) --
    var wantsMark = any(q, ['mark', 'check off', 'tick', 'set as done', 'i passed', 'i finished', 'i completed', 'i took',
      'علمت', 'علم', 'انهيت', 'أنهيت', 'نجحت في', 'خلصت']);
    var wantsUnmark = any(q, ['unmark', 'uncheck', 'undo', 'not completed', 'remove the mark', 'didnt pass', 'did not pass',
      'الغي', 'ألغِ', 'ازل العلامه', 'ما نجحت']);
    if (wantsMark || wantsUnmark) {
      if (!prefix) return say('noPlanOpen', lang);
      var markSlug = findCourse(prefix, q);
      if (!markSlug) return say('courseUnknown', lang);
      return proposeMark(prefix, markSlug, !wantsUnmark, lang);
    }
    if (any(q, ['reset my progress', 'clear my progress', 'start over', 'reset progress', 'امسح تقدمي', 'مسح التقدم', 'ابدا من جديد'])) {
      if (!prefix) return say('noPlanOpen', lang);
      return proposeReset(prefix, lang);
    }
    if (any(q, ['add a course', 'add course', 'remove a course', 'delete a course', 'move a course', 'move course',
      'اضف مساق', 'احذف مساق', 'انقل مساق'])) {
      return editHandoff(lang, {
        en: 'add, remove, or move courses',
        ar: 'إضافة المساقات أو حذفها أو نقلها'
      });
    }

    // --- questions about a specific course --------------------------------
    var wantsPrereq = any(q, ['prerequisite', 'prerequisites', 'prereq', 'what does it need', 'what do i need for', 'requires', 'required before',
      'متطلب', 'متطلبات', 'شو بحتاج']);
    var wantsLocked = any(q, ['why is', 'why cant', 'why can t', 'locked', 'blocked', 'cant take', 'can t take', 'not available',
      'ليش', 'لماذا', 'مقفل', 'مغلق', 'ما بقدر اخذ']);
    var wantsUnlocks = any(q, ['what does it unlock', 'unlocks', 'what comes after', 'leads to', 'يفتح', 'ماذا بعد']);

    if (prefix && (wantsPrereq || wantsLocked || wantsUnlocks)) {
      var slug = findCourse(prefix, q);
      if (slug) {
        if (wantsUnlocks) return answerUnlocks(prefix, slug, lang);
        if (wantsLocked) return answerWhyLocked(prefix, slug, lang);
        return answerPrereqs(prefix, slug, lang);
      }
      // No course named — fall through to the general topic instead of
      // pretending to know which course was meant.
    } else if (!prefix && (wantsPrereq || wantsLocked || wantsUnlocks)) {
      needsPlan = true;
    }

    // --- questions about the student's own state --------------------------
    if (any(q, ['what can i take', 'available courses', 'what am i allowed', 'whats unlocked', 'what is unlocked', 'next semester',
      'ماذا اخذ', 'شو اخذ', 'المساقات المتاحه', 'الفصل القادم'])) {
      if (!prefix) return say('noPlanOpen', lang);
      return answerAvailable(prefix, lang);
    }
    if (any(q, ['my progress', 'how am i doing', 'how far am i', 'how much left', 'how much is left',
      'how much do i have left', 'whats left', 'what is left', 'hours left', 'left to graduate',
      'how close am i', 'am i to graduating', 'my statistics', 'my stats', 'percentage',
      'تقدمي', 'كم باقي', 'وين وصلت', 'نسبتي', 'كم تبقى', 'كم بقي', 'شو باقي'])) {
      if (!prefix) return say('noPlanOpen', lang);
      return answerProgress(prefix, lang);
    }
    if (any(q, ['my gpa', 'whats my gpa', 'what is my gpa', 'calculate my gpa', 'معدلي', 'كم معدلي'])) {
      if (!prefix) return say('noPlanOpen', lang);
      return answerGpa(prefix, lang);
    }
    if (any(q, ['pass mark', 'passing mark', 'passing grade', 'minimum to pass', 'علامه النجاح', 'اقل علامه'])) {
      if (!prefix) return say('noPlanOpen', lang);
      return answerPassMark(prefix, lang);
    }

    // --- feature help, optionally as a walkthrough ------------------------
    var topic = matchTopic(q);
    if (topic) {
      var r = topicReply(topic, lang);
      // "How do I…" / "Where is…" is a request to be shown, not told.
      if (topic.guide && any(q, ASK_GUIDE)) r.autoGuide = true;
      return r;
    }

    // --- a bare course name, typed on its own -----------------------------
    if (prefix) {
      var bare = findCourse(prefix, q);
      if (bare) return answerCourse(prefix, bare, lang);
    }
    if (needsPlan) return say('noPlanOpen', lang);

    return say('notHere', lang, { chips: suggestions(lang) });
  }

  function suggestions(lang) {
    return lang === 'ar'
      ? ['ماذا يمكنني أن آخذ الآن؟', 'كم تبقّى لي؟', 'كيف أحسب معدّلي؟', 'أين الإعدادات؟']
      : ['What can I take now?', 'How much is left?', 'How do I enter a grade?', 'Where is Settings?'];
  }

  window.AAUP_ASSISTANT = {
    ask: ask,
    suggestions: suggestions,
    greeting: function (lang) { return pick(KB.say.greeting, lang || 'en'); },
    // exposed for the UI's language handling and for verification
    langFor: langFor,
    normalize: normalize,
    findCourse: findCourse,
    currentPlan: currentPlan,
    // The proposal builders are shared with the online assistant
    // (js/46-assistant-ai.js): when the model asks to change a student's
    // record, it goes through this same code — the same prerequisite
    // warnings, the same cascade explanation, the same confirm-first
    // contract. A second, model-side implementation of "what will this
    // change" is exactly how the two would drift apart.
    proposeMark: proposeMark,
    proposeReset: proposeReset,
    courseName: courseName,
    courseState: courseState,
    creditsOf: creditsOf,
    planData: planData,
    say: function (key, lang) { return pick(KB.say[key], lang || 'en'); }
  };
})();
