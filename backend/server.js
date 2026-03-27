const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();

// Serve the worker demo page at /demo
app.use('/demo', express.static(path.join(__dirname, '..', 'demo')));
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  // Tuned for real-time hand tracking latency
  pingInterval: 10000,
  pingTimeout: 5000,
  // Allow larger payloads (21 landmarks * 3 floats)
  maxHttpBufferSize: 1e6
});

// Track connected clients for logging
let clientCount = 0;

io.on('connection', (socket) => {
  clientCount++;
  const role = socket.handshake.query.role || 'unknown';
  console.log(`[+] Client connected: ${socket.id} (${role}) — Total: ${clientCount}`);

  // Hand tracking data: Dashboard → Server → Unity
  socket.on('hand:data', (payload) => {
    socket.broadcast.emit('hand:data', payload);
  });

  // Gesture events: Unity → Server → Dashboard
  socket.on('gesture:detected', (payload) => {
    console.log(`[GESTURE] ${payload.gesture} (${(payload.confidence * 100).toFixed(0)}%)`);
    socket.broadcast.emit('gesture:detected', payload);
  });

  // Voice transcripts: Dashboard → Server → Unity
  socket.on('voice:transcript', (payload) => {
    socket.broadcast.emit('voice:transcript', payload);
  });

  // Annotations: Dashboard → Server → Unity
  socket.on('annotation:update', (payload) => {
    socket.broadcast.emit('annotation:update', payload);
  });

  // AI detection results: Unity → Server → Dashboard
  socket.on('ai:detection', (payload) => {
    socket.broadcast.emit('ai:detection', payload);
  });

  // Session management
  socket.on('session:join', (payload) => {
    console.log(`[SESSION] ${payload.userId} joined as ${payload.role}`);
    socket.join(payload.sessionId);
    socket.broadcast.to(payload.sessionId).emit('session:join', payload);
  });

  socket.on('session:end', (payload) => {
    console.log(`[SESSION] Ended: ${payload.reason}`);
    io.to(payload.sessionId).emit('session:end', payload);
  });

  // WebRTC signaling relay
  socket.on('webrtc:offer', (payload) => socket.broadcast.emit('webrtc:offer', payload));
  socket.on('webrtc:answer', (payload) => socket.broadcast.emit('webrtc:answer', payload));
  socket.on('webrtc:ice', (payload) => socket.broadcast.emit('webrtc:ice', payload));

  socket.on('disconnect', () => {
    clientCount--;
    console.log(`[-] Client disconnected: ${socket.id} — Total: ${clientCount}`);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', clients: clientCount, uptime: process.uptime() });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║   Synapse XR Relay Server Live                ║
║   WebSocket:   ws://localhost:${PORT}            ║
║   Health:      http://localhost:${PORT}/health       ║
║   Worker Demo: http://localhost:${PORT}/demo         ║
╚═══════════════════════════════════════════════╝
  `);
});
