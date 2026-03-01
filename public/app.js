const SUPABASE_URL = "https://tofpgoewiaczhnanharo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZnBnb2V3aWFjemhuYW5oYXJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0OTM3NDksImV4cCI6MjA4NzA2OTc0OX0.Jwy75KytdZGMrv7uKYYfR1HzIVnTSTQBTKTkRKv9dd4";

const GAME_META = {
  othello: { title: "Othello", cost: 1 },
  invader: { title: "Invader Rush", cost: 2 },
  memory: { title: "Memory Match", cost: 1 }
};

let supabaseClient = null;
let currentSession = null;
let currentPoints = 0;
let activeCleanup = null;

const ui = {};

window.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    showFlash(error.message || "Initialization failed", true);
  });
});

async function init() {
  cacheDom();
  bindEvents();

  if (!window.supabase || !window.supabase.createClient) {
    throw new Error("Supabase SDK failed to load.");
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const sessionResponse = await supabaseClient.auth.getSession();
  currentSession = sessionResponse.data.session;
  applyAuthState();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;
    applyAuthState();
  });
}

function cacheDom() {
  ui.authSection = document.getElementById("authSection");
  ui.appSection = document.getElementById("appSection");
  ui.loginForm = document.getElementById("loginForm");
  ui.registerForm = document.getElementById("registerForm");
  ui.loginEmail = document.getElementById("loginEmail");
  ui.loginPassword = document.getElementById("loginPassword");
  ui.registerEmail = document.getElementById("registerEmail");
  ui.registerPassword = document.getElementById("registerPassword");
  ui.userEmail = document.getElementById("userEmail");
  ui.pointCount = document.getElementById("pointCount");
  ui.refreshPointsBtn = document.getElementById("refreshPointsBtn");
  ui.logoutBtn = document.getElementById("logoutBtn");
  ui.flash = document.getElementById("flash");
  ui.playButtons = document.querySelectorAll(".play-btn");
  ui.gameModal = document.getElementById("gameModal");
  ui.modalTitle = document.getElementById("modalTitle");
  ui.modalBody = document.getElementById("modalBody");
  ui.closeModalBtn = document.getElementById("closeModalBtn");
}

function bindEvents() {
  ui.loginForm.addEventListener("submit", onLogin);
  ui.registerForm.addEventListener("submit", onRegister);
  ui.refreshPointsBtn.addEventListener("click", refreshPoints);
  ui.logoutBtn.addEventListener("click", onLogout);
  ui.closeModalBtn.addEventListener("click", closeModal);
  ui.gameModal.addEventListener("click", (event) => {
    if (event.target === ui.gameModal) {
      closeModal();
    }
  });

  ui.playButtons.forEach((button) => {
    button.addEventListener("click", () => {
      handlePlay(button).catch((error) => {
        showFlash(error.message || "Failed to start game", true);
      });
    });
  });
}

async function onLogin(event) {
  event.preventDefault();
  setFormBusy(ui.loginForm, true);
  clearFlash();
  try {
    const email = ui.loginEmail.value.trim();
    const password = ui.loginPassword.value;

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;

    ui.loginForm.reset();
    showFlash("Login successful.");
  } catch (error) {
    showFlash(error.message || "Login failed", true);
  } finally {
    setFormBusy(ui.loginForm, false);
  }
}

async function onRegister(event) {
  event.preventDefault();
  setFormBusy(ui.registerForm, true);
  clearFlash();
  try {
    const email = ui.registerEmail.value.trim();
    const password = ui.registerPassword.value;

    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) throw error;

    ui.registerForm.reset();

    if (!data.session) {
      showFlash("Registration completed. Please check your email for confirmation.");
    } else {
      showFlash("Account created and signed in.");
    }
  } catch (error) {
    showFlash(error.message || "Registration failed", true);
  } finally {
    setFormBusy(ui.registerForm, false);
  }
}

