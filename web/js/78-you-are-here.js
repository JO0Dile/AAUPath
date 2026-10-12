// ==========================
// YOU ARE HERE — the plan learns what "now" is.
//
// A study plan is a map with no dot on it. Five years of semesters all look
// equally current, so a student opens it and has to work out where they
// are before they can read anything — which is most of what "I get lost in
// it" actually means.
//
// Nobody is asked. "Now" is the earliest semester that still has an
// unfinished course, which is the same definition the rest of the app
// already uses for current, needs no input, and corrects itself every time
// a box is ticked. A student who has finished nothing is in Year 1
// Semester 1, which is true; one who has finished everything gets no
// marker, which is also true.
//
// What it does: marks that semester, and — the first time a plan is opened
// in a session, and only if the student has not opened or closed a year
// themselves — opens the year it is in and scrolls to it. After that their
// own choices win, because a plan that keeps re-opening a year you closed
// is worse than one that never opened anything.
// ==========================
(function(){
  'use strict';

  var SCROLLED = {};   // per plan, per session: scroll to "now" only once

  var TX = {
    en: 'You are here',
    ar: 'أنت هنا'
  };
  // Plan My Next Semester was a screen you went to. The semester it plans is
  // the one after the marked one, so its suggestions belong here, under the
  // marker — with the full screen still one tap away for actually building
  // and keeping a semester.
  var NX = {
    en: { head: 'Next semester — suggested', more: 'Plan the whole semester',
          empty: 'Nothing new is open yet — finish something in this semester first.' },
    ar: { head: 'الفصل القادم — مقترح', more: 'خطط الفصل كامل',
          empty: 'ما في إشي جديد متاح — خلّص إشي من هالفصل الأول.' }
  };
  var SHOWN = 4;

  function root(prefix){ return document.getElementById('page-' + prefix); }

  // The earliest semester with anything left in it. Reads the DOM rather
  // than the plan data because "unfinished" includes courses the student
  // removed from their own plan (js/12-removed.js), and the DOM is where
  // that is already resolved.
  function currentSemester(prefix){
    var page = root(prefix);
    if(!page) return null;
    var blocks = page.querySelectorAll('.imp-year-block[data-year-index] .imp-semester-block');
    for(var i = 0; i < blocks.length; i++){
      var courses = blocks[i].querySelectorAll('.course[id]:not(.course-removed)');
      if(!courses.length) continue;
      for(var j = 0; j < courses.length; j++){
        if(!courses[j].classList.contains('completed')) return blocks[i];
      }
    }
    return null;   // nothing left — no marker, which is the honest answer
  }

  function rtlFor(prefix){
    var page = root(prefix);
    if(page) return page.classList.contains('rtl-mode');
    return !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
  }

  function mark(prefix){
    var page = root(prefix);
    if(!page) return null;
    // Clear first: render() rebuilds the cards but this runs against
    // whatever is on screen, and ticking a box moves where "now" is.
    page.querySelectorAll('.sem-now').forEach(function(el){ el.classList.remove('sem-now'); });
    page.querySelectorAll('.now-tag').forEach(function(el){ el.remove(); });

    var sem = currentSemester(prefix);
    if(!sem) return null;
    sem.classList.add('sem-now');
    var tag = document.createElement('div');
    tag.className = 'now-tag';
    tag.innerHTML = '<span class="now-dot" aria-hidden="true"></span>' +
      '<span>' + (rtlFor(prefix) ? TX.ar : TX.en) + '</span>';
    sem.insertBefore(tag, sem.firstChild);
    return sem;
  }

  // The suggestion block under the marked semester. Everything in it comes
  // from AAUP_ADVISOR.recommend — the same ranking the full screen uses, so
  // the two can never suggest different things.
  function suggestions(prefix, sem){
    var page = root(prefix);
    if(!page) return;
    page.querySelectorAll('.ynx').forEach(function(el){ el.remove(); });
    if(!sem || !window.AAUP_ADVISOR || !window.AAUP_ADVISOR.recommend) return;
    // Edit mode is for rearranging the plan, not for taking advice on it.
    if(page.classList.contains('editing')) return;

    var rtl = rtlFor(prefix);
    var t = rtl ? NX.ar : NX.en;
    var rec = window.AAUP_ADVISOR.recommend(prefix) || { chosen: [] };
    var esc = window.__escapeHtml;
    // Anything already ticked off in the marked semester is not a suggestion
    // for the next one, and neither is a course sitting in this semester.
    var here = {};
    sem.querySelectorAll('.course[id]').forEach(function(el){ here[el.id] = true; });
    var picks = (rec.chosen || []).filter(function(c){ return !here[c.id]; }).slice(0, SHOWN);

    var box = document.createElement('div');
    box.className = 'ynx';
    var hours = picks.reduce(function(a, c){ return a + (c.cr || 0); }, 0);
    box.innerHTML =
      '<div class="ynx-head"><span class="ynx-label">' + esc(t.head) + '</span>' +
      (picks.length ? '<span class="ynx-hours">' + window.__hrs(hours) + '</span>' : '') + '</div>' +
      (picks.length
        ? '<div class="ynx-list">' + picks.map(function(c){
            var why = window.AAUP_ADVISOR.reason ? window.AAUP_ADVISOR.reason(c, rtl) : '';
            var nm = window.AAUP_ADVISOR.name ? window.AAUP_ADVISOR.name(prefix, c.slug, rtl) : c.slug;
            return '<button type="button" class="ynx-card" data-ynx-slug="' + esc(c.slug) + '">' +
              '<span class="ynx-name">' + esc(nm) + '</span>' +
              '<span class="ynx-meta">' + esc(window.__hrs(c.cr) + (why ? ' · ' + why : '')) + '</span>' +
              '</button>';
          }).join('') + '</div>'
        : '<p class="ynx-empty">' + esc(t.empty) + '</p>') +
      '<button type="button" class="ynx-more">' + esc(t.more) + '</button>';

    sem.parentNode.insertBefore(box, sem.nextSibling);

    box.querySelectorAll('[data-ynx-slug]').forEach(function(b){
      b.addEventListener('click', function(){
        if(window.AAUP_IMPORTED){ window.AAUP_IMPORTED.openCourseModal(prefix, b.getAttribute('data-ynx-slug')); }
      });
    });
    var more = box.querySelector('.ynx-more');
    if(more){ more.addEventListener('click', function(){ if(window.AAUP_ADVISOR) window.AAUP_ADVISOR.open(prefix); }); }
  }

  // Has the student opened or closed any year of this plan themselves? If
  // so, nothing here touches the fold state.
  function studentHasFolded(prefix){
    try{
      var map = JSON.parse(localStorage.getItem('aaup_yearOpen') || '{}') || {};
      return Object.keys(map).some(function(k){ return k.indexOf(prefix + '::') === 0; });
    }catch(e){ return false; }
  }

  function refresh(prefix){
    var sem = mark(prefix);
    suggestions(prefix, sem);
    if(!sem || SCROLLED[prefix]) return;
    SCROLLED[prefix] = true;
    if(studentHasFolded(prefix)) return;

    var block = sem.closest('.imp-year-block');
    if(block && block.classList.contains('year-collapsed')){
      var toggle = block.querySelector('.imp-year-toggle');
      if(toggle) toggle.click();     // through the real control, so it is stored and the connectors redraw
    }
    // Scroll to the TAG, not to the semester. Centring the semester centres
    // a block that can be a screen and a half tall, which puts its own "you
    // are here" marker above the fold — the plan lands in the right place
    // and says nothing about why.
    //
    // Delayed so the fold above has actually reflowed; otherwise this aims
    // at where the semester sat while its year was still closed.
    setTimeout(function(){
      var live = currentSemester(prefix);
      var tag = live && live.querySelector('.now-tag');
      (tag || live || {}).scrollIntoView &&
        (tag || live).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
  }

  window.__refreshYouAreHere = refresh;
  window.AAUP_NOW = { semester: currentSemester, refresh: refresh };
})();
