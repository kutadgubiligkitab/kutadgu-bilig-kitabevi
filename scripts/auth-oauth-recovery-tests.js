#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, err.message);
  }
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const cfg = read("supabase-config.js");
const index = read("index.html");
const resetJs = read("reset-password.js");
const member = read("member.js");
const admin = read("admin.js");
const account = read("account.html");

function loadConfig(location) {
  const sandbox = {
    window: {},
    URLSearchParams,
    console,
    location: Object.assign({
      pathname: "/index.html",
      search: "",
      hash: "",
      href: "https://www.kutadgubilik.com/",
      hostname: "www.kutadgubilik.com",
      origin: "https://www.kutadgubilik.com",
      replace() {}
    }, location || {})
  };
  sandbox.window = sandbox;
  sandbox.window.location = sandbox.location;
  vm.runInNewContext(
    cfg.replace(/\(function kutadguCanonicalizeApexAuthCallback\(\)\{[\s\S]*?\}\)\(\);/, "")
      .replace(/\(function kutadguBounceRecoveryToResetPage\(\)\{[\s\S]*?\}\)\(\);/, "")
      .replace(/\(function kutadguLoadMaintenanceGuard\(\)\{[\s\S]*?\}\)\(\);/, ""),
    sandbox
  );
  return sandbox.window;
}

test("auth origin is www custom domain, not Vercel", () => {
  assert.match(cfg, /window\.KUTADGU_SITE_ORIGIN = "https:\/\/www\.kutadgubilik\.com"/);
  assert.doesNotMatch(cfg, /KUTADGU_SITE_ORIGIN = "https:\/\/kutadgu-bilig-kitab\.vercel\.app"/);
  assert.match(member, /reset-password\.html\?type=recovery&next=/);
  assert.match(admin, /reset-password\.html\?type=recovery&next=admin/);
  assert.doesNotMatch(member, /kutadgu-bilig-kitab\.vercel\.app\/reset-password/);
  assert.doesNotMatch(admin, /kutadgu-bilig-kitab\.vercel\.app\/reset-password/);
});

test("production custom domain is kutadgubilik.com, never kutadgubilig.com", () => {
  const files = [
    "supabase-config.js",
    "member.js",
    "admin.js",
    "shop.js",
    "kutadgu-book-seo.js",
    "kutadgu-sitemap.js",
    "robots.txt",
    "index.html"
  ];
  files.forEach((rel) => {
    const text = read(rel);
    assert.match(text, /kutadgubilik\.com/, rel + " missing correct custom domain");
    assert.doesNotMatch(text, /kutadgubilig\.com/, rel + " still has the unrelated kutadgubilig.com host");
  });
  assert.match(cfg, /kutadgu-bilig-kitab\.vercel\.app/);
});

test("password reset helper uses auth callback origin and dedicated reset page", () => {
  const w = loadConfig();
  assert.strictEqual(w.KUTADGU_SITE_ORIGIN, "https://www.kutadgubilik.com");
  assert.strictEqual(
    w.kutadguPasswordResetRedirectTo("account"),
    "https://www.kutadgubilik.com/reset-password.html?type=recovery&next=account"
  );
  assert.strictEqual(
    w.kutadguPasswordResetRedirectTo("admin"),
    "https://www.kutadgubilik.com/reset-password.html?type=recovery&next=admin"
  );
  assert.strictEqual(
    w.kutadguPasswordResetRedirectTo(),
    "https://www.kutadgubilik.com/reset-password.html?type=recovery&next=account"
  );
  assert.ok(!w.kutadguPasswordResetRedirectTo("account").includes("account.html"));
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("?type=recovery", ""), true);
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("?code=abc", ""), false);
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("?code=abc&type=signup", ""), false);
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("?code=abc&type=recovery", ""), true);
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("", "#access_token=x&type=recovery"), true);
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("", "#access_token=x&token_type=bearer"), false);
  assert.strictEqual(w.kutadguIsGenericOauthHash("#access_token=x&token_type=bearer"), true);
  assert.strictEqual(w.kutadguIsGenericOauthHash("#access_token=x&type=recovery"), false);
  assert.strictEqual(w.kutadguIsGenericOauthHash("#access_token=x&provider_token=p"), true);
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("", "#access_token=x&type=recovery&provider_token=p"), false);
});

