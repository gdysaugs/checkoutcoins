const SUPABASE_URL = "https://tofpgoewiaczhnanharo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZnBnb2V3aWFjemhuYW5oYXJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0OTM3NDksImV4cCI6MjA4NzA2OTc0OX0.Jwy75KytdZGMrv7uKYYfR1HzIVnTSTQBTKTkRKv9dd4";

let supabaseClient = null;

window.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    renderFlash(error.message || "Initialization failed", true);
  });
});

async function init() {
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error("Supabase SDK failed to load.");
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const current = await supabaseClient.auth.getSession();
  if (current?.data?.session) {
    window.location.assign("/");
    return;
  }

  const form = document.getElementById("magicLinkForm");
  if (!form) return;

  form.addEventListener("submit", onSubmitMagicLink);
}

async function onSubmitMagicLink(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const emailInput = document.getElementById("emailInput");
  const sendBtn = document.getElementById("sendMagicBtn");
  const email = (emailInput?.value || "").trim();

  if (!email) {
    renderFlash("Please enter your email.", true);
    return;
  }

  setBusy(form, true);
  renderFlash("", false);

  try {
    const redirectTo = `${window.location.origin}/`;
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo
      }
    });

    if (error) throw error;

    renderFlash("Magic link sent. Please check your email inbox.", false);
    if (sendBtn) {
      sendBtn.textContent = "Sent";
    }
  } catch (error) {
    renderFlash(error.message || "Failed to send magic link.", true);
  } finally {
    setBusy(form, false);
  }
}

function setBusy(form, busy) {
  const controls = form.querySelectorAll("input, button");
  controls.forEach((node) => {
    node.disabled = busy;
  });
}

function renderFlash(message, isError) {
  const flash = document.getElementById("magicFlash");
  if (!flash) return;

  flash.textContent = message;
  if (!message) {
    flash.classList.add("hidden");
    flash.classList.remove("error");
    return;
  }

  flash.classList.remove("hidden");
  flash.classList.toggle("error", Boolean(isError));
}

