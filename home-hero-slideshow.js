(function kutadguShopHeroSlideshow(){
  const INTERVAL_MS=7000;
  const ALLOWED_INTERVALS=new Set([5000,7000,10000,15000]);

  function normalizeInterval(ms){
    const n=Number(ms);
    if(ALLOWED_INTERVALS.has(n))return n;
    return INTERVAL_MS;
  }

  if(typeof document==="undefined"){
    const api={INTERVAL_MS,normalizeInterval,refresh:function(){},setIntervalMs:function(){},getIntervalMs:function(){return INTERVAL_MS;},start:function(){},stop:function(){},show:function(){}};
    if(typeof module!=="undefined"&&module.exports)module.exports=api;
    return;
  }

  const root=document.querySelector("[data-shop-hero-slideshow]");
  if(!root){
    if(typeof window!=="undefined")window.KutadguHeroSlideshow=null;
    return;
  }

  let slides=[];
  let dots=[];
  let index=0;
  let timer=null;
  let intervalMs=INTERVAL_MS;
  let dotsBound=false;
  let globalsBound=false;
  const motion=window.matchMedia("(prefers-reduced-motion: reduce)");

  function query(){
    slides=[...root.querySelectorAll("[data-shop-hero-slide]")];
    dots=[...root.querySelectorAll("[data-shop-hero-dot]")];
  }

  function emit(){
    const slide=slides[index]||null;
    try{
      root.dispatchEvent(new CustomEvent("kutadgu:hero-slide-change",{
        bubbles:true,
        detail:{
          index:index,
          total:slides.length,
          slide:slide
        }
      }));
    }catch(err){}
  }

  function show(next){
    query();
    if(!slides.length)return;
    index=((Number(next)||0)%slides.length+slides.length)%slides.length;
    slides.forEach((slide,i)=>{
      const on=i===index;
      slide.classList.toggle("is-active",on);
      slide.setAttribute("aria-hidden",on?"false":"true");
    });
    dots.forEach((dot,i)=>{
      const on=i===index;
      dot.classList.toggle("is-active",on);
      if(on)dot.setAttribute("aria-current","true");
      else dot.removeAttribute("aria-current");
    });
    emit();
  }

  function stop(){
    if(timer){
      clearInterval(timer);
      timer=null;
    }
  }

  function start(){
    stop();
    query();
    if(slides.length<2)return;
    if(motion.matches||document.hidden)return;
    timer=setInterval(()=>show(index+1),intervalMs);
  }

  function bindDots(){
    if(dotsBound)return;
    dotsBound=true;
    root.addEventListener("click",(event)=>{
      const dot=event.target&&event.target.closest?event.target.closest("[data-shop-hero-dot]"):null;
      if(!dot||!root.contains(dot))return;
      const live=[...root.querySelectorAll("[data-shop-hero-dot]")];
      const i=live.indexOf(dot);
      if(i<0)return;
      show(i);
      start();
    });
  }

  function bindGlobals(){
    if(globalsBound)return;
    globalsBound=true;
    if(typeof motion.addEventListener==="function")motion.addEventListener("change",start);
    else if(typeof motion.addListener==="function")motion.addListener(start);
    document.addEventListener("visibilitychange",start);
  }

  function refresh(){
    query();
    if(index>=slides.length)index=0;
    if(slides.length)show(index);
    else{
      index=0;
      stop();
    }
    start();
  }

  function setIntervalMs(ms){
    intervalMs=normalizeInterval(ms);
    start();
  }

  function getIntervalMs(){
    return intervalMs;
  }

  query();
  bindDots();
  bindGlobals();
  start();

  const api={
    INTERVAL_MS,
    refresh,
    setIntervalMs,
    getIntervalMs,
    start,
    stop,
    show,
    normalizeInterval
  };
  if(typeof window!=="undefined")window.KutadguHeroSlideshow=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();