test("Google OAuth redirectTo stays on the start origin except production hosts", () => {
  const www = loadConfig({
    hostname: "www.kutadgubilik.com",
    origin: "https://www.kutadgubilik.com"
  });
  assert.strictEqual(www.kutadguGoogleAccountRedirectTo(), "https://www.kutadgubilik.com/account.html");
  assert.ok(!www.kutadguGoogleAccountRedirectTo().includes("reset-password"));
  const apex = loadConfig({
    hostname: "kutadgubilik.com",
    origin: "https://kutadgubilik.com"
  });
  assert.strictEqual(apex.kutadguAuthCallbackOrigin(), "https://www.kutadgubilik.com");
  assert.strictEqual(apex.kutadguGoogleAccountRedirectTo(), "https://www.kutadgubilik.com/account.html");
  const previewHost = "kutadgu-bilig-kitab-git-cursor-auth-oauth-recovery-domain-fd87.vercel.app";
  const preview = loadConfig({
    hostname: previewHost,
    origin: "https://"+previewHost
  });
  assert.strictEqual(preview.kutadguGoogleAccountRedirectTo(), "https://"+previewHost+"/account.html");
  const prodVercel = loadConfig({
    hostname: "kutadgu-bilig-kitab.vercel.app",
    origin: "https://kutadgu-bilig-kitab.vercel.app"
  });
  assert.strictEqual(prodVercel.kutadguGoogleAccountRedirectTo(), "https://www.kutadgubilik.com/account.html");
  const otherPreview = loadConfig({
    hostname: "pr-33-auth.example.com",
    origin: "https://pr-33-auth.example.com"
  });
  assert.strictEqual(otherPreview.kutadguGoogleAccountRedirectTo(), "https://pr-33-auth.example.com/account.html");
  const local = loadConfig({
    hostname: "127.0.0.1",
    origin: "http://127.0.0.1:4173"
  });
  assert.strictEqual(local.kutadguGoogleAccountRedirectTo(), "http://127.0.0.1:4173/account.html");
  assert.strictEqual(
    preview.kutadguPasswordResetRedirectTo("account"),
    "https://"+previewHost+"/reset-password.html?type=recovery&next=account"
  );
  assert.strictEqual(
    local.kutadguPasswordResetRedirectTo("admin"),
    "http://127.0.0.1:4173/reset-password.html?type=recovery&next=admin"
  );
});

test("homepage bounce only uses explicit type=recovery and skips OAuth hashes", () => {
  const bounce = read("recovery-bounce.js");
  assert.match(index, /<script src="recovery-bounce\.js\?v=1"><\/script>/);
  assert.match(bounce, /hp\.get\("access_token"\)&&type!=="recovery"\)return/);
  assert.match(bounce, /if\(type!=="recovery"\)return/);
  assert.doesNotMatch(index, /authOnHome/);
  assert.doesNotMatch(cfg, /authOnHome/);
  assert.match(cfg, /kutadguIsGenericOauthHash/);
  assert.match(cfg, /kutadguCanonicalizeApexAuthCallback/);
});

