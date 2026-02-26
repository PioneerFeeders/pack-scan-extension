// content.js
// Runs in the MAIN world (injected via script tag by injector.js)
// 1. Intercepts fetch to detect new labels
// 2. Renders badge scan overlay in Shadow DOM (isolated from ShipStation)

(() => {
  // ============================================================
  // CONFIG
  // ============================================================
  const EMPLOYEES = {
    PF001: "Justin",
    PF002: "Sarah",
    PF003: "Mike",
    PF004: "Alex",
  };

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
        clone.json().then((data) => {
          processShipStationResponse(data);
        }).catch(() => {});
      }
    } catch (e) {}

    return response;
  };

  // Also intercept XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._packScanUrl = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        if (
          this._packScanUrl &&
          this._packScanUrl.includes("/api/bulkload/BySalesOrderIds")
        ) {
          const data = JSON.parse(this.responseText);
          processShipStationResponse(data);
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
      for (const f of fulfillments) {
        knownFulfillmentIds.add(f.fulfillmentId);
      }
      isFirstLoad = false;
      console.log("[PackScan] Initialized with " + knownFulfillmentIds.size + " existing fulfillments");
      return;
    }

    const newOnes = fulfillments.filter((f) => !knownFulfillmentIds.has(f.fulfillmentId));
    for (const f of newOnes) {
      knownFulfillmentIds.add(f.fulfillmentId);
    }

    if (newOnes.length > 0) {
      console.log("[PackScan] New label(s) detected:", newOnes);
      pendingQueue.push(...newOnes);
      if (!overlayActive) {
        showNextOverlay();
      }
    }
  }

  function findOrderNumber(data, fulfillmentPlanId) {
    if (!data.salesOrders) return "";
    for (const order of data.salesOrders) {
      if (order.fulfillmentPlanIds?.includes(fulfillmentPlanId)) {
        return order.orderNumber || "";
      }
    }
    return "";
  }

  function findCustomerName(data, fulfillmentPlanId) {
    if (!data.salesOrders) return "";
    for (const order of data.salesOrders) {
      if (order.fulfillmentPlanIds?.includes(fulfillmentPlanId)) {
        return order.soldTo?.name || "";
      }
    }
    return "";
  }

  // ============================================================
  // OVERLAY UI - Shadow DOM for isolation from ShipStation
  // ============================================================
  let hostEl = null;

  function showNextOverlay() {
    if (pendingQueue.length === 0) {
      overlayActive = false;
      return;
    }
    overlayActive = true;
    const fulfillment = pendingQueue.shift();
    showOverlay(fulfillment);
  }

  function showOverlay(fulfillment) {
    removeOverlay();

    hostEl = document.createElement("div");
    hostEl.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;";
    document.body.appendChild(hostEl);

    const shadow = hostEl.attachShadow({ mode: "open" });

    shadow.innerHTML = '<style>' +
      '* { box-sizing: border-box; margin: 0; padding: 0; }' +
      '.backdrop { position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.35);backdrop-filter:blur(2px); }' +
      '.card { position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:14px;padding:28px 32px;width:340px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.2),0 0 0 1px rgba(0,0,0,0.05);animation:slideIn 0.2s ease-out;font-family:system-ui,-apple-system,sans-serif; }' +
      '.card.success { background:#EDF8F4;box-shadow:0 20px 60px rgba(3,129,83,0.15),0 0 0 2px #038153; }' +
      '@keyframes slideIn { from{opacity:0;transform:translate(-50%,-50%) scale(0.95);} to{opacity:1;transform:translate(-50%,-50%) scale(1);} }' +
      '.header { display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:20px; }' +
      '.pulse { width:8px;height:8px;border-radius:50%;background:#1F73B7;box-shadow:0 0 0 3px rgba(31,115,183,0.2);animation:pulse 2s infinite; }' +
      '@keyframes pulse { 0%,100%{box-shadow:0 0 0 3px rgba(31,115,183,0.2);} 50%{box-shadow:0 0 0 6px rgba(31,115,183,0.1);} }' +
      '.header-text { font-size:12px;font-weight:700;color:#1F73B7;text-transform:uppercase;letter-spacing:0.08em; }' +
      '.order-info { margin-bottom:24px; }' +
      '.order-number { font-size:26px;font-weight:700;color:#2F3941; }' +
      '.customer { font-size:13px;color:#68737D;margin-top:4px; }' +
      '.tracking { font-size:11px;font-family:monospace;color:#87929D;margin-top:4px; }' +
      '.scan-area { display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px;background:#F8F9FA;border-radius:10px;border:2px dashed #D8DCDE;margin-bottom:12px; }' +
      '.scan-area.error { border-color:#CC3340;background:rgba(204,51,64,0.05); }' +
      '.scan-text { font-size:15px;font-weight:600;color:#2F3941; }' +
      '.scan-text.error { color:#CC3340; }' +
      '.badge-input { width:100%;padding:10px 12px;margin-top:8px;border:2px solid #D8DCDE;border-radius:8px;font-size:16px;text-align:center;text-transform:uppercase;outline:none;font-family:system-ui,-apple-system,sans-serif; }' +
      '.badge-input:focus { border-color:#1F73B7;box-shadow:0 0 0 3px rgba(31,115,183,0.2); }' +
      '.skip { font-size:11px;color:#C2C8CC;margin-top:8px; }' +
      '.skip kbd { display:inline-block;padding:1px 5px;background:#F0F1F2;border:1px solid #D8DCDE;border-radius:3px;font-family:monospace;font-size:10px;color:#87929D; }' +
      '.success-container { display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 0; }' +
      '.success-check { width:52px;height:52px;border-radius:50%;background:#038153;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;margin-bottom:8px; }' +
      '.success-name { font-size:22px;font-weight:700;color:#038153; }' +
      '.success-order { font-size:13px;color:#68737D; }' +
      '</style>' +
      '<div class="backdrop"></div>' +
      '<div class="card">' +
        '<div class="header">' +
          '<div class="pulse"></div>' +
          '<span class="header-text">LABEL PRINTED</span>' +
        '</div>' +
        '<div class="order-info">' +
          '<div class="order-number">#' + (fulfillment.orderNumber || "\u2014") + '</div>' +
          '<div class="customer">' + (fulfillment.customerName || "") + '</div>' +
          '<div class="tracking">' + fulfillment.trackingNumber + '</div>' +
        '</div>' +
        '<div class="scan-area">' +
          '<div class="scan-text">Scan your badge</div>' +
        '</div>' +
        '<input class="badge-input" type="text" autocomplete="off" placeholder="Badge ID" />' +
        '<div class="skip">Press <kbd>Esc</kbd> to skip</div>' +
      '</div>';

    var input = shadow.querySelector(".badge-input");
    var card = shadow.querySelector(".card");
    var scanArea = shadow.querySelector(".scan-area");
    var scanText = shadow.querySelector(".scan-text");

    setTimeout(function() { input.focus(); }, 50);

    input.addEventListener("keydown", function(e) {
      e.stopPropagation();

      if (e.key === "Enter") {
        var code = input.value.trim().toUpperCase();
        if (code && EMPLOYEES[code]) {
          window.postMessage({
            type: "PACKSCAN_LOG",
            trackingNumber: fulfillment.trackingNumber,
            employeeId: code,
            fulfillmentId: fulfillment.fulfillmentId,
            orderNumber: fulfillment.orderNumber,
          }, "*");

          card.innerHTML =
            '<div class="success-container">' +
              '<div class="success-check">\u2713</div>' +
              '<div class="success-name">' + EMPLOYEES[code] + '</div>' +
              '<div class="success-order">#' + fulfillment.orderNumber + '</div>' +
            '</div>';
          card.classList.add("success");

          setTimeout(function() {
            removeOverlay();
            showNextOverlay();
          }, 1200);
        } else if (code) {
          scanArea.classList.add("error");
          scanText.textContent = "Badge not recognized \u2014 try again";
          scanText.classList.add("error");
          input.value = "";
          setTimeout(function() {
            scanArea.classList.remove("error");
            scanText.textContent = "Scan your badge";
            scanText.classList.remove("error");
          }, 1500);
        }
      }

      if (e.key === "Escape") {
        removeOverlay();
        showNextOverlay();
      }
    });

    shadow.querySelector(".backdrop").addEventListener("click", function() {
      input.focus();
    });
  }

  function removeOverlay() {
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
    }
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
