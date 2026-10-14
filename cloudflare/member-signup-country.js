"use strict";

const visitCountry = require("./analytics-visit-country.js");

const SUPABASE_URL = "https://fxlojnqwyojqjskfggmh.supabase.co";
const PUBLIC_KEY = "sb_publishable_lqxWeLH9m7hGbPMUfVY0pA_bdcK-PzE";
const MAX_BODY_BYTES = 4096;
const SIGNUP_WINDOW_MS = 3 * 60 * 1000;
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function emptyResult(status) {
  return {
    status,
    body: "",
    contentType: "application/json; charset=utf-8"
  };
}

function nowMs(deps) {
  if (deps && typeof deps.now === "function") return Number(deps.now());
  return Date.now();
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
  const fullName = typeof parsed.full_name === "string" ? parsed.full_name.trim().slice(0, 120) : "";
  if (!email || email.length > 320 || !password || password.length > 200) return null;
  return { email, password, fullName };
}

function scrubSecret(text, secret) {
  const body = String(text || "");
  const hidden = String(secret || "");
  if (hidden.length < 8 || body.indexOf(hidden) === -1) return body;
  return body.split(hidden).join("");
}

function recent(createdAt, now) {
  const created = Date.parse(createdAt || "");
  if (!Number.isFinite(created)) return false;
  const delta = now - created;
  return delta >= -CLOCK_SKEW_MS && delta <= SIGNUP_WINDOW_MS;
}

function freshEmailUserId(user, now) {
  if (!user || typeof user !== "object") return "";
  const id = String(user.id || "").trim().toLowerCase();
  if (!UUID_RE.test(id)) return "";
  if (!Array.isArray(user.identities) || user.identities.length === 0) return "";
  const emailIdentity = user.identities.some((item) => {
    const provider = String(item && item.provider || "").toLowerCase();
    const owner = String(item && item.user_id || "").trim().toLowerCase();
    return provider === "email" && (!owner || owner === id);
  });
  if (!emailIdentity) return "";
  if (!recent(user.created_at, now)) return "";
  return id;
}

function freshGoogleUserId(user, now) {
  if (!user || typeof user !== "object") return "";
  const id = String(user.id || "").trim().toLowerCase();
  if (!UUID_RE.test(id)) return "";
  if (!Array.isArray(user.identities) || user.identities.length === 0) return "";
  const providers = user.identities.map((item) => String(item && item.provider || "").toLowerCase());
  if (providers.indexOf("google") === -1 || providers.indexOf("email") !== -1) return "";
  const bound = user.identities.some((item) => {
    if (String(item && item.provider || "").toLowerCase() !== "google") return false;
    const owner = String(item && item.user_id || "").trim().toLowerCase();
    return !owner || owner === id;
  });
  if (!bound) return "";
  if (!recent(user.created_at, now)) return "";
  return id;
}

function serverKey(env) {
  return String((env && env.SUPABASE_SECRET_KEY) || "").trim();
}

async function recordCountry(env, fetchImpl, userId, country) {
  const key = serverKey(env);
  if (!key || !userId || !country) return;
  await fetchImpl(SUPABASE_URL + "/rest/v1/rpc/record_member_signup_country", {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ p_user_id: userId, p_country: country })
  });
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
  const redirect = accountRedirect(request);
  let response;
  try {
    response = await fetchImpl(SUPABASE_URL + "/auth/v1/signup?redirect_to=" + encodeURIComponent(redirect), {
      method: "POST",
      headers: {
        apikey: PUBLIC_KEY,
        Authorization: "Bearer " + PUBLIC_KEY,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: fields.email,
        password: fields.password,
        data: { full_name: fields.fullName }
      })
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
  if (status >= 200 && status < 300 && payload && payload.user) {
    const userId = freshEmailUserId(payload.user, nowMs(deps));
    const country = trustedCountry(request);
    if (userId && country) {
      try {
        await recordCountry(env, fetchImpl, userId, country);
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

async function handleMemberSignupCountry(request, env, deps) {
  const method = String((request && request.method) || "GET").toUpperCase();
  if (method !== "POST") return emptyResult(405);
  const limited = await readBoundedBody(request);
  if (!limited.ok) return emptyResult(limited.status || 413);
  const header = headerValue(request, "authorization");
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match || match[1].length < 20 || match[1].length > 8192) return emptyResult(401);
  const fetchImpl = deps && deps.fetchImpl;
  if (typeof fetchImpl !== "function" || !serverKey(env)) return emptyResult(503);
  const country = trustedCountry(request);
  if (!country) return emptyResult(204);
  let response;
  try {
    response = await fetchImpl(SUPABASE_URL + "/auth/v1/user", {
      method: "GET",
      headers: {
        apikey: PUBLIC_KEY,
        Authorization: "Bearer " + match[1],
        Accept: "application/json"
      }
    });
  } catch (err) {
    return emptyResult(503);
  }
  if (!response || response.status < 200 || response.status >= 300) return emptyResult(401);
  let user = null;
  try {
    user = JSON.parse(typeof response.text === "function" ? await response.text() : "");
  } catch (err) {
    user = null;
  }
  const userId = freshGoogleUserId(user, nowMs(deps));
  if (!userId) return emptyResult(204);
  try {
    await recordCountry(env, fetchImpl, userId, country);
  } catch (err) {
    return emptyResult(204);
  }
  return emptyResult(204);
}

module.exports = {
  SUPABASE_URL,
  MAX_BODY_BYTES,
  SIGNUP_WINDOW_MS,
  accountRedirect,
  signupFields,
  freshEmailUserId,
  freshGoogleUserId,
  handleMemberSignup,
  handleMemberSignupCountry
};
