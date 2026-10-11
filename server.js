const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true }));

const rooms = new Map();

function makeRoom(code) {
  return { code, chess: new Chess(), players: { w: null, b: null }, spectators: new Set() };
}
function roomState(room) {
  return {
    code: room.code,
    fen: room.chess.fen(),
    turn: room.chess.turn(),
    history: room.chess.history(),
    gameOver: room.chess.isGameOver(),
    check: room.chess.isCheck(),
    checkmate: room.chess.isCheckmate(),
    draw: room.chess.isDraw(),
    stalemate: room.chess.isStalemate(),
    players: {
      w: room.players.w ? "connected" : "waiting",
      b: room.players.b ? "connected" : "waiting"
    }
  };
}
function emitState(room) { io.to(room.code).emit("state", roomState(room)); }
function cleanCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}
function newCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({length: 5}, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

io.on("connection", socket => {
  socket.on("createRoom", callback => {
    const code = newCode();
    const room = makeRoom(code);
    room.players.w = socket.id;
    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    socket.data.color = "w";
    if (typeof callback === "function") callback({ ok: true, code, color: "w" });
    emitState(room);
  });

  socket.on("joinRoom", (rawCode, callback) => {
    const code = cleanCode(rawCode);
    const room = rooms.get(code);
    if (!room) return callback?.({ ok: false, error: "Кімнату не знайдено. Перевір код або створи нову." });
    if (socket.data.room) {
      const old = rooms.get(socket.data.room);
      if (old) {
        if (old.players.w === socket.id) old.players.w = null;
        if (old.players.b === socket.id) old.players.b = null;
        old.spectators.delete(socket.id);
        emitState(old);
      }
      socket.leave(socket.data.room);
    }
    let color = null;
    if (!room.players.w) { room.players.w = socket.id; color = "w"; }
    else if (!room.players.b) { room.players.b = socket.id; color = "b"; }
    else room.spectators.add(socket.id);
    socket.join(code);
    socket.data.room = code;
    socket.data.color = color || "spectator";
    callback?.({ ok: true, code, color: color || "spectator" });
    emitState(room);
  });

  socket.on("move", (move, callback) => {
    const room = rooms.get(socket.data.room);
    if (!room) return callback?.({ ok: false, error: "Спочатку зайди в кімнату." });
    if (socket.data.color !== room.chess.turn()) {
      return callback?.({ ok: false, error: "Зараз не твій хід." });
    }
    if (!room.players.w || !room.players.b) {
      return callback?.({ ok: false, error: "Потрібні два гравці, щоб почати." });
    }
    try {
      const result = room.chess.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
      if (!result) return callback?.({ ok: false, error: "Такий хід неможливий." });
      callback?.({ ok: true });
      emitState(room);
    } catch (_e) {
      callback?.({ ok: false, error: "Неможливий хід." });
    }
  });

  socket.on("resetGame", callback => {
    const room = rooms.get(socket.data.room);
    if (!room || socket.data.color === "spectator") return callback?.({ ok: false });
    room.chess = new Chess();
    emitState(room);
    callback?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;
    if (room.players.w === socket.id) room.players.w = null;
    if (room.players.b === socket.id) room.players.b = null;
    room.spectators.delete(socket.id);
    emitState(room);
    if (!room.players.w && !room.players.b && room.spectators.size === 0) {
      setTimeout(() => {
        const current = rooms.get(code);
        if (current && !current.players.w && !current.players.b && current.spectators.size === 0) rooms.delete(code);
      }, 60000);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Chess server running on port ${PORT}`));
