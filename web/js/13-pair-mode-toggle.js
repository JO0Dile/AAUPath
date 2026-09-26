// ==========================
// PAIR MODE TOGGLE — a small "connect" button on every lecture+lab
// pair-group letting a student flip whether the two share one grade
// ("Same grade") or are graded independently ("Every course has its own
// grade"), overriding the catalog-number-based default per pair. Built-in
// majors only: pair-group is a hand-authored HTML wrapper that doesn't
// exist in the generic imported-plan renderer.
// ==========================
(function(){
  function effectiveMode(prefix, baseSlug, wrapperEl){
    var override = window.AAUP_GPA.loadPairModeOverrides()[window.AAUP_GPA.pairOverrideKey(prefix, baseSlug)];
    if(override) return override;
    return wrapperEl.classList.contains('independent-grades') ? 'independent' : 'same';
  }
  function applyMode(wrapperEl, mode){
    wrapperEl.classList.toggle('independent-grades', mode === 'independent');
  }
  function labelFor(mode, rtl){
    if(mode === 'independent'){
      return rtl ? 'مستقل — لكل مساق علامته الخاصة' : 'Independent — every course has its own grade';
    }
    return rtl ? 'مرتبط — علامة واحدة للمساقين' : 'Connected — same grade for both';
  }
  function glyphFor(mode){ return window.AAUP_ICONS.preview(mode === 'independent' ? 'shuffle' : 'link', 14); }

  function injectButtons(prefix){
    var page = document.getElementById('page-' + prefix);
    if(!page) return;
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    page.querySelectorAll('.pair-group').forEach(function(group){
      if(group.querySelector('.pair-mode-btn')) return; // already wired
      var courseEls = group.querySelectorAll('.course[id]');
      if(courseEls.length < 2) return;
      var parts = window.__splitCourseId ? window.__splitCourseId(courseEls[0].id) : null;
      if(!parts) return;
      // The base (non-"-lab") slug is what primaryId()/overrides key off of.
      var baseSlug = parts.slug.slice(-4) === '-lab' ? null : parts.slug;
      if(!baseSlug){
        var other = window.__splitCourseId(courseEls[1].id);
        baseSlug = other && other.slug.slice(-4) !== '-lab' ? other.slug : null;
      }
      if(!baseSlug) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'connect-glyph pair-mode-btn';
      function refresh(){
        var mode = effectiveMode(prefix, baseSlug, group);
        applyMode(group, mode);
        btn.innerHTML = glyphFor(mode);
        btn.title = labelFor(mode, rtl);
      }
      refresh();
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var current = effectiveMode(prefix, baseSlug, group);
        var next = current === 'independent' ? 'same' : 'independent';
        var overrides = window.AAUP_GPA.loadPairModeOverrides();
        overrides[window.AAUP_GPA.pairOverrideKey(prefix, baseSlug)] = next;
        window.AAUP_GPA.savePairModeOverrides(overrides);
        refresh();
        if(window.__showToast){ window.__showToast(labelFor(next, rtl)); }
        if(window.__refreshPlanUI){ window.__refreshPlanUI(prefix); }
      });
      // Placed between the two course cards, matching where the (previously
      // unused) .connect-glyph styling already expected a middle element.
      var secondCourse = group.querySelectorAll('.course[id]')[1];
      group.insertBefore(btn, secondCourse);
    });
  }

  function init(){
    ['robotics', 'cybersecurity', 'medical', 'cs'].forEach(injectButtons);
  }
  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }
  window.__injectPairModeButtons = injectButtons;
})();
