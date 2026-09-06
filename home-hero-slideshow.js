(function kutadguShopHeroSlideshow(){
  const INTERVAL_MS=7000;
  const root=document.querySelector("[data-shop-hero-slideshow]");
  if(!root)return;
  const slides=[...root.querySelectorAll("[data-shop-hero-slide]")];
  const dots=[...root.querySelectorAll("[data-shop-hero-dot]")];
  if(slides.length<2)return;

  let index=0;
  let timer=null;
  const motion=window.matchMedia("(prefers-reduced-motion: reduce)");

  function show(next){
    index=(next+slides.length)%slides.length;
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
  }

  function stop(){
    if(timer){
      clearInterval(timer);
      timer=null;
    }
  }

  function start(){
    stop();
    if(motion.matches||document.hidden)return;
    timer=setInterval(()=>show(index+1),INTERVAL_MS);
  }

  dots.forEach((dot,i)=>{
    dot.addEventListener("click",()=>{
      show(i);
      start();
    });
  });

  if(typeof motion.addEventListener==="function")motion.addEventListener("change",start);
  else if(typeof motion.addListener==="function")motion.addListener(start);
  document.addEventListener("visibilitychange",start);
  start();
})();
