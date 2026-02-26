// content.js
// Runs in the MAIN world (injected via script tag by injector.js)
// 1. Intercepts fetch to detect new labels
// 2. Renders badge scan overlay
// 3. Uses capture-phase event listeners to beat ShipStation's handlers

(() => {
  const EMPLOYEES = {
    PF001: "Justin",
    PF002: "Sarah",
    PF003: "Mike",
    PF004: "Alex",
  };

  // Enabled state — controlled by clicking the extension icon
  let enabled = false;

  window.addEventListener("message", function(event) {
    if (event.source !== window) return;
    if (event.data?.type === "PACKSCAN_SET_ENABLED") {
      enabled = event.data.enabled;
      console.log("[PackScan] " + (enabled ? "ENABLED" : "DISABLED"));
    }
  });

  // ============================================================
  // FETCH INTERCEPTOR
  // ============================================================
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (url.includes("/api/bulkload/BySalesOrderIds")) {
        const clone = response.clone();
        clone.json().then((data) => processShipStationResponse(data)).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._packScanUrl = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        if (this._packScanUrl && this._packScanUrl.includes("/api/bulkload/BySalesOrderIds")) {
          processShipStationResponse(JSON.parse(this.responseText));
        }
      } catch (e) {}
    });
    return originalXHRSend.apply(this, args);
  };

  // ============================================================
  // PROCESS SHIPSTATION RESPONSE
  // ============================================================
  let knownFulfillmentIds = new Set();
  let isFirstLoad = true;
  let pendingQueue = [];
  let overlayActive = false;

  function processShipStationResponse(data) {
    if (!data || !data.fulfillments) return;
    const fulfillments = data.fulfillments
      .filter((f) => f.trackingInformation?.trackingNumber)
      .map((f) => ({
        fulfillmentId: f.fulfillmentId,
        fulfillmentPlanId: f.fulfillmentPlanId,
        trackingNumber: f.trackingInformation.trackingNumber,
        orderNumber: findOrderNumber(data, f.fulfillmentPlanId),
        customerName: findCustomerName(data, f.fulfillmentPlanId),
      }));

    if (isFirstLoad) {
      for (const f of fulfillments) knownFulfillmentIds.add(f.fulfillmentId);
      isFirstLoad = false;
      console.log("[PackScan] Initialized with " + knownFulfillmentIds.size + " existing fulfillments");
      return;
    }

    const newOnes = fulfillments.filter((f) => !knownFulfillmentIds.has(f.fulfillmentId));
    for (const f of newOnes) knownFulfillmentIds.add(f.fulfillmentId);

    if (newOnes.length > 0) {
      console.log("[PackScan] New label(s) detected:", newOnes);
      if (!enabled) {
        console.log("[PackScan] Overlay disabled — skipping");
        return;
      }
      pendingQueue.push(...newOnes);
      if (!overlayActive) showNextOverlay();
    }
  }

  function findOrderNumber(data, fpId) {
    if (!data.salesOrders) return "";
    for (const o of data.salesOrders) { if (o.fulfillmentPlanIds?.includes(fpId)) return o.orderNumber || ""; }
    return "";
  }
  function findCustomerName(data, fpId) {
    if (!data.salesOrders) return "";
    for (const o of data.salesOrders) { if (o.fulfillmentPlanIds?.includes(fpId)) return o.soldTo?.name || ""; }
    return "";
  }

  // ============================================================
  // OVERLAY
  // ============================================================
  let overlayEl = null;
  let currentInput = null;
  let currentFulfillment = null;

  // CAPTURE-PHASE listeners on window — fires before ShipStation can intercept
  window.addEventListener("keydown", function(e) {
    if (!overlayActive || !currentInput) return;

    // Stop ShipStation from seeing ANY keystrokes while overlay is open
    e.stopImmediatePropagation();
    e.stopPropagation();
    e.preventDefault();

    if (e.key === "Escape") {
      removeOverlay();
      showNextOverlay();
      return;
    }

    if (e.key === "Enter") {
      // Handle Enter directly - process the badge code
      var code = currentInput.value.trim().toUpperCase();
      if (code && EMPLOYEES[code]) {
        handleSuccess(code);
      } else if (code) {
        handleBadBadge();
      }
      return;
    }

    if (e.key === "Backspace") {
      currentInput.value = currentInput.value.slice(0, -1);
      return;
    }

    // Only type printable characters (single char keys)
    if (e.key.length === 1) {
      currentInput.value += e.key;
    }
  }, true);

  window.addEventListener("keyup", function(e) {
    if (!overlayActive) return;
    e.stopImmediatePropagation();
    e.stopPropagation();
    e.preventDefault();
  }, true);

  window.addEventListener("keypress", function(e) {
    if (!overlayActive) return;
    e.stopImmediatePropagation();
    e.stopPropagation();
    e.preventDefault();
  }, true);

  function showNextOverlay() {
    if (pendingQueue.length === 0) {
      overlayActive = false;
      currentInput = null;
      currentFulfillment = null;
      return;
    }
    overlayActive = true;
    currentFulfillment = pendingQueue.shift();
    showOverlay(currentFulfillment);
  }

  function showOverlay(fulfillment) {
    removeOverlay();

    overlayEl = document.createElement("div");
    overlayEl.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;font-family:system-ui,-apple-system,sans-serif;";

    // Backdrop
    var backdrop = document.createElement("div");
    backdrop.style.cssText = "position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.35);backdrop-filter:blur(2px);";
    overlayEl.appendChild(backdrop);

    // Card
    var card = document.createElement("div");
    card.style.cssText = "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:14px;padding:28px 32px;width:340px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.2),0 0 0 1px rgba(0,0,0,0.05);";
    card.id = "packscan-card";

    // Header
    var header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:20px;";
    var pulse = document.createElement("div");
    pulse.style.cssText = "width:8px;height:8px;border-radius:50%;background:#1F73B7;box-shadow:0 0 0 3px rgba(31,115,183,0.2);";
    var headerText = document.createElement("span");
    headerText.style.cssText = "font-size:12px;font-weight:700;color:#1F73B7;text-transform:uppercase;letter-spacing:0.08em;";
    headerText.textContent = "LABEL PRINTED";
    header.appendChild(pulse);
    header.appendChild(headerText);
    card.appendChild(header);

    // Order info
    var orderInfo = document.createElement("div");
    orderInfo.style.cssText = "margin-bottom:24px;";
    var orderNum = document.createElement("div");
    orderNum.style.cssText = "font-size:26px;font-weight:700;color:#2F3941;";
    orderNum.textContent = "#" + (fulfillment.orderNumber || "\u2014");
    var customer = document.createElement("div");
    customer.style.cssText = "font-size:13px;color:#68737D;margin-top:4px;";
    customer.textContent = fulfillment.customerName || "";
    var tracking = document.createElement("div");
    tracking.style.cssText = "font-size:11px;font-family:monospace;color:#87929D;margin-top:4px;";
    tracking.textContent = fulfillment.trackingNumber;
    orderInfo.appendChild(orderNum);
    orderInfo.appendChild(customer);
    orderInfo.appendChild(tracking);
    card.appendChild(orderInfo);

    // Scan area
    var scanArea = document.createElement("div");
    scanArea.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px;background:#F8F9FA;border-radius:10px;border:2px dashed #D8DCDE;margin-bottom:12px;";
    scanArea.id = "packscan-scan-area";
    var scanText = document.createElement("div");
    scanText.style.cssText = "font-size:15px;font-weight:600;color:#2F3941;";
    scanText.id = "packscan-scan-text";
    scanText.textContent = "Scan your badge";
    scanArea.appendChild(scanText);
    card.appendChild(scanArea);

    // Input
    var input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = "Badge ID";
    input.style.cssText = "width:100%;padding:10px 12px;margin-top:8px;border:2px solid #D8DCDE;border-radius:8px;font-size:16px;text-align:center;text-transform:uppercase;outline:none;font-family:system-ui,-apple-system,sans-serif;box-sizing:border-box;";
    input.id = "packscan-input";
    card.appendChild(input);

    // Skip hint
    var skip = document.createElement("div");
    skip.style.cssText = "font-size:11px;color:#C2C8CC;margin-top:8px;";
    skip.innerHTML = "Press <kbd style='display:inline-block;padding:1px 5px;background:#F0F1F2;border:1px solid #D8DCDE;border-radius:3px;font-family:monospace;font-size:10px;color:#87929D;'>Esc</kbd> to skip";
    card.appendChild(skip);

    overlayEl.appendChild(card);
    document.body.appendChild(overlayEl);

    currentInput = input;

    // Focus
    setTimeout(function() { input.focus(); }, 50);

    // Click backdrop to refocus
    backdrop.addEventListener("click", function() { input.focus(); });
  }

  function handleSuccess(code) {
    var fulfillment = currentFulfillment;
    var card = document.getElementById("packscan-card");

    window.postMessage({
      type: "PACKSCAN_LOG",
      trackingNumber: fulfillment.trackingNumber,
      employeeId: code,
      fulfillmentId: fulfillment.fulfillmentId,
      orderNumber: fulfillment.orderNumber,
    }, "*");

    card.style.background = "#EDF8F4";
    card.style.boxShadow = "0 20px 60px rgba(3,129,83,0.15), 0 0 0 2px #038153";
    card.innerHTML = "";
    var sc = document.createElement("div");
    sc.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 0;";
    var check = document.createElement("div");
    check.style.cssText = "width:52px;height:52px;border-radius:50%;background:#038153;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;margin-bottom:8px;";
    check.textContent = "\u2713";
    var name = document.createElement("div");
    name.style.cssText = "font-size:22px;font-weight:700;color:#038153;";
    name.textContent = EMPLOYEES[code];
    var onum = document.createElement("div");
    onum.style.cssText = "font-size:13px;color:#68737D;";
    onum.textContent = "#" + fulfillment.orderNumber;
    sc.appendChild(check);
    sc.appendChild(name);
    sc.appendChild(onum);
    card.appendChild(sc);

    currentInput = null;
    setTimeout(function() {
      removeOverlay();
      showNextOverlay();
    }, 1200);
  }

  function handleBadBadge() {
    var scanArea = document.getElementById("packscan-scan-area");
    var scanText = document.getElementById("packscan-scan-text");
    scanArea.style.borderColor = "#CC3340";
    scanArea.style.background = "rgba(204,51,64,0.05)";
    scanText.textContent = "Badge not recognized \u2014 try again";
    scanText.style.color = "#CC3340";
    currentInput.value = "";
    setTimeout(function() {
      scanArea.style.borderColor = "#D8DCDE";
      scanArea.style.background = "#F8F9FA";
      scanText.textContent = "Scan your badge";
      scanText.style.color = "#2F3941";
    }, 1500);
  }

  function removeOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    currentInput = null;
  }

  console.log("[PackScan] Content script loaded on ShipStation (main world)");

  window.__packScanTest = function() {
    processShipStationResponse({
      fulfillments: [{
        fulfillmentId: "test-" + Date.now(),
        fulfillmentPlanId: "fp-test",
        trackingInformation: { trackingNumber: "1ZTEST" + Date.now() },
        labelFulfillment: { carrierId: "ups" },
      }],
      salesOrders: [{
        orderNumber: "TEST-9999",
        fulfillmentPlanIds: ["fp-test"],
        soldTo: { name: "Test Customer" },
      }],
    });
  };
})();