async function onLogout() {
  clearFlash();
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    showFlash(error.message || "Logout failed", true);
    return;
  }
  closeModal();
  showFlash("Logged out.");
}

async function refreshPoints() {
  try {
    await loadPoints();
    showFlash("Point balance refreshed.");
  } catch (error) {
    showFlash(error.message || "Failed to refresh points", true);
  }
}

function applyAuthState() {
  const isSignedIn = Boolean(currentSession);
  ui.authSection.classList.toggle("hidden", isSignedIn);
  ui.appSection.classList.toggle("hidden", !isSignedIn);

  if (!isSignedIn) {
    ui.userEmail.textContent = "-";
    currentPoints = 0;
    ui.pointCount.textContent = "0";
    closeModal();
    return;
  }

  ui.userEmail.textContent = currentSession.user.email || "unknown";
  loadPoints().catch((error) => {
    showFlash(error.message || "Failed to load points", true);
  });
}

async function handlePlay(button) {
  clearFlash();

  if (!currentSession) {
    throw new Error("Please login first.");
  }

  const gameKey = button.dataset.game;
  const cost = Number(button.dataset.cost || 0);

  if (!GAME_META[gameKey]) {
    throw new Error("Unknown game selected.");
  }

  button.disabled = true;
  try {
    const spendResponse = await callApi("/api/points/spend", {
      method: "POST",
      body: JSON.stringify({ game: gameKey, cost })
    });

    currentPoints = spendResponse.points;
    ui.pointCount.textContent = String(currentPoints);

    showFlash("Points used successfully. Game started.");
    openGame(gameKey);
  } finally {
    button.disabled = false;
  }
}

async function loadPoints() {
  const status = await callApi("/api/points/status", { method: "GET" });
  currentPoints = status.points;
  ui.pointCount.textContent = String(currentPoints);
}

