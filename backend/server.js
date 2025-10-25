const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Improved CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || ["http://localhost:3000", "http://127.0.0.1:3000"],
  credentials: true
}));

app.use(express.json());

// Store rooms and users
const rooms = new Map();
const users = new Map();

// Socket.IO setup with better configuration
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'] // Add fallback transports
});

// Add connection logging
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

  // Join room with better error handling
  socket.on('join-room', (data) => {
    console.log('🎯 Join room attempt:', data);
    
    const { roomId, username, isHost } = data;
    
    if (!roomId || !username) {
      socket.emit('room-error', { message: 'Room ID and username are required' });
      return;
    }
    
    let room = rooms.get(roomId);
    
    // Create room if it doesn't exist and user is host
    if (!room && isHost) {
      room = {
        id: roomId,
        host: socket.id,
        users: [],
        videoUrl: '',
        videoType: '',
        playbackState: {
          isPlaying: false,
          currentTime: 0,
          timestamp: Date.now()
        }
      };
      rooms.set(roomId, room);
      console.log('🚀 New room created:', roomId);
    }
    
    // Add user to room
    if (room) {
      // Check if username already exists in room
      const existingUser = room.users.find(u => u.username === username);
      if (existingUser && existingUser.id !== socket.id) {
        socket.emit('room-error', { message: 'Username already taken in this room' });
        return;
      }
      
      // Remove user if they already exist (reconnection)
      room.users = room.users.filter(u => u.id !== socket.id);
      
      const user = {
        id: socket.id,
        username: username,
        isHost: isHost || false
      };
      
      room.users.push(user);
      users.set(socket.id, { roomId, ...user });
      
      socket.join(roomId);
      
      console.log(`✅ User ${username} joined room ${roomId}. Room users:`, room.users.map(u => u.username));
      
      // Notify room about new user
      socket.to(roomId).emit('user-joined', user);
      
      // Send current room state to new user
      socket.emit('room-state', {
        room,
        users: room.users,
        playbackState: room.playbackState
      });
      
      // Update all users with new user list
      io.to(roomId).emit('users-updated', room.users);
      
    } else {
      console.log('❌ Room not found:', roomId);
      socket.emit('room-error', { message: 'Room not found' });
    }
  });

  // Video playback controls with validation
  socket.on('play-video', (data) => {
    const user = users.get(socket.id);
    console.log('▶️ Play video request from:', user?.username, data);
    
    if (user) {
      const room = rooms.get(user.roomId);
      if (room && user.isHost) {
        room.playbackState = {
          isPlaying: true,
          currentTime: data.currentTime || room.playbackState.currentTime,
          timestamp: Date.now()
        };
        
        console.log('📢 Broadcasting play to room:', user.roomId);
        socket.to(user.roomId).emit('video-played', room.playbackState);
      } else if (!user.isHost) {
        console.log('❌ Non-host tried to play video:', user.username);
      }
    }
  });

  socket.on('pause-video', (data) => {
    const user = users.get(socket.id);
    console.log('⏸️ Pause video request from:', user?.username, data);
    
    if (user) {
      const room = rooms.get(user.roomId);
      if (room && user.isHost) {
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
    console.log('🔍 Seek video request from:', user?.username, data);
    
    if (user) {
      const room = rooms.get(user.roomId);
      if (room && user.isHost) {
        room.playbackState = {
          isPlaying: room.playbackState.isPlaying,
          currentTime: data.currentTime,
          timestamp: Date.now()
        };
        
        socket.to(user.roomId).emit('video-seeked', room.playbackState);
      }
    }
  });

  // Video URL change with validation
  socket.on('change-video', (data) => {
    const user = users.get(socket.id);
    console.log('🎬 Change video request:', data);
    
    if (user && user.isHost) {
      const room = rooms.get(user.roomId);
      if (room) {
        // Validate YouTube URL
        let videoType = 'upload';
        if (data.url.includes('youtube.com') || data.url.includes('youtu.be')) {
          videoType = 'youtube';
        }
        
        room.videoUrl = data.url;
        room.videoType = videoType;
        room.playbackState = {
          isPlaying: false,
          currentTime: 0,
          timestamp: Date.now()
        };
        
        console.log('🎥 Video changed to:', data.url);
        io.to(user.roomId).emit('video-changed', {
          url: data.url,
          type: videoType,
          playbackState: room.playbackState
        });
      }
    } else {
      console.log('❌ Non-host tried to change video');
    }
  });

  // Chat messages
  socket.on('send-message', (data) => {
    const user = users.get(socket.id);
    console.log('💬 Chat message from:', user?.username, data);
    
    if (user && data.message) {
      const message = {
        id: uuidv4(),
        username: user.username,
        message: data.message.trim(),
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
  socket.on('disconnect', (reason) => {
    console.log('❌ User disconnected:', socket.id, reason);
    
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
          console.log('👑 New host assigned:', room.users[0].username);
        } else if (room.users.length === 0) {
          rooms.delete(user.roomId);
          console.log('🗑️ Room deleted (no users):', user.roomId);
        } else {
          socket.to(user.roomId).emit('user-left', user);
        }
        
        // Update users list
        io.to(user.roomId).emit('users-updated', room.users);
      }
      users.delete(socket.id);
    }
  });

  // Add ping-pong for connection monitoring
  socket.on('ping', () => {
    socket.emit('pong');
  });
});

// Health check endpoint with room info
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    activeRooms: rooms.size,
    activeUsers: users.size
  });
});

// Get room info
app.get('/room/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (room) {
    res.json({ 
      exists: true, 
      users: room.users.length,
      userList: room.users.map(u => u.username)
    });
  } else {
    res.json({ exists: false });
  }
});

// Get all rooms (for debugging)
app.get('/debug/rooms', (req, res) => {
  const roomInfo = Array.from(rooms.entries()).map(([id, room]) => ({
    id,
    host: room.host,
    users: room.users.map(u => u.username),
    videoUrl: room.videoUrl,
    videoType: room.videoType
  }));
  
  res.json(roomInfo);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/health`);
});