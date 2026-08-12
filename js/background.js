// Tic for Twitch - Production Background Service Worker (Manifest V3)

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

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.remove(["supportDismissedUntil"]);

  if (details.reason === "install") {
    chrome.storage.local.set(DEFAULT_SETTINGS, () => {
      console.log("Tic for Twitch initialized with production defaults.");
    });
  } else {
    chrome.storage.local.get(DEFAULT_SETTINGS, (current) => {
      const merged = { ...DEFAULT_SETTINGS, ...current };
      const deprecatedKeys = [
        "clickToPause", "chatSoundNotification", "cinemaMode", "adBlockPlus"
      ];
      deprecatedKeys.forEach(k => delete merged[k]);
      chrome.storage.local.remove(deprecatedKeys);
      chrome.storage.local.set(merged);
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "GET_SETTINGS") {
    chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
      sendResponse(settings);
    });
    return true;
  }

  if (message.action === "OPEN_POPOUT") {
    const streamUrl = message.url || "https://www.twitch.tv/";
    chrome.windows.create({
      url: streamUrl,
      type: "popup",
      width: 1280,
      height: 720
    });
    sendResponse({ success: true });
  }

  if (message.action === "DOWNLOAD_CLIP") {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename
    }, (downloadId) => {
      sendResponse({ success: true, downloadId });
    });
    return true;
  }

  if (message.action === "PING") {
    sendResponse({ pong: true });
  }
});
