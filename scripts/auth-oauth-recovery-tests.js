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
      href: "https://www.kutadgubilig.com/",
      hostname: "www.kutadgubilig.com",
      origin: "https://www.kutadgubilig.com",
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
  assert.match(cfg, /window\.KUTADGU_SITE_ORIGIN = "https:\/\/www\.kutadgubilig\.com"/);
  assert.doesNotMatch(cfg, /KUTADGU_SITE_ORIGIN = "https:\/\/kutadgu-bilig-kitab\.vercel\.app"/);
  assert.match(member, /https:\/\/www\.kutadgubilig\.com\/reset-password\.html\?next=/);
  assert.match(admin, /https:\/\/www\.kutadgubilig\.com\/reset-password\.html\?next=admin/);
  assert.doesNotMatch(member, /kutadgu-bilig-kitab\.vercel\.app\/reset-password/);
  assert.doesNotMatch(admin, /kutadgu-bilig-kitab\.vercel\.app\/reset-password/);
});

test("password reset helper always uses www and next=account|admin", () => {
  const w = loadConfig();
  assert.strictEqual(w.KUTADGU_SITE_ORIGIN, "https://www.kutadgubilig.com");
  assert.strictEqual(
    w.kutadguPasswordResetRedirectTo("account"),
    "https://www.kutadgubilig.com/reset-password.html?next=account"
  );
  assert.strictEqual(
    w.kutadguPasswordResetRedirectTo("admin"),
    "https://www.kutadgubilig.com/reset-password.html?next=admin"
  );
  assert.strictEqual(
    w.kutadguPasswordResetRedirectTo(),
    "https://www.kutadgubilig.com/reset-password.html?next=account"
  );
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("?type=recovery", ""), true);
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("?code=abc", ""), false);
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("?code=abc&type=signup", ""), false);
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("", "#access_token=x&type=recovery"), true);
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("", "#access_token=x&token_type=bearer"), false);
  assert.strictEqual(w.kutadguIsGenericOauthHash("#access_token=x&token_type=bearer"), true);
  assert.strictEqual(w.kutadguIsGenericOauthHash("#access_token=x&type=recovery"), false);
  assert.strictEqual(w.kutadguIsGenericOauthHash("#access_token=x&provider_token=p"), true);
  assert.strictEqual(w.kutadguIsPasswordRecoveryType("", "#access_token=x&type=recovery&provider_token=p"), false);
});

test("Google OAuth redirectTo stays on the start origin except production hosts", () => {
  const www = loadConfig({
    hostname: "www.kutadgubilig.com",
    origin: "https://www.kutadgubilig.com"
  });
  assert.strictEqual(www.kutadguGoogleAccountRedirectTo(), "https://www.kutadgubilig.com/account.html");
  assert.ok(!www.kutadguGoogleAccountRedirectTo().includes("reset-password"));
  const apex = loadConfig({
    hostname: "kutadgubilig.com",
    origin: "https://kutadgubilig.com"
  });
  assert.strictEqual(apex.kutadguAuthCallbackOrigin(), "https://www.kutadgubilig.com");
  assert.strictEqual(apex.kutadguGoogleAccountRedirectTo(), "https://www.kutadgubilig.com/account.html");
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
  assert.strictEqual(prodVercel.kutadguGoogleAccountRedirectTo(), "https://www.kutadgubilig.com/account.html");
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
    "https://www.kutadgubilig.com/reset-password.html?next=account"
  );
});

test("homepage bounce only uses explicit type=recovery and skips OAuth hashes", () => {
  assert.match(index, /hp\.get\("access_token"\)&&type!=="recovery"\)return/);
  assert.match(index, /if\(type!=="recovery"\)return/);
  assert.doesNotMatch(index, /authOnHome/);
  assert.doesNotMatch(cfg, /authOnHome/);
  assert.match(cfg, /kutadguIsGenericOauthHash/);
  assert.match(cfg, /kutadguCanonicalizeApexAuthCallback/);
});

