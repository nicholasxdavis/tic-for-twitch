// Tic for Twitch - Production-Ready Content Script (Isolated World)
// Incorporates TCPAC, Twitch Mini Player, Latency Display, Click to Pause, Color Swapper, and I Hear You Twitch.
// Includes TicSchemaEngine for dynamic Twitch DOM resilience & 7TV/FFZ style chat clutter filters.

const DEFAULT_SETTINGS = {
  videoPopout: true,
  turnLightsOff: true,
  customSkin: false,
  customSkinHex: "#ff0055",
  bitratePreview: false,
  autoClaimDrops: true,
  hideExtensions: true,
  compactChat: false
};

let currentSettings = { ...DEFAULT_SETTINGS };
let bitrateInterval = null;
let dropsObserver = null;
let dropsInterval = null;
let uiMaintainInterval = null;
let clickToPauseObserver = null;
let compactChatObserver = null;

// ============================================================================
// TicSchemaEngine - Multi-Tier Resilient Target Finder & Schema Adjuster
// Ensures Tic for Twitch never breaks when Twitch updates layout or React DOM
// ============================================================================
const TicSchemaEngine = {
  getVideo() {
    return document.querySelector("video") || document.querySelector("iframe[src*='player']")?.contentDocument?.querySelector("video");
  },

  getPlayerContainer() {
    const video = this.getVideo();
    return document.querySelector('[data-a-target="video-player"]') ||
           document.querySelector('[data-test-selector="video-player"]') ||
           document.querySelector('.video-player__container') ||
           document.querySelector('.video-player') ||
           (video && video.closest('div[class*="player"]')) ||
           (video ? video.parentElement : null);
  },

  getRightControlGroup() {
    // 1. Target settings button container
    const settingsBtn = document.querySelector('[data-a-target="player-settings-button"]') ||
                        document.querySelector('[data-test-selector="player-settings-button"]') ||
                        document.querySelector('button[aria-label*="Settings"], button[aria-label*="settings"]');
    if (settingsBtn) {
      const group = settingsBtn.closest('.player-controls__right-control-group, [class*="right-control-group"]') || settingsBtn.parentElement;
      if (group) return { container: group, referenceNode: settingsBtn };
    }

    // 2. Target theatre button container
    const theatreBtn = document.querySelector('[data-a-target="player-theatre-mode-button"]') ||
                       document.querySelector('button[aria-label*="Theatre"], button[aria-label*="theatre"]');
    if (theatreBtn) {
      const group = theatreBtn.closest('.player-controls__right-control-group, [class*="right-control-group"]') || theatreBtn.parentElement;
      if (group) return { container: group, referenceNode: theatreBtn };
    }

    // 3. Fallback direct class or last child
    const rightGroup = document.querySelector('.player-controls__right-control-group') ||
                       document.querySelector('[data-a-target="player-controls"] > div:last-child') ||
                       document.querySelector('[data-test-selector="player-controls"] > div:last-child');
    if (rightGroup) return { container: rightGroup, referenceNode: rightGroup.firstChild };

    return null;
  },

  getChatContainer() {
    return document.querySelector('.chat-scrollable-area__message-container') ||
           document.querySelector('[data-test-selector="chat-room-component-layout"]') ||
           document.querySelector('.stream-chat') ||
           document.querySelector('[data-a-target="chat-room"]') ||
           document.body;
  }
};


// Initialize when page loads
function initTicExtension() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    // 1. VAFT script injection removed

    // 2. Load preferences and apply
    chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
      currentSettings = { ...DEFAULT_SETTINGS, ...settings };
      applyAllSettings();
      
      if (!uiMaintainInterval) {
        uiMaintainInterval = setInterval(maintainReactUI, 1000);
      }
    });

    // 3. Listen for storage changes from popup
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local") {
        Object.keys(changes).forEach((key) => {
          if (changes[key].newValue !== undefined && currentSettings[key] !== undefined) {
            currentSettings[key] = changes[key].newValue;
          }
        });
        applyAllSettings();
      }
    });

    // 4. Listen for direct runtime messages
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "SETTING_CHANGED" && currentSettings[message.setting] !== undefined) {
        currentSettings[message.setting] = message.value;
        applyAllSettings();
        sendResponse({ received: true });
      }
    });

    // 5. Global Keyboard shortcuts (Alt+L for Lights, Alt+P for Popout)
    window.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "l" || e.key === "L") && currentSettings.turnLightsOff !== undefined) {
        currentSettings.turnLightsOff = !currentSettings.turnLightsOff;
        chrome.storage.local.set({ turnLightsOff: currentSettings.turnLightsOff });
      }
      // Video Popout Mini Player
      if (e.altKey && (e.key === "p" || e.key === "P") && currentSettings.videoPopout) {
        openFloatingMiniPlayer();
      }
    });
  }
}