async function callApi(path, init) {
  const session = (await supabaseClient.auth.getSession()).data.session;
  if (!session) {
    throw new Error("Not authenticated.");
  }

  const headers = {
    Authorization: `Bearer ${session.access_token}`
  };

  if (init.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload.error || payload.message || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

function openGame(gameKey) {
  closeModal();
  ui.gameModal.classList.remove("hidden");
  ui.gameModal.setAttribute("aria-hidden", "false");
  ui.modalTitle.textContent = GAME_META[gameKey].title;
  ui.modalBody.innerHTML = "";

  if (gameKey === "othello") {
    activeCleanup = startOthello(ui.modalBody);
    return;
  }

  if (gameKey === "invader") {
    activeCleanup = startInvader(ui.modalBody);
    return;
  }

  if (gameKey === "memory") {
    activeCleanup = startMemory(ui.modalBody);
    return;
  }
}

function closeModal() {
  if (typeof activeCleanup === "function") {
    activeCleanup();
  }
  activeCleanup = null;
  ui.modalBody.innerHTML = "";
  ui.gameModal.classList.add("hidden");
  ui.gameModal.setAttribute("aria-hidden", "true");
}

function setFormBusy(form, busy) {
  const controls = form.querySelectorAll("input, button");
  controls.forEach((node) => {
    node.disabled = busy;
  });
}

function clearFlash() {
  ui.flash.textContent = "";
  ui.flash.classList.add("hidden");
  ui.flash.classList.remove("error");
}

function showFlash(message, isError = false) {
  ui.flash.textContent = message;
  ui.flash.classList.remove("hidden");
  ui.flash.classList.toggle("error", Boolean(isError));
}

function startOthello(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "othello-wrap";
  const status = document.createElement("p");
  status.className = "othello-status";
  const boardEl = document.createElement("div");
  boardEl.className = "othello-board";

  wrapper.append(status, boardEl);
  container.appendChild(wrapper);

  const dirs = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  const board = Array.from({ length: 8 }, () => Array(8).fill(0));
  board[3][3] = 2;
  board[3][4] = 1;
  board[4][3] = 1;
  board[4][4] = 2;

  let turn = 1;
  let ended = false;
  let cpuTimer = null;

  const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  function findFlips(r, c, player) {
    if (board[r][c] !== 0) return [];
    const enemy = player === 1 ? 2 : 1;
    const all = [];

    for (const [dr, dc] of dirs) {
      const line = [];
      let nr = r + dr;
      let nc = c + dc;

      while (inBounds(nr, nc) && board[nr][nc] === enemy) {
        line.push([nr, nc]);
        nr += dr;
        nc += dc;
      }

      if (line.length && inBounds(nr, nc) && board[nr][nc] === player) {
        all.push(...line);
      }
    }

    return all;
  }

  function getMoves(player) {
    const moves = [];
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const flips = findFlips(r, c, player);
        if (flips.length) {
          moves.push({ r, c, flips });
        }
      }
    }
    return moves;
  }

  function applyMove(move, player) {
    board[move.r][move.c] = player;
    move.flips.forEach(([r, c]) => {
      board[r][c] = player;
    });
  }

  function score() {
    let black = 0;
    let white = 0;
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        if (board[r][c] === 1) black += 1;
        if (board[r][c] === 2) white += 1;
      }
    }
    return { black, white };
  }

  function setStatus(text) {
    const s = score();
    status.textContent = `${text} | You: ${s.black} CPU: ${s.white}`;
  }

  function checkEnd() {
    const playerMoves = getMoves(1);
    const cpuMoves = getMoves(2);

    if (!playerMoves.length && !cpuMoves.length) {
      ended = true;
      const s = score();
      const result = s.black === s.white ? "Draw" : s.black > s.white ? "You win" : "CPU wins";
      setStatus(`Game over - ${result}`);
      render();
      return true;
    }

    return false;
  }

  function cpuTurn() {
    if (ended) return;
    const moves = getMoves(2);

    if (!moves.length) {
      turn = 1;
      if (checkEnd()) return;
      setStatus("CPU skipped. Your turn.");
      render();
      return;
    }

    const pick = moves[Math.floor(Math.random() * moves.length)];
    applyMove(pick, 2);
    turn = 1;
    if (checkEnd()) return;
    setStatus("Your turn");
    render();
  }

  function onPlayerMove(move) {
    if (ended || turn !== 1) return;
    applyMove(move, 1);
    turn = 2;
    if (checkEnd()) return;
    setStatus("CPU turn...");
    render();
    cpuTimer = setTimeout(cpuTurn, 500);
  }

  function render() {
    boardEl.innerHTML = "";
    const valid = turn === 1 ? getMoves(1) : [];
    const validMap = new Map(valid.map((m) => [`${m.r}-${m.c}`, m]));

    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const key = `${r}-${c}`;
        const cell = document.createElement("button");
        cell.className = "othello-cell";
        cell.type = "button";

        const move = validMap.get(key);
        if (move) {
          cell.classList.add("valid");
          cell.addEventListener("click", () => onPlayerMove(move));
        } else {
          cell.disabled = true;
        }

        if (board[r][c] === 1 || board[r][c] === 2) {
          const disk = document.createElement("div");
          disk.className = `disk ${board[r][c] === 1 ? "black" : "white"}`;
          cell.appendChild(disk);
        }

        boardEl.appendChild(cell);
      }
    }

    if (!ended && turn === 1 && getMoves(1).length === 0) {
      turn = 2;
      setStatus("No valid move. CPU turn...");
      cpuTimer = setTimeout(cpuTurn, 500);
    }
  }

  setStatus("Your turn");
  render();

  return () => {
    if (cpuTimer) {
      clearTimeout(cpuTimer);
    }
  };
}

