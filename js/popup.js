// Tic for Twitch - Production Popup Interaction & State Management

const DEFAULT_SETTINGS = {
  videoPopout: true,
  bitratePreview: false,
  turnLightsOff: true,
  customSkin: false,
  customSkinHex: "#ff0055",
  autoClaimDrops: true,
  hideExtensions: true,
  compactChat: false
};

document.addEventListener("DOMContentLoaded", () => {
  const isExtension = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

  if (isExtension) {
    chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
      Object.keys(settings).forEach((key) => {
        if (key === "customSkinHex") {
          const colorInput = document.getElementById("tic-skin-color-picker");
          if (colorInput) colorInput.value = settings[key] || "#ff0055";
        } else {
          const checkbox = document.querySelector(`input[data-setting="${key}"]`);
          if (checkbox) {
            checkbox.checked = Boolean(settings[key]);
          }
        }
      });
    });

  } else {
    Object.keys(DEFAULT_SETTINGS).forEach((key) => {
      if (key === "customSkinHex") {
        const colorInput = document.getElementById("tic-skin-color-picker");
        const savedColor = localStorage.getItem(`tic_${key}`);
        if (colorInput && savedColor) colorInput.value = savedColor;
      } else {
        const checkbox = document.querySelector(`input[data-setting="${key}"]`);
        if (checkbox) {
          const saved = localStorage.getItem(`tic_${key}`);
          if (saved !== null) {
            checkbox.checked = saved === "true";
          }
        }
      }
    });
  }

  const checkboxes = document.querySelectorAll("input[data-setting]");
  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", (e) => {
      const key = e.target.getAttribute("data-setting");
      const value = e.target.checked;

      if (isExtension) {
        chrome.storage.local.set({ [key]: value }, () => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0 && tabs[0].id) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: "SETTING_CHANGED",
                setting: key,
                value: value
              }).catch(() => {});
            }
          });
        });
      } else {
        localStorage.setItem(`tic_${key}`, value.toString());
      }
    });
  });

  const colorPicker = document.getElementById("tic-skin-color-picker");
  if (colorPicker) {
    colorPicker.addEventListener("input", (e) => {
      const newHex = e.target.value;
      if (isExtension) {
        chrome.storage.local.set({ customSkinHex: newHex }, () => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0 && tabs[0].id) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: "SETTING_CHANGED",
                setting: "customSkinHex",
                value: newHex
              }).catch(() => {});
            }
          });
        });
      } else {
        localStorage.setItem("tic_customSkinHex", newHex);
      }
    });
  }

  const supportBanner = document.getElementById("support-banner");
  const dismissBtn = document.getElementById("dismiss-support-btn");
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  if (supportBanner && dismissBtn) {
    if (isExtension) {
      chrome.storage.local.get(["supportDismissedUntil"], (data) => {
        if (data.supportDismissedUntil && Date.now() < data.supportDismissedUntil) {
          supportBanner.style.display = "none";
        }
      });
    } else {
      const dismissedUntil = localStorage.getItem("tic_supportDismissedUntil");
      if (dismissedUntil && Date.now() < parseInt(dismissedUntil, 10)) {
        supportBanner.style.display = "none";
      }
    }

    dismissBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      supportBanner.style.display = "none";
      const hideUntil = Date.now() + ONE_WEEK_MS;

      if (isExtension) {
        chrome.storage.local.set({ supportDismissedUntil: hideUntil });
      } else {
        localStorage.setItem("tic_supportDismissedUntil", hideUntil.toString());
      }
    });
  }

  const logoImg = document.querySelector('img[alt="Tic Logo"]');
  if (logoImg && supportBanner) {
    logoImg.style.cursor = "pointer";
    logoImg.title = "Double-click to reset hidden Support Us banner";
    logoImg.addEventListener("dblclick", () => {
      supportBanner.style.display = "flex";
      if (isExtension) {
        chrome.storage.local.remove(["supportDismissedUntil"]);
      } else {
        localStorage.removeItem("tic_supportDismissedUntil");
      }
    });
  }
});
