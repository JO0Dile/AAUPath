// ==========================
// OFFLINE PILL — "Offline · everything still works".
//
// The app is fully offline (the service worker keeps every file), but a
// student who loses signal mid-tick has no way to know their ticks were
// kept. A small calm pill at the top says so while the connection is gone,
// and leaves on its own when it is back. Nothing to tap, nothing to close.
// ==========================
(function(){
  'use strict';
  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  var pill = null;
  function sync(){
    var off = navigator.onLine === false;
    if(!off){ if(pill) pill.classList.remove('show'); return; }
    if(!pill){
      pill = document.createElement('div');
      pill.className = 'offline-pill';
      pill.setAttribute('role', 'status');
      document.body.appendChild(pill);
    }
    pill.innerHTML = '<span class="offline-dot" aria-hidden="true"></span>' +
      (ar() ? 'بدون إنترنت · كل إشي شغّال' : 'Offline · everything still works');
    pill.classList.add('show');
  }
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
})();
