const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { TikTokLiveConnection, RouteConfig } = require('tiktok-live-connector');

// Override fetchRoomInfo to use HTML scraping without requiring EulerStream paid API keys
if (RouteConfig && RouteConfig.fetchRoomInfoFromHtml) {
  RouteConfig.fetchRoomInfo = RouteConfig.fetchRoomInfoFromHtml;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TIKTOK_EMOJI_MAP = {
  laughcry: '😂',
  joy: '😂',
  rofl: '🤣',
  smile: '😊',
  happy: '😄',
  grin: '😁',
  cry: '😭',
  sob: '😭',
  heart: '❤️',
  love: '❤️',
  rose: '🌹',
  loveface: '🥰',
  heart_eyes: '😍',
  wink: '😉',
  yummy: '😋',
  thinking: '🤔',
  cool: '😎',
  sunglasses: '😎',
  surprised: '😮',
  shock: '😱',
  scream: '😱',
  angry: '😡',
  rage: '🤬',
  flushed: '😳',
  proud: '😌',
  drool: '🤤',
  sweat: '😅',
  evil: '😈',
  slap: '👋',
  cute: '🥺',
  pleading: '🥺',
  wronged: '🥺',
  kiss: '😘',
  fire: '🔥',
  crown: '👑',
  star: '⭐',
  sparkles: '✨',
  clap: '👏',
  pray: '🙏',
  thumbsup: '👍',
  thumbsdown: '👎',
  ok: '👌',
  '100': '💯',
  clown: '🤡',
  skull: '💀',
  eyes: '👀',
  gift: '🎁',
  cake: '🎂',
  party: '🎉',
  popper: '🎉',
  music: '🎵',
  gem: '💎',
  diamond: '💎',
  money: '💰',
  luck: '🍀',
  coffee: '☕',
  beer: '🍻',
  cheers: '🥂',
  dog: '🐶',
  cat: '🐱',
  monkey: '🐵',
  ghost: '👻',
  alien: '👽',
  robot: '🤖',
  sleep: '😴',
  bored: '🥱',
  shhh: '🤫',
  woozy: '🥴',
  dizzy: '😵',
  vomit: '🤮',
  sick: '🤒',
  mask: '😷',
  bandage: '🤕',
  sneezing: '🤧',
  hot: '🥵',
  cold: '🥶',
  mindblown: '🤯',
  cowboy: '🤠',
  partying: '🥳',
  disguise: '🥸',
  tears: '🥲',
  nerd: '🤓',
  monocle: '🧐',
  hug: '🤗',
  salute: '🫡',
  melting: '🫠',
  facepalm: '🤦',
  shrug: '🤷'
};

function parseTikTokEmojis(text) {
  if (!text) return '';
  return text.replace(/\[([a-zA-Z0-9_-]+)\]/g, (match, tag) => {
    const lower = tag.toLowerCase();
    return TIKTOK_EMOJI_MAP[lower] || match;
  });
}

// Persistent Live Session Store (Holds cumulative stats across reconnects, only resets on streamEnd)
const persistentLiveSessions = new Map();

function getOrCreateLiveSession(uniqueId) {
  const key = uniqueId.toLowerCase();
  if (!persistentLiveSessions.has(key)) {
    persistentLiveSessions.set(key, {
      uniqueId: key,
      roomId: null,
      viewerCount: 0,
      newFollowersCount: 0,
      totalDiamonds: 0,
      totalLikes: 0,
      isLive: true,
      lastUpdated: Date.now()
    });
  }
  return persistentLiveSessions.get(key);
}

// Store active TikTok connections: Map<uniqueId, { connection, clientsCount, state, stats }>
const activeConnections = new Map();

class TikTokLiveHandler {
  constructor(uniqueId) {
    this.uniqueId = uniqueId.replace(/^@/, '').trim();
    this.connection = new TikTokLiveConnection(this.uniqueId, {
      processInitialData: true,
      fetchRoomInfoOnConnect: false,
      enableExtendedGiftInfo: false,
      enableWebsocketUpgrade: true,
      requestPollingIntervalMs: 1000,
      clientParams: {
        app_language: 'th-TH',
        webcast_language: 'th-TH'
      }
    });

    this.isConnected = false;
    this.pollInterval = null;
    this.setupEventListeners();
  }

  startRoomInfoPolling(roomId) {
    if (this.pollInterval) clearInterval(this.pollInterval);
    const roomKey = this.uniqueId.toLowerCase();

    const fetchStats = async () => {
      if (!this.isConnected || !roomId) return;
      try {
        const r = await this.connection.webClient.getJsonObjectFromWebcastApi('room/info/', { room_id: roomId });
        if (r && r.data) {
          const session = getOrCreateLiveSession(this.uniqueId);
          let changed = false;

          // 1. Viewer count from room/info
          if (r.data.user_count !== undefined) {
            const uCount = parseInt(r.data.user_count, 10);
            if (!isNaN(uCount) && uCount >= 0) {
              session.viewerCount = uCount;
              changed = true;
            }
          }

          // 2. Likes count from room/info
          const totalLikes = parseInt(r.data.like_count || r.data.stats?.like_count || r.data.stats?.digg_count || r.data.like_info?.total, 10);
          if (!isNaN(totalLikes) && totalLikes > 0 && totalLikes > session.totalLikes) {
            session.totalLikes = totalLikes;
            changed = true;
          }

          if (changed) {
            session.lastUpdated = Date.now();
            io.to(roomKey).emit('tiktok:roomStats', session);
          }
        }
      } catch (e) {}
    };

    // Run immediately and every 3 seconds
    fetchStats();
    this.pollInterval = setInterval(fetchStats, 3000);
  }

  setupEventListeners() {
    const conn = this.connection;
    const roomKey = this.uniqueId.toLowerCase();

    conn.on('connected', (state) => {
      this.isConnected = true;
      const session = getOrCreateLiveSession(this.uniqueId);
      session.roomId = state.roomId;
      session.isLive = true;
      session.lastUpdated = Date.now();

      console.log(`[TikTok] Connected to live room of @${this.uniqueId} (RoomId: ${state.roomId})`);
      io.to(roomKey).emit('tiktok:connected', {
        uniqueId: this.uniqueId,
        roomId: state.roomId,
        state
      });
      io.to(roomKey).emit('tiktok:roomStats', session);

      // Start periodic Webcast room/info polling for real-time viewers and likes
      this.startRoomInfoPolling(state.roomId);
    });

    conn.on('disconnected', (data) => {
      this.isConnected = false;
      if (this.pollInterval) clearInterval(this.pollInterval);
      console.log(`[TikTok] Disconnected from @${this.uniqueId}`);
      io.to(roomKey).emit('tiktok:disconnected', {
        uniqueId: this.uniqueId,
        message: data?.reason || 'Live stream disconnected'
      });
    });

    conn.on('streamEnd', (actionId) => {
      this.isConnected = false;
      if (this.pollInterval) clearInterval(this.pollInterval);
      console.log(`[TikTok] Stream ended for @${this.uniqueId}`);
      // Stream actually ended: clean up persistent session
      persistentLiveSessions.delete(roomKey);
      io.to(roomKey).emit('tiktok:streamEnd', {
        uniqueId: this.uniqueId,
        actionId
      });
    });

    // Chat comments
    conn.on('chat', (data) => {
      const user = data.user || {};
      const uniqueId = user.displayId || user.uniqueId || data.uniqueId || 'user';
      const nickname = user.nickname || data.nickname || uniqueId;
      const avatarUrl = user.avatarThumb?.urlListList?.[0] || 
                        user.avatarThumb?.urlList?.[0] || 
                        user.profileThumb?.urlListList?.[0] || 
                        data.profilePictureUrl || 
                        'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face';
      const rawComment = data.content || data.comment || '';
      const commentText = parseTikTokEmojis(rawComment);

      // Extract custom subscriber emotes if any
      const emotes = [];
      if (Array.isArray(data.emotes)) {
        data.emotes.forEach(e => {
          const imgUrl = e.emote?.image?.urlListList?.[0] || e.emote?.image?.urlList?.[0] || e.image?.urlListList?.[0];
          if (imgUrl) {
            emotes.push({
              place: e.placeInComment,
              url: imgUrl
            });
          }
        });
      }

      const chatItem = {
        id: data.msgId || `${Date.now()}_${Math.random()}`,
        uniqueId: uniqueId,
        nickname: nickname,
        userId: user.id || data.userId || '0',
        profilePictureUrl: avatarUrl,
        comment: commentText,
        emotes: emotes,
        isModerator: data.isModerator || user.userRole === 3 || false,
        isSubscriber: data.isSubscriber || false,
        isTopGifter: data.isTopGifter || false,
        userBadges: data.userBadges || [],
        timestamp: data.createTime ? parseInt(data.createTime) : Date.now()
      };
      io.to(roomKey).emit('tiktok:chat', chatItem);
    });

    // Custom Emote Message (WebcastEmoteChatMessage)
    conn.on('emote', (data) => {
      const user = data.user || {};
      const uniqueId = user.displayId || user.uniqueId || data.uniqueId || 'user';
      const nickname = user.nickname || data.nickname || uniqueId;
      const avatarUrl = user.avatarThumb?.urlListList?.[0] || 
                        user.avatarThumb?.urlList?.[0] || 
                        data.profilePictureUrl || 
                        'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face';
      const emoteUrl = data.emote?.image?.urlListList?.[0] || 
                       data.emote?.image?.urlList?.[0] || 
                       data.emoteImage?.urlListList?.[0] || 
                       data.emoteUrl || '';

      const chatItem = {
        id: data.msgId || `${Date.now()}_${Math.random()}`,
        uniqueId: uniqueId,
        nickname: nickname,
        userId: user.id || data.userId || '0',
        profilePictureUrl: avatarUrl,
        comment: '',
        emoteUrl: emoteUrl,
        isEmoteOnly: true,
        isModerator: data.isModerator || user.userRole === 3 || false,
        isSubscriber: true,
        isTopGifter: data.isTopGifter || false,
        timestamp: data.createTime ? parseInt(data.createTime) : Date.now()
      };
      io.to(roomKey).emit('tiktok:chat', chatItem);
    });

    // Gift event
    conn.on('gift', (data) => {
      const user = data.user || {};
      const uniqueId = user.displayId || user.uniqueId || data.uniqueId || 'user';
      const nickname = user.nickname || data.nickname || uniqueId;
      const avatarUrl = user.avatarThumb?.urlListList?.[0] || 
                        user.avatarThumb?.urlList?.[0] || 
                        data.profilePictureUrl || 
                        'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face';

      const giftName = data.giftDetails?.giftName || data.giftName || 'ของขวัญ';
      const diamondCost = (data.diamondCount || data.giftDetails?.diamondCount || 1) * (data.repeatCount || 1);

      const session = getOrCreateLiveSession(this.uniqueId);
      session.totalDiamonds += diamondCost;
      session.lastUpdated = Date.now();

      const giftItem = {
        id: data.msgId || `${Date.now()}_${Math.random()}`,
        uniqueId: uniqueId,
        nickname: nickname,
        profilePictureUrl: avatarUrl,
        giftId: data.giftId,
        giftName: giftName,
        giftPictureUrl: data.giftPictureUrl,
        diamondCount: data.diamondCount || 1,
        repeatCount: data.repeatCount || 1,
        repeatEnd: data.repeatEnd,
        groupId: data.groupId,
        totalDiamonds: session.totalDiamonds,
        timestamp: Date.now()
      };

      io.to(roomKey).emit('tiktok:gift', giftItem);
      io.to(roomKey).emit('tiktok:roomStats', session);
    });

    // Likes event
    conn.on('like', (data) => {
      const session = getOrCreateLiveSession(this.uniqueId);
      const totalLikesVal = parseInt(data.totalLikeCount || data.totalLikes || data.total, 10);
      if (!isNaN(totalLikesVal) && totalLikesVal > 0) {
        session.totalLikes = totalLikesVal;
      } else {
        const count = parseInt(data.likeCount || data.count || 1, 10);
        session.totalLikes += (isNaN(count) || count <= 0) ? 1 : count;
      }
      session.lastUpdated = Date.now();

      io.to(roomKey).emit('tiktok:like', {
        uniqueId: data.uniqueId,
        nickname: data.nickname,
        profilePictureUrl: data.profilePictureUrl,
        likeCount: data.likeCount || data.count || 1,
        totalLikes: session.totalLikes,
        timestamp: Date.now()
      });
      io.to(roomKey).emit('tiktok:roomStats', session);
    });

    // Room stats & viewer count
    conn.on('roomUser', (data) => {
      const session = getOrCreateLiveSession(this.uniqueId);
      const vCount = parseInt(data.viewerCount || data.total || data.user_count, 10);
      if (!isNaN(vCount)) {
        session.viewerCount = vCount;
      }
      session.lastUpdated = Date.now();

      io.to(roomKey).emit('tiktok:roomUser', {
        viewerCount: session.viewerCount,
        topViewers: data.topViewers || [],
        timestamp: Date.now()
      });
      io.to(roomKey).emit('tiktok:roomStats', session);
    });

    // Fallback: Decoded protobuf stream packets
    conn.on('decodedData', (method, data) => {
      const session = getOrCreateLiveSession(this.uniqueId);
      let updated = false;

      if (method === 'WebcastRoomUserSeqMessage' && data) {
        const vCount = parseInt(data.total || data.user_count || data.viewerCount, 10);
        if (!isNaN(vCount)) {
          session.viewerCount = vCount;
          updated = true;
        }
      } else if (method === 'WebcastLikeMessage' && data) {
        const total = parseInt(data.total, 10);
        if (!isNaN(total) && total > 0) {
          session.totalLikes = total;
          updated = true;
        } else if (data.count) {
          const c = parseInt(data.count, 10);
          if (!isNaN(c) && c > 0) {
            session.totalLikes += c;
            updated = true;
          }
        }
      }

      if (updated) {
        session.lastUpdated = Date.now();
        io.to(roomKey).emit('tiktok:roomStats', session);
      }
    });

    // Member joins
    conn.on('member', (data) => {
      const user = data.user || {};
      const uniqueId = user.displayId || user.uniqueId || data.uniqueId || 'user';
      const nickname = user.nickname || data.nickname || uniqueId;
      io.to(roomKey).emit('tiktok:member', {
        uniqueId,
        nickname,
        timestamp: Date.now()
      });
    });

    // Follow event
    conn.on('follow', (data) => {
      const user = data.user || {};
      const uniqueId = user.displayId || user.uniqueId || data.uniqueId || 'user';
      const nickname = user.nickname || data.nickname || uniqueId;

      const session = getOrCreateLiveSession(this.uniqueId);
      session.newFollowersCount += 1;
      session.lastUpdated = Date.now();

      io.to(roomKey).emit('tiktok:follow', {
        uniqueId,
        nickname,
        timestamp: Date.now()
      });
      io.to(roomKey).emit('tiktok:roomStats', session);
    });

    // Share event
    conn.on('share', (data) => {
      io.to(roomKey).emit('tiktok:share', {
        uniqueId: data.uniqueId,
        nickname: data.nickname,
        profilePictureUrl: data.profilePictureUrl,
        timestamp: Date.now()
      });
    });

    // Question event (TikTok Q&A)
    conn.on('questionNew', (data) => {
      io.to(roomKey).emit('tiktok:question', {
        questionId: data.questionId,
        questionText: data.questionText,
        uniqueId: data.uniqueId,
        nickname: data.nickname,
        timestamp: Date.now()
      });
    });

    // Error event
    conn.on('error', (err) => {
      console.error(`[TikTok Error] @${this.uniqueId}:`, err.message || err);
      io.to(roomKey).emit('tiktok:error', {
        uniqueId: this.uniqueId,
        message: err.message || 'TikTok connection error'
      });
    });
  }

  async connect() {
    try {
      const state = await this.connection.connect();
      return { success: true, state };
    } catch (err) {
      console.error(`[TikTok Connect Failed] @${this.uniqueId}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  disconnect() {
    try {
      this.connection.disconnect();
    } catch (e) {
      console.error('Error disconnecting:', e);
    }
    this.isConnected = false;
  }
}

// Socket.io Connection Management
io.on('connection', (socket) => {
  let currentTargetUser = null;

  socket.on('join_room', async ({ username }) => {
    if (!username) return;
    const cleanUser = username.replace(/^@/, '').trim().toLowerCase();

    // Leave previous room if any
    if (currentTargetUser && currentTargetUser !== cleanUser) {
      socket.leave(currentTargetUser);
    }

    currentTargetUser = cleanUser;
    socket.join(cleanUser);

    console.log(`[Socket] Client ${socket.id} joined room for @${cleanUser}`);

    // If it's a demo room, don't try connecting to TikTok live webcast
    if (cleanUser.startsWith('demo') || cleanUser === 'test') {
      socket.emit('tiktok:status', {
        status: 'connected',
        uniqueId: cleanUser,
        message: `เชื่อมต่อห้องจำลอง @${cleanUser} สำเร็จ (โหมด Simulator)`
      });
      return;
    }

    // Check if we already have an active connection to this user
    let handler = activeConnections.get(cleanUser);
    const session = getOrCreateLiveSession(cleanUser);

    if (!handler) {
      handler = new TikTokLiveHandler(cleanUser);
      activeConnections.set(cleanUser, handler);

      socket.emit('tiktok:status', {
        status: 'connecting',
        uniqueId: cleanUser,
        message: `กำลังเชื่อมต่อกับไลฟ์ของ @${cleanUser}...`
      });

      // Send persistent session stats right away
      socket.emit('tiktok:roomStats', session);

      const res = await handler.connect();
      if (!res.success) {
        socket.emit('tiktok:status', {
          status: 'error',
          uniqueId: cleanUser,
          message: `ไม่สามารถเชื่อมต่อได้: ${res.error || 'ห้องอาจไม่ได้กำลัง Live อยู่'}`
        });
      } else {
        socket.emit('tiktok:status', {
          status: 'connected',
          uniqueId: cleanUser,
          message: `เชื่อมต่อสำเร็จกับ @${cleanUser}`
        });
        socket.emit('tiktok:roomStats', session);
      }
    } else {
      // Send current state if already connected
      socket.emit('tiktok:status', {
        status: handler.isConnected ? 'connected' : 'connecting',
        uniqueId: cleanUser,
        message: handler.isConnected ? `เชื่อมต่อกับ @${cleanUser} อยู่แล้ว` : 'กำลังเชื่อมต่อ...'
      });

      socket.emit('tiktok:roomStats', session);
    }
  });

  socket.on('leave_room', ({ username }) => {
    const cleanUser = (username || currentTargetUser || '').replace(/^@/, '').trim().toLowerCase();
    if (cleanUser) {
      socket.leave(cleanUser);
      const room = io.sockets.adapter.rooms.get(cleanUser);
      if (!room || room.size === 0) {
        const handler = activeConnections.get(cleanUser);
        if (handler) {
          handler.disconnect();
          activeConnections.delete(cleanUser);
          console.log(`[TikTok] Closed live connection for @${cleanUser} (No more active clients)`);
        }
      }
    }
  });

  // Global demo gifters map for simulator
  const demoGifters = new Map();

  // Simulator event emitter from client to room
  socket.on('simulate_event', ({ eventType, data }) => {
    const roomKey = currentTargetUser || 'demo_streamer';

    switch (eventType) {
      case 'chat':
        io.to(roomKey).emit('tiktok:chat', {
          id: `sim_${Date.now()}`,
          uniqueId: data.uniqueId || 'sim_user',
          nickname: data.nickname || 'ผู้ชมใจดี (Simulated)',
          userId: 'sim_123',
          profilePictureUrl: data.profilePictureUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face',
          comment: data.comment || 'สวัสดีครับทุกคน! 🎉 ยินดีด้วยกับไลฟ์นี้นะครับ',
          isModerator: data.isModerator || false,
          isSubscriber: data.isSubscriber || false,
          isTopGifter: data.isTopGifter || false,
          userBadges: data.userBadges || [],
          timestamp: Date.now()
        });
        break;

      case 'gift': {
        const diamonds = data.diamondCount || 50;
        const repeat = data.repeatCount || 1;
        const total = diamonds * repeat;

        const senderId = data.uniqueId || 'sim_gifter';
        const sender = demoGifters.get(senderId) || {
          uniqueId: senderId,
          nickname: data.nickname || 'FC ตัวยง 💎',
          profilePictureUrl: data.profilePictureUrl || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&h=100&fit=crop&crop=face',
          totalDiamonds: 0,
          giftsCount: 0
        };
        sender.totalDiamonds += total;
        sender.giftsCount += repeat;
        demoGifters.set(senderId, sender);

        const sortedGifters = Array.from(demoGifters.values())
          .sort((a, b) => b.totalDiamonds - a.totalDiamonds)
          .slice(0, 10);
        io.to(roomKey).emit('tiktok:leaderboard', sortedGifters);

        io.to(roomKey).emit('tiktok:gift', {
          id: `sim_gift_${Date.now()}`,
          uniqueId: senderId,
          nickname: data.nickname || 'FC ตัวยง 💎',
          profilePictureUrl: data.profilePictureUrl || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&h=100&fit=crop&crop=face',
          giftId: data.giftId || 5655,
          giftName: data.giftName || 'Rose (กุหลาบ)',
          giftPictureUrl: data.giftPictureUrl || 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/5655~tplv-obj.png',
          diamondCount: diamonds,
          repeatCount: repeat,
          repeatEnd: true,
          groupId: Date.now(),
          timestamp: Date.now()
        });
        break;
      }

      case 'like':
        io.to(roomKey).emit('tiktok:like', {
          uniqueId: data.uniqueId || 'liker_user',
          nickname: data.nickname || 'คนชอบไลฟ์',
          profilePictureUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=face',
          likeCount: data.likeCount || 15,
          totalLikes: data.totalLikes || 520,
          timestamp: Date.now()
        });
        break;

      case 'member':
        io.to(roomKey).emit('tiktok:member', {
          uniqueId: data.uniqueId || 'new_viewer',
          nickname: data.nickname || 'ผู้ชมใหม่เพิ่งเข้ามา',
          profilePictureUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face',
          timestamp: Date.now()
        });
        break;

      case 'follow':
        io.to(roomKey).emit('tiktok:follow', {
          uniqueId: data.uniqueId || 'new_follower',
          nickname: data.nickname || 'ผู้ติดตามใหม่',
          profilePictureUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face',
          timestamp: Date.now()
        });
        break;
    }
  });

  socket.on('disconnect', () => {
    if (currentTargetUser) {
      socket.leave(currentTargetUser);
      const room = io.sockets.adapter.rooms.get(currentTargetUser);
      if (!room || room.size === 0) {
        // Disconnect tiktok connection after a 10s grace period if no clients reconnect
        setTimeout(() => {
          const checkRoom = io.sockets.adapter.rooms.get(currentTargetUser);
          if (!checkRoom || checkRoom.size === 0) {
            const handler = activeConnections.get(currentTargetUser);
            if (handler) {
              handler.disconnect();
              activeConnections.delete(currentTargetUser);
              console.log(`[TikTok] Garbage collected connection for @${currentTargetUser}`);
            }
          }
        }, 10000);
      }
    }
  });
});

// Mobile reader shortcuts
app.get(['/m', '/mobile', '/mobile.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Network IP discovery endpoint
const os = require('os');
app.get('/api/network-ip', (req, res) => {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ interface: name, address: net.address });
      }
    }
  }
  const preferred = addresses.find(a => /wi-fi|wlan|ethernet/i.test(a.interface)) || addresses[0];
  const ip = preferred ? preferred.address : 'localhost';
  res.json({
    ip,
    port: PORT,
    mobileUrl: `http://${ip}:${PORT}/mobile.html`,
    allInterfaces: addresses
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    activeRooms: Array.from(activeConnections.keys()),
    timestamp: Date.now()
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=============================================`);
  console.log(`🚀 TTChat Pro Server is running on port ${PORT}`);
  console.log(`📱 Local URL: http://localhost:${PORT}`);
  console.log(`🎥 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`=============================================`);
});
