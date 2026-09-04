(function(){
  var q=location.search||"";
  var h=location.hash||"";
  var hp=new URLSearchParams(String(h||"").replace(/^#/,""));
  if(hp.get("provider_token"))return;
  var type=String(new URLSearchParams(q).get("type")||hp.get("type")||"").toLowerCase();
  if(type==="signup"||type==="email")return;
  if(hp.get("access_token")&&type!=="recovery")return;
  if(type!=="recovery")return;
  location.replace("reset-password.html"+q+h);
})();
