// ==========================
// SHARE LINK + QR CODE — hand a plan to someone else with one tap or one
// scan, no server involved on either end.
//
// Two different things get shared, and the app tells them apart the same
// way js/36-dashboard.js already does (window.AAUP_DASHBOARD.isImportedPlan):
//
//   - A built-in major: the receiver already has the same data bundled
//     with their copy of the app, so the link only needs to carry which
//     one — #plan=<prefix>.
//   - A custom/imported plan: the receiver does NOT have that data, so the
//     link carries the whole thing — the same JSON js/28-imported.js's own
//     "Export Plan" produces, gzip-compressed (when the browser supports
//     CompressionStream) and base64url-encoded straight into the URL hash.
//     A hash fragment never reaches a server, even GitHub Pages' own — this
//     stays exactly as offline as everything else here.
//
// The QR code is drawn by js/71-qrcode.js, this app's own encoder — no CDN,
// same reasoning as everywhere else offline-first matters. A custom plan
// large enough to not fit in one QR code (rare — most are a few hundred
// courses short of that) still gets a working link, just no QR image for it.
// ==========================
(function(){
  'use strict';

  function esc(s){
    var v = String(s == null ? '' : s);
    return window.__cleanText ? window.__cleanText(v) : (window.__escapeHtml ? window.__escapeHtml(v) : v);
  }

  // ---- base64url + optional gzip -----------------------------------------

  function toBase64Url(bytes){
    var bin = '';
    for(var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromBase64Url(str){
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while(str.length % 4) str += '=';
    var bin = atob(str);
    var bytes = new Uint8Array(bin.length);
    for(var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function compressText(text){
    if(typeof CompressionStream === 'undefined'){
      return Promise.resolve({ compressed: false, bytes: new TextEncoder().encode(text) });
    }
    var stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then(function(buf){
      return { compressed: true, bytes: new Uint8Array(buf) };
    });
  }
  function decompressBytes(bytes, wasCompressed){
    if(!wasCompressed) return Promise.resolve(new TextDecoder().decode(bytes));
    if(typeof DecompressionStream === 'undefined'){
      return Promise.reject(new Error('This browser is too old to open a compressed share link.'));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then(function(buf){ return new TextDecoder().decode(buf); });
  }

  function baseUrl(){ return location.origin + location.pathname; }

  // A reference link ("#plan=<prefix>") only works if the receiver's own
  // app already has this plan's data. That is true for the four hardcoded
  // majors (never in loadImportedPlans at all) AND for anything pulled from
  // the official feed (js/30-sync.js marks it .official) that the student
  // hasn't personally edited — every install syncs the same feed. It is
  // NOT true the moment a student edits an official plan or builds one from
  // scratch, so those still need the full data in the link.
  function needsFullData(prefix){
    var plans = window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans();
    var p = plans && plans[prefix];
    if(!p) return false;
    return !(p.official && !p.wasEdited);
  }

  // Reads the side the language switch asks for, falling back to English for
  // a plan with no Arabic name — the same rule the sidebar and the dashboard
  // use, so one plan is never called two different things on two screens.
  function planNameFor(prefix){
    var arabic = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
    var imported = window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()[prefix];
    if(imported && imported.majorName){
      var side = arabic ? (imported.majorName.ar || imported.majorName.en) : imported.majorName.en;
      var parts = window.AAUP_IMPORTED.nameParts(side || '');
      if(!parts.big){ parts = window.AAUP_IMPORTED.nameParts(imported.majorName.en || ''); }
      return parts.big || imported.majorName.en || prefix;
    }
    var page = document.getElementById('page-' + prefix);
    var nameEl = page && page.querySelector('.title-block ' + (arabic ? '.ar' : '.en'));
    if(!nameEl || !nameEl.textContent.trim()){
      nameEl = page && page.querySelector('.title-block .en');
    }
    return nameEl ? nameEl.textContent.trim() : prefix;
  }

  function buildLink(prefix){
    if(!needsFullData(prefix)){
      return Promise.resolve({ url: baseUrl() + '#plan=' + encodeURIComponent(prefix),
                               isCustom: false, planName: planNameFor(prefix) });
    }
    var bundle = window.AAUP_IMPORTED && window.AAUP_IMPORTED.planBundle(prefix);
    if(!bundle) return Promise.reject(new Error('This plan could not be read.'));
    var text = JSON.stringify(bundle);
    return compressText(text).then(function(res){
      var marker = res.compressed ? 'g' : 'r';
      return { url: baseUrl() + '#import=' + marker + toBase64Url(res.bytes),
               isCustom: true, planName: planNameFor(prefix) };
    });
  }

  // Any JSON payload as an offline #hash link, gzipped when the browser can.
  // Used by the plan link above and by js/82-follow.js for a progress
  // snapshot, so both go through one encoder and one marker convention.
  function encodePayload(kind, obj){
    return compressText(JSON.stringify(obj)).then(function(res){
      return baseUrl() + '#' + kind + '=' + (res.compressed ? 'g' : 'r') + toBase64Url(res.bytes);
    });
  }

  // ---- drawing the QR (js/71-qrcode.js) ----------------------------------

  function drawQr(canvas, text){
    if(!window.__qrEncode) return false;
    var qr = window.__qrEncode(text, { ecLevel: 'L' });
    if(!qr) return false;
    // Sized so the whole code lands near 280 CSS px however many modules it
    // needs — a fixed 4px module made a dense link's code physically smaller
    // than a sparse one's, which is backwards: the denser the code, the more
    // room each module needs for a camera to resolve it. Clamped so a short
    // link does not produce an absurdly chunky one.
    var quiet = 4;
    var moduleSize = Math.max(3, Math.min(9, Math.round(280 / (qr.size + quiet * 2))));
    var total = qr.size + quiet * 2;
    canvas.width = total * moduleSize;
    canvas.height = total * moduleSize;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for(var y = 0; y < qr.size; y++){
      for(var x = 0; x < qr.size; x++){
        if(qr.get(x, y)) ctx.fillRect((x + quiet) * moduleSize, (y + quiet) * moduleSize, moduleSize, moduleSize);
      }
    }
    return true;
  }

  var TX = {
    title: { en: 'Share this plan', ar: 'شارك هذه الخطة' },
    builtinLead: { en: 'Anyone with this link opens the app straight to this major — they already have the course data, this just points at it.',
                   ar: 'أي حد معه هذا الرابط بيفتح التطبيق مباشرة على هذا التخصص — بيانات المساقات موجودة عندهم أصلاً، هذا بس بدله عليها.' },
    customLead: { en: 'This plan is one you built — the link carries the whole thing, so whoever opens it gets an exact copy to import, no download and re-upload needed.',
                  ar: 'هاي خطة أنت بنيتها — الرابط شايل كل شي فيها، فمين ما فتحه بياخذ نسخة مطابقة يستوردها، بلا تنزيل ورفع.' },
    copy: { en: 'Copy link', ar: 'انسخ الرابط' },
    copied: { en: 'Copied ✓', ar: 'انتسخ ✓' },
    // Was "Or scan this:" — an alternative to the link above it. The code is
    // the screen now, so it is an instruction, not an afterthought.
    scan: { en: 'Point a camera here to open it', ar: 'وجّه الكاميرا هنا لفتحها' },
    tooBig: { en: 'This plan is too large to fit in a QR code — the link above still works, just send it directly.',
              ar: 'هاي الخطة كبيرة كثير على رمز QR — بس الرابط فوق يشتغل تمام، ابعته مباشرة.' },
    building: { en: 'Building your link…', ar: 'عم نجهّز رابطك…' },
    error: { en: 'Could not build a share link for this plan.', ar: 'ما قدرنا نجهّز رابط مشاركة لهاي الخطة.' },
    shareVia: { en: 'Share via…', ar: 'شارك عبر…' },
    print:    { en: 'Print', ar: 'طباعة' },
    calendar: { en: 'Calendar', ar: 'التقويم' },
    progress: { en: 'My progress', ar: 'تقدّمي' },
    linkLabel: { en: 'Link', ar: 'الرابط' },
    otherWays: { en: 'Or send it another way', ar: 'أو ابعتها بطريقة ثانية' },
    copyShort: { en: 'Copy', ar: 'انسخ' }
  };
  function t(k, r){ return r ? TX[k].ar : TX[k].en; }

  function render(prefix){
    var body = document.getElementById('shareBody');
    if(!body) return;
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    body.innerHTML =
      (window.__backBarHTML ? window.__backBarHTML('', 'shareOverlay', rtl) : '') +
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('link', 20) + t('title', rtl) + '</h2>' +
      '<p class="share-loading">' + t('building', rtl) + '</p>';

    buildLink(prefix).then(function(res){
      var qrCanvasId = 'shareQrCanvas';
      body.innerHTML =
        (window.__backBarHTML ? window.__backBarHTML('', 'shareOverlay', rtl) : '') +
        '<div class="share-head"><span class="share-head-ic">' + window.AAUP_ICONS.preview('link', 18) + '</span>' +
          '<h2 class="share-title">' + t('title', rtl) + '</h2></div>' +
        '<p class="share-lead">' + t(res.isCustom ? 'customLead' : 'builtinLead', rtl) + '</p>' +
        // Code on one side, everything else on the other: the window used to
        // be 420px wide with five buttons and a long link in one column, so
        // the row ran off both edges and the whole window scrolled sideways.
        // It is wider now (.share-card) and stacks back into one column on a
        // phone.
        '<div class="share-grid">' +
        // The QR is the thing this screen exists for and the one part of it
        // that works across the room, so it opens the screen at a size a
        // phone camera can actually read. It used to sit last, under a lead
        // paragraph, a share button and a read-only URL field — below the
        // fold on a phone, small, captioned "Or scan this:" as if it were
        // the afterthought. The link is still here, demoted to where it is
        // useful: after the two buttons that are what most people want.
        '<div class="share-qr-wrap" id="shareQrWrap">' +
          '<div class="share-qr-plate"><canvas id="' + qrCanvasId + '" class="share-qr-canvas"></canvas></div>' +
          '<p class="share-qr-for">' + esc(res.planName || '') + '</p>' +
          '<p class="share-qr-label">' + t('scan', rtl) + '</p>' +
          // The app's credit, on one of the two screens whose whole job is to
          // be seen by someone who is not the student. It used to be a fixed
          // overlay on every screen in the app instead.
          '<p class="share-credit">AAUPath \u00b7 @Dile (AL-Hammam_Natsha)</p>' +
        '</div>' +
        '<div class="share-side">' +
        // The link and its Copy button sit together; a long link ends in an
        // ellipsis inside its own box rather than stretching the window.
        '<p class="share-field-label">' + t('linkLabel', rtl) + '</p>' +
        '<div class="share-link-row">' +
          '<input type="text" id="shareLinkInput" class="share-link-input" readonly dir="ltr" aria-label="' + t('linkLabel', rtl) + '" value="' + esc(res.url) + '">' +
          '<button type="button" class="home-btn share-copy-btn" id="shareCopyBtn">' + window.AAUP_ICONS.preview('copy', 14) + t('copyShort', rtl) + '</button>' +
        '</div>' +
        '<p class="share-field-label">' + t('otherWays', rtl) + '</p>' +
        // Overview & Print used to be its own menu row. It answers the same
        // question this screen answers — get this plan out of the app — one
        // as a link, one on paper, so it is a third way out from here rather
        // than a fourteenth destination in the menu.
        '<div class="share-actions">' +
          (navigator.share ? '<button type="button" class="home-btn share-native-btn" id="shareNativeBtn">' + window.AAUP_ICONS.preview('send', 14) + t('shareVia', rtl) + '</button>' : '') +
          (window.AAUP_OVERVIEW ? '<button type="button" class="home-btn" id="sharePrintBtn">' + window.AAUP_ICONS.preview('printer', 14) + t('print', rtl) + '</button>' : '') +
          (window.AAUP_CALENDAR ? '<button type="button" class="home-btn" id="shareIcsBtn">' + window.AAUP_ICONS.preview('calendar', 14) + t('calendar', rtl) + '</button>' : '') +
          // A link to the PLAN says what the degree is; this one says where
          // the sender has got to on it (js/82-follow.js).
          (window.AAUP_FOLLOW ? '<button type="button" class="home-btn" id="shareProgressBtn">' + window.AAUP_ICONS.preview('people', 14) + t('progress', rtl) + '</button>' : '') +
        '</div>' +
        '</div></div>';

      // The native share sheet, when the platform has one, goes straight
      // into whatever app the student actually wants to send this through —
      // WhatsApp, Telegram, a text message — instead of "copy link, then go
      // find the app, then paste." Copy-link and the QR code stay exactly
      // as they were beneath it: still the only option on desktop, and
      // still there on phone for a chat client this sheet doesn't offer.
      var nativeBtn = document.getElementById('shareNativeBtn');
      if(nativeBtn){
        nativeBtn.addEventListener('click', function(){
          navigator.share({ title: t('title', rtl), url: res.url }).catch(function(){});
        });
      }

      var progressBtn = document.getElementById('shareProgressBtn');
      if(progressBtn){
        progressBtn.addEventListener('click', function(){ window.AAUP_FOLLOW.open(prefix); });
      }

      var icsBtn = document.getElementById('shareIcsBtn');
      if(icsBtn){
        icsBtn.addEventListener('click', function(){ window.AAUP_CALENDAR.open(prefix); });
      }

      var printBtn = document.getElementById('sharePrintBtn');
      if(printBtn){
        printBtn.addEventListener('click', function(){ window.AAUP_OVERVIEW.open(prefix); });
      }

      var input = document.getElementById('shareLinkInput');
      var copyBtn = document.getElementById('shareCopyBtn');
      if(copyBtn){
        copyBtn.addEventListener('click', function(){
          var done = function(){
            copyBtn.innerHTML = window.AAUP_ICONS.preview('check', 14) + t('copied', rtl);
            setTimeout(function(){ copyBtn.innerHTML = window.AAUP_ICONS.preview('copy', 14) + t('copyShort', rtl); }, 1500);
          };
          if(navigator.clipboard && navigator.clipboard.writeText){
            navigator.clipboard.writeText(res.url).then(done, function(){
              if(input){ input.select(); document.execCommand('copy'); done(); }
            });
          } else if(input){
            input.select(); document.execCommand('copy'); done();
          }
        });
      }

      var canvas = document.getElementById(qrCanvasId);
      var qrWrap = document.getElementById('shareQrWrap');
      if(canvas && !drawQr(canvas, res.url) && qrWrap){
        qrWrap.innerHTML = '<p class="share-qr-toobig">' + window.AAUP_ICONS.preview('warning', 14) + t('tooBig', rtl) + '</p>';
      }
    }).catch(function(){
      body.innerHTML =
        (window.__backBarHTML ? window.__backBarHTML('', 'shareOverlay', rtl) : '') +
        '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('link', 20) + t('title', rtl) + '</h2>' +
        '<p class="ex-note">' + t('error', rtl) + '</p>';
    });
  }

  function open(prefix){
    var overlay = document.getElementById('shareOverlay');
    if(!overlay) return;
    render(prefix);
    overlay.classList.add('open');
  }

  function bindOverlay(){
    var overlay = document.getElementById('shareOverlay');
    if(!overlay) return;
    var close = function(){ overlay.classList.remove('open'); };
    var closeBtn = document.getElementById('shareClose');
    if(closeBtn) closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && overlay.classList.contains('open')) close(); });
    var card = overlay.querySelector('.modal-card');
    if(card) card.addEventListener('click', function(e){ e.stopPropagation(); });
  }
  if(document.readyState === 'complete'){ bindOverlay(); }
  else { window.addEventListener('load', bindOverlay); }

  // ---- receiving end: a link someone shared with you ---------------------
  //
  // Runs once, on load, before any "which plan is selected" logic gets a
  // chance to show something else — a share link IS the reason this visit
  // is happening, so it always wins over whatever was open last.
  function handleIncomingShare(){
    var hash = location.hash || '';
    // Home-screen shortcuts (web/manifest.json's own "shortcuts" array) land
    // here the same way a share link does — a fresh launch, hash already
    // set. They assume "continue with whatever plan I already had open",
    // the same plan window.AAUP_DASHBOARD already remembers between
    // visits, so a first-time visitor with no plan yet just quietly lands
    // on the normal picker instead — there is nothing yet for the shortcut
    // to act on.
    if(hash.indexOf('#action=') === 0){
      var action = hash.slice(8);
      history.replaceState(null, '', location.pathname + location.search);
      var actionPrefix = window.AAUP_DASHBOARD ? window.AAUP_DASHBOARD.getSelected() : null;
      if(!actionPrefix) return;
      window.AAUP_DASHBOARD.selectAndOpen(actionPrefix);
      if(action === 'assistant' && window.AAUP_ASSISTANT_UI){
        setTimeout(function(){ window.AAUP_ASSISTANT_UI.open(); }, 300);
      } else if(action === 'gpa' && window.AAUP_AUDIT){
        setTimeout(function(){ window.AAUP_AUDIT.open(actionPrefix); }, 300);
      } else if(action === 'share' && window.AAUP_SHARE){
        setTimeout(function(){ window.AAUP_SHARE.open(actionPrefix); }, 300);
      }
      return;
    }
    if(hash.indexOf('#plan=') === 0){
      var prefix = decodeURIComponent(hash.slice(6));
      history.replaceState(null, '', location.pathname + location.search);
      if(prefix && window.AAUP_DASHBOARD) window.AAUP_DASHBOARD.selectAndOpen(prefix);
      return;
    }
    if(hash.indexOf('#follow=') === 0){
      var fpayload = hash.slice(8);
      var fmarker = fpayload.charAt(0);
      var fdata = fpayload.slice(1);
      history.replaceState(null, '', location.pathname + location.search);
      if(!fdata) return;
      var fbytes;
      try{ fbytes = fromBase64Url(fdata); }catch(e){ return; }
      decompressBytes(fbytes, fmarker === 'g').then(function(jsonText){
        var snap = JSON.parse(jsonText);
        if(window.AAUP_FOLLOW) window.AAUP_FOLLOW.accept(snap);
      }).catch(function(){
        if(window.__showToast) window.__showToast('Could not open that link.');
      });
      return;
    }
    if(hash.indexOf('#import=') === 0){
      var payload = hash.slice(8);
      var marker = payload.charAt(0);
      var data = payload.slice(1);
      history.replaceState(null, '', location.pathname + location.search);
      if(!data) return;
      var bytes;
      try{ bytes = fromBase64Url(data); }catch(e){ return; }
      decompressBytes(bytes, marker === 'g').then(function(jsonText){
        var obj;
        try{ obj = JSON.parse(jsonText); }catch(e){ throw new Error('That link is not a valid plan.'); }
        var nameObj = obj && obj.majorName && obj.majorName.en;
        var name = (nameObj && (nameObj.big || nameObj)) || 'this plan';
        var msg = 'Someone shared “' + name + '” with you. Import it into your plans?';
        var doImport = function(){
          var result = window.AAUP_DEV && window.AAUP_DEV.importPlan(jsonText);
          if(result && result.ok){
            if(window.__showToast) window.__showToast('Imported — opening it now.');
            if(window.AAUP_DASHBOARD) window.AAUP_DASHBOARD.selectAndOpen(result.id);
          } else if(window.__showToast){
            window.__showToast('Could not import that plan: ' + ((result && result.errors) || ['unknown error']).join(' '));
          }
        };
        if(window.__showConfirmDialog){ window.__showConfirmDialog(msg, doImport); }
        else if(window.confirm(msg)){ doImport(); }
      }).catch(function(err){
        if(window.__showToast) window.__showToast('Could not open that share link: ' + (err && err.message || err));
      });
    }
  }
  if(document.readyState === 'complete'){ handleIncomingShare(); }
  else { window.addEventListener('load', handleIncomingShare); }

  window.AAUP_SHARE = { open: open, encodePayload: encodePayload, close: function(){ var o = document.getElementById('shareOverlay'); if(o) o.classList.remove('open'); } };
})();
