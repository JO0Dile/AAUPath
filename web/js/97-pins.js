// ==========================
// PINNED COURSES — "Pin to Home" in a course's ⋯ menu (idea 10).
//
// Kept per major, in the order they were pinned, through AAUP_STORAGE so it
// follows the active profile like the rest of a student's data. Home reads
// the list (js/90-task-home.js pinnedHtml); the course window toggles it
// (js/49-course-detail.js).
// ==========================
(function(){
  'use strict';

  var KEY = 'aaup_pinned';
  var MAX = 8;

  function all(){
    var m = window.AAUP_STORAGE ? window.AAUP_STORAGE.getJSON(KEY, {}) : {};
    return (m && typeof m === 'object') ? m : {};
  }
  function list(prefix){
    var l = all()[prefix];
    return Array.isArray(l) ? l.slice() : [];
  }
  function has(prefix, slug){ return list(prefix).indexOf(slug) >= 0; }
  function set(prefix, slug, on){
    var m = all();
    var l = Array.isArray(m[prefix]) ? m[prefix] : [];
    l = l.filter(function(s){ return s !== slug; });
    if(on) l.unshift(slug);
    m[prefix] = l.slice(0, MAX);
    if(window.AAUP_STORAGE) window.AAUP_STORAGE.setJSON(KEY, m);
  }

  window.AAUP_PINS = { list: list, has: has, set: set };
})();
