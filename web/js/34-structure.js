// ==========================
// PLAN STRUCTURE EDITING FOR THE BUILT-IN MAJORS (extra years + summer
// semesters). An imported plan is re-rendered from its own JSON on every
// interaction, so AAUP_IMPORTED.addYear/addSummer just edit that JSON. The
// four built-in majors are static HTML instead, so their extra rows are
// recorded here and re-injected into the DOM on every load — same student-
// owned overlay idea as the prerequisite corrections, and equally reversible.
// ==========================
(function(){
  var BUILT_IN = ['robotics', 'cybersecurity', 'medical', 'cs'];
  var KEY = 'aaup_structureEdits';

  function load(){ return window.AAUP_STORAGE.getJSON(KEY, {}); }
  function save(m){ window.AAUP_STORAGE.setJSON(KEY, m); }
  function forPlan(prefix){
    var m = load()[prefix] || {};
    return { extraYears: m.extraYears || 0, summers: m.summers || [] };
  }
  function setForPlan(prefix, val){
    var m = load();
    if(!val.extraYears && !val.summers.length){ delete m[prefix]; }
    else { m[prefix] = { extraYears: val.extraYears, summers: val.summers }; }
    save(m);
  }
  function isRtl(prefix){ return window.__isRtl ? window.__isRtl(prefix) : false; }

  function yearsContainer(prefix){
    var page = document.getElementById('page-' + prefix);
    return page ? page.querySelector('.years') : null;
  }
  function yearRowFor(prefix, yearId){
    var first = document.getElementById(prefix + '-' + yearId + '-s1');
    return first ? first.closest('.year-row') : null;
  }
  // How many years the published plan itself ships with — user-added ones
  // carry data-user-year so they never get counted as official.
  function baseYearCount(prefix){
    var c = yearsContainer(prefix);
    if(!c) return 0;
    return c.querySelectorAll('.year-row:not([data-user-year])').length;
  }
  function semesterHasCourses(prefix, yearId, sem){
    var row = document.getElementById(prefix + '-' + yearId + '-s' + sem);
    return !!(row && row.querySelector('.course[id]'));
  }

  function makeSem(prefix, yearId, sem, labelEn, labelAr){
    var wrap = document.createElement('div');
    wrap.className = 'sem';
    var label = document.createElement('div');
    label.className = 'sem-label';
    label.setAttribute('data-ar', labelAr);
    label.textContent = labelEn;
    var row = document.createElement('div');
    row.className = 'course-row';
    row.id = prefix + '-' + yearId + '-s' + sem;
    wrap.appendChild(label);
    wrap.appendChild(row);
    return wrap;
  }

  function makeYearRow(prefix, yearNum){
    var yearId = 'y' + yearNum;
    var row = document.createElement('div');
    row.className = 'year-row';
    row.setAttribute('data-user-year', yearId);

    var badge = document.createElement('div');
    badge.className = 'year-badge';
    var num = document.createElement('div');
    num.className = 'num';
    var numSpan = document.createElement('span');
    numSpan.textContent = String(yearNum);
    num.appendChild(numSpan);
    var label = document.createElement('div');
    label.className = 'label';
    // Ordinal words are only authored for years 1-4 in the shipped plans; an
    // added year gets the plain numeric form rather than a guessed ordinal.
    label.setAttribute('data-ar-html', 'السنة<br>' + yearNum);
    label.innerHTML = 'Year<br>' + yearNum;

    badge.appendChild(num);
    badge.appendChild(label);

    var sems = document.createElement('div');
    sems.className = 'semesters';
    sems.appendChild(makeSem(prefix, yearId, 1, 'First semester', 'الفصل الأول'));
    var div = document.createElement('div');
    div.className = 'divider';
    sems.appendChild(div);
    sems.appendChild(makeSem(prefix, yearId, 2, 'Second semester', 'الفصل الثاني'));

    row.appendChild(badge);
    row.appendChild(sems);
    return row;
  }

  // Idempotent: brings the DOM in line with what's stored, adding only what's
  // missing. Safe to call repeatedly (load, after an edit, after a language
  // flip) without ever duplicating a row.
  function apply(prefix){
    var container = yearsContainer(prefix);
    if(!container) return;
    var state = forPlan(prefix);
    var base = baseYearCount(prefix);

    // Extra years go before the electives pool / special rows so the grid
    // still reads top-to-bottom in year order.
    var anchor = container.querySelector('.electives-row');
    for(var i = 1; i <= state.extraYears; i++){
      var yearNum = base + i;
      if(yearRowFor(prefix, 'y' + yearNum)) continue;
      var el = makeYearRow(prefix, yearNum);
      if(anchor){ container.insertBefore(el, anchor); }
      else { container.appendChild(el); }
    }

    state.summers.forEach(function(yearId){
      if(document.getElementById(prefix + '-' + yearId + '-s3')) return;
      var yr = yearRowFor(prefix, yearId);
      if(!yr) return;
      var sems = yr.querySelector('.semesters');
      if(!sems) return;
      var div = document.createElement('div');
      div.className = 'divider';
      sems.appendChild(div);
      sems.appendChild(makeSem(prefix, yearId, 3, 'Summer semester', 'الفصل الصيفي'));
    });

    renderControls(prefix);
  }

  // ---- edit-mode controls (only visible inside .editing, via CSS) ----
  function renderControls(prefix){
    var container = yearsContainer(prefix);
    if(!container) return;
    var rtl = isRtl(prefix);
    var state = forPlan(prefix);

    container.querySelectorAll('.year-row').forEach(function(yr){
      var firstRow = yr.querySelector('.course-row[id]');
      var m = firstRow ? /-y(\d+)-s\d$/.exec(firstRow.id) : null;
      if(!m) return;
      var yearId = 'y' + m[1];
      var bar = yr.querySelector('.bi-year-actions');
      if(!bar){
        bar = document.createElement('div');
        bar.className = 'bi-year-actions';
        yr.appendChild(bar);
      }
      var hasSummer = !!document.getElementById(prefix + '-' + yearId + '-s3');
      var isUserYear = yr.hasAttribute('data-user-year');
      var html = hasSummer
        ? '<button type="button" class="home-btn" data-act="rmSummer" data-year="' + yearId + '">' + window.AAUP_ICONS.preview('trash', 13) + (rtl ? 'إزالة الصيفي' : 'Remove summer') + '</button>'
        : '<button type="button" class="home-btn" data-act="addSummer" data-year="' + yearId + '">' + window.AAUP_ICONS.preview('sun', 13) + (rtl ? 'إضافة صيفي' : 'Add summer') + '</button>';
      if(isUserYear){
        html += '<button type="button" class="home-btn" data-act="rmYear" data-year="' + yearId + '">' + window.AAUP_ICONS.preview('trash', 13) + (rtl ? 'إزالة السنة' : 'Remove year') + '</button>';
      }
      bar.innerHTML = html;
    });

    var addBar = container.querySelector('.bi-structure-actions');
    if(!addBar){
      addBar = document.createElement('div');
      addBar.className = 'bi-structure-actions';
      var anchor = container.querySelector('.electives-row');
      if(anchor){ container.insertBefore(addBar, anchor); }
      else { container.appendChild(addBar); }
    }
    addBar.innerHTML = '<button type="button" class="home-btn" data-act="addYear">' + (rtl ? 'إضافة سنة' : 'Add year') + '</button>' +
      (state.extraYears || state.summers.length
        ? '<span class="bi-structure-note">' + (rtl
            ? 'تعديلاتك على السنوات/الفصول محفوظة محليًا.'
            : 'Your added years/semesters are saved on this device.') + '</span>'
        : '');
  }

  function addYear(prefix){
    var state = forPlan(prefix);
    state.extraYears += 1;
    setForPlan(prefix, state);
    apply(prefix);
    refresh(prefix);
    if(window.__showToast){ window.__showToast(isRtl(prefix) ? 'تمت إضافة سنة.' : 'Year added.'); }
  }
  function removeYear(prefix, yearId){
    var rtl = isRtl(prefix);
    if(semesterHasCourses(prefix, yearId, 1) || semesterHasCourses(prefix, yearId, 2) || semesterHasCourses(prefix, yearId, 3)){
      if(window.__showToast){ window.__showToast((rtl ? 'السنة مش فاضية — انقل مساقاتها أولًا' : 'Year not empty — move its courses first')); }
      return;
    }
    var state = forPlan(prefix);
    var base = baseYearCount(prefix);
    // Only the LAST added year can go, so the remaining year numbers stay
    // contiguous with the official ones (no y6 sitting after a deleted y5).
    if(yearId !== 'y' + (base + state.extraYears)){
      if(window.__showToast){ window.__showToast((rtl ? 'يمكن إزالة آخر سنة مضافة فقط.' : 'Only the last added year can be removed.')); }
      return;
    }
    var yr = yearRowFor(prefix, yearId);
    if(yr) yr.remove();
    state.extraYears -= 1;
    state.summers = state.summers.filter(function(y){ return y !== yearId; });
    setForPlan(prefix, state);
    apply(prefix);
    refresh(prefix);
    if(window.__showToast){ window.__showToast(rtl ? 'تمت إزالة السنة.' : 'Year removed.'); }
  }
  function addSummer(prefix, yearId){
    var state = forPlan(prefix);
    if(state.summers.indexOf(yearId) === -1){ state.summers.push(yearId); }
    setForPlan(prefix, state);
    apply(prefix);
    refresh(prefix);
    if(window.__showToast){ window.__showToast(isRtl(prefix) ? 'تمت إضافة الفصل الصيفي.' : 'Summer semester added.'); }
  }
  function removeSummer(prefix, yearId){
    var rtl = isRtl(prefix);
    if(semesterHasCourses(prefix, yearId, 3)){
      if(window.__showToast){ window.__showToast((rtl ? 'الصيفي مش فاضي — انقل مساقاته أولًا' : 'Summer not empty — move its courses first')); }
      return;
    }
    var row = document.getElementById(prefix + '-' + yearId + '-s3');
    var sem = row ? row.closest('.sem') : null;
    if(sem){
      var prev = sem.previousElementSibling;
      if(prev && prev.classList.contains('divider')) prev.remove();
      sem.remove();
    }
    var state = forPlan(prefix);
    state.summers = state.summers.filter(function(y){ return y !== yearId; });
    setForPlan(prefix, state);
    apply(prefix);
    refresh(prefix);
    if(window.__showToast){ window.__showToast(rtl ? 'تمت إزالة الفصل الصيفي.' : 'Summer semester removed.'); }
  }

  // Adding/removing a row changes the grid geometry, so the prerequisite
  // arrows have to be recomputed against the new layout — same redraw hook
  // course removal and the collapse toggle already use.
  function refresh(prefix){
    if(window.__redraw && window.__redraw[prefix]){ window.__redraw[prefix](); }
    if(window.__refreshPlanUI){ window.__refreshPlanUI(prefix); }
  }

  function bind(prefix){
    var container = yearsContainer(prefix);
    if(!container || container.__structureBound) return;
    container.__structureBound = true;
    container.addEventListener('click', function(e){
      var btn = e.target.closest('[data-act]');
      if(!btn || !container.contains(btn)) return;
      var page = document.getElementById('page-' + prefix);
      if(!page || !page.classList.contains('editing')) return;
      var act = btn.getAttribute('data-act');
      var yearId = btn.getAttribute('data-year');
      e.preventDefault();
      e.stopPropagation();
      if(act === 'addYear') addYear(prefix);
      else if(act === 'rmYear') removeYear(prefix, yearId);
      else if(act === 'addSummer') addSummer(prefix, yearId);
      else if(act === 'rmSummer') removeSummer(prefix, yearId);
    });
  }

  function init(){
    BUILT_IN.forEach(function(prefix){
      if(!document.getElementById('page-' + prefix)) return;
      apply(prefix);
      bind(prefix);
    });
  }

  window.AAUP_STRUCTURE = {
    apply: apply, renderControls: renderControls,
    addYear: addYear, removeYear: removeYear,
    addSummer: addSummer, removeSummer: removeSummer
  };

  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }
})();