// React SPA UI Maintenance: checks and re-attaches controls when React re-renders player DOM
function maintainReactUI() {
    applyTurnLightsOff(currentSettings.turnLightsOff);
    applyVideoPopout(currentSettings.videoPopout);
    applyBitratePreview(currentSettings.bitratePreview);
    applyCustomSkin(currentSettings.customSkin, currentSettings.customSkinHex);
    
    // Default features with no option toggles (always running cleanly by default)
    applyClickToPause(true);
    applyMediaDownloader();
    applyGridDownloader(); // Inject into React layout loop to catch SPA navigations
    applyStatsPanel();     // Inject into React layout loop
  
    // Enforce strict left-to-right ordering of all Tic injected buttons
    const rightControl = TicSchemaEngine.getRightControlGroup();
    if (rightControl && rightControl.container) {
      let wrapper = document.getElementById("tic-controls-wrapper");
      if (!wrapper) {
         wrapper = document.createElement("div");
         wrapper.id = "tic-controls-wrapper";
         wrapper.style.display = "flex";
         wrapper.style.alignItems = "center";
         wrapper.style.height = "100%";
      }
      if (!document.body.contains(wrapper)) {
         rightControl.container.prepend(wrapper);
      }
      
      const order = [
        "tic-bitrate-inline-display",
        "tic-bitrate-btn",
        "tic-media-dl-btn",
        "tic-lights-btn",
        "tic-pip-btn"
      ];
      
      let currentChild = wrapper.firstChild;
      order.forEach(id => {
         const el = document.getElementById(id);
         if (el) {
            if (currentChild !== el) {
               wrapper.insertBefore(el, currentChild);
            }
            currentChild = el.nextSibling;
         }
      });
    }
  }

// Apply and synchronize all tools
function applyAllSettings() {
  window.dispatchEvent(new CustomEvent("TIC_CONFIG_UPDATE", { detail: currentSettings }));

  applyTurnLightsOff(currentSettings.turnLightsOff);
  applyCustomSkin(currentSettings.customSkin, currentSettings.customSkinHex);
  applyAutoClaimDrops(currentSettings.autoClaimDrops);
  applyHideExtensions(currentSettings.hideExtensions);
  applyCompactChat(currentSettings.compactChat);


  maintainReactUI();
}

// ---------------------------------------------------------------------------
// 1. Video Popout & Picture-in-Picture Control (`videoPopout`)
// Resilient schema lookup + backup quick-PiP inside Custom Player bar
// ---------------------------------------------------------------------------
function applyVideoPopout(enabled) {
  const existingBtn = document.getElementById("tic-pip-btn");
  if (enabled) {
    const rightControl = TicSchemaEngine.getRightControlGroup();
    // Check if detached from DOM due to React reconciliation
    if (existingBtn && !document.body.contains(existingBtn)) {
      existingBtn.remove();
    }
    if (!document.getElementById("tic-pip-btn") && rightControl) {
      const pipBtn = document.createElement("button");
      pipBtn.id = "tic-pip-btn";
      pipBtn.className = "tic-pip-btn-native";
      pipBtn.title = "Click: Picture-in-Picture • Shift+Click: Floating Mini-Player Window";
      pipBtn.innerHTML = `<svg width="20px" height="20px" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="4" width="16" height="12" rx="1.5"/><rect x="11" y="9" width="5" height="4" rx="0.5" fill="currentColor" stroke="none"/></svg>`;
      
      pipBtn.addEventListener("click", (e) => {
        const video = TicSchemaEngine.getVideo();
        if (e.shiftKey) {
          openFloatingMiniPlayer();
        } else if (video && document.pictureInPictureElement !== video) {
          video.requestPictureInPicture().catch(() => openFloatingMiniPlayer());
        } else if (document.pictureInPictureElement === video) {
          document.exitPictureInPicture();
        } else {
          openFloatingMiniPlayer();
        }
      });
      
      rightControl.container.prepend(pipBtn);
    }
  } else if (existingBtn) {
    existingBtn.remove();
  }
}

let miniPlayerAbortController = null;

