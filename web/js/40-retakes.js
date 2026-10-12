// ==========================
// COURSE RETAKES
// ==========================
// Setting a grade of F automatically schedules a retake in the next
// available regular semester, so a failed requirement never just quietly
// sits there unaddressed. Two things this deliberately keeps separate:
//   - GPA (AAUP_GPA.gpaFor) needs BOTH the F and the eventual retake grade
//     to count — that's just "every graded attempt contributes its own
//     credit-weighted grade point," which the existing formula already
//     does correctly with no changes, as long as both are registered as
//     real, separately-graded courses.
//   - Degree-progress credit hours (computeStats / computeAudit) must NOT
//     count the same requirement twice — once a retake exists, the
//     original is excluded from both "required" and "completed" totals
//     there, and the retake alone represents that requirement going
//     forward. window.__isSupersededByRetake() is the one shared check
//     both of those functions use for this.
(function(){
  function loadRetakes(){ return window.AAUP_STORAGE.getJSON('aaup_retakes', {}); }
  function saveRetakes(m){ window.AAUP_STORAGE.setJSON('aaup_retakes', m); }

  function isSuperseded(prefix, slug){
    var all = loadRetakes();
    return !!(all[prefix] && all[prefix][slug]);
  }

  function retakeSlugFor(prefix, slug){
    var all = loadRetakes();
    return all[prefix] && all[prefix][slug];
  }

  // Smallest-order regular semester (never summer) strictly after the
  // course's current one — summer isn't assumed, since not everyone takes
  // summer courses, and picking one automatically could mislead a student
  // into thinking they must.
  function nextRegularContainer(prefix, fromContainerId){
    if(!window.AAUP_PLAN_EDITOR) return null;
    var page = document.getElementById('page-' + prefix);
    if(!page) return null;
    var fromOrder = window.AAUP_PLAN_EDITOR.orderOfContainerId(fromContainerId);
    if(fromOrder === null) return null;
    var rows = Array.prototype.slice.call(page.querySelectorAll('.course-row[id]'))
      .filter(function(row){ return !/-s3$/.test(row.id); })
      .map(function(row){ return { row: row, order: window.AAUP_PLAN_EDITOR.orderOfContainerId(row.id) }; })
      .filter(function(r){ return r.order !== null && r.order > fromOrder; })
      .sort(function(a, b){ return a.order - b.order; });
    return rows.length ? rows[0].row : null;
  }

  var KNOWN_CATEGORIES = ['core', 'math', 'dept', 'eng', 'uni', 'free', 'skills'];
  function categoryOf(el){
    for(var i = 0; i < KNOWN_CATEGORIES.length; i++){ if(el.classList.contains(KNOWN_CATEGORIES[i])) return KNOWN_CATEGORIES[i]; }
    return 'core';
  }

  function createRetake(prefix, slug, force){
    if(!force && isSuperseded(prefix, slug)) return; // already has one
    var originalEl = document.getElementById(prefix + '-c-' + slug);
    if(!originalEl) return;
    var currentContainer = originalEl.closest('.course-row[id]');
    if(!currentContainer) return;
    var targetRow = nextRegularContainer(prefix, currentContainer.id);
    if(!targetRow){
      if(window.__showToast){ window.__showToast(window.__L('No later semester \u2014 place it yourself', 'ما في فصل بعده \u2014 حطّه بنفسك')); }
      return;
    }

    var data = window.__PLAN_DATA[prefix] || {};
    var meta = (data.courseInfo || {})[slug] || {};
    var cat = categoryOf(originalEl);
    var baseName = meta.name || (originalEl.querySelector('.name') || {}).textContent || slug;
    var baseAr = meta.ar || '';
    var retakeSlug = slug + '--retake';
    var retakeName = baseName + ' (Retake)';
    var retakeAr = baseAr ? (baseAr + ' (إعادة)') : '';
    var m = /-y(\d+)-s(\d+)$/.exec(targetRow.id || '');

    // Recorded BEFORE the plan is re-rendered below: the cards read this map
    // to mark which attempt was replaced and which one counts, and writing it
    // afterwards meant the original card only picked that up on some later
    // re-render.
    var all = loadRetakes();
    all[prefix] = all[prefix] || {};
    all[prefix][slug] = retakeSlug;
    saveRetakes(all);

    var isImported = !!(window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()[prefix]);
    if(isImported && m){
      // Imported plans fully re-render their DOM from p.courses[] on every
      // interaction — a directly-appended node here would vanish the
      // instant anything else re-rendered (the exact same class of bug as
      // the drag-and-drop persistence issue found earlier). This needs to
      // become real, saved course data instead, using the same "add
      // course" path everything else already goes through.
      var plans = window.AAUP_IMPORTED.loadImportedPlans();
      var plan = plans[prefix];
      if(!plan) return;
      plan.courses.push({
        id: retakeSlug, name: retakeName, ar: retakeAr,
        creditHours: parseFloat(meta.cr) || 0, category: cat,
        yearId: 'y' + m[1], semester: 's' + m[2], isRetake: true
      });
      window.AAUP_IMPORTED.saveImportedPlans(plans);
      window.AAUP_IMPORTED.refresh(prefix);
    } else {
      // Built-in majors are static, persistent HTML — a directly-appended
      // node here is safe and permanent (nothing ever regenerates this
      // page's DOM from scratch), so it's simpler to just insert it.
      var card = document.createElement('div');
      card.className = 'course ' + cat + ' retake-course';
      card.id = prefix + '-c-' + retakeSlug;
      var nameDiv = document.createElement('div');
      nameDiv.className = 'name';
      nameDiv.setAttribute('data-ar', retakeAr);
      nameDiv.textContent = retakeName;
      card.appendChild(nameDiv);
      var badge = document.createElement('span');
      badge.className = 'retake-badge';
      badge.textContent = '\u21bb ' + window.__L('Retake', 'إعادة');
      card.appendChild(badge);
      targetRow.appendChild(card);

      var openModalFn = window['__openCourseModal_' + prefix];
      if(openModalFn){ card.addEventListener('click', function(){ openModalFn(retakeSlug); }); }

      // Register with the same courseInfo/needsMap bridge every other
      // feature already reads from, so GPA, the Advisor, achievements,
      // etc. all see this as a completely normal course.
      if(data.courseInfo){
        data.courseInfo[retakeSlug] = {
          num: '-', name: retakeName, th: meta.th || '-', pr: meta.pr || '-',
          cr: meta.cr || '0', prereq: meta.prereq || '-', ar: retakeAr
        };
      }
      if(data.needsMap){
        // Same prerequisites as the original — if you needed them to take
        // it the first time, retaking it doesn't waive that.
        data.needsMap[retakeSlug] = (data.needsMap[slug] || []).slice();
      }
      if(window.__injectCheckboxes){ window.__injectCheckboxes(); }
    }

    if(window.__showToast){ window.__showToast(window.__L('Auto-scheduled a retake of "' + baseName + '" next semester.', 'انجدولت إعادة «' + baseName + '» للفصل الجاي.')); }
  }

  function removeRetakeIfUntouched(prefix, slug){
    var all = loadRetakes();
    var retakeSlug = all[prefix] && all[prefix][slug];
    if(!retakeSlug) return;
    var progress = window.__getProgress ? window.__getProgress() : {};
    var grades = window.AAUP_GPA ? window.AAUP_GPA.loadGrades() : {};
    var retakeId = prefix + '-c-' + retakeSlug;
    // Only clean it up if nothing has actually happened to it yet — never
    // silently delete real progress or a grade someone already entered.
    if(progress[retakeId] || grades[retakeId]) return;

    var isImported = !!(window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()[prefix]);
    if(isImported){
      var plans = window.AAUP_IMPORTED.loadImportedPlans();
      var plan = plans[prefix];
      if(plan){
        plan.courses = (plan.courses || []).filter(function(c){ return c.id !== retakeSlug; });
        plan.prerequisites = (plan.prerequisites || []).filter(function(p){ return p[0] !== retakeSlug && p[1] !== retakeSlug; });
        window.AAUP_IMPORTED.saveImportedPlans(plans);
        window.AAUP_IMPORTED.refresh(prefix);
      }
    } else {
      var el = document.getElementById(retakeId);
      if(el) el.remove();
    }
    var data = window.__PLAN_DATA[prefix];
    if(data && data.courseInfo){ delete data.courseInfo[retakeSlug]; }
    if(data && data.needsMap){ delete data.needsMap[retakeSlug]; }
    delete all[prefix][slug];
    saveRetakes(all);
  }

  // Re-creates every saved retake for a plan on load, before its first
  // draw — same pattern as the Plan Editor's replayOverrides().
  function replayRetakes(prefix){
    var all = loadRetakes();
    var forPlan = all[prefix];
    if(!forPlan) return;
    Object.keys(forPlan).forEach(function(slug){
      var retakeSlug = forPlan[slug];
      if(document.getElementById(prefix + '-c-' + retakeSlug)) return; // already there
      createRetake(prefix, slug, true); // force=true: we already know this one is supposed to exist
    });
  }

  window.__isSupersededByRetake = isSuperseded;

  // Shared by every grade-setting UI (the built-in majors' course modal,
  // and the imported-plans' lightweight grade popup) so the retake-trigger
  // logic only has to live in one place. Returns nothing; saves the grade
  // and reacts to an F transition either way.
  function applyGradeChange(prefix, pid, newGrade){
    var grades = window.AAUP_GPA.loadGrades();
    var previousGrade = grades[pid];
    if(newGrade){ grades[pid] = newGrade; } else { delete grades[pid]; }
    window.AAUP_GPA.saveGrades(grades);
    var primarySlug = window.__splitCourseId ? window.__splitCourseId(pid).slug : pid;
    // F, FA and W all mean the course must be retaken. Trigger (or clear) the
    // retake slot on any transition into/out of that non-passing set.
    var nonPass = window.AAUP_GPA.isNonPassing;
    if(nonPass(newGrade) && !nonPass(previousGrade)){
      createRetake(prefix, primarySlug);
    } else if(nonPass(previousGrade) && !nonPass(newGrade)){
      removeRetakeIfUntouched(prefix, primarySlug);
    }
  }
  window.__applyGradeChange = applyGradeChange;
  window.AAUP_RETAKES = {
    createRetake: createRetake, removeRetakeIfUntouched: removeRetakeIfUntouched,
    replayRetakes: replayRetakes, isSuperseded: isSuperseded, retakeSlugFor: retakeSlugFor
  };
})();
