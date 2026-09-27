// ==========================
// STORY IMAGE — a tall progress picture for Instagram and WhatsApp stories.
//
// Opened from Share (js/72-share.js). Drawn on a 1080×1920 canvas, the size
// stories use, so it is sharp when posted. By default it shows progress only:
// no grades. The student can add their GPA, show or hide the finish term, and
// pick one of three colours before saving or sharing. Nothing leaves the
// device unless they choose Share.
// ==========================
(function(){
  'use strict';

  var W = 1080, H = 1920;
  var COLOURS = [
    { id: 'blue',  top: '#3b4a9a', mid: '#1b2350', bot: '#0b0f22', ring: '#8fa5ff', well: '#0f1430' },
    { id: 'green', top: '#1f6b52', mid: '#123a31', bot: '#07130f', ring: '#5fd3a0', well: '#0c1d18' },
    { id: 'plum',  top: '#6b2f5a', mid: '#3a1a33', bot: '#140910', ring: '#f08ccf', well: '#1e0d19' }
  ];
  var opts = { gpa: false, finish: true, colour: 'blue' };

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s)) : String(s); }

  // Everything the picture says, from the same sources the rest of the app uses.
  function facts(prefix){
    var rows = window.AAUP_AUDIT ? window.AAUP_AUDIT.computeAudit(prefix) : [];
    var total = 0, done = 0;
    rows.forEach(function(r){ total += r.total; done += r.completed; });
    var plan = window.AAUP_IMPORTED ? window.AAUP_IMPORTED.loadImportedPlans()[prefix] : null;
    var progress = window.__getProgress ? window.__getProgress() : {};
    var passed = 0, semsDone = 0;
    if(plan && plan.structure && Array.isArray(plan.structure.years)){
      (plan.courses || []).forEach(function(c){ if(progress[prefix + '-c-' + c.id]) passed++; });
      plan.structure.years.forEach(function(y){
        ['s1', 's2', 's3'].forEach(function(s){
          var here = (plan.courses || []).filter(function(c){ return c.yearId === y.id && c.semester === s; });
          if(here.length && here.every(function(c){ return progress[prefix + '-c-' + c.id]; })) semsDone++;
        });
      });
    }
    var mn = plan && plan.majorName ? (ar() && plan.majorName.ar ? plan.majorName.ar : plan.majorName.en) : '';
    var parts = mn && window.AAUP_IMPORTED.nameParts ? window.AAUP_IMPORTED.nameParts(mn) : { big: mn, small: '' };
    var tmp = document.createElement('div');
    tmp.innerHTML = [parts.big, parts.small].filter(Boolean).join(' ');
    var name = (tmp.textContent || '').replace(/\s+/g, ' ').trim() || prefix;
    var fin = window.AAUP_GRADUATION && window.AAUP_GRADUATION.estimate ? window.AAUP_GRADUATION.estimate(prefix, ar()) : null;
    var g = window.AAUP_GPA && window.AAUP_GPA.gpaFor ? window.AAUP_GPA.gpaFor(prefix, null) : { gpa: null };
    return {
      name: name, pct: total ? Math.round(done / total * 100) : 0, done: Math.round(done), total: Math.round(total),
      passed: passed, semsDone: semsDone, finish: fin ? fin.term : '', gpa: g.gpa
    };
  }

  // Wraps a line to the width, returning the lines (for a long major name).
  function wrap(ctx, text, max){
    var words = String(text).split(' '), lines = [], line = '';
    words.forEach(function(w){
      var test = line ? line + ' ' + w : w;
      if(ctx.measureText(test).width > max && line){ lines.push(line); line = w; } else { line = test; }
    });
    if(line) lines.push(line);
    return lines.slice(0, 3);
  }

  function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw(canvas, f){
    var c = COLOURS.filter(function(x){ return x.id === opts.colour; })[0] || COLOURS[0];
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var font = "'Cairo', -apple-system, 'Segoe UI', Roboto, sans-serif";
    ctx.direction = ar() ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';

    var bg = ctx.createRadialGradient(W / 2, 0, 60, W / 2, 0, H * 0.95);
    bg.addColorStop(0, c.top); bg.addColorStop(0.45, c.mid); bg.addColorStop(1, c.bot);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '800 34px ' + font;
    ctx.fillText(L('ARAB AMERICAN UNIVERSITY', 'الجامعة العربية الأمريكية'), W / 2, 230);

    ctx.fillStyle = '#fff';
    ctx.font = '900 66px ' + font;
    var lines = wrap(ctx, f.name, W - 200);
    lines.forEach(function(l, i){ ctx.fillText(l, W / 2, 330 + i * 80); });
    var y0 = 330 + (lines.length - 1) * 80;

    // The ring.
    var cx = W / 2, cy = y0 + 330, R = 230;
    ctx.lineWidth = 46; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    if(f.pct > 0){
      ctx.strokeStyle = c.ring;
      ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, f.pct / 100)); ctx.stroke();
    }
    ctx.fillStyle = c.well;
    ctx.beginPath(); ctx.arc(cx, cy, R - 40, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '900 128px ' + font;
    ctx.fillText(f.pct + '%', cx, cy + 30);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.font = '800 34px ' + font;
    ctx.fillText(L('DONE', 'منجز'), cx, cy + 90);

    // The headline and the line under it.
    var yH = cy + R + 150;
    ctx.fillStyle = '#fff';
    ctx.font = '900 64px ' + font;
    ctx.fillText(f.semsDone === 1 ? L('1 semester down', 'خلّصت فصل واحد')
      : L(f.semsDone + ' semesters down', 'خلّصت ' + f.semsDone + ' فصول'), W / 2, yH);
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = '600 38px ' + font;
    var sub = L(f.done + ' of ' + f.total + ' hours', f.done + ' من ' + f.total + ' ساعة');
    if(opts.finish && f.finish) sub += L(' · finishing ' + f.finish, ' · التخرج ' + f.finish);
    ctx.fillText(sub, W / 2, yH + 70);

    // Two equal boxes: the number large, what it counts underneath.
    var boxes = [];
    if(opts.gpa && f.gpa != null) boxes.push([f.gpa.toFixed(2), L('GPA', 'المعدل')]);
    boxes.push([String(f.passed), L('courses passed', 'مساق منجز')]);
    if(boxes.length < 2) boxes.push([String(Math.max(0, f.total - f.done)), L('hours to go', 'ساعة باقية')]);
    var bw = 380, bh = 210, gap = 40, bx = (W - (bw * 2 + gap)) / 2, by = yH + 150;
    boxes.forEach(function(b, i){
      var x = bx + i * (bw + gap);
      ctx.fillStyle = 'rgba(255,255,255,.1)';
      roundRect(ctx, x, by, bw, bh, 40); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '900 84px ' + font;
      ctx.fillText(b[0], x + bw / 2, by + 110);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = '700 34px ' + font;
      ctx.fillText(b[1], x + bw / 2, by + 165);
    });

    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.font = '700 32px ' + font;
    ctx.fillText(L('made with AAUPath', 'صُنعت بـ AAUPath'), W / 2, H - 120);
  }

  function overlayEl(){
    var el = document.getElementById('storyCardOverlay');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'storyCardOverlay';
    el.className = 'modal-overlay';
    el.innerHTML = '<div class="modal-card sc-card" role="dialog" aria-modal="true" aria-labelledby="scTitle"><div class="modal-body" id="scBody"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function(e){ if(e.target === el) el.classList.remove('open'); });
    return el;
  }

  function open(prefix){
    var el = overlayEl();
    var body = document.getElementById('scBody');
    var f = facts(prefix);
    function sw(key, on){ return '<button type="button" class="sc-sw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" data-sc="' + key + '"></button>'; }
    function paint(){
      body.innerHTML =
        '<h2 class="mh" id="scTitle" style="margin-top:0;">' + window.AAUP_ICONS.preview('camera', 20) + L('Story image', 'صورة ستوري') + '</h2>' +
        '<div class="sc-grid">' +
          '<canvas id="scCanvas" class="sc-canvas" aria-label="' + esc(L('Preview of the story image', 'معاينة صورة الستوري')) + '"></canvas>' +
          '<div class="sc-side">' +
            '<div class="sc-row"><span>' + L('Show my GPA', 'اعرض معدلي') + '</span>' + sw('gpa', opts.gpa) + '</div>' +
            '<div class="sc-row"><span>' + L('Show when I finish', 'اعرض موعد تخرجي') + '</span>' + sw('finish', opts.finish) + '</div>' +
            '<div class="sc-row"><span>' + L('Colour', 'اللون') + '</span><span class="sc-dots">' +
              COLOURS.map(function(c){ return '<button type="button" class="sc-dot' + (opts.colour === c.id ? ' on' : '') + '" data-sc-colour="' + c.id + '" style="background:' + c.top + '" aria-label="' + c.id + '"></button>'; }).join('') +
            '</span></div>' +
            '<div class="sc-go">' +
              '<button type="button" class="home-btn" id="scSave">' + window.AAUP_ICONS.preview('download', 14) + L('Save', 'احفظ') + '</button>' +
              (navigator.share ? '<button type="button" class="home-btn btn-pri" id="scShare">' + window.AAUP_ICONS.preview('send', 14) + L('Share', 'شارك') + '</button>' : '') +
            '</div>' +
            '<p class="form-note">' + L('Grades stay off the picture unless you turn them on.', 'العلامات ما بتظهر بالصورة إلا إذا شغّلتها.') + '</p>' +
          '</div>' +
        '</div>';
      draw(document.getElementById('scCanvas'), f);
      body.querySelectorAll('[data-sc]').forEach(function(b){
        b.addEventListener('click', function(){ opts[b.getAttribute('data-sc')] = !opts[b.getAttribute('data-sc')]; paint(); });
      });
      body.querySelectorAll('[data-sc-colour]').forEach(function(b){
        b.addEventListener('click', function(){ opts.colour = b.getAttribute('data-sc-colour'); paint(); });
      });
      var canvas = document.getElementById('scCanvas');
      document.getElementById('scSave').addEventListener('click', function(){
        var a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = 'aaupath-story.png';
        document.body.appendChild(a); a.click(); a.remove();
      });
      var shareBtn = document.getElementById('scShare');
      if(shareBtn) shareBtn.addEventListener('click', function(){
        canvas.toBlob(function(blob){
          if(!blob) return;
          var file = new File([blob], 'aaupath-story.png', { type: 'image/png' });
          if(navigator.canShare && navigator.canShare({ files: [file] })){
            navigator.share({ files: [file] }).catch(function(){});
          } else {
            document.getElementById('scSave').click();
          }
        }, 'image/png');
      });
    }
    // The picture uses the app font; wait for it so the first draw is not in
    // a fallback face.
    var ready = document.fonts && document.fonts.load ? document.fonts.load("900 40px 'Cairo'") : Promise.resolve();
    ready.then(paint, paint);
    el.classList.add('open');
  }

  window.AAUP_STORY_CARD = { open: open, facts: facts };
})();