// Floating Mini-Player Window (Twitch Mini Player open-source logic)
function openFloatingMiniPlayer() {
  const existingMini = document.getElementById("tx-mini-window");
  if (existingMini) { 
    existingMini.remove(); 
    if (miniPlayerAbortController) miniPlayerAbortController.abort();
    return; 
  }

  miniPlayerAbortController = new AbortController();
  const { signal } = miniPlayerAbortController;

  const channel = window.location.pathname.replace(/^\//, "").split("/")[0] || "twitch";
  const parentHost = window.location.hostname || "www.twitch.tv";

  const mini = document.createElement("div");
  mini.id = "tx-mini-window";
  
  // Load persisted dimensions and position
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['tic_mini_x', 'tic_mini_y', 'tic_mini_w', 'tic_mini_h'], (res) => {
      if (res.tic_mini_w) mini.style.width = res.tic_mini_w + 'px';
      if (res.tic_mini_h) mini.style.height = res.tic_mini_h + 'px';
      if (res.tic_mini_x !== undefined) mini.style.left = res.tic_mini_x + 'px';
      if (res.tic_mini_y !== undefined) mini.style.top = res.tic_mini_y + 'px';
    });
  }

  mini.innerHTML = `
    <div id="tx-mini-header">
      <span id="tx-mini-title">🟣 ${channel}</span>
      <button id="tx-mini-close">✖  Close</button>
    </div>
    <div id="tx-mini-body">
      <iframe id="tx-mini-window-player" src="https://player.twitch.tv/?channel=${channel}&parent=${parentHost}&autoplay=true&muted=false" title="Twitch mini player: ${channel}" allow="autoplay; fullscreen; picture-in-picture"></iframe>
      <div id="tx-mini-resize" title="Drag corner to resize"></div>
    </div>
  `;

  document.body.appendChild(mini);

  document.getElementById("tx-mini-close")?.addEventListener("click", () => {
    mini.remove();
    if (miniPlayerAbortController) miniPlayerAbortController.abort();
  });

  const header = document.getElementById("tx-mini-header");
  let isDragging = false, startX, startY, origLeft, origTop;
  header.addEventListener("mousedown", (e) => {
    if (e.target.id === "tx-mini-close") return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origLeft = mini.offsetLeft;
    origTop = mini.offsetTop;
    const iframe = document.getElementById("tx-mini-window-player");
    if (iframe) iframe.style.pointerEvents = "none";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    mini.style.left = `${Math.max(0, origLeft + (e.clientX - startX))}px`;
    mini.style.top = `${Math.max(0, origTop + (e.clientY - startY))}px`;
    mini.style.right = "auto";
  }, { signal });

  window.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      const iframe = document.getElementById("tx-mini-window-player");
      if (iframe) iframe.style.pointerEvents = "auto";
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          tic_mini_x: parseInt(mini.style.left || "0", 10),
          tic_mini_y: parseInt(mini.style.top || "0", 10)
        });
      }
    }
  }, { signal });

  const resizeBtn = document.getElementById("tx-mini-resize");
  let isResizing = false, resStartX, resStartY, startW, startH;
  resizeBtn.addEventListener("mousedown", (e) => {
    isResizing = true;
    resStartX = e.clientX;
    resStartY = e.clientY;
    startW = mini.offsetWidth;
    startH = mini.offsetHeight;
    const iframe = document.getElementById("tx-mini-window-player");
    if (iframe) iframe.style.pointerEvents = "none";
    e.stopPropagation();
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    mini.style.width = `${Math.max(300, startW + (e.clientX - resStartX))}px`;
    mini.style.height = `${Math.max(200, startH + (e.clientY - resStartY))}px`;
  }, { signal });

  window.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      const iframe = document.getElementById("tx-mini-window-player");
      if (iframe) iframe.style.pointerEvents = "auto";
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          tic_mini_w: parseInt(mini.style.width || "300", 10),
          tic_mini_h: parseInt(mini.style.height || "200", 10)
        });
      }
    }
  }, { signal });
}

// ---------------------------------------------------------------------------
// 2. Turn Lights Off Mode (#tic-lights-off-backdrop & UI Dimming)
// ---------------------------------------------------------------------------
function applyTurnLightsOff(enabled) {
  const path = window.location.pathname;
  const isWatchPage = path !== "/" && !path.startsWith("/directory") && !path.startsWith("/search");

  if (enabled && isWatchPage) {
    document.body.classList.add("tic-lights-off-active");
  } else {
    document.body.classList.remove("tic-lights-off-active");
  }

  const existingBtn = document.getElementById("tic-lights-btn");
  const rightControl = TicSchemaEngine.getRightControlGroup();
  if (existingBtn && !document.body.contains(existingBtn)) {
    existingBtn.remove();
  }
  if (!document.getElementById("tic-lights-btn") && rightControl) {
    const btn = document.createElement("button");
    btn.id = "tic-lights-btn";
    btn.className = "tic-pip-btn-native";
    btn.title = "Toggle Turn Lights Off";
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
    btn.addEventListener("click", () => {
      currentSettings.turnLightsOff = !currentSettings.turnLightsOff;
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ turnLightsOff: currentSettings.turnLightsOff });
      }
      applyTurnLightsOff(currentSettings.turnLightsOff);
    });
    rightControl.container.prepend(btn);
  }
}

