"use strict";

const crypto = require("crypto");
const visitCountry = require("./analytics-visit-country.js");

const SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const PUBLIC_KEY = "sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE";
const MAX_BODY_BYTES = 4096;
const RECORD_TIMEOUT_MS = 1500;
const SAME_INSERT_MS = 2000;
const NONCE_KEY = "kutadgu_signup_nonce";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NONCE_RE = /^[0-9a-f]{64}$/;
const CHALLENGE_RE = /^[A-Za-z0-9._~-]{43,128}$/;

function emptyResult(status) {
  return {
    status,
    body: "",
    contentType: "application/json; charset=utf-8"
  };
}

function trustedCountry(request) {
  return visitCountry.trustedCountry(request && request.cf);
}

async function readBoundedBody(request) {
  const declared = Number(request && request.headers && request.headers.get && request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, status: 413 };
  if (!request || typeof request.text !== "function") return { ok: true, body: "" };
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return { ok: false, status: 413 };
  return { ok: true, body };
}

function headerValue(request, name) {
  if (!request || !request.headers || typeof request.headers.get !== "function") return "";
  return String(request.headers.get(name) || "");
}

function accountRedirect(request) {
  let url;
  try {
    url = new URL(request && request.url ? request.url : "https://www.kutadgubilik.com/api/member-signup");
  } catch (err) {
    return "https://www.kutadgubilik.com/account.html";
  }
  const host = String(url.hostname || "").toLowerCase().replace(/\.$/, "");
  if (host === "www.kutadgubilik.com" || host === "kutadgubilik.com") {
    return "https://www.kutadgubilik.com/account.html";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "https://www.kutadgubilik.com/account.html";
  }
  return url.origin + "/account.html";
}

function requestedRedirect(request) {
  const fallback = accountRedirect(request);
  let requestUrl;
  try {
    requestUrl = new URL(request && request.url ? request.url : "https://www.kutadgubilik.com/api/member-signup");
  } catch (err) {
    return fallback;
  }
  const raw = requestUrl.searchParams.get("redirect_to");
  if (!raw) return fallback;
  let target;
  try {
    target = new URL(raw);
  } catch (err) {
    return fallback;
  }
  if (target.username || target.password) return fallback;
  if (target.pathname !== "/account.html" || target.search || target.hash) return fallback;
  if (target.protocol !== "https:" && target.protocol !== "http:") return fallback;
  const host = String(target.hostname || "").toLowerCase().replace(/\.$/, "");
  if (host === "www.kutadgubilik.com" || host === "kutadgubilik.com") {
    return "https://www.kutadgubilik.com/account.html";
  }
  if (target.origin !== requestUrl.origin) return fallback;
  return target.origin + "/account.html";
}

function captchaToken(parsed) {
  const meta = parsed && parsed.gotrue_meta_security;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return { ok: true, token: "" };
  if (!Object.prototype.hasOwnProperty.call(meta, "captcha_token")) return { ok: true, token: "" };
  const token = meta.captcha_token;
  if (token == null || token === "") return { ok: true, token: "" };
  if (typeof token !== "string" || token.length > 2048) return { ok: false, token: "" };
  return { ok: true, token };
}

function signupFields(text) {
  let parsed;
  try {
    parsed = JSON.parse(text || "");
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
  const password = typeof parsed.password === "string" ? parsed.password : "";
  const data = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : {};
  const fullName = typeof data.full_name === "string" ? data.full_name.trim().slice(0, 120) : "";
  if (!email || email.length > 320 || !password || password.length > 200) return null;
  const method = String(parsed.code_challenge_method || "").toLowerCase();
  const challenge = parsed.code_challenge;
  if ((method !== "s256" && method !== "plain") || typeof challenge !== "string" || !CHALLENGE_RE.test(challenge)) return null;
  const captcha = captchaToken(parsed);
  if (!captcha.ok) return null;
  return {
    email,
    password,
    fullName,
    codeChallenge: challenge,
    codeChallengeMethod: method,
    captcha: captcha.token
  };
}

function scrubSecret(text, secret) {
  const body = String(text || "");
  const hidden = String(secret || "");
  if (hidden.length < 8 || body.indexOf(hidden) === -1) return body;
  return body.split(hidden).join("");
}

function creationNonce() {
  return crypto.randomBytes(32).toString("hex");
}

function markerValue(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return "";
  const value = source[NONCE_KEY];
  return typeof value === "string" && NONCE_RE.test(value) ? value : "";
}

function emailIdentity(user, id) {
  if (!user || !Array.isArray(user.identities)) return null;
  return user.identities.find((item) => {
    const provider = String(item && item.provider || "").toLowerCase();
    const owner = String(item && item.user_id || "").trim().toLowerCase();
    return provider === "email" && owner === id;
  }) || null;
}

function signupUser(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.user && typeof payload.user === "object" && !Array.isArray(payload.user)) return payload.user;
  if (payload.access_token || payload.refresh_token) return null;
  if (typeof payload.id === "string" && payload.id) return payload;
  return null;
}

