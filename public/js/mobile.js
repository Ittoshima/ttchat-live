// TTChat Pro - Mobile Reader Logic
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  const urlParams = new URLSearchParams(window.location.search);
  let currentTargetUser = urlParams.get('username') || urlParams.get('user') || '';

  // State
  let socket = null;
  let isAutoScroll = true;
  let wakeLock = null;
  let isTtsEnabled = false;

  // Color generator for authors
  const colorMap = new Map();
  function getAuthorColorClass(name) {
    if (!colorMap.has(name)) {
      const idx = Math.abs(hashCode(name)) % 6;
      colorMap.set(name, `color-${idx}`);
    }
    return colorMap.get(name);
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  // DOM Elements
  const liveIndicator = document.getElementById('live-indicator');
  const displayChannelName = document.getElementById('display-channel-name');
  const displayViewers = document.getElementById('display-viewers');
  const mobileChatFeed = document.getElementById('mobile-chat-feed');
  const welcomeCard = document.getElementById('welcome-card');
  const giftStrip = document.getElementById('gift-strip');
  const giftStripText = document.getElementById('gift-strip-text');
  const btnResumeScroll = document.getElementById('btn-resume-scroll');

  // Controls
  const btnWakeLock = document.getElementById('btn-wakelock');
  const btnFontSize = document.getElementById('btn-font-size');
  const fontSizeLabel = document.getElementById('font-size-label');
  const btnFullscreen = document.getElementById('btn-fullscreen');
  const btnChannelModal = document.getElementById('btn-channel-modal');

  // Welcome Form
  const mobileUsernameInput = document.getElementById('mobile-username-input');
  const btnMobileConnect = document.getElementById('btn-mobile-connect');

  // Modal
  const channelModal = document.getElementById('channel-modal');
  const btnCloseChannelModal = document.getElementById('btn-close-channel-modal');
  const modalUsernameInput = document.getElementById('modal-username-input');
  const btnModalConnect = document.getElementById('btn-modal-connect');
  const mobileTtsToggle = document.getElementById('mobile-tts-toggle');
  const sizeOptBtns = document.querySelectorAll('.size-opt-btn');

  // Font Size Cycle: medium -> large -> xlarge -> xxlarge
  const fontSizes = ['medium', 'large', 'xlarge', 'xxlarge'];
  const fontLabels = { medium: 'M', large: 'L', xlarge: 'XL', xxlarge: 'XXL' };
  let currentFontIdx = 1; // 'large' by default

  // Load saved preferences
  const savedFontSize = localStorage.getItem('ttchat_font_size');
  if (savedFontSize && fontSizes.includes(savedFontSize)) {
    currentFontIdx = fontSizes.indexOf(savedFontSize);
  }
  applyFontSize();

  function applyFontSize() {
    const sizeName = fontSizes[currentFontIdx];
    document.body.className = `font-size-${sizeName}`;
    fontSizeLabel.textContent = fontLabels[sizeName];
    localStorage.setItem('ttchat_font_size', sizeName);

    sizeOptBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.size === sizeName);
    });
  }

  btnFontSize.addEventListener('click', () => {
    currentFontIdx = (currentFontIdx + 1) % fontSizes.length;
    applyFontSize();
  });

  sizeOptBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const size = btn.dataset.size;
      currentFontIdx = fontSizes.indexOf(size);
      applyFontSize();
    });
  });

  // Screen Wake Lock API (Keep phone awake)
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        btnWakeLock.classList.add('active');
        wakeLock.addEventListener('release', () => {
          btnWakeLock.classList.remove('active');
        });
      } catch (err) {
        console.warn('WakeLock error:', err);
      }
    }
  }

  btnWakeLock.addEventListener('click', async () => {
    if (wakeLock !== null) {
      await wakeLock.release();
      wakeLock = null;
      btnWakeLock.classList.remove('active');
    } else {
      await requestWakeLock();
    }
  });

  // Re-acquire wake lock on visibility change
  document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
      await requestWakeLock();
    }
  });

  // Request wake lock initially
  requestWakeLock();

  // Fullscreen
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(e => console.warn(e));
    } else {
      document.exitFullscreen().catch(e => console.warn(e));
    }
  });

  // Socket Connection
  function initSocket() {
    if (socket) return;
    socket = io();

    socket.on('connect', () => {
      if (currentTargetUser) {
        joinRoom(currentTargetUser);
      }
    });

    socket.on('tiktok:connected', (data) => {
      liveIndicator.classList.add('active');
      displayChannelName.textContent = `@${data.uniqueId}`;
    });

    socket.on('tiktok:status', (data) => {
      if (data.status === 'connected') {
        liveIndicator.classList.add('active');
        displayChannelName.textContent = `@${data.uniqueId}`;
      } else if (data.status === 'connecting') {
        displayChannelName.textContent = `กำลังเชื่อมต่อ...`;
      } else {
        liveIndicator.classList.remove('active');
        displayChannelName.textContent = `@${data.uniqueId || 'ไม่ได้เชื่อมต่อ'}`;
      }
    });

    socket.on('tiktok:roomUser', (data) => {
      if (data.viewerCount !== undefined) {
        displayViewers.textContent = `👀 ${data.viewerCount.toLocaleString()} คน`;
      }
    });

    socket.on('tiktok:chat', (item) => {
      addChatCard(item);
      if (isTtsEnabled) {
        speakMobile(item.comment);
      }
    });

    socket.on('tiktok:gift', (gift) => {
      showGiftStrip(gift);
    });

    socket.on('tiktok:disconnected', () => {
      liveIndicator.classList.remove('active');
    });
  }

  function joinRoom(user) {
    const clean = user.replace(/^@/, '').trim().toLowerCase();
    currentTargetUser = clean;
    displayChannelName.textContent = `@${clean}`;
    welcomeCard.style.display = 'none';

    // Update URL query string without reloading
    const newUrl = `${window.location.pathname}?username=${encodeURIComponent(clean)}`;
    window.history.replaceState({ path: newUrl }, '', newUrl);

    initSocket();
    socket.emit('join_room', { username: clean });
  }

  function addChatCard(item) {
    if (welcomeCard) {
      welcomeCard.style.display = 'none';
    }

    const card = document.createElement('div');
    card.className = 'mobile-chat-card';
    if (item.isModerator) card.classList.add('highlight-mod');
    if (item.isTopGifter) card.classList.add('highlight-gift');

    let badgesHtml = '';
    if (item.isModerator) badgesHtml += `<span class="author-badge author-badge-mod">MOD</span>`;
    if (item.isSubscriber) badgesHtml += `<span class="author-badge author-badge-sub">SUB</span>`;
    if (item.isTopGifter) badgesHtml += `<span class="author-badge author-badge-gifter">GIFTER</span>`;

    const colorClass = getAuthorColorClass(item.uniqueId || item.nickname || 'user');
    const timeStr = new Date(item.timestamp || Date.now()).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
      <div class="chat-card-top">
        <div class="chat-card-author ${colorClass}">
          <span>${escapeHtml(item.nickname || item.uniqueId)}</span>
          ${badgesHtml}
        </div>
        <span class="chat-card-time">${timeStr}</span>
      </div>
      <div class="chat-card-text">${escapeHtml(item.comment)}</div>
    `;

    mobileChatFeed.appendChild(card);

    // Limit cards in feed to prevent mobile memory bloat
    if (mobileChatFeed.children.length > 150) {
      mobileChatFeed.removeChild(mobileChatFeed.firstElementChild);
    }

    if (isAutoScroll) {
      mobileChatFeed.scrollTop = mobileChatFeed.scrollHeight;
    } else {
      btnResumeScroll.style.display = 'flex';
    }
  }

  let giftStripTimer = null;
  function showGiftStrip(gift) {
    giftStripText.textContent = `${gift.nickname || gift.uniqueId} ส่ง ${gift.giftName} (x${gift.repeatCount || 1})`;
    giftStrip.style.display = 'flex';

    if (giftStripTimer) clearTimeout(giftStripTimer);
    giftStripTimer = setTimeout(() => {
      giftStrip.style.display = 'none';
    }, 4000);
  }

  // Detect user scroll interaction
  mobileChatFeed.addEventListener('scroll', () => {
    const isAtBottom = mobileChatFeed.scrollHeight - mobileChatFeed.scrollTop - mobileChatFeed.clientHeight < 60;
    isAutoScroll = isAtBottom;
    if (isAtBottom) {
      btnResumeScroll.style.display = 'none';
    }
  });

  btnResumeScroll.addEventListener('click', () => {
    isAutoScroll = true;
    mobileChatFeed.scrollTop = mobileChatFeed.scrollHeight;
    btnResumeScroll.style.display = 'none';
  });

  // Mobile Welcome Form
  btnMobileConnect.addEventListener('click', () => {
    const u = mobileUsernameInput.value.trim();
    if (u) joinRoom(u);
  });

  mobileUsernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const u = mobileUsernameInput.value.trim();
      if (u) joinRoom(u);
    }
  });

  // Channel Switch Modal
  btnChannelModal.addEventListener('click', () => {
    modalUsernameInput.value = currentTargetUser;
    channelModal.classList.add('active');
  });

  btnCloseChannelModal.addEventListener('click', () => {
    channelModal.classList.remove('active');
  });

  btnModalConnect.addEventListener('click', () => {
    const u = modalUsernameInput.value.trim();
    if (u) {
      joinRoom(u);
      channelModal.classList.remove('active');
    }
  });

  // Mobile TTS
  mobileTtsToggle.addEventListener('change', (e) => {
    isTtsEnabled = e.target.checked;
  });

  function speakMobile(text) {
    if (!('speechSynthesis' in window) || !text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'th-TH';
    utterance.rate = 1.2;
    window.speechSynthesis.speak(utterance);
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

  // Auto-connect if username in URL
  if (currentTargetUser) {
    joinRoom(currentTargetUser);
  } else {
    initSocket();
  }
});
