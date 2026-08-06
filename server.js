require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const teamRoutes = require('./routes/teams');
const matchRoutes = require('./routes/matches');
const standingsRoutes = require('./routes/standings');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('io', io);
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/standings', standingsRoutes);

io.on('connection', (socket) => {
  socket.on('join:match', (matchNumber) => socket.join(`match:${matchNumber}`));
  socket.on('leave:match', (matchNumber) => socket.leave(`match:${matchNumber}`));
  socket.on('join:matches', () => socket.join('matches'));
});

const PORT = process.env.PORT || 3001;

async function start() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Copy .env.example to .env and fill in your Atlas connection string.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');
  server.listen(PORT, () => {
    console.log(`AO Doubles Tournament tracker running on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