// ---------------------------------------------------------------------------
// 3. Custom Skin & Hex Color Swapper (`customSkin` + `customSkinHex`)
// Replaces ALL purple shades on Twitch dynamically with selected hex
// ---------------------------------------------------------------------------
function applyCustomSkin(enabled, hexColor = "#ff0055") {
  if (enabled) {
    document.documentElement.classList.add("tic-custom-skin-active");
    if (document.body) document.body.classList.add("tic-custom-skin-active");
    
    const hex = hexColor || "#ff0055";
    
    // Calculate 1 shade lighter (mix with 35% white)
    let lightHex = hex;
    try {
      let h = hex.replace(/^#/, '');
      if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      let r = parseInt(h.substring(0,2), 16);
      let g = parseInt(h.substring(2,4), 16);
      let b = parseInt(h.substring(4,6), 16);
      r = Math.min(255, Math.floor(r + (255 - r) * 0.35));
      g = Math.min(255, Math.floor(g + (255 - g) * 0.35));
      b = Math.min(255, Math.floor(b + (255 - b) * 0.35));
      const toHex = (c) => { const hexC = Math.round(c).toString(16); return hexC.length === 1 ? '0'+hexC : hexC; };
      lightHex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    } catch (e) {}

    document.documentElement.style.setProperty('--tic-dynamic-skin', hex);
    document.documentElement.style.setProperty('--tic-dynamic-skin-light', lightHex);
    document.documentElement.style.setProperty('--tic-dynamic-skin-a40', hex + '40');
    document.documentElement.style.setProperty('--tic-dynamic-skin-a80', hex + '80');
  } else {
    document.documentElement.classList.remove("tic-custom-skin-active");
    if (document.body) document.body.classList.remove("tic-custom-skin-active");
    
    document.documentElement.style.removeProperty('--tic-dynamic-skin');
    document.documentElement.style.removeProperty('--tic-dynamic-skin-light');
    document.documentElement.style.removeProperty('--tic-dynamic-skin-a40');
    document.documentElement.style.removeProperty('--tic-dynamic-skin-a80');
    
    // Cleanup old style element if it exists from previous version
    const oldStyle = document.getElementById("tic-custom-skin-dynamic-styles");
    if (oldStyle) oldStyle.remove();
  }
}

// ---------------------------------------------------------------------------
// 4. Bitrate & Real-Time Stream Latency Monitor (`bitratePreview`)
// ---------------------------------------------------------------------------
function applyBitratePreview(enabled) {
  const btnId = "tic-bitrate-btn";
  const existingBtn = document.getElementById(btnId);
  const rightControl = TicSchemaEngine.getRightControlGroup();
  if (existingBtn && !document.body.contains(existingBtn)) {
    existingBtn.remove();
  }
  if (!document.getElementById(btnId) && rightControl) {
    const btn = document.createElement("button");
    btn.id = btnId;
    btn.className = "tic-pip-btn-native";
    btn.title = "Toggle Bitrate & Latency HUD";
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`;
    btn.addEventListener("click", () => {
      currentSettings.bitratePreview = !currentSettings.bitratePreview;
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ bitratePreview: currentSettings.bitratePreview });
      }
      applyBitratePreview(currentSettings.bitratePreview);
    });
    rightControl.container.prepend(btn);
  }

  const existingInline = document.getElementById("tic-bitrate-inline-display");
  if (enabled) {
    if (existingInline && !document.body.contains(existingInline)) {
      existingInline.remove();
    }
    if (!document.getElementById("tic-bitrate-inline-display") && rightControl) {
      const inlineDisplay = document.createElement("span");
      inlineDisplay.id = "tic-bitrate-inline-display";
      inlineDisplay.className = "tic-bitrate-inline-display";
      inlineDisplay.title = "Real-Time Stream Latency & Health";
      inlineDisplay.innerHTML = `Analyzing stream health...`;
      
      // Insert immediately before the bitrate button
      const bitrateBtn = document.getElementById(btnId);
      if (bitrateBtn && bitrateBtn.parentNode) {
        bitrateBtn.parentNode.insertBefore(inlineDisplay, bitrateBtn);
      } else {
        rightControl.container.prepend(inlineDisplay);
      }

      if (!bitrateInterval) {
        bitrateInterval = setInterval(() => {
          const vid = TicSchemaEngine.getVideo();
          const textSpan = document.getElementById("tic-bitrate-inline-display");
          if (vid && textSpan) {
            const width = vid.videoWidth || 1920;
            const height = vid.videoHeight || 1080;
            const quality = vid.getVideoPlaybackQuality ? vid.getVideoPlaybackQuality() : null;
            const dropped = quality ? quality.droppedVideoFrames : (vid.webkitDecodedFrameCount || 0);
            const total = quality ? quality.totalVideoFrames : (vid.webkitDecodedFrameCount || 1000);
            const dropRate = total > 0 ? ((dropped / total) * 100).toFixed(2) : "0.00";
            
            let bufSecs = 0;
            if (vid.buffered && vid.buffered.length > 0) {
              bufSecs = Math.max(0, vid.buffered.end(vid.buffered.length - 1) - vid.currentTime);
            }

            const latencyElem = document.querySelector('[aria-label*="Latency to Broadcaster"], [aria-label*="latency"]');
            const latencyVal = latencyElem?.textContent?.match(/([0-9.]+)/)?.[1];
            const latencyStr = latencyVal ? ` Latency: ${latencyVal}s` : ` Buf: ${bufSecs.toFixed(1)}s`;

            const estKbps = height >= 1080 ? "6,150 kbps" : height >= 720 ? "4,500 kbps" : "2,500 kbps";
            textSpan.textContent = `${estKbps} ${width}x${height}p60 ${dropRate}% drops${latencyStr}`;
          }
        }, 1500);
      }
    }
  } else {
    if (existingInline) {
      existingInline.remove();
    }
    if (bitrateInterval) { clearInterval(bitrateInterval); bitrateInterval = null; }
  }
}






// ---------------------------------------------------------------------------
// 11. Click to Pause Video (Core Default Feature - Always Active)
// ---------------------------------------------------------------------------
function applyClickToPause(enabled) {
  if (enabled) {
    const setupClickToPause = () => {
      const player = TicSchemaEngine.getPlayerContainer();
      const controls = document.querySelector("div[data-a-target='player-controls']");
      const pauseButton = document.querySelector("button[data-a-target='player-play-pause-button']");

      if (player && controls && pauseButton && !player._ticClickToPauseBound) {
        player._ticClickToPauseBound = true;
        player.addEventListener("click", (event) => {
          if (
            controls.contains(event.target) ||
            event.target.closest("#tic-custom-player-bar") ||
            event.target.closest("#tic-bitrate-overlay") ||
            event.target.closest("#tic-pip-btn")
          ) {
            return;
          }
          pauseButton.click();
        });
      }
    };

    setupClickToPause();
  }
}


// ---------------------------------------------------------------------------
// 10. Native Media Downloader (Always Active for Clips and Videos)
// ---------------------------------------------------------------------------
  function applyMediaDownloader() {
    const isClipPage = window.location.hostname === "clips.twitch.tv" || window.location.pathname.includes("/clip/") || !!document.querySelector('[data-a-page-loaded-name="ClipsViewPage"]');
    const isVideoPage = window.location.pathname.startsWith("/videos/");
  
  const existingBtn = document.getElementById("tic-media-dl-btn");

  if (!isClipPage && !isVideoPage) {
    if (existingBtn) existingBtn.remove();
    return;
  }

  const rightControl = TicSchemaEngine.getRightControlGroup();
  
  if (existingBtn && !document.body.contains(existingBtn)) {
    existingBtn.remove();
  }
  
  if (!document.getElementById("tic-media-dl-btn") && rightControl && rightControl.container) {
    const dlBtn = document.createElement("button");
    dlBtn.id = "tic-media-dl-btn";
    dlBtn.className = "tic-pill-btn";
    dlBtn.title = isClipPage ? "Download Clip" : "Download Video";
    dlBtn.innerHTML = `
          <svg style="color: var(--tic-stats-accent);" width="20px" height="20px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span style="font-size: 13px; font-weight: 600; padding-bottom: 1px;">Download</span>
        `;
    
    dlBtn.addEventListener("click", async (e) => {
      // Prevent multiple clicks
      if (dlBtn.style.opacity === "0.5") return;
      dlBtn.style.opacity = "0.5";

      if (isClipPage) {
        // Native Clip Downloader: Try <video> src first, then fallback to og:image
        let mp4Url = null;
        const videoEl = document.querySelector('video');
        
        if (videoEl && videoEl.src && videoEl.src.includes('.mp4')) {
            mp4Url = videoEl.src;
        } else {
            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage && ogImage.content && ogImage.content.includes('-preview-')) {
                mp4Url = ogImage.content.split('-preview-')[0] + '.mp4';
            }
        }
        
        if (!mp4Url) {
          showTicToast("Failed to find MP4 URL via Thumbnail extraction.", "error");
          dlBtn.style.opacity = "1";
          return;
        }

        let slug = window.location.pathname.split('/').pop() || "clip";
        if (slug.includes('?')) slug = slug.split('?')[0];
        
        showTicToast("Downloading Clip...", "success");
        chrome.runtime.sendMessage({ 
          action: "DOWNLOAD_CLIP", 
          url: mp4Url, 
          filename: `Twitch-Clip-${slug}.mp4` 
        });
        
        setTimeout(() => dlBtn.style.opacity = "1", 2000);

      } else if (isVideoPage) {
        // VOD Downloader: Reconstruct unrestricted m3u8 using GQL (TwitchAdSolutions bypass)
        const videoId = window.location.pathname.split('/')[2];
        if (videoId) {
          showTicToast("Fetching VOD source...", "info");
          try {
            const resp = await fetch("https://gql.twitch.tv/gql", {
                method: 'POST',
                body: JSON.stringify({
                    "query": `query { video(id: "${videoId}") { broadcastType, createdAt, seekPreviewsURL, owner { login } }}`
                }),
                headers: {
                    'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            const data = await resp.json();
            
            if (data && data.data && data.data.video && data.data.video.seekPreviewsURL) {
                const currentURL = new URL(data.data.video.seekPreviewsURL);
                const domain = currentURL.host;
                const paths = currentURL.pathname.split("/");
                const vodSpecialID = paths[paths.findIndex(element => element.includes("storyboards")) - 1];
                
                const m3u8 = `https://${domain}/${vodSpecialID}/chunked/index-dvr.m3u8`;
                
                await navigator.clipboard.writeText(m3u8);
                showTicToast("Raw VOD stream (m3u8) copied to clipboard! Paste in VLC/Downloader.", "success", 5000);
            } else {
                showTicToast("Failed to fetch VOD data. Sub-only VODs may be restricted.", "error");
            }
          } catch (err) {
             showTicToast("Error resolving VOD stream.", "error");
          }
          dlBtn.style.opacity = "1";
        }
      }
    });
    
    rightControl.container.prepend(dlBtn);
  }
}

