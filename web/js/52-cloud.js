// ==========================
// CLOUD SYNC
// ==========================
// Real sign-in: an email (or a chosen username) and password, verified by
// cloud/cloudflare-worker.js against Cloudflare D1, so a student's selected
// plan, progress, grades, and custom plans follow them to a new device.
// This is a different feature from js/38-accounts.js's "Accounts" — that
// lets ONE device hold several separate local profiles (a sibling sharing a
// laptop); this lets ONE profile follow a student across devices. Two
// different problems, so they get two different names throughout the UI:
// "Accounts" stays local-profile switching, this is always "Cloud Sync."
//
// The whole sign-in/up flow and account management live in ONE dedicated
// popup (open()/close() below), not spread across the general Settings
// modal — Settings only carries a one-line status + a button that opens it.
//
// Optional end to end: with window.APP_CLOUD_URL left '', isConfigured() is
// false, the Settings line says so, and nothing else about the app changes.
// Nobody's data leaves their device until a student actually signs up.
(function(){
  // Deliberately a server, not a cloud — see the Settings section below.
  // A function rather than a constant because icons.js may not have loaded
  // when this module's top level runs.
  function ICONMARK(size){ return window.AAUP_ICONS ? window.AAUP_ICONS.preview('server', size || 20) : ''; }
  function ICONBTN(key){ return window.AAUP_ICONS ? window.AAUP_ICONS.preview(key, 14) : ''; }
  var TOKEN_KEY = 'aaup_cloudToken';
  var EMAIL_KEY = 'aaup_cloudEmail';
  var USERNAME_KEY = 'aaup_cloudUsername';
  var LAST_SYNC_KEY = 'aaup_cloudLastSyncedAt';
  // Keys that exist under the aaup_ prefix but describe THIS DEVICE, not the
  // signed-in student, so they must never round-trip through a sync blob —
  // syncing "the list of local profile names on this device" from one
  // device to another would just corrupt both.
  var EXCLUDE_EXACT = { aaup_cloudToken: 1, aaup_cloudEmail: 1, aaup_cloudUsername: 1, aaup_cloudLastSyncedAt: 1,
                         aaup_accounts: 1, aaup_currentAccount: 1 };
  var EXCLUDE_PREFIX = 'aaup_account_snapshot_';
  var AUTO_SYNC_MS = 45000;

  function apiBase(){ return window.APP_CLOUD_URL || ''; }
  function isConfigured(){ return !!apiBase(); }

  function getToken(){ try{ return localStorage.getItem(TOKEN_KEY) || ''; }catch(e){ return ''; } }
  function setToken(t){ try{ localStorage.setItem(TOKEN_KEY, t); }catch(e){} }
  function clearToken(){ try{ localStorage.removeItem(TOKEN_KEY); }catch(e){} }
  function getEmail(){ try{ return localStorage.getItem(EMAIL_KEY) || ''; }catch(e){ return ''; } }
  function setEmailCache(e){ try{ localStorage.setItem(EMAIL_KEY, e || ''); }catch(e2){} }
  function getUsername(){ try{ return localStorage.getItem(USERNAME_KEY) || ''; }catch(e){ return ''; } }
  function setUsernameCache(u){ try{ localStorage.setItem(USERNAME_KEY, u || ''); }catch(e){} }
  function displayName(){ return getUsername() || getEmail(); }
  function getLastSyncedAt(){ try{ return parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10) || 0; }catch(e){ return 0; } }
  function setLastSyncedAt(t){ try{ localStorage.setItem(LAST_SYNC_KEY, String(t)); }catch(e){} }

  function isSignedIn(){ return isConfigured() && !!getToken(); }

  // ---------- HTTP ----------
  function request(path, opts){
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if(token){ headers.Authorization = 'Bearer ' + token; }
    return fetch(apiBase() + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      keepalive: !!opts.keepalive
    }).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(data){
        return { ok: res.ok, status: res.status, data: data };
      });
    }).catch(function(){
      return { ok: false, status: 0, data: { error: 'could not reach the server — check your connection' } };
    });
  }

  // ---------- the synced blob ----------
  function relevantKeys(){
    var keys = [];
    var progressKey = window.__PROGRESS_STORAGE_KEY;
    if(progressKey) keys.push(progressKey);
    try{
      for(var i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i);
        if(!k || keys.indexOf(k) !== -1) continue;
        if(EXCLUDE_EXACT[k] || k.indexOf(EXCLUDE_PREFIX) === 0) continue;
        if(k.indexOf('aaup_') === 0 || k.indexOf('aaup-imported-progress-') === 0){ keys.push(k); }
      }
    }catch(e){}
    return keys;
  }
  function collectLocalData(){
    var data = {};
    relevantKeys().forEach(function(k){ data[k] = localStorage.getItem(k); });
    return data;
  }
  function localHasMeaningfulData(){
    return relevantKeys().some(function(k){
      var v = localStorage.getItem(k);
      return v && v !== '{}' && v !== '[]' && v !== 'null';
    });
  }
  function applyRemoteData(data){
    if(!data || typeof data !== 'object') return;
    Object.keys(data).forEach(function(k){
      if(EXCLUDE_EXACT[k] || k.indexOf(EXCLUDE_PREFIX) === 0) return; // never let a synced blob overwrite this device's own identity
      if(data[k] !== null && data[k] !== undefined){ try{ localStorage.setItem(k, data[k]); }catch(e){} }
    });
  }

  // ---------- auth ----------
  function signUp(email, username, password){
    return request('/api/signup', { method: 'POST', body: { email: email, username: username || undefined, password: password } }).then(function(r){
      if(!r.ok) return r;
      setToken(r.data.token); setEmailCache(r.data.email); setUsernameCache(r.data.username);
      // Shown once, and kept only until the student says they saved it — so
      // a reload (or closing the app) before then shows it again.
      if(r.data.recoveryCode) setPendingRecovery(r.data.recoveryCode);
      // A brand-new account has nothing to conflict with — push straight away
      // so this device's data is the starting point.
      return push(null).then(function(){ return r; });
    });
  }
  // identifier: an email OR a username — the server tells the two apart by
  // shape (contains '@' and a dot => email), so the client never has to know.
  function signIn(identifier, password){
    return request('/api/login', { method: 'POST', body: { email: identifier, password: password } }).then(function(r){
      if(!r.ok) return r;
      setToken(r.data.token); setEmailCache(r.data.email); setUsernameCache(r.data.username);
      return r;
    });
  }
  function signOut(){
    // Best-effort final push so the account is left holding this device's
    // latest state, but never blocks signing out on it — a flaky connection
    // must not trap someone in a signed-in state they asked to leave.
    if(isSignedIn()){ push(getLastSyncedAt(), true); }
    clearToken(); setEmailCache(''); setUsernameCache('');
  }
  function changePassword(current, next){
    return request('/api/password/change', { method: 'POST', body: { currentPassword: current, newPassword: next } })
      .then(function(r){ if(r.ok){ setToken(r.data.token); } return r; });
  }
  // ---------- account recovery ----------
  var PENDING_RECOVERY_KEY = 'aaup_pendingRecoveryCode';
  function setPendingRecovery(code){ try{ if(code) sessionStorage.setItem(PENDING_RECOVERY_KEY, code); else sessionStorage.removeItem(PENDING_RECOVERY_KEY); }catch(e){} }
  function getPendingRecovery(){ try{ return sessionStorage.getItem(PENDING_RECOVERY_KEY) || ''; }catch(e){ return ''; } }
  // Forgot password, with the recovery code: sets a new password and signs
  // this device in. The server spends the code and hands back a new one.
  function useRecovery(identifier, code, newPassword){
    return request('/api/recovery/use', { method: 'POST', body: { identifier: identifier, code: code, newPassword: newPassword } }).then(function(r){
      if(!r.ok) return r;
      setToken(r.data.token); setEmailCache(r.data.email); setUsernameCache(r.data.username);
      if(r.data.recoveryCode) setPendingRecovery(r.data.recoveryCode);
      return r;
    });
  }
  // A new password from this signed-in device, without the old one.
  function setPasswordSignedIn(next){
    return request('/api/password/set', { method: 'POST', body: { newPassword: next } })
      .then(function(r){ if(r.ok){ setToken(r.data.token); } return r; });
  }
  function newRecoveryCode(){
    return request('/api/recovery/new', { method: 'POST', body: {} });
  }
  function googleSignIn(credential){
    return request('/api/google', { method: 'POST', body: { credential: credential } }).then(function(r){
      if(!r.ok) return r;
      setToken(r.data.token); setEmailCache(r.data.email); setUsernameCache(r.data.username);
      return r;
    });
  }

  function setUsername(username){
    return request('/api/username', { method: 'POST', body: { username: username } }).then(function(r){
      if(r.ok){ setUsernameCache(r.data.username); }
      return r;
    });
  }
  function deleteCloudAccount(){
    return request('/api/account', { method: 'DELETE' }).then(function(r){
      if(r.ok){ clearToken(); setEmailCache(''); setUsernameCache(''); setLastSyncedAt(0); }
      return r;
    });
  }

  // ---------- sync ----------
  // keepalive lets this survive a tab actually closing (used on sign-out and
  // on visibilitychange->hidden); it is NOT used for interactive pushes,
  // where a real response (and conflict handling) is expected.
  function push(baseUpdatedAt, keepalive){
    return request('/api/sync', {
      method: 'POST', keepalive: keepalive,
      body: { data: collectLocalData(), baseUpdatedAt: baseUpdatedAt }
    }).then(function(r){
      if(r.ok){ setLastSyncedAt(r.data.updatedAt); }
      return r;
    });
  }
  function pull(){
    return request('/api/sync', { method: 'GET' }).then(function(r){
      if(r.ok){ setLastSyncedAt(r.data.updatedAt); }
      return r;
    });
  }

  // The one moment this module ever has to choose between two DIFFERENT
  // sets of real data rather than just moving one forward: right after
  // sign-in, when this device already has its own progress AND the account
  // already has synced data from somewhere else. Every other push carries a
  // baseUpdatedAt and either applies cleanly or 409s onto the explicit
  // "Sync now" flow, which is never silent about a conflict either.
  function reconcileAfterSignIn(rtl, onDone){
    pull().then(function(r){
      if(!r.ok){ onDone(r); return; }
      var serverHasData = r.data.updatedAt > 0 && r.data.data && Object.keys(r.data.data).length;
      var localHasData = localHasMeaningfulData();
      if(!serverHasData){
        // Nothing synced yet under this account — this device's data becomes
        // the starting point.
        push(r.data.updatedAt).then(function(){ onDone({ ok: true }); });
        return;
      }
      if(!localHasData){
        // A fresh device (or a student who hasn't used this browser before)
        // signing into an account that already has real progress — just
        // load it, nothing here is worth asking about.
        applyRemoteData(r.data.data);
        onDone({ ok: true, applied: true, reload: true });
        return;
      }
      // Both sides have something real. Ask, rather than guessing which one
      // to throw away — the whole point of this feature is that neither copy
      // is disposable.
      showConflictChoice(rtl, function(choice){
        if(choice === 'remote'){
          applyRemoteData(r.data.data);
          onDone({ ok: true, applied: true, reload: true });
        } else if(choice === 'local'){
          push(r.data.updatedAt).then(function(){ onDone({ ok: true }); });
        } else {
          onDone({ ok: true, skipped: true });
        }
      });
    });
  }

  function showConflictChoice(rtl, onChoice){
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.style.zIndex = '1001';
    var card = document.createElement('div');
    card.className = 'modal-card';
    card.style.maxWidth = '380px';
    card.style.textAlign = 'center';
    var title = document.createElement('h3');
    title.style.margin = '0 0 8px';
    title.textContent = rtl ? 'يوجد تقدّم محفوظ في الحسابين' : 'Both this device and your account have progress';
    var text = document.createElement('p');
    text.style.cssText = 'margin:0 0 18px;color:var(--text-dim);font-size:12.5px;line-height:1.55;';
    text.textContent = rtl
      ? 'هذا الجهاز لديه تقدّم محفوظ محليًا، وحسابك السحابي لديه تقدّم محفوظ أيضًا. أيّهما تريد الاحتفاظ به؟ (الآخر سيُستبدل)'
      : 'This device has its own saved progress, and your account already has synced progress too. Which one do you want to keep? (The other will be replaced.)';
    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    function btn(label, choice){
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'home-btn';
      b.style.cssText = 'border-color:var(--accent);color:var(--text);width:100%;';
      b.textContent = label;
      b.addEventListener('click', function(){
        if(overlay.parentNode) overlay.parentNode.removeChild(overlay);
        onChoice(choice);
      });
      return b;
    }
    actions.appendChild(btn(rtl ? 'إبقاء بيانات هذا الجهاز' : 'Keep this device’s data', 'local'));
    actions.appendChild(btn(rtl ? 'استخدام البيانات المتزامنة' : 'Use the synced data', 'remote'));
    var skip = btn(rtl ? 'قرّر لاحقًا' : 'Decide later', 'skip');
    skip.className = 'home-btn'; skip.style.cssText = 'width:100%;';
    actions.appendChild(skip);
    card.appendChild(title); card.appendChild(text); card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // ---------- background upkeep ----------
  var autoTimer = null;
  function startAutoSync(){
    stopAutoSync();
    autoTimer = setInterval(function(){
      if(isSignedIn() && document.visibilityState === 'visible'){ push(getLastSyncedAt()); }
    }, AUTO_SYNC_MS);
  }
  function stopAutoSync(){ if(autoTimer){ clearInterval(autoTimer); autoTimer = null; } }
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden' && isSignedIn()){ push(getLastSyncedAt(), true); }
  });
  if(isSignedIn()){ startAutoSync(); }

  // ---------- Settings: a one-line status + a button that opens the popup ----------
  function sectionHtml(r){
    if(!isConfigured()){
      return '<h3 style="margin-bottom:6px;">' + ICONMARK(17) + ' ' + (r ? 'المزامنة بين أجهزتك' : 'Sync across devices') + '</h3>' +
        '<p class="form-note" style="margin-top:0;">' + (r
          ? 'المزامنة السحابية غير مُفعّلة لهذا التطبيق بعد. بياناتك تبقى على هذا الجهاز كما هي.'
          : 'Cloud Sync isn’t set up for this app yet. Your data stays on this device exactly as it always has.') + '</p>';
    }
    var head = '<h3 style="margin-bottom:6px;">' + ICONMARK(17) + ' ' + (r ? 'المزامنة بين أجهزتك' : 'Sync across devices') + '</h3>';

    // Signed in used to read exactly like signed out: the same heading, a
    // dim grey line of text, the same button. Nothing said the thing a
    // student signed in FOR had actually happened — that their progress is
    // off this device and safe. It is a status card now: who is signed in,
    // that the work is backed up, and when it last went up.
    if(isSignedIn()){
      var last = lastSyncLabel(r);
      var initial = (displayName() || '?').trim().charAt(0).toUpperCase();
      return head +
        '<div class="cloud-live">' +
          '<span class="cloud-live-avatar" aria-hidden="true">' + window.__escapeHtml(initial) +
            '<span class="cloud-live-tick">✓</span></span>' +
          '<span class="cloud-live-body">' +
            '<span class="cloud-live-name">' + window.__escapeHtml(displayName()) + '</span>' +
            '<span class="cloud-live-sub">' + (r
              ? 'تقدّمك محفوظ على حسابك'
              : 'Your progress is backed up to your account') + '</span>' +
            (last ? '<span class="cloud-live-when">' + window.__escapeHtml(last) + '</span>' : '') +
          '</span>' +
        '</div>' +
        '<div class="form-actions" style="justify-content:flex-start;">' +
        '<button type="button" class="home-btn" id="cloudOpenBtn">' + ICONBTN('server') +
          (r ? 'إدارة المزامنة السحابية' : 'Manage Cloud Sync') +
        '</button></div>';
    }

    return head +
      '<p class="form-note" style="margin-top:0;">' + (r ? 'غير مسجّل الدخول' : 'Not signed in') + '</p>' +
      '<div class="form-actions" style="justify-content:flex-start;">' +
      '<button type="button" class="home-btn btn-pri" id="cloudOpenBtn">' + ICONBTN('server') +
        (r ? 'تسجيل الدخول / إنشاء حساب' : 'Sign In / Sign Up') +
      '</button></div>';
  }

  function bindSection(root){
    if(!root || !isConfigured()) return;
    var openBtn = root.querySelector('#cloudOpenBtn');
    if(openBtn){ openBtn.addEventListener('click', open); }
  }

  // ---------- the dedicated popup ----------
  function detailHtml(r){
    if(isSignedIn()){
      var name = window.__escapeHtml(displayName());
      return '<h2 style="margin-top:0;">' + ICONMARK(20) + ' ' + (r ? 'المزامنة السحابية' : 'Cloud Sync') + '</h2>' +
        '<p class="form-note" style="margin-top:0;">' + (r ? 'مسجّل الدخول باسم ' : 'Signed in as ') + '<b>' + name + '</b></p>' +
        '<div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap;">' +
        '<button type="button" class="home-btn" id="cloudSyncNowBtn">' + ICONBTN('refresh') + (r ? 'مزامنة الآن' : 'Sync now') + '</button>' +
        '<button type="button" class="home-btn" id="cloudUsernameBtn">' + ICONBTN('person') + (r ? 'اسم المستخدم' : 'Username') + '</button>' +
        '<button type="button" class="home-btn" id="cloudChangePwBtn">' + ICONBTN('keys') + (r ? 'تغيير كلمة المرور' : 'Change password') + '</button>' +
        '<button type="button" class="home-btn" id="cloudRecoveryBtn">' + ICONBTN('lock') + (r ? 'رمز الاسترجاع' : 'Recovery code') + '</button>' +
        '<button type="button" class="home-btn" id="cloudSignOutBtn">' + ICONBTN('undo') + (r ? 'تسجيل الخروج' : 'Sign out') + '</button>' +
        '</div>' +
        '<p class="form-note" id="cloudSyncStatus" style="margin-top:4px;">' + lastSyncLabel(r) + '</p>' +
        '<div id="cloudUsernameForm" style="display:none;margin-top:8px;"></div>' +
        '<div id="cloudChangePwForm" style="display:none;margin-top:8px;"></div>' +
        '<div id="cloudRecoveryBox" style="display:none;margin-top:8px;"></div>' +
        '<p class="form-note" style="margin-top:14px;"><button type="button" id="cloudDeleteAcctBtn" style="background:none;border:none;color:var(--danger, #ff6b6b);font-size:11.5px;cursor:pointer;padding:0;">' +
          ICONBTN('trash') + (r ? 'حذف الحساب السحابي نهائيًا' : 'Permanently delete cloud account') + '</button></p>' +
        '<div id="cloudMsg"></div>';
    }
    return '<h2 style="margin-top:0;">' + ICONMARK(20) + ' ' + (r ? 'المزامنة السحابية' : 'Cloud Sync') + '</h2>' +
      '<p class="form-note" style="margin-top:0;">' + (r
        ? 'سجّل بإيميل أو اسم مستخدم وكلمة مرور ليتبعك تقدّمك وعلاماتك وخططك إلى أي جهاز جديد.'
        : 'Sign in with an email (or username) and password, and your progress, grades, and plans follow you to a new device.') + '</p>' +
      '<div class="form-field-row" style="flex-wrap:wrap;">' +
      '<div class="form-field"><input type="text" id="cloudIdentifier" placeholder="' + (r ? 'الإيميل أو اسم المستخدم' : 'Email or username') + '" autocomplete="username"></div>' +
      '<div class="form-field"><input type="password" id="cloudPassword" placeholder="' + (r ? 'كلمة المرور' : 'Password') + '" autocomplete="current-password"></div>' +
      '</div>' +
      '<div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap;">' +
      '<button type="button" class="home-btn btn-pri" id="cloudSignInBtn">' + ICONBTN('unlock') + (r ? 'تسجيل الدخول' : 'Sign in') + '</button>' +
      '<button type="button" class="home-btn" id="cloudToggleSignUpBtn">' + ICONBTN('plus') + (r ? 'إنشاء حساب' : 'Sign up') + '</button>' +
      '</div>' +
      '<p class="form-note" style="margin:6px 0 0;"><button type="button" class="cloud-link" id="cloudForgotBtn">' + (r ? 'نسيت كلمة المرور؟' : 'Forgot password?') + '</button></p>' +
      '<div id="cloudForgotBox" style="display:none;margin-top:10px;">' +
        '<p class="form-note" style="margin-top:0;">' + (r
          ? 'اكتب إيميلك أو اسم المستخدم، ورمز الاسترجاع اللي ظهرلك لما عملت الحساب، وكلمة مرور جديدة.'
          : 'Type your email or username, the recovery code you were shown when you made the account, and a new password.') + '</p>' +
        '<div class="form-field"><input type="text" id="cloudForgotId" placeholder="' + (r ? 'الإيميل أو اسم المستخدم' : 'Email or username') + '" autocomplete="username"></div>' +
        '<div class="form-field"><input type="text" id="cloudForgotCode" placeholder="' + (r ? 'رمز الاسترجاع (XXXX-XXXX-XXXX)' : 'Recovery code (XXXX-XXXX-XXXX)') + '" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>' +
        '<div class="form-field"><input type="password" id="cloudForgotNew" placeholder="' + (r ? 'كلمة مرور جديدة' : 'New password') + '" autocomplete="new-password"></div>' +
        '<div class="form-actions" style="justify-content:flex-start;"><button type="button" class="home-btn btn-pri" id="cloudForgotSubmit">' + ICONBTN('keys') + (r ? 'غيّر كلمة المرور' : 'Set new password') + '</button></div>' +
        '<p class="form-note">' + (r
          ? 'ما عندك الرمز؟ إذا لسا مسجّل دخول على جهاز ثاني، غيّرها من هناك (تغيير كلمة المرور ← نسيت كلمتك الحالية؟). غير هيك، تواصل مع فريق AAUPath ليعطوك كلمة مرور مؤقتة.'
          : 'No code? If you are still signed in on another phone, change it there (Change password → "Forgot your current password?"). Otherwise, contact the AAUPath team for a temporary password.') + '</p>' +
      '</div>' +
      (window.APP_GOOGLE_CLIENT_ID ? '<div class="cloud-or"><span>' + (r ? 'أو' : 'or') + '</span></div><div id="cloudGoogleBtn" class="cloud-google"></div>' : '') +
      '<div id="cloudSignUpBox" style="display:none;margin-top:10px;">' +
      '<p class="form-note" style="margin-top:0;">' + (r
        ? 'أنشئ حسابًا بنفس الإيميل أعلاه — اسم مستخدم اختياري لتسجيل دخول أسهل من الإيميل.'
        : 'Create an account with the email above — an optional username makes signing in later easier than typing a full email.') + '</p>' +
      '<div class="form-field"><input type="text" id="cloudSignUpUsername" placeholder="' + (r ? 'اسم مستخدم (اختياري)' : 'Username (optional)') + '" autocomplete="username"></div>' +
      '<div class="form-actions" style="justify-content:flex-start;">' +
      '<button type="button" class="home-btn btn-pri" id="cloudSignUpBtn">' + ICONBTN('plus') + (r ? 'إنشاء الحساب' : 'Create account') + '</button>' +
      '</div></div>' +
      '<div id="cloudMsg"></div>';
  }

  function lastSyncLabel(r){
    var t = getLastSyncedAt();
    if(!t) return '';
    var mins = Math.round((Date.now() - t) / 60000);
    var when = mins < 1 ? (r ? 'الآن' : 'just now')
      : mins < 60 ? (r ? ('قبل ' + mins + ' د') : (mins + 'm ago'))
      : (r ? ('قبل ' + Math.round(mins / 60) + ' س') : (Math.round(mins / 60) + 'h ago'));
    return (r ? 'آخر مزامنة: ' : 'Last synced: ') + when;
  }

  function showMsg(root, text, isError){
    var el = root.querySelector('#cloudMsg');
    if(!el) return;
    el.innerHTML = '<p class="' + (isError ? 'dev-error-msg' : 'form-note') + '">' + window.__escapeHtml(text) + '</p>';
  }

  function bindDetail(root, rtl){
    var syncBtn = root.querySelector('#cloudSyncNowBtn');
    if(syncBtn){
      syncBtn.addEventListener('click', function(){
        syncBtn.disabled = true; syncBtn.textContent = (rtl ? 'جارٍ...' : 'Syncing…');
        push(getLastSyncedAt()).then(function(r){
          if(r.ok){ render(); return; }
          if(r.data && r.data.conflict){
            showConflictChoice(rtl, function(choice){
              if(choice === 'remote'){ applyRemoteData(r.data.serverData); setLastSyncedAt(r.data.serverUpdatedAt); location.reload(); }
              else if(choice === 'local'){ push(r.data.serverUpdatedAt).then(render); }
              else { render(); }
            });
            return;
          }
          showMsg(root, (r.data && r.data.error) || 'Sync failed.', true);
          syncBtn.disabled = false; syncBtn.textContent = (rtl ? 'مزامنة الآن' : 'Sync now');
        });
      });
    }
    var signOutBtn = root.querySelector('#cloudSignOutBtn');
    if(signOutBtn){
      signOutBtn.addEventListener('click', function(){ signOut(); stopAutoSync(); location.reload(); });
    }
    var deleteBtn = root.querySelector('#cloudDeleteAcctBtn');
    if(deleteBtn){
      deleteBtn.addEventListener('click', function(){
        var warn = rtl
          ? 'حذف حسابك السحابي نهائيًا؟ لن يمكن استرجاعه، لكنّ بيانات هذا الجهاز نفسها تبقى محفوظة عليه كما هي.'
          : 'Permanently delete your cloud account? This can’t be undone — but this device’s own copy of your data stays right here, untouched.';
        window.__showConfirmDialog(warn, function(){
          deleteCloudAccount().then(function(r){
            if(!r.ok){ showMsg(root, (r.data && r.data.error) || 'Could not delete account.', true); return; }
            stopAutoSync();
            location.reload();
          });
        }, rtl);
      });
    }
    var usernameBtn = root.querySelector('#cloudUsernameBtn');
    if(usernameBtn){
      usernameBtn.addEventListener('click', function(){
        var box = root.querySelector('#cloudUsernameForm');
        if(!box) return;
        var showing = box.style.display !== 'none';
        if(showing){ box.style.display = 'none'; box.innerHTML = ''; return; }
        box.style.display = 'block';
        box.innerHTML =
          '<div class="form-field"><input type="text" id="cloudUsernameInput" value="' + window.__escapeHtml(getUsername()) + '" placeholder="' + (rtl ? 'اسم مستخدم' : 'Username') + '" autocomplete="username"></div>' +
          '<div class="form-actions" style="justify-content:flex-start;">' +
          '<button type="button" class="home-btn btn-pri" id="cloudUsernameSubmit">' + (rtl ? 'حفظ' : 'Save') + '</button>' +
          '</div>';
        box.querySelector('#cloudUsernameSubmit').addEventListener('click', function(){
          var val = box.querySelector('#cloudUsernameInput').value.trim();
          setUsername(val).then(function(r){
            if(!r.ok){ showMsg(root, (r.data && r.data.error) || 'Could not update username.', true); return; }
            render();
          });
        });
      });
    }
    var changePwBtn = root.querySelector('#cloudChangePwBtn');
    if(changePwBtn){
      changePwBtn.addEventListener('click', function(){
        var box = root.querySelector('#cloudChangePwForm');
        if(!box) return;
        var showing = box.style.display !== 'none';
        if(showing){ box.style.display = 'none'; box.innerHTML = ''; return; }
        box.style.display = 'block';
        box.innerHTML =
          '<div class="form-field-row" style="flex-wrap:wrap;">' +
          '<div class="form-field" id="cloudPwCurrentWrap"><input type="password" id="cloudPwCurrent" placeholder="' + (rtl ? 'كلمة المرور الحالية' : 'Current password') + '" autocomplete="current-password"></div>' +
          '<div class="form-field"><input type="password" id="cloudPwNew" placeholder="' + (rtl ? 'كلمة المرور الجديدة' : 'New password') + '" autocomplete="new-password"></div>' +
          '</div>' +
          '<p class="form-note" style="margin:0 0 6px;"><button type="button" class="cloud-link" id="cloudPwForgot">' + (rtl ? 'نسيت كلمتك الحالية؟' : 'Forgot your current password?') + '</button></p>' +
          '<div class="form-actions" style="justify-content:flex-start;">' +
          '<button type="button" class="home-btn btn-pri" id="cloudPwSubmit">' + (rtl ? 'تحديث' : 'Update') + '</button>' +
          '</div>';
        // This phone is signed in, which is proof enough: the new password
        // can be set without the old one. Other devices are signed out.
        var withoutCurrent = false;
        box.querySelector('#cloudPwForgot').addEventListener('click', function(){
          withoutCurrent = true;
          box.querySelector('#cloudPwCurrentWrap').style.display = 'none';
          this.parentNode.textContent = rtl
            ? 'بما إنك مسجّل دخول على هالجهاز، بتقدر تحط كلمة جديدة بدون القديمة. أي جهاز ثاني رح يطلع من الحساب.'
            : 'You are signed in on this phone, so you can set a new one without the old one. Any other device will be signed out.';
        });
        box.querySelector('#cloudPwSubmit').addEventListener('click', function(){
          var cur = box.querySelector('#cloudPwCurrent').value;
          var next = box.querySelector('#cloudPwNew').value;
          (withoutCurrent ? setPasswordSignedIn(next) : changePassword(cur, next)).then(function(r){
            if(!r.ok){ showMsg(root, (r.data && r.data.error) || 'Could not change password.', true); return; }
            box.style.display = 'none'; box.innerHTML = '';
            showMsg(root, rtl ? 'تم تحديث كلمة المرور.' : 'Password updated.', false);
          });
        });
      });
    }
    var recBtn = root.querySelector('#cloudRecoveryBtn');
    if(recBtn){
      recBtn.addEventListener('click', function(){
        var box = root.querySelector('#cloudRecoveryBox');
        if(!box) return;
        if(box.style.display !== 'none'){ box.style.display = 'none'; box.innerHTML = ''; return; }
        box.style.display = 'block';
        box.innerHTML = '<p class="form-note" style="margin-top:0;">' + (rtl
            ? 'رمز الاسترجاع بيرجّعك لحسابك إذا نسيت كلمة المرور. عمل رمز جديد بيلغي القديم.'
            : 'A recovery code gets you back in if you forget your password. Making a new one cancels the old one.') + '</p>' +
          '<div class="form-actions" style="justify-content:flex-start;"><button type="button" class="home-btn btn-pri" id="cloudRecNew">' + (rtl ? 'اعمل رمز جديد' : 'Make a new code') + '</button></div>';
        box.querySelector('#cloudRecNew').addEventListener('click', function(){
          newRecoveryCode().then(function(r){
            if(!r.ok){ showMsg(root, (r.data && r.data.error) || 'Could not make a code.', true); return; }
            box.innerHTML = codePanelHtml(r.data.recoveryCode, rtl);
            bindCodePanel(box, rtl, function(){ box.style.display = 'none'; box.innerHTML = ''; });
          });
        });
      });
    }
    var forgotBtn = root.querySelector('#cloudForgotBtn');
    if(forgotBtn){
      forgotBtn.addEventListener('click', function(){
        var box = root.querySelector('#cloudForgotBox');
        if(!box) return;
        var show = box.style.display === 'none';
        box.style.display = show ? 'block' : 'none';
        var idNow = (root.querySelector('#cloudIdentifier') || {}).value || '';
        var idField = root.querySelector('#cloudForgotId');
        if(show && idField && !idField.value) idField.value = idNow.trim();
      });
      var forgotSubmit = root.querySelector('#cloudForgotSubmit');
      if(forgotSubmit) forgotSubmit.addEventListener('click', function(){
        var ident = root.querySelector('#cloudForgotId').value.trim();
        var code = root.querySelector('#cloudForgotCode').value.trim();
        var next = root.querySelector('#cloudForgotNew').value;
        forgotSubmit.disabled = true;
        useRecovery(ident, code, next).then(function(r){
          forgotSubmit.disabled = false;
          if(!r.ok){ showMsg(root, (r.data && r.data.error) || 'Could not reset the password.', true); return; }
          startAutoSync();
          // The used code is spent: the new one is shown before anything else.
          showPendingRecovery({ reload: true });
        });
      });
    }
    var gHost = root.querySelector('#cloudGoogleBtn');
    if(gHost) mountGoogle(gHost, rtl, root);
    var signInBtn = root.querySelector('#cloudSignInBtn');
    var toggleSignUpBtn = root.querySelector('#cloudToggleSignUpBtn');
    if(toggleSignUpBtn){
      toggleSignUpBtn.addEventListener('click', function(){
        var box = root.querySelector('#cloudSignUpBox');
        if(box){ box.style.display = box.style.display === 'none' ? 'block' : 'none'; }
      });
    }
    if(signInBtn){
      signInBtn.addEventListener('click', function(){
        var identifier = (root.querySelector('#cloudIdentifier') || {}).value || '';
        var password = (root.querySelector('#cloudPassword') || {}).value || '';
        signInBtn.disabled = true;
        signIn(identifier.trim(), password).then(function(r){
          signInBtn.disabled = false;
          if(!r.ok){ showMsg(root, r.data.error || 'Sign in failed.', true); return; }
          reconcileAfterSignIn(rtl, function(res){
            startAutoSync();
            if(res.reload){ location.reload(); return; }
            render();
            if(window.__showToast){ window.__showToast(rtl ? 'تم تسجيل الدخول.' : 'Signed in.'); }
          });
        });
      });
    }
    var signUpBtn = root.querySelector('#cloudSignUpBtn');
    if(signUpBtn){
      signUpBtn.addEventListener('click', function(){
        var email = (root.querySelector('#cloudIdentifier') || {}).value || '';
        var username = (root.querySelector('#cloudSignUpUsername') || {}).value || '';
        var password = (root.querySelector('#cloudPassword') || {}).value || '';
        signUpBtn.disabled = true;
        signUp(email.trim(), username.trim(), password).then(function(r){
          signUpBtn.disabled = false;
          if(!r.ok){ showMsg(root, r.data.error || 'Sign up failed.', true); return; }
          startAutoSync();
          // The recovery code first; the reload waits for "I saved it".
          if(getPendingRecovery()) showPendingRecovery({ reload: true });
          else location.reload();
        });
      });
    }
  }

  // The recovery code, shown once: big, copyable, and a plain sentence on
  // why it matters.
  function codePanelHtml(code, rtl){
    return '<div class="rec-panel">' +
      '<b class="rec-title">' + (rtl ? 'رمز الاسترجاع تبعك' : 'Your recovery code') + '</b>' +
      '<div class="rec-code" dir="ltr">' + window.__escapeHtml(code) + '</div>' +
      '<p class="form-note">' + (rtl
        ? 'احفظه بمكان آمن (سكرين شوت بتزبط). هو الطريقة الوحيدة ترجع لحسابك إذا نسيت كلمة المرور وما كنت مسجّل دخول بأي جهاز. ما رح يظهر مرة ثانية.'
        : 'Keep it somewhere safe (a screenshot works). It is the only way back in if you forget your password and are not signed in anywhere. It will not be shown again.') + '</p>' +
      '<div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap;">' +
        '<button type="button" class="home-btn" data-rec-copy>' + ICONBTN('copy') + (rtl ? 'نسخ' : 'Copy') + '</button>' +
        '<button type="button" class="home-btn btn-pri" data-rec-done>' + (rtl ? 'حفظته' : 'I saved it') + '</button>' +
      '</div></div>';
  }
  function bindCodePanel(host, rtl, onDone){
    var copyBtn = host.querySelector('[data-rec-copy]');
    var code = (host.querySelector('.rec-code') || {}).textContent || '';
    if(copyBtn) copyBtn.addEventListener('click', function(){
      try{ navigator.clipboard.writeText(code); }catch(e){}
      if(window.__showToast) window.__showToast(rtl ? 'انسخ' : 'Copied');
    });
    var doneBtn = host.querySelector('[data-rec-done]');
    if(doneBtn) doneBtn.addEventListener('click', function(){ setPendingRecovery(''); if(onDone) onDone(); });
  }
  // Opens Cloud Sync on the recovery code waiting to be seen (after a sign-
  // up, or after a code was used). reload: whether to reload afterwards,
  // as the sign-up path always has.
  function showPendingRecovery(opts){
    var code = getPendingRecovery();
    if(!code) return false;
    var overlay = document.getElementById('cloudModalOverlay');
    var body = document.getElementById('cloudModalBody');
    if(!overlay || !body) return false;
    var rtl = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    body.innerHTML = '<h2 style="margin-top:0;">' + ICONMARK(20) + ' ' + (rtl ? 'المزامنة السحابية' : 'Cloud Sync') + '</h2>' + codePanelHtml(code, rtl);
    overlay.classList.add('open');
    bindCodePanel(body, rtl, function(){
      if(opts && opts.reload){ location.reload(); return; }
      render();
    });
    return true;
  }

  // Sign in with Google: Google's own button (Identity Services), loaded
  // only when APP_GOOGLE_CLIENT_ID is set and only when this form is shown.
  var gsiLoading = null;
  function loadGsi(){
    if(window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
    if(gsiLoading) return gsiLoading;
    gsiLoading = new Promise(function(resolve, reject){
      var sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client';
      sc.async = true;
      sc.onload = resolve;
      sc.onerror = function(){ gsiLoading = null; reject(new Error('could not load Google sign-in')); };
      document.head.appendChild(sc);
    });
    return gsiLoading;
  }
  function mountGoogle(host, rtl, root){
    loadGsi().then(function(){
      window.google.accounts.id.initialize({
        client_id: window.APP_GOOGLE_CLIENT_ID,
        callback: function(resp){
          googleSignIn(resp && resp.credential).then(function(r){
            if(!r.ok){ showMsg(root, (r.data && r.data.error) || 'Google sign-in failed.', true); return; }
            reconcileAfterSignIn(rtl, function(res){
              startAutoSync();
              if(res.reload){ location.reload(); return; }
              render();
              if(window.__showToast){ window.__showToast(rtl ? 'تم تسجيل الدخول.' : 'Signed in.'); }
            });
          });
        }
      });
      window.google.accounts.id.renderButton(host, {
        theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with',
        locale: rtl ? 'ar' : 'en', width: Math.min(320, host.clientWidth || 320)
      });
    }).catch(function(){
      host.innerHTML = '<p class="form-note">' + (rtl ? 'تسجيل الدخول بجوجل مش متاح هلأ.' : 'Sign in with Google is not available right now.') + '</p>';
    });
  }

  function render(){
    var body = document.getElementById('cloudModalBody');
    if(!body) return;
    // rtl-mode lives on the plan page, not on <body>, so this was always
    // false: every Arabic string below it was written and never reached.
    var rtl = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    body.innerHTML = detailHtml(rtl);
    bindDetail(body, rtl);
  }

  function open(){
    if(!isConfigured()) return;
    var overlay = document.getElementById('cloudModalOverlay');
    if(!overlay) return;
    render();
    overlay.classList.add('open');
  }
  function close(){
    var overlay = document.getElementById('cloudModalOverlay');
    if(overlay){ overlay.classList.remove('open'); }
  }

  function initModalClose(){
    var closeBtn = document.getElementById('cloudModalClose');
    var overlay = document.getElementById('cloudModalOverlay');
    if(closeBtn){ closeBtn.addEventListener('click', close); }
    if(overlay){ overlay.addEventListener('click', function(e){ if(e.target === overlay){ close(); } }); }
    // Same keyboard escape hatch the other modals have.
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && overlay && overlay.classList.contains('open')){ close(); } });
  }
  if(document.readyState === 'complete'){ initModalClose(); }
  else { window.addEventListener('load', initModalClose); }

  window.AAUP_CLOUD = {
    isConfigured: isConfigured, isSignedIn: isSignedIn, getEmail: getEmail, getUsername: getUsername, displayName: displayName,
    sectionHtml: sectionHtml, bindSection: bindSection,
    open: open, close: close,
    // Exposed so the first-run wizard (js/55-onboarding.js) can offer sign
    // in/up inline without duplicating this module's auth or conflict-
    // resolution logic — reconcileAfterSignIn is the one place a genuine
    // "two real copies of data" choice has to be made, and it's worth
    // reusing rather than re-deciding differently in a second place.
    signIn: signIn, signUp: signUp, reconcileAfterSignIn: reconcileAfterSignIn, startAutoSync: startAutoSync,
    showPendingRecovery: showPendingRecovery
  };
  // A recovery code the student has not confirmed saving yet (the app was
  // reloaded or closed first) is shown again.
  if(document.readyState === 'complete'){ setTimeout(function(){ showPendingRecovery(); }, 1200); }
  else { window.addEventListener('load', function(){ setTimeout(function(){ showPendingRecovery(); }, 1200); }); }
})();
