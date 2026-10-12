// ==========================
// ACCOUNTS
// ==========================
// Lets one browser/device support more than one independent student
// profile — its own selected plan(s), progress, GPA, ratings, everything.
// Rather than rewriting every module in this file to namespace its own
// storage key by account (a huge, error-prone change touching nearly
// every feature built so far), switching accounts snapshots the CURRENT
// account's full state into one blob, clears the live keys, and restores
// the target account's own blob (or starts empty, for a brand new one) —
// then reloads, so every module just re-initializes from scratch exactly
// like a normal fresh page load already knows how to do.
(function(){
  var ACCOUNTS_KEY = 'aaup_accounts';
  var CURRENT_KEY = 'aaup_currentAccount';
  var SNAPSHOT_PREFIX = 'aaup_account_snapshot_';
  var DEFAULT_NAME = 'Default';

  function listAccounts(){
    try{ var m = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '{}') || {}; return Object.keys(m); }
    catch(e){ return []; }
  }
  function markAccountExists(name){
    var m; try{ m = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '{}') || {}; }catch(e){ m = {}; }
    m[name] = true;
    try{ localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(m)); }catch(e){}
  }
  function currentAccount(){
    try{ return localStorage.getItem(CURRENT_KEY) || DEFAULT_NAME; }catch(e){ return DEFAULT_NAME; }
  }

  // Same scan Reset All Data already relies on (any aaup_ or legacy
  // aaup-imported-progress- key), minus the account-management keys
  // themselves, which must never be swapped away.
  function relevantKeys(){
    var keys = [];
    var progressKey = window.__PROGRESS_STORAGE_KEY;
    if(progressKey) keys.push(progressKey);
    try{
      for(var i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i);
        if(!k || keys.indexOf(k) !== -1) continue;
        if(k === ACCOUNTS_KEY || k === CURRENT_KEY || k.indexOf(SNAPSHOT_PREFIX) === 0) continue;
        if(k.indexOf('aaup_') === 0 || k.indexOf('aaup-imported-progress-') === 0){ keys.push(k); }
      }
    }catch(e){}
    return keys;
  }

  // Returns whether the snapshot is genuinely on disk. Writing it is not
  // enough to know that: a device at its storage quota throws, and some
  // browsers evict or truncate instead, so the value is read back and
  // compared. switchTo() wipes live storage immediately after this, so a
  // snapshot that only LOOKED saved would take the account's whole history
  // with it \u2014 this boolean is the one thing standing between a full
  // device and permanent data loss.
  function snapshotCurrent(name){
    var keys = relevantKeys();
    var data = {};
    keys.forEach(function(k){ data[k] = localStorage.getItem(k); });
    var payload = JSON.stringify(data);
    try{
      localStorage.setItem(SNAPSHOT_PREFIX + name, payload);
      return localStorage.getItem(SNAPSHOT_PREFIX + name) === payload;
    }catch(e){ return false; }
  }
  function clearLiveKeys(){
    relevantKeys().forEach(function(k){ try{ localStorage.removeItem(k); }catch(e){} });
  }
  // true = this account's data is now live. A brand-new account legitimately
  // has no snapshot and a clean slate is the correct result, so that counts
  // as success; only an unreadable or malformed one is a failure worth
  // rolling back for.
  function restoreSnapshot(name){
    var raw;
    try{ raw = localStorage.getItem(SNAPSHOT_PREFIX + name); }
    catch(e){ return false; }
    if(raw === null || raw === '') return true;
    var data;
    try{ data = JSON.parse(raw); }
    catch(e){ return false; }
    if(!data || typeof data !== 'object') return false;
    try{
      Object.keys(data).forEach(function(k){
        if(data[k] !== null && data[k] !== undefined){ localStorage.setItem(k, data[k]); }
      });
    }catch(e){ return false; }
    return true;
  }

  function switchTo(name){
    name = (name || '').trim();
    if(!name) return { ok: false, error: window.__L('Please enter a name.', 'اكتب اسم.') };
    var current = currentAccount();
    if(name === current) return { ok: false, error: window.__L('That\u2019s already the current account.', 'هاد هو الحساب الحالي.') };
    // Save the account being left, and confirm it stuck, BEFORE touching
    // anything. Nothing has been modified at this point, so bailing out here
    // is completely safe \u2014 unlike bailing out after the wipe below.
    if(!snapshotCurrent(current)){
      return { ok: false, error: window.__L('Couldn\u2019t save \u201c' + current + '\u201d before switching, so nothing was changed and your progress is exactly as it was. This device\u2019s storage is most likely full \u2014 export a backup from Settings, free some space, then try again.',
        'ما قدرنا نحفظ «' + current + '» قبل التبديل، فما تغيّر إشي وتقدّمك زي ما هو. غالبًا مساحة الجهاز ممتلئة \u2014 احفظ نسخة احتياطية من الإعدادات، فضّي مساحة، وجرّب مرة ثانية.') };
    }
    markAccountExists(current);
    clearLiveKeys();
    if(!restoreSnapshot(name)){
      // The target's saved data is damaged. Live storage is empty right now,
      // so put back the account we just left rather than stranding them in
      // an empty app with everything apparently gone.
      restoreSnapshot(current);
      return { ok: false, error: window.__L('Couldn\u2019t open \u201c' + name + '\u201d \u2014 its saved data looks damaged, so you\u2019ve been left on \u201c' + current + '\u201d with everything intact.',
        'ما قدرنا نفتح «' + name + '» \u2014 بياناته شكلها خربانة، فضلّيت على «' + current + '» وكل إشي سليم.') };
    }
    markAccountExists(name);
    try{ localStorage.setItem(CURRENT_KEY, name); }catch(e){}
    location.reload();
    return { ok: true };
  }

  function createAccount(name){
    name = (name || '').trim();
    if(!name) return { ok: false, error: window.__L('Please enter a name.', 'اكتب اسم.') };
    if(listAccounts().indexOf(name) !== -1) return { ok: false, error: window.__L('An account with that name already exists.', 'في حساب بهالاسم.') };
    return switchTo(name);
  }

  function deleteAccount(name){
    if(name === currentAccount()) return { ok: false, error: window.__L('Can\u2019t delete the account you\u2019re currently using \u2014 switch to another one first.', 'ما بتقدر تحذف الحساب اللي أنت فيه \u2014 بدّل لحساب ثاني أول.') };
    var m; try{ m = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '{}') || {}; }catch(e){ m = {}; }
    delete m[name];
    try{ localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(m)); }catch(e){}
    try{ localStorage.removeItem(SNAPSHOT_PREFIX + name); }catch(e){}
    return { ok: true };
  }

  function init(){ markAccountExists(currentAccount()); }
  init();

  window.AAUP_ACCOUNTS = {
    listAccounts: listAccounts, currentAccount: currentAccount,
    switchTo: switchTo, createAccount: createAccount, deleteAccount: deleteAccount
  };
})();
