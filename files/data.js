// data.js — Firebase Auth + all Firestore reads + rendering into the DOM
// Depends on: firebase-config.js (firebaseConfig), ui.js (goTab), and the Firebase
// compat SDK scripts (app, firestore, auth) being loaded before this file.

let app, db, auth;
try{
  app = firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  auth = firebase.auth();
}catch(e){ console.error("Firebase init failed:", e); }

let currentStudent = null;

function showLoginError(msg){
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.style.display = 'block';
}

async function handleLogin(){
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  document.getElementById('loginError').style.display = 'none';
  if(!email || !password){ showLoginError('Enter your email and password.'); return; }
  try{
    await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged below handles showing the app
  }catch(e){
    console.error(e);
    const friendly = {
      'auth/invalid-email': 'That email address looks invalid.',
      'auth/user-not-found': 'No account found for that email.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/invalid-credential': 'Incorrect email or password.',
      'auth/too-many-requests': 'Too many attempts — try again shortly.'
    };
    showLoginError(friendly[e.code] || 'Could not sign in. Please try again.');
  }
}

function handleLogout(){
  auth.signOut();
}

function showLoggedOutUI(){
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appMain').style.display = 'none';
  document.getElementById('appNav').style.display = 'none';
}

function showLoggedInUI(){
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appMain').style.display = 'block';
  document.getElementById('appNav').style.display = 'flex';
}

if(auth){
  auth.onAuthStateChanged(async (user) => {
    if(user){
      showLoggedInUI();
      await loadStudentByUid(user.uid);
      loadNotices();
    }else{
      showLoggedOutUI();
    }
  });
}

