// ==========================
// FIX SYSTEM — ANALYZERS
// ==========================
// A registry of independent checks. Each one is handed a context, returns a
// list of findings, and knows nothing about any other analyzer or about the
// panel that displays them (js/45-fix.js) — so adding a new check is adding
// one entry to ANALYZERS at the bottom of this file, and nothing else.
//
// WHAT THIS CAN AND CANNOT DO — worth being blunt about, because the
// difference decides which problems can be repaired and which can only be
// reported:
//
//   It CAN read the app's own source files. They are static files served
//   from the same origin, so the running app can fetch its own HTML, CSS,
//   JS, and JSON and analyze them — real syntax checking, real duplicate
//   detection, not guesswork.
//
//   It CANNOT write them back. A browser cannot edit files on a web server,
//   and it should not be able to. So for a source-level problem this
//   produces the full report the student can act on — problem, cause, files,
//   suggested fix, difficulty, and the exact replacement code where that can
//   be computed — and stops there.
//
//   It CAN fully repair the data the app owns: everything in localStorage
//   and in the offline cache. That is where the problems a student actually
//   hits live — a half-written progress entry, a stale cache, a saved plan
//   that no longer exists — and those are auto-fixed, after a backup.
//
// A finding is:
//   { id, severity: 'critical' | 'warning' | 'info',
//     title, problem, cause, suggestion   — each { en, ar }
//     files: [string], difficulty: 'easy' | 'medium' | 'hard',
//     code: string | null,                — exact replacement code, if known
//     fix: function | null }              — auto-repair, only when safe
(function () {

  function t(en, ar) { return { en: en, ar: ar }; }

  function finding(o) {
    return {
      id: o.id,
      severity: o.severity || 'warning',
      title: o.title,
      problem: o.problem,
      cause: o.cause,
      suggestion: o.suggestion,
      files: o.files || [],
      difficulty: o.difficulty || 'medium',
      code: o.code || null,
      fix: o.fix || null
    };
  }

  function textOf(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  // Every file the page itself says it depends on.
  function shellUrls() {
    var urls = [];
    document.querySelectorAll('script[src]').forEach(function (s) { urls.push(s.getAttribute('src')); });
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) { urls.push(l.getAttribute('href')); });
    urls.push('plans.json', 'manifest.json');
    return urls.filter(function (u) { return u && u.indexOf('//') === -1; });
  }

  function localKeys() {
    var keys = [];
    try { for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); }
    catch (e) { /* storage blocked */ }
    return keys;
  }

  // ---------------------------------------------------------------
  // 1. RUNTIME ERRORS
  // ---------------------------------------------------------------
  function runtimeErrors() {
    var diag = window.__DIAG ? window.__DIAG.snapshot() : { errors: [], resources: [], network: [], warnings: [] };
    var out = [];

    if (diag.errors.length) {
      var first = diag.errors[0];
      var where = first.source ? (first.source.split('/').pop() + (first.line ? ':' + first.line : '')) : 'unknown file';
      out.push(finding({
        id: 'runtime-errors',
        severity: 'critical',
        title: t(diag.errors.length + ' JavaScript error' + (diag.errors.length > 1 ? 's' : '') + ' since this page loaded',
                 diag.errors.length + ' خطأ برمجي منذ تحميل الصفحة'),
        problem: t('Something threw while the app was running. The first was: "' + first.message + '" in ' + where + '.',
                   'حدث خطأ أثناء تشغيل التطبيق. أولها: «' + first.message + '» في ' + where + '.'),
        cause: t('A bug in the app’s own code, or a file that loaded only partially.',
                 'خلل في شيفرة التطبيق نفسه، أو ملف حُمِّل جزئيًا.'),
        suggestion: t('Reload the page. If it happens again, the file and line above is where to look — this cannot be repaired from inside the browser.',
                      'أعد تحميل الصفحة. وإن تكرّر، فالملف والسطر أعلاه هما موضع البحث — ولا يمكن إصلاح هذا من داخل المتصفح.'),
        files: diag.errors.slice(0, 4).map(function (e) { return e.source ? e.source.split('/').pop() : 'unknown'; }),
        difficulty: 'medium'
      }));
    }

    if (diag.resources.length) {
      out.push(finding({
        id: 'resource-load-failed',
        severity: 'critical',
        title: t(diag.resources.length + ' file' + (diag.resources.length > 1 ? 's' : '') + ' failed to load',
                 diag.resources.length + ' ملف فشل تحميله'),
        problem: t('The page asked for these and did not get them: ' +
                   diag.resources.slice(0, 5).map(function (r) { return r.url.split('/').pop(); }).join(', ') + '.',
                   'طلبت الصفحة هذه الملفات ولم تحصل عليها: ' +
                   diag.resources.slice(0, 5).map(function (r) { return r.url.split('/').pop(); }).join('، ') + '.'),
        cause: t('The file is missing from the server, or it was never stored for offline use.',
                 'الملف غير موجود على الخادم، أو لم يُخزَّن للاستخدام دون اتصال.'),
        suggestion: t('Run the offline-cache repair below, then reload. If a file is genuinely missing it has to be restored in the project.',
                      'شغّل إصلاح التخزين دون اتصال أدناه ثم أعد التحميل. وإن كان الملف مفقودًا فعلًا فيجب استعادته في المشروع.'),
        files: diag.resources.slice(0, 6).map(function (r) { return r.url; }),
        difficulty: 'medium'
      }));
    }

    if (diag.network.length) {
      out.push(finding({
        id: 'network-errors',
        severity: 'warning',
        title: t(diag.network.length + ' network request' + (diag.network.length > 1 ? 's' : '') + ' failed',
                 diag.network.length + ' طلب شبكة فشل'),
        problem: t('Failed requests: ' + diag.network.slice(0, 4).map(function (n) {
                     return n.url.split('/').pop() + (n.status ? ' (' + n.status + ')' : '');
                   }).join(', ') + '.',
                   'طلبات فاشلة: ' + diag.network.slice(0, 4).map(function (n) {
                     return n.url.split('/').pop() + (n.status ? ' (' + n.status + ')' : '');
                   }).join('، ') + '.'),
        cause: t(navigator.onLine
                   ? 'The address returned an error, or the connection dropped mid-request.'
                   : 'This device is offline, so any request to the network fails — that is expected here.',
                 navigator.onLine
                   ? 'أعاد العنوان خطأً، أو انقطع الاتصال أثناء الطلب.'
                   : 'الجهاز غير متصل، فتفشل طلبات الشبكة — وهذا متوقّع هنا.'),
        suggestion: t('The app works fully offline, so this does not block anything. Only the Contribute feature needs a connection.',
                      'التطبيق يعمل بالكامل دون اتصال، فهذا لا يعطّل شيئًا. ميزة المشاركة وحدها تحتاج اتصالًا.'),
        files: diag.network.slice(0, 5).map(function (n) { return n.url; }),
        difficulty: 'easy'
      }));
    }

    if (diag.warnings.length > 3) {
      out.push(finding({
        id: 'console-warnings',
        severity: 'info',
        title: t(diag.warnings.length + ' console warnings', diag.warnings.length + ' تحذيرًا في الطرفية'),
        problem: t('The app logged warnings while running. First: "' + diag.warnings[0].message + '".',
                   'سجّل التطبيق تحذيرات أثناء التشغيل. أولها: «' + diag.warnings[0].message + '».'),
        cause: t('Usually a non-fatal condition the code chose to report.',
                 'عادةً حالة غير قاتلة اختارت الشيفرة الإبلاغ عنها.'),
        suggestion: t('Nothing to do unless something is visibly wrong.',
                      'لا حاجة لفعل شيء ما لم يظهر خلل واضح.'),
        files: [], difficulty: 'easy'
      }));
    }

    return Promise.resolve(out);
  }

  // ---------------------------------------------------------------
  // 2. MISSING MODULES
  // ---------------------------------------------------------------
  // Every feature module publishes one global. A missing global means its
  // file did not load or threw on the way in — which is invisible to the
  // student until they tap the feature and nothing happens.
  var REQUIRED_GLOBALS = [
    ['AAUP_STORAGE', '14-storage.js'], ['AAUP_STUDENT', '15-student.js'],
    ['AAUP_DATA', '16-data.js'], ['AAUP_THEME', '17-theme.js'],
    ['AAUP_GPA', '18-gpa.js'], ['AAUP_AUDIT', '19-audit.js'],
    ['AAUP_PERSONAL', '20-personal.js'], ['AAUP_FEEDBACK', '22-feedback.js'],
    ['AAUP_ACHIEVEMENTS', '24-achievements.js'],
    ['AAUP_ADVISOR', '25-advisor.js'], ['AAUP_DEV', '26-dev.js'],
    ['AAUP_COMMUNITY', '27-community.js'], ['AAUP_IMPORTED', '28-imported.js'],
    ['AAUP_SYNC', '30-sync.js'],
    ['AAUP_COLLECT', '31-collect.js'], ['AAUP_TUTORIAL', '32-tutorial.js'],
    ['AAUP_PLAN_EDITOR', '33-plan-editor.js'], ['AAUP_STRUCTURE', '34-structure.js'],
    ['AAUP_LINKS', '35-links.js'], ['AAUP_DASHBOARD', '36-dashboard.js'],
    ['AAUP_SIDEBAR', '37-sidebar.js'], ['AAUP_ACCOUNTS', '38-accounts.js'],
    ['AAUP_ORPHANS', '39-orphans.js'], ['AAUP_RETAKES', '40-retakes.js'],
    ['AAUP_ASSISTANT_KB', '41-assistant-kb.js'], ['AAUP_ASSISTANT', '42-assistant.js'],
    ['AAUP_ASSISTANT_UI', '43-assistant-ui.js'],
    // AAUP_ICONS is load-bearing in a way the others are not: the home screen,
    // the college tiles and every plan card call it while painting, so if it
    // fails to load the app renders nothing rather than rendering plainly.
    ['AAUP_ICONS', '04-icons.js'], ['AAUP_ADMIN', '48-admin.js'],
    ['__getProgress', '11-module11.js'], ['__registerPlanData', '02-shared-cross.js'],
    ['__escapeHtml', '02-shared-cross.js'], ['__showToast', '14-storage.js'],
    ['__computeStats', '11-module11.js'], ['__splitCourseId', '11-module11.js']
  ];

  function missingModules() {
    var missing = REQUIRED_GLOBALS.filter(function (pair) { return !window[pair[0]]; });
    if (!missing.length) return Promise.resolve([]);
    return Promise.resolve([finding({
      id: 'missing-modules',
      severity: 'critical',
      title: t(missing.length + ' feature module' + (missing.length > 1 ? 's' : '') + ' did not load',
               missing.length + ' وحدة من وحدات التطبيق لم تُحمَّل'),
      problem: t('These parts of the app are not available: ' +
                 missing.map(function (m) { return m[0]; }).join(', ') + '.',
                 'هذه الأجزاء غير متاحة: ' + missing.map(function (m) { return m[0]; }).join('، ') + '.'),
      cause: t('The file that defines each one failed to load, or threw an error while loading. Anything that depends on it will silently do nothing.',
               'فشل تحميل الملف الذي يعرّف كلًا منها، أو أخطأ أثناء التحميل. وكل ما يعتمد عليه لن يعمل دون رسالة.'),
      suggestion: t('Repair the offline cache below and reload the page. If it persists, the file is missing or broken in the project itself.',
                    'أصلح التخزين دون اتصال أدناه وأعد تحميل الصفحة. وإن استمر الأمر فالملف مفقود أو تالف في المشروع نفسه.'),
      files: missing.map(function (m) { return 'web/js/' + m[1]; }),
      difficulty: 'medium'
    })]);
  }

  // ---------------------------------------------------------------
  // 3. OFFLINE CACHE
  // ---------------------------------------------------------------
  function offlineCache() {
    if (!('caches' in window)) {
      return Promise.resolve([finding({
        id: 'no-cache-api',
        severity: 'info',
        title: t('Offline storage is not available in this browser', 'التخزين دون اتصال غير متاح في هذا المتصفح'),
        problem: t('This browser does not support the storage the app uses to work offline.',
                   'لا يدعم هذا المتصفح التخزين الذي يستخدمه التطبيق للعمل دون اتصال.'),
        cause: t('Either a very old browser, or private browsing mode.',
                 'إما متصفح قديم جدًا أو وضع التصفح الخاص.'),
        suggestion: t('The app still works while you have a connection.', 'يبقى التطبيق يعمل ما دام لديك اتصال.'),
        files: [], difficulty: 'easy'
      })]);
    }

    var expected = shellUrls();
    return caches.keys().then(function (names) {
      var current = names.filter(function (n) { return n.indexOf('studyplan-shell') === 0; });
      var stale = names.filter(function (n) { return current.indexOf(n) === -1; });
      var out = [];

      if (stale.length) {
        out.push(finding({
          id: 'stale-caches',
          severity: 'info',
          title: t(stale.length + ' old offline cache' + (stale.length > 1 ? 's' : '') + ' left behind',
                   stale.length + ' نسخة تخزين قديمة متروكة'),
          problem: t('Storage from a previous version of the app is still on this device: ' + stale.join(', ') + '.',
                     'ما زال على الجهاز تخزين من نسخة سابقة من التطبيق: ' + stale.join('، ') + '.'),
          cause: t('An update replaced the cache but the old one was not cleared.',
                   'استبدل تحديثٌ التخزين ولم تُمسح النسخة القديمة.'),
          suggestion: t('Safe to delete — it only takes up space.', 'حذفها آمن — فهي تشغل مساحة فقط.'),
          files: [], difficulty: 'easy',
          fix: function () {
            return Promise.all(stale.map(function (n) { return caches.delete(n); }))
              .then(function () {
                return { note: t('Deleted ' + stale.length + ' old cache(s).', 'حُذفت ' + stale.length + ' نسخة قديمة.') };
              });
          }
        }));
      }

      if (!current.length) {
        out.push(finding({
          id: 'no-offline-cache',
          severity: 'warning',
          title: t('Nothing is stored for offline use', 'لا شيء مخزَّن للاستخدام دون اتصال'),
          problem: t('The app has not been saved to this device, so it will not open without a connection.',
                     'لم يُحفظ التطبيق على هذا الجهاز، فلن يفتح دون اتصال.'),
          cause: t('The service worker has not finished installing yet, or was unregistered.',
                   'لم ينتهِ تثبيت عامل الخدمة بعد، أو أُلغي تسجيله.'),
          suggestion: t('Reload once while online and it will store itself.',
                        'أعد التحميل مرة واحدة أثناء الاتصال وسيحفظ نفسه.'),
          files: ['web/sw.js'], difficulty: 'easy'
        }));
        return out;
      }

      var cacheName = current[0];
      return caches.open(cacheName).then(function (cache) {
        return Promise.all(expected.map(function (url) {
          return cache.match(url).then(function (hit) { return hit ? null : url; });
        }));
      }).then(function (results) {
        var missing = results.filter(Boolean);
        if (missing.length) {
          out.push(finding({
            id: 'incomplete-offline-cache',
            severity: 'warning',
            title: t(missing.length + ' file' + (missing.length > 1 ? 's are' : ' is') + ' missing from offline storage',
                     missing.length + ' ملف مفقود من التخزين دون اتصال'),
            problem: t('These are part of the app but were not saved for offline use: ' +
                       missing.slice(0, 6).map(function (u) { return u.split('/').pop(); }).join(', ') +
                       (missing.length > 6 ? ', …' : '') + '.',
                       'هذه جزء من التطبيق لكنها لم تُحفظ للاستخدام دون اتصال: ' +
                       missing.slice(0, 6).map(function (u) { return u.split('/').pop(); }).join('، ') +
                       (missing.length > 6 ? '، …' : '') + '.'),
            cause: t('A file was added to the app without being added to the service worker’s list of files to save.',
                     'أُضيف ملف إلى التطبيق دون إضافته إلى قائمة الملفات التي يحفظها عامل الخدمة.'),
            suggestion: navigator.onLine
              ? t('Fix it now — this downloads the missing files into offline storage.',
                  'أصلحها الآن — سيحمّل ذلك الملفات الناقصة إلى التخزين دون اتصال.')
              : t('Connect to the internet first; the repair needs to download these files.',
                  'اتصل بالإنترنت أولًا؛ فالإصلاح يحتاج تنزيل هذه الملفات.'),
            files: ['web/sw.js'], difficulty: 'easy',
            fix: navigator.onLine ? function () {
              return caches.open(cacheName).then(function (cache) {
                // One at a time, not addAll: addAll is all-or-nothing, and one
                // genuinely missing file would abandon the other nineteen.
                return Promise.all(missing.map(function (u) {
                  return cache.add(u).then(function () { return null; }, function () { return u; });
                }));
              }).then(function (failed) {
                var bad = failed.filter(Boolean);
                return {
                  note: bad.length
                    ? t('Saved ' + (missing.length - bad.length) + ' of ' + missing.length + '. Could not fetch: ' + bad.join(', '),
                        'حُفظ ' + (missing.length - bad.length) + ' من ' + missing.length + '. تعذّر جلب: ' + bad.join('، '))
                    : t('All ' + missing.length + ' files are now stored for offline use.',
                        'جميع الملفات (' + missing.length + ') مخزَّنة الآن للاستخدام دون اتصال.')
                };
              });
            } : null
          }));
        }
        return out;
      });
    }).catch(function () { return []; });
  }

  // ---------------------------------------------------------------
  // 4. CATALOGUE INTEGRITY
  // ---------------------------------------------------------------
  // The plans themselves: invalid JSON, prerequisites pointing at courses
  // that do not exist, and prerequisite loops. A loop is the one that
  // actually hurts — every course in the cycle stays locked forever, and the
  // student has no way to tell why.
  function catalogueIntegrity() {
    return textOf('plans.json').then(function (raw) {
      var feed;
      try { feed = JSON.parse(raw); }
      catch (e) {
        return [finding({
          id: 'plans-json-invalid',
          severity: 'critical',
          title: t('The study-plan catalogue is not valid JSON', 'ملف الخطط ليس JSON صالحًا'),
          problem: t('plans.json could not be parsed: ' + e.message,
                     'تعذّر تحليل plans.json: ' + e.message),
          cause: t('The file was edited by hand, or a build wrote it only partially.',
                   'حُرِّر الملف يدويًا، أو كتبته عملية بناء بشكل جزئي.'),
          suggestion: t('Rebuild it with: python3 tools/build-catalogue.py',
                        'أعد بناءه بالأمر: python3 tools/build-catalogue.py'),
          files: ['web/plans.json'], difficulty: 'easy',
          code: 'python3 tools/build-catalogue.py'
        })];
      }

      var out = [];
      var plans = feed.plans || [];
      var brokenPrereqs = [], cycles = [], badCredits = [], dupIds = [], noHours = [];

      plans.forEach(function (p) {
        var ids = {}, dup = false;
        (p.courses || []).forEach(function (c) {
          if (ids[c.id]) dup = true;
          ids[c.id] = true;
          var cr = Number(c.creditHours);
          if (!(cr >= 0) || cr > 12) badCredits.push(p.id + ' / ' + c.id);
        });
        if (dup) dupIds.push(p.id);
        if (p.courses && p.courses.length && (p.degreeHours == null)) noHours.push(p.id);

        // Prerequisite edges whose endpoints are not courses in this plan.
        var edges = {};
        (p.prerequisites || []).forEach(function (pair) {
          if (!ids[pair[0]] || !ids[pair[1]]) {
            brokenPrereqs.push(p.id + ': ' + pair[0] + ' → ' + pair[1]);
            return;
          }
          (edges[pair[0]] = edges[pair[0]] || []).push(pair[1]);
        });

        // Depth-first cycle detection over the same edges the app draws.
        var state = {};
        function walk(node) {
          if (state[node] === 2) return false;
          if (state[node] === 1) return true;
          state[node] = 1;
          var hit = (edges[node] || []).some(walk);
          state[node] = 2;
          return hit;
        }
        if (Object.keys(edges).some(function (n) { return state[n] ? false : walk(n); })) {
          cycles.push(p.id);
        }
      });

      if (brokenPrereqs.length) {
        out.push(finding({
          id: 'broken-prereqs',
          severity: 'warning',
          title: t(brokenPrereqs.length + ' prerequisite' + (brokenPrereqs.length > 1 ? 's point' : ' points') + ' at a course that does not exist',
                   brokenPrereqs.length + ' متطلبًا يشير إلى مساق غير موجود'),
          problem: t('For example: ' + brokenPrereqs.slice(0, 3).join('; ') + '.',
                     'مثال: ' + brokenPrereqs.slice(0, 3).join('؛ ') + '.'),
          cause: t('A course was renamed or removed from the plan without updating the prerequisite that referred to it.',
                   'أُعيدت تسمية مساق أو حُذف من الخطة دون تحديث المتطلب الذي يشير إليه.'),
          suggestion: t('Correct it in data/<university>/majors/<major>.json, then rebuild with tools/build-catalogue.py. Nothing on screen breaks meanwhile — the app ignores an edge it cannot draw.',
                        'صحّحه في data/<الجامعة>/majors/<التخصص>.json ثم أعد البناء عبر tools/build-catalogue.py. ولا يتعطّل شيء على الشاشة الآن — فالتطبيق يتجاهل السهم الذي لا يستطيع رسمه.'),
          files: ['data/', 'web/plans.json'], difficulty: 'easy'
        }));
      }

      if (cycles.length) {
        out.push(finding({
          id: 'prereq-cycles',
          severity: 'critical',
          title: t('Prerequisite loop in ' + cycles.length + ' plan' + (cycles.length > 1 ? 's' : ''),
                   'حلقة متطلبات في ' + cycles.length + ' خطة'),
          problem: t('In ' + cycles.join(', ') + ' a course ends up requiring itself through a chain of prerequisites.',
                     'في ' + cycles.join('، ') + ' ينتهي مساق إلى اشتراط نفسه عبر سلسلة متطلبات.'),
          cause: t('Two prerequisite arrows point in opposite directions along the same chain.',
                   'سهما متطلبات يشيران في اتجاهين متعاكسين على السلسلة نفسها.'),
          suggestion: t('This matters: every course in the loop can never unlock. Find the reversed arrow in that plan’s data file and remove it.',
                        'هذا مهم: كل مساق في الحلقة لن يُفتح أبدًا. ابحث عن السهم المعكوس في ملف بيانات الخطة واحذفه.'),
          files: ['data/', 'web/plans.json'], difficulty: 'medium'
        }));
      }

      if (dupIds.length) {
        out.push(finding({
          id: 'duplicate-course-ids',
          severity: 'warning',
          title: t('Duplicate course ids in ' + dupIds.length + ' plan' + (dupIds.length > 1 ? 's' : ''),
                   'معرّفات مساقات مكرّرة في ' + dupIds.length + ' خطة'),
          problem: t('These plans list the same course id twice: ' + dupIds.join(', ') + '.',
                     'هذه الخطط تدرج معرّف المساق نفسه مرتين: ' + dupIds.join('، ') + '.'),
          cause: t('The same course was entered twice, or two different courses were given the same id.',
                   'أُدخل المساق نفسه مرتين، أو أُعطي مساقان مختلفان المعرّف نفسه.'),
          suggestion: t('Progress is stored per id, so ticking one will tick the other. Give them distinct ids in data/.',
                        'يُخزَّن التقدّم حسب المعرّف، فتعليم أحدهما يعلّم الآخر. أعطهما معرّفين مختلفين في data/.'),
          files: ['data/'], difficulty: 'easy'
        }));
      }

      if (badCredits.length) {
        out.push(finding({
          id: 'implausible-credits',
          severity: 'warning',
          title: t(badCredits.length + ' course' + (badCredits.length > 1 ? 's have' : ' has') + ' an implausible credit-hour value',
                   badCredits.length + ' مساقًا بقيمة ساعات غير معقولة'),
          problem: t('For example: ' + badCredits.slice(0, 4).join(', ') + '.',
                     'مثال: ' + badCredits.slice(0, 4).join('، ') + '.'),
          cause: t('A missing or mistyped credit value in the plan data.',
                   'قيمة ساعات مفقودة أو مكتوبة خطأً في بيانات الخطة.'),
          suggestion: t('Credit hours feed progress, GPA weighting, and the audit, so a wrong value is wrong in three places. Fix it in data/ and rebuild.',
                        'تدخل الساعات في التقدّم ووزن المعدّل والتدقيق، فالقيمة الخاطئة خاطئة في ثلاثة مواضع. صحّحها في data/ وأعد البناء.'),
          files: ['data/'], difficulty: 'easy'
        }));
      }

      if (noHours.length) {
        out.push(finding({
          id: 'degree-hours-missing',
          severity: 'info',
          title: t(noHours.length + ' plan' + (noHours.length > 1 ? 's have' : ' has') + ' no confirmed degree total',
                   noHours.length + ' خطة بلا مجموع ساعات مؤكَّد'),
          problem: t('These plans cannot show a completion percentage because their official credit-hour total is not set.',
                     'لا تستطيع هذه الخطط عرض نسبة إنجاز لأن مجموع ساعاتها الرسمي غير محدَّد.'),
          cause: t('The total is left empty on purpose until it is confirmed against the university’s own document — a zero would read as "a degree needing no hours".',
                   'تُترك القيمة فارغة عمدًا حتى تُؤكَّد من وثيقة الجامعة — فالصفر يُقرأ كأنه «درجة لا تحتاج ساعات».'),
          suggestion: t('Set degreeHours in data/<university>/majors/<major>.json once the official figure is confirmed, then rebuild.',
                        'حدّد degreeHours في data/<الجامعة>/majors/<التخصص>.json بعد تأكيد الرقم الرسمي ثم أعد البناء.'),
          files: ['data/'], difficulty: 'easy'
        }));
      }

      return out;
    }).catch(function () { return []; });
  }

  // ---------------------------------------------------------------
  // 5. SAVED DATA
  // ---------------------------------------------------------------
  // The one category that is fully repairable from here, because the app
  // owns every byte of it.
  var APP_KEY_PREFIXES = ['aaup_', 'studyplan.'];
  function isAppKey(k) {
    return APP_KEY_PREFIXES.some(function (p) { return k.indexOf(p) === 0; });
  }

  function savedData() {
    var out = [];
    var keys = localKeys().filter(isAppKey);

    // Values that no longer parse. Nothing can read these, so they are pure
    // dead weight — but they are still deleted with a backup first, because
    // "unparseable to me" is not the same as "worthless to the student".
    var corrupt = keys.filter(function (k) {
      var raw;
      try { raw = localStorage.getItem(k); } catch (e) { return false; }
      if (raw == null || raw === '') return false;
      if (raw[0] !== '{' && raw[0] !== '[') return false; // plain strings are legitimate
      try { JSON.parse(raw); return false; } catch (e) { return true; }
    });

    if (corrupt.length) {
      out.push(finding({
        id: 'corrupt-storage',
        severity: 'critical',
        title: t(corrupt.length + ' saved item' + (corrupt.length > 1 ? 's are' : ' is') + ' unreadable',
                 corrupt.length + ' عنصرًا محفوظًا غير قابل للقراءة'),
        problem: t('These saved values are damaged and cannot be read back: ' + corrupt.join(', ') + '.',
                   'هذه القيم المحفوظة تالفة ولا يمكن قراءتها: ' + corrupt.join('، ') + '.'),
        cause: t('Writing was interrupted — the tab closed mid-save, or the device ran out of storage.',
                 'انقطعت عملية الحفظ — أُغلق التبويب أثناءها أو نفدت مساحة الجهاز.'),
        suggestion: t('Removing them restores normal behaviour. A backup is taken first and can be restored from the history below.',
                      'حذفها يعيد السلوك الطبيعي. تُؤخذ نسخة احتياطية أولًا ويمكن استعادتها من السجل أدناه.'),
        files: [], difficulty: 'easy',
        fix: function () {
          corrupt.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
          return Promise.resolve({
            note: t('Removed ' + corrupt.length + ' damaged item(s).', 'حُذف ' + corrupt.length + ' عنصرًا تالفًا.')
          });
        }
      }));
    }

    // A selected plan that no longer exists strands the app on a blank
    // dashboard on the next open.
    var selected = null;
    try { selected = localStorage.getItem('aaup_selectedPlan'); } catch (e) {}
    if (selected) {
      var known = (window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()) || {};
      var isBuiltIn = (window.__PLANS || []).indexOf(selected) !== -1;
      if (!known[selected] && !isBuiltIn) {
        out.push(finding({
          id: 'selected-plan-gone',
          severity: 'warning',
          title: t('Your selected plan no longer exists', 'الخطة المختارة لم تعد موجودة'),
          problem: t('The app is set to open "' + selected + '", which is not among the plans on this device.',
                     'التطبيق مضبوط لفتح «' + selected + '» وهي ليست ضمن الخطط الموجودة على الجهاز.'),
          cause: t('The plan was deleted, or its id changed in an update.',
                   'حُذفت الخطة، أو تغيّر معرّفها في تحديث.'),
          suggestion: t('Clearing the selection returns you to the plan picker. No progress is deleted.',
                        'مسح الاختيار يعيدك إلى شاشة اختيار الخطة. ولا يُحذف أي تقدّم.'),
          files: [], difficulty: 'easy',
          fix: function () {
            try { localStorage.removeItem('aaup_selectedPlan'); } catch (e) {}
            return Promise.resolve({
              note: t('Selection cleared — reload to pick a plan.', 'مُسح الاختيار — أعد التحميل لاختيار خطة.')
            });
          }
        }));
      }
    }

    // Prerequisite corrections the student made against courses that have
    // since disappeared: invisible, permanent, and they can never take effect.
    var edits = (window.__loadPrereqEdits && window.__loadPrereqEdits()) || {};
    var deadEdits = [];
    Object.keys(edits).forEach(function (prefix) {
      var info = ((window.__PLAN_DATA || {})[prefix] || {}).courseInfo;
      if (!info) return; // plan not loaded right now — not evidence of anything
      (edits[prefix].added || []).forEach(function (pair) {
        if (!info[pair[0]] || !info[pair[1]]) deadEdits.push(prefix + ': ' + pair[0] + ' → ' + pair[1]);
      });
    });
    if (deadEdits.length) {
      out.push(finding({
        id: 'dead-prereq-edits',
        severity: 'info',
        title: t(deadEdits.length + ' of your prerequisite corrections no longer apply',
                 deadEdits.length + ' من تصحيحاتك للمتطلبات لم تعد سارية'),
        problem: t('They refer to courses that are not in the plan any more: ' + deadEdits.slice(0, 3).join('; ') + '.',
                   'تشير إلى مساقات لم تعد في الخطة: ' + deadEdits.slice(0, 3).join('؛ ') + '.'),
        cause: t('The official plan was updated and those courses were renamed or removed.',
                 'حُدِّثت الخطة الرسمية وأُعيدت تسمية تلك المساقات أو حُذفت.'),
        suggestion: t('They do nothing either way. Removing them just keeps your corrections tidy.',
                      'لا أثر لها في الحالتين. وحذفها يبقي تصحيحاتك مرتبة فقط.'),
        files: [], difficulty: 'easy',
        fix: function () {
          var m = window.__loadPrereqEdits();
          Object.keys(m).forEach(function (prefix) {
            var info = ((window.__PLAN_DATA || {})[prefix] || {}).courseInfo;
            if (!info || !m[prefix].added) return;
            m[prefix].added = m[prefix].added.filter(function (pair) {
              return info[pair[0]] && info[pair[1]];
            });
          });
          window.__savePrereqEdits(m);
          return Promise.resolve({
            note: t('Removed ' + deadEdits.length + ' correction(s) that could not apply.',
                    'حُذف ' + deadEdits.length + ' تصحيحًا غير قابل للتطبيق.')
          });
        }
      }));
    }

    // Leftover progress for courses that no longer exist — the app already
    // has a module that identifies these precisely, so ask it rather than
    // inventing a second, less careful definition of "orphan".
    if (window.AAUP_ORPHANS && window.AAUP_ORPHANS.activeCount) {
      var orphans = 0;
      try { orphans = window.AAUP_ORPHANS.activeCount(); } catch (e) { orphans = 0; }
      if (orphans > 0) {
        out.push(finding({
          id: 'orphan-progress',
          severity: 'info',
          title: t(orphans + ' saved item' + (orphans > 1 ? 's belong' : ' belongs') + ' to a course that is gone',
                   orphans + ' عنصرًا محفوظًا يخص مساقًا لم يعد موجودًا'),
          problem: t('Progress, grades, or notes are saved against courses that are not in any plan on this device.',
                     'هناك تقدّم أو علامات أو ملاحظات محفوظة لمساقات ليست في أي خطة على هذا الجهاز.'),
          cause: t('A plan was deleted or updated after you had already recorded something on those courses.',
                   'حُذفت خطة أو حُدِّثت بعد أن سجّلت شيئًا على تلك المساقات.'),
          suggestion: t('Settings has a dedicated section for these that shows exactly what each one is before you decide — safer than a blanket delete from here.',
                        'في الإعدادات قسم مخصص لها يعرض ما هو كل عنصر قبل أن تقرّر — وهذا أأمن من حذف شامل من هنا.'),
          files: [], difficulty: 'easy'
        }));
      }
    }

    // Storage pressure — the cause of most corrupt writes in the first place.
    var probe = Promise.resolve(null);
    if (navigator.storage && navigator.storage.estimate) {
      probe = navigator.storage.estimate().then(function (est) {
        if (!est || !est.quota) return null;
        var used = est.usage / est.quota;
        if (used < 0.9) return null;
        return finding({
          id: 'storage-nearly-full',
          severity: 'warning',
          title: t('Device storage for this app is nearly full', 'مساحة التخزين لهذا التطبيق شارفت على الامتلاء'),
          problem: t(Math.round(used * 100) + '% of the space this browser gives the app is used.',
                     'استُخدم ' + Math.round(used * 100) + '٪ من المساحة التي يمنحها المتصفح للتطبيق.'),
          cause: t('Saved plans, progress, and the offline copy of the app all share one quota.',
                   'الخطط المحفوظة والتقدّم والنسخة دون اتصال تتشارك حصة واحدة.'),
          suggestion: t('Export a backup, then delete plans you no longer use. Writes start failing silently when this fills.',
                        'صدّر نسخة احتياطية ثم احذف الخطط التي لا تستخدمها. فعمليات الحفظ تبدأ بالفشل صامتة عند الامتلاء.'),
          files: [], difficulty: 'easy'
        });
      }).catch(function () { return null; });
    }

    return probe.then(function (extra) {
      if (extra) out.push(extra);
      return out;
    });
  }

  // ---------------------------------------------------------------
  // 6. SOURCE ANALYSIS
  // ---------------------------------------------------------------
  // The app reads its own source files. Nothing here executes them —
  // `new Function(src)` compiles and throws on a syntax error without
  // running a single statement, which is exactly the check wanted.
  function sourceAnalysis() {
    var scripts = [];
    document.querySelectorAll('script[src]').forEach(function (s) { scripts.push(s.getAttribute('src')); });
    var styles = [];
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) { styles.push(l.getAttribute('href')); });

    var out = [];
    var syntaxErrors = [], leftoverLogs = [], debuggers = [], todos = [];
    var globalDefs = {};

    var jobs = scripts.map(function (url) {
      return textOf(url).then(function (src) {
        try { new Function(src); }
        catch (e) { syntaxErrors.push(url + ': ' + e.message); }

        var logs = src.match(/console\s*\.\s*log\s*\(/g);
        if (logs) leftoverLogs.push(url + ' (' + logs.length + ')');
        if (/(^|[^\w.])debugger\s*;/.test(src)) debuggers.push(url);
        var todo = src.match(/\b(TODO|FIXME|XXX)\b/g);
        if (todo) todos.push(url + ' (' + todo.length + ')');

        // Two files assigning the same global is how a feature silently
        // loses to whichever file happens to load second.
        //
        // (?!=) matters: without it, a module merely CHECKING a global —
        // `typeof window.__collectOnPlansChanged === 'function'` — is read as
        // a second definition of it, and the check reports a conflict between
        // the file that defines a hook and the file that calls it.
        var re = /window\.(AAUP_[A-Z_]+|__[A-Za-z_]+)\s*=(?!=)/g, m;
        while ((m = re.exec(src))) {
          (globalDefs[m[1]] = globalDefs[m[1]] || []);
          if (globalDefs[m[1]].indexOf(url) === -1) globalDefs[m[1]].push(url);
        }
      }).catch(function () { /* unreachable file is reported by the cache analyzer */ });
    });

    var cssJob = Promise.all(styles.map(function (url) {
      return textOf(url).then(function (css) {
        var opens = (css.match(/{/g) || []).length;
        var closes = (css.match(/}/g) || []).length;
        if (opens !== closes) {
          out.push(finding({
            id: 'css-unbalanced',
            severity: 'critical',
            title: t('Unbalanced braces in a stylesheet', 'أقواس غير متوازنة في ملف التنسيق'),
            problem: t(url + ' has ' + opens + ' "{" and ' + closes + ' "}". Everything after the mismatch is ignored by the browser.',
                       'يحوي ' + url + ' عدد ' + opens + ' «{» و' + closes + ' «}». وكل ما بعد الخلل يتجاهله المتصفح.'),
            cause: t('A rule was left unclosed during an edit.', 'تُركت قاعدة غير مغلقة أثناء التعديل.'),
            suggestion: t('Find the unclosed rule in that file — this is why part of the page looks unstyled.',
                          'ابحث عن القاعدة غير المغلقة في ذلك الملف — وهذا سبب ظهور جزء من الصفحة بلا تنسيق.'),
            files: [url], difficulty: 'medium'
          }));
        }
      }).catch(function () {});
    }));

    // The service worker's list of files to save, versus the files the page
    // actually loads. This app has no build step, so nothing keeps the two in
    // step automatically — and the failure is invisible until someone opens
    // the app on a plane.
    var swJob = textOf('sw.js').then(function (sw) {
      var block = sw.match(/var\s+CORE\s*=\s*\[([\s\S]*?)\]/);
      if (!block) return;
      var listed = (block[1].match(/'([^']+)'/g) || []).map(function (s) { return s.replace(/'/g, ''); });
      var normalize = function (u) { return u.replace(/^\.\//, ''); };
      var listedSet = {};
      listed.forEach(function (u) { listedSet[normalize(u)] = true; });
      var expected = shellUrls().map(normalize);
      var notListed = expected.filter(function (u) { return !listedSet[u]; });
      if (!notListed.length) return;

      var rebuilt = "var CORE = [\n  " +
        listed.concat(notListed.map(function (u) { return './' + u; }))
          .map(function (u) { return "'" + u + "'"; })
          .join(', ') + "\n];";

      out.push(finding({
        id: 'precache-drift',
        severity: 'warning',
        title: t(notListed.length + ' file' + (notListed.length > 1 ? 's are' : ' is') + ' not in the offline file list',
                 notListed.length + ' ملف غير مدرج في قائمة الملفات دون اتصال'),
        problem: t('The page loads these, but sw.js does not save them for offline use: ' + notListed.join(', ') + '.',
                   'تحمّل الصفحة هذه الملفات، لكن sw.js لا يحفظها للاستخدام دون اتصال: ' + notListed.join('، ') + '.'),
        cause: t('A file was added to index.html without being added to the CORE list in sw.js. There is no build step to keep them in sync.',
                 'أُضيف ملف إلى index.html دون إضافته إلى قائمة CORE في sw.js. ولا توجد خطوة بناء تبقيهما متطابقين.'),
        suggestion: t('Replace the CORE array in web/sw.js with the code below. Until then the app is incomplete offline.',
                      'استبدل مصفوفة CORE في web/sw.js بالشيفرة أدناه. وحتى ذلك الحين يكون التطبيق ناقصًا دون اتصال.'),
        files: ['web/sw.js'], difficulty: 'easy',
        code: rebuilt
      }));
    }).catch(function () {});

    return Promise.all(jobs.concat([cssJob, swJob])).then(function () {
      if (syntaxErrors.length) {
        out.push(finding({
          id: 'js-syntax-error',
          severity: 'critical',
          title: t(syntaxErrors.length + ' file' + (syntaxErrors.length > 1 ? 's have' : ' has') + ' a syntax error',
                   syntaxErrors.length + ' ملف به خطأ في الصياغة'),
          problem: t(syntaxErrors.slice(0, 3).join(' | '), syntaxErrors.slice(0, 3).join(' | ')),
          cause: t('The file cannot be parsed, so none of it runs — every feature it defines is missing.',
                   'لا يمكن تحليل الملف فلا يعمل أي جزء منه — وكل ميزة يعرّفها تكون مفقودة.'),
          suggestion: t('Fix the syntax at the position named above. This is the highest-priority kind of problem here.',
                        'صحّح الصياغة عند الموضع المذكور أعلاه. وهذا أعلى أنواع المشاكل أولوية هنا.'),
          files: syntaxErrors.map(function (s) { return s.split(':')[0]; }),
          difficulty: 'medium'
        }));
      }

      var duplicated = Object.keys(globalDefs).filter(function (g) { return globalDefs[g].length > 1; });
      if (duplicated.length) {
        out.push(finding({
          id: 'duplicate-globals',
          severity: 'warning',
          title: t(duplicated.length + ' name' + (duplicated.length > 1 ? 's are' : ' is') + ' defined in more than one file',
                   duplicated.length + ' اسمًا معرَّفًا في أكثر من ملف'),
          problem: t(duplicated.slice(0, 4).map(function (g) {
                       return g + ' (' + globalDefs[g].map(function (u) { return u.split('/').pop(); }).join(', ') + ')';
                     }).join('; '),
                     duplicated.slice(0, 4).map(function (g) {
                       return g + ' (' + globalDefs[g].map(function (u) { return u.split('/').pop(); }).join('، ') + ')';
                     }).join('؛ ')),
          cause: t('Whichever file loads last wins, so the other definition is dead code that looks live.',
                   'يفوز الملف الذي يُحمَّل أخيرًا، فتصبح التعريفات الأخرى شيفرة ميتة تبدو حيّة.'),
          suggestion: t('Keep one definition and delete the rest, or rename one of them.',
                        'أبقِ تعريفًا واحدًا واحذف الباقي، أو أعد تسمية أحدها.'),
          files: duplicated.slice(0, 6).map(function (g) { return globalDefs[g].join(' + '); }),
          difficulty: 'medium'
        }));
      }

      if (debuggers.length) {
        out.push(finding({
          id: 'debugger-left',
          severity: 'warning',
          title: t('A debugger statement was left in the code', 'تُركت تعليمة debugger في الشيفرة'),
          problem: t('Found in: ' + debuggers.join(', ') + '.', 'وُجدت في: ' + debuggers.join('، ') + '.'),
          cause: t('Debugging code that was not removed before shipping.',
                   'شيفرة تصحيح لم تُحذف قبل النشر.'),
          suggestion: t('Remove it — it freezes the app for anyone with developer tools open.',
                        'احذفها — فهي تجمّد التطبيق لكل من يفتح أدوات المطوّر.'),
          files: debuggers, difficulty: 'easy'
        }));
      }

      if (leftoverLogs.length > 3) {
        out.push(finding({
          id: 'console-logs',
          severity: 'info',
          title: t('console.log calls left in ' + leftoverLogs.length + ' files',
                   'استدعاءات console.log متروكة في ' + leftoverLogs.length + ' ملفات'),
          problem: t(leftoverLogs.slice(0, 5).join(', ') + '.', leftoverLogs.slice(0, 5).join('، ') + '.'),
          cause: t('Debug output that was never removed.', 'مخرجات تصحيح لم تُحذف.'),
          suggestion: t('Harmless, but noisy for anyone reading the console.',
                        'غير ضارّة، لكنها تشوّش على من يقرأ الطرفية.'),
          files: [], difficulty: 'easy'
        }));
      }

      if (todos.length) {
        out.push(finding({
          id: 'todos',
          severity: 'info',
          title: t(todos.length + ' file' + (todos.length > 1 ? 's contain' : ' contains') + ' TODO notes',
                   todos.length + ' ملف يحوي ملاحظات TODO'),
          problem: t(todos.slice(0, 5).join(', ') + '.', todos.slice(0, 5).join('، ') + '.'),
          cause: t('Notes left by whoever wrote the code.', 'ملاحظات تركها كاتب الشيفرة.'),
          suggestion: t('Informational only.', 'للعلم فقط.'),
          files: [], difficulty: 'easy'
        }));
      }

      return out;
    });
  }

  // ---------------------------------------------------------------
  // 7. ACCESSIBILITY
  // ---------------------------------------------------------------
  // A small, dependency-free subset of what axe-core checks, chosen for the
  // rules that actually bite this app: controls a screen reader cannot name,
  // and images it cannot describe. Reported, never auto-fixed — an aria-label
  // invented by a scanner is worse than none, because it silences the warning
  // without telling the user anything true.
  function accessibility() {
    var out = [];

    var namelessButtons = [];
    document.querySelectorAll('button, a[href], [role="button"]').forEach(function (b) {
      if (b.offsetParent === null) return;
      var name = (b.textContent || '').trim() ||
                 b.getAttribute('aria-label') || b.getAttribute('title') ||
                 (b.querySelector('img') && b.querySelector('img').getAttribute('alt'));
      if (!name) namelessButtons.push(b.id || b.className || b.tagName.toLowerCase());
    });
    if (namelessButtons.length) {
      out.push(finding({
        id: 'a11y-unnamed-controls',
        severity: 'warning',
        title: t(namelessButtons.length + ' control' + (namelessButtons.length > 1 ? 's have' : ' has') + ' no readable name',
                 namelessButtons.length + ' عنصر تحكّم بلا اسم مقروء'),
        problem: t('A screen reader announces these as just "button": ' + namelessButtons.slice(0, 5).join(', ') + '.',
                   'يقرأها قارئ الشاشة كـ«زر» فقط: ' + namelessButtons.slice(0, 5).join('، ') + '.'),
        cause: t('The control shows only an icon, with no aria-label to say what it does.',
                 'يعرض العنصر أيقونة فقط دون aria-label يوضّح وظيفته.'),
        suggestion: t('Add aria-label="…" to each. Not auto-fixed on purpose: a made-up label would hide the problem rather than solve it.',
                      'أضف aria-label="…" لكل منها. ولا يُصلَح تلقائيًا عمدًا: فالتسمية المخترعة تخفي المشكلة بدل حلّها.'),
        files: ['web/index.html'], difficulty: 'easy'
      }));
    }

    var noAlt = [];
    document.querySelectorAll('img').forEach(function (img) {
      if (!img.hasAttribute('alt')) noAlt.push(img.getAttribute('src') || 'image');
    });
    if (noAlt.length) {
      out.push(finding({
        id: 'a11y-img-alt',
        severity: 'info',
        title: t(noAlt.length + ' image' + (noAlt.length > 1 ? 's have' : ' has') + ' no alt text',
                 noAlt.length + ' صورة بلا نص بديل'),
        problem: t(noAlt.slice(0, 4).join(', ') + '.', noAlt.slice(0, 4).join('، ') + '.'),
        cause: t('The alt attribute is missing entirely.', 'خاصية alt مفقودة تمامًا.'),
        suggestion: t('Add alt="" for decoration, or a short description for meaningful images.',
                      'أضف alt="" للصور الزخرفية، أو وصفًا قصيرًا للصور ذات المعنى.'),
        files: ['web/index.html'], difficulty: 'easy'
      }));
    }

    // Duplicate ids break every getElementById in the app — it returns the
    // first match, and the second element becomes unreachable.
    var seen = {}, dupes = [];
    document.querySelectorAll('[id]').forEach(function (n) {
      if (seen[n.id]) { if (dupes.indexOf(n.id) === -1) dupes.push(n.id); }
      seen[n.id] = true;
    });
    if (dupes.length) {
      out.push(finding({
        id: 'duplicate-ids',
        severity: 'warning',
        title: t(dupes.length + ' duplicated element id' + (dupes.length > 1 ? 's' : ''),
                 dupes.length + ' معرّف عنصر مكرّر'),
        problem: t('These ids appear more than once: ' + dupes.slice(0, 6).join(', ') + '.',
                   'تتكرّر هذه المعرّفات: ' + dupes.slice(0, 6).join('، ') + '.'),
        cause: t('Two elements were given the same id, most likely by a render that ran twice.',
                 'أُعطي عنصران المعرّف نفسه، غالبًا بسبب عملية رسم تكرّرت.'),
        suggestion: t('Only the first is reachable in code — the second is invisible to every lookup. Make the ids unique.',
                      'الأول فقط يمكن الوصول إليه برمجيًا — والثاني غير مرئي لأي بحث. اجعل المعرّفات فريدة.'),
        files: ['web/index.html'], difficulty: 'medium'
      }));
    }

    return Promise.resolve(out);
  }

  // ---------------------------------------------------------------
  // 8. LINKS AND HANDLERS
  // ---------------------------------------------------------------
  function linksAndHandlers() {
    var out = [];

    var deadAnchors = [];
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      var id = a.getAttribute('href').slice(1);
      if (id && !document.getElementById(id)) deadAnchors.push(a.getAttribute('href'));
    });
    if (deadAnchors.length) {
      out.push(finding({
        id: 'dead-anchors',
        severity: 'warning',
        title: t(deadAnchors.length + ' link' + (deadAnchors.length > 1 ? 's point' : ' points') + ' nowhere',
                 deadAnchors.length + ' رابط لا يؤدي إلى شيء'),
        problem: t('These target elements that do not exist: ' + deadAnchors.slice(0, 5).join(', ') + '.',
                   'تشير إلى عناصر غير موجودة: ' + deadAnchors.slice(0, 5).join('، ') + '.'),
        cause: t('The target was renamed or removed but the link was not updated.',
                 'أُعيدت تسمية الهدف أو حُذف دون تحديث الرابط.'),
        suggestion: t('Point them at a real id, or remove them.', 'وجّهها إلى معرّف حقيقي أو احذفها.'),
        files: ['web/index.html'], difficulty: 'easy'
      }));
    }

    // Inline onclick="AAUP_X.y()" is used throughout this app's markup. If
    // the module behind one never loaded, the button is a button that does
    // nothing at all when tapped — with no error until then.
    var deadHandlers = [];
    document.querySelectorAll('[onclick]').forEach(function (n) {
      var code = n.getAttribute('onclick') || '';
      var root = code.match(/^\s*([A-Za-z_$][\w$]*)/);
      if (root && !(root[1] in window) && ['event', 'this', 'if', 'return', 'location', 'window', 'document'].indexOf(root[1]) === -1) {
        if (deadHandlers.indexOf(root[1]) === -1) deadHandlers.push(root[1]);
      }
    });
    if (deadHandlers.length) {
      out.push(finding({
        id: 'dead-handlers',
        severity: 'critical',
        title: t(deadHandlers.length + ' button' + (deadHandlers.length > 1 ? 's call' : ' calls') + ' code that does not exist',
                 deadHandlers.length + ' زر يستدعي شيفرة غير موجودة'),
        problem: t('Tapping them does nothing, because ' + deadHandlers.join(', ') + ' is not defined.',
                   'الضغط عليها لا يفعل شيئًا لأن ' + deadHandlers.join('، ') + ' غير معرَّف.'),
        cause: t('The module that defines it did not load, or was renamed without updating the markup.',
                 'لم تُحمَّل الوحدة التي تعرّفه، أو أُعيدت تسميته دون تحديث العناصر.'),
        suggestion: t('Repair the offline cache and reload. If it survives that, the name in index.html no longer matches the code.',
                      'أصلح التخزين دون اتصال وأعد التحميل. وإن بقي الأمر فالاسم في index.html لم يعد يطابق الشيفرة.'),
        files: ['web/index.html'], difficulty: 'medium'
      }));
    }

    return Promise.resolve(out);
  }

  // ---------------------------------------------------------------
  // 9. PERFORMANCE
  // ---------------------------------------------------------------
  function performanceCheck() {
    var out = [];
    var nodes = document.getElementsByTagName('*').length;
    if (nodes > 9000) {
      out.push(finding({
        id: 'dom-size',
        severity: 'warning',
        title: t('The page is very large (' + nodes + ' elements)', 'الصفحة كبيرة جدًا (' + nodes + ' عنصرًا)'),
        problem: t('A page this size scrolls and re-renders slowly, especially on older phones.',
                   'صفحة بهذا الحجم تتمرّر وتُعاد رسمها ببطء، خاصة على الهواتف القديمة.'),
        cause: t('Every plan that has been opened stays in the page, and each course is several elements.',
                 'كل خطة فُتحت تبقى في الصفحة، وكل مساق عدة عناصر.'),
        suggestion: t('Reloading clears it. It grows again as you open more plans in one session.',
                      'إعادة التحميل تنظّفها. وتنمو مجددًا كلما فتحت خططًا أكثر في الجلسة نفسها.'),
        files: [], difficulty: 'medium'
      }));
    }

    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav && nav.loadEventEnd > 0) {
        var secs = nav.loadEventEnd / 1000;
        if (secs > 6) {
          out.push(finding({
            id: 'slow-load',
            severity: 'info',
            title: t('This page took ' + secs.toFixed(1) + 's to load', 'استغرق تحميل الصفحة ' + secs.toFixed(1) + ' ثانية'),
            problem: t('Slower than expected for an app that is stored on the device.',
                       'أبطأ من المتوقّع لتطبيق مخزَّن على الجهاز.'),
            cause: t('Usually the first visit, when everything is being downloaded and saved.',
                     'عادةً في الزيارة الأولى حين يُنزَّل كل شيء ويُحفظ.'),
            suggestion: t('Later visits load from the device and should be much faster. If they are not, check the offline storage above.',
                          'الزيارات اللاحقة تُحمَّل من الجهاز وتكون أسرع بكثير. وإن لم تكن كذلك فراجع التخزين دون اتصال أعلاه.'),
            files: [], difficulty: 'easy'
          }));
        }
      }
    } catch (e) { /* timing API unavailable */ }

    return Promise.resolve(out);
  }

  // ---------------------------------------------------------------
  // 10. SECURITY
  // ---------------------------------------------------------------
  function securityCheck() {
    var out = [];
    var https = location.protocol === 'https:';

    if (https) {
      var insecure = [];
      document.querySelectorAll('[src], [href]').forEach(function (n) {
        var u = n.getAttribute('src') || n.getAttribute('href') || '';
        if (u.indexOf('http://') === 0) insecure.push(u);
      });
      if (insecure.length) {
        out.push(finding({
          id: 'mixed-content',
          severity: 'critical',
          title: t(insecure.length + ' insecure resource' + (insecure.length > 1 ? 's' : '') + ' on a secure page',
                   insecure.length + ' مورد غير آمن في صفحة آمنة'),
          problem: t('These load over plain http: ' + insecure.slice(0, 4).join(', ') + '.',
                     'تُحمَّل هذه عبر http عادي: ' + insecure.slice(0, 4).join('، ') + '.'),
          cause: t('An http:// address on an https:// page. Browsers block these, so the resource simply never arrives.',
                   'عنوان http:// في صفحة https://. تحجبها المتصفحات فلا يصل المورد أصلًا.'),
          suggestion: t('Change them to https:// — or better, host the file with the app so it works offline too.',
                        'غيّرها إلى https:// — والأفضل استضافة الملف مع التطبيق ليعمل دون اتصال أيضًا.'),
          files: ['web/index.html'], difficulty: 'easy'
        }));
      }
    }

    var foreign = [];
    document.querySelectorAll('script[src]').forEach(function (s) {
      var u = s.getAttribute('src') || '';
      if (/^https?:\/\//.test(u) && u.indexOf(location.origin) !== 0) foreign.push(u);
    });
    if (foreign.length) {
      out.push(finding({
        id: 'third-party-scripts',
        severity: 'warning',
        title: t(foreign.length + ' script' + (foreign.length > 1 ? 's are' : ' is') + ' loaded from another site',
                 foreign.length + ' سكربت مُحمَّل من موقع آخر'),
        problem: t(foreign.join(', '), foreign.join('، ')),
        cause: t('Code from another origin runs with full access to this app and everything saved in it.',
                 'شيفرة من أصل آخر تعمل بصلاحية كاملة على التطبيق وكل ما هو محفوظ فيه.'),
        suggestion: t('This app is designed to have none — it also breaks offline use. Bundle the file instead.',
                      'صُمِّم هذا التطبيق بلا أي منها — كما أنها تعطّل العمل دون اتصال. ضمّن الملف بدلًا من ذلك.'),
        files: ['web/index.html'], difficulty: 'medium'
      }));
    }

    var unsafeTargets = [];
    document.querySelectorAll('a[target="_blank"]').forEach(function (a) {
      var rel = (a.getAttribute('rel') || '');
      if (rel.indexOf('noopener') === -1) unsafeTargets.push(a.getAttribute('href') || '(link)');
    });
    if (unsafeTargets.length) {
      out.push(finding({
        id: 'target-blank-noopener',
        severity: 'warning',
        title: t(unsafeTargets.length + ' link' + (unsafeTargets.length > 1 ? 's open' : ' opens') + ' a new tab unsafely',
                 unsafeTargets.length + ' رابط يفتح تبويبًا جديدًا بشكل غير آمن'),
        problem: t('target="_blank" without rel="noopener": ' + unsafeTargets.slice(0, 4).join(', ') + '.',
                   'target="_blank" بدون rel="noopener": ' + unsafeTargets.slice(0, 4).join('، ') + '.'),
        cause: t('The opened page gets a handle back to this one and can navigate it elsewhere.',
                 'تحصل الصفحة المفتوحة على مقبض لهذه الصفحة ويمكنها توجيهها إلى مكان آخر.'),
        suggestion: t('Add rel="noopener noreferrer" to each.', 'أضف rel="noopener noreferrer" لكل منها.'),
        files: ['web/index.html'], difficulty: 'easy'
      }));
    }

    // Something token-shaped in local storage. Almost certainly pasted in by
    // hand, and this app never needs one — worth flagging on the student's
    // own device, where it is their secret sitting in plain text.
    var suspicious = localKeys().filter(function (k) {
      var v = '';
      try { v = localStorage.getItem(k) || ''; } catch (e) { return false; }
      return /\b(gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/.test(v);
    });
    if (suspicious.length) {
      out.push(finding({
        id: 'secret-in-storage',
        severity: 'critical',
        title: t('Something that looks like a secret key is saved in this browser',
                 'يبدو أن مفتاحًا سريًا محفوظ في هذا المتصفح'),
        problem: t('These saved items contain a token-shaped value: ' + suspicious.join(', ') + '.',
                   'تحتوي هذه العناصر المحفوظة على قيمة تشبه رمزًا سريًا: ' + suspicious.join('، ') + '.'),
        cause: t('A key was pasted into the app or into browser storage. This app never needs one.',
                 'لُصق مفتاح في التطبيق أو في تخزين المتصفح. وهذا التطبيق لا يحتاج أيًّا منها.'),
        suggestion: t('Treat the key as exposed: revoke it wherever it came from, then delete it here.',
                      'اعتبر المفتاح مكشوفًا: ألغِه من مصدره ثم احذفه من هنا.'),
        files: [], difficulty: 'easy',
        fix: function () {
          suspicious.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
          return Promise.resolve({
            note: t('Removed ' + suspicious.length + ' item(s). Revoke the key at its source as well.',
                    'حُذف ' + suspicious.length + ' عنصرًا. وألغِ المفتاح من مصدره أيضًا.')
          });
        }
      }));
    }

    return Promise.resolve(out);
  }

  // ---------------------------------------------------------------
  // REGISTRY
  // ---------------------------------------------------------------
  var ANALYZERS = [
    { id: 'runtime', title: t('Runtime errors', 'أخطاء التشغيل'), run: runtimeErrors },
    { id: 'modules', title: t('Feature modules', 'وحدات التطبيق'), run: missingModules },
    { id: 'cache', title: t('Offline storage', 'التخزين دون اتصال'), run: offlineCache },
    { id: 'catalogue', title: t('Study-plan data', 'بيانات الخطط'), run: catalogueIntegrity },
    { id: 'saved', title: t('Your saved data', 'بياناتك المحفوظة'), run: savedData },
    { id: 'source', title: t('Source files', 'ملفات المصدر'), run: sourceAnalysis },
    { id: 'a11y', title: t('Accessibility', 'إمكانية الوصول'), run: accessibility },
    { id: 'links', title: t('Links and buttons', 'الروابط والأزرار'), run: linksAndHandlers },
    { id: 'perf', title: t('Performance', 'الأداء'), run: performanceCheck },
    { id: 'security', title: t('Security', 'الأمان'), run: securityCheck }
  ];

  window.AAUP_FIX_ANALYZERS = {
    list: ANALYZERS,
    // Registering a new analyzer is a one-liner from anywhere, so this stays
    // extensible without editing this file.
    register: function (analyzer) { ANALYZERS.push(analyzer); },
    helpers: { t: t, finding: finding, textOf: textOf, shellUrls: shellUrls, localKeys: localKeys, isAppKey: isAppKey }
  };
})();
