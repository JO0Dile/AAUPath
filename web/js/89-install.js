// ==========================
// INSTALL — putting AAUPath on the home screen
//
// It is a proper offline PWA and almost nobody finds that out, because the
// browser only offers installation through a menu most students never open.
// So the app asks, in three places, and every one of them is honest about
// whether it can actually do anything.
//
// WHERE IT ASKS
//
//   HOME    a bar under the hero (mockup C). The one a stranger sees. It has
//           room to answer the objection people actually have — "no store, no
//           account" — before they think to ask it.
//   MORE    a row at the top of the menu (mockup H). Nothing is covered and
//           nothing is dismissed; it is simply there for anyone who went
//           looking.
//   HELP    a row in Settings → Help. This one is PERMANENT: the other two
//           disappear the moment the app is installed, and someone who later
//           removes it from their home screen needs a way back that does not
//           depend on a browser event that will not fire again.
//
// The first two vanish on install. That is the whole point of them: they are
// an offer, and an offer that outlives its acceptance is just noise.
//
// THE THREE STATES, AND WHY THE THIRD ONE EXISTS
//
//   installable   Chrome/Edge/Samsung fired beforeinstallprompt and we held
//                 it. A real button that opens the real dialog.
//   installed     Running from the home screen (display-mode: standalone, or
//                 navigator.standalone on iOS), or appinstalled fired.
//   manual        iOS Safari — and any browser that supports installing but
//                 never fires the event. THERE IS NO API HERE. Safari has
//                 never implemented beforeinstallprompt and is not going to,
//                 so a button that calls prompt() on an iPhone does nothing
//                 at all. Rather than show a dead button to every iPhone
//                 student — which on this campus is a lot of them — this
//                 state shows the two steps Safari actually requires.
//
// A fourth possibility, a browser that cannot install at all, gets nothing on
// Home and in More, and a plain sentence in Settings saying so. Pretending
// otherwise would be worse than silence.
// ==========================
(function(){
  'use strict';

  var INSTALLED_KEY = 'aaup_installed';

  var TX = {
    en: {
      barTitle: 'Add AAUPath to your phone',
      barSub: 'No store, no account needed',
      barSubIos: 'Share → Add to Home Screen',
      go: 'Install',
      how: 'How',
      rowTitle: 'Install AAUPath',
      rowSub: 'Home screen · works offline',
      helpTitle: 'AAUPath on your home screen',
      helpInstalled: 'Installed. If you remove it, this is where you add it back.',
      helpInstallable: 'It opens like an app, starts instantly, and works with no connection. No store and no account.',
      helpManual: 'Safari cannot do this from a button. Tap Share at the bottom of the browser, then Add to Home Screen.',
      helpNone: 'This browser does not offer installing a web app. Chrome, Edge and Samsung Internet on Android do, and Safari does on iPhone through Share → Add to Home Screen.',
      installed: 'Installed',
      addBack: 'Add it back',
      iosTitle: 'Two taps in Safari',
      iosStep1: 'Tap Share at the bottom of Safari.',
      iosStep2: 'Scroll down and tap "Add to Home Screen".',
      ok: 'Got it',
      thanks: 'Added — open it from your home screen from now on.'
    },
    ar: {
      barTitle: 'ضيف التطبيق على جوالك',
      barSub: 'بلا متجر وبلا حساب',
      barSubIos: 'مشاركة ← إضافة إلى الشاشة الرئيسية',
      go: 'تثبيت',
      how: 'كيف',
      rowTitle: 'ثبّت التطبيق',
      rowSub: 'الشاشة الرئيسية · بيشتغل بدون إنترنت',
      helpTitle: 'التطبيق على شاشتك الرئيسية',
      helpInstalled: 'مثبَّت. إذا شلته، من هون بترجّعه.',
      helpInstallable: 'بيفتح زي التطبيق، بيبلّش فورًا، وبيشتغل بدون اتصال. بلا متجر وبلا حساب.',
      helpManual: 'سفاري ما بيقدر يعمل هيك من زر. اضغط "مشاركة" تحت بالمتصفح، بعدين "إضافة إلى الشاشة الرئيسية".',
      helpNone: 'هذا المتصفح ما بيوفّر تثبيت تطبيق ويب. كروم وإيدج وسامسونج إنترنت على أندرويد بيوفّروه، وسفاري على الآيفون من مشاركة ← إضافة إلى الشاشة الرئيسية.',
      installed: 'مثبَّت',
      addBack: 'رجّعه',
      iosTitle: 'نقرتين بسفاري',
      iosStep1: 'اضغط "مشاركة" تحت بسفاري.',
      iosStep2: 'انزل تحت واضغط "إضافة إلى الشاشة الرئيسية".',
      ok: 'تمام',
      thanks: 'انضاف — افتحه من شاشتك الرئيسية من هلق ورايح.'
    }
  };
  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function t(){ return TX[ar() ? 'ar' : 'en']; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s == null ? '' : s)) : String(s); }
  function ic(k, n){ return window.AAUP_ICONS ? window.AAUP_ICONS.preview(k, n || 16) : ''; }

  // ---------------------------------------------------------------------
  // State.
  var held = null;               // the beforeinstallprompt event, held

  // Running from the home screen. display-mode is the standard; iOS reports
  // it on navigator instead. The stored flag covers the gap between tapping
  // Install and the next launch, where neither of those is true yet.
  function isInstalled(){
    try{
      if(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if(window.navigator && window.navigator.standalone) return true;
      return localStorage.getItem(INSTALLED_KEY) === '1';
    }catch(e){ return false; }
  }
  function markInstalled(){
    try{ localStorage.setItem(INSTALLED_KEY, '1'); }catch(e){}
    refresh();
  }

  // iOS Safari can install, but only by hand. Chrome and Firefox ON iOS are
  // Safari underneath and behave the same way, so this tests the platform
  // rather than the browser name.
  function isIos(){
    var ua = (navigator.userAgent || '');
    var iOSDevice = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+
    return iOSDevice && !window.MSStream;
  }

  // 'installed' | 'ready' | 'manual' | 'none'
  function state(){
    if(isInstalled()) return 'installed';
    if(held) return 'ready';
    if(isIos()) return 'manual';
    return 'none';
  }
  function canOffer(){
    var s = state();
    return s === 'ready' || s === 'manual';
  }

  // ---------------------------------------------------------------------
  // Doing it.
  function install(){
    var s = state();
    if(s === 'manual'){ showIosSteps(); return; }
    if(s !== 'ready' || !held) return;
    var p = held;
    held = null;                 // a held prompt is single-use
    refresh();
    try{
      p.prompt();
      if(p.userChoice && p.userChoice.then){
        p.userChoice.then(function(res){
          if(res && res.outcome === 'accepted'){
            markInstalled();
            if(window.__showToast) window.__showToast(t().thanks);
          } else {
            // Declined. Nothing is remembered: the offer is a row on a
            // screen, not a popup, so leaving it there costs the student
            // nothing and they may well change their mind next semester.
            refresh();
          }
        }).catch(function(){});
      }
    }catch(e){}
  }

  function showIosSteps(){
    var tx = t();
    var overlay = document.getElementById('iosInstallOverlay');
    if(!overlay){
      overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.id = 'iosInstallOverlay';
      overlay.innerHTML = '<div class="modal-card"><div class="modal-body" id="iosInstallBody"></div></div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e){
        if(e.target === overlay) overlay.classList.remove('open');
      });
    }
    var body = overlay.querySelector('#iosInstallBody');
    body.setAttribute('dir', ar() ? 'rtl' : 'ltr');
    body.innerHTML =
      '<h2 class="mh">' + ic('download', 18) + esc(tx.iosTitle) + '</h2>' +
      '<ol class="ios-steps">' +
        '<li>' + esc(tx.iosStep1) + '</li>' +
        '<li>' + esc(tx.iosStep2) + '</li>' +
      '</ol>' +
      '<div class="form-actions">' +
        '<button type="button" class="home-btn" id="iosInstallOk">' + esc(tx.ok) + '</button>' +
      '</div>';
    overlay.classList.add('open');
    body.querySelector('#iosInstallOk').onclick = function(){ overlay.classList.remove('open'); };
  }

  // ---------------------------------------------------------------------
  // C · the bar under the hero on Home.
  function barHtml(){
    if(!canOffer()) return '';
    var tx = t(), manual = state() === 'manual';
    return '<div class="install-bar">' +
      '<span class="install-ic">' + ic('download', 17) + '</span>' +
      '<span class="install-copy">' +
        '<b>' + esc(tx.barTitle) + '</b>' +
        '<span>' + esc(manual ? tx.barSubIos : tx.barSub) + '</span>' +
      '</span>' +
      '<button type="button" class="install-go" data-install-go>' +
        esc(manual ? tx.how : tx.go) + '</button>' +
    '</div>';
  }

  // H · the row at the top of the More menu.
  function rowHtml(){
    if(!canOffer()) return '';
    var tx = t();
    return '<div class="sb-group sb-group-install">' +
      '<button type="button" class="sb-mrow sb-mrow-install" data-install-go>' +
        '<span class="sb-mrow-icon">' + ic('download', 17) + '</span>' +
        '<span class="sb-mrow-label"><b>' + esc(tx.rowTitle) + '</b>' +
          '<small>' + esc(tx.rowSub) + '</small></span>' +
        '<span class="sb-mrow-chevron">' + ic('chevronRight', 15) + '</span>' +
      '</button></div>';
  }

  // Settings → Help. Always rendered, in every state — this is the one that
  // has to be here when someone deleted the app and wants it back.
  function settingsHtml(){
    var tx = t(), s = state();
    var body = s === 'installed' ? tx.helpInstalled
      : s === 'ready' ? tx.helpInstallable
      : s === 'manual' ? tx.helpManual
      : tx.helpNone;
    var action = '';
    if(s === 'ready'){
      action = '<button type="button" class="home-btn install-help-btn" data-install-go>' +
        ic('download', 14) + ' ' + esc(tx.go) + '</button>';
    } else if(s === 'manual'){
      action = '<button type="button" class="home-btn install-help-btn" data-install-go>' +
        esc(tx.how) + '</button>';
    } else if(s === 'installed'){
      // No button: the browser will not re-prompt for an app it can see is
      // already installed, so one here would do nothing. The sentence above
      // says where to go instead.
      action = '<span class="install-help-done">' + ic('tick', 13) + esc(tx.installed) + '</span>';
    }
    return '<div class="install-help" id="installHelpBlock">' +
      '<div class="install-help-head">' +
        '<span class="install-help-t">' + esc(tx.helpTitle) + '</span>' + action +
      '</div>' +
      '<p class="form-note" style="margin:8px 0 0;">' + esc(body) + '</p>' +
    '</div>';
  }

  // ---------------------------------------------------------------------
  // Re-render every mount point that is currently on screen. Called whenever
  // the state can have changed: the event arriving, the install completing,
  // the language switching.
  function refresh(){
    var home = document.getElementById('homeInstallRow');
    if(home){
      var h = barHtml();
      home.innerHTML = h;
      home.hidden = !h;
    }
    var more = document.getElementById('sbInstallRow');
    if(more){
      var r = rowHtml();
      more.innerHTML = r;
      more.hidden = !r;
    }
    var help = document.getElementById('installHelpBlock');
    if(help && help.parentNode){
      var tmp = document.createElement('div');
      tmp.innerHTML = settingsHtml();
      help.parentNode.replaceChild(tmp.firstChild, help);
    }
  }

  if(typeof window !== 'undefined'){
    window.addEventListener('beforeinstallprompt', function(e){
      e.preventDefault();        // hold it rather than let the browser decide
      held = e;
      refresh();
    });
    // Fires whether they installed from our button or the browser's own menu.
    window.addEventListener('appinstalled', function(){
      held = null;
      markInstalled();
    });
    // Launched from the home screen after installing on a previous visit.
    if(window.matchMedia){
      var mq = window.matchMedia('(display-mode: standalone)');
      var onMq = function(){ if(mq.matches) markInstalled(); };
      if(mq.addEventListener) mq.addEventListener('change', onMq);
      else if(mq.addListener) mq.addListener(onMq);
    }
    // One delegated handler for all three mount points, because two of them
    // are rebuilt wholesale by their own screens on every render.
    document.addEventListener('click', function(e){
      if(e.target.closest && e.target.closest('[data-install-go]')) install();
    });
  }

  window.AAUP_INSTALL = {
    state: state, canOffer: canOffer, isInstalled: isInstalled,
    barHtml: barHtml, rowHtml: rowHtml, settingsHtml: settingsHtml,
    refresh: refresh, install: install
  };
})();
