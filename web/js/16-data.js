// ==========================
// DATA EXPORT / IMPORT / RESET
// ==========================
(function(){
  function relevantKeys(){
    var keys = [];
    var progressKey = window.__PROGRESS_STORAGE_KEY;
    if(progressKey) keys.push(progressKey);
    try{
      for(var i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i);
        if(!k || keys.indexOf(k) !== -1) continue;
        // Most of this app's keys use an underscore (aaup_xxx), but the
        // legacy per-imported-plan progress keys predate that convention
        // and use a hyphen instead (aaup-imported-progress-<planId>, one
        // per plan, name unknown in advance) — both need to be caught or
        // Reset All Data silently leaves some progress behind.
        if(k.indexOf('aaup_') === 0 || k.indexOf('aaup-imported-progress-') === 0){ keys.push(k); }
      }
    }catch(e){ /* storage unavailable */ }
    return keys;
  }

  function exportData(){
    var bundle = { app: 'AAUP Planner', version: 1, exportedAt: new Date().toISOString(), data: {} };
    relevantKeys().forEach(function(k){
      try{
        var raw = localStorage.getItem(k);
        if(raw !== null){ bundle.data[k] = JSON.parse(raw); }
      }catch(e){ /* skip an entry that somehow isn't valid JSON */ }
    });
    var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'aaup-planner-progress-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    if(window.__showToast) window.__showToast('Progress exported!');
  }

  function triggerImport(){
    var input = document.getElementById('importFileInput');
    if(input) input.click();
  }

  function handleImportFile(file){
    var reader = new FileReader();
    reader.onload = function(){
      var parsed;
      try{ parsed = JSON.parse(String(reader.result)); }
      catch(e){
        if(window.__showToast) window.__showToast('That file is not valid JSON.');
        return;
      }
      var data = parsed && parsed.data;
      if(!data || typeof data !== 'object'){
        if(window.__showToast) window.__showToast('That file does not look like an AAUP Planner export.');
        return;
      }
      // Only this app's own keys — a backup file is just JSON anyone could
      // have edited (or built), and without this check it could write ANY
      // localStorage key on this origin, not just planner data.
      var progressKey = window.__PROGRESS_STORAGE_KEY;
      function isOwnKey(k){
        return k === progressKey || k.indexOf('aaup_') === 0 || k.indexOf('aaup-imported-progress-') === 0;
      }
      // The plans inside a backup get the same treatment as any other
      // imported plan (see __sanitizeImportedPlan) — a "here, take my
      // progress backup" file from another student is exactly as
      // attacker-controlled as a shared plan file. Community feedback is
      // rebuilt against its own whitelist for the same reason.
      if(data.aaup_importedPlans && typeof data.aaup_importedPlans === 'object' && window.__sanitizeImportedPlan){
        Object.keys(data.aaup_importedPlans).forEach(function(pid){
          data.aaup_importedPlans[pid] = window.__sanitizeImportedPlan(data.aaup_importedPlans[pid]);
        });
      }
      if(data['aaup_community_feedback'] && typeof data['aaup_community_feedback'] === 'object'){
        var WORKLOADS = ['Easy','Medium','Hard'];
        Object.keys(data['aaup_community_feedback']).forEach(function(cid){
          var entry = data['aaup_community_feedback'][cid] || {};
          var counts = {};
          WORKLOADS.forEach(function(w){
            if(entry.workloadCounts && typeof entry.workloadCounts[w] === 'number'){ counts[w] = entry.workloadCounts[w]; }
          });
          data['aaup_community_feedback'][cid] = {
            totalDifficulty: Number(entry.totalDifficulty) || 0,
            difficultyVotes: Number(entry.difficultyVotes) || 0,
            workloadCounts: counts,
            sampleNotes: (Array.isArray(entry.sampleNotes) ? entry.sampleNotes.slice(0, 5) : []).map(function(n){
              return window.__cleanText(String(n).slice(0, 200));
            })
          };
        });
      }
      if(data.aaup_ratings && typeof data.aaup_ratings === 'object'){
        Object.keys(data.aaup_ratings).forEach(function(rid){
          var r = data.aaup_ratings[rid] || {};
          data.aaup_ratings[rid] = {
            workload: ['Easy','Medium','Hard'].indexOf(r.workload) !== -1 ? r.workload : undefined,
            difficulty: (typeof r.difficulty === 'number' && r.difficulty >= 1 && r.difficulty <= 5) ? r.difficulty : undefined
          };
        });
      }
      var count = 0;
      Object.keys(data).forEach(function(k){
        if(!isOwnKey(k)) return;
        try{ localStorage.setItem(k, JSON.stringify(data[k])); count++; }
        catch(e){ /* skip a key that fails to write */ }
      });
      if(window.__showToast) window.__showToast('Imported ' + count + ' item(s) — reloading…');
      setTimeout(function(){ location.reload(); }, 900);
    };
    reader.readAsText(file);
  }

  // The erase itself, with no question asked — Settings asks its own
  // (type RESET) before calling this.
  function resetAllNow(){
    relevantKeys().forEach(function(k){ try{ localStorage.removeItem(k); }catch(e){} });
    if(window.__showToast) window.__showToast('Everything cleared — reloading…');
    setTimeout(function(){ location.reload(); }, 700);
  }

  function confirmResetAll(){
    var rtl = window.__anyVisiblePageIsRtl && window.__anyVisiblePageIsRtl();
    var msg = rtl
      ? 'هل أنت متأكد أنك تريد مسح كل التقدم والبيانات المحفوظة (جميع الخطط، ملفك الشخصي، الملاحظات، التقييمات)؟ لا يمكن التراجع عن هذا.'
      : 'Are you sure you want to erase ALL progress and saved data (every plan, your profile, notes, ratings)? This cannot be undone.';
    var doer = resetAllNow;
    if(window.__showConfirmDialog){ window.__showConfirmDialog(msg, doer, rtl); }
    else if(window.confirm(msg)){ doer(); }
  }

  function bindImportInput(){
    var input = document.getElementById('importFileInput');
    if(!input) return;
    input.addEventListener('change', function(){
      if(input.files && input.files[0]){ handleImportFile(input.files[0]); }
      input.value = '';
    });
  }
  if(document.readyState === 'complete'){ bindImportInput(); }
  else { window.addEventListener('load', bindImportInput); }

  window.AAUP_DATA = {
    exportData: exportData,
    triggerImport: triggerImport,
    handleImportFile: handleImportFile,
    confirmResetAll: confirmResetAll,
    resetAllNow: resetAllNow
  };
})();
