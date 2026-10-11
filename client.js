const socket = io();
const boardEl = document.getElementById("board");
const notice = document.getElementById("notice");
const roomInfo = document.getElementById("roomInfo");
const roomCodeEl = document.getElementById("roomCode");
const roomInput = document.getElementById("roomInput");
const gameMessage = document.getElementById("gameMessage");
const turnPill = document.getElementById("turnPill");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const copyBtn = document.getElementById("copyBtn");
const resetBtn = document.getElementById("resetBtn");

let myColor = null;
let currentRoom = null;
let game = new Chess();
let selected = null;
let legalTargets = [];
let lastMove = null;
let state = null;

const glyphs = {
  wp:"♙",wn:"♘",wb:"♗",wr:"♖",wq:"♕",wk:"♔",
  bp:"♟",bn:"♞",bb:"♝",br:"♜",bq:"♛",bk:"♚"
};
const files = "abcdefgh";
function say(text, bad=false) { notice.textContent = text; notice.style.color = bad ? "#ff9c8f" : ""; }
function syncRoom(result) {
  currentRoom = result.code;
  myColor = result.color;
  roomCodeEl.textContent = currentRoom;
  roomInfo.classList.remove("hidden");
  say(myColor === "w" ? "Ти граєш білими." : myColor === "b" ? "Ти граєш чорними." : "Ти спостерігаєш за партією.");
  renderBoard();
}
createBtn.addEventListener("click", () => {
  socket.emit("createRoom", result => {
    if (!result?.ok) return say("Не вдалося створити кімнату.", true);
    syncRoom(result);
  });
});
joinBtn.addEventListener("click", () => {
  const code = roomInput.value.trim();
  if (!code) return say("Введи код кімнати.", true);
  socket.emit("joinRoom", code, result => {
    if (!result?.ok) return say(result?.error || "Помилка підключення.", true);
    syncRoom(result);
  });
});
roomInput.addEventListener("keydown", e => { if (e.key === "Enter") joinBtn.click(); });
roomInput.addEventListener("input", () => { roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
copyBtn.addEventListener("click", async () => {
  if (!currentRoom) return;
  try { await navigator.clipboard.writeText(currentRoom); copyBtn.textContent = "Скопійовано ✓"; }
  catch { roomInput.value = currentRoom; roomInput.select(); say("Код показано в полі — скопіюй його вручну."); }
  setTimeout(() => copyBtn.textContent = "Копіювати код", 1600);
});
resetBtn.addEventListener("click", () => {
  if (!currentRoom) return say("Спочатку створи або відкрий кімнату.", true);
  socket.emit("resetGame", result => { if (!result?.ok) say("Не вдалося почати нову партію.", true); });
});
socket.on("state", incoming => {
  state = incoming;
  game.load(incoming.fen);
  const hist = game.history({ verbose:true });
  lastMove = hist.length ? {from:hist[hist.length-1].from,to:hist[hist.length-1].to} : null;
  selected = null; legalTargets = [];
  document.getElementById("whiteStatus").textContent = incoming.players.w === "connected" ? (myColor === "w" ? "Ти • підключений" : "Гравець підключений") : "Очікують гравця";
  document.getElementById("blackStatus").textContent = incoming.players.b === "connected" ? (myColor === "b" ? "Ти • підключений" : "Гравець підключений") : "Очікують гравця";
  document.getElementById("whiteDot").classList.toggle("active", incoming.turn === "w" && !incoming.gameOver);
  document.getElementById("blackDot").classList.toggle("active", incoming.turn === "b" && !incoming.gameOver);
  turnPill.textContent = incoming.gameOver ? "Партію завершено" : incoming.turn === "w" ? "Хід білих" : "Хід чорних";
  if (incoming.checkmate) gameMessage.textContent = `Мат! Перемогли ${incoming.turn === "w" ? "чорні" : "білі"}.`;
  else if (incoming.stalemate) gameMessage.textContent = "Пат — нічия.";
  else if (incoming.draw) gameMessage.textContent = "Нічия.";
  else if (incoming.check) gameMessage.textContent = "Шах!";
  else if (incoming.players.w !== "connected" || incoming.players.b !== "connected") gameMessage.textContent = "Очікуємо двох гравців у кімнаті.";
  else gameMessage.textContent = incoming.turn === myColor ? "Твій хід." : "Хід суперника.";
  renderBoard();
});
socket.on("connect", () => { if (!currentRoom) say("Сервер підключено. Створи кімнату або введи код друга."); });
socket.on("disconnect", () => say("Зв’язок із сервером перервано. Перевір інтернет.", true));

function renderBoard() {
  boardEl.innerHTML = "";
  const fenBoard = game.board();
  const flipped = myColor === "b";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const r = flipped ? 7-row : row;
      const c = flipped ? 7-col : col;
      const squareName = files[c] + (8-r);
      const piece = fenBoard[r][c];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "square " + ((r+c)%2===0 ? "light" : "dark");
      if (selected === squareName) button.classList.add("selected");
      if (legalTargets.includes(squareName)) button.classList.add(piece ? "capture" : "legal");
      if (lastMove && (lastMove.from === squareName || lastMove.to === squareName)) button.classList.add("last-move");
      button.setAttribute("aria-label", squareName);
      if (piece) {
        const span = document.createElement("span");
        span.className = "piece " + (piece.color === "w" ? "white-piece" : "black-piece");
        span.textContent = glyphs[piece.color + piece.type];
        button.appendChild(span);
      }
      if (col === 0) {
        const coord = document.createElement("span");
        coord.className = "coords"; coord.textContent = 8-r;
        button.appendChild(coord);
      }
      button.addEventListener("click", () => clickSquare(squareName));
      boardEl.appendChild(button);
    }
  }
}
function clickSquare(square) {
  if (!currentRoom || !state) return;
  if (myColor !== state.turn || myColor === "spectator" || state.gameOver) return;
  const piece = game.get(square);
  if (selected && legalTargets.includes(square)) {
    socket.emit("move", {from:selected,to:square,promotion:"q"}, result => {
      if (!result?.ok) gameMessage.textContent = result?.error || "Хід не виконано.";
    });
    selected = null; legalTargets = []; renderBoard(); return;
  }
  if (piece && piece.color === myColor) {
    selected = square;
    legalTargets = game.moves({square, verbose:true}).map(move => move.to);
  } else {
    selected = null; legalTargets = [];
  }
  renderBoard();
}
renderBoard();
