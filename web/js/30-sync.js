// ==========================
// ONLINE SYNC — pulls new/updated official plans from APP_PLANS_FEED_URL
// ==========================
// This is the one place text from OUTSIDE the user's own browser enters the
// app (every other imported plan came from a file the user personally chose
// to open). Every string field is HTML-escaped and every id is re-slugified
// to a safe [a-z0-9-]+ shape before it ever reaches the same render paths
// AAUP_IMPORTED already uses — those paths interpolate plan data into
// innerHTML/attribute strings without re-checking it, which is fine for a
// user's own data (self-XSS at worst) but not for data that arrived over
// the network on behalf of every user of the feed.
(function(){
  // Everything this module says to a student, in the app's language.
  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function safeId(s, fallback){
    var out = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return out || fallback || ('x-' + Math.random().toString(36).slice(2, 8));
  }
  function esc(s){ return window.__escapeHtml(s); }
  function escName(n){
    if(!n) return { big: '', small: '' };
    if(typeof n === 'object') return { big: esc(n.big || ''), small: esc(n.small || '') };
    return { big: esc(n), small: '' };
  }
  var CATS = ['skills','core','math','dept','eng','uni','free'];

  function sanitizePlan(fp){
    if(!fp || !fp.id || !fp.majorName) return null;
    var id = safeId(fp.id);
    var university = (window.APP_UNIVERSITIES && window.APP_UNIVERSITIES[fp.university]) ? fp.university : 'aaup';
    var years = Array.isArray(fp.structure && fp.structure.years) ? fp.structure.years.map(function(y){
      return { id: safeId(y.id, 'y1'), hasSummer: !!y.hasSummer };
    }) : [{ id: 'y1', hasSummer: false }];
    var yearIds = years.map(function(y){ return y.id; });
    var courses = Array.isArray(fp.courses) ? fp.courses.slice(0, 400).map(function(c){
      var out = {
        id: safeId(c.id), name: esc(c.name || c.id || ''), ar: esc(c.ar || ''),
        creditHours: Math.max(0, Math.min(20, Number(c.creditHours) || 0)),
        category: CATS.indexOf(c.category) !== -1 ? c.category : 'core',
        // A course with no year is not a course in year one — it is an
        // elective the student picks, and the plan deliberately does not say
        // when. Forcing it to yearIds[0] is what dumped every department
        // elective into Year 1 Semester 1, mixed in with the required courses
        // and with no way to tell them apart. Empty is preserved and the
        // renderer gives them their own section.
        yearId: yearIds.indexOf(safeId(c.yearId)) !== -1 ? safeId(c.yearId) : '',
        // "summer" is a friendly alias for the renderer's s3 summer slot —
        // normalize so a feed plan's summer courses actually render.
        semester: (c.semester == null || c.semester === '')
          ? ''
          : (window.__normalizeSemester ? window.__normalizeSemester(c.semester) : (['s1','s2'].indexOf(c.semester) !== -1 ? c.semester : 's1'))
      };
      // The real catalog code (e.g. "100411010") — was silently dropped by
      // this sanitizer even though __sanitizeImportedPlan (the other entry
      // point, for manually-pasted/imported plans) already preserved it;
      // every course synced from the online feed showed "-" for its course
      // number in the popup and couldn't be found by searching its code.
      if(c.courseNumber != null){ out.courseNumber = esc(String(c.courseNumber)).slice(0, 30); }
      // The university's requirement bucket. Like courseNumber above, this
      // sanitizer is a strict whitelist, so a field that is not named here is
      // silently dropped — which is exactly how every synced course lost its
      // course number once already.
      if(window.__REQUIREMENT_KEYS && window.__REQUIREMENT_KEYS.indexOf(c.requirement) !== -1){
        out.requirement = c.requirement;
      }
      // Whether this course's TERM came from the published plan or was picked
      // by the app (see tools/build-catalogue.py). Named here for the same
      // reason the two above are: this whitelist drops anything it does not
      // know, and every plan on the home screen arrives through it.
      if(c.termSuggested){ out.termSuggested = true; }
      return out;
    }) : [];
    var prerequisites = Array.isArray(fp.prerequisites) ? fp.prerequisites.slice(0, 800).map(function(pair){
      return [safeId(pair[0]), safeId(pair[1])];
    }).filter(function(pair){ return pair[0] && pair[1]; }) : [];
    return {
      id: id,
      majorName: { en: escName(fp.majorName.en), ar: escName(fp.majorName.ar) },
      icon: String(fp.icon || '🎓').slice(0, 8),
      // The two newer icon layers have to survive this sanitizer or every
      // synced plan would fall back to its emoji. iconKey is checked against
      // the built-in set rather than escaped — it is an enum, not text — and
      // imageUrl goes through the same URL guard the renderer uses.
      iconKey: (window.AAUP_ICONS && window.AAUP_ICONS.has(fp.iconKey)) ? fp.iconKey : '',
      imageUrl: window.AAUP_ICONS ? window.AAUP_ICONS.safeImageUrl(fp.imageUrl) : '',
      bio: { en: esc(fp.bio && fp.bio.en), ar: esc(fp.bio && fp.bio.ar) },
      college: { en: esc(fp.college && fp.college.en), ar: esc(fp.college && fp.college.ar) },
      // Where this plan sits among its faculty's tiles. A number or null, never
      // text — it is only ever compared, so it does not go through esc().
      sortOrder: (fp.sortOrder == null || fp.sortOrder === '' || !isFinite(Number(fp.sortOrder)))
        ? null : Number(fp.sortOrder),
      university: university,
      structure: { years: years },
      courses: courses,
      prerequisites: prerequisites,
      // Round 10, idea 8: named groups of electives a student can follow.
      tracks: Array.isArray(fp.tracks) ? fp.tracks.slice(0, 20).map(function(t){
        return { id: safeId(t && t.id), name: { en: esc(t && t.name && t.name.en), ar: esc(t && t.name && t.name.ar) },
                 courses: (Array.isArray(t && t.courses) ? t.courses : []).slice(0, 60).map(function(c){ return safeId(c); }).filter(Boolean) };
      }).filter(function(t){ return t.id && t.name.en && t.courses.length; }) : [],
      // Idea 7: an old course that now counts as one of this plan's.
      replaced: Array.isArray(fp.replaced) ? fp.replaced.slice(0, 100).map(function(r){ return [safeId(r && r[0]), safeId(r && r[1])]; })
        .filter(function(r){ return r[0] && r[1] && r[0] !== r[1]; }) : [],
      requirementHours: window.__cleanRequirementHours
        ? window.__cleanRequirementHours(fp.requirementHours) : {},
      official: true,
      feedVersion: Number(fp.version) || 1,
      importedAt: new Date().toISOString()
    };
  }

  function fetchFeed(){
    if(!window.APP_PLANS_FEED_URL || typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(window.APP_PLANS_FEED_URL, { cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; });
  }

  // ---------------------------------------------------------------------
  // Official updates reach every student, and every student keeps their own
  // ---------------------------------------------------------------------
  // An update used to be all or nothing: a plan the student had never
  // touched was replaced, and one they had edited waited behind a "keep
  // mine or take theirs" question. Saying no to it kept the student's moves
  // and also kept the wrong prerequisite the update was there to fix.
  //
  // Now there is no question. Every official plan carries a small copy of
  // the version it came from (`base`). Comparing three copies (that one, the
  // student's, and the new official one) says who changed what:
  //   - something the university changed (a prerequisite, the hours, a
  //     name, a course added or taken out) is applied, for everyone, even on
  //     a course the student edited;
  //   - something only the student changed (where a course sits, a course
  //     they added or deleted, an arrow they drew or removed) is kept.
  // Where the university and the student both moved the same course, the
  // student's place wins: an update never moves a course someone put
  // somewhere themselves.

  // What an update must not take from a student even when the university
  // drops the course: one they added, a retake, or one they ticked, graded
  // or gave a status (Leadership taken as a university elective, say).
  function keptByStudent(planId, c){
    if(c.own || c.isRetake) return true;
    var pid = planId + '-c-' + c.id;
    var prog = window.__getProgress ? window.__getProgress() : {};
    var st = window.AAUP_GPA && window.AAUP_GPA.loadStatuses ? window.AAUP_GPA.loadStatuses() : {};
    var gr = window.AAUP_GPA && window.AAUP_GPA.loadGrades ? window.AAUP_GPA.loadGrades() : {};
    return !!(prog[pid] || st[pid] || gr[pid]);
  }

  // The fields of a course the university decides. Placement is handled
  // apart, because there the student's choice wins.
  var FIELDS = ['name', 'ar', 'creditHours', 'category', 'courseNumber', 'requirement', 'termSuggested'];
  function pairKey(p){ return p[0] + '>' + p[1]; }
  function blank(v){ return v == null || v === '' || v === false; }

  // The base only has to answer "did the university change this?", so a
  // long value is kept as a short fingerprint, not the text. Every plan on
  // the phone carries one, and the full copy doubled what the app keeps in
  // the browser.
  function fp(str){
    var h = 0x811c9dc5;
    for(var i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  function tok(f, v){
    if(blank(v)) return '';
    if(f === 'name' || f === 'ar' || f === 'courseNumber') return fp(String(v));
    return f === 'termSuggested' ? '1' : String(v);
  }
  function place(c){ return (c.yearId || '') + '/' + (c.semester || ''); }

  // The official version, kept small: per course its place and a token per
  // field ("y2/s1|<name>|<ar>|3|core|<number>|univReq|"), the prerequisite
  // pairs as fingerprints, and the years.
  function makeBase(plan){
    var c = {};
    (plan.courses || []).forEach(function(x){
      c[x.id] = [place(x)].concat(FIELDS.map(function(f){ return tok(f, x[f]); })).join('|');
    });
    return {
      v: plan.feedVersion,
      c: c,
      p: (plan.prerequisites || []).map(function(q){ return fp(pairKey(q)); }),
      y: ((plan.structure && plan.structure.years) || []).map(function(y){ return [y.id, y.hasSummer ? 1 : 0]; })
    };
  }

  // base: the official version the student's copy came from, or null for a
  // copy saved before bases existed. With no base, nothing says what the
  // student changed, so: the university's fields win; on a plan the student
  // edited, a course sitting somewhere other than the new official place
  // stays where it is (on one they never edited, the difference is the
  // university's); and a course missing from the copy comes back (it may
  // be one the university just added).
  function mergeOfficial(planId, base, current, incoming){
    var B = base ? base.c : null;
    var cur = {}, inc = {};
    (current.courses || []).forEach(function(c){ cur[c.id] = c; });
    (incoming.courses || []).forEach(function(c){ inc[c.id] = c; });
    var out = [];

    (incoming.courses || []).forEach(function(n){
      var c = cur[n.id], b = B && typeof B[n.id] === 'string' ? B[n.id].split('|') : null;
      if(!c){
        // In the version they had and gone from their copy: they deleted it.
        if(b) return;
        out.push(n);
        return;
      }
      var m = JSON.parse(JSON.stringify(c));
      FIELDS.forEach(function(f, i){
        // The university changed it (or there is no base to say otherwise).
        if(!b || b[i + 1] !== tok(f, n[f])){
          if(n[f] == null || n[f] === '' || n[f] === false) delete m[f]; else m[f] = n[f];
        }
      });
      // An Arabic name the student wrote stays when the university has none.
      if(!b && c.ar && c.ar !== c.name && blank(n.ar)) m.ar = c.ar;
      var theirs = !!c.placedByStudent || (b
        ? place(c) !== b[0]
        : (!!current.wasEdited && place(c) !== place(n)));
      if(!theirs){
        if(n.yearId) m.yearId = n.yearId; else delete m.yearId;
        m.semester = n.semester || '';
      }
      out.push(m);
    });
    // Theirs, kept: courses the university does not list (any more).
    (current.courses || []).forEach(function(c){
      if(inc[c.id]) return;
      var inBase = !!(B && B[c.id]);
      if(c.own || c.isRetake || keptByStudent(planId, c)) out.push(c);
      else if(B && !inBase) out.push(c);          // added by the student before "own" existed
    });

    var ids = {};
    out.forEach(function(c){ ids[c.id] = true; });
    var BP = null;
    if(base){ BP = {}; (base.p || []).forEach(function(k){ BP[k] = true; }); }
    var inBP = function(k){ return !!(BP && BP[fp(k)]); };
    var CP = {}, IP = {};
    (current.prerequisites || []).forEach(function(p){ CP[pairKey(p)] = p; });
    (incoming.prerequisites || []).forEach(function(p){ IP[pairKey(p)] = p; });
    var pairs = [], seen = {};
    function add(p){ var k = pairKey(p); if(!seen[k] && ids[p[0]] && ids[p[1]]){ seen[k] = true; pairs.push([p[0], p[1]]); } }
    Object.keys(IP).forEach(function(k){
      // Every official pair, except one the student removed and the
      // university did not touch since.
      if(inBP(k) && !CP[k]) return;
      add(IP[k]);
    });
    Object.keys(CP).forEach(function(k){
      if(IP[k]) return;
      if(BP){ if(!inBP(k)) add(CP[k]); return; }   // drawn by the student; else dropped by the university
      var a = cur[CP[k][0]] || {}, z = cur[CP[k][1]] || {};
      if(a.own || z.own || a.isRetake || z.isRetake) add(CP[k]);
    });

    // Years: the official ones, plus a year or summer the student added, or
    // one the university dropped that still holds a course of theirs.
    var years = ((incoming.structure && incoming.structure.years) || []).map(function(y){ return { id: y.id, hasSummer: !!y.hasSummer }; });
    var byYear = {}, inBaseYear = {}, used = {};
    years.forEach(function(y){ byYear[y.id] = y; });
    if(base) (base.y || []).forEach(function(y){ inBaseYear[y[0]] = { summer: !!y[1] }; });
    out.forEach(function(c){ if(c.yearId){ used[c.yearId] = true; if(c.semester === 's3') used[c.yearId + '/s3'] = true; } });
    ((current.structure && current.structure.years) || []).forEach(function(y){
      var was = inBaseYear[y.id];
      if(byYear[y.id]){
        if(y.hasSummer && !byYear[y.id].hasSummer && (!base || !was || !was.summer || used[y.id + '/s3'])) byYear[y.id].hasSummer = true;
        return;
      }
      if(!base || !was || used[y.id]){ var ny = { id: y.id, hasSummer: !!y.hasSummer }; years.push(ny); byYear[y.id] = ny; }
    });

    var merged = {};
    Object.keys(current).forEach(function(k){ merged[k] = current[k]; });
    Object.keys(incoming).forEach(function(k){ merged[k] = incoming[k]; });
    merged.courses = out;
    merged.prerequisites = pairs;
    merged.structure = { years: years };
    merged.wasEdited = !!current.wasEdited;
    delete merged.declinedVersion;
    merged.base = makeBase(incoming);
    return merged;
  }

  function applyFeed(feed){
    var result = { added: 0, updated: 0 };
    if(!feed || !Array.isArray(feed.plans) || !window.AAUP_IMPORTED) return result;
    var local = window.AAUP_IMPORTED.loadImportedPlans();
    var touched = false;
    // Plans this user removed in the Developer Panel stay removed for them.
    var removed = (window.AAUP_STORAGE && window.AAUP_STORAGE.getJSON('aaup_removedPlans', [])) || [];

    feed.plans.forEach(function(fp){
      var sanitized = sanitizePlan(fp);
      if(!sanitized) return;
      var existing = local[sanitized.id];
      if(!existing && removed.indexOf(sanitized.id) !== -1) return;

      if(!existing){
        sanitized.base = makeBase(sanitized);
        local[sanitized.id] = sanitized;
        result.added++;
        return;
      }
      if(!existing.official){
        // A plan the student built themselves that happens to share an id.
        // Not ours to touch at all.
        return;
      }
      // Any different version is a new one. The version is a hash of the
      // plan's content (tools/build-catalogue.py), not a counter, so "only a
      // bigger number" threw away about half of all real updates. A version
      // a student turned down under the old "keep mine" question is applied
      // now too: those were the fixes.
      if((existing.feedVersion || 0) === sanitized.feedVersion && !existing.declinedVersion){
        // Same version: whatever the student has came from exactly this, so
        // this is its base. Copies saved before bases existed get theirs here.
        if(!existing.base || existing.base.v !== sanitized.feedVersion){
          existing.base = makeBase(sanitized);
          touched = true;
        }
        return;
      }
      local[sanitized.id] = mergeOfficial(sanitized.id, existing.base && existing.base.c ? existing.base : null, existing, sanitized);
      result.updated++;
    });

    if(result.added || result.updated || touched){
      window.AAUP_IMPORTED.saveImportedPlans(local);
    }
    // A passed old course now counts as its replacement (js/02-id-renames.js).
    // The app already read what was saved, so it has to start again to see the
    // move: at once while it is still opening, otherwise when the student says.
    if(window.__carryAllReplaced && window.__carryAllReplaced()){
      var fresh = window.performance && performance.now ? performance.now() < 15000 : false;
      if(fresh) location.reload();
      else if(window.__showActionToast) window.__showActionToast(L('A course in your plan was replaced; your progress moved to the new one.', 'انبدل مساق بخطتك؛ تقدّمك انتقل للمساق الجديد.'), L('Reload', 'حدّث'), function(){ location.reload(); });
    }
    return result;
  }

  function lastSyncLabel(){
    var t = 0;
    try{ t = parseInt(localStorage.getItem('aaup_lastSync') || '0', 10) || 0; }catch(e){}
    if(!t) return L('Never checked yet.', 'لسا ما انفحصت.');
    var mins = Math.round((Date.now() - t) / 60000);
    if(mins < 1) return L('Last checked just now.', 'آخر فحص: هلّق.');
    if(mins < 60) return L('Last checked ' + mins + ' min ago.', 'آخر فحص: قبل ' + mins + ' دقيقة.');
    var hrs = Math.round(mins / 60);
    if(hrs < 24) return L('Last checked ' + hrs + 'h ago.', 'آخر فحص: قبل ' + hrs + ' ساعة.');
    return L('Last checked ' + Math.round(hrs / 24) + 'd ago.', 'آخر فحص: قبل ' + Math.round(hrs / 24) + ' يوم.');
  }

  // Two startup paths reach checkForUpdates(false): the catalogue boot chain
  // hands the freshly read plans over (01-catalogue.js), and this module's own
  // load init fires independently. That meant three plans.json downloads per
  // cold start and two applyFeed passes over identical data. An automatic check
  // is only worth doing once per page load, so the first one is shared; a
  // manual check from Settings always runs fresh, because the whole point of
  // pressing the button is to ask again.
  var autoCheck = null;

  // presetFeed lets the catalogue hand over the plans it has already
  // downloaded and parsed, instead of making this module fetch the same file a
  // second time on a student's mobile data.
  function checkForUpdates(manual, presetFeed){
    if(!manual && autoCheck) return autoCheck;
    var run = (presetFeed ? Promise.resolve(presetFeed) : fetchFeed()).then(function(feed){
      if(!feed){
        if(manual && window.__showToast){ window.__showToast(L('Could not reach the plans feed — check your connection.', 'ما قدرنا نوصل للخطط — تأكد من الإنترنت.')); }
        return { added: 0, updated: 0 };
      }
      var result = applyFeed(feed);
      try{ localStorage.setItem('aaup_lastSync', String(Date.now())); }catch(e){}
      // Nothing is announced over the first screen a student ever sees.
      // On a brand-new device every plan in the feed is "new", so the landing
      // page came up with "🔄 78 new." floating over it — an update to an app
      // they had not opened yet. A manual check still always reports back,
      // because then someone asked.
      var firstRun = document.getElementById('onboardingWizardOverlay');
      firstRun = !!(firstRun && firstRun.classList.contains('open'));
      if(!manual && firstRun){ return result; }
      if(manual || result.added || result.updated){
        var bits = [];
        if(result.added) bits.push(L(result.added + ' new', result.added + ' جديدة'));
        if(result.updated) bits.push(L(result.updated + ' updated', result.updated + ' انحدّثت'));
        if(!bits.length) bits.push(L('already up to date', 'كل إشي محدّث'));
        var msg = bits.join(L(', ', '، ')) + '.';
        if(window.__showToast){ window.__showToast(msg); }
      }
      return result;
    });
    if(!manual) autoCheck = run;
    return run;
  }

  // The university's own version of one plan, fresh from the feed and
  // cleaned the same way an update is: what "Reset to official plan" puts a
  // semester back to (js/106-semester.js). Resolves to null when offline or
  // when the plan isn't an official one.
  function officialPlan(id){
    return fetchFeed().then(function(feed){
      var fp = feed && Array.isArray(feed.plans) ? feed.plans.filter(function(x){ return x && x.id === id; })[0] : null;
      return fp ? sanitizePlan(fp) : null;
    }).catch(function(){ return null; });
  }

  window.AAUP_SYNC = {
    officialPlan: officialPlan,
    checkForUpdates: checkForUpdates,
    lastSyncLabel: lastSyncLabel,
    // Exposed so the merge can be driven with a crafted feed. Reaching it
    // through the network would mean publishing a change and waiting for a
    // deploy, which is not a thing a test can do — and this is the one branch
    // in the app that can destroy a student's own work if it is wrong.
    __applyFeedForTest: applyFeed
  };

  // No startup check is scheduled here. 01-catalogue.js already downloads the
  // very same plans.json to build the catalogue and hands the parsed feed to
  // checkForUpdates() the moment it lands, so a second listener on window load
  // only raced it into re-downloading the file. If that download fails there is
  // nothing to retry either — it is the same URL.
})();
