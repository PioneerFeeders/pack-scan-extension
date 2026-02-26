// background.js
// Watches ShipStation network requests for new label creations

const API_BASE = "https://web-production-9d744.up.railway.app";

// Track known fulfillment IDs so we only trigger on NEW labels
let knownFulfillmentIds = new Set();

// On install, initialize storage
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ employees: {}, recentScans: [] });
  console.log("[PackScan] Extension installed");
});

// Listen for completed requests to the bulkload endpoint
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (
      details.method === "POST" &&
      details.url.includes("/api/bulkload/BySalesOrderIds") &&
      details.statusCode === 200
    ) {
      // We can't read the response body from webRequest in MV3
      // So we message the content script to read it via fetch intercept
      chrome.tabs.sendMessage(details.tabId, {
        type: "CHECK_NEW_LABELS",
        url: details.url,
      });
    }
  },
  { urls: ["*://*.shipstation.com/api/bulkload/*"] }
);

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "NEW_FULFILLMENT_CHECK") {
    // Content script sends us fulfillment data to check for new ones
    const newFulfillments = [];

    for (const f of message.fulfillments) {
      if (!knownFulfillmentIds.has(f.fulfillmentId) && f.trackingNumber) {
        knownFulfillmentIds.add(f.fulfillmentId);
        newFulfillments.push(f);
      }
    }

    if (newFulfillments.length > 0) {
      // Tell the content script to show the overlay
      chrome.tabs.sendMessage(sender.tab.id, {
        type: "SHOW_SCAN_OVERLAY",
        fulfillments: newFulfillments,
      });
    }

    sendResponse({ ok: true });
  }

  if (message.type === "LOG_PACK_SCAN") {
    // Forward the scan to the API
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
        sendResponse({ ok: true, data });
      })
      .catch((err) => {
        console.error("[PackScan] API error:", err);
        sendResponse({ ok: false, error: err.message });
      });

    // Return true to keep the message channel open for async response
    return true;
  }

  if (message.type === "INIT_KNOWN_FULFILLMENTS") {
    // When content script loads, it sends existing fulfillments so we don't
    // trigger on labels that already existed before the extension loaded
    for (const id of message.fulfillmentIds) {
      knownFulfillmentIds.add(id);
    }
    sendResponse({ ok: true });
  }
});