function freshEmailUserId(user, nonce) {
  if (!user || typeof user !== "object" || !NONCE_RE.test(String(nonce || ""))) return "";
  const id = String(user.id || "").trim().toLowerCase();
  if (!UUID_RE.test(id)) return "";
  const identity = emailIdentity(user, id);
  if (!identity) return "";
  if (markerValue(user.user_metadata) !== nonce || markerValue(identity.identity_data) !== nonce) return "";
  const userCreated = Date.parse(user.created_at || "");
  const identityCreated = Date.parse(identity.created_at || "");
  if (!Number.isFinite(userCreated) || !Number.isFinite(identityCreated)) return "";
  if (Math.abs(userCreated - identityCreated) > SAME_INSERT_MS) return "";
  return id;
}

function connectingIp(request) {
  const value = headerValue(request, "cf-connecting-ip").trim();
  if (!value || value.length > 64) return "";
  if (!/^[0-9A-Fa-f:.]+$/.test(value)) return "";
  return value;
}

function serverKey(env) {
  return String((env && env.SUPABASE_SECRET_KEY) || "").trim();
}

async function recordCountry(env, fetchImpl, userId, country, nonce) {
  const key = serverKey(env);
  if (!key || !userId || !country || !NONCE_RE.test(String(nonce || ""))) return;
  await fetchImpl(SUPABASE_URL + "/rest/v1/rpc/record_member_signup_country", {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ p_user_id: userId, p_country: country, p_nonce: nonce })
  });
}

async function recordCountryLimited(env, fetchImpl, userId, country, nonce) {
  let timer;
  const pending = recordCountry(env, fetchImpl, userId, country, nonce).then(
    () => null,
    (err) => err
  );
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(new Error("signup-country-timeout")), RECORD_TIMEOUT_MS);
  });
  await Promise.race([pending, timeout]);
  clearTimeout(timer);
}

async function handleMemberSignup(request, env, deps) {
  const method = String((request && request.method) || "GET").toUpperCase();
  if (method !== "POST") return emptyResult(405);
  const limited = await readBoundedBody(request);
  if (!limited.ok) return emptyResult(limited.status || 413);
  const fields = signupFields(limited.body);
  if (!fields) return emptyResult(400);
  const fetchImpl = deps && deps.fetchImpl;
  if (typeof fetchImpl !== "function") return emptyResult(503);
  const redirect = requestedRedirect(request);
  const nonce = creationNonce();
  const upstream = {
    email: fields.email,
    password: fields.password,
    data: { full_name: fields.fullName, [NONCE_KEY]: nonce },
    code_challenge: fields.codeChallenge,
    code_challenge_method: fields.codeChallengeMethod
  };
  if (fields.captcha) upstream.gotrue_meta_security = { captcha_token: fields.captcha };
  const headers = {
    apikey: PUBLIC_KEY,
    Authorization: "Bearer " + PUBLIC_KEY,
    Accept: "application/json",
    "Content-Type": "application/json"
  };
  const ip = connectingIp(request);
  if (ip) {
    headers["X-Forwarded-For"] = ip;
    headers["X-Real-IP"] = ip;
  }
  let response;
  try {
    response = await fetchImpl(SUPABASE_URL + "/auth/v1/signup?redirect_to=" + encodeURIComponent(redirect), {
      method: "POST",
      headers,
      body: JSON.stringify(upstream)
    });
  } catch (err) {
    return emptyResult(503);
  }
  const text = scrubSecret(typeof response.text === "function" ? await response.text() : "", fields.password);
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    payload = null;
  }
  const status = Number(response.status) || 502;
  if (status >= 200 && status < 300) {
    const userId = freshEmailUserId(signupUser(payload), nonce);
    const country = trustedCountry(request);
    if (userId && country) {
      try {
        await recordCountryLimited(env, fetchImpl, userId, country, nonce);
      } catch (err) {
        /* The account exists. A missed country stays Unknown. */
      }
    }
  }
  return {
    status,
    body: text,
    contentType: "application/json; charset=utf-8"
  };
}

module.exports = {
  SUPABASE_URL,
  MAX_BODY_BYTES,
  NONCE_KEY,
  SAME_INSERT_MS,
  RECORD_TIMEOUT_MS,
  accountRedirect,
  requestedRedirect,
  signupFields,
  signupUser,
  freshEmailUserId,
  handleMemberSignup
};
