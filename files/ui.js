// ui.js — theme toggle + tab navigation (no Firebase dependency)

function toggleTheme(){
  const root = document.documentElement;
  const isLight = root.getAttribute('data-theme') === 'light';
  root.setAttribute('data-theme', isLight ? 'dark' : 'light');
  document.getElementById('themeBtn').textContent = isLight ? '☀️ Light' : '🌙 Dark';
  try{ localStorage.setItem('zel-theme', isLight ? 'dark' : 'light'); }catch(e){}
}

(function initTheme(){
  let saved = null;
  try{ saved = localStorage.getItem('zel-theme'); }catch(e){}
  if(saved === 'light'){
    document.documentElement.setAttribute('data-theme', 'light');
    document.getElementById('themeBtn').textContent = '🌙 Dark';
  }
})();

const TABS = ['home', 'search', 'courses', 'events', 'profile'];

function goTab(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.remove('active'));
  const root = TABS.includes(id)
    ? id
    : (id === 'batch-detail' ? 'courses'
      : (id.startsWith('edit') || id === 'settings' || id === 'report-bug') ? 'profile'
      : 'home');
  const btn = document.querySelector('.tabbar button[data-tab="' + root + '"]');
  if(btn) btn.classList.add('active');
  document.querySelector('main').scrollTop = 0;
}
