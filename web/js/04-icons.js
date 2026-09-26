// ==========================
// ICONS — how a university, a major, or the app's own chrome is pictured
// ==========================
// Most entries below are the three-layer system for a major/university:
//
//   1. imageUrl  — a PNG uploaded through Admin → Assets. Wins when present.
//   2. iconKey   — one of the built-in line icons below. Ships with the app,
//                  inherits the current theme colour, stays sharp at any size,
//                  costs no network request and works offline.
//   3. icon      — the emoji the app has always used. Never removed: it is the
//                  last fallback, so a plan that has neither of the other two
//                  looks exactly like it did before this module existed.
//
// The point of the order is that an admin can improve a major's icon without
// anyone editing code, and a major nobody has touched still renders fine.
//
// The icons are deliberately one visual family: 24×24, 1.8px round strokes, no
// fills, drawn on the same grid. That is why they are hand-written here rather
// than pulled from an icon font — a font is a network dependency and a licence,
// and mixing sets is what made the old generic 🎓 look out of place.
//
// The last few entries (home, planpin, chatdots, menu, clipboard, printer,
// shuffle, refresh, link) aren't for a major or university at all — they're
// the app's own nav chrome (the sidebar, the phone tab bar, the dashboard).
// Same grid, same reason: a hand-drawn icon and an emoji reads as two
// different apps side by side, so once the emoji went here it had to go
// everywhere that visual family shows up.
(function(){
  'use strict';

  // stroke() wraps a path list in the shared <svg> chrome so each entry below
  // is just its own geometry. currentColor is what makes them theme-aware.
  function stroke(paths){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      paths + '</svg>';
  }

  var ICONS = {
    // ---- computing ----
    robot: stroke('<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/>' +
      '<circle cx="12" cy="3" r="1.4"/><circle cx="9" cy="13" r="1.1"/><circle cx="15" cy="13" r="1.1"/>' +
      '<path d="M9.5 16.5h5"/><path d="M4 12H2"/><path d="M22 12h-2"/>'),
    code: stroke('<path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/><path d="M13.5 4.5 10.5 19.5"/>'),
    network: stroke('<rect x="9" y="2" width="6" height="5" rx="1.4"/>' +
      '<rect x="2" y="15" width="6" height="5" rx="1.4"/><rect x="16" y="15" width="6" height="5" rx="1.4"/>' +
      '<path d="M12 7v4"/><path d="M5 15v-2h14v2"/>'),
    shield: stroke('<path d="M12 3 5 6v5.5c0 4.3 2.9 8.1 7 9.5 4.1-1.4 7-5.2 7-9.5V6z"/>' +
      '<circle cx="12" cy="11" r="1.9"/><path d="M12 12.9V15.5"/>'),
    gamepad: stroke('<path d="M7.5 8h9a5 5 0 0 1 4.6 7l-.9 2.1a2.2 2.2 0 0 1-3.8.5L14.6 16H9.4l-1.8 1.6a2.2 2.2 0 0 1-3.8-.5L2.9 15A5 5 0 0 1 7.5 8Z"/>' +
      '<path d="M7 11v2.4"/><path d="M5.8 12.2h2.4"/><circle cx="16" cy="11.6" r="1"/><circle cx="18.2" cy="13.6" r="1"/>'),
    vr: stroke('<path d="M3.5 8.5h17a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-3.9a2 2 0 0 1-1.6-.8l-1.2-1.6a2 2 0 0 0-3.2 0l-1.2 1.6a2 2 0 0 1-1.6.8H3.5A1.5 1.5 0 0 1 2 14v-4a1.5 1.5 0 0 1 1.5-1.5Z"/>' +
      '<path d="M6 8.5V7.2"/><path d="M18 8.5V7.2"/>'),

    // ---- data & maths ----
    brain: stroke('<path d="M12 5.5a3 3 0 0 0-5.6-1.5A2.8 2.8 0 0 0 4 8.4a3 3 0 0 0 .5 4.6A3 3 0 0 0 7 18.4a3 3 0 0 0 5 1.1z"/>' +
      '<path d="M12 5.5A3 3 0 0 1 17.6 4 2.8 2.8 0 0 1 20 8.4a3 3 0 0 1-.5 4.6A3 3 0 0 1 17 18.4a3 3 0 0 1-5 1.1z"/>' +
      '<path d="M12 5.5v14"/>'),
    datascience: stroke('<circle cx="5" cy="18" r="1.8"/><circle cx="11" cy="11" r="1.8"/>' +
      '<circle cx="18" cy="14" r="1.8"/><circle cx="16" cy="5" r="1.8"/>' +
      '<path d="m6.3 16.7 3.4-4.3"/><path d="m12.7 11.8 3.6 1.5"/><path d="m16.6 6.7-4.4 3.1"/>'),
    stats: stroke('<path d="M3 20h18"/><rect x="4.5" y="12" width="3.6" height="6" rx="1"/>' +
      '<rect x="10.2" y="7.5" width="3.6" height="10.5" rx="1"/>' +
      '<rect x="15.9" y="4" width="3.6" height="14" rx="1"/>'),
    chart: stroke('<path d="M3 20h18"/><path d="m4.5 15 4.2-4.6 3.4 2.9L20 6"/>' +
      '<path d="M20 10.4V6h-4.4"/>'),
    finance: stroke('<circle cx="12" cy="12" r="8.4"/><path d="M12 7.2v9.6"/>' +
      '<path d="M14.6 9.4a2.7 2.7 0 0 0-2.6-1.5c-1.6 0-2.6.9-2.6 2.1 0 2.9 5.4 1.5 5.4 4.4 0 1.3-1.1 2.2-2.8 2.2a2.9 2.9 0 0 1-2.8-1.7"/>'),
    fintech: stroke('<rect x="3" y="6" width="18" height="12" rx="2.4"/><path d="M3 10h18"/>' +
      '<path d="M7 14.5h3"/><circle cx="16.5" cy="14.4" r="1.9"/>' +
      '<path d="M16.5 12.5v-.9"/><path d="M16.5 17.2v-.9"/>'),

    // ---- health ----
    medical: stroke('<path d="M6 3v5.2a5 5 0 0 0 5 5 5 5 0 0 0 5-5V3"/><path d="M4.4 3h3.2"/><path d="M14.4 3h3.2"/>' +
      '<path d="M11 13.2v2.3a4 4 0 0 0 8 0v-.8"/><circle cx="19" cy="13.4" r="1.9"/>'),
    health: stroke('<path d="M12 20.2C8.4 17.6 3.5 14.4 3.5 9.9A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8.5 2.3c0 4.5-4.9 7.7-8.5 10.3Z"/>' +
      '<path d="M6.4 12.3h2.4l1.3-2.2 1.7 4 1.4-2.4h3.2"/>'),
    pharmacy: stroke('<path d="M5 20h14"/><path d="M6.5 20v-2.6a5.5 5.5 0 0 1 11 0V20"/>' +
      '<path d="M4.5 7.6h15"/><path d="M12 7.6V4.4"/><path d="m17.6 6.2 2.6-2.2"/>'),
    lungs: stroke('<path d="M12 4v8"/><path d="M12 8.6c-1.6 0-2.4-1-3.4-1s-2.3.7-3.1 2.6C4.6 12.3 4.4 15 4.6 17c.1 1.6 1 2.3 2.3 2.3 1.6 0 3-.9 3.6-2.4.4-1 .5-2 .5-3.1V8.6Z"/>' +
      '<path d="M12 8.6c1.6 0 2.4-1 3.4-1s2.3.7 3.1 2.6c.9 2.1 1.1 4.8.9 6.8-.1 1.6-1 2.3-2.3 2.3-1.6 0-3-.9-3.6-2.4-.4-1-.5-2-.5-3.1V8.6Z"/>'),

    // ---- media & place ----
    media: stroke('<rect x="2.5" y="5" width="19" height="14" rx="2.4"/><path d="M2.5 9h19"/>' +
      '<path d="M6.5 5v4"/><path d="M11 5v4"/><path d="M15.5 5v4"/>' +
      '<path d="m10.6 12.4 4.4 2.5-4.4 2.5z"/>'),
    palette: stroke('<path d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.3 0 2-.9 2-1.9 0-.6-.3-1-.6-1.4a1.9 1.9 0 0 1 1.5-3.1h1.7a4 4 0 0 0 4-4c0-3.6-3.8-6.8-8.6-6.8Z"/>' +
      '<circle cx="7.6" cy="11.4" r="1.1"/><circle cx="10.2" cy="7.4" r="1.1"/><circle cx="15" cy="8" r="1.1"/>'),
    globe: stroke('<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/>' +
      '<path d="M12 3.6a13 13 0 0 1 0 16.8 13 13 0 0 1 0-16.8Z"/>'),
    education: stroke('<path d="m12 4 9.2 4.2L12 12.4 2.8 8.2z"/>' +
      '<path d="M6.6 10.4v4.4c0 1.7 2.4 3.1 5.4 3.1s5.4-1.4 5.4-3.1v-4.4"/>' +
      '<path d="M20.4 8.6v5"/>'),
    megaphone: stroke('<path d="M4 10.6v2.8a1.9 1.9 0 0 0 1.9 1.9h1.4L15 19.5V4.5L7.3 8.7H5.9A1.9 1.9 0 0 0 4 10.6Z"/>' +
      '<path d="M18.2 9.2a4 4 0 0 1 0 5.6"/><path d="M7.3 15.3V19a1.4 1.4 0 0 0 2.7.4"/>'),
    university: stroke('<path d="m12 3.4 9 4.3H3z"/><path d="M4.6 20.4h14.8"/>' +
      '<path d="M6.4 17.8V9.4"/><path d="M10.1 17.8V9.4"/><path d="M13.9 17.8V9.4"/><path d="M17.6 17.8V9.4"/>'),
    flask: stroke('<path d="M9.4 3.4v5.4L4.6 17a2.4 2.4 0 0 0 2.1 3.6h10.6a2.4 2.4 0 0 0 2.1-3.6l-4.8-8.2V3.4"/>' +
      '<path d="M8.2 3.4h7.6"/><path d="M7.2 13.6h9.6"/>'),
    book: stroke('<path d="M4 4.6h5.4A2.6 2.6 0 0 1 12 7.2v12a2.2 2.2 0 0 0-2.2-2.2H4z"/>' +
      '<path d="M20 4.6h-5.4A2.6 2.6 0 0 0 12 7.2v12a2.2 2.2 0 0 1 2.2-2.2H20z"/>'),
    // ---- engineering & physical sciences ----
    gear: stroke('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.6v2.6M12 18.8v2.6M21.4 12h-2.6M5.2 12H2.6"/>' +
      '<path d="m18.6 5.4-1.9 1.9M7.3 16.7l-1.9 1.9M18.6 18.6l-1.9-1.9M7.3 7.3 5.4 5.4"/>'),
    circuit: stroke('<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M12 2.6V7M12 17v4.4"/>' +
      '<path d="M2.6 12H7M17 12h4.4"/><path d="M8.8 2.6V7M15.2 2.6V7M8.8 17v4.4M15.2 17v4.4"/>'),
    atom: stroke('<circle cx="12" cy="12" r="2"/>' +
      '<ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/>' +
      '<ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)"/>'),
    bolt: stroke('<path d="M13.2 2.4 4.8 13.2h5.4L10.8 21.6l8.4-10.8h-5.4z"/>'),
    magnet: stroke('<path d="M5 4v8a7 7 0 0 0 14 0V4"/><path d="M5 9.6h4.6M14.4 9.6H19"/>' +
      '<path d="M5 4h4.6M14.4 4H19"/>'),
    ruler: stroke('<rect x="2.4" y="8.4" width="19.2" height="7.2" rx="1.6" transform="rotate(-20 12 12)"/>' +
      '<path d="m7.4 9.6.9 2M11 8.3l1.4 3M14.6 7l.9 2"/>'),
    telescope: stroke('<path d="m3.4 14.2 12.4-6.6 2.6 4.9-12.4 6.6z"/><path d="m16.4 6.4 3.5-1.9 2 3.7-3.5 1.9"/>' +
      '<path d="M9.4 15.6 8 21.4M13.4 13.6l3.4 5"/>'),
    rocket: stroke('<path d="M12 2.6c3.4 2.5 5.4 6.4 5.4 10.6l-2.6 3.2H9.2l-2.6-3.2C6.6 9 8.6 5.1 12 2.6Z"/>' +
      '<circle cx="12" cy="10.4" r="1.9"/><path d="M9.2 16.4 7 21.4l4-2M14.8 16.4 17 21.4l-4-2"/>'),
    factory: stroke('<path d="M3 20.4V11l5.4 3.4V11l5.4 3.4V7.6h4.2c1 0 1.6.6 1.6 1.6v11.2z"/>' +
      '<path d="M2.6 20.4h18.8"/><path d="M7 17.4h1.6M12 17.4h1.6M16.6 17.4h1.6"/>'),

    // ---- health & life sciences ----
    dna: stroke('<path d="M7 2.6c0 5 10 5.4 10 10.4S7 18.4 7 21.4"/><path d="M17 2.6c0 5-10 5.4-10 10.4s10 5.4 10 8.4"/>' +
      '<path d="M8.4 6.4h7.2M8.4 17.6h7.2M7.4 10.4h9.2"/>'),
    microscope: stroke('<path d="M7.4 18.4h9.2"/><path d="M4.6 21.4h14.8"/>' +
      '<path d="M11 4.4h2.6l1.4 6a4 4 0 0 1-3.4 4.4H10"/><path d="M9.6 8.4h3.4"/><path d="M8.6 18.4a5.4 5.4 0 0 1 3-9.6"/>'),
    tooth: stroke('<path d="M8 3.4c1.6 0 2.4.8 4 .8s2.4-.8 4-.8c2 0 3.4 1.6 3.4 4.2 0 3-1.2 4.4-1.8 7.4-.5 2.4-.6 6-2.4 6-1.6 0-1.6-3.6-3.2-3.6s-1.6 3.6-3.2 3.6c-1.8 0-1.9-3.6-2.4-6C5.8 12 4.6 10.6 4.6 7.6c0-2.6 1.4-4.2 3.4-4.2Z"/>'),
    brainhealth: stroke('<path d="M4.6 12a7.4 7.4 0 1 1 14.8 0"/><path d="M4.6 12v3.4a3 3 0 0 0 3 3h1.8"/>' +
      '<path d="M19.4 12v3.4a3 3 0 0 1-3 3h-1.8"/><path d="M9.4 18.4V21M14.6 18.4V21"/>'),
    eye: stroke('<path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12Z"/><circle cx="12" cy="12" r="3"/>'),
    bone: stroke('<path d="M6.4 17.6 17.6 6.4"/>' +
      '<path d="M6.4 17.6a2.2 2.2 0 1 1-2.6-2.6 2.2 2.2 0 1 1 2.6 2.6Z"/>' +
      '<path d="M17.6 6.4a2.2 2.2 0 1 1 2.6 2.6 2.2 2.2 0 1 1-2.6-2.6Z"/>'),
    syringe: stroke('<path d="m14.4 3.4 6.2 6.2"/><path d="m17.4 6.4-9.6 9.6-3.8.8.8-3.8 9.6-9.6z"/>' +
      '<path d="m11.4 8.4 4.2 4.2M9 10.8l4.2 4.2"/><path d="m4 20 2.4-2.4"/>'),

    // ---- business & society ----
    scales: stroke('<path d="M12 3.4v17M6.6 20.4h10.8"/><path d="M4 7.6h16"/>' +
      '<path d="M4 7.6 1.6 13.4h4.8zM20 7.6l-2.4 5.8h4.8z"/>'),
    handshake: stroke('<path d="m8.4 11.4 2.6-2.6 3 3 3-3 3 3"/><path d="M4 12.4 7 9.4"/>' +
      '<path d="M11 14.4 8.6 16.8a1.8 1.8 0 1 1-2.6-2.6"/><path d="m14 16.4-1.6 1.6a1.8 1.8 0 1 1-2.6-2.6"/>'),
    briefcase: stroke('<rect x="2.6" y="7.4" width="18.8" height="12" rx="2"/>' +
      '<path d="M8.4 7.4V5.6a2 2 0 0 1 2-2h3.2a2 2 0 0 1 2 2v1.8"/><path d="M2.6 12.4h18.8"/>'),
    building: stroke('<rect x="4.4" y="3" width="15.2" height="18" rx="1.6"/>' +
      '<path d="M8.4 7h2M13.6 7h2M8.4 11h2M13.6 11h2M8.4 15h2M13.6 15h2"/><path d="M10.4 21v-3h3.2v3"/>'),
    people: stroke('<circle cx="9" cy="8" r="3.2"/><path d="M2.6 20.4a6.4 6.4 0 0 1 12.8 0"/>' +
      '<path d="M16.4 5.2a3.2 3.2 0 0 1 0 6"/><path d="M18 14.6a6.4 6.4 0 0 1 3.4 5.8"/>'),
    speech: stroke('<path d="M20.4 15.4a2 2 0 0 1-2 2H7.4l-4 3.4V5.6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>' +
      '<path d="M7.6 8.6h8.8M7.6 12.2h5.8"/>'),
    news: stroke('<path d="M3 5.4h13.4v14a2 2 0 0 0 2 2H5a2 2 0 0 1-2-2z"/>' +
      '<path d="M16.4 9h2.6a2 2 0 0 1 2 2v8.4"/><path d="M6 8.6h7.4M6 12h7.4M6 15.4h4.4"/>'),
    tag: stroke('<path d="M11.4 2.6H20a1.4 1.4 0 0 1 1.4 1.4v8.6l-9.6 9.6a1.4 1.4 0 0 1-2 0l-7-7a1.4 1.4 0 0 1 0-2z"/>' +
      '<circle cx="16.6" cy="7.4" r="1.4"/>'),

    // ---- language, arts & humanities ----
    language: stroke('<path d="M2.6 5.6h9.6"/><path d="M7.4 3.4v2.2"/>' +
      '<path d="M10.4 5.6c0 3.6-2.6 7-7 8.4"/><path d="M5.4 9.6c1.4 2.4 3.4 4 5.8 4.8"/>' +
      '<path d="m12.6 20.6 4-9.6 4 9.6"/><path d="M14 17.4h5.2"/>'),
    pen: stroke('<path d="m14.6 3.4 6 6"/><path d="M18.6 5.4 7.4 16.6 3.4 20.6l4-1 11.2-11.2z"/>' +
      '<path d="M12.6 7.4 16.6 11.4"/>'),
    music: stroke('<path d="M8.4 18V5.4l11.2-2.2v12.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="17.2" cy="15.6" r="2.4"/>'),
    camera: stroke('<rect x="2.6" y="6.6" width="18.8" height="13.4" rx="2.2"/>' +
      '<path d="M8.4 6.6 9.8 4h4.4l1.4 2.6"/><circle cx="12" cy="13.2" r="3.6"/>'),
    theatre: stroke('<path d="M3.4 6.6h8v6.8a4 4 0 0 1-8 0z"/><path d="M12.6 6.6h8v6.8a4 4 0 0 1-8 0z"/>' +
      '<path d="M5.6 9.4h.8M8.2 9.4h.8M14.8 9.4h.8M17.4 9.4h.8"/>'),
    scroll: stroke('<path d="M6 3.4h11a2.6 2.6 0 0 1 2.6 2.6v12a2.6 2.6 0 0 0 2.6 2.6H8.6A2.6 2.6 0 0 1 6 18z"/>' +
      '<path d="M6 3.4A2.6 2.6 0 0 0 3.4 6v2.6H6"/><path d="M9.4 8h7M9.4 11.6h7M9.4 15.2h4.4"/>'),

    // ---- computing, extra ----
    database: stroke('<ellipse cx="12" cy="5.6" rx="8" ry="3"/>' +
      '<path d="M4 5.6v12.8c0 1.7 3.6 3 8 3s8-1.3 8-3V5.6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
    cloud: stroke('<path d="M7 18.4a4.4 4.4 0 0 1-.4-8.8 6 6 0 0 1 11.5 1.6A3.8 3.8 0 0 1 17.4 18.4z"/>'),
    lock: stroke('<rect x="4.4" y="10.4" width="15.2" height="10.2" rx="2"/>' +
      '<path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8"/><circle cx="12" cy="15.4" r="1.4"/>'),
    bug: stroke('<rect x="8" y="7.4" width="8" height="12" rx="4"/><path d="M9.4 5.4 8 3.6M14.6 5.4 16 3.6"/>' +
      '<path d="M8 11H4.4M8 15.4H4.6M16 11h3.6M16 15.4h3.4"/><path d="M12 7.4v12"/>'),
    server: stroke('<rect x="3" y="4" width="18" height="6" rx="1.6"/><rect x="3" y="14" width="18" height="6" rx="1.6"/>' +
      '<path d="M6.6 7h.8M6.6 17h.8"/>'),
    mobile: stroke('<rect x="6.4" y="2.6" width="11.2" height="18.8" rx="2.4"/><path d="M10.6 5.4h2.8"/>' +
      '<path d="M11.2 18.4h1.6"/>'),
    terminal: stroke('<rect x="2.6" y="4.4" width="18.8" height="15.2" rx="2"/>' +
      '<path d="m6.6 9.4 3 2.6-3 2.6"/><path d="M12.4 15h5"/>'),
    cpu: stroke('<rect x="6.6" y="6.6" width="10.8" height="10.8" rx="1.8"/><rect x="10" y="10" width="4" height="4" rx="1"/>' +
      '<path d="M9.4 2.6v4M14.6 2.6v4M9.4 17.4v4M14.6 17.4v4M2.6 9.4h4M2.6 14.6h4M17.4 9.4h4M17.4 14.6h4"/>'),

    // ---- maths & measurement ----
    sigma: stroke('<path d="M17.6 4.4H6.4l6 7.6-6 7.6h11.2"/>'),
    pi: stroke('<path d="M4.4 7.6h15.2"/><path d="M8.6 7.6v12"/><path d="M15.4 7.6v9.4c0 1.6.8 2.6 2.4 2.6"/>'),
    infinity: stroke('<path d="M7 8.4a3.6 3.6 0 1 0 0 7.2c3 0 4-3.6 5-3.6s2 3.6 5 3.6a3.6 3.6 0 1 0 0-7.2c-3 0-4 3.6-5 3.6s-2-3.6-5-3.6Z"/>'),
    percent: stroke('<circle cx="7" cy="7" r="2.8"/><circle cx="17" cy="17" r="2.8"/><path d="m19.4 4.6-15 15"/>'),
    target: stroke('<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.4"/>'),
    scatter: stroke('<path d="M3.4 20.6V3.4M3.4 20.6h17.2"/>' +
      '<circle cx="8" cy="15.4" r="1.2"/><circle cx="11.4" cy="10.6" r="1.2"/><circle cx="15" cy="12.6" r="1.2"/>' +
      '<circle cx="18.2" cy="7.4" r="1.2"/><circle cx="7" cy="9.4" r="1.2"/>'),

    // ---- places & general ----
    map: stroke('<path d="M9 4.4 3.4 6.6v13l5.6-2.2 6 2.2 5.6-2.2v-13L15 6.6z"/>' +
      '<path d="M9 4.4v13M15 6.6v13"/>'),
    compass: stroke('<circle cx="12" cy="12" r="8.6"/><path d="m15.4 8.6-2 5.4-5.4 2 2-5.4z"/>'),
    plane: stroke('<path d="M10.4 20.6 12 14.4l8.6-1.8a1.4 1.4 0 0 0 .4-2.6l-8-4.4-1.6-2.8a1 1 0 0 0-1.8.2L8 8.2l-4.4-1a1 1 0 0 0-1 1.6l3.2 3.4-1 3.6 3.6-1z"/>'),
    leaf: stroke('<path d="M4.6 19.4C3 14 6 5.6 20.4 4.6c1 12.6-6.6 16.8-13 14.4"/><path d="M8.6 15.4c2-3.6 5-6 8.4-7.4"/>'),
    sun: stroke('<circle cx="12" cy="12" r="4.2"/>' +
      '<path d="M12 2.6v2.4M12 19v2.4M21.4 12H19M5 12H2.6M18.6 5.4l-1.7 1.7M7.1 16.9l-1.7 1.7M18.6 18.6l-1.7-1.7M7.1 7.1 5.4 5.4"/>'),
    clock: stroke('<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.4l3.4 2"/>'),
    calendar: stroke('<rect x="3.4" y="5" width="17.2" height="16" rx="2"/><path d="M3.4 9.6h17.2"/>' +
      '<path d="M8 3v4M16 3v4"/><path d="M7.6 13.4h2M11 13.4h2M14.4 13.4h2M7.6 17h2M11 17h2"/>'),
    star: stroke('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'),
    trophy: stroke('<path d="M8 4h8v5.4a4 4 0 0 1-8 0z"/><path d="M8 5.6H5.4a2.6 2.6 0 0 0 2.6 5.2"/>' +
      '<path d="M16 5.6h2.6a2.6 2.6 0 0 1-2.6 5.2"/><path d="M12 13.4V17"/><path d="M8.6 20.6h6.8L14.4 17H9.6z"/>'),
    // Achievement badges (js/24-achievements.js) — a graduation cap for the
    // year-completion milestones and "graduation ready," a medal for the
    // GPA/honours-tier badges. Same grid/stroke as everything above.
    cap: stroke('<path d="M12 4 2 9l10 5 10-5z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/><path d="M20 9v6"/>'),
    medal: stroke('<circle cx="12" cy="15" r="5.2"/><path d="m8.5 11-3-7"/><path d="m15.5 11 3-7"/><path d="M12 12.5v5"/>'),

    // ---- the app's own chrome (nav, dashboard, sidebar) — not a major or
    // university, but the same one hand-drawn family throughout ----
    home: stroke('<path d="M4 11.5 12 4l8 7.5"/>' +
      '<path d="M5.6 10.2V19a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4v-8.8"/>' +
      '<path d="M9.6 20.4v-4.6a2.4 2.4 0 0 1 4.8 0v4.6"/>'),
    // A destination pin with a checkmark in place of the usual dot — the
    // plan itself, the thing every path in the app leads back to.
    planpin: stroke('<path d="M12 21c4-4.2 6.4-7.6 6.4-10.6A6.4 6.4 0 1 0 5.6 10.4C5.6 13.4 8 16.8 12 21Z"/>' +
      '<path d="m9.2 10.6 1.8 1.8 3.6-3.8"/>'),
    // A chat bubble with the three-dot "typing" cue, distinct from `speech`
    // above — this one is specifically the AI assistant.
    chatdots: stroke('<path d="M4.6 6.4a2.2 2.2 0 0 1 2.2-2.2h10.4a2.2 2.2 0 0 1 2.2 2.2v7.6a2.2 2.2 0 0 1-2.2 2.2H10l-4 3.4v-3.4H6.8a2.2 2.2 0 0 1-2.2-2.2Z"/>' +
      '<circle cx="9" cy="10.2" r="1" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="10.2" r="1" fill="currentColor" stroke="none"/>' +
      '<circle cx="15" cy="10.2" r="1" fill="currentColor" stroke="none"/>'),
    menu: stroke('<path d="M4.5 7h15M4.5 12h15M4.5 17h9"/>'),
    clipboard: stroke('<rect x="5.6" y="5" width="12.8" height="16" rx="1.8"/>' +
      '<rect x="9" y="3.4" width="6" height="3.2" rx="1"/>' +
      '<path d="m8.8 13 2 2 4.4-4.4"/><path d="M8.8 17.4h6.4"/>'),
    printer: stroke('<rect x="5" y="8.4" width="14" height="7.2" rx="1.6"/>' +
      '<path d="M7.4 8.4V4.4h9.2v4"/><path d="M7.4 15.6v4.2h9.2v-4.2"/>' +
      '<circle cx="16" cy="11" r=".9" fill="currentColor" stroke="none"/>'),
    shuffle: stroke('<path d="M4 6.4h3.4l9.2 11.2H20"/><path d="m17 4 3 2.4-3 2.4"/>' +
      '<path d="M4 17.6h3.4l1.8-2.2"/><path d="m17 20-3-2.4 3-2.4"/>' +
      '<path d="m12.2 9.7 1.4-1.7"/>'),
    refresh: stroke('<path d="M19.4 12a7.4 7.4 0 0 1-12.6 5.3"/><path d="M4.6 12a7.4 7.4 0 0 1 12.6-5.3"/>' +
      '<path d="M19.4 6v4.4H15"/><path d="M4.6 18v-4.4H9"/>'),
    link: stroke('<path d="M9.6 14.4 14.4 9.6"/>' +
      '<path d="M13 6.6l1.6-1.6a3.2 3.2 0 0 1 4.4 4.4L17.4 11"/>' +
      '<path d="M11 17.4l-1.6 1.6a3.2 3.2 0 0 1-4.4-4.4L6.6 13"/>'),

    // ---- small UI glyphs (buttons, menus, headings) — the same hand-drawn
    // family as the app chrome above, standing in for the plain characters
    // (✓ ➕ 🔒 ⚠️ ...) headings and menus used to be prefixed with. ----
    plus: stroke('<path d="M12 4.6v14.8"/><path d="M4.6 12h14.8"/>'),
    chevron: stroke('<path d="m5.6 8.4 6.4 7.2 6.4-7.2"/>'),
    // chevron points down; these three are the same stroke rotated, drawn
    // rather than CSS-rotated so a caller can place one without also having
    // to know which way the base glyph happens to face.
    chevronUp: stroke('<path d="m5.6 15.6 6.4-7.2 6.4 7.2"/>'),
    chevronRight: stroke('<path d="m9 5.6 7.2 6.4-7.2 6.4"/>'),
    chevronLeft: stroke('<path d="m15 5.6-7.2 6.4 7.2 6.4"/>'),
    // Close and Back replace the bare ✖ and ← characters the app was
    // printing as text. A character inherits the font, not the icon grid,
    // so it never lined up with the drawn icons beside it.
    close: stroke('<path d="M6.4 6.4 17.6 17.6"/><path d="M17.6 6.4 6.4 17.6"/>'),
    back: stroke('<path d="M19.4 12H5"/><path d="m11 6-6 6 6 6"/>'),
    send: stroke('<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>'),
    check: stroke('<circle cx="12" cy="12" r="8.6"/><path d="m7.6 12.4 3 3 6-6.4"/>'),
    // The tick on its own, for places that already draw their own circle
    // around it — the course card's checkbox being the one that matters.
    tick: stroke('<path d="m5.4 12.6 4.4 4.4 8.8-9.6"/>'),
    undo: stroke('<path d="M8.4 15 4 10.6 8.4 6.2"/><path d="M4 10.6h10.4a5.6 5.6 0 0 1 0 11.2H10"/>'),
    copy: stroke('<rect x="9" y="9" width="11" height="11" rx="2"/>' +
      '<path d="M15 9V6.4A2.4 2.4 0 0 0 12.6 4H6.4A2.4 2.4 0 0 0 4 6.4v6.2A2.4 2.4 0 0 0 6.4 15H9"/>'),
    unlock: stroke('<rect x="4.4" y="10.4" width="15.2" height="10.2" rx="2"/>' +
      '<path d="M8 10.4V7.6a4 4 0 0 1 7.6-1.8"/><circle cx="12" cy="15.4" r="1.4"/>'),
    warning: stroke('<path d="M12 3.4 21.6 20H2.4z"/><path d="M12 9.6v4.8"/>' +
      '<circle cx="12" cy="17.4" r=".9" fill="currentColor" stroke="none"/>'),
    person: stroke('<circle cx="12" cy="8" r="3.6"/><path d="M4.6 20.4a7.4 7.4 0 0 1 14.8 0"/>'),
    textsize: stroke('<path d="M4 6.6h9M8.5 6.6v11"/><path d="M14.4 11h6M17.4 11v7"/>'),
    mail: stroke('<rect x="2.6" y="5" width="18.8" height="14" rx="2"/><path d="m3.4 6.4 8.6 6.4 8.6-6.4"/>'),
    trash: stroke('<path d="M4.4 7.4h15.2"/><path d="M9 7.4V5a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 16 5v2.4"/>' +
      '<path d="M6.4 7.4 7.2 19a2 2 0 0 0 2 1.8h5.6a2 2 0 0 0 2-1.8l.8-11.6"/><path d="M10.2 11v6M13.8 11v6"/>'),
    upload: stroke('<path d="M12 15.6V4.4"/><path d="m7.4 9 4.6-4.6L16.6 9"/>' +
      '<path d="M4.6 15.6v3a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-3"/>'),
    download: stroke('<path d="M12 4.4v11.2"/><path d="m7.4 11 4.6 4.6L16.6 11"/>' +
      '<path d="M4.6 15.6v3a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-3"/>'),
    save: stroke('<path d="M5 4.4h11.2l2.4 2.4v12.8H5z"/><path d="M7.6 4.4v5.6h8.8V4.4"/><path d="M8 14h8v5.2H8z"/>'),
    help: stroke('<circle cx="12" cy="12" r="8.6"/>' +
      '<path d="M9.4 9.4a2.6 2.6 0 1 1 3.6 2.4c-.7.4-1 .8-1 1.6v.4"/>' +
      '<circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>'),
    // A magnifier. Every search box in the app was drawing 🔍, which renders
    // as a different picture on every platform and next to a drawn icon reads
    // as two different apps — the whole reason this file exists.
    search: stroke('<circle cx="10.5" cy="10.5" r="6.4"/>' +
      '<path d="M15.2 15.2 20 20"/>')
  };

  // An uploaded image is the only one of the three layers that can carry a
  // URL, so it is the only one that needs checking. Same-origin relative
  // assets are what the admin uploader produces; https is allowed so a logo
  // can point at an official source. Anything else (javascript:, data:) is
  // dropped rather than sanitized — there is no legitimate third case.
  function safeImageUrl(u){
    var s = String(u == null ? '' : u).trim();
    if(!s) return '';
    if(/^https:\/\//i.test(s)) return s;
    if(/^(assets|\.\/assets)\//i.test(s)) return s.replace(/^\.\//, '');
    return '';
  }

  function esc(s){
    return window.__escapeHtml ? window.__escapeHtml(s) : String(s == null ? '' : s);
  }

  // The one function the rest of the app calls. `entity` is any object with
  // some combination of imageUrl / iconKey / icon — a university record, a
  // plan record, a college record, all three already look like that.
  function markup(entity, opts){
    var e = entity || {};
    var o = opts || {};
    var size = o.size || 28;
    var label = o.label ? ' aria-label="' + esc(o.label) + '" role="img"' : ' aria-hidden="true"';

    var img = safeImageUrl(e.imageUrl || e.logoUrl || e.iconUrl);
    if(img){
      // object-fit keeps a non-square upload from stretching; the admin
      // preview shows exactly this, so what is uploaded is what is seen.
      return '<img class="app-icon app-icon-img" src="' + esc(img) + '" alt="' +
        esc(o.label || '') + '" loading="lazy" ' +
        'style="width:' + size + 'px;height:' + size + 'px;object-fit:contain;">';
    }

    var key = String(e.iconKey || '').trim();
    if(key && Object.prototype.hasOwnProperty.call(ICONS, key)){
      return '<span class="app-icon app-icon-svg"' + label +
        ' style="width:' + size + 'px;height:' + size + 'px;">' + ICONS[key] + '</span>';
    }

    var emoji = e.icon || o.fallback || '🎓';
    return '<span class="app-icon app-icon-emoji"' + label +
      ' style="font-size:' + Math.round(size * 0.82) + 'px;line-height:1;">' + esc(emoji) + '</span>';
  }

  var DIRECTIONAL = { chevronRight:1, chevronLeft:1, back:1 };
  window.AAUP_ICONS = {
    markup: markup,
    keys: function(){ return Object.keys(ICONS).sort(); },
    has: function(k){ return Object.prototype.hasOwnProperty.call(ICONS, k); },
    // Used by the admin icon picker to draw the whole set as choosable tiles.
    preview: function(key, size){
      // Left/right arrows point the way the page reads: flipped by CSS
      // under html[dir="rtl"], so callers never pick a direction themselves.
      var dir = DIRECTIONAL[key] ? ' app-icon-dir' : '';
      return ICONS[key] ? '<span class="app-icon app-icon-svg' + dir + '" aria-hidden="true" style="width:' +
        (size || 24) + 'px;height:' + (size || 24) + 'px;">' + ICONS[key] + '</span>' : '';
    },
    safeImageUrl: safeImageUrl,
    // Fills every <span data-app-icon="key"> in the static markup. index.html
    // is hand-authored HTML with no template layer, so its icons could only
    // ever be literal characters — which is how emoji kept getting into the
    // one surface that is not generated by a module able to call preview().
    // Idempotent: an element already filled is skipped, so it is safe to call
    // again after any markup is injected.
    hydrate: function(root){
      var scope = root || document;
      var els = scope.querySelectorAll ? scope.querySelectorAll('[data-app-icon]') : [];
      Array.prototype.forEach.call(els, function(el){
        if(el.firstChild) return;
        var key = el.getAttribute('data-app-icon');
        var size = parseInt(el.getAttribute('data-app-icon-size'), 10) || 16;
        if(ICONS[key]){ el.innerHTML = window.AAUP_ICONS.preview(key, size); }
      });
    }
  };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ window.AAUP_ICONS.hydrate(); });
  } else {
    window.AAUP_ICONS.hydrate();
  }
})();