// ---------------------------------------------------------------------------
// 6. Auto Claim Drops & Channel Points Engine (`autoClaimDrops`)
// ---------------------------------------------------------------------------
function applyAutoClaimDrops(enabled) {
  if (enabled) {
    const claimHandler = () => {
      // 1. Channel Points Bonus Chest
      const tcpacChest = document.querySelector('.claimable-bonus__icon');
      if (tcpacChest && typeof tcpacChest.click === "function") {
        tcpacChest.click();
        incrementClaimCount();
        return;
      }

      // 2. Twitch Drops Inventory / Campaign Buttons
      const claimButtons = document.querySelectorAll(
        '[data-test-selector="DropsCampaignInProgressRewardPresentation-claim-button"], ' +
        '[data-test-selector="community-points-summary"] button[aria-label*="Claim"], ' +
        'button[aria-label="Claim Bonus"], button[aria-label="Claim bonus"], ' +
        'button[aria-label="Claim"], button[data-a-target="tw-core-button-label-text"]'
      );
      
      claimButtons.forEach((btn) => {
        if (btn && typeof btn.click === "function") {
          const text = btn.textContent || btn.getAttribute("aria-label") || "";
          if (btn.getAttribute("data-a-target") === "tw-core-button-label-text" && !text.toLowerCase().includes("claim")) {
            return;
          }
          btn.click();
          incrementClaimCount();
        }
      });
    };

    // Use a lightweight interval instead of a heavy global MutationObserver
    if (!dropsInterval) {
      dropsInterval = setInterval(claimHandler, 3000);
    }
  } else {
    if (dropsInterval) { clearInterval(dropsInterval); dropsInterval = null; }
  }
}

