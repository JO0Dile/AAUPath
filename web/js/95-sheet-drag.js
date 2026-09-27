// ==========================
// PULL-UP COURSE WINDOW (phone) — the course sheet opens half-way and is
// dragged, the way a map app's place sheet is.
//
// Half-way shows the name, the numbers and the status: what most visits need.
// Drag the top of the sheet up for everything else, or down to close it. A
// quick flick counts as much as a long drag. Nothing changes on a laptop,
// where the course is a normal window.
// ==========================
(function(){
  'use strict';

  var FULL = 0.92;   // the tallest a dragged sheet grows (half-way is 58dvh in CSS)
  function isPhone(){ return window.innerWidth <= 720; }
  function overlay(){ return document.getElementById('impCourseModalOverlay'); }
  function card(){ var o = overlay(); return o && o.querySelector('.modal-card.cd-card'); }

  function setState(c, state){
    c.classList.toggle('sheet-full', state === 'full');
    c.classList.toggle('sheet-half', state === 'half');
    c.style.height = '';
    c.style.transform = '';
  }

  // Every time the course window opens on a phone, it opens half-way.
  var watched = false;
  function watch(){
    var o = overlay();
    if(!o || watched) return;
    watched = true;
    new MutationObserver(function(){
      var c = card();
      if(!c) return;
      if(o.classList.contains('open') && isPhone()){
        if(!c.classList.contains('sheet-full') && !c.classList.contains('sheet-half')) setState(c, 'half');
      } else if(!o.classList.contains('open')){
        c.classList.remove('sheet-full', 'sheet-half');
      }
    }).observe(o, { attributes: true, attributeFilter: ['class'] });
  }

  // The drag. It starts only on the top strip of the sheet (the handle and
  // the course name), so scrolling the details inside never drags the sheet.
  var drag = null;
  document.addEventListener('touchstart', function(e){
    var c = card();
    if(!c || !isPhone() || e.touches.length !== 1) return;
    if(!c.contains(e.target)) return;
    var top = c.getBoundingClientRect().top;
    var y = e.touches[0].clientY;
    if(y - top > 88) return;
    if(e.target.closest('button, a, input, textarea, select')) return;
    drag = { y0: y, h0: c.getBoundingClientRect().height, t0: Date.now(), c: c };
    c.style.transition = 'none';
  }, { passive: true });

  document.addEventListener('touchmove', function(e){
    if(!drag) return;
    var dy = e.touches[0].clientY - drag.y0;
    var vh = window.innerHeight;
    if(dy < 0){
      drag.c.style.height = Math.min(vh * FULL, drag.h0 - dy) + 'px';
      drag.c.style.transform = '';
    } else {
      drag.c.style.transform = 'translateY(' + dy + 'px)';
    }
  }, { passive: true });

  document.addEventListener('touchend', function(e){
    if(!drag) return;
    var d = drag; drag = null;
    d.c.style.transition = '';
    var dy = (e.changedTouches[0] ? e.changedTouches[0].clientY : d.y0) - d.y0;
    var fast = Date.now() - d.t0 < 250;
    var full = d.c.classList.contains('sheet-full');
    if(dy > (fast ? 30 : 110)){
      // Down: a full sheet drops to half, a half one closes.
      if(full){ setState(d.c, 'half'); return; }
      d.c.style.transform = '';
      var o = overlay();
      if(o) o.classList.remove('open');
      return;
    }
    if(dy < (fast ? -30 : -70)){ setState(d.c, 'full'); return; }
    setState(d.c, full ? 'full' : 'half');
  }, { passive: true });

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  window.addEventListener('load', watch);
})();
