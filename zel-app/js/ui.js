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
