// content.js
// Runs inside the ShipStation page
// 1. Intercepts fetch to detect new labels
// 2. Renders badge scan overlay

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
  // Monkey-patches window.fetch to read bulkload responses
  // ============================================================
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

      if (url.includes("/api/bulkload/BySalesOrderIds")) {
        // Clone the response so we can read it without consuming it
        const clone = response.clone();
        clone.json().then((data) => {
          processShipStationResponse(data);
        }).catch(() => {});
      }
    } catch (e) {
      // Silently fail - don't break ShipStation
    }

    return response;
  };

  // Also intercept XMLHttpRequest for older code paths
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
      } catch (e) {
        // Silently fail
      }
    });
    return originalXHRSend.apply(this, args);
  };

  // ============================================================
  // PROCESS SHIPSTATION RESPONSE
  // Extract fulfillments and check for new labels
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
        carrier: f.labelFulfillment?.carrierId || "",
        labelCreated: f.labelFulfillment?.labelCreatedDateTime || "",
      }));

    if (isFirstLoad) {
      // First load — seed known IDs so we don't trigger overlays for existing labels
      for (const f of fulfillments) {
        knownFulfillmentIds.add(f.fulfillmentId);
      }
      isFirstLoad = false;
      console.log(
        `[PackScan] Initialized with ${knownFulfillmentIds.size} existing fulfillments`
      );
      return;
    }

    // Check for new fulfillments
    const newOnes = fulfillments.filter(
      (f) => !knownFulfillmentIds.has(f.fulfillmentId)
    );

    for (const f of newOnes) {
      knownFulfillmentIds.add(f.fulfillmentId);
    }

    if (newOnes.length > 0) {
      console.log(`[PackScan] New label(s) detected:`, newOnes);
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
  // OVERLAY UI
  // ============================================================
  let overlayEl = null;

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
    // Remove existing overlay if any
    removeOverlay();

    // Create overlay container
    overlayEl = document.createElement("div");
    overlayEl.id = "packscan-overlay";
    overlayEl.innerHTML = `
      <div id="packscan-backdrop"></div>
      <div id="packscan-card">
        <div id="packscan-header">
          <div id="packscan-pulse"></div>
          <span id="packscan-header-text">LABEL PRINTED</span>
        </div>
        <div id="packscan-order-info">
          <div id="packscan-order-number">#${fulfillment.orderNumber || "—"}</div>
          <div id="packscan-customer">${fulfillment.customerName || ""}</div>
          <div id="packscan-tracking">${fulfillment.trackingNumber}</div>
        </div>
        <div id="packscan-scan-area">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1F73B7" stroke-width="1.5">
            <rect x="6" y="2" width="12" height="20" rx="2"/>
            <circle cx="12" cy="9" r="2.5"/>
            <path d="M8 16h8"/>
            <path d="M8 18h8"/>
          </svg>
          <div id="packscan-scan-text">Scan your badge</div>
        </div>
        <input id="packscan-input" type="text" autocomplete="off" autofocus />
        <div id="packscan-skip">
          Press <kbd>Esc</kbd> to skip
        </div>
      </div>
    `;

    document.body.appendChild(overlayEl);

    // Focus the hidden input
    const input = document.getElementById("packscan-input");
    setTimeout(() => input?.focus(), 100);

    // Handle input (barcode scanner fires keystrokes + Enter)
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const code = input.value.trim().toUpperCase();
        if (code && EMPLOYEES[code]) {
          handleSuccessfulScan(fulfillment, code, EMPLOYEES[code]);
        } else if (code) {
          handleFailedScan(input);
        }
      }
      if (e.key === "Escape") {
        removeOverlay();
        showNextOverlay();
      }
    });

    // Keep focus on input (barcode scanners need it)
    document.addEventListener("click", refocusInput);
  }

  function refocusInput() {
    const input = document.getElementById("packscan-input");
    if (input && overlayActive) {
      input.focus();
    }
  }

  function handleSuccessfulScan(fulfillment, employeeId, employeeName) {
    // Send to API via injector.js → background script
    window.postMessage({
      type: "PACKSCAN_LOG",
      trackingNumber: fulfillment.trackingNumber,
      employeeId: employeeId,
      fulfillmentId: fulfillment.fulfillmentId,
      orderNumber: fulfillment.orderNumber,
    }, "*");

    // Show success state
    const card = document.getElementById("packscan-card");
    if (card) {
      card.innerHTML = `
        <div id="packscan-success">
          <div id="packscan-success-check">✓</div>
          <div id="packscan-success-name">${employeeName}</div>
          <div id="packscan-success-order">#${fulfillment.orderNumber}</div>
        </div>
      `;
      card.classList.add("packscan-card-success");
    }

    // Auto-dismiss after 1.2 seconds
    setTimeout(() => {
      removeOverlay();
      showNextOverlay();
    }, 1200);
  }

  function handleFailedScan(input) {
    const scanArea = document.getElementById("packscan-scan-area");
    if (scanArea) {
      scanArea.style.borderColor = "#CC3340";
      scanArea.style.background = "rgba(204,51,64,0.05)";
      const scanText = document.getElementById("packscan-scan-text");
      if (scanText) {
        scanText.textContent = "Badge not recognized — try again";
        scanText.style.color = "#CC3340";
      }
    }
    input.value = "";
    setTimeout(() => {
      if (scanArea) {
        scanArea.style.borderColor = "#D8DCDE";
        scanArea.style.background = "#F8F9FA";
      }
      const scanText = document.getElementById("packscan-scan-text");
      if (scanText) {
        scanText.textContent = "Scan your badge";
        scanText.style.color = "#2F3941";
      }
    }, 1500);
  }

  function removeOverlay() {
    document.removeEventListener("click", refocusInput);
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  console.log("[PackScan] Content script loaded on ShipStation (main world)");
})();
