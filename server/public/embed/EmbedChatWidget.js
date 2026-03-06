/**
 * GYS Portal AI – Chat Widget
 * ────────────────────────────────────────────────────────────────
 * Tambahkan script ini di website manapun untuk menampilkan
 * floating chat button dengan avatar AI.
 *
 * CARA PAKAI — satu baris di HTML:
 *
 *   <script
 *     src="https://chat.gyssteel.com/embed/widget.js"
 *     data-bot-id="BOT_ID_DISINI"
 *     data-theme="light"
 *     data-accent="#007857"
 *     data-position="bottom-right"
 *     defer
 *   ></script>
 *
 * PARAMETER (semua opsional kecuali data-bot-id):
 *   data-bot-id       – ID bot (wajib)
 *   data-theme        – "light" | "dark"  (default: "light")
 *   data-accent       – warna hex          (default: "#007857")
 *   data-position     – "bottom-right" | "bottom-left"  (default: "bottom-right")
 *   data-offset-x     – jarak horizontal dari tepi, px   (default: "24")
 *   data-offset-y     – jarak vertikal dari bawah, px    (default: "24")
 *   data-width        – lebar iframe, px                 (default: "400")
 *   data-height       – tinggi iframe, px                (default: "600")
 *   data-label        – teks tooltip tombol             (default: nama bot / "Chat dengan AI")
 *   data-open         – "true" untuk buka otomatis      (default: "false")
 *   data-brand        – "false" untuk sembunyikan brand  (default: "true")
 *   data-base-url     – override URL server             (default: auto dari src script)
 * ────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // ── 1. Baca config dari tag <script> ──────────────────────────
  const scriptEl = document.currentScript ||
    (function () {
      const scripts = document.querySelectorAll('script[data-bot-id]');
      return scripts[scripts.length - 1];
    })();

  if (!scriptEl) return;

  const cfg = {
    botId:    scriptEl.getAttribute('data-bot-id') || '',
    theme:    scriptEl.getAttribute('data-theme')    || 'light',
    accent:   scriptEl.getAttribute('data-accent')   || '#007857',
    position: scriptEl.getAttribute('data-position') || 'bottom-right',
    offsetX:  parseInt(scriptEl.getAttribute('data-offset-x')  || '24', 10),
    offsetY:  parseInt(scriptEl.getAttribute('data-offset-y')  || '24', 10),
    width:    parseInt(scriptEl.getAttribute('data-width')      || '400', 10),
    height:   parseInt(scriptEl.getAttribute('data-height')     || '600', 10),
    label:    scriptEl.getAttribute('data-label')    || '',
    autoOpen: scriptEl.getAttribute('data-open')     === 'true',
    brand:    scriptEl.getAttribute('data-brand')    !== 'false',
    baseUrl:  scriptEl.getAttribute('data-base-url') || (() => {
      // Auto-detect dari URL script
      try {
        const src = scriptEl.getAttribute('src') || '';
        if (src.startsWith('http')) return new URL(src).origin;
      } catch (_) {}
      return window.location.origin;
    })(),
  };

  if (!cfg.botId) {
    console.warn('[GYS Widget] data-bot-id tidak diisi.');
    return;
  }

  // ── 2. Cegah duplikasi ────────────────────────────────────────
  if (document.getElementById('gys-chat-widget-root')) return;

  const isDark   = cfg.theme === 'dark';
  const isLeft   = cfg.position === 'bottom-left';
  const accent   = cfg.accent;

  // ── 3. Inject CSS ─────────────────────────────────────────────
  const style = document.createElement('style');
  style.id = 'gys-chat-widget-style';
  style.textContent = `
    #gys-chat-widget-root * { box-sizing: border-box; margin: 0; padding: 0; }

    /* Container */
    #gys-chat-widget-root {
      position: fixed;
      ${isLeft ? `left: ${cfg.offsetX}px;` : `right: ${cfg.offsetX}px;`}
      bottom: ${cfg.offsetY}px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: ${isLeft ? 'flex-start' : 'flex-end'};
      gap: 12px;
      pointer-events: none;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    }

    /* iframe panel */
    #gys-chat-panel {
      pointer-events: all;
      width: ${cfg.width}px;
      height: 0;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 24px 64px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.12);
      border: 1px solid rgba(255,255,255,0.1);
      opacity: 0;
      transform: scale(0.92) translateY(16px);
      transform-origin: ${isLeft ? 'bottom left' : 'bottom right'};
      transition:
        height 0s 0.22s,
        opacity 0.22s cubic-bezier(.4,0,.2,1),
        transform 0.22s cubic-bezier(.4,0,.2,1);
      will-change: opacity, transform;
    }
    #gys-chat-panel.gys-open {
      height: ${cfg.height}px;
      opacity: 1;
      transform: scale(1) translateY(0);
      transition:
        height 0s 0s,
        opacity 0.22s cubic-bezier(.4,0,.2,1),
        transform 0.22s cubic-bezier(.4,0,.2,1);
    }
    #gys-chat-panel iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
      border-radius: 20px;
    }

    /* Floating button */
    #gys-chat-btn {
      pointer-events: all;
      position: relative;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: ${accent};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px ${accent}66, 0 2px 8px rgba(0,0,0,0.18);
      transition: transform 0.2s cubic-bezier(.34,1.56,.64,1), box-shadow 0.2s;
      outline: none;
      overflow: hidden;
      padding: 0;
    }
    #gys-chat-btn:hover {
      transform: scale(1.10);
      box-shadow: 0 8px 28px ${accent}88, 0 2px 12px rgba(0,0,0,0.22);
    }
    #gys-chat-btn:active {
      transform: scale(0.96);
    }

    /* Avatar inside button */
    #gys-chat-btn .gys-avatar-img {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      object-fit: cover;
      display: block;
      transition: opacity 0.2s;
    }
    #gys-chat-btn .gys-avatar-fallback {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.5px;
    }

    /* Close icon overlay (shown when open) */
    #gys-chat-btn .gys-close-icon {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: ${accent};
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transform: rotate(-90deg) scale(0.7);
      transition: opacity 0.2s, transform 0.25s cubic-bezier(.34,1.56,.64,1);
      pointer-events: none;
    }
    #gys-chat-btn.gys-open .gys-close-icon {
      opacity: 1;
      transform: rotate(0deg) scale(1);
    }
    #gys-chat-btn.gys-open .gys-avatar-img,
    #gys-chat-btn.gys-open .gys-avatar-fallback {
      opacity: 0;
    }

    /* Pulse ring animation */
    #gys-chat-btn::before {
      content: '';
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      border: 2px solid ${accent};
      opacity: 0;
      animation: gys-pulse 2.4s ease-out infinite;
    }
    #gys-chat-btn.gys-open::before {
      animation: none;
    }
    @keyframes gys-pulse {
      0%   { opacity: 0.6; transform: scale(1); }
      100% { opacity: 0;   transform: scale(1.5); }
    }

    /* Notification badge */
    #gys-chat-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: #EF4444;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      display: none;
      align-items: center;
      justify-content: center;
      line-height: 1;
      border: 2px solid #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    }
    #gys-chat-badge.gys-visible {
      display: flex;
    }

    /* Tooltip */
    #gys-chat-tooltip {
      position: absolute;
      ${isLeft ? 'left: 72px;' : 'right: 72px;'}
      bottom: 50%;
      transform: translateY(50%);
      background: ${isDark ? '#1F2937' : '#111827'};
      color: #F9FAFB;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      padding: 6px 12px;
      border-radius: 8px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }
    #gys-chat-tooltip::after {
      content: '';
      position: absolute;
      ${isLeft ? 'left: -5px;' : 'right: -5px;'}
      top: 50%;
      transform: translateY(-50%);
      border: 5px solid transparent;
      ${isLeft
        ? `border-right-color: ${isDark ? '#1F2937' : '#111827'};`
        : `border-left-color: ${isDark ? '#1F2937' : '#111827'};`
      }
    }
    #gys-chat-btn:hover #gys-chat-tooltip {
      opacity: 1;
    }

    /* Mobile responsiveness */
    @media (max-width: 480px) {
      #gys-chat-panel {
        position: fixed !important;
        ${isLeft ? 'left: 0 !important;' : 'right: 0 !important;'}
        bottom: 0 !important;
        width: 100vw !important;
        border-radius: 20px 20px 0 0 !important;
        transform-origin: bottom center !important;
      }
      #gys-chat-panel.gys-open {
        height: 90vh !important;
      }
    }
  `;
  document.head.appendChild(style);

  // ── 4. Buat DOM ───────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'gys-chat-widget-root';

  // Panel iframe
  const panel = document.createElement('div');
  panel.id = 'gys-chat-panel';

  const iframe = document.createElement('iframe');
  const iframeUrl = new URL(
    `/embed/${cfg.botId}?theme=${cfg.theme}&accent=${encodeURIComponent(accent)}&brand=${cfg.brand}`,
    cfg.baseUrl
  ).href;
  iframe.src = iframeUrl;
  iframe.title = 'Chat AI';
  iframe.allow = 'clipboard-write';
  panel.appendChild(iframe);

  // Button
  const btn = document.createElement('button');
  btn.id = 'gys-chat-btn';
  btn.setAttribute('aria-label', 'Buka chat AI');
  btn.setAttribute('aria-expanded', 'false');

  // Avatar fallback default (huruf)
  const fallbackDiv = document.createElement('div');
  fallbackDiv.className = 'gys-avatar-fallback';
  fallbackDiv.textContent = '?';
  fallbackDiv.id = 'gys-avatar-fallback';

  // Avatar image (hidden until loaded)
  const avatarImg = document.createElement('img');
  avatarImg.className = 'gys-avatar-img';
  avatarImg.id = 'gys-avatar-img';
  avatarImg.style.display = 'none';
  avatarImg.alt = '';

  // Close icon overlay
  const closeIcon = document.createElement('div');
  closeIcon.className = 'gys-close-icon';
  closeIcon.innerHTML = `
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>
  `;

  // Notification badge
  const badge = document.createElement('span');
  badge.id = 'gys-chat-badge';
  badge.textContent = '';

  // Tooltip
  const tooltip = document.createElement('span');
  tooltip.id = 'gys-chat-tooltip';
  tooltip.textContent = cfg.label || 'Chat dengan AI';

  btn.appendChild(fallbackDiv);
  btn.appendChild(avatarImg);
  btn.appendChild(closeIcon);
  btn.appendChild(badge);
  btn.appendChild(tooltip);

  root.appendChild(panel);
  root.appendChild(btn);
  document.body.appendChild(root);

  // ── 5. State & toggle ─────────────────────────────────────────
  let isOpen = false;

  function openChat() {
    isOpen = true;
    panel.classList.add('gys-open');
    btn.classList.add('gys-open');
    btn.setAttribute('aria-expanded', 'true');
    badge.classList.remove('gys-visible');
    badge.textContent = '';
  }

  function closeChat() {
    isOpen = false;
    panel.classList.remove('gys-open');
    btn.classList.remove('gys-open');
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', function () {
    if (isOpen) closeChat(); else openChat();
  });

  // Keyboard: Escape menutup
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) closeChat();
  });

  // ── 6. Fetch bot info → set avatar & label ────────────────────
  function fetchBotInfo() {
    fetch(`${cfg.baseUrl}/api/embed/bot/${cfg.botId}`, { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (bot) {
        if (!bot) return;

        // Update tooltip label
        if (!cfg.label) {
          tooltip.textContent = 'Chat dengan ' + bot.name;
        }

        // Update aria-label
        btn.setAttribute('aria-label', 'Chat dengan ' + (bot.name || 'AI'));

        // Set avatar
        const avatarPath = bot.avatarUrl || bot.avatar;
        if (avatarPath) {
          let url = avatarPath;
          if (!url.startsWith('http') && !url.startsWith('/')) {
            url = cfg.baseUrl + '/api/files/' + url;
          } else if (url.startsWith('/')) {
            url = cfg.baseUrl + url;
          }
          avatarImg.src = url;
          avatarImg.onload = function () {
            fallbackDiv.style.display = 'none';
            avatarImg.style.display = 'block';
          };
          avatarImg.onerror = function () {
            // fallback to initials
            setFallbackInitial(bot.name);
          };
        } else {
          setFallbackInitial(bot.name);
        }
      })
      .catch(function () {
        // Server tidak bisa dicapai sebelum login — tampilkan default
        setFallbackInitial('AI');
      });
  }

  function setFallbackInitial(name) {
    if (name) {
      const words = name.trim().split(/\s+/);
      const initials = words.length >= 2
        ? (words[0][0] + words[1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase();
      fallbackDiv.textContent = initials;
    } else {
      fallbackDiv.textContent = 'AI';
    }
    fallbackDiv.style.display = 'flex';
    avatarImg.style.display = 'none';
  }

  fetchBotInfo();

  // ── 7. Public API (window.GYSChatWidget) ──────────────────────
  window.GYSChatWidget = {
    open:  openChat,
    close: closeChat,
    toggle: function () { if (isOpen) closeChat(); else openChat(); },
    notify: function (count) {
      if (!isOpen) {
        badge.textContent = count > 9 ? '9+' : String(count || '');
        badge.classList.toggle('gys-visible', count > 0);
      }
    },
    destroy: function () {
      root.remove();
      style.remove();
      delete window.GYSChatWidget;
    },
  };

  // ── 8. Auto open ──────────────────────────────────────────────
  if (cfg.autoOpen) {
    setTimeout(openChat, 600);
  }

  // ── 9. PostMessage API (opsional dari dalam iframe) ───────────
  window.addEventListener('message', function (e) {
    if (e.origin !== cfg.baseUrl) return;
    if (e.data && e.data.type === 'GYS_CHAT_CLOSE') closeChat();
    if (e.data && e.data.type === 'GYS_CHAT_NOTIFY') {
      window.GYSChatWidget.notify(e.data.count || 0);
    }
  });

})();
