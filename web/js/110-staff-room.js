// Round 10: staff logins for deans and professors.
//
// The staff page (js/109-staff.js) stays open to anyone, read only. A dean or
// professor with a login presses Staff sign in and uses the username and
// password they chose from their setup link (#staff-setup=<username>~<code>),
// which the admin or their dean sent them. Signed in, a dean gets a "Your
// college" panel with their professors: give a login, pause, send a new link,
// remove. A professor sees the courses their login covers.
//
// Everything goes to the admin Worker's /api/staff routes (APP_ADMIN_URL),
// which check the login on every request; hiding a button here is not access
// control and does not pretend to be.
//
// Also the shared pieces the admin room's Staff logins page uses
// (js/48-admin.js): colleges of a university, the courses inside one, the
// course picker, and the setup link.
(function(){
  'use strict';

  var TOKEN_KEY = 'aaup_staffToken';
  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s == null ? '' : s)) : String(s); }
  var decoder = document.createElement('textarea');
  function plain(s){ decoder.innerHTML = String(s == null ? '' : s); return decoder.value; }
  function pick(o){ return !o ? '' : typeof o === 'string' ? o : (ar() && o.ar ? o.ar : (o.en || o.ar || '')); }

  // ---- shared: universities, colleges, courses --------------------------------------
  function uniName(id){ var u = (window.APP_UNIVERSITIES || {})[id]; return u ? (u.shortName || pick(u.name) || id) : id; }
  function collegeName(id){ var c = (window.APP_COLLEGES || {})[id]; return c ? pick(c.name) : id; }
  function universities(){
    var all = window.APP_UNIVERSITIES || {};
    return Object.keys(all).map(function(id){ return { id: id, name: uniName(id) }; });
  }
  function colleges(uni){
    var all = window.APP_COLLEGES || {};
    return Object.keys(all).filter(function(id){ return all[id].university === uni; })
      .map(function(id){ return { id: id, name: collegeName(id) }; })
      .sort(function(a, b){ return a.name.localeCompare(b.name); });
  }
  function plans(){ return window.AAUP_IMPORTED ? window.AAUP_IMPORTED.loadImportedPlans() : {}; }
  // A plan as stored on the phone keeps its college's name, not its id, so the
  // id is found by name among the university's colleges.
  function planCollege(p){
    if(p.collegeId) return p.collegeId;
    var name = p.college && (p.college.en || (typeof p.college === 'string' ? p.college : ''));
    if(!name) return '';
    var all = window.APP_COLLEGES || {};
    return Object.keys(all).filter(function(id){
      var c = all[id];
      return c.university === (p.university || 'aaup') && c.name && (c.name.en || c.name) === name;
    })[0] || '';
  }
  function plansIn(uni, college){
    var all = plans();
    return Object.keys(all).map(function(k){ return all[k]; }).filter(function(p){
      return p && (p.university || 'aaup') === uni && (!college || planCollege(p) === college);
    });
  }
  // Every course taught in a college (or a whole university), once each.
  function coursesIn(uni, college){
    var seen = {}, out = [];
    plansIn(uni, college).forEach(function(p){
      (p.courses || []).forEach(function(c){
        if(!c || !c.id || seen[c.id]) return;
        seen[c.id] = true;
        out.push({ id: c.id, name: plain(ar() && c.ar ? c.ar : c.name) });
      });
    });
    return out.sort(function(a, b){ return a.name.localeCompare(b.name); });
  }
  function courseNames(ids, uni){
    var byId = {};
    coursesIn(uni, '').forEach(function(c){ byId[c.id] = c.name; });
    return (ids || []).map(function(id){ return byId[id] || id; });
  }
  function setupLink(username, code){
    return location.origin + location.pathname + '#staff-setup=' + encodeURIComponent(username) + '~' + code;
  }

  // A search box over the courses of a college; each pick becomes a chip.
  function pickerHtml(uni, college, selected){
    var list = coursesIn(uni, college);
    var names = {};
    list.forEach(function(c){ names[c.id] = c.name; });
    var dl = 'srPickList' + Math.random().toString(36).slice(2, 8);
    return '<div class="sr-pick" data-sr-pick>' +
      '<div class="sr-chips">' + (selected || []).map(function(id){ return chipHtml(id, names[id] || id); }).join('') + '</div>' +
      '<input type="text" list="' + dl + '" class="sr-in" placeholder="' + esc(L('Type a course name, then pick it', 'اكتب اسم المساق واختاره')) + '" aria-label="' + esc(L('Add a course', 'ضيف مساق')) + '">' +
      '<datalist id="' + dl + '">' + list.map(function(c){ return '<option value="' + esc(c.name + ' · ' + c.id) + '">'; }).join('') + '</datalist>' +
    '</div>';
  }
  function chipHtml(id, name){
    return '<span class="sr-chip" data-id="' + esc(id) + '">' + esc(name) +
      '<button type="button" data-sr-unchip aria-label="' + esc(L('Remove ', 'شيل ') + name) + '">×</button></span>';
  }
  function bindPickers(root){
    root.querySelectorAll('[data-sr-pick]').forEach(function(box){
      if(box._srBound) return;
      box._srBound = true;
      var inp = box.querySelector('input');
      var add = function(){
        var m = / · ([a-z0-9][a-z0-9-]*)$/.exec(inp.value || '');
        if(!m) return;
        var id = m[1];
        if(!box.querySelector('.sr-chip[data-id="' + id + '"]')){
          box.querySelector('.sr-chips').insertAdjacentHTML('beforeend', chipHtml(id, inp.value.replace(/ · [^·]*$/, '')));
        }
        inp.value = '';
      };
      inp.addEventListener('change', add);
      inp.addEventListener('input', function(){ if(/ · [a-z0-9-]+$/.test(inp.value)) add(); });
      box.addEventListener('click', function(e){
        var x = e.target.closest('[data-sr-unchip]');
        if(x){ x.parentElement.remove(); inp.focus(); }
      });
    });
  }
  function pickerValue(root){
    var box = root.querySelector('[data-sr-pick]');
    return box ? [].map.call(box.querySelectorAll('.sr-chip'), function(c){ return c.getAttribute('data-id'); }) : [];
  }
  function linkBoxHtml(who, link){
    return '<div class="sr-link">' +
      '<b>' + esc(L('Send this link to ' + who, 'ابعت هالرابط لـ ' + who)) + '</b>' +
      '<p>' + esc(L('They open it and choose their own password. It works once, for 14 days.', 'بيفتحوه وبيختاروا كلمة السر. بيشتغل مرة وحدة، لمدة 14 يوم.')) + '</p>' +
      '<div class="sr-link-row"><input type="text" readonly class="sr-in" value="' + esc(link) + '"><button type="button" class="stf-btn stf-pri" data-sr-copy="' + esc(link) + '">' + esc(L('Copy', 'انسخ')) + '</button></div>' +
    '</div>';
  }
  function copy(text){
    var done = function(){ if(window.__showToast) window.__showToast(L('Copied', 'انتسخ')); };
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function(){ window.prompt(L('Copy this', 'انسخ'), text); });
    else window.prompt(L('Copy this', 'انسخ'), text);
  }
  function agoTx(sec){
    if(!sec) return '';
    var m = Math.round((Date.now() / 1000 - sec) / 60);
    if(m < 60) return L('just now', 'هلق');
    if(m < 1440) return L(Math.round(m / 60) + ' h ago', 'قبل ' + Math.round(m / 60) + ' ساعة');
    var d = Math.round(m / 1440);
    return d === 1 ? L('yesterday', 'مبارح') : L(d + ' days ago', 'قبل ' + d + ' يوم');
  }
  function stateTx(s){
    if(s.status === 'paused') return L('Paused', 'موقوف');
    if(!s.hasPassword) return L('Hasn’t opened their link yet', 'لسا ما فتح الرابط');
    return s.lastSeen ? L('Signed in ', 'دخل ') + agoTx(s.lastSeen) : L('Not signed in yet', 'لسا ما دخل');
  }

  // ---- the staff page's sign-in -----------------------------------------------------
  var me = null, team = null, dlg = null, dlgMsg = '', lastLink = null, busy = false;
  function token(){ try{ return localStorage.getItem(TOKEN_KEY) || ''; }catch(e){ return ''; } }
  function setToken(t){ try{ if(t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }catch(e){} }
  function base(){ return String(window.APP_ADMIN_URL || '').replace(/\/+$/, ''); }
  function api(method, path, body){
    var opts = { method: method, headers: {}, cache: 'no-store' };
    var t = token();
    if(t) opts.headers.Authorization = 'Bearer ' + t;
    if(body !== undefined){ opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(base() + path, opts).catch(function(){
      throw new Error(L('Couldn’t reach AAUPath’s server. Check the connection and try again.', 'ما قدرنا نوصل لسيرفر AAUPath. تأكد من الإنترنت وجرّب كمان مرة.'));
    }).then(function(r){
      return r.json().catch(function(){ return { error: 'HTTP ' + r.status }; }).then(function(d){
        if(r.status === 401 && !/\/(login|setup)$/.test(path)){ setToken(''); me = null; team = null; refresh(); }
        if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        return d;
      });
    });
  }
  function refresh(){ if(window.AAUP_STAFF && window.AAUP_STAFF.refresh) window.AAUP_STAFF.refresh(); }
  // Once signed in, the page moves to a major of their own (a dean's college,
  // or a major that has the professor's first course), unless it already
  // shows one or the link named a major.
  function goHome(){
    if(!me || !window.AAUP_STAFF) return;
    var mine = me.role === 'dean' ? plansIn(me.uni, me.college)
      : plansIn(me.uni, '').filter(function(p){ return (p.courses || []).some(function(c){ return (me.courses || []).indexOf(c.id) !== -1; }); });
    mine = mine.filter(function(p){ return p.structure && Array.isArray(p.structure.years) && (p.courses || []).length; });
    if(!mine.length) return;
    var cur = window.AAUP_STAFF.current && window.AAUP_STAFF.current();
    if(mine.some(function(p){ return p.id === cur; })) return;
    window.AAUP_STAFF.open(mine[0].id);
  }
  function signedIn(d){
    setToken(d.token); me = d.me; team = null; dlg = null; dlgMsg = '';
    if(me.role === 'dean') loadTeam();
    goHome();
    refresh();
    if(window.__showToast) window.__showToast(L('Signed in', 'تم الدخول'));
  }
  function loadMe(){
    if(!token() || me || !base()) return;
    api('GET', '/api/staff/me').then(function(d){
      me = d.me;
      if(me.role === 'dean') loadTeam();
      if(!/^#staff=/.test(location.hash)) goHome();
      refresh();
    }).catch(function(){});
  }
  function loadTeam(){
    api('GET', '/api/staff/team').then(function(d){ team = d.staff || []; refresh(); })
      .catch(function(e){ team = { error: e.message }; refresh(); });
  }

  // Called by js/109-staff.js while it draws the page.
  function pillHtml(){
    if(!me) return '';
    return me.role === 'dean'
      ? '<span class="sr-role sr-dean">' + esc(L('Dean · ', 'عميد · ') + collegeName(me.college)) + '</span>'
      : '<span class="sr-role sr-prof">' + esc(L('Professor', 'أستاذ')) + '</span>';
  }
  function actionsHtml(){
    if(!base()) return '';
    return me
      ? '<button type="button" class="stf-btn" data-sr="signout">' + esc(L('Sign out', 'تسجيل خروج')) + '</button>'
      : '<button type="button" class="stf-btn" data-sr="signin">' + esc(L('Staff sign in', 'دخول الكادر')) + '</button>';
  }
  function panelHtml(){
    if(!me) return '';
    if(me.role === 'dean'){
      var majorsN = plansIn(me.uni, me.college).length;
      var rows;
      if(team === null) rows = '<p class="stf-muted">' + esc(L('Loading…', 'عم نحمّل…')) + '</p>';
      else if(team.error) rows = '<p class="stf-muted">' + esc(team.error) + '</p>';
      else if(!team.length) rows = '<p class="stf-muted">' + esc(L('No professor logins yet.', 'لسا ما في حسابات أساتذة.')) + '</p>';
      else rows = team.map(function(s){
        return '<div class="sr-row' + (s.status === 'paused' ? ' is-off' : '') + '">' +
          '<div class="sr-grow"><b>' + esc(s.name || s.username) + '</b>' +
            '<small>' + esc(courseNames(s.courses, me.uni).join(L(', ', '، ')) || L('No courses yet', 'بدون مساقات')) + '</small>' +
            '<small>' + esc(stateTx(s)) + '</small></div>' +
          '<div class="sr-acts">' +
            '<button type="button" class="stf-btn" data-sr="' + (s.status === 'paused' ? 'resume' : 'pause') + '" data-id="' + esc(s.id) + '">' + esc(s.status === 'paused' ? L('Turn back on', 'رجّعه') : L('Pause', 'وقّف')) + '</button>' +
            '<button type="button" class="stf-btn" data-sr="relink" data-id="' + esc(s.id) + '">' + esc(L('New link', 'رابط جديد')) + '</button>' +
            '<button type="button" class="stf-btn sr-bad" data-sr="remove" data-id="' + esc(s.id) + '">' + esc(L('Remove', 'احذف')) + '</button>' +
          '</div></div>';
      }).join('');
      return '<aside class="stf-detail sr-panel">' +
        '<div class="stf-detail-h"><b>' + esc(L('Your college', 'كليتك')) + '</b></div>' +
        '<p class="stf-muted">' + esc(collegeName(me.college) + ' · ' + L(majorsN + ' majors', majorsN + ' تخصص')) + '</p>' +
        '<h4>' + esc(L('Professors in your college', 'أساتذة كليتك')) + '</h4>' + rows +
        (lastLink ? linkBoxHtml(lastLink.who, lastLink.link) : '') +
        '<button type="button" class="stf-btn stf-pri sr-give" data-sr="give">' + esc(L('Give a professor a login', 'اعطِ أستاذ حساب')) + '</button>' +
        '<p class="stf-muted sr-foot">' + esc(L('Click a course on the left to see its details and counts.', 'اضغط على أي مساق لتشوف تفاصيله وأعداده.')) + '</p>' +
      '</aside>';
    }
    var names = courseNames(me.courses, me.uni);
    return '<aside class="stf-detail sr-panel">' +
      '<div class="stf-detail-h"><b>' + esc(L('Your courses', 'مساقاتك')) + '</b></div>' +
      '<p class="stf-muted">' + esc(L('Signed in as ', 'داخل كـ ') + (me.name || me.username)) + '</p>' +
      (names.length ? '<ul class="sr-list">' + names.map(function(n){ return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>'
                    : '<p class="stf-muted">' + esc(L('Your login doesn’t cover any courses yet. Ask your dean to add them.', 'حسابك لسا ما فيه مساقات. اطلب من العميد يضيفها.')) + '</p>') +
      '<p class="stf-muted sr-foot">' + esc(L('Click a course on the left to see its details and counts.', 'اضغط على أي مساق لتشوف تفاصيله وأعداده.')) + '</p>' +
    '</aside>';
  }
  function dialogHtml(){
    if(!dlg) return '';
    var body;
    if(dlg === 'signin'){
      body = '<h2>' + esc(L('Staff sign in', 'دخول الكادر')) + '</h2>' +
        '<p class="stf-muted">' + esc(L('For deans and professors with a login from AAUPath. Students don’t need this.', 'للعمداء والأساتذة اللي عندهم حساب من AAUPath. الطلاب ما بيحتاجوه.')) + '</p>' +
        '<label class="sr-f"><span>' + esc(L('Username', 'اسم المستخدم')) + '</span><input class="sr-in" id="srUser" autocomplete="username" autocapitalize="off" spellcheck="false"></label>' +
        '<label class="sr-f"><span>' + esc(L('Password', 'كلمة السر')) + '</span><input class="sr-in" id="srPass" type="password" autocomplete="current-password"></label>' +
        '<button type="button" class="stf-btn stf-pri sr-wide" data-sr="dosignin">' + esc(L('Sign in', 'دخول')) + '</button>' +
        '<p class="stf-muted">' + esc(L('New here? Open the setup link you were sent to choose your password.', 'جديد؟ افتح رابط الإعداد اللي وصلك لتختار كلمة السر.')) + '</p>';
    } else if(dlg === 'setup'){
      body = '<h2>' + esc(L('Choose your password', 'اختار كلمة السر')) + '</h2>' +
        '<p class="stf-muted">' + esc(L('Your staff login is ', 'حسابك هو ') ) + '<b>' + esc(setupFor.username) + '</b>' + esc(L('. Pick a password of at least 8 characters; you’ll use both to sign in.', '. اختار كلمة سر 8 أحرف أو أكثر، ورح تستعملهم للدخول.')) + '</p>' +
        '<label class="sr-f"><span>' + esc(L('Password', 'كلمة السر')) + '</span><input class="sr-in" id="srNew1" type="password" autocomplete="new-password"></label>' +
        '<label class="sr-f"><span>' + esc(L('The same again', 'كمان مرة')) + '</span><input class="sr-in" id="srNew2" type="password" autocomplete="new-password"></label>' +
        '<button type="button" class="stf-btn stf-pri sr-wide" data-sr="dosetup">' + esc(L('Save and sign in', 'احفظ وادخل')) + '</button>';
    } else if(dlg === 'give'){
      body = '<h2>' + esc(L('Give a professor a login', 'اعطِ أستاذ حساب')) + '</h2>' +
        '<p class="stf-muted">' + esc(L('For ', 'لـ ') + collegeName(me.college) + L('. You’ll get a link to send them.', '. رح يطلعلك رابط تبعتله إياه.')) + '</p>' +
        '<label class="sr-f"><span>' + esc(L('Name (what you’ll see)', 'الاسم (اللي رح تشوفه)')) + '</span><input class="sr-in" id="srGName" maxlength="80"></label>' +
        '<label class="sr-f"><span>' + esc(L('Username (what they sign in with)', 'اسم المستخدم (للدخول)')) + '</span><input class="sr-in" id="srGUser" maxlength="32" autocapitalize="off" spellcheck="false" placeholder="calc.prof"></label>' +
        '<div class="sr-f"><span>' + esc(L('Their courses', 'مساقاته')) + '</span>' + pickerHtml(me.uni, me.college, []) + '</div>' +
        '<button type="button" class="stf-btn stf-pri sr-wide" data-sr="dogive">' + esc(L('Make the login', 'اعمل الحساب')) + '</button>';
    }
    return '<div class="sr-veil" data-sr-veil><div class="sr-dlg" role="dialog" aria-modal="true">' +
      '<button type="button" class="stf-x sr-close" data-sr="dlgclose" aria-label="' + esc(L('Close', 'إغلاق')) + '">×</button>' +
      body + (dlgMsg ? '<p class="sr-err" role="alert">' + esc(dlgMsg) + '</p>' : '') + '</div></div>';
  }
  function afterRender(view){
    bindPickers(view);
    var first = view.querySelector('.sr-dlg input:not([readonly])');
    if(first && !view.querySelector('.sr-dlg').contains(document.activeElement)) first.focus();
  }
  // Shows a message in the open dialog without redrawing it, so what was
  // typed (and the courses picked) stays put.
  function say(text){
    dlgMsg = text;
    var box = document.querySelector('.sr-dlg');
    if(!box){ refresh(); return; }
    var el = box.querySelector('.sr-err');
    if(!el){ el = document.createElement('p'); el.className = 'sr-err'; el.setAttribute('role', 'alert'); box.appendChild(el); }
    el.textContent = text;
  }
  function fail(e){ busy = false; say(e.message); }
  function val(id){ var el = document.getElementById(id); return el ? el.value : ''; }

  // Returns true when the click was one of ours.
  function onClick(e){
    var copyBtn = e.target.closest('[data-sr-copy]');
    if(copyBtn){ copy(copyBtn.getAttribute('data-sr-copy')); return true; }
    if(e.target.hasAttribute && e.target.hasAttribute('data-sr-veil')){ dlg = null; dlgMsg = ''; refresh(); return true; }
    var b = e.target.closest('[data-sr]');
    if(!b) return !!e.target.closest('.sr-dlg, [data-sr-pick]');
    var act = b.getAttribute('data-sr'), id = b.getAttribute('data-id');
    if(busy && /^do|pause|resume|relink|remove/.test(act)) return true;
    if(act === 'signin'){ dlg = 'signin'; dlgMsg = ''; refresh(); return true; }
    if(act === 'dlgclose'){ dlg = null; dlgMsg = ''; refresh(); return true; }
    if(act === 'give'){ dlg = 'give'; dlgMsg = ''; lastLink = null; refresh(); return true; }
    if(act === 'signout'){ setToken(''); me = null; team = null; lastLink = null; refresh(); return true; }
    if(act === 'dosignin'){
      busy = true;
      api('POST', '/api/staff/login', { username: val('srUser').trim(), password: val('srPass') })
        .then(function(d){ busy = false; signedIn(d); }, fail);
      return true;
    }
    if(act === 'dosetup'){
      if(val('srNew1').length < 8){ say(L('The password needs at least 8 characters.', 'كلمة السر لازم تكون 8 أحرف أو أكثر.')); return true; }
      if(val('srNew1') !== val('srNew2')){ say(L('The two passwords are different.', 'كلمتين السر مش نفس الإشي.')); return true; }
      busy = true;
      api('POST', '/api/staff/setup', { username: setupFor.username, code: setupFor.code, password: val('srNew1') })
        .then(function(d){ busy = false; setupFor = null; signedIn(d); }, fail);
      return true;
    }
    if(act === 'dogive'){
      var dlgEl = b.closest('.sr-dlg');
      var who = val('srGName').trim() || val('srGUser').trim();
      busy = true;
      api('POST', '/api/staff/team', { name: val('srGName').trim(), username: val('srGUser').trim(), courses: pickerValue(dlgEl) })
        .then(function(d){ busy = false; dlg = null; dlgMsg = ''; lastLink = { who: who, link: setupLink(d.staff.username, d.setupCode) }; loadTeam(); }, fail);
      return true;
    }
    if(act === 'pause' || act === 'resume'){
      busy = true;
      api('PATCH', '/api/staff/team/' + id, { status: act === 'pause' ? 'paused' : 'active' })
        .then(function(){ busy = false; loadTeam(); }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
      return true;
    }
    if(act === 'relink'){
      var s = (team || []).filter(function(x){ return x.id === id; })[0];
      if(s && s.hasPassword && !window.confirm(L('A new link signs ' + (s.name || s.username) + ' out until they use it to choose a new password. Make one?', 'الرابط الجديد بيطلّع ' + (s.name || s.username) + ' لحد ما يستعمله ويختار كلمة سر جديدة. نعمله؟'))) return true;
      busy = true;
      api('PATCH', '/api/staff/team/' + id, { newSetupCode: true })
        .then(function(d){ busy = false; lastLink = { who: d.staff.name || d.staff.username, link: setupLink(d.staff.username, d.setupCode) }; loadTeam(); },
              function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
      return true;
    }
    if(act === 'remove'){
      var r = (team || []).filter(function(x){ return x.id === id; })[0];
      if(!window.confirm(L('Remove ' + ((r && (r.name || r.username)) || 'this login') + '? They can’t sign in any more.', 'نحذف ' + ((r && (r.name || r.username)) || 'هالحساب') + '؟ ما رح يقدر يدخل بعدها.'))) return true;
      busy = true;
      api('DELETE', '/api/staff/team/' + id)
        .then(function(){ busy = false; loadTeam(); }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
      return true;
    }
    return false;
  }
  function onKey(e){
    if(!dlg) return false;
    if(e.key === 'Escape'){ dlg = null; dlgMsg = ''; refresh(); return true; }
    if(e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && !e.target.closest('[data-sr-pick]')){
      var go = document.querySelector('.sr-dlg [data-sr^="do"]');
      if(go){ go.click(); return true; }
    }
    return false;
  }

  // #staff-setup=<username>~<code>: open the staff page on the password step.
  var setupFor = null;
  function fromHash(){
    var m = /^#staff-setup=([^~]+)~([A-Za-z0-9-]+)$/.exec(location.hash || '');
    if(!m) return;
    setupFor = { username: decodeURIComponent(m[1]), code: m[2] };
    dlg = 'setup'; dlgMsg = '';
    // Through the ordinary #staff link, which waits for the plans to load on
    // a first visit before it opens the page.
    location.hash = 'staff';
  }
  window.addEventListener('hashchange', fromHash);
  if(document.readyState === 'complete') setTimeout(fromHash, 0); else window.addEventListener('load', fromHash);

  window.AAUP_STAFF_ROOM = {
    // the staff page
    loadMe: loadMe, pillHtml: pillHtml, actionsHtml: actionsHtml, panelHtml: panelHtml,
    dialogHtml: dialogHtml, afterRender: afterRender, onClick: onClick, onKey: onKey,
    signedIn: function(){ return !!me; },
    // shared with the admin room
    universities: universities, colleges: colleges, uniName: uniName, collegeName: collegeName,
    coursesIn: coursesIn, courseNames: courseNames, pickerHtml: pickerHtml, bindPickers: bindPickers,
    pickerValue: pickerValue, setupLink: setupLink, linkBoxHtml: linkBoxHtml, copy: copy, stateTx: stateTx
  };
})();
