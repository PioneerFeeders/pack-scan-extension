// injector.js
// Runs in the ISOLATED world — has access to chrome.runtime APIs
// Injects content.js into the MAIN world for fetch interception
// Bridges messages between the two worlds via window.postMessage

console.log("[PackScan] Injector loaded (isolated world)");

// Check initial enabled state and pass to MAIN world
chrome.runtime.sendMessage({ type: "GET_ENABLED" }, (response) => {
  window.postMessage({ type: "PACKSCAN_SET_ENABLED", enabled: !!response?.enabled }, "*");
});

// Inject content.js into the MAIN world
const script = document.createElement("script");
script.src = chrome.runtime.getURL("content.js");
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// Listen for messages from the MAIN world (content.js)
window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  if (event.data?.type === "PACKSCAN_LOG") {
    chrome.runtime.sendMessage({
      type: "LOG_PACK_SCAN",
      trackingNumber: event.data.trackingNumber,
      employeeId: event.data.employeeId,
      fulfillmentId: event.data.fulfillmentId,
      orderNumber: event.data.orderNumber,
    });
  }
});

// Listen for toggle from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PACKSCAN_TOGGLE") {
    window.postMessage({ type: "PACKSCAN_SET_ENABLED", enabled: message.enabled }, "*");
    sendResponse({ ok: true });
  }
  if (message.type === "CHECK_NEW_LABELS") {
    sendResponse({ ok: true });
  }
});
