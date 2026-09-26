// ==========================
// IMPORTED PLANS (structured renderer)
// ==========================
// A custom plan now registers through window.__registerPlanData(), the
// exact same bridge each built-in major uses — so once its courses render
// as real .course[id] elements inside real .course-row[id] semester
// containers, GPA, Degree Audit, Achievements, the AI Advisor, and the
// drag-and-drop Plan Editor all work on it unmodified. No SVG prerequisite
// diagram (that stays a built-in-major thing — see the Plan Editor's own
// banner for why), but everything else is the real thing, not a mockup.
//
// Backward compatible: a plan imported before this update (raw JSON paste,
// free-text `semester` labels, no `structure`) still renders through the
// original simple grouped-list view further down in this file.
(function(){
  var ICONS = ['🤖','🔒','⚕️','💻','📊','🔬','🎨','📚','⚙️','🌐'];
  // The whole view re-renders (host.innerHTML = ...) on every interaction —
  // checkbox toggle, course add, drag — so anything that would normally
  // live as a DOM class (rtl-mode, legend expanded) has to be tracked here
  // instead, or it silently resets on the very next render.
  // Language is one app-wide setting now (js/09-language.js), not a per-plan
  // one held in memory: switching to Arabic on one plan used to leave the
  // next plan, the menu, and everything after a reload in English.
  function isAr(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  var currentOpenPlanId = null;

  // Every one of the ~55 readers below assumes each value here is a plan
  // OBJECT. A single null (or number, or string) entry — which an import, a
  // half-written sync, or a student poking at localStorage can produce — threw
  // "Cannot read properties of null (reading 'university')" out of the home
  // screen's plan walk and took the ENTIRE card grid with it: every other
  // perfectly valid plan disappeared because of one bad sibling. Dropping the
  // unusable entries here, at the single point they are all read from, keeps
  // one corrupt record from costing a student every plan they have.
  function loadImportedPlans(){
    var raw = window.AAUP_STORAGE.getJSON('aaup_importedPlans', {});
    var out = {};
    Object.keys(raw).forEach(function(id){
      var p = raw[id];
      if(p && typeof p === 'object' && !Array.isArray(p)) out[id] = p;
    });
    return out;
  }
  function saveImportedPlans(m){ window.AAUP_STORAGE.setJSON('aaup_importedPlans', m); plansChanged(); }

  // Old plans stored majorName.en as a plain string; new ones store
  // {big, small} to match the built-in cards' two-tone title. Reading
  // through this helper means both shapes display correctly everywhere.
  function nameParts(field){
    if(field && typeof field === 'object'){ return { big: field.big || '', small: field.small || '' }; }
    return { big: field || '', small: '' };
  }
  function hasStructure(p){ return !!(p.structure && Array.isArray(p.structure.years) && p.structure.years.length); }

  // Plan strings are sanitized on the way IN — on import, on sync, and again
  // for every stored plan at boot (see the pass at the bottom of this file).
  // These two escape them again on the way OUT, so a plan that reaches
  // storage through some path that skips the sanitizer still cannot put
  // markup on the page. __cleanText is idempotent, so already-clean text
  // renders byte-identical and nothing double-escapes.
  //
  // This is not theoretical: writing a majorName of
  // "<img src=x onerror=…>" straight into storage and redrawing the old
  // home page's plan cards ran the handler, because the card wrote the name into
  // innerHTML raw. It survived only until the next boot re-sanitized it —
  // one page load is plenty.
  function txt(s){
    var v = String(s == null ? '' : s);
    return window.__cleanText ? window.__cleanText(v) : v;
  }
  // A plan id lands inside a JS string inside an HTML attribute, so it needs
  // both escapes: backslash and quote for the JS layer, then HTML for the
  // attribute the browser decodes first.


  // Where a plan sits among its faculty's tiles. Empty means unplaced, not
  // zero — zero is a real position that would move the plan to the front.
  function sortOrderOf(p){
    var v = p && p.sortOrder;
    if(v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  // Plans the admin has placed come first, in that order; everything else
  // follows alphabetically. Mirrors the same comparator in the admin Worker
  // and the catalogue build, so all three agree on what students see.
  function compareByDisplayOrder(a, b){
    var ao = sortOrderOf(a), bo = sortOrderOf(b);
    if(ao !== null && bo !== null && ao !== bo) return ao - bo;
    if(ao !== null && bo === null) return -1;
    if(ao === null && bo !== null) return 1;
    return nameParts((a && a.majorName && a.majorName.en) || '').big
      .localeCompare(nameParts((b && b.majorName && b.majorName.en) || '').big);
  }

  function collegeKeyForPlan(p){
    var uniId = p.university || 'aaup';
    // A published plan carries its college's id. Prefer it: matching on the
    // display name breaks the moment a faculty is renamed, and an unmatched
    // name silently dumps the plan into "Other / Community".
    if(p.collegeId && (window.APP_COLLEGES || {})[p.collegeId]) return p.collegeId;
    var enText = ((p.college && p.college.en) || '').trim().toLowerCase();
    var arText = ((p.college && p.college.ar) || '').trim();
    if(enText || arText){
      var regId = Object.keys(window.APP_COLLEGES || {}).filter(function(cid){
        var c = window.APP_COLLEGES[cid];
        if(c.university !== uniId) return false;
        return (enText && (c.name.en || '').trim().toLowerCase() === enText) ||
               (arText && (c.name.ar || '').trim() === arText);
      })[0];
      if(regId) return regId;
      return 'custom:' + uniId + ':' + (enText || arText).replace(/\s+/g, '-');
    }
    return 'custom:' + uniId + ':unspecified';
  }

  // Tapping a plan whose courses are not in yet: say why, rather than opening
  // an empty grid or silently doing nothing.
  function notePending(id){
    var rtl = window.__anyVisiblePageIsRtl ? window.__anyVisiblePageIsRtl() : false;
    if(window.AAUP_CONTRIBUTE && id){
      window.AAUP_CONTRIBUTE.offerToHelp(id);
      return;
    }
    if(window.__showToast){
      window.__showToast(rtl
        ? '\u23f3 هذه الخطة منشورة لكن مساقاتها لم تُدخل بعد.'
        : '\u23f3 This programme is published, but its course list has not been added yet.');
    }
  }

  // The set of plans changed — one was saved or deleted, or the catalogue
  // synced. Screens that list plans (the home and its major picker) listen
  // for this event rather than being called by name; the catalogue loading
  // fires the same one (js/01-catalogue.js).
  function plansChanged(){
    try{ window.dispatchEvent(new window.Event('aaup:plans')); }catch(e){}
  }

  // ---------- registering a plan so every shared feature module can see it ----------
  // ---------- transitive reduction on a chosen prerequisite set ----------
  // If someone checks both "Calculus I" and "Calculus II" as prerequisites,
  // and Calculus II already needs Calculus I, drawing a direct arrow from
  // BOTH is redundant — completing Calculus II already implies Calculus I
  // is done. Keep only the "closest" one(s): any selected course that is
  // itself a (direct or transitive) prerequisite of another selected
  // course gets dropped from the direct-edge set.
  // Same two traps as __registerPlanData in 02-shared-cross.js: `pairs` may not
  // be an array at all, and a course slug of "constructor"/"__proto__"/
  // "toString" collides with an inherited name on a plain {} map, so
  // `needs[b] || []` hands back a function and .push() throws.
  function computeNeedsFromPairs(pairs){
    var needs = Object.create(null);
    (Array.isArray(pairs) ? pairs : []).forEach(function(pair){
      if(!pair || typeof pair !== 'object') return;
      var a = pair[0], b = pair[1];
      if(typeof a !== 'string' || typeof b !== 'string' || !a || !b) return;
      (needs[b] = needs[b] || []).push(a);
    });
    return needs;
  }
  function isAncestorOf(needsMap, ancestor, node, visited){
    visited = visited || {};
    if(visited[node]) return false; // cycle guard
    visited[node] = true;
    var direct = needsMap[node] || [];
    if(direct.indexOf(ancestor) !== -1) return true;
    return direct.some(function(n){ return isAncestorOf(needsMap, ancestor, n, visited); });
  }
  function reduceToDirectPrereqs(selectedSlugs, needsMap){
    return selectedSlugs.filter(function(candidate){
      return !selectedSlugs.some(function(other){
        return other !== candidate && isAncestorOf(needsMap, candidate, other);
      });
    });
  }

  // ---------- cross-plan auto-linking ----------
  // The same real course (same id) can exist in several plans, since it's
  // the same university offering it. If two courses that are ALREADY
  // linked as prerequisite/dependent somewhere else both happen to exist
  // in THIS plan too, that same link should exist here automatically —
  // nobody should have to manually re-declare "Calculus II needs Calculus
  // I" in every single plan that happens to include both.
  //
  // This only ever looks at courses already present in this plan; it
  // never pulls in a course from elsewhere on its own. And it's re-run
  // from scratch on every add/edit rather than trying to track "was this
  // link auto-generated" indefinitely — simpler, and self-correcting: if
  // an edit changes a course's identity enough that it no longer matches
  // anything, the stale auto-link just isn't regenerated.
  function normalizeName(s){ return String(s || '').trim().toLowerCase(); }

  function findAllOtherPlansData(){
    // {prefix: {courseInfo, prereqs}} for every built-in major (already
    // registered) plus every OTHER imported plan (registered on demand,
    // same as the Course Library does, so a plan nobody has opened this
    // session still counts).
    var out = {};
    Object.keys(window.__PLAN_DATA || {}).forEach(function(prefix){ out[prefix] = window.__PLAN_DATA[prefix]; });
    var imported = loadImportedPlans();
    Object.keys(imported).forEach(function(pid){
      if(out[pid]) return;
      if(hasStructure(imported[pid])){
        var info = buildCourseInfo(imported[pid]);
        var needsMap = computeNeedsFromPairs(imported[pid].prerequisites);
        out[pid] = { courseInfo: info, prereqs: imported[pid].prerequisites || [], needsMap: needsMap };
      }
    });
    return out;
  }

  function runAutoLink(planId, slug){
    var plans = loadImportedPlans();
    var p = plans[planId];
    if(!p) return;
    var course = (p.courses || []).filter(function(c){ return c.id === slug; })[0];
    if(!course) return;

    // 1. Undo any PREVIOUS auto-link involving this course — the
    // situation may have changed (an edit, a removal elsewhere) since it
    // was last computed.
    p.autoLinkedPairs = p.autoLinkedPairs || [];
    p.autoLinkedPairs = p.autoLinkedPairs.filter(function(key){
      var parts = key.split('__');
      if(parts[0] === slug || parts[1] === slug){
        p.prerequisites = (p.prerequisites || []).filter(function(pair){
          return !(pair[0] === parts[0] && pair[1] === parts[1]);
        });
        return false;
      }
      return true;
    });

    // 2. Find every prerequisite relationship elsewhere involving a
    // course with this exact id.
    var others = findAllOtherPlansData();
    var candidates = []; // {otherId, direction}
    Object.keys(others).forEach(function(otherPrefix){
      var data = others[otherPrefix];
      (data.prereqs || []).forEach(function(pair){
        if(pair[0] === slug && pair[1] !== slug){ candidates.push({ otherId: pair[1], direction: 'unlocks', srcPrefix: otherPrefix }); }
        if(pair[1] === slug && pair[0] !== slug){ candidates.push({ otherId: pair[0], direction: 'needs', srcPrefix: otherPrefix }); }
      });
    });

    // 3. Only act on a candidate if a course with that SAME id (AND a
    // matching name — the "only if every piece of information matches"
    // safety net) already exists in THIS plan.
    candidates.forEach(function(cand){
      var localOther = (p.courses || []).filter(function(c){ return c.id === cand.otherId; })[0];
      if(!localOther) return;
      var srcInfo = (others[cand.srcPrefix].courseInfo || {})[cand.otherId];
      if(srcInfo && normalizeName(srcInfo.name) !== normalizeName(localOther.name)) return; // names disagree — treat as a different course despite the shared id

      var a = cand.direction === 'needs' ? cand.otherId : slug;
      var b = cand.direction === 'needs' ? slug : cand.otherId;
      var existingNeeds = computeNeedsFromPairs(p.prerequisites);
      // Skip if already linked (directly or transitively) either way —
      // covers "already linked" and "would create a cycle".
      if(isAncestorOf(existingNeeds, a, b) || isAncestorOf(existingNeeds, b, a)) return;
      var key = a + '__' + b;
      if(p.autoLinkedPairs.indexOf(key) !== -1) return;
      p.prerequisites.push([a, b]);
      p.autoLinkedPairs.push(key);
    });

    saveImportedPlans(plans);
  }

  function buildCourseInfo(plan){
    var info = {};
    (plan.courses || []).forEach(function(c){
      info[c.id] = {
        // A course's real catalog code can arrive as either "num" (an older
        // field name still accepted for backward compatibility) or
        // "courseNumber" (the field the plans feed's documented schema and
        // every plan built this session actually use) — without this
        // fallback, every course popup showed "-" instead of its real code
        // even when the plan data had one.
        num: c.num || c.courseNumber || '-', name: c.name, th: '-', pr: '-',
        cr: String(c.creditHours != null ? c.creditHours : 0),
        // The university's requirement bucket for this course, when the
        // published plan says which one it is. Empty for a major no published
        // plan covers; readers fall back to guessing from the visual category.
        req: c.requirement || '',
        prereq: '-', ar: c.ar || c.name
      };
    });
    return info;
  }
  function registerPlan(id, plan){
    if(window.__registerPlanData){
      window.__registerPlanData(id, buildCourseInfo(plan), plan.prerequisites || [],
                                { requirementHours: plan.requirementHours || {} });
    }
  }

  // ---------- progress (shares the SAME storage + object as every built-in major) ----------
  function fullId(planId, slug){ return planId + '-c-' + slug; }
  function isDone(planId, slug){
    var progress = window.__getProgress ? window.__getProgress() : {};
    return !!progress[fullId(planId, slug)];
  }
  function persistProgress(){
    if(!window.__PROGRESS_STORAGE_KEY) return;
    try{ localStorage.setItem(window.__PROGRESS_STORAGE_KEY, JSON.stringify(window.__getProgress())); }catch(e){}
  }
  function isAvailable(planId, slug){
    var data = window.__PLAN_DATA[planId] || {};
    var needs = (data.needsMap && data.needsMap[slug]) || [];
    return needs.every(function(r){ return isDone(planId, r); });
  }
  function toggleCourse(planId, slug){
    var progress = window.__getProgress ? window.__getProgress() : {};
    var data = window.__PLAN_DATA[planId] || {};
    var id = fullId(planId, slug);
    if(progress[id]){
      delete progress[id];
      // Cascade-uncheck: nothing that directly needed this can still count
      // as done once its own prerequisite is undone — same rule the
      // built-in majors already enforce.
      (function cascade(s){
        var deps = (data.unlocksMap && data.unlocksMap[s]) || [];
        deps.forEach(function(d){
          var did = fullId(planId, d);
          if(progress[did]){ delete progress[did]; cascade(d); }
        });
      })(slug);
    } else if(isAvailable(planId, slug)){
      progress[id] = true;
    }
    persistProgress();
  }

  // ---------- structure editing (add/remove year, add/remove summer) ----------
  function yearCourseCount(plan, yearId, semester){
    return (plan.courses || []).filter(function(c){
      return c.yearId === yearId && (semester ? c.semester === semester : true);
    }).length;
  }
  function withPlan(planId, fn){
    var plans = loadImportedPlans();
    var p = plans[planId];
    if(!p) return;
    fn(p, plans);
  }
  function addYear(planId){
    withPlan(planId, function(p, plans){
      var n = p.structure.years.length + 1;
      p.structure.years.push({ id: 'y' + n, hasSummer: false });
      saveImportedPlans(plans);
      render(planId);
    });
  }
  function removeYear(planId, yearId){
    withPlan(planId, function(p, plans){
      if(yearCourseCount(p, yearId) > 0){
        if(window.__showToast){ window.__showToast('Year not empty — move its courses first'); }
        return;
      }
      p.structure.years = p.structure.years.filter(function(y){ return y.id !== yearId; });
      saveImportedPlans(plans);
      render(planId);
    });
  }
  function addSummer(planId, yearId){
    withPlan(planId, function(p, plans){
      var y = p.structure.years.filter(function(yy){ return yy.id === yearId; })[0];
      if(!y) return;
      y.hasSummer = true;
      saveImportedPlans(plans);
      render(planId);
    });
  }
  function removeSummer(planId, yearId){
    withPlan(planId, function(p, plans){
      if(yearCourseCount(p, yearId, 's3') > 0){
        if(window.__showToast){ window.__showToast('Summer not empty — move its courses first'); }
        return;
      }
      var y = p.structure.years.filter(function(yy){ return yy.id === yearId; })[0];
      if(!y) return;
      y.hasSummer = false;
      saveImportedPlans(plans);
      render(planId);
    });
  }

  // ---------- adding a course (form popup, reachable from a "+" card
  // sitting directly inside the semester it will be added to — so where it
  // lands never has to be typed or remembered, just clicked) ----------
  // ---------- removing a course ----------
  function confirmRemoveCourse(planId, slug){
    var plans = loadImportedPlans();
    var p = plans[planId];
    if(!p) return;
    var course = (p.courses || []).filter(function(c){ return c.id === slug; })[0];
    if(!course) return;
    var dependents = (p.prerequisites || []).filter(function(pair){ return pair[0] === slug; }).map(function(pair){ return pair[1]; });
    var dependentNames = dependents.map(function(depSlug){
      var d = (p.courses || []).filter(function(c){ return c.id === depSlug; })[0];
      return d ? d.name : depSlug;
    });
    var msg = 'Remove "' + course.name + '"?' +
      (dependentNames.length ? ' ' + dependentNames.join(', ') + ' currently need it — that prerequisite link will be removed too, not the courses themselves.' : '') +
      ' This can\u2019t be undone.';
    if(window.__showConfirmDialog){
      window.__showConfirmDialog(msg, function(){ removeCourse(planId, slug); });
    } else if(window.confirm(msg)){
      removeCourse(planId, slug);
    }
  }
  function removeCourse(planId, slug){
    var plans = loadImportedPlans();
    var p = plans[planId];
    if(!p) return;
    var name = ((p.courses || []).filter(function(c){ return c.id === slug; })[0] || {}).name || slug;
    p.courses = (p.courses || []).filter(function(c){ return c.id !== slug; });
    // Cascade-clean prerequisite pairs in BOTH directions — otherwise a
    // removed course leaves dangling references (as something's stated
    // prerequisite, or requiring a prerequisite that no longer exists).
    p.prerequisites = (p.prerequisites || []).filter(function(pair){ return pair[0] !== slug && pair[1] !== slug; });
    saveImportedPlans(plans);
    var progress = window.__getProgress ? window.__getProgress() : {};
    delete progress[planId + '-c-' + slug];
    persistProgress();
    if(window.__showToast){ window.__showToast('Removed "' + name + '".'); }
    render(planId);
  }

  // ---------- duplicate detection ----------
  // Catches the "same real course, entered slightly differently" case —
  // e.g. typing "Calculus-1" as an ID when it's already known as "calc-1",
  // or "Calculus 1" as a name when it's registered as "Calculus I". The
  // official course NUMBER (when given) is the most reliable signal, per
  // the reasoning that two different course codes are never the same
  // course — name/ID matching is a fuzzier, secondary check.
  function normalizeForMatch(s){
    var t = String(s || '').trim().toLowerCase();
    t = t.replace(/\b(i|ii|iii|iv|v)\s*$/i, function(m){
      var map = { i: '1', ii: '2', iii: '3', iv: '4', v: '5' };
      return map[m.trim().toLowerCase()] || m;
    });
    return t.replace(/[^a-z0-9]/g, '');
  }
  function findDuplicateCandidate(nameEn, courseNumber, courseId){
    var known = allKnownCourses();
    if(courseNumber){
      var byNum = known.filter(function(k){ return k.num && k.num !== '-' && k.num === courseNumber; })[0];
      if(byNum) return byNum;
    }
    var byId = known.filter(function(k){ return k.slug === courseId; })[0];
    if(byId) return byId;
    var normTarget = normalizeForMatch(nameEn);
    if(normTarget){
      var byName = known.filter(function(k){ return normalizeForMatch(k.name) === normTarget; })[0];
      if(byName) return byName;
    }
    return null;
  }

  function openCourseCreatePopup(planId, yearId, semester){
    var overlay = document.getElementById('devModalOverlay');
    var body = document.getElementById('devModalBody');
    if(!overlay || !body) return;
    var plans = loadImportedPlans();
    var plan = plans[planId];
    if(!plan) return;
    var rtl = isAr();

    var courseOptions = (plan.courses || []).map(function(c){
      return '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;margin-bottom:5px;">' +
        '<input type="checkbox" value="' + c.id + '" class="ncq-prereq-check"> ' + window.__escapeHtml(rtl && c.ar ? c.ar : c.name) + '</label>';
    }).join('') || '<p class="ex-note">' + (rtl ? 'لا توجد مساقات أخرى بعد \u2014 سيكون هذا الأول.' : 'No other courses yet \u2014 this will be the first one.') + '</p>';

    var categories = ['core','math','dept','eng','uni','free','skills'];
    var categoryLabels = rtl
      ? { core:'إجباري', math:'رياضيات', dept:'اختياري تخصصي', eng:'إنجليزي', uni:'اختياري جامعي', free:'اختياري حر', skills:'متطلب جامعي' }
      : { core:'Core', math:'Math', dept:'Department Elective', eng:'English', uni:'University Elective', free:'Free Elective', skills:'University Requirement' };

    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    body.innerHTML =
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('plus', 20) + (rtl ? 'إضافة مساق' : 'Add Course') + '</h2>' +
      '<div class="form-field-row">' +
        '<div class="form-field"><label for="ncqNameEn">' + (rtl ? 'الاسم (بالإنجليزية)' : 'Name (English)') + '</label><input type="text" id="ncqNameEn" maxlength="80"></div>' +
        '<div class="form-field"><label for="ncqNameAr">' + (rtl ? 'الاسم (بالعربية)' : 'Name (Arabic)') + '</label><input type="text" id="ncqNameAr" maxlength="80"></div>' +
      '</div>' +
      '<div class="form-field-row">' +
        '<div class="form-field"><label for="ncqId">' + (rtl ? 'معرّف المساق' : 'Course ID') + '</label><input type="text" id="ncqId" maxlength="40" placeholder="e.g. intro-stats"></div>' +
        '<div class="form-field"><label for="ncqCredits">' + (rtl ? 'الساعات المعتمدة' : 'Credit Hours') + '</label><input type="number" id="ncqCredits" min="0" step="0.5" value="3"></div>' +
      '</div>' +
      '<div class="form-field-row">' +
        '<div class="form-field"><label for="ncqNumber">' + (rtl ? 'رقم المساق (اختياري)' : 'Course Number (optional)') + '</label><input type="text" id="ncqNumber" maxlength="20" placeholder="e.g. 100411010"></div>' +
        '<div class="form-field"><label for="ncqCategory">' + (rtl ? 'الفئة' : 'Category') + '</label><select id="ncqCategory">' +
          categories.map(function(c){ return '<option value="' + c + '">' + categoryLabels[c] + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<p class="form-note">' + (rtl ? 'رقم المساق هو أفضل طريقة لمعرفة ما إذا كان هذا نفس المساق الموجود في مكان آخر \u2014 أدخله إن كنت تعرفه.' : 'The course number is the most reliable way to tell whether this is the same course as one that already exists elsewhere \u2014 fill it in if you know it.') + '</p>' +
      '<div class="form-field"><label>' + (rtl ? 'المتطلبات السابقة (اختياري)' : 'Prerequisites (optional)') + '</label>' +
      '<div style="max-height:140px;overflow-y:auto;background:var(--search-bg);border:1px solid var(--line);border-radius:8px;padding:8px;">' + courseOptions + '</div></div>' +
      '<div class="form-actions"><button type="button" class="home-btn" id="ncqCancel">' + (rtl ? 'إلغاء' : 'Cancel') + '</button>' +
      '<button type="button" class="home-btn" id="ncqCreate" style="border-color:var(--accent);color:var(--text);">' + (rtl ? 'إضافة المساق' : 'Add Course') + '</button></div>' +
      '<div id="ncqMsg"></div>';
    overlay.classList.add('open');

    document.getElementById('ncqCancel').addEventListener('click', function(){ overlay.classList.remove('open'); });
    document.getElementById('ncqCreate').addEventListener('click', function(){
      // __cleanText, not raw: these names go straight into innerHTML-built
      // course cards, popups and the Course Library — typing markup here
      // (or pasting it from somewhere) must render as text, not run.
      var nameEn = window.__cleanText(document.getElementById('ncqNameEn').value.trim());
      var nameAr = window.__cleanText(document.getElementById('ncqNameAr').value.trim());
      var id = document.getElementById('ncqId').value.trim();
      var credits = parseFloat(document.getElementById('ncqCredits').value);
      var category = document.getElementById('ncqCategory').value;
      var courseNumber = window.__cleanText(document.getElementById('ncqNumber').value.trim());
      var msg = document.getElementById('ncqMsg');

      if(!nameEn || !nameAr || !id || isNaN(credits)){
        msg.innerHTML = '<p class="dev-error-msg">' + (rtl ? 'يرجى إدخال الاسم (باللغتين) والمعرّف والساعات المعتمدة.' : 'Please fill in the name (both languages), an ID, and credit hours.') + '</p>';
        return;
      }
      if(!/^[a-z0-9-]+$/.test(id)){
        msg.innerHTML = '<p class="dev-error-msg">' + (rtl ? 'معرّف المساق يمكن أن يحتوي فقط على أحرف إنجليزية صغيرة وأرقام وشرطات.' : 'Course ID can only use lowercase letters, numbers, and hyphens.') + '</p>';
        return;
      }
      var plansNow = loadImportedPlans();
      var p = plansNow[planId];
      if((p.courses || []).some(function(c){ return c.id === id; })){
        msg.innerHTML = '<p class="dev-error-msg">' + (rtl ? 'يوجد مساق بهذا المعرّف بالفعل في هذه الخطة.' : 'A course with that ID already exists in this plan.') + '</p>';
        return;
      }

      var prereqIds = Array.prototype.slice.call(document.querySelectorAll('.ncq-prereq-check:checked')).map(function(cb){ return cb.value; });
      var candidate = findDuplicateCandidate(nameEn, courseNumber, id);
      if(candidate && candidate.name){
        var question = (rtl ? ('يبدو أن هذا قد يكون "' + candidate.name + '"' + (candidate.num && candidate.num !== '-' ? ' (' + candidate.num + ')' : '') + '. هل تريد استخدام تلك التفاصيل بالضبط ليرتبط بشكل صحيح مع نفس المساق في أماكن أخرى؟') : ('This looks like it might already be "' + candidate.name + '"' + (candidate.num && candidate.num !== '-' ? ' (' + candidate.num + ')' : '') + '. Use those exact details instead, so it links up correctly with the same course elsewhere?'));
        if(window.__showConfirmDialog){
          window.__showConfirmDialog(question, function(){
            finalizeCourseCreation(planId, yearId, semester, candidate.name, candidate.ar || nameAr, candidate.slug, parseFloat(candidate.cr) || credits, category, prereqIds, overlay);
          }, false, function(){
            finalizeCourseCreation(planId, yearId, semester, nameEn, nameAr, id, credits, category, prereqIds, overlay);
          });
          return;
        }
      }
      finalizeCourseCreation(planId, yearId, semester, nameEn, nameAr, id, credits, category, prereqIds, overlay);
    });
  }

  function finalizeCourseCreation(planId, yearId, semester, nameEn, nameAr, id, credits, category, prereqIds, overlay){
    var plansNow = loadImportedPlans();
    var p = plansNow[planId];
    if((p.courses || []).some(function(c){ return c.id === id; })){
      if(window.__showToast){ window.__showToast('A course with that ID already exists in this plan.'); }
      return;
    }
    p.courses.push({ id: id, name: nameEn, ar: nameAr, creditHours: credits, category: category, yearId: yearId, semester: semester });
    p.wasEdited = true;
    p.prerequisites = p.prerequisites || [];
    // Only draw a direct arrow from whichever selected prereqs are NOT
    // themselves already implied by another selected prereq (see the
    // transitive-reduction helpers above) — e.g. picking both Calculus I
    // and Calculus II only draws one arrow, from Calculus II.
    var existingNeeds = computeNeedsFromPairs(p.prerequisites);
    var directPrereqIds = reduceToDirectPrereqs(prereqIds, existingNeeds);
    directPrereqIds.forEach(function(reqId){ p.prerequisites.push([reqId, id]); });
    saveImportedPlans(plansNow);
    runAutoLink(planId, id);
    if(overlay){ overlay.classList.remove('open'); }
    if(window.__showToast){ window.__showToast('Added "' + nameEn + '"'); }
    render(planId);
  }

  function openCourseEditPopup(planId, slug){
    var overlay = document.getElementById('devModalOverlay');
    var body = document.getElementById('devModalBody');
    if(!overlay || !body) return;
    var plans = loadImportedPlans();
    var plan = plans[planId];
    if(!plan) return;
    var course = (plan.courses || []).filter(function(c){ return c.id === slug; })[0];
    if(!course) return;

    var currentNeeds = (plan.prerequisites || []).filter(function(pair){ return pair[1] === slug; }).map(function(pair){ return pair[0]; });
    var courseOptions = (plan.courses || []).filter(function(c){ return c.id !== slug; }).map(function(c){
      var checked = currentNeeds.indexOf(c.id) !== -1 ? ' checked' : '';
      return '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;margin-bottom:5px;">' +
        '<input type="checkbox" value="' + c.id + '" class="ecq-prereq-check"' + checked + '> ' + window.__escapeHtml((isAr() && c.ar) ? c.ar : c.name) + '</label>';
    }).join('') || '<p class="ex-note">' + (isAr() ? 'لا توجد مساقات أخرى لاشتراطها.' : 'No other courses to require.') + '</p>';

    var rtl = isAr();
    var categories = ['core','math','dept','eng','uni','free','skills'];
    var categoryLabels = rtl
      ? { core:'إجباري', math:'رياضيات', dept:'اختياري تخصصي', eng:'إنجليزي', uni:'اختياري جامعي', free:'اختياري حر', skills:'متطلب جامعي' }
      : { core:'Core', math:'Math', dept:'Department Elective', eng:'English', uni:'University Elective', free:'Free Elective', skills:'University Requirement' };

    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    body.innerHTML =
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('pen', 20) + (rtl ? 'تعديل المساق' : 'Edit Course') + '</h2>' +
      '<div class="form-field-row">' +
        '<div class="form-field"><label for="ecqNameEn">' + (rtl ? 'الاسم (بالإنجليزية)' : 'Name (English)') + '</label><input type="text" id="ecqNameEn" maxlength="80" value="' + course.name.replace(/"/g, '&quot;') + '"></div>' +
        '<div class="form-field"><label for="ecqNameAr">' + (rtl ? 'الاسم (بالعربية)' : 'Name (Arabic)') + '</label><input type="text" id="ecqNameAr" maxlength="80" value="' + (course.ar || '').replace(/"/g, '&quot;') + '"></div>' +
      '</div>' +
      '<div class="form-field-row">' +
        '<div class="form-field"><label for="ecqId">' + (rtl ? 'معرّف المساق' : 'Course ID') + '</label><input type="text" id="ecqId" maxlength="40" value="' + course.id + '"></div>' +
        '<div class="form-field"><label for="ecqCredits">' + (rtl ? 'الساعات المعتمدة' : 'Credit Hours') + '</label><input type="number" id="ecqCredits" min="0" step="0.5" value="' + course.creditHours + '"></div>' +
      '</div>' +
      '<div class="form-field"><label for="ecqCategory">' + (rtl ? 'الفئة' : 'Category') + '</label><select id="ecqCategory">' +
        categories.map(function(c){ return '<option value="' + c + '"' + (c === course.category ? ' selected' : '') + '>' + categoryLabels[c] + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="form-field"><label>' + (rtl ? 'المتطلبات السابقة' : 'Prerequisites') + '</label>' +
      '<div style="max-height:140px;overflow-y:auto;background:var(--search-bg);border:1px solid var(--line);border-radius:8px;padding:8px;">' + courseOptions + '</div></div>' +
      '<p class="form-note">' + (rtl ? 'تغيير الاسم أو المعرّف أو الساعات أو الفئة قد يعني أن هذا المساق لن يرتبط تلقائيًا بالمساقات المطابقة في الخطط الأخرى كما كان \u2014 سيُعاد فحصه وفق التفاصيل الجديدة.' : 'Changing the name, ID, credit hours, or category means this may no longer automatically link to matching courses in other plans the way it used to \u2014 it\u2019ll be re-checked against whatever the new details actually match.') + '</p>' +
      '<div class="form-actions"><button type="button" class="home-btn" id="ecqCancel">' + (rtl ? 'إلغاء' : 'Cancel') + '</button>' +
      '<button type="button" class="home-btn" id="ecqSave" style="border-color:var(--accent);color:var(--text);">' + (rtl ? 'حفظ التغييرات' : 'Save Changes') + '</button></div>' +
      '<div id="ecqMsg"></div>';
    overlay.classList.add('open');

    document.getElementById('ecqCancel').addEventListener('click', function(){ overlay.classList.remove('open'); });
    document.getElementById('ecqSave').addEventListener('click', function(){
      // Same reason as the Add Course form: these strings feed innerHTML.
      var nameEn = window.__cleanText(document.getElementById('ecqNameEn').value.trim());
      var nameAr = window.__cleanText(document.getElementById('ecqNameAr').value.trim());
      var newId = document.getElementById('ecqId').value.trim();
      var credits = parseFloat(document.getElementById('ecqCredits').value);
      var category = document.getElementById('ecqCategory').value;
      var msg = document.getElementById('ecqMsg');

      if(!nameEn || !nameAr || !newId || isNaN(credits)){
        msg.innerHTML = '<p class="dev-error-msg">' + (rtl ? 'يرجى إدخال الاسم (باللغتين) والمعرّف والساعات المعتمدة.' : 'Please fill in the name (both languages), an ID, and credit hours.') + '</p>';
        return;
      }
      if(!/^[a-z0-9-]+$/.test(newId)){
        msg.innerHTML = '<p class="dev-error-msg">' + (rtl ? 'معرّف المساق يمكن أن يحتوي فقط على أحرف إنجليزية صغيرة وأرقام وشرطات.' : 'Course ID can only use lowercase letters, numbers, and hyphens.') + '</p>';
        return;
      }
      var plansNow = loadImportedPlans();
      var p = plansNow[planId];
      var target = (p.courses || []).filter(function(c){ return c.id === slug; })[0];
      if(!target) return;
      if(newId !== slug && (p.courses || []).some(function(c){ return c.id === newId; })){
        msg.innerHTML = '<p class="dev-error-msg">' + (rtl ? 'مساق آخر يستخدم هذا المعرّف بالفعل.' : 'Another course already uses that ID.') + '</p>';
        return;
      }

      var idChanged = newId !== slug;
      target.name = nameEn; target.ar = nameAr; target.creditHours = credits; target.category = category;

      // Renaming the id means every reference to the OLD id has to move
      // to the new one, or prerequisite pairs and progress would point at
      // something that no longer exists.
      if(idChanged){
        target.id = newId;
        p.prerequisites = (p.prerequisites || []).map(function(pair){
          return [pair[0] === slug ? newId : pair[0], pair[1] === slug ? newId : pair[1]];
        });
        p.autoLinkedPairs = (p.autoLinkedPairs || []).map(function(key){
          var parts = key.split('__');
          return (parts[0] === slug ? newId : parts[0]) + '__' + (parts[1] === slug ? newId : parts[1]);
        });
        var progress = window.__getProgress ? window.__getProgress() : {};
        if(progress[planId + '-c-' + slug] !== undefined){
          progress[planId + '-c-' + newId] = progress[planId + '-c-' + slug];
          delete progress[planId + '-c-' + slug];
          persistProgress();
        }
      }

      // Fully re-derive this course's DIRECT prerequisites from the
      // current checkbox state, rather than trying to patch the old set —
      // simpler, and correctly drops anything that's no longer checked.
      p.prerequisites = (p.prerequisites || []).filter(function(pair){ return pair[1] !== newId; });
      var checkedIds = Array.prototype.slice.call(document.querySelectorAll('.ecq-prereq-check:checked')).map(function(cb){ return cb.value; });
      var needsNow = computeNeedsFromPairs(p.prerequisites);
      var directIds = reduceToDirectPrereqs(checkedIds, needsNow);
      directIds.forEach(function(reqId){ p.prerequisites.push([reqId, newId]); });

      saveImportedPlans(plansNow);
      runAutoLink(planId, newId);
      overlay.classList.remove('open');
      if(window.__showToast){ window.__showToast('Saved changes to "' + nameEn + '"'); }
      render(planId);
    });
  }

  // ---------- rendering ----------
  var SEMESTER_LABEL = { s1: 'First Semester', s2: 'Second Semester', s3: 'Summer' };

  var SEMESTER_LABEL_AR = { s1: 'الفصل الأول', s2: 'الفصل الثاني', s3: 'الصيفي' };

  // ---------- prerequisite connector lines (generic version of each
  // built-in major's hand-written draw()/bindHover() — those stay hardcoded
  // per major on purpose (see the Plan Editor's banner comment on why),
  // but an imported plan's course set changes at runtime and there can be
  // arbitrarily many of them, so this one has to be a real parameterized
  // function rather than a copy-pasted block per plan. ----------
  var NS = 'http://www.w3.org/2000/svg';
  // Takes already-measured rects (see drawConnectors), so all the reads can
  // be batched before any DOM write instead of thrashing layout per pair.
  function pathBetweenGeneric(f, t, cRect){
    var x1 = f.left - cRect.left + f.width / 2;
    var y1 = f.top - cRect.top + f.height;
    var x2 = t.left - cRect.left + t.width / 2;
    var y2 = t.top - cRect.top;
    var dy = Math.max(28, (y2 - y1) / 2);
    return 'M' + x1.toFixed(1) + ',' + y1.toFixed(1) +
      ' C' + x1.toFixed(1) + ',' + (y1 + dy).toFixed(1) +
      ' ' + x2.toFixed(1) + ',' + (y2 - dy).toFixed(1) +
      ' ' + x2.toFixed(1) + ',' + y2.toFixed(1);
  }
  function initSearch(planId){
    var input = document.getElementById(planId + '-courseSearchInput');
    if(!input || !window.__buildCourseIndex || !window.__attachSearch) return;
    window.__buildCourseIndex(planId); // rebuilt fresh every render, so a just-added course is searchable immediately
    window.__attachSearch({
      input: input,
      box: document.getElementById(planId + '-courseSearchBox'),
      clear: document.getElementById(planId + '-courseSearchClear'),
      dropdown: document.getElementById(planId + '-courseSearchDropdown'),
      getIndex: function(){ return (window.__PLAN_DATA[planId] && window.__PLAN_DATA[planId].index) || []; },
      emptyText: 'No matching course found / لا يوجد مساق مطابق',
      onSelect: function(r){
        input.value = '';
        document.getElementById(planId + '-courseSearchBox').classList.remove('has-value');
        // Same reasoning as the built-in-major search wiring in 03-search.js:
        // a search result now opens the interactive prerequisite map instead
        // of the old scroll-to-and-highlight popup. This is the renderer
        // every real plan (built-in majors included) actually goes through,
        // so this handler — not the one in 03-search.js's initCourseSearch —
        // is the one that fires for a real search in the app.
        if(window.AAUP_PREREQ_GRAPH){ window.AAUP_PREREQ_GRAPH.open(planId, r.slug); }
        else if(window.__selectCourse){ window.__selectCourse(planId, r.slug); }
      }
    });
  }

  function drawConnectors(planId){
    var svg = document.getElementById(planId + '-connectorSvg');
    var container = svg && svg.parentNode; // the .years wrapper
    var data = window.__PLAN_DATA[planId];
    if(!svg || !container || !data) return;
    // Batch reads, then writes — same layout-thrash fix the built-in majors
    // use. Feed plans can be the biggest (Pharmacy is 86 cards), so this is
    // where it matters most.
    var cRect = container.getBoundingClientRect();
    // The whole plan can be off screen — the student navigated Home while a
    // window resize was still pending, say. Every card would then measure as
    // zero-sized and we would wipe a perfectly good set of lines that nothing
    // redraws on the way back. Nothing to measure means nothing to do.
    if(cRect.width <= 0 || cRect.height <= 0) return;
    var w = container.scrollWidth, h = container.scrollHeight;
    var prereqs = data.prereqs || [];
    var rects = {};
    // A course can be in the DOM but have no box on screen: it was removed
    // from the plan (.course-removed), or it sits inside a year that is
    // folded away by "Collapse finished years". Either way its bounding rect
    // collapses to 0,0,0,0 rather than becoming null, and treating that as a
    // real position drew a stray line from the top-left corner of the page to
    // whatever it was still connected to. Measure once, then treat a
    // zero-sized box exactly like a missing element: the edge is dropped and
    // every edge between two courses that ARE on screen still draws.
    function boxOf(id){
      var el = document.getElementById(id);
      if(!el) return null;
      var r = el.getBoundingClientRect();
      return (r.width > 0 && r.height > 0) ? r : null;
    }
    prereqs.forEach(function(pair){
      var a = planId + '-c-' + pair[0], b = planId + '-c-' + pair[1];
      if(!(a in rects)){ rects[a] = boxOf(a); }
      if(!(b in rects)){ rects[b] = boxOf(b); }
    });

    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.style.width = w + 'px';
    svg.style.height = h + 'px';
    var old = svg.querySelectorAll('path.edge');
    for(var i = 0; i < old.length; i++){ old[i].parentNode.removeChild(old[i]); }

    var frag = document.createDocumentFragment();
    prereqs.forEach(function(pair){
      var fa = rects[planId + '-c-' + pair[0]], tb = rects[planId + '-c-' + pair[1]];
      if(!fa || !tb) return; // one end may be in a collapsed/removed part of the plan
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', pathBetweenGeneric(fa, tb, cRect));
      p.setAttribute('class', 'edge');
      p.setAttribute('data-from', planId + '-c-' + pair[0]);
      p.setAttribute('data-to', planId + '-c-' + pair[1]);
      p.setAttribute('marker-end', 'url(#' + planId + '-prereqArrow)');
      frag.appendChild(p);
    });
    svg.appendChild(frag);

    bindImportedHover(planId);
  }

  var hoverBoundPlans = {};
  var hoverSequenceTimers = [];
  function clearHoverSequence(){
    hoverSequenceTimers.forEach(function(t){ clearTimeout(t); });
    hoverSequenceTimers = [];
  }
  function importedSemesterOrder(courseId){
    var el = document.getElementById(courseId);
    var row = el && el.closest('.course-row[id]');
    var order = (row && window.AAUP_PLAN_EDITOR) ? window.AAUP_PLAN_EDITOR.orderOfContainerId(row.id) : null;
    return (order === null || order === undefined) ? Infinity : order;
  }
  // What this course needs, and what it opens up, read from the plan's own
  // prerequisite data rather than from the lines drawn on screen.
  //
  // This used to walk the connector SVG's <path class="edge"> elements and
  // take data-from/data-to off them. Three things go wrong that way, and a
  // student reported all three as "some courses light the wrong ones, and
  // they stay pink":
  //
  //   - the app deliberately does not draw every connector (an edge whose
  //     two ends are too far apart, or would cross the page, is dropped), so
  //     a course with real prerequisites traced nothing at all;
  //   - a year that is folded has no laid-out cards, so its edges are stale
  //     or absent, and the trace pointed at where a card used to be;
  //   - it returned early when it found no paths, which meant holding a
  //     course silently did nothing rather than saying what it connects to.
  //
  // The relationships are in window.__PLAN_DATA — they are the same data the
  // lines are generated FROM — so they are always complete and always right.
  // The lines are still animated when they happen to exist; they are now
  // decoration on top of the highlight rather than the source of it.
  function relatedSlugs(planId, slug){
    var data = (window.__PLAN_DATA || {})[planId] || {};
    var needs = (data.needsMap && data.needsMap[slug]) || [];
    var unlocks = (data.unlocksMap && data.unlocksMap[slug]) || [];
    return { needs: needs, unlocks: unlocks };
  }

  function handleCourseHoverEnter(planId, courseEl){
    clearHoverSequence();
    var id = courseEl.id;
    var slug = id.slice((planId + '-c-').length);
    var rel = relatedSlugs(planId, slug);

    // Mark the cards first, so the highlight is correct whether or not a
    // single line got drawn between them.
    var marked = [];
    function mark(s, cls){
      var el = document.getElementById(planId + '-c-' + s);
      if(!el) return;
      el.classList.add('node-active', cls);
      marked.push(el);
    }
    rel.needs.forEach(function(s){ mark(s, 'node-needs'); });
    rel.unlocks.forEach(function(s){ mark(s, 'node-unlocks'); });
    courseEl.classList.add('node-active');

    var svg = document.getElementById(planId + '-connectorSvg');
    if(!svg) return;
    var paths = Array.prototype.slice.call(svg.querySelectorAll('path.edge'));
    var incoming = [], outgoing = [];
    paths.forEach(function(p){
      if(p.getAttribute('data-to') === id){ incoming.push(p); }
      else if(p.getAttribute('data-from') === id){ outgoing.push(p); }
    });
    if(incoming.length === 0 && outgoing.length === 0) return;

    var hoveredOrder = importedSemesterOrder(id);
    function distance(p, isIncoming){
      var otherId = p.getAttribute(isIncoming ? 'data-from' : 'data-to');
      var otherOrder = importedSemesterOrder(otherId);
      if(otherOrder === Infinity || hoveredOrder === Infinity) return Infinity;
      return Math.abs(hoveredOrder - otherOrder);
    }
    incoming.sort(function(a, b){ return distance(a, true) - distance(b, true); });
    outgoing.sort(function(a, b){ return distance(a, false) - distance(b, false); });
    var sequence = incoming.concat(outgoing);

    sequence.forEach(function(p){
      var len; try{ len = p.getTotalLength(); }catch(e){ len = 2000; }
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
    });
    void svg.getBoundingClientRect();
    requestAnimationFrame(function(){
      paths.forEach(function(p){
        if(sequence.indexOf(p) !== -1){ p.classList.add('active'); }
        else { p.classList.add('dim'); }
      });
      var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var STEP_MS = reducedMotion ? 0 : 650;
      sequence.forEach(function(p, i){
        var t = setTimeout(function(){ p.style.strokeDashoffset = 0; }, i * STEP_MS);
        hoverSequenceTimers.push(t);
      });
    });
  }
  function handleCourseHoverLeave(planId){
    // The quick-action sheet holds the trace open. Lifting your finger is
    // what opens that sheet, and clearing here would wipe the highlight the
    // sheet exists to sit on top of.
    if(window.__QA_HOLD) return;
    clearHoverSequence();
    // Cards first and unconditionally. Clearing used to sit behind an early
    // return when the connector layer was missing, which is exactly how a
    // course could be left highlighted with no way to un-highlight it.
    document.querySelectorAll('#page-' + planId + ' .course[id]').forEach(function(c){
      c.classList.remove('node-active', 'node-needs', 'node-unlocks');
    });
    var svg = document.getElementById(planId + '-connectorSvg');
    if(!svg) return;
    svg.querySelectorAll('path.edge').forEach(function(p){
      p.classList.remove('active');
      p.classList.remove('dim');
      p.style.strokeDasharray = '';
      p.style.strokeDashoffset = '';
    });
  }
  var touchHoldTimer = null;
  var touchHoldEl = null;
  var touchHoldStartX = 0, touchHoldStartY = 0;
  function bindImportedHover(planId){
    if(hoverBoundPlans[planId]) return;
    hoverBoundPlans[planId] = true;
    // mouseenter/mouseleave don't bubble, so delegation (needed since
    // course cards are recreated on every render) uses mouseover/mouseout
    // with a relatedTarget check instead, to avoid re-triggering every
    // time the pointer crosses a child element within the same card.
    document.addEventListener('mouseover', function(e){
      var el = e.target.closest && e.target.closest('.course[id]');
      if(!el || el.id.indexOf(planId + '-c-') !== 0) return;
      if(el.contains(e.relatedTarget)) return;
      handleCourseHoverEnter(planId, el);
    });
    document.addEventListener('mouseout', function(e){
      var el = e.target.closest && e.target.closest('.course[id]');
      if(!el || el.id.indexOf(planId + '-c-') !== 0) return;
      if(el.contains(e.relatedTarget)) return;
      handleCourseHoverLeave(planId);
    });
    // Touch devices have no hover — press and hold a course instead. A
    // quick tap still falls through to the normal onclick (toggle/edit);
    // only a sustained, still press starts the trace.
    document.addEventListener('touchstart', function(e){
      var el = e.target.closest && e.target.closest('.course[id]');
      if(!el || el.id.indexOf(planId + '-c-') !== 0) return;
      touchHoldEl = el;
      var t = e.touches && e.touches[0];
      touchHoldStartX = t ? t.clientX : 0;
      touchHoldStartY = t ? t.clientY : 0;
      touchHoldTimer = setTimeout(function(){ handleCourseHoverEnter(planId, el); }, 450);
    }, { passive: true });
    document.addEventListener('touchmove', function(e){
      // Same tolerance as the built-in majors' hold-to-trace: a real finger
      // held "still" always drifts a few pixels, so only an actual
      // scroll/drag past a small radius should cancel the hold — cancelling
      // on any movement at all meant the hold almost never survived to the
      // 450ms mark in real use.
      var t = e.touches && e.touches[0];
      if(!t){ clearTimeout(touchHoldTimer); return; }
      var dx = t.clientX - touchHoldStartX, dy = t.clientY - touchHoldStartY;
      if((dx * dx + dy * dy) > 100){ clearTimeout(touchHoldTimer); }
    });
    document.addEventListener('touchend', function(){
      clearTimeout(touchHoldTimer);
      if(touchHoldEl){ handleCourseHoverLeave(planId); touchHoldEl = null; }
    });
    document.addEventListener('touchcancel', function(){
      clearTimeout(touchHoldTimer);
      if(touchHoldEl){ handleCourseHoverLeave(planId); touchHoldEl = null; }
    });
  }

  // A lecture and its lab are ONE registered course at AAUP: one catalogue
  // number, one credit value, deliberately drawn as two cards. Both cards
  // printed the full figure, so Programming Fundamentals read as 4H and then
  // another 4H — eight hours for a four-hour course, which is exactly what
  // students reported. The totals were already right (they de-duplicate on
  // the catalogue number); only the cards lied.
  //
  // The FIRST card of such a pair keeps the figure. The rest say the hours are
  // part of it, so no card claims hours a second time.
  function pairContinuations(planId){
    var plan = loadImportedPlans()[planId];
    var firstFor = Object.create(null), out = Object.create(null);
    ((plan && plan.courses) || []).forEach(function(c){
      var num = c.courseNumber ? String(c.courseNumber).trim() : '';
      if(!num || num === '-') return;
      if(firstFor[num] === undefined){ firstFor[num] = c.id; return; }
      out[c.id] = true;
    });
    return out;
  }

  // The registrar counts a degree in buckets — University Req., Spec. Elec.,
  // Support — and every course in plans.json carries the one it belongs to.
  // The cards used to take their colour from `category` (core / math / dept /
  // free), which is an older and coarser split: one "core" card could be a
  // College Req. here and a Specialization Req. in the next plan, while the
  // legend beside it named buckets. Same palette, keyed off the thing the
  // legend actually names.
  //
  // A plan imported before the buckets existed carries no `requirement`, and
  // those cards keep their category colour rather than being assigned to a
  // bucket nobody published for them.
  var BUCKET_ORDER = ['univReq', 'univElec', 'colgReq', 'specReq', 'specElec', 'freeElec', 'supportCourses'];
  var BUCKET_CLASS = {
    univReq: 'skills', univElec: 'uni', colgReq: 'math', specReq: 'core',
    specElec: 'dept', freeElec: 'free', supportCourses: 'misc'
  };
  var BUCKET_LABEL = {
    univReq: ['University Req.', 'متطلب جامعي'],
    univElec: ['University Elec.', 'اختياري جامعي'],
    colgReq: ['College Req.', 'متطلب كلية'],
    specReq: ['Specialization Req.', 'متطلب تخصص'],
    specElec: ['Specialization Elec.', 'اختياري تخصص'],
    freeElec: ['Free Elec.', 'اختياري حر'],
    supportCourses: ['Support', 'مساقات مساندة']
  };
  function bucketOf(c){ return (c && BUCKET_CLASS[c.requirement]) ? c.requirement : ''; }



  // 32: once a grade is in, the requirement bucket has done its job — you
  // already know which block the course belongs to. The card switches to
  // saying how it WENT, which turns the plan into a transcript you can read
  // at arm's length and makes a bad semester visible as a shape.
  function gradeTier(g){
    if(!g) return '';
    var head = String(g).trim().charAt(0).toUpperCase();
    if(head === 'A') return 'a';
    if(head === 'B') return 'b';
    if(head === 'C') return 'c';
    if(head === 'D') return 'd';
    if(head === 'F') return 'f';
    return '';
  }

  // 42: a Latin course name inside an Arabic sentence drags trailing numbers
  // and punctuation to the wrong end of the phrase — "يحتاج Advanced English +1"
  // put the "+1" on the far side of the line. <bdi> isolates the run so the
  // surrounding Arabic keeps its own direction.
  function bidi(text){
    return '<bdi>' + window.__escapeHtml(text) + '</bdi>';
  }
  function visualClassFor(c){
    var b = bucketOf(c);
    return b ? BUCKET_CLASS[b] : ((c && c.category) || 'core');
  }

  // What a locked course is still waiting for, by name. Only the prerequisites
  // that are not done yet — the ones already passed are not why it is closed.
  function missingPrereqNames(planId, slug, rtl){
    var data = window.__PLAN_DATA[planId] || {};
    var info = data.courseInfo || {};
    return ((data.needsMap && data.needsMap[slug]) || [])
      .filter(function(r){ return !isDone(planId, r); })
      .map(function(r){
        var i = info[r];
        if(!i) return r;
        return (rtl && i.ar && i.ar !== i.name) ? i.ar : (i.name || r);
      });
  }

  // ============================================================
  // 2 · HOW FAR AWAY A LOCKED COURSE ACTUALLY IS
  //
  // Every locked course looks equally out of reach today, so a student cannot
  // tell the one that opens as soon as they pass a single course from the one
  // that is three deep behind courses they have not started. Depth is the
  // longest chain of NOT-YET-DONE prerequisites standing in front of it —
  // exactly the number of courses that still have to happen first.
  //
  // Capped, and cycle-guarded: a hand-transcribed plan can contain a pair of
  // courses that each list the other, and this walk must not follow that
  // forever.
  var DEPTH_CAP = 9;
  function chainDepth(planId, slug, seen){
    var data = window.__PLAN_DATA[planId] || {};
    var needs = (data.needsMap && data.needsMap[slug]) || [];
    seen = seen || Object.create(null);
    if(seen[slug]) return 0;
    seen[slug] = true;
    var deepest = 0;
    for(var i = 0; i < needs.length; i++){
      var r = needs[i];
      if(isDone(planId, r)) continue;
      var d = 1 + chainDepth(planId, r, seen);
      if(d > deepest) deepest = d;
      if(deepest >= DEPTH_CAP) break;
    }
    seen[slug] = false;
    return Math.min(deepest, DEPTH_CAP);
  }

  // 57 · WHAT CLOSES IF YOU DROP THIS
  //
  // The inverse of "what does this open", and the more urgent one: dropping a
  // course is a decision made under pressure in week three with no information
  // at all. Transitive, because the second-order effects are the ones that
  // catch people out — dropping Statistics does not just close Machine
  // Learning, it closes everything behind Machine Learning too.
  // A prerequisite list in this catalogue is an AND, not a choice of routes:
  // needsMap holds every course that must be passed first, so there is no
  // "other way round" to check for. What closes is therefore the whole
  // downstream cone — everything whose path to being taken runs through this
  // course — minus anything already passed, which cannot close retroactively.
  function closesIfDropped(planId, slug){
    var data = window.__PLAN_DATA[planId] || {};
    var unlocks = data.unlocksMap || {};
    var out = [], seen = Object.create(null), queue = (unlocks[slug] || []).slice();
    seen[slug] = true;
    while(queue.length){
      var cur = queue.shift();
      if(seen[cur]) continue;
      seen[cur] = true;
      if(isDone(planId, cur)) continue;
      out.push(cur);
      (unlocks[cur] || []).forEach(function(n){ queue.push(n); });
    }
    return out;
  }

  function courseCardHtml(planId, c, rtl, yearNum, continuations, whereTx){
    var done = isDone(planId, c.id);
    var avail = isAvailable(planId, c.id);
    var editing = document.getElementById('page-' + planId) && document.getElementById('page-' + planId).classList.contains('editing');
    var bucket = bucketOf(c);
    // A retake replaces the original in the degree totals (js/40-retakes.js),
    // and the original stays on the plan carrying the grade that no longer
    // counts. Neither card said which was which, so a student looked at two
    // cards for one course with no way to tell the live one from the dead
    // one. Both say so now.
    var superseded = !!(window.__isSupersededByRetake && window.__isSupersededByRetake(planId, c.id));
    var gradeNow = '';
    try{
      var gmap = window.AAUP_GPA ? window.AAUP_GPA.loadGrades() : {};
      gradeNow = gmap[fullId(planId, c.id)] || '';
    }catch(e){ gradeNow = ''; }
    var tier = (done && !superseded) ? gradeTier(gradeNow) : '';
    var cls = 'course ' + visualClassFor(c) + (bucket ? ' req-' + bucket : '') +
      (done ? ' completed' : '') + (avail || done ? ' available' : '') +
      (tier ? ' grade-' + tier : '') +
      (c.isRetake ? ' retake-course' : '') + (superseded ? ' course-superseded' : '');
    var displayName = (rtl && c.ar) ? c.ar : c.name;
    // 43: the other language, underneath. Lectures, slides and the registrar
    // all use the English title, so a student reading Arabic still has to be
    // able to match the card to what the portal calls it — and the reverse is
    // true for an English reader sitting in an Arabic lecture.
    var otherName = (rtl && c.ar && c.name && c.name !== c.ar) ? c.name
      : (!rtl && c.ar && c.ar !== c.name) ? c.ar : '';
    // The old quick "📊 set grade" shortcut for a done course is retired —
    // it shared the same top-right corner as the new checkbox and would
    // visually collide with it. Grade is now set from the full course-
    // details popup (opened by tapping the card), same as every built-in
    // major already works — openGradePrompt() itself is untouched in case
    // anything else still calls it directly.
    var cardButtons = editing
      ? '<div class="imp-card-btn-row">' +
        '<button type="button" class="imp-edit-course-btn" title="Edit course" onclick="event.stopPropagation(); AAUP_IMPORTED.editCoursePrompt(\'' + planId + '\',\'' + c.id + '\');">' + window.AAUP_ICONS.preview('pen', 13) + '</button>' +
        '<button type="button" class="imp-remove-course-btn" title="Remove course" onclick="event.stopPropagation(); AAUP_IMPORTED.confirmRemoveCourse(\'' + planId + '\',\'' + c.id + '\');">' + window.AAUP_ICONS.preview('close', 13) + '</button>' +
        '</div>'
      : '';
    var checkboxHtml = editing ? '' :
      '<span class="course-check" role="checkbox" tabindex="0" aria-checked="' + (done ? 'true' : 'false') + '" ' +
      'aria-label="' + (rtl ? 'ضع علامة إنجاز على المساق' : 'Mark course as completed') + '" onclick="event.stopPropagation(); AAUP_IMPORTED.toggle(\'' + planId + '\',\'' + c.id + '\');" ' +
      'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();event.stopPropagation();AAUP_IMPORTED.toggle(\'' + planId + '\',\'' + c.id + '\');}">' + window.AAUP_ICONS.preview('tick', 11) + '</span>';
    // The line under the name answers the three things a student checks on
    // every card: which year the plan puts it in, whether they can register
    // for it today, and how many hours it carries. The course code used to
    // sit under that as a third line; it is read off the card perhaps once,
    // when registering, and was costing every card a line of height for it.
    // It is in the course details popup, a tap away, where the rest of the
    // registration facts already live.
    var statusTx = done ? (rtl ? 'مُنجز' : 'passed')
      : avail ? (rtl ? 'متاح لك' : 'open to you')
      : (rtl ? 'مغلق لك' : 'closed to you');
    // Most cards on a plan are open, so "open to you" was printed on most
    // cards — and the colour, the empty tick and the connector lines had all
    // said so already. The state worth a word is the closed one, and the
    // useful word is not "closed" but what it is still waiting for.
    var missing = (done || avail) ? [] : missingPrereqNames(planId, c.id, rtl);
    var depth = (done || avail) ? 0 : chainDepth(planId, c.id);
    // Two is a dual in Arabic, not a plural — "2 مساقات" reads as a mistake.
    // Depth is capped at DEPTH_CAP (9), so the three-to-ten plural covers the
    // whole of the rest of the range.
    var awayTx = depth > 1
      ? (rtl ? ' \u00b7 ' + (depth === 2 ? 'على بُعد مساقين' : 'على بُعد ' + depth + ' مساقات')
             : ' \u00b7 ' + depth + ' away')
      : '';
    var lockHtml = !missing.length ? window.__escapeHtml(statusTx)
      : window.__escapeHtml(rtl ? 'يحتاج ' : 'needs ') + bidi(missing[0]) +
        (missing.length > 1 ? window.__escapeHtml(' +' + (missing.length - 1)) : '') +
        window.__escapeHtml(awayTx);
    // The plain-text form, for the screen-reader label where markup cannot go.
    var lockTx = !missing.length ? statusTx
      : (rtl ? 'يحتاج ' : 'needs ') + missing[0] +
        (missing.length > 1 ? ' +' + (missing.length - 1) : '');
    var yearTx = yearNum ? (rtl ? 'سنة ' + yearNum : 'Year ' + yearNum)
      : (rtl ? 'اختياري' : 'Elective');
    var partOfPair = !!(continuations && continuations[c.id]);
    // The grade is entered on this card, stored against this card and counted
    // in the GPA — and then was not shown on it. It rides with the hours,
    // which is the other number a finished course still has to say.
    var gr = '';
    try{
      var grades = window.AAUP_GPA ? window.AAUP_GPA.loadGrades() : {};
      gr = grades[fullId(planId, c.id)] || '';
    }catch(e){ gr = ''; }
    var hoursTx = partOfPair
      ? (rtl ? 'ضمن ' + c.creditHours + ' ساعات' : 'part of ' + c.creditHours + 'H')
      : c.creditHours + 'H';
    if(done && gr && !superseded){ hoursTx += ' · ' + gr; }
    // Each part in its own span so the phone layout can drop the year: a
    // card sitting inside a block headed "Year 1" does not need to say
    // "Year 1" as well, and at half width that repetition is what pushes the
    // line onto a second row. The aria-label below keeps all three parts
    // whatever the layout hides.
    var metaParts = ['<span class="cm-year">' + window.__escapeHtml(yearTx) + '</span>'];
    // Hours before the lock line, not after: the lock line carries a course
    // name and is the part that gets ellipsised on a narrow card, so putting
    // it last is what keeps the hours on screen.
    metaParts.push('<span class="cm-hours">' + bidi(hoursTx) + '</span>');
    // The plan document listed this course among the requirements but did not
    // say which term to take it in — the app picked the earliest one its own
    // prerequisites allow. Every other card on the page is showing the
    // department's own placement, and without this line these ten looked
    // exactly the same as those.
    if(c.termSuggested){
      metaParts.push('<span class="cm-status cm-suggested">' +
        window.__escapeHtml(rtl ? 'الفصل مقترح' : 'term suggested') + '</span>');
    }
    if(!done && !avail){
      metaParts.push('<span class="cm-status cm-locked">' + lockHtml + '</span>');
    }
    // 52 · The English placement is no longer a gate in front of the app; it
    // is asked on the three courses it actually decides. This chip is what
    // makes the question findable — without it the only prompt would be
    // inside a popup nobody has a reason to open.
    if(window.AAUP_ENGLISH && window.AAUP_ENGLISH.needsAnswer &&
       window.AAUP_ENGLISH.needsAnswer(planId, c.id)){
      metaParts.push('<span class="cm-status cm-eng-ask">' +
        window.__escapeHtml(window.AAUP_ENGLISH.chipLabel(rtl)) + '</span>');
    }
    if(superseded || c.isRetake){
      var attemptTx = superseded
        ? (gr ? gr + ' · ' : '') + (rtl ? 'مستبدَل' : 'replaced')
        : (rtl ? 'المحسوب' : 'counts');
      metaParts.push('<span class="cm-attempt' + (superseded ? ' cm-replaced' : ' cm-counts') + '">' +
        window.__escapeHtml(attemptTx) + '</span>');
    }
    var meta = metaParts.join('<span class="cm-sep"> · </span>');
    // Focusable so the plan can be worked from a keyboard: the card itself is
    // a button (Enter opens the details) and the tick inside it is its own
    // control (Space toggles completion) — see js/57-card-input.js.
    var a11y = editing ? '' :
      ' tabindex="0" role="button" aria-label="' +
      window.__escapeHtml(displayName + ' — ' + yearTx + ', ' + statusTx + ', ' + hoursTx) + '"';
    // Where this card sits, written once here so a search result can say it
    // without having to re-derive the plan's shape from the DOM.
    var whereAttr = whereTx ? ' data-where="' + window.__escapeHtml(whereTx) + '"' : '';
    return '<div class="' + cls + '" id="' + fullId(planId, c.id) + '"' + whereAttr + a11y + (editing ? '' : ' onclick="AAUP_IMPORTED.openCourseModal(\'' + planId + '\',\'' + c.id + '\')"') + '>' +
      checkboxHtml +
      cardButtons +
      (c.isRetake ? '<span class="retake-badge">\u21bb ' + (rtl ? 'إعادة' : 'Retake') + '</span>' : '') +
      // The bucket written out ("College Req.") on its own line above the
      // name. As a three-letter code in the corner it printed over the
      // course name on a phone; with the card no longer filled by the bucket
      // colour, this label and the edge stripe are what carry it.
      (bucket && BUCKET_LABEL[bucket]
        ? '<span class="req-code" aria-hidden="true">' + BUCKET_LABEL[bucket][rtl ? 1 : 0] + '</span>' : '') +
      '<div class="name">' + displayName + '</div>' +
      (otherName ? '<div class="name-alt">' + bidi(otherName) + '</div>' : '') +
      '<div class="course-meta">' + meta + '</div>' +
      '</div>';
  }

  function openGradePrompt(planId, slug){
    var overlay = document.getElementById('devModalOverlay');
    var body = document.getElementById('devModalBody');
    if(!overlay || !body) return;
    var plan = loadImportedPlans()[planId];
    var course = plan && (plan.courses || []).filter(function(c){ return c.id === slug; })[0];
    if(!course) return;
    var pid = fullId(planId, slug);
    var grades = window.AAUP_GPA.loadGrades();
    var current = grades[pid] || '';
    var opts = '<option value="">\u2014</option>' + window.AAUP_GPA.GRADE_ORDER.map(function(g){
      return '<option value="' + g + '"' + (g === current ? ' selected' : '') + '>' + window.AAUP_GPA.gradeLabel(g) + '</option>';
    }).join('');
    var rtl = isAr();
    var dispName = rtl && course.ar ? course.ar : course.name;
    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    body.innerHTML =
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('chart', 20) + (rtl ? 'العلامة \u2014 ' : 'Grade \u2014 ') + window.__escapeHtml(dispName) + '</h2>' +
      '<div class="form-field"><label for="impGradeSelect">' + (rtl ? 'العلامة' : 'Grade') + '</label><select id="impGradeSelect">' + opts + '</select>' +
      '<div class="numeric-grade-row">' +
        '<input type="number" min="0" max="100" step="0.1" class="numeric-grade-input" id="impNumericGradeInput" placeholder="' +
        (rtl ? 'أو أدخل العلامة الرقمية (اختياري)' : 'or enter numeric score (optional)') + '">' +
        '<span class="numeric-grade-result" id="impNumericGradeResult"></span>' +
      '</div></div>' +
      '<p class="form-note">' + (rtl ? 'اختيار F يجدول إعادة المساق تلقائيًا في الفصل التالي.' : 'Setting F automatically schedules a retake in the next semester.') + '</p>' +
      '<div class="form-actions"><button type="button" class="home-btn" id="impGradeClose">' + (rtl ? 'إغلاق' : 'Close') + '</button></div>';
    overlay.classList.add('open');
    document.getElementById('impGradeClose').addEventListener('click', function(){ overlay.classList.remove('open'); });
    document.getElementById('impGradeSelect').addEventListener('change', function(e){
      if(window.__applyGradeChange){ window.__applyGradeChange(planId, pid, e.target.value); }
      render(planId);
    });
    var impNumericInput = document.getElementById('impNumericGradeInput');
    var impNumericResult = document.getElementById('impNumericGradeResult');
    var impGradeSelect = document.getElementById('impGradeSelect');
    if(impNumericInput){
      impNumericInput.addEventListener('input', function(){
        var raw = impNumericInput.value;
        var letter = raw === '' ? null : window.AAUP_GPA.letterForScore(raw, planId, pid);
        if(!letter){ impNumericResult.textContent = ''; impNumericResult.classList.remove('ngr-active'); return; }
        impNumericResult.textContent = '→ ' + letter;
        impNumericResult.classList.add('ngr-active');
        impGradeSelect.value = letter;
        if(window.__applyGradeChange){ window.__applyGradeChange(planId, pid, letter); }
        render(planId);
      });
    }
  }

  var IMP_MODAL_LABELS = {
    en: { num: 'Course Number', name: 'Course Name', cr: 'Cr. Hrs.', prereq: 'Prerequisite', th: 'Theoretical', pr: 'Practical' },
    ar: { num: 'رقم المساق', name: 'اسم المساق', cr: 'الساعات المعتمدة', prereq: 'المتطلب السابق', th: 'نظري', pr: 'عملي' }
  };

  // The same course-details popup the 4 built-in majors have (grade,
  // planning status, difficulty, workload, notes, and the University
  // Elective picker) — reused here via window.__renderCourseModalExtras /
  // __bindCourseModalExtras rather than re-implemented, so any future change
  // to that popup (like the elective picker) applies to every plan type at
  // once instead of needing to be built twice.
  // GPA of one finished year, from the grades given to its courses. Null when
  // none of them has a grade yet — then the folded line leaves GPA out.
  function yearGpaOf(planId, courses){
    var G = window.AAUP_GPA;
    if(!G || !G.loadGrades || !G.GRADE_POINTS) return null;
    var grades = G.loadGrades();
    var points = 0, credits = 0;
    courses.forEach(function(c){
      var pid = G.primaryId ? G.primaryId(planId, c.id) : fullId(planId, c.id);
      var g = grades[pid];
      if(!G.isRealGrade || !G.isRealGrade(g) || G.GRADE_POINTS[g] == null) return;
      var cr = parseFloat(c.creditHours) || 0;
      points += G.GRADE_POINTS[g] * cr; credits += cr;
    });
    return credits ? points / credits : null;
  }

  var VIEW_KEY = 'aaup_plan_view';
  function planView(){ try{ return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'; }catch(e){ return 'cards'; } }
  function applyPlanView(v){
    document.documentElement.setAttribute('data-plan-view', v);
    document.querySelectorAll('[data-plan-view]').forEach(function(b){
      if(b !== document.documentElement) b.setAttribute('aria-pressed', String(b.getAttribute('data-plan-view') === v));
    });
  }
  applyPlanView(planView());
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('button[data-plan-view]');
    if(!b) return;
    var v = b.getAttribute('data-plan-view');
    try{ localStorage.setItem(VIEW_KEY, v); }catch(err){}
    applyPlanView(v);
    // The prerequisite arrows are drawn from where the cards sit, which just moved.
    if(currentOpenPlanId) drawConnectors(currentOpenPlanId);
  });

  function openCourseModal(planId, slug){
    var plan = loadImportedPlans()[planId];
    var course = plan && (plan.courses || []).filter(function(c){ return c.id === slug; })[0];
    if(!course) return;
    var rtl = isAr();
    var L = IMP_MODAL_LABELS[rtl ? 'ar' : 'en'];
    var displayName = (rtl && course.ar) ? course.ar : course.name;
    var info = ((window.__PLAN_DATA[planId] || {}).courseInfo || {})[slug] || {
      num: course.num || course.courseNumber || '-', th: '-', pr: '-', prereq: '-'
    };
    var overlay = document.getElementById('impCourseModalOverlay');
    var body = document.getElementById('impCourseModalBody');
    if(!overlay || !body) return;
    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');

    // The six label/value rows this used to print are still here — they moved
    // into the Details column of the detail panel. What is in front of them now
    // is whether the course is available and why, which is the thing a course
    // is opened to find out. Falls back to the old rows if the module is
    // missing, so the modal degrades rather than blanking.
    // The shared modal card is sized for a short list of rows. The detail
    // panel needs room for two columns on a wide screen, so it says so — via a
    // class rather than :has(), which is not safe to rely on across the phones
    // this has to work on.
    var cardEl = overlay.querySelector('.modal-card');
    if(cardEl) cardEl.classList.toggle('cd-card', !!window.AAUP_COURSE_DETAIL);

    if(window.AAUP_COURSE_DETAIL){
      body.innerHTML = window.AAUP_COURSE_DETAIL.build(planId, slug, course, rtl);
    } else {
      body.innerHTML =
        '<h3>' + window.__escapeHtml(displayName) + '</h3>' +
        '<div class="modal-row"><span class="k">' + L.num + '</span><span class="v">' + window.__escapeHtml(String(info.num || '-')) + '</span></div>' +
        '<div class="modal-row"><span class="k">' + L.name + '</span><span class="v">' + window.__escapeHtml(displayName) + '</span></div>' +
        '<div class="modal-row"><span class="k">' + L.cr + '</span><span class="v">' + window.__escapeHtml(String(course.creditHours != null ? course.creditHours : 0)) + '</span></div>' +
        '<div class="modal-row"><span class="k">' + L.prereq + '</span><span class="v">' + window.__escapeHtml(String(info.prereq || '-')) + '</span></div>' +
        '<div class="modal-row"><span class="k">' + L.th + '</span><span class="v">' + window.__escapeHtml(String(info.th || '-')) + '</span></div>' +
        '<div class="modal-row"><span class="k">' + L.pr + '</span><span class="v">' + window.__escapeHtml(String(info.pr || '-')) + '</span></div>';
    }

    // The grade and planning controls are untouched and still owned by
    // js/21-course-modal-extras.js. They are placed inside the panel rather
    // than appended after it, so the layout keeps them beside the reasoning
    // instead of below a two-column block.
    if(window.__renderCourseModalExtras){
      var slot = body.querySelector('.cd-extras');
      var extrasHTML = window.__renderCourseModalExtras(planId, slug);
      if(slot) slot.innerHTML = extrasHTML; else body.innerHTML += extrasHTML;
    }
    overlay.classList.add('open');
    if(window.__bindCourseModalExtras){
      var extrasEl = body.querySelector('.modal-extras');
      window.__bindCourseModalExtras(planId, slug, extrasEl);
    }
    if(window.AAUP_COURSE_DETAIL && window.AAUP_COURSE_DETAIL.bind){
      window.AAUP_COURSE_DETAIL.bind(planId, slug, body);
    }

    // A prerequisite chip is a course too. Following one is the whole point of
    // drawing the chain, and it beats closing the panel and hunting the grid.
    body.querySelectorAll('[data-goto]').forEach(function(b){
      b.addEventListener('click', function(){
        var next = b.getAttribute('data-goto');
        if(next) openCourseModal(planId, next);
      });
    });
  }

  function closeCourseModal(){
    var overlay = document.getElementById('impCourseModalOverlay');
    if(overlay){ overlay.classList.remove('open'); }
  }

  // One-time wiring for the single shared overlay — backdrop click, Escape,
  // and stopping a click on the card itself from bubbling to the backdrop.
  function bindCourseModal(){
    var overlay = document.getElementById('impCourseModalOverlay');
    if(!overlay || overlay.getAttribute('data-bound')) return;
    overlay.setAttribute('data-bound', '1');
    var closeBtn = document.getElementById('impCourseModalClose');
    if(closeBtn){ closeBtn.addEventListener('click', closeCourseModal); }
    overlay.addEventListener('click', function(e){ if(e.target === overlay){ closeCourseModal(); } });
    // The card used to stopPropagation() on every click, to stop a click
    // inside it reaching the backdrop. It never could: the backdrop handler
    // above closes only when the click's target IS the overlay, which a click
    // inside the card is not. What the guard did instead was swallow every
    // click before it left the card, so any handler delegated from document —
    // js/86-prereq-report.js was the first to need one — silently never
    // fired inside this modal. Removed rather than worked around.
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && overlay.classList.contains('open')){ closeCourseModal(); }
    });
  }

  // A Specialization Elective is a CHOICE out of a pool, not a course the
  // plan tells you to take in a given term — the university's own app lists
  // "Spec. Elec." as (Optional) next to the mandatory categories. Showing them
  // inline made a semester look heavier than it is and implied a fixed slot
  // that does not exist, so they are lifted out of the year grid and gathered
  // into one pool block under the years (see electivePoolHtml below).
  // A specialization elective is in the pool until the student says where
  // they actually took it. Before that, the term the catalogue happens to
  // print beside it is meaningless — the plan does not schedule these — so
  // it is pooled regardless of what yearId/semester the data carries.
  //
  // placedByStudent is what edit mode writes when one is dragged into a real
  // semester. Without it the drag appeared to work and then silently undid
  // itself: the course's yearId was updated, and the very next render pooled
  // it again anyway because the category had not changed.
  function isPoolElective(c){ return !!c && c.category === 'dept' && !c.placedByStudent; }

  // The legend was a disclosure: a heading, a "tap to expand" hint, seven
  // colour-and-word pairs, and a sentence explaining that hovering a course
  // traces its prerequisites. A key is swatches. This one carries only the
  // buckets the plan in front of you actually uses, so a plan with no Support
  // courses does not advertise a Support colour.
  //
  // .i18n with data-en/data-ar is kept: js/19-audit.js reads its label for a
  // bucket off this row rather than hardcoding one wording for every plan.
  // How far through a year you are, as a shape. The fraction it replaces
  // ("3 / 22") is still there for a screen reader, and the year's hours still
  // sit beside it, so nothing is only in the picture.
  function yearRingHtml(done, total, rtl){
    var C = 50.27;                       // 2πr at r=8
    var frac = total ? Math.min(1, done / total) : 0;
    var label = rtl ? (done + ' من ' + total) : (done + ' of ' + total);
    return '<span class="iy-ring" role="img" aria-label="' + window.__escapeHtml(label) + '">' +
      '<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true" focusable="false">' +
      '<circle class="iy-ring-bg" cx="11" cy="11" r="8"></circle>' +
      (frac > 0
        ? '<circle class="iy-ring-fill" cx="11" cy="11" r="8" transform="rotate(-90 11 11)" ' +
          'stroke-dasharray="' + (frac * C).toFixed(2) + ' ' + C.toFixed(2) + '"></circle>'
        : '') +
      '</svg></span>';
  }

  // Which requirement buckets this plan actually draws on, in the order the
  // audit lists them. Read by the legend below and by the plan filter
  // (js/79-plan-filter.js), which offers one chip per bucket.
  function bucketsInPlan(planId){
    var p = loadImportedPlans()[planId];
    if(!p) return [];
    var seen = {};
    (p.courses || []).forEach(function(c){
      var b = bucketOf(c);
      if(b) seen[b] = true;
    });
    return BUCKET_ORDER.filter(function(b){ return seen[b]; }).map(function(b){
      return { key: b, cls: BUCKET_CLASS[b], en: BUCKET_LABEL[b][0], ar: BUCKET_LABEL[b][1] };
    });
  }

  function legendHtml(id, p, rtl){
    var seen = {}, keys = [];
    (p.courses || []).forEach(function(c){
      var b = bucketOf(c);
      if(b && !seen[b]){ seen[b] = true; }
    });
    BUCKET_ORDER.forEach(function(b){ if(seen[b]) keys.push(b); });
    // A plan imported before requirement buckets existed: fall back to the
    // categories it does carry, named the way the audit names them.
    if(!keys.length){
      var byCat = {};
      (p.courses || []).forEach(function(c){ byCat[c.category || 'core'] = true; });
      BUCKET_ORDER.forEach(function(b){
        if(byCat[BUCKET_CLASS[b]] && !seen[BUCKET_CLASS[b]]){ seen[BUCKET_CLASS[b]] = true; keys.push(b); }
      });
    }
    if(!keys.length) return '';
    return '<div class="legend" id="' + id + '-legend">' +
      keys.map(function(b){
        var label = BUCKET_LABEL[b];
        return '<span class="item"><span class="chip ' + BUCKET_CLASS[b] + '"></span>' +
          '<span class="i18n" data-en="' + window.__escapeHtml(label[0]) + '" data-ar="' + window.__escapeHtml(label[1]) + '">' +
          window.__escapeHtml(label[rtl ? 1 : 0]) + '</span></span>';
      }).join('') +
      '</div>';
  }

  // A requirement the plan lists at zero credit hours — Community Service in
  // almost every AAUP plan, and Beginning English in the ones that publish
  // it. The plan asks for them and they move no number on this page, so
  // scheduled among fifteen credit-hour courses they read as the least
  // important card in the year. They are lifted out of their semester and
  // pinned above Year 1 instead. Nothing else changes: the card keeps its
  // id, so its prerequisite arrows, its grade, the audit and the filter all
  // still find it, and js/12-removed.js still hides it if the student's
  // English placement took it out of their plan.
  function isZeroHour(c){
    return !!c && !isPoolElective(c) && (parseFloat(c.creditHours) || 0) === 0;
  }

  // Where the plan itself put a course, in words. Used by the pinned block,
  // whose cards are no longer sitting under a year header that says it.
  function yearIndexOf(plan, yearId){
    var idx = -1;
    (plan.structure && plan.structure.years ? plan.structure.years : []).forEach(function(y, i){
      if(y.id === yearId) idx = i;
    });
    return idx;
  }

  function whereOf(plan, c, rtl){
    if(!c.yearId) return rtl ? 'غير مجدولة' : 'Not scheduled';
    var idx = yearIndexOf(plan, c.yearId);
    var yearTx = idx >= 0 ? ((rtl ? 'سنة ' : 'Year ') + (idx + 1)) : '';
    var semTx = c.semester ? (rtl ? SEMESTER_LABEL_AR[c.semester] : SEMESTER_LABEL[c.semester]) : '';
    return [yearTx, semTx].filter(Boolean).join(' · ');
  }

  function pinnedHtml(planId, plan, rtl){
    var zero = (plan.courses || []).filter(isZeroHour);
    if(!zero.length) return '';
    var pairs = pairContinuations(planId);
    return '<div class="imp-year-block imp-pinned-block">' +
      '<div class="imp-year-header"><h3>' +
      (rtl ? 'مطلوبة كمان · بلا ساعات' : 'Also required · 0 hours') + '</h3></div>' +
      '<p class="imp-elective-note">' +
      (rtl
        ? 'الخطة تدرجها بصفر ساعة معتمدة — فهي لا تضيف شيئًا لأي مجموع في هذه الصفحة.'
        : 'The plan lists these at zero credit hours, so they add nothing to any total on this page.') +
      '</p><div class="course-row">' +
      zero.map(function(c){
        // The year is still passed through, so a card lifted out of Year 1
        // keeps saying Year 1 on its own meta line instead of losing where
        // the plan put it.
        var idx = c.yearId ? yearIndexOf(plan, c.yearId) : -1;
        return courseCardHtml(planId, c, rtl, idx >= 0 ? idx + 1 : null, pairs, whereOf(plan, c, rtl));
      }).join('') +
      '</div></div>';
  }

  // How heavy a semester is, said in the only terms this app can honestly
  // use. The university's registration ceiling is a regulation, not
  // something any plan document publishes, so it is not in plans.json and
  // is not guessed at here. What IS in the data is every other semester the
  // same plan schedules — so "heavy" means heavy FOR THIS PLAN, measured
  // against the median of its own regular semesters, and the label says so
  // rather than implying a rule from the registrar.
  //
  // Summers are left out of the median and never flagged: a summer term is
  // deliberately light and would drag the typical load down.
  // A course the student dropped out of their own plan is not part of the
  // load they will actually register for — an Intermediate English they
  // placed out of is three hours this term will never contain. Removal is
  // normally painted onto the cards after render (js/12-removed.js), which
  // is too late for a number computed while building them, so the same
  // store is asked directly here.
  function countsForLoad(planId, c){
    if(window.AAUP_REMOVED && window.AAUP_REMOVED.isRemoved(planId, c.id)) return false;
    return true;
  }

  function typicalLoad(planId, plan){
    var totals = {};
    (plan.courses || []).forEach(function(c){
      if(!c.yearId || c.semester === 's3' || isPoolElective(c)) return;
      if(!countsForLoad(planId, c)) return;
      var k = c.yearId + '/' + c.semester;
      totals[k] = (totals[k] || 0) + (parseFloat(c.creditHours) || 0);
    });
    var arr = Object.keys(totals).map(function(k){ return totals[k]; })
      .filter(function(n){ return n > 0; }).sort(function(a, b){ return a - b; });
    if(arr.length < 3) return 0;               // too few terms for a median to mean anything
    // Upper median rather than the average of the middle two: credit hours
    // are whole numbers and an eight-semester plan would otherwise be
    // compared against a "14.5H usual" no term in it actually has. Taking
    // the upper one also errs toward flagging less.
    return arr[Math.floor(arr.length / 2)];
  }

  // One course clear of the plan's own median is the line. Anything tighter
  // flags a seventeen-hour term against a sixteen-hour median, which is not
  // information.
  var HEAVY_MARGIN = 3;

  // ============================================================
  // 64 · "WHERE ARE YOU NOW?"
  //
  // Setting up means marking two or three years of history one course at a
  // time — around forty taps before the app is useful to the person doing
  // them, which is where most people stop. One tap instead: say which
  // semester you are in, and everything the plan schedules BEFORE that point
  // is marked done for you to correct.
  //
  // It is a starting position, not a claim about the student, so the wording
  // says so and the correction is the ordinary card tick they would have used
  // anyway. It only appears on a plan with nothing marked — the moment it
  // helps — and never again after that.
  function planTerms(plan){
    var terms = [];
    (plan.structure && plan.structure.years ? plan.structure.years : []).forEach(function(y, i){
      ['s1', 's2'].concat(y.hasSummer ? ['s3'] : []).forEach(function(sem){
        terms.push({ yearId: y.id, sem: sem, yearNum: i + 1 });
      });
    });
    return terms;
  }

  function whereAreYouHtml(planId, plan, rtl){
    if(!hasStructure(plan)) return '';
    var real = (plan.courses || []).filter(function(c){ return !isPoolElective(c); });
    if(!real.length || real.some(function(c){ return isDone(planId, c.id); })) return '';
    var terms = planTerms(plan);
    if(terms.length < 2) return '';
    var chips = terms.map(function(t, i){
      var lab = (rtl ? 'س' + t.yearNum : 'Y' + t.yearNum) + ' · ' +
        (rtl ? SEMESTER_LABEL_AR[t.sem] : SEMESTER_LABEL[t.sem]).replace(/ Semester$/, '');
      return '<button type="button" class="way-chip" data-way="' + i +
        '" data-plan="' + window.__escapeHtml(planId) + '">' + window.__escapeHtml(lab) + '</button>';
    }).join('');
    // One line until it is opened: the eight semester buttons used to fill
    // most of a phone screen above Year 1.
    return '<details class="way-card">' +
      '<summary class="way-head"><span>' + window.__escapeHtml(rtl ? 'وين أنت الآن؟' : 'Where are you now?') + '</span>' +
        '<span class="way-pick">' + window.__escapeHtml(rtl ? 'اختر فصلك' : 'Pick your semester') + '</span></summary>' +
      '<p class="way-note">' + window.__escapeHtml(rtl
        ? 'اختر فصلك الحالي وسنحدّد كل ما قبله كمنجز — عدّل أي مساق لم تأخذه.'
        : 'Pick the semester you are in and everything before it is marked done — fix any you have not taken.') +
      '</p><div class="way-chips">' + chips + '</div></details>';
  }

  function semesterHtml(planId, plan, yearId, semester, editing, rtl, yearNum){
    var pairs = pairContinuations(planId);
    var containerId = planId + '-y' + yearId.replace('y','') + '-s' + semester.replace('s','');
    var courses = (plan.courses || []).filter(function(c){ return c.yearId === yearId && c.semester === semester && !isPoolElective(c) && !isZeroHour(c); });
    var addCard = editing ? '<div class="imp-add-course-card" onclick="AAUP_IMPORTED.addCoursePrompt(\'' + planId + '\',\'' + yearId + '\',\'' + semester + '\')">+</div>' : '';
    var semTx = rtl ? SEMESTER_LABEL_AR[semester] : SEMESTER_LABEL[semester];
    var whereTx = (yearNum ? (rtl ? 'سنة ' + yearNum : 'Year ' + yearNum) + ' · ' : '') + semTx;

    // Hours in the term, and — when the plan's own median says this one is a
    // course heavier than the rest — a line naming the comparison it is
    // making, so nobody reads it as the university's ceiling.
    var semHours = courses.reduce(function(a, c){
      return countsForLoad(planId, c) ? a + (parseFloat(c.creditHours) || 0) : a;
    }, 0);
    var usual = semester === 's3' ? 0 : typicalLoad(planId, plan);
    var heavy = usual > 0 && semHours >= usual + HEAVY_MARGIN;
    // "18H" means nothing to a first-year. Light, balanced and heavy mean
    // something immediately, and the number stays beside them for anyone who
    // wants it. Measured against this plan's own median term, not a fixed
    // ceiling — a 163-hour engineering degree and a 33-hour diploma do not
    // share a definition of heavy.
    var light = usual > 0 && semHours > 0 && semHours <= usual - HEAVY_MARGIN;
    var verdict = !usual || !semHours ? ''
      : heavy ? (rtl ? 'ثقيل' : 'heavy')
      : light ? (rtl ? 'خفيف' : 'light')
      : (rtl ? 'متوازن' : 'balanced');
    var verdictCls = heavy ? 'is-heavy' : light ? 'is-light' : 'is-balanced';
    var loadNote = heavy
      ? '<div class="imp-sem-heavy">' +
        (rtl
          ? ('أثقل من المعتاد في هذه الخطة (' + usual + ' ساعة)')
          : ((semHours - usual) + 'H over this plan\'s usual ' + usual + 'H')) +
        '</div>'
      : '';

    return '<div class="imp-semester-block' + (heavy ? ' is-heavy' : '') + '">' +
      '<div class="imp-semester-title">' + semTx +
      (semHours > 0 ? '<span class="imp-sem-hours">' + semHours + 'H</span>' : '') +
      (verdict ? '<span class="imp-sem-verdict ' + verdictCls + '">' +
        window.__escapeHtml(verdict) + '</span>' : '') +
      // 12 · One action instead of six taps. A student setting up two years of
      // history is marking forty-odd courses one at a time before the app is
      // useful to them at all, which is where most people give up. The button
      // says which way it will go, so it is never a guess.
      (!editing && courses.length
        ? '<button type="button" class="imp-sem-bulk" data-sem-bulk="' + containerId +
          '" data-plan="' + window.__escapeHtml(planId) + '">' +
          window.__escapeHtml(
            courses.every(function(c){ return isDone(planId, c.id); })
              ? (rtl ? 'ألغِ تحديد الفصل' : 'Unmark all')
              : (rtl ? 'حدّد الفصل كمنجز' : 'Mark all done')) +
          '</button>'
        : '') +
      '</div>' + loadNote +
      '<div class="course-row" id="' + containerId + '">' +
      courses.map(function(c){ return courseCardHtml(planId, c, rtl, yearNum, pairs, whereTx); }).join('') + addCard +
      '</div></div>';
  }

  // Courses the plan lists but does not schedule — department and free
  // electives you choose and slot in yourself. They used to be forced into
  // Year 1 Semester 1, which read as "these are all first-semester courses"
  // and made that semester look impossibly heavy. They get their own block,
  // labelled, after the years.
  //
  // Same .course-row / .course markup as a real semester on purpose: ticking
  // one off, its grade, its prerequisite arrows and the degree audit all go
  // through the shared code, which finds courses by id and does not care
  // where on the page they sit.
  // Which requirement each pool group is drawn from, so the group can be
  // measured against the hours the plan actually publishes for it.
  var POOL_BUCKET = { dept: 'specElec', free: 'freeElec', uni: 'univElec' };

  var UNSCHEDULED_LABEL = {
    dept: { en: 'Specialization Electives', ar: 'متطلبات التخصص الاختيارية' },
    free: { en: 'Free Electives', ar: 'المتطلبات الحرة' },
    uni:  { en: 'University Electives', ar: 'المتطلبات الجامعية الاختيارية' },
    other:{ en: 'Electives — choose from these', ar: 'مواد اختيارية' }
  };

  // A shelf of thirteen electives said "13" — the size of the shelf, which is
  // not a thing a student is finishing. What they are finishing is the hours
  // the plan asks for, so that is what this measures: hours already placed
  // into a semester against the hours the plan publishes for that
  // requirement. A plan that publishes no figure for it gets no meter rather
  // than a made-up one.
  function poolMeterHtml(planId, plan, groupKey, rtl){
    var bucket = POOL_BUCKET[groupKey];
    var need = bucket && plan.requirementHours ? Number(plan.requirementHours[bucket]) : 0;
    if(!bucket || !need || !isFinite(need)) return '';
    var placed = (plan.courses || []).reduce(function(a, c){
      if(c.requirement !== bucket) return a;
      if(!c.yearId || isPoolElective(c)) return a;      // still on the shelf
      return a + (parseFloat(c.creditHours) || 0);
    }, 0);
    var pct = Math.max(0, Math.min(100, Math.round(placed / need * 100)));
    var line = rtl
      ? ('<b>' + placed + ' من ' + need + ' ساعة</b> موضوعة')
      : ('<b>' + placed + ' of ' + need + 'H</b> placed');
    return '<div class="imp-pool-meter">' +
      '<div class="pw-track"><div class="pw-fill" style="width:' + pct + '%;"></div></div>' +
      '<span class="imp-pool-num">' + line + '</span></div>';
  }

  function unscheduledHtml(planId, plan, editing, rtl){
    var pairs = pairContinuations(planId);
    // Two sources feed one pool: courses the plan never scheduled, and every
    // specialization elective regardless of the term the data happens to name.
    var loose = (plan.courses || []).filter(function(c){ return (!c.yearId || isPoolElective(c)) && !isZeroHour(c); });
    if(!loose.length) return '';

    // Grouped by category so a plan with both department and free electives
    // does not present them as one undifferentiated pile.
    var order = ['dept', 'free', 'uni', 'other'];
    var groups = {};
    loose.forEach(function(c){
      var k = UNSCHEDULED_LABEL[c.category] ? c.category : 'other';
      (groups[k] = groups[k] || []).push(c);
    });

    var html = '<div class="imp-year-block imp-elective-block">' +
      '<div class="imp-year-header"><h3>' +
      (rtl ? 'مواد اختيارية' : 'Electives') +
      ' <span class="imp-optional-tag">' + (rtl ? '(اختياري)' : '(Optional)') + '</span></h3></div>' +
      '<p class="imp-elective-note">' +
      (rtl
        ? 'الخطة لا تحدد لها فصلًا — ضعها في الفصل الذي تأخذها فيه.'
        : 'The plan does not schedule these — put each one where you take it.') +
      '</p>';

    order.forEach(function(k){
      if(!groups[k]) return;
      var label = UNSCHEDULED_LABEL[k];
      var whereTx = rtl ? 'اختياري' : 'Elective';
      html += '<div class="imp-semester-block"><div class="imp-semester-title">' +
        (rtl ? label.ar : label.en) +
        ' <span class="imp-optional-tag">' + (rtl ? '(اختياري)' : '(Optional)') + '</span>' +
        ' <span class="imp-elective-count">' + groups[k].length + '</span></div>' +
        poolMeterHtml(planId, plan, k, rtl) +
        '<div class="course-row" id="' + planId + '-elective-' + k + '">' +
        groups[k].map(function(c){ return courseCardHtml(planId, c, rtl, null, pairs, whereTx); }).join('') +
        '</div></div>';
    });
    return html + '</div>';
  }

  function render(id){
    var plans = loadImportedPlans();
    var p = plans[id];
    var host = document.getElementById('importedPlanView');
    if(!p || !host) return;

    if(!hasStructure(p)){ renderLegacy(id, p, host); return; }

    registerPlan(id, p);
    var editing = document.getElementById('page-' + id) ? document.getElementById('page-' + id).classList.contains('editing') : false;
    var rtl = isAr();

    var en = nameParts(p.majorName.en), ar = nameParts(p.majorName.ar);
    var bioEn = (p.bio && p.bio.en) || '';

    var totalCr = 0, doneCr = 0;
    if(window.AAUP_AUDIT){
      window.AAUP_AUDIT.computeAudit(id).forEach(function(r){ totalCr += r.total; doneCr += r.completed; });
    }
    var pct = totalCr ? Math.round(doneCr / totalCr * 100) : 0;

    // Same header structure every built-in major uses (brand block, center
    // title with the plan's own icon standing in for the hand-drawn
    // per-major artwork, Arabic block, action buttons) rather than a
    // simplified look-alike.
    // Width and margin live in CSS (.sheet-plan), not in a style attribute:
    // an inline margin beats every stylesheet rule, which is exactly how this
    // page used to slide underneath the fixed sidebar on a laptop-width screen
    // — body.has-sidebar's 230px offset could never win against it.
    var html = '<div class="sheet sheet-plan' + (editing ? ' editing' : '') + (rtl ? ' rtl-mode' : '') + '" id="page-' + id + '"' + (rtl ? ' dir="rtl"' : '') + '>' +
      '<header>' +
      '<div class="brand"><div class="mark" style="display:flex;align-items:center;justify-content:center;font-size:20px;">' + window.AAUP_ICONS.markup(p, { size: 22 }) + '</div>' +
      '<div><h1>' + (function(){ var u = (window.APP_UNIVERSITIES || {})[p.university || 'aaup'] || { name: { en: 'The Arab American University', ar: 'الجامعة العربية الأمريكية' } }; return rtl ? u.name.ar : u.name.en; })() + '</h1><p>' + (rtl ? (p.college && p.college.ar ? p.college.ar : 'كلية غير محددة') : (p.college && p.college.en ? p.college.en : 'Faculty not specified')) + '</p></div></div>' +
      '<div class="title-block"><div class="icon-row">' +
      '<div class="en">' + en.big + (en.small ? '<em>' + en.small + '</em>' : '') + '</div>' +
      '</div></div>' +
      '<div class="ar-block"><div class="ar1">' + ar.big + '</div>' + (ar.small ? '<div class="ar2">' + ar.small + '</div>' : '') + '</div>' +
      // 45 · The language switch, here rather than four taps away.
      // It lived at More → Settings → Preferences → Language. Bilingual
      // students switch constantly — to read a course name the way the
      // lecturer says it, to send a screenshot to someone who reads the
      // other one — and four taps each way is enough friction that they
      // simply stop. Two characters, on the screen where the switching
      // actually matters.
      '<div class="plan-lang" role="group" aria-label="' +
        (rtl ? 'اللغة' : 'Language') + '">' +
        '<button type="button" class="plan-lang-btn' + (rtl ? '' : ' is-on') +
          '" data-plan-lang="en" aria-pressed="' + (rtl ? 'false' : 'true') + '">EN</button>' +
        '<button type="button" class="plan-lang-btn' + (rtl ? ' is-on' : '') +
          '" data-plan-lang="ar" aria-pressed="' + (rtl ? 'true' : 'false') + '">\u0639</button>' +
      '</div>' +
      // Home, Edit Mode, Course Library, Export Plan and Contribute all used
      // to sit here as a five-button row above the plan. Every one of them
      // is a destination, and destinations belong in the menu — which is
      // where they are now (Edit Mode at the top of it). What is left in the
      // header is what the header is for: whose plan this is.
      //
      // The one exception is an ACTIVE contribution. That is not navigation,
      // it is an unsent draft: hiding it in a menu is how a student loses
      // work they thought they had submitted.
      (p.contributing && window.AAUP_CONTRIBUTE
        ? '<div class="header-actions"><button type="button" class="home-btn" onclick="AAUP_CONTRIBUTE.submit(\'' + id + '\')" style="border-color:var(--accent);color:var(--text);" title="Send what you have added so far — the maintainer can reply here in the app">' + window.AAUP_ICONS.preview('send', 14) + 'Submit contribution</button></div>'
        : '') +
      // The way out of Edit Mode used to be a button in the header, which
      // scrolled away with it — a student three years down the plan had to
      // scroll back up to leave. It is a bar pinned to the bottom of the
      // screen now, there the whole time you are editing, so you always
      // know you are in Edit Mode and how to finish.
      (editing
        ? '<div class="edit-donebar" role="region" aria-label="' + (rtl ? 'وضع التعديل' : 'Edit Mode') + '">' +
            '<span class="edit-donebar-ic" aria-hidden="true">' + window.AAUP_ICONS.preview('pen', 16) + '</span>' +
            '<span class="edit-donebar-text"><b>' + (rtl ? 'وضع التعديل' : 'Editing') + '</b>' +
              '<span>' + (rtl ? 'التغييرات بتنحفظ أول بأول' : 'Changes save as you go') + '</span></span>' +
            '<button type="button" class="edit-donebar-btn imp-exit-edit-btn" onclick="AAUP_IMPORTED.toggleEdit(\'' + id + '\')">' + (rtl ? 'تم' : 'Done') + '</button>' +
          '</div>'
        : '') +
      '</header>' +
      // The colour key stays in the page (js/19-audit.js reads its bucket
      // names off it) but is not shown: every card now writes its bucket out,
      // and the filter chips in the hours bar carry the same colours.
      legendHtml(id, p, rtl) +
      '<div class="imp-body-pad">' +
      // Six lines of mission statement sat between the search box and the
      // meter, on every plan, and it is read once. Folded behind one row —
      // nothing is lost, and the hours it quotes are on the title above and
      // in the Degree Audit's own table.
      (bioEn
        ? '<details class="imp-about"><summary>' + (rtl ? 'عن هذه الخطة' : 'About this plan') + '</summary>' +
          '<p>' + txt(rtl && p.bio && p.bio.ar ? p.bio.ar : bioEn) + '</p></details>'
        : '') +
      // "48 / 129H completed (37%)" — the bar underneath is the percentage,
      // and "completed" is what a progress meter means. What is left is the
      // two numbers, plus (from js/64-milestones.js, which appends into this
      // same line) the hours to the nearest requirement still open.
      // Search rides in the hours bar, behind a magnifier, because that bar
      // is the one thing that stays on screen all the way down the plan — the
      // box used to sit above it and scroll away with the header.
      '<div class="progress-widget"><div class="pw-track"><div class="pw-fill" style="width:' + pct + '%;"></div></div>' +
      '<span class="pw-num"><b>' + doneCr + ' / ' + totalCr + 'H</b></span>' +
      // Cards or List: List puts each course on one line (tick, name, hours)
      // so a whole year fits on a phone screen. Remembered per device.
      (editing ? '' : '<div class="pw-view" role="group" aria-label="' + (rtl ? 'طريقة العرض' : 'View') + '">' +
        '<button type="button" data-plan-view="cards" aria-pressed="' + (planView() === 'cards') + '">' + (rtl ? 'بطاقات' : 'Cards') + '</button>' +
        '<button type="button" data-plan-view="list" aria-pressed="' + (planView() === 'list') + '">' + (rtl ? 'قائمة' : 'List') + '</button></div>') +
      '<button type="button" class="pw-search-btn" data-pw-search="' + id + '" aria-expanded="false" aria-controls="' + id + '-courseSearchWrap" aria-label="' + (rtl ? 'ابحث عن مساق' : 'Search a course') + '">' +
        window.AAUP_ICONS.preview('search', 16) + '</button>' +
      '<div class="course-search-wrap pw-search" id="' + id + '-courseSearchWrap" hidden><div class="search-box" id="' + id + '-courseSearchBox">' +
      '<span class="search-ic">' + window.AAUP_ICONS.preview('search', 15) + '</span>' +
      '<input type="text" id="' + id + '-courseSearchInput" class="search-input" placeholder="' + (rtl ? 'ابحث عن مساق بالاسم أو الرقم…' : 'Search a course by name or code…') + '" autocomplete="off">' +
      '<button type="button" class="search-clear" id="' + id + '-courseSearchClear" aria-label="Clear">&times;</button>' +
      '</div><div class="search-dropdown" id="' + id + '-courseSearchDropdown"></div></div>' +
      '</div>';

    // Three stat chips — GPA, Credits Earned, Remaining — used to sit here,
    // on the grounds that edit mode is where a student most wants a read on
    // where they stand. It is not: edit mode is where they are moving
    // courses, and GPA is the one thing they are not doing.
    //
    // What it cost was the whole first screen. Header, legend, search,
    // About this plan, the progress bar, the filter chips and then three
    // large chips put the first course card 1,333px down an 844px phone —
    // a screen and a half of scrolling before anything editable.
    //
    // Two of the three were already on the page anyway: the progress widget
    // directly above says "0 / 132H", which is Credits Earned and Remaining
    // in one line. The third is a tap away in Degree Audit & GPA.

    html += '<div class="years"><svg id="' + id + '-connectorSvg" class="connector-layer" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><marker id="' + id + '-prereqArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 Z"></path></marker>' +
      '<marker id="' + id + '-prereqArrowActive" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 Z"></path></marker></defs></svg>';

    // Inside .years on purpose: the connector layer above is positioned in
    // this container's coordinate space, and a card pinned outside it would
    // have its prerequisite arrows drawn to the wrong place.
    html += whereAreYouHtml(id, p, rtl);

    // Each year is its own disclosure: a header button that toggles the
    // body under it. The header carries how far through that year the
    // student is, so a folded plan still answers "where am I" without
    // anything having to be opened — see js/05-year-collapse.js for the
    // state, which lives per plan and per year and starts folded.
    p.structure.years.forEach(function(y, i){
      var yearCourses = (p.courses || []).filter(function(c){ return c.yearId === y.id && !isPoolElective(c) && !isZeroHour(c); });
      var yearDone = yearCourses.filter(function(c){ return isDone(id, c.id); }).length;
      var yearHours = yearCourses.reduce(function(a, c){ return a + (parseFloat(c.creditHours) || 0); }, 0);
      var bodyId = id + '-yearbody-' + i;
      var yearFinished = yearCourses.length > 0 && yearDone === yearCourses.length;
      var yearGpa = yearFinished ? yearGpaOf(id, yearCourses) : null;
      html += '<div class="imp-year-block' + (yearFinished ? ' is-finished' : '') + '" data-year-index="' + i + '">' +
        '<div class="imp-year-header">' +
        '<button type="button" class="imp-year-toggle" aria-expanded="false" aria-controls="' + bodyId + '">' +
          '<span class="iy-chev" aria-hidden="true">' + window.AAUP_ICONS.preview('chevronRight', 15) + '</span>' +
          '<h3>' + (rtl ? 'السنة ' + (i + 1) : 'Year ' + (i + 1)) + '</h3>' +
          (yearFinished
            // A finished year reads as history: done, its hours, its GPA.
            ? '<span class="iy-done">' + window.AAUP_ICONS.preview('check', 14) + '<span>' + (rtl ? 'خلصت' : 'done') +
                ' · ' + yearHours + 'H' + (yearGpa != null ? ' · ' + (rtl ? 'المعدل ' : 'GPA ') + yearGpa.toFixed(2) : '') + '</span></span>'
            : yearRingHtml(yearDone, yearCourses.length, rtl) +
              '<span class="iy-hours">' + yearHours + 'H</span>') +
        '</button>';
      if(editing){
        html += '<div class="imp-year-actions">' +
          (y.hasSummer
            ? '<button type="button" class="home-btn" onclick="AAUP_IMPORTED.removeSummer(\'' + id + '\',\'' + y.id + '\')">' + window.AAUP_ICONS.preview('trash', 13) + (rtl ? 'إزالة الصيفي' : 'Remove Summer') + '</button>'
            : '<button type="button" class="home-btn" onclick="AAUP_IMPORTED.addSummer(\'' + id + '\',\'' + y.id + '\')">' + window.AAUP_ICONS.preview('sun', 13) + (rtl ? 'إضافة صيفي' : 'Add Summer') + '</button>') +
          '<button type="button" class="home-btn" onclick="AAUP_IMPORTED.removeYear(\'' + id + '\',\'' + y.id + '\')">' + window.AAUP_ICONS.preview('trash', 13) + (rtl ? 'إزالة السنة' : 'Remove Year') + '</button>' +
          '</div>';
      }
      html += '</div><div class="imp-year-body" id="' + bodyId + '">';
      html += semesterHtml(id, p, y.id, 's1', editing, rtl, i + 1);
      html += semesterHtml(id, p, y.id, 's2', editing, rtl, i + 1);
      if(y.hasSummer){ html += semesterHtml(id, p, y.id, 's3', editing, rtl, i + 1); }
      html += '</div></div>';
    });

    // The zero-hour requirements (Community Service…) sat above Year 1, and
    // were the first cards on the page. They move nothing on any total, so
    // they come after the degree rather than before it.
    html += pinnedHtml(id, p, rtl);
    html += unscheduledHtml(id, p, editing, rtl);

    if(editing){
      html += '<div class="imp-structure-actions">' +
        '<button type="button" class="home-btn" onclick="AAUP_IMPORTED.addYear(\'' + id + '\')">' + window.AAUP_ICONS.preview('plus', 13) + (rtl ? 'إضافة سنة' : 'Add Year') + '</button>' +
        '<button type="button" class="home-btn" onclick="AAUP_LINKS.open(\'' + id + '\')">' + window.AAUP_ICONS.preview('link', 13) + (rtl ? 'خطوط المتطلبات' : 'Prerequisite lines') + '</button>' +
        '</div>';
    }
    html += '</div>'; // closes .years

    html += '</div></div>';
    host.innerHTML = html;
    drawConnectors(id);
    initSearch(id);

    if(window.AAUP_PLAN_EDITOR){ window.AAUP_PLAN_EDITOR.bindDraggable(id); }
    // A course held in hand (js/85-carry.js) has a dimmed source card and a
    // drop slot in every semester, and this render just replaced both.
    if(window.AAUP_CARRY){ window.AAUP_CARRY.repaint(id); }
    if(window.AAUP_COMMUNITY){
      window.AAUP_COMMUNITY.refreshAllCommunityBadges();
      if(window.AAUP_COMMUNITY.syncLive) window.AAUP_COMMUNITY.syncLive(id);
    }
    // A course the student dropped out of their own plan (js/12-removed.js —
    // placed out of Intermediate English, and so on) is marked by adding a
    // class to its card. render() rebuilds every card from scratch, so that
    // class has to be re-applied here or it survives exactly until the next
    // tick of a checkbox. It never was, which meant removing a course from
    // an imported plan appeared to work and silently came back — and every
    // plan in the app is an imported plan.
    if(window.__applyRemovedCourses){ window.__applyRemovedCourses(id); }
    // The hours in the meter come from the Degree Audit, and the audit counts
    // the cards on the page — which on the first render of a plan do not
    // exist yet, because render() computes the figure before it writes them.
    // A plan therefore opened claiming "0 / 3H" until something re-rendered
    // it. Same numbers, recomputed once the cards are actually there.
    refreshMeter(id);
    if(window.__refreshCollapse){ window.__refreshCollapse(id); }
    if(window.__refreshWorkloadSummary){ window.__refreshWorkloadSummary(id); }
    if(window.__refreshMilestones){ window.__refreshMilestones(id); }
    if(window.__refreshPhoneHeader){ window.__refreshPhoneHeader(id); }
    // Both read the freshly-rebuilt cards: which semester is current moves
    // whenever a box is ticked, and the filter chips live inside the meter,
    // which render() has just replaced along with everything else.
    if(window.__refreshPlanFilter){ window.__refreshPlanFilter(id); }
    if(window.__refreshYouAreHere){ window.__refreshYouAreHere(id); }
    if(window.__refreshTabBarProgress){ window.__refreshTabBarProgress(id); }
    // Runs against the freshly-rebuilt DOM. The first call per plan (on open)
    // silently seeds already-complete semesters; later ones (after a toggle
    // re-renders) fire confetti for a semester that just became complete.
    if(window.__celebrateCheck){ window.__celebrateCheck(id); }
  }

  // Re-reads the audit against the rendered cards and writes the two numbers
  // back into the meter. js/64-milestones.js appends the "…H to <bucket>"
  // tail onto the same line right after this, so it is rebuilt too.
  function refreshMeter(planId){
    var page = document.getElementById('page-' + planId);
    var num = page && page.querySelector('.pw-num');
    if(!num || !window.AAUP_AUDIT) return;
    var totalCr = 0, doneCr = 0;
    window.AAUP_AUDIT.computeAudit(planId).forEach(function(r){ totalCr += r.total; doneCr += r.completed; });
    var pct = totalCr ? Math.round(doneCr / totalCr * 100) : 0;
    num.innerHTML = '<b>' + doneCr + ' / ' + totalCr + 'H</b>';
    var fill = page.querySelector('.pw-fill');
    if(fill){ fill.style.width = pct + '%'; }
  }

  // `opts.silent` skips the re-render and the announcement, for the bulk
  // action above: forty renders in a row is forty full rebuilds of the plan,
  // and forty screen-reader announcements is noise rather than information.
  // The caller renders and announces once at the end instead.
  function toggle(planId, slug, opts){
    if(opts && opts.silent){ toggleCourse(planId, slug); return; }
    // What was open to the student before, so the announcement below can name
    // what this tick actually changed rather than just saying "done".
    var before = {};
    (window.__openCourses ? window.__openCourses(planId) : []).forEach(function(el){ before[el.id] = true; });
    toggleCourse(planId, slug);
    render(planId);
    announceToggle(planId, slug, before);
  }

  // A tick silently unlocks other courses: the grid repaints, and a screen
  // reader user is told nothing at all. Say the consequence, not the click.
  function announceToggle(planId, slug, before){
    var node = document.getElementById('a11yAnnouncer');
    if(!node) return;
    var plan = loadImportedPlans()[planId];
    var course = plan && (plan.courses || []).filter(function(c){ return c.id === slug; })[0];
    if(!course) return;
    var rtl = window.__isRtl ? window.__isRtl(planId) : false;
    var done = isDone(planId, slug);
    var info = (window.__PLAN_DATA[planId] || {}).courseInfo || {};
    var opened = (window.__openCourses ? window.__openCourses(planId) : []).filter(function(el){
      return !before[el.id];
    }).map(function(el){
      var parts = window.__splitCourseId(el.id);
      var meta = parts && info[parts.slug];
      return meta ? (rtl && meta.ar ? meta.ar : meta.name) : '';
    }).filter(Boolean);

    var name = (rtl && course.ar) ? course.ar : course.name;
    var msg = name + ' — ' + (done ? (rtl ? 'مُنجز' : 'marked passed') : (rtl ? 'غير مُنجز' : 'marked not passed'));
    if(opened.length){
      msg += '. ' + (rtl ? 'أصبح متاحًا الآن: ' : 'Now open to you: ') + opened.slice(0, 4).join(', ') +
        (opened.length > 4 ? (rtl ? ' وغيرها' : ' and more') : '');
    }
    node.textContent = msg;

    // The same news, visibly, with an Undo — a tick is easy to land on the
    // wrong card with a thumb. What it opened up rides underneath, and an
    // achievement it earned joins the same message (js/14-storage.js) rather
    // than arriving as a second one on top.
    if(done && window.__showUnlockToast){
      var title = name + ': ' + (rtl ? 'مُنجز' : 'passed');
      var subtitle = opened.length
        ? (rtl ? 'صار متاح لك: ' : 'You can now take ') + opened.slice(0, 3).join(', ') +
          (opened.length > 3 ? (rtl ? ' وغيرها' : ' and more') : '')
        : '';
      window.__showUnlockToast(title, subtitle, {
        undoLabel: rtl ? 'تراجع' : 'Undo',
        undo: function(){ if(isDone(planId, slug)) toggle(planId, slug); }
      });
    }
  }

  // Called by the Plan Editor's applyMove() right after a successful drag —
  // updates the ACTUAL yearId/semester on the course (not a separate
  // override), since this plan's whole view regenerates from that data on
  // every interaction. Without this, a drag looked like it worked but
  // reverted the instant anything else re-rendered the view.
  function persistCourseMove(planId, slug, targetContainerId){
    var plans = loadImportedPlans();
    var p = plans[planId];
    if(!p) return;
    var course = (p.courses || []).filter(function(c){ return c.id === slug; })[0];
    if(!course) return;

    // Dropped back on the elective pool: forget where it was placed and let
    // it return to being one of the options.
    if(/-elective-/.test(targetContainerId || '')){
      delete course.placedByStudent;
      saveImportedPlans(plans);
      render(planId);
      return;
    }

    var m = /-y(\d+)-s(\d+)$/.exec(targetContainerId || '');
    if(!m) return;
    course.yearId = 'y' + m[1];
    course.semester = 's' + m[2];
    // The student has now said when they take this one, so it stops being a
    // pool option and starts being a course in that semester.
    if(course.category === 'dept'){ course.placedByStudent = true; }
    saveImportedPlans(plans);
    render(planId);
  }

  function toggleEdit(planId){
    var page = document.getElementById('page-' + planId);
    if(!page) return;
    page.classList.toggle('editing');
    var enteringEdit = page.classList.contains('editing');
    render(planId); // rebuilds the DOM the tour's step targets look for — must happen before starting it
    if(enteringEdit && window.AAUP_TUTORIAL){ window.AAUP_TUTORIAL.startWhenClear('planEditor'); }
  }

  // Flips the app, not the plan: every other screen reads the same setting,
  // and it is remembered.
  // Called by the two-button switch in the plan header (45) as well as by the
  // Settings row. `want` is optional: pressing the language you are already in
  // should do nothing rather than flip you to the other one.
  function toggleLang(planId, want){
    var isAr = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
    if(want && ((want === 'ar') === isAr)) return;
    if(window.AAUP_LANG){ window.AAUP_LANG.set(want || (isAr ? 'en' : 'ar')); }
    render(planId);
    // The menu, the tab bar and anything else already on screen were drawn in
    // the other language.
    if(window.AAUP_SIDEBAR && window.AAUP_SIDEBAR.refresh){ window.AAUP_SIDEBAR.refresh(); }
  }

  // The line under the search box read "Search a course directly, or just
  // scroll — everything's browsable too." The box's own placeholder says the
  // first half and the plan under it says the second, so it was a sentence
  // explaining a search box to people already using one. dismissSearchHint()
  // stays exported: an older cached page can still call it.
  // The magnifier in the hours bar opens the course search right there, and
  // closing it (the same button, or Escape) clears it.
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-pw-search]');
    if(!btn) return;
    var planId = btn.getAttribute('data-pw-search');
    var wrap = document.getElementById(planId + '-courseSearchWrap');
    if(!wrap) return;
    var opening = wrap.hidden;
    wrap.hidden = !opening;
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    btn.classList.toggle('is-on', opening);
    var input = document.getElementById(planId + '-courseSearchInput');
    if(opening && input){ input.focus(); }
    else if(!opening){
      var clear = document.getElementById(planId + '-courseSearchClear');
      if(clear && input && input.value){ clear.click(); }
    }
  });
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape' || !e.target || !e.target.id || !/-courseSearchInput$/.test(e.target.id)) return;
    var planId = e.target.id.replace(/-courseSearchInput$/, '');
    var btn = document.querySelector('[data-pw-search="' + planId + '"]');
    var wrap = document.getElementById(planId + '-courseSearchWrap');
    if(btn && wrap && !wrap.hidden){ btn.click(); }
  });

  // 64 · Apply the picked starting position.
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-way]');
    if(!btn) return;
    e.preventDefault();
    var planId = btn.getAttribute('data-plan');
    var plan = loadImportedPlans()[planId];
    if(!plan) return;
    var terms = planTerms(plan);
    var pick = terms[parseInt(btn.getAttribute('data-way'), 10)];
    if(!pick) return;
    var cutoff = terms.indexOf(pick);
    var rank = {};
    terms.forEach(function(t, i){ rank[t.yearId + '|' + t.sem] = i; });
    var n = 0;
    (plan.courses || []).forEach(function(c){
      // Pool electives are chosen by the student, not scheduled by the plan,
      // so "everything before this term" cannot include them.
      if(isPoolElective(c)) return;
      var r = rank[c.yearId + '|' + c.semester];
      if(r === undefined || r >= cutoff) return;
      if(!isDone(planId, c.id)){ toggle(planId, c.id, { silent: true }); n++; }
    });
    render(planId);
    if(window.__showToast){
      var rtl = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
      window.__showToast(rtl
        ? ('\u2713 حُدّد ' + n + ' مساقًا كمنجز — عدّل أي واحد لم تأخذه.')
        : ('\u2713 ' + n + ' course' + (n === 1 ? '' : 's') + ' marked done — fix any you have not taken.'));
    }
  });

  // 12 · The semester bulk action. Delegated for the same reason as the
  // language switch below: render() replaces the whole sheet.
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-sem-bulk]');
    if(!btn) return;
    e.preventDefault();
    var planId = btn.getAttribute('data-plan');
    var row = document.getElementById(btn.getAttribute('data-sem-bulk'));
    if(!planId || !row) return;
    var slugs = [].slice.call(row.querySelectorAll('.course[id]'))
      .map(function(el){ return el.id.split('-c-')[1]; })
      .filter(Boolean);
    if(!slugs.length) return;
    // Every course, one way — not a per-course toggle, which on a half-done
    // semester would flip the finished ones back off.
    var makeDone = !slugs.every(function(sl){ return isDone(planId, sl); });
    slugs.forEach(function(sl){
      if(isDone(planId, sl) !== makeDone){ toggle(planId, sl, { silent: true }); }
    });
    render(planId);
  });

  // One delegated listener for the header's language switch, bound at module
  // level so it survives every re-render of the plan (render() replaces the
  // whole sheet, so a listener attached to the buttons themselves would not).
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-plan-lang]');
    if(!btn) return;
    var sheet = btn.closest('.sheet-plan');
    var planId = sheet && sheet.id ? sheet.id.replace(/^page-/, '') : currentOpenPlanId;
    if(!planId) return;
    e.preventDefault();
    toggleLang(planId, btn.getAttribute('data-plan-lang'));
  });

  function dismissSearchHint(){
    document.querySelectorAll('.search-hint').forEach(function(el){ el.remove(); });
  }

  // ---------- legacy renderer (plans imported before this update — free-text
  // semester labels, no window.__registerPlanData registration) ----------
  function computeNeedsLegacy(prereqPairs){
    var needs = Object.create(null);
    (Array.isArray(prereqPairs) ? prereqPairs : []).forEach(function(pair){
      if(!pair || typeof pair !== 'object') return;
      var a = pair[0], b = pair[1];
      if(typeof a !== 'string' || typeof b !== 'string' || !a || !b) return;
      (needs[b] = needs[b] || []).push(a);
    });
    return needs;
  }
  function renderLegacy(id, p, host){
    var progressKey = 'aaup-imported-progress-' + id;
    var progress = {};
    try{ progress = JSON.parse(localStorage.getItem(progressKey) || '{}') || {}; }catch(e){}

    var needs = computeNeedsLegacy(p.prerequisites);
    var bySemester = {};
    p.courses.forEach(function(c){
      var sem = c.semester || 'Unspecified';
      (bySemester[sem] = bySemester[sem] || []).push(c);
    });
    function isDoneLegacy(cid){ return !!progress[cid]; }
    function isAvailableLegacy(cid){
      var reqs = needs[cid] || [];
      return reqs.every(function(r){ return isDoneLegacy(r); });
    }
    var totalCr = window.__planTotalCredits(p);
    var doneCr = window.__planEarnedCredits(p, isDoneLegacy);
    var pct = totalCr ? Math.round(doneCr / totalCr * 100) : 0;
    var en = nameParts(p.majorName.en), ar = nameParts(p.majorName.ar);

    var html = '<div class="sheet sheet-plan sheet-plan-simple">' +
      '<header><div class="header-actions"><button type="button" class="home-btn" onclick="AAUP_IMPORTED.close()"><span>' + window.AAUP_ICONS.preview('home', 15) + '</span><span>Home</span></button></div>' +
      '<h1>' + txt(en.big) + (en.small ? ' ' + txt(en.small) : '') + ' <em style="opacity:.6;font-size:.6em;">' + txt(ar.big) + (ar.small ? ' ' + txt(ar.small) : '') + '</em></h1></header>' +
      '<div class="imp-body-pad">' +
      '<p style="font-size:12px;color:var(--text-dim);">This is a community-imported plan \u2014 a simplified view without the custom prerequisite-arrow diagram the built-in majors have, but progress tracking and prerequisite locking both work normally.</p>' +
      // "48 / 129H completed (37%)" — the bar underneath is the percentage,
      // and "completed" is what a progress meter means. What is left is the
      // two numbers, plus (from js/64-milestones.js, which appends into this
      // same line) the hours to the nearest requirement still open.
      '<div class="progress-widget"><div class="pw-track"><div class="pw-fill" style="width:' + pct + '%;"></div></div>' +
      '<span class="pw-num"><b>' + doneCr + ' / ' + totalCr + 'H</b></span></div>';

    var community = window.AAUP_COMMUNITY ? window.AAUP_COMMUNITY.loadCommunity() : {};
    Object.keys(bySemester).forEach(function(sem){
      html += '<div class="imp-semester-block"><div class="imp-semester-title">' + sem + '</div><div class="imp-course-grid">';
      bySemester[sem].forEach(function(c){
        var done = isDoneLegacy(c.id);
        var avail = isAvailableLegacy(c.id);
        var locked = !done && !avail;
        var reqNames = (needs[c.id] || []).map(function(rid){
          var rc = p.courses.filter(function(cc){ return cc.id === rid; })[0];
          return rc ? rc.name : rid;
        });
        var entry = community[c.id];
        var communityBadge = '';
        if(entry){
          var avgD = entry.difficultyVotes ? (entry.totalDifficulty / entry.difficultyVotes).toFixed(1) : null;
          if(avgD){ communityBadge += '<span class="meta-badge">' + window.AAUP_ICONS.preview('star', 11) + avgD + '</span>'; }
        }
        html += '<div class="imp-course-card' + (done ? ' completed' : '') + (locked ? ' locked' : '') + '" data-imp-course="' + c.id + '">' +
          '<div class="imp-name">' + c.name + (done ? ' ✓' : '') + '</div>' +
          '<div class="imp-cr">' + c.creditHours + 'H \u00b7 ' + (c.category || '') + '</div>' +
          (locked ? '<div class="imp-lock-note">' + window.AAUP_ICONS.preview('lock', 11) + ' Requires: ' + reqNames.join(', ') + '</div>' : '') +
          (communityBadge ? '<div class="course-meta-badges" style="position:static;margin-top:6px;">' + communityBadge + '</div>' : '') +
          '</div>';
      });
      html += '</div></div>';
    });

    html += '</div></div>';
    host.innerHTML = html;

    host.querySelectorAll('[data-imp-course]').forEach(function(el){
      el.addEventListener('click', function(){
        var cid = el.getAttribute('data-imp-course');
        var canToggle = isDoneLegacy(cid) || isAvailableLegacy(cid);
        if(!canToggle) return;
        progress[cid] = !progress[cid];
        try{ localStorage.setItem(progressKey, JSON.stringify(progress)); }catch(e){}
        renderLegacy(id, p, host);
      });
    });
  }

  function open(id){
    var home = document.getElementById('home');
    if(home) home.style.display = 'none';
    (window.__PLANS || ['robotics', 'cybersecurity', 'medical', 'cs']).forEach(function(prefix){
      var el = document.getElementById('page-' + prefix);
      if(el) el.style.display = 'none';
    });
    var host = document.getElementById('importedPlanView');
    host.style.display = 'block';
    currentOpenPlanId = id;
    render(id);
    window.scrollTo(0, 0);
  }
  function close(){
    currentOpenPlanId = null;
    var host = document.getElementById('importedPlanView');
    if(host) host.style.display = 'none';
    if(window.showPage) window.showPage('home');
  }

  // Shares a plan with someone else: just its definition (name, icon, bio,
  // structure, courses, prerequisites) — deliberately NOT wasEdited or any
  // progress data, since a recipient is starting fresh, not inheriting the
  // exporter's personal completion state. The result is exactly what the
  // Developer Panel's "Import Study Plan" box (or someone else's copy of
  // this same app) expects, so the round trip just works.
  // The community pipeline: a student who built a plan for a major (or a
  // whole university) that isn't covered yet sends it to the maintainer,
  // who reviews it and ships it to everyone in the next update. If
  // APP_SUBMIT_URL is configured (a Google Form, server endpoint, etc.)
  // the exported file + that page open together; until then, a dialog
  // explains exactly what to do with the downloaded file so the flow is
  // never a dead end.
  function planBundle(id){
    var plans = loadImportedPlans();
    var p = plans[id];
    if(!p) return null;
    return {
      majorName: p.majorName, icon: p.icon, iconKey: p.iconKey, imageUrl: p.imageUrl, bio: p.bio,
      structure: p.structure, courses: p.courses, prerequisites: p.prerequisites,
      university: p.university || 'aaup', college: p.college
    };
  }

  function submitPlan(id){
    exportPlan(id);
    if(window.APP_SUBMIT_URL){
      // 'noopener' matters even for a developer-configured URL: without it the
      // opened page gets a live window.opener handle back into this one. The
      // app's own Fix analyzer flags exactly this for <a target="_blank">, so
      // the same standard applies here.
      window.open(window.APP_SUBMIT_URL, '_blank', 'noopener');
      if(window.__showToast){ window.__showToast('\ud83d\udce8 Downloaded \u2014 attach it in the form that opened'); }
      return;
    }
    var overlay = document.getElementById('devModalOverlay');
    var body = document.getElementById('devModalBody');
    if(!overlay || !body) return;
    var bundle = planBundle(id);
    var bundleText = bundle ? JSON.stringify(bundle, null, 2) : '';
    // GitHub's own URL-length limits mean a very large plan can't be
    // prefilled into the issue body \u2014 those still work fine via the
    // downloaded file attached by hand, just without the one-click part.
    var canPrefillIssue = !!(window.APP_GITHUB_REPO && bundleText && bundleText.length < 6000);
    var issueUrl = '';
    if(window.APP_GITHUB_REPO){
      var title = 'New study plan submission: ' + id;
      var lines = ['Submitted from the app\u2019s \ud83d\udce8 Contribute button.', ''];
      if(canPrefillIssue){
        lines.push('```json', bundleText, '```');
      } else {
        lines.push('_Plan JSON is too large to prefill here \u2014 attach the downloaded `' + id + '-study-plan.json` file to this issue instead._');
      }
      issueUrl = 'https://github.com/' + window.APP_GITHUB_REPO + '/issues/new?title=' +
        encodeURIComponent(title) + '&body=' + encodeURIComponent(lines.join('\n'));
    }
    body.innerHTML =
      '<h2 style="margin-top:0;">' + window.AAUP_ICONS.preview('mail', 20) + ' Thank you for contributing!</h2>' +
      '<p style="font-size:13px;">Your plan\u2019s file was just downloaded.' +
      (issueUrl
        ? ' Open a submission issue below (the plan JSON is ' + (canPrefillIssue ? 'already filled in' : 'too big to prefill \u2014 attach the downloaded file there') + '), or send the <b>.json</b> file to the app maintainer any other way you reached this app.'
        : ' Send that <b>.json</b> file to the app maintainer (however you reached this app \u2014 the group chat, the store listing\u2019s contact email, etc.) and it can be added for every student in a future update.') +
      '</p>' +
      '<p class="form-note">Plans like yours are exactly how majors that aren\u2019t covered yet get covered \u2014 someone who lived that plan writes it down once, and nobody after them has to be lost.</p>' +
      '<div class="form-actions">' +
      (issueUrl ? '<button type="button" class="home-btn" id="submitOpenIssue" style="border-color:var(--accent);color:var(--text);">\ud83d\udc19 Open submission issue</button>' : '') +
      '<button type="button" class="home-btn" id="submitClose">Close</button></div>';
    overlay.classList.add('open');
    document.getElementById('submitClose').addEventListener('click', function(){ overlay.classList.remove('open'); });
    if(document.getElementById('submitOpenIssue')){
      document.getElementById('submitOpenIssue').addEventListener('click', function(){ window.open(issueUrl, '_blank', 'noopener'); });
    }
  }

  function exportPlan(id){
    var bundle = planBundle(id);
    if(!bundle) return;
    var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = id + '-study-plan.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    if(window.__showToast){ window.__showToast('Exported — the file is in your downloads'); }
  }

  function confirmDelete(id){
    var plans = loadImportedPlans();
    var p = plans[id];
    if(!p) return;
    var en = nameParts(p.majorName.en);
    var name = en.big || id;
    var msg = 'Delete "' + name + '"? This removes the plan itself and everyone\u2019s progress in it. This can\u2019t be undone.';
    if(window.__showConfirmDialog){
      window.__showConfirmDialog(msg, function(){ deletePlan(id); });
    } else if(window.confirm(msg)){
      deletePlan(id);
    }
  }
  function deletePlan(id){
    var plans = loadImportedPlans();
    delete plans[id];
    saveImportedPlans(plans);
    try{ localStorage.removeItem('aaup-imported-progress-' + id); }catch(e){}
    if(window.__PLAN_DATA){ delete window.__PLAN_DATA[id]; }
    if(window.AAUP_STORAGE){
      var overrides = window.AAUP_STORAGE.getJSON('aaup_semesterOverrides', {});
      delete overrides[id];
      window.AAUP_STORAGE.setJSON('aaup_semesterOverrides', overrides);
    }
    if(window.__showToast){ window.__showToast('Plan deleted.'); }
    close();
  }

  // ---------- Course Library: browse every course that already exists,
  // across every built-in major and every other custom plan, for reference
  // while building this one — e.g. checking whether "Discrete Math"
  // already exists somewhere before typing it in again with a slightly
  // different id. Read-only; it doesn't add anything to the plan by
  // itself. ----------
  // Just the plan's name. planLabel() below appends the "small" subtitle so
  // two plans sharing a big name stay distinguishable in a dropdown — but on
  // the Library's own heading that subtitle is the degree line ("B.Sc. · 121
  // CH (as stated) · Program 29033"), which wrapped the title onto three
  // lines to tell a student which plan they are already inside.
  function planTitle(prefix){
    var label = planLabel(prefix);
    var cut = label.indexOf(' — ');
    return cut === -1 ? label : label.slice(0, cut);
  }

  function planLabel(prefix){
    var BUILT_IN = { robotics: 'AI & Robotics', cybersecurity: 'AI & Cybersecurity', medical: 'AI & Medical Sciences', cs: 'Computer Science' };
    if(BUILT_IN[prefix]) return BUILT_IN[prefix];
    var plans = loadImportedPlans();
    var p = plans[prefix];
    if(p){
      // Append the "small" subtitle when present so two plans that share a
      // big name (e.g. this app's built-in "Computer Science" and a feed
      // plan called "Computer Science — Minor: ...") don't render as
      // identical, indistinguishable entries in this dropdown.
      var parts = nameParts(p.majorName.en);
      var big = parts.big || prefix;
      return parts.small ? (big + ' — ' + parts.small) : big;
    }
    return prefix;
  }
  function allKnownCourses(){
    // Built-in majors register themselves at page load; an imported plan
    // only registers once it's actually been opened this session — make
    // sure every one of them is registered here too, or the library would
    // silently miss any custom plan nobody has visited yet.
    var imported = loadImportedPlans();
    Object.keys(imported).forEach(function(pid){
      if(!window.__PLAN_DATA[pid] && hasStructure(imported[pid])){ registerPlan(pid, imported[pid]); }
    });
    var out = [];
    var data = window.__PLAN_DATA || {};
    Object.keys(data).forEach(function(prefix){
      var info = data[prefix].courseInfo || {};
      Object.keys(info).forEach(function(slug){
        out.push({ prefix: prefix, slug: slug, name: info[slug].name, ar: info[slug].ar,
                    cr: info[slug].cr, num: info[slug].num, req: info[slug].req || '' });
      });
    });
    return out;
  }
  // Same order and wording the Degree Audit and My Path use (js/53-roadmap.js
  // BUCKET_ORDER / BUCKET_META), so a bucket is named identically wherever a
  // student meets it.
  var LIB_BUCKET_ORDER = ['univReq', 'univElec', 'colgReq', 'specReq', 'specElec', 'freeElec', 'supportCourses'];
  // Written out in full: "Colg. Req." and "Spec. Elec." are the
  // registrar's shorthand, and a first-year student browsing courses has no
  // reason to know it. Each shelf wears its bucket's colour (BUCKET_CLASS,
  // the plan legend's own palette) so the two screens match.
  var LIB_BUCKET_LABEL = {
    univReq: 'University requirements', univElec: 'University electives', colgReq: 'College requirements',
    specReq: 'Major requirements', specElec: 'Major electives', freeElec: 'Free electives',
    supportCourses: 'Support courses', _none: 'Not categorised'
  };
  var LIB_ELECTIVE = { univElec: true, specElec: true, freeElec: true };

  // The library is English-only for now, so it keeps left-to-right reading
  // even while the rest of the app is mirrored for Arabic.
  function openLibrary(currentPlanId){
    var overlay = document.getElementById('devModalOverlay');
    var body = document.getElementById('devModalBody');
    if(!overlay || !body) return;
    var courses = allKnownCourses();
    var prefixes = {};
    courses.forEach(function(c){ prefixes[c.prefix] = true; });
    var prefixList = Object.keys(prefixes).sort(function(a, b){ return planLabel(a).localeCompare(planLabel(b)); });

    function showPicker(){
      body.innerHTML = '<div dir="ltr">' +
        '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('book', 20) + 'Course Library</h2>' +
        '<p class="form-note" style="margin-top:-6px;">Choose a study plan to browse its courses.</p>' +
        (currentPlanId ? '<p class="form-note" style="margin-top:-2px;">Currently in <b>' + window.__escapeHtml(planLabel(currentPlanId)) + '</b>.</p>' : '') +
        '<div class="form-field"><label for="libPlanSelect">Study plan</label><select id="libPlanSelect">' +
        '<option value="">— choose a plan —</option>' +
        prefixList.map(function(pref){ return '<option value="' + pref + '">' + planLabel(pref) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="form-actions"><button type="button" class="home-btn" id="libClose">Close</button></div></div>';
      overlay.classList.add('open');
      document.getElementById('libClose').addEventListener('click', function(){ overlay.classList.remove('open'); });
      document.getElementById('libPlanSelect').addEventListener('change', function(e){
        if(e.target.value){ showBrowse(e.target.value); }
      });
    }

    // Opening the Library from inside a plan used to land on an empty "choose
    // a study plan" dropdown — asking a question the student had already
    // answered by being there. Go straight to their plan's courses; the
    // "Choose a different plan" button at the top is how they get to another.
    function start(){
      if(currentPlanId && prefixes[currentPlanId]){ showBrowse(currentPlanId); }
      else { showPicker(); }
    }

    function showBrowse(browsePrefix){
      var list = courses.filter(function(c){ return c.prefix === browsePrefix; });
      var currentIsSame = browsePrefix === currentPlanId;

      // Shelves, not one undifferentiated scroll. A plan's courses are
      // grouped by the requirement each one satisfies — the university's own
      // taxonomy, now that every course carries it — so browsing answers the
      // question a student actually arrives with ("what counts as a Spec.
      // Elec.?") instead of making them read 130 rows to find out. Each shelf
      // states its own count and hours, and courses whose plan published no
      // requirement data fall into one honest "Not categorised" shelf rather
      // than being silently assigned to a bucket nobody said they were in.
      var reqHours = (loadImportedPlans()[browsePrefix] || {}).requirementHours || {};
      var progress = window.__getProgress ? window.__getProgress() : {};
      function shelvesFor(filtered){
        var byBucket = {};
        filtered.forEach(function(c){
          var k = LIB_BUCKET_ORDER.indexOf(c.req) !== -1 ? c.req : '_none';
          (byBucket[k] = byBucket[k] || []).push(c);
        });
        return LIB_BUCKET_ORDER.concat(['_none']).filter(function(k){
          return byBucket[k] && byBucket[k].length;
        }).map(function(k){
          var items = byBucket[k];
          var hours = items.reduce(function(a, c){ return a + (Number(c.cr) || 0); }, 0);
          // What the bucket asks for (the plan's published figure) and how
          // much of it this student has finished — done is only meaningful
          // on a plan they are actually following, so other majors show 0.
          var need = reqHours[k] ? Number(reqHours[k]) : 0;
          var done = items.reduce(function(a, c){
            var pid = window.AAUP_GPA && window.AAUP_GPA.primaryId ? window.AAUP_GPA.primaryId(browsePrefix, c.slug) : (browsePrefix + '-c-' + c.slug);
            return a + (progress[pid] ? (Number(c.cr) || 0) : 0);
          }, 0);
          // An elective shelf lists the options; "pick 3" says how many of
          // them the degree wants, from the hours it needs over the usual size.
          var pick = 0;
          if(LIB_ELECTIVE[k] && need){
            var sizes = {};
            items.forEach(function(c){ var n = Number(c.cr) || 0; if(n) sizes[n] = (sizes[n] || 0) + 1; });
            var unit = Number(Object.keys(sizes).sort(function(a, b){ return sizes[b] - sizes[a]; })[0]) || 3;
            pick = Math.max(1, Math.round(need / unit));
          }
          return { key: k, label: LIB_BUCKET_LABEL[k], items: items, hours: hours, need: need, done: Math.min(done, need || done), pick: pick };
        });
      }

      function rowHtml(c){
        // The registration number, not the internal slug. Half these rows
        // were printing things like "arabic-language" beside the name — an
        // id this app made up, which means nothing to a student and nothing
        // to the registrar either. Courses whose plan carries no number show
        // just the hours rather than a placeholder dash.
        var num = c.num && c.num !== '-' ? window.__escapeHtml(String(c.num)) + ' · ' : '';
        return '<div class="lib-row">' +
          '<span class="lib-row-name">' + window.__escapeHtml(c.name) +
            ' <span class="lib-row-meta">' + num + c.cr + 'H</span></span>' +
          (currentIsSame ? '' : '<button type="button" class="home-btn lib-add-btn" data-slug="' + window.__escapeHtml(c.slug) + '">' +
            window.AAUP_ICONS.preview('plus', 13) + 'Add</button>') +
          '</div>';
      }

      function renderList(filterText){
        var f = (filterText || '').toLowerCase();
        // Match the course code as well as the name — the code is what a
        // student has in front of them on a registration screen.
        var filtered = list.filter(function(c){
          return !f || c.name.toLowerCase().indexOf(f) !== -1 || String(c.slug).toLowerCase().indexOf(f) !== -1;
        });
        if(filtered.length === 0){ return '<p class="ex-note">No matching courses.</p>'; }
        var shelves = shelvesFor(filtered);
        // One shelf and nothing to compare it against is not a shelf — that
        // is the flat list this replaced, with a redundant header on top.
        if(shelves.length === 1){ return shelves[0].items.map(rowHtml).join(''); }
        // Closed until asked for. Every shelf open at once put a hundred and
        // thirty rows on the screen the moment the Library opened, which is
        // the same wall the shelves were meant to break up — the sections are
        // the answer to "what counts as a Spec. Elec.", and you only want the
        // one you asked about. A search that matched is opened, since
        // hiding the thing someone just searched for would be perverse.
        var openAll = !!f;
        return shelves.map(function(sh, i){
          var id = 'libShelf' + i;
          var cls = BUCKET_CLASS[sh.key] || 'misc';
          var total = sh.need || sh.hours;
          var pct = total ? Math.round(sh.done / total * 100) : 0;
          var sub = sh.pick ? 'pick ' + sh.pick : sh.items.length + (sh.items.length === 1 ? ' course' : ' courses');
          return '<div class="lib-shelf' + (openAll ? ' lib-shelf-open' : '') + '" style="--lib-c:var(--' + cls + ')">' +
            '<button type="button" class="lib-shelf-head" data-lib-shelf="' + id + '"' +
              ' aria-expanded="' + (openAll ? 'true' : 'false') + '" aria-controls="' + id + '">' +
              '<span class="lib-shelf-dot" aria-hidden="true"></span>' +
              '<span class="lib-shelf-main"><span class="lib-shelf-label">' + sh.label + '</span>' +
                '<span class="lib-shelf-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span></span>' +
              '<span class="lib-shelf-count"><span><b>' + sh.done + '</b> of ' + total + ' hours</span><span>' + sub + '</span></span>' +
              '<span class="lib-shelf-chev" aria-hidden="true">' + window.AAUP_ICONS.preview('chevronRight', 14) + '</span>' +
            '</button>' +
            '<div class="lib-shelf-body" id="' + id + '">' + sh.items.map(rowHtml).join('') + '</div>' +
            '</div>';
        }).join('');
      }

      // "Change plan" at the top of a screen for looking courses up read as
      // "switch the major I'm on". What it did was browse another major's
      // courses, so it says that, as a small switch beside the name.
      body.innerHTML = '<div dir="ltr">' +
        '<div class="lib-head"><span class="lib-head-ic">' + window.AAUP_ICONS.preview('book', 20) + '</span>' +
          '<h2 class="lib-title">Browse Courses</h2></div>' +
        '<div class="lib-showing"><span>Showing <b>' + window.__escapeHtml(planTitle(browsePrefix)) + '</b></span>' +
          '<button type="button" class="lib-other" id="libBack">Other major' + window.AAUP_ICONS.preview('chevron', 13) + '</button></div>' +
        '<div class="form-field"><input type="text" id="libSearch" aria-label="Search courses" placeholder="Search by name or course code…"></div>' +
        '<div id="libList" class="lib-list"></div>' +
        '<div class="form-actions"><button type="button" class="home-btn" id="libClose">Close</button></div></div>';
      document.getElementById('libList').innerHTML = renderList('');
      overlay.classList.add('open');

      document.getElementById('libBack').addEventListener('click', showPicker);
      document.getElementById('libClose').addEventListener('click', function(){ overlay.classList.remove('open'); });
      document.getElementById('libSearch').addEventListener('input', function(e){
        document.getElementById('libList').innerHTML = renderList(e.target.value);
        bindAddButtons();
      });
      bindAddButtons();

      // Delegated on the list, which survives every re-render — only its
      // innerHTML is replaced — so this binds once instead of once per
      // keystroke in the search box.
      var listEl = document.getElementById('libList');
      listEl.addEventListener('click', function(e){
        var head = e.target.closest('[data-lib-shelf]');
        if(!head) return;
        var shelf = head.closest('.lib-shelf');
        if(!shelf) return;
        var isOpen = shelf.classList.toggle('lib-shelf-open');
        head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });

      function bindAddButtons(){
        document.querySelectorAll('.lib-add-btn').forEach(function(btn){
          btn.addEventListener('click', function(){
            var slug = btn.getAttribute('data-slug');
            var course = list.filter(function(c){ return c.slug === slug; })[0];
            if(course){ showTargetPicker(course); }
          });
        });
      }
    }

    function showTargetPicker(course){
      var plans = loadImportedPlans();
      var target = plans[currentPlanId];
      if(!target || !hasStructure(target)){ overlay.classList.remove('open'); return; }
      var alreadyExists = (target.courses || []).some(function(c){ return c.id === course.slug; });

      var yearOptions = target.structure.years.map(function(y, i){
        return '<option value="' + y.id + '|s1">Year ' + (i + 1) + ' — First Semester</option>' +
          '<option value="' + y.id + '|s2">Year ' + (i + 1) + ' — Second Semester</option>' +
          (y.hasSummer ? '<option value="' + y.id + '|s3">Year ' + (i + 1) + ' — Summer</option>' : '');
      }).join('');

      body.innerHTML = '<div dir="ltr">' +
        '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('plus', 20) + 'Add "' + course.name + '"</h2>' +
        (alreadyExists
          ? '<p class="dev-error-msg">This plan already has a course with the same ID (' + course.slug + '). Adding it again isn\u2019t possible from here — check the plan first.</p>' +
            '<div class="form-actions"><button type="button" class="home-btn" id="libTargetBack">← Back</button></div>'
          : '<div class="form-field"><label for="libTargetSem">Add to which semester?</label><select id="libTargetSem">' + yearOptions + '</select></div>' +
            '<p class="form-note">Same name, ID, category, and credit hours as the original — prerequisites aren\u2019t copied, since they depend on what already exists in this plan.</p>' +
            '<div class="form-actions"><button type="button" class="home-btn" id="libTargetBack">← Back</button>' +
            '<button type="button" class="home-btn" id="libTargetConfirm" style="border-color:var(--accent);color:var(--text);">Add to Plan</button></div>') + '</div>';
      overlay.classList.add('open');

      document.getElementById('libTargetBack').addEventListener('click', function(){ showBrowse(course.prefix); });
      var confirmBtn = document.getElementById('libTargetConfirm');
      if(confirmBtn){
        confirmBtn.addEventListener('click', function(){
          var parts = document.getElementById('libTargetSem').value.split('|');
          var plansNow = loadImportedPlans();
          var p = plansNow[currentPlanId];
          var info = (window.__PLAN_DATA[course.prefix] || {}).courseInfo || {};
          var srcInfo = info[course.slug] || {};
          p.courses.push({
            id: course.slug, name: course.name, ar: srcInfo.ar || course.name,
            creditHours: parseFloat(course.cr) || 0, category: srcInfo.category || inferCategoryFromCard(course.prefix, course.slug),
            yearId: parts[0], semester: parts[1]
          });
          p.wasEdited = true;
          p.prerequisites = p.prerequisites || [];
          saveImportedPlans(plansNow);
          runAutoLink(currentPlanId, course.slug);
          overlay.classList.remove('open');
          if(window.__showToast){ window.__showToast('Added "' + course.name + '" to this plan'); }
          render(currentPlanId);
        });
      }
    }

    function inferCategoryFromCard(prefix, slug){
      var el = document.getElementById(prefix + '-c-' + slug);
      if(!el) return 'core';
      var known = ['core','math','dept','eng','uni','free','skills'];
      for(var i = 0; i < known.length; i++){ if(el.classList.contains(known[i])) return known[i]; }
      return 'core';
    }

    start();
  }

  window.AAUP_IMPORTED = {
    open: open, close: close, plansChanged: plansChanged, loadImportedPlans: loadImportedPlans,
    saveImportedPlans: saveImportedPlans, toggle: toggle, toggleEdit: toggleEdit,
    addYear: addYear, removeYear: removeYear, addSummer: addSummer, removeSummer: removeSummer,
    addCoursePrompt: openCourseCreatePopup, ICONS: ICONS, nameParts: nameParts, hasStructure: hasStructure,
    compareByDisplayOrder: compareByDisplayOrder,
    confirmDelete: confirmDelete, deletePlan: deletePlan,
    // Exposed for js/74-course-gestures.js, which shows the same trace under
    // its action sheet rather than re-implementing the walk over the edges.
    traceCourse: handleCourseHoverEnter, untraceCourse: handleCourseHoverLeave,
    // Exposed for js/49-course-detail.js (57) and anything else that wants to
    // ask what a course is holding open.
    closesIfDropped: closesIfDropped, chainDepth: chainDepth,
    toggleLang: toggleLang, openLibrary: openLibrary, bucketsInPlan: bucketsInPlan,
    dismissSearchHint: dismissSearchHint,
    persistCourseMove: persistCourseMove, confirmRemoveCourse: confirmRemoveCourse, removeCourse: removeCourse,
    // Programmatic course creation, for callers that already have every field
    // and do not want the popup — the assistant (js/46-assistant-ai.js) after
    // a student has confirmed the change. Deliberately the SAME function the
    // popup itself submits to, so a course added by the assistant gets the
    // identical duplicate-id check, transitive prerequisite reduction,
    // auto-link pass, and re-render. `overlay` is null: there is no dialog to
    // close. Do not reimplement this elsewhere; that is how two ways of
    // adding a course start behaving differently.
    addCourseDirect: function (planId, yearId, semester, nameEn, nameAr, id, credits, category, prereqIds) {
      return finalizeCourseCreation(planId, yearId, semester, nameEn, nameAr, id,
                                    credits, category, prereqIds || [], null);
    },
    exportPlan: exportPlan, submitPlan: submitPlan, editCoursePrompt: openCourseEditPopup, runAutoLink: runAutoLink,
    planBundle: planBundle,
    refresh: render, openGradePrompt: openGradePrompt, collegeKeyForPlan: collegeKeyForPlan,
    // Re-measure and redraw the prerequisite lines without rebuilding the
    // plan. Folding/unfolding a year (js/05-collapse-finished-years.js)
    // reflows the grid under the connector layer, and a full render() there
    // would throw away scroll position and the search box's state.
    redrawConnectors: drawConnectors,
    openCourseModal: openCourseModal,
    notePending: notePending
  };

  // If the person somehow navigates to a built-in plan while an imported
  // one is open, make sure the imported view gets tucked away too.
  var _origShowPage = window.showPage;
  if(typeof _origShowPage === 'function'){
    window.showPage = function(id){
      var host = document.getElementById('importedPlanView');
      if(host && id !== '__imported__'){ host.style.display = 'none'; }
      return _origShowPage(id);
    };
  }

  var resizeT = null;
  window.addEventListener('resize', function(){
    if(!currentOpenPlanId) return;
    var host = document.getElementById('importedPlanView');
    if(!host || host.style.display === 'none') return;
    if(resizeT) clearTimeout(resizeT);
    resizeT = setTimeout(function(){ drawConnectors(currentOpenPlanId); }, 120);
  });

  function init(){
    // One-time cleanup of plans saved BEFORE imports were sanitized —
    // anything already sitting in storage with markup in its names gets
    // the same escape-and-reslugify pass new imports now get at the door.
    // __sanitizeImportedPlan is idempotent, so on every later boot this
    // finds nothing to change and skips the write entirely.
    try{
      if(window.__sanitizeImportedPlan){
        var stored = loadImportedPlans();
        var before = JSON.stringify(stored);
        Object.keys(stored).forEach(function(pid){
          stored[pid] = window.__sanitizeImportedPlan(stored[pid]);
        });
        if(JSON.stringify(stored) !== before){ saveImportedPlans(stored); }
      }
    }catch(e){ /* never let a migration failure stop the app from loading */ }
    bindCourseModal();
    plansChanged();
  }
  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }
})();
