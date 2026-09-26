// ==========================
// LANGUAGE — one switch, for the whole app.
//
// Language used to be per plan and in memory only: js/28-imported.js kept an
// rtlState map, so switching to Arabic on one plan left the next one in
// English, the menu around it in English, and every screen back in English
// after a reload. A student who reads Arabic had to keep saying so.
//
// This is the one place the choice lives. It is the same aaup_lang key the
// landing screen's AR/EN toggle already writes (js/55-onboarding.js), so a
// student who picks Arabic before signing in is still in Arabic afterwards.
//
// Nothing here renders. Screens read isAr() — or, while a plan is on screen,
// the rtl-mode class that render() sets from it, which is the same answer.
// ==========================
(function(){
  'use strict';

  var KEY = 'aaup_lang';
  var cached = null;

  function get(){
    if(cached) return cached;
    try{ cached = localStorage.getItem(KEY) === 'ar' ? 'ar' : 'en'; }
    catch(e){ cached = 'en'; }
    return cached;
  }
  function isAr(){ return get() === 'ar'; }
  function set(v){
    cached = v === 'ar' ? 'ar' : 'en';
    try{ localStorage.setItem(KEY, cached); }catch(e){}
    // Everything on screen that is not the plan re-reads on its next render;
    // the plan itself is re-rendered by whoever flipped the switch. The
    // document direction is set here so a screen with no plan behind it
    // (Settings, the home picker) still turns around.
    applyDir();
    return cached;
  }
  // WHOLE-APP MIRRORING.
  // The page's reading direction follows the language, so every screen —
  // menus, bars, sheets, cards — lays out right-to-left in Arabic, not only
  // the few that used to flip themselves. Direction-sensitive CSS keys off
  // html[dir="rtl"] (or uses logical properties, which follow it for free).
  function applyDir(){
    try{
      var el = document.documentElement;
      el.setAttribute('lang', cached);
      el.setAttribute('dir', cached === 'ar' ? 'rtl' : 'ltr');
    }catch(e){}
  }
  function toggle(){ return set(isAr() ? 'en' : 'ar'); }

  // ---------------------------------------------------------------------
  // STATIC MARKUP
  //
  // Most of the app builds its own HTML in JS and can read isAr() while it
  // renders. index.html cannot: its labels are written once, in English, and
  // then never touched — so the assistant panel, the Fix panel and the
  // course-detail sheet kept their English aria-labels and placeholders in
  // Arabic no matter what the switch said, which is invisible on screen but
  // is the entire interface to a student using a screen reader.
  //
  // So: put the Arabic next to the English in the markup, as data-ar,
  // data-ar-label, data-ar-placeholder or data-ar-title, and this swaps it
  // in. The English is stashed on the node the first time it is swapped so
  // switching back is exact rather than a second translation.
  var ATTRS = [
    ['data-ar', null], ['data-ar-label', 'aria-label'],
    ['data-ar-placeholder', 'placeholder'], ['data-ar-title', 'title']
  ];

  function applyStatic(root){
    var scope = root || document;
    var arabic = isAr();
    ATTRS.forEach(function(pair){
      var src = pair[0], target = pair[1];
      var nodes = scope.querySelectorAll('[' + src + ']');
      for(var i = 0; i < nodes.length; i++){
        var el = nodes[i];
        // data-ar rewrites textContent, which would delete any child
        // elements. Only ever use it on a leaf.
        if(!target && el.children.length) continue;
        var stash = '__en_' + (target || 'text');
        if(el[stash] === undefined){
          el[stash] = target ? (el.getAttribute(target) || '') : el.textContent;
        }
        var value = arabic ? el.getAttribute(src) : el[stash];
        if(target) el.setAttribute(target, value);
        else el.textContent = value;
      }
    });
  }

  function setAndApply(v){ var r = set(v); applyStatic(); return r; }

  // Before first paint, so an Arabic student never sees the app laid out
  // left-to-right for a moment.
  get(); applyDir();

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ applyStatic(); });
  } else {
    applyStatic();
  }

  window.AAUP_LANG = {
    get: get, isAr: isAr,
    set: setAndApply,
    toggle: function(){ return setAndApply(isAr() ? 'en' : 'ar'); },
    applyStatic: applyStatic
  };
})();
