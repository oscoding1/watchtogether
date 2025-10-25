import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import ReactPlayer from 'react-player';
import { 
  Video, 
  Users, 
  MessageSquare, 
  Play, 
  Pause, 
  Volume2, 
  VolumeX,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Share2,
  Copy,
  Send
} from 'lucide-react';

const App = () => {
  const [currentView, setCurrentView] = useState('home'); // 'home', 'lobby', 'room'
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [socket, setSocket] = useState(null);
  const [roomUsers, setRoomUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoType, setVideoType] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [peerConnections, setPeerConnections] = useState(new Map());

  const playerRef = useRef(null);
  const localVideoRef = useRef(null);
  const videoContainerRef = useRef(null);

  const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(SERVER_URL);
    setSocket(newSocket);

    return () => newSocket.close();
  }, []);

  // Add this useEffect after your socket initialization
useEffect(() => {
  if (!socket) return;

  // Connection event handlers
  socket.on('connect', () => {
    console.log('✅ Connected to server');
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnected from server');
  });

  socket.on('connect_error', (error) => {
    console.error('🚨 Connection error:', error);
  });

  socket.on('room-error', (error) => {
    console.error('🚨 Room error:', error);
    alert(`Room error: ${error.message}`);
  });

  // Add users-updated event
  socket.on('users-updated', (users) => {
    console.log('👥 Users updated:', users);
    setRoomUsers(users);
  });

  // Ping the server every 30 seconds to keep connection alive
  const pingInterval = setInterval(() => {
    if (socket.connected) {
      socket.emit('ping');
    }
  }, 30000);

  return () => {
    clearInterval(pingInterval);
  };
}, [socket]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('room-state', (data) => {
      setRoomUsers(data.users);
      setVideoUrl(data.room.videoUrl);
      setVideoType(data.room.videoType);
      setIsPlaying(data.playbackState.isPlaying);
      setCurrentTime(data.playbackState.currentTime);
    });

    socket.on('user-joined', (user) => {
      setRoomUsers(prev => [...prev, user]);
      handleUserJoined(user.id);
    });

    socket.on('user-left', (user) => {
      setRoomUsers(prev => prev.filter(u => u.id !== user.id));
      setRemoteStreams(prev => {
        const newStreams = new Map(prev);
        newStreams.delete(user.id);
        return newStreams;
      });
    });

    socket.on('video-played', (playbackState) => {
      setIsPlaying(true);
      setCurrentTime(playbackState.currentTime);
    });

    socket.on('video-paused', (playbackState) => {
      setIsPlaying(false);
      setCurrentTime(playbackState.currentTime);
    });

    socket.on('video-seeked', (playbackState) => {
      setCurrentTime(playbackState.currentTime);
      if (playerRef.current) {
        playerRef.current.seekTo(playbackState.currentTime, 'seconds');
      }
    });

    socket.on('video-changed', (data) => {
      setVideoUrl(data.url);
      setVideoType(data.type);
      setIsPlaying(data.playbackState.isPlaying);
      setCurrentTime(data.playbackState.currentTime);
    });

    socket.on('new-message', (message) => {
      setMessages(prev => [...prev, message]);
    });

    socket.on('host-changed', (newHost) => {
      setIsHost(socket.id === newHost.id);
    });

    // WebRTC signaling
    socket.on('webrtc-offer', async (data) => {
      await handleOffer(data.offer, data.sender);
    });

    socket.on('webrtc-answer', async (data) => {
      await handleAnswer(data.answer, data.sender);
    });

    socket.on('webrtc-ice-candidate', async (data) => {
      await handleIceCandidate(data.candidate, data.sender);
    });

  }, [socket]);

  // WebRTC setup
  const initializeWebRTC = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing media devices:', error);
    }
  };

  const createPeerConnection = (userId) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });

    // Add local stream to connection
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Handle incoming stream
    pc.ontrack = (event) => {
      setRemoteStreams(prev => {
        const newStreams = new Map(prev);
        newStreams.set(userId, event.streams[0]);
        return newStreams;
      });
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          target: userId,
          candidate: event.candidate
        });
      }
    };

    return pc;
  };

  const handleUserJoined = async (userId) => {
    if (isHost) {
      const pc = createPeerConnection(userId);
      setPeerConnections(prev => new Map(prev).set(userId, pc));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('webrtc-offer', {
        target: userId,
        offer: offer
      });
    }
  };

  const handleOffer = async (offer, senderId) => {
    const pc = createPeerConnection(senderId);
    setPeerConnections(prev => new Map(prev).set(senderId, pc));

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('webrtc-answer', {
      target: senderId,
      answer: answer
    });
  };

  const handleAnswer = async (answer, senderId) => {
    const pc = peerConnections.get(senderId);
    if (pc) {
      await pc.setRemoteDescription(answer);
    }
  };

  const handleIceCandidate = async (candidate, senderId) => {
    const pc = peerConnections.get(senderId);
    if (pc) {
      await pc.addIceCandidate(candidate);
    }
  };

  // Room management
  const createRoom = () => {
    if (!username.trim()) return alert('Please enter a username');
    
    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(newRoomId);
    setIsHost(true);
    joinRoom(newRoomId, true);
  };

  const joinRoom = (id = roomId, host = false) => {
    if (!username.trim()) return alert('Please enter a username');
    
    socket.emit('join-room', {
      roomId: id || roomId,
      username: username.trim(),
      isHost: host
    });
    
    setCurrentView('room');
    initializeWebRTC();
  };

  // Video controls
  const handlePlay = () => {
    if (!isHost) return;
    
    const currentTime = playerRef.current?.getCurrentTime() || 0;
    socket.emit('play-video', { currentTime });
    setIsPlaying(true);
  };

  const handlePause = () => {
    if (!isHost) return;
    
    const currentTime = playerRef.current?.getCurrentTime() || 0;
    socket.emit('pause-video', { currentTime });
    setIsPlaying(false);
  };

  const handleSeek = (seconds) => {
    if (!isHost) return;
    
    socket.emit('seek-video', { currentTime: seconds });
    setCurrentTime(seconds);
  };

  const handleProgress = (state) => {
    setCurrentTime(state.playedSeconds);
  };

  const handleDuration = (duration) => {
    setDuration(duration);
  };

  const changeVideo = (url, type = '') => {
  if (!isHost) {
    alert('Only the host can change the video');
    return;
  }

  if (!url.trim()) {
    alert('Please enter a video URL');
    return;
  }

  // Auto-detect video type if not provided
  let detectedType = type;
  if (!type) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      detectedType = 'youtube';
    } else if (url.endsWith('.mp4') || url.endsWith('.webm') || url.endsWith('.ogg')) {
      detectedType = 'upload';
    } else {
      detectedType = 'upload'; // default
    }
  }

  console.log('🎬 Changing video:', url, detectedType);
  socket.emit('change-video', { url: url.trim(), type: detectedType });
};

  // Chat functions
  const sendMessage = () => {
    if (!newMessage.trim()) return;
    
    socket.emit('send-message', { message: newMessage.trim() });
    setNewMessage('');
  };

  // Media controls
  const toggleCamera = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
      }
    }
  };

  const toggleMic = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  };

  const copyRoomLink = () => {
    const roomLink = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(roomLink);
    alert('Room link copied to clipboard!');
  };

  // Home Screen
  if (currentView === 'home') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full shadow-2xl">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-4">
              <Video className="h-12 w-12 text-blue-500 mr-3" />
              <h1 className="text-3xl font-bold text-white">WatchTogether</h1>
            </div>
            <p className="text-gray-400">Watch videos in sync with friends</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Your Name
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <button
              onClick={createRoom}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-semibold transition-colors duration-200 flex items-center justify-center"
            >
              <Users className="w-5 h-5 mr-2" />
              Create New Room
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-600"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-800 text-gray-400">or join existing room</span>
              </div>
            </div>

            <div className="flex space-x-2">
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                placeholder="Room Code"
                className="flex-1 px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent uppercase"
                maxLength={6}
              />
              <button
                onClick={() => joinRoom()}
                disabled={!roomId}
                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white py-3 px-6 rounded-lg font-semibold transition-colors duration-200"
              >
                Join
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Room Screen
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <Video className="h-6 w-6 text-blue-500 mr-2" />
              <h1 className="text-xl font-bold text-white">WatchTogether</h1>
            </div>
            <div className="text-sm text-gray-300">
              Room: <span className="font-mono bg-gray-700 px-2 py-1 rounded">{roomId}</span>
              <button
                onClick={copyRoomLink}
                className="ml-2 text-blue-400 hover:text-blue-300"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            {videoUrl && (
              <div className="text-sm text-gray-300">
                Now Watching: <span className="text-white">{videoUrl}</span>
              </div>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <div className="flex items-center text-sm text-gray-300">
              <Users className="w-4 h-4 mr-1" />
              {roomUsers.length} users
            </div>
            {isHost && (
              <span className="bg-green-600 text-xs text-white px-2 py-1 rounded">Host</span>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row p-4 gap-4">
        {/* Main Video Area */}
        <div className="flex-1 flex flex-col" ref={videoContainerRef}>
          {/* Video Player */}
          <div className="bg-black rounded-lg overflow-hidden aspect-video mb-4 relative">
            {videoUrl ? (
              <ReactPlayer
                ref={playerRef}
                url={videoUrl}
                playing={isPlaying}
                controls={false}
                width="100%"
                height="100%"
                muted={isMuted}
                progressInterval={100}
                onProgress={handleProgress}
                onDuration={handleDuration}
                onPlay={handlePlay}
                onPause={handlePause}
                onSeek={handleSeek}
                config={{
                  youtube: {
                    playerVars: { showinfo: 1 }
                  }
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <Video className="h-16 w-16 mx-auto mb-4" />
                  <p>No video selected</p>
                  {isHost && (
                    <p className="text-sm mt-2">Add a YouTube URL or upload a video to start</p>
                  )}
                </div>
              </div>
            )}

            {/* Video Controls Overlay */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center space-x-4 bg-gray-800 bg-opacity-75 rounded-lg px-4 py-2">
              {isHost ? (
                <>
                  <button
                    onClick={handlePlay}
                    disabled={!videoUrl}
                    className="text-white hover:text-green-400 disabled:text-gray-500"
                  >
                    <Play className="w-6 h-6" />
                  </button>
                  <button
                    onClick={handlePause}
                    disabled={!videoUrl}
                    className="text-white hover:text-yellow-400 disabled:text-gray-500"
                  >
                    <Pause className="w-6 h-6" />
                  </button>
                </>
              ) : (
                <div className="text-white text-sm">
                  {isPlaying ? 'Playing' : 'Paused'}
                </div>
              )}
              
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="text-white hover:text-gray-300"
              >
                {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
              </button>
              
              <div className="text-white text-sm">
                {Math.floor(currentTime / 60)}:{(currentTime % 60).toFixed(0).padStart(2, '0')}
              </div>
            </div>
          </div>

          {/* Video URL Input */}
          {isHost && (
            <div className="flex space-x-2 mb-4">
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="Enter YouTube URL or video URL"
                className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={() => changeVideo(videoUrl, videoUrl.includes('youtube') ? 'youtube' : 'upload')}
                disabled={!videoUrl}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors duration-200"
              >
                Load Video
              </button>
            </div>
          )}

          {/* Webcam Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Local Video */}
            <div className="bg-gray-800 rounded-lg overflow-hidden aspect-video relative">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-2 left-2 text-white text-sm bg-black bg-opacity-50 px-2 py-1 rounded">
                You ({username})
              </div>
              <div className="absolute top-2 right-2 flex space-x-2">
                <button
                  onClick={toggleCamera}
                  className={`p-1 rounded ${isCameraOn ? 'bg-green-600' : 'bg-red-600'}`}
                >
                  {isCameraOn ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
                </button>
                <button
                  onClick={toggleMic}
                  className={`p-1 rounded ${isMicOn ? 'bg-green-600' : 'bg-red-600'}`}
                >
                  {isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remote Videos */}
            {Array.from(remoteStreams.entries()).map(([userId, stream]) => {
              const user = roomUsers.find(u => u.id === userId);
              return (
                <div key={userId} className="bg-gray-800 rounded-lg overflow-hidden aspect-video relative">
                  <video
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                    ref={video => {
                      if (video) video.srcObject = stream;
                    }}
                  />
                  <div className="absolute bottom-2 left-2 text-white text-sm bg-black bg-opacity-50 px-2 py-1 rounded">
                    {user?.username || 'User'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chat Sidebar */}
        <div className="w-full lg:w-80 bg-gray-800 rounded-lg flex flex-col">
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white flex items-center">
              <MessageSquare className="w-5 h-5 mr-2" />
              Chat
            </h2>
          </div>

          <div className="flex-1 p-4 overflow-y-auto">
            {messages.map((message) => (
              <div key={message.id} className="mb-3">
                <div className="flex items-start space-x-2">
                  <div className="flex-1">
                    <div className="flex items-baseline space-x-2">
                      <span className="font-semibold text-blue-400 text-sm">
                        {message.username}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-white text-sm mt-1">{message.message}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-gray-700">
            <div className="flex space-x-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={sendMessage}
                disabled={!newMessage.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white p-2 rounded-lg transition-colors duration-200"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;