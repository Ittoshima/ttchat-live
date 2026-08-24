// TTChat - Simplified Live Chat with Smart Device Detection
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  // State
  let socket = null;
  let currentUsername = '';
  let isAutoScroll = true;
  let wakeLock = null;
  let isMobile = false;

  // Views
  const viewConnect = document.getElementById('view-connect');
  const viewLive = document.getElementById('view-live');

  // Connect View Elements
  const inputUsername = document.getElementById('input-username');
  const btnStart = document.getElementById('btn-start');
  const connectError = document.getElementById('connect-error');
  const devicePillBadge = document.getElementById('device-pill-badge');

  // Live View Elements
  const displayUsername = document.getElementById('display-username');
  const displayViewers = document.getElementById('display-viewers');
  const liveDeviceTag = document.getElementById('live-device-tag');
  const chatFeed = document.getElementById('chat-feed');
  const readyCard = document.getElementById('ready-card');
  const btnScrollBottom = document.getElementById('btn-scroll-bottom');
  const btnFontToggle = document.getElementById('btn-font-toggle');
  const labelFontSize = document.getElementById('label-font-size');
  const btnFullscreen = document.getElementById('btn-fullscreen');
  const btnDisconnect = document.getElementById('btn-disconnect');
  const desktopShortcuts = document.getElementById('desktop-shortcuts');
  const btnShowQr = document.getElementById('btn-show-qr');

  // 4 Live Stats Elements
  const liveStatViewers = document.getElementById('live-stat-viewers');
  const liveStatFollowers = document.getElementById('live-stat-followers');
  const liveStatDiamonds = document.getElementById('live-stat-diamonds');
  const liveStatDiamondsThb = document.getElementById('live-stat-diamonds-thb');
  const liveStatLikes = document.getElementById('live-stat-likes');

  // Rate: 1 Diamond = ~0.0875 THB
  const DIAMOND_TO_THB_RATE = 0.0875;

  function formatTHB(diamonds) {
    const val = (diamonds || 0) * DIAMOND_TO_THB_RATE;
    return `≈ ฿${val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  // Stats Counters
  let totalNewFollowers = 0;
  let totalDiamonds = 0;
  let totalLikesCount = 0;

  function resetStats() {
    totalNewFollowers = 0;
    totalDiamonds = 0;
    totalLikesCount = 0;
    if (liveStatViewers) liveStatViewers.textContent = '0';
    if (liveStatFollowers) liveStatFollowers.textContent = '0';
    if (liveStatDiamonds) liveStatDiamonds.textContent = '0';
    if (liveStatDiamondsThb) liveStatDiamondsThb.textContent = '≈ ฿0.00';
    if (liveStatLikes) liveStatLikes.textContent = '0';
  }

  // =========================================
  // SMART DEVICE DETECTION
  // =========================================
  function detectDevice() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isMobileUA = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    const isTouchScreen = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isSmallScreen = window.innerWidth <= 850;

    isMobile = isMobileUA || (isTouchScreen && isSmallScreen);

    document.body.classList.remove('device-mobile', 'device-desktop');

    if (isMobile) {
      document.body.classList.add('device-mobile');
      if (devicePillBadge) devicePillBadge.textContent = '📱 ตรวจพบ: มือถือ / แท็บเล็ต';
      if (liveDeviceTag) liveDeviceTag.textContent = '📱 มือถือ';
      if (desktopShortcuts) desktopShortcuts.style.display = 'none';
      if (btnShowQr) btnShowQr.style.display = 'none';
    } else {
      document.body.classList.add('device-desktop');
      if (devicePillBadge) devicePillBadge.textContent = '💻 ตรวจพบ: คอมพิวเตอร์';
      if (liveDeviceTag) liveDeviceTag.textContent = '💻 คอมพิวเตอร์';
      if (desktopShortcuts) desktopShortcuts.style.display = 'block';
    }

    return isMobile;
  }

  // Initial detection
  detectDevice();
  window.addEventListener('resize', detectDevice);

  // =========================================
  // FONT SIZE CONTROLS & DEFAULTS
  // =========================================
  const fontClasses = ['font-m', 'font-l', 'font-xl', 'font-xxl'];
  const fontLabels = ['M', 'L', 'XL', 'XXL'];
  
  // Default: XL for mobile (easy reading from distance), L for desktop
  let currentFontIdx = isMobile ? 2 : 1;

  const savedSize = localStorage.getItem('ttchat_device_font');
  if (savedSize && fontClasses.includes(savedSize)) {
    currentFontIdx = fontClasses.indexOf(savedSize);
  }
  applyFontSize();

  function applyFontSize() {
    const cls = fontClasses[currentFontIdx];
    fontClasses.forEach(c => document.body.classList.remove(c));
    document.body.classList.add(cls);
    labelFontSize.textContent = fontLabels[currentFontIdx];
    localStorage.setItem('ttchat_device_font', cls);
  }

  btnFontToggle.addEventListener('click', () => {
    currentFontIdx = (currentFontIdx + 1) % fontClasses.length;
    applyFontSize();
  });

  // Fullscreen
  btnFullscreen.addEventListener('click', toggleFullscreen);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(e => console.warn(e));
    } else {
      document.exitFullscreen().catch(e => console.warn(e));
    }
  }

  // Screen Wake Lock (Always Awake on Mobile)
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.warn('WakeLock error:', err);
      }
    }
  }

  // Audio Beep for alerts
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  function playAlertChime(freq = 587.33, duration = 0.15) {
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
  }

  // Colors for authors
  const colorMap = new Map();
  function getAuthorColorClass(name) {
    if (!colorMap.has(name)) {
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i);
      const idx = Math.abs(hash) % 6;
      colorMap.set(name, `color-${idx}`);
    }
    return colorMap.get(name);
  }

  // Stats Persistence Helper
  function saveLocalStats(user) {
    if (!user) return;
    try {
      const statsObj = {
        viewers: liveStatViewers ? liveStatViewers.textContent : '0',
        followers: totalNewFollowers,
        diamonds: totalDiamonds,
        likes: totalLikesCount,
        timestamp: Date.now()
      };
      localStorage.setItem(`ttchat_stats_${user.toLowerCase()}`, JSON.stringify(statsObj));
    } catch (e) {}
  }

  function loadLocalStats(user) {
    if (!user) return;
    try {
      const raw = localStorage.getItem(`ttchat_stats_${user.toLowerCase()}`);
      if (!raw) return;
      const data = JSON.parse(raw);
      // If saved in last 6 hours, restore
      if (Date.now() - (data.timestamp || 0) < 21600000) {
        if (data.viewers && liveStatViewers) liveStatViewers.textContent = data.viewers;
        if (data.followers !== undefined) {
          totalNewFollowers = data.followers;
          if (liveStatFollowers) liveStatFollowers.textContent = totalNewFollowers.toLocaleString();
        }
        if (data.diamonds !== undefined) {
          totalDiamonds = data.diamonds;
          if (liveStatDiamonds) liveStatDiamonds.textContent = totalDiamonds.toLocaleString();
          if (liveStatDiamondsThb) liveStatDiamondsThb.textContent = formatTHB(totalDiamonds);
        }
        if (data.likes !== undefined) {
          totalLikesCount = data.likes;
          if (liveStatLikes) {
            if (totalLikesCount >= 10000) {
              liveStatLikes.textContent = `${(totalLikesCount / 1000).toFixed(1)}k`;
            } else {
              liveStatLikes.textContent = totalLikesCount.toLocaleString();
            }
          }
        }
      }
    } catch (e) {}
  }

  // =========================================
  // SOCKET & TIKTOK LIVE CONNECTION
  // =========================================
  function initSocket() {
    if (socket) return;
    socket = io();

    socket.on('tiktok:status', (data) => {
      if (data.status === 'connecting') {
        btnStart.disabled = true;
        btnStart.innerHTML = `<i data-lucide="loader-2" class="spin"></i><span>กำลังเชื่อมต่อ...</span>`;
        if (window.lucide) lucide.createIcons();
        connectError.style.display = 'none';
      } else if (data.status === 'error') {
        btnStart.disabled = false;
        btnStart.innerHTML = `<i data-lucide="play"></i><span>เชื่อมต่อ &amp; เริ่มอ่านแชท</span>`;
        if (window.lucide) lucide.createIcons();
        connectError.textContent = data.message || 'ไม่สามารถเชื่อมต่อได้';
        connectError.style.display = 'block';
      }
    });

    socket.on('tiktok:connected', (data) => {
      // 1. SWITCH TO LIVE VIEW
      viewConnect.classList.remove('active');
      viewLive.classList.add('active');
      displayUsername.textContent = `@${data.uniqueId}`;
      loadLocalStats(data.uniqueId);
      requestWakeLock();
      if (window.lucide) lucide.createIcons();
    });

    // AUTHORITATIVE ROOM STATS SYNC (อัปเดตสถิติตลอดการไลฟ์)
    socket.on('tiktok:roomStats', (session) => {
      if (!session) return;
      if (session.viewerCount !== undefined) {
        if (liveStatViewers) liveStatViewers.textContent = session.viewerCount.toLocaleString();
        if (displayViewers) displayViewers.textContent = `👀 ${session.viewerCount.toLocaleString()} คนดู`;
      }
      if (session.newFollowersCount !== undefined) {
        totalNewFollowers = session.newFollowersCount;
        if (liveStatFollowers) liveStatFollowers.textContent = totalNewFollowers.toLocaleString();
      }
      if (session.totalDiamonds !== undefined) {
        totalDiamonds = session.totalDiamonds;
        if (liveStatDiamonds) liveStatDiamonds.textContent = totalDiamonds.toLocaleString();
        if (liveStatDiamondsThb) liveStatDiamondsThb.textContent = formatTHB(totalDiamonds);
      }
      if (session.totalLikes !== undefined) {
        totalLikesCount = session.totalLikes;
        if (liveStatLikes) {
          if (totalLikesCount >= 10000) {
            liveStatLikes.textContent = `${(totalLikesCount / 1000).toFixed(1)}k`;
          } else {
            liveStatLikes.textContent = totalLikesCount.toLocaleString();
          }
        }
      }
      saveLocalStats(currentUsername);
    });

    // 1. LIVE VIEWERS
    socket.on('tiktok:roomUser', (data) => {
      if (data.viewerCount !== undefined) {
        if (displayViewers) displayViewers.textContent = `👀 ${data.viewerCount.toLocaleString()} คนดู`;
        if (liveStatViewers) liveStatViewers.textContent = data.viewerCount.toLocaleString();
        saveLocalStats(currentUsername);
      }
    });

    // 2. TOTAL LIKES
    socket.on('tiktok:like', (data) => {
      if (data.totalLikes !== undefined) {
        totalLikesCount = data.totalLikes;
      } else if (data.likeCount) {
        totalLikesCount += data.likeCount;
      }
      if (liveStatLikes) {
        if (totalLikesCount >= 10000) {
          liveStatLikes.textContent = `${(totalLikesCount / 1000).toFixed(1)}k`;
        } else {
          liveStatLikes.textContent = totalLikesCount.toLocaleString();
        }
      }
      saveLocalStats(currentUsername);
    });

    // 3. LIVE CHAT COMMENTS
    socket.on('tiktok:chat', (item) => {
      addChatCard(item);
    });

    // 4. GIFT ALERTS & DIAMONDS
    socket.on('tiktok:gift', (gift) => {
      addGiftAlert(gift);
      if (gift.totalDiamonds !== undefined) {
        totalDiamonds = gift.totalDiamonds;
      } else {
        const giftDiamonds = (gift.diamondCount || 1) * (gift.repeatCount || 1);
        totalDiamonds += giftDiamonds;
      }
      if (liveStatDiamonds) liveStatDiamonds.textContent = totalDiamonds.toLocaleString();
      if (liveStatDiamondsThb) liveStatDiamondsThb.textContent = formatTHB(totalDiamonds);
      saveLocalStats(currentUsername);
      playAlertChime(659.25, 0.2); // E5 chime
    });

    // 5. FOLLOW ALERTS & NEW FOLLOWERS
    socket.on('tiktok:follow', (data) => {
      addFollowAlert(data);
      totalNewFollowers++;
      if (liveStatFollowers) liveStatFollowers.textContent = totalNewFollowers.toLocaleString();
      saveLocalStats(currentUsername);
      playAlertChime(783.99, 0.2); // G5 chime
    });

    // STREAM ENDED EVENT: เมื่อสตรีมจบจริงเท่านั้น ถึงจะล้างสถิติ
    socket.on('tiktok:streamEnd', (data) => {
      try {
        localStorage.removeItem(`ttchat_stats_${(data.uniqueId || currentUsername).toLowerCase()}`);
      } catch (e) {}
      showToast('การไลฟ์สตรีมจบลงแล้ว', 'info');
    });

    socket.on('tiktok:disconnected', () => {
      // เมื่อหลุดการเชื่อมต่อ ไม่ล้างยอด ยอดยังคงอยู่เหมือนเดิม
    });
  }

  // TikTok Native Emoji Shortcode Map
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
    shrug: '🤷',
    shout: '🗣️',
    relieved: '😌',
    neutral: '😐',
    expressionless: '😑',
    smirk: '😏',
    unamused: '😒',
    grimacing: '😬',
    pensive: '😔',
    sleepy: '😪',
    zipper_mouth: '🤐'
  };

  function parseTikTokEmojis(text) {
    if (!text) return '';
    return text.replace(/\[([a-zA-Z0-9_-]+)\]/g, (match, tag) => {
      const lower = tag.toLowerCase();
      return TIKTOK_EMOJI_MAP[lower] || match;
    });
  }

  // Emoji Only Regex Checker
  function isOnlyEmojis(str) {
    if (!str || !str.trim()) return false;
    const clean = str.replace(/\s+/g, '');
    if (!clean) return false;
    const emojiRegex = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200d\uFE0F\uFE0E]+$/u;
    return emojiRegex.test(clean) && clean.length <= 16;
  }

  // Add Chat Message
  function addChatCard(item) {
    if (readyCard) readyCard.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'chat-card';
    const colorClass = getAuthorColorClass(item.uniqueId || item.nickname || 'user');
    const timeStr = new Date(item.timestamp || Date.now()).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

    let contentHtml = '';

    // If it's a TikTok custom sticker / emote
    if (item.emoteUrl) {
      contentHtml = `
        <div class="chat-emote-wrapper">
          <img src="${escapeHtml(item.emoteUrl)}" class="chat-emote-img" alt="TikTok Sticker" onerror="this.style.display='none'">
        </div>
      `;
    } else {
      // Parse TikTok shortcodes like [laughcry] -> 😂
      const rawText = item.comment || '';
      const parsedComment = parseTikTokEmojis(rawText);
      const isEmojiOnly = isOnlyEmojis(parsedComment);
      const emojiClass = isEmojiOnly ? 'jumbo-emoji' : '';

      contentHtml = `<div class="card-text ${emojiClass}">${escapeHtml(parsedComment)}</div>`;
    }

    card.innerHTML = `
      <div class="card-top">
        <span class="card-author ${colorClass}">${escapeHtml(item.nickname || item.uniqueId)}</span>
        <span class="card-time">${timeStr}</span>
      </div>
      ${contentHtml}
    `;

    chatFeed.appendChild(card);
    trimFeed();
    autoScrollIfNeeded();
  }

  // Add Gift Alert
  function addGiftAlert(gift) {
    if (readyCard) readyCard.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'gift-card-alert';
    const giftName = gift.giftName || 'ของขวัญ';
    const diamonds = (gift.diamondCount || 1) * (gift.repeatCount || 1);
    const thbVal = (diamonds * DIAMOND_TO_THB_RATE).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    card.innerHTML = `
      <div class="gift-alert-left">
        <span class="gift-alert-icon">🎁</span>
        <div class="gift-alert-info">
          <span class="gift-alert-sender">${escapeHtml(gift.nickname || gift.uniqueId)}</span>
          <span class="gift-alert-gift">ส่ง ${escapeHtml(giftName)} (${diamonds} 💎 ≈ ฿${thbVal})</span>
        </div>
      </div>
      <span class="gift-alert-combo">x${gift.repeatCount || 1}</span>
    `;

    chatFeed.appendChild(card);
    trimFeed();
    autoScrollIfNeeded();
  }

  // Add Follow Alert
  function addFollowAlert(data) {
    if (readyCard) readyCard.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'follow-card-alert';

    card.innerHTML = `
      <span class="follow-alert-icon">💖</span>
      <span class="follow-alert-text"><strong>${escapeHtml(data.nickname || data.uniqueId)}</strong> เริ่มติดตามคุณแล้ว! 🎉</span>
    `;

    chatFeed.appendChild(card);
    trimFeed();
    autoScrollIfNeeded();
  }

  function trimFeed() {
    if (chatFeed.children.length > 200) {
      chatFeed.removeChild(chatFeed.firstElementChild);
    }
  }

  function autoScrollIfNeeded() {
    if (isAutoScroll) {
      chatFeed.scrollTop = chatFeed.scrollHeight;
    } else {
      btnScrollBottom.style.display = 'flex';
    }
  }

  chatFeed.addEventListener('scroll', () => {
    const isAtBottom = chatFeed.scrollHeight - chatFeed.scrollTop - chatFeed.clientHeight < 60;
    isAutoScroll = isAtBottom;
    if (isAtBottom) btnScrollBottom.style.display = 'none';
  });

  btnScrollBottom.addEventListener('click', () => {
    isAutoScroll = true;
    chatFeed.scrollTop = chatFeed.scrollHeight;
    btnScrollBottom.style.display = 'none';
  });

  // Start Connect Action
  btnStart.addEventListener('click', startConnect);
  inputUsername.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startConnect();
  });

  function startConnect() {
    const raw = inputUsername.value.trim();
    if (!raw) {
      connectError.textContent = 'กรุณากรอกชื่อ TikTok username';
      connectError.style.display = 'block';
      return;
    }

    const clean = raw.replace(/^@/, '').trim().toLowerCase();
    currentUsername = clean;

    initSocket();
    socket.emit('join_room', { username: clean });
  }

  // Disconnect Action
  btnDisconnect.addEventListener('click', () => {
    if (socket && currentUsername) {
      socket.emit('leave_room', { username: currentUsername });
    }
    viewLive.classList.remove('active');
    viewConnect.classList.add('active');
    btnStart.disabled = false;
    btnStart.innerHTML = `<i data-lucide="play"></i><span>เชื่อมต่อ &amp; เริ่มอ่านแชท</span>`;
    if (window.lucide) lucide.createIcons();
    chatFeed.innerHTML = '';
    if (readyCard) chatFeed.appendChild(readyCard);
  });

  // =========================================
  // DESKTOP KEYBOARD SHORTCUTS
  // =========================================
  document.addEventListener('keydown', (e) => {
    // Only listen when in Live View
    if (!viewLive.classList.contains('active')) return;

    if (e.code === 'Space') {
      e.preventDefault();
      isAutoScroll = !isAutoScroll;
      if (isAutoScroll) {
        chatFeed.scrollTop = chatFeed.scrollHeight;
        btnScrollBottom.style.display = 'none';
      } else {
        btnScrollBottom.style.display = 'flex';
      }
    } else if (e.key === '+' || e.key === '=') {
      currentFontIdx = Math.min(fontClasses.length - 1, currentFontIdx + 1);
      applyFontSize();
    } else if (e.key === '-' || e.key === '_') {
      currentFontIdx = Math.max(0, currentFontIdx - 1);
      applyFontSize();
    } else if (e.key.toLowerCase() === 'f') {
      toggleFullscreen();
    }
  });

  // Auto connect if username in URL
  const urlParams = new URLSearchParams(window.location.search);
  const qUser = urlParams.get('username') || urlParams.get('user');
  if (qUser) {
    inputUsername.value = qUser;
    startConnect();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[m]);
  }
});
