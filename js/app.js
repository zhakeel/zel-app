/* ZEL — main app: Firebase (Auth, Firestore, Storage) + all screens. Loaded as an ES module. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getStorage, ref as sRef, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, EmailAuthProvider,
  reauthenticateWithCredential, updatePassword, deleteUser, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc,
  collection, getDocs, addDoc, deleteDoc,
  query, orderBy, where, serverTimestamp,
  limit, startAfter, getCountFromServer, increment,
  onSnapshot, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({
  apiKey: "AIzaSyDn4b3InpK68vw9HdTgHCc6jpmUuh0YD0c",
  authDomain: "zel-app-cfb38.firebaseapp.com",
  projectId: "zel-app-cfb38",
  storageBucket: "zel-app-cfb38.firebasestorage.app",
  messagingSenderId: "178893517113",
  appId: "1:178893517113:web:65cfce0b5cdd2a655d78e8"
});
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const adminResetPasswordFn = httpsCallable(functions, 'adminResetPassword');
const adminRecreateAuthFn = httpsCallable(functions, 'adminRecreateStudentAuth');
const storage = getStorage(app);

const SUPER_ADMIN = "zhakeel.mhd@gmail.com";
const DEFAULT_BATCHES = ['Batch 20','Batch 21','Batch 22','Batch 23','Batch 24'];
const PAGE = 30;

// ── Helpers ──
const $ = id => document.getElementById(id);
function showScreen(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); $(id).classList.add('active'); }
function alertMsg(id, msg, type='err', keep=false){
  const el = $(id); if(!el) return;
  el.className = 'alert '+type;
  el.textContent = msg;
  if(!keep) setTimeout(()=>{ el.className='alert'; }, 5000);
}
function esc(s){ return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
window.esc = esc;

function resizeImg(file, maxDim=400, q=0.75){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Cannot read file'));
    r.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('Cannot load image'));
      img.onload = () => {
        let { width:w, height:h } = img;
        if(w>h && w>maxDim){ h = Math.round(h*maxDim/w); w = maxDim; }
        else if(h>maxDim){ w = Math.round(w*maxDim/h); h = maxDim; }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,w,h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', q));
      };
      img.src = e.target.result;
    };
    r.readAsDataURL(file);
  });
}

// Upload a base64 image to Firebase Storage and return the public download URL
async function uploadPhotoToStorage(base64DataUrl, uid){
  const path = `photos/${uid}_${Date.now()}.jpg`;
  const r = sRef(storage, path);
  await uploadString(r, base64DataUrl, 'data_url');
  return await getDownloadURL(r);
}

async function nextStudentId(){
  // Atomic transaction — safe for 100 concurrent registrations
  // No two students will ever get the same ID
  const ref = doc(db, 'meta', 'counters');
  const n = await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    let next = 1;
    if(snap.exists()){
      next = (snap.data().studentCount || 0) + 1;
      tx.update(ref, { studentCount: increment(1) });
    } else {
      tx.set(ref, { studentCount: 1, totalPaid: 0 });
    }
    return next;
  });
  return `ZEL${String(n).padStart(4,'0')}`;
}

async function isAdmin(email){
  if(!email) return false;
  if(email === SUPER_ADMIN) return true;
  try {
    const s = await getDoc(doc(db, 'admins', email));
    return s.exists();
  } catch(e){ return false; }
}

// ── State ──
let CU = null;       // current Firebase user
let CUD = null;      // current user data from Firestore
let pendingPhoto = null, regPhoto = null, addPhoto = null;
let photoTarget = null;
let confirmRes = null, resendTimer = null;
let attCursor = null, feeCursor = null, batchCursor = null;
let currentBatch = null, batchLoaded = [];
let pickers = { at: null, fe: null };
let pickerTimers = { at: null, fe: null };
let attRecs = [], feeRecs = [];
let isSuperAdmin = false;
let allBatches = [...DEFAULT_BATCHES]; // current list of batches available

// ══ BATCH OPTIONS ══ (loads from Firestore + populates dropdowns)
async function loadBatchOptions(){
  try {
    const snap = await getDocs(query(collection(db,'batches'), orderBy('name','asc')));
    let list = [];
    if(!snap.empty){
      snap.forEach(d => list.push(d.data().name));
    }
    // No fallback to defaults - if no custom batches, list stays empty
    allBatches = list;
    // populate register dropdown
    const r = $('rg-ba');
    if(r){
      if(list.length === 0){
        r.innerHTML = '<option value="">No batches available — contact admin</option>';
      } else {
        r.innerHTML = '<option value="">Select batch...</option>' + list.map(b=>`<option>${esc(b)}</option>`).join('');
      }
    }
    // populate add student dropdown
    const a = $('ad-ba');
    if(a){
      if(list.length === 0){
        a.innerHTML = '<option value="">No batches yet — add one in Manage Batches first</option>';
      } else {
        a.innerHTML = '<option value="">Select Batch *</option>' + list.map(b=>`<option>${esc(b)}</option>`).join('');
      }
    }
  } catch(e){
    allBatches = [];
    const r = $('rg-ba');
    if(r) r.innerHTML = '<option value="">Could not load batches</option>';
    const a = $('ad-ba');
    if(a) a.innerHTML = '<option value="">Could not load batches</option>';
  }
}

// Load batches on page load (so register form has options before login)
loadBatchOptions();

// ── Auth state ──
onAuthStateChanged(auth, async user => {
  CU = user;
  if(!user){
    CUD = null;
    stopDisabledWatcher();
    showScreen('scr-login');
    loadBatchOptions(); // refresh in case
    return;
  }
  const admin = await isAdmin(user.email);
  if(admin){
    isSuperAdmin = (user.email === SUPER_ADMIN);
    showScreen('scr-admin');
    $('a-em').textContent = user.email;
    $('b-grant').style.display = isSuperAdmin ? 'block' : 'none';
    $('t-admins').style.display = isSuperAdmin ? 'block' : 'none';
    await loadBatchOptions();
    await loadBatches();
    loadNotices();
    if(isSuperAdmin) loadAdminsList();
  } else {
    // Load student data with retry logic
    // (handles timing issue when student just registered and setDoc may not have completed)
    CUD = null;
    try { const cached = sessionStorage.getItem('zel_cud'); if(cached) CUD = JSON.parse(cached); } catch(_){}
    for(let attempt = 0; attempt < 3; attempt++){
      try {
        const s = await getDoc(doc(db, 'students', user.uid));
        if(s.exists()){
          CUD = s.data();
          break;
        }
      } catch(e){ /* keep trying */ }
      if(attempt < 2) await new Promise(r => setTimeout(r, 300));
    }
    showScreen('scr-dash');
    if(CUD){
      try { sessionStorage.setItem('zel_cud', JSON.stringify(CUD)); } catch(_){}
      try {
        if(CUD.studentId && CUD.email && !sessionStorage.getItem('zel_lm_'+user.uid)){
          saveLoginMap(CUD.studentId, CUD.email);
          sessionStorage.setItem('zel_lm_'+user.uid,'1');
        }
      } catch(_){}
      renderStudent();
      loadStudentNotices();
      loadStudentAtt();
      loadStudentFees();
      // Start watching for admin removal
      startDisabledWatcher(user.uid);
    } else {
      // Profile missing — could mean the student was just removed by admin
      // Check if they're in the disabled list
      try {
        const dis = await getDoc(doc(db,'disabled', user.uid));
        if(dis.exists()){
          try { await deleteDoc(doc(db,'disabled', user.uid)); } catch(_){}
          await signOut(auth);
          alert('Your account has been removed by the administrator.');
          return;
        }
      } catch(_){}
      $('d-welcome').textContent = 'Welcome! 👋';
      alert('Your student profile was not found. Please contact admin.');
    }
  }
});

// ══ AUTH ══
// ══ STUDENT-ID LOGIN ══
// Accepts "ZEL0001", "ZEL-0001", "zel0001", "0001" or "1" and returns "ZEL0001" (or null)
function normSid(raw){
  const t = String(raw||'').trim().toUpperCase().replace(/\s+/g,'');
  let m = t.match(/^ZEL-?(\d{1,6})$/) || t.match(/^(\d{1,6})$/);
  return m ? `ZEL${m[1].padStart(4,'0')}` : null;
}
// Public, tiny lookup: loginMap/{studentId} -> { email }. Lets a student sign in
// BEFORE being authenticated without exposing the whole students collection.
async function saveLoginMap(sid, email){
  if(!sid || !email) return;
  try {
    const ref = doc(db,'loginMap', sid);
    const ex = await getDoc(ref);
    if(!ex.exists()) await setDoc(ref, { email });
  } catch(_){}
}
async function emailFromStudentId(sid){
  // new format first (ZEL0001), then the old hyphen format (ZEL-0001)
  const keys = [sid, sid.replace(/^ZEL/, 'ZEL-')];
  for(const k of keys){
    try {
      const m = await getDoc(doc(db,'loginMap', k));
      if(m.exists() && m.data().email) return m.data().email;
    } catch(_){}
  }
  // legacy fallback (only works if your rules allow reading students while signed out)
  for(const k of keys){
    try {
      const snap = await getDocs(query(collection(db,'students'), where('studentId','==', k), limit(1)));
      if(!snap.empty) return snap.docs[0].data().email || null;
    } catch(_){}
  }
  return null;
}

