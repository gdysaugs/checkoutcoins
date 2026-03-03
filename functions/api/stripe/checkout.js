import {
  ApiError,
  json,
  onOptions,
  requireAuthedUser,
  respondError
} from "../../_lib/points.js";

const PLAN_CONFIG = Object.freeze([
  { coins: 30, envKey: "STRIPE_PRICE_ID_30", label: "Starter 30" },
  { coins: 80, envKey: "STRIPE_PRICE_ID_80", label: "Plus 80" },
  { coins: 200, envKey: "STRIPE_PRICE_ID_200", label: "Pro 200" },
  { coins: 500, envKey: "STRIPE_PRICE_ID_500", label: "Mega 500" },
  { coins: 1200, envKey: "STRIPE_PRICE_ID_1200", label: "Ultra 1200" }
]);

const DEFAULT_APP_TAG = "checkoutcoins";

export const onRequestOptions = () => onOptions();

function requireEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new ApiError(500, `${name} is not set`);
  }
  return value;
}

function getOrigin(request) {
  const url = new URL(request.url);
  return url.origin;
}

function getSuccessUrl(env, request) {
  return (
    env.STRIPE_SUCCESS_URL ||
    `${getOrigin(request)}/purchase.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`
  );
}

function getCancelUrl(env, request) {
  return env.STRIPE_CANCEL_URL || `${getOrigin(request)}/purchase.html?checkout=cancel`;
}

function resolvePlan(env, coinsValue) {
  const coins = Number(coinsValue);
  if (!Number.isInteger(coins) || coins <= 0) {
    throw new ApiError(400, "Invalid plan");
  }

  const plan = PLAN_CONFIG.find((item) => item.coins === coins);
  if (!plan) {
    throw new ApiError(400, "Unknown plan");
  }

  const priceId = env[plan.envKey];
  if (!priceId) {
    throw new ApiError(400, "This plan is not available");
  }

  return { ...plan, priceId };
}

function listPlans(env) {
  return PLAN_CONFIG.map((plan) => ({
    coins: plan.coins,
    label: plan.label,
    enabled: Boolean(env[plan.envKey])
  }));
}

async function createCheckoutSession(env, user, plan, request) {
  const stripeKey = requireEnv(env, "STRIPE_SECRET_KEY");
  const successUrl = getSuccessUrl(env, request);
  const cancelUrl = getCancelUrl(env, request);

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  params.set("line_items[0][price]", plan.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("client_reference_id", user.id);
  params.set("customer_email", user.email);
  params.set("metadata[user_id]", user.id);
  params.set("metadata[email]", user.email);
  params.set("metadata[tickets]", String(plan.coins));
  params.set("metadata[price_id]", plan.priceId);
  params.set("metadata[plan_label]", plan.label);
  params.set("metadata[app]", DEFAULT_APP_TAG);

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  const bodyText = await stripeResponse.text();
  let body = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }

  if (!stripeResponse.ok) {
    const errorMessage = body?.error?.message || "Failed to create Stripe checkout session";
    throw new ApiError(500, errorMessage);
  }

  if (!body?.url) {
    throw new ApiError(500, "Stripe did not return checkout URL");
  }

  return body.url;
}

export async function onRequestGet(context) {
  try {
    return json({ plans: listPlans(context.env) });
  } catch (error) {
    return respondError(error);
  }
}

export async function onRequestPost(context) {
  try {
    const user = await requireAuthedUser(context.request, context.env);
    const payload = await context.request.json().catch(() => ({}));
    const plan = resolvePlan(context.env, payload.coins);
    const url = await createCheckoutSession(context.env, user, plan, context.request);
    return json({ url });
  } catch (error) {
    return respondError(error);
  }
}
