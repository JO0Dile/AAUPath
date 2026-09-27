// ==========================
// SIDEWAYS ROWS WITH A MOUSE — the chip rows (Find a Professor's
// categories, the plan's filters, achievement groups…) scroll sideways,
// which a finger does naturally and a mouse cannot: there is no scrollbar
// and the wheel only goes up and down. On a computer the wheel now scrolls
// such a row sideways while the pointer is over it, and the row can be
// dragged. Touch is left alone.
// ==========================
(function(){
  'use strict';

  function rowFrom(el){
    while(el && el !== document.body && el.nodeType === 1){
      if(el.scrollWidth > el.clientWidth + 2){
        var ox = getComputedStyle(el).overflowX;
        if((ox === 'auto' || ox === 'scroll') && el.scrollHeight <= el.clientHeight + 2) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener('wheel', function(e){
    if(e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    var row = rowFrom(e.target);
    if(!row) return;
    var max = row.scrollWidth - row.clientWidth;
    var rtl = getComputedStyle(row).direction === 'rtl';
    // In RTL scrollLeft runs from 0 down to -max.
    var pos = rtl ? -row.scrollLeft : row.scrollLeft;
    var d = rtl ? -e.deltaY : e.deltaY;
    if((d > 0 && pos >= max - 1) || (d < 0 && pos <= 0)) return;   // at the end: let the page scroll
    row.scrollLeft += d;
    e.preventDefault();
  }, { passive: false });

  var drag = null;
  document.addEventListener('pointerdown', function(e){
    if(e.pointerType !== 'mouse' || e.button !== 0) return;
    var row = rowFrom(e.target);
    if(!row) return;
    drag = { row: row, x: e.clientX, left: row.scrollLeft, moved: false };
  });
  document.addEventListener('pointermove', function(e){
    if(!drag) return;
    var dx = e.clientX - drag.x;
    if(!drag.moved && Math.abs(dx) < 6) return;
    drag.moved = true;
    drag.row.scrollLeft = drag.left - dx;
    drag.row.classList.add('is-dragging');
  });
  document.addEventListener('pointerup', function(){
    if(!drag) return;
    var d = drag; drag = null;
    d.row.classList.remove('is-dragging');
    // A drag that ends on a chip must not also press it.
    if(d.moved){
      var stop = function(ev){ ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(function(){ document.removeEventListener('click', stop, true); }, 0);
    }
  });
})();
