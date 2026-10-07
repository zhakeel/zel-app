/* Runs in <head> before first paint so the saved theme never flashes. */
/* Apply saved/system theme BEFORE first paint (prevents flash) */
(function(){
  var t=null;
  try{t=localStorage.getItem('zel-theme');}catch(e){}
  if(t!=='light'&&t!=='dark'){
    t=(window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';
  }
  document.documentElement.setAttribute('data-theme',t);
  var m=document.querySelector('meta[name="theme-color"]');
  if(m)m.setAttribute('content',t==='light'?'#064e73':'#090c12');
})();