window.doLogin = async () => {
  const input = $('li-em').value.trim();
  const pass = $('li-pw').value;
  const btn = $('bt-li');
  const reset = () => { btn.innerHTML = 'Sign In'; btn.disabled = false; };
  if(!input || !pass){ alertMsg('la', 'Please enter your Student ID and password.'); return; }
  btn.innerHTML = '<span class="spin"></span>Signing in...'; btn.disabled = true;
  try {
    let email = input;
    if(!input.includes('@')){
      const sid = normSid(input);
      if(!sid){ alertMsg('la', 'Enter your Student ID like ZEL0001 (or your email).'); reset(); return; }
      email = await emailFromStudentId(sid);
      if(!email){
        alertMsg('la', 'Student ID not found. Check the ID, or sign in once with your email, or ask the admin.');
        reset(); return;
      }
    }
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e){
    let m = 'Login failed.';
    if(e.code === 'auth/user-not-found') m = 'No account found.';
    if(e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') m = 'Incorrect Student ID or password.';
    if(e.code === 'auth/too-many-requests') m = 'Too many attempts. Please wait.';
    if(e.code === 'auth/invalid-email') m = 'Please enter a valid Student ID or email.';
    alertMsg('la', m);
  }
  reset();
};

// Admin: create loginMap entries for every existing student in one click
window.syncLoginMap = async () => {
  const btn = $('bt-sync');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Syncing...';
  try {
    const snap = await getDocs(collection(db,'students'));
    let added = 0, total = 0;
    for(const d of snap.docs){
      const st = d.data();
      if(!st.studentId || !st.email) continue;
      total++;
      const ref = doc(db,'loginMap', st.studentId);
      const ex = await getDoc(ref);
      if(!ex.exists()){ await setDoc(ref, { email: st.email }); added++; }
    }
    alertMsg('sy-al', `✅ Done. ${added} added, ${total-added} already set (${total} students).`, 'ok');
  } catch(e){
    alertMsg('sy-al', 'Sync failed: ' + e.message);
  }
  btn.disabled = false; btn.innerHTML = '🔄 Sync Student ID Logins';
};

// Admin: convert old IDs (ZEL-0001) to the new format (ZEL0001) everywhere. Run once.
window.migrateStudentIds = async () => {
  if(!confirm('Convert all old IDs like ZEL-0001 to ZEL0001?\n\nThis updates students, attendance and fees. Run it once.')) return;
  const btn = $('bt-mig');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Converting...';
  try {
    const snap = await getDocs(collection(db,'students'));
    let students = 0, records = 0;
    for(const d of snap.docs){
      const st = d.data();
      const old = st.studentId || '';
      const m = old.match(/^ZEL-(\d+)$/i);
      if(!m) continue;
      const nid = 'ZEL' + m[1];
      await updateDoc(doc(db,'students', d.id), { studentId: nid });
      for(const col of ['attendance','fees']){
        const rs = await getDocs(query(collection(db,col), where('studentId','==', old)));
        for(const r of rs.docs){ await updateDoc(r.ref, { studentId: nid }); records++; }
      }
      if(st.email) await saveLoginMap(nid, st.email);
      students++;
    }
    alertMsg('sy-al', `✅ Done. ${students} students and ${records} attendance/fee records converted.`, 'ok');
  } catch(e){
    alertMsg('sy-al', 'Conversion failed: ' + e.message);
  }
  btn.disabled = false; btn.innerHTML = '🔁 Convert Old IDs to ZEL0001';
};

// ══ FORGOT PASSWORD (Student ID or email) ══
window.doForgotPassword = async () => {
  const input = $('fp-em').value.trim();
  const btn = $('bt-fp');
  const reset = () => { btn.innerHTML = 'Send Reset Link'; btn.disabled = false; };
  if(!input){ alertMsg('la', 'Please enter your Student ID or email.'); return; }
  btn.innerHTML = '<span class="spin"></span>Sending...'; btn.disabled = true;
  const finish = () => {
    alertMsg('la', "✅ If an account exists, a password reset link has been sent to its email. Check the inbox (and spam folder).", 'ok', true);
    $('fp-em').value = ''; reset();
  };
  try {
    let email = input;
    if(!input.includes('@')){
      const sid = normSid(input);
      if(!sid){ alertMsg('la', 'Please enter a valid email or Student ID (e.g. ZEL0001).'); reset(); return; }
      email = await emailFromStudentId(sid);
      if(!email){ finish(); return; }
    }
    await sendPasswordResetEmail(auth, email);
  } catch(e){
    if(e.code === 'auth/invalid-email'){ alertMsg('la', 'Please enter a valid email address or Student ID.'); reset(); return; }
  }
  finish();
};

// ══ ADMIN: RESET STUDENT PASSWORD (no email) ══
// Uses a Cloud Function running with Admin privileges — the only way to
// directly set another account's password. The client itself never has
// this power, by design.
function genRandomPassword(len=10){
  // Avoids visually ambiguous characters (0/O, 1/l/I) since an admin will
  // read this password aloud or type it into a message by hand.
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let out = '';
  for(let i=0;i<len;i++) out += chars[arr[i] % chars.length];
  return out;
}
window.resetStudentPassword = async (uid, name) => {
  const newPass = genRandomPassword(10);
  const ok = confirm(
    `Reset password for ${name}?\n\n` +
    `New password:\n${newPass}\n\n` +
    `No email will be sent — you'll need to share this with the student yourself ` +
    `(WhatsApp, SMS, in person, etc).\n\nContinue?`
  );
  if(!ok) return;
  try {
    await adminResetPasswordFn({ uid, newPassword: newPass });
    alert(`✅ Password reset for ${name}.\n\nNew password:\n${newPass}\n\nShare it with the student securely — this won't be shown again.`);
  } catch(e){
    if(/no longer exists in Firebase Authentication/.test(e.message||'')){
      const repair = confirm(
        `This student's login account was deleted separately from their profile ` +
        `(this can happen if it was removed directly in Firebase, outside the app).\n\n` +
        `Recreate their login now? This restores access while keeping all existing ` +
        `attendance and fee history correctly linked.\n\nContinue?`
      );
      if(repair){
        try {
          const res = await adminRecreateAuthFn({ uid, newPassword: newPass });
          alert(`✅ Login recreated for ${name} (${res.data.email}).\n\nNew password:\n${newPass}\n\nShare it with the student securely — this won't be shown again.`);
        } catch(e2){
          alert('❌ Could not recreate login: ' + (e2.message || 'Unknown error'));
        }
      }
      return;
    }
    alert('❌ Could not reset password: ' + (e.message || 'Unknown error'));
  }
};

let galleryPhoto = null;

window.onGalleryPhoto = async (e) => {
  const f = e.target.files[0]; if(!f) return;
  if(f.size > 5 * 1024 * 1024){ alertMsg('gl-al', 'Photo must be smaller than 5MB.', 'err'); e.target.value=''; return; }
  const c = $('gl-pc');
  c.innerHTML = '⏳';
  try {
    galleryPhoto = await resizeImg(f, 1000, 0.8);
    c.innerHTML = `<img src="${galleryPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:14px">`;
    c.style.borderColor = 'var(--accent)';
    c.style.borderStyle = 'solid';
  } catch(err){
    c.innerHTML = '📷';
    alert('Could not process image.');
  }
};

window.uploadGalleryPhoto = async () => {
  const title = $('gl-title').value.trim();
  const caption = $('gl-caption').value.trim();
  const btn = $('bt-gl');
  if(!galleryPhoto){ alertMsg('gl-al', 'Please choose a photo.'); return; }
  if(!title){ alertMsg('gl-al', 'Please enter a title.'); return; }
  btn.innerHTML = '<span class="spin"></span>Uploading...'; btn.disabled = true;
  try {
    await addDoc(collection(db,'gallery'), {
      title, caption: caption || '',
      photo: galleryPhoto,
      uploadedBy: CU.email,
      createdAt: serverTimestamp()
    });
    alertMsg('gl-al', '\u2705 Photo added to gallery!', 'ok');
    $('gl-title').value = ''; $('gl-caption').value = '';
    galleryPhoto = null;
    $('gl-pc').innerHTML = '📷';
    $('gl-pc').style.borderColor = '';
    $('gl-pc').style.borderStyle = '';
    loadGalleryList();
  } catch(e){
    alertMsg('gl-al', 'Failed: ' + e.message);
  }
  btn.innerHTML = '📤 Upload to Gallery'; btn.disabled = false;
};

function loadGalleryList(){
  const el = $('gl-list');
  if(!el) return;
  el.innerHTML = '<div style="color:var(--adm-muted);font-size:.8rem;padding:.5rem 0">Loading...</div>';
  // Real-time — new photos appear/disappear instantly
  onSnapshot(collection(db,'gallery'), snap => {
    if(snap.empty){
      el.innerHTML = '<div style="color:var(--adm-muted);font-size:.8rem;padding:.5rem 0">No photos yet. Upload one above!</div>';
      return;
    }
    const items = [];
    snap.forEach(d => items.push({...d.data(), id:d.id}));
    items.sort((a,b) => {
      const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.6rem">';
    items.forEach(g => {
      const ps = g.photo || '';
      html += `<div style="background:var(--adm-bg);border:1px solid var(--adm-bd);border-radius:10px;overflow:hidden">
        <img src="${ps}" style="width:100%;height:120px;object-fit:cover;display:block;cursor:zoom-in" onclick="zoomPhotoSrc('${ps}')">
        <div style="padding:.55rem .65rem">
          <div style="color:var(--adm-ink);font-size:.78rem;font-weight:600;margin-bottom:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.title||'Untitled')}</div>
          <div style="color:var(--adm-muted);font-size:.68rem;margin-bottom:.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.caption||'')}</div>
          <button class="b-del" style="width:100%;font-size:.68rem" onclick="deleteGalleryPhoto('${g.id}')">🗑 Remove</button>
        </div>
      </div>`;
    });
    el.innerHTML = html + '</div>';
  }, e => {
    let msg = e.message||String(e);
    if(e.code==='permission-denied') msg='Permission denied — check Firestore rules.';
    el.innerHTML = `<div style="color:var(--danger);font-size:.8rem;padding:.5rem 0">${esc(msg)}</div><button class="b-sec" style="margin-top:.5rem" onclick="loadGalleryList()">🔄 Retry</button>`;
  });
}

// Zoom from a direct image src (used in gallery thumbnails)
window.zoomPhotoSrc = function(src){
  if(!src) return;
  document.getElementById('zoom-img').src = src;
  document.getElementById('zoom-ovl').classList.add('show');
};

window.deleteGalleryPhoto = async (id) => {
  if(!confirm('Remove this photo from the gallery?')) return;
  try {
    await deleteDoc(doc(db,'gallery', id));
    loadGalleryList();
  } catch(e){ alert('Failed: ' + e.message); }
};

window.doLogout = async () => {
  try { sessionStorage.removeItem('zel_cud'); } catch(_){}
  stopDisabledWatcher();
  // Stop all real-time listeners
  if(typeof batchStudentsListener === 'function'){ try{batchStudentsListener();}catch(_){} batchStudentsListener = null; }
  if(typeof studentFeeListener === 'function'){ try{studentFeeListener();}catch(_){} studentFeeListener = null; }
  await signOut(auth);
};

// ══ REGISTER PHOTO ══
window.onRegPhoto = async e => {
  const f = e.target.files[0]; if(!f) return;
  if(f.size > 5 * 1024 * 1024){ alert('Photo must be smaller than 5MB. Please choose a smaller image.'); e.target.value=''; return; }
  const c = $('rg-pc');
  c.innerHTML = '⏳';
  try {
    regPhoto = await resizeImg(f);
    c.innerHTML = `<img src="${regPhoto}" alt="">`;
    c.style.borderColor = 'var(--ocean)';
    c.style.borderStyle = 'solid';
  } catch(err){
    c.innerHTML = '📷';
    alert('Could not process image. Try a different photo.');
  }
};

// ══ EMAIL/PASSWORD REGISTER ══
window.doRegister = async () => {
  const name = $('rg-nm').value.trim();
  const cc = $('rg-cc').value;
  const raw = $('rg-ph').value.trim();
  const email = $('rg-em').value.trim();
  const batch = $('rg-ba').value;
  const dob = $('rg-dob').value;
  const gender = $('rg-gd').value;
  const pass = $('rg-pw').value;
  const btn = $('bt-rg');

  if(!name || !email || !batch || !pass){
    alertMsg('la', 'Please fill in all required fields (Name, Email, Batch, Password).');
    return;
  }
  if(!email.includes('@')){
    alertMsg('la', 'Please enter a valid email address.');
    return;
  }
  if(pass.length < 6){
    alertMsg('la', 'Password must be at least 6 characters.');
    return;
  }

  // Format phone
  let fullPhone = '';
  if(raw){
    let phone = raw.replace(/\D/g, '');
    if(phone.startsWith('0')) phone = phone.substring(1);
    fullPhone = cc + phone;
  }

  btn.innerHTML = '<span class="spin"></span>Creating account...'; btn.disabled = true;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const sid = await nextStudentId();
    // Upload photo to Firebase Storage if provided
    let photoUrl = '';
    if(regPhoto){
      try { photoUrl = await uploadPhotoToStorage(regPhoto, cred.user.uid); }
      catch(_){ photoUrl = ''; }
    }
    await setDoc(doc(db, 'students', cred.user.uid), {
      name: name,
      nameLower: name.toLowerCase(),
      phone: fullPhone,
      email: email,
      course: batch,
      studentId: sid,
      dob: dob || '',
      gender: gender || '',
      photo: photoUrl,
      enrolledAt: serverTimestamp(),
      role: 'student'
    });
    await saveLoginMap(sid, email);
    alertMsg('la', `\u2705 Account created! Your Student ID: ${sid}`, 'ok', true);
    // User is now logged in automatically — onAuthStateChanged will route to dashboard
  } catch(e){
    let m = 'Registration failed: ' + e.message;
    if(e.code === 'auth/email-already-in-use') m = 'This email is already registered. Please sign in instead.';
    if(e.code === 'auth/invalid-email') m = 'Please enter a valid email address.';
    if(e.code === 'auth/weak-password') m = 'Password is too weak. Use at least 6 characters.';
    alertMsg('la', m);
  }
  btn.innerHTML = 'Create Account'; btn.disabled = false;
};

// ══ STUDENT UI ══
function renderStudent(){
  if(!CUD || !CU) return;
  const d = CUD;
  const first = (d.name || 'Student').split(' ')[0];
  const init = (first[0] || 'S').toUpperCase();
  $('d-welcome').textContent = `Welcome, ${first}! 👋`;
  $('d-ba').textContent = d.course || '—';
  $('d-sid').textContent = d.studentId || '—';
  $('d-sid2').textContent = d.studentId || 'ZEL0000';
  $('d-sid3') && ($('d-sid3').textContent = d.studentId || '—');
  $('d-nm-big').textContent = d.name || '—';
  $('d-ba2').textContent = d.course || '—';
  $('d-nm').textContent = d.name || '—';
  $('d-phone').textContent = d.phone || '—';
  $('d-em').textContent = d.email || '—';
  // Date of Birth — format nicely if present
  if(d.dob){
    try {
      const [y,m,day] = d.dob.split('-');
      const dobDate = new Date(y, m-1, day);
      $('d-dob').textContent = dobDate.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
    } catch(_){ $('d-dob').textContent = d.dob; }
  } else { $('d-dob').textContent = '—'; }
  $('d-gender').textContent = d.gender || '—';
  if(d.enrolledAt && d.enrolledAt.toDate){
    $('d-en').textContent = d.enrolledAt.toDate().toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
  } else {
    $('d-en').textContent = 'Today';
  }
  const src = d.photo || '';
  const av = $('d-av'), ph = $('d-ph');
  if(src){
    av.innerHTML = `<img src="${src}" alt="">`;
    ph.innerHTML = `<img src="${src}" alt="">`;
  } else {
    av.textContent = init;
    ph.textContent = init;
  }
}

function loadStudentNotices(){
  const el = $('d-not');
  el.innerHTML = '<div class="empty">📭 Loading...</div>';
  const q = query(collection(db,'notices'), orderBy('createdAt','desc'), limit(50));
  // Real-time listener — updates instantly when admin posts a notice
  onSnapshot(q, snap => {
    if(snap.empty){
      el.innerHTML = '<div class="empty">📭 No announcements yet</div>';
      return;
    }
    const studentBatch = (CUD && CUD.course) ? CUD.course : '';
    const parts = [];
    snap.forEach(d => {
      const n = d.data();
      // Only show if notice targets 'all' OR matches the student's batch
      const target = n.targetBatch || 'all';
      if(target !== 'all' && target !== studentBatch) return;
      const dt = n.createdAt && n.createdAt.toDate ? n.createdAt.toDate().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '';
      const pHtml = n.photo
        ? `<img src="${n.photo}" style="width:100%;max-height:180px;object-fit:cover;border-radius:8px;margin-top:.5rem;cursor:zoom-in" onclick="zoomPhotoSrc('${n.photo}')">`
        : '';
      parts.push(`<div class="notice"><div class="dt">${dt}</div><div class="ti">${esc(n.title)}</div><div class="bd">${esc(n.body)}</div>${pHtml}</div>`);
    });
    if(parts.length === 0){
      el.innerHTML = '<div class="empty">📭 No announcements yet</div>';
    } else {
      el.innerHTML = parts.join('');
    }
  }, e => {
    el.innerHTML = `<div class="empty" style="color:var(--danger)">Error: ${esc(e.message)}</div>`;
  });
}

let attAllRecs = [];
let attCurrentMonth = '';

function loadStudentAtt(){
  if(!CU) return;
  const q = query(collection(db,'attendance'), where('studentUid','==', CU.uid));
  // Real-time — updates instantly when admin marks attendance
  onSnapshot(q, snap => {
    let present=0, absent=0, late=0;
    attAllRecs = [];
    snap.forEach(d => {
      const r = d.data();
      attAllRecs.push(r);
      if(r.status === 'present') present++;
      else if(r.status === 'absent') absent++;
      else if(r.status === 'late') late++;
    });
    const total = present + absent + late;
    const pct = total === 0 ? 0 : Math.round(((present + late*0.5) / total) * 100);
    $('d-att-p').textContent = present;
    $('d-att-a').textContent = absent;
    $('d-att-l').textContent = late;
    $('d-att-pct').textContent = pct + '%';
    $('d-att-bar').style.width = pct + '%';

    const monthSet = new Set();
    attAllRecs.forEach(r => { if(r.date) monthSet.add(r.date.substring(0,7)); });
    const months = [...monthSet].sort().reverse();
    const nowMonth = new Date().toISOString().substring(0,7);
    if(!monthSet.has(nowMonth)) months.unshift(nowMonth);

    const tabsEl = $('d-att-months');
    const prevMonth = attCurrentMonth;
    tabsEl.innerHTML = months.map(m => {
      const [y,mo] = m.split('-');
      const label = new Date(y, mo-1).toLocaleString('en-GB',{month:'short',year:'2-digit'});
      return `<button class="att-mtab ${m===prevMonth?'active':''}" onclick="showAttMonth('${m}',this)">${label}</button>`;
    }).join('');

    const defaultMonth = prevMonth && months.includes(prevMonth) ? prevMonth : months[0];
    attCurrentMonth = defaultMonth;
    renderAttCalendar(defaultMonth);
  }, e=>console.error(e));
}

window.showAttMonth = function(month, btn){
  attCurrentMonth = month;
  // Update tab active state
  document.querySelectorAll('.att-mtab').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderAttCalendar(month);
};

function renderAttCalendar(month){
  const [year, mo] = month.split('-').map(Number);
  const today = new Date().toISOString().split('T')[0];
  const firstDay = new Date(year, mo-1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, mo, 0).getDate();
  // Build lookup
  const byDate = {};
  attAllRecs.forEach(r => { if(r.date && r.date.startsWith(month)) byDate[r.date] = r.status; });
  // Render grid
  let html = '';
  // Empty cells for days before 1st
  for(let i=0; i<firstDay; i++) html += '<div></div>';
  // Day cells
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = month + '-' + String(d).padStart(2,'0');
    const status = byDate[dateStr] || '';
    const isToday = dateStr === today;
    html += `<div class="att-day-cell ${status} ${isToday ? 'today' : ''}" title="${status || 'No record'}">${d}</div>`;
  }
  $('d-att-grid').innerHTML = html;
}

// ── Fee Portal State ──
let feePortalRecs = [];
let feePortalSelected = null;

function loadStudentFees(){
  if(!CU) return;
  const q = query(collection(db,'fees'), where('studentUid','==', CU.uid));
  onSnapshot(q, snap => {
    let total = 0, paid = 0;
    feePortalRecs = [];
    snap.forEach(d => {
      const r = {...d.data(), id: d.id};
      feePortalRecs.push(r);
      // New structure: courseFee + paidTotal
      total += Number(r.courseFee || r.amount || 0);
      paid  += Number(r.paidTotal || (r.status==='Paid'?Number(r.amount||0) : r.status==='Partial'?Number(r.amount||0)/2 : 0));
    });
    feePortalRecs.sort((a,b) => (b.month||'').localeCompare(a.month||''));

    // Update summary
    $('d-ft').textContent = 'Rs ' + total.toLocaleString();
    $('d-fp').textContent = 'Rs ' + paid.toLocaleString();
    $('d-fd').textContent = 'Rs ' + (total-paid).toLocaleString();

    const el = $('d-fl');
    if(!feePortalRecs.length){
      el.innerHTML = '<div class="empty">💳 No fee records yet</div>';
      $('d-select-btn').style.display = 'none';
      return;
    }

    // Upcoming (Unpaid with dueDate)
    const today = new Date().toISOString().split('T')[0];
    const upcoming = feePortalRecs.filter(r => r.status !== 'Paid' && r.dueDate && r.dueDate >= today);
    const upcomingEl = $('d-upcoming');
    if(upcoming.length){
      upcomingEl.style.display = 'block';
      $('d-upcoming-list').innerHTML = upcoming.map(r => `
        <div class="fee-portal-item ${r.status === 'Paid' ? 'paid' : ''}">
          <div class="fee-portal-badge ${r.status}">${r.status}</div>
          <div class="fi-name">${esc(r.month||'—')}</div>
          <div class="fi-amount ${r.dueDate < today ? 'overdue' : ''}">Rs ${Number(r.amount||0).toLocaleString()}</div>
          <div class="fi-due">📅 Due ${esc(r.dueDate||'—')}</div>
        </div>`).join('');
    } else {
      upcomingEl.style.display = 'none';
    }

    // All fees list — new payment tracker structure
    el.innerHTML = feePortalRecs.map(r => {
      const cf = Number(r.courseFee||r.amount||0);
      const pt = Number(r.paidTotal||(r.status==='Paid'?cf:r.status==='Partial'?cf/2:0));
      const rem = cf - pt;
      const pct = cf > 0 ? Math.min(100,Math.round(pt/cf*100)) : 0;
      const settled = rem <= 0 && cf > 0;
      const today = new Date().toISOString().split('T')[0];
      const isOverdue = !settled && r.dueDate && r.dueDate < today;
      const badgeClass = settled ? 'Paid' : pt > 0 ? 'Partial' : 'Unpaid';
      const badgeTxt   = settled ? '✅ Fully Settled' : pt > 0 ? '⚠️ Partial' : '🔴 Unpaid';
      return `<div class="fee-portal-item ${settled?'paid':isOverdue?'overdue':''}">
        <div class="fee-portal-badge ${badgeClass}">${badgeTxt}</div>
        <div class="fi-name">${esc(r.month||'—')}</div>
        <div class="fi-amount ${settled?'paid':isOverdue?'overdue':''}">Rs ${cf.toLocaleString()}</div>
        <div style="height:6px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden;margin:.3rem 0">
          <div style="height:100%;width:${pct}%;background:${settled?'var(--success)':'var(--ocean)'};border-radius:3px;transition:width .4s ease"></div>
        </div>
        <div class="fi-due" style="display:flex;justify-content:space-between;margin-top:.25rem">
          <span>💰 Paid: Rs ${pt.toLocaleString()} (${pct}%)</span>
          <span style="color:${settled?'var(--success)':'var(--danger)'}">Rem: Rs ${rem>0?rem.toLocaleString():'0'}</span>
        </div>
        <div class="fi-due">📅 Due: ${esc(r.dueDate||'N/A')}${isOverdue?' ⚠️ Overdue':''}</div>
      </div>`;
    }).join('');
    $('d-select-btn').style.display = 'block';
    goFeeStep(1);
  }, e => console.error(e));
}

// ── Fee Portal Navigation ──
window.goFeeStep = function(step){
  [1,2,3].forEach(n => {
    $('pstep'+n).classList.toggle('active', n === step);
    const circ = $('ps'+n);
    const lbl = $('ps'+n+'l');
    if(n < step){ circ.classList.add('done'); circ.classList.remove('active'); lbl.classList.remove('active'); }
    else if(n === step){ circ.classList.add('active'); circ.classList.remove('done'); lbl.classList.add('active'); }
    else { circ.classList.remove('done','active'); lbl.classList.remove('active'); }
    // Lines
    if(n < 3){ const line = $('sl'+n); if(line) line.classList.toggle('done', n < step); }
  });
};

window.goFeeStep2 = function(){
  const list = $('d-fee-select-list');
  list.innerHTML = feePortalRecs.map((r,i) => {
    const today = new Date().toISOString().split('T')[0];
    const isOverdue = r.status !== 'Paid' && r.dueDate && r.dueDate < today;
    return `<div class="fee-select-item" onclick="selectFeeEntry(${i})">
      <div>
        <div style="font-weight:600;font-size:.88rem;color:var(--ink)">${esc(r.month||'—')}</div>
        <div style="font-size:.76rem;color:var(--muted);margin-top:.18rem">Rs ${Number(r.amount||0).toLocaleString()} · Due ${esc(r.dueDate||'N/A')}</div>
      </div>
      <span class="pill ${isOverdue ? 'Unpaid' : r.status}" style="flex-shrink:0">${isOverdue ? 'Overdue' : r.status}</span>
    </div>`;
  }).join('');
  goFeeStep(2);
};

window.selectFeeEntry = function(idx){
  const r = feePortalRecs[idx];
  if(!r) return;
  const today = new Date().toISOString().split('T')[0];
  const isOverdue = r.status !== 'Paid' && r.dueDate && r.dueDate < today;
  const statusColor = r.status === 'Paid' ? 'var(--success)' : isOverdue ? 'var(--danger)' : 'var(--ocean)';
  $('d-fee-detail-card').innerHTML = `
    <div class="fee-summary-box">
      <div class="lbl">Fee Entry</div>
      <div class="val">${esc(r.month||'—')}</div>
    </div>
    <div class="card" style="margin-bottom:.6rem">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.85rem">
        <div><div style="font-size:.67rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:.2rem">Amount</div>
         <div style="font-size:1.25rem;font-weight:700;color:var(--ocean-dark);font-family:'Cormorant Garamond',serif">Rs ${Number(r.amount||0).toLocaleString()}</div></div>
        <div><div style="font-size:.67rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:.2rem">Status</div>
         <span class="pill ${r.status}" style="font-size:.78rem">${isOverdue ? '⚠️ Overdue' : r.status === 'Paid' ? '✅ Paid' : r.status === 'Partial' ? '⚠️ Partial' : '🔴 Unpaid'}</span></div>
        <div><div style="font-size:.67rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:.2rem">Due Date</div>
         <div style="font-size:.9rem;font-weight:500;color:${isOverdue ? 'var(--danger)' : 'var(--ink)'}">${esc(r.dueDate||'Not set')}</div></div>
        <div><div style="font-size:.67rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:.2rem">Student ID</div>
         <div style="font-size:.9rem;font-weight:500;color:var(--ink)">${esc(r.studentId||'—')}</div></div>
      </div>
    </div>
    ${r.status !== 'Paid' ? `<div class="fee-info-box">ℹ️ Please contact ZEL admin to complete your payment. Phone: <strong>+94 761 864 245</strong></div>` : `<div class="fee-info-box" style="background:rgba(34,197,94,.1);border-color:rgba(34,197,94,.35);color:#86efac">✅ This fee has been paid. Thank you!</div>`}`;
  goFeeStep(3);
};

// ══ AUTO-LOGOUT WATCHER ══
// Watches the 'disabled' collection — if this user's UID appears there,
// they get logged out immediately. Called when a student logs in.
let disabledWatcher = null;

function startDisabledWatcher(uid){
  // Stop any existing watcher
  stopDisabledWatcher();
  // Poll every 4 seconds
  disabledWatcher = setInterval(async () => {
    if(!CU || !uid) return stopDisabledWatcher();
    try {
      const snap = await getDoc(doc(db,'disabled', uid));
      if(snap.exists()){
        // Account has been disabled by admin
        stopDisabledWatcher();
        // Clean up the disabled flag (best-effort) and force logout
        try { await deleteDoc(doc(db,'disabled', uid)); } catch(_){}
        await signOut(auth);
        alert('Your account has been removed by the administrator. You have been logged out.');
        location.reload();
      }
    } catch(_){}
  }, 4000);
}

function stopDisabledWatcher(){
  if(disabledWatcher){
    clearInterval(disabledWatcher);
    disabledWatcher = null;
  }
}

// ══ DELETE MY ACCOUNT (student self-deletion) ══
window.deleteMyAccount = async () => {
  if(!CU || !CUD){
    alert('You are not logged in.');
    return;
  }
  const confirmText = prompt(
    '⚠️ DELETE YOUR ACCOUNT?\n\n' +
    'This will permanently remove:\n' +
    '• Your profile and photo\n' +
    '• All your attendance records\n' +
    '• All your fee records\n' +
    '• Your login access\n\n' +
    'This CANNOT be undone.\n\n' +
    'Type DELETE (in capitals) to confirm:'
  );
  if(confirmText !== 'DELETE'){
    if(confirmText !== null) alert('Cancelled. You did not type DELETE correctly.');
    return;
  }

  // Re-authentication: ask for password to confirm identity
  const pw = prompt('For security, please enter your password to confirm:');
  if(!pw){ alert('Cancelled.'); return; }

  try {
    // Step 1: Re-auth
    await reauthenticateWithCredential(CU, EmailAuthProvider.credential(CU.email, pw));

    const myUid = CU.uid;
    stopDisabledWatcher();

    // Step 2: Delete my attendance records
    try {
      const attSnap = await getDocs(query(collection(db,'attendance'), where('studentUid','==', myUid)));
      const dels = [];
      attSnap.forEach(d => dels.push(deleteDoc(doc(db,'attendance', d.id))));
      await Promise.all(dels);
    } catch(_){}

    // Step 3: Delete my fee records and adjust totalPaid
    try {
      const feeSnap = await getDocs(query(collection(db,'fees'), where('studentUid','==', myUid)));
      let paidLost = 0;
      const dels = [];
      feeSnap.forEach(d => {
        const f = d.data();
        paidLost += Number(f.paidTotal||0);
        dels.push(deleteDoc(doc(db,'fees', d.id)));
      });
      await Promise.all(dels);
      if(paidLost > 0){
        try { await updateDoc(doc(db,'meta','counters'), { totalPaid: increment(-paidLost) }); } catch(_){}
      }
    } catch(_){}

    // Step 4: Delete student profile
    await deleteDoc(doc(db,'students', myUid));

    // Step 5: Decrement student counter
    try { await updateDoc(doc(db,'meta','counters'), { studentCount: increment(-1) }); } catch(_){}

    // Step 6: Delete the actual auth account (last step)
    await deleteUser(CU);

    alert('\u2705 Your account has been permanently deleted. Goodbye!');
    location.reload();
  } catch(e){
    let m = 'Failed to delete account: ' + e.message;
    if(e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential')
      m = 'Wrong password. Account not deleted.';
    if(e.code === 'auth/requires-recent-login')
      m = 'For security, please sign out and sign in again, then try deleting.';
    alert(m);
  }
};

window.changePW = async () => {
  const cur = $('pw-c').value;
  const neu = $('pw-n').value;
  const con = $('pw-2').value;
  const btn = $('bt-pw');
  if(!cur || !neu || !con){ alertMsg('pw-al', 'Please fill all fields.'); return; }
  if(neu.length < 6){ alertMsg('pw-al', 'New password must be at least 6 characters.'); return; }
  if(neu !== con){ alertMsg('pw-al', 'New passwords do not match.'); return; }
  btn.innerHTML = '<span class="spin"></span>Updating...'; btn.disabled = true;
  try {
    await reauthenticateWithCredential(CU, EmailAuthProvider.credential(CU.email, cur));
    await updatePassword(CU, neu);
    alertMsg('pw-al', '✅ Password updated successfully!', 'ok');
    $('pw-c').value=''; $('pw-n').value=''; $('pw-2').value='';
  } catch(e){
    let m = 'Failed to update password.';
    if(e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') m = 'Current password is incorrect.';
    alertMsg('pw-al', m);
  }
  btn.innerHTML = 'Update Password'; btn.disabled = false;
};

// ══ PHOTO MODAL ══
window.openPhotoModal = uid => {
  photoTarget = uid || (CU ? CU.uid : null);
  pendingPhoto = null;
  $('mp-pc').innerHTML = '📷';
  $('mp-pc').style.borderColor = '';
  $('mp-pc').style.borderStyle = '';
  $('mp-al').className = 'alert';
  $('m-photo').classList.add('open');
};

window.onModalPhoto = async e => {
  const f = e.target.files[0]; if(!f) return;
  if(f.size > 5 * 1024 * 1024){ alertMsg('mp-al', 'Photo must be smaller than 5MB.', 'err', true); e.target.value=''; return; }
  const c = $('mp-pc');
  c.innerHTML = '⏳';
  alertMsg('mp-al', 'Processing image...', 'info', true);
  try {
    pendingPhoto = await resizeImg(f);
    c.innerHTML = `<img src="${pendingPhoto}" alt="">`;
    c.style.borderColor = 'var(--ocean)';
    c.style.borderStyle = 'solid';
    alertMsg('mp-al', '✅ Ready — tap Save Photo', 'ok');
  } catch(err){
    c.innerHTML = '📷';
    alertMsg('mp-al', 'Could not process image. Try a smaller file.', 'err', true);
    pendingPhoto = null;
  }
};

window.savePhoto = async () => {
  const btn = $('bt-mp');
  if(!pendingPhoto){ alertMsg('mp-al', 'Please choose a photo first.'); return; }
  if(!photoTarget){ alertMsg('mp-al', 'No target selected.'); return; }
  btn.innerHTML = '<span class="spin"></span>Saving...'; btn.disabled = true;
  try {
    // Upload to Firebase Storage, get public URL
    const url = await uploadPhotoToStorage(pendingPhoto, photoTarget);
    await updateDoc(doc(db,'students', photoTarget), { photo: url });
    if(CU && photoTarget === CU.uid && CUD){
      CUD.photo = url;
      renderStudent();
    }
    alertMsg('mp-al', '✅ Photo saved!', 'ok');
    setTimeout(() => {
      closeModal('m-photo');
      if(photoTarget && CU && photoTarget !== CU.uid){
        openStudentDetail(photoTarget);
      }
    }, 700);
  } catch(e){
    let m = 'Save failed: ' + e.message;
    if(e.code === 'permission-denied') m = 'Permission denied — check Firebase Storage rules (allow read, write: if request.auth != null).';
    alertMsg('mp-al', m, 'err', true);
  }
  btn.innerHTML = 'Save Photo'; btn.disabled = false;
};

window.closeModal = id => $(id).classList.remove('open');

// ══ ADMIN: BATCHES ══
window.loadBatches = async () => {
  const grid = $('b-grid');
  grid.innerHTML = '<div class="empty" style="color:var(--adm-muted);grid-column:1/-1">Loading...</div>';
  try {
    // Recalculate ALL stats from real data (don't trust the counter)
    const total = await getCountFromServer(collection(db,'students'));
    const realCount = total.data().count;
    $('st-stu').textContent = realCount;
    $('st-ba').textContent = allBatches.length;

    // Total paid is now shown per-batch when a batch is opened
    $('st-fe').textContent = '—';
    $('st-fe-lbl') && ($('st-fe-lbl').textContent = 'Batch Paid');


    grid.innerHTML = '';
    if(allBatches.length === 0){
      grid.innerHTML = '<div class="empty" style="color:var(--adm-muted);grid-column:1/-1">No batches yet. Click "📚 Manage Batches" to add one.</div>';
    } else {
      // Show batch cards immediately with 0 count, then update counts in parallel
      allBatches.forEach(b => {
        grid.innerHTML += `<div class="b-card" onclick='openBatch(${JSON.stringify(b)})' id="bcard-${b.replace(/\s/g,'_')}"><div class="ic">📚</div><div class="nm">${esc(b)}</div><div class="ct"><strong id="bct-${b.replace(/\s/g,'_')}">...</strong> students</div></div>`;
      });
      // Fetch all counts in parallel
      await Promise.all(allBatches.map(async b => {
        try {
          const c = await getCountFromServer(query(collection(db,'students'), where('course','==', b)));
          const n = c.data().count;
          const el = document.getElementById('bct-'+b.replace(/\s/g,'_'));
          if(el) el.textContent = n;
        } catch(e){}
      }));
    }
  } catch(e){
    grid.innerHTML = `<div class="empty" style="color:var(--danger);grid-column:1/-1">Error: ${esc(e.message)}</div>`;
  }
};

window.openBatch = async b => {
  currentBatch = b;
  batchCursor = null;
  batchLoaded = [];
  $('b-list').style.display = 'none';
  $('b-stus').style.display = 'block';
  $('b-det').style.display = 'none';
  $('bs-title').textContent = b;
  $('bs-search').value = '';
  $('bs-list').innerHTML = '<div class="empty" style="color:var(--adm-muted)">Loading...</div>';
  $('bs-total-paid').textContent = 'Rs ...';
  // Load students and batch total paid in parallel
  await Promise.all([loadMoreStus(), loadBatchTotalPaid(b)]);
};

window.showBatchList = () => {
  // Stop real-time listeners when leaving batch view
  if(batchStudentsListener){ batchStudentsListener(); batchStudentsListener = null; }
  if(studentFeeListener){ studentFeeListener(); studentFeeListener = null; }
  $('b-list').style.display = 'block';
  $('b-stus').style.display = 'none';
  $('b-det').style.display = 'none';
};

let batchStudentsListener = null; // unsubscribe fn for batch student list

window.loadMoreStus = async () => {
  if(!currentBatch) return;
  // Unsubscribe any previous batch listener
  if(batchStudentsListener){ batchStudentsListener(); batchStudentsListener = null; }
  batchLoaded = [];
  $('bs-list').innerHTML = '<div class="empty" style="color:var(--adm-muted)">Loading...</div>';
  const q = query(collection(db,'students'), where('course','==', currentBatch), orderBy('name'), limit(100));
  // Real-time — student added/removed shows instantly
  batchStudentsListener = onSnapshot(q, snap => {
    batchLoaded = [];
    snap.forEach(d => batchLoaded.push({...d.data(), id:d.id}));
    $('bs-more').style.display = 'none'; // real-time covers all, no paging needed
    const filter = $('bs-search') ? $('bs-search').value.toLowerCase().trim() : '';
    renderStuRows(filter);
  }, e => {
    $('bs-list').innerHTML = `<div class="empty" style="color:var(--danger)">Error: ${esc(e.message)}</div>`;
  });
};

function renderStuRows(filter=''){
  const el = $('bs-list');
  const list = filter
    ? batchLoaded.filter(s => (s.name||'').toLowerCase().includes(filter) || (s.studentId||'').toLowerCase().includes(filter))
    : batchLoaded;
  if(!list.length){
    el.innerHTML = '<div class="empty" style="color:var(--adm-muted)">No matches.</div>';
    return;
  }
  const rows = list.map(s => {
    const init = (s.name && s.name[0] || 'S').toUpperCase();
    const ph = s.photo ? `<img src="${s.photo}" alt="">` : init;
    return `<div class="s-row" onclick="openStudentDetail('${s.id}')"><div class="s-av">${ph}</div><div style="flex:1;min-width:0"><div class="s-id">${esc(s.studentId||'N/A')}</div><div class="s-name">${esc(s.name||'—')}</div><div class="s-meta">${esc(s.phone||'')}${s.email?' · '+esc(s.email):''}</div></div><div class="arr">›</div></div>`;
  });
  el.innerHTML = rows.join('');
}

let _filterTimer = null;
window.filterStus = () => {
  clearTimeout(_filterTimer);
  _filterTimer = setTimeout(() => renderStuRows($('bs-search').value.toLowerCase().trim()), 120);
};

window.backToStus = () => {
  // Stop real-time fee listener when leaving student detail
  if(studentFeeListener){ studentFeeListener(); studentFeeListener = null; }
  $('b-det').style.display = 'none';
  $('b-stus').style.display = 'block';
};

window.openStudentDetail = async uid => {
  $('b-stus').style.display = 'none';
  $('b-det').style.display = 'block';
  const el = $('b-det-c');
  el.innerHTML = '<div class="empty" style="color:var(--adm-muted)">Loading...</div>';
  $('b-fee-section').style.display = 'none';
  const snap = await getDoc(doc(db,'students',uid));
  if(!snap.exists()){
    el.innerHTML = '<div class="empty" style="color:var(--danger)">Student not found.</div>';
    return;
  }
  const s = snap.data();
  const init = (s.name && s.name[0] || 'S').toUpperCase();
  const ph = s.photo ? `<img src="${s.photo}" alt="">` : init;
  const enr = s.enrolledAt && s.enrolledAt.toDate ? s.enrolledAt.toDate().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—';
  el.innerHTML = `
    <div class="det">
      <div class="d-row">
        <div class="d-photo" onclick="zoomPhoto(this)" style="cursor:zoom-in" title="Click to enlarge">${ph}</div>
        <div>
          <div class="d-name">${esc(s.name||'—')}</div>
          <span class="d-id">${esc(s.studentId||'N/A')}</span>
        </div>
      </div>
      <div class="d-fields">
        <div class="d-field"><label>Batch</label><span>${esc(s.course||'—')}</span></div>
        <div class="d-field"><label>Phone</label><span>${esc(s.phone||'—')}</span></div>
        <div class="d-field full"><label>Email</label><span>${esc(s.email||'—')}</span></div>
        <div class="d-field"><label>Date of Birth</label><span>${(()=>{ if(!s.dob) return '—'; try{ const [y,m,d]=s.dob.split('-'); return new Date(y,m-1,d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }catch(_){ return s.dob; } })()}</span></div>
        <div class="d-field"><label>Gender</label><span>${esc(s.gender||'—')}</span></div>
        <div class="d-field"><label>Enrolled</label><span>${enr}</span></div>
        <div class="d-field"><label>Status</label><span style="color:#86efac;font-weight:600">✅ Active</span></div>
      </div>
    </div>
    <div class="acts">
      <button class="act" onclick="openPhotoModal('${uid}')">📷 Edit Photo</button>
      <button class="act" onclick="quickJumpAtt('${uid}','${esc(s.studentId||'')}','${esc(s.name||'')}')">📋 Attendance</button>
      <button class="act" style="border-color:var(--accent);color:var(--accent)" onclick="openEditStudent('${uid}')">✏️ Edit Info</button>
      <button class="act" style="border-color:var(--warn);color:var(--warn)" onclick="resetStudentPassword('${uid}','${esc(s.name||'')}')">🔑 Reset Password</button>
    </div>
    <div class="nfc-link-status">
      <div class="ls-info">
       <div class="ls-label">📡 NFC Card</div>
       <div class="ls-value" id="nfc-cur-${uid}">${s.nfcId ? esc(s.nfcId) : '<span class="ls-empty">No card linked</span>'}</div>
      </div>
      <button class="b-acc" style="font-size:.74rem;padding:.5rem .8rem" onclick="linkNfcCard('${uid}','${esc(s.name||'')}','${esc(s.studentId||'')}')">${s.nfcId ? '🔄 Re-link Card' : '🔗 Link NFC Card'}</button>
    </div>
    <button class="b-del" style="width:100%;padding:.7rem;margin-top:.4rem" onclick="deleteStudent('${uid}')">🗑 Remove Student</button>`;

  // Show fee section and load this student's fees
  $('b-fee-section').style.display = 'block';
  if($('b-new-fee-form')) $('b-new-fee-form').style.display = 'none';
  loadStudentFeesAdmin(uid, s.name, s.studentId);
};

// Store current student for inline fee ops
let currentFeeUid = null;
let currentFeeSid = null;
let currentFeeName = null;

let studentFeeListener = null;

function loadStudentFeesAdmin(uid, name, sid){
  currentFeeUid = uid; currentFeeSid = sid; currentFeeName = name;
  const listEl = $('b-fee-list');
  listEl.innerHTML = '<div style="color:var(--adm-muted);font-size:.8rem">Loading...</div>';
  if(studentFeeListener){ studentFeeListener(); studentFeeListener = null; }
  // Listen to all fee records for this student in real-time
  studentFeeListener = onSnapshot(
    query(collection(db,'fees'), where('studentUid','==', uid)),
    snap => {
      const recs = [];
      let grandTotal=0, grandPaid=0;
      snap.forEach(d => { recs.push({...d.data(), id:d.id}); });
      recs.sort((a,b)=>(b.createdAt?.toMillis?.()??0)-(a.createdAt?.toMillis?.()??0));
      // Compute grand totals
      recs.forEach(r => {
        grandTotal += Number(r.courseFee||0);
        grandPaid  += Number(r.paidTotal||0);
      });
      $('b-fs-total').textContent = 'Rs ' + grandTotal.toLocaleString();
      $('b-fs-paid').textContent  = 'Rs ' + grandPaid.toLocaleString();
      $('b-fs-due').textContent   = 'Rs ' + (grandTotal-grandPaid).toLocaleString();
      // Show/hide the "Set Course Fee" form
      const newForm = $('b-new-fee-form');
      if(newForm){
        newForm.style.display = recs.length ? 'none' : 'block';
        // Add "Add another fee record" button after the fee list if there are existing records
        let addBtn = $('b-fee-add-btn');
        if(!addBtn){
          addBtn = document.createElement('div');
          addBtn.id = 'b-fee-add-btn';
          listEl.parentNode.insertBefore(addBtn, listEl.nextSibling);
        }
        if(recs.length){
          addBtn.innerHTML = `<button class="b-sec" style="width:100%;margin-top:.4rem;padding:.6rem;font-size:.78rem" onclick="toggleNewFeeForm()">➕ Add Another Fee Record</button>`;
        } else {
          addBtn.innerHTML = '';
        }
      }
      if(!recs.length){ listEl.innerHTML=''; return; }
      // Render each fee tracker card
      listEl.innerHTML = recs.map(r => renderFeeTracker(r)).join('');
    },
    e => { listEl.innerHTML = `<div style="color:var(--danger);font-size:.8rem">${esc(e.message)}</div>`; }
  );
}

function renderFeeTracker(r){
  const cf = Number(r.courseFee||0);
  const pt = Number(r.paidTotal||0);
  const rem = cf - pt;
  const pct = cf > 0 ? Math.min(100, Math.round(pt/cf*100)) : 0;
  const settled = rem <= 0 && cf > 0;
  const payments = r.payments || [];
  const badge = settled
    ? '<span class="ft-settled">✅ FULLY SETTLED</span>'
    : pt > 0
      ? '<span class="ft-partial">⚠️ PARTIAL</span>'
      : '<span class="ft-unsettled">🔴 UNPAID</span>';
  const payRows = payments.map((p,i) => `
    <div class="ft-pay-row">
      <div class="ft-pay-dot"></div>
      <div class="ft-pay-amount">Rs ${Number(p.amount||0).toLocaleString()}</div>
      <div class="ft-pay-note">${esc(p.note||'')}</div>
      <div class="ft-pay-date">${p.date||''}</div>
      <button class="ft-pay-del" onclick="deletePayment('${r.id}',${i})" title="Remove this payment">✕</button>
    </div>`).join('') || '<div style="color:var(--adm-muted);font-size:.76rem;padding:.3rem 0">No payments recorded yet.</div>';
  const todayStr = new Date().toISOString().split('T')[0];
  return `
    <div class="fee-tracker ${settled?'settled':''}">
      <div class="ft-header">
        <div>
          <div class="ft-title">${esc(r.month||'Course Fee')}</div>
          <div style="color:var(--adm-muted);font-size:.72rem;margin-top:.1rem">Course Fee: Rs ${cf.toLocaleString()}${r.dueDate ? ' · Due: '+esc(r.dueDate) : ''}</div>
        </div>
        ${badge}
      </div>
      <div class="ft-progress">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-bottom:.5rem;text-align:center">
          <div><div style="font-size:.6rem;color:var(--adm-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.15rem">Course Fee</div><div style="color:var(--adm-ink);font-family:'Cormorant Garamond',serif;font-size:1.1rem">Rs ${cf.toLocaleString()}</div></div>
          <div><div style="font-size:.6rem;color:var(--adm-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.15rem">Paid</div><div style="color:#16a34a;font-family:'Cormorant Garamond',serif;font-size:1.1rem">Rs ${pt.toLocaleString()}</div></div>
          <div><div style="font-size:.6rem;color:var(--adm-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.15rem">Remaining</div><div style="color:${settled?'#16a34a':'#dc2626'};font-family:'Cormorant Garamond',serif;font-size:1.1rem">Rs ${rem>0?rem.toLocaleString():'0'}</div></div>
        </div>
        <div class="ft-prog-bar"><div class="ft-prog-fill" style="width:${pct}%${settled?';background:linear-gradient(90deg,#16a34a,#16a34a)':''}"></div></div>
        <div class="ft-prog-nums">
          <span class="ft-prog-paid">Paid: ${pct}%</span>
          <span class="ft-prog-rem">${settled ? '✅ Settled' : 'Remaining: Rs '+rem.toLocaleString()}</span>
        </div>
      </div>
      <div class="ft-payments">
        <div class="ft-pay-title">Payment History (${payments.length} payment${payments.length!==1?'s':''})</div>
        ${payRows}
      </div>
      ${settled?`
      <div style="padding:.65rem 1rem;background:#0a1f0a;border-top:1px solid #166534;text-align:center">
        <span style="color:#86efac;font-size:.82rem;font-weight:600">🎉 Course fee fully settled — no balance remaining!</span>
      </div>`:` 
      <div class="ft-add">
        <div style="color:var(--adm-muted);font-size:.7rem;margin-bottom:.5rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em">➕ Add Payment</div>
        <div class="ft-add-row">
          <input type="number" class="di" id="fp-amt-${r.id}" placeholder="Amount (Rs) *" min="1" max="${rem}">
          <input type="date" class="di" id="fp-dt-${r.id}" value="${todayStr}">
          <input type="text" class="di" id="fp-note-${r.id}" placeholder="Note (optional, e.g. Cash)">
          <button class="ft-add-btn" onclick="addPayment('${r.id}',${cf},${pt})">＋ Pay</button>
        </div>
        <div style="font-size:.68rem;color:var(--adm-muted);margin-top:.3rem">Remaining balance: Rs ${rem.toLocaleString()}</div>
      </div>`}
      <div style="padding:.4rem .8rem .6rem;display:flex;justify-content:flex-end">
        <button class="ft-del-fee" onclick="delFeeRecord('${r.id}',${pt})">🗑 Delete Record</button>
      </div>
    </div>`;
}

// Create a brand-new fee record (set course fee)
window.createFeeRecord = async () => {
  if(!currentFeeUid){ alertMsg('b-fe-al','No student selected.'); return; }
  const month  = $('b-fe-mo').value.trim();
  const total  = Number($('b-fe-total').value);
  const due    = $('b-fe-du').value;
  const first  = Number($('b-fe-first').value||0);
  if(!month || !total){ alertMsg('b-fe-al','Please fill Description and Total Course Fee.'); return; }
  const payments = first>0 ? [{ amount:first, date:new Date().toISOString().split('T')[0], note:'Initial payment' }] : [];
  const paidTotal = payments.reduce((s,p)=>s+Number(p.amount),0);
  try {
    await addDoc(collection(db,'fees'), {
      studentUid: currentFeeUid, studentName: currentFeeName, studentId: currentFeeSid,
      month, courseFee: total, dueDate: due,
      payments, paidTotal, remaining: total-paidTotal,
      settled: paidTotal >= total,
      createdAt: serverTimestamp()
    });
    $('b-fe-mo').value=''; $('b-fe-total').value=''; $('b-fe-du').value=''; $('b-fe-first').value='';
    $('b-fe-al').className='alert';
    loadBatchTotalPaid(currentBatch);
  } catch(e){ alertMsg('b-fe-al','Failed: '+e.message); }
};

// Add a payment to an existing fee record
window.addPayment = async (feeId, courseFee, currentPaid) => {
  const amtEl = $('fp-amt-'+feeId), dtEl = $('fp-dt-'+feeId), noteEl = $('fp-note-'+feeId);
  const amount = Number(amtEl?.value||0);
  const date   = dtEl?.value || new Date().toISOString().split('T')[0];
  const note   = noteEl?.value.trim()||'';
  if(!amount || amount<=0){ alert('Please enter a valid payment amount.'); return; }
  const feeRef = doc(db,'fees',feeId);
  const snap = await getDoc(feeRef);
  if(!snap.exists()) return;
  const existing = snap.data().payments || [];
  const newPayments = [...existing, { amount, date, note }];
  const newPaid = newPayments.reduce((s,p)=>s+Number(p.amount),0);
  const newRem = courseFee - newPaid;
  await updateDoc(feeRef, {
    payments: newPayments,
    paidTotal: newPaid,
    remaining: newRem,
    settled: newRem <= 0
  });
  // Update counter
  try { await updateDoc(doc(db,'meta','counters'),{totalPaid:increment(amount)}); } catch(_){}
  if(amtEl) amtEl.value=''; if(noteEl) noteEl.value='';
  loadBatchTotalPaid(currentBatch);
};

// Delete a single payment from history
window.deletePayment = async (feeId, payIndex) => {
  if(!confirm('Remove this payment?')) return;
  const feeRef = doc(db,'fees',feeId);
  const snap = await getDoc(feeRef);
  if(!snap.exists()) return;
  const d = snap.data();
  const payments = [...(d.payments||[])];
  const removed = payments.splice(payIndex,1)[0];
  const newPaid = payments.reduce((s,p)=>s+Number(p.amount),0);
  const newRem = Number(d.courseFee||0) - newPaid;
  await updateDoc(feeRef, {
    payments, paidTotal:newPaid, remaining:newRem, settled:newRem<=0
  });
  try { await updateDoc(doc(db,'meta','counters'),{totalPaid:increment(-Number(removed?.amount||0))}); } catch(_){}
  loadBatchTotalPaid(currentBatch);
};

// Delete the whole fee record
window.delFeeRecord = async (feeId, paidTotal) => {
  if(!confirm('Delete this entire fee record and all payment history?')) return;
  await deleteDoc(doc(db,'fees',feeId));
  try { await updateDoc(doc(db,'meta','counters'),{totalPaid:increment(-Number(paidTotal||0))}); } catch(_){}
  loadBatchTotalPaid(currentBatch);
};

// Keep old compat functions
window.addFeeInline = window.createFeeRecord;
window.updateFeeStatusInline = async()=>{};
window.setFeeStatus = async()=>{};
window.delFeeInline = window.delFeeRecord;

window.toggleNewFeeForm = () => {
  const f = $('b-new-fee-form');
  if(!f) return;
  const shown = f.style.display === 'block';
  f.style.display = shown ? 'none' : 'block';
  if(!shown){ f.scrollIntoView({behavior:'smooth',block:'nearest'}); }
};

// Load total paid for current batch and show in stat box
async function loadBatchTotalPaid(batch){
  if(!batch) return;
  try {
    // Get all students in batch
    const stuSnap = await getDocs(query(collection(db,'students'), where('course','==',batch)));
    const uids = [];
    stuSnap.forEach(d => uids.push(d.id));
    if(!uids.length){ updateBatchPaidStat(batch, 0); return; }
    // Get all fees for those students
    let total = 0;
    // Firestore 'in' query supports up to 30 items
    const chunks = [];
    for(let i=0;i<uids.length;i+=10) chunks.push(uids.slice(i,i+10));
    for(const chunk of chunks){
      const fsnap = await getDocs(query(collection(db,'fees'), where('studentUid','in',chunk)));
      fsnap.forEach(d => {
        const f = d.data();
        // Use paidTotal (new structure) or fall back to old status-based estimate
        if(typeof f.paidTotal === 'number') total += f.paidTotal;
        else if(f.status==='Paid') total += Number(f.amount||0);
        else if(f.status==='Partial') total += Number(f.amount||0)/2;
      });
    }
    updateBatchPaidStat(batch, total);
  } catch(_){}
}

function updateBatchPaidStat(batch, total){
  const el = $('st-fe');
  const lbl = $('st-fe-lbl');
  if(el) el.textContent = 'Rs ' + total.toLocaleString();
  if(lbl) lbl.textContent = batch ? batch.replace('Batch','B.') + ' Paid' : 'Batch Paid';
  // Also update the bs-total-paid in student list view
  const bs = $('bs-total-paid');
  if(bs) bs.textContent = 'Rs ' + total.toLocaleString();
}

// jump to attendance tab for a specific student
window.quickJumpAtt = (uid, sid, name) => {
  document.querySelectorAll('.adm-tabs button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.adm-tabs button')[1].classList.add('active');
  $('as-att').classList.add('active');
  selectPicker('at', uid, sid, name);
};

// quickJump kept for compatibility but fees now inline
window.quickJump = (kind, uid, sid, name) => {
  if(kind === 'at'){
    document.querySelectorAll('.adm-tabs button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.adm-tabs button')[1].classList.add('active');
    $('as-att').classList.add('active');
    selectPicker('at', uid, sid, name);
  }
  // fees are now inline in student detail — no redirect needed
};

window.deleteStudent = async uid => {
  if(!confirm('Permanently delete this student?\n\n• Profile and photo deleted\n• All attendance records deleted\n• All fee records deleted\n• Cannot log in again\n\nThis cannot be undone.')) return;

  // Stop real-time listeners FIRST before any async work to prevent listener errors
  if(typeof studentFeeListener === 'function'){ studentFeeListener(); studentFeeListener = null; }
  if(typeof batchStudentsListener === 'function'){ batchStudentsListener(); batchStudentsListener = null; }

  // Navigate away immediately so UI doesn't flicker or show stale data
  showBatchList();

  try {
    // Step 1: Mark as disabled so any logged-in student session gets blocked
    try {
      await setDoc(doc(db,'disabled', uid), {
        disabledAt: serverTimestamp(),
        disabledBy: CU.email
      });
    } catch(_){}

    // Step 2: Short delay so any active student session sees the disabled flag
    await new Promise(r => setTimeout(r, 500));

    // Step 3: Delete all attendance records for this student
    try {
      const attSnap = await getDocs(query(collection(db,'attendance'), where('studentUid','==', uid)));
      if(!attSnap.empty){
        await Promise.all(attSnap.docs.map(d => deleteDoc(doc(db,'attendance', d.id))));
      }
    } catch(_){}

    // Step 4: Delete all fee records and update counters
    try {
      const feeSnap = await getDocs(query(collection(db,'fees'), where('studentUid','==', uid)));
      if(!feeSnap.empty){
        let paidLost = 0;
        feeSnap.forEach(d => {
          const f = d.data();
          paidLost += Number(f.paidTotal||0);
        });
        await Promise.all(feeSnap.docs.map(d => deleteDoc(doc(db,'fees', d.id))));
        if(paidLost > 0){
          try { await updateDoc(doc(db,'meta','counters'), { totalPaid: increment(-paidLost) }); } catch(_){}
        }
      }
    } catch(_){}

    // Step 5: Delete the student profile document
    await deleteDoc(doc(db,'students', uid));

    // Step 6: Decrement student counter
    try { await updateDoc(doc(db,'meta','counters'), { studentCount: increment(-1) }); } catch(_){}

    // Step 7: Clean up the disabled flag after a delay
    setTimeout(async () => {
      try { await deleteDoc(doc(db,'disabled', uid)); } catch(_){}
    }, 10000);

    // Step 8: Refresh the batch and fees lists
    try { await loadBatches(); } catch(_){}
    try { loadFees(true); } catch(_){}

    alert('✅ Student permanently deleted.\nAll records removed successfully.');
  } catch(e){
    alert('Failed to delete student: ' + e.message + '\n\nThe student may have been partially removed. Please refresh and check.');
  }
};

// ══ EDIT STUDENT ══
window.openEditStudent = async uid => {
  // Populate batch dropdown
  const baSel = $('es-ba');
  baSel.innerHTML = allBatches.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');

  // Also load from Firestore batches
  try {
    const snap = await getDocs(query(collection(db,'batches'), orderBy('name','asc')));
    if(!snap.empty){
      const names = [];
      snap.forEach(d => names.push(d.data().name));
      baSel.innerHTML = names.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
    }
  } catch(_){}

  // Load student data
  const snap = await getDoc(doc(db,'students',uid));
  if(!snap.exists()){ alert('Student not found.'); return; }
  const s = snap.data();

  $('es-uid').value = uid;
  $('es-nm').value = s.name || '';
  $('es-ph').value = s.phone || '';
  $('es-em').value = s.email || '';
  $('es-dob').value = s.dob || '';
  $('es-gd').value = s.gender || '';
  $('es-st').value = s.status || 'active';
  // Set batch
  baSel.value = s.course || '';
  if(!baSel.value && s.course){
    const opt = document.createElement('option');
    opt.value = s.course; opt.textContent = s.course;
    baSel.prepend(opt);
    baSel.value = s.course;
  }

  $('es-al').className = 'alert';
  $('m-edit-stu').classList.add('open');
};

window.saveStudentEdit = async () => {
  const uid  = $('es-uid').value;
  const name = $('es-nm').value.trim();
  const phone= $('es-ph').value.trim();
  const email= $('es-em').value.trim().toLowerCase();
  const batch= $('es-ba').value;
  const dob  = $('es-dob').value;
  const gnd  = $('es-gd').value;
  const stat = $('es-st').value;
  const btn  = $('bt-es');

  if(!name){ alertMsg('es-al','Name is required.'); return; }
  if(!batch){ alertMsg('es-al','Please select a batch.'); return; }

  btn.textContent = 'Saving...'; btn.disabled = true;

  try {
    const updates = { name, phone, email, course: batch, dob, gender: gnd, status: stat };
    await updateDoc(doc(db,'students', uid), updates);
    alertMsg('es-al','✅ Student details updated!','ok');
    // Refresh the detail card
    await openStudentDetail(uid);
    setTimeout(() => closeModal('m-edit-stu'), 900);
  } catch(e){
    alertMsg('es-al','Failed: ' + e.message);
  }
  btn.textContent = '💾 Save Changes'; btn.disabled = false;
};

// ══ MANAGE BATCHES ══
window.toggleBatchMgr = () => {
  const el = $('b-mgr');
  if(el.style.display === 'none'){
    el.style.display = 'block';
    loadBatchesMgr();
  } else {
    el.style.display = 'none';
  }
};

async function loadBatchesMgr(){
  const el = $('bm-list');
  if(!el) return;
  try {
    const snap = await getDocs(query(collection(db,'batches'), orderBy('name','asc')));
    if(snap.empty){
      el.innerHTML = `<div style="color:var(--adm-muted);font-size:.78rem;padding:.4rem 0">No batches yet. Add one above to get started.</div>`;
      return;
    }
    el.innerHTML = '';
    snap.forEach(d => {
      const b = d.data().name;
      el.innerHTML += `<div class="bm-row"><span>${esc(b)}</span><button class="b-del" onclick="deleteBatch('${d.id}','${esc(b).replace(/'/g,"\\\\'")}')">🗑 Remove</button></div>`;
    });
  } catch(e){
    el.innerHTML = `<div style="color:var(--danger);font-size:.78rem">${esc(e.message)}</div>`;
  }
}

window.addBatch = async () => {
  const inp = $('bm-name');
  const name = inp ? inp.value.trim() : '';
  if(!name){ alertMsg('bm-al', 'Please enter a batch name.'); return; }
  try {
    // Check duplicate
    const existing = await getDocs(query(collection(db,'batches'), where('name','==', name)));
    if(!existing.empty){
      alertMsg('bm-al', 'This batch already exists.', 'err');
      return;
    }
    if(allBatches.includes(name)){
      alertMsg('bm-al', 'This batch already exists.', 'err');
      return;
    }
    await addDoc(collection(db,'batches'), { name, createdAt: serverTimestamp() });
    alertMsg('bm-al', `✅ Batch "${name}" added!`, 'ok');
    inp.value = '';
    await loadBatchesMgr();
    await loadBatchOptions();
    await loadBatches();
  } catch(e){
    alertMsg('bm-al', 'Failed: ' + e.message);
  }
};

window.deleteBatch = async (id, name) => {
  // Check how many students are in this batch first
  let stuCount = 0;
  try {
    const cnt = await getCountFromServer(query(collection(db,'students'), where('course','==', name)));
    stuCount = cnt.data().count;
  } catch(_){}

  const msg = stuCount > 0
    ? `Delete batch "${name}"?\n\n⚠️ This will PERMANENTLY DELETE:\n• ${stuCount} student account${stuCount>1?'s':''} in this batch\n• All their attendance records\n• All their fee records\n• Their login access\n\nThis CANNOT be undone. Type DELETE to confirm:`
    : `Delete batch "${name}"?\n\nNo students in this batch.\n\nType DELETE to confirm:`;

  const confirm1 = prompt(msg);
  if(confirm1 !== 'DELETE'){
    if(confirm1 !== null) alert('Cancelled. You did not type DELETE correctly.');
    return;
  }

  alertMsg('bm-al', '⏳ Deleting batch and all students...', 'info', true);

  try {
    // Get all students in this batch
    const stuSnap = await getDocs(query(collection(db,'students'), where('course','==', name)));
    const stuIds = [];
    stuSnap.forEach(d => stuIds.push(d.id));

    // For each student: mark disabled + delete attendance + fees + profile
    for(const uid of stuIds){
      // Mark disabled so they get logged out
      try { await setDoc(doc(db,'disabled',uid),{disabledAt:serverTimestamp(),disabledBy:CU.email}); } catch(_){}
      // Delete attendance
      try {
        const aSnap = await getDocs(query(collection(db,'attendance'), where('studentUid','==',uid)));
        await Promise.all(aSnap.docs.map(d=>deleteDoc(doc(db,'attendance',d.id))));
      } catch(_){}
      // Delete fees
      try {
        const fSnap = await getDocs(query(collection(db,'fees'), where('studentUid','==',uid)));
        await Promise.all(fSnap.docs.map(d=>deleteDoc(doc(db,'fees',d.id))));
      } catch(_){}
      // Delete student profile
      try { await deleteDoc(doc(db,'students',uid)); } catch(_){}
    }

    // Update student counter
    if(stuIds.length > 0){
      try { await updateDoc(doc(db,'meta','counters'),{studentCount:increment(-stuIds.length)}); } catch(_){}
    }

    // Wait a moment so disabled flags reach logged-in students
    if(stuIds.length > 0) await new Promise(r=>setTimeout(r,600));

    // Clean up disabled flags
    for(const uid of stuIds){
      setTimeout(async()=>{ try{ await deleteDoc(doc(db,'disabled',uid)); }catch(_){} }, 8000);
    }

    // Delete the batch document
    await deleteDoc(doc(db,'batches', id));

    alertMsg('bm-al', `✅ Batch "${name}" deleted with ${stuIds.length} student${stuIds.length!==1?'s':''}.`, 'ok');
    await loadBatchesMgr();
    await loadBatchOptions();
    await loadBatches();
  } catch(e){
    alertMsg('bm-al', 'Failed: ' + e.message);
  }
};

// ══ PICKER (att/fee student picker) ══
window.searchPicker = async (kind, term) => {
  const res = $(`${kind}-pr`);
  res.classList.add('open');
  term = term.trim();
  if(!term){
    res.innerHTML = '<div class="pkr-em">Type to search by name or ID...</div>';
    return;
  }
  clearTimeout(pickerTimers[kind]);
  pickerTimers[kind] = setTimeout(async () => {
    res.innerHTML = '<div class="pkr-em">Searching...</div>';
    try {
      const up = term.toUpperCase(), lo = term.toLowerCase();
      const map = new Map();
      try {
        const q1 = query(collection(db,'students'), where('studentId','>=', up), where('studentId','<=', up+'\uf8ff'), limit(8));
        (await getDocs(q1)).forEach(d => map.set(d.id, {...d.data(), id:d.id}));
      } catch(_){}
      try {
        const q2 = query(collection(db,'students'), where('nameLower','>=', lo), where('nameLower','<=', lo+'\uf8ff'), limit(8));
        (await getDocs(q2)).forEach(d => map.set(d.id, {...d.data(), id:d.id}));
      } catch(_){}
      const arr = [...map.values()].slice(0,12);
      if(!arr.length){
        res.innerHTML = '<div class="pkr-em">No students found.</div>';
        return;
      }
      res.innerHTML = '';
      arr.forEach(s => {
        const div = document.createElement('div');
        div.className = 'pkr-it';
        div.innerHTML = `<div class="pid">${esc(s.studentId||'')}</div><div class="pnm">${esc(s.name||'')}</div><div class="pba">${esc(s.course||'')}</div>`;
        div.onclick = () => selectPicker(kind, s.id, s.studentId, s.name);
        res.appendChild(div);
      });
    } catch(e){
      res.innerHTML = `<div class="pkr-em">Error: ${esc(e.message)}</div>`;
    }
  }, 250);
};

function selectPicker(kind, uid, sid, name){
  pickers[kind] = { uid, sid, name };
  $(`${kind}-pi`).parentElement.style.display = 'none';
  const chip = $(`${kind}-ch`);
  chip.style.display = 'block';
  chip.innerHTML = `<div class="chip"><span><strong>${esc(sid||'')}</strong>${esc(name||'')}</span><button onclick="clearPicker('${kind}')">✕</button></div>`;
  $(`${kind}-pr`).classList.remove('open');

}
window.selectPicker = selectPicker;

window.clearPicker = kind => {
  pickers[kind] = null;
  const piWrap = $(`${kind}-pi`);
  if(piWrap) piWrap.parentElement.style.display = 'block';
  const ch = $(`${kind}-ch`);
  if(ch) ch.style.display = 'none';
  const pi = $(`${kind}-pi`);
  if(pi) pi.value = '';

};

document.addEventListener('click', e => {
  ['at','fe'].forEach(k => {
    const w = $(`${k}-pi`) ? $(`${k}-pi`).parentElement : null;
    if(w && !w.contains(e.target)) $(`${k}-pr`)?.classList.remove('open');
  });
});

// ══ ATTENDANCE ══
// ── Quick status selector ──
window.selectAttStatus = async function(status){
  const el = $('at-st');
  el.value = status;
  ['present','absent','late'].forEach(s => {
    const btn = $('qm-'+s);
    if(btn) btn.classList.toggle('sel', s === status);
  });
  // Auto-save immediately
  await markAtt();
};

window.markAtt = async () => {
  const sel = pickers.at;
  const date = $('at-dt').value;
  const status = $('at-st').value;
  if(!sel){ alertMsg('at-al', 'Please select a student first.'); return; }
  if(!date){ alertMsg('at-al', 'Please pick a date first.'); return; }
  if(!status){ return; } // called before status selected — do nothing
  // Disable buttons during save
  ['present','absent','late'].forEach(s => { const b=$('qm-'+s); if(b) b.disabled=true; });
  try {
    await addDoc(collection(db,'attendance'), {
      studentUid: sel.uid, studentName: sel.name, studentId: sel.sid,
      date, status, createdAt: serverTimestamp()
    });
    alertMsg('at-al', '✅ Attendance saved!', 'ok');
    $('at-st').value = '';
    ['present','absent','late'].forEach(s => { const b = $('qm-'+s); if(b){ b.classList.remove('sel'); b.disabled=false; } });
    loadAttRecs(true);
  } catch(e){
    alertMsg('at-al', 'Save failed: ' + e.message);
    ['present','absent','late'].forEach(s => { const b=$('qm-'+s); if(b) b.disabled=false; });
  }
};

window.loadAttRecs = async (reset=true) => {
  const month = $('at-mo').value;
  if(!month){
    $('at-rec').innerHTML = '<div class="empty" style="color:var(--adm-muted)">Pick a month to view records</div>';
    $('at-more').style.display = 'none';
    return;
  }
  if(reset){
    attCursor = null;
    attRecs = [];
    $('at-rec').innerHTML = '<div class="empty" style="color:var(--adm-muted)">Loading...</div>';
  }
  try {
    let q;
    if(attCursor){
      q = query(collection(db,'attendance'), where('date','>=', month+'-01'), where('date','<=', month+'-31'), orderBy('date','desc'), startAfter(attCursor), limit(PAGE));
    } else {
      q = query(collection(db,'attendance'), where('date','>=', month+'-01'), where('date','<=', month+'-31'), orderBy('date','desc'), limit(PAGE));
    }
    const snap = await getDocs(q);
    if(snap.empty && !attRecs.length){
      $('at-rec').innerHTML = '<div class="empty" style="color:var(--adm-muted)">No records found.</div>';
      $('at-more').style.display = 'none';
      return;
    }
    snap.forEach(d => attRecs.push({...d.data(), id:d.id}));
    if(snap.docs.length) attCursor = snap.docs[snap.docs.length-1];
    $('at-more').style.display = snap.size === PAGE ? 'block' : 'none';
    const colors = { present:'#16a34a', absent:'#dc2626', late:'#d97706' };
    const attParts = attRecs.map(r =>
      `<div class="fee-row" style="background:var(--adm-bg);border-color:var(--adm-bd)"><div><div class="mon" style="color:var(--adm-ink)">${esc(r.studentId||'')} — ${esc(r.studentName||'')}</div><div class="sub">${esc(r.date)}</div></div><div style="display:flex;align-items:center;gap:.5rem"><span style="background:${colors[r.status]||'#888'};color:var(--adm-ink);padding:.2rem .65rem;border-radius:50px;font-size:.7rem;font-weight:700;text-transform:capitalize">${r.status}</span><button class="b-del" onclick="delAtt('${r.id}')">🗑</button></div></div>`
    );
    $('at-rec').innerHTML = attParts.join('');
  } catch(e){
    $('at-rec').innerHTML = `<div class="empty" style="color:var(--danger)">Error: ${esc(e.message)}</div>`;
  }
};

window.delAtt = async id => {
  if(!confirm('Delete this attendance record?')) return;
  await deleteDoc(doc(db,'attendance', id));
  loadAttRecs(true);
};

// ══ FEES ══
function feeContrib(status, amount){
  if(status === 'Paid') return Number(amount||0);
  if(status === 'Partial') return Number(amount||0)/2;
  return 0;
}

window.addFee = async () => {
  const sel = pickers.fe;
  const month = $('fe-mo').value.trim();
  const amount = $('fe-am').value;
  const due = $('fe-du').value;
  const status = $('fe-st').value;
  if(!sel){ alertMsg('fe-al', 'Please select a student.'); return; }
  if(!month || !amount){ alertMsg('fe-al', 'Please fill required fields (Month, Amount).'); return; }
  try {
    await addDoc(collection(db,'fees'), {
      studentUid: sel.uid, studentName: sel.name, studentId: sel.sid,
      month, amount: Number(amount), dueDate: due, status,
      createdAt: serverTimestamp()
    });
    const delta = feeContrib(status, amount);
    if(delta > 0){
      try {
        const r = doc(db,'meta','counters');
        const s = await getDoc(r);
        if(s.exists()) await updateDoc(r, { totalPaid: increment(delta) });
        else await setDoc(r, { totalPaid: delta }, { merge:true });
      } catch(_){}
    }
    alertMsg('fe-al', '✅ Fee entry added!', 'ok');
    $('fe-mo').value=''; $('fe-am').value=''; $('fe-du').value='';
    loadFees(true);
  } catch(e){
    alertMsg('fe-al', 'Save failed: ' + e.message);
  }
};

window.loadFees = async (reset=true) => {
  if(reset){
    feeCursor = null;
    feeRecs = [];
    $('fe-rec').innerHTML = '<div class="empty" style="color:var(--adm-muted)">Loading...</div>';
  }
  try {
    let q;
    if(feeCursor){
      q = query(collection(db,'fees'), orderBy('createdAt','desc'), startAfter(feeCursor), limit(PAGE));
    } else {
      q = query(collection(db,'fees'), orderBy('createdAt','desc'), limit(PAGE));
    }
    const snap = await getDocs(q);
    if(snap.empty && !feeRecs.length){
      $('fe-rec').innerHTML = '<div class="empty" style="color:var(--adm-muted)">No fee records yet.</div>';
      $('fe-more').style.display = 'none';
    }
    snap.forEach(d => feeRecs.push({...d.data(), id:d.id}));
    if(snap.docs.length) feeCursor = snap.docs[snap.docs.length-1];
    $('fe-more').style.display = snap.size === PAGE ? 'block' : 'none';
    try {
      const ms = await getDoc(doc(db,'meta','counters'));
      $('st-fe').textContent = 'Rs ' + (ms.exists() ? (ms.data().totalPaid||0) : 0);
    } catch(_){}
    const feeParts = feeRecs.map(r =>
      `<div class="fee-row" style="background:var(--adm-bg);border-color:var(--adm-bd)"><div><div class="mon" style="color:var(--adm-ink)">${esc(r.studentId||'')} — ${esc(r.studentName||'')}</div><div class="sub">${esc(r.month)} · Rs ${r.amount} · Due ${esc(r.dueDate||'—')}</div></div><div style="display:flex;align-items:center;gap:.5rem"><select class="ds" style="width:auto;margin-bottom:0;padding:.32rem .58rem;font-size:.74rem" onchange="updateFeeStatus('${r.id}',this.value,${r.amount},'${r.status}')"><option ${r.status==='Unpaid'?'selected':''}>Unpaid</option><option ${r.status==='Partial'?'selected':''}>Partial</option><option ${r.status==='Paid'?'selected':''}>Paid</option></select><button class="b-del" onclick="delFee('${r.id}',${r.amount},'${r.status}')">🗑</button></div></div>`
    );
    $('fe-rec').innerHTML = feeParts.join('');
  } catch(e){
    $('fe-rec').innerHTML = `<div class="empty" style="color:var(--danger)">Error: ${esc(e.message)}</div>`;
  }
};

window.updateFeeStatus = async (id, ns, amount, os) => {
  await updateDoc(doc(db,'fees', id), { status: ns });
  try {
    const d = feeContrib(ns, amount) - feeContrib(os, amount);
    if(d !== 0) await updateDoc(doc(db,'meta','counters'), { totalPaid: increment(d) });
  } catch(_){}
  loadFees(true);
};

window.delFee = async (id, amount, status) => {
  if(!confirm('Delete this fee record?')) return;
  await deleteDoc(doc(db,'fees', id));
  try {
    const d = -feeContrib(status, amount);
    if(d !== 0) await updateDoc(doc(db,'meta','counters'), { totalPaid: increment(d) });
  } catch(_){}
  loadFees(true);
};

// ══ NOTICES ══
// ── Notice / Announcement photo attachment ──
let noticeImgData = null;

window.onNoticeImg = async (e) => {
  const f = e.target.files[0]; if(!f) return;
  if(f.size > 5 * 1024 * 1024){ alert('Photo must be under 5MB.'); e.target.value=''; return; }
  const prev = $('no-img-prev');
  prev.innerHTML = '⏳';
  try {
    noticeImgData = await resizeImg(f, 1000, 0.8);
    prev.innerHTML = `<img src="${noticeImgData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
    prev.style.borderColor = 'var(--accent)';
    $('no-img-lbl').textContent = 'Photo attached ✅';
    $('bt-no-img-clear').style.display = 'block';
  } catch(err){
    prev.innerHTML = '📷'; noticeImgData = null;
    alert('Could not process image.');
  }
};

window.clearNoticeImg = () => {
  noticeImgData = null;
  $('no-img-prev').innerHTML = '📷';
  $('no-img-prev').style.borderColor = '';
  $('no-img-file').value = '';
  $('no-img-lbl').textContent = 'No photo selected';
  $('bt-no-img-clear').style.display = 'none';
};

// ── Populate batch dropdown for notices ──
window.loadNoticeBatchOptions = async function(){
  const sel = $('no-batch');
  if(!sel) return;
  try {
    const snap = await getDocs(collection(db,'batches'));
    // Keep the first "All Batches" option, then repopulate batch options
    sel.innerHTML = '<option value="all">📢 All Batches</option>';
    snap.forEach(d => {
      const name = d.data().name || d.id;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = '📚 ' + name;
      sel.appendChild(opt);
    });
  } catch(_){}
};

window.postNotice = async () => {
  const title = $('no-ti').value.trim();
  const body  = $('no-bo').value.trim();
  const targetBatch = $('no-batch') ? $('no-batch').value : 'all';
  if(!title || !body){ alert('Please fill in title and message.'); return; }
  try {
    await addDoc(collection(db,'notices'), {
      title, body,
      photo: noticeImgData || '',
      targetBatch: targetBatch || 'all',
      createdAt: serverTimestamp()
    });
    $('no-ti').value=''; $('no-bo').value='';
    if($('no-batch')) $('no-batch').value = 'all';
    clearNoticeImg();
    // real-time listener updates the list instantly — no manual reload needed
  } catch(e){
    alert('Failed: ' + e.message);
  }
};

function loadNotices(){
  const el = $('no-list');
  const q = query(collection(db,'notices'), orderBy('createdAt','desc'), limit(50));
  // Real-time — new notices appear instantly without refresh
  onSnapshot(q, snap => {
    $('st-no').textContent = snap.size;
    if(snap.empty){
      el.innerHTML = '<div class="empty" style="color:var(--adm-muted)">No notices yet.</div>';
      return;
    }
    const nParts = [];
    snap.forEach(d => {
      const n = d.data();
      const photoHtml = n.photo
        ? `<img src="${n.photo}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-top:.55rem;cursor:zoom-in" onclick="zoomPhotoSrc('${n.photo}')">`
        : '';
      const batchTag = (n.targetBatch && n.targetBatch !== 'all')
        ? `<span style="background:rgba(0,180,216,.18);color:var(--accent);border:1px solid var(--accent);font-size:.6rem;font-weight:700;letter-spacing:.08em;padding:.12rem .42rem;border-radius:4px;text-transform:uppercase;white-space:nowrap">📚 ${esc(n.targetBatch)}</span>`
        : `<span style="background:rgba(255,255,255,.07);color:var(--adm-muted);border:1px solid var(--adm-bd);font-size:.6rem;font-weight:700;letter-spacing:.08em;padding:.12rem .42rem;border-radius:4px;text-transform:uppercase;white-space:nowrap">📢 All</span>`;
      nParts.push(`<div class="dc" style="margin-bottom:.55rem;padding:.95rem 1.1rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.28rem;gap:.5rem">
          <div style="color:var(--adm-ink);font-weight:600;font-size:.86rem">${esc(n.title)}</div>
          <div style="display:flex;align-items:center;gap:.4rem;flex-shrink:0">${batchTag}<button class="b-del" onclick="delNotice('${d.id}')">🗑</button></div>
        </div>
        <div style="color:var(--adm-muted);font-size:.8rem;line-height:1.55">${esc(n.body)}</div>
        ${photoHtml}
      </div>`);
    });
    el.innerHTML = nParts.join('');
  }, e => console.error(e));
}

window.delNotice = async id => {
  if(!confirm('Delete this notice?')) return;
  await deleteDoc(doc(db,'notices', id));
  loadNotices();
};

// ══ ADD STUDENT (admin) ══
window.onAddPhoto = async e => {
  const f = e.target.files[0]; if(!f) return;
  if(f.size > 5 * 1024 * 1024){ alert('Photo must be smaller than 5MB.'); e.target.value=''; return; }
  const c = $('ad-pc');
  c.innerHTML = '⏳';
  try {
    addPhoto = await resizeImg(f);
    c.innerHTML = `<img src="${addPhoto}" alt="">`;
    c.style.borderColor = 'var(--accent)';
    c.style.borderStyle = 'solid';
  } catch(err){
    c.innerHTML = '📷';
    alert('Could not process image.');
  }
};

window.adminAdd = async () => {
  const name = $('ad-nm').value.trim();
  const dob  = $('ad-dob').value.trim();
  const gender = $('ad-gd').value;
  const phone = $('ad-ph').value.trim();
  const email = $('ad-em').value.trim();
  const pass = $('ad-pw').value;
  const batch = $('ad-ba').value;
  const btn = $('bt-add');
  if(!name || !phone || !email || !pass || !batch){
    alertMsg('ad-al', 'Please fill in all fields.');
    return;
  }
  if(pass.length < 6){
    alertMsg('ad-al', 'Password must be at least 6 characters.');
    return;
  }
  btn.innerHTML = '<span class="spin"></span>Creating...'; btn.disabled = true;
  try {
    let uid;
    // Try creating a new auth account
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      uid = cred.user.uid;
    } catch(authErr){
      if(authErr.code === 'auth/email-already-in-use'){
        // Sign in with the existing account to get the UID
        const cred2 = await signInWithEmailAndPassword(auth, email, pass);
        uid = cred2.user.uid;
      } else {
        throw authErr;
      }
    }
    // Upload photo to Firebase Storage if provided
    let photoUrl = '';
    if(addPhoto){
      try { photoUrl = await uploadPhotoToStorage(addPhoto, uid); }
      catch(_){ photoUrl = ''; }
    }
    const sid = await nextStudentId();
    await setDoc(doc(db,'students', uid), {
      name, nameLower: name.toLowerCase(),
      phone, email, course: batch,
      dob: dob || '',
      gender: gender || '',
      studentId: sid,
      photo: photoUrl,
      enrolledAt: serverTimestamp(),
      role: 'student'
    });
    await saveLoginMap(sid, email);
    alertMsg('ad-al', `✅ Student created! ID: ${sid}`, 'ok');
    $('ad-nm').value=''; $('ad-dob').value=''; $('ad-gd').value='';
    $('ad-ph').value=''; $('ad-em').value='';
    $('ad-pw').value=''; $('ad-ba').value='';
    addPhoto = null;
    $('ad-pc').innerHTML = '📷';
    $('ad-pc').style.borderColor = '';
    $('ad-pc').style.borderStyle = '';
    loadBatches();
  } catch(e){
    let m = 'Failed: ' + e.message;
    if(e.code === 'auth/invalid-email') m = 'Invalid email address.';
    if(e.code === 'auth/wrong-password') m = 'Email already exists but password is wrong — use the correct password for that account.';
    alertMsg('ad-al', m);
  }
  btn.innerHTML = 'Create Student Account'; btn.disabled = false;
};

// ══ ADMINS ══
window.grantAdmin = async () => {
  const email = $('am-em').value.trim().toLowerCase();
  if(!email || !email.includes('@')){
    alertMsg('am-al', 'Please enter a valid email address.');
    return;
  }
  if(email === SUPER_ADMIN){
    alertMsg('am-al', 'That is already the super admin.');
    return;
  }
  try {
    await setDoc(doc(db,'admins', email), {
      email, grantedBy: CU.email, grantedAt: serverTimestamp()
    });
    alertMsg('am-al', '✅ Admin access granted to ' + email, 'ok');
    $('am-em').value = '';
    loadAdminsList();
  } catch(e){
    alertMsg('am-al', 'Failed: ' + e.message);
  }
};

async function loadAdminsList(){
  const el = $('am-list');
  if(!el) return;
  try {
    const snap = await getDocs(collection(db,'admins'));
    el.innerHTML = `<div class="a-row"><div><div class="em">${esc(SUPER_ADMIN)}<span class="s-tag">SUPER</span></div><div class="sb">Owner — permanent</div></div></div>`;
    snap.forEach(d => {
      const a = d.data();
      el.innerHTML += `<div class="a-row"><div><div class="em">${esc(a.email)}</div><div class="sb">Added by ${esc(a.grantedBy||'')}</div></div><button class="b-del" onclick="removeAdmin('${esc(a.email)}')">Remove</button></div>`;
    });
  } catch(e){
    el.innerHTML = '<div style="color:var(--danger);font-size:.8rem">Error loading admins.</div>';
  }
}

window.removeAdmin = async email => {
  if(!confirm('Remove admin access for ' + email + '?')) return;
  await deleteDoc(doc(db,'admins', email));
  loadAdminsList();
  loadGrantList();
};

// Grant admin modal
window.openGrantModal = () => {
  $('g-em').value = '';
  $('g-al').className = 'alert';
  $('m-grant').classList.add('open');
  loadGrantList();
};

async function loadGrantList(){
  const el = $('g-list');
  if(!el) return;
  try {
    const snap = await getDocs(collection(db,'admins'));
    if(snap.empty){
      el.innerHTML = '<div style="color:var(--adm-muted);font-size:.76rem;margin-top:.7rem">No extra admins yet.</div>';
      return;
    }
    let html = '<div style="color:var(--adm-muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;margin-top:.85rem;margin-bottom:.4rem">Current Admins</div>';
    snap.forEach(d => {
      const e = d.data().email;
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--adm-bd)"><span style="color:var(--adm-ink);font-size:.8rem">${esc(e)}</span><button onclick="removeAdminGrant('${esc(e)}')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:.74rem">✕ Remove</button></div>`;
    });
    el.innerHTML = html;
  } catch(_){
    el.innerHTML = '';
  }
}

window.removeAdminGrant = async email => {
  if(!confirm('Remove admin access for ' + email + '?')) return;
  await deleteDoc(doc(db,'admins', email));
  loadGrantList();
  loadAdminsList();
};

window.doGrant = async () => {
  const email = $('g-em').value.trim().toLowerCase();
  const btn = $('bt-g');
  if(!email || !email.includes('@')){
    alertMsg('g-al', 'Enter a valid email address.');
    return;
  }
  if(email === SUPER_ADMIN){
    alertMsg('g-al', 'That is already the super admin!');
    return;
  }
  btn.textContent = 'Saving...'; btn.disabled = true;
  try {
    await setDoc(doc(db,'admins', email), {
      email, grantedBy: CU.email, grantedAt: serverTimestamp()
    });
    alertMsg('g-al', '✅ Admin access granted to ' + email + '! They see admin panel on next login.', 'ok');
    $('g-em').value = '';
    loadGrantList();
    loadAdminsList();
  } catch(e){
    alertMsg('g-al', 'Failed: ' + e.message);
  }
  btn.textContent = '✅ Grant Access'; btn.disabled = false;
};


// ══════════════════════════════════════════════
//   NFC ATTENDANCE ENGINE
// ══════════════════════════════════════════════

let nfcMode = 'keyboard'; // 'keyboard' | 'manual'
let nfcCurrentStudent = null; // {uid, name, sid, photo, batch, nfcId}
let nfcLinkMode = null; // when set, next tap links card to this {uid, name, sid}
let nfcRecentTaps = []; // [{time, name, sid, status}]
let nfcInputBuffer = '';
let nfcInputTimer = null;

window.setNfcMode = function(mode){
  nfcMode = mode;
  document.getElementById('nfc-mode-keyboard').classList.toggle('active', mode === 'keyboard');
  document.getElementById('nfc-mode-manual').classList.toggle('active', mode === 'manual');
  const inp = document.getElementById('nfc-input');
  if(mode === 'manual'){
    inp.placeholder = 'Type the card UID and press Enter';
    inp.readOnly = false;
  } else {
    inp.placeholder = 'Tap card on the reader (auto-receive)';
    inp.readOnly = false; // keep editable for keyboard wedge
    inp.focus();
  }
};

// Listen for Enter key in the NFC input — most keyboard NFC readers send the UID
// followed by Enter. Manual mode also uses Enter to submit.
function setupNfcInput(){
  const inp = document.getElementById('nfc-input');
  if(!inp) return;
  inp.addEventListener('keydown', e => {
    if(e.key === 'Enter'){
      e.preventDefault();
      const uid = inp.value.trim();
      if(uid) handleNfcTap(uid);
      inp.value = '';
    }
  });
  // Auto-focus the input when the NFC tab is active
  document.addEventListener('click', () => {
    const sec = document.getElementById('as-nfc');
    if(sec && sec.classList.contains('active')){
      setTimeout(() => inp.focus(), 50);
    }
  });
}
// Init when page loads
if(document.readyState !== 'loading') setupNfcInput();
else document.addEventListener('DOMContentLoaded', setupNfcInput);

// ── Main tap handler ──
async function handleNfcTap(uid){
  // Normalise UID — strip whitespace, uppercase hex
  uid = uid.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if(!uid) return;

  // If we're in link mode, link this card to the pending student
  if(nfcLinkMode){
    await linkNfcCardToStudent(uid);
    return;
  }

  // Look up student by nfcId
  setNfcScreen('scanning', '🔍 Looking up card...', `Card UID: ${uid}`);
  try {
    const snap = await getDocs(query(collection(db,'students'), where('nfcId','==', uid), limit(1)));
    if(snap.empty){
      setNfcScreen('error', '❌ Card not recognised', `UID: ${uid} is not linked to any student. Open a student profile and click "Link NFC Card".`);
      playNfcBeep('error');
      setTimeout(() => nfcReset(), 4000);
      return;
    }
    const doc0 = snap.docs[0];
    const s = doc0.data();
    nfcCurrentStudent = {
      uid: doc0.id,
      name: s.name || '',
      sid: s.studentId || '',
      photo: s.photo || '',
      batch: s.course || '',
      phone: s.phone || '',
      email: s.email || '',
      dob: s.dob || '',
      gender: s.gender || '',
      status: s.status || 'active',
      enrolledAt: s.enrolledAt || null,
      nfcId: uid
    };
    showNfcStudentCard();
    playNfcBeep('success');
  } catch(e){
    setNfcScreen('error', '❌ Lookup failed', e.message);
    setTimeout(() => nfcReset(), 3500);
  }
}

function setNfcScreen(state, status, hint){
  const scr = document.getElementById('nfc-screen');
  if(!scr) return;
  scr.classList.remove('scanning','success','error');
  scr.classList.add(state);
  document.getElementById('nfc-status').textContent = status;
  document.getElementById('nfc-hint').innerHTML = hint;
  document.getElementById('nfc-result').style.display = 'none';
  scr.style.display = 'flex';
  // Update icon based on state
  const ic = scr.querySelector('.nfc-icon');
  if(ic){
    ic.textContent = state === 'success' ? '✅' : state === 'error' ? '⚠️' : '📡';
  }
}

async function showNfcStudentCard(){
  const s = nfcCurrentStudent;
  document.getElementById('nfc-screen').style.display = 'none';
  const result = document.getElementById('nfc-result');
  result.style.display = 'block';
  // Photo
  const ph = document.getElementById('ncr-photo');
  if(s.photo) ph.innerHTML = `<img src="${s.photo}" alt="">`;
  else ph.textContent = (s.name && s.name[0] || '?').toUpperCase();
  // Name & header
  document.getElementById('ncr-name').textContent = s.name || '—';
  document.getElementById('ncr-id').textContent = s.sid || '—';
  document.getElementById('ncr-batch').textContent = s.batch || '—';
  // Detail grid
  document.getElementById('ncr-fullname').textContent = s.name || '—';
  document.getElementById('ncr-phone').textContent = s.phone || '—';
  document.getElementById('ncr-email').textContent = s.email || '—';
  // Format DOB
  let dobTxt = '—';
  if(s.dob){
    try {
      const d = new Date(s.dob);
      if(!isNaN(d)) dobTxt = d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
      else dobTxt = s.dob;
    } catch(_){ dobTxt = s.dob; }
  }
  document.getElementById('ncr-dob').textContent = dobTxt;
  // Gender — capitalise
  document.getElementById('ncr-gender').textContent = s.gender ? s.gender.charAt(0).toUpperCase()+s.gender.slice(1) : '—';
  // Status
  const statusEl = document.getElementById('ncr-status');
  const st = (s.status || 'active').toLowerCase();
  if(st === 'active'){
    statusEl.innerHTML = '<span style="color:#16a34a;font-weight:600">✅ Active</span>';
  } else if(st === 'inactive'){
    statusEl.innerHTML = '<span style="color:#dc2626;font-weight:600">⛔ Inactive</span>';
  } else {
    statusEl.textContent = s.status;
  }
  // Enrolled date
  let enrTxt = '—';
  if(s.enrolledAt){
    try {
      const d = s.enrolledAt.toDate ? s.enrolledAt.toDate() : new Date(s.enrolledAt);
      if(!isNaN(d)) enrTxt = d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    } catch(_){}
  }
  document.getElementById('ncr-enrolled').textContent = enrTxt;

  // Check if already marked today
  const today = new Date().toISOString().split('T')[0];
  try {
    const q = query(
      collection(db,'attendance'),
      where('studentUid','==', s.uid),
      where('date','==', today)
    );
    const snap = await getDocs(q);
    const already = document.getElementById('nfc-already');
    if(!snap.empty){
      const existing = snap.docs[0].data();
      const stTxt = (existing.status || '').toUpperCase();
      already.style.display = 'block';
      document.getElementById('nfc-already-txt').textContent = `⚠️ Already marked today as ${stTxt}`;
    } else {
      already.style.display = 'none';
    }
  } catch(_){}
}

window.markNfcAtt = async function(status){
  if(!nfcCurrentStudent) return;
  const s = nfcCurrentStudent;
  const today = new Date().toISOString().split('T')[0];
  try {
    // Find existing record or create new
    const q = query(
      collection(db,'attendance'),
      where('studentUid','==', s.uid),
      where('date','==', today)
    );
    const snap = await getDocs(q);
    if(!snap.empty){
      // Update existing
      await updateDoc(doc(db,'attendance', snap.docs[0].id), {
        status,
        updatedAt: serverTimestamp()
      });
    } else {
      // Create new
      await addDoc(collection(db,'attendance'), {
        studentUid: s.uid,
        studentName: s.name,
        studentId: s.sid,
        date: today,
        status,
        createdAt: serverTimestamp()
      });
    }
    // Add to recent taps
    const tm = new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
    nfcRecentTaps.unshift({ time: tm, name: s.name, sid: s.sid, status });
    if(nfcRecentTaps.length > 30) nfcRecentTaps.pop();
    renderNfcRecent();
    // Visual confirmation
    setNfcScreen('success', `✅ ${status.toUpperCase()} for ${s.name}`, `Marked ${s.sid} as ${status} on ${today}. Tap next card.`);
    playNfcBeep('confirm');
    nfcCurrentStudent = null;
    setTimeout(() => {
      nfcReset();
      const inp = document.getElementById('nfc-input');
      if(inp) inp.focus();
    }, 2000);
  } catch(e){
    alert('Failed to save attendance: ' + e.message);
  }
};

window.nfcReset = function(){
  nfcCurrentStudent = null;
  document.getElementById('nfc-result').style.display = 'none';
  setNfcScreen('scanning', 'Ready to Scan', 'Tap a student\'s NFC card on the reader to mark attendance');
  const inp = document.getElementById('nfc-input');
  if(inp){ inp.value = ''; inp.focus(); }
};

function renderNfcRecent(){
  const el = document.getElementById('nfc-recent-list');
  const cnt = document.getElementById('nfc-recent-count');
  if(!el) return;
  cnt.textContent = nfcRecentTaps.length;
  if(!nfcRecentTaps.length){
    el.innerHTML = '<div style="color:var(--adm-muted);font-size:.78rem;padding:.4rem 0;text-align:center">No taps yet today.</div>';
    return;
  }
  el.innerHTML = nfcRecentTaps.map(t => `
    <div class="nfc-tap-row">
      <span class="tm">${t.time}</span>
      <span class="nm"><strong style="color:var(--accent)">${esc(t.sid||'—')}</strong> ${esc(t.name||'')}</span>
      <span class="st ${t.status}">${t.status}</span>
    </div>`).join('');
}

// ── Beep sound (audio feedback) ──
let nfcAudioCtx = null;
function playNfcBeep(kind){
  try {
    if(!nfcAudioCtx) nfcAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = nfcAudioCtx.createOscillator();
    const g = nfcAudioCtx.createGain();
    o.connect(g); g.connect(nfcAudioCtx.destination);
    if(kind === 'success'){
      o.frequency.value = 880; g.gain.value = .15;
      o.start(); setTimeout(() => { o.stop(); }, 100);
    } else if(kind === 'confirm'){
      o.frequency.value = 1320; g.gain.value = .15;
      o.start(); setTimeout(() => { o.stop(); }, 150);
    } else if(kind === 'error'){
      o.frequency.value = 200; g.gain.value = .12;
      o.start(); setTimeout(() => { o.stop(); }, 300);
    }
  } catch(_){}
}

// ══════════════════════════════════════════════
//   NFC CARD LINKING (in student profile)
// ══════════════════════════════════════════════

window.linkNfcCard = function(uid, name, sid){
  // Open a tiny prompt-style modal to capture the card
  if(!confirm(`Link an NFC card to ${name} (${sid})?\n\n1. After clicking OK, you'll see a tap screen.\n2. Tap a blank or new card on the reader.\n3. The card UID will be saved and linked to this student.`)) return;
  nfcLinkMode = { uid, name, sid };
  // Switch to NFC tab
  document.querySelectorAll('.adm-tabs button').forEach(b => b.classList.remove('active'));
  const nfcBtn = [...document.querySelectorAll('.adm-tabs button')].find(b => b.textContent.includes('NFC'));
  if(nfcBtn) nfcBtn.classList.add('active');
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  document.getElementById('as-nfc').classList.add('active');
  // Update screen
  setNfcScreen('scanning', `📱 Linking card for ${name}`, `Tap a card on the reader to link it to <strong>${esc(sid)}</strong>. Click "Cancel" below to abort.`);
  document.getElementById('nfc-result').style.display = 'none';
  // Show cancel button via reset
  setTimeout(() => { const inp = document.getElementById('nfc-input'); if(inp) inp.focus(); }, 100);
};

async function linkNfcCardToStudent(uid){
  if(!nfcLinkMode) return;
  const target = nfcLinkMode;
  try {
    // Check if this UID is already linked to someone else
    const existing = await getDocs(query(collection(db,'students'), where('nfcId','==', uid), limit(1)));
    if(!existing.empty && existing.docs[0].id !== target.uid){
      const other = existing.docs[0].data();
      if(!confirm(`⚠️ This card is already linked to ${other.name || 'another student'} (${other.studentId || ''}).\n\nDo you want to MOVE it to ${target.name} (${target.sid})?\n\nThe other student will lose this card.`)){
        nfcLinkMode = null;
        nfcReset();
        return;
      }
      // Unlink from other student
      await updateDoc(doc(db,'students', existing.docs[0].id), { nfcId: '' });
    }
    // Link to target student
    await updateDoc(doc(db,'students', target.uid), { nfcId: uid });
    nfcLinkMode = null;
    setNfcScreen('success', `✅ Card linked to ${target.name}!`, `UID <strong>${uid}</strong> is now linked to <strong>${esc(target.sid)}</strong>. Use this card to mark attendance.`);
    playNfcBeep('confirm');
    setTimeout(() => nfcReset(), 3500);
  } catch(e){
    nfcLinkMode = null;
    setNfcScreen('error', '❌ Link failed', e.message);
  }
}