test("Google OAuth uses PKCE and same-origin account helper", () => {
  assert.match(member, /function googleAccountRedirectTo/);
  assert.match(member, /flowType:"pkce"/);
  assert.match(member, /signInWithOAuth\(\{provider:"google",options:\{redirectTo\}\}/);
  assert.match(account, /member\.js\?v=19/);
  assert.match(read("shop.js"), /member\.js\?v=19/);
  assert.match(index, /shop\.js\?v=98/);
});

test("reset page does not treat generic SIGNED_IN or hash OAuth as recovery", () => {
  assert.match(resetJs, /event==="PASSWORD_RECOVERY"/);
  assert.doesNotMatch(resetJs, /event==="PASSWORD_RECOVERY" \|\| event==="SIGNED_IN"/);
  assert.match(resetJs, /detectSessionInUrl:false/);
  assert.match(resetJs, /verifyOtp\(\{token_hash:info\.tokenHash,type:"recovery"\}\)/);
  assert.doesNotMatch(resetJs, /exchangeCodeForSession/);
  assert.doesNotMatch(resetJs, /isPkceRecoveryCallback/);
  assert.match(resetJs, /usesPkceCodeExchange:false/);
  assert.match(resetJs, /stripRecoverySecretsFromUrl/);
  assert.match(resetJs, /if\(session\)markRecoveryReady/);
  assert.doesNotMatch(resetJs, /if\(session && info\.tokenHash\)markRecoveryReady/);
  assert.match(resetJs, /setSession\(\{/);
  assert.match(resetJs, /isGenericOauthCallback/);
  assert.match(resetJs, /sendGenericOauthToAccount/);
  assert.doesNotMatch(resetJs, /console\.(log|info|debug|warn)\([^)]*access_token/);
  assert.doesNotMatch(resetJs, /console\.(log|info|debug|warn)\([^)]*token_hash/);
});

test("reset-password.html loads reset-password.js v=9", () => {
  assert.match(read("reset-password.html"), /reset-password\.js\?v=9/);
  assert.match(read("reset-password.html"), /supabase-config\.js\?v=14/);
  assert.match(account, /supabase-config\.js\?v=14/);
  assert.match(index, /supabase-config\.js\?v=14/);
  assert.match(read("admin.html"), /supabase-config\.js\?v=14/);
  assert.match(read("admin.html"), /admin\.js\?v=57/);
});

test("recovery email CTA uses TokenHash and forbids ConfirmationURL PKCE", () => {
  assert.match(cfg, /\{\{ \.RedirectTo \}\}&token_hash=\{\{ \.TokenHash \}\}&type=recovery/);
  assert.match(cfg, /TokenHash/);
  assert.match(cfg, /must NOT use \{\{ \.ConfirmationURL \}\}/);
  assert.doesNotMatch(cfg, /Recovery email uses \{\{ \.ConfirmationURL \}\}/);
});

function isExplicitRecoveryType(type){
  return type==="recovery";
}
function recoveryHashTokens(info){
  if(!info||info.hasProviderToken)return null;
  if(!isExplicitRecoveryType(info.type))return null;
  const access=String((info.hashParams&&info.hashParams.get("access_token"))||(info.params&&info.params.get("access_token"))||"").trim();
  const refresh=String((info.hashParams&&info.hashParams.get("refresh_token"))||(info.params&&info.params.get("refresh_token"))||"").trim();
  if(!access||!refresh)return null;
  return {access_token:access,refresh_token:refresh};
}
function isIntendedRecoveryLink(info){
  if(info.hasProviderToken)return false;
  if(recoveryHashTokens(info))return true;
  if(!info.tokenHash)return false;
  return isExplicitRecoveryType(info.type);
}
function isGenericOauthCallback(info){
  if(info.hasProviderToken)return true;
  if(info.hasAccessToken && !isExplicitRecoveryType(info.type))return true;
  return false;
}

test("recovery detection matches reset-password.js rules", () => {
  assert.match(resetJs, /function isIntendedRecoveryLink/);
  assert.strictEqual(isExplicitRecoveryType("recovery"), true);
  assert.strictEqual(isExplicitRecoveryType(""), false);
  assert.strictEqual(isIntendedRecoveryLink({ type: "recovery", next: "", code: "x", tokenHash: "", hasProviderToken: false }), false);
  assert.strictEqual(isIntendedRecoveryLink({ type: "recovery", next: "account", code: "", tokenHash: "th", hasProviderToken: false }), true);
  assert.strictEqual(isIntendedRecoveryLink({ type: "", next: "account", code: "x", tokenHash: "", hasProviderToken: false }), false);
  assert.strictEqual(isIntendedRecoveryLink({ type: "", next: "admin", code: "", tokenHash: "th", hasProviderToken: false }), false);
  assert.strictEqual(isIntendedRecoveryLink({ type: "", next: "", code: "oauth-code", tokenHash: "", hasProviderToken: false }), false);
  assert.strictEqual(isGenericOauthCallback({ type: "", next: "", code: "oauth-code", tokenHash: "", hasAccessToken: false, hasProviderToken: false }), false);
  assert.strictEqual(isGenericOauthCallback({ type: "", next: "account", code: "x", tokenHash: "", hasAccessToken: false, hasProviderToken: false }), false);
  assert.strictEqual(isGenericOauthCallback({ type: "recovery", next: "account", code: "", tokenHash: "th", hasAccessToken: false, hasProviderToken: false }), false);
  assert.strictEqual(isGenericOauthCallback({ type: "", next: "", code: "", tokenHash: "", hasAccessToken: true, hasProviderToken: false }), true);
  assert.strictEqual(isGenericOauthCallback({ type: "recovery", next: "", code: "", tokenHash: "", hasAccessToken: true, hasProviderToken: false }), false);
  assert.strictEqual(isGenericOauthCallback({ type: "recovery", next: "", code: "", tokenHash: "", hasAccessToken: true, hasProviderToken: true }), true);
  assert.strictEqual(isIntendedRecoveryLink({ type: "recovery", next: "", code: "", tokenHash: "", hasProviderToken: false, hashParams: new URLSearchParams("access_token=a&refresh_token=b"), params: new URLSearchParams() }), true);
  assert.strictEqual(isIntendedRecoveryLink({ type: "recovery", next: "", code: "", tokenHash: "", hasProviderToken: false, hashParams: new URLSearchParams("access_token=a"), params: new URLSearchParams() }), false);
  assert.strictEqual(isIntendedRecoveryLink({ type: "", next: "", code: "", tokenHash: "", hasProviderToken: false, hashParams: new URLSearchParams("access_token=a&refresh_token=b"), params: new URLSearchParams() }), false);
});

test("cross-device recovery uses verifyOtp and never PKCE code exchange", () => {
  const calls={verify:0,exchange:0};
  function establishRecoverySession(info,auth){
    if(!isIntendedRecoveryLink(info))return {session:null,error:null};
    if(info.tokenHash){
      calls.verify++;
      const result=auth.verifyOtp({token_hash:info.tokenHash,type:"recovery"});
      if(result.error)return {session:null,error:result.error};
      return {session:result.data&&result.data.session,error:null};
    }
    return {session:null,error:null};
  }
  const desktopVerifier={"supabase.auth.token-code-verifier":"desktop-only-verifier"};
  const phoneStorage={};
  assert.ok(!Object.prototype.hasOwnProperty.call(phoneStorage,"supabase.auth.token-code-verifier"));
  assert.ok(desktopVerifier["supabase.auth.token-code-verifier"]);
  const phoneAuth={
    verifyOtp({token_hash,type}){
      assert.strictEqual(type,"recovery");
      assert.ok(token_hash);
      assert.strictEqual(phoneStorage["supabase.auth.token-code-verifier"],undefined);
      return {data:{session:{user:{id:"u1"}}},error:null};
    },
    exchangeCodeForSession(){
      calls.exchange++;
      return {error:new Error("PKCE code verifier not found in storage")};
    }
  };
  const phoneOpens=establishRecoverySession(
    {type:"recovery",next:"account",code:"",tokenHash:"phone-opens-this-hash",hasProviderToken:false},
    phoneAuth
  );
  const desktopOpens=establishRecoverySession(
    {type:"recovery",next:"admin",code:"",tokenHash:"desktop-opens-this-hash",hasProviderToken:false},
    phoneAuth
  );
  const sameDevice=establishRecoverySession(
    {type:"recovery",next:"account",code:"",tokenHash:"same-device-hash",hasProviderToken:false},
    phoneAuth
  );
  assert.ok(phoneOpens.session);
  assert.ok(desktopOpens.session);
  assert.ok(sameDevice.session);
  assert.strictEqual(calls.verify,3);
  assert.strictEqual(calls.exchange,0);
  const expired=establishRecoverySession(
    {type:"recovery",next:"account",code:"",tokenHash:"expired-hash",hasProviderToken:false},
    {verifyOtp(){return {data:null,error:new Error("Token has expired or is invalid")}}}
  );
  assert.ok(expired.error);
  assert.match(String(expired.error.message),/expired|invalid/i);
  const recoveryCode={type:"recovery",next:"account",code:"pkce-recovery-code",tokenHash:"",hasProviderToken:false,hasAccessToken:false};
  assert.strictEqual(isGenericOauthCallback(recoveryCode),false);
  assert.strictEqual(isIntendedRecoveryLink(recoveryCode),false);
  const skippedPkce=establishRecoverySession(recoveryCode,{
    verifyOtp(){throw new Error("token_hash path should not run");},
    exchangeCodeForSession(){
      calls.exchange++;
      return {data:{session:{user:{id:"u1"}}},error:null};
    }
  });
  assert.strictEqual(skippedPkce.session,null);
  assert.strictEqual(calls.exchange,0);
  const missingType=establishRecoverySession(
    {type:"",next:"account",code:"",tokenHash:"no-type-hash",hasProviderToken:false},
    phoneAuth
  );
  assert.strictEqual(missingType.session,null);
  const oauthHash={type:"",next:"account",code:"",tokenHash:"",hasProviderToken:true,hasAccessToken:true};
  assert.strictEqual(isGenericOauthCallback(oauthHash),true);
  assert.strictEqual(isIntendedRecoveryLink(oauthHash),false);
});

if (failed) process.exit(1);
console.log("auth-oauth-recovery unit checks passed.");
