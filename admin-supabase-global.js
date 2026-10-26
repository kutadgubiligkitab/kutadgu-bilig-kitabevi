(function(){
  if(window.supabase&&typeof window.supabase.createClient==="function")return;
  var exported=null;
  try{
    if(typeof module==="object"&&module&&module.exports&&typeof module.exports.createClient==="function")exported=module.exports;
  }catch(error){}
  if(!exported){
    try{
      if(typeof exports==="object"&&exports&&exports.supabase&&typeof exports.supabase.createClient==="function")exported=exports.supabase;
    }catch(error){}
  }
  if(exported)window.supabase=exported;
})();
