// ==========================
// MY COLOURS — the theme a student makes themselves.
//
// Six themes shipped, and the answer to "I want my own colours" was: you
// can't. This adds a Customize button under the theme grid in Settings that
// opens a colour wheel, a lightness slider and a hex box for the two colours
// a theme is actually made of — the background and the accent. The other
// seven variables are derived from those two (AAUP_THEME.deriveTokens), so
// there is no way to end up with black text on a black card.
//
// Everything applies live while you drag, because the app is right there
// behind the dialog and a colour you cannot see on the real thing is a
// colour you are guessing at. "Undo changes" puts back the theme that was
// active when the panel opened, so trying it out costs nothing.
// ==========================
(function(){
  'use strict';

  var TX = {
    open:      { en: 'Customize', ar: 'تخصيص' },
    title:     { en: 'My colours', ar: 'ألواني' },
    lead:      { en: 'Pick a background and an accent. Everything else — cards, borders, text — is worked out from them.',
                 ar: 'اختر لون الخلفية ولون التمييز. كل ما عدا ذلك — البطاقات والحدود والنص — يُشتق منهما.' },
    bg:        { en: 'Background', ar: 'الخلفية' },
    accent:    { en: 'Accent', ar: 'التمييز' },
    hex:       { en: 'Hex code', ar: 'كود اللون' },
    light:     { en: 'Lightness', ar: 'الإضاءة' },
    undo:      { en: 'Undo changes', ar: 'تراجع' },
    done:      { en: '✓ Done', ar: '✓ تم' },
    close:     { en: 'Close', ar: 'إغلاق' },
    preview:   { en: 'Preview', ar: 'معاينة' },
    sample:    { en: 'A course card', ar: 'بطاقة مساق' },
    button:    { en: 'A button', ar: 'زر' },
    lowAccent: { en: 'This accent is hard to read on this background.',
                 ar: 'لون التمييز هذا صعب القراءة على هذه الخلفية.' },
    lowText:   { en: 'Text will be a little low-contrast on this background — a darker or lighter one reads better.',
                 ar: 'النص رح يكون تباينه ضعيف على هذه الخلفية — لون أغمق أو أفتح بيقرأ أحسن.' },
    okAccent:  { en: 'Good contrast.', ar: 'تباين جيد.' },
    badHex:    { en: 'That is not a colour code. Try #1b4f8c.',
                 ar: 'هذا ليس كود لون. جرّب ‎#1b4f8c‎.' },
    presets:      { en: 'Saved presets', ar: 'المحفوظات' },
    savePreset:   { en: '+ Save current colours', ar: '+ احفظ الألوان الحالية' },
    presetNamePh: { en: 'Name this preset…', ar: 'اسم للمحفوظة…' },
    save:         { en: 'Save', ar: 'حفظ' },
    presetDel:    { en: 'Delete', ar: 'حذف' }
  };
  function t(key, r){ return r ? TX[key].ar : TX[key].en; }

  var open = false;          // is the panel showing
  var target = 'bg';         // which of the two colours the wheel is editing
  var bg = '#0b1330', accent = '#5db8ff';
  var restore = null;        // {theme, colors} — what "undo" puts back
  var wheelCanvas = null, wheelSize = 168, wheelLight = 0.5;
  var rtlNow = false;        // the language the panel was drawn in
  var presetNameOpen = false; // is the "name this preset" row showing

  function theme(){ return window.AAUP_THEME; }
  function esc(s){
    var v = String(s == null ? '' : s);
    return window.__cleanText ? window.__cleanText(v) : (window.__escapeHtml ? window.__escapeHtml(v) : v);
  }

  // The colours the panel starts from: the student's own if they have made
  // a theme, otherwise whichever theme is active, so "customize" begins as a
  // copy of what they are already looking at rather than as a jump to navy.
  function seed(){
    var T = theme(); if(!T) return;
    var saved = T.customColors && T.customColors();
    if(T.current() === 'custom' && saved){ bg = saved.bg; accent = saved.accent; return; }
    var cur = null, list = T.list();
    for(var i = 0; i < list.length; i++){ if(list[i].id === T.current()) cur = list[i]; }
    if(cur){ bg = cur.bg; accent = cur.accent; }
  }

  function currentColor(){ return target === 'bg' ? bg : accent; }
  function setCurrentColor(hex){
    if(target === 'bg') bg = hex; else accent = hex;
    var T = theme();
    if(!T || !T.setCustomColors(bg, accent)) return;
    // setCustomColors already repaints when "My colours" is the live theme.
    // Switching to it is the once-per-session part — and it toasts, which
    // during a drag would mean one toast per pixel.
    if(T.current() !== 'custom') T.setTheme('custom');
  }

  // ---------------------------------------------------------------- wheel
  // Hue around the circle, saturation from the middle out, lightness on the
  // slider beside it. Drawn pixel by pixel once per lightness change — 168²
  // is small enough that this is instant and the result is a real wheel
  // rather than six conic gradient stops pretending to be one.
  function drawWheel(){
    if(!wheelCanvas) return;
    var T = theme(); if(!T) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var px = Math.round(wheelSize * dpr);
    wheelCanvas.width = px; wheelCanvas.height = px;
    var ctx = wheelCanvas.getContext('2d');
    var img = ctx.createImageData(px, px);
    var d = img.data, r = px / 2;
    // The wheel is drawn near the chosen lightness, but never so dark or so
    // pale that the hues stop being distinguishable — a wheel painted at
    // lightness 0.08 (which is where the Midnight background sits) is a black
    // disc you cannot pick a colour off. The slider's own track and the
    // preview strip below show the true lightness.
    var shown = Math.max(0.32, Math.min(0.72, wheelLight));
    for(var y = 0; y < px; y++){
      for(var x = 0; x < px; x++){
        var dx = x - r + 0.5, dy = y - r + 0.5;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var i = (y * px + x) * 4;
        if(dist > r){ d[i + 3] = 0; continue; }
        var hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        var sat = Math.min(1, dist / (r - 1));
        var rgb = T.hexToRgb(T.hslToHex(hue, sat, shown));
        d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2];
        // Feather the last pixel ring so the edge is not a staircase.
        d[i + 3] = dist > r - 1 ? Math.round(255 * (r - dist)) : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    drawMarker(ctx, px, r);
  }

  function drawMarker(ctx, px, r){
    var T = theme();
    var hsl = T.rgbToHsl(T.hexToRgb(currentColor()));
    var sat = Math.min(1, hsl[1]);
    var a = hsl[0] * Math.PI / 180;
    var x = r + Math.cos(a) * sat * (r - 1);
    var y = r + Math.sin(a) * sat * (r - 1);
    var ring = Math.max(6, px / 22);
    ctx.beginPath(); ctx.arc(x, y, ring, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, px / 84); ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, ring + ctx.lineWidth, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();
  }

  function pickFromWheel(ev){
    var T = theme(); if(!T || !wheelCanvas) return;
    var box = wheelCanvas.getBoundingClientRect();
    var r = box.width / 2;
    var dx = ev.clientX - box.left - r, dy = ev.clientY - box.top - r;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    var sat = Math.min(1, dist / (r - 1));
    setCurrentColor(T.hslToHex(hue, sat, wheelLight));
    syncControls();
  }

  // ---------------------------------------------------------------- render
  function panelHtml(r){
    var T = theme();
    var d = T.deriveTokens(bg, accent);
    return '<div class="tc-panel" dir="' + (r ? 'rtl' : 'ltr') + '">' +
      '<p class="form-note tc-lead">' + t('lead', r) + '</p>' +
      '<div class="tc-targets" role="group">' +
        ['bg', 'accent'].map(function(k){
          return '<button type="button" class="tc-target' + (target === k ? ' tc-target-on' : '') +
            '" data-tc-target="' + k + '" aria-pressed="' + (target === k) + '">' +
            '<span class="tc-target-chip" style="background:' + (k === 'bg' ? bg : accent) + ';"></span>' +
            '<span class="tc-target-txt"><span>' + t(k === 'bg' ? 'bg' : 'accent', r) + '</span>' +
            '<code>' + (k === 'bg' ? bg : accent) + '</code></span></button>';
        }).join('') +
      '</div>' +
      '<div class="tc-editor">' +
        '<canvas class="tc-wheel" width="' + wheelSize + '" height="' + wheelSize + '" ' +
          'style="width:' + wheelSize + 'px;height:' + wheelSize + 'px;" ' +
          'role="img" aria-label="' + t('title', r) + '"></canvas>' +
        '<div class="tc-fields">' +
          '<label class="tc-lab" for="tcLight">' + t('light', r) + '</label>' +
          '<input type="range" id="tcLight" class="tc-light" min="4" max="96" value="' +
            Math.round(wheelLight * 100) + '">' +
          '<label class="tc-lab" for="tcHex">' + t('hex', r) + '</label>' +
          '<div class="tc-hex-row">' +
            '<input type="text" id="tcHex" class="tc-hex" maxlength="7" spellcheck="false" ' +
              'value="' + currentColor() + '" dir="ltr">' +
            '<input type="color" class="tc-native" value="' + currentColor() + '" ' +
              'aria-label="' + t('hex', r) + '">' +
          '</div>' +
          '<p class="tc-msg" id="tcMsg"></p>' +
        '</div>' +
      '</div>' +
      '<div class="tc-preview" style="background:' + d.page + ';border-color:' + d.line + ';">' +
        '<div class="tc-prev-card" style="background:' + d.panel + ';border-color:' + d.line + ';color:' + d.text + ';">' +
          '<span>' + t('sample', r) + '</span>' +
          '<small style="color:' + d.dim + ';">3H</small>' +
        '</div>' +
        '<span class="tc-prev-btn" style="background:' + d.accent + ';color:' + d['on-accent'] + ';">' +
          t('button', r) + '</span>' +
      '</div>' +
      '<div class="tc-presets">' +
        '<div class="tc-presets-label">' + t('presets', r) + '</div>' +
        '<div class="tc-presets-row">' +
          T.presets().map(function(p){
            var active = p.bg === bg && p.accent === accent;
            return '<div class="tc-preset-wrap' + (active ? ' tc-preset-active' : '') + '">' +
              '<button type="button" class="tc-preset-pick" data-tc-preset="' + esc(p.id) + '" title="' + esc(p.name) + '">' +
                '<span class="tc-preset-dot" style="background:' + p.bg + ';"><i style="background:' + p.accent + ';"></i></span>' +
              '</button>' +
              '<button type="button" class="tc-preset-del" data-tc-preset-del="' + esc(p.id) + '" aria-label="' + t('presetDel', r) + ' ' + esc(p.name) + '">&times;</button>' +
            '</div>';
          }).join('') +
          (presetNameOpen ? '' : '<button type="button" class="tc-preset-add" id="tcPresetAdd">' + t('savePreset', r) + '</button>') +
        '</div>' +
        (presetNameOpen ? '<div class="tc-preset-name-row">' +
          '<input type="text" id="tcPresetName" maxlength="24" placeholder="' + t('presetNamePh', r) + '" dir="' + (r ? 'rtl' : 'ltr') + '">' +
          '<button type="button" class="home-btn" id="tcPresetSave">' + t('save', r) + '</button>' +
        '</div>' : '') +
      '</div>' +
      '<div class="tc-actions">' +
        '<button type="button" class="home-btn" id="tcUndo">' + t('undo', r) + '</button>' +
        '<button type="button" class="home-btn btn-pri" id="tcDone">' + t('done', r) + '</button>' +
      '</div>' +
      '</div>';
  }

  // The button that opens it, plus the container the panel is drawn into.
  function sectionHtml(r){
    if(!theme() || !theme().deriveTokens) return '';
    return '<div class="tc-open-row">' +
      '<button type="button" class="home-btn tc-open" id="tcOpenBtn" aria-expanded="' + open + '">' +
        t('open', r) + '</button>' +
      '</div><div id="tcPanelHost"></div>';
  }

  function syncControls(){
    var host = document.getElementById('tcPanelHost');
    if(!host) return;
    var T = theme(), r = rtlNow;
    var hex = host.querySelector('.tc-hex');
    var native = host.querySelector('.tc-native');
    if(hex && document.activeElement !== hex) hex.value = currentColor();
    if(native) native.value = currentColor();
    host.querySelectorAll('[data-tc-target]').forEach(function(b){
      var k = b.getAttribute('data-tc-target');
      b.classList.toggle('tc-target-on', k === target);
      b.setAttribute('aria-pressed', String(k === target));
      var chip = b.querySelector('.tc-target-chip');
      var code = b.querySelector('code');
      if(chip) chip.style.background = k === 'bg' ? bg : accent;
      if(code) code.textContent = k === 'bg' ? bg : accent;
    });
    var d = T.deriveTokens(bg, accent);
    var prev = host.querySelector('.tc-preview');
    if(prev){
      prev.style.background = d.page; prev.style.borderColor = d.line;
      var card = prev.querySelector('.tc-prev-card');
      if(card){ card.style.background = d.panel; card.style.borderColor = d.line; card.style.color = d.text; }
      var small = prev.querySelector('.tc-prev-card small');
      if(small) small.style.color = d.dim;
      var btn = prev.querySelector('.tc-prev-btn');
      if(btn){ btn.style.background = d.accent; btn.style.color = d['on-accent']; }
    }
    // Said plainly rather than silently allowed: an accent that cannot be
    // read on the chosen background makes every primary button in the app
    // unreadable, and the student is the only one who can decide that is
    // fine.
    var msg = document.getElementById('tcMsg');
    if(msg){
      var ratio = T.contrast(accent, bg);
      var textRatio = T.contrast(d.text, bg);
      var line = ratio < 3 ? t('lowAccent', r) : t('okAccent', r);
      if(textRatio < 4.5) line = t('lowText', r);
      msg.textContent = line + ' (' + ratio.toFixed(1) + ':1)';
      msg.className = 'tc-msg' + (ratio < 3 || textRatio < 4.5 ? ' tc-msg-warn' : '');
    }
    var light = host.querySelector('.tc-light');
    if(light) light.style.setProperty('--tc-hue-bg',
      'linear-gradient(to right,#000,' + T.hslToHex(T.rgbToHsl(T.hexToRgb(currentColor()))[0], 0.9, 0.5) + ',#fff)');
    drawWheel();
  }

  function renderPanel(host, r){
    rtlNow = !!r;
    if(!open){ host.innerHTML = ''; wheelCanvas = null; return; }
    host.innerHTML = panelHtml(r);
    wheelCanvas = host.querySelector('.tc-wheel');
    var T = theme();
    wheelLight = T.rgbToHsl(T.hexToRgb(currentColor()))[2];
    var light = host.querySelector('.tc-light');
    if(light) light.value = String(Math.round(wheelLight * 100));
    bindPanel(host, r);
    syncControls();
  }

  function bindPanel(host, r){
    var dragging = false;
    if(wheelCanvas){
      wheelCanvas.addEventListener('pointerdown', function(e){
        dragging = true;
        try{ wheelCanvas.setPointerCapture(e.pointerId); }catch(err){}
        pickFromWheel(e); e.preventDefault();
      });
      wheelCanvas.addEventListener('pointermove', function(e){ if(dragging) pickFromWheel(e); });
      wheelCanvas.addEventListener('pointerup', function(){ dragging = false; });
      wheelCanvas.addEventListener('pointercancel', function(){ dragging = false; });
    }
    host.querySelectorAll('[data-tc-target]').forEach(function(b){
      b.addEventListener('click', function(){
        target = b.getAttribute('data-tc-target');
        var T = theme();
        wheelLight = T.rgbToHsl(T.hexToRgb(currentColor()))[2];
        var light = host.querySelector('.tc-light');
        if(light) light.value = String(Math.round(wheelLight * 100));
        syncControls();
      });
    });
    var lightEl = host.querySelector('.tc-light');
    if(lightEl){
      lightEl.addEventListener('input', function(){
        var T = theme();
        wheelLight = Number(lightEl.value) / 100;
        var hsl = T.rgbToHsl(T.hexToRgb(currentColor()));
        setCurrentColor(T.hslToHex(hsl[0], hsl[1], wheelLight));
        syncControls();
      });
    }
    var hexEl = host.querySelector('.tc-hex');
    if(hexEl){
      hexEl.addEventListener('input', function(){
        var T = theme();
        var v = hexEl.value.trim();
        if(v && v.charAt(0) !== '#') v = '#' + v;
        if(T.isHex(v)){
          setCurrentColor(T.rgbToHex.apply(null, T.hexToRgb(v)));
          wheelLight = T.rgbToHsl(T.hexToRgb(v))[2];
          var light = host.querySelector('.tc-light');
          if(light) light.value = String(Math.round(wheelLight * 100));
          syncControls();
        } else {
          var msg = document.getElementById('tcMsg');
          if(msg){ msg.textContent = t('badHex', r); msg.className = 'tc-msg tc-msg-warn'; }
        }
      });
    }
    var nativeEl = host.querySelector('.tc-native');
    if(nativeEl){
      nativeEl.addEventListener('input', function(){
        var T = theme();
        setCurrentColor(nativeEl.value);
        wheelLight = T.rgbToHsl(T.hexToRgb(nativeEl.value))[2];
        var light = host.querySelector('.tc-light');
        if(light) light.value = String(Math.round(wheelLight * 100));
        syncControls();
      });
    }
    host.querySelectorAll('[data-tc-preset]').forEach(function(b){
      b.addEventListener('click', function(){
        var T = theme();
        var id = b.getAttribute('data-tc-preset');
        var p = T.presets().filter(function(x){ return x.id === id; })[0];
        if(!p) return;
        bg = p.bg; accent = p.accent;
        T.setCustomColors(bg, accent);
        if(T.current() !== 'custom') T.setTheme('custom');
        wheelLight = T.rgbToHsl(T.hexToRgb(currentColor()))[2];
        var light = host.querySelector('.tc-light');
        if(light) light.value = String(Math.round(wheelLight * 100));
        renderPanel(host, r);
      });
    });
    host.querySelectorAll('[data-tc-preset-del]').forEach(function(b){
      b.addEventListener('click', function(e){
        e.stopPropagation();
        theme().removePreset(b.getAttribute('data-tc-preset-del'));
        renderPanel(host, r);
      });
    });
    var presetAdd = document.getElementById('tcPresetAdd');
    if(presetAdd) presetAdd.addEventListener('click', function(){
      presetNameOpen = true;
      renderPanel(host, r);
      var nameEl = document.getElementById('tcPresetName');
      if(nameEl){
        nameEl.value = t('title', r) + ' ' + (theme().presets().length + 1);
        nameEl.focus();
        nameEl.select();
      }
    });
    var presetSave = document.getElementById('tcPresetSave');
    if(presetSave) presetSave.addEventListener('click', function(){
      var nameEl = document.getElementById('tcPresetName');
      var name = (nameEl && nameEl.value.trim()) || (t('title', r) + ' ' + (theme().presets().length + 1));
      theme().addPreset(name, bg, accent);
      presetNameOpen = false;
      renderPanel(host, r);
    });
    var undo = document.getElementById('tcUndo');
    if(undo) undo.addEventListener('click', function(){
      var T = theme();
      if(restore){
        // Undo means undo: if there was no "My colours" before the panel
        // opened, there is none after it either, and the seventh swatch
        // goes away with it.
        if(restore.colors) T.setCustomColors(restore.colors.bg, restore.colors.accent);
        else T.clearCustomColors();
        T.setTheme(restore.theme);
      }
      open = false;
      presetNameOpen = false;
      if(host.__rerender) host.__rerender();
    });
    var done = document.getElementById('tcDone');
    if(done) done.addEventListener('click', function(){
      open = false;
      presetNameOpen = false;
      if(host.__rerender) host.__rerender();
    });
  }

  // Called by js/37-sidebar.js after it has written the Preferences tab.
  function bindSection(root, rerender){
    var host = root.querySelector('#tcPanelHost');
    var btn = root.querySelector('#tcOpenBtn');
    if(!host || !btn) return;
    var r = root.getAttribute('dir') === 'rtl';
    host.__rerender = rerender;
    btn.addEventListener('click', function(){
      var T = theme();
      open = !open;
      if(open){
        restore = { theme: T.current(), colors: T.customColors() };
        seed();
      }
      btn.setAttribute('aria-expanded', String(open));
      renderPanel(host, r);
      if(open) host.scrollIntoView({ block: 'nearest' });
    });
    if(open) renderPanel(host, r);
  }

  window.AAUP_THEME_CUSTOM = { sectionHtml: sectionHtml, bindSection: bindSection };
})();
