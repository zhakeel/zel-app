/* ZEL — UI helpers: navigation tabs, photo zoom, dark/light theme switch. */
// ── Navigation (non-module, plain script) ──
function $$(id){ return document.getElementById(id); }

// ══ PHOTO ZOOM ══
window.zoomPhoto = function(el){
  if(!el) return;
  const img = el.querySelector('img');
  if(!img || !img.src){
    // No photo to zoom (just initial letter) - do nothing
    return;
  }
  document.getElementById('zoom-img').src = img.src;
  document.getElementById('zoom-ovl').classList.add('show');
};

window.closeZoom = function(){
  document.getElementById('zoom-ovl').classList.remove('show');
};

// Close zoom on Escape
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape'){
    var ovl = document.getElementById('zoom-ovl');
    if(ovl && ovl.classList.contains('show')) ovl.classList.remove('show');
  }
});

// ══ THEME SWITCH (dark / light) ══
window.toggleTheme = function(){
  var root=document.documentElement;
  var next=root.getAttribute('data-theme')==='light'?'dark':'light';
  root.setAttribute('data-theme',next);
  try{localStorage.setItem('zel-theme',next);}catch(e){}
  var m=document.querySelector('meta[name="theme-color"]');
  if(m)m.setAttribute('content',next==='light'?'#064e73':'#090c12');
};
// follow the OS setting only until the user picks a theme manually
if(window.matchMedia){
  matchMedia('(prefers-color-scheme: light)').addEventListener('change',function(e){
    var saved=null;try{saved=localStorage.getItem('zel-theme');}catch(_){}
    if(!saved){document.documentElement.setAttribute('data-theme',e.matches?'light':'dark');}
  });
}

function loginTab(tab){
  if($$('pg-fp')) $$('pg-fp').style.display = 'none';
  if($$('login-tabs')) $$('login-tabs').style.display = 'flex';
  $$('pg-in').style.display = tab === 'in' ? 'block' : 'none';
  $$('pg-rg').style.display = tab === 'rg' ? 'block' : 'none';
  $$('t-in').classList.toggle('active', tab === 'in');
  $$('t-rg').classList.toggle('active', tab === 'rg');
  $$('la').className = 'alert';
}
window.loginTab = loginTab;

function stuTab(sec, btn){
  document.querySelectorAll('.bnav button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.sub').forEach(s => s.classList.remove('active'));
  $$('ss-' + sec).classList.add('active');
}
window.stuTab = stuTab;


function admTab(sec, btn){
  document.querySelectorAll('.adm-tabs button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  $$('as-' + sec).classList.add('active');
  if(sec === 'batches' && typeof showBatchList === 'function'){
    showBatchList();
  }
  if(sec === 'notices' && typeof loadNoticeBatchOptions === 'function'){
    loadNoticeBatchOptions();
  }
  if(sec === 'gallery' && typeof loadGalleryList === 'function'){
    loadGalleryList();
  }
  if(sec === 'att') {
    const mo = document.getElementById('at-mo');
    if(mo && !mo.value) { const now = new Date(); mo.value = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0'); }
  }
  if(sec === 'nfc'){
    setTimeout(() => {
      const inp = document.getElementById('nfc-input');
      if(inp) inp.focus();
    }, 100);
  }
}
window.admTab = admTab;


// ══ HOME DASHBOARD (greeting, live stat tiles, quick actions) ══
window.goTab = function(sec){
  var i = {home:0,id:1,att:2,fees:3,set:4}[sec];
  stuTab(sec, document.querySelectorAll('.bnav button')[i]);
  window.scrollTo({top:0,behavior:'smooth'});
};
function syncHome(){
  var g = function(i){ return document.getElementById(i); };
  if(!g('h-att') || !g('d-att-pct')) return;
  g('h-att').textContent = g('d-att-pct').textContent || '0%';
  g('h-att-bar').style.width = (g('d-att-bar') && g('d-att-bar').style.width) || '0%';
  g('h-pres').textContent = g('d-att-p').textContent || '0';
  var d = new Date(), h = d.getHours();
  g('h-greet').textContent = (h<12?'Good morning':h<18?'Good afternoon':'Good evening') + ' · ' +
    d.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short'});
}
setInterval(syncHome, 1200);
document.addEventListener('DOMContentLoaded', syncHome);


// ══ FORGOT PASSWORD VIEW ══
window.showForgotPw = function(){
  $$('pg-in').style.display = 'none';
  $$('pg-rg').style.display = 'none';
  $$('pg-fp').style.display = 'block';
  $$('login-tabs').style.display = 'none';
  $$('la').className = 'alert';
  var ex = $$('li-em').value.trim();
  if(ex) $$('fp-em').value = ex;
};
window.backToSignIn = function(){
  $$('pg-fp').style.display = 'none';
  $$('pg-in').style.display = 'block';
  $$('login-tabs').style.display = 'flex';
  $$('la').className = 'alert';
};

// ══ SHOW / HIDE PASSWORD (auto-added to every password field) ══
var ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
var ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 3.9M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M2 2l20 20"/></svg>';
window.togglePw = function(btn){
  var input = btn.previousElementSibling; if(!input) return;
  var show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = show ? ICON_EYE_OFF : ICON_EYE;
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
};
document.querySelectorAll('input[type=password]').forEach(function(i){
  if(i.parentElement.classList.contains('pw-wrap')) return;
  var w = document.createElement('div'); w.className = 'pw-wrap';
  i.parentNode.insertBefore(w, i); w.appendChild(i);
  var b = document.createElement('button');
  b.type = 'button'; b.className = 'pw-eye'; b.tabIndex = -1;
  b.setAttribute('aria-label','Show password'); b.innerHTML = ICON_EYE;
  b.onclick = function(){ window.togglePw(b); };
  w.appendChild(b);
});

// ══ PWA: service worker (installable app + Android wrapper) ══
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){ navigator.serviceWorker.register('service-worker.js').catch(function(){}); });
}
