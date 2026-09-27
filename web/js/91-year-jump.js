// ==========================
// YEAR JUMP BAR — a slim strip of year numbers on the edge of My Plan.
//
// A five-year plan on a phone is a long scroll. The strip shows one number per
// year: tap one to jump there (a folded year opens), or drag along it and a
// bubble says where you will land. Finished years are green, the year you are
// in is filled. It shows while the plan is scrolling and fades once it stops,
// so it never sits on top of a card you are reading. In Arabic it is on the
// left, like everything else that mirrors.
// ==========================
(function(){
  'use strict';

  var bar = null, bubble = null, hideTimer = null, dragging = false;

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function page(){
    var host = document.getElementById('importedPlanView');
    if(!host || host.style.display === 'none') return null;
    var sheet = host.querySelector('.sheet-plan');
    return sheet && !sheet.classList.contains('editing') ? sheet : null;
  }
  function blocks(){ var p = page(); return p ? Array.prototype.slice.call(p.querySelectorAll('.imp-year-block')) : []; }

  function ensure(){
    if(bar) return;
    bar = document.createElement('div');
    bar.className = 'yj';
    bar.setAttribute('role', 'navigation');
    bubble = document.createElement('div');
    bubble.className = 'yj-bubble';
    bubble.hidden = true;
    document.body.appendChild(bar);
    document.body.appendChild(bubble);
    bar.addEventListener('pointerdown', function(e){
      dragging = true;
      try{ bar.setPointerCapture(e.pointerId); }catch(err){}
      pick(e.clientY, false);
      e.preventDefault();
    });
    bar.addEventListener('pointermove', function(e){ if(dragging) pick(e.clientY, false); });
    var end = function(e){
      if(!dragging) return;
      dragging = false;
      pick(e.clientY, true);
      bubble.hidden = true;
      schedHide();
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', function(){ dragging = false; bubble.hidden = true; schedHide(); });
  }

  function currentIndex(bs){
    var mid = window.innerHeight * 0.35, best = 0;
    bs.forEach(function(b, i){ if(b.getBoundingClientRect().top <= mid) best = i; });
    return best;
  }

  function render(){
    var bs = blocks();
    if(bs.length < 2){ if(bar) bar.classList.remove('show'); return false; }
    ensure();
    var now = currentIndex(bs);
    bar.setAttribute('aria-label', ar() ? 'انتقل لسنة' : 'Jump to a year');
    bar.innerHTML = '<span class="yj-lbl">' + (ar() ? 'سنة' : 'Year') + '</span>' + bs.map(function(b, i){
      var cls = i === now ? ' on' : (b.classList.contains('is-finished') ? ' done' : '');
      return '<button type="button" class="yj-n' + cls + '" data-yj="' + i + '" tabindex="-1">' + (i + 1) + '</button>';
    }).join('');
    return true;
  }

  function indexAt(y){
    var ns = bar.querySelectorAll('.yj-n');
    var best = 0, bestD = Infinity;
    Array.prototype.forEach.call(ns, function(n, i){
      var r = n.getBoundingClientRect(), d = Math.abs((r.top + r.height / 2) - y);
      if(d < bestD){ bestD = d; best = i; }
    });
    return best;
  }

  function pick(y, go){
    var i = indexAt(y);
    Array.prototype.forEach.call(bar.querySelectorAll('.yj-n'), function(n, k){ n.classList.toggle('on', k === i); });
    bubble.textContent = (ar() ? 'السنة ' : 'Year ') + (i + 1);
    var r = bar.querySelectorAll('.yj-n')[i].getBoundingClientRect();
    bubble.style.top = (r.top + r.height / 2 - 20) + 'px';
    bubble.hidden = false;
    if(go) jump(i);
  }

  function jump(i){
    var b = blocks()[i];
    if(!b) return;
    if(b.classList.contains('year-collapsed')){
      var t = b.querySelector('.imp-year-toggle');
      if(t) t.click();
    }
    var top = b.getBoundingClientRect().top + window.scrollY - 150;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  }

  function schedHide(){
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function(){ if(bar && !dragging) bar.classList.remove('show'); }, 1600);
  }

  var queued = false;
  window.addEventListener('scroll', function(){
    if(dragging || queued) return;
    queued = true;
    requestAnimationFrame(function(){
      queued = false;
      if(!page()){ if(bar) bar.classList.remove('show'); return; }
      if(render()){ bar.classList.add('show'); schedHide(); }
    });
  }, { passive: true });
})();
