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
  function plans(){
    if(window.AAUP_STAFF && window.AAUP_STAFF.plans) return window.AAUP_STAFF.plans();
    return window.AAUP_IMPORTED ? window.AAUP_IMPORTED.loadImportedPlans() : {};
  }
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
  // college: '' or '*' for every college, else one id or several joined by commas.
  function collegeIds(college){ return String(college || '').split(',').map(function(x){ return x.trim(); }).filter(function(x){ return x && x !== '*'; }); }
  function collegeLabel(college, short){
    if(!college || college === '*') return L('All colleges', 'كل الكليات');
    var ids = collegeIds(college);
    return ids.length > (short ? 1 : 2) ? L(ids.length + ' colleges', ids.length + ' كليات') : ids.map(collegeName).join(L(' and ', ' و'));
  }
  function plansIn(uni, college){
    var all = plans(), ids = collegeIds(college);
    return Object.keys(all).map(function(k){ return all[k]; }).filter(function(p){
      return p && (p.university || 'aaup') === uni && (!ids.length || ids.indexOf(planCollege(p)) !== -1);
    });
  }
  // Every course taught in a college (or a whole university), once each by
  // name. The same course can carry a different id in each major (Advanced
  // English is 010610035 in one and advanced-english in another), so a name
  // stands for all of its ids, and picking it covers the course everywhere.
  function coursesIn(uni, college){
    var byName = {}, out = [];
    plansIn(uni, college).forEach(function(p){
      (p.courses || []).forEach(function(c){
        if(!c || !c.id) return;
        var name = plain(ar() && c.ar ? c.ar : c.name);
        var key = name.toLowerCase().replace(/\s+/g, ' ').trim();
        var e = byName[key];
        if(!e){ e = byName[key] = { name: name, ids: [] }; out.push(e); }
        if(e.ids.indexOf(c.id) === -1) e.ids.push(c.id);
      });
    });
    out.forEach(function(e){ e.id = e.ids[0]; });
    return out.sort(function(a, b){ return a.name.localeCompare(b.name); });
  }
  function courseNames(ids, uni){
    var byId = {}, seen = {}, out = [];
    coursesIn(uni, '').forEach(function(c){ c.ids.forEach(function(id){ byId[id] = c.name; }); });
    (ids || []).forEach(function(id){ var n = byId[id] || id; if(!seen[n]){ seen[n] = 1; out.push(n); } });
    return out;
  }
  function setupLink(username, code){
    return location.origin + location.pathname + '#staff-setup=' + encodeURIComponent(username) + '~' + code;
  }

  // A search box over the courses of a college: type part of a name, pick it
  // from the list, and it becomes a chip. Names only, each once.
  // `only`: an explicit list to pick from (a plan's own courses), instead of
  // every course of the college. `tag`: remembered on the box (a course id).
  var pickerLists = {}, pickerN = 0;
  function pickerHtml(uni, college, selected, only, tag){
    var list = only || coursesIn(uni, college);
    var key = 'p' + (++pickerN);
    pickerLists[key] = list;
    var sel = {};
    (selected || []).forEach(function(id){ sel[id] = 1; });
    var chips = list.filter(function(c){ return c.ids.some(function(id){ return sel[id]; }); });
    return '<div class="sr-pick" data-sr-pick data-list="' + key + '"' + (tag ? ' data-tag="' + esc(tag) + '"' : '') + '>' +
      '<div class="sr-chips">' + chips.map(chipHtml).join('') + '</div>' +
      '<div class="sr-pick-in"><input type="text" class="sr-in" autocomplete="off" placeholder="' + esc(L('Type part of a course name…', 'اكتب جزء من اسم المساق…')) + '" aria-label="' + esc(L('Add a course', 'ضيف مساق')) + '">' +
      '<div class="sr-opts" role="listbox" hidden></div></div>' +
    '</div>';
  }
  function chipHtml(c){
    return '<span class="sr-chip" data-ids="' + esc(c.ids.join(',')) + '">' + esc(c.name) +
      '<button type="button" data-sr-unchip aria-label="' + esc(L('Remove ', 'شيل ') + c.name) + '">×</button></span>';
  }
  function norm(t){ return String(t || '').toLowerCase().replace(/[ً-ْ]/g, '').replace(/[أإآ]/g, 'ا').replace(/\s+/g, ' ').trim(); }
  function bindPickers(root){
    root.querySelectorAll('[data-sr-pick]').forEach(function(box){
      if(box._srBound) return;
      box._srBound = true;
      var inp = box.querySelector('input'), opts = box.querySelector('.sr-opts');
      var all = pickerLists[box.getAttribute('data-list')] || [];
      var hits = [], at = 0;
      var chosen = function(){ var m = {}; box.querySelectorAll('.sr-chip').forEach(function(c){ m[c.textContent.replace(/×$/, '')] = 1; }); return m; };
      var draw = function(){
        var q = norm(inp.value), have = chosen();
        hits = all.filter(function(c){ return !have[c.name] && (!q || norm(c.name).indexOf(q) !== -1); }).slice(0, 8);
        at = 0;
        opts.innerHTML = hits.length ? hits.map(function(c, i){
          return '<button type="button" role="option" class="sr-opt' + (i === 0 ? ' is-on' : '') + '" data-i="' + i + '">' + esc(c.name) + '</button>';
        }).join('') : '<p class="sr-opt-none">' + esc(L('No course by that name here.', 'ما في مساق بهالاسم هون.')) + '</p>';
        opts.hidden = false;
      };
      var changed = function(){
        var tag = box.getAttribute('data-tag');
        if(tag){ preDraft[tag] = pickerValue(box.parentElement); if(prePreview[tag]){ delete prePreview[tag]; refresh(); } }
      };
      var add = function(c){
        if(!c) return;
        box.querySelector('.sr-chips').insertAdjacentHTML('beforeend', chipHtml(c));
        inp.value = ''; opts.hidden = true; inp.focus();
        changed();
      };
      inp.addEventListener('input', draw);
      inp.addEventListener('focus', draw);
      inp.addEventListener('blur', function(){ setTimeout(function(){ opts.hidden = true; }, 150); });
      inp.addEventListener('keydown', function(e){
        if(opts.hidden || !hits.length) return;
        if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
          e.preventDefault();
          at = (at + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
          opts.querySelectorAll('.sr-opt').forEach(function(b, i){ b.classList.toggle('is-on', i === at); });
        } else if(e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); add(hits[at]); }
        else if(e.key === 'Escape'){ e.stopPropagation(); opts.hidden = true; }
      });
      opts.addEventListener('mousedown', function(e){ var b = e.target.closest('.sr-opt'); if(b){ e.preventDefault(); add(hits[+b.getAttribute('data-i')]); } });
      box.addEventListener('click', function(e){
        var x = e.target.closest('[data-sr-unchip]');
        if(x){ x.parentElement.remove(); inp.focus(); changed(); }
      });
    });
  }
  function pickerValue(root){
    var box = root.querySelector('[data-sr-pick]'), out = [];
    if(box) box.querySelectorAll('.sr-chip').forEach(function(c){
      c.getAttribute('data-ids').split(',').forEach(function(id){ if(id && out.indexOf(id) === -1) out.push(id); });
    });
    return out;
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
  var me = null, team = null, dlg = null, dlgMsg = '', lastLink = null, busy = false, askRelink = null;
  // A staff login, or else the admin's session in this tab (the admin works
  // on the staff page as a dean of every college).
  var adminOff = false;
  function token(){
    try{
      return localStorage.getItem(TOKEN_KEY) || (adminOff ? '' : sessionStorage.getItem('aaup_adminToken') || '');
    }catch(e){ return ''; }
  }
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
  // Redraws the staff page. Whatever is being typed in a form (fields marked
  // data-keep) survives the redraw, unless a save just replaced it.
  var dropKept = false;
  function refresh(){
    if(!(window.AAUP_STAFF && window.AAUP_STAFF.refresh)) return;
    var kept = {}, focus = document.activeElement && document.activeElement.id;
    if(!dropKept) document.querySelectorAll('#staffView [data-keep]').forEach(function(e){ kept[e.id] = e.value; });
    dropKept = false;
    window.AAUP_STAFF.refresh();
    Object.keys(kept).forEach(function(id){ var e = document.getElementById(id); if(e) e.value = kept[id]; });
    if(focus){ var f = document.getElementById(focus); if(f && f.focus) f.focus(); }
  }
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
  // What is live for students now (fresh, not the phone's copy), what is
  // waiting for a dean, and the professor's own card.
  var live = null, pending = null, myCard = null;
  function loadWork(){
    if(!me) return;
    fetch(base() + '/api/public/content?uni=' + encodeURIComponent(me.uni) + '&_=' + Date.now(), { cache: 'no-store' })
      .then(function(r){ return r.json(); }).then(function(j){ live = (j && j.courses) || {}; refresh(); }).catch(function(){ live = {}; });
    api('GET', '/api/staff/pending').then(function(d){ pending = d.pending || []; refresh(); }).catch(function(){ pending = []; });
    api('GET', '/api/staff/card').then(function(d){ myCard = d.card || {}; refresh(); }).catch(function(){ myCard = {}; });
  }
  function signedIn(d){
    setToken(d.token); me = d.me; team = null; dlg = null; dlgMsg = '';
    live = pending = myCard = null; loadWork();
    if(me.role === 'dean') loadTeam();
    goHome();
    refresh();
    if(window.__showToast) window.__showToast(L('Signed in', 'تم الدخول'));
  }
  function loadMe(){
    if(!token() || me || !base()) return;
    api('GET', '/api/staff/me').then(function(d){
      me = d.me;
      loadWork();
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
    if(me.admin) return '<span class="sr-role sr-dean">' + esc(L('Admin · all colleges', 'الإدارة · كل الكليات')) + '</span>';
    return me.role === 'dean'
      ? '<span class="sr-role sr-dean">' + esc(L('Dean · ', 'عميد · ') + collegeLabel(me.college, true)) + '</span>'
      : '<span class="sr-role sr-prof">' + esc(L('Professor', 'أستاذ')) + '</span>';
  }
  function actionsHtml(){
    if(!base()) return '';
    var cur = window.AAUP_STAFF && window.AAUP_STAFF.current && window.AAUP_STAFF.current();
    var editable = me && me.role === 'dean' && cur && plansIn(me.uni, me.college).some(function(p){ return p.id === cur; });
    return me
      ? (editable ? '<button type="button" class="stf-btn" data-sr="editmajor">' + esc(L('Edit this major', 'عدّل هالتخصص')) + '</button>' : '') +
        '<button type="button" class="stf-btn" data-sr="signout">' + esc(L('Sign out', 'تسجيل خروج')) + '</button>'
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
          '</div></div>' +
          (askRelink === s.id ? '<div class="sr-link"><b>' + esc(L('Make a new link for ' + (s.name || s.username) + '?', 'نعمل رابط جديد لـ ' + (s.name || s.username) + '؟')) + '</b>' +
            '<p>' + esc(L('It signs them out until they open it and choose a new password.', 'بيطلّعه لحد ما يفتحه ويختار كلمة سر جديدة.')) + '</p>' +
            '<div class="sr-link-row"><button type="button" class="stf-btn stf-pri" data-sr="relinkgo" data-id="' + esc(s.id) + '">' + esc(L('Make the new link', 'اعمل الرابط')) + '</button>' +
            '<button type="button" class="stf-btn" data-sr="relinkno">' + esc(L('Cancel', 'إلغاء')) + '</button></div></div>' : '');
      }).join('');
      return '<aside class="stf-detail sr-panel">' +
        '<div class="stf-detail-h"><b>' + esc(collegeIds(me.college).length === 1 ? L('Your college', 'كليتك') : L('Your colleges', 'كلياتك')) + '</b></div>' +
        '<p class="stf-muted">' + esc(collegeLabel(me.college) + ' · ' + L(majorsN + ' majors', majorsN + ' تخصص')) + '</p>' +
        waitingHtml() +
        '<h4>' + esc(L('Professors', 'الأساتذة')) + '</h4>' + rows +
        (lastLink ? linkBoxHtml(lastLink.who, lastLink.link) : '') +
        '<button type="button" class="stf-btn stf-pri sr-give" data-sr="give">' + esc(L('Give a professor a login', 'اعطِ أستاذ حساب')) + '</button>' +
        '<p class="stf-muted sr-foot">' + esc(L('Click a course on the left to see its details and counts.', 'اضغط على أي مساق لتشوف تفاصيله وأعداده.')) + '</p>' +
      '</aside>';
    }
    // E · the professor's page: each course with what it has, and their card.
    var mine = coursesIn(me.uni, '').filter(function(c){ return c.ids.some(function(id){ return (me.courses || []).indexOf(id) !== -1; }); });
    return '<aside class="stf-detail sr-panel">' +
      '<div class="stf-detail-h"><b>' + esc(L('Your courses', 'مساقاتك')) + '</b></div>' +
      '<p class="stf-muted">' + esc(L('Signed in as ', 'داخل كـ ') + (me.name || me.username)) + '</p>' +
      (mine.length ? mine.map(function(c){
        var info = {};
        c.ids.forEach(function(id){ var x = (live || {})[id]; if(x) Object.keys(x).forEach(function(f){ info[f] = x[f]; }); });
        var secs = Array.isArray(info.sections) ? info.sections.length : 0;
        var note = info.note && info.note.until >= todayIso() ? info.note : null;
        var waits = (pending || []).filter(function(p){ return c.ids.indexOf(p.course) !== -1; }).length;
        var line = [secs ? L(secs + (secs === 1 ? ' section' : ' sections'), secs + ' شعب') : L('no sections yet', 'بدون شعب'),
                    note ? L('note until ', 'ملاحظة لحد ') + note.until : L('no note', 'بدون ملاحظة'),
                    waits ? L(waits + ' waiting for your dean', waits + ' بستنّى العميد') : ''].filter(Boolean).join(' · ');
        return '<div class="sr-row sr-row-line"><div class="sr-grow"><b>' + esc(c.name) + '</b><small>' + esc(line) + '</small></div>' +
          '<button type="button" class="stf-btn" data-sr="opencourse" data-id="' + esc(c.ids.join(',')) + '">' + esc(L('Open', 'افتح')) + '</button></div>';
      }).join('') : '<p class="stf-muted">' + esc(L('Your login doesn’t cover any courses yet. Ask your dean to add them.', 'حسابك لسا ما فيه مساقات. اطلب من العميد يضيفها.')) + '</p>') +
      waitingHtml() + cardFormHtml() +
      '<p class="stf-muted sr-foot">' + esc(L('Click a course on the left to see its details and counts.', 'اضغط على أي مساق لتشوف تفاصيله وأعداده.')) + '</p>' +
    '</aside>';
  }
  function todayIso(){ var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // ---- writing for students (part B) ------------------------------------------------
  var FIELD_TX = {
    about: ['About this course', 'عن المساق'], revise: ['Revise first', 'راجع قبل'], offered: ['Offered in', 'بتنعطى بـ'],
    prereqNote: ['Prerequisite note', 'ملاحظة عن المتطلبات'], note: ['Pinned note', 'ملاحظة مثبّتة'],
    sections: ['Sections', 'الشعب']
  };
  function fieldTx(f){ var x = FIELD_TX[f] || [f, f]; return L(x[0], x[1]); }
  function offeredTx(v){ return v === 's1' ? L('First semester only', 'الفصل الأول بس') : v === 's2' ? L('Second semester only', 'الفصل الثاني بس') : L('Both semesters', 'الفصلين'); }
  function valueTx(field, v){
    if(field === 'offered') return offeredTx(v);
    if(field === 'note'){
      if(!v) return '';
      try{ var n = typeof v === 'string' ? JSON.parse(v) : v; return n.text + L(' (until ', ' (لحد ') + n.until + ')'; }catch(e){ return String(v); }
    }
    if(field === 'sections'){
      try{ var sl = typeof v === 'string' ? JSON.parse(v) : v; return (sl || []).map(function(x){ return L('Section ', 'شعبة ') + x.n + ': ' + sectionLine(x); }).join(' · '); }catch(e){ return ''; }
    }
    if(field === 'card'){
      try{ var c = JSON.parse(v); return [c.office, c.hours, c.contact].filter(Boolean).join(' · '); }catch(e){ return ''; }
    }
    return v || '';
  }
  function mayWrite(courseId){
    if(!me) return false;
    if(me.role === 'professor') return (me.courses || []).indexOf(courseId) !== -1;
    return plansIn(me.uni, me.college).some(function(p){ return (p.courses || []).some(function(c){ return c.id === courseId; }); });
  }
  // What the form starts from: my own waiting change if there is one, else
  // what students see now.
  function current(courseId, field){
    var w = (pending || []).filter(function(p){ return p.kind === 'content' && p.course === courseId && p.field === field && p.by === me.username; })[0];
    if(w) return (w.field === 'note' || w.field === 'sections') && w.value ? JSON.parse(w.value) : w.value;
    var c = (live || {})[courseId] || {};
    return c[field] || '';
  }
  // ---- the course panel (A for a dean, D for a professor) -------------------------------
  var DAYS = [[6, 'Sat', 'سبت'], [0, 'Sun', 'أحد'], [1, 'Mon', 'اثنين'], [2, 'Tue', 'ثلاثاء'], [3, 'Wed', 'أربعاء'], [4, 'Thu', 'خميس'], [5, 'Fri', 'جمعة']];
  function fmt(t){ return window.__fmtTime ? window.__fmtTime(t) : t; }
  function sectionLine(x){
    var days = DAYS.filter(function(y){ return (x.days || []).indexOf(y[0]) !== -1; }).map(function(y){ return L(y[1], y[2]); }).join(L(', ', '، '));
    return [days, fmt(x.s) + '–' + fmt(x.e), x.room].filter(Boolean).join(' · ');
  }
  var secDraft = {}, secOpen = {}, preDraft = {}, prePreview = {};
  function draftFor(id){
    if(!secDraft[id]){
      var cur = current(id, 'sections');
      if(typeof cur === 'string' && cur) try{ cur = JSON.parse(cur); }catch(e){ cur = []; }
      secDraft[id] = Array.isArray(cur) ? JSON.parse(JSON.stringify(cur)) : [];
    }
    return secDraft[id];
  }
  function plansNow(){ var p = plans(), cur = window.AAUP_STAFF && window.AAUP_STAFF.current && window.AAUP_STAFF.current(); return { p: p[cur], id: cur }; }
  function prereqsOf(id){
    var pl = plansNow().p;
    return pl ? (pl.prerequisites || []).filter(function(x){ return x[1] === id; }).map(function(x){ return x[0]; }) : [];
  }
  function courseName2(id){
    var pl = plansNow().p, c = pl && (pl.courses || []).filter(function(x){ return x.id === id; })[0];
    return c ? plain(ar() && c.ar ? c.ar : c.name) : id;
  }
  function sectionsHtml(id){
    var list = draftFor(id);
    return list.map(function(x, i){
      var open = secOpen[id] === i;
      return '<div class="sr-sec">' +
        '<div class="sr-sec-h"><b>' + esc(L('Section ', 'شعبة ') + (x.n || i + 1)) + '</b>' +
          '<button type="button" class="stf-btn" data-sr="secedit" data-course="' + esc(id) + '" data-i="' + i + '">' + esc(open ? L('Done', 'تمام') : L('Edit', 'عدّل')) + '</button>' +
          '<button type="button" class="stf-btn sr-bad" data-sr="secdel" data-course="' + esc(id) + '" data-i="' + i + '" aria-label="' + esc(L('Remove section', 'احذف الشعبة')) + '">×</button></div>' +
        (open
          ? '<div class="sr-days">' + DAYS.map(function(d){
              return '<button type="button" class="sr-day' + ((x.days || []).indexOf(d[0]) !== -1 ? ' is-on' : '') + '" data-sr="secday" data-course="' + esc(id) + '" data-i="' + i + '" data-d="' + d[0] + '">' + esc(L(d[1], d[2])) + '</button>';
            }).join('') + '</div>' +
            '<div class="sr-sec-grid">' +
              '<label><span>' + esc(L('Starts', 'بتبدأ')) + '</span><input class="sr-in" type="time" data-sec="' + esc(id) + ':' + i + ':s" value="' + esc(x.s || '') + '"></label>' +
              '<label><span>' + esc(L('Ends', 'بتخلص')) + '</span><input class="sr-in" type="time" data-sec="' + esc(id) + ':' + i + ':e" value="' + esc(x.e || '') + '"></label>' +
              '<label><span>' + esc(L('Room', 'القاعة')) + '</span><input class="sr-in" maxlength="40" data-sec="' + esc(id) + ':' + i + ':room" value="' + esc(x.room || '') + '" placeholder="B-110"></label>' +
            '</div>' +
            '<label class="sr-f"><span>' + esc(L('Professor', 'المدرّس')) + '</span><input class="sr-in" maxlength="80" data-sec="' + esc(id) + ':' + i + ':prof" value="' + esc(x.prof || '') + '"></label>'
          : '<small>' + esc(sectionLine(x) || L('No days or times yet', 'لسا بدون أيام وأوقات')) + '</small>' + (x.prof ? '<small>' + esc(x.prof) + '</small>' : '')) +
      '</div>';
    }).join('') +
    '<button type="button" class="stf-btn" data-sr="secadd" data-course="' + esc(id) + '">' + esc(L('+ Add a section', '+ ضيف شعبة')) + '</button>';
  }
  function prereqHtml(id){
    var dean = me.role === 'dean';
    var now = prereqsOf(id);
    if(!dean){
      return '<div class="sr-f"><span>' + esc(L('Prerequisites', 'المتطلبات')) + '</span>' +
        '<p class="sr-ro">' + esc(now.length ? now.map(courseName2).join(L(', ', '، ')) : L('None', 'ولا إشي')) + '</p>' +
        '<small class="sr-lock">' + esc(L('Only your dean changes prerequisites.', 'العميد بس بيغيّر المتطلبات.')) + '</small></div>';
    }
    var pl = plansNow().p;
    var inPlan = pl ? coursesInPlan(pl, id) : [];
    var chosen = preDraft[id] || now;
    var pv = prePreview[id];
    return '<div class="sr-f"><span>' + esc(L('Prerequisites', 'المتطلبات')) + '</span>' +
      pickerHtml(me.uni, me.college, chosen, inPlan, id) +
      '<small class="sr-lock">' + esc(L('Changes the plan for every major in your colleges that has this course. You see each change before it is saved.', 'بيغيّر الخطة بكل تخصص بكلياتك فيه هالمساق. بتشوف كل تغيير قبل ما ينحفظ.')) + '</small>' +
      (pv ? (pv.length
        ? '<div class="sr-link"><b>' + esc(L('This changes ' + pv.length + (pv.length === 1 ? ' major:' : ' majors:'), 'هاد بيغيّر ' + pv.length + ' تخصص:')) + '</b>' +
            pv.map(function(c){ return '<p><b>' + esc(c.major) + '</b><br><span class="sr-was">' + esc(c.before.join(', ') || L('none', 'ولا إشي')) + '</span> → ' + esc(c.after.join(', ') || L('none', 'ولا إشي')) + '</p>'; }).join('') +
            '<div class="sr-link-row"><button type="button" class="stf-btn stf-pri" data-sr="presave" data-course="' + esc(id) + '">' + esc(L('Save prerequisites', 'احفظ المتطلبات')) + '</button>' +
            '<button type="button" class="stf-btn" data-sr="precancel" data-course="' + esc(id) + '">' + esc(L('Cancel', 'إلغاء')) + '</button></div></div>'
        : '<p class="stf-muted">' + esc(L('Nothing would change.', 'ما رح يتغيّر إشي.')) + '</p>')
      : '<button type="button" class="stf-btn" data-sr="precheck" data-course="' + esc(id) + '">' + esc(L('See what changes', 'شوف شو بيتغيّر')) + '</button>') +
    '</div>';
  }
  // The courses of one plan, each once, for the prerequisite picker.
  function coursesInPlan(pl, except){
    return (pl.courses || []).filter(function(c){ return c.id !== except && !/-lab$/.test(c.id); }).map(function(c){
      return { id: c.id, ids: [c.id], name: plain(ar() && c.ar ? c.ar : c.name) };
    }).sort(function(a, b){ return a.name.localeCompare(b.name); });
  }
  function courseEditHtml(course){
    if(!me || !course || !mayWrite(course.id)) return '';
    if(live === null || pending === null) return '<h4>' + esc(L('Write for students', 'اكتب للطلاب')) + '</h4><p class="stf-muted">' + esc(L('Loading…', 'عم نحمّل…')) + '</p>';
    var id = course.id, k = function(f){ return 'srC-' + f + '-' + id; };
    var dean = me.role === 'dean';
    var note = current(id, 'note') || {};
    if(typeof note === 'string') try{ note = JSON.parse(note); }catch(e){ note = {}; }
    var waits = (pending || []).filter(function(p){ return p.kind === 'content' && p.course === id && p.by === me.username; });
    var offered = current(id, 'offered');
    return '<div class="sr-edit">' +
      '<h4>' + esc(L('Write for students', 'اكتب للطلاب')) + '</h4>' +
      '<p class="stf-muted">' + esc(dean
        ? L('Students see it in this course’s window as soon as you save.', 'الطلاب بيشوفوه بنافذة المساق أول ما تحفظ.')
        : L('Your dean checks it first, then students see it in this course’s window.', 'العميد بيراجعه أول، وبعدين بيشوفه الطلاب بنافذة المساق.')) + '</p>' +
      (waits.length ? '<p class="sr-wait">' + esc(L('Waiting for your dean: ', 'بستنّى العميد: ') + waits.map(function(w){ return fieldTx(w.field); }).join(L(', ', '، '))) + '</p>' : '') +
      '<label class="sr-f"><span>' + esc(fieldTx('about')) + '</span><textarea class="sr-in" rows="3" maxlength="1200" id="' + k('about') + '" data-keep>' + esc(current(id, 'about')) + '</textarea></label>' +
      (dean
        ? '<label class="sr-f"><span>' + esc(fieldTx('offered')) + '</span><select class="sr-in" id="' + k('offered') + '" data-keep>' +
            ['', 's1', 's2'].map(function(v){ return '<option value="' + v + '"' + (v === offered ? ' selected' : '') + '>' + esc(offeredTx(v)) + '</option>'; }).join('') + '</select></label>'
        : '<div class="sr-f"><span>' + esc(fieldTx('offered')) + '</span><p class="sr-ro">' + esc(offeredTx(offered)) + '</p><small class="sr-lock">' + esc(L('Set by your dean.', 'العميد بيحدّدها.')) + '</small></div>') +
      prereqHtml(id) +
      '<div class="sr-f"><span>' + esc(dean ? L('Sections this semester', 'شعب هالفصل') : L('Your sections', 'شعبك')) + '</span>' + sectionsHtml(id) + '</div>' +
      '<label class="sr-f"><span>' + esc(fieldTx('note')) + '</span><textarea class="sr-in" rows="2" maxlength="300" id="' + k('noteText') + '" data-keep placeholder="' + esc(L('e.g. Midterm moved to Thursday, room B-05.', 'مثلاً: النصفي انتقل للخميس، قاعة B-05.')) + '">' + esc(note.text || '') + '</textarea></label>' +
      '<label class="sr-f sr-f-row"><span>' + esc(L('Show it until', 'اعرضها لحد')) + '</span><input class="sr-in" type="date" id="' + k('noteUntil') + '" data-keep value="' + esc(note.until || '') + '"></label>' +
      '<button type="button" class="stf-btn stf-pri sr-wide" data-sr="savecourse" data-course="' + esc(id) + '">' + esc(dean ? L('Save for students', 'احفظ للطلاب') : L('Send to my dean', 'ابعت للعميد')) + '</button>' +
    '</div>';
  }
  function cleanSections(list){
    return (list || []).map(function(x, i){ return { n: String(x.n || i + 1), days: (x.days || []).slice().sort(), s: x.s || '', e: x.e || '', room: x.room || '', prof: x.prof || '' }; });
  }
  function saveCourse(courseId){
    var k = function(f){ var e = document.getElementById('srC-' + f + '-' + courseId); return e ? e.value : null; };
    var noteText = (k('noteText') || '').trim(), noteUntil = k('noteUntil') || '';
    if(noteText && !noteUntil){ if(window.__showToast) window.__showToast(L('Pick the date the pinned note ends.', 'اختار لإيمتى الملاحظة المثبّتة.')); return; }
    var bad = draftFor(courseId).filter(function(x){ return !(x.days || []).length || !x.s || !x.e || x.e <= x.s; })[0];
    if(bad){ if(window.__showToast) window.__showToast(L('Section ' + (bad.n || '') + ': pick its days, and an end time after its start.', 'الشعبة ' + (bad.n || '') + ': اختار أيامها، ووقت نهاية بعد البداية.')); return; }
    var want = { about: (k('about') || '').trim(), note: noteText ? { text: noteText, until: noteUntil } : '', sections: cleanSections(draftFor(courseId)) };
    if(me.role === 'dean') want.offered = k('offered') || '';
    var sends = Object.keys(want).filter(function(f){
      var cur = current(courseId, f);
      if(f === 'note') return JSON.stringify(want.note || '') !== JSON.stringify(cur && cur.text ? { text: cur.text, until: cur.until } : '');
      if(f === 'sections'){
        if(typeof cur === 'string' && cur) try{ cur = JSON.parse(cur); }catch(e){ cur = []; }
        return JSON.stringify(want.sections) !== JSON.stringify(cleanSections(Array.isArray(cur) ? cur : []));
      }
      return (want[f] || '') !== (cur || '');
    });
    if(!sends.length){ if(window.__showToast) window.__showToast(L('Nothing changed', 'ما تغيّر إشي')); return; }
    busy = true;
    var chain = Promise.resolve();
    sends.forEach(function(f){ chain = chain.then(function(){ return api('POST', '/api/staff/content', { course: courseId, field: f, value: want[f] }); }); });
    chain.then(function(){
      busy = false; dropKept = true; delete secDraft[courseId]; secOpen[courseId] = null;
      if(window.__showToast) window.__showToast(me.role === 'dean' ? L('Saved. Students see it now.', 'انحفظ. الطلاب بيشوفوه هلق.') : L('Sent to your dean', 'انبعت للعميد'));
      if(window.AAUP_STAFF_CONTENT) window.AAUP_STAFF_CONTENT.load(true);
      loadWork();
    }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
  }
  function prereqRun(courseId, preview){
    var box = document.querySelector('.sr-edit [data-sr-pick]');
    var want = box ? pickerValue(box.parentElement) : (preDraft[courseId] || prereqsOf(courseId));
    preDraft[courseId] = want;
    busy = true;
    return api('POST', '/api/staff/prereqs', { course: courseId, requires: want, preview: !!preview }).then(function(d){
      busy = false;
      if(preview){ prePreview[courseId] = d.changes || []; refresh(); return; }
      delete prePreview[courseId]; delete preDraft[courseId];
      if(window.__showToast) window.__showToast(L('Saved in ' + (d.changes || []).length + ' majors. Students see it after the next update, in a few minutes.', 'انحفظ بـ' + (d.changes || []).length + ' تخصص. الطلاب بيشوفوه بالتحديث الجاي، بعد كم دقيقة.'));
      refresh();
    }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
  }
  function waitingHtml(){
    if(!pending || !pending.length) return '';
    var dean = me.role === 'dean';
    return '<h4>' + esc(dean ? L('Waiting for you · ', 'بستنّوك · ') + pending.length : L('Waiting for your dean', 'بستنّى العميد')) + '</h4>' +
      pending.map(function(p){
        var what = p.kind === 'card' ? L('Card in Find a Professor', 'البطاقة بـ"ابحث عن محاضر"') : p.courseName + ' · ' + fieldTx(p.field);
        var was = valueTx(p.kind === 'card' ? 'card' : p.field, p.now), now = valueTx(p.kind === 'card' ? 'card' : p.field, p.value);
        return '<div class="sr-row sr-pend">' +
          '<div class="sr-grow"><b>' + esc(what) + '</b>' + (dean ? '<small>' + esc(L('From ', 'من ') + p.byName) + '</small>' : '') +
            (was ? '<small class="sr-was">' + esc(was) + '</small>' : '') +
            '<small class="sr-now">' + esc(now || L('(removed)', '(انحذف)')) + '</small></div>' +
          (dean ? '<div class="sr-acts"><button type="button" class="stf-btn stf-pri" data-sr="accept" data-id="' + esc(p.id) + '">' + esc(L('Accept', 'اقبل')) + '</button>' +
            '<button type="button" class="stf-btn" data-sr="refuse" data-id="' + esc(p.id) + '">' + esc(L('Refuse', 'ارفض')) + '</button></div>' : '') +
        '</div>';
      }).join('');
  }
  function cardFormHtml(){
    if(myCard === null) return '';
    var v = function(f){ return esc(myCard[f] || ''); };
    return '<h4>' + esc(L('Your card in Find a Professor', 'بطاقتك بـ"ابحث عن محاضر"')) + '</h4>' +
      '<p class="stf-muted">' + esc(L('Students see it when they look you up, under the name “', 'الطلاب بيشوفوها لما يدوروا عليك، تحت اسم "') + (me.name || me.username) + L('”.', '".')) + '</p>' +
      '<label class="sr-f"><span>' + esc(L('Office', 'المكتب')) + '</span><input class="sr-in" id="srCardOffice" data-keep maxlength="200" value="' + v('office') + '"></label>' +
      '<label class="sr-f"><span>' + esc(L('Office hours', 'الساعات المكتبية')) + '</span><input class="sr-in" id="srCardHours" data-keep maxlength="200" value="' + v('hours') + '"></label>' +
      '<label class="sr-f"><span>' + esc(L('Best way to reach you', 'أحسن طريقة للتواصل')) + '</span><input class="sr-in" id="srCardContact" data-keep maxlength="200" value="' + v('contact') + '"></label>' +
      '<button type="button" class="stf-btn stf-pri sr-wide" data-sr="savecard">' + esc(me.role === 'dean' ? L('Save my card', 'احفظ بطاقتي') : L('Send to my dean', 'ابعت للعميد')) + '</button>';
  }
  function saveCard(){
    busy = true;
    api('POST', '/api/staff/card', { office: val('srCardOffice'), hours: val('srCardHours'), contact: val('srCardContact') }).then(function(d){
      busy = false; dropKept = true;
      if(window.__showToast) window.__showToast(d.live ? L('Saved', 'انحفظ') : L('Sent to your dean', 'انبعت للعميد'));
      loadWork();
    }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
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
        '<p class="stf-muted">' + esc(L('You’ll get a link to send them.', 'رح يطلعلك رابط تبعتله إياه.')) + '</p>' +
        (collegeIds(me.college).length === 1 ? '' :
          '<label class="sr-f"><span>' + esc(L('Their college', 'كليته')) + '</span><select class="sr-in" id="srGCollege">' +
            (me.college === '*' ? colleges(me.uni) : collegeIds(me.college).map(function(id){ return { id: id, name: collegeName(id) }; }))
              .map(function(c){ return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</select></label>') +
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
    if(act === 'signout'){ if(me && me.admin) adminOff = true; setToken(''); me = null; team = null; lastLink = null; live = pending = myCard = null; refresh(); return true; }
    if(act === 'savecourse'){ saveCourse(b.getAttribute('data-course')); return true; }
    var cid = b.getAttribute('data-course'), si = +b.getAttribute('data-i');
    if(act === 'secadd'){ var dl = draftFor(cid); dl.push({ n: String(dl.length + 1), days: [], s: '08:00', e: '09:00', room: '', prof: me.role === 'professor' ? (me.name || '') : '' }); secOpen[cid] = dl.length - 1; refresh(); return true; }
    if(act === 'secedit'){ secOpen[cid] = secOpen[cid] === si ? null : si; refresh(); return true; }
    if(act === 'secdel'){ draftFor(cid).splice(si, 1); draftFor(cid).forEach(function(x, i){ x.n = String(i + 1); }); secOpen[cid] = null; refresh(); return true; }
    if(act === 'secday'){ var x = draftFor(cid)[si], d = +b.getAttribute('data-d'); x.days = x.days || []; var at = x.days.indexOf(d); if(at === -1) x.days.push(d); else x.days.splice(at, 1); refresh(); return true; }
    if(act === 'precheck'){ prereqRun(cid, true); return true; }
    if(act === 'presave'){ prereqRun(cid, false); return true; }
    if(act === 'precancel'){ delete prePreview[cid]; delete preDraft[cid]; refresh(); return true; }
    if(act === 'opencourse'){ if(window.AAUP_STAFF && window.AAUP_STAFF.openCourse) window.AAUP_STAFF.openCourse(String(id).split(',')); return true; }
    if(act === 'editmajor'){
      var curMajor = window.AAUP_STAFF && window.AAUP_STAFF.current && window.AAUP_STAFF.current();
      if(window.AAUP_ADMIN && window.AAUP_ADMIN.openStaff) window.AAUP_ADMIN.openStaff(token(), me.name || me.username, me.uni, curMajor);
      return true;
    }
    if(act === 'savecard'){ saveCard(); return true; }
    if(act === 'accept' || act === 'refuse'){
      busy = true;
      api('POST', '/api/staff/pending/' + id, { decision: act }).then(function(){
        busy = false;
        if(window.__showToast) window.__showToast(act === 'accept' ? L('Accepted — students see it now', 'انقبل — الطلاب بيشوفوه هلق') : L('Refused', 'انرفض'));
        loadWork();
      }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
      return true;
    }
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
      var gBody = { name: val('srGName').trim(), username: val('srGUser').trim(), courses: pickerValue(dlgEl) };
      if(document.getElementById('srGCollege')) gBody.college = val('srGCollege');
      api('POST', '/api/staff/team', gBody)
        .then(function(d){ busy = false; dlg = null; dlgMsg = ''; lastLink = { who: who, link: setupLink(d.staff.username, d.setupCode) }; loadTeam(); }, fail);
      return true;
    }
    if(act === 'pause' || act === 'resume'){
      busy = true;
      api('PATCH', '/api/staff/team/' + id, { status: act === 'pause' ? 'paused' : 'active' })
        .then(function(){ busy = false; loadTeam(); }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
      return true;
    }
    if(act === 'relinkno'){ askRelink = null; refresh(); return true; }
    if(act === 'relink' || act === 'relinkgo'){
      var s = (team || []).filter(function(x){ return x.id === id; })[0];
      // Asked in the page, not a browser pop-up (those can be blocked).
      if(act === 'relink' && s && s.hasPassword){ askRelink = id; lastLink = null; refresh(); return true; }
      askRelink = null;
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

  // Section fields write straight into the draft, so a redraw keeps them.
  document.addEventListener('input', function(e){
    var f = e.target && e.target.getAttribute && e.target.getAttribute('data-sec');
    if(!f) return;
    var parts = f.split(':'), list = secDraft[parts[0]];
    if(list && list[+parts[1]]) list[+parts[1]][parts[2]] = e.target.value;
  });
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
    loadMe: loadMe, pillHtml: pillHtml, actionsHtml: actionsHtml, panelHtml: panelHtml, courseEditHtml: courseEditHtml,
    dialogHtml: dialogHtml, afterRender: afterRender, onClick: onClick, onKey: onKey,
    signedIn: function(){ return !!me; },
    // shared with the admin room
    universities: universities, colleges: colleges, uniName: uniName, collegeName: collegeName, collegeLabel: collegeLabel, collegeIds: collegeIds,
    coursesIn: coursesIn, courseNames: courseNames, pickerHtml: pickerHtml, bindPickers: bindPickers,
    pickerValue: pickerValue, setupLink: setupLink, linkBoxHtml: linkBoxHtml, copy: copy, stateTx: stateTx
  };
})();