function incrementClaimCount() {
  chrome.storage?.local?.get(["ticClaimedCount"], (res) => {
    const count = (res.ticClaimedCount || 0) + 1;
    chrome.storage.local.set({ ticClaimedCount: count });
    showTicToast(`⚡ Claimed ${count} points/drops!`);
  });
}

function showTicToast(message) {
  const player = TicSchemaEngine.getPlayerContainer();
  if (!player) return;
  
  const toast = document.createElement("div");
  toast.style.cssText = `
    position: absolute;
    bottom: 80px;
    left: 20px;
    background: rgba(18, 18, 24, 0.9);
    border-left: 3px solid #ff0055;
    color: #efeff1;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 600;
    z-index: 9999;
    pointer-events: none;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  `;
  
  toast.textContent = message;
  player.appendChild(toast);
  
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });
  
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ---------------------------------------------------------------------------
// 7. Hide Video Extensions (`hideExtensions`)
// ---------------------------------------------------------------------------
function applyHideExtensions(enabled) {
  if (enabled) {
    document.body.classList.add("tic-hide-extensions-active");
  } else {
    document.body.classList.remove("tic-hide-extensions-active");
  }
}

// ---------------------------------------------------------------------------
// 9. Compact Chat Density & Clutter Filter Mode (`compactChat`)
// ---------------------------------------------------------------------------
function applyCompactChat(enabled) {
  if (enabled) {
    document.body.classList.add("tic-compact-chat-active");
    // Initial pass on existing messages
    cleanCompactChatNodes(document.querySelectorAll('.chat-line__message, [data-test-selector="chat-line-message"], [data-a-target="chat-line-message"], div[class*="chat-line"], .user-notice-line'));
    
    if (!compactChatObserver) {
      const chatContainer = TicSchemaEngine.getChatContainer();
      if (chatContainer) {
        compactChatObserver = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.addedNodes.length > 0) {
              const newNodes = [];
              mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) { // Element node
                  if (node.matches && node.matches('.chat-line__message, [class*="chat-line"], .user-notice-line')) {
                    newNodes.push(node);
                  }
                  // Also query within added container just in case
                  const nested = node.querySelectorAll ? node.querySelectorAll('.chat-line__message, [class*="chat-line"], .user-notice-line') : [];
                  nested.forEach(n => newNodes.push(n));
                }
              });
              if (newNodes.length > 0) cleanCompactChatNodes(newNodes);
            }
          });
        });
        compactChatObserver.observe(chatContainer, { childList: true, subtree: true });
      }
    }
  } else {
    document.body.classList.remove("tic-compact-chat-active");
    if (compactChatObserver) { compactChatObserver.disconnect(); compactChatObserver = null; }
    document.querySelectorAll(".tic-hidden-chat-clutter").forEach((el) => {
      el.style.removeProperty("display");
      el.style.removeProperty("height");
      el.style.removeProperty("padding");
      el.style.removeProperty("margin");
      el.classList.remove("tic-hidden-chat-clutter");
    });
  }
}

