import {
  addPointsAtomic,
  ApiError,
  getOrCreateWallet,
  respondError
} from "../../_lib/points.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Stripe-Signature"
};

const SIGNATURE_TOLERANCE_SECONDS = 300;
const ACCEPTED_APP_TAG = "checkoutcoins";

function webhookJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
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
  const key = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

function supabaseUrl(env, path) {
  return `${requireEnv(env, "SUPABASE_URL")}${path}`;
}

async function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseStripeSignature(signatureHeader) {
  const parts = String(signatureHeader || "")
    .split(",")
    .map((item) => item.trim());

  const timestampPart = parts.find((item) => item.startsWith("t="));
  const signatures = parts
    .filter((item) => item.startsWith("v1="))
    .map((item) => item.slice(3))
    .filter(Boolean);

  if (!timestampPart || signatures.length === 0) {
    return { timestamp: 0, signatures: [] };
  }

  const timestamp = Number(timestampPart.slice(2));
  return { timestamp, signatures };
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret, payload) {
  const keyData = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signed))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyStripeSignature(body, signatureHeader, secret) {
  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  if (!Number.isFinite(timestamp) || !signatures.length) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const signedPayload = `${timestamp}.${body}`;
  const expected = await hmacSha256Hex(secret, signedPayload);
  return signatures.some((sig) => timingSafeEqualHex(sig, expected));
}

function extractCheckoutPayload(event) {
  if (!event || event.type !== "checkout.session.completed") {
    return null;
  }

  const session = event.data?.object || {};
  if (session.payment_status && session.payment_status !== "paid") {
    return null;
  }

  const metadata = session.metadata || {};
  const appTag = String(metadata.app || "");
  if (appTag !== ACCEPTED_APP_TAG) {
    return null;
  }

  const coins = Number(metadata.tickets || 0);
  const userId = String(metadata.user_id || session.client_reference_id || "");
  const email = String(metadata.email || session.customer_details?.email || "");
  const usageId = String(event.id || session.id || "");

  if (!Number.isInteger(coins) || coins <= 0 || !userId || !email || !usageId) {
    throw new ApiError(400, "Missing or invalid checkout metadata");
  }

  return {
    coins,
    userId,
    email,
    usageId,
    sessionId: String(session.id || ""),
    priceId: String(metadata.price_id || "")
  };
}

async function reservePurchaseEvent(env, checkout) {
  const response = await fetch(
    supabaseUrl(env, "/rest/v1/ticket_events?on_conflict=usage_id"),
    {
      method: "POST",
      headers: {
        ...serviceHeaders(env),
        Prefer: "resolution=ignore-duplicates,return=representation"
      },
      body: JSON.stringify({
        usage_id: checkout.usageId,
        email: checkout.email,
        user_id: checkout.userId,
        delta: 0,
        reason: "stripe_purchase_pending",
        metadata: {
          source: "checkoutcoins",
          session_id: checkout.sessionId || null,
          price_id: checkout.priceId || null,
          coins: checkout.coins,
          status: "pending"
        },
        created_at: new Date().toISOString()
      })
    }
  );

  const text = await response.text();
  const rows = await parseJsonSafe(text);

  if (!response.ok) {
    const message = text || String(response.status);
    if (message.includes("duplicate key value")) {
      return false;
    }
    throw new ApiError(500, `Supabase REST error: ${message}`);
  }

  return Array.isArray(rows) && rows.length > 0;
}

async function deletePendingReservation(env, usageId) {
  const response = await fetch(
    supabaseUrl(
      env,
      `/rest/v1/ticket_events?usage_id=eq.${encodeURIComponent(usageId)}&reason=eq.stripe_purchase_pending`
    ),
    {
      method: "DELETE",
      headers: serviceHeaders(env)
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(500, `Supabase REST error: ${text || response.status}`);
  }
}

async function completePurchaseEvent(env, checkout) {
  const response = await fetch(
    supabaseUrl(env, `/rest/v1/ticket_events?usage_id=eq.${encodeURIComponent(checkout.usageId)}`),
    {
      method: "PATCH",
      headers: {
        ...serviceHeaders(env),
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        delta: checkout.coins,
        reason: "stripe_purchase",
        metadata: {
          source: "checkoutcoins",
          session_id: checkout.sessionId || null,
          price_id: checkout.priceId || null,
          coins: checkout.coins,
          status: "completed"
        }
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(500, `Supabase REST error: ${text || response.status}`);
  }
}

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });

export async function onRequestPost(context) {
  try {
    const secret = requireEnv(context.env, "STRIPE_WEBHOOK_SECRET");
    const signatureHeader = context.request.headers.get("stripe-signature") || "";
    const body = await context.request.text();

    const valid = await verifyStripeSignature(body, signatureHeader, secret);
    if (!valid) {
      throw new ApiError(401, "Invalid signature");
    }

    const event = body ? JSON.parse(body) : null;
    const checkout = extractCheckoutPayload(event);
    if (!checkout) {
      return webhookJson({ received: true, ignored: true });
    }

    // Reserve the Stripe event id first so only one concurrent webhook can grant coins.
    const reserved = await reservePurchaseEvent(context.env, checkout);
    if (!reserved) {
      return webhookJson({ received: true, duplicate: true });
    }

    const user = { id: checkout.userId, email: checkout.email };
    const wallet = await getOrCreateWallet(context.env, user);

    let nextPoints;
    try {
      nextPoints = await addPointsAtomic(context.env, wallet.id, checkout.coins);
    } catch (error) {
      // Release reservation on failure so Stripe retries can safely retry granting.
      try {
        await deletePendingReservation(context.env, checkout.usageId);
      } catch {
        // Keep original error; reservation cleanup can be handled manually if needed.
      }
      throw error;
    }

    // Best effort: points are already granted at this point.
    try {
      await completePurchaseEvent(context.env, checkout);
    } catch {
      // Do not fail webhook after successful grant to avoid retry storms.
    }

    return webhookJson({
      received: true,
      granted: checkout.coins,
      points: nextPoints
    });
  } catch (error) {
    return respondError(error);
  }
}