// ==========================
// PERSONALIZATION (notes, difficulty & workload ratings)
// ==========================
(function(){
  function loadMap(key){
    return window.AAUP_STORAGE.getJSON(key, {});
  }
  function saveMap(key, obj){
    window.AAUP_STORAGE.setJSON(key, obj);
  }


  // Generic pool slots like "uni-elective-2", "free-elective-1",
  // "dept-elective-3", "spec-elective-1" stand in for whatever specific
  // course the student actually took — those get an extra free-text field
  // so the card can show what it really was, instead of just "University
  // elective (2)". Named pool options (e.g. "elective-machine-learning")
  // already have a real title and don't need this.
  function isGenericElectiveSlot(slug){
    return /^(uni|free|dept|spec)-elective-\d+$/.test(slug);
  }

  // Rebuilds one course card's workload tint + bottom badge row (difficulty /
  // workload / has-a-note) from whatever's currently saved. A lecture+lab
  // pair shares one rating, so both halves of the card are refreshed the
  // same way even though only the lecture half's modal can change it.
  function refreshCard(prefix, slug){
    var pid = window.AAUP_GPA.primaryId(prefix, slug);
    var ratings = loadMap('aaup_ratings');
    var notes = loadMap('aaup_notes');
    var r = ratings[pid] || {};

    var basePartsSlug = pid.slice((prefix + '-c-').length);
    var altSlug = basePartsSlug.slice(-4) === '-lab' ? basePartsSlug.slice(0, -4) : basePartsSlug + '-lab';
    [basePartsSlug, altSlug].forEach(function(s){
      var el = document.getElementById(prefix + '-c-' + s);
      if(!el) return;

      el.classList.remove('workload-easy', 'workload-hard');
      if(r.workload === 'Easy') el.classList.add('workload-easy');
      else if(r.workload === 'Hard') el.classList.add('workload-hard');

      var badgeHtml = '';
      if(r.workload){ badgeHtml += '<span class="meta-badge">' + window.AAUP_ICONS.preview('bolt', 11) + r.workload + '</span>'; }
      if(r.difficulty){ badgeHtml += '<span class="meta-badge">' + window.AAUP_ICONS.preview('star', 11) + r.difficulty + '</span>'; }
      if(notes[pid] && notes[pid].trim()){ badgeHtml += '<span class="meta-badge" title="Has a personal note">' + window.AAUP_ICONS.preview('pen', 11) + '</span>'; }

      var badgeRow = el.querySelector('.course-meta-badges');
      if(badgeHtml){
        if(!badgeRow){
          badgeRow = document.createElement('div');
          badgeRow.className = 'course-meta-badges';
          el.appendChild(badgeRow);
        }
        badgeRow.innerHTML = badgeHtml;
      } else if(badgeRow){
        badgeRow.remove();
      }

      // Show what the student actually took in place of a generic
      // "University elective (2)" placeholder, if they've recorded it.
      if(isGenericElectiveSlot(s)){
        var names = loadMap('aaup_customNames');
        var customName = names[pid];
        var tag = el.querySelector('.custom-name-tag');
        if(customName && customName.trim()){
          if(!tag){
            tag = document.createElement('span');
            tag.className = 'custom-name-tag';
            var nameDiv = el.querySelector('.name');
            if(nameDiv){ nameDiv.parentNode.insertBefore(tag, nameDiv.nextSibling); }
            else { el.appendChild(tag); }
          }
          tag.textContent = customName;
        } else if(tag){
          tag.remove();
        }
      }
    });
    // The per-semester "2 hard · 1 easy" roll-up is derived from exactly the
    // rating this card just changed, so keep it in sync from here too.
    if(window.__refreshWorkloadSummary){ window.__refreshWorkloadSummary(prefix); }
  }

  function refreshAllCards(){
    var ratings = loadMap('aaup_ratings');
    var notes = loadMap('aaup_notes');
    var customNames = loadMap('aaup_customNames');
    var touched = {};
    Object.keys(ratings).concat(Object.keys(notes)).concat(Object.keys(customNames)).forEach(function(pid){
      if(touched[pid]) return;
      touched[pid] = true;
      var parts = window.__splitCourseId(pid);
      if(parts) refreshCard(parts.prefix, parts.slug);
    });
  }

  window.AAUP_PERSONAL = {
    loadRatings: function(){ return loadMap('aaup_ratings'); },
    saveRatings: function(m){ saveMap('aaup_ratings', m); },
    loadNotes: function(){ return loadMap('aaup_notes'); },
    saveNotes: function(m){ saveMap('aaup_notes', m); },
    loadCustomNames: function(){ return loadMap('aaup_customNames'); },
    saveCustomNames: function(m){ saveMap('aaup_customNames', m); },
    isGenericElectiveSlot: isGenericElectiveSlot,
    refreshCard: refreshCard,
    refreshAllCards: refreshAllCards
  };

  if(document.readyState === 'complete'){ refreshAllCards(); }
  else { window.addEventListener('load', refreshAllCards); }
})();