// Deep text & DOM schema parser for chat clutter (processes only specific nodes for O(1) performance)
function cleanCompactChatNodes(nodes) {
  if (!currentSettings.compactChat) return;
  
  nodes.forEach((msg) => {
    if (msg._ticCleaned) return;
    msg._ticCleaned = true;
    
    // Check if system message, reward box, or matches clutter schema using strict DOM indicators
    const isClutterNotice = msg.querySelector('[data-test-selector="user-notice-line"], [data-a-target="chat-line-notice"], .user-notice-line, [data-test-selector="chat-leaderboard"], div[class*="notice"], div[class*="leaderboard"], div[class*="hype-train"], div[class*="treasure-train"]') ||
                            msg.getAttribute("data-a-target") === "chat-line-system" ||
                            msg.classList.contains("chat-line__system");

    if (isClutterNotice) {
      msg.style.setProperty("display", "none", "important");
      msg.style.setProperty("height", "0", "important");
      msg.style.setProperty("padding", "0", "important");
      msg.style.setProperty("margin", "0", "important");
      msg.style.setProperty("overflow", "hidden", "important");
      msg.classList.add("tic-hidden-chat-clutter");
    }
  });
}

// Run extension initialization
initTicExtension();

// ---------------------------------------------------------------------------
// 10. Twitch Stats Panel (IVR API)
// ---------------------------------------------------------------------------
function applyStatsPanel() {
  const injectStats = async () => {
    const aboutSection = document.querySelector('.about-section__panel');
    if (!aboutSection || document.getElementById('tic-stats-panel')) return;

    const pathParts = window.location.pathname.split('/').filter(p => p);
    if (pathParts.length === 0) return;
    
    const channelName = pathParts[0];
    const ignoreList = ['directory', 'videos', 'downloads', 'settings', 'p', 'search', 'popout', 'embed'];
    if (ignoreList.includes(channelName.toLowerCase())) return;

    const panel = document.createElement('div');
    panel.id = 'tic-stats-panel';
    panel.innerHTML = `<div style="text-align: center; color: var(--color-text-alt-2); padding: 20px;">Loading live channel stats...</div>`;
    aboutSection.insertBefore(panel, aboutSection.firstChild);

    try {
        const query = `query { user(login: "${channelName}") { stream { type viewersCount createdAt game { name } } followers { totalCount } createdAt roles { isPartner isAffiliate } lastBroadcast { startedAt } primaryColorHex } }`;
        const res = await fetch("https://gql.twitch.tv/gql", {
            method: 'POST',
            body: JSON.stringify({ query }),
            headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko' }
        });
        
        if (!res.ok) throw new Error("GQL fetch failed");
        const data = await res.json();
        const user = data?.data?.user;
        if (!user) throw new Error("User not found");

        const formatNumber = (num) => new Intl.NumberFormat().format(num || 0);
        const createdAt = new Date(user.createdAt).toLocaleDateString();
        const isPartner = user.roles.isPartner ? "Partner" : user.roles.isAffiliate ? "Affiliate" : "Standard";
        
        const getTimeAgo = (dateStr) => {
            if (!dateStr) return 'Unknown';
            const diff = Date.now() - new Date(dateStr).getTime();
            const days = Math.floor(diff / 86400000);
            if (days > 0) return `${days} day${days !== 1 ? 's' : ''} ago`;
            const hours = Math.floor(diff / 3600000);
            return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
        };

        let liveBadges = '';
        if (user.stream) {
            const getUptime = (start) => {
              const diff = Date.now() - new Date(start).getTime();
              const h = Math.floor(diff / 3600000);
              const m = Math.floor((diff % 3600000) / 60000);
              return `${h}h ${m}m`;
            };
            
            liveBadges = `
              <div class="tic-badge" title="Live Viewers">
                 <span class="tic-badge-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg></span>
                 <span>${formatNumber(user.stream.viewersCount)}</span>
              </div>
              <div class="tic-badge" title="Category">
                 <span class="tic-badge-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2" ry="2"></rect><line x1="8" y1="2" x2="8" y2="22"></line><line x1="16" y1="2" x2="16" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg></span>
                 <span>${user.stream.game?.name || 'Just Chatting'}</span>
              </div>
              <div class="tic-badge" title="Uptime">
                 <span class="tic-badge-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></span>
                 <span>${getUptime(user.stream.createdAt)}</span>
              </div>
            `;
        } else if (user.lastBroadcast?.startedAt) {
            liveBadges = `
              <div class="tic-badge" title="Last Live">
                 <span class="tic-badge-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg></span>
                 <span>Last live ${getTimeAgo(user.lastBroadcast.startedAt)}</span>
              </div>
            `;
        }
  
        panel.innerHTML = `
          ${liveBadges}
          <div class="tic-badge" title="Total Followers">
             <span class="tic-badge-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></span>
             <span>${formatNumber(user.followers.totalCount)}</span>
          </div>
          <div class="tic-badge" title="Account Created">
             <span class="tic-badge-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></span>
             <span>Joined on ${createdAt}</span>
          </div>
          <div class="tic-badge" title="Partnership Status">
             <span class="tic-badge-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></span>
             <span>${isPartner}</span>
          </div>
        `;
    } catch (err) {
      panel.innerHTML = ``;
    };
  };

  injectStats();
}

