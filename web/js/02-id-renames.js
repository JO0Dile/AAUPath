// Course ids that changed, and moving a student's saved data to the new ones.
//
// Four older majors named their courses with tags (robotics: calc-1) where
// every other major uses the catalogue number (100411010). They now use the
// number too (tools/renumber-courses.py), which would orphan everything a
// student saved under the old tag: ticks, grades, statuses, notes, class
// times, pins, their own copy of the plan.
//
// So this runs before any other script reads storage (it is loaded right
// after js/01-catalogue.js, ahead of the bundles), and rewrites every aaup*
// entry that mentions one of those majors:
//   - "<major>-c-<old tag>"  becomes  "<major>-c-<number>", in keys and values;
//   - inside anything grouped under a renamed major (the major's own plan
//     copy, {major: {tag: …}} tables, {plan: major, slug: tag} records), a
//     key or value that is exactly an old tag becomes the number.
// It does nothing once nothing old is left, so it runs on every start, and
// again after a cloud download (js/52-cloud.js), which can bring an older
// copy back from another phone.
(function(){
  'use strict';

  // Written by tools/renumber-courses.py from each major's renamedIds.
  /* RENAMES */
  var RENAMES = {"cs": {"advanced-english": "010610035", "advanced-english-lab": "010610036", "advanced-oop": "240213010", "algo-prog-tech": "240113020", "arabic-language": "040111001", "artificial-intelligence": "240114350", "beginning-english": "010610014", "calc-1": "100411010", "calc-2": "100411020", "community-service": "000011110", "comp-arch": "240114331", "comp-graphics": "240212100", "comp-net-lab": "110113220", "comp-org": "240112111", "computer-skills": "110411000", "data-struct-lab": "110412130", "data-structures": "240112031", "digital-logic": "110411100", "discrete-math": "100413750", "elective-adv-os": "240113321", "elective-business-basics": "240223202", "elective-cloud-computing": "240314800", "elective-compiler-design": "240114550", "elective-data-mining": "240114610", "elective-distributed-sys": "240114130", "elective-entrepreneurship": "240114321", "elective-machine-learning": "240114020", "elective-networks-1": "240223041", "elective-neural-net": "240113100", "elective-parallel-prog": "240114780", "elective-special-topic-it": "240114500", "elective-special-topics-cs": "240114411", "elective-web-dev-2": "240214120", "info-security": "240113221", "intermediate-english": "010610025", "intermediate-english-lab": "010610026", "internship": "240113990", "intro-db": "240113121", "intro-db-lab": "240113132", "intro-it": "240221010", "intro-it-lab": "110111030", "intro-os": "240113311", "intro-se": "240113171", "it-proj-mgmt": "240114471", "math-it": "100412040", "mobile-prog": "240113291", "oop-principles": "240212010", "palestinian-studies": "040511011", "progfund1": "240111011", "progfund1-lab": "240111021", "progfund2": "240112003", "progfund2-lab": "110412120", "research-methods": "040521301", "senior-proj-1": "240114974", "senior-proj-2": "240114982", "speech-comm": "240213480", "sw-testing": "240113620", "theory-computation": "240114081", "unix-lab": "240114341", "visual-prog": "240213231", "web-dev-1": "240213081"}, "cybersecurity": {"advanced-english": "010610035", "advanced-english-lab": "010610036", "ai-in-cybersecurity": "290373110", "ai-python": "290313130", "arabic-language": "040111001", "blockchain-security": "290374120", "calc-1": "100411010", "calc-2": "100411020", "capstone-project": "290354230", "comp-arch": "290312130", "computer-networks": "290372220", "computer-skills": "240111000", "cryptography": "290373210", "cyber-physical-security": "290374210", "cybersecurity-policy": "290373130", "data-sci-analytics": "290312210", "db-fund": "290312110", "db-fund-lab": "290312110-lab", "diff-eq": "290312240", "digital-forensics": "290373120", "discrete-math": "100413750", "dsa": "290312140", "elective-advanced-ethical-hacking": "290373160", "elective-computer-vision": "290313210", "elective-fund-se": "250223040", "elective-nlp": "290313120", "elective-robotics-foundation": "290313110", "elective-special-topics-cyber": "290373150", "elective-web-dev": "290373140", "elective-wireless-networks": "290373170", "ethical-hacking": "290373230", "ethics-ai": "290314110", "fund-ai": "290312120", "intermediate-english": "010610025", "intermediate-english-lab": "010610026", "internship": "290313250", "intro-cs": "290311110", "intro-cs-lab": "290311110-lab", "intro-cybersecurity": "290372210", "intro-os": "290312220", "linear-algebra": "250223010", "machine-learning": "290312230", "network-security": "290373220", "palestinian-studies": "040511011", "prob-stats": "250111040", "progfund": "290311210", "progfund-lab": "290311210-lab", "research-methods": "040521301", "software-security": "290374110"}, "medical": {"advanced-english": "010610035", "advanced-english-lab": "010610036", "anatomy-physio": "290323110", "arabic-language": "040111001", "bio-medsci": "100211620", "bio-medsci-lab": "100211650", "calc-1": "100411010", "calc-2": "100411020", "capstone-cognitive": "290314210", "capstone-research": "290314130", "chem-medsci": "100311620", "chem-medsci-lab": "100311650", "comp-arch": "290312130", "computer-skills": "240111000", "computer-vision": "290313210", "data-sci-analytics": "290312210", "db-fund": "290312110", "db-fund-lab": "290312110-lab", "deep-learning": "290313240", "diff-eq": "290312240", "discrete-math": "100413750", "dsa": "290312140", "elective-ai-clinical-decision": "290323210", "elective-ai-diagnostic-predictive-1": "290323220", "elective-ai-diagnostic-predictive-2": "290323280", "elective-ai-genomics-personalized-med": "290323260", "elective-ai-lab-tech-diagnosis": "290323240", "elective-ai-medical-imaging": "290323270", "elective-cognitive-systems": "290313190", "elective-digital-health-informatics": "290323250", "elective-robotics-assistive-tech": "290323230", "elective-robotics-foundation": "290313110", "ethics-ai": "290314110", "fund-ai": "290312120", "fund-se": "250223040", "gen-microbio": "200232120", "histology": "080112202", "intermediate-english": "010610025", "intermediate-english-lab": "010610026", "intro-cs": "290311110", "intro-cs-lab": "290311110-lab", "intro-os": "290312220", "linear-algebra": "250223010", "machine-learning": "290312230", "medical-terminology": "060511030", "nlp": "290313120", "palestinian-studies": "040511011", "pathophysiology": "290324210", "physics": "290322110", "physics-lab": "290322110-lab", "prob-stats": "250111040", "progfund": "290311120", "progfund-lab": "290311120-lab", "research-methods": "040521301"}, "robotics": {"advanced-english": "010610035", "advanced-english-lab": "010610036", "ai-python": "290313130", "arabic-language": "040111001", "av-sim": "290314120", "calc-1": "100411010", "calc-2": "100411020", "capstone-cognitive": "290314210", "capstone-research": "290314130", "comp-arch": "290312130", "computer-skills": "240111000", "computer-vision": "290313210", "data-sci-analytics": "290312210", "db-fund": "290312110", "db-fund-lab": "290312110-lab", "deep-learning": "290313240", "diff-eq": "290312240", "discrete-math": "100413750", "dsa": "290312140", "elective-cognitive-systems": "290313190", "elective-embedded-systems": "290313140", "elective-reinforcement-learning": "290313180", "elective-robotics-automation": "290313100", "elective-robotics-os": "290313150", "elective-sensors-perception": "290313170", "elective-swarm-robotics": "290313160", "ethics-ai": "290314110", "fund-ai": "290312120", "fund-se": "250223040", "human-robot-interaction": "290313230", "intermediate-english": "010610025", "intermediate-english-lab": "010610026", "intro-cs": "290311110", "intro-cs-lab": "290311110-lab", "intro-os": "290312220", "linear-algebra": "250223010", "machine-learning": "290312230", "nlp": "290313120", "palestinian-studies": "040511011", "prob-stats": "250111040", "progfund": "290311120", "progfund-lab": "290311120-lab", "research-methods": "040521301", "robotics-foundation": "290313110", "robotics-motion": "290313220"}};
  /* END RENAMES */
  window.APP_ID_RENAMES = RENAMES;

  var plans = Object.keys(RENAMES);
  function reEsc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var tokenRe = {};
  plans.forEach(function(p){ tokenRe[p] = new RegExp('(^|[^A-Za-z0-9_-])' + reEsc(p) + '-c-([A-Za-z0-9_-]+)', 'g'); });

  function renameStr(s, ctx){
    plans.forEach(function(p){
      if(s.indexOf(p + '-c-') === -1) return;
      var map = RENAMES[p];
      s = s.replace(tokenRe[p], function(m, pre, slug){ return pre + p + '-c-' + (map[slug] || slug); });
    });
    if(ctx && RENAMES[ctx][s]) s = RENAMES[ctx][s];
    return s;
  }
  function walk(v, ctx){
    if(typeof v === 'string') return renameStr(v, ctx);
    if(Array.isArray(v)) return v.map(function(x){ return walk(x, ctx); });
    if(!v || typeof v !== 'object') return v;
    // A record that names a renamed major ({plan: 'robotics', slug: …}).
    var own = ctx;
    if(!own){
      for(var k0 in v){ if(typeof v[k0] === 'string' && RENAMES[v[k0]] && k0 !== 'id'){ own = v[k0]; break; } }
      if(!own && typeof v.id === 'string' && RENAMES[v.id] && Array.isArray(v.courses)) own = v.id;
    }
    var out = {};
    Object.keys(v).forEach(function(k){
      var nk = renameStr(k, own);
      var child = walk(v[k], RENAMES[k] ? k : own);
      // Both the old and the new key present: the new one wins.
      if(Object.prototype.hasOwnProperty.call(out, nk) && nk !== k) return;
      out[nk] = child;
    });
    return out;
  }

  function run(){
    if(!plans.length) return 0;
    var changed = 0, keys = [];
    try{
      for(var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach(function(k){
        if(k.indexOf('aaup') !== 0) return;
        var raw = localStorage.getItem(k);
        if(!raw || !plans.some(function(p){ return raw.indexOf(p) !== -1; })) return;
        var val;
        try{ val = JSON.parse(raw); }catch(e){ return; }
        var next = JSON.stringify(walk(val, null));
        if(next !== raw){ localStorage.setItem(k, next); changed++; }
      });
    }catch(e){ /* storage blocked: nothing to move */ }
    return changed;
  }
  window.__migrateCourseIds = run;
  // Old tag -> new id for one major (for anything that still meets an old id).
  window.__renamedId = function(plan, id){ return (RENAMES[plan] && RENAMES[plan][id]) || id; };
  run();
})();
