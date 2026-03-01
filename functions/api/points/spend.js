import {
  ApiError,
  getOrCreateWallet,
  insertTicketEvent,
  json,
  onOptions,
  requireAuthedUser,
  respondError,
  setPoints
} from "../../_lib/points.js";

export const onRequestOptions = () => onOptions();

export async function onRequestPost(context) {
  try {
    const user = await requireAuthedUser(context.request, context.env);
    const body = await context.request.json().catch(() => ({}));

    const cost = Number(body.cost);
    const game = String(body.game || "unknown").toLowerCase();

    if (!Number.isInteger(cost) || cost <= 0 || cost > 20) {
      throw new ApiError(400, "Invalid cost");
    }

    if (!/^[a-z0-9_-]{2,32}$/.test(game)) {
      throw new ApiError(400, "Invalid game key");
    }

    const wallet = await getOrCreateWallet(context.env, user);
    const points = Number(wallet.tickets || 0);

    if (points < cost) {
      throw new ApiError(409, "INSUFFICIENT_POINTS");
    }

    const nextPoints = points - cost;

    await setPoints(context.env, wallet.id, nextPoints);
    await insertTicketEvent(context.env, user, -cost, `play:${game}`, {
      source: "checkoutcoins",
      game,
      cost
    });

    return json({
      points: nextPoints,
      spent: cost,
      game
    });
  } catch (error) {
    return respondError(error);
  }
}
