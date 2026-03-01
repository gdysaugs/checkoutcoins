import {
  getOrCreateWallet,
  json,
  onOptions,
  requireAuthedUser,
  respondError
} from "../../_lib/points.js";

export const onRequestOptions = () => onOptions();

export async function onRequestGet(context) {
  try {
    const user = await requireAuthedUser(context.request, context.env);
    const wallet = await getOrCreateWallet(context.env, user);

    return json({
      points: Number(wallet.tickets || 0),
      email: user.email,
      user_id: user.id
    });
  } catch (error) {
    return respondError(error);
  }
}
