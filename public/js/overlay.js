// TTChat Pro - OBS Overlay Logic
document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const username = urlParams.get('username') || urlParams.get('user') || 'demo_streamer';
  const cleanUser = username.replace(/^@/, '').trim().toLowerCase();

  const chatContainer = document.getElementById('overlay-chat-container');
  const giftBanner = document.getElementById('overlay-gift-banner');
  const giftImg = document.getElementById('overlay-gift-img');
  const giftUser = document.getElementById('overlay-gift-user');
  const giftName = document.getElementById('overlay-gift-name');
  const giftCount = document.getElementById('overlay-gift-count');

  const socket = io();

  socket.on('connect', () => {
    console.log(`[OBS Overlay] Connected to server, joining room: @${cleanUser}`);
    socket.emit('join_room', { username: cleanUser });
  });

  // Incoming Chat
  socket.on('tiktok:chat', (data) => {
    addOverlayMessage(data);
  });

  // Incoming Gift
  socket.on('tiktok:gift', (gift) => {
    showGiftAlert(gift);
    if (gift.diamondCount >= 100 && typeof confetti === 'function') {
      confetti({
        particleCount: 60,
        spread: 60,
        origin: { y: 0.2 }
      });
    }
  });

  function addOverlayMessage(item) {
    const card = document.createElement('div');
    card.className = 'overlay-chat-item';

    let badgesHtml = '';
    if (item.isModerator) {
      badgesHtml += `<span class="overlay-badge overlay-badge-mod">MOD</span>`;
    }
    if (item.isSubscriber) {
      badgesHtml += `<span class="overlay-badge overlay-badge-sub">SUB</span>`;
    }

    const avatarUrl = item.profilePictureUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face';

    card.innerHTML = `
      <img src="${avatarUrl}" class="overlay-avatar" onerror="this.src='https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face'" alt="avatar">
      <div class="overlay-body">
        <div class="overlay-header">
          <span class="overlay-nickname">${escapeHtml(item.nickname || item.uniqueId)}</span>
          ${badgesHtml}
        </div>
        <div class="overlay-message">${escapeHtml(item.comment)}</div>
      </div>
    `;

    chatContainer.appendChild(card);

    // Limit visible messages in overlay to prevent screen clutter
    if (chatContainer.children.length > 8) {
      const old = chatContainer.firstElementChild;
      old.style.opacity = '0';
      setTimeout(() => old.remove(), 400);
    }

    // Auto-remove after 25 seconds of inactivity
    setTimeout(() => {
      if (card && card.parentNode) {
        card.style.opacity = '0';
        setTimeout(() => {
          if (card && card.parentNode) card.remove();
        }, 500);
      }
    }, 25000);
  }

  let giftHideTimer = null;
  function showGiftAlert(gift) {
    giftImg.src = gift.giftPictureUrl || 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/5655~tplv-obj.png';
    giftUser.textContent = gift.nickname || gift.uniqueId;
    giftName.textContent = `ส่ง ${gift.giftName || 'ของขวัญ'}`;
    giftCount.textContent = `x${gift.repeatCount || 1}`;

    giftBanner.classList.add('show');

    if (giftHideTimer) clearTimeout(giftHideTimer);
    giftHideTimer = setTimeout(() => {
      giftBanner.classList.remove('show');
    }, 4500);
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
