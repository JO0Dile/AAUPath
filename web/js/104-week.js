// ==========================
// YOUR WEEK: the class times as a grid, with clashes (idea 19).
//
// Reads what js/102-timetable.js stores. Two classes on the same day whose
// times overlap are a clash: both sit side by side in red and a line under
// the grid names them, with the days and the exact overlap.
// ==========================
(function(){
  'use strict';

  var WEEK = [6, 0, 1, 2, 3, 4];
  var DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_AR = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s)) : String(s); }
  function mins(t){ var p = String(t || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
  function hhmm(m){ return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function dayLabel(d){ return ar() ? DAY_AR[d] : DAY_EN[d]; }
  function full(c){ return ar() && c.ar ? c.ar : c.name; }
  // A class squeezed beside a clashing one shows a short label: the initials
  // in English ("DSA"), the first word in Arabic, where initials don't read.
  var SKIP = { and: 1, of: 1, the: 1, to: 1, in: 1, for: 1, '&': 1 };
  function abbr(c){
    var code = c.num || c.courseNumber || '';
    if(ar()) return full(c).split(' ')[0] || code;
    return c.name.split(/\s+/).filter(function(w){ return w && !SKIP[w.toLowerCase()]; }).map(function(w){
      return /^(I|II|III|IV|V|\d+)$/.test(w) ? ' ' + w : w.charAt(0).toUpperCase();
    }).join('');
  }

  // Classes that overlap on one day sit side by side instead of on top of
  // each other: each gets a lane, and every class in an overlapping run
  // knows how many lanes that run needs.
  function lanes(list){
    var sorted = list.slice().sort(function(a, b){ return mins(a.s) - mins(b.s); });
    var run = [], runEnd = -1, ends = [];
    var close = function(){ var n = ends.length || 1; run.forEach(function(x){ x.lanes = n; }); run = []; ends = []; };
    sorted.forEach(function(x){
      if(mins(x.s) >= runEnd) close();
      var lane = 0;
      while(lane < ends.length && ends[lane] > mins(x.s)) lane++;
      ends[lane] = mins(x.e);
      x.lane = lane;
      run.push(x);
      runEnd = Math.max(runEnd, mins(x.e));
    });
    close();
    return sorted;
  }

  function week(planId){
    var T = window.AAUP_TIMETABLE;
    var out = {};
    WEEK.forEach(function(d){ out[d] = lanes(T ? T.meetingsOn(planId, d) : []); });
    return out;
  }

  // Every pair of different courses that overlap on the same day, merged
  // across days: { a, b, days:[d], from, to }.
  function clashes(planId){
    var w = week(planId), map = {};
    WEEK.forEach(function(d){
      var l = w[d];
      for(var i = 0; i < l.length; i++){
        for(var j = i + 1; j < l.length; j++){
          var x = l[i], y = l[j];
          if(x.c.id === y.c.id) continue;
          var from = Math.max(mins(x.s), mins(y.s)), to = Math.min(mins(x.e), mins(y.e));
          if(to <= from) continue;
          var key = [x.c.id, y.c.id].sort().join('|');
          if(!map[key]) map[key] = { a: x.c, b: y.c, days: [], from: from, to: to };
          map[key].days.push(d);
        }
      }
    });
    return Object.keys(map).map(function(k){ return map[k]; });
  }

  function gridHtml(planId){
    var w = week(planId), lo = 24 * 60, hi = 0, any = false;
    WEEK.forEach(function(d){ w[d].forEach(function(x){ any = true; lo = Math.min(lo, mins(x.s)); hi = Math.max(hi, mins(x.e)); }); });
    if(!any) return '';
    lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
    var span = hi - lo, clashIds = {};
    clashes(planId).forEach(function(cl){ cl.days.forEach(function(d){ clashIds[d + '|' + cl.a.id] = 1; clashIds[d + '|' + cl.b.id] = 1; }); });
    var hours = [];
    for(var h = lo; h < hi; h += 60) hours.push(h);
    return '<div class="wk" style="--wk-rows:' + hours.length + '">' +
      '<div class="wk-times"><span></span>' + hours.map(function(m){ return '<span>' + (m / 60) + '</span>'; }).join('') + '</div>' +
      WEEK.map(function(d){
        return '<div class="wk-day"><b>' + esc(dayLabel(d)) + '</b><div class="wk-col">' +
          w[d].map(function(x){
            var top = (mins(x.s) - lo) / span * 100, ht = (mins(x.e) - mins(x.s)) / span * 100;
            var wpc = 100 / (x.lanes || 1), start = (x.lane || 0) * wpc;
            return '<span class="wk-blk' + (clashIds[d + '|' + x.c.id] ? ' is-clash' : '') + '" style="top:' + top + '%;height:' + ht + '%;inset-inline-start:calc(' + start + '% + 1px);width:calc(' + wpc + '% - 2px)">' +
              '<span class="wk-nm">' + esc(x.lanes > 1 ? abbr(x.c) : full(x.c)) + '</span><small>' + esc(window.__fmtTime(x.s)) + '</small></span>';
          }).join('') + '</div></div>';
      }).join('') + '</div>';
  }

  function clashHtml(planId){
    return clashes(planId).map(function(cl){
      var days = cl.days.map(dayLabel).join(L(' & ', ' و'));
      return '<div class="wk-clash">' +
        '<b>' + esc(L((ar() && cl.a.ar ? cl.a.ar : cl.a.name) + ' and ' + cl.b.name + ' overlap',
                      'في تعارض بين ' + (cl.a.ar || cl.a.name) + ' و' + (cl.b.ar || cl.b.name))) + '</b>' +
        '<span>' + esc(days) + ' · <bdi dir="ltr">' + esc(window.__fmtTime(hhmm(cl.from)) + '–' + window.__fmtTime(hhmm(cl.to))) + '</bdi></span></div>';
    }).join('');
  }

  // The block the class-times window puts above the course list.
  function panelHtml(planId){
    var g = gridHtml(planId);
    if(!g) return '';
    return '<div class="wk-panel"><div class="wk-panel-h"><b>' + esc(L('Your week', 'أسبوعك')) + '</b></div>' +
      g + clashHtml(planId) + '</div>';
  }

  window.AAUP_WEEK = { panelHtml: panelHtml, clashes: clashes };
})();
