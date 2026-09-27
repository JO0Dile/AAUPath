// ==========================
// WHAT'S NEW — one screen listing what changed in each update.
//
// Deliberately empty. Entries are added only when the maintainer says what
// to write and for which update; nothing is filled in automatically, and no
// release notes are written here without being asked for. An entry is:
//   { version: '7.4', date: '2026-10-01', en: ['…'], ar: ['…'] }
// newest first.
// ==========================
(function(){
  'use strict';

  var ENTRIES = [];

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s)) : String(s); }

  function overlayEl(){
    var el = document.getElementById('whatsNewOverlay');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'whatsNewOverlay';
    el.className = 'modal-overlay';
    el.innerHTML = '<div class="modal-card wn2-card" role="dialog" aria-modal="true" aria-labelledby="wn2Title"><div class="modal-body" id="wn2Body"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function(e){ if(e.target === el) el.classList.remove('open'); });
    return el;
  }

  function open(){
    var el = overlayEl(), r = ar();
    var body = document.getElementById('wn2Body');
    body.innerHTML =
      '<h2 class="mh" id="wn2Title" style="margin-top:0;">' + window.AAUP_ICONS.preview('news', 20) + (r ? 'الجديد' : "What's new") + '</h2>' +
      (ENTRIES.length
        ? ENTRIES.map(function(e){
            var lines = (r ? e.ar : e.en) || [];
            return '<section class="wn2-entry"><div class="wn2-head"><b>v' + esc(e.version) + '</b>' + (e.date ? '<span>' + esc(e.date) + '</span>' : '') + '</div>' +
              '<ul>' + lines.map(function(l){ return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></section>';
          }).join('')
        : '<p class="wn2-empty">' + (r ? 'لسا ما في إشي هون.' : 'Nothing here yet.') + '</p>');
    el.classList.add('open');
  }

  window.AAUP_WHATS_NEW = { open: open };
})();
