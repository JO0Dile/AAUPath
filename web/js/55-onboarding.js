// ==========================
// FIRST-RUN LANDING
// ==========================
// The first thing a new student sees. One screen: the name, one line of what
// the app is, and the choice of signing in or not.
//
// It used to be a four-step wizard — welcome, cloud, theme, ready — three of
// whose steps a student had to tap through before reaching anything, and the
// welcome and ready steps existed only to say hello and goodbye. Theme
// belongs in Settings, where it already is. What is left is the one thing
// that genuinely has to happen before the app can be useful, which is whether
// this student's progress lives on this device or on their account.
//
// Shown once, on the same "brand-new student" signal AAUP_STUDENT already
// used for its own popup (js/15-student.js), which no longer opens itself.
(function(){
  var STEPS = [];
  var index = 0;
  var mode = 'in';        // the sign-in panel: 'in' or 'up'

  // ---- language ----------------------------------------------------------
  // The same one setting the rest of the app runs on (js/09-language.js).
  // The landing screen is where a student first says which language they
  // read, before any plan exists — and that answer is now the answer
  // everywhere, not just on this screen.
  function lang(){
    return (window.AAUP_LANG && window.AAUP_LANG.get()) || 'en';
  }
  function setLang(v){
    if(window.AAUP_LANG){ window.AAUP_LANG.set(v); }
    document.documentElement.setAttribute('lang', v);
    document.documentElement.setAttribute('dir', v === 'ar' ? 'rtl' : 'ltr');
  }
  var TX = {
    en: { line: 'Every course in your degree, and where you are on it.',
          // One button, both doors — the screen underneath offers "create one
          // instead", so a student with no account was being asked to press
          // something that read as if it were not for them.
          signIn: 'Sign in / Sign up', start: 'Start', notNow: 'Not now',
          note: 'Free, offline, and made by a student. Always confirm with your academic advisor.',
          other: 'العربية' },
    ar: { line: 'كل مساق في تخصصك، وأين أنت منه.',
          signIn: 'تسجيل الدخول / إنشاء حساب', start: 'ابدأ', notNow: 'ليس الآن',
          note: 'مجاني، يعمل بدون إنترنت، ومن صنع طالب. تأكّد دائمًا من مرشدك الأكاديمي.',
          other: 'English' }
  };
  function t(){ return TX[lang()]; }

  // The campus, drawn. A photograph would be a fixed rectangle that fights
  // every theme it is shown on; this is one stroke colour the theme sets, so
  // it belongs to whatever palette is running. It is the two things on AAUP's
  // own campus a student recognises from the road: the arched clock-tower
  // gate, and the faceted glass faculty building beside it — with the walkway
  // running up to them, which is the "path" the app is named for.
  // ---------------------------------------------------------------------
  // THE LANDING BACKDROP
  //
  // The blueprint of the walk up to the نافورة, with the faculty either
  // side. It is a picture rather than the drawn SVG that used to be here.
  //
  // Everywhere else in this app artwork is drawn in code, so it takes the
  // running theme's colour and costs a couple of kilobytes. This one screen
  // is the exception, deliberately: it is seen once, before a student has
  // signed in or picked anything, and it is never reachable again — so it
  // never meets any theme but the one it was drawn against, and there is
  // nothing for a theme-aware version to buy.
  //
  // 66 KB as WebP, from a 903 KB source: the image is line-work on a flat
  // ground, which is exactly what that format is good at. A browser too old
  // for WebP simply gets the plain background, which the screen is designed
  // to be legible on regardless.
  //
  // alt="" and aria-hidden: it is scenery, and a screen reader announcing a
  // description of it before the sign-in choice would be noise.
  //
  // AND THEN IT MOVED. The picture is still here and still the thing that
  // renders first — but a canvas now sits over it, and js/86-campus3d.js
  // rebuilds the same walk as real geometry on the GPU: the gate, the two
  // faculty blocks, the fountain, the lamps, the walkway running out under
  // the camera. It dollies in once and then drifts, and it leans with the
  // phone.
  //
  // The picture underneath is not a placeholder, it is the floor. The canvas
  // only hides it once WebGL has actually compiled, linked and started
  // drawing (.is-live). No WebGL, a lost context, an old phone, anything at
  // all throwing — the drawing is simply still there, and the screen behaves
  // exactly as it did before.
  function campusArt(){
    return '<img class="wiz-campus" src="assets/img/landing-campus.webp" ' +
           'alt="" aria-hidden="true" decoding="async">' +
           '<canvas class="wiz-campus-3d" id="wizCampus3d" aria-hidden="true"></canvas>';
  }

  // ---- the 3D campus -----------------------------------------------------
  // The scene is a module of its own (web/scene/, built to
  // bundles/landing-scene.js) and is fetched only when this screen is
  // actually shown. That is deliberate: it is by far the largest single
  // thing in the app, and it has no business being in the app shell that a
  // returning student downloads to look at their timetable. The service
  // worker caches it on first fetch, so it is offline from the second visit
  // like everything else.
  //
  // Every failure path lands in the same place — the drawing that is already
  // in the DOM stays visible and the student signs in exactly as before. No
  // WebGL, a slow network, a lost context, a thrown error: same outcome.
  var scenePromise = null;
  function loadScene(){
    if(scenePromise) return scenePromise;
    if(!window.WebGLRenderingContext) return Promise.reject(new Error('no webgl'));
    var url = new URL('bundles/landing-scene.js', document.baseURI).href;
    scenePromise = import(/* webpackIgnore: true */ url);
    return scenePromise;
  }

  // 25 · THE SCENE IS A WELCOME, NOT A DAILY EXPERIENCE.
  // It is 206 KB of bundle and a few seconds of camera move, and it is the
  // right thing to show someone the first time they open the app. It is the
  // wrong thing to show a student who has opened it to check one prerequisite
  // between classes — which is most openings, for the rest of the degree. So
  // it plays once and then the still image (already in the DOM, already the
  // no-WebGL fallback) carries the screen. Nothing is lost: the drawing is
  // what everyone without WebGL has always seen, and it is good.
  //
  // Stored as a flag rather than a count because the question is binary, and
  // a student who clears their storage gets the welcome again, which is
  // exactly right — as far as the app knows they are new.
  var SEEN_KEY = 'aaup_landingSceneSeen';
  function sceneAlreadySeen(){
    try{ return localStorage.getItem(SEEN_KEY) === '1'; }catch(e){ return false; }
  }
  function markSceneSeen(){
    try{ localStorage.setItem(SEEN_KEY, '1'); }catch(e){}
  }

  var sceneState = 'idle';   // idle | loading | live | failed | skipped
  function mountCampus(){
    var c = document.getElementById('wizCampus3d');
    if(!c) return;
    if(sceneAlreadySeen()){
      // Deliberately identical to the no-WebGL path, so there is exactly one
      // "no moving scene" appearance to design and to test.
      sceneState = 'skipped';
      var flat = c.closest('.wiz-landing');
      if(flat){ flat.classList.add('is-scene-flat'); }
      return;
    }
    var wrap = c.closest('.wiz-landing');
    if(wrap) wrap.classList.add('is-scene-loading');
    sceneState = 'loading';
    loadScene().then(function(){
      // The landing may have been left while the module was in flight.
      var still = document.getElementById('wizCampus3d');
      if(!still || !window.AAUP_CAMPUS3D){ sceneState = 'failed'; return; }
      return Promise.resolve(window.AAUP_CAMPUS3D.mount(still, {
        lang: lang(),
        // The panel is a real object in the scene; the buttons that operate
        // it are real DOM, placed over where it actually projects. That is
        // what keeps the whole thing keyboard-operable and reachable by a
        // screen reader while looking like part of the world.
        onPanelRect: function(r){
          var act = document.querySelector('.wiz-landing-actions');
          if(!act || !r.visible) return;
          act.style.setProperty('--panel-x', r.x + 'px');
          act.style.setProperty('--panel-y', r.y + 'px');
          act.style.setProperty('--panel-w', Math.max(180, r.width) + 'px');
        }
      })).then(function(ok){
        sceneState = ok ? 'live' : 'failed';
        // Only a scene that actually rendered counts as seen. A student whose
        // first visit failed on a slow phone should get the welcome on their
        // second, not be told they have already had it.
        if(ok){ markSceneSeen(); }
        var w = still.closest('.wiz-landing');
        if(w){
          w.classList.remove('is-scene-loading');
          w.classList.add(ok ? 'is-scene-live' : 'is-scene-flat');
        }
      });
    }).catch(function(){
      sceneState = 'failed';
      var w = document.querySelector('.wiz-landing');
      if(w){ w.classList.remove('is-scene-loading'); w.classList.add('is-scene-flat'); }
    });
  }
  function unmountCampus(){
    sceneState = 'idle';
    if(window.AAUP_CAMPUS3D){ window.AAUP_CAMPUS3D.stop(); }
  }

  function buildSteps(){
    // One screen when there is nothing to sign into, two when there is.
    return (window.AAUP_CLOUD && window.AAUP_CLOUD.isConfigured())
      ? ['landing', 'cloud']
      : ['landing'];
  }

  function overlay(){ return document.getElementById('onboardingWizardOverlay'); }
  function body(){ return document.getElementById('onboardingWizardBody'); }

  function stepData(i){
    if(STEPS[i] === 'landing'){
      var cloud = window.AAUP_CLOUD && window.AAUP_CLOUD.isConfigured();
      return {
        landing: true,
        primary: cloud ? t().signIn : t().start,
        secondary: cloud ? t().notNow : ''
      };
    }
    return {
      title: mode === 'up' ? 'Create your account' : 'Sign in',
      sub: 'Your progress, grades and plans follow you to any device.',
      content:
        '<div class="wiz-fields">' +
        '<input type="text" id="wizCloudIdentifier" placeholder="Email" autocomplete="username" inputmode="email">' +
        '<input type="password" id="wizCloudPassword" placeholder="Password" autocomplete="' +
          (mode === 'up' ? 'new-password' : 'current-password') + '">' +
        (mode === 'up'
          ? '<input type="text" id="wizCloudSignUpUsername" placeholder="Name (optional)" autocomplete="nickname">'
          : '') +
        '</div>' +
        '<div id="wizCloudMsg"></div>' +
        '<button type="button" class="wiz-switch" id="wizCloudToggleSignUp">' +
          (mode === 'up' ? 'I already have an account' : 'Create one instead') +
        '</button>',
      primary: mode === 'up' ? 'Create account' : 'Sign in',
      secondary: 'Not now'
    };
  }

  function render(){
    var b = body();
    if(!b) return;
    var s = stepData(index);
    if(s.landing){
      // The whole screen is the name and the choice. No progress bar, no step
      // count, no paragraph of welcome — there is nothing here to be partway
      // through.
      var tx = t();
      b.innerHTML =
        '<div class="wiz-landing" dir="' + (lang() === 'ar' ? 'rtl' : 'ltr') + '">' +
          campusArt() +
          '<button type="button" class="wiz-lang" id="wizLangToggle" lang="' +
            (lang() === 'ar' ? 'en' : 'ar') + '">' + tx.other + '</button>' +
          '<div class="wiz-brand">' +
            '<img class="wiz-brand-mark" src="assets/icons/icon-any-384.png" alt="">' +
            '<div class="wiz-brand-name">AAUPATH</div>' +
            '<div class="wiz-brand-ar" lang="ar" dir="rtl">طريقك</div>' +
          '</div>' +
          '<p class="wiz-landing-line">' + window.__escapeHtml(tx.line) + '</p>' +
          '<div class="wiz-landing-actions">' +
            '<button type="button" class="wiz-continue" id="onboardingContinue">' + window.__escapeHtml(s.primary) + '</button>' +
            (s.secondary ? '<button type="button" class="wiz-skip" id="onboardingSkip">' + window.__escapeHtml(s.secondary) + '</button>' : '') +
          '</div>' +
          '<p class="wiz-landing-note">' + window.__escapeHtml(tx.note) + '</p>' +
        '</div>';
      mountCampus();
    } else {
      unmountCampus();
      b.innerHTML =
        '<div class="wiz-body">' +
          '<div class="wiz-title">' + s.title + '</div>' +
          '<div class="wiz-sub">' + s.sub + '</div>' +
          '<div class="wiz-content">' + s.content + '</div>' +
        '</div>' +
        '<div class="wiz-foot">' +
          '<button type="button" class="wiz-back" id="onboardingBack">← Back</button>' +
          '<button type="button" class="wiz-continue" id="onboardingContinue">' + s.primary + '</button>' +
        '</div>' +
        '<button type="button" class="wiz-skip-link" id="onboardingSkip">' + s.secondary + '</button>';
    }
    bindStep();
  }

  function showCloudMsg(text, isError){
    var el = document.getElementById('wizCloudMsg');
    if(!el) return;
    el.innerHTML = '<p class="' + (isError ? 'dev-error-msg' : 'form-note') + '">' + window.__escapeHtml(text) + '</p>';
  }

  // Sign in and sign up are the same panel with one field's difference, so
  // they are one form with a mode rather than two stacked forms where a
  // hidden one used to sit under a toggle.
  function submitCloud(btn){
    var idEl = document.getElementById('wizCloudIdentifier');
    var pwEl = document.getElementById('wizCloudPassword');
    if(!idEl || !pwEl || !window.AAUP_CLOUD) return;
    var identifier = (idEl.value || '').trim();
    var password = pwEl.value || '';
    if(!identifier || !password){
      showCloudMsg(mode === 'up' ? 'Enter an email and a password.'
                                 : 'Enter your email and password.', true);
      return;
    }
    btn.disabled = true;
    if(mode === 'up'){
      var username = ((document.getElementById('wizCloudSignUpUsername') || {}).value || '').trim();
      window.AAUP_CLOUD.signUp(identifier, username, password).then(function(r){
        btn.disabled = false;
        if(!r.ok){ showCloudMsg((r.data && r.data.error) || 'Sign up failed.', true); return; }
        if(window.AAUP_STUDENT && window.AAUP_STUDENT.markSeen){ window.AAUP_STUDENT.markSeen(); }
        window.AAUP_CLOUD.startAutoSync();
        finish(true);             // a brand-new account has nothing to reconcile
        // Its recovery code, once the wizard has closed.
        if(window.AAUP_CLOUD.showPendingRecovery) setTimeout(function(){ window.AAUP_CLOUD.showPendingRecovery(); }, 400);
      });
      return;
    }
    window.AAUP_CLOUD.signIn(identifier, password).then(function(r){
      btn.disabled = false;
      if(!r.ok){ showCloudMsg((r.data && r.data.error) || 'Sign in failed.', true); return; }
      // Marked seen BEFORE any reload reconcileAfterSignIn might trigger —
      // otherwise a reload mid-flow would start it over, since nothing else
      // marks first-run done on this path.
      if(window.AAUP_STUDENT && window.AAUP_STUDENT.markSeen){ window.AAUP_STUDENT.markSeen(); }
      window.AAUP_CLOUD.reconcileAfterSignIn(false, function(res){
        window.AAUP_CLOUD.startAutoSync();
        if(res.reload){ location.reload(); return; }
        finish(true);
      });
    });
  }

  function bindCloudStep(){
    var toggle = document.getElementById('wizCloudToggleSignUp');
    if(toggle){
      toggle.addEventListener('click', function(){
        mode = mode === 'up' ? 'in' : 'up';
        render();
      });
    }
    var pw = document.getElementById('wizCloudPassword');
    if(pw){
      pw.addEventListener('keydown', function(e){
        if(e.key === 'Enter'){
          e.preventDefault();
          var btn = document.getElementById('onboardingContinue');
          if(btn) btn.click();
        }
      });
    }
  }

  function finish(celebrate){
    if(window.AAUP_STUDENT && window.AAUP_STUDENT.markSeen){ window.AAUP_STUDENT.markSeen(); }
    // The screen is gone; so is the render loop behind it.
    unmountCampus();
    var ov = overlay();
    if(ov) ov.classList.remove('open');
    if(window.__renderWelcomeMessages) window.__renderWelcomeMessages();
    // Confetti for signing in or starting, not for declining. Firing it on
    // "Not now" celebrated the student saying no.
    if(celebrate && window.__confetti) window.__confetti();
  }

  function bindStep(){
    var langBtn = document.getElementById('wizLangToggle');
    if(langBtn){
      langBtn.addEventListener('click', function(){
        setLang(lang() === 'ar' ? 'en' : 'ar');
        render();
      });
    }
    var skip = document.getElementById('onboardingSkip');
    var back = document.getElementById('onboardingBack');
    var cont = document.getElementById('onboardingContinue');
    if(skip) skip.addEventListener('click', function(){ finish(false); });
    if(back) back.addEventListener('click', function(){ index = Math.max(0, index - 1); render(); });
    if(cont) cont.addEventListener('click', function(){
      if(STEPS[index] === 'cloud'){ submitCloud(cont); return; }
      if(index >= STEPS.length - 1){ finish(true); return; }
      index++; render();
    });
    if(STEPS[index] === 'cloud'){ bindCloudStep(); }
  }

  function open(){
    setLang(lang());   // stamp <html lang/dir> from the stored choice
    STEPS = buildSteps();
    index = 0;
    mode = 'in';
    var ov = overlay();
    if(!ov) return;
    ov.classList.add('open');
    render();
  }

  function init(){
    if(window.AAUP_STUDENT && window.AAUP_STUDENT.isFirstRun && window.AAUP_STUDENT.isFirstRun()){ open(); }
  }

  window.AAUP_ONBOARDING = { open: open };

  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }
})();
