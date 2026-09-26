// ==========================
// SHARE FEEDBACK (student -> developer, via a plain mailto: link — no
// external email library, nothing is sent automatically; the student still
// has to hit Send in their own mail app)
// ==========================
(function(){
  var FEEDBACK_EMAIL = 'pmhtrfalab999@gmail.com';

  function buildFeedback(prefix){
    var ratings = window.AAUP_PERSONAL.loadRatings();
    var notes = window.AAUP_PERSONAL.loadNotes();
    var seen = {};
    var feedback = [];
    Object.keys(ratings).concat(Object.keys(notes)).forEach(function(pid){
      if(seen[pid]) return;
      seen[pid] = true;
      var parts = window.__splitCourseId(pid);
      if(!parts || parts.prefix !== prefix) return; // only this plan's courses
      var r = ratings[pid] || {};
      var note = notes[pid] || '';
      if(!r.difficulty && !r.workload && !note.trim()) return; // nothing actually entered — skip
      feedback.push({
        courseId: parts.slug,
        difficulty: r.difficulty || null,
        workload: r.workload || null,
        note: note || ''
      });
    });
    return feedback;
  }

  function send(prefix){
    var feedback = buildFeedback(prefix);
    if(feedback.length === 0){
      if(window.__showToast) window.__showToast('Nothing to share yet — rate a course first');
      return;
    }
    var info = window.AAUP_STUDENT ? window.AAUP_STUDENT.get() : null;
    var payload = {
      studentName: (info && info.name) || null,
      studentGPA: (info && typeof info.gpa === 'number') ? info.gpa : null,
      studentGender: (info && info.gender) || null,
      major: prefix,
      submittedAt: new Date().toISOString(),
      feedback: feedback
    };
    var subject = 'AAUP Course Feedback \u2013 ' + ((info && info.name) || 'Anonymous Student');
    var body = JSON.stringify(payload, null, 2);
    var mailto = 'mailto:' + FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    window.location.href = mailto;
    if(window.__showToast) window.__showToast('Email opened \u2014 hit send');
  }

  window.AAUP_FEEDBACK = { send: send, buildFeedback: buildFeedback };
})();
