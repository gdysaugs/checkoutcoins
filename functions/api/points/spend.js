import {
  ApiError,
  getOrCreateWallet,
  insertTicketEvent,
  json,
  onOptions,
  requireAuthedUser,
  respondError,
  spendPointsAtomic
} from "../../_lib/points.js";

export const onRequestOptions = () => onOptions();

const GAME_COSTS = Object.freeze({
  othello: 1,
  invader: 2,
  memory: 1
});

export async function onRequestPost(context) {
  try {
    const user = await requireAuthedUser(context.request, context.env);
    const body = await context.request.json().catch(() => ({}));

    const game = String(body.game || "unknown").toLowerCase();

    if (!Object.prototype.hasOwnProperty.call(GAME_COSTS, game)) {
      throw new ApiError(400, "Invalid game key");
    }

    const expectedCost = GAME_COSTS[game];
    if (body.cost !== undefined && Number(body.cost) !== expectedCost) {
      throw new ApiError(400, "COST_MISMATCH");
    }

    const wallet = await getOrCreateWallet(context.env, user);
    const nextPoints = await spendPointsAtomic(context.env, wallet.id, expectedCost);

    await insertTicketEvent(context.env, user, -expectedCost, `play:${game}`, {
      source: "checkoutcoins",
      game,
      cost: expectedCost
    });

    return json({
      points: nextPoints,
      spent: expectedCost,
      game
    });
  } catch (error) {
    return respondError(error);
  }
}