function timeAgo(date){
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if(s < 60) return "Just now";
  if(s < 3600) return Math.floor(s / 60) + "m ago";
  if(s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

function toDate(ts){
  if(!ts) return null;
  if(ts.toDate) return ts.toDate();
  return new Date(ts);
}

async function loadNotices(){
  const el = document.getElementById('noticesList');
  try{
    const snap = await db.collection('notices').orderBy('createdAt', 'desc').limit(10).get();
    if(snap.empty){ el.innerHTML = '<p class="sub">No notices yet.</p>'; return; }
    el.innerHTML = snap.docs.map(doc => {
      const n = doc.data();
      const when = toDate(n.createdAt);
      return `<div class="notice">
        <div class="row"><span class="who">${n.title || 'Notice'}</span><span class="when">${when ? timeAgo(when) : ''}</span></div>
        <p style="margin-top:8px;font-size:14px;">${n.body || ''}</p>
        ${n.photo ? `<img src="${n.photo}">` : ''}
      </div>`;
    }).join('');
  }catch(e){
    console.error(e);
    el.innerHTML = '<p class="sub">Could not load notices.</p>';
  }
}

async function loadStudentByUid(uid){
  try{
    const doc = await db.collection('students').doc(uid).get();
    if(!doc.exists) throw new Error('Student profile not found for this account');
    currentStudent = { id: doc.id, ...doc.data() };
    renderProfile();
    renderBatch();
    loadFees();
    loadAttendance();
  }catch(e){
    console.error(e);
    document.getElementById('profileName').textContent = 'Could not load profile';
    document.getElementById('batchCard').innerHTML = '<p class="sub">Could not load batch.</p>';
    document.getElementById('attendanceList').innerHTML = '<p class="sub">Could not load attendance.</p>';
  }
}

function renderProfile(){
  const s = currentStudent;
  document.getElementById('profileName').textContent = s.name || 'Student';
  document.getElementById('profileRole').textContent = (s.course || 'Student') + ' · ' + (s.status || '');
  document.getElementById('profileEmail').textContent = s.email || '—';
  const initial = (s.name || '?').trim().charAt(0).toUpperCase();
  if(s.photo){
    document.getElementById('profileCover').innerHTML =
      `<img src="${s.photo}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid var(--bg);position:absolute;left:16px;bottom:-30px;">`;
  }else{
    document.getElementById('avatarInitial').textContent = initial;
  }
}

function renderBatch(){
  const s = currentStudent;
  const statusColor = s.status === 'active' ? '' : 'style="background:rgba(224,164,55,.15);color:var(--amber);"';
  document.getElementById('batchCard').innerHTML = `
    <div class="card" onclick="goTab('batch-detail')">
      <div class="row"><b>${s.course || 'Batch'}</b></div>
      <p class="sub" style="margin:4px 0 8px;">Kinniya-01</p>
      <span class="badge" ${statusColor}>${(s.status || '').toUpperCase()}</span>
    </div>`;
  document.getElementById('batchTitle').textContent = s.course || 'Batch';
  document.getElementById('batchSub').textContent = 'Kinniya-01 · ' + (s.status || '');
}

async function loadFees(){
  const el = document.getElementById('feeCard');
  try{
    let snap = await db.collection('fees').where('studentUid', '==', currentStudent.id).get();
    if(snap.empty){
      // fallback: match by course/month if studentUid isn't present on fee docs
      snap = await db.collection('fees').where('month', '==', currentStudent.course).get();
    }
    if(snap.empty){ el.innerHTML = '<p class="sub">No fee record found.</p>'; return; }
    const f = snap.docs[0].data();
    const pct = f.courseFee ? Math.min(100, Math.round((f.paidTotal / f.courseFee) * 100)) : 0;
    el.innerHTML = `
      <div class="row"><b>Payment plan</b><span class="sub">Rs ${f.paidTotal || 0} / ${f.courseFee || 0}</span></div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <p class="sub" style="margin-bottom:8px;">Due ${f.dueDate || '—'} · ${f.settled ? 'Settled' : 'Remaining Rs ' + ((f.courseFee || 0) - (f.paidTotal || 0))}</p>
      ${(f.payments || []).map(p => `
        <div class="checklist-item"><div class="dot done">✓</div><div><div class="ci-title">Rs ${p.amount}</div><div class="ci-sub">${p.date}${p.note ? ' · ' + p.note : ''}</div></div></div>
      `).join('')}`;
  }catch(e){
    console.error(e);
    el.innerHTML = '<p class="sub">Could not load fees.</p>';
  }
}

async function loadAttendance(){
  const listEl = document.getElementById('attendanceList');
  const gridEl = document.getElementById('calGrid');
  try{
    const snap = await db.collection('attendance')
      .where('studentUid', '==', currentStudent.id)
      .orderBy('date', 'desc').limit(30).get();
    if(snap.empty){ listEl.innerHTML = '<p class="sub">No attendance records yet.</p>'; return; }
    const records = snap.docs.map(d => d.data());
    listEl.innerHTML = records.slice(0, 8).map(r => `
      <div class="class-item" style="border-left-color:${r.status === 'present' ? 'var(--green)' : 'var(--red)'}">
        <div class="t">${r.date}</div>
        <div class="m">${(r.status || '').toUpperCase()}</div>
      </div>`).join('');

    // build calendar grid for the month of the latest record
    const latest = new Date(records[0].date + 'T00:00:00');
    const monthLabel = latest.toLocaleString('default', { month: 'long', year: 'numeric' });
    document.getElementById('calMonthLabel').textContent = monthLabel;
    const presentDates = new Set(records.filter(r => r.status === 'present').map(r => r.date));
    const year = latest.getFullYear(), month = latest.getMonth();
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let html = '';
    for(let i = 0; i < firstDow; i++) html += '<div></div>';
    const todayStr = new Date().toISOString().slice(0, 10);
    for(let d = 1; d <= daysInMonth; d++){
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      let cls = 'day';
      if(presentDates.has(dateStr)) cls += ' hi';
      if(dateStr === todayStr) cls += ' today';
      html += `<div class="${cls}">${d}</div>`;
    }
    gridEl.innerHTML = html;
  }catch(e){
    console.error(e);
    listEl.innerHTML = '<p class="sub">Could not load attendance.</p>';
  }
}