test("Google OAuth uses PKCE and same-origin account helper", () => {
  assert.match(member, /function googleAccountRedirectTo/);
  assert.match(member, /flowType:"pkce"/);
  assert.match(member, /signInWithOAuth\(\{provider:"google",options:\{redirectTo\}\}/);
  assert.match(account, /member\.js\?v=13/);
  assert.match(read("shop.js"), /member\.js\?v=13/);
  assert.match(index, /shop\.js\?v=70/);
});

test("reset page does not treat generic SIGNED_IN or hash OAuth as recovery", () => {
  assert.match(resetJs, /event==="PASSWORD_RECOVERY"/);
  assert.doesNotMatch(resetJs, /event==="PASSWORD_RECOVERY" \|\| event==="SIGNED_IN"/);
  assert.match(resetJs, /detectSessionInUrl:false/);
  assert.match(resetJs, /verifyOtp\(\{token_hash:info\.tokenHash,type:"recovery"\}\)/);
  assert.doesNotMatch(resetJs, /exchangeCodeForSession/);
  assert.match(resetJs, /if\(session && info\.tokenHash\)markRecoveryReady/);
  assert.match(resetJs, /isGenericOauthCallback/);
  assert.match(resetJs, /sendGenericOauthToAccount/);
  assert.doesNotMatch(resetJs, /console\.(log|info|debug|warn)\([^)]*access_token/);
  assert.doesNotMatch(resetJs, /console\.(log|info|debug|warn)\([^)]*token_hash/);
});

test("reset-password.html loads reset-password.js v=6", () => {
  assert.match(read("reset-password.html"), /reset-password\.js\?v=6/);
  assert.match(read("reset-password.html"), /supabase-config\.js\?v=12/);
  assert.match(account, /supabase-config\.js\?v=12/);
  assert.match(index, /supabase-config\.js\?v=12/);
  assert.match(read("admin.html"), /supabase-config\.js\?v=12/);
  assert.match(read("admin.html"), /admin\.js\?v=30/);
});

test("recovery email CTA documents TokenHash not ConfirmationURL PKCE", () => {
  assert.match(cfg, /\{\{ \.RedirectTo \}\}&token_hash=\{\{ \.TokenHash \}\}&type=recovery/);
  assert.match(cfg, /TokenHash/);
  assert.match(cfg, /\{\{\s*\.RedirectTo\s*\}\}&token_hash=\{\{\s*\.TokenHash\s*\}\}/);
});

function isExplicitRecoveryType(type){
  return type==="recovery";
}
function isIntendedRecoveryLink(info){
  if(info.hasProviderToken)return false;
  if(!info.tokenHash)return false;
  if(isExplicitRecoveryType(info.type))return true;
  if(info.next==="account"||info.next==="admin")return true;
  return false;
}
function isGenericOauthCallback(info){
  if(info.hasProviderToken)return true;
  if(info.hasAccessToken && !isExplicitRecoveryType(info.type))return true;
  if(info.code && !info.tokenHash)return true;
  return false;
}

test("recovery detection matches reset-password.js rules", () => {
  assert.match(resetJs, /function isIntendedRecoveryLink/);
  assert.strictEqual(isExplicitRecoveryType("recovery"), true);
  assert.strictEqual(isExplicitRecoveryType(""), false);
  assert.strictEqual(isIntendedRecoveryLink({ type: "recovery", next: "", code: "x", tokenHash: "", hasProviderToken: false }), false);
  assert.strictEqual(isIntendedRecoveryLink({ type: "recovery", next: "account", code: "", tokenHash: "th", hasProviderToken: false }), true);
  assert.strictEqual(isIntendedRecoveryLink({ type: "", next: "account", code: "x", tokenHash: "", hasProviderToken: false }), false);
  assert.strictEqual(isIntendedRecoveryLink({ type: "", next: "admin", code: "", tokenHash: "th", hasProviderToken: false }), true);
  assert.strictEqual(isIntendedRecoveryLink({ type: "", next: "", code: "oauth-code", tokenHash: "", hasProviderToken: false }), false);
  assert.strictEqual(isGenericOauthCallback({ type: "", next: "", code: "oauth-code", tokenHash: "", hasAccessToken: false, hasProviderToken: false }), true);
  assert.strictEqual(isGenericOauthCallback({ type: "", next: "account", code: "x", tokenHash: "", hasAccessToken: false, hasProviderToken: false }), true);
  assert.strictEqual(isGenericOauthCallback({ type: "recovery", next: "account", code: "", tokenHash: "th", hasAccessToken: false, hasProviderToken: false }), false);
  assert.strictEqual(isGenericOauthCallback({ type: "", next: "", code: "", tokenHash: "", hasAccessToken: true, hasProviderToken: false }), true);
  assert.strictEqual(isGenericOauthCallback({ type: "recovery", next: "", code: "", tokenHash: "", hasAccessToken: true, hasProviderToken: false }), false);
  assert.strictEqual(isGenericOauthCallback({ type: "recovery", next: "", code: "", tokenHash: "", hasAccessToken: true, hasProviderToken: true }), true);
  assert.strictEqual(isIntendedRecoveryLink({ type: "recovery", next: "", code: "", tokenHash: "", hasProviderToken: true }), false);
});

test("cross-device recovery uses verifyOtp and never PKCE code exchange", () => {
  const calls={verify:0,exchange:0};
  function establishRecoverySession(info,auth){
    if(!info.tokenHash)return {session:null,error:null};
    if(!isIntendedRecoveryLink(info))return {session:null,error:null};
    calls.verify++;
    const result=auth.verifyOtp({token_hash:info.tokenHash,type:"recovery"});
    if(result.error)return {session:null,error:result.error};
    return {session:result.data&&result.data.session,error:null};
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
  const oauth={type:"",next:"account",code:"oauth-code",tokenHash:"",hasProviderToken:false,hasAccessToken:false};
  assert.strictEqual(isGenericOauthCallback(oauth),true);
  assert.strictEqual(isIntendedRecoveryLink(oauth),false);
});

if (failed) process.exit(1);
console.log("auth-oauth-recovery unit checks passed.");
