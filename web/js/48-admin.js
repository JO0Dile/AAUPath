// ==========================
// ADMIN MODE
// ==========================
// The dashboard for the admin Worker (admin/cloudflare-worker.js). It is a
// client for an authenticated API, not an authority: every button here ends in
// a request the Worker independently authorizes and validates. Deleting this
// file, or calling its functions from the console, grants nothing — which is
// the property that makes it safe to ship inside the public app.
//
// Reached at #admin, or from Settings. A student who never types that never
// sees it, and nothing on this page runs until they do.
//
// One shape worth knowing before reading on: a major's metadata, its course
// list, its year/semester layout and its prerequisites all live in ONE file
// (data/<uni>/majors/<slug>.json). So the Majors, Courses, Prerequisites and
// Study Plan sections below are four views of a single in-memory object,
// saved by a single PUT. That is why there is one Save button per major and
// not one per section — and why a course move and a prerequisite edit can
// never land half-applied.
(function(){
  'use strict';

  var TOKEN_KEY = 'aaup_adminToken';   // sessionStorage: dies with the tab
  var state = {
    token: null,
    username: '',
    section: 'dashboard',
    tree: null,
    uni: null,          // slug of the university being edited
    major: null,        // the full in-memory major object
    majorSlug: null,
    dirty: false,
    assets: [],
    status: null,
    // The Majors browser groups by faculty, which needs two things the tree
    // does not carry: the university's faculty list and each major's faculty.
    // Both are fetched per university rather than for the whole catalogue.
    browseUni: null,
    browseFaculties: null,
    browseMajors: null,
    browseLoading: false,
    // Contributions (js/73-contribute.js) — a separate Worker, not the
    // GitHub-writing one this whole panel otherwise talks to, so it is
    // fetched directly rather than through api().
    contribItems: null,
    contribLoading: false
  };

  function esc(s){ return window.__escapeHtml(s == null ? '' : String(s)); }

  // The Worker's URL is a guess until someone actually deploys one — Cloudflare
  // builds it from the Worker name and the account subdomain, neither of which
  // this file can know. Getting it wrong produces a bare "Failed to fetch" with
  // nothing to act on, so the sign-in screen lets it be corrected here and
  // remembers it, rather than needing a code change and a redeploy to try a
  // different name.
  var URL_KEY = 'aaup_adminUrl';
  function savedUrl(){
    try{ return localStorage.getItem(URL_KEY) || ''; }catch(e){ return ''; }
  }
  function saveUrl(u){
    try{
      if(u) localStorage.setItem(URL_KEY, u); else localStorage.removeItem(URL_KEY);
    }catch(e){}
  }
  function base(){ return (savedUrl() || window.APP_ADMIN_URL || '').replace(/\/+$/, ''); }

  // ---------- API ----------

  // Round 10: a dean opens this same editor from the staff page ("Edit this
  // major"). In that staff mode it signs in with their staff login and asks
  // the staff routes, which only answer for majors in the dean's colleges.
  var staffMode = null;   // { label } while a dean is editing
  var STAFF_PATHS = [[/^\/api\/major\//, '/api/staff/major/'], [/^\/api\/history\//, '/api/staff/history/'],
    [/^\/api\/majors\/[^/]+$/, '/api/staff/majors'], [/^\/api\/tree$/, '/api/staff/tree'],
    [/^\/api\/status$/, '/api/staff/status'], [/^\/api\/university\//, '/api/staff/university/']];
  function staffPath(path){
    for(var i = 0; i < STAFF_PATHS.length; i++){ if(STAFF_PATHS[i][0].test(path)) return path.replace(STAFF_PATHS[i][0], STAFF_PATHS[i][1]); }
    return null;
  }
  function api(method, path, body){
    if(!base()) return Promise.reject(new Error('No admin API configured (APP_ADMIN_URL is empty).'));
    if(staffMode){
      var sp = staffPath(path);
      if(!sp) return Promise.reject(new Error('Not available here.'));
      path = sp;
    }
    // no-store, because a cached read here is not a stale view — it is data
    // loss. The editor renders its form from the response and Save posts the
    // whole object back, so a minutes-old copy silently reverts everything
    // saved in between. The Worker sends no-store too; this is the belt to
    // that brace, and it also covers replies cached before the Worker did.
    var opts = { method: method, headers: {}, cache: 'no-store' };
    if(state.token) opts.headers.Authorization = 'Bearer ' + state.token;
    if(body !== undefined){
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(base() + path, opts).catch(function(){
      // fetch() rejects — rather than returning a status — when the request
      // never completed: DNS did not resolve, the Worker is not deployed, its
      // workers.dev route is switched off, or CORS blocked the reply. The
      // browser deliberately does not say which. "Failed to fetch" on its own
      // sends people hunting through their password; this says what it
      // actually means and offers the one thing worth trying.
      var e = new Error('The admin server didn\'t answer. Check your internet, reload the page and try again.');
      e.unreachable = true;
      throw e;
    }).then(function(r){
      return r.json().catch(function(){ return { error: 'HTTP ' + r.status }; }).then(function(data){
        // A 401 from /api/login means the password was wrong and must say so.
        // Anywhere else it means the session expired or the signing secret was
        // rotated, so the token is dropped rather than letting every later
        // click fail one at a time.
        if(r.status === 401 && path !== '/api/login'){
          if(staffMode){ endStaff(); throw new Error('Your staff session ended. Sign in again on the staff page.'); }
          signOut(true);
          throw new Error('Your admin session ended. Sign in again.');
        }
        if(!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        return data;
      });
    });
  }

  // ---------- shell ----------

  // The catalogue editor behind the password is a maintainer tool and stays
  // in English. The sign-in screen in front of it is not: it is the one part
  // of this module a student can reach by typing #admin, so it follows the
  // language switch like the rest of the app.
  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function T(en, arabic){ return ar() ? arabic : en; }

  function ensureOverlay(){
    if(document.getElementById('adminOverlay')) return;
    var el = document.createElement('div');
    el.id = 'adminOverlay';
    el.className = 'admin-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', T('Admin', 'لوحة الإدارة'));
    el.innerHTML =
      '<div class="admin-shell">' +
        '<header class="admin-top">' +
          '<div class="admin-brand">🛡 <strong>' + T('Admin', 'لوحة الإدارة') + '</strong><span id="adminWho"></span></div>' +
          '<div class="admin-top-actions">' +
            '<span id="adminSaveState" class="admin-savestate"></span>' +
            '<button type="button" class="home-btn" id="adminSignOut">' + T('Sign out', 'تسجيل الخروج') + '</button>' +
            '<button type="button" class="home-btn" id="adminClose">✕ ' + T('Close', 'إغلاق') + '</button>' +
          '</div>' +
        '</header>' +
        '<div class="admin-body">' +
          '<nav class="admin-nav" id="adminNav"></nav>' +
          '<main class="admin-main" id="adminMain"></main>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    document.getElementById('adminClose').addEventListener('click', close);
    document.getElementById('adminSignOut').addEventListener('click', function(){ signOut(false); });
  }

  var SECTIONS = [
    ['dashboard',     '📊 Dashboard'],
    ['universities',  '🏛 Universities'],
    ['majors',        '🎓 Majors / Plans'],
    ['courses',       '📚 Courses'],
    ['prereqs',       '🔗 Prerequisites'],
    ['schedule',      '🗓 Study Plan'],
    ['assets',        '🖼 Assets'],
    ['contributions', '📮 Contributions'],
    ['thoughts',      '💬 Student Thoughts'],
    ['accounts',      '👤 Student accounts'],
    ['staff',         '🎓 Staff logins'],
    ['workers',       '🚀 Workers'],
    ['settings',      '⚙️ Settings']
  ];

  // Round 8, idea 22: the same sections, same names, grouped under three
  // headings, with a count beside the ones that are waiting on you.
  var NAV_GROUPS = [
    [null, ['dashboard']],
    ['Content', ['universities', 'majors', 'courses', 'prereqs', 'schedule', 'assets']],
    ['People', ['contributions', 'thoughts', 'accounts', 'staff']],
    ['System', ['workers', 'settings']]
  ];
  function navCount(key){
    if(key === 'contributions' && state.contribItems){
      return state.contribItems.filter(function(c){ return (c.status || 'pending') === 'pending'; }).length;
    }
    if(key === 'thoughts' && (state.thoughtItems || state.reports)){
      var seen = 0; try{ seen = +localStorage.getItem(SEEN_THOUGHTS_KEY) || 0; }catch(e){}
      return (state.thoughtItems || []).filter(function(t){ return (t.at || 0) > seen; }).length + (state.reports || []).length;
    }
    if(key === 'workers' && state.workers){
      return state.workers.filter(function(w){ return w.status === 'behind' || w.status === 'down'; }).length;
    }
    if((key === 'courses' || key === 'prereqs' || key === 'schedule') && state.major){
      return problemsOf(state.major).filter(function(x){ return x.sev === 'bad'; }).length;
    }
    return 0;
  }
  function renderNav(){
    var nav = document.getElementById('adminNav');
    if(!nav) return;
    var label = {};
    SECTIONS.forEach(function(s){ label[s[0]] = s[1]; });
    var btn = function(key){
      var needsMajor = ['courses', 'prereqs', 'schedule'].indexOf(key) !== -1;
      var off = needsMajor && !state.major;
      var n = navCount(key);
      return '<button type="button" class="admin-navbtn' + (state.section === key ? ' is-active' : '') +
        (off ? ' is-off' : '') + (needsMajor && state.dirty ? ' is-dirty' : '') + '" data-section="' + key + '">' + label[key] +
        (n ? '<span class="admin-navcount">' + n + '</span>' : '') + '</button>';
    };
    var groups = staffMode ? [[null, ['majors']], ['Plan', ['courses', 'prereqs', 'schedule']]] : NAV_GROUPS;
    nav.innerHTML = groups.map(function(g){
      return (g[0] ? '<div class="admin-navgroup">' + g[0] + '</div>' : '') + g[1].map(btn).join('');
    }).join('') +
    (state.major
      ? '<div class="admin-nav-context">Editing<br><strong>' + esc(state.majorSlug) + '</strong>' +
        '<br><span class="admin-dot-dirty" id="adminNavDirty"' +
        (state.dirty ? '' : ' style="display:none"') + '>unsaved changes</span></div>'
      : '');
    nav.querySelectorAll('[data-section]').forEach(function(b){
      b.addEventListener('click', function(){
        var want = b.getAttribute('data-section');
        if(['courses', 'prereqs', 'schedule'].indexOf(want) !== -1 && !state.major){
          toast('Pick a major first — open Majors / Plans and choose one to edit.');
          state.section = 'majors';
        } else {
          state.section = want;
        }
        render();
      });
    });
  }

  function toast(msg){
    if(window.__showToast) window.__showToast(msg);
  }

  function setMsg(html, kind){
    var el = document.getElementById('adminMsg');
    if(!el) return;
    el.innerHTML = html ? '<p class="' + (kind === 'ok' ? 'dev-success-msg' : 'dev-error-msg') + '">' + html + '</p>' : '';
  }

  // Updates the two dirty indicators in place. It must NOT re-render the nav:
  // these fire on every keystroke and every select change, and replacing the
  // nav's DOM between a mousedown and its mouseup means the browser never
  // fires the click at all — so the admin's first click after editing a field
  // was being silently swallowed.
  function setDirty(on){
    state.dirty = on;
    var s = document.getElementById('adminSaveState');
    if(s) s.textContent = on ? '● unsaved · Ctrl+S to save' : 'saved';
    var ctx = document.getElementById('adminNavDirty');
    if(ctx) ctx.style.display = on ? '' : 'none';
    // Round 8, idea 26: a dot on the sections holding the unsaved major.
    document.querySelectorAll('.admin-navbtn[data-section="courses"], .admin-navbtn[data-section="prereqs"], .admin-navbtn[data-section="schedule"]')
      .forEach(function(b){ b.classList.toggle('is-dirty', !!on); });
    if(on) schedulePreview();
  }
  function markDirty(){ setDirty(true); }
  function markClean(){ setDirty(false); }

  // ---------- login ----------

  function renderLogin(err, unreachable){
    var main = document.getElementById('adminMain');
    var nav = document.getElementById('adminNav');
    if(nav) nav.innerHTML = '';
    main.innerHTML =
      '<div class="admin-login">' +
        '<h2>' + T('Sign in', 'تسجيل الدخول') + '</h2>' +
        '<p class="admin-hint">' + T(
          'Your password is checked on the server. It is never stored in this page, ' +
          'and nothing here can change published data without it.',
          'تُفحص كلمة المرور على الخادم. لا تُخزَّن في هذه الصفحة أبدًا، ولا شيء هنا يستطيع تغيير البيانات المنشورة بدونها.') + '</p>' +
        '<div class="form-field"><label for="adminUser">' + T('Username', 'اسم المستخدم') + '</label>' +
        '<input type="text" id="adminUser" autocomplete="username" autocapitalize="none" spellcheck="false"></div>' +
        '<div class="form-field"><label for="adminPass">' + T('Password', 'كلمة المرور') + '</label>' +
        '<input type="password" id="adminPass" autocomplete="current-password"></div>' +
        '<div class="form-actions"><button type="button" class="home-btn admin-primary" id="adminLoginBtn">' + T('Sign in', 'تسجيل الدخول') + '</button></div>' +
        (err ? '<p class="dev-error-msg">' + esc(err) + '</p>' : '') +
        '<p class="admin-hint" id="adminHealth"></p>' +
        '<details class="admin-endpoint"' + (unreachable ? ' open' : '') + '>' +
          '<summary>' + T('Admin API address', 'عنوان واجهة الإدارة') + '</summary>' +
          (unreachable
            ? '<p class="admin-hint">The browser could not reach it at all — that happens before any ' +
              'password is checked, so this is not about your credentials. Usually it means the ' +
              'Worker is not deployed, is named something else, or its <code>workers.dev</code> ' +
              'route is switched off.</p>' +
              '<p class="admin-hint">Open <code>' + esc(base()) + '/api/health</code> in a tab. ' +
              'If it shows <code>{"ok":true}</code> the address is right; if nothing loads, it is wrong.</p>'
            : '') +
          '<div class="form-field"><label for="adminUrl">' + T('Worker URL', 'رابط الـ Worker') + '</label>' +
          '<input type="text" id="adminUrl" spellcheck="false" autocapitalize="none" ' +
          'value="' + esc(base()) + '" placeholder="https://your-worker.your-subdomain.workers.dev"></div>' +
          '<div class="form-actions">' +
          '<button type="button" class="home-btn" id="adminUrlTest">' + T('Test', 'اختبار') + '</button>' +
          '<button type="button" class="home-btn" id="adminUrlSave">' + T('Use this address', 'استخدم هذا العنوان') + '</button>' +
          (savedUrl() ? '<button type="button" class="home-btn" id="adminUrlReset">Reset to default</button>' : '') +
          '</div><div id="adminUrlMsg" class="admin-hint"></div>' +
        '</details>' +
      '</div>';

    var go = function(){
      var u = document.getElementById('adminUser').value;
      var p = document.getElementById('adminPass').value;
      document.getElementById('adminLoginBtn').disabled = true;
      api('POST', '/api/login', { username: u, password: p }).then(function(res){
        state.token = res.token;
        state.username = res.username || u;
        try{ sessionStorage.setItem(TOKEN_KEY, res.token); }catch(e){}
        return api('GET', '/api/status').then(function(st){ state.status = st; }).catch(function(){})
          .then(loadTree);
      }).then(function(){
        state.section = 'dashboard';
        render();
      }).catch(function(e){
        renderLogin(e.unreachable
          ? T('Could not reach the admin API.', 'تعذّر الوصول إلى واجهة الإدارة.')
          : e.message, !!e.unreachable);
      });
    };
    document.getElementById('adminLoginBtn').addEventListener('click', go);

    var urlMsg = function(t, ok){
      var el = document.getElementById('adminUrlMsg');
      if(el){ el.innerHTML = t; el.style.color = ok ? 'var(--unlock)' : 'var(--prereq)'; }
    };
    var typedUrl = function(){
      return (document.getElementById('adminUrl').value || '').trim().replace(/\/+$/, '');
    };
    var testBtn = document.getElementById('adminUrlTest');
    if(testBtn){
      testBtn.addEventListener('click', function(){
        var u = typedUrl();
        // https only, except a local address — a Worker under `wrangler dev`
        // is served over plain http on localhost, and refusing that would make
        // this box useless for the one case where you are actively debugging.
        var okScheme = /^https:\/\//i.test(u) ||
                       /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u);
        if(!okScheme){ urlMsg('That needs to start with https://', false); return; }
        urlMsg('Checking…', true);
        fetch(u + '/api/health')
          .then(function(r){ return r.json(); })
          .then(function(h){
            if(h && h.ok && h.originAllowed === false){
              urlMsg('Reached it, but it refuses this site. Set its ALLOWED_ORIGIN to exactly ' +
                     esc(location.origin) + ' and redeploy.', false);
            } else if(h && h.ok){
              urlMsg(T('✅ Reached it. Press "Use this address", then sign in.',
                '✅ تم الوصول. اضغط «استخدم هذا العنوان» ثم سجّل الدخول.'), true);
            } else {
              urlMsg('Something answered, but not the admin Worker.', false);
            }
          })
          .catch(function(){
            urlMsg('❌ Nothing there. Check the Worker name, and that its workers.dev route is enabled.', false);
          });
      });
    }
    var saveBtn = document.getElementById('adminUrlSave');
    if(saveBtn){
      saveBtn.addEventListener('click', function(){
        saveUrl(typedUrl());
        renderLogin('', false);
        urlMsg('Saved on this device.', true);
      });
    }
    var resetBtn = document.getElementById('adminUrlReset');
    if(resetBtn){
      resetBtn.addEventListener('click', function(){ saveUrl(''); renderLogin('', false); });
    }
    document.getElementById('adminPass').addEventListener('keydown', function(e){ if(e.key === 'Enter') go(); });
    document.getElementById('adminUser').focus();

    // Reachability only. It deliberately does NOT report whether an admin is
    // configured or which repo is behind it: anyone can open this screen, and
    // those answers tell a stranger there is an account here and what it is
    // worth attacking. That detail now arrives after sign-in, from /api/status.
    if(base()){
      fetch(base() + '/api/health').then(function(r){ return r.json(); }).then(function(h){
        var el = document.getElementById('adminHealth');
        if(!el) return;
        // The Worker answers, so the address is right. If it also says this
        // page's origin is not on its list, every later request will be
        // blocked by the browser with no explanation — name the exact value
        // that needs setting rather than leaving a CORS failure to be guessed.
        // Checked before the origin, because when this is on nothing else can
        // possibly succeed and the origin question is moot.
        if(h && h.accessGateBlocking){
          el.innerHTML = '⚠️ The Worker has <code>REQUIRE_CF_ACCESS</code> switched on, but this ' +
            'request carries no Cloudflare Access token — so every route answers ' +
            '<em>not found</em>, including sign-in. Either finish setting up Cloudflare Access, ' +
            'or delete the <code>REQUIRE_CF_ACCESS</code> variable in the Worker\'s settings.';
        } else if(h && h.originAllowed === false){
          el.innerHTML = '⚠️ The Worker is reachable but is refusing this site. ' +
            'Set its <code>ALLOWED_ORIGIN</code> to exactly <code>' + esc(location.origin) +
            '</code> — an origin only, with no path and no trailing slash — then redeploy.';
        } else {
          el.textContent = '';
        }
      }).catch(function(){
        var el = document.getElementById('adminHealth');
        if(el) el.innerHTML = T('⚠️ Could not reach the admin API — see below.',
          '⚠️ تعذّر الوصول إلى واجهة الإدارة — انظر أدناه.');
        var d = document.querySelector('.admin-endpoint');
        if(d) d.open = true;
      });
    } else {
      var el = document.getElementById('adminHealth');
      if(el) el.innerHTML = T('No admin API is configured.', 'لا توجد واجهة إدارة مُعدّة.');
    }
  }

  function endStaff(){
    staffMode = null;
    state.token = null; state.username = ''; state.major = null; state.tree = null; state.dirty = false;
    state.browseUni = null; state.browseMajors = null; state.browseFaculties = null;
    var el = document.getElementById('adminOverlay');
    if(el){ el.classList.remove('open', 'is-staff'); }
    document.body.style.overflow = '';
  }
  function signOut(silent){
    if(staffMode){ endStaff(); return; }
    state.token = null; state.username = ''; state.major = null; state.tree = null; state.dirty = false;
    try{ sessionStorage.removeItem(TOKEN_KEY); }catch(e){}
    if(!silent && document.getElementById('adminOverlay')) render();
  }

  function loadTree(){
    return api('GET', '/api/tree').then(function(res){ state.tree = res.universities || []; });
  }

  // Faculties and major metadata for one university, for the Majors browser.
  // Kept separate from loadTree so opening the dashboard stays one request:
  // this is only paid when someone actually looks at a university's majors.
  function loadBrowse(uniSlug){
    state.browseUni = uniSlug;
    state.browseLoading = true;
    state.browseFaculties = null;
    state.browseMajors = null;
    return Promise.all([
      api('GET', '/api/university/' + uniSlug),
      api('GET', '/api/majors/' + uniSlug)
    ]).then(function(res){
      // A university edited in another tab can land here mid-flight; ignoring a
      // reply for a university we are no longer looking at stops it painting
      // over the current one.
      if(state.browseUni !== uniSlug) return;
      state.browseFaculties = (res[0].university || {}).colleges || [];
      state.browseMajors = res[1].majors || [];
      state.browseLoading = false;
    }).catch(function(e){
      if(state.browseUni !== uniSlug) return;
      state.browseLoading = false;
      // /api/majors is newer than some deployed Workers. Say which half failed
      // rather than showing an empty browser with no explanation.
      toast(/404|not found/i.test(e.message)
        ? 'This Worker does not have /api/majors yet — redeploy admin/cloudflare-worker.js.'
        : e.message);
    });
  }

  // ---------- sections ----------

  // ---------- Workers: deploys and versions (round 7, ideas 28 + 29) ----------
  // Each Worker reports the commit it was deployed from at /__version (the
  // deploy workflow writes it in). GitHub says the latest commit of each
  // Worker's file, and how the last "Deploy workers" run went. Side by side:
  // up to date, behind (with the file to paste if deploys aren't set up), or
  // "version unknown" for a copy pasted by hand.
  var WORKERS = [
    { name: 'studyplan-cloud', file: 'cloud/cloudflare-worker.js', url: function(){ return window.APP_CLOUD_URL; } },
    { name: 'studyplan-admin', file: 'admin/cloudflare-worker.js', url: function(){ return base(); } },
    { name: 'thoughts-worker', file: 'workers/thoughts-worker.js', url: function(){ return window.APP_THOUGHTS_URL; } },
    { name: 'contributions-worker', file: 'workers/contributions-worker.js', url: function(){ return window.APP_CONTRIB_URL; } },
    { name: 'ratings-worker', file: 'workers/ratings-worker.js', url: function(){ return window.APP_RATINGS_URL; } }
  ];
  function ghRepo(){ return (state.status && state.status.repo) || 'JO0Dile/AAUPath'; }
  function getJson(u){ return fetch(u, { cache: 'no-store' }).then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
  function loadWorkers(){
    state.workersLoading = true;
    var repo = ghRepo();
    var runs = getJson('https://api.github.com/repos/' + repo + '/actions/workflows/deploy-workers.yml/runs?per_page=1')
      .then(function(d){ return (d.workflow_runs || [])[0] || null; }).catch(function(){ return null; });
    Promise.all([runs].concat(WORKERS.map(function(w){
      var live = w.url() ? getJson(String(w.url()).replace(/\/+$/, '') + '/__version').then(function(d){ return d && d.build; }).catch(function(e){ return e && /HTTP 404/.test(e.message) ? '' : null; }) : Promise.resolve(null);
      var latest = getJson('https://api.github.com/repos/' + repo + '/commits?path=' + encodeURIComponent(w.file) + '&per_page=1')
        .then(function(d){ return d && d[0] ? { sha: d[0].sha, msg: (d[0].commit && d[0].commit.message || '').split('\n')[0], at: d[0].commit && d[0].commit.committer && d[0].commit.committer.date } : null; })
        .catch(function(){ return null; });
      return Promise.all([live, latest]).then(function(x){ return { w: w, live: x[0], latest: x[1] }; });
    }))).then(function(all){
      state.deployRun = all[0];
      return (window.APP_CLOUD_URL ? getJson(String(window.APP_CLOUD_URL).replace(/\/+$/, '') + '/api/google/config')
        .then(function(d){ return d && d.clientId ? 'on' : 'off'; }).catch(function(e){ return e && /HTTP 404/.test(e.message) ? 'old' : 'down'; })
        : Promise.resolve('down')).then(function(g){ state.googleSignIn = g; return all; });
    }).then(function(all){
      state.workers = all.slice(1).map(function(r){
        var st = 'unknown';
        if(r.live === null) st = 'down';
        else if(!r.live || r.live === '__WORKER_BUILD__') st = 'unknown';
        else if(r.latest && r.latest.sha.indexOf(r.live) === 0) st = 'ok';
        else if(r.latest) st = 'behind';
        return { name: r.w.name, file: r.w.file, live: r.live, latest: r.latest, status: st };
      });
      state.workersAt = Date.now();
    }).then(function(){ state.workersLoading = false; render(); });
  }
  function agoTx(t){
    var m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
  }
  function sectionWorkers(){
    var head = '<h2>🚀 Workers</h2>';
    if(!state.workers) return head + '<p class="admin-hint">Checking each Worker…</p>';
    var run = state.deployRun;
    var runTx = run
      ? '<div class="admin-note">Last <strong>Deploy workers</strong> run: ' +
          (run.status !== 'completed' ? '⏳ ' + esc(run.status) : run.conclusion === 'success' ? '✓ succeeded' : '✗ ' + esc(run.conclusion || 'failed')) +
          ' · after “' + esc((run.head_commit && run.head_commit.message || '').split('\n')[0]) + '”' +
          (run.run_started_at && run.updated_at ? ' · ' + Math.max(1, Math.round((new Date(run.updated_at) - new Date(run.run_started_at)) / 1000)) + ' s' : '') +
          ' · ' + agoTx(run.created_at) + ' · <a href="' + esc(run.html_url) + '" target="_blank" rel="noopener">open the run</a></div>'
      : '<div class="admin-note admin-note-warn"><strong>Automatic deploys aren\'t running yet.</strong> In GitHub → the repository → Settings → Secrets and variables → Actions, add <code>CLOUDFLARE_API_TOKEN</code> (a Cloudflare API token with “Workers Scripts: Edit”) and <code>CLOUDFLARE_ACCOUNT_ID</code>. From then on, every merge that changes a Worker deploys it by itself.</div>';
    var badge = { ok: '<span class="adm-ok">✓ deployed</span>', behind: '<span class="adm-warn">behind</span>',
                  unknown: '<span class="adm-dim">version unknown</span>', down: '<span class="adm-bad">not reachable</span>' };
    return head + runTx +
      '<table class="admin-table"><thead><tr><th>Worker</th><th>Running</th><th>Latest on GitHub</th><th></th></tr></thead><tbody>' +
      state.workers.map(function(w){
        var fileUrl = 'https://github.com/' + ghRepo() + '/blob/main/' + w.file;
        return '<tr><td><strong>' + esc(w.name) + '</strong><br><span class="admin-sub">' + esc(w.file) + '</span></td>' +
          '<td><code>' + esc(w.live && w.live !== '__WORKER_BUILD__' ? w.live : '—') + '</code></td>' +
          '<td>' + (w.latest ? '<code>' + esc(w.latest.sha.slice(0, 7)) + '</code> <span class="admin-sub">' + esc(agoTx(w.latest.at)) + '</span>' : '—') + '</td>' +
          '<td>' + badge[w.status] + (w.status === 'behind' || w.status === 'unknown' ? '<br><a class="admin-sub" href="' + esc(fileUrl) + '" target="_blank" rel="noopener">the code to paste</a>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      googleNoteHtml() +
      '<p class="admin-hint">“Version unknown” means that Worker was pasted by hand, so it can\'t say which commit it is. The first automatic deploy fixes that.</p>' +
      '<div class="form-actions" style="justify-content:flex-start;"><button type="button" class="home-btn" id="adminWorkersRefresh">Check again</button></div>';
  }

  // Whether students get the "Continue with Google" button: it shows only
  // when studyplan-cloud answers /api/google/config with a client id.
  function googleNoteHtml(){
    var g = state.googleSignIn;
    if(g === 'on') return '<div class="admin-note">Sign in with Google: <span class="adm-ok">✓ on</span>. Students see “Continue with Google” when they sign in.</div>';
    if(g === 'off') return '<div class="admin-note admin-note-warn"><strong>Sign in with Google is off:</strong> studyplan-cloud has no Google client ID, so students don\'t see the button. In Cloudflare → Workers → <strong>studyplan-cloud</strong> → Settings → Variables and Secrets, add <code>GOOGLE_CLIENT_ID</code> (type Text) with the client ID from Google Cloud → Credentials, then Deploy. Check that the name is spelled exactly like that and that it is on studyplan-cloud, not another Worker.</div>';
    if(g === 'old') return '<div class="admin-note admin-note-warn"><strong>Sign in with Google:</strong> studyplan-cloud is running old code that can\'t say whether Google is set up. Run Actions → Deploy workers → Run workflow.</div>';
    if(g === 'down') return '<div class="admin-note admin-note-warn"><strong>Sign in with Google:</strong> couldn\'t reach studyplan-cloud to check.</div>';
    return '';
  }

  // ---------- Waiting for you (round 7, idea 30) ----------
  // The Dashboard opens on the things that need the maintainer: Workers
  // behind, contributions not answered, thoughts since the last look, and
  // universities with no upcoming dates. Each row goes where it's dealt with.
  var SEEN_THOUGHTS_KEY = 'aaup_adminSeenThoughts';
  function inboxHtml(){
    var rows = [];
    var row = function(text, section, btn){ rows.push('<div class="adm-inbox-row"><span>' + text + '</span><button type="button" class="home-btn" data-inbox-go="' + section + '">' + btn + '</button></div>'); };
    if(state.workers){
      var behind = state.workers.filter(function(w){ return w.status === 'behind' || w.status === 'down'; });
      if(behind.length) row('🚀 ' + behind.length + ' Worker' + (behind.length === 1 ? '' : 's') + ' behind or not reachable: ' + esc(behind.map(function(w){ return w.name; }).join(', ')), 'workers', 'Open');
      if(!state.deployRun) row('🚀 Automatic Worker deploys aren\'t set up yet', 'workers', 'How');
      if(state.googleSignIn === 'off' || state.googleSignIn === 'old') row('🔑 Sign in with Google is off, so students don\'t see the button', 'workers', 'Fix');
    }
    if(contribSecret() && state.contribItems){
      var pend = state.contribItems.filter(function(c){ return (c.status || 'pending') === 'pending'; });
      if(pend.length) row('📮 ' + pend.length + ' contribution' + (pend.length === 1 ? '' : 's') + ' waiting for a reply', 'contributions', 'Review');
    } else if(contribUrl() && !contribSecret()) row('📮 Contributions: enter the secret once to check for new ones', 'contributions', 'Open');
    if(thoughtsSecret() && state.thoughtItems){
      var seen = 0; try{ seen = +localStorage.getItem(SEEN_THOUGHTS_KEY) || 0; }catch(e){}
      var fresh = state.thoughtItems.filter(function(t){ return (t.at || 0) > seen; });
      if(fresh.length) row('💬 ' + fresh.length + ' new student thought' + (fresh.length === 1 ? '' : 's') + ' since you last looked', 'thoughts', 'Read');
    }
    if(state.reports && state.reports.length) row('🚩 ' + state.reports.length + ' thought' + (state.reports.length === 1 ? '' : 's') + ' reported by staff', 'thoughts', 'Review');
    var today = new Date().toISOString().slice(0, 10);
    (state.tree || []).filter(function(u){ return u.published; }).forEach(function(u){
      var d = ((window.APP_UNIVERSITIES || {})[u.slug] || {}).dates || [];
      if(!d.some(function(x){ return x && x.date >= today; })) row('🗓 ' + esc(u.shortName || u.name) + ' has no upcoming dates (add/drop, midterms, finals)', 'universities', 'Add');
    });
    return '<h2>Waiting for you</h2>' + (rows.length ? '<div class="adm-inbox">' + rows.join('') + '</div>'
      : '<p class="admin-hint">' + (state.workers ? 'Nothing right now.' : 'Checking…') + '</p>');
  }

  function sectionDashboard(){
    if(!state.workers && !state.workersLoading) setTimeout(loadWorkers, 0);
    if(contribSecret() && !state.contribItems && !state.contribLoading) setTimeout(loadContributions, 0);
    if(thoughtsSecret() && !state.thoughtItems && !state.thoughtsLoading) setTimeout(loadThoughts, 0);
    if(!state.reports && !state.reportsLoading) setTimeout(loadReports, 0);
    var unis = state.tree || [];
    var majorCount = unis.reduce(function(n, u){ return n + (u.majors || []).length; }, 0);
    var published = unis.filter(function(u){ return u.published; });
    return inboxHtml() + '<h2>Overview</h2>' +
      '<div class="admin-stats">' +
        stat(published.length, 'published universities') +
        stat(unis.length - published.length, 'unpublished') +
        stat(majorCount, 'major files') +
        stat(state.assets.length, 'uploaded assets') +
      '</div>' +
      (state.status
        ? '<div class="admin-note">' + (state.status.canWrite
            ? 'Writing to <strong>' + esc(state.status.repo) + '</strong> on <strong>' + esc(state.status.branch) + '</strong>.'
            : '⚠️ Saving will fail: the Worker has no GitHub token configured.') + '</div>'
        : '') +
      '<div class="admin-note">' +
        '<strong>How a change reaches students.</strong> Saving here writes a real commit to ' +
        '<code>data/</code>. CI rebuilds <code>web/plans.json</code> and GitHub Pages redeploys, so an edit is ' +
        'live in about a minute — not instantly. Every change is a commit, so anything can be undone with ' +
        '<code>git revert</code>.' +
      '</div>' +
      '<div class="admin-note admin-note-warn">' +
        '<strong>Students who edited their own copy of a plan are not overwritten.</strong> ' +
        'When your change reaches them, they get a popup listing exactly what changed and choose whether to ' +
        'take it. Everything else — logos, icons, university details — applies with no prompt.' +
      '</div>' +
      '<h3>Universities</h3>' + universityTable();
  }

  function stat(n, label){
    return '<div class="admin-stat"><div class="admin-stat-n">' + n + '</div><div>' + label + '</div></div>';
  }

  function universityTable(){
    var unis = state.tree || [];
    if(!unis.length) return '<p class="ex-note">Nothing loaded.</p>';
    return '<table class="admin-table"><thead><tr><th>University</th><th>Short</th><th>Majors</th><th>Status</th><th></th></tr></thead><tbody>' +
      unis.map(function(u){
        return '<tr><td><strong>' + esc(u.name) + '</strong><br><span class="admin-sub">' + esc(u.slug) + '</span></td>' +
          '<td>' + esc(u.shortName || '') + '</td>' +
          '<td>' + (u.majors || []).length + '</td>' +
          '<td>' + (u.published
            ? '<span class="admin-pill admin-pill-on">Published</span>'
            : '<span class="admin-pill">Hidden</span>') + '</td>' +
          '<td><button type="button" class="home-btn admin-mini" data-edit-uni="' + esc(u.slug) + '">Edit</button></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function sectionUniversities(){
    return '<h2>Universities</h2>' +
      '<p class="admin-hint">Editing a university changes its name, description and logo for everyone. ' +
      'These are not student-editable, so they apply with no confirmation prompt.</p>' +
      universityTable() +
      '<div id="adminUniEditor"></div>';
  }

  function universityEditor(u, full){
    var pub = u.published !== false;
    return '<div class="admin-editor"><h3>' + esc(full.name || u.slug) + '</h3>' +
      '<div class="form-field-row">' +
        field('auName', 'Name (English)', full.name) +
        field('auNameAr', 'Name (Arabic)', full.nameAr) +
      '</div>' +
      '<div class="form-field-row">' +
        field('auShort', 'Short name', full.shortName) +
        field('auIcon', 'Emoji fallback', full.icon) +
        field('auWebsite', 'Website', full.website) +
      '</div>' +
      '<div class="form-field"><label for="auDesc">Description</label>' +
      '<textarea id="auDesc" rows="3">' + esc(full.description || '') + '</textarea></div>' +
      iconPicker('auIconKey', full.iconKey) +
      '<div class="form-field"><label for="auLogo">Official logo</label>' +
      '<input type="text" id="auLogo" value="' + esc(full.logoUrl || '') + '" placeholder="assets/uploads/aaup-logo.png or https://…">' +
      '<p class="admin-hint">Upload the file in <strong>Assets</strong>, then paste its path here. ' +
      'An uploaded file is served from the app itself, so the logo still shows offline.</p>' +
      '</div>' +
      markPreview('au') +
      '<label class="admin-check"><input type="checkbox" id="auPublished"' + (pub ? ' checked' : '') + '> Published (visible to students)</label>' +
      '<h4>Faculties</h4><div id="auColleges">' + collegeRows(full.colleges || []) + '</div>' +
      '<h4>Important dates</h4>' +
      '<p class="admin-hint">Shown on every student\'s Home, counting down: add/drop, midterms, finals, registration… ' +
      'Past dates drop off by themselves. A student can add their own dates beside these.</p>' +
      '<div id="auDates">' + dateRows(full.dates || []) + '</div>' +
      '<div class="form-actions">' +
        '<button type="button" class="home-btn admin-mini" id="auAddDate">+ Add a date</button>' +
        '<button type="button" class="home-btn admin-mini" id="auAddCollege">+ Add faculty</button>' +
        '<button type="button" class="home-btn admin-primary" id="auSave" data-slug="' + esc(u.slug) + '">Save university</button>' +
      '</div><div id="adminMsg"></div></div>';
  }

  function dateRows(list){
    return list.map(function(d){
      return '<div class="form-field-row admin-date-row" data-date-row>' +
        '<div class="form-field"><label>What (English)</label><input type="text" class="ad-en" value="' + esc(d.en || '') + '" placeholder="Add / drop ends"></div>' +
        '<div class="form-field"><label>What (Arabic)</label><input type="text" class="ad-ar" dir="rtl" value="' + esc(d.ar || '') + '" placeholder="آخر يوم سحب وإضافة"></div>' +
        '<div class="form-field"><label>Date</label><input type="date" class="ad-date" value="' + esc(d.date || '') + '"></div>' +
        '<button type="button" class="home-btn admin-mini" data-del-date title="Remove this date">✕</button>' +
        '</div>';
    }).join('');
  }

  // Three fields, one mark. Which one a student actually sees was invisible
  // here: you could clear the icon, set a logo, and still be looking at the
  // old emoji with nothing explaining why. This shows the real answer, live,
  // and says which field produced it.
  function markPreview(prefix){
    return '<div class="admin-markpreview" data-markpreview="' + prefix + '">' +
      '<div class="admin-markpreview-box" id="' + prefix + 'MarkBox"></div>' +
      '<div><div class="admin-markpreview-title">What students will see</div>' +
      '<div class="admin-hint" id="' + prefix + 'MarkWhy" style="margin:0;"></div></div></div>';
  }

  // The order here is the renderer's order (js/04-icons.js), not a guess: an
  // uploaded image wins, then a built-in icon, then the emoji. Keeping the two
  // in step matters — a preview that disagrees with the app is worse than none.
  function refreshMarkPreview(prefix, fields){
    var box = document.getElementById(prefix + 'MarkBox');
    var why = document.getElementById(prefix + 'MarkWhy');
    if(!box || !why) return;
    var img = (document.getElementById(fields.image) || {}).value || '';
    var key = (document.getElementById(fields.key) || {}).value || '';
    var emoji = (document.getElementById(fields.emoji) || {}).value || '';
    var entity = { imageUrl: img, iconKey: key, icon: emoji };
    box.innerHTML = window.AAUP_ICONS.markup(entity, { size: 52 });

    if(img && window.AAUP_ICONS.safeImageUrl(img)){
      why.innerHTML = 'Using the <strong>uploaded image</strong>. It wins over both the icon and the emoji — clear this field to fall back to them.';
    } else if(img){
      why.innerHTML = '⚠️ That image path is not usable (it must start with <code>assets/</code> or <code>https://</code>), so the icon or emoji is being used instead.';
    } else if(key && window.AAUP_ICONS.has(key)){
      why.innerHTML = 'Using the <strong>built-in icon</strong>. Upload an image above to override it; pick <em>none</em> to fall back to the emoji.';
    } else if(emoji){
      why.innerHTML = 'Using the <strong>emoji</strong>, because no image and no icon are set. This is the last fallback and always works.';
    } else {
      why.innerHTML = 'Nothing is set, so a default mark is shown. Any one of the three fields replaces it.';
    }
  }

  // Four unlabelled boxes in a row gave no clue which was which, and the id was
  // the least obvious of them while being the one that must not change: majors
  // reference it, so renaming it orphans them. It is labelled as such and set
  // apart from the display names.
  function collegeRows(list){
    if(!list.length) return '<p class="ex-note">No faculties yet.</p>';
    return list.map(function(c, i){
      return '<div class="admin-faculty" data-college-row="' + i + '">' +
        '<div class="admin-faculty-head">' +
          '<span class="admin-faculty-n">' + (i + 1) + '</span>' +
          '<strong class="admin-faculty-name">' + esc(c.name || c.slug || 'New faculty') + '</strong>' +
          '<button type="button" class="home-btn admin-mini admin-danger" data-del-college="' + i + '">🗑 Remove</button>' +
        '</div>' +
        '<div class="admin-faculty-grid">' +
          '<label>Name (English)<input type="text" class="ac-name" value="' + esc(c.name) + '" placeholder="Faculty of Information Technology"></label>' +
          '<label>Name (Arabic)<input type="text" class="ac-namear" dir="rtl" value="' + esc(c.nameAr || '') + '" placeholder="كلية تكنولوجيا المعلومات"></label>' +
          '<label>Emoji<input type="text" class="ac-icon" value="' + esc(c.icon || '') + '" placeholder="🏫" maxlength="4"></label>' +
          '<label class="admin-faculty-id">ID <span>— referenced by majors; changing it unlinks them</span>' +
          '<input type="text" class="ac-slug" value="' + esc(c.slug) + '" placeholder="aaup-it" spellcheck="false"></label>' +
        '</div></div>';
    }).join('');
  }

  function field(id, label, val){
    return '<div class="form-field"><label for="' + id + '">' + label + '</label>' +
      '<input type="text" id="' + id + '" value="' + esc(val || '') + '"></div>';
  }

  // The icon picker draws the actual built-in set rather than listing key
  // names, because "datascience" and "network" are indistinguishable as words
  // and obvious as pictures.
  function iconPicker(id, current){
    var keys = window.AAUP_ICONS.keys();
    return '<div class="form-field"><label>Icon</label>' +
      '<input type="hidden" id="' + id + '" value="' + esc(current || '') + '">' +
      '<div class="admin-iconpick" data-for="' + id + '">' +
        '<button type="button" class="admin-icontile' + (!current ? ' is-active' : '') + '" data-key="">none</button>' +
        keys.map(function(k){
          return '<button type="button" class="admin-icontile' + (k === current ? ' is-active' : '') +
            '" data-key="' + k + '" title="' + k + '">' + window.AAUP_ICONS.preview(k, 22) + '</button>';
        }).join('') +
      '</div></div>';
  }

  var MARK_FIELDS = {
    au: { image: 'auLogo',  key: 'auIconKey', emoji: 'auIcon' },
    am: { image: 'amImage', key: 'amIconKey', emoji: 'amIcon' }
  };

  function bindMarkPreview(){
    Object.keys(MARK_FIELDS).forEach(function(prefix){
      var fields = MARK_FIELDS[prefix];
      if(!document.getElementById(prefix + 'MarkBox')) return;
      refreshMarkPreview(prefix, fields);
      [fields.image, fields.key, fields.emoji].forEach(function(id){
        var el = document.getElementById(id);
        if(!el) return;
        // 'input' as well as 'change': the preview should follow typing, since
        // the whole point is answering "what did that just do?" immediately.
        el.addEventListener('input', function(){ refreshMarkPreview(prefix, fields); });
        el.addEventListener('change', function(){ refreshMarkPreview(prefix, fields); });
      });
    });
  }

  function bindIconPickers(){
    document.querySelectorAll('.admin-iconpick').forEach(function(pick){
      pick.addEventListener('click', function(e){
        var b = e.target.closest('.admin-icontile');
        if(!b) return;
        var input = document.getElementById(pick.getAttribute('data-for'));
        if(input) input.value = b.getAttribute('data-key');
        pick.querySelectorAll('.admin-icontile').forEach(function(x){ x.classList.remove('is-active'); });
        b.classList.add('is-active');
        markDirty();
        bindMarkPreview();
      });
    });
    bindMarkPreview();
  }

  // A major belongs to a faculty, and until now the browser could not show
  // that. It listed bare slugs in one flat table per university, with a single
  // "+ New major" that belonged to the university rather than to any faculty —
  // so a new major was created with no faculty at all, and the only way to give
  // it one was to type the exact slug into a free-text box from memory. Getting
  // it wrong, or leaving it blank, silently produced a major that no student
  // could ever reach, with nothing anywhere saying so.
  //
  // So the browser is the real hierarchy now: university, then its faculties,
  // then the majors inside each, with the add button on the faculty it will
  // actually add to.
  function sectionMajors(){
    var unis = state.tree || [];
    if(!unis.length) return '<h2>Majors / Plans</h2><p class="admin-hint">No universities yet.</p>';

    var uniSlug = state.browseUni || (unis[0] && unis[0].slug);
    var picker = unis.length > 1
      ? '<div class="form-field"><label for="amUni">University</label><select id="amUni">' +
          unis.map(function(u){
            return '<option value="' + esc(u.slug) + '"' + (u.slug === uniSlug ? ' selected' : '') + '>' +
              esc(u.name) + (u.published ? '' : ' (hidden)') + '</option>';
          }).join('') + '</select></div>'
      : '';

    var head = '<h2>Majors / Plans</h2>' +
      '<p class="admin-hint">Majors are grouped by the faculty they belong to. ' +
      'Add one from inside a faculty and it starts out in that faculty. ' +
      'They are listed here in the order students see them on the home page — ' +
      'set a major\'s <strong>Display order</strong> in its editor to move it.</p>' + picker;

    // Metadata arrives from /api/majors/:uni, which is a separate request from
    // the tree. Say so rather than rendering an empty page that looks broken.
    if(state.browseLoading) return head + '<p class="admin-hint">Loading majors…</p><div id="adminMajorEditor"></div>';
    if(!state.browseMajors) return head + '<p class="admin-hint">Could not load this university\'s majors.</p><div id="adminMajorEditor"></div>';

    var faculties = (state.browseFaculties || []).slice();
    var majors = state.browseMajors || [];
    var known = {};
    faculties.forEach(function(f){ known[f.slug] = true; });

    var groups = faculties.map(function(f){
      return { slug: f.slug, name: f.name, icon: f.icon, iconKey: f.iconKey, imageUrl: f.imageUrl,
               majors: majors.filter(function(m){ return m.college === f.slug; }) };
    });

    // Majors whose faculty is blank or points at a faculty that no longer
    // exists. They were invisible before — listed with everything else and
    // indistinguishable — which is how one gets created and then forgotten.
    var orphans = majors.filter(function(m){ return !m.college || !known[m.college]; });

    var body = groups.map(function(g){ return facultyGroup(uniSlug, g, false); }).join('') +
      (orphans.length
        ? facultyGroup(uniSlug, { slug: '', name: 'Not in any faculty', icon: '⚠️', majors: orphans }, true)
        : '') +
      (groups.length ? '' :
        '<p class="admin-hint">This university has no faculties yet. Add one in ' +
        '<strong>Universities → Edit → Faculties</strong>, then come back here to add majors to it.</p>');

    return head +
      '<div class="form-field"><label for="amFilter">Search</label>' +
      '<input type="text" id="amFilter" placeholder="Filter by name or slug…"></div>' +
      body + '<div id="adminMajorEditor"></div>';
  }

  function facultyGroup(uniSlug, g, isOrphan){
    var mark = isOrphan ? '⚠️' : window.AAUP_ICONS.markup(g, { size: 20, fallback: '🏫' });
    return '<section class="admin-facgroup' + (isOrphan ? ' is-orphan' : '') + '">' +
      '<div class="admin-facgroup-head">' +
        '<span class="admin-facgroup-mark">' + mark + '</span>' +
        '<div><h3>' + esc(g.name) + '</h3>' +
          (isOrphan
            ? '<span class="admin-sub">These are not reachable by students until they are given a faculty.</span>'
            : '<span class="admin-sub">' + esc(g.slug) + ' · ' + g.majors.length +
              ' major' + (g.majors.length === 1 ? '' : 's') + '</span>') +
        '</div>' +
        (isOrphan ? '' :
          '<button type="button" class="home-btn admin-mini admin-addhere" data-new-major="' + esc(uniSlug) +
          '" data-faculty="' + esc(g.slug) + '">+ Add major here</button>') +
      '</div>' +
      (g.majors.length
        ? '<table class="admin-table admin-major-table"><tbody>' + g.majors.map(function(m){
            return '<tr data-major-row="' + esc(m.slug) + '">' +
              '<td><strong>' + esc(m.name || m.slug) + '</strong>' +
                (m.nameAr ? '<br><span class="admin-sub" dir="rtl">' + esc(m.nameAr) + '</span>' : '') +
                '<br><span class="admin-sub">' + esc(m.slug) + ' · ' + (m.courseCount || 0) + ' courses · ' +
                  (m.sortOrder == null ? 'unplaced' : 'order ' + esc(m.sortOrder)) + '</span>' +
                (m.unreadable ? '<br><span class="admin-sub admin-warn">⚠️ this file could not be read</span>' : '') +
              '</td>' +
              '<td style="text-align:right;">' +
              '<button type="button" class="home-btn admin-mini" data-edit-major="' + esc(m.slug) + '" data-uni="' + esc(uniSlug) + '">Edit</button> ' +
              '<button type="button" class="home-btn admin-mini admin-danger" data-del-major="' + esc(m.slug) + '" data-uni="' + esc(uniSlug) + '">Delete</button>' +
              '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="admin-hint admin-facgroup-empty">No majors in this faculty yet.</p>') +
      '</section>';
  }

  function majorEditor(m){
    return '<div class="admin-editor"><h3>' + esc(m.name || m.slug) + '</h3>' +
      '<p class="admin-hint">This major\'s courses, prerequisites and semester layout are edited in the ' +
      '<strong>Courses</strong>, <strong>Prerequisites</strong> and <strong>Study Plan</strong> sections — ' +
      'they are all one file, saved together.</p>' +
      '<div class="form-field-row">' + field('amName', 'Name (English)', m.name) + field('amNameAr', 'Name (Arabic)', m.nameAr) + '</div>' +
      '<div class="form-field-row">' + field('amSub', 'Subtitle', m.subtitle) + field('amSubAr', 'Subtitle (Arabic)', m.subtitleAr) + '</div>' +
      facultyField(m) +
      '<div class="form-field-row">' + field('amIcon', 'Emoji fallback', m.icon) +
      field('amHours', 'Degree credit hours', m.degreeHours == null ? '' : m.degreeHours) + '</div>' +
      '<div class="form-field"><label for="amOrder">Display order ' +
        '<span class="admin-sub">— lower numbers show first on the home page. ' +
        'Leave empty to sit after the numbered ones, alphabetically.</span></label>' +
        '<input type="number" id="amOrder" step="1" value="' +
        esc(m.sortOrder == null ? '' : m.sortOrder) + '" placeholder="unplaced"></div>' +
      iconPicker('amIconKey', m.iconKey) +
      '<div class="form-field"><label for="amImage">Icon image (optional)</label>' +
      '<input type="text" id="amImage" value="' + esc(m.imageUrl || '') + '" placeholder="assets/uploads/…"></div>' +
      markPreview('am') +
      '<div class="form-field"><label for="amBio">Description</label><textarea id="amBio" rows="3">' + esc(m.bio || '') + '</textarea></div>' +
      '<div class="form-field"><label for="amBioAr">Description (Arabic)</label><textarea id="amBioAr" rows="3">' + esc(m.bioAr || '') + '</textarea></div>' +
      saveBar() + '</div>';
  }

  // This was a free-text box labelled "Faculty slug". It required knowing that
  // the Faculty of Information Technology is "aaup-it", and a typo produced a
  // major filed under a faculty that does not exist — which looks exactly like
  // a major that saved fine, right up until nobody can find it.
  //
  // A list cannot be mistyped. The one case a list cannot express is a value
  // already stored that matches no faculty, so that is kept as an option and
  // called out, rather than being silently corrected to something else.
  function facultyField(m){
    var list = state.browseFaculties || [];
    var known = list.some(function(f){ return f.slug === m.college; });
    var stray = m.college && !known;
    return '<div class="form-field"><label for="amCollege">Faculty</label>' +
      '<select id="amCollege">' + facultyOptions(m.college, true) +
        (stray ? '<option value="' + esc(m.college) + '" selected>' + esc(m.college) + ' — not a faculty here</option>' : '') +
      '</select>' +
      (stray
        ? '<p class="admin-hint admin-warn">⚠️ This major is filed under <code>' + esc(m.college) +
          '</code>, which is not one of this university\'s faculties, so students cannot reach it. ' +
          'Pick a real faculty, or add that one in Universities → Edit → Faculties.</p>'
        : (!m.college
            ? '<p class="admin-hint admin-warn">⚠️ No faculty set — students cannot reach this major.</p>'
            : '')) +
      '</div>';
  }

  function saveBar(){
    return '<div class="form-actions admin-savebar">' +
      '<button type="button" class="home-btn admin-primary" id="amSave">💾 Save major</button>' +
      '<span class="admin-hint">Writes a commit and redeploys. Live in about a minute.</span>' +
      '</div><div id="adminMsg"></div>';
  }

  // Courses, Prerequisites and Study Plan are three views of one major, reached
  // from a nav that does not say which major, on top of a university and a
  // faculty chosen two screens earlier. With fifty courses on screen that is
  // very easy to lose — and every one of these screens can write to the file.
  function crumbs(){
    var m = state.major || {};
    var uni = (state.tree || []).filter(function(u){ return u.slug === state.uni; })[0];
    var fac = (state.browseFaculties || []).filter(function(f){ return f.slug === m.college; })[0];
    return '<nav class="admin-crumbs">' +
      '<span>' + esc(uni ? uni.name : (state.uni || '—')) + '</span>' +
      '<span class="admin-crumb-sep">›</span>' +
      '<span' + (fac ? '' : ' class="admin-warn"') + '>' +
        esc(fac ? fac.name : (m.college ? m.college + ' (unknown faculty)' : 'no faculty')) + '</span>' +
      '<span class="admin-crumb-sep">›</span>' +
      '<strong>' + esc(m.name || m.slug || '—') + '</strong>' +
      '</nav>';
  }

  var SEM_LABEL = { s1: 'Semester 1', s2: 'Semester 2', s3: 'Summer', summer: 'Summer' };

  function semKey(c){
    if(c.semester === 'summer') return 's3';
    return c.semester || '';
  }

  // One table of every course in the degree, in file order, was unreadable —
  // and it was also the only place the year/semester columns could be checked,
  // so a course sitting in the wrong term was invisible unless you happened to
  // scan the right row. Grouping by the structure the plan actually has makes
  // a misplaced course obvious, and gives the credit-hour total per term for
  // free. Unscheduled courses get their own group instead of being scattered.
  function sectionCourses(){
    var m = state.major;
    var years = m.years || [];
    var all = m.courses || [];

    var buckets = [];
    years.forEach(function(y){
      ['s1', 's2'].concat(y.hasSummer ? ['s3'] : []).forEach(function(sem){
        buckets.push({
          title: y.id.toUpperCase() + ' · ' + SEM_LABEL[sem],
          term: y.id + '|' + sem,
          rows: all.map(function(c, i){ return { c: c, i: i }; })
                   .filter(function(r){ return r.c.yearId === y.id && semKey(r.c) === sem; })
        });
      });
    });
    var placed = {};
    buckets.forEach(function(b){ b.rows.forEach(function(r){ placed[r.i] = true; }); });
    var loose = all.map(function(c, i){ return { c: c, i: i }; }).filter(function(r){ return !placed[r.i]; });
    if(loose.length){
      buckets.push({ title: 'Not placed in a year or semester', rows: loose, warn: true });
    }

    return '<h2>Courses</h2>' + crumbs() + problemsHtml() +
      '<p class="admin-hint">Grouped by where each course sits in the plan. ' +
      'Add straight into a term with its own button, or change a row\'s Year or Sem ' +
      'and it moves to the matching group immediately. Type straight into the cells; ' +
      'Enter or ↓ goes to the next row, and a changed cell is marked until you save.</p>' +
      '<div class="form-field"><label for="acFilter">Search this plan</label><input type="text" id="acFilter" placeholder="Filter by name or code…"></div>' +
      coursePicker() + pasteToolHtml() + whereUsedHtml() + historyHtml() +
      '<div id="acBody">' + buckets.map(function(b){
        var ch = b.rows.reduce(function(n, r){ return n + (Number(r.c.creditHours) || 0); }, 0);
        return '<section class="admin-termgroup' + (b.warn ? ' is-orphan' : '') + '">' +
          '<div class="admin-termgroup-head">' +
            '<h4>' + (b.warn ? '⚠️ ' : '') + esc(b.title) +
              ' <span class="admin-sub">' + b.rows.length + ' course' + (b.rows.length === 1 ? '' : 's') +
              ' · ' + ch + ' CH</span></h4>' +
            (b.term
              ? '<button type="button" class="home-btn admin-mini" data-add-term="' + esc(b.term) + '">+ Add here</button>'
              : '') +
          '</div>' +
          (b.rows.length
            ? '<table class="admin-table admin-course-table"><thead><tr>' +
              '<th>Code</th><th>Name</th><th>Arabic</th><th>CH</th><th>Category</th><th>Year</th><th>Sem</th><th></th>' +
              '</tr></thead><tbody>' +
              b.rows.map(function(r){ return courseRow(r.c, r.i, years); }).join('') +
              '</tbody></table>'
            : '<p class="admin-hint admin-facgroup-empty">Empty.</p>') +
          '</section>';
      }).join('') + '</div>' +
      '<div class="form-actions"><button type="button" class="home-btn admin-mini" id="acAdd">+ Add course (unscheduled)</button></div>' +
      // One shared set of lists for every row. Per-row copies would put five
      // hundred options in the DOM once per course.
      '<datalist id="acCodeList"></datalist>' +
      '<datalist id="acNameList"></datalist>' +
      '<datalist id="acArList"></datalist>' +
      saveBar();
  }

  // Adding "Arabic Language" to a new major meant retyping its code, its
  // English name, its Arabic name, its credit hours and its category — for a
  // course that is already written down in another plan, identically. 112 of
  // AAUP's courses appear in more than one plan, so this is the common case,
  // not the rare one, and every retyping is a chance to disagree with the
  // course the students already have.
  //
  // The pool is read from plans.json, which the app already ships and caches:
  // the same catalogue the search on the study plans searches. It lags data/ by
  // about a minute after an edit, which does not matter for what this is — a
  // source of course definitions to copy, not a source of truth.
  function coursePicker(){
    var years = (state.major || {}).years || [];
    var termOpts = years.map(function(y){
      return ['s1', 's2'].concat(y.hasSummer ? ['s3'] : []).map(function(s){
        return '<option value="' + esc(y.id + '|' + s) + '">' + esc(y.id.toUpperCase()) + ' · ' + SEM_LABEL[s] + '</option>';
      }).join('');
    }).join('');
    return '<details class="admin-picker" id="acPicker">' +
      '<summary>🔍 Add a course that already exists</summary>' +
      '<div class="admin-picker-body">' +
        '<p class="admin-hint">Search every course in this university\'s published plans. ' +
        'Picking one copies its code, names, credit hours and category into this plan — ' +
        'it does not link the two, so editing it here does not change any other major.</p>' +
        '<div class="admin-row">' +
          '<input type="text" id="acPickQuery" placeholder="Course name, Arabic name, or code…">' +
          '<select id="acPickTerm">' + (termOpts || '<option value="">unscheduled</option>') + '</select>' +
        '</div>' +
        '<div id="acPickResults" class="admin-picker-results"></div>' +
      '</div></details>';
  }

  var CATS = [['skills', 'Skills'], ['core', 'Core'], ['math', 'Math'], ['dept', 'Department'],
              ['eng', 'English'], ['uni', 'University'], ['free', 'Free elective']];

  // Offering Summer for a year that has none produced a course filed in a term
  // that does not exist, which then vanished into "not placed" with no clue why.
  function semestersFor(years, yearId){
    var y = (years || []).filter(function(x){ return x.id === yearId; })[0];
    return y && y.hasSummer ? ['s1', 's2', 's3'] : ['s1', 's2'];
  }

  function courseRow(c, i, years){
    return '<tr data-course="' + i + '">' +
      // Code, name and Arabic name each offer the courses that already exist,
      // the same way Category, Year and Sem offer their choices. Picking one
      // fills the rest of the row, so a course that is already written down
      // somewhere is never typed out a second time.
      '<td><input type="text" class="cc-num" list="acCodeList" autocomplete="off" value="' + esc(c.courseNumber || '') + '"></td>' +
      '<td><input type="text" class="cc-name" list="acNameList" autocomplete="off" value="' + esc(c.name || '') + '"></td>' +
      '<td><input type="text" class="cc-namear" list="acArList" autocomplete="off" value="' + esc(c.nameAr || '') + '" dir="rtl"></td>' +
      '<td><input type="number" class="cc-ch" min="0" max="20" step="1" value="' + esc(c.creditHours) + '"></td>' +
      '<td><select class="cc-cat">' + CATS.map(function(k){
        return '<option value="' + k[0] + '"' + (c.category === k[0] ? ' selected' : '') + '>' + k[1] + '</option>';
      }).join('') + '</select></td>' +
      // "Unscheduled" is a real state — a course can exist in the file with no
      // year — and leaving it out of the list meant the dropdown silently
      // disagreed with the row it was describing.
      '<td><select class="cc-year">' +
        '<option value=""' + (!c.yearId ? ' selected' : '') + '>—</option>' +
        years.map(function(y){
          return '<option value="' + esc(y.id) + '"' + (c.yearId === y.id ? ' selected' : '') + '>' + esc(y.id).toUpperCase() + '</option>';
        }).join('') + '</select></td>' +
      '<td><select class="cc-sem">' +
        '<option value=""' + (!semKey(c) ? ' selected' : '') + '>—</option>' +
        semestersFor(years, c.yearId).map(function(s){
          return '<option value="' + s + '"' + (semKey(c) === s ? ' selected' : '') + '>' +
            (s === 's3' ? 'Summer' : s.toUpperCase()) + '</option>';
        }).join('') + '</select></td>' +
      '<td><button type="button" class="home-btn admin-mini admin-danger" data-del-course="' + i + '">✕</button></td></tr>';
  }

  function sectionPrereqs(){
    var m = state.major;
    var courses = m.courses || [];
    // Fifty courses in one flat dropdown, in file order, meant scrolling for a
    // name you already knew the position of in the plan. Grouped by term, the
    // list matches how the courses are actually thought about.
    var byTerm = {};
    courses.forEach(function(c){
      var k = (c.yearId || '—') + '|' + (semKey(c) || '—');
      (byTerm[k] = byTerm[k] || []).push(c);
    });
    var opts = Object.keys(byTerm).sort().map(function(k){
      var parts = k.split('|');
      var label = parts[0].toUpperCase() + ' · ' + (SEM_LABEL[parts[1]] || 'Unscheduled');
      return '<optgroup label="' + esc(label) + '">' + byTerm[k].map(function(c){
        return '<option value="' + esc(c.id) + '">' +
          esc((c.courseNumber ? c.courseNumber + ' · ' : '') + c.name) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');

    return '<h2>Prerequisites</h2>' + crumbs() + problemsHtml() +
      '<p class="admin-hint">Each row is “must pass <strong>before</strong> → can then take <strong>after</strong>”. ' +
      'The server rejects a loop, so a plan can never be saved in a state where a course is impossible to reach.</p>' +
      '<table class="admin-table"><thead><tr><th>Before</th><th>After</th><th></th></tr></thead><tbody id="apBody">' +
      (m.prerequisites || []).map(function(p, i){
        return '<tr data-pr="' + i + '"><td>' + nameOf(p[0]) + '</td><td>' + nameOf(p[1]) + '</td>' +
          '<td><button type="button" class="home-btn admin-mini admin-danger" data-del-pr="' + i + '">✕</button></td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="admin-row"><select id="apBefore">' + opts + '</select>' +
      '<span>→</span><select id="apAfter">' + opts + '</select>' +
      '<button type="button" class="home-btn admin-mini" id="apAdd">+ Add</button></div>' +
      saveBar();
  }

  function nameOf(id){
    var c = (state.major.courses || []).filter(function(x){ return x.id === id; })[0];
    return esc(c ? ((c.courseNumber ? c.courseNumber + ' · ' : '') + c.name) : id);
  }

  function sectionSchedule(){
    var m = state.major;
    var years = m.years || [];
    return '<h2>Study Plan</h2>' + crumbs() + problemsHtml() +
      '<p class="admin-hint">Move a course to a different year or semester, or change the year layout. ' +
      'Same file as Courses — one Save covers both.</p>' +
      '<h4>Years</h4><div id="asYears">' + years.map(function(y, i){
        return '<div class="admin-row"><input type="text" class="ay-id" value="' + esc(y.id) + '" style="max-width:80px;">' +
          '<label class="admin-check"><input type="checkbox" class="ay-summer"' + (y.hasSummer ? ' checked' : '') + '> has summer</label>' +
          '<button type="button" class="home-btn admin-mini admin-danger" data-del-year="' + i + '">✕</button></div>';
      }).join('') + '</div>' +
      '<div class="form-actions"><button type="button" class="home-btn admin-mini" id="asAddYear">+ Add year</button></div>' +
      years.map(function(y){
        return ['s1', 's2'].concat(y.hasSummer ? ['s3'] : []).map(function(sem){
          var list = (m.courses || []).filter(function(c){
            return c.yearId === y.id && (c.semester === sem || (sem === 's3' && c.semester === 'summer'));
          });
          return '<h4>' + esc(y.id) + ' · ' + (sem === 's3' ? 'Summer' : sem.toUpperCase()) +
            ' <span class="admin-sub">' + list.reduce(function(n, c){ return n + (Number(c.creditHours) || 0); }, 0) + ' CH</span></h4>' +
            '<ul class="admin-semlist">' + (list.map(function(c){
              var idx = m.courses.indexOf(c);
              return '<li><span>' + esc(c.name) + '</span>' + moveSelect(idx, y.id, sem, years) + '</li>';
            }).join('') || '<li class="ex-note">Empty</li>') + '</ul>';
        }).join('');
      }).join('') +
      saveBar();
  }

  function moveSelect(idx, curYear, curSem, years){
    var opts = '';
    years.forEach(function(y){
      ['s1', 's2'].concat(y.hasSummer ? ['s3'] : []).forEach(function(sem){
        var sel = (y.id === curYear && sem === curSem) ? ' selected' : '';
        opts += '<option value="' + esc(y.id) + '|' + sem + '"' + sel + '>' +
          esc(y.id) + ' · ' + (sem === 's3' ? 'Summer' : sem.toUpperCase()) + '</option>';
      });
    });
    return '<select class="admin-move" data-move="' + idx + '">' + opts + '</select>';
  }

  function sectionAssets(){
    return '<h2>Assets</h2>' +
      '<p class="admin-hint">Uploads are committed into <code>web/assets/uploads/</code>, so they deploy with the ' +
      'app and keep working offline. PNG, JPEG, WebP or SVG, up to 512 KB.</p>' +
      '<div class="form-field"><label for="aaFile">Upload an image</label><input type="file" id="aaFile" accept="image/png,image/jpeg,image/webp,image/svg+xml"></div>' +
      '<div id="aaPreview"></div>' +
      '<div class="form-actions"><button type="button" class="home-btn admin-primary" id="aaUpload" disabled>Upload</button></div>' +
      '<div id="adminMsg"></div>' +
      '<h3>Uploaded</h3>' +
      (state.assets.length
        ? '<div class="admin-assets">' + state.assets.map(function(a){
            return '<div class="admin-asset"><img src="' + esc(base() ? a.url : a.url) + '" alt="" loading="lazy">' +
              '<code>' + esc(a.url) + '</code>' +
              '<div><button type="button" class="home-btn admin-mini" data-copy-asset="' + esc(a.url) + '">Copy path</button> ' +
              '<button type="button" class="home-btn admin-mini admin-danger" data-del-asset="' + esc(a.filename) + '">Delete</button></div></div>';
          }).join('') + '</div>'
        : '<p class="ex-note">Nothing uploaded yet.</p>');
  }

  // ---------- Contributions (js/73-contribute.js / workers/contributions-worker.js) ----------
  //
  // A separate Worker from everything else this panel talks to, on purpose
  // — same reasoning as Thoughts having its own. A reply here does not
  // write to the repo; it is a message back to the student. Actually
  // incorporating what they sent still happens by hand, in Majors/Courses,
  // same as any other edit.

  function contribUrl(){ return (window.APP_CONTRIB_URL || '').replace(/\/+$/, ''); }

  // THE SECRET IS NOT SHIPPED WITH THE APP, and this is the reason why.
  //
  // It used to be APP_CONTRIB_SECRET in js/01-catalogue.js — a file any
  // visitor can fetch from the published site. The one credential that lists
  // every student's submission, replies in the maintainer's name and deletes
  // anything was therefore public for as long as it sat there; reading it
  // took no attack, only View Source.
  //
  // So it is typed in here instead, and kept beside the admin token on the
  // same terms: sessionStorage, this tab only, gone when the tab closes.
  // That trades a permanent public credential for one prompt per session.
  var CONTRIB_SECRET_KEY = 'aaup_contribSecret';
  function contribSecret(){
    try{ return sessionStorage.getItem(CONTRIB_SECRET_KEY) || ''; }catch(e){ return ''; }
  }
  function setContribSecret(v){
    try{
      if(v) sessionStorage.setItem(CONTRIB_SECRET_KEY, v);
      else sessionStorage.removeItem(CONTRIB_SECRET_KEY);
    }catch(e){}
  }
  function contribHeaders(){
    var h = { 'Content-Type': 'application/json' };
    var s = contribSecret();
    if(s) h['X-Admin-Secret'] = s;
    return h;
  }

  // A refused secret is the one failure worth handling apart from the rest:
  // it means what is stored is wrong, so it is dropped and the panel asks
  // again rather than retrying a call that cannot ever succeed.
  function contribRes(r){
    if(r.status === 401 || r.status === 403){
      setContribSecret('');
      state.contribItems = null;
      throw new Error('That secret was not accepted — enter it again.');
    }
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function loadContributions(){
    if(!contribUrl() || !contribSecret()) return;
    state.contribLoading = true;
    fetch(contribUrl() + '/contributions', { headers: contribHeaders() })
      .then(contribRes)
      .then(function(data){
        state.contribItems = (data && Array.isArray(data.contributions)) ? data.contributions : [];
      })
      .catch(function(e){
        // Left null when the secret was refused, so the panel returns to the
        // prompt instead of an empty list that reads as "nothing sent in".
        if(contribSecret()) state.contribItems = [];
        toast(e && e.message ? e.message : 'Could not load contributions.');
      })
      .then(function(){ state.contribLoading = false; render(); });
  }

  function sectionContributions(){
    if(!contribUrl()){
      return '<h2>📮 Contributions</h2>' +
        '<div class="admin-note">APP_CONTRIB_URL is not set in web/js/01-catalogue.js — deploy ' +
        '<code>workers/contributions-worker.js</code> and put its URL there to see what students send in ' +
        'while helping build "coming soon" majors.</div>';
    }
    if(!contribSecret()){
      return '<h2>📮 Contributions</h2>' +
        '<div class="admin-note">Listing every submission — and replying to or deleting one — needs the ' +
        'Contributions Worker\'s <code>ADMIN_SECRET</code>. It is deliberately not shipped with the app, so it ' +
        'is typed once per session and kept in this tab only.</div>' +
        '<div class="form-field"><label for="contribSecretInput">ADMIN_SECRET</label>' +
        '<input type="password" id="contribSecretInput" autocomplete="off" spellcheck="false"></div>' +
        '<div class="form-actions"><button type="button" class="home-btn admin-primary" id="contribUnlock">Unlock</button></div>';
    }
    if(state.contribLoading || !state.contribItems){
      return '<h2>📮 Contributions</h2><p class="ex-note">Loading…</p>';
    }
    if(!state.contribItems.length){
      return '<h2>📮 Contributions</h2>' +
        '<div class="form-actions"><button type="button" class="home-btn" id="contribReload">🔄 Refresh</button> ' +
        '<button type="button" class="home-btn admin-mini" id="contribForget">Forget secret</button></div>' +
        '<p class="ex-note">Nothing sent in yet.</p>';
    }
    return '<h2>📮 Contributions</h2>' +
      '<div class="form-actions"><button type="button" class="home-btn" id="contribReload">🔄 Refresh</button> ' +
      '<button type="button" class="home-btn admin-mini" id="contribForget">Forget secret</button></div>' +
      state.contribItems.map(function(c){
        // Two kinds arrive on this endpoint. A plan contribution is a course
        // list to merge; a prerequisite report (js/86-prereq-report.js) is a
        // single claim to check against the published document. They need
        // different summaries — counting "0 course(s)" on a report told you
        // nothing about what it said.
        var isReport = c.kind === 'prereq-report';
        var r = c.report || {};
        var summary = isReport
          ? '<strong>Wrong prerequisite</strong> on ' + esc(courseRefTx(r.course)) +
            ' — reported: ' + esc(r.wrongPrereq ? courseRefTx(r.wrongPrereq) : 'not one of the listed ones')
          : '<strong>' + esc(c.majorName || c.prefix) + '</strong> (' + esc(c.prefix) + ') — ' +
            esc((c.courses || []).length) + ' course(s), ' +
            esc((c.prerequisites || []).length) + ' prerequisite line(s)';
        var detail = isReport
          ? { plan: c.prefix, majorName: c.majorName, course: r.course,
              reportedWrong: r.wrongPrereq, appListsAsPrereqs: r.listedPrereqs, note: r.note }
          : { courses: c.courses, prerequisites: c.prerequisites, structure: c.structure };
        return '<div class="admin-note" data-contrib-id="' + esc(c.id) + '">' +
          summary +
          (c.contributorName ? ' — from ' + esc(c.contributorName) : '') +
          '<br><span style="opacity:.7;">' + esc(new Date(c.submittedAt).toLocaleString()) + ' · status: ' + esc(c.status) + '</span>' +
          (c.adminReply ? '<div class="admin-note" style="margin-top:8px;"><strong>Your reply:</strong> ' + esc(c.adminReply) + '</div>' : '') +
          '<pre class="admin-contrib-json">' + esc(JSON.stringify(detail, null, 2)) + '</pre>' +
          '<div class="form-field"><label>Reply' + (c.adminReply ? ' (replacing the one above)' : '') + '</label>' +
          '<textarea data-contrib-reply rows="2" placeholder="Thanks — added! or: can you double check X\'s credit hours?"></textarea></div>' +
          '<div class="form-actions">' +
          '<button type="button" class="home-btn admin-primary" data-contrib-send="' + esc(c.id) + '">Send reply</button> ' +
          '<button type="button" class="home-btn admin-danger" data-contrib-dismiss="' + esc(c.id) + '">🗑 Delete</button>' +
          '</div></div>';
      }).join('');
  }

  // "Machine Learning [0303221]" — one line for a course reference inside a
  // prerequisite report, so the summary reads without opening the JSON.
  function courseRefTx(c){
    if(!c) return '(missing)';
    return (c.name || c.id || '?') + (c.num ? ' [' + c.num + ']' : '');
  }

  function bindContributions(main){
    var unlock = document.getElementById('contribUnlock');
    if(unlock){
      var input = document.getElementById('contribSecretInput');
      var accept = function(){
        var v = input ? input.value.trim() : '';
        if(!v) return;
        setContribSecret(v);
        state.contribItems = null;   // forces the load the render below starts
        render();
      };
      unlock.addEventListener('click', accept);
      // Enter is what anyone pasting a secret into a single field expects.
      if(input) input.addEventListener('keydown', function(e){ if(e.key === 'Enter') accept(); });
    }
    var forget = document.getElementById('contribForget');
    if(forget) forget.addEventListener('click', function(){
      setContribSecret('');
      state.contribItems = null;
      render();
    });
    var reload = document.getElementById('contribReload');
    if(reload) reload.addEventListener('click', loadContributions);
    main.querySelectorAll('[data-contrib-send]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-contrib-send');
        var card = btn.closest('[data-contrib-id]');
        var ta = card ? card.querySelector('[data-contrib-reply]') : null;
        var message = ta ? ta.value.trim() : '';
        if(!message) return;
        fetch(contribUrl() + '/contributions/' + encodeURIComponent(id) + '/reply', {
          method: 'POST', headers: contribHeaders(),
          body: JSON.stringify({ message: message, status: 'replied' })
        }).then(contribRes)
          .then(function(){ toast('Reply sent.'); return loadContributions(); })
          .catch(function(e){
            toast('Could not send the reply: ' + e.message);
            if(!contribSecret()) render();
          });
      });
    });
    main.querySelectorAll('[data-contrib-dismiss]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-contrib-dismiss');
        if(!confirm('Delete this contribution permanently? Use this for junk or duplicates only — it also removes any reply from what the student can see, so send a reply first for anything real.')) return;
        fetch(contribUrl() + '/contributions/' + encodeURIComponent(id), { method: 'DELETE', headers: contribHeaders() })
          .then(contribRes)
          .then(function(){ toast('Dismissed.'); return loadContributions(); })
          .catch(function(e){
            toast('Could not dismiss it: ' + e.message);
            if(!contribSecret()) render();
          });
      });
    });
  }

  // ---------- Student Thoughts (js/59-thoughts.js / workers/thoughts-worker.js) ----------
  //
  // Every major's wall in one list, newest first, with Delete on each post.
  // Posts go live the moment they are sent (no approval step); this is where
  // the maintainer finds one and takes it down. The thoughts Worker has its
  // own ADMIN_SECRET, typed here once per session like the Contributions one
  // and never shipped with the app.
  function thoughtsUrl(){
    var stored = '';
    try{ stored = localStorage.getItem('aaup_thoughtsUrl') || ''; }catch(e){}
    return (stored || window.APP_THOUGHTS_URL || '').replace(/\/+$/, '');
  }
  var THOUGHTS_SECRET_KEY = 'aaup_thoughtsSecret';
  function thoughtsSecret(){
    try{ return sessionStorage.getItem(THOUGHTS_SECRET_KEY) || ''; }catch(e){ return ''; }
  }
  function setThoughtsSecret(v){
    try{
      if(v) sessionStorage.setItem(THOUGHTS_SECRET_KEY, v);
      else sessionStorage.removeItem(THOUGHTS_SECRET_KEY);
    }catch(e){}
  }
  function thoughtsHeaders(){
    return { 'Content-Type': 'application/json', 'X-Admin-Secret': thoughtsSecret() };
  }
  function thoughtsRes(r){
    if(r.status === 401 || r.status === 403){
      setThoughtsSecret('');
      state.thoughtItems = null;
      throw new Error('That secret was not accepted — enter it again.');
    }
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function loadThoughts(){
    if(!thoughtsUrl() || !thoughtsSecret()) return;
    state.thoughtsLoading = true;
    fetch(thoughtsUrl() + '/thoughts/all', { headers: thoughtsHeaders() })
      .then(thoughtsRes)
      .then(function(data){ state.thoughtItems = (data && Array.isArray(data.thoughts)) ? data.thoughts : []; })
      .catch(function(e){
        if(thoughtsSecret()) state.thoughtItems = [];
        toast(e && e.message ? e.message : 'Could not load thoughts.');
      })
      .then(function(){ state.thoughtsLoading = false; render(); });
  }
  function majorLabel(prefix){
    var plans = (window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans) ? window.AAUP_IMPORTED.loadImportedPlans() : {};
    var p = plans[prefix];
    var np = window.AAUP_IMPORTED && window.AAUP_IMPORTED.nameParts;
    var en = p && p.majorName && p.majorName.en;
    return (en && (np ? np(en).big : en)) || prefix;
  }
  // Thoughts a dean or professor reported from the staff page (round 10,
  // idea 14). Staff can't delete anything; the admin takes it down here, or
  // keeps it. The list lives in the admin Worker (/api/admin/reports).
  function loadReports(){
    if(staffMode) return;
    state.reportsLoading = true;
    api('GET', '/api/admin/reports').then(function(d){ state.reports = d.reports || []; })
      .catch(function(){ state.reports = []; })
      .then(function(){ state.reportsLoading = false; render(); });
  }
  function reportsHtml(){
    if(!state.reports){ if(!state.reportsLoading) setTimeout(loadReports, 0); return ''; }
    if(!state.reports.length) return '';
    return '<h3>🚩 Reported by staff · ' + state.reports.length + '</h3>' +
      '<p class="admin-hint">A dean or professor thought these shouldn\'t stay up. Only you can take one down.' +
        (thoughtsSecret() ? '' : ' Taking one down needs the thoughts Worker\'s secret, entered below.') + '</p>' +
      state.reports.map(function(r){
        return '<div class="admin-note admin-note-warn">' +
          '<div>“' + esc(r.text) + '”</div>' +
          '<span style="opacity:.75;">' + esc([r.courseName, r.plan ? majorLabel(r.plan) : '', 'reported by ' + r.byName, new Date(r.at * 1000).toLocaleString()].filter(Boolean).join(' · ')) + '</span>' +
          '<div class="form-actions"><button type="button" class="home-btn admin-danger" data-report-down="' + esc(r.thought) + '">Take it down</button> ' +
            '<button type="button" class="home-btn" data-report-keep="' + esc(r.thought) + '">Keep it</button></div>' +
        '</div>';
      }).join('') + '<h3>Every thought</h3>';
  }
  function bindReports(main){
    var close = function(id, status){
      return api('POST', '/api/admin/reports/' + encodeURIComponent(id), { status: status }).then(function(){
        toast(status === 'removed' ? 'Taken down.' : 'Kept. The report is closed.');
        state.reports = null; loadReports();
      });
    };
    main.querySelectorAll('[data-report-keep]').forEach(function(b){
      b.addEventListener('click', function(){ close(b.getAttribute('data-report-keep'), 'kept').catch(function(e){ toast(e.message); }); });
    });
    main.querySelectorAll('[data-report-down]').forEach(function(b){
      b.addEventListener('click', function(){
        var id = b.getAttribute('data-report-down');
        if(!thoughtsSecret()){ toast('Enter the thoughts Worker\'s ADMIN_SECRET below first.'); var i = document.getElementById('thoughtsSecretInput'); if(i) i.focus(); return; }
        if(!confirm('Take this thought down for everyone? This cannot be undone.')) return;
        fetch(thoughtsUrl() + '/thoughts/' + encodeURIComponent(id), { method: 'DELETE', headers: thoughtsHeaders(), body: JSON.stringify({}) })
          .then(thoughtsRes)
          .then(function(){ return close(id, 'removed'); })
          .then(function(){ if(thoughtsSecret()) loadThoughts(); })
          .catch(function(e){ toast('Could not take it down: ' + e.message); if(!thoughtsSecret()) render(); });
      });
    });
  }
  function sectionThoughts(){
    var head = '<h2>💬 Student Thoughts</h2>';
    return head + reportsHtml() + sectionThoughtsWall().replace(head, '');
  }
  function sectionThoughtsWall(){
    var head = '<h2>💬 Student Thoughts</h2>';
    if(!thoughtsUrl()){
      return head + '<div class="admin-note">APP_THOUGHTS_URL is not set in web/js/01-catalogue.js, so thoughts only live on each student\'s own phone.</div>';
    }
    if(!thoughtsSecret()){
      return head +
        '<div class="admin-note">Thoughts go live as soon as a student sends them. This list shows <strong>every major\'s wall</strong> ' +
        'in one place, newest first, so you can find a post and delete it. It needs the thoughts Worker\'s ' +
        '<code>ADMIN_SECRET</code> (set it under the Worker\'s Settings → Variables and Secrets). It is typed once per session and kept in this tab only.</div>' +
        '<div class="form-field"><label for="thoughtsSecretInput">ADMIN_SECRET</label>' +
        '<input type="password" id="thoughtsSecretInput" autocomplete="off" spellcheck="false"></div>' +
        '<div class="form-actions"><button type="button" class="home-btn admin-primary" id="thoughtsUnlock">Unlock</button></div>';
    }
    if(state.thoughtsLoading || !state.thoughtItems) return head + '<p class="ex-note">Loading…</p>';
    var tools = '<div class="form-actions"><button type="button" class="home-btn" id="thoughtsReload">🔄 Refresh</button> ' +
      '<button type="button" class="home-btn admin-mini" id="thoughtsForget">Forget secret</button></div>';
    if(!state.thoughtItems.length) return head + tools + '<p class="ex-note">No thoughts on any wall yet.</p>';
    return head + tools +
      '<p class="ex-note">' + state.thoughtItems.length + ' thought' + (state.thoughtItems.length === 1 ? '' : 's') + ' across every major.</p>' +
      state.thoughtItems.map(function(t){
        return '<div class="admin-note" data-thought-id="' + esc(t.id) + '">' +
          '<div>' + esc(t.text) + '</div>' +
          '<span style="opacity:.7;">' + esc(majorLabel(t.plan)) +
            (t.courseName ? ' · ' + esc(t.courseName) : '') +
            ' · ' + esc(t.name || 'Anonymous') +
            ' · ' + esc(new Date(t.at).toLocaleString()) +
            (t.up || t.down ? ' · ▲' + esc(t.up || 0) + ' ▼' + esc(t.down || 0) : '') + '</span>' +
          '<div class="form-actions"><button type="button" class="home-btn admin-danger" data-thought-del="' + esc(t.id) + '">🗑 Delete</button></div>' +
          '</div>';
      }).join('');
  }
  function bindThoughts(main){
    bindReports(main);
    var unlock = document.getElementById('thoughtsUnlock');
    if(unlock){
      var input = document.getElementById('thoughtsSecretInput');
      var accept = function(){
        var v = input ? input.value.trim() : '';
        if(!v) return;
        setThoughtsSecret(v);
        state.thoughtItems = null;
        render();
      };
      unlock.addEventListener('click', accept);
      if(input) input.addEventListener('keydown', function(e){ if(e.key === 'Enter') accept(); });
    }
    on('thoughtsForget', 'click', function(){ setThoughtsSecret(''); state.thoughtItems = null; render(); });
    on('thoughtsReload', 'click', loadThoughts);
    main.querySelectorAll('[data-thought-del]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-thought-del');
        if(!confirm('Delete this thought for everyone? This cannot be undone.')) return;
        fetch(thoughtsUrl() + '/thoughts/' + encodeURIComponent(id), {
          method: 'DELETE', headers: thoughtsHeaders(), body: JSON.stringify({})
        }).then(thoughtsRes)
          .then(function(){ toast('Deleted.'); return loadThoughts(); })
          .catch(function(e){
            toast('Could not delete it: ' + e.message);
            if(!thoughtsSecret()) render();
          });
      });
    });
  }

  // ---------- Student accounts (cloud/cloudflare-worker.js) ----------
  //
  // For a student who forgot their password and has no recovery code and no
  // signed-in phone: find the account, give it a temporary password, tell
  // them. Needs the cloud Worker's own ADMIN_SECRET, typed once per session.
  function cloudUrl(){ return (window.APP_CLOUD_URL || '').replace(/\/+$/, ''); }
  var CLOUD_SECRET_KEY = 'aaup_cloudAdminSecret';
  function cloudSecret(){ try{ return sessionStorage.getItem(CLOUD_SECRET_KEY) || ''; }catch(e){ return ''; } }
  function setCloudSecret(v){ try{ if(v) sessionStorage.setItem(CLOUD_SECRET_KEY, v); else sessionStorage.removeItem(CLOUD_SECRET_KEY); }catch(e){} }
  function cloudCall(path, opts){
    opts = opts || {};
    return fetch(cloudUrl() + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': cloudSecret() },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function(r){
      if(r.status === 403){ setCloudSecret(''); throw new Error('That secret was not accepted — enter it again.'); }
      return r.json().catch(function(){ return {}; }).then(function(d){
        if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        return d;
      });
    });
  }
  // ---------- Staff logins (round 10) ----------
  // Deans and professors who sign in on the staff page (#staff). A login is a
  // role, a university and college, and for a professor the courses it covers.
  // It has no password until the person opens the setup link made here and
  // chooses one. The pickers and the link come from js/110-staff-room.js.
  function loadStaff(){
    state.staffLoading = true;
    api('GET', '/api/admin/staff').then(function(d){ state.staffItems = d.staff || []; state.staffErr = ''; })
      .catch(function(e){ state.staffErr = e.message; })
      .then(function(){ state.staffLoading = false; render(); });
  }
  function staffDraftFrom(s){
    var c = (s && s.card) || {};
    return s ? { id: s.id, name: s.name, username: s.username, role: s.role, uni: s.uni, college: s.college, courses: (s.courses || []).slice(), email: c.email || '', phone: c.phone || '', phoneShown: !!c.phoneShown }
             : { id: '', name: '', username: '', role: 'professor', uni: 'aaup', college: '', courses: [], email: '', phone: '', phoneShown: false };
  }
  function staffFormHtml(d){
    var R = window.AAUP_STAFF_ROOM;
    var chosen = d.college === '*' ? ['*'] : R.collegeIds(d.college);
    var left = R.colleges(d.uni).filter(function(c){ return chosen.indexOf(c.id) === -1; });
    return '<div class="as-form" id="asForm">' +
      '<h3>' + (d.id ? 'Change ' + esc(d.name || d.username) : 'New staff login') + '</h3>' +
      '<div class="as-grid">' +
        '<label class="sr-f"><span>Name (what you and their dean see)</span><input class="sr-in" id="asName" maxlength="80" placeholder="Dr. …" value="' + esc(d.name) + '"></label>' +
        '<label class="sr-f"><span>Username (what they sign in with)</span><input class="sr-in" id="asUser" maxlength="32" autocapitalize="off" spellcheck="false" placeholder="dean.ai" value="' + esc(d.username) + '"' + (d.id ? ' disabled' : '') + '></label>' +
        '<label class="sr-f"><span>Role</span><select class="sr-in" id="asRole">' +
          '<option value="dean"' + (d.role === 'dean' ? ' selected' : '') + '>Dean: their colleges, and gives professors logins</option>' +
          '<option value="professor"' + (d.role === 'professor' ? ' selected' : '') + '>Professor: their own courses</option></select></label>' +
        '<label class="sr-f"><span>University</span><select class="sr-in" id="asUni">' + R.universities().map(function(u){
          return '<option value="' + esc(u.id) + '"' + (u.id === d.uni ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('') + '</select></label>' +
        '<label class="sr-f"><span>Email (students see it in Find a Professor)</span><input class="sr-in" id="asEmail" type="email" maxlength="200" value="' + esc(d.email || '') + '"></label>' +
        '<label class="sr-f"><span>Phone (hidden until allowed)</span><input class="sr-in" id="asPhone" type="tel" maxlength="24" value="' + esc(d.phone || '') + '"></label>' +
      '</div>' +
      '<label class="sr-check"><input type="checkbox" id="asPhoneOk"' + (d.phoneShown ? ' checked' : '') + '> Show the phone to students</label>' +
      '<div class="sr-f"><span>' + (d.role === 'dean' ? 'Colleges they lead' : 'Colleges they teach in') + '</span>' +
        '<div class="sr-chips as-cols">' + chosen.map(function(id){
          return '<span class="sr-chip">' + esc(id === '*' ? 'All colleges' : R.collegeName(id)) +
            '<button type="button" data-as-uncol="' + esc(id) + '" aria-label="Remove">×</button></span>'; }).join('') + '</div>' +
        (chosen[0] === '*' ? '' :
          '<div class="as-add"><select class="sr-in" id="asColPick"><option value="*">All colleges</option>' + left.map(function(c){
            return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
          '<button type="button" class="home-btn" id="asColAdd">+ Add</button></div>') +
      '</div>' +
      (d.role === 'professor'
        ? '<div class="sr-f"><span>Their courses</span>' + R.pickerHtml(d.uni, d.college, d.courses) + '</div>'
        : '') +
      '<div class="form-actions" style="justify-content:flex-start;"><button type="button" class="home-btn admin-primary" id="asSave">' + (d.id ? 'Save' : 'Make the login') + '</button> ' +
        '<button type="button" class="home-btn" id="asCancel">Cancel</button></div></div>';
  }
  function sectionStaff(){
    var R = window.AAUP_STAFF_ROOM;
    var head = '<h2>🎓 Staff logins</h2>' +
      '<p class="admin-hint">Deans and professors who sign in on the staff page. You choose what each login covers; they choose their own password from the link you send them. A dean can also give logins to professors in their own college.</p>';
    if(!R) return head + '<div class="admin-note admin-note-warn">The staff module did not load. Reload the page.</div>';
    if(state.staffErr) return head + '<div class="admin-note admin-note-warn">' + esc(state.staffErr) + '</div>' +
      '<div class="form-actions"><button type="button" class="home-btn" id="asRetry">Try again</button></div>';
    if(!state.staffItems) return head + '<p class="admin-hint">Loading…</p>';
    var list = state.staffItems;
    var covers = function(s){
      var where = R.uniName(s.uni) + ' · ' + R.collegeLabel(s.college);
      if(s.role === 'dean') return esc(where);
      var names = R.courseNames(s.courses, s.uni);
      return esc(where) + '<br><span class="admin-sub">' + esc(names.length ? names.join(', ') : 'No courses yet') + '</span>';
    };
    return head +
      (state.staffLink && !state.staffLink.id ? R.linkBoxHtml(state.staffLink.who, state.staffLink.link) : '') +
      (state.staffDraft ? staffFormHtml(state.staffDraft)
        : '<div class="form-actions" style="justify-content:flex-start;"><button type="button" class="home-btn admin-primary" id="asNew">+ New staff login</button></div>') +
      (list.length
        ? '<table class="admin-table"><thead><tr><th>Login</th><th>Role</th><th>Covers</th><th>State</th><th></th></tr></thead><tbody>' +
          list.map(function(s){
            return '<tr' + (s.status === 'paused' ? ' style="opacity:.6"' : '') + '><td><strong>' + esc(s.name || s.username) + '</strong><br><span class="admin-sub">' + esc(s.username) + '</span></td>' +
              '<td><span class="sr-role ' + (s.role === 'dean' ? 'sr-dean' : 'sr-prof') + '">' + (s.role === 'dean' ? 'Dean' : 'Professor') + '</span></td>' +
              '<td>' + covers(s) + '</td>' +
              '<td>' + esc(R.stateTx(s)) + (s.createdBy && s.createdBy !== 'admin' ? '<br><span class="admin-sub">given by ' + esc(s.createdBy) + '</span>' : '') + '</td>' +
              '<td style="white-space:nowrap;">' +
                '<button type="button" class="home-btn admin-mini" data-as-edit="' + esc(s.id) + '">Change</button> ' +
                '<button type="button" class="home-btn admin-mini" data-as-status="' + esc(s.id) + '" data-to="' + (s.status === 'paused' ? 'active' : 'paused') + '">' + (s.status === 'paused' ? 'Turn back on' : 'Pause') + '</button> ' +
                '<button type="button" class="home-btn admin-mini" data-as-link="' + esc(s.id) + '">New link</button> ' +
                '<button type="button" class="home-btn admin-mini admin-danger" data-as-del="' + esc(s.id) + '">Remove</button></td></tr>' +
              // The link just made for this login, right under its row.
              (state.staffLink && state.staffLink.id === s.id ? '<tr class="as-linkrow"><td colspan="5">' + R.linkBoxHtml(state.staffLink.who, state.staffLink.link) + '</td></tr>' : '') +
              // New link for someone who already has a password: asked here in
              // the page, not in a browser pop-up (a browser can block those,
              // and then the button seemed to do nothing).
              (state.staffAsk === s.id ? '<tr class="as-linkrow"><td colspan="5"><div class="sr-link"><b>Make a new link for ' + esc(s.name || s.username) + '?</b>' +
                '<p>It signs them out until they open it and choose a new password. Their old link stops working.</p>' +
                '<div class="sr-link-row"><button type="button" class="home-btn admin-primary" data-as-linkgo="' + esc(s.id) + '">Make the new link</button>' +
                '<button type="button" class="home-btn" data-as-linkno>Cancel</button></div></div></td></tr>' : '');
          }).join('') + '</tbody></table>'
        : '<p class="admin-hint">No staff logins yet.</p>');
  }
  function bindStaff(main){
    var R = window.AAUP_STAFF_ROOM;
    if(!R) return;
    var byId = function(id){ return (state.staffItems || []).filter(function(s){ return s.id === id; })[0]; };
    var err = function(e){ toast(e.message); };
    on('asRetry', 'click', function(){ state.staffErr = ''; render(); });
    on('asNew', 'click', function(){ state.staffDraft = staffDraftFrom(null); state.staffLink = null; render(); });
    main.querySelectorAll('[data-sr-copy]').forEach(function(b){ b.addEventListener('click', function(){ R.copy(b.getAttribute('data-sr-copy')); }); });
    var fresh = main.querySelector('.as-linkrow');
    if(fresh && fresh.scrollIntoView) fresh.scrollIntoView({ block: 'nearest' });
    var form = document.getElementById('asForm');
    if(form){
      R.bindPickers(form);
      var read = function(){
        var d = state.staffDraft;
        d.name = document.getElementById('asName').value;
        if(!d.id) d.username = document.getElementById('asUser').value;
        d.role = document.getElementById('asRole').value;
        d.uni = document.getElementById('asUni').value;
        if(d.role === 'professor') d.courses = R.pickerValue(form);
        d.email = document.getElementById('asEmail').value.trim();
        d.phone = document.getElementById('asPhone').value.trim();
        d.phoneShown = document.getElementById('asPhoneOk').checked;
        return d;
      };
      ['asRole', 'asUni'].forEach(function(id){ on(id, 'change', function(){
        var before = state.staffDraft.uni;
        read();
        if(state.staffDraft.uni !== before) state.staffDraft.college = '';
        render();
      }); });
      on('asColAdd', 'click', function(){
        var d = read(), pick = document.getElementById('asColPick').value;
        d.college = pick === '*' ? '*' : R.collegeIds(d.college).concat(pick).join(',');
        render();
      });
      form.querySelectorAll('[data-as-uncol]').forEach(function(b){
        b.addEventListener('click', function(){
          var d = read(), id = b.getAttribute('data-as-uncol');
          d.college = id === '*' ? '' : R.collegeIds(d.college).filter(function(x){ return x !== id; }).join(',');
          render();
        });
      });
      on('asCancel', 'click', function(){ state.staffDraft = null; render(); });
      on('asSave', 'click', function(){
        var d = read();
        if(d.role === 'dean' && !d.college){ toast('Add the college (or All colleges) this dean leads.'); return; }
        var body = { name: d.name.trim(), role: d.role, uni: d.uni, college: d.college || '*', courses: d.role === 'professor' ? d.courses : [],
                     email: d.email, phone: d.phone, phoneShown: !!(d.phone && d.phoneShown) };
        if(!d.id) body.username = d.username.trim();
        api(d.id ? 'PATCH' : 'POST', '/api/admin/staff' + (d.id ? '/' + d.id : ''), body).then(function(res){
          state.staffDraft = null;
          if(res.setupCode) state.staffLink = { who: res.staff.name || res.staff.username, link: R.setupLink(res.staff.username, res.setupCode) };
          toast(d.id ? 'Saved' : 'Login made — send them the link');
          state.staffItems = null; render();
        }).catch(err);
      });
    }
    main.querySelectorAll('[data-as-edit]').forEach(function(b){
      b.addEventListener('click', function(){ state.staffDraft = staffDraftFrom(byId(b.getAttribute('data-as-edit'))); state.staffLink = null; render(); });
    });
    main.querySelectorAll('[data-as-status]').forEach(function(b){
      b.addEventListener('click', function(){
        api('PATCH', '/api/admin/staff/' + b.getAttribute('data-as-status'), { status: b.getAttribute('data-to') })
          .then(function(){ state.staffItems = null; render(); }).catch(err);
      });
    });
    var makeLink = function(id){
        state.staffAsk = null;
        api('PATCH', '/api/admin/staff/' + id, { newSetupCode: true }).then(function(res){
          state.staffLink = { id: res.staff.id, who: res.staff.name || res.staff.username, link: R.setupLink(res.staff.username, res.setupCode) };
          toast('New link made. Copy it under ' + (res.staff.name || res.staff.username) + '.');
          state.staffItems = null; render();
        }).catch(function(e){ toast('Couldn\'t make a new link: ' + e.message); render(); });
    };
    main.querySelectorAll('[data-as-link]').forEach(function(b){
      b.addEventListener('click', function(){
        var s = byId(b.getAttribute('data-as-link'));
        if(!s) return;
        state.staffLink = null;
        if(s.hasPassword){ state.staffAsk = s.id; render(); return; }
        makeLink(s.id);
      });
    });
    main.querySelectorAll('[data-as-linkgo]').forEach(function(b){ b.addEventListener('click', function(){ makeLink(b.getAttribute('data-as-linkgo')); }); });
    main.querySelectorAll('[data-as-linkno]').forEach(function(b){ b.addEventListener('click', function(){ state.staffAsk = null; render(); }); });
    main.querySelectorAll('[data-as-del]').forEach(function(b){
      b.addEventListener('click', function(){
        var s = byId(b.getAttribute('data-as-del'));
        if(!confirm('Remove ' + ((s && (s.name || s.username)) || 'this login') + '? They can\'t sign in any more.')) return;
        api('DELETE', '/api/admin/staff/' + s.id).then(function(){ state.staffItems = null; render(); }).catch(err);
      });
    });
  }

  function sectionAccounts(){
    var head = '<h2>👤 Student accounts</h2>';
    if(!cloudUrl()) return head + '<div class="admin-note">APP_CLOUD_URL is not set, so there are no accounts.</div>';
    if(!cloudSecret()){
      return head +
        '<div class="admin-note">For a student who forgot their password, has no recovery code, and is not signed in on any phone. ' +
        'Find their account and give it a temporary password; they sign in with it and change it in Cloud Sync. ' +
        'This needs the cloud Worker\'s <code>ADMIN_SECRET</code> (a different secret from the thoughts Worker\'s). It is kept in this tab only.</div>' +
        '<div class="form-field"><label for="acctSecretInput">ADMIN_SECRET</label><input type="password" id="acctSecretInput" autocomplete="off" spellcheck="false"></div>' +
        '<div class="form-actions"><button type="button" class="home-btn admin-primary" id="acctUnlock">Unlock</button></div>';
    }
    var list = state.acctResults;
    return head +
      '<div class="admin-note">Make sure it is really them before resetting: ask them to message you from the email on the account, for example. A reset signs the account out everywhere.</div>' +
      '<div class="form-field"><label for="acctQuery">Email or username</label><input type="search" id="acctQuery" value="' + esc(state.acctQuery || '') + '" autocomplete="off" spellcheck="false" placeholder="at least 3 characters"></div>' +
      '<div class="form-actions"><button type="button" class="home-btn admin-primary" id="acctFind">Find</button> <button type="button" class="home-btn admin-mini" id="acctForget">Forget secret</button></div>' +
      (state.acctTemp ? '<div class="admin-note" style="border-color:var(--accent);"><strong>Temporary password for ' + esc(state.acctTemp.who) + ':</strong> ' +
        '<code style="font-size:16px;user-select:all;">' + esc(state.acctTemp.pw) + '</code><br>Send it to them. They sign in with it, then Cloud Sync → Change password.</div>' : '') +
      (list == null ? '' : (list.length
        ? list.map(function(u){
            return '<div class="admin-note" data-acct-id="' + esc(u.id) + '"><strong>' + esc(u.email) + '</strong>' +
              (u.username ? ' · @' + esc(u.username) : '') + (u.google ? ' · Google' : '') +
              '<br><span style="opacity:.7;">since ' + esc(new Date(u.createdAt).toLocaleDateString()) + '</span>' +
              '<div class="form-actions"><button type="button" class="home-btn admin-danger" data-acct-reset="' + esc(u.id) + '" data-acct-who="' + esc(u.email) + '">Give a temporary password</button></div></div>';
          }).join('')
        : '<p class="ex-note">No account matches that.</p>'));
  }
  function bindAccounts(main){
    var unlock = document.getElementById('acctUnlock');
    if(unlock){
      var input = document.getElementById('acctSecretInput');
      var accept = function(){ var v = input ? input.value.trim() : ''; if(!v) return; setCloudSecret(v); render(); };
      unlock.addEventListener('click', accept);
      if(input) input.addEventListener('keydown', function(e){ if(e.key === 'Enter') accept(); });
      return;
    }
    on('acctForget', 'click', function(){ setCloudSecret(''); state.acctResults = null; state.acctTemp = null; render(); });
    var find = function(){
      var q = (document.getElementById('acctQuery') || {}).value || '';
      state.acctQuery = q.trim();
      state.acctTemp = null;
      cloudCall('/api/admin/users?q=' + encodeURIComponent(state.acctQuery))
        .then(function(d){ state.acctResults = d.users || []; render(); })
        .catch(function(e){ toast(e.message); render(); });
    };
    on('acctFind', 'click', find);
    var qEl = document.getElementById('acctQuery');
    if(qEl) qEl.addEventListener('keydown', function(e){ if(e.key === 'Enter') find(); });
    main.querySelectorAll('[data-acct-reset]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var who = btn.getAttribute('data-acct-who');
        if(!confirm('Give ' + who + ' a temporary password? Their current password stops working and every device is signed out.')) return;
        cloudCall('/api/admin/reset', { method: 'POST', body: { id: btn.getAttribute('data-acct-reset') } })
          .then(function(d){ state.acctTemp = { who: who, pw: d.tempPassword }; render(); })
          .catch(function(e){ toast('Could not reset it: ' + e.message); render(); });
      });
    });
  }

  function sectionSettings(){
    return '<h2>Settings</h2>' +
      '<div class="admin-note"><strong>Signed in as</strong> ' + esc(state.username) + '.<br>' +
      'The session lasts 8 hours and lives only in this tab — closing it signs you out.</div>' +
      '<div class="admin-note"><strong>Changing your password.</strong> Run ' +
      '<code>python3 tools/hash-admin-password.py</code> and paste the result into the Worker\'s ' +
      '<code>ADMIN_PASSWORD_HASH</code> secret. The password itself is never stored anywhere.</div>' +
      '<div class="admin-note"><strong>Revoking access.</strong> Replace <code>SESSION_SECRET</code> in the ' +
      'Worker. Every signed-in session stops working immediately.</div>' +
      '<div class="admin-note"><strong>Refresh from GitHub.</strong> Re-reads the list of ' +
      'universities and majors from the repo. It changes nothing and deletes nothing — ' +
      'use it if you edited files in GitHub directly and want this dashboard to catch up. ' +
      'Any major you have open with unsaved changes is left alone.</div>' +
      '<div class="form-actions"><button type="button" class="home-btn" id="adminReload">🔄 Refresh list from GitHub</button></div>' +
      '<div class="admin-note"><strong>Student preview.</strong> The phone beside a major\'s editor shows what students will see as you type.</div>' +
      '<div class="form-actions"><button type="button" class="home-btn" id="adminPreviewToggle">📱 ' + (previewOn() ? 'Hide' : 'Show') + ' the student preview</button></div>';
  }

  // ---------- render + binding ----------

  function render(){
    ensureOverlay();
    var main = document.getElementById('adminMain');
    var who = document.getElementById('adminWho');
    if(!state.token){ if(who) who.textContent = ''; renderLogin(''); return; }
    if(who) who.textContent = ' · ' + state.username;
    var brand = document.querySelector('#adminOverlay .admin-brand strong');
    if(brand) brand.textContent = staffMode ? 'Staff room' : T('Admin', 'لوحة الإدارة');
    document.getElementById('adminOverlay').classList.toggle('is-staff', !!staffMode);

    renderNav();
    var s = state.section;

    // Opening Majors for the first time needs the faculty grouping data. Fetch
    // it once and re-render when it lands, rather than making every caller of
    // render() remember to do it.
    if(s === 'majors' && !state.browseLoading && !state.browseMajors){
      var want = state.browseUni || ((state.tree || [])[0] || {}).slug;
      if(want) loadBrowse(want).then(render);
    }

    if(s === 'dashboard') main.innerHTML = sectionDashboard();
    else if(s === 'universities') main.innerHTML = sectionUniversities();
    else if(s === 'majors') main.innerHTML = sectionMajors();
    else if(s === 'courses') main.innerHTML = sectionCourses();
    else if(s === 'prereqs') main.innerHTML = sectionPrereqs();
    else if(s === 'schedule') main.innerHTML = sectionSchedule();
    else if(s === 'assets') main.innerHTML = sectionAssets();
    else if(s === 'contributions'){
      main.innerHTML = sectionContributions();
      if(!state.contribLoading && !state.contribItems) loadContributions();
    }
    else if(s === 'accounts') main.innerHTML = sectionAccounts();
    else if(s === 'staff'){
      main.innerHTML = sectionStaff();
      if(!state.staffLoading && !state.staffItems && !state.staffErr) loadStaff();
    }
    else if(s === 'workers'){
      main.innerHTML = sectionWorkers();
      if(!state.workersLoading && !state.workers) loadWorkers();
    }
    else if(s === 'thoughts'){
      main.innerHTML = sectionThoughts();
      if(!state.thoughtsLoading && !state.thoughtItems) loadThoughts();
    }
    else main.innerHTML = sectionSettings();
    bindMain();
  }

  function on(sel, ev, fn){
    var el = typeof sel === 'string' ? document.getElementById(sel) : sel;
    if(el) el.addEventListener(ev, fn);
  }

  function bindMain(){
    var main = document.getElementById('adminMain');
    bindIconPickers();
    if(state.section === 'contributions') bindContributions(main);
    if(state.section === 'thoughts') bindThoughts(main);
    if(state.section === 'accounts') bindAccounts(main);
    if(state.section === 'staff') bindStaff(main);
    on('adminWorkersRefresh', 'click', function(){ state.workers = null; render(); });
    main.querySelectorAll('[data-inbox-go]').forEach(function(b){
      b.addEventListener('click', function(){ state.section = b.getAttribute('data-inbox-go'); render(); });
    });
    if(state.section === 'thoughts' && state.thoughtItems){
      var newest = state.thoughtItems.reduce(function(m, t){ return Math.max(m, t.at || 0); }, 0);
      try{ if(newest) localStorage.setItem(SEEN_THOUGHTS_KEY, String(newest)); }catch(e){}
    }

    main.querySelectorAll('[data-edit-uni]').forEach(function(b){
      b.addEventListener('click', function(){
        var slug = b.getAttribute('data-edit-uni');
        var row = (state.tree || []).filter(function(u){ return u.slug === slug; })[0] || { slug: slug };
        api('GET', '/api/university/' + slug).then(function(res){
          var host = document.getElementById('adminUniEditor') || main;
          // The version this form is a picture of. Save sends it back so the
          // Worker can tell an edit from an accidental rollback.
          state.uniSha = res.sha || '';
          host.innerHTML = universityEditor(row, res.university);
          bindIconPickers();
          bindUniEditor(slug);
          host.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }).catch(function(e){ toast(e.message); });
      });
    });

    main.querySelectorAll('[data-edit-major]').forEach(function(b){
      b.addEventListener('click', function(){
        openMajor(b.getAttribute('data-uni'), b.getAttribute('data-edit-major'));
      });
    });
    main.querySelectorAll('[data-del-major]').forEach(function(b){
      b.addEventListener('click', function(){
        var slug = b.getAttribute('data-del-major');
        if(!confirm('Delete the major "' + slug + '"?\n\nIt stops being offered to students. The file is removed by a commit, so it can be restored with git revert.')) return;
        api('DELETE', '/api/major/' + b.getAttribute('data-uni') + '/' + slug)
          .then(function(){ toast('Removed ' + slug + '.'); return loadTree(); })
          .then(function(){ return state.browseUni ? loadBrowse(state.browseUni) : null; })
          .then(render).catch(function(e){ toast(e.message); });
      });
    });
    main.querySelectorAll('[data-new-major]').forEach(function(b){
      b.addEventListener('click', function(){
        openNewMajorForm(b.getAttribute('data-new-major'), b.getAttribute('data-faculty') || '');
      });
    });

    on('amUni', 'change', function(e){ loadBrowse(e.target.value).then(render); });
    on('amFilter', 'input', function(e){ filterRows(e.target.value, '[data-major-row]'); });
    on('acFilter', 'input', function(e){ filterRows(e.target.value, '[data-course]'); });

    if(state.section === 'courses') bindCourses();
    if(state.section === 'prereqs') bindPrereqs();
    if(state.section === 'schedule') bindSchedule();
    if(state.section === 'assets') bindAssets();
    if(document.getElementById('amSave')) bindMajorSave();
    on('adminReload', 'click', function(){ loadTree().then(render).catch(function(e){ toast(e.message); }); });
    on('adminPreviewToggle', 'click', function(){
      try{ localStorage.setItem(PREVIEW_KEY, previewOn() ? '0' : '1'); }catch(e){}
      render();
    });
    bindPlus();
  }

  // Turns "AI and Robotics" into "ai-and-robotics". The slug is the filename
  // and every reference to the major, so it is still editable — but nobody
  // should have to invent one to create a major, which is what a bare prompt()
  // for the slug demanded.
  function slugify(s){
    return String(s || '').toLowerCase().trim()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  function facultyOptions(selected, includeNone){
    var list = state.browseFaculties || [];
    return (includeNone ? '<option value="">— no faculty —</option>' : '') +
      list.map(function(f){
        return '<option value="' + esc(f.slug) + '"' + (f.slug === selected ? ' selected' : '') + '>' +
          esc(f.name) + ' (' + esc(f.slug) + ')</option>';
      }).join('');
  }

  // The old flow asked for a slug in a window.prompt and created the major with
  // no faculty at all, no name, and no way to set either without knowing to go
  // looking. Everything a major needs to exist somewhere a student can find it
  // is asked for here, once, with the faculty already filled in from whichever
  // group the button was pressed in.
  function openNewMajorForm(uni, faculty){
    var host = document.getElementById('adminMajorEditor');
    if(!host) return;
    host.innerHTML =
      '<div class="admin-editor"><h3>New major</h3>' +
      '<p class="admin-hint">This creates <code>data/' + esc(uni) + '/majors/&lt;slug&gt;.json</code>. ' +
      'You can add courses, prerequisites and the year layout straight after.</p>' +
      '<div class="form-field-row">' +
        field('anName', 'Name (English)', '') +
        field('anNameAr', 'Name (Arabic)', '') +
      '</div>' +
      '<div class="form-field"><label for="anFaculty">Faculty</label>' +
      '<select id="anFaculty">' + facultyOptions(faculty, true) + '</select>' +
      '<p class="admin-hint">A major with no faculty does not appear anywhere for students.</p></div>' +
      '<div class="form-field"><label for="anSlug">Slug (the filename)</label>' +
      '<input type="text" id="anSlug" value="" placeholder="filled in from the name">' +
      '<p class="admin-hint">Lowercase letters, numbers and hyphens. Other majors and saved student ' +
      'plans reference this, so it is worth getting right — renaming it later orphans them.</p></div>' +
      '<div class="form-actions">' +
        '<button type="button" class="home-btn admin-primary" id="anCreate">Create major</button> ' +
        '<button type="button" class="home-btn admin-mini" id="anCancel">Cancel</button>' +
      '</div><div id="adminMsg"></div></div>';
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });

    var slugEl = document.getElementById('anSlug');
    var touched = false;
    on('anSlug', 'input', function(){ touched = true; });
    on('anName', 'input', function(e){ if(!touched) slugEl.value = slugify(e.target.value); });
    on('anCancel', 'click', function(){ host.innerHTML = ''; });

    on('anCreate', 'click', function(){
      var name = val('anName').trim();
      var slug = slugify(val('anSlug') || name);
      if(!name){ setMsg('Give the major a name.', 'err'); return; }
      if(!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)){
        setMsg('Slug must be lowercase letters, numbers and hyphens.', 'err'); return;
      }
      var clash = (state.browseMajors || []).filter(function(m){ return m.slug === slug; })[0];
      if(clash){ setMsg('A major with the slug “' + esc(slug) + '” already exists here.', 'err'); return; }

      state.uni = uni;
      state.majorSlug = slug;
      state.majorSha = '';   // nothing to be stale against — this is a create
      state.major = {
        schemaVersion: 1, slug: slug, university: uni,
        name: name, nameAr: val('anNameAr').trim(),
        college: val('anFaculty'),
        icon: '🎓', iconKey: '',
        years: [{ id: 'y1', hasSummer: false }], courses: [], prerequisites: []
      };
      state.section = 'majors';
      markDirty();
      render();
      var h = document.getElementById('adminMajorEditor');
      if(h){
        h.innerHTML = majorEditor(state.major);
        bindIconPickers(); bindMajorSave();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      setMsg('Not created yet — press Save major to write the file.', 'ok');
    });
  }

  function filterRows(q, sel){
    var needle = String(q || '').toLowerCase();
    document.querySelectorAll(sel).forEach(function(r){
      r.style.display = !needle || r.textContent.toLowerCase().indexOf(needle) !== -1 ||
        (r.querySelector('input') && Array.prototype.some.call(r.querySelectorAll('input'), function(i){
          return i.value.toLowerCase().indexOf(needle) !== -1;
        })) ? '' : 'none';
    });
  }

  function openMajor(uni, slug){
    if(state.dirty && state.major && (uni !== state.uni || slug !== state.majorSlug) &&
       !confirm('You have unsaved changes to ' + state.majorSlug + '. Open ' + slug + ' and lose them?')) return Promise.resolve();
    // The editor's faculty list comes from the browse data. Opening a major
    // belonging to a university we have not browsed would otherwise render an
    // empty dropdown and look like the major has no faculty to choose from.
    var ready = (state.browseUni === uni && state.browseFaculties)
      ? Promise.resolve() : loadBrowse(uni);
    return ready.then(function(){
    return api('GET', '/api/major/' + uni + '/' + slug).then(function(res){
      state.uni = uni; state.majorSlug = slug; state.major = res.major; state.dirty = false;
      state.majorOrig = clone(res.major);
      state.majorSha = res.sha || '';
      state.section = 'majors'; render();
      var host = document.getElementById('adminMajorEditor');
      if(host){
        host.innerHTML = majorEditor(state.major);
        bindIconPickers(); bindMajorSave();
        host.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    }).catch(function(e){ toast(e.message); });
  }

  function val(id){ var el = document.getElementById(id); return el ? el.value : ''; }

  function bindUniEditor(slug){
    on('auAddCollege', 'click', function(){
      var host = document.getElementById('auColleges');
      var rows = host.querySelectorAll('[data-college-row]').length;
      if(!rows) host.innerHTML = '';
      // Rendered with its real index rather than string-patching index 0, which
      // produced duplicate indices as soon as two were added.
      var html = collegeRows([{ slug: '', name: '', nameAr: '', icon: '🏫' }])
        .replace(/data-college-row="0"/, 'data-college-row="' + rows + '"')
        .replace(/data-del-college="0"/, 'data-del-college="' + rows + '"')
        .replace(/admin-faculty-n">1</, 'admin-faculty-n">' + (rows + 1) + '<');
      host.insertAdjacentHTML('beforeend', html);
      bindCollegeDeletes();
      var last = host.querySelector('[data-college-row="' + rows + '"] .ac-name');
      if(last) last.focus();
    });
    bindCollegeDeletes();
    var bindDateDeletes = function(){
      document.querySelectorAll('[data-del-date]').forEach(function(b){
        if(b.__bound) return; b.__bound = true;
        b.addEventListener('click', function(){ var row = b.closest('[data-date-row]'); if(row) row.remove(); });
      });
    };
    bindDateDeletes();
    on('auAddDate', 'click', function(){
      var host = document.getElementById('auDates');
      if(!host) return;
      host.insertAdjacentHTML('beforeend', dateRows([{ en: '', ar: '', date: '' }]));
      bindDateDeletes();
      var rows = host.querySelectorAll('[data-date-row]');
      var last = rows[rows.length - 1];
      if(last) last.querySelector('.ad-en').focus();
    });
    on('auSave', 'click', function(){
      var dates = [];
      document.querySelectorAll('[data-date-row]').forEach(function(r){
        var en = r.querySelector('.ad-en').value.trim(), date = r.querySelector('.ad-date').value;
        if(!en || !date) return;
        dates.push({ en: en, ar: r.querySelector('.ad-ar').value.trim(), date: date });
      });
      var colleges = [];
      document.querySelectorAll('[data-college-row]').forEach(function(r){
        var s = r.querySelector('.ac-slug').value.trim();
        if(!s) return;
        colleges.push({ slug: s, name: r.querySelector('.ac-name').value.trim(),
                        nameAr: r.querySelector('.ac-namear').value.trim(),
                        icon: r.querySelector('.ac-icon').value.trim() });
      });
      var payload = {
        university: {
          slug: slug, name: val('auName'), nameAr: val('auNameAr'), shortName: val('auShort'),
          icon: val('auIcon'), iconKey: val('auIconKey'), website: val('auWebsite'),
          description: val('auDesc'), logoUrl: val('auLogo'), colleges: colleges, dates: dates
        },
        published: document.getElementById('auPublished').checked,
        baseSha: state.uniSha || ''
      };
      setMsg('Saving…', 'ok');
      api('PUT', '/api/university/' + slug, payload).then(function(res){
        // Track forward, so pressing Save twice in a row is not a conflict.
        state.uniSha = res.sha || '';
        setMsg('Saved. Live for everyone in about a minute.', 'ok');
        return loadTree();
      }).catch(function(e){ setMsg(esc(e.message), 'err'); });
    });
  }

  // Every destructive control asks first. A misclick in a table of forty rows
  // is easy and, before this, instant and silent.
  function bindCollegeDeletes(){
    document.querySelectorAll('[data-del-college]').forEach(function(b){
      b.addEventListener('click', function(){
        var row = b.closest('[data-college-row]');
        var name = (row.querySelector('.ac-name').value || row.querySelector('.ac-slug').value || 'this faculty').trim();
        if(!confirm('Remove the faculty "' + name + '"?\n\nMajors already pointing at it keep their own copy of the name, ' +
                    'but they stop being grouped under it. Nothing is saved until you press Save university.')) return;
        row.remove();
      });
    });
  }

  // Reads every input back into state.major. Called before any save and before
  // switching section, so edits typed in one view are not lost by navigating.
  function harvestCourses(){
    if(!state.major) return;
    document.querySelectorAll('[data-course]').forEach(function(r){
      var c = state.major.courses[Number(r.getAttribute('data-course'))];
      if(!c) return;
      c.courseNumber = r.querySelector('.cc-num').value.trim();
      c.name = r.querySelector('.cc-name').value.trim();
      c.nameAr = r.querySelector('.cc-namear').value.trim();
      c.creditHours = Number(r.querySelector('.cc-ch').value) || 0;
      c.category = r.querySelector('.cc-cat').value;
      c.yearId = r.querySelector('.cc-year').value;
      c.semester = r.querySelector('.cc-sem').value;
    });
  }

  function harvestMajorMeta(){
    if(!state.major || !document.getElementById('amName')) return;
    var m = state.major;
    m.name = val('amName'); m.nameAr = val('amNameAr');
    m.subtitle = val('amSub'); m.subtitleAr = val('amSubAr');
    m.college = val('amCollege'); m.icon = val('amIcon'); m.iconKey = val('amIconKey');
    m.imageUrl = val('amImage'); m.bio = val('amBio'); m.bioAr = val('amBioAr');
    var h = val('amHours'); m.degreeHours = h === '' ? null : Number(h);
    var o = val('amOrder'); m.sortOrder = o === '' ? null : Number(o);
  }

  // Every course in the university's published plans, deduplicated. Loaded once
  // per session, lazily — nobody pays for it unless they open the picker.
  var coursePool = null;
  function loadCoursePool(){
    if(coursePool) return Promise.resolve(coursePool);
    return fetch('plans.json', { cache: 'no-store' })
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(feed){
        var uni = state.uni;
        var seen = {};
        (feed.plans || []).forEach(function(p){
          if(p.university !== uni) return;
          (p.courses || []).forEach(function(c){
            // Code first: it is the registrar's identity for a course. Falling
            // back to the name keeps courses that have never been given one.
            var key = (c.courseNumber || '').trim() || ('name:' + (c.name || '').trim().toLowerCase());
            if(!key || seen[key]) { if(seen[key]) seen[key].plans++; return; }
            seen[key] = {
              courseNumber: c.courseNumber || '',
              name: c.name || '',
              nameAr: c.ar || c.nameAr || '',
              creditHours: Number(c.creditHours) || 0,
              category: c.category || 'core',
              plans: 1
            };
          });
        });
        coursePool = Object.keys(seen).map(function(k){ return seen[k]; });
        return coursePool;
      });
  }

  function renderPickResults(q){
    var box = document.getElementById('acPickResults');
    if(!box) return;
    var needle = String(q || '').trim().toLowerCase();
    if(needle.length < 2){
      box.innerHTML = '<p class="admin-hint admin-facgroup-empty">Type at least two characters.</p>';
      return;
    }
    // Courses already in this plan are excluded rather than shown greyed out:
    // adding one twice is never what anyone meant, and the list is long enough.
    var have = {};
    ((state.major || {}).courses || []).forEach(function(c){
      have[(c.courseNumber || '').trim() || ('name:' + (c.name || '').trim().toLowerCase())] = true;
    });
    var hits = (coursePool || []).filter(function(c){
      var key = (c.courseNumber || '').trim() || ('name:' + c.name.trim().toLowerCase());
      if(have[key]) return false;
      return c.name.toLowerCase().indexOf(needle) !== -1 ||
             (c.nameAr || '').toLowerCase().indexOf(needle) !== -1 ||
             (c.courseNumber || '').toLowerCase().indexOf(needle) !== -1;
    }).slice(0, 40);

    box.innerHTML = hits.length
      ? hits.map(function(c, i){
          return '<button type="button" class="admin-pickhit" data-pick="' + i + '">' +
            '<span class="admin-pickhit-code">' + esc(c.courseNumber || '—') + '</span>' +
            '<span class="admin-pickhit-name">' + esc(c.name) +
              (c.nameAr ? '<br><span class="admin-sub" dir="rtl">' + esc(c.nameAr) + '</span>' : '') + '</span>' +
            '<span class="admin-sub">' + c.creditHours + ' CH · ' + esc(c.category) +
              (c.plans > 1 ? ' · in ' + c.plans + ' plans' : '') + '</span>' +
            '</button>';
        }).join('')
      : '<p class="admin-hint admin-facgroup-empty">Nothing matches — or it is already in this plan.</p>';

    box.querySelectorAll('[data-pick]').forEach(function(b){
      b.addEventListener('click', function(){
        addCourseFromPool(hits[Number(b.getAttribute('data-pick'))]);
      });
    });
  }

  function newCourseId(){
    // Must not collide with an existing id: prerequisites are stored as pairs
    // of ids, so a duplicate would silently attach this course to another's
    // prerequisite lines.
    var used = {};
    ((state.major || {}).courses || []).forEach(function(c){ used[c.id] = true; });
    var n = 1;
    while(used['new-course-' + n]) n++;
    return 'new-course-' + n;
  }

  function addCourseAt(term, base){
    harvestCourses();
    var parts = String(term || '').split('|');
    var c = {
      id: newCourseId(),
      courseNumber: (base && base.courseNumber) || '',
      name: (base && base.name) || 'New course',
      nameAr: (base && base.nameAr) || '',
      creditHours: base ? base.creditHours : 3,
      category: (base && base.category) || 'core',
      yearId: parts[0] || '',
      semester: parts[1] || ''
    };
    state.major.courses.push(c);
    markDirty();
    render();
    return c;
  }

  function addCourseFromPool(c){
    if(!c) return;
    var term = val('acPickTerm');
    addCourseAt(term, c);
    toast('Added ' + (c.courseNumber ? c.courseNumber + ' · ' : '') + c.name + '.');
  }

  // Populates the three shared datalists. The label carries the rest of the
  // course, so the browser's own dropdown shows "040111001 · 2 CH · skills"
  // next to the name and the choice is made on sight rather than on memory.
  function fillDatalists(pool){
    var fill = function(id, valueOf, labelOf){
      var el = document.getElementById(id);
      if(!el) return;
      var seen = {}, html = '';
      (pool || []).forEach(function(c){
        var v = valueOf(c);
        if(!v || seen[v]) return;      // a duplicate value is unpickable anyway
        seen[v] = true;
        html += '<option value="' + esc(v) + '" label="' + esc(labelOf(c)) + '"></option>';
      });
      el.innerHTML = html;
    };
    fill('acCodeList', function(c){ return c.courseNumber; },
                       function(c){ return c.name + ' · ' + c.creditHours + ' CH'; });
    fill('acNameList', function(c){ return c.name; },
                       function(c){ return (c.courseNumber || '—') + ' · ' + c.creditHours + ' CH · ' + c.category; });
    fill('acArList',   function(c){ return c.nameAr; },
                       function(c){ return (c.courseNumber || '—') + ' · ' + c.name; });
  }

  function poolMatch(field, value){
    var v = String(value || '').trim();
    if(!v) return null;
    var lower = v.toLowerCase();
    return (coursePool || []).filter(function(c){
      return String(c[field] || '').trim().toLowerCase() === lower;
    })[0] || null;
  }

  // Only fires on an exact match, which in practice means a pick from the list
  // rather than half-typed text — so it cannot overwrite a row while someone is
  // still in the middle of describing a course that does not exist yet.
  function autofillRow(row, hit, from){
    if(!hit) return false;
    var set = function(sel, v){
      var el = row.querySelector(sel);
      if(el && String(el.value) !== String(v)) el.value = v;
    };
    if(from !== 'code') set('.cc-num', hit.courseNumber || '');
    if(from !== 'name') set('.cc-name', hit.name || '');
    if(from !== 'ar')   set('.cc-namear', hit.nameAr || '');
    set('.cc-ch', hit.creditHours);
    var cat = row.querySelector('.cc-cat');
    if(cat && hit.category) cat.value = hit.category;
    // Four boxes changing at once is a lot to do silently; the flash says which
    // row did it. Purely cosmetic — the class is gone before the next save.
    row.classList.add('is-autofilled');
    setTimeout(function(){ row.classList.remove('is-autofilled'); }, 1200);
    return true;
  }

  function bindCourses(){
    document.querySelectorAll('[data-course] input').forEach(function(i){
      i.addEventListener('change', markDirty);
    });

    // The lists are what make Code and Name behave like the Category, Year and
    // Sem dropdowns beside them: a set of real choices rather than an empty box.
    loadCoursePool().then(fillDatalists).catch(function(){ /* offline: rows still type freely */ });

    [['.cc-num', 'courseNumber', 'code'], ['.cc-name', 'name', 'name'], ['.cc-namear', 'nameAr', 'ar']]
      .forEach(function(spec){
        document.querySelectorAll('[data-course] ' + spec[0]).forEach(function(inp){
          var apply = function(){
            var row = inp.closest('[data-course]');
            if(!row) return;
            if(autofillRow(row, poolMatch(spec[1], inp.value), spec[2])){
              harvestCourses();
              markDirty();
            }
          };
          // 'input' catches a click on the browser's suggestion list, which does
          // not always fire 'change' until focus leaves.
          inp.addEventListener('input', apply);
          inp.addEventListener('change', apply);
        });
      });
    document.querySelectorAll('[data-course] .cc-cat').forEach(function(s){
      s.addEventListener('change', markDirty);
    });
    // Year and semester decide which group the row belongs to, so re-render
    // rather than just marking dirty. Before this the value changed and the row
    // stayed put until a save and a reopen, which read as "it cannot be moved".
    document.querySelectorAll('[data-course] .cc-year, [data-course] .cc-sem').forEach(function(s){
      s.addEventListener('change', function(){ harvestCourses(); markDirty(); render(); });
    });
    document.querySelectorAll('[data-add-term]').forEach(function(b){
      b.addEventListener('click', function(){ addCourseAt(b.getAttribute('data-add-term'), null); });
    });

    var q = document.getElementById('acPickQuery');
    if(q){
      var run = function(){ renderPickResults(q.value); };
      q.addEventListener('input', function(){
        loadCoursePool().then(run).catch(function(e){
          var box = document.getElementById('acPickResults');
          if(box) box.innerHTML = '<p class="admin-hint admin-warn">Could not read the catalogue (' + esc(e.message) + ').</p>';
        });
      });
      // Warm the pool when the panel is opened, so the first keystroke is not
      // the thing that waits on a network read.
      var det = document.getElementById('acPicker');
      if(det) det.addEventListener('toggle', function(){ if(det.open) loadCoursePool().catch(function(){}); });
    }
    document.querySelectorAll('[data-del-course]').forEach(function(b){
      b.addEventListener('click', function(){
        harvestCourses();
        var i = Number(b.getAttribute('data-del-course'));
        var c = state.major.courses[i];
        var links = (state.major.prerequisites || []).filter(function(p){
          return p[0] === c.id || p[1] === c.id;
        }).length;
        if(!confirm('Remove "' + (c.name || c.id) + '"?' +
                    (links ? '\n\nThis also removes ' + links + ' prerequisite link' + (links === 1 ? '' : 's') +
                             ' that refer to it — otherwise the plan could not be saved.' : '') +
                    '\n\nNothing is saved until you press Save major.')) return;
        var id = c.id;
        state.major.courses.splice(i, 1);
        // A dangling prerequisite would fail server validation, so the pairs
        // that referenced this course go with it.
        state.major.prerequisites = (state.major.prerequisites || []).filter(function(p){
          return p[0] !== id && p[1] !== id;
        });
        markDirty(); render();
      });
    });
    // Deliberately unscheduled. This used to hard-code the first year and first
    // semester, so every course arrived in Y1 S1 no matter which term you were
    // looking at — the per-term buttons above are the answer to "where does it
    // go", and this one is for a course whose term is not decided yet.
    on('acAdd', 'click', function(){ addCourseAt('', null); });
  }

  function bindPrereqs(){
    on('apAdd', 'click', function(){
      var a = val('apBefore'), b = val('apAfter');
      if(!a || !b || a === b){ toast('Pick two different courses.'); return; }
      var exists = (state.major.prerequisites || []).some(function(p){ return p[0] === a && p[1] === b; });
      if(exists){ toast('That prerequisite is already there.'); return; }
      state.major.prerequisites = (state.major.prerequisites || []).concat([[a, b]]);
      markDirty(); render();
    });
    document.querySelectorAll('[data-del-pr]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var i = Number(btn.getAttribute('data-del-pr'));
        var p = state.major.prerequisites[i];
        if(!confirm('Remove this prerequisite?\n\n' + nameOf(p[0]) + '  →  ' + nameOf(p[1]) +
                    '\n\nThe second course becomes available without the first. ' +
                    'Nothing is saved until you press Save major.')) return;
        state.major.prerequisites.splice(i, 1);
        markDirty(); render();
      });
    });
  }

  function bindSchedule(){
    document.querySelectorAll('.admin-move').forEach(function(sel){
      sel.addEventListener('change', function(){
        var parts = sel.value.split('|');
        var c = state.major.courses[Number(sel.getAttribute('data-move'))];
        c.yearId = parts[0]; c.semester = parts[1];
        markDirty(); render();
      });
    });
    on('asAddYear', 'click', function(){
      var years = state.major.years || (state.major.years = []);
      years.push({ id: 'y' + (years.length + 1), hasSummer: false });
      markDirty(); render();
    });
    document.querySelectorAll('[data-del-year]').forEach(function(b){
      b.addEventListener('click', function(){
        var i = Number(b.getAttribute('data-del-year'));
        var y = state.major.years[i];
        var used = (state.major.courses || []).filter(function(c){ return c.yearId === y.id; }).length;
        if(!confirm('Remove year ' + y.id + '?' +
                    (used ? '\n\nIt still holds ' + used + ' course' + (used === 1 ? '' : 's') +
                            ', which would need a new year before this major can be saved.' : '') +
                    '\n\nNothing is saved until you press Save major.')) return;
        state.major.years.splice(i, 1);
        markDirty(); render();
      });
    });
    document.querySelectorAll('.ay-summer').forEach(function(cb, i){
      cb.addEventListener('change', function(){ state.major.years[i].hasSummer = cb.checked; markDirty(); render(); });
    });
  }

  // Round 8, idea 25: Save first shows what will change, then saves.
  function bindMajorSave(){
    on('amSave', 'click', function(){
      harvestCourses(); harvestMajorMeta();
      var lines = diffMajors(state.majorOrig, state.major);
      if(state.majorOrig && !lines.length){ setMsg('Nothing has changed since this major was opened.', 'ok'); return; }
      var el = document.getElementById('adminMsg');
      if(!el){ doSaveMajor(); return; }
      var adds = lines.filter(function(l){ return l.kind === 'add'; }).length,
          chg = lines.filter(function(l){ return l.kind === 'chg'; }).length,
          del = lines.filter(function(l){ return l.kind === 'del'; }).length;
      el.innerHTML = '<div class="adm-confirm"><b>Save these changes to ' + esc(state.major.name || state.majorSlug) + '?</b>' +
        '<p class="admin-hint">' + adds + ' added · ' + chg + ' changed · ' + del + ' removed</p>' +
        diffHtml(lines, 40) +
        '<div class="form-actions"><button type="button" class="home-btn admin-primary" id="amSaveGo">💾 Save these changes</button>' +
        '<button type="button" class="home-btn" id="amSaveBack">Back to editing</button></div></div>';
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      on('amSaveBack', 'click', function(){ el.innerHTML = ''; });
      on('amSaveGo', 'click', doSaveMajor);
    });
  }
  function doSaveMajor(){
      setMsg('Saving…', 'ok');
      api('PUT', '/api/major/' + state.uni + '/' + state.majorSlug,
          { major: state.major, baseSha: state.majorSha || '' })
        .then(function(res){
          state.major = res.major;
          state.majorSha = res.sha || '';
          state.majorOrig = clone(res.major);
          delete historyCache[state.uni + '/' + state.majorSlug];
          markClean();
          setMsg('Saved. Live for everyone in about a minute.', 'ok');
          // Refresh the browser too, not just the tree — a new major, a
          // renamed one, or one moved to another faculty has to appear in its
          // group, and the tree does not carry faculties.
          return loadTree().then(function(){
            return state.browseUni === state.uni ? loadBrowse(state.uni) : null;
          });
        })
        .catch(function(e){ setMsg(esc(e.message), 'err'); });
  }

  function bindAssets(){
    var pending = null;
    on('aaFile', 'change', function(e){
      var f = e.target.files && e.target.files[0];
      var btn = document.getElementById('aaUpload');
      var prev = document.getElementById('aaPreview');
      if(!f){ pending = null; btn.disabled = true; prev.innerHTML = ''; return; }
      var reader = new FileReader();
      reader.onload = function(){
        pending = { name: f.name, contentType: f.type, dataBase64: String(reader.result).split(',')[1] };
        btn.disabled = false;
        prev.innerHTML = '<div class="admin-logo-preview"><img src="' + String(reader.result) +
          '" alt="preview" style="max-width:160px;max-height:120px;object-fit:contain;"></div>' +
          '<p class="admin-hint">' + esc(f.name) + ' · ' + Math.round(f.size / 1024) + ' KB</p>';
      };
      reader.readAsDataURL(f);
    });
    on('aaUpload', 'click', function(){
      if(!pending) return;
      setMsg('Uploading…', 'ok');
      api('POST', '/api/assets', pending).then(function(res){
        setMsg('Uploaded as <code>' + esc(res.url) + '</code>. Paste that path into a logo or icon field.', 'ok');
        return refreshAssets();
      }).then(render).catch(function(e){ setMsg(esc(e.message), 'err'); });
    });
    document.querySelectorAll('[data-del-asset]').forEach(function(b){
      b.addEventListener('click', function(){
        var f = b.getAttribute('data-del-asset');
        if(!confirm('Delete ' + f + '? Anything still pointing at it will fall back to its icon.')) return;
        api('DELETE', '/api/assets/' + encodeURIComponent(f))
          .then(refreshAssets).then(render).catch(function(e){ toast(e.message); });
      });
    });
    document.querySelectorAll('[data-copy-asset]').forEach(function(b){
      b.addEventListener('click', function(){
        var v = b.getAttribute('data-copy-asset');
        if(navigator.clipboard) navigator.clipboard.writeText(v);
        toast('Copied ' + v);
      });
    });
  }

  function refreshAssets(){
    return api('GET', '/api/assets').then(function(res){ state.assets = res.assets || []; });
  }

  // =====================================================================
  // ROUND 8, BATCH E — the admin room on a laptop (ideas 23–30).
  // =====================================================================
  function clone(o){ return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function termTx(c){
    if(!c || !c.yearId) return 'unscheduled';
    var s = semKey(c);
    return c.yearId.toUpperCase() + ' · ' + (s === 's3' ? 'Summer' : (s || '?').toUpperCase());
  }
  function cName(c){ return (c && (c.name || c.courseNumber || c.id)) || '?'; }

  // ---- 25 · what changed, in plain words -------------------------------------------
  // Used before a save (what this save will do) and in the history (what each
  // past save did). Lines are { kind: 'add' | 'chg' | 'del', text }.
  function diffMajors(a, b){
    a = a || {}; b = b || {};
    var out = [];
    var push = function(kind, text){ out.push({ kind: kind, text: text }); };
    var byId = function(m){ var o = {}; (m.courses || []).forEach(function(c){ o[c.id] = c; }); return o; };
    var A = byId(a), B = byId(b);
    Object.keys(B).forEach(function(id){
      var n = B[id], o = A[id];
      if(!o){ push('add', 'Added ' + cName(n) + ' (' + termTx(n) + ', ' + (Number(n.creditHours) || 0) + ' CH)'); return; }
      if((o.name || '') !== (n.name || '')) push('chg', 'Renamed ' + cName(o) + ' → ' + cName(n));
      if((o.nameAr || '') !== (n.nameAr || '')) push('chg', cName(n) + ': Arabic name ' + (o.nameAr ? '“' + o.nameAr + '”' : '(none)') + ' → ' + (n.nameAr ? '“' + n.nameAr + '”' : '(none)'));
      if((o.courseNumber || '') !== (n.courseNumber || '')) push('chg', cName(n) + ': code ' + (o.courseNumber || '(none)') + ' → ' + (n.courseNumber || '(none)'));
      if((Number(o.creditHours) || 0) !== (Number(n.creditHours) || 0)) push('chg', cName(n) + ': ' + (Number(o.creditHours) || 0) + ' CH → ' + (Number(n.creditHours) || 0) + ' CH');
      if((o.category || '') !== (n.category || '')) push('chg', cName(n) + ': category ' + (o.category || '—') + ' → ' + (n.category || '—'));
      if(termTx(o) !== termTx(n)) push('chg', 'Moved ' + cName(n) + ': ' + termTx(o) + ' → ' + termTx(n));
    });
    Object.keys(A).forEach(function(id){ if(!B[id]) push('del', 'Removed ' + cName(A[id]) + ' (' + termTx(A[id]) + ')'); });
    var pairKey = function(p){ return p[0] + '>' + p[1]; };
    var pa = {}, pb = {};
    (a.prerequisites || []).forEach(function(p){ pa[pairKey(p)] = p; });
    (b.prerequisites || []).forEach(function(p){ pb[pairKey(p)] = p; });
    var nm = function(id){ return cName(B[id] || A[id] || { id: id }); };
    Object.keys(pb).forEach(function(k){ if(!pa[k]) push('add', 'New prerequisite: ' + nm(pb[k][0]) + ' → ' + nm(pb[k][1])); });
    Object.keys(pa).forEach(function(k){ if(!pb[k]) push('del', 'Prerequisite removed: ' + nm(pa[k][0]) + ' → ' + nm(pa[k][1])); });
    var yrs = function(m){ return (m.years || []).map(function(y){ return y.id + (y.hasSummer ? '+summer' : ''); }).join(', '); };
    if(yrs(a) !== yrs(b)) push('chg', 'Years: ' + (yrs(a) || 'none') + ' → ' + (yrs(b) || 'none'));
    [['name', 'Name'], ['nameAr', 'Arabic name'], ['subtitle', 'Subtitle'], ['college', 'Faculty'], ['degreeHours', 'Degree hours'],
     ['icon', 'Icon'], ['imageUrl', 'Image'], ['bio', 'Description'], ['bioAr', 'Arabic description'], ['sortOrder', 'Order']].forEach(function(f){
      var x = a[f[0]] == null ? '' : String(a[f[0]]), y = b[f[0]] == null ? '' : String(b[f[0]]);
      if(x !== y) push('chg', f[1] + ': ' + (x ? (x.length > 40 ? x.slice(0, 40) + '…' : x) : '(empty)') + ' → ' + (y ? (y.length > 40 ? y.slice(0, 40) + '…' : y) : '(empty)'));
    });
    return out;
  }
  function diffHtml(lines, max){
    var shown = max ? lines.slice(0, max) : lines;
    return '<ul class="adm-diff">' + shown.map(function(l){
      return '<li class="adm-diff-' + l.kind + '"><span aria-hidden="true">' + (l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : '~') + '</span>' + esc(l.text) + '</li>';
    }).join('') + '</ul>' + (max && lines.length > max ? '<p class="admin-hint">…and ' + (lines.length - max) + ' more.</p>' : '');
  }

  // ---- 29 · problems in a plan ------------------------------------------------------
  function problemsOf(m){
    var out = [];
    if(!m) return out;
    var courses = m.courses || [];
    var ids = {}, byNum = {};
    courses.forEach(function(c, i){
      ids[c.id] = i;
      var n = (c.courseNumber || '').trim();
      if(n) (byNum[n] = byNum[n] || []).push(i);
    });
    var years = {};
    (m.years || []).forEach(function(y){ years[y.id] = y; });
    courses.forEach(function(c, i){
      if(!String(c.name || '').trim() || c.name === 'New course') out.push({ sev: 'bad', text: 'A course has no real name' + (c.courseNumber ? ' (' + c.courseNumber + ')' : ''), i: i });
      if(!(Number(c.creditHours) > 0) && ['core', 'math', 'dept'].indexOf(c.category) !== -1) out.push({ sev: 'warn', text: cName(c) + ' has 0 hours', i: i });
      if(c.yearId && !years[c.yearId]) out.push({ sev: 'bad', text: cName(c) + ' is in ' + c.yearId.toUpperCase() + ', which this plan doesn’t have', i: i });
      else if(c.yearId && semKey(c) === 's3' && !years[c.yearId].hasSummer) out.push({ sev: 'bad', text: cName(c) + ' is in a summer that ' + c.yearId.toUpperCase() + ' doesn’t have', i: i });
      if(!c.yearId) out.push({ sev: 'warn', text: cName(c) + ' isn’t placed in a year', i: i });
    });
    Object.keys(byNum).forEach(function(n){
      if(byNum[n].length > 1) out.push({ sev: 'bad', text: 'Code ' + n + ' is used by ' + byNum[n].length + ' courses', i: byNum[n][1] });
    });
    var next = {};
    (m.prerequisites || []).forEach(function(p){
      if(!(p[0] in ids) || !(p[1] in ids)) out.push({ sev: 'bad', text: 'A prerequisite points at a course that isn’t in this plan (' + (p[0] in ids ? p[1] : p[0]) + ')' });
      else (next[p[0]] = next[p[0]] || []).push(p[1]);
    });
    // A loop: a course that (through others) needs itself.
    var state2 = {}, loopAt = null;
    var visit = function(id){
      if(loopAt) return;
      state2[id] = 1;
      (next[id] || []).forEach(function(n){ if(state2[n] === 1 && !loopAt) loopAt = [id, n]; else if(!state2[n]) visit(n); });
      state2[id] = 2;
    };
    Object.keys(next).forEach(function(id){ if(!state2[id]) visit(id); });
    if(loopAt) out.push({ sev: 'bad', text: 'Prerequisite loop: ' + cName(courses[ids[loopAt[0]]]) + ' ⇄ ' + cName(courses[ids[loopAt[1]]]) + ' (the server will refuse to save)' });
    // Heavy terms.
    var load = {};
    courses.forEach(function(c){ if(c.yearId && semKey(c)){ var k = c.yearId + '|' + semKey(c); load[k] = (load[k] || 0) + (Number(c.creditHours) || 0); } });
    Object.keys(load).forEach(function(k){
      var p = k.split('|'), cap = p[1] === 's3' ? 9 : 21;
      if(load[k] > cap) out.push({ sev: 'warn', text: p[0].toUpperCase() + ' · ' + (p[1] === 's3' ? 'Summer' : p[1].toUpperCase()) + ' has ' + load[k] + ' CH (over ' + cap + ')' });
    });
    var noAr = courses.filter(function(c){ return !String(c.nameAr || '').trim(); }).length;
    if(noAr) out.push({ sev: 'info', text: noAr + ' course' + (noAr === 1 ? ' has' : 's have') + ' no Arabic name' });
    return out;
  }
  function problemsHtml(){
    var list = problemsOf(state.major);
    var bad = list.filter(function(x){ return x.sev !== 'info'; }).length;
    if(!list.length) return '<div class="adm-probs is-ok">✓ No problems found in this plan.</div>';
    return '<details class="adm-probs"' + (bad ? ' open' : '') + '><summary>' + (bad ? '⚠️ ' + bad + ' problem' + (bad === 1 ? '' : 's') + ' in this plan' : 'ℹ️ A note on this plan') + '</summary><ul>' +
      list.map(function(x){
        return '<li class="adm-prob-' + x.sev + '">' + (x.i != null ? '<button type="button" class="admin-linkbtn" data-prob-go="' + x.i + '">' + esc(x.text) + '</button>' : esc(x.text)) + '</li>';
      }).join('') + '</ul></details>';
  }
  function goToCourse(i){
    if(state.section !== 'courses'){ harvestCourses(); state.section = 'courses'; render(); }
    var row = document.querySelector('[data-course="' + i + '"]');
    if(!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('is-autofilled');
    setTimeout(function(){ row.classList.remove('is-autofilled'); }, 1400);
    var inp = row.querySelector('.cc-name');
    if(inp) inp.focus({ preventScroll: true });
  }

  // ---- 24 · paste rows from Excel -----------------------------------------------------
  function pasteToolHtml(){
    var years = (state.major || {}).years || [];
    var termOpts = '<option value="">unscheduled</option>' + years.map(function(y){
      return ['s1', 's2'].concat(y.hasSummer ? ['s3'] : []).map(function(sm){
        return '<option value="' + esc(y.id + '|' + sm) + '">' + esc(y.id.toUpperCase()) + ' · ' + SEM_LABEL[sm] + '</option>';
      }).join('');
    }).join('');
    return '<details class="admin-picker" id="acPaste"><summary>📋 Paste rows from Excel</summary><div class="admin-picker-body">' +
      '<p class="admin-hint">Copy rows from a spreadsheet (code, name, Arabic name, hours, in any order) and paste them here. ' +
      'Rows whose code is already in this plan update that course; the rest are added. Nothing changes until you press Apply, and nothing is saved until Save major.</p>' +
      '<textarea id="acPasteBox" rows="5" placeholder="290312210&#9;Reinforcement Learning&#9;التعلم المعزز&#9;3"></textarea>' +
      '<div class="admin-row"><label class="admin-hint" for="acPasteTerm">New courses go to</label><select id="acPasteTerm">' + termOpts + '</select></div>' +
      '<div id="acPastePreview"></div></div></details>';
  }
  function parsePasted(text){
    var lines = String(text || '').split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean);
    var sep = lines.some(function(l){ return l.indexOf('\t') !== -1; }) ? '\t' : (lines.some(function(l){ return l.indexOf(';') !== -1; }) ? ';' : ',');
    var rows = [];
    lines.forEach(function(l){
      var cells = l.split(sep).map(function(x){ return x.trim().replace(/^"|"$/g, ''); }).filter(function(x){ return x !== ''; });
      var r = { courseNumber: '', name: '', nameAr: '', creditHours: null };
      cells.forEach(function(x){
        if(!r.courseNumber && /^\d{6,12}$/.test(x)) r.courseNumber = x;
        else if(r.creditHours === null && /^\d{1,2}(\.\d)?$/.test(x)) r.creditHours = Number(x);
        else if(!r.nameAr && /[؀-ۿ]/.test(x)) r.nameAr = x;
        else if(!r.name) r.name = x;
      });
      // A header row ("Code, Name, Hours") has no code and no hours.
      if(!r.courseNumber && r.creditHours === null && /code|name|course|hours|اسم|رقم|ساعات/i.test(l)) return;
      if(r.name || r.courseNumber) rows.push(r);
    });
    return rows;
  }
  function planPaste(rows){
    var courses = state.major.courses || [];
    return rows.map(function(r){
      var hit = null;
      courses.forEach(function(c, i){
        if(hit) return;
        if(r.courseNumber && (c.courseNumber || '').trim() === r.courseNumber) hit = { c: c, i: i };
        else if(!r.courseNumber && r.name && (c.name || '').trim().toLowerCase() === r.name.toLowerCase()) hit = { c: c, i: i };
      });
      if(!hit) return { kind: 'add', r: r };
      var changes = [];
      if(r.name && r.name !== hit.c.name) changes.push('name');
      if(r.nameAr && r.nameAr !== hit.c.nameAr) changes.push('Arabic name');
      if(r.creditHours !== null && r.creditHours !== Number(hit.c.creditHours)) changes.push('hours');
      return { kind: changes.length ? 'chg' : 'same', r: r, i: hit.i, changes: changes };
    });
  }
  function renderPastePreview(){
    var box = document.getElementById('acPastePreview');
    var ta = document.getElementById('acPasteBox');
    if(!box || !ta) return;
    var plan = planPaste(parsePasted(ta.value));
    if(!plan.length){ box.innerHTML = ''; return; }
    var adds = plan.filter(function(x){ return x.kind === 'add'; }).length, chg = plan.filter(function(x){ return x.kind === 'chg'; }).length;
    box.innerHTML = '<table class="admin-table"><thead><tr><th>Code</th><th>Name</th><th>Arabic</th><th>CH</th><th></th></tr></thead><tbody>' +
      plan.map(function(x){
        return '<tr class="adm-paste-' + x.kind + '"><td>' + esc(x.r.courseNumber || '—') + '</td><td>' + esc(x.r.name || '—') + '</td><td dir="rtl">' + esc(x.r.nameAr || '') + '</td><td>' +
          (x.r.creditHours === null ? '—' : x.r.creditHours) + '</td><td>' + (x.kind === 'add' ? 'new' : x.kind === 'chg' ? 'changes ' + esc(x.changes.join(', ')) : 'already the same') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="form-actions"><button type="button" class="home-btn admin-primary" id="acPasteApply"' + (adds + chg ? '' : ' disabled') + '>Apply: ' +
        adds + ' new, ' + chg + ' changed</button></div>';
    on('acPasteApply', 'click', function(){
      harvestCourses();
      var term = String(val('acPasteTerm') || '').split('|');
      plan.forEach(function(x){
        if(x.kind === 'add'){
          state.major.courses.push({ id: newCourseId(), courseNumber: x.r.courseNumber, name: x.r.name || x.r.courseNumber, nameAr: x.r.nameAr,
            creditHours: x.r.creditHours === null ? 3 : x.r.creditHours, category: 'core', yearId: term[0] || '', semester: term[1] || '' });
        } else if(x.kind === 'chg'){
          var c = state.major.courses[x.i];
          if(x.r.name) c.name = x.r.name;
          if(x.r.nameAr) c.nameAr = x.r.nameAr;
          if(x.r.creditHours !== null) c.creditHours = x.r.creditHours;
        }
      });
      markDirty(); render();
      toast('Applied ' + adds + ' new and ' + chg + ' changed. Press Save major to publish.');
    });
  }

  // ---- 28 · where is this course used? -----------------------------------------------
  var feedCache = null;
  function loadFeed(){
    if(feedCache) return Promise.resolve(feedCache);
    return fetch('plans.json', { cache: 'no-store' }).then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(f){ feedCache = f; return f; });
  }
  function whereUsedHtml(){
    return '<details class="admin-picker" id="acWhere"><summary>🔎 Where is a course used?</summary><div class="admin-picker-body">' +
      '<p class="admin-hint">Every published plan that has it, and where in the plan. Handy before renaming a course or changing its hours: each of those plans has its own copy to update.</p>' +
      '<input type="text" id="acWhereQ" placeholder="Course code or name…"><div id="acWhereOut"></div></div></details>';
  }
  function runWhere(q){
    var out = document.getElementById('acWhereOut');
    if(!out) return;
    q = String(q || '').trim().toLowerCase();
    if(q.length < 3){ out.innerHTML = '<p class="admin-hint">Type at least three characters.</p>'; return; }
    loadFeed().then(function(feed){
      var hits = [];
      (feed.plans || []).forEach(function(p){
        (p.courses || []).forEach(function(c){
          var num = String(c.courseNumber || c.id || '').toLowerCase();
          if(num === q || String(c.name || '').toLowerCase().indexOf(q) !== -1 || String(c.ar || '').indexOf(q) !== -1){
            var mn = p.majorName && p.majorName.en ? (p.majorName.en.big || p.majorName.en) : p.id;
            hits.push({ major: String(mn), uni: p.university, course: c.name, num: c.courseNumber || '', where: c.yearId ? (c.yearId.toUpperCase() + ' · ' + (c.semester === 's3' ? 'Summer' : String(c.semester || '').toUpperCase())) : 'unscheduled', hours: c.creditHours });
          }
        });
      });
      var byCourse = {};
      hits.forEach(function(h){ var k = (h.num || h.course); (byCourse[k] = byCourse[k] || []).push(h); });
      var keys = Object.keys(byCourse).slice(0, 12);
      out.innerHTML = keys.length ? keys.map(function(k){
        var list = byCourse[k];
        var hrs = {}; list.forEach(function(h){ hrs[h.hours] = 1; });
        return '<div class="adm-where"><b>' + esc(list[0].course) + (list[0].num ? ' <span class="admin-sub">' + esc(list[0].num) + '</span>' : '') + '</b>' +
          '<span class="admin-sub"> is in ' + list.length + ' plan' + (list.length === 1 ? '' : 's') + (Object.keys(hrs).length > 1 ? ' · ⚠️ hours differ: ' + esc(Object.keys(hrs).join(' / ')) : '') + '</span>' +
          '<ul>' + list.map(function(h){ return '<li>' + esc(h.major) + ' <span class="admin-sub">(' + esc(h.uni) + ') · ' + esc(h.where) + ' · ' + esc(h.hours) + ' CH</span></li>'; }).join('') + '</ul></div>';
      }).join('') : '<p class="admin-hint">Not found in any published plan.</p>';
    }).catch(function(e){ out.innerHTML = '<p class="admin-hint admin-warn">Could not read the catalogue (' + esc(e.message) + ').</p>'; });
  }

  // ---- 30 · change history with Put back ---------------------------------------------
  function historyHtml(){
    return '<details class="admin-picker" id="acHistory"><summary>🕘 Change history</summary><div class="admin-picker-body" id="acHistoryBody">' +
      '<p class="admin-hint">Loading…</p></div></details>';
  }
  var historyCache = {};
  function loadHistory(){
    var body = document.getElementById('acHistoryBody');
    if(!body || !state.major) return;
    var key = state.uni + '/' + state.majorSlug;
    var draw = function(h){
      if(!document.getElementById('acHistoryBody')) return;
      body = document.getElementById('acHistoryBody');
      if(h.error){ body.innerHTML = '<p class="admin-hint admin-warn">' + esc(h.error) + '</p>'; return; }
      if(!h.commits.length){ body.innerHTML = '<p class="admin-hint">No saved changes yet.</p>'; return; }
      body.innerHTML = '<p class="admin-hint">Newest first. Put back loads that version into the editor; nothing changes until you press Save major, which shows exactly what it will undo first.</p>' +
        h.commits.map(function(c, i){
          var d = c.date ? new Date(c.date) : null;
          return '<div class="adm-hist"><div class="adm-hist-h"><b>' + esc(d ? d.toLocaleString() : '') + '</b><span class="admin-sub">' + esc(c.message) + '</span>' +
            (i > 0 ? '<button type="button" class="home-btn admin-mini" data-hist-back="' + esc(c.sha) + '">Put back</button>' : '<span class="admin-sub">current</span>') + '</div>' +
            '<div class="adm-hist-d" data-hist-diff="' + i + '">' + (c.lines ? (c.lines.length ? diffHtml(c.lines, 4) : '<p class="admin-hint">No change to the plan itself.</p>') : '<p class="admin-hint">…</p>') + '</div></div>';
        }).join('');
      body.querySelectorAll('[data-hist-back]').forEach(function(b){
        b.addEventListener('click', function(){ putBack(b.getAttribute('data-hist-back')); });
      });
    };
    if(historyCache[key]){ draw(historyCache[key]); return; }
    api('GET', '/api/history/' + state.uni + '/' + state.majorSlug).then(function(res){
      var h = { commits: res.commits || [] };
      historyCache[key] = h;
      draw(h);
      // What each save changed: that version against the one before it.
      var versions = {};
      var get = function(sha){
        if(!versions[sha]) versions[sha] = api('GET', '/api/major/' + state.uni + '/' + state.majorSlug + '?ref=' + sha).then(function(r){ return r.major; }).catch(function(){ return null; });
        return versions[sha];
      };
      var chain = Promise.resolve();
      h.commits.slice(0, 10).forEach(function(c, i){
        chain = chain.then(function(){
          var prev = h.commits[i + 1];
          return Promise.all([get(c.sha), prev ? get(prev.sha) : Promise.resolve({})]).then(function(pair){
            c.lines = pair[0] ? diffMajors(pair[1] || {}, pair[0]) : [];
            var slot = document.querySelector('[data-hist-diff="' + i + '"]');
            if(slot) slot.innerHTML = c.lines.length ? diffHtml(c.lines, 4) : '<p class="admin-hint">No change to the plan itself.</p>';
          });
        });
      });
    }).catch(function(e){ historyCache[key] = { error: e.message }; draw(historyCache[key]); });
  }
  function putBack(sha){
    if(state.dirty && !confirm('You have unsaved changes. Replace them with this older version?')) return;
    api('GET', '/api/major/' + state.uni + '/' + state.majorSlug + '?ref=' + sha).then(function(res){
      state.major = res.major;
      markDirty();
      render();
      var lines = diffMajors(state.majorOrig, state.major);
      setMsg('Loaded the version from that save. Saving would make these changes:' + diffHtml(lines, 8) + 'Press 💾 Save major to make it live, or reopen the major to cancel.', 'ok');
    }).catch(function(e){ toast(e.message); });
  }

  // ---- 27 · what students will see ---------------------------------------------------
  var PREVIEW_KEY = 'aaup_adminPreview';
  function previewOn(){ try{ return localStorage.getItem(PREVIEW_KEY) !== '0'; }catch(e){ return true; } }
  var previewTimer = null;
  function schedulePreview(){ clearTimeout(previewTimer); previewTimer = setTimeout(drawPreview, 150); }
  function drawPreview(){
    var host = document.getElementById('adminPreview');
    var shell = document.querySelector('#adminOverlay .admin-body');
    var want = !!state.major && ['courses', 'schedule', 'prereqs', 'majors'].indexOf(state.section) !== -1 && previewOn();
    if(!want){ if(host) host.remove(); if(shell) shell.classList.remove('has-preview'); return; }
    if(!host && shell){
      host = document.createElement('aside');
      host.id = 'adminPreview';
      host.className = 'adm-preview';
      shell.appendChild(host);
    }
    if(!host) return;
    shell.classList.add('has-preview');
    // Read what is typed right now, without disturbing the form.
    var m = clone(state.major);
    document.querySelectorAll('[data-course]').forEach(function(r){
      var c = m.courses[Number(r.getAttribute('data-course'))];
      if(!c) return;
      var g = function(sel){ var el = r.querySelector(sel); return el ? el.value : null; };
      if(g('.cc-name') !== null) c.name = g('.cc-name').trim();
      if(g('.cc-ch') !== null) c.creditHours = Number(g('.cc-ch')) || 0;
      if(g('.cc-year') !== null) c.yearId = g('.cc-year');
      if(g('.cc-sem') !== null) c.semester = g('.cc-sem');
      if(g('.cc-cat') !== null) c.category = g('.cc-cat');
    });
    var years = m.years || [];
    host.innerHTML = '<div class="adm-preview-h"><b>📱 What students see</b><button type="button" class="admin-linkbtn" id="adminPreviewHide">Hide</button></div>' +
      '<div class="adm-phone"><div class="adm-phone-s"><div class="adm-phone-t">' + esc(m.name || state.majorSlug) + '</div>' +
      years.map(function(y, yi){
        return '<div class="adm-phone-y">Year ' + (yi + 1) + '</div>' +
          ['s1', 's2'].concat(y.hasSummer ? ['s3'] : []).map(function(sm){
            var list = (m.courses || []).filter(function(c){ return c.yearId === y.id && semKey(c) === sm; });
            if(!list.length) return '';
            return '<div class="adm-phone-sem">' + (sm === 's3' ? 'Summer' : sm === 's1' ? 'First semester' : 'Second semester') +
              ' · ' + list.reduce(function(n, c){ return n + (Number(c.creditHours) || 0); }, 0) + 'H</div>' +
              '<div class="adm-phone-grid">' + list.map(function(c){
                return '<div class="adm-phone-c cat-' + esc(c.category || 'core') + '"><b>' + esc(c.name || '(no name)') + '</b><span>' + (Number(c.creditHours) || 0) + 'H</span></div>';
              }).join('') + '</div>';
          }).join('');
      }).join('') + '</div></div>';
    var hide = document.getElementById('adminPreviewHide');
    if(hide) hide.addEventListener('click', function(){ try{ localStorage.setItem(PREVIEW_KEY, '0'); }catch(e){} drawPreview(); toast('Preview hidden. Turn it back on in Settings.'); });
  }

  // ---- 23 · the Courses table as a spreadsheet ---------------------------------------
  // Enter or ↓ goes to the same column one row down, ↑ one row up; a cell
  // that differs from the version that was opened is marked.
  var FIELD_OF = { 'cc-num': 'courseNumber', 'cc-name': 'name', 'cc-namear': 'nameAr', 'cc-ch': 'creditHours' };
  function markChanged(inp){
    var row = inp.closest('[data-course]');
    var cls = Object.keys(FIELD_OF).filter(function(k){ return inp.classList.contains(k); })[0];
    if(!row || !cls || !state.major) return;
    var c = state.major.courses[Number(row.getAttribute('data-course'))];
    var orig = c && (state.majorOrig && (state.majorOrig.courses || []).filter(function(o){ return o.id === c.id; })[0]);
    var was = orig ? orig[FIELD_OF[cls]] : null;
    var now = cls === 'cc-ch' ? Number(inp.value) || 0 : inp.value.trim();
    var same = orig ? String(cls === 'cc-ch' ? (Number(was) || 0) : (was || '')) === String(now) : false;
    inp.classList.toggle('is-changed', !same);
    inp.title = !orig ? 'New course' : (same ? '' : 'Was: ' + (was == null || was === '' ? '(empty)' : was));
  }
  function bindSheet(){
    var cols = ['cc-num', 'cc-name', 'cc-namear', 'cc-ch'];
    cols.forEach(function(cls){
      var all = Array.prototype.slice.call(document.querySelectorAll('[data-course] .' + cls));
      all.forEach(function(inp, i){
        markChanged(inp);
        inp.addEventListener('input', function(){ markChanged(inp); schedulePreview(); });
        inp.addEventListener('keydown', function(e){
          var to = null;
          if(e.key === 'Enter' || (e.key === 'ArrowDown' && inp.type !== 'number')) to = all[i + 1];
          else if(e.key === 'ArrowUp' && inp.type !== 'number') to = all[i - 1];
          if(e.key === 'Enter' || to){
            e.preventDefault();
            if(to){ to.focus(); if(to.select) to.select(); }
          }
        });
      });
    });
    document.querySelectorAll('[data-course] select').forEach(function(s){ s.addEventListener('change', schedulePreview); });
  }

  // ---- 26 · Ctrl+S, and not losing work ---------------------------------------------
  document.addEventListener('keydown', function(e){
    if(!(e.ctrlKey || e.metaKey) || e.altKey || String(e.key).toLowerCase() !== 's') return;
    var ov = document.getElementById('adminOverlay');
    if(!ov || !ov.classList.contains('open') || !state.token) return;
    e.preventDefault();
    var btn = document.getElementById('amSaveGo') || document.getElementById('amSave');
    if(btn) btn.click();
    else if(state.major && state.dirty){ harvestCourses(); state.section = 'courses'; render(); toast('Here is the major with unsaved changes — press Ctrl+S again to save it.'); }
    else toast('Nothing to save here.');
  });
  window.addEventListener('beforeunload', function(e){
    var ov = document.getElementById('adminOverlay');
    if(state.dirty && ov && ov.classList.contains('open')){ e.preventDefault(); e.returnValue = ''; }
  });

  // Everything above, wired after each render of a major's sections.
  function bindPlus(){
    document.querySelectorAll('[data-prob-go]').forEach(function(b){
      b.addEventListener('click', function(){ goToCourse(Number(b.getAttribute('data-prob-go'))); });
    });
    if(state.section === 'courses') bindSheet();
    var pbox = document.getElementById('acPasteBox');
    if(pbox){
      pbox.addEventListener('input', renderPastePreview);
      pbox.addEventListener('paste', function(){ setTimeout(renderPastePreview, 0); });
    }
    var wq = document.getElementById('acWhereQ');
    if(wq){
      var t = null;
      wq.addEventListener('input', function(){ clearTimeout(t); t = setTimeout(function(){ runWhere(wq.value); }, 200); });
    }
    var hist = document.getElementById('acHistory');
    if(hist) hist.addEventListener('toggle', function(){ if(hist.open) loadHistory(); });
    drawPreview();
  }

  // ---------- open / close ----------

  function open(){
    ensureOverlay();
    document.getElementById('adminOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    try{ state.token = state.token || sessionStorage.getItem(TOKEN_KEY); }catch(e){}
    if(state.token && !state.tree){
      api('GET', '/api/status').then(function(me){
        state.username = me.username || '';
        state.status = me;
        return loadTree();
      }).then(function(){ return refreshAssets().catch(function(){}); })
        .then(render)
        .catch(function(){ signOut(true); render(); });
    } else {
      render();
    }
  }

  function close(){
    if(state.dirty && !confirm('You have unsaved changes. Close anyway?')) return;
    if(staffMode){ endStaff(); return; }
    var el = document.getElementById('adminOverlay');
    if(el) el.classList.remove('open');
    document.body.style.overflow = '';
    if(location.hash === '#admin'){
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  // A dean's "Edit this major" (js/110-staff-room.js): the editor, with their
  // staff login, straight on that major.
  function openStaff(token, label, uni, slug){
    if(state.token && !staffMode && state.token !== token && !confirm('You are signed in to the admin room in this tab. Open the dean\'s editor instead?')) return;
    staffMode = { label: label };
    state.token = token; state.username = label; state.tree = null; state.major = null; state.dirty = false;
    state.browseUni = null; state.browseMajors = null; state.browseFaculties = null;
    state.section = 'courses';
    ensureOverlay();
    document.getElementById('adminOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    api('GET', '/api/status').then(function(st){ state.status = st; return loadTree(); })
      .then(function(){ return slug ? openMajor(uni, slug) : null; })
      .then(function(){ state.section = slug ? 'courses' : 'majors'; render(); })
      .catch(function(e){ toast(e.message); render(); });
  }

  window.AAUP_ADMIN = { open: open, close: close, openStaff: openStaff, isOpen: function(){
    var el = document.getElementById('adminOverlay');
    return !!(el && el.classList.contains('open'));
  } };

  function checkHash(){ if(location.hash === '#admin') open(); }
  window.addEventListener('hashchange', checkHash);
  if(document.readyState === 'complete') checkHash();
  else window.addEventListener('load', checkHash);
})();
