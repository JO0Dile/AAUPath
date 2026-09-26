// ==========================
// YEAR COLLAPSE — every year is a disclosure, and a plan opens folded.
//
// This file used to be "collapse finished years": one master toggle that
// folded away years in which every course was already complete. That is a
// narrower version of the same idea, and it left a first-year student —
// who has finished nothing — scrolling through five years of course cards
// to find the one semester they are actually in.
//
// So the fold is per year now and starts closed. A plan opens as a short
// stack of year bars, each carrying how far through it the student is, and
// they open the one they want. The old master toggle is gone with the
// separate row it lived in; this replaces it rather than sitting beside it.
//
// The chevron, the counts and the .imp-year-body wrapper are rendered by
// js/28-imported.js. What lives here is the state (per plan, per year, in
// localStorage), the click and keyboard handling, and the connector redraw
// — folding a year reflows the grid the prerequisite lines are drawn over,
// so every line has to be re-measured or it points at where a course used
// to be.
//
// Also here: HOLD a year's title to see what is open to you inside it.
// That replaces the app-wide "Show only what I can take" toggle, which was
// a persistent setting for a momentary question. Holding is momentary: the
// year dims everything that is done or locked until you let go.
// ==========================
(function(){
  'use strict';

  var KEY = 'aaup_yearOpen';
  var HOLD_MS = 320;

  function readOpen(){
    try{ return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
    catch(e){ return {}; }
  }
  function writeOpen(map){
    try{ localStorage.setItem(KEY, JSON.stringify(map)); }catch(e){}
  }
  function isOpen(prefix, idx){
    // Absent means closed. A plan the student has never touched opens
    // folded, which is the whole point.
    return readOpen()[prefix + '::' + idx] === 1;
  }
  function setOpen(prefix, idx, on){
    var map = readOpen();
    if(on){ map[prefix + '::' + idx] = 1; } else { delete map[prefix + '::' + idx]; }
    writeOpen(map);
  }

  function rootFor(prefix){ return document.getElementById('page-' + prefix); }

  function yearBlocks(root){
    var imported = root.querySelectorAll('.imp-year-block');
    if(imported.length) return Array.prototype.slice.call(imported);
    return Array.prototype.slice.call(root.querySelectorAll('.year-row'));
  }

  // Redraw in place rather than re-rendering: a full render() would reset
  // the scroll position and wipe whatever is typed in the course search.
  function redrawConnectors(prefix){
    try{
      if(window.AAUP_IMPORTED && window.AAUP_IMPORTED.redrawConnectors){
        window.AAUP_IMPORTED.redrawConnectors(prefix);
      } else if(window.__redraw && window.__redraw[prefix]){
        window.__redraw[prefix]();
      }
    }catch(e){}
  }

  function applyOne(prefix, block, idx){
    var open = isOpen(prefix, idx);
    block.classList.toggle('year-collapsed', !open);
    var toggle = block.querySelector('.imp-year-toggle');
    if(toggle){
      toggle.setAttribute('aria-expanded', String(open));
      var chev = toggle.querySelector('.iy-chev');
      if(chev && window.AAUP_ICONS){
        chev.innerHTML = window.AAUP_ICONS.preview(open ? 'chevron' : 'chevronRight', 15);
      }
    }
  }

  // ---------------------------------------------------------------------
  // HOLD TO SEE WHAT IS OPEN
  //
  // Adds .year-peek to the year block, which dims its done and locked
  // cards and leaves the available ones at full strength. Deliberately not
  // persisted anywhere: it lasts exactly as long as the finger is down.
  function bindHold(prefix, block, toggle){
    var timer = null, held = false;

    function stop(){
      if(timer){ clearTimeout(timer); timer = null; }
      if(held){
        held = false;
        block.classList.remove('year-peek');
      }
    }
    function start(){
      stop();
      timer = setTimeout(function(){
        timer = null;
        // Nothing to show if the year is folded — open it first, so the
        // hold always has a visible effect rather than silently doing
        // nothing on the most likely state to hold from.
        if(block.classList.contains('year-collapsed')){
          setOpen(prefix, block.getAttribute('data-year-index'), true);
          applyOne(prefix, block, block.getAttribute('data-year-index'));
          redrawConnectors(prefix);
        }
        held = true;
        block.classList.add('year-peek');
        if(navigator.vibrate){ try{ navigator.vibrate(8); }catch(e){} }
      }, HOLD_MS);
    }

    toggle.addEventListener('pointerdown', start);
    toggle.addEventListener('pointerup', function(e){
      // A hold is not also a tap: without this, letting go after a peek
      // would fold the year the peek just opened.
      if(held){ e.preventDefault(); e.stopPropagation(); }
      stop();
    });
    toggle.addEventListener('pointerleave', stop);
    toggle.addEventListener('pointercancel', stop);
    toggle.addEventListener('contextmenu', function(e){
      // Long-press on a touch screen raises the context menu on top of the
      // peek, which is exactly the thing being looked at.
      if(held) e.preventDefault();
    });
    toggle.__aaupHoldBound = true;
  }

  function bind(prefix, block){
    var toggle = block.querySelector('.imp-year-toggle');
    if(!toggle || toggle.__aaupYearBound) return;
    toggle.__aaupYearBound = true;
    toggle.addEventListener('click', function(e){
      // Swallowed by the hold handler when this "click" is the end of a
      // press-and-hold rather than a tap.
      if(e.defaultPrevented) return;
      var idx = block.getAttribute('data-year-index');
      var opening = !isOpen(prefix, idx);
      setOpen(prefix, idx, opening);
      applyOne(prefix, block, idx);
      redrawConnectors(prefix);
    });
    bindHold(prefix, block, toggle);
  }

  function refresh(prefix){
    var root = rootFor(prefix);
    if(!root) return;
    yearBlocks(root).forEach(function(block){
      var idx = block.getAttribute('data-year-index');
      if(idx == null) return;
      bind(prefix, block);
      applyOne(prefix, block, idx);
    });
  }

  // Opens a year and scrolls to it — used by search, by "jump to current
  // semester", and by anything else that needs to point at a course the
  // student cannot currently see because its year is folded.
  function reveal(prefix, el){
    var block = el && el.closest ? el.closest('.imp-year-block, .year-row') : null;
    if(!block) return false;
    var idx = block.getAttribute('data-year-index');
    if(idx == null || isOpen(prefix, idx)) return false;
    setOpen(prefix, idx, true);
    applyOne(prefix, block, idx);
    redrawConnectors(prefix);
    return true;
  }

  window.__refreshCollapse = refresh;
  window.__revealYearFor = reveal;
})();