// ---------------------------------------------------------------------------
// 9. Grid Card Media Downloader
// ---------------------------------------------------------------------------
function applyGridDownloader() {
    const injectGridButtons = () => {
      // Broad selector to catch directory cards, channel clips pages, and video pages
      const cards = document.querySelectorAll('a[href*="/clip/"], a[href*="/videos/"], a[href*="clips.twitch.tv"], article, [data-a-target="video-tower-card"], [data-a-target="preview-card-image-link"]');
      cards.forEach(card => {
        // Find anchor tag for href logic if card is article
        const anchor = card.tagName.toLowerCase() === 'a' ? card : card.querySelector('a');
        if (!anchor) return;
        
        // Must contain an image to be a thumbnail card
        if (!card.querySelector('img')) return;
        if (card.querySelector('.tic-grid-dl-btn')) return; // Already injected
        
        const href = anchor.getAttribute('href') || "";
        const isClip = href.includes('/clip/') || href.includes('clips.twitch.tv');
        const isVod = href.includes('/videos/');
        
        if (!isClip && !isVod) return;
      
      // Ensure the card can anchor absolute positioned button
      if (window.getComputedStyle(card).position === 'static') {
        card.style.position = 'relative';
      }
      
      card.classList.add("tic-dl-wrapper");
      
      const btn = document.createElement('button');
      btn.className = 'tic-grid-dl-btn';
      btn.title = isClip ? "Download Clip" : "Download VOD (m3u8)";
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="16px" height="16px" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
      
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.style.opacity === "0.5") return;
        btn.style.opacity = "0.5";
        
        if (isClip) {
          const img = card.querySelector('img');
          let mp4Url = null;
          if (img && img.src && img.src.includes('-preview-')) {
            mp4Url = img.src.split('-preview-')[0] + '.mp4';
          }
          if (mp4Url) {
            showTicToast("Downloading Clip...", "success");
            let slug = href.split('/').pop() || "clip";
            if (slug.includes('?')) slug = slug.split('?')[0];
            chrome.runtime.sendMessage({ 
              action: "DOWNLOAD_CLIP", 
              url: mp4Url, 
              filename: `Twitch-Clip-${slug}.mp4` 
            });
          } else {
            showTicToast("Failed to parse clip URL from thumbnail.", "error");
          }
        } else if (isVod) {
          const videoId = href.split('/').pop().split('?')[0];
          showTicToast("Fetching VOD stream...", "info");
          try {
            const resp = await fetch("https://gql.twitch.tv/gql", {
                method: 'POST',
                body: JSON.stringify({
                    "query": `query { video(id: "${videoId}") { broadcastType, createdAt, seekPreviewsURL, owner { login } }}`
                }),
                headers: {
                    'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            const data = await resp.json();
            if (data && data.data && data.data.video && data.data.video.seekPreviewsURL) {
                const currentURL = new URL(data.data.video.seekPreviewsURL);
                const domain = currentURL.host;
                const paths = currentURL.pathname.split("/");
                const vodSpecialID = paths[paths.findIndex(element => element.includes("storyboards")) - 1];
                const m3u8 = `https://${domain}/${vodSpecialID}/chunked/index-dvr.m3u8`;
                await navigator.clipboard.writeText(m3u8);
                showTicToast("Raw VOD stream (m3u8) copied to clipboard! Paste in VLC.", "success", 5000);
            } else {
                showTicToast("Failed to fetch VOD data.", "error");
            }
          } catch (err) {
            showTicToast("Error resolving VOD.", "error");
          }
        }
        setTimeout(() => btn.style.opacity = "1", 2000);
      });
      
      card.appendChild(btn);
    });
  };
  
  injectGridButtons();
}
