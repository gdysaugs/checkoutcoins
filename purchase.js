const SUPABASE_URL = "https://tofpgoewiaczhnanharo.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZnBnb2V3aWFjemhuYW5oYXJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0OTM3NDksImV4cCI6MjA4NzA2OTc0OX0.Jwy75KytdZGMrv7uKYYfR1HzIVnTSTQBTKTkRKv9dd4";
const OAUTH_REDIRECT_URL = "https://checkoutcoins.uk/purchase.html";
const PLAN_ORDER = [30, 80, 200, 500, 1200];
const SUPABASE_PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

let supabaseClient = null;
let currentSession = null;
let availablePlans = [];

const ui = {};

function clearSupabaseLocalSession() {
  const prefixes = [`sb-${SUPABASE_PROJECT_REF}-`, "supabase.auth.token"];
  const storages = [window.localStorage, window.sessionStorage];

  for (const storage of storages) {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      storage.removeItem(key);
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    showFlash(error.message || "初期化に失敗しました", true);
  });
});

async function init() {
  cacheDom();
  bindEvents();

  if (!window.supabase || !window.supabase.createClient) {
    throw new Error("Supabase SDKの読み込みに失敗しました");
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data } = await supabaseClient.auth.getSession();
  currentSession = data.session;
  await loadPlans();
  applyAuthState();
  applyCheckoutResult();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;
    applyAuthState();
  });
}

function cacheDom() {
  ui.authSection = document.getElementById("authSection");
  ui.walletSection = document.getElementById("walletSection");
  ui.googleLoginBtn = document.getElementById("googleLoginBtn");
  ui.refreshBtn = document.getElementById("refreshBtn");
  ui.logoutBtn = document.getElementById("logoutBtn");
  ui.userEmail = document.getElementById("userEmail");
  ui.pointCount = document.getElementById("pointCount");
  ui.planGrid = document.getElementById("planGrid");
  ui.flash = document.getElementById("flash");
}

function bindEvents() {
  ui.googleLoginBtn.addEventListener("click", onGoogleLogin);
  ui.refreshBtn.addEventListener("click", refreshPoints);
  ui.logoutBtn.addEventListener("click", onLogout);
}

async function loadPlans() {
  const response = await fetch("/api/stripe/checkout", { method: "GET" });
  const payload = await response.json().catch(() => ({ plans: [] }));
  if (!response.ok) {
    throw new Error(payload.error || "プラン取得に失敗しました");
  }

  const normalized = Array.isArray(payload.plans) ? payload.plans : [];
  availablePlans = PLAN_ORDER.map((coins) => {
    const hit = normalized.find((item) => Number(item.coins) === coins);
    return {
      coins,
      label: hit?.label || `${coins} Coins`,
      enabled: Boolean(hit?.enabled)
    };
  });
  renderPlans();
}

function renderPlans() {
  ui.planGrid.innerHTML = "";

  availablePlans.forEach((plan) => {
    const card = document.createElement("article");
    card.className = "plan-card";

    const title = document.createElement("h3");
    title.textContent = `${plan.coins} コイン`;
    card.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "muted";
    desc.textContent = plan.label;
    card.appendChild(desc);

    const btn = document.createElement("button");
    btn.className = "primary-btn";
    btn.type = "button";
    btn.textContent = plan.enabled ? "購入する" : "未設定";
    btn.disabled = !plan.enabled;
    btn.addEventListener("click", () => startCheckout(plan.coins, btn));
    card.appendChild(btn);

    ui.planGrid.appendChild(card);
  });
}

async function onGoogleLogin() {
  clearFlash();
  ui.googleLoginBtn.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: OAUTH_REDIRECT_URL }
    });
    if (error) throw error;
  } catch (error) {
    showFlash(error.message || "Googleログインに失敗しました", true);
    ui.googleLoginBtn.disabled = false;
  }
}

async function onLogout() {
  clearFlash();
  clearSupabaseLocalSession();
  currentSession = null;
  applyAuthState();
  showFlash("ログアウトしました");
}

function applyAuthState() {
  const signedIn = Boolean(currentSession);
  ui.authSection.classList.toggle("hidden", signedIn);
  ui.walletSection.classList.toggle("hidden", !signedIn);

  if (!signedIn) {
    ui.userEmail.textContent = "-";
    ui.pointCount.textContent = "0";
    return;
  }

  ui.userEmail.textContent = currentSession.user.email || "-";
  refreshPoints().catch((error) => {
    showFlash(error.message || "保有コイン取得に失敗しました", true);
  });
}

function applyCheckoutResult() {
  const url = new URL(window.location.href);
  const checkout = url.searchParams.get("checkout");
  if (!checkout) return;

  if (checkout === "success") {
    showFlash("購入が完了しました。コイン残高を更新します。");
    refreshPoints().catch(() => {});
  } else if (checkout === "cancel") {
    showFlash("購入をキャンセルしました。", true);
  }

  url.searchParams.delete("checkout");
  url.searchParams.delete("session_id");
  window.history.replaceState({}, document.title, url.toString());
}

async function refreshPoints() {
  if (!currentSession) return;
  const response = await fetch("/api/points/status", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${currentSession.access_token}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "ポイント取得に失敗しました");
  }
  ui.pointCount.textContent = String(Number(payload.points || 0));
}

async function startCheckout(coins, button) {
  clearFlash();
  if (!currentSession) {
    showFlash("先にログインしてください", true);
    return;
  }

  button.disabled = true;
  const previousText = button.textContent;
  button.textContent = "遷移中...";

  try {
    const response = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentSession.access_token}`
      },
      body: JSON.stringify({ coins })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "決済ページ作成に失敗しました");
    }
    if (!payload.url) {
      throw new Error("決済URLが取得できませんでした");
    }
    window.location.assign(payload.url);
  } catch (error) {
    button.disabled = false;
    button.textContent = previousText;
    showFlash(error.message || "購入開始に失敗しました", true);
  }
}

function showFlash(message, isError = false) {
  ui.flash.textContent = message;
  ui.flash.classList.remove("hidden");
  ui.flash.classList.toggle("error", isError);
}

function clearFlash() {
  ui.flash.textContent = "";
  ui.flash.classList.add("hidden");
  ui.flash.classList.remove("error");
}