function startInvader(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "invader-wrap";

  const info = document.createElement("p");
  info.className = "invader-info";
  info.textContent = "Controls: Arrow Left/Right or A/D, Space to shoot";

  const canvas = document.createElement("canvas");
  canvas.id = "invaderCanvas";
  canvas.width = 800;
  canvas.height = 450;

  const mobileControls = document.createElement("div");
  mobileControls.className = "mobile-controls";
  mobileControls.innerHTML = `
    <button type="button" data-action="left">Left</button>
    <button type="button" data-action="shoot">Shoot</button>
    <button type="button" data-action="right">Right</button>
  `;

  wrapper.append(info, canvas, mobileControls);
  container.appendChild(wrapper);

  const ctx = canvas.getContext("2d");
  let frameId = null;
  let gameEnded = false;
  let score = 0;

  const keys = {
    left: false,
    right: false,
    shoot: false
  };

  const player = {
    x: canvas.width / 2 - 22,
    y: canvas.height - 36,
    w: 44,
    h: 16,
    speed: 300
  };

  const bullets = [];
  const enemies = [];

  let enemyDirection = 1;
  let enemySpeed = 46;
  let lastShot = 0;

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      enemies.push({
        x: 80 + col * 72,
        y: 48 + row * 46,
        w: 34,
        h: 22,
        alive: true
      });
    }
  }

  function finish(message) {
    gameEnded = true;
    info.textContent = `${message} | Score: ${score}`;
  }

  function shoot(now) {
    if (now - lastShot < 180) return;
    bullets.push({ x: player.x + player.w / 2 - 2, y: player.y - 8, w: 4, h: 10, speed: 420 });
    lastShot = now;
  }

  function update(deltaMs, now) {
    const dt = deltaMs / 1000;

    if (keys.left) player.x -= player.speed * dt;
    if (keys.right) player.x += player.speed * dt;

    player.x = Math.max(0, Math.min(canvas.width - player.w, player.x));

    if (keys.shoot) shoot(now);

    bullets.forEach((bullet) => {
      bullet.y -= bullet.speed * dt;
    });

    for (let i = bullets.length - 1; i >= 0; i -= 1) {
      if (bullets[i].y + bullets[i].h < 0) {
        bullets.splice(i, 1);
      }
    }

    let hitWall = false;
    enemies.forEach((enemy) => {
      if (!enemy.alive) return;
      enemy.x += enemyDirection * enemySpeed * dt;
      if (enemy.x <= 8 || enemy.x + enemy.w >= canvas.width - 8) {
        hitWall = true;
      }
    });

    if (hitWall) {
      enemyDirection *= -1;
      enemies.forEach((enemy) => {
        if (!enemy.alive) return;
        enemy.y += 16;
      });
    }

    enemies.forEach((enemy) => {
      if (!enemy.alive) return;
      if (enemy.y + enemy.h >= player.y) {
        finish("Game over");
      }
    });

    bullets.forEach((bullet) => {
      enemies.forEach((enemy) => {
        if (!enemy.alive) return;
        const overlap =
          bullet.x < enemy.x + enemy.w &&
          bullet.x + bullet.w > enemy.x &&
          bullet.y < enemy.y + enemy.h &&
          bullet.y + bullet.h > enemy.y;

        if (overlap) {
          enemy.alive = false;
          bullet.y = -9999;
          score += 10;
        }
      });
    });

    const aliveCount = enemies.filter((enemy) => enemy.alive).length;
    if (aliveCount === 0) {
      finish("You cleared all invaders");
    }

    enemySpeed = 46 + (32 - aliveCount) * 2;
    info.textContent = gameEnded ? info.textContent : `Score: ${score} | Remaining: ${aliveCount}`;
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#6ee7ff";
    ctx.fillRect(player.x, player.y, player.w, player.h);

    ctx.fillStyle = "#89ff9e";
    bullets.forEach((bullet) => {
      ctx.fillRect(bullet.x, bullet.y, bullet.w, bullet.h);
    });

    enemies.forEach((enemy) => {
      if (!enemy.alive) return;
      ctx.fillStyle = "#ff7ea0";
      ctx.fillRect(enemy.x, enemy.y, enemy.w, enemy.h);
      ctx.fillStyle = "#231130";
      ctx.fillRect(enemy.x + 8, enemy.y + 7, 6, 6);
      ctx.fillRect(enemy.x + 20, enemy.y + 7, 6, 6);
    });

    if (gameEnded) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 34px Segoe UI";
      ctx.fillText("Round End", canvas.width / 2 - 95, canvas.height / 2);
    }
  }

  let lastTime = performance.now();

  function loop(now) {
    const delta = now - lastTime;
    lastTime = now;

    if (!gameEnded) {
      update(delta, now);
    }

    render();
    frameId = requestAnimationFrame(loop);
  }

  function onKeyDown(event) {
    if (event.code === "ArrowLeft" || event.code === "KeyA") keys.left = true;
    if (event.code === "ArrowRight" || event.code === "KeyD") keys.right = true;
    if (event.code === "Space") {
      event.preventDefault();
      keys.shoot = true;
    }
  }

  function onKeyUp(event) {
    if (event.code === "ArrowLeft" || event.code === "KeyA") keys.left = false;
    if (event.code === "ArrowRight" || event.code === "KeyD") keys.right = false;
    if (event.code === "Space") keys.shoot = false;
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const mobileDown = (action) => {
    if (action === "left") keys.left = true;
    if (action === "right") keys.right = true;
    if (action === "shoot") keys.shoot = true;
  };

  const mobileUp = () => {
    keys.left = false;
    keys.right = false;
    keys.shoot = false;
  };

  mobileControls.querySelectorAll("button").forEach((button) => {
    button.addEventListener("pointerdown", () => mobileDown(button.dataset.action));
    button.addEventListener("pointerup", mobileUp);
    button.addEventListener("pointerleave", mobileUp);
  });

  frameId = requestAnimationFrame(loop);

  return () => {
    if (frameId) cancelAnimationFrame(frameId);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}

function startMemory(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "memory-wrap";

  const info = document.createElement("p");
  info.className = "muted";
  info.textContent = "Flip cards and match all pairs.";

  const grid = document.createElement("div");
  grid.className = "memory-grid";

  wrapper.append(info, grid);
  container.appendChild(wrapper);

  const symbols = ["A", "B", "C", "D", "E", "F"];
  const cards = [...symbols, ...symbols]
    .sort(() => Math.random() - 0.5)
    .map((value, index) => ({ id: index, value, flipped: false, matched: false }));

  let firstIndex = null;
  let lock = false;
  let turns = 0;

  function render() {
    grid.innerHTML = "";

    cards.forEach((card, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "memory-card";

      if (card.matched) {
        button.classList.add("matched");
      }

      const visible = card.flipped || card.matched;
      button.textContent = visible ? card.value : "?";
      button.disabled = lock || card.matched || card.flipped;
      button.addEventListener("click", () => flip(index));
      grid.appendChild(button);
    });
  }

  function flip(index) {
    if (lock) return;

    cards[index].flipped = true;

    if (firstIndex === null) {
      firstIndex = index;
      render();
      return;
    }

    turns += 1;
    const secondIndex = index;

    if (cards[firstIndex].value === cards[secondIndex].value) {
      cards[firstIndex].matched = true;
      cards[secondIndex].matched = true;
      cards[firstIndex].flipped = false;
      cards[secondIndex].flipped = false;
      firstIndex = null;

      const allMatched = cards.every((card) => card.matched);
      if (allMatched) {
        info.textContent = `Completed in ${turns} turns.`;
      } else {
        info.textContent = `Good match. Turns: ${turns}`;
      }
      render();
      return;
    }

    lock = true;
    render();
    setTimeout(() => {
      cards[firstIndex].flipped = false;
      cards[secondIndex].flipped = false;
      firstIndex = null;
      lock = false;
      info.textContent = `Turns: ${turns}`;
      render();
    }, 650);
  }

  render();

  return () => {
    // no-op
  };
}
