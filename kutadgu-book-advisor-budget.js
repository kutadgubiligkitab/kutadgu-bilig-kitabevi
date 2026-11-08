"use strict";

/**
 * Server-owned GPT advisor spend ledger.
 * This is not the AI Search budget. Callers cannot pass a remaining balance.
 * reserve, settle, and release run one at a time. A database error fails closed.
 */

const crypto = require("node:crypto");

const DEFAULT_DAILY_MICRO_USD = 2000000;
const DEFAULT_MONTHLY_MICRO_USD = 20000000;
const DEFAULT_PER_MINUTE = 6;

function coded(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function dayKey(now) {
  return now.toISOString().slice(0, 10);
}

function monthKey(now) {
  return now.toISOString().slice(0, 7);
}

function createLedger(options) {
  const dailyLimit = Math.floor(Number(options && options.dailyLimitMicroUsd));
  const monthlyLimit = Math.floor(Number(options && options.monthlyLimitMicroUsd));
  const perMinute = Math.floor(Number(options && options.perMinute));
  if (!Number.isInteger(dailyLimit) || dailyLimit <= 0) throw coded("advisor_budget_unavailable");
  if (!Number.isInteger(monthlyLimit) || monthlyLimit <= 0) throw coded("advisor_budget_unavailable");
  if (!Number.isInteger(perMinute) || perMinute <= 0) throw coded("advisor_budget_unavailable");
  const state = {
    spentDay: new Map(),
    spentMonth: new Map(),
    reservedDay: new Map(),
    reservedMonth: new Map(),
    reservations: new Map(),
    clients: new Map(),
    chain: Promise.resolve()
  };

  function exclusive(work) {
    const run = state.chain.then(work, work);
    state.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  function amount(map, key) {
    return map.get(key) || 0;
  }

  return {
    limits: {
      dailyLimitMicroUsd: dailyLimit,
      monthlyLimitMicroUsd: monthlyLimit,
      perMinute
    },
    reserve(input) {
      return exclusive(() => {
        if (options && options.failStore) throw coded("advisor_budget_unavailable");
        const now = input && input.now instanceof Date ? input.now : null;
        const clientHash = String(input && input.clientHash || "");
        const microUsd = Math.floor(Number(input && input.microUsd));
        if (!now || Number.isNaN(now.getTime())) throw coded("advisor_budget_unavailable");
        if (!/^[a-f0-9]{64}$/.test(clientHash)) throw coded("advisor_budget_unavailable");
        if (!Number.isInteger(microUsd) || microUsd <= 0) throw coded("advisor_budget");
        const day = dayKey(now);
        const month = monthKey(now);
        const window = Math.floor(now.getTime() / 60000);
        const client = state.clients.get(clientHash) || { window, count: 0 };
        if (client.window !== window) {
          client.window = window;
          client.count = 0;
        }
        if (client.count >= perMinute) throw coded("advisor_rate_limit");
        const dayUsed = amount(state.spentDay, day) + amount(state.reservedDay, day);
        const monthUsed = amount(state.spentMonth, month) + amount(state.reservedMonth, month);
        if (dayUsed + microUsd > dailyLimit || monthUsed + microUsd > monthlyLimit) {
          throw coded("advisor_budget");
        }
        client.count += 1;
        state.clients.set(clientHash, client);
        state.reservedDay.set(day, amount(state.reservedDay, day) + microUsd);
        state.reservedMonth.set(month, amount(state.reservedMonth, month) + microUsd);
        const id = crypto.randomBytes(16).toString("hex");
        state.reservations.set(id, {
          microUsd,
          day,
          month,
          clientHash,
          state: "reserved"
        });
        return { id };
      });
    },
    settle(id, actualMicroUsd) {
      return exclusive(() => {
        if (options && options.failStore) throw coded("advisor_budget_unavailable");
        const row = state.reservations.get(String(id || ""));
        if (!row || row.state !== "reserved") throw coded("advisor_budget_unavailable");
        const actual = Math.floor(Number(actualMicroUsd));
        if (!Number.isInteger(actual) || actual < 0) throw coded("advisor_budget_unavailable");
        const applied = actual;
        state.reservedDay.set(row.day, amount(state.reservedDay, row.day) - row.microUsd);
        state.reservedMonth.set(row.month, amount(state.reservedMonth, row.month) - row.microUsd);
        state.spentDay.set(row.day, amount(state.spentDay, row.day) + applied);
        state.spentMonth.set(row.month, amount(state.spentMonth, row.month) + applied);
        row.state = "settled";
        row.actualMicroUsd = applied;
        return { actualMicroUsd: applied };
      });
    },
    release(id) {
      return exclusive(() => {
        if (options && options.failStore) throw coded("advisor_budget_unavailable");
        const row = state.reservations.get(String(id || ""));
        if (!row || row.state !== "reserved") throw coded("advisor_budget_unavailable");
        state.reservedDay.set(row.day, amount(state.reservedDay, row.day) - row.microUsd);
        state.reservedMonth.set(row.month, amount(state.reservedMonth, row.month) - row.microUsd);
        row.state = "released";
        return { releasedMicroUsd: row.microUsd };
      });
    },
    snapshot() {
      return exclusive(() => ({
        spentDay: Array.from(state.spentDay.entries()),
        reservedDay: Array.from(state.reservedDay.entries()),
        reservations: state.reservations.size
      }));
    }
  };
}

function createSessionStore() {
  const sessions = new Map();
  let chain = Promise.resolve();
  function exclusive(work) {
    const run = chain.then(work, work);
    chain = run.then(() => undefined, () => undefined);
    return run;
  }
  return {
    create(clientHash, bookIds) {
      return exclusive(() => {
        if (!/^[a-f0-9]{64}$/.test(String(clientHash || ""))) throw coded("advisor_unavailable");
        const id = crypto.randomBytes(16).toString("hex");
        sessions.set(id, {
          clientHash,
          bookIds: (Array.isArray(bookIds) ? bookIds : []).map(Number).filter((item) => Number.isInteger(item) && item > 0)
        });
        return id;
      });
    },
    read(id, clientHash) {
      return exclusive(() => {
        const row = sessions.get(String(id || ""));
        if (!row || row.clientHash !== clientHash) return [];
        return row.bookIds.slice();
      });
    },
    save(id, clientHash, bookIds) {
      return exclusive(() => {
        const row = sessions.get(String(id || ""));
        if (!row || row.clientHash !== clientHash) throw coded("advisor_unavailable");
        row.bookIds = (Array.isArray(bookIds) ? bookIds : []).map(Number).filter((item) => Number.isInteger(item) && item > 0);
        return row.bookIds.slice();
      });
    }
  };
}

function rpcError(payload, status) {
  const message = String(payload && (payload.message || payload.error || "") || "");
  if (message === "advisor_budget" || message === "advisor_rate_limit" || message === "advisor_budget_unavailable" || message === "advisor_unavailable") {
    return coded(message);
  }
  if (status === 401 || status === 403) return coded("advisor_budget_unavailable");
  return coded("advisor_budget_unavailable");
}

function createRpcStores(options) {
  const fetchImpl = options && options.fetchImpl;
  const supabaseUrl = String(options && options.supabaseUrl || "");
  const apiKey = String(options && options.apiKey || "");
  if (!fetchImpl || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(supabaseUrl) || !apiKey) {
    throw coded("advisor_unconfigured");
  }
  async function rpc(name, args) {
    const headers = {
      apikey: apiKey,
      Accept: "application/json",
      "Content-Type": "application/json"
    };
    if (!apiKey.startsWith("sb_" + "secret_")) headers.Authorization = "Bearer " + apiKey;
    let response;
    try {
      response = await fetchImpl(supabaseUrl + "/rest/v1/rpc/" + name, {
        method: "POST",
        headers,
        body: JSON.stringify(args || {})
      });
    } catch (_error) {
      throw coded("advisor_budget_unavailable");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw rpcError(payload, response.status);
    return payload;
  }
  return {
    ledger: {
      reserve(input) {
        return rpc("reserve_book_advisor_spend", {
          p_client_hash: input && input.clientHash,
          p_micro_usd: input && input.microUsd
        }).then((id) => {
          if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) throw coded("advisor_budget_unavailable");
          return { id: String(id) };
        });
      },
      settle(id, actualMicroUsd) {
        return rpc("settle_book_advisor_spend", {
          p_id: id,
          p_actual_micro_usd: actualMicroUsd
        }).then((actual) => ({ actualMicroUsd: Number(actual) }));
      },
      release(id) {
        return rpc("release_book_advisor_spend", { p_id: id }).then((released) => ({
          releasedMicroUsd: Number(released)
        }));
      }
    },
    sessions: {
      create(clientHashValue, bookIds) {
        return rpc("book_advisor_session_create", {
          p_client_hash: clientHashValue,
          p_book_ids: bookIds || []
        }).then((id) => {
          if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) throw coded("advisor_unavailable");
          return String(id);
        });
      },
      read(id, clientHashValue) {
        return rpc("book_advisor_session_read", {
          p_session_id: id,
          p_client_hash: clientHashValue
        }).then((ids) => (Array.isArray(ids) ? ids.map(Number) : []));
      },
      save(id, clientHashValue, bookIds) {
        return rpc("book_advisor_session_save", {
          p_session_id: id,
          p_client_hash: clientHashValue,
          p_book_ids: bookIds || []
        }).then((ids) => (Array.isArray(ids) ? ids.map(Number) : []));
      }
    }
  };
}

function isTrustedClientIp(value) {
  const ip = String(value || "").trim();
  const octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
  if (new RegExp("^" + octet + "(?:\\." + octet + "){3}$").test(ip)) return true;
  if (new RegExp("^::ffff:" + octet + "(?:\\." + octet + "){3}$", "i").test(ip)) return true;
  if (!ip.includes(":") || ip.length > 45 || ip.includes("%")) return false;
  return /^[0-9a-f:]+$/i.test(ip);
}

function clientHash(secret, ip) {
  const key = String(secret || "");
  const address = String(ip || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(key) || !isTrustedClientIp(address)) throw coded("advisor_unconfigured");
  return crypto.createHash("sha256").update(key + "|" + address).digest("hex");
}

function constraintPayload(state, binding) {
  const age = Number(state && state.age);
  const offer = state && (state.offer === "age" || state.offer === "genre") ? state.offer : "";
  const client = String(binding && binding.clientHash || "");
  const session = String(binding && binding.sessionId || "");
  const exp = Math.floor(Number(binding && binding.exp) || 0);
  return JSON.stringify({
    v: 2,
    age: Number.isInteger(age) && age >= 1 && age <= 16 ? age : null,
    strictAge: !!(state && state.strictAge),
    story: !!(state && state.story),
    offer,
    client,
    session,
    exp
  });
}

function signConstraintState(secret, state, binding) {
  const key = String(secret || "");
  const client = String(binding && binding.clientHash || "");
  const session = String(binding && binding.sessionId || "");
  const exp = Math.floor(Number(binding && binding.exp) || 0);
  if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}$/.test(client)) throw coded("advisor_unconfigured");
  if (!/^(?:[a-f0-9]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(session)) throw coded("advisor_unconfigured");
  if (!Number.isInteger(exp) || exp <= 0) throw coded("advisor_unconfigured");
  const body = Buffer.from(constraintPayload(state, binding), "utf8").toString("base64url");
  const mac = crypto.createHmac("sha256", key).update(body).digest("hex");
  return body + "." + mac;
}

function readConstraintState(secret, token, binding) {
  const key = String(secret || "");
  const parts = String(token || "").split(".");
  if (!/^[a-f0-9]{64}$/.test(key) || parts.length !== 2) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) return null;
  const expected = crypto.createHmac("sha256", key).update(parts[0]).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(parts[1], "utf8");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const now = Math.floor(((binding && binding.now) || new Date()).getTime() / 1000);
    const client = String(binding && binding.clientHash || "");
    const session = String(binding && binding.sessionId || "");
    if (parsed.v !== 2 || parsed.client !== client || parsed.session !== session) return null;
    if (!Number.isInteger(parsed.exp) || parsed.exp <= now) return null;
    return JSON.parse(constraintPayload(parsed, { clientHash: client, sessionId: session, exp: parsed.exp }));
  } catch (_error) {
    return null;
  }
}

module.exports = {
  DEFAULT_DAILY_MICRO_USD,
  DEFAULT_MONTHLY_MICRO_USD,
  DEFAULT_PER_MINUTE,
  createLedger,
  createSessionStore,
  createRpcStores,
  clientHash,
  isTrustedClientIp,
  signConstraintState,
  readConstraintState
};
