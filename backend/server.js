const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));

app.use(express.json());

// Store rooms and users
const rooms = new Map();
const users = new Map();

// Generate unique room code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Socket.IO setup
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join room
  socket.on('join-room', (data) => {
    const { roomId, username, isHost } = data;
    
    let room = rooms.get(roomId);
    
    // Create room if it doesn't exist and user is host
    if (!room && isHost) {
      room = {
        id: roomId,
        host: socket.id,
        users: [],
        videoUrl: '',
        videoType: '', // 'youtube' or 'upload'
        playbackState: {
          isPlaying: false,
          currentTime: 0,
          timestamp: Date.now()
        }
      };
      rooms.set(roomId, room);
    }
    
    // Add user to room
    if (room) {
      const user = {
        id: socket.id,
        username: username || `User${room.users.length + 1}`,
        isHost: isHost || false
      };
      
      room.users.push(user);
      users.set(socket.id, { roomId, ...user });
      
      socket.join(roomId);
      
      // Notify room about new user
      socket.to(roomId).emit('user-joined', user);
      
      // Send current room state to new user
      socket.emit('room-state', {
        room,
        users: room.users,
        playbackState: room.playbackState
      });
      
      console.log(`User ${username} joined room ${roomId}`);
    } else {
      socket.emit('room-error', { message: 'Room not found' });
    }
  });

  // Video playback controls
  socket.on('play-video', (data) => {
    const user = users.get(socket.id);
    if (user) {
      const room = rooms.get(user.roomId);
      if (room) {
        room.playbackState = {
          isPlaying: true,
          currentTime: data.currentTime || room.playbackState.currentTime,
          timestamp: Date.now()
        };
        
        socket.to(user.roomId).emit('video-played', room.playbackState);
      }
    }
  });

  socket.on('pause-video', (data) => {
    const user = users.get(socket.id);
    if (user) {
      const room = rooms.get(user.roomId);
      if (room) {
        room.playbackState = {
          isPlaying: false,
          currentTime: data.currentTime || room.playbackState.currentTime,
          timestamp: Date.now()
        };
        
        socket.to(user.roomId).emit('video-paused', room.playbackState);
      }
    }
  });

  socket.on('seek-video', (data) => {
    const user = users.get(socket.id);
    if (user) {
      const room = rooms.get(user.roomId);
      if (room) {
        room.playbackState = {
          isPlaying: room.playbackState.isPlaying,
          currentTime: data.currentTime,
          timestamp: Date.now()
        };
        
        socket.to(user.roomId).emit('video-seeked', room.playbackState);
      }
    }
  });

  // Video URL change
  socket.on('change-video', (data) => {
    const user = users.get(socket.id);
    if (user && user.isHost) {
      const room = rooms.get(user.roomId);
      if (room) {
        room.videoUrl = data.url;
        room.videoType = data.type;
        room.playbackState = {
          isPlaying: false,
          currentTime: 0,
          timestamp: Date.now()
        };
        
        io.to(user.roomId).emit('video-changed', {
          url: data.url,
          type: data.type,
          playbackState: room.playbackState
        });
      }
    }
  });

  // Chat messages
  socket.on('send-message', (data) => {
    const user = users.get(socket.id);
    if (user) {
      const message = {
        id: uuidv4(),
        username: user.username,
        message: data.message,
        timestamp: new Date().toISOString()
      };
      
      io.to(user.roomId).emit('new-message', message);
    }
  });

  // WebRTC signaling
  socket.on('webrtc-offer', (data) => {
    socket.to(data.target).emit('webrtc-offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('webrtc-answer', (data) => {
    socket.to(data.target).emit('webrtc-answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    socket.to(data.target).emit('webrtc-ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // User disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const room = rooms.get(user.roomId);
      if (room) {
        // Remove user from room
        room.users = room.users.filter(u => u.id !== socket.id);
        
        // If host left, assign new host or delete room
        if (user.isHost && room.users.length > 0) {
          room.host = room.users[0].id;
          room.users[0].isHost = true;
          io.to(user.roomId).emit('host-changed', room.users[0]);
        } else if (room.users.length === 0) {
          rooms.delete(user.roomId);
        } else {
          socket.to(user.roomId).emit('user-left', user);
        }
      }
      users.delete(socket.id);
    }
    console.log('User disconnected:', socket.id);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Get room info
app.get('/room/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (room) {
    res.json({ exists: true, users: room.users.length });
  } else {
    res.json({ exists: false });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});