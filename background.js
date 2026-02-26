// background.js
// Watches ShipStation network requests for new label creations

const API_BASE = "https://web-production-9d744.up.railway.app";

// Track known fulfillment IDs so we only trigger on NEW labels
let knownFulfillmentIds = new Set();

// On install, initialize storage and default to OFF
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ enabled: false, recentScans: [] });
  chrome.action.setBadgeText({ text: "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: "#87929D" });
  console.log("[PackScan] Extension installed (disabled by default)");
});

// Click extension icon to toggle on/off
chrome.action.onClicked.addListener((tab) => {
  chrome.storage.local.get("enabled", (data) => {
    const newState = !data.enabled;
    chrome.storage.local.set({ enabled: newState });

    if (newState) {
      chrome.action.setBadgeText({ text: "ON" });
      chrome.action.setBadgeBackgroundColor({ color: "#038153" });
      console.log("[PackScan] Enabled");
    } else {
      chrome.action.setBadgeText({ text: "OFF" });
      chrome.action.setBadgeBackgroundColor({ color: "#87929D" });
      console.log("[PackScan] Disabled");
    }

    // Notify any open ShipStation tabs
    chrome.tabs.query({ url: "*://*.shipstation.com/*" }, (tabs) => {
      for (const t of tabs) {
        chrome.tabs.sendMessage(t.id, { type: "PACKSCAN_TOGGLE", enabled: newState }).catch(() => {});
      }
    });
  });
});

// On startup, restore badge state
chrome.storage.local.get("enabled", (data) => {
  if (data.enabled) {
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#038153" });
  } else {
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#87929D" });
  }
});

// Listen for completed requests to the bulkload endpoint
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (
      details.method === "POST" &&
      details.url.includes("/api/bulkload/BySalesOrderIds") &&
      details.statusCode === 200
    ) {
      chrome.tabs.sendMessage(details.tabId, {
        type: "CHECK_NEW_LABELS",
        url: details.url,
      }).catch(() => {});
    }
  },
  { urls: ["*://*.shipstation.com/api/bulkload/*"] }
);

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_ENABLED") {
    chrome.storage.local.get("enabled", (data) => {
      sendResponse({ enabled: !!data.enabled });
    });
    return true;
  }

  if (message.type === "LOG_PACK_SCAN") {
    fetch(`${API_BASE}/pack-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tracking_number: message.trackingNumber,
        employee_id: message.employeeId,
        fulfillment_id: message.fulfillmentId,
        order_number: message.orderNumber,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("[PackScan] API response:", data);
        sendResponse({ ok: true, data });
      })
      .catch((err) => {
        console.error("[PackScan] API error:", err);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (message.type === "INIT_KNOWN_FULFILLMENTS") {
    for (const id of message.fulfillmentIds) {
      knownFulfillmentIds.add(id);
    }
    sendResponse({ ok: true });
  }
});
