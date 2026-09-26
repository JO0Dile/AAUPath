// ==========================
// THEME
// ==========================
// Six themes: the original Midnight (dark) and Daylight (light) plus four
// new ones — two more light, two more dark — so "theme" means more than a
// single dark/light switch. Each only ever redefines the same handful of
// CSS custom properties app.css's :root and html[data-theme="light"] block
// already defined (--page-bg, --surface-bg, --header-bg, --panel, --line,
// --text, --text-dim, --accent, --search-bg) — adding a theme here is a
// data-only change, no new selectors anywhere else in the app.
(function(){
  var KEY = 'aaup_theme';
  var DEFAULT = 'dark';

  var THEMES = [
    { id: 'dark', icon: '🌙', en: 'Midnight', ar: 'منتصف الليل', bg: '#0b1330', accent: '#5db8ff' },
    { id: 'light', icon: '☀️', en: 'Daylight', ar: 'ضوء النهار', bg: '#e7ebf1', accent: '#1b4f8c' },
    { id: 'cranberry', icon: '🍷', en: 'Cranberry & Bronze', ar: 'توت العليق والبرونز', bg: '#f3e9dd', accent: '#8c1f3d' },
    { id: 'botanical', icon: '🌿', en: 'Botanical Ivy', ar: 'اللبلاب النباتي', bg: '#eef1e6', accent: '#b3702f' },
    { id: 'indigo', icon: '🔮', en: 'Indigo Dusk', ar: 'غسق نيلي', bg: '#150f2e', accent: '#a56bff' },
    { id: 'amber', icon: '🔥', en: 'Amber Ember', ar: 'جمر العنبر', bg: '#1c1410', accent: '#ff9f43' }
  ];

  // ---------------------------------------------------------------------
  // COLOUR MATHS — shared by the picker and by js/61-theme-custom.js.
  //
  // A student picking their own two colours only chooses a background and an
  // accent; the other seven variables every theme sets have to be worked out
  // from those, or the app ends up with black text on a black card. The
  // relationships below are lifted from the six hand-made themes above: cards
  // sit slightly lighter than the page, borders are the biggest step away
  // from it, and text is the same hue pushed to the far end of the scale.
  function hexToRgb(hex){
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if(!m) return null;
    var h = m[1];
    if(h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(r, g, b){
    return '#' + [r, g, b].map(function(v){
      var x = Math.round(Math.max(0, Math.min(255, v))).toString(16);
      return x.length === 1 ? '0' + x : x;
    }).join('');
  }
  function rgbToHsl(rgb){
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h = 0, s = 0;
    if(max !== min){
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if(max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if(max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToHex(h, s, l){
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2, t;
    if(h < 60) t = [c, x, 0]; else if(h < 120) t = [x, c, 0]; else if(h < 180) t = [0, c, x];
    else if(h < 240) t = [0, x, c]; else if(h < 300) t = [x, 0, c]; else t = [c, 0, x];
    return rgbToHex((t[0] + m) * 255, (t[1] + m) * 255, (t[2] + m) * 255);
  }
  // WCAG relative luminance, so "is this background dark?" and "which ink
  // reads on this button?" are answered by measurement rather than by a
  // guess about the hue.
  function relLum(hex){
    var rgb = hexToRgb(hex) || [0, 0, 0];
    var c = rgb.map(function(v){
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b){
    var la = relLum(a), lb = relLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function rgbaOf(hex, alpha){
    var rgb = hexToRgb(hex) || [0, 0, 0];
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
  }

  var INK_DARK = '#0b1330';
  var INK_LIGHT = '#ffffff';

  function deriveTokens(bg, accent){
    if(!hexToRgb(bg)) bg = '#0b1330';
    if(!hexToRgb(accent)) accent = '#5db8ff';
    var hsl = rgbToHsl(hexToRgb(bg));
    var h = hsl[0], s = Math.min(hsl[1], 0.6), l = hsl[2];
    var dark = relLum(bg) < 0.22;
    // Cards sit a step lighter than the page in every built-in theme —
    // except when the page is already near-white, where there is no lighter
    // left and the step has to go the other way for the card to show at all.
    var dir = (!dark && l > 0.93) ? -1 : 1;
    function step(d, sat){ return hslToHex(h, sat === undefined ? s : sat, l + dir * d); }
    var out = {
      page: bg,
      surface: step(dark ? 0.045 : 0.06),
      header: step(dark ? 0.075 : 0.02),
      panel: step(dark ? 0.055 : 0.04),
      search: step(dark ? 0.015 : 0.02),
      // The border is the one value that steps AWAY from the page in the
      // other direction on a light theme: dark themes lighten their lines,
      // light themes darken them.
      line: dark ? hslToHex(h, s * 0.9, l + 0.17) : hslToHex(h, s * 0.9, l - 0.14),
      accent: accent
    };
    // Text is not chosen by "is the background dark?" but by measuring both
    // candidates against it, because a mid-tone background (a medium green,
    // say) is neither, and the wrong pick there is the difference between a
    // readable app and a smear. If even the better one falls under 4.5:1 —
    // the ratio ordinary body text needs — go to pure white or pure black,
    // which is as far as it can go.
    var lightText = hslToHex(h, Math.min(s, 0.28), 0.94);
    var darkText = hslToHex(h, Math.min(s + 0.08, 0.4), 0.16);
    var useLight = contrast(lightText, bg) >= contrast(darkText, bg);
    out.text = useLight ? lightText : darkText;
    if(contrast(out.text, bg) < 4.5) out.text = useLight ? '#ffffff' : '#000000';
    // The dimmed text (course codes, hints, counts) only has to clear 3:1,
    // but on a mid-tone background the usual step lands under that, so it is
    // walked toward the nearer extreme until it clears — rather than left
    // at a value that merely looks plausible next to the page colour.
    var dimSat = useLight ? Math.min(s, 0.26) : Math.min(s, 0.3);
    var dimL = useLight ? 0.72 : 0.42;
    var dimStep = useLight ? 0.04 : -0.04;
    for(var guard = 0; guard < 25; guard++){
      if(contrast(hslToHex(h, dimSat, dimL), bg) >= 3) break;
      if(dimL <= 0 || dimL >= 1) break;
      dimL = Math.max(0, Math.min(1, dimL + dimStep));
    }
    out.dim = hslToHex(h, dimSat, dimL);
    out['on-accent'] = contrast(accent, INK_LIGHT) >= contrast(accent, INK_DARK) ? INK_LIGHT : INK_DARK;
    out.watermark = dark ? 'rgba(255,255,255,.05)' : rgbaOf(out.text, 0.22);
    return out;
  }

  // ---------------------------------------------------------------------
  // MY COLOURS — the seventh theme, whose two colours the student picks.
  // It only exists once they have made one; until then nothing shows it.
  var CUSTOM_KEY = 'aaup_customColors';
  var CUSTOM_FALLBACK = { bg: '#0b1330', accent: '#5db8ff' };

  function customColors(){
    try{
      var raw = localStorage.getItem(CUSTOM_KEY);
      if(!raw) return null;
      var v = JSON.parse(raw);
      if(!v || !hexToRgb(v.bg) || !hexToRgb(v.accent)) return null;
      return { bg: v.bg, accent: v.accent };
    }catch(e){ return null; }
  }
  function customTheme(){
    var c = customColors() || CUSTOM_FALLBACK;
    return { id: 'custom', icon: '🎨', en: 'My colours', ar: 'ألواني', bg: c.bg, accent: c.accent };
  }
  function clearCustomColors(){
    try{ localStorage.removeItem(CUSTOM_KEY); }catch(e){}
  }
  function setCustomColors(bg, accent){
    if(!hexToRgb(bg) || !hexToRgb(accent)) return false;
    try{ localStorage.setItem(CUSTOM_KEY, JSON.stringify({ bg: bg, accent: accent })); }catch(e){}
    if(current() === 'custom'){ apply('custom'); }
    return true;
  }

  // ---------------------------------------------------------------------
  // SAVED PRESETS — named snapshots of a bg/accent pair a student can
  // recall later without redoing the wheel/hex work. "My colours" itself
  // stays the single LIVE slot (the one the wheel edits and the one that
  // actually paints when the theme is 'custom'); a preset is just a copy of
  // some earlier bg/accent worth keeping, loaded back into that live slot
  // on pick — not a theme in its own right, so nothing here touches apply()
  // or the CSS's fixed html[data-theme="custom"] selector.
  var PRESETS_KEY = 'aaup_customPresets';
  function loadPresets(){
    try{
      var v = JSON.parse(localStorage.getItem(PRESETS_KEY));
      return Array.isArray(v) ? v.filter(function(p){ return p && hexToRgb(p.bg) && hexToRgb(p.accent); }) : [];
    }catch(e){ return []; }
  }
  function savePresets(list){
    try{ localStorage.setItem(PRESETS_KEY, JSON.stringify(list.slice(0, 12))); }catch(e){}
  }
  function addPreset(name, bg, accent){
    if(!hexToRgb(bg) || !hexToRgb(accent)) return null;
    var list = loadPresets();
    var preset = { id: 'p' + Date.now().toString(36), name: String(name || '').slice(0, 24) || 'My colours', bg: bg, accent: accent };
    list.push(preset);
    savePresets(list);
    return preset;
  }
  function removePreset(id){
    savePresets(loadPresets().filter(function(p){ return p.id !== id; }));
  }
  // Paints the nine --c-* variables html[data-theme="custom"] reads, or
  // clears them when any other theme is active.
  function paintCustomVars(on, bg, accent){
    var st = document.documentElement.style;
    var names = ['page', 'surface', 'header', 'panel', 'search', 'line', 'text', 'dim', 'accent', 'on-accent', 'watermark'];
    if(!on){ names.forEach(function(n){ st.removeProperty('--c-' + n); }); return; }
    var d = deriveTokens(bg, accent);
    names.forEach(function(n){ st.setProperty('--c-' + n, d[n]); });
  }

  function themeById(id){
    if(id === 'custom') return customTheme();
    for(var i = 0; i < THEMES.length; i++){ if(THEMES[i].id === id) return THEMES[i]; }
    return null;
  }

  function apply(id){
    var t = themeById(id) || themeById(DEFAULT);
    paintCustomVars(t.id === 'custom', t.bg, t.accent);
    if(t.id === DEFAULT){ document.documentElement.removeAttribute('data-theme'); }
    else{ document.documentElement.setAttribute('data-theme', t.id); }
    document.querySelectorAll('.theme-toggle-icon').forEach(function(el){ el.textContent = t.icon; });
    // The mobile browser chrome / PWA status bar color is a separate meta
    // tag, not CSS — without this it stayed the original dark navy no
    // matter which theme was picked, an odd mismatch right at the top of
    // the screen for every light theme.
    var meta = document.querySelector('meta[name="theme-color"]');
    if(meta){ meta.setAttribute('content', t.bg); }
    // The browser draws its own date pickers, dropdown lists and scrollbars,
    // and without this it drew them light on every theme — a white calendar
    // popping up over a dark screen. Measured from the theme's own ground,
    // so a custom theme gets the right one too.
    document.documentElement.style.colorScheme = relLum(t.bg) < 0.22 ? 'dark' : 'light';
    // Every swatch button in the (possibly currently-open) Settings picker
    // updates its own "active" ring directly — no full re-render needed.
    document.querySelectorAll('[data-theme-swatch]').forEach(function(el){
      el.classList.toggle('theme-swatch-active', el.getAttribute('data-theme-swatch') === t.id);
    });
  }

  function current(){
    try{
      var v = localStorage.getItem(KEY);
      return themeById(v) ? v : DEFAULT;
    }catch(e){ return DEFAULT; }
  }

  function setTheme(id){
    if(!themeById(id)) return;
    try{ localStorage.setItem(KEY, id); }catch(e){}
    apply(id);
    if(window.__showToast){ var t = themeById(id); window.__showToast(t.en); }
  }

  // Cycles to the next theme in the list — kept for anything still calling
  // the old binary toggle() API; the Settings picker itself calls
  // setTheme(id) directly now.
  function toggle(){
    var ids = THEMES.map(function(t){ return t.id; });
    var idx = ids.indexOf(current());
    setTheme(ids[(idx + 1) % ids.length]);
  }

  // ---------------------------------------------------------------------
  // READING SIZE — how big the plan grid's course cards are.
  //
  // Six themes and no way to make the text bigger: course names sit at
  // 12.5px, and a student who has enlarged their phone's system font gets no
  // benefit from it inside the grid. This scales the cards' type and their
  // minimum height together (--card-scale in css/app.css) rather than zooming
  // the whole page, so the year and semester structure stays where it was.
  var SIZE_KEY = 'aaup_cardScale';
  var SIZES = [
    { id: 'compact', scale: 0.92, en: 'Compact', ar: 'مضغوط' },
    { id: 'normal', scale: 1, en: 'Normal', ar: 'عادي' },
    { id: 'large', scale: 1.16, en: 'Large', ar: 'كبير' },
    { id: 'xlarge', scale: 1.34, en: 'Extra large', ar: 'كبير جدًا' }
  ];
  var SIZE_DEFAULT = 'normal';

  function sizeById(id){
    for(var i = 0; i < SIZES.length; i++){ if(SIZES[i].id === id) return SIZES[i]; }
    return null;
  }
  function currentSize(){
    try{
      var v = localStorage.getItem(SIZE_KEY);
      return sizeById(v) ? v : SIZE_DEFAULT;
    }catch(e){ return SIZE_DEFAULT; }
  }
  function applySize(id){
    var s = sizeById(id) || sizeById(SIZE_DEFAULT);
    document.documentElement.style.setProperty('--card-scale', String(s.scale));
    // The scale alone only shrinks type. "Compact" should also mean a tighter
    // layout — closer gaps, no second-language line — and "Extra large" should
    // mean roomier, so the setting is named for what a student wants ("fit a
    // whole year" / "I can actually read this") rather than for a font size.
    // Rather than add a second density control next to this one, this exposes
    // the choice to CSS and the density rules hang off it.
    document.documentElement.setAttribute('data-card-size', s.id);
    document.querySelectorAll('[data-size-pick]').forEach(function(el){
      el.classList.toggle('size-pick-active', el.getAttribute('data-size-pick') === s.id);
    });
    // Cards grew or shrank, so the prerequisite lines drawn over them are
    // measuring the old geometry.
    if(window.AAUP_IMPORTED && window.AAUP_IMPORTED.redrawConnectors){
      Object.keys(window.__PLAN_DATA || {}).forEach(function(prefix){
        try{ window.AAUP_IMPORTED.redrawConnectors(prefix); }catch(e){}
      });
    }
  }
  function setSize(id){
    if(!sizeById(id)) return;
    try{ localStorage.setItem(SIZE_KEY, id); }catch(e){}
    applySize(id);
  }

  function init(){ apply(current()); applySize(currentSize()); }

  window.AAUP_THEME = {
    toggle: toggle, setTheme: setTheme, current: current,
    // list() is the six built-ins — what the first-run wizard offers.
    // listAll() adds the student's own theme once they have made one,
    // which is what the Settings picker shows.
    list: function(){ return THEMES.slice(); },
    listAll: function(){ return customColors() ? THEMES.concat([customTheme()]) : THEMES.slice(); },
    customColors: customColors, setCustomColors: setCustomColors,
    clearCustomColors: clearCustomColors,
    presets: loadPresets, addPreset: addPreset, removePreset: removePreset,
    deriveTokens: deriveTokens, contrast: contrast, isHex: function(v){ return !!hexToRgb(v); },
    hexToRgb: hexToRgb, rgbToHex: rgbToHex, rgbToHsl: rgbToHsl, hslToHex: hslToHex,
    setSize: setSize, currentSize: currentSize,
    sizes: function(){ return SIZES.slice(); }
  };

  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }
})();
