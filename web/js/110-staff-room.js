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
    // A redraw replaces the panels, which put them back at the top: pressing
    // "+ Add a section" low in a course sent you up to its name. Each scrolled
    // box keeps its place (found again by its class and position).
    var view = document.getElementById('staffView'), scrolls = [];
    if(view) view.querySelectorAll('*').forEach(function(e, i){ if(e.scrollTop > 0) scrolls.push([e.className, i, e.scrollTop]); });
    if(view && view.scrollTop > 0) scrolls.push([null, -1, view.scrollTop]);
    window.AAUP_STAFF.refresh();
    if(view){
      var all = view.querySelectorAll('*');
      scrolls.forEach(function(s){
        var el = s[1] === -1 ? view : (all[s[1]] && all[s[1]].className === s[0] ? all[s[1]] : view.getElementsByClassName(String(s[0]).split(' ')[0])[0]);
        if(el) el.scrollTop = s[2];
      });
    }
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
  var live = null, pending = null, myCard = null, replies = {}, reported = {}, cdates = null;
  function loadWork(){
    if(!me) return;
    fetch(base() + '/api/public/content?uni=' + encodeURIComponent(me.uni) + '&_=' + Date.now(), { cache: 'no-store' })
      .then(function(r){ return r.json(); }).then(function(j){ live = (j && j.courses) || {}; replies = (j && j.replies) || {}; refresh(); }).catch(function(){ live = {}; });
    api('GET', '/api/staff/pending').then(function(d){ pending = d.pending || []; refresh(); }).catch(function(){ pending = []; });
    api('GET', '/api/staff/card').then(function(d){ myCard = d.card || {}; refresh(); }).catch(function(){ myCard = {}; });
    api('GET', '/api/staff/reported').then(function(d){
      reported = {};
      (d.reported || []).forEach(function(x){ reported[x.thought] = x.status; });
      refresh();
    }).catch(function(){});
    if(me.role === 'dean'){ loadDates(); loadLog(); }
    loadSaid();
  }
  var slog = null, logAll = false;
  function loadLog(){
    api('GET', '/api/staff/log').then(function(d){ slog = d.log || []; refresh(); }).catch(function(e){ slog = { error: e.message }; refresh(); });
  }
  function loadDates(){
    api('GET', '/api/staff/dates').then(function(d){ cdates = d.dates || []; refresh(); }).catch(function(e){ cdates = { error: e.message }; refresh(); });
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
            '<small>' + esc(stateTx(s)) + '</small>' +
            (s.card && s.card.phone ? '<small>' + esc(L('Phone ', 'الهاتف ') + s.card.phone + (s.card.phoneShown ? L(' · shown to students', ' · ظاهر للطلاب') : L(' · not shown yet', ' · مش ظاهر لسا'))) + '</small>' : '') + '</div>' +
          '<div class="sr-acts">' +
            '<button type="button" class="stf-btn" data-sr="' + (s.status === 'paused' ? 'resume' : 'pause') + '" data-id="' + esc(s.id) + '">' + esc(s.status === 'paused' ? L('Turn back on', 'رجّعه') : L('Pause', 'وقّف')) + '</button>' +
            (s.card && s.card.phone ? '<button type="button" class="stf-btn' + (s.card.phoneShown ? '' : ' stf-pri') + '" data-sr="' + (s.card.phoneShown ? 'phonehide' : 'phoneshow') + '" data-id="' + esc(s.id) + '">' + esc(s.card.phoneShown ? L('Hide phone', 'خبّي الرقم') : L('Show phone', 'أظهر الرقم')) + '</button>' : '') +
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
        glanceHtml() + waitingHtml() + logHtml() + datesHtml() +
        '<h4>' + esc(L('Professors', 'الأساتذة')) + '</h4>' + rows +
        (lastLink ? linkBoxHtml(lastLink.who, lastLink.link) : '') +
        '<button type="button" class="stf-btn stf-pri sr-give" data-sr="give">' + esc(L('Give a professor a login', 'اعطِ أستاذ حساب')) + '</button>' +
        (me.admin ? '' : cardFormHtml()) +
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
  // Names for a section's Professor box: everyone in Find a Professor, the
  // staff logins, and yourself. A new name can still be typed.
  var profNames = null;
  function loadProfNames(){
    if(profNames) return;
    profNames = [];
    fetch('contacts.json').then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
      ((d && d.contacts) || []).forEach(function(c){
        var n = String(c.name || '').trim();
        if(c.category === 'instructor' && n && profNames.indexOf(n) === -1) profNames.push(n);
      });
      profNames.sort(function(a, b){ return a.localeCompare(b); });
      refresh();
    }).catch(function(){});
  }
  function profListHtml(){
    loadProfNames();
    var all = (profNames || []).slice();
    var add = function(n){ n = String(n || '').trim(); if(n && all.indexOf(n) === -1) all.unshift(n); };
    ((window.AAUP_STAFF_CONTENT && window.AAUP_STAFF_CONTENT.cards()) || []).forEach(function(c){ add(c.name); });
    (Array.isArray(team) ? team : []).forEach(function(t){ add(t.name || t.username); });
    if(me) add(me.name);
    return '<datalist id="srProfNames">' + all.map(function(n){ return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>';
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
            '<label class="sr-f"><span>' + esc(L('Professor', 'المدرّس')) + '</span><input class="sr-in" maxlength="80" list="srProfNames" autocomplete="off" placeholder="' + esc(L('Pick from the list, or type a new name', 'اختار من القائمة، أو اكتب اسم جديد')) + '" data-sec="' + esc(id) + ':' + i + ':prof" value="' + esc(x.prof || '') + '"></label>'
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
      '<div class="sr-f"><span>' + esc(dean ? L('Sections this semester', 'شعب هالفصل') : L('Your sections', 'شعبك')) + '</span>' + sectionsHtml(id) + profListHtml() + '</div>' +
      '<label class="sr-f"><span>' + esc(fieldTx('note')) + '</span><textarea class="sr-in" rows="2" maxlength="300" id="' + k('noteText') + '" data-keep placeholder="' + esc(L('e.g. Midterm moved to Thursday, room B-05.', 'مثلاً: النصفي انتقل للخميس، قاعة B-05.')) + '">' + esc(note.text || '') + '</textarea></label>' +
      '<label class="sr-f sr-f-row"><span>' + esc(L('Show it until', 'اعرضها لحد')) + '</span><input class="sr-in" type="date" id="' + k('noteUntil') + '" data-keep value="' + esc(note.until || '') + '"></label>' +
      '<button type="button" class="stf-btn stf-pri sr-wide" data-sr="savecourse" data-course="' + esc(id) + '">' + esc(dean ? L('Save for students', 'احفظ للطلاب') : L('Send to my dean', 'ابعت للعميد')) + '</button>' +
    '</div>' + saidHtml(course);
  }

  // ---- what students said (round 10, ideas 13 and 14) ----------------------------------
  // The thoughts wall (workers/thoughts-worker.js) is public; it is read here
  // straight from its Worker, and the students' names are never drawn. A
  // reply or a report goes through the staff Worker, which checks the course
  // is this login's.
  var said = null, saidAt = 0, replyOpen = {};
  function loadSaid(force){
    var url = String(window.APP_THOUGHTS_URL || '').replace(/\/+$/, '');
    if(!url){ said = []; return; }
    if(!force && said && !said.error && Date.now() - saidAt < 2 * 60 * 1000) return;
    fetch(url + '/thoughts?all=1', { cache: 'no-store' }).then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(j){
        said = ((j && j.thoughts) || []).slice(0, 400).map(function(t){
          return { id: String(t.id || '').slice(0, 60), plan: String(t.plan || '').slice(0, 60), text: String(t.text || '').slice(0, 300),
                   at: Number(t.at) || 0, course: String(t.course || '').slice(0, 80) };
        }).filter(function(t){ return t.id && t.text; });
        saidAt = Date.now(); refresh();
      }, function(){ said = { error: true }; refresh(); });
  }
  // Every id this course has: the same name in the other majors, and the
  // tags it had before its major used course numbers.
  function idsOfCourse(id){
    var name = courseName2(id), out = [id];
    coursesIn(me.uni, '').forEach(function(c){ if(c.name === name) c.ids.forEach(function(x){ if(out.indexOf(x) === -1) out.push(x); }); });
    var sc = window.AAUP_STAFF_CONTENT;
    out.slice().forEach(function(x){ ((sc && sc.oldIds && sc.oldIds(x)) || []).forEach(function(o){ if(out.indexOf(o) === -1) out.push(o); }); });
    return out;
  }
  function saidAbout(course){
    if(!said || said.error) return [];
    var ids = idsOfCourse(course.id), th = window.AAUP_THOUGHTS;
    var pl = plansNow().p, c = pl && (pl.courses || []).filter(function(x){ return x.id === course.id; })[0];
    var probe = { slug: '', name: c ? plain(c.name) : '', ar: c ? plain(c.ar || '') : '', num: c ? String(c.courseNumber || '') : '' };
    return said.filter(function(t){
      if(t.course) return ids.indexOf(t.course) !== -1;
      return !!(th && th.aboutCourse && probe.name && th.aboutCourse(t, probe));
    }).sort(function(a, b){ return b.at - a.at; });
  }
  function saidHtml(course){
    var list = saidAbout(course), dean = me.role === 'dean', cid = course.id;
    var head = '<h4>' + esc(L('What students said about ', 'شو حكوا الطلاب عن ') + courseName2(cid)) + '</h4>';
    if(said === null) return '<div class="sr-said">' + head + '<p class="stf-muted">' + esc(L('Loading…', 'عم نحمّل…')) + '</p></div>';
    if(said.error) return '<div class="sr-said">' + head + '<p class="stf-muted">' + esc(L('Couldn’t load what students said. Check the connection.', 'ما قدرنا نجيب شو حكوا الطلاب. تأكد من الإنترنت.')) + '</p></div>';
    if(!list.length) return '<div class="sr-said">' + head + '<p class="stf-muted">' + esc(L('Nothing yet. Students write about a course from its window in the app.', 'لسا ولا إشي. الطلاب بيكتبوا عن المساق من نافذته بالتطبيق.')) + '</p></div>';
    return '<div class="sr-said">' + head +
      '<p class="stf-muted">' + esc(L(list.length + (list.length === 1 ? ' thought' : ' thoughts') + '. Names are never shown. You can reply, or report one that is rude or names someone; only the admin can take it down.',
        list.length + ' فكرة. الأسماء ما بتبين أبداً. بتقدر ترد، أو تبلّغ عن وحدة فيها إساءة أو اسم حدا، والإدارة بس بتقدر تشيلها.')) + '</p>' +
      list.slice(0, 25).map(function(t){
        var r = replies[t.id], editing = replyOpen[t.id] || !r, rep = reported[t.id];
        var tag = 'srRe-' + t.id;
        return '<div class="sr-th">' +
          '<p class="sr-th-q">“' + esc(t.text) + '”<small>' + esc(agoTx(Math.floor(t.at / 1000))) + '</small></p>' +
          (r && !replyOpen[t.id] ? '<div class="sr-th-reply"><b>' + esc(r.by === (me.name || me.username) ? L('Your reply: ', 'ردّك: ') : L('Reply from ', 'رد ') + r.by + ': ') + '</b>' + esc(r.text) +
            '<div class="sr-th-acts"><button type="button" class="stf-btn" data-sr="replyedit" data-id="' + esc(t.id) + '">' + esc(L('Change', 'غيّر')) + '</button>' +
            '<button type="button" class="stf-btn" data-sr="replydel" data-id="' + esc(t.id) + '" data-course="' + esc(r.course || cid) + '">' + esc(L('Remove', 'احذف')) + '</button></div></div>' : '') +
          (editing ? '<textarea class="sr-in" rows="2" maxlength="600" id="' + tag + '" data-keep placeholder="' + esc(dean ? L('Reply as the dean…', 'رد كعميد…') : L('Reply as the professor…', 'رد كأستاذ…')) + '">' + esc(r && replyOpen[t.id] ? r.text : '') + '</textarea>' : '') +
          '<div class="sr-th-acts">' +
            (editing ? '<button type="button" class="stf-btn stf-pri" data-sr="reply" data-id="' + esc(t.id) + '" data-course="' + esc(cid) + '">' + esc(L('Reply', 'رد')) + '</button>' : '') +
            (editing && r ? '<button type="button" class="stf-btn" data-sr="replyno" data-id="' + esc(t.id) + '">' + esc(L('Cancel', 'إلغاء')) + '</button>' : '') +
            (rep ? '<small class="sr-th-rep">' + esc(rep === 'removed' ? L('Reported · the admin took it down', 'تبلّغ عنها · الإدارة شالتها') : rep === 'kept' ? L('Reported · the admin kept it', 'تبلّغ عنها · الإدارة خلّتها') : L('Reported to the admin ✓', 'تبلّغ عنها للإدارة ✓')) + '</small>'
                 : '<button type="button" class="stf-btn sr-bad" data-sr="report" data-id="' + esc(t.id) + '" data-course="' + esc(cid) + '">' + esc(L('Report to admin', 'بلّغ الإدارة')) + '</button>') +
          '</div></div>';
      }).join('') +
      (list.length > 25 ? '<p class="stf-muted">' + esc(L('Showing the newest 25.', 'هاي أحدث 25.')) + '</p>' : '') +
    '</div>';
  }
  function sendReply(id, courseId, text){
    busy = true;
    return api('POST', '/api/staff/reply', { thought: id, course: courseId, text: text }).then(function(){
      busy = false; dropKept = true; delete replyOpen[id];
      if(text) replies[id] = { course: courseId, text: text, by: me.name || me.username };
      else delete replies[id];
      if(window.__showToast) window.__showToast(text ? L('Replied. Students see it under the thought.', 'انبعت. الطلاب بيشوفوه تحت الفكرة.') : L('Reply removed', 'انحذف الرد'));
      if(window.AAUP_STAFF_CONTENT) window.AAUP_STAFF_CONTENT.load(true);
      refresh();
    }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
  }

  // ---- numbers for the dean (round 10, ideas 15 to 18) ----------------------------------
  // For the major on screen, when it is one of the dean's: where students get
  // stuck, how many plan each course next semester, the plan as a PDF or a
  // spreadsheet, and (for the whole college) recent changes with Put back.
  // Counts come from the cloud worker (/api/stats/plan): counts only, never
  // names, and under 5 is hidden.
  var SEC_KEY = 'aaup_staffSectionSize';
  function secSize(){ var n = 35; try{ n = +localStorage.getItem(SEC_KEY) || 35; }catch(e){} return Math.min(200, Math.max(5, n)); }
  function myMajorNow(){
    var pn = plansNow();
    return pn.p && me && me.role === 'dean' && plansIn(me.uni, me.college).some(function(p){ return p.id === pn.id; }) ? pn : null;
  }
  function glanceHtml(){
    var pn = myMajorNow();
    if(!pn) return '';
    var S = window.AAUP_STAFF, pl = pn.p, name = S && S.nameOf ? S.nameOf(pl) : pn.id;
    var st = window.APP_CLOUD_URL && S && S.stats ? S.stats(pn.id) : undefined;
    var byId = {};
    (pl.courses || []).forEach(function(c){ byId[c.id] = c; });
    var cname = function(id){ var c = byId[id]; return c ? plain(ar() && c.ar ? c.ar : c.name) : id; };
    var out = '<h4>' + esc(L(name + ' at a glance', name + ' بلمحة')) + '</h4>';
    var nums = '';
    if(st === undefined) nums = '';
    else if(!st) nums = '<p class="stf-muted">' + esc(L('Counting…', 'عم نعدّ…')) + '</p>';
    else if(st.error) nums = '<p class="stf-muted">' + esc(L('Couldn’t reach the counts right now.', 'ما قدرنا نجيب الأعداد هلق.')) + '</p>';
    else if(st.tooFew) nums = '<p class="stf-muted">' + esc(L('Fewer than 5 students of this major use AAUPath yet, so there are no counts to show.', 'أقل من 5 طلاب من هالتخصص بيستعملوا AAUPath لهلق، فما في أعداد نعرضها.')) + '</p>';
    else {
      var cs = st.courses || {}, g = S.graph(pl);
      var stuck = Object.keys(cs).filter(function(id){ return byId[id] && cs[id].ready != null && (g.prev[id] || []).length; })
        .map(function(id){ return { id: id, n: cs[id].ready, blocks: g.opensAll(id).length }; })
        .sort(function(a, b){ return b.n - a.n || b.blocks - a.blocks; }).slice(0, 4);
      var most = stuck.length ? stuck[0].n : 1;
      var planned = Object.keys(cs).filter(function(id){ return byId[id] && cs[id].planned != null; })
        .map(function(id){ return { id: id, n: cs[id].planned }; }).sort(function(a, b){ return b.n - a.n; });
      var fewer = Object.keys(cs).filter(function(id){ return byId[id] && cs[id].planned == null; }).length;
      var size = secSize();
      nums = '<p class="stf-muted">' + esc(L(st.students + ' students of this major use AAUPath. Counts only, never names; under 5 is hidden.',
          st.students + ' طالب من هالتخصص بيستعملوا AAUPath. أعداد بس، بدون أسماء، وأقل من 5 ما بيبين.')) + '</p>' +
        '<div class="sr-sub">' + esc(L('Where students get stuck', 'وين الطلاب بيعلقوا')) + '</div>' +
        (stuck.length ? stuck.map(function(x){
          return '<div class="sr-stuck"><div class="sr-stuck-t"><b>' + esc(cname(x.id)) + '</b><span>' + esc(L(x.n + ' waiting', x.n + ' مستنّيين')) + '</span></div>' +
            '<small>' + esc(x.blocks ? L('blocks ' + x.blocks + (x.blocks === 1 ? ' course' : ' courses'), 'بيسكّر ' + x.blocks + ' مساق') : L('the last step before graduating', 'آخر خطوة قبل التخرج')) + '</small>' +
            '<div class="sr-bar"><i style="width:' + Math.max(4, Math.round(100 * x.n / most)) + '%"></i></div></div>';
        }).join('') + '<p class="stf-muted sr-small">' + esc(L('Waiting: they have passed everything the course needs, but not the course, and aren’t taking it now.', 'مستنّيين: نجحوا بكل اللي بيحتاجه المساق، بس لسا ما نجحوا فيه ومش آخذينه هلق.')) + '</p>'
          : '<p class="stf-muted">' + esc(L('No course has 5 or more students waiting on it.', 'ما في مساق مستنّيه 5 طلاب أو أكثر.')) + '</p>') +
        '<div class="sr-sub">' + esc(L('Planned for next semester', 'مخططين إلها الفصل الجاي')) + '</div>' +
        (planned.length
          ? '<table class="sr-tbl"><thead><tr><th>' + esc(L('Course', 'المساق')) + '</th><th>' + esc(L('Students', 'طلاب')) + '</th><th>' +
              '<label>' + esc(L('Sections of ', 'شعب من ')) + '<input type="number" min="5" max="200" id="srSecSize" value="' + size + '" aria-label="' + esc(L('Students per section', 'طلاب بالشعبة')) + '"></label></th></tr></thead><tbody>' +
            planned.slice(0, 8).map(function(x){ return '<tr><td>' + esc(cname(x.id)) + '</td><td>' + x.n + '</td><td>' + Math.ceil(x.n / size) + '</td></tr>'; }).join('') + '</tbody></table>' +
            (planned.length > 8 || fewer ? '<p class="stf-muted sr-small">' + esc([planned.length > 8 ? L((planned.length - 8) + ' more with 5 or more', (planned.length - 8) + ' كمان فيهم 5 أو أكثر') : '', fewer ? L(fewer + ' with fewer than 5', fewer + ' فيهم أقل من 5') : ''].filter(Boolean).join(' · ')) + '</p>' : '')
          : '<p class="stf-muted">' + esc(L('No course is planned by 5 or more students yet.', 'ما في مساق مخططله 5 طلاب أو أكثر لهلق.')) + '</p>');
    }
    return out +
      '<div class="sr-exports"><button type="button" class="stf-btn" data-sr="pdf">PDF</button><button type="button" class="stf-btn" data-sr="xlsx">Excel</button>' +
        '<small>' + esc(L('The plan, for meetings and accreditation', 'الخطة، للاجتماعات والاعتماد')) + '</small></div>' + nums;
  }
  function logHtml(){
    if(!me || me.role !== 'dean') return '';
    var head = '<h4>' + esc(L('Recent changes', 'آخر التغييرات')) + '</h4>';
    if(slog === null) return head + '<p class="stf-muted">' + esc(L('Loading…', 'عم نحمّل…')) + '</p>';
    if(slog.error) return head + '<p class="stf-muted">' + esc(slog.error) + '</p>';
    if(!slog.length) return head + '<p class="stf-muted">' + esc(L('Nothing yet.', 'لسا ولا إشي.')) + '</p>';
    var list = logAll ? slog : slog.slice(0, 6);
    return head +
      list.map(function(x){
        return '<div class="sr-row sr-row-line' + (x.undone ? ' is-off' : '') + '"><div class="sr-grow"><b>' + esc(x.what) + '</b><small>' + esc(x.by + ' · ' + agoTx(x.at) + (x.undone ? L(' · put back', ' · رجعت') : '')) + '</small></div>' +
          (x.canPutBack ? '<button type="button" class="stf-btn" data-sr="putback" data-id="' + esc(x.id) + '">' + esc(L('Put back', 'رجّعها')) + '</button>' : '') + '</div>';
      }).join('') +
      (slog.length > 6 ? '<button type="button" class="stf-btn sr-more" data-sr="logall">' + esc(logAll ? L('Show fewer', 'أقل') : L('Show all ' + slog.length, 'اعرض الكل (' + slog.length + ')')) + '</button>' : '') +
      '<p class="stf-muted sr-small">' + esc(L('Put back restores what students read about a course before that change. Plan changes are put back from Edit this major → History.', 'رجّعها بترجّع اللي كان الطلاب بيقروه عن المساق قبل هالتغيير. تغييرات الخطة بترجع من "عدّل هالتخصص" ← السجل.')) + '</p>';
  }
  // The plan on paper (or as a PDF from the print window): year by year,
  // each course with its number, hours and what it needs.
  function printPlan(){
    var pn = plansNow(), pl = pn.p, S = window.AAUP_STAFF;
    if(!pl || !S || !S.yearsOf) return;
    var byId = {};
    (pl.courses || []).forEach(function(c){ byId[c.id] = c; });
    var cname = function(c){ return plain(ar() && c.ar ? c.ar : c.name); };
    var g = S.graph(pl), hrs = function(list){ return list.reduce(function(n, c){ return n + (parseFloat(c.creditHours) || 0); }, 0); };
    var years = S.yearsOf(pl), total = hrs(pl.courses || []);
    var col = planCollege(pl);
    var html = '<div class="sp-head"><h1>' + esc(S.nameOf(pl)) + '</h1>' +
      '<p>' + esc([uniName(pl.university || 'aaup'), col ? collegeName(col) : '', L(total + ' hours', total + ' ساعة'), L(years.length + ' years', years.length + ' سنوات')].filter(Boolean).join(' · ')) + '</p>' +
      '<p class="sp-note">' + esc(L('Official study plan · printed ', 'الخطة الدراسية الرسمية · انطبعت ') + new Date().toLocaleDateString(ar() ? 'ar' : 'en', { day: 'numeric', month: 'long', year: 'numeric' }) + L(' from AAUPath', ' من AAUPath')) + '</p></div>' +
      years.map(function(y){
        return '<section class="sp-year"><h2>' + esc(L('Year ' + y.n, 'السنة ' + y.n)) + '</h2>' + y.sems.map(function(sm){
          return '<h3>' + esc(S.semName(sm.s) + ' · ' + L(hrs(sm.list) + ' hours', hrs(sm.list) + ' ساعة')) + '</h3>' +
            '<table><thead><tr><th>' + esc(L('Number', 'الرقم')) + '</th><th>' + esc(L('Course', 'المساق')) + '</th><th>' + esc(L('Hours', 'الساعات')) + '</th><th>' + esc(L('Needs', 'بيحتاج')) + '</th></tr></thead><tbody>' +
            sm.list.map(function(c){
              return '<tr><td>' + esc(c.courseNumber || '') + '</td><td>' + esc(cname(c)) + '</td><td>' + (parseFloat(c.creditHours) || 0) + '</td><td>' +
                esc((g.prev[c.id] || []).map(function(id){ return byId[id] ? cname(byId[id]) : id; }).join(L(', ', '، '))) + '</td></tr>';
            }).join('') + '</tbody></table>';
        }).join('') + '</section>';
      }).join('');
    // Elective options sit in no semester: students choose among them.
    var picks = (pl.courses || []).filter(function(c){ return !c.yearId || !c.semester; });
    if(picks.length){
      html += '<section class="sp-year"><h2>' + esc(L('Electives to choose from', 'مواد اختيارية للاختيار منها')) + '</h2>' +
        '<table><thead><tr><th>' + esc(L('Number', 'الرقم')) + '</th><th>' + esc(L('Course', 'المساق')) + '</th><th>' + esc(L('Hours', 'الساعات')) + '</th><th>' + esc(L('Needs', 'بيحتاج')) + '</th></tr></thead><tbody>' +
        picks.map(function(c){
          return '<tr><td>' + esc(c.courseNumber || '') + '</td><td>' + esc(cname(c)) + '</td><td>' + (parseFloat(c.creditHours) || 0) + '</td><td>' +
            esc((g.prev[c.id] || []).map(function(id){ return byId[id] ? cname(byId[id]) : id; }).join(L(', ', '، '))) + '</td></tr>';
        }).join('') + '</tbody></table></section>';
    }
    var root = document.getElementById('staffPrintRoot');
    if(!root){ root = document.createElement('div'); root.id = 'staffPrintRoot'; document.body.appendChild(root); }
    root.setAttribute('dir', ar() ? 'rtl' : 'ltr');
    root.innerHTML = html;
    document.body.classList.add('printing-staff');
    var done = function(){ document.body.classList.remove('printing-staff'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function(){ window.print(); }, 60);
  }
  function exportPlan(){
    var pn = plansNow(), pl = pn.p, S = window.AAUP_STAFF, X = window.AAUP_EXPORT;
    if(!pl || !S || !X || !X.saveXlsx) return;
    var byId = {};
    (pl.courses || []).forEach(function(c){ byId[c.id] = c; });
    var g = S.graph(pl);
    var table = [[L('Year', 'السنة'), L('Semester', 'الفصل'), L('Number', 'الرقم'), L('Course', 'المساق'), L('Other name', 'الاسم الآخر'), L('Hours', 'الساعات'), L('Needs', 'بيحتاج'), L('Opens', 'بيفتح')]];
    S.yearsOf(pl).forEach(function(y){
      y.sems.forEach(function(sm){
        sm.list.forEach(function(c){
          table.push([y.n, S.semName(sm.s), c.courseNumber || '', plain(ar() && c.ar ? c.ar : c.name), plain(ar() ? c.name : (c.ar || '')),
            parseFloat(c.creditHours) || 0,
            (g.prev[c.id] || []).map(function(id){ return byId[id] ? plain(byId[id].name) : id; }).join(', '),
            g.opensAll(c.id).length]);
        });
      });
    });
    (pl.courses || []).filter(function(c){ return !c.yearId || !c.semester; }).forEach(function(c){
      table.push(['', L('Elective (choose)', 'اختياري (للاختيار)'), c.courseNumber || '', plain(ar() && c.ar ? c.ar : c.name), plain(ar() ? c.name : (c.ar || '')),
        parseFloat(c.creditHours) || 0,
        (g.prev[c.id] || []).map(function(id){ return byId[id] ? plain(byId[id].name) : id; }).join(', '),
        g.opensAll(c.id).length]);
    });
    X.saveXlsx(S.nameOf(pl), L('Study plan', 'الخطة'), table, [6, 18, 12, 40, 34, 7, 40, 7], ar());
  }

  // ---- college dates on Home (round 10, idea 11) ----------------------------------------
  function dateTx(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(ar() ? 'ar' : 'en', { weekday: 'short', day: 'numeric', month: 'short' }) : iso;
  }
  function datesHtml(){
    if(!me || me.role !== 'dean') return '';
    var many = me.college === '*' || collegeIds(me.college).length > 1;
    var opts = me.college === '*' ? [{ id: '*', name: L('All colleges', 'كل الكليات') }].concat(colleges(me.uni))
      : collegeIds(me.college).map(function(id){ return { id: id, name: collegeName(id) }; });
    var list = cdates === null ? '<p class="stf-muted">' + esc(L('Loading…', 'عم نحمّل…')) + '</p>'
      : cdates.error ? '<p class="stf-muted">' + esc(cdates.error) + '</p>'
      : !cdates.length ? '<p class="stf-muted">' + esc(L('None coming up.', 'ما في إشي جاي.')) + '</p>'
      : cdates.map(function(d){
          return '<div class="sr-row sr-row-line"><div class="sr-grow"><b>' + esc(d.label) + '</b><small>' + esc(dateTx(d.date) + (many ? ' · ' + (d.college === '*' ? L('All colleges', 'كل الكليات') : collegeName(d.college)) : '')) + '</small></div>' +
            '<button type="button" class="stf-btn sr-bad" data-sr="datedel" data-id="' + esc(d.id) + '">' + esc(L('Remove', 'احذف')) + '</button></div>';
        }).join('');
    return '<h4>' + esc(L('College dates on Home', 'تواريخ الكلية بالرئيسية')) + '</h4>' +
      '<p class="stf-muted">' + esc(L('Students of your college see them on Home, next to the university’s dates, counting down.', 'طلاب كليتك بيشوفوها بالرئيسية جنب تواريخ الجامعة، مع عدّ الأيام.')) + '</p>' + list +
      '<div class="sr-date-add">' +
        '<input class="sr-in" id="srDateLabel" data-keep maxlength="60" placeholder="' + esc(L('e.g. Midterm week', 'مثلاً: أسبوع النصفي')) + '">' +
        '<input class="sr-in" id="srDateDay" data-keep type="date" min="' + todayIso() + '">' +
        (many ? '<select class="sr-in" id="srDateCollege" data-keep>' + opts.map(function(c){ return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' : '') +
        '<button type="button" class="stf-btn stf-pri" data-sr="dateadd">' + esc(L('Add', 'ضيف')) + '</button>' +
      '</div>';
  }
  // ---- several courses at once (Ctrl/⌘ + click, or "Pick several") -------------------
  // The same change for every picked course: when it is offered (a dean) and
  // a pinned note. Courses this login doesn't cover are listed and left alone.
  function bulkHtml(pl, ids, picking){
    var byId = {};
    (pl.courses || []).forEach(function(c){ byId[c.id] = c; });
    var nm = function(id){ var c = byId[id]; return c ? plain(ar() && c.ar ? c.ar : c.name) : id; };
    var mine = ids.filter(mayWrite), other = ids.filter(function(id){ return !mayWrite(id); });
    var dean = me && me.role === 'dean';
    var head = '<div class="stf-detail-h"><b>' + esc(L(ids.length + ' courses picked', ids.length + ' مساقات مختارة')) + '</b>' +
      '<button type="button" class="stf-x" data-sr="bulkdone" aria-label="' + esc(L('Stop picking', 'وقّف الاختيار')) + '">×</button></div>' +
      '<div class="sr-chips sr-bulk-chips">' + ids.map(function(id){
        return '<span class="sr-chip">' + esc(nm(id)) + '<button type="button" data-sr="bulkun" data-id="' + esc(id) + '" aria-label="' + esc(L('Remove', 'شيل')) + '">×</button></span>';
      }).join('') + '</div>' +
      '<p class="stf-muted">' + esc(picking ? L('Tap more courses to add them, or tap one again to take it out.', 'اضغط على مساقات كمان لتضيفها، أو اضغط عليه مرة ثانية لتشيله.')
        : L('Ctrl + click (⌘ on a Mac) more courses to add them, or one again to take it out.', 'Ctrl + نقرة (⌘ عالماك) على مساقات كمان لتضيفها، أو على وحدة مرة ثانية لتشيلها.')) + '</p>';
    if(!me) return '<aside class="stf-detail sr-panel">' + head + '<p class="stf-muted">' + esc(L('Sign in to change them together.', 'سجّل دخول لتغيّرهم مع بعض.')) + '</p></aside>';
    return '<aside class="stf-detail sr-panel">' + head +
      (other.length ? '<p class="sr-wait">' + esc(L('Not yours, left alone: ', 'مش إلك، رح تضل زي ما هي: ') + other.map(nm).join(L(', ', '، '))) + '</p>' : '') +
      (mine.length ? '<div class="sr-edit"><h4>' + esc(L('Change all ' + mine.length + ' together', 'غيّر الـ' + mine.length + ' مع بعض')) + '</h4>' +
        '<p class="stf-muted">' + esc(dean ? L('Anything you leave as it is stays different per course.', 'اللي بتتركه زي ما هو بيضل مختلف لكل مساق.')
          : L('Your dean checks it first, as with one course.', 'العميد بيراجعه أول، زي المساق الواحد.')) + '</p>' +
        (dean ? '<label class="sr-f"><span>' + esc(fieldTx('offered')) + '</span><select class="sr-in" id="srBulkOffered" data-keep>' +
            '<option value="keep">' + esc(L('Leave as it is', 'خلّيها زي ما هي')) + '</option>' +
            ['', 's1', 's2'].map(function(v){ return '<option value="' + v + '">' + esc(offeredTx(v)) + '</option>'; }).join('') + '</select></label>' : '') +
        '<label class="sr-f"><span>' + esc(fieldTx('note')) + '</span><textarea class="sr-in" rows="2" maxlength="300" id="srBulkNote" data-keep placeholder="' + esc(L('Empty: leave their notes as they are', 'فاضي: خلّي ملاحظاتهم زي ما هي')) + '"></textarea></label>' +
        '<label class="sr-f sr-f-row"><span>' + esc(L('Show it until', 'اعرضها لحد')) + '</span><input class="sr-in" type="date" id="srBulkUntil" data-keep></label>' +
        '<label class="sr-check"><input type="checkbox" id="srBulkNoteDel"> ' + esc(L('Remove their pinned notes', 'احذف ملاحظاتهم المثبّتة')) + '</label>' +
        '<button type="button" class="stf-btn stf-pri sr-wide" data-sr="bulkapply">' + esc(dean ? L('Save for all ' + mine.length, 'احفظ للـ' + mine.length) : L('Send all to my dean', 'ابعت الكل للعميد')) + '</button></div>'
        : '<p class="stf-muted">' + esc(L('None of these courses is yours to change.', 'ولا مساق من هدول إلك تغيّره.')) + '</p>') +
    '</aside>';
  }
  function bulkApply(){
    var S = window.AAUP_STAFF, ids = (S && S.picked ? S.picked() : []).filter(mayWrite);
    if(!ids.length || busy) return;
    var sends = [];
    var off = document.getElementById('srBulkOffered');
    if(off && off.value !== 'keep') ids.forEach(function(id){ sends.push({ course: id, field: 'offered', value: off.value }); });
    var del = document.getElementById('srBulkNoteDel').checked, text = val('srBulkNote').trim(), until = val('srBulkUntil');
    if(del) ids.forEach(function(id){ sends.push({ course: id, field: 'note', value: '' }); });
    else if(text){
      if(!until){ if(window.__showToast) window.__showToast(L('Pick the date the pinned note ends.', 'اختار لإيمتى الملاحظة المثبّتة.')); return; }
      ids.forEach(function(id){ sends.push({ course: id, field: 'note', value: { text: text, until: until } }); });
    }
    if(!sends.length){ if(window.__showToast) window.__showToast(L('Nothing to change: pick what to set first.', 'ما في إشي يتغيّر: اختار شو بدك تغيّر أول.')); return; }
    busy = true;
    var chain = Promise.resolve();
    sends.forEach(function(x){ chain = chain.then(function(){ return api('POST', '/api/staff/content', x); }); });
    chain.then(function(){
      busy = false; dropKept = true;
      if(window.__showToast) window.__showToast(me.role === 'dean' ? L('Saved for ' + ids.length + ' courses. Students see it now.', 'انحفظ لـ' + ids.length + ' مساقات. الطلاب بيشوفوه هلق.') : L('Sent to your dean for ' + ids.length + ' courses', 'انبعت للعميد لـ' + ids.length + ' مساقات'));
      if(window.AAUP_STAFF_CONTENT) window.AAUP_STAFF_CONTENT.load(true);
      loadWork();
    }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); loadWork(); });
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
      '<p class="stf-muted">' + esc(L('You’re in Find a Professor as “', 'إنت بـ"ابحث عن محاضر" باسم "') + (me.name || me.username) + L('”, with your courses. What you save here shows there at once, except your phone.', '"، مع مساقاتك. اللي بتحفظه هون بيظهر هناك فوراً، إلا رقم الهاتف.')) + '</p>' +
      '<label class="sr-f"><span>' + esc(L('Office', 'المكتب')) + '</span><input class="sr-in" id="srCardOffice" data-keep maxlength="200" value="' + v('office') + '"></label>' +
      '<label class="sr-f"><span>' + esc(L('Office hours', 'الساعات المكتبية')) + '</span><input class="sr-in" id="srCardHours" data-keep maxlength="200" value="' + v('hours') + '"></label>' +
      '<label class="sr-f"><span>' + esc(L('Email', 'الإيميل')) + '</span><input class="sr-in" id="srCardEmail" data-keep type="email" maxlength="200" dir="ltr" value="' + v('email') + '"></label>' +
      '<label class="sr-f"><span>' + esc(L('Best way to reach you', 'أحسن طريقة للتواصل')) + '</span><input class="sr-in" id="srCardContact" data-keep maxlength="200" value="' + v('contact') + '"></label>' +
      '<label class="sr-f"><span>' + esc(L('Phone', 'رقم الهاتف')) + '</span><input class="sr-in" id="srCardPhone" data-keep type="tel" maxlength="24" dir="ltr" value="' + v('phone') + '"></label>' +
      '<small class="sr-lock">' + esc(!myCard.phone ? L('Students don’t see your phone until your dean allows it.', 'الطلاب ما بيشوفوا رقمك لحد ما العميد يسمح.')
        : myCard.phoneShown ? L('Your phone is shown to students.', 'رقمك ظاهر للطلاب.')
        : L('Your phone is saved. Students see it once your dean allows it.', 'رقمك محفوظ. الطلاب بيشوفوه لما العميد يسمح.')) + '</small>' +
      '<button type="button" class="stf-btn stf-pri sr-wide" data-sr="savecard">' + esc(L('Save my card', 'احفظ بطاقتي')) + '</button>';
  }
  function saveCard(){
    busy = true;
    api('POST', '/api/staff/card', { office: val('srCardOffice').trim(), hours: val('srCardHours').trim(), contact: val('srCardContact').trim(), email: val('srCardEmail').trim(), phone: val('srCardPhone').trim() }).then(function(){
      busy = false; dropKept = true;
      if(window.__showToast) window.__showToast(L('Saved. Students see it in Find a Professor.', 'انحفظ. الطلاب بيشوفوه بـ"ابحث عن محاضر".'));
      if(window.AAUP_STAFF_CONTENT) window.AAUP_STAFF_CONTENT.load(true);
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
        '<label class="sr-f"><span>' + esc(L('Email (students see it)', 'الإيميل (الطلاب بيشوفوه)')) + '</span><input class="sr-in" id="srGEmail" type="email" maxlength="200" dir="ltr"></label>' +
        '<label class="sr-f"><span>' + esc(L('Phone (optional)', 'الهاتف (اختياري)')) + '</span><input class="sr-in" id="srGPhone" type="tel" maxlength="24" dir="ltr"></label>' +
        '<label class="sr-check"><input type="checkbox" id="srGPhoneOk"> ' + esc(L('Show the phone to students', 'أظهر الرقم للطلاب')) + '</label>' +
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
    if(act === 'signout'){ if(me && me.admin) adminOff = true; setToken(''); me = null; team = null; lastLink = null; live = pending = myCard = cdates = slog = null; replies = {}; reported = {}; refresh(); return true; }
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
    if(act === 'reply'){
      var rt = val('srRe-' + id).trim();
      if(!rt){ if(window.__showToast) window.__showToast(L('Write the reply first.', 'اكتب الرد أول.')); return true; }
      if(!busy) sendReply(id, cid, rt);
      return true;
    }
    if(act === 'replyedit'){ replyOpen[id] = true; refresh(); return true; }
    if(act === 'replyno'){ delete replyOpen[id]; dropKept = true; refresh(); return true; }
    if(act === 'replydel'){ if(!busy) sendReply(id, cid, ''); return true; }
    if(act === 'report'){
      var th = (said && !said.error ? said : []).filter(function(x){ return x.id === id; })[0];
      if(!th || busy) return true;
      busy = true;
      api('POST', '/api/staff/report', { thought: id, course: cid, plan: th.plan, text: th.text }).then(function(){
        busy = false; reported[id] = 'open';
        if(window.__showToast) window.__showToast(L('Reported. The admin will look at it.', 'تبلّغ عنها. الإدارة رح تشوفها.'));
        refresh();
      }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
      return true;
    }
    if(act === 'bulkapply'){ bulkApply(); return true; }
    if(act === 'bulkdone'){ if(window.AAUP_STAFF && window.AAUP_STAFF.endPick) window.AAUP_STAFF.endPick(); return true; }
    if(act === 'bulkun'){ if(window.AAUP_STAFF && window.AAUP_STAFF.unpick) window.AAUP_STAFF.unpick(id); return true; }
    if(act === 'pdf'){ printPlan(); return true; }
    if(act === 'xlsx'){ exportPlan(); return true; }
    if(act === 'logall'){ logAll = !logAll; refresh(); return true; }
    if(act === 'putback'){
      if(busy) return true;
      busy = true;
      api('POST', '/api/staff/log/' + id + '/putback', {}).then(function(){
        busy = false;
        if(window.__showToast) window.__showToast(L('Put back. Students see the earlier version.', 'رجعت. الطلاب بيشوفوا النسخة القديمة.'));
        if(window.AAUP_STAFF_CONTENT) window.AAUP_STAFF_CONTENT.load(true);
        loadWork();
      }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
      return true;
    }
    if(act === 'dateadd'){
      var dl0 = val('srDateLabel').trim(), dd0 = val('srDateDay');
      if(!dl0 || !dd0){ if(window.__showToast) window.__showToast(L('Write what it is and pick the date.', 'اكتب شو هو واختار التاريخ.')); return true; }
      if(busy) return true;
      busy = true;
      var dBody = { label: dl0, date: dd0 };
      if(document.getElementById('srDateCollege')) dBody.college = val('srDateCollege');
      api('POST', '/api/staff/dates', dBody).then(function(){
        busy = false; dropKept = true;
        if(window.__showToast) window.__showToast(L('Added. Your students see it on Home.', 'انضاف. طلابك بيشوفوه بالرئيسية.'));
        if(window.AAUP_STAFF_CONTENT) window.AAUP_STAFF_CONTENT.load(true);
        loadDates();
      }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
      return true;
    }
    if(act === 'datedel'){
      if(busy) return true;
      busy = true;
      api('DELETE', '/api/staff/dates/' + id).then(function(){
        busy = false;
        if(window.AAUP_STAFF_CONTENT) window.AAUP_STAFF_CONTENT.load(true);
        loadDates();
      }, function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
      return true;
    }
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
      if(val('srGEmail').trim()) gBody.email = val('srGEmail').trim();
      if(val('srGPhone').trim()){ gBody.phone = val('srGPhone').trim(); gBody.phoneShown = !!(document.getElementById('srGPhoneOk') || {}).checked; }
      api('POST', '/api/staff/team', gBody)
        .then(function(d){ busy = false; dlg = null; dlgMsg = ''; lastLink = { who: who, link: setupLink(d.staff.username, d.setupCode) }; loadTeam(); }, fail);
      return true;
    }
    if(act === 'phoneshow' || act === 'phonehide'){
      busy = true;
      api('PATCH', '/api/staff/team/' + id, { phoneShown: act === 'phoneshow' })
        .then(function(){ busy = false; if(window.__showToast) window.__showToast(act === 'phoneshow' ? L('Students see the phone now', 'الطلاب بيشوفوا الرقم هلق') : L('Phone hidden from students', 'الرقم مخفي عن الطلاب')); if(window.AAUP_STAFF_CONTENT) window.AAUP_STAFF_CONTENT.load(true); loadTeam(); },
              function(e){ busy = false; if(window.__showToast) window.__showToast(e.message); });
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

  // Students per section, for "Planned for next semester" (kept on this device).
  document.addEventListener('change', function(e){
    if(!e.target || e.target.id !== 'srSecSize') return;
    try{ localStorage.setItem(SEC_KEY, String(Math.min(200, Math.max(5, +e.target.value || 35)))); }catch(err){}
    refresh();
  });
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
    loadMe: loadMe, pillHtml: pillHtml, actionsHtml: actionsHtml, panelHtml: panelHtml, courseEditHtml: courseEditHtml, bulkHtml: bulkHtml,
    dialogHtml: dialogHtml, afterRender: afterRender, onClick: onClick, onKey: onKey,
    signedIn: function(){ return !!me; },
    // shared with the admin room
    universities: universities, colleges: colleges, uniName: uniName, collegeName: collegeName, collegeLabel: collegeLabel, collegeIds: collegeIds,
    coursesIn: coursesIn, courseNames: courseNames, pickerHtml: pickerHtml, bindPickers: bindPickers,
    pickerValue: pickerValue, setupLink: setupLink, linkBoxHtml: linkBoxHtml, copy: copy, stateTx: stateTx
  };
})();
