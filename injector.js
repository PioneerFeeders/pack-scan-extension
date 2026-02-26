// injector.js
// Runs in the ISOLATED world — has access to chrome.runtime APIs
// Injects content.js into the MAIN world for fetch interception
// Bridges messages between the two worlds via window.postMessage

console.log("[PackScan] Injector loaded (isolated world)");

// Inject content.js into the MAIN world so it can monkey-patch fetch
const script = document.createElement("script");
script.src = chrome.runtime.getURL("content.js");
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// Listen for messages from the MAIN world (content.js)
window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  // Forward pack scan logs to the background script
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

// Listen for messages from the background script and forward to MAIN world
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_NEW_LABELS") {
    window.postMessage({ type: "PACKSCAN_CHECK_LABELS" }, "*");
    sendResponse({ ok: true });
  }
});
