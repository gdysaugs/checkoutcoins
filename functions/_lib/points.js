const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export function onOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

function requireEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new ApiError(500, `${name} is not set`);
  }
  return value;
}

function serviceHeaders(env) {
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json"
  };
}

async function supabaseRest(env, path, init = {}) {
  const url = `${requireEnv(env, "SUPABASE_URL")}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...serviceHeaders(env),
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(500, `Supabase REST error: ${text || response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  return response.json();
}

export async function requireAuthedUser(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "Unauthorized");
  }

  const response = await fetch(`${requireEnv(env, "SUPABASE_URL")}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: env.SUPABASE_ANON_KEY || requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: authHeader
    }
  });

  if (!response.ok) {
    throw new ApiError(401, "Invalid auth token");
  }

  const user = await response.json();
  if (!user || !user.id || !user.email) {
    throw new ApiError(401, "Invalid user profile");
  }

  return {
    id: user.id,
    email: user.email
  };
}

async function fetchWalletByUserId(env, userId) {
  const query = `/rest/v1/user_tickets?select=id,email,user_id,tickets&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
  const rows = await supabaseRest(env, query, { method: "GET" });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchWalletByEmail(env, email) {
  const query = `/rest/v1/user_tickets?select=id,email,user_id,tickets&email=eq.${encodeURIComponent(email)}&limit=1`;
  const rows = await supabaseRest(env, query, { method: "GET" });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function patchWallet(env, walletId, body) {
  const rows = await supabaseRest(
    env,
    `/rest/v1/user_tickets?id=eq.${encodeURIComponent(walletId)}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify(body)
    }
  );

  if (!Array.isArray(rows) || !rows.length) {
    throw new ApiError(500, "Failed to update wallet");
  }

  return rows[0];
}

async function createWallet(env, user) {
  const rows = await supabaseRest(env, "/rest/v1/user_tickets", {
    method: "POST",
    headers: {
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      email: user.email,
      user_id: user.id,
      tickets: 5
    })
  });

  if (!Array.isArray(rows) || !rows.length) {
    throw new ApiError(500, "Failed to create wallet");
  }

  return rows[0];
}

export async function getOrCreateWallet(env, user) {
  let wallet = await fetchWalletByUserId(env, user.id);
  if (wallet) {
    return wallet;
  }

  wallet = await fetchWalletByEmail(env, user.email);
  if (wallet) {
    if (!wallet.user_id || wallet.user_id !== user.id) {
      wallet = await patchWallet(env, wallet.id, {
        user_id: user.id,
        updated_at: new Date().toISOString()
      });
    }
    return wallet;
  }

  try {
    return await createWallet(env, user);
  } catch (_error) {
    const retry = await fetchWalletByEmail(env, user.email);
    if (retry) {
      return retry;
    }
    throw _error;
  }
}

export async function setPoints(env, walletId, points) {
  return patchWallet(env, walletId, {
    tickets: points,
    updated_at: new Date().toISOString()
  });
}

async function fetchWalletPoints(env, walletId) {
  const query = `/rest/v1/user_tickets?select=id,tickets&id=eq.${encodeURIComponent(walletId)}&limit=1`;
  const rows = await supabaseRest(env, query, { method: "GET" });
  if (!Array.isArray(rows) || !rows.length) {
    throw new ApiError(404, "Wallet not found");
  }
  return rows[0];
}

/**
 * Atomically deducts points with optimistic concurrency control.
 * Retries when a concurrent request updated the same wallet first.
 */
export async function spendPointsAtomic(env, walletId, amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError(400, "Invalid amount");
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const wallet = await fetchWalletPoints(env, walletId);
    const current = Number(wallet.tickets || 0);

    if (current < amount) {
      throw new ApiError(409, "INSUFFICIENT_POINTS");
    }

    const next = current - amount;
    const updatedRows = await supabaseRest(
      env,
      `/rest/v1/user_tickets?id=eq.${encodeURIComponent(walletId)}&tickets=eq.${encodeURIComponent(current)}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          tickets: next,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (Array.isArray(updatedRows) && updatedRows.length) {
      return Number(updatedRows[0].tickets ?? next);
    }
    // No updated rows means another request won the race; retry.
  }

  throw new ApiError(409, "POINTS_UPDATE_CONFLICT");
}

export async function insertTicketEvent(env, user, delta, reason, metadata = {}) {
  await supabaseRest(env, "/rest/v1/ticket_events", {
    method: "POST",
    body: JSON.stringify({
      usage_id: `game:${crypto.randomUUID()}`,
      email: user.email,
      user_id: user.id,
      delta,
      reason,
      metadata,
      created_at: new Date().toISOString()
    })
  });
}

export function respondError(error) {
  if (error instanceof ApiError) {
    return json({ error: error.message }, error.status);
  }

  return json({ error: "Internal server error" }, 500);
}
