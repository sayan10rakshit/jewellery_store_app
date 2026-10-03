const state = {
    portal: null,
    meta: { groups: [], entities: [] },
    lookups: {},
    rows: {},
    hubs: {
        orderbook: { orders: [], selectedOrderId: "" },
        billing: { documents: [], selectedDocumentType: "invoice", selectedDocumentId: "" },
    },
    searches: {},
    loaded: {},
    rawMetalTotals: null,
    activeSection: "dashboard",
    notifications: {
        calendarMonth: (() => {
            const now = new Date();
            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        })(),
        selectedDate: localIsoDate(new Date()),
        returnContext: null,
        filter: "active",
    },
};

const sectionButtons = () => [...document.querySelectorAll(".nav-item")];
const sections = () => [...document.querySelectorAll(".page-section")];
const metricGrid = document.getElementById("metric-grid");
const supabaseStatus = document.getElementById("supabase-status");
const salesTotal = document.getElementById("sales-total");
const receivablesTotal = document.getElementById("receivables-total");
const notificationsTotal = document.getElementById("notifications-total");
const toast = document.getElementById("toast");
const refreshAllButton = document.getElementById("refresh-all");

const dashboardCustomers = document.getElementById("dashboard-customers");
const dashboardStock = document.getElementById("dashboard-stock");
const dashboardOrders = document.getElementById("dashboard-orders");
const dashboardDocuments = document.getElementById("dashboard-documents");
const dashboardNotifications = document.getElementById("dashboard-notifications");
const dynamicNav = document.getElementById("dynamic-nav");
const entitySections = document.getElementById("entity-sections");
const quickActions = document.getElementById("quick-actions");
const orderbookHub = document.getElementById("orderbook-hub");
const billingHub = document.getElementById("billing-hub");
const floatingNotificationStack = document.getElementById("floating-notification-stack");
const recordDrawer = document.getElementById("record-drawer");
const drawerTitle = document.getElementById("drawer-title");
const drawerKicker = document.getElementById("drawer-kicker");
const drawerBody = document.getElementById("drawer-body");
const drawerEditButton = document.getElementById("drawer-edit");
const drawerDeleteButton = document.getElementById("drawer-delete");
const formDrawer = document.getElementById("form-drawer");
const formDrawerTitle = document.getElementById("form-drawer-title");
const formDrawerKicker = document.getElementById("form-drawer-kicker");
const formDrawerBody = document.getElementById("form-drawer-body");
const appShell = document.getElementById("app-shell");
const sidebarToggle = document.getElementById("sidebar-toggle");

state.drawer = { slug: null, recordId: null };
state.formDrawer = { slug: null, mode: null };
state.modal = { type: null, data: null };
state.filters = { billing: {}, orderbook: {} };

const appModal = document.getElementById("app-modal");
const appModalContainer = document.getElementById("app-modal-container");
const appModalHeader = document.getElementById("app-modal-header");
const appModalBody = document.getElementById("app-modal-body");
const appModalFooter = document.getElementById("app-modal-footer");
const billGenAppUrl = "http://127.0.0.1:5000";
const masterPortalAppUrl = "http://127.0.0.1:5051";
const launchParams = new URLSearchParams(window.location.search);

/* Sidebar collapse */
if (localStorage.getItem("sidebarCollapsed") === "true") {
    appShell.classList.add("sidebar-collapsed");
}
sidebarToggle.addEventListener("click", () => {
    appShell.classList.toggle("sidebar-collapsed");
    localStorage.setItem("sidebarCollapsed", appShell.classList.contains("sidebar-collapsed"));
});

function showToast(message, isError = false) {
    const successIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const errorIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    toast.innerHTML = `${isError ? errorIcon : successIcon}<span>${message}</span>`;
    toast.dataset.state = isError ? "error" : "visible";
    /* Re-trigger the progress bar animation */
    toast.style.animation = "none";
    toast.offsetHeight;
    toast.style.animation = "";
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(() => {
        toast.dataset.state = "";
    }, 2600);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function formatCurrency(value) {
    const amount = Number(value || 0);
    return `Rs. ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toNumber(value) {
    const parsed = Number.parseFloat(String(value ?? "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value) {
    if (!value) return "--";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value) {
    if (!value) return "--";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatStockTimestamp(value) {
    if (!value) return "--";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(parsed);
    const time = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
        .formatToParts(parsed)
        .map((part) => part.type === "dayPeriod" ? part.value.toUpperCase() : part.value)
        .join("")
        .trim();
    return `${date} ${time}`;
}

function splitHuidValues(value) {
    return Array.isArray(value)
        ? value.flatMap((entry) => String(entry || "").trim().split(/\s+/)).filter(Boolean)
        : String(value || "").trim().split(/\s+/).filter(Boolean);
}

const copyIcon = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

function copyableValue(value, label) {
    const text = String(value || "").trim();
    if (!text) return "--";
    return `<span class="copyable-value"><span>${escapeHtml(text)}</span><button type="button" class="copy-value-button" data-copy-value="${escapeHtml(text)}" aria-label="Copy ${escapeHtml(label)}" title="Copy ${escapeHtml(label)}">${copyIcon}</button></span>`;
}

function copyableHuidValues(value) {
    const huids = splitHuidValues(value);
    if (!huids.length) return "--";
    return `<div class="huid-list">${huids.map((huid) => `<span class="huid-chip"><span>${escapeHtml(huid)}</span><button type="button" class="copy-value-button" data-copy-value="${escapeHtml(huid)}" aria-label="Copy HUID ${escapeHtml(huid)}" title="Copy HUID">${copyIcon}</button></span>`).join("")}</div>`;
}

async function copyTextToClipboard(value) {
    try {
        await navigator.clipboard.writeText(value);
    } catch (_error) {
        const input = document.createElement("textarea");
        input.value = value;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        document.execCommand("copy");
        input.remove();
    }
    showToast("Copied to clipboard");
}

function formatDateTimeLocal(value) {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    const offset = parsed.getTimezoneOffset();
    const local = new Date(parsed.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
}

function localDateTimeInputToIso(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return text;
    return parsed.toISOString();
}

function localIsoDate(value) {
    const parsed = new Date(value || "");
    if (Number.isNaN(parsed.getTime())) return "";
    return [
        parsed.getFullYear(),
        padNumber(parsed.getMonth() + 1),
        padNumber(parsed.getDate()),
    ].join("-");
}

function padNumber(value) {
    return String(value).padStart(2, "0");
}

function startOfDayIso(value) {
    return `${value}T00:00`;
}

function formatMonthLabel(value) {
    const [year, month] = String(value || "").split("-");
    if (!year || !month) return value || "";
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
    });
}

function shiftMonth(value, delta) {
    const [year, month] = String(value || "").split("-").map(Number);
    const base = new Date(year || new Date().getFullYear(), (month || 1) - 1 + delta, 1);
    return `${base.getFullYear()}-${padNumber(base.getMonth() + 1)}`;
}

function formatOptionLabel(value) {
    return String(value || "")
        .replaceAll("_", " ")
        .replaceAll("/", " / ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (match) => match.toUpperCase());
}

function isOldOrnamentAdvanceType(value) {
    return String(value || "").trim() === "old_ornaments_valuation";
}

function syncAdvanceReceiptDescriptionField(form, { clearWhenHidden = true } = {}) {
    if (!form) return;
    const transactionInput = form.querySelector('[name="transaction_type"]');
    if (!transactionInput) return;
    const isReceiptDriven = isOldOrnamentAdvanceType(transactionInput.value);
    const fieldGrid = form.querySelector(".field-grid");
    if (!fieldGrid) return;

    /* Cache the original Amount and Description label HTML on first call */
    if (!form._advAmountLabelHtml) {
        const amountLabel = fieldGrid.querySelector('[data-advance-field="amount"]');
        if (amountLabel) form._advAmountLabelHtml = amountLabel.outerHTML;
    }
    if (!form._advDescLabelHtml) {
        const descLabel = fieldGrid.querySelector('[data-advance-field="description"]');
        if (descLabel) form._advDescLabelHtml = descLabel.outerHTML;
    }

    if (isReceiptDriven) {
        /* Remove fields entirely from DOM */
        const amountLabel = fieldGrid.querySelector('[data-advance-field="amount"]');
        const descLabel = fieldGrid.querySelector('[data-advance-field="description"]');
        if (amountLabel) amountLabel.remove();
        if (descLabel) descLabel.remove();
    } else {
        /* Re-inject fields if missing */
        if (!fieldGrid.querySelector('[data-advance-field="amount"]') && form._advAmountLabelHtml) {
            /* Insert after the transaction type label */
            const transactionLabel = fieldGrid.querySelector('[data-advance-field="transaction_type"]');
            if (transactionLabel) {
                transactionLabel.insertAdjacentHTML("afterend", form._advAmountLabelHtml);
            } else {
                fieldGrid.insertAdjacentHTML("beforeend", form._advAmountLabelHtml);
            }
        }
        if (!fieldGrid.querySelector('[data-advance-field="description"]') && form._advDescLabelHtml) {
            fieldGrid.insertAdjacentHTML("beforeend", form._advDescLabelHtml);
        }
        /* Restore state */
        const amountInput = form.querySelector('[name="amount"]');
        const descriptionInput = form.querySelector('[name="valuation_description"]');
        if (amountInput) {
            amountInput.disabled = false;
            amountInput.readOnly = false;
            amountInput.required = true;
            amountInput.placeholder = "Enter amount";
        }
        if (descriptionInput) {
            descriptionInput.disabled = false;
            descriptionInput.readOnly = false;
            descriptionInput.required = false;
            descriptionInput.placeholder = "Optional: Describe ornaments received, purity/weight checks, valuation notes";
        }
    }
    syncAdvanceReceiptSubmitLabel(form);
}

function syncAdvanceReceiptSubmitLabel(form) {
    if (!form) return;
    const submitButton = form.querySelector('[type="submit"]');
    const transactionType = form.querySelector('[name="transaction_type"]')?.value || "";
    if (!submitButton) return;
    submitButton.innerHTML = isOldOrnamentAdvanceType(transactionType)
        ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="5 12 10 17 20 7"/></svg> Save & Open Receipt`
        : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Save Receipt`;
}

function nextSequentialDocumentNumber(values, fallbackPrefix = "ADV-") {
    const numberedValues = values
        .map((value) => String(value || "").trim())
        .filter((value) => /\d+$/.test(value));
    if (!numberedValues.length) return `${fallbackPrefix}001`;
    const latestValue = numberedValues
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }))[0];
    const match = latestValue.match(/^(.*?)(\d+)$/);
    if (!match) return `${fallbackPrefix}001`;
    const [, prefix, digits] = match;
    return `${prefix}${String(Number(digits) + 1).padStart(digits.length, "0")}`;
}

function nextAdvanceReceiptNumber() {
    const receiptNumbers = (state.hubs.orderbook.orders || [])
        .flatMap((order) => order.advance_receipts || [])
        .map((receipt) => receipt.receipt_no);
    return nextSequentialDocumentNumber(receiptNumbers, "ADV-");
}

function setFormFieldValue(form, name, value) {
    const input = form?.querySelector(`[name="${name}"]`);
    if (input) input.value = value ?? "";
    return input;
}

function findEntityForm(slug, form = null) {
    if (form) return form;
    return appModalBody?.querySelector(`[data-entity-form="${slug}"]`)
        || formDrawerBody?.querySelector(`[data-entity-form="${slug}"]`)
        || document.querySelector(`[data-entity-form="${slug}"]`);
}

function replaceOrderInState(order) {
    if (!order?.id) return;
    const existingIndex = (state.hubs.orderbook.orders || []).findIndex((row) => String(row.id) === String(order.id));
    if (existingIndex >= 0) {
        state.hubs.orderbook.orders.splice(existingIndex, 1, order);
    } else {
        state.hubs.orderbook.orders.unshift(order);
    }
}

function replaceBillingDocumentInState(document) {
    if (!document?.id) return;
    const existingIndex = (state.hubs.billing.documents || []).findIndex((row) => String(row.id) === String(document.id));
    if (existingIndex >= 0) {
        state.hubs.billing.documents.splice(existingIndex, 1, document);
    } else {
        state.hubs.billing.documents.unshift(document);
    }
}

async function refreshOrderbookOrder(orderId, { reopenModalTab = null } = {}) {
    if (!orderId) return null;
    const payload = await requestJson(`/api/orderbook?order_id=${encodeURIComponent(orderId)}`);
    const order = payload.orders?.[0] || null;
    if (!order) return null;
    replaceOrderInState(order);
    state.hubs.orderbook.selectedOrderId = order.id;
    renderOrderbookHub();
    if (state.activeSection === "orderbook-hub") {
        syncOrderbookForms();
    }
    if (reopenModalTab !== null) {
        closeAppModal();
        openOrderDetailModal(orderId, reopenModalTab);
    }
    return order;
}

async function refreshBillingDocument(documentId, { reopenModalTab = null, openView = false } = {}) {
    if (!documentId) return null;
    const payload = await requestJson(`/api/billing?document_id=${encodeURIComponent(documentId)}`);
    const document = (payload.documents || []).find((row) => String(row.id) === String(documentId)) || null;
    if (!document) return null;
    replaceBillingDocumentInState(document);
    state.hubs.billing.selectedDocumentId = document.id;
    state.hubs.billing.selectedDocumentType = document.document_type || "receipt";
    renderBillingHub();
    if (state.activeSection === "billing-hub") {
        syncBillingForms();
    }
    if (reopenModalTab !== null) {
        closeAppModal();
        if (openView) openBillingDocumentViewModal(documentId, reopenModalTab);
        else openBillingDocumentModal(documentId, reopenModalTab);
    }
    return document;
}

function getNotificationRows() {
    return state.rows.notifications || [];
}

function notificationEffectiveAt(row) {
    return row?.reminder_at || "";
}

function normalizeTimestamp(value) {
    const parsed = new Date(value || "");
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function compareNotifications(left, right) {
    const leftTs = normalizeTimestamp(notificationEffectiveAt(left)) ?? Number.MAX_SAFE_INTEGER;
    const rightTs = normalizeTimestamp(notificationEffectiveAt(right)) ?? Number.MAX_SAFE_INTEGER;
    return leftTs - rightTs;
}

function isNotificationClosed(row) {
    return String(row?.status || "").trim() === "closed";
}

function isNotificationDue(row) {
    if (!row || isNotificationClosed(row)) return false;
    const effectiveTs = normalizeTimestamp(notificationEffectiveAt(row));
    return effectiveTs != null && effectiveTs <= Date.now();
}

function isNotificationUpcoming(row) {
    if (!row || isNotificationClosed(row)) return false;
    const effectiveTs = normalizeTimestamp(notificationEffectiveAt(row));
    return effectiveTs != null && effectiveTs > Date.now();
}

function describeNotificationLinks(row) {
    const parts = [];
    if (row.customer_name) parts.push(`Customer: ${row.customer_name}`);
    if (row.artisan_name) parts.push(`Artisan: ${row.artisan_name}`);
    if (row.order_number) parts.push(`Order: ${row.order_number}`);
    if (row.invoice_no) parts.push(`Invoice: ${row.invoice_no}`);
    if (row.receipt_no) parts.push(`Receipt: ${row.receipt_no}`);
    return parts;
}

function notificationMatchesDate(row, isoDate) {
    const effective = notificationEffectiveAt(row);
    return effective ? localIsoDate(effective) === String(isoDate || "") : false;
}

function getNotificationsForDate(isoDate) {
    return getNotificationRows()
        .filter((row) => notificationMatchesDate(row, isoDate))
        .sort(compareNotifications);
}

function setNotificationReturnContext(context) {
    state.notifications.returnContext = context || null;
}

async function refreshNotificationsState(force = false) {
    await loadEntityRows("notifications", force);
    renderDueNotificationToasts();
}

function notificationLinkSummaryHtml(row) {
    const links = [];
    if (row.customer_id) {
        links.push({ type: "customer", id: row.customer_id, label: row.customer_name || formatLookupValue("customers", row.customer_id) || "Customer" });
    }
    if (row.artisan_id) {
        links.push({ type: "artisan", id: row.artisan_id, label: row.artisan_name || formatLookupValue("artisans", row.artisan_id) || "Artisan" });
    }
    if (row.order_id) {
        links.push({ type: "order", id: row.order_id, label: row.order_number || "Order" });
    }
    if (row.invoice_id) {
        links.push({ type: "invoice", id: row.invoice_id, label: row.invoice_no || "Invoice" });
    }
    if (row.receipt_id) {
        links.push({ type: "receipt", id: row.receipt_id, label: row.receipt_no || "Receipt" });
    }
    if (!links.length) return `<span class="empty-state">Standalone reminder</span>`;
    return links.map((item) => `
        <button
            type="button"
            class="notification-link-pill notification-link-button"
            data-open-notification-target="${escapeHtml(item.type)}"
            data-open-notification-target-id="${escapeHtml(item.id)}"
        >
            ${escapeHtml(item.type.charAt(0).toUpperCase() + item.type.slice(1))}: ${escapeHtml(item.label)}
        </button>
    `).join("");
}

function notificationStatusBadge(row) {
    if (isNotificationClosed(row)) return badge("closed");
    if (isNotificationDue(row)) return badge("due");
    return badge(row?.status || "open");
}

async function patchNotification(record, updates, { toastMessage = "" } = {}) {
    const payload = {
        ...record,
        ...updates,
    };
    await requestJson("/api/admin/notifications", {
        method: "POST",
        body: JSON.stringify(payload),
    });
    await Promise.all([loadPortal(), refreshNotificationsState(true)]);
    if (toastMessage) showToast(toastMessage);
}

async function closeNotification(recordId) {
    const row = findRow("notifications", recordId);
    if (!row) return;
    await patchNotification(row, {
        status: "closed",
    }, { toastMessage: "Notification closed" });
}

function formatJson(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

const BADGE_COLORS = {
    /* Success / active states */
    open: "badge-success", active: "badge-success", issued: "badge-success", paid: "badge-success",
    delivered: "badge-success", ready: "badge-success", sent: "badge-success", yes: "badge-success",
    /* Warning / in-progress states */
    draft: "badge-warning", in_progress: "badge-warning", "in progress": "badge-warning",
    partially_paid: "badge-warning", "partially paid": "badge-warning", pending: "badge-warning",
    queued: "badge-warning",
    /* Danger / cancelled states */
    cancelled: "badge-danger", failed: "badge-danger", overdue: "badge-danger", due: "badge-danger", no: "badge-danger",
    rejected: "badge-danger",
    /* Info states */
    custom_order: "badge-info", "custom order": "badge-info", repair: "badge-info",
    alteration: "badge-info", special_request: "badge-info", "special request": "badge-info",
    /* Neutral */
    stock_reservation: "badge-neutral", "stock reservation": "badge-neutral",
    /* Stock statuses */
    in_stock: "badge-success", "in stock": "badge-success",
    sold: "badge-danger",
    reserved: "badge-warning",
    exchanged: "badge-info",
    returned: "badge-neutral",
    out_for_jobwork: "badge-warning", "out for jobwork": "badge-warning",
    inactive: "badge-neutral",
    /* Order-item statuses */
    rough: "badge-warning",
    finalized: "badge-success",
};

/* Ornament-type specific color map */
const ORNAMENT_TYPE_COLORS = {
    ring: "badge-ornament-gold", bangle: "badge-ornament-gold", bracelet: "badge-ornament-gold",
    chain: "badge-ornament-gold", necklace: "badge-ornament-gold", pendant: "badge-ornament-gold",
    earring: "badge-ornament-gold", nose_pin: "badge-ornament-gold", "nose pin": "badge-ornament-gold",
    mangalsutra: "badge-ornament-gold", coin: "badge-ornament-gold",
    article: "badge-ornament-silver",
    other: "badge-neutral",
};

/* Purity specific color map */
const PURITY_COLORS = {
    "24k": "badge-purity-24k",
    "22k": "badge-purity-22k",
    "18k": "badge-purity-18k",
    "14k": "badge-purity-14k",
    "9k": "badge-purity-9k",
    "999": "badge-purity-fine-silver",
    "990": "badge-purity-fine-silver",
    "970": "badge-purity-sterling",
    "958": "badge-purity-sterling",
    "925": "badge-purity-sterling",
    "835": "badge-purity-coin-silver",
    "800": "badge-purity-coin-silver",
    "n/a": "badge-purity-na",
    "n_a": "badge-purity-na",
    "--": "badge-purity-na",
};

function badge(value) {
    const text = String(value || "--").trim();
    const key = text.toLowerCase().replace(/\s+/g, "_");
    const colorClass = BADGE_COLORS[key] || "";
    return `<span class="badge ${colorClass}">${escapeHtml(formatOptionLabel(text))}</span>`;
}

function ornamentTypeBadge(value, hsnCode) {
    const text = String(value || "--").trim();
    const label = formatOptionLabel(text);
    /* Derive material category from HSN code when available */
    const category = hsnCode ? detectOrnamentCategory(hsnCode) : null;
    const HSN_CATEGORY_LABELS = {
        gold: "Gold",
        silver: "Silver",
        imitation: "Imitation",
        stone: "Stone",
    };
    /* Show only the classification tag when category is known */
    if (category) {
        return `<span class="badge-category-tag badge-category-${category}">${HSN_CATEGORY_LABELS[category]}</span>`;
    }
    /* Fallback: show ornament type as a neutral badge */
    const colorClass = ORNAMENT_TYPE_COLORS[text.toLowerCase().replace(/\s+/g, "_")] || "badge-neutral";
    return `<span class="badge ${colorClass}">${escapeHtml(label)}</span>`;
}

function purityBadge(value) {
    const text = String(value || "--").trim();
    const key = text.toLowerCase().replace(/\s+/g, "_");
    const colorClass = PURITY_COLORS[key] || "";
    return `<span class="badge ${colorClass}">${escapeHtml(text)}</span>`;
}

function truncate(value, length = 80) {
    const text = String(value ?? "");
    if (text.length <= length) return text;
    return `${text.slice(0, length - 1)}...`;
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Request failed (${response.status})`);
    }
    return payload;
}

async function prefillNumberRecommendation(form, kind) {
    if (!form || form.dataset.editing === "true") return;
    const fieldName = kind === "order" ? "order_number" : "stock_no";
    const numberField = form.querySelector(`[name="${fieldName}"]`);
    if (!numberField) return;

    const params = new URLSearchParams({ kind });
    if (kind === "stock") {
        const hsnCode = form.querySelector('[name="hsn_code"]')?.value?.trim();
        const purity = form.querySelector('[name="purity"]')?.value?.trim();
        const category = detectOrnamentCategory(hsnCode);
        if (!hsnCode || ((category === "gold" || category === "silver") && !purity)) return;
        params.set("hsn_code", hsnCode);
        if (purity) params.set("purity", purity);
    }

    try {
        const recommendation = await requestJson(`/api/admin/number-recommendation?${params}`);
        // Never replace a number typed by the user. A previous suggestion can,
        // however, be refreshed when HSN/purity changes.
        if (!numberField.value.trim() || numberField.value === numberField.dataset.recommendation) {
            numberField.value = recommendation.number || "";
            numberField.dataset.recommendation = recommendation.number || "";
        }
    } catch (error) {
        // Recommendation is a convenience only; a form must remain usable if it
        // cannot be calculated (for example, while offline).
        console.warn("Unable to recommend a number", error);
    }
}

function prefillOrderDateTime(form) {
    if (!form) return;
    const dateTimeField = form.querySelector('[name="order_datetime"]');
    const dateField = form.querySelector('[name="order_date"]');
    if (!dateTimeField || !dateField) return;

    if (!dateTimeField.value) dateTimeField.value = formatDateTimeLocal(new Date());
    if (!dateField.value) dateField.value = dateTimeField.value.slice(0, 10);
    dateTimeField.addEventListener("change", () => {
        // Keep the legacy reporting date aligned with the editable local date.
        if (dateTimeField.value) dateField.value = dateTimeField.value.slice(0, 10);
    });
    dateField.addEventListener("change", () => {
        if (!dateField.value) return;
        const time = dateTimeField.value.slice(11) || "00:00";
        dateTimeField.value = `${dateField.value}T${time}`;
    });
}

function renderTable(target, columns, rows, actions = []) {
    if (!target) return;
    if (!rows || rows.length === 0) {
        target.innerHTML = `<p class="empty-state">No records yet.</p>`;
        return;
    }
    const rowEntity = target.dataset.rowEntity || actions[0]?.entity || "";
    const primaryKey = target.dataset.rowPrimaryKey || actions[0]?.primaryKey || "id";
    const head = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
    const actionHead = actions.length ? "<th>Actions</th>" : "";
    const body = rows.map((row) => {
        const cells = columns.map((column) => {
            const raw = row[column.key];
            return `<td>${column.render ? column.render(raw, row) : escapeHtml(raw ?? "--")}</td>`;
        }).join("");
        const actionCell = actions.length ? `<td class="row-actions">${actions.map((action) => `
            <button type="button" class="table-action ${action.iconOnly ? "icon-only" : ""} ${action.kind || ""}" data-entity="${action.entity}" data-action="${action.action}" data-id="${row[action.primaryKey || "id"]}"${action.title ? ` aria-label="${escapeHtml(action.title)}" title="${escapeHtml(action.title)}"` : ""}>
                ${action.icon || action.label}
            </button>
        `).join("")}</td>` : "";
        return `<tr class="data-row" data-row-entity="${rowEntity}" data-row-id="${row[primaryKey] || ""}">${cells}${actionCell}</tr>`;
    }).join("");
    target.innerHTML = `<table><thead><tr>${head}${actionHead}</tr></thead><tbody>${body}</tbody></table>`;
}

function valueOptionsHtml(options, currentValue) {
    return [`<option value="">Select</option>`, ...options.map((option) => `
        <option value="${escapeHtml(option.value)}"${String(currentValue ?? "") === String(option.value) ? " selected" : ""}>${escapeHtml(option.label)}</option>
    `)].join("");
}

function getEntity(slug) {
    return (state.meta.entities || []).find((entity) => entity.slug === slug);
}

function getVisibleEntities() {
    return (state.meta.entities || []).filter((entity) => !entity.navHidden);
}

function getOrderbookSelection() {
    const orders = state.hubs.orderbook.orders || [];
    return orders.find((order) => String(order.id) === String(state.hubs.orderbook.selectedOrderId)) || orders[0] || null;
}

function getBillingSelection() {
    const documents = state.hubs.billing.documents || [];
    return documents.find((document) => (
        String(document.id) === String(state.hubs.billing.selectedDocumentId)
        && document.document_type === state.hubs.billing.selectedDocumentType
    )) || documents[0] || null;
}

function getPaymentTransactionRows() {
    return state.rows["payment-transactions"] || [];
}

function findPaymentTransaction(recordId) {
    return getPaymentTransactionRows().find((row) => String(row.id) === String(recordId)) || null;
}

function getPaymentTransactionLinkedRecord(row) {
    if (!row) return null;
    const sourceType = String(row.source_type || "").trim();
    if (sourceType === "invoice" && row.invoice_id) {
        return {
            sourceType,
            entitySlug: "invoices",
            targetSection: "billing-hub",
            id: row.invoice_id,
            label: row.document_number || "Invoice",
            buttonLabel: "Go to Invoice",
        };
    }
    if (sourceType === "receipt" && row.receipt_id) {
        return {
            sourceType,
            entitySlug: "receipts",
            targetSection: "billing-hub",
            id: row.receipt_id,
            label: row.document_number || "Receipt",
            buttonLabel: "Go to Receipt",
        };
    }
    if (sourceType === "advance_receipt" && row.advance_receipt_id) {
        return {
            sourceType,
            entitySlug: "advance-receipts",
            targetSection: "payment-transactions",
            id: row.advance_receipt_id,
            label: row.document_number || "Advance Receipt",
            buttonLabel: "Go to Advance Receipt",
        };
    }
    return null;
}

function findPaymentTransactionByDocument(sourceType, documentId) {
    return getPaymentTransactionRows().find((row) => {
        if (sourceType === "invoice") return String(row.invoice_id || "") === String(documentId);
        if (sourceType === "receipt") return String(row.receipt_id || "") === String(documentId);
        if (sourceType === "advance_receipt") return String(row.advance_receipt_id || "") === String(documentId);
        return false;
    }) || null;
}

function getPaymentTransactionDefaults() {
    return {
        transaction_datetime: new Date().toISOString(),
        direction: "in",
        source_type: "invoice",
        total_amount: 0,
        reference_no: "",
        remarks: "",
    };
}

function paymentDirectionForSourceType(sourceType) {
    return sourceType === "receipt" ? "out" : "in";
}

function syncPaymentTransactionDirection(form) {
    if (!form) return;
    const sourceType = form.querySelector('[name="source_type"]')?.value || "";
    const directionField = form.querySelector('[name="direction"]');
    if (directionField) directionField.value = paymentDirectionForSourceType(sourceType);
}

function getLookupOptions(field) {
    if (!field.lookup) return [];
    return state.lookups[field.lookup] || [];
}

function formatLookupValue(lookupKey, value) {
    if (!lookupKey || !value) return value ?? "--";
    const option = (state.lookups[lookupKey] || []).find((row) => String(row.value) === String(value));
    return option ? option.label : value;
}

/* ===== CUSTOM DATETIME PICKER ===== */
const DTP_MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];
const DTP_SHORT_MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];
const DTP_WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function closeAllDatetimeDropdowns() {
    document.querySelectorAll(".datetime-dropdown.open").forEach((d) => {
        d.classList.remove("open");
    });
    document.querySelectorAll(".datetime-panel.open").forEach((p) => {
        p.classList.remove("open");
    });
}

document.addEventListener("click", (e) => {
    if (!e.target.closest(".datetime-dropdown") && !e.target.closest(".datetime-panel")) {
        closeAllDatetimeDropdowns();
    }
});

function dtpExtractDigits(str) {
    return str.replace(/\D/g, "");
}

function dtpFormatDateTimeDigits(digits) {
    let result = "";
    for (let i = 0; i < digits.length && i < 12; i++) {
        if (i === 2) result += "/";
        if (i === 4) result += "/";
        if (i === 8) result += "  ";
        if (i === 10) result += ":";
        result += digits[i];
    }
    return result;
}

function dtpParseDateTimeString(str) {
    const digits = dtpExtractDigits(str);
    if (digits.length < 8) return null;
    const day = parseInt(digits.substring(0, 2), 10);
    const month = parseInt(digits.substring(2, 4), 10) - 1;
    const year = parseInt(digits.substring(4, 8), 10);
    let hour = 0, minute = 0, hasTime = false;
    if (digits.length >= 10) {
        hour = parseInt(digits.substring(8, 10), 10);
        hasTime = true;
    }
    if (digits.length >= 12) {
        minute = parseInt(digits.substring(10, 12), 10);
    }
    if (day < 1 || day > 31 || month < 0 || month > 11 || year < 1900 || year > 2099) return null;
    if (hasTime && (hour < 0 || hour > 23)) return null;
    if (minute < 0 || minute > 59) return null;
    return { day, month, year, hour, minute, hasTime };
}

function dtpBuildPanelHTML() {
    const upChevron = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
    const downChevron = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    const leftChevron = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    const rightChevron = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;

    return `
        <div class="dtp-header">
            <div class="dtp-header-labels">
                <button type="button" class="dtp-month-btn" data-dtp-month-btn></button>
                <button type="button" class="dtp-year-btn" data-dtp-year-btn></button>
            </div>
            <div class="dtp-nav">
                <button type="button" class="dtp-nav-btn" data-dtp-prev title="Previous">${leftChevron}</button>
                <button type="button" class="dtp-nav-btn" data-dtp-next title="Next">${rightChevron}</button>
            </div>
        </div>
        <div class="dtp-body" data-dtp-body>
            <div class="dtp-weekdays">
                ${DTP_WEEKDAY_LABELS.map((d) => `<span class="dtp-weekday">${d}</span>`).join("")}
            </div>
            <div class="dtp-days" data-dtp-days></div>
        </div>
        <div class="dtp-divider"></div>
        <div class="dtp-time">
            <span class="dtp-time-label">Time<span class="dtp-time-optional">optional</span></span>
            <div class="dtp-time-spinner">
                <button type="button" class="dtp-time-spinner-btn" data-dtp-hour-up>${upChevron}</button>
                <input type="text" class="dtp-time-input" data-dtp-hour maxlength="2" value="12">
                <button type="button" class="dtp-time-spinner-btn" data-dtp-hour-down>${downChevron}</button>
            </div>
            <span class="dtp-time-colon">:</span>
            <div class="dtp-time-spinner">
                <button type="button" class="dtp-time-spinner-btn" data-dtp-min-up>${upChevron}</button>
                <input type="text" class="dtp-time-input" data-dtp-min maxlength="2" value="00">
                <button type="button" class="dtp-time-spinner-btn" data-dtp-min-down>${downChevron}</button>
            </div>
            <div class="dtp-time-period">
                <button type="button" class="dtp-time-period-btn active" data-dtp-am>AM</button>
                <button type="button" class="dtp-time-period-btn" data-dtp-pm>PM</button>
            </div>
        </div>
        <div class="dtp-footer">
            <div style="display: flex; gap: 6px;">
                <button type="button" class="dtp-now-btn" data-dtp-now>Now</button>
                <button type="button" class="dtp-clear-btn" data-dtp-clear>Clear</button>
            </div>
            <button type="button" class="dtp-confirm-btn" data-dtp-confirm>Confirm</button>
        </div>
    `;
}

function initAdvanceDatetimePicker(wrapper) {
    const dropdown = wrapper.querySelector("[data-datetime-dropdown]");
    const textInput = wrapper.querySelector("[data-datetime-input]");
    const calBtn = wrapper.querySelector("[data-datetime-cal-btn]");
    const panel = wrapper.querySelector("[data-datetime-panel]");
    const hiddenInput = wrapper.querySelector('input[type="hidden"]');
    if (!dropdown || !textInput || !calBtn || !panel || !hiddenInput) return;

    panel.remove();
    document.body.appendChild(panel);

    panel.innerHTML = dtpBuildPanelHTML();

    let viewMode = "days";
    const now = new Date();
    const dtpState = {
        viewYear: now.getFullYear(),
        viewMonth: now.getMonth(),
        yearRangeStart: Math.floor(now.getFullYear() / 12) * 12,
        selectedDay: null,
        selectedMonth: null,
        selectedYear: null,
        hour: 12,
        minute: 0,
        period: "AM",
        hasTime: false
    };

    const monthBtn = panel.querySelector("[data-dtp-month-btn]");
    const yearBtn = panel.querySelector("[data-dtp-year-btn]");
    const bodyEl = panel.querySelector("[data-dtp-body]");
    const daysContainer = panel.querySelector("[data-dtp-days]");
    const prevBtn = panel.querySelector("[data-dtp-prev]");
    const nextBtn = panel.querySelector("[data-dtp-next]");
    const hourInput = panel.querySelector("[data-dtp-hour]");
    const minInput = panel.querySelector("[data-dtp-min]");
    const hourUpBtn = panel.querySelector("[data-dtp-hour-up]");
    const hourDownBtn = panel.querySelector("[data-dtp-hour-down]");
    const minUpBtn = panel.querySelector("[data-dtp-min-up]");
    const minDownBtn = panel.querySelector("[data-dtp-min-down]");
    const amBtn = panel.querySelector("[data-dtp-am]");
    const pmBtn = panel.querySelector("[data-dtp-pm]");
    const nowBtn = panel.querySelector("[data-dtp-now]");
    const clearBtn = panel.querySelector("[data-dtp-clear]");
    const confirmBtn = panel.querySelector("[data-dtp-confirm]");

    function pad2(n) { return String(n).padStart(2, "0"); }

    function updateHeaderLabels() {
        monthBtn.textContent = DTP_MONTH_NAMES[dtpState.viewMonth];
        yearBtn.textContent = dtpState.viewYear;
        monthBtn.classList.toggle("active", viewMode === "months");
        yearBtn.classList.toggle("active", viewMode === "years");
    }

    function renderDaysView() {
        viewMode = "days";
        updateHeaderLabels();
        const weekdaysEl = bodyEl.querySelector(".dtp-weekdays");
        if (weekdaysEl) weekdaysEl.style.display = "";
        const firstDay = new Date(dtpState.viewYear, dtpState.viewMonth, 1).getDay();
        const daysInMonth = new Date(dtpState.viewYear, dtpState.viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(dtpState.viewYear, dtpState.viewMonth, 0).getDate();
        const today = new Date();
        let html = "";
        for (let i = firstDay - 1; i >= 0; i--) {
            const d = daysInPrevMonth - i;
            html += `<button type="button" class="dtp-day dtp-day-other-month" data-day="${d}" data-month="${dtpState.viewMonth - 1}" data-year="${dtpState.viewYear}">${d}</button>`;
        }
        for (let d = 1; d <= daysInMonth; d++) {
            let cls = "dtp-day";
            if (d === today.getDate() && dtpState.viewMonth === today.getMonth() && dtpState.viewYear === today.getFullYear()) cls += " dtp-day-today";
            if (d === dtpState.selectedDay && dtpState.viewMonth === dtpState.selectedMonth && dtpState.viewYear === dtpState.selectedYear) cls += " dtp-day-selected";
            html += `<button type="button" class="${cls}" data-day="${d}" data-month="${dtpState.viewMonth}" data-year="${dtpState.viewYear}">${d}</button>`;
        }
        const totalCells = firstDay + daysInMonth;
        const remaining = (7 - (totalCells % 7)) % 7;
        for (let d = 1; d <= remaining; d++) {
            html += `<button type="button" class="dtp-day dtp-day-other-month" data-day="${d}" data-month="${dtpState.viewMonth + 1}" data-year="${dtpState.viewYear}">${d}</button>`;
        }
        daysContainer.innerHTML = html;
        daysContainer.className = "dtp-days";
    }

    function renderMonthsView() {
        viewMode = "months";
        updateHeaderLabels();
        const weekdaysEl = bodyEl.querySelector(".dtp-weekdays");
        if (weekdaysEl) weekdaysEl.style.display = "none";
        const today = new Date();
        let html = "";
        for (let m = 0; m < 12; m++) {
            let cls = "dtp-month-cell";
            if (m === today.getMonth() && dtpState.viewYear === today.getFullYear()) cls += " dtp-month-current";
            if (m === dtpState.viewMonth) cls += " dtp-month-selected";
            html += `<button type="button" class="${cls}" data-month-idx="${m}">${DTP_SHORT_MONTHS[m]}</button>`;
        }
        daysContainer.innerHTML = html;
        daysContainer.className = "dtp-months";
    }

    function renderYearsView() {
        viewMode = "years";
        updateHeaderLabels();
        const weekdaysEl = bodyEl.querySelector(".dtp-weekdays");
        if (weekdaysEl) weekdaysEl.style.display = "none";
        const today = new Date();
        const start = dtpState.yearRangeStart;
        let html = "";
        for (let i = 0; i < 12; i++) {
            const y = start + i;
            let cls = "dtp-year-cell";
            if (y === today.getFullYear()) cls += " dtp-year-current";
            if (y === dtpState.viewYear) cls += " dtp-year-selected";
            html += `<button type="button" class="${cls}" data-year-val="${y}">${y}</button>`;
        }
        daysContainer.innerHTML = html;
        daysContainer.className = "dtp-years";
        yearBtn.textContent = `${start} – ${start + 11}`;
    }

    function render() {
        if (viewMode === "months") renderMonthsView();
        else if (viewMode === "years") renderYearsView();
        else renderDaysView();
    }

    function updateTimeDisplay() {
        hourInput.value = pad2(dtpState.hour);
        minInput.value = pad2(dtpState.minute);
        amBtn.classList.toggle("active", dtpState.period === "AM");
        pmBtn.classList.toggle("active", dtpState.period === "PM");
    }

    function getH24() {
        let h24 = dtpState.hour;
        if (dtpState.period === "PM" && h24 !== 12) h24 += 12;
        if (dtpState.period === "AM" && h24 === 12) h24 = 0;
        return h24;
    }

    function setFromH24(h) {
        if (h === 0) { dtpState.hour = 12; dtpState.period = "AM"; }
        else if (h < 12) { dtpState.hour = h; dtpState.period = "AM"; }
        else if (h === 12) { dtpState.hour = 12; dtpState.period = "PM"; }
        else { dtpState.hour = h - 12; dtpState.period = "PM"; }
    }

    function syncTextInput() {
        if (dtpState.selectedDay === null) {
            textInput.value = "";
            return;
        }
        const dateStr = `${pad2(dtpState.selectedDay)}/${pad2(dtpState.selectedMonth + 1)}/${dtpState.selectedYear}`;
        if (dtpState.hasTime) {
            const h24 = getH24();
            textInput.value = `${dateStr}  ${pad2(h24)}:${pad2(dtpState.minute)}`;
        } else {
            textInput.value = dateStr;
        }
    }

    function writeHiddenValue() {
        if (dtpState.selectedDay === null) {
            hiddenInput.value = "";
        } else {
            /* Write as ISO datetime for API consumption */
            const h24 = dtpState.hasTime ? getH24() : 0;
            const min = dtpState.hasTime ? dtpState.minute : 0;
            const d = new Date(dtpState.selectedYear, dtpState.selectedMonth, dtpState.selectedDay, h24, min);
            if (!Number.isNaN(d.getTime())) {
                hiddenInput.value = d.toISOString();
            }
        }
        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
        hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function applyAndClose() {
        writeHiddenValue();
        syncTextInput();
        closeDropdown();
    }

    /* Inline text input with auto-formatting */
    textInput.addEventListener("input", () => {
        const raw = textInput.value;
        const digits = dtpExtractDigits(raw);
        const formatted = dtpFormatDateTimeDigits(digits.substring(0, 12));
        const cursorBefore = textInput.selectionStart;
        const digitsBefore = dtpExtractDigits(raw.substring(0, cursorBefore)).length;
        textInput.value = formatted;
        let digitsSeen = 0, newCursor = 0;
        for (let i = 0; i < formatted.length; i++) {
            if (/\d/.test(formatted[i])) digitsSeen++;
            if (digitsSeen >= digitsBefore) { newCursor = i + 1; break; }
        }
        if (digitsSeen < digitsBefore) newCursor = formatted.length;
        textInput.setSelectionRange(newCursor, newCursor);
        const parsed = dtpParseDateTimeString(formatted);
        if (parsed) {
            dtpState.selectedDay = parsed.day;
            dtpState.selectedMonth = parsed.month;
            dtpState.selectedYear = parsed.year;
            dtpState.viewMonth = parsed.month;
            dtpState.viewYear = parsed.year;
            if (parsed.hasTime) {
                setFromH24(parsed.hour);
                dtpState.minute = parsed.minute;
                dtpState.hasTime = true;
            }
            writeHiddenValue();
            if (dropdown.classList.contains("open")) render();
            updateTimeDisplay();
        } else if (digits.length === 0) {
            dtpState.selectedDay = null;
            dtpState.selectedMonth = null;
            dtpState.selectedYear = null;
            dtpState.hasTime = false;
            writeHiddenValue();
            if (dropdown.classList.contains("open")) render();
        }
    });

    textInput.addEventListener("blur", () => {
        const parsed = dtpParseDateTimeString(textInput.value);
        if (parsed) {
            dtpState.selectedDay = parsed.day;
            dtpState.selectedMonth = parsed.month;
            dtpState.selectedYear = parsed.year;
            if (parsed.hasTime) {
                setFromH24(parsed.hour);
                dtpState.minute = parsed.minute;
                dtpState.hasTime = true;
            }
            syncTextInput();
            writeHiddenValue();
        } else if (dtpExtractDigits(textInput.value).length > 0 && dtpExtractDigits(textInput.value).length < 8) {
            textInput.value = "";
            dtpState.selectedDay = null;
            writeHiddenValue();
        }
    });

    function positionPanel() {
        const rect = calBtn.getBoundingClientRect();
        const panelHeight = 440;
        const panelWidth = 300;
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow < panelHeight && rect.top > panelHeight) {
            panel.style.top = "auto";
            panel.style.bottom = (window.innerHeight - rect.top + 6) + "px";
        } else {
            panel.style.bottom = "auto";
            panel.style.top = (rect.bottom + 6) + "px";
        }
        let left = rect.right - panelWidth;
        if (left < 8) left = 8;
        if (left + panelWidth > window.innerWidth - 12) left = window.innerWidth - panelWidth - 12;
        panel.style.left = left + "px";
    }

    function openDropdown() {
        closeAllDatetimeDropdowns();
        if (dtpState.selectedDay !== null) {
            dtpState.viewYear = dtpState.selectedYear;
            dtpState.viewMonth = dtpState.selectedMonth;
        } else {
            const n = new Date();
            dtpState.viewYear = n.getFullYear();
            dtpState.viewMonth = n.getMonth();
        }
        dtpState.yearRangeStart = Math.floor(dtpState.viewYear / 12) * 12;
        viewMode = "days";
        render();
        updateTimeDisplay();
        dropdown.classList.add("open");
        panel.classList.add("open");
        positionPanel();
    }

    function closeDropdown() {
        dropdown.classList.remove("open");
        panel.classList.remove("open");
    }

    calBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains("open");
        closeAllDatetimeDropdowns();
        if (!isOpen) openDropdown();
    });

    /* Header navigation */
    monthBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        viewMode = viewMode === "months" ? "days" : "months";
        render();
    });

    yearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (viewMode === "years") {
            viewMode = "days";
        } else {
            dtpState.yearRangeStart = Math.floor(dtpState.viewYear / 12) * 12;
            viewMode = "years";
        }
        render();
    });

    prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (viewMode === "years") { dtpState.yearRangeStart -= 12; }
        else if (viewMode === "months") { dtpState.viewYear--; }
        else { dtpState.viewMonth--; if (dtpState.viewMonth < 0) { dtpState.viewMonth = 11; dtpState.viewYear--; } }
        render();
    });

    nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (viewMode === "years") { dtpState.yearRangeStart += 12; }
        else if (viewMode === "months") { dtpState.viewYear++; }
        else { dtpState.viewMonth++; if (dtpState.viewMonth > 11) { dtpState.viewMonth = 0; dtpState.viewYear++; } }
        render();
    });

    /* Grid click handling */
    daysContainer.addEventListener("click", (e) => {
        const dayBtn = e.target.closest(".dtp-day");
        const monthCell = e.target.closest(".dtp-month-cell");
        const yearCell = e.target.closest(".dtp-year-cell");
        if (dayBtn) {
            let m = parseInt(dayBtn.dataset.month, 10);
            let y = parseInt(dayBtn.dataset.year, 10);
            if (m < 0) { m = 11; y--; }
            if (m > 11) { m = 0; y++; }
            dtpState.selectedDay = parseInt(dayBtn.dataset.day, 10);
            dtpState.selectedMonth = m;
            dtpState.selectedYear = y;
            dtpState.viewMonth = m;
            dtpState.viewYear = y;
            render();
        } else if (monthCell) {
            dtpState.viewMonth = parseInt(monthCell.dataset.monthIdx, 10);
            viewMode = "days";
            render();
        } else if (yearCell) {
            dtpState.viewYear = parseInt(yearCell.dataset.yearVal, 10);
            dtpState.yearRangeStart = Math.floor(dtpState.viewYear / 12) * 12;
            viewMode = "months";
            render();
        }
    });

    /* Time spinners */
    hourUpBtn.addEventListener("click", (e) => { e.stopPropagation(); dtpState.hour = dtpState.hour >= 12 ? 1 : dtpState.hour + 1; dtpState.hasTime = true; updateTimeDisplay(); });
    hourDownBtn.addEventListener("click", (e) => { e.stopPropagation(); dtpState.hour = dtpState.hour <= 1 ? 12 : dtpState.hour - 1; dtpState.hasTime = true; updateTimeDisplay(); });
    minUpBtn.addEventListener("click", (e) => { e.stopPropagation(); dtpState.minute = (dtpState.minute + 1) % 60; dtpState.hasTime = true; updateTimeDisplay(); });
    minDownBtn.addEventListener("click", (e) => { e.stopPropagation(); dtpState.minute = dtpState.minute <= 0 ? 59 : dtpState.minute - 1; dtpState.hasTime = true; updateTimeDisplay(); });
    hourInput.addEventListener("change", () => { let v = parseInt(hourInput.value, 10); if (isNaN(v) || v < 1) v = 1; if (v > 12) v = 12; dtpState.hour = v; dtpState.hasTime = true; updateTimeDisplay(); });
    minInput.addEventListener("change", () => { let v = parseInt(minInput.value, 10); if (isNaN(v) || v < 0) v = 0; if (v > 59) v = 59; dtpState.minute = v; dtpState.hasTime = true; updateTimeDisplay(); });
    amBtn.addEventListener("click", (e) => { e.stopPropagation(); dtpState.period = "AM"; dtpState.hasTime = true; updateTimeDisplay(); });
    pmBtn.addEventListener("click", (e) => { e.stopPropagation(); dtpState.period = "PM"; dtpState.hasTime = true; updateTimeDisplay(); });

    /* Footer buttons */
    nowBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const n = new Date();
        dtpState.selectedDay = n.getDate();
        dtpState.selectedMonth = n.getMonth();
        dtpState.selectedYear = n.getFullYear();
        dtpState.viewMonth = n.getMonth();
        dtpState.viewYear = n.getFullYear();
        let h = n.getHours();
        dtpState.period = h >= 12 ? "PM" : "AM";
        if (h === 0) { h = 12; dtpState.period = "AM"; }
        else if (h > 12) h -= 12;
        dtpState.hour = h;
        dtpState.minute = n.getMinutes();
        dtpState.hasTime = true;
        applyAndClose();
    });

    clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        dtpState.selectedDay = null;
        dtpState.selectedMonth = null;
        dtpState.selectedYear = null;
        dtpState.hour = 12;
        dtpState.minute = 0;
        dtpState.period = "AM";
        dtpState.hasTime = false;
        textInput.value = "";
        writeHiddenValue();
        closeDropdown();
    });

    confirmBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (dtpState.selectedDay === null) {
            const n = new Date();
            dtpState.selectedDay = n.getDate();
            dtpState.selectedMonth = n.getMonth();
            dtpState.selectedYear = n.getFullYear();
        }
        applyAndClose();
    });

    panel.addEventListener("click", (e) => e.stopPropagation());

    /* Parse existing hidden value on init */
    function parseExistingValue() {
        const val = hiddenInput.value?.trim();
        if (!val) return;
        /* Try ISO format first */
        const isoDate = new Date(val);
        if (!Number.isNaN(isoDate.getTime())) {
            dtpState.selectedDay = isoDate.getDate();
            dtpState.selectedMonth = isoDate.getMonth();
            dtpState.selectedYear = isoDate.getFullYear();
            dtpState.viewMonth = isoDate.getMonth();
            dtpState.viewYear = isoDate.getFullYear();
            const h = isoDate.getHours();
            const m = isoDate.getMinutes();
            if (h !== 0 || m !== 0) {
                setFromH24(h);
                dtpState.minute = m;
                dtpState.hasTime = true;
            }
            syncTextInput();
            return;
        }
        /* Try DD/MM/YYYY format */
        const parsed = dtpParseDateTimeString(val);
        if (parsed) {
            dtpState.selectedDay = parsed.day;
            dtpState.selectedMonth = parsed.month;
            dtpState.selectedYear = parsed.year;
            dtpState.viewMonth = parsed.month;
            dtpState.viewYear = parsed.year;
            if (parsed.hasTime) {
                setFromH24(parsed.hour);
                dtpState.minute = parsed.minute;
                dtpState.hasTime = true;
            }
            syncTextInput();
        }
    }

    parseExistingValue();
}

/* ===== CUSTOMER SMART SEARCH ===== */
let _customerSearchTimer = null;
let _customerSearchAbort = null;
let _acceptedCustomer = null;
let _stockItemSearchTimer = null;
let _stockItemSearchAbort = null;
let _acceptedStockItem = null;
let _artisanSearchTimer = null;
let _artisanSearchAbort = null;
let _acceptedArtisan = null;
/* Per-item artisan search state for order item artisan assignments */
const _orderItemArtisanSearch = new Map();
function getOrCreateItemArtisanState(itemId) {
    if (!_orderItemArtisanSearch.has(itemId)) {
        _orderItemArtisanSearch.set(itemId, { timer: null, abort: null, accepted: null });
    }
    return _orderItemArtisanSearch.get(itemId);
}
function clearAllItemArtisanSearchState() {
    _orderItemArtisanSearch.forEach(s => { clearTimeout(s.timer); if (s.abort) s.abort.abort(); });
    _orderItemArtisanSearch.clear();
}
function initOrderItemArtisanSearches() {
    document.querySelectorAll("[data-artisan-search-item]").forEach(input => {
        const itemId = input.dataset.artisanSearchItem;
        const st = getOrCreateItemArtisanState(itemId);
        st.accepted = null;
        input.addEventListener("input", () => {
            clearTimeout(st.timer);
            const q = input.value.trim();
            const hidden = document.getElementById(`artisan-hidden-${itemId}`);
            if (hidden) hidden.value = "";
            st.accepted = null;
            removeAcceptedBadge(`artisan-item-search-wrap-${itemId}`);
            if (!q) { clearItemArtisanSuggestions(itemId); return; }
            st.timer = setTimeout(() => fetchItemArtisanSearch(itemId, q), 250);
        });
        input.addEventListener("keydown", (e) => { if (e.key === "Escape") clearItemArtisanSuggestions(itemId); });
    });
}
async function fetchItemArtisanSearch(itemId, query) {
    const st = getOrCreateItemArtisanState(itemId);
    if (st.abort) st.abort.abort();
    st.abort = new AbortController();
    try {
        const data = await requestJson(`/api/admin/artisans/search?q=${encodeURIComponent(query)}`);
        renderItemArtisanSuggestions(itemId, data.suggestions || [], query);
    } catch (e) {
        if (e.name !== "AbortError") clearItemArtisanSuggestions(itemId);
    }
}
function renderItemArtisanSuggestions(itemId, suggestions, query) {
    const panel = document.getElementById(`artisan-suggestion-panel-${itemId}`);
    if (!panel) return;
    if (!suggestions.length) { panel.innerHTML = ""; panel._suggestions = null; return; }
    panel.innerHTML = suggestions.map((s, i) => {
        const scorePct = Math.round((s.score || 0) * 100);
        const scoreClass = scorePct >= 90 ? "high" : scorePct >= 75 ? "medium" : "low";
        return `<div class="cust-smart-card" style="animation-delay:${i * 40}ms">
            <div class="cust-smart-header">
                <div class="cust-smart-header-left">
                    <div class="cust-smart-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
                    <div class="cust-smart-text">
                        <span class="cust-smart-eyebrow">ARTISAN MATCH</span>
                        <strong>${highlightMatch(s.name, query)}</strong>
                    </div>
                </div>
                <span class="cust-smart-score ${scoreClass}">${scorePct}%</span>
            </div>
            <div class="cust-smart-details">
                ${s.description ? `<div class="cust-smart-detail-line"><span class="cust-smart-detail-label">ABOUT</span><span class="cust-smart-detail-value">${highlightMatch(s.description, query)}</span></div>` : ""}
                ${s.usual_making_charge_percent != null && s.usual_making_charge_percent !== "" ? `<div class="cust-smart-detail-line"><span class="cust-smart-detail-label">USUAL MC%</span><span class="cust-smart-detail-value">${escapeHtml(s.usual_making_charge_percent)}</span></div>` : ""}
            </div>
            <div class="cust-smart-actions">
                <button type="button" class="cust-smart-dismiss" data-dismiss-item-artisan="${itemId}:${i}">Dismiss</button>
                <button type="button" class="cust-smart-accept" data-accept-item-artisan="${itemId}:${i}">Accept</button>
            </div>
        </div>`;
    }).join("");
    panel._suggestions = suggestions;
}
function clearItemArtisanSuggestions(itemId) {
    const panel = document.getElementById(`artisan-suggestion-panel-${itemId}`);
    if (panel) { panel.innerHTML = ""; panel._suggestions = null; }
}
function acceptItemArtisanSuggestion(itemId, suggestion) {
    const hidden = document.getElementById(`artisan-hidden-${itemId}`);
    const input = document.querySelector(`[data-artisan-search-item="${CSS.escape(itemId)}"]`);
    const wrap = document.getElementById(`artisan-item-search-wrap-${itemId}`);
    const st = getOrCreateItemArtisanState(itemId);
    if (!hidden || !input || !wrap) return;
    hidden.value = suggestion.id || "";
    input.value = suggestion.name || "";
    st.accepted = suggestion;
    clearItemArtisanSuggestions(itemId);
    removeAcceptedBadge(`artisan-item-search-wrap-${itemId}`);
    const badge = document.createElement("div");
    badge.className = "customer-accepted-badge";
    const mcStr = suggestion.usual_making_charge_percent != null && suggestion.usual_making_charge_percent !== ""
        ? ` · ${escapeHtml(suggestion.usual_making_charge_percent)}%`
        : "";
    badge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span>Accepted: <span class="accepted-name">${escapeHtml(suggestion.name || "")}${mcStr}</span></span>
        <button type="button" data-clear-item-artisan="${itemId}" title="Clear selection">✕</button>`;
    wrap.appendChild(badge);
}
function clearAcceptedItemArtisan(itemId) {
    const hidden = document.getElementById(`artisan-hidden-${itemId}`);
    const input = document.querySelector(`[data-artisan-search-item="${CSS.escape(itemId)}"]`);
    const wrap = document.getElementById(`artisan-item-search-wrap-${itemId}`);
    const st = getOrCreateItemArtisanState(itemId);
    if (hidden) hidden.value = "";
    if (input) { input.value = ""; input.focus(); }
    st.accepted = null;
    const b = wrap?.querySelector(".customer-accepted-badge");
    if (b) b.remove();
}
const NOTIFICATION_SMART_FIELD_CONFIG = {
    artisan_id: {
        label: "Artisan",
        placeholder: "Search artisan by name or description",
        endpoint: "/api/admin/artisans/search",
        queryMinLength: 1,
        scoreHigh: 90,
        scoreMedium: 75,
        badgeSuffix: (suggestion) => (
            suggestion.usual_making_charge_percent != null && suggestion.usual_making_charge_percent !== ""
                ? ` · ${escapeHtml(suggestion.usual_making_charge_percent)}%`
                : ""
        ),
        title: (suggestion) => suggestion.name || "",
        renderDetails: (suggestion, query) => `
            ${suggestion.description ? `<div class="cust-smart-detail-line"><span class="cust-smart-detail-label">ABOUT</span><span class="cust-smart-detail-value">${highlightMatch(suggestion.description, query)}</span></div>` : ""}
            ${suggestion.usual_making_charge_percent != null && suggestion.usual_making_charge_percent !== "" ? `<div class="cust-smart-detail-line"><span class="cust-smart-detail-label">USUAL MC%</span><span class="cust-smart-detail-value">${escapeHtml(suggestion.usual_making_charge_percent)}</span></div>` : ""}
        `,
    },
    order_id: {
        label: "Order",
        placeholder: "Enter order number",
        endpoint: "/api/admin/orders/search",
        queryMinLength: 1,
        scoreHigh: 95,
        scoreMedium: 80,
        badgeSuffix: (suggestion) => suggestion.status ? ` · ${escapeHtml(formatOptionLabel(suggestion.status))}` : "",
        title: (suggestion) => suggestion.order_number || "",
        renderDetails: (suggestion) => `
            <div class="cust-smart-detail-line"><span class="cust-smart-detail-label">TYPE</span><span class="cust-smart-detail-value">${escapeHtml(formatOptionLabel(suggestion.order_type || "--"))}</span></div>
            <div class="cust-smart-detail-line"><span class="cust-smart-detail-label">STATUS</span><span class="cust-smart-detail-value">${escapeHtml(formatOptionLabel(suggestion.status || "--"))}</span></div>
            <div class="cust-smart-detail-line"><span class="cust-smart-detail-label">PROMISED</span><span class="cust-smart-detail-value">${escapeHtml(formatDate(suggestion.promised_date || ""))}</span></div>
        `,
    },
    invoice_id: {
        label: "Invoice",
        placeholder: "Enter invoice number",
        endpoint: "/api/admin/invoices/search",
        queryMinLength: 1,
        scoreHigh: 95,
        scoreMedium: 80,
        badgeSuffix: (suggestion) => suggestion.customer_name ? ` · ${escapeHtml(suggestion.customer_name)}` : "",
        title: (suggestion) => suggestion.invoice_no || "",
        renderDetails: (suggestion, query) => `
            <div class="cust-smart-detail-line"><span class="cust-smart-detail-label">CUSTOMER</span><span class="cust-smart-detail-value">${highlightMatch(suggestion.customer_name || "--", query)}</span></div>
            <div class="cust-smart-detail-line"><span class="cust-smart-detail-label">STATUS</span><span class="cust-smart-detail-value">${escapeHtml(formatOptionLabel(suggestion.status || "--"))}</span></div>
            <div class="cust-smart-detail-line"><span class="cust-smart-detail-label">DATE</span><span class="cust-smart-detail-value">${escapeHtml(formatDateTime(suggestion.invoice_datetime || ""))}</span></div>
        `,
    },
    receipt_id: {
        label: "Receipt",
        placeholder: "Enter receipt number",
        endpoint: "/api/admin/receipts/search",
        queryMinLength: 1,
        scoreHigh: 95,
        scoreMedium: 80,
        badgeSuffix: (suggestion) => suggestion.customer_name ? ` · ${escapeHtml(suggestion.customer_name)}` : "",
        title: (suggestion) => suggestion.receipt_no || "",
        renderDetails: (suggestion, query) => `
            <div class="cust-smart-detail-line"><span class="cust-smart-detail-label">CUSTOMER</span><span class="cust-smart-detail-value">${highlightMatch(suggestion.customer_name || "--", query)}</span></div>
            <div class="cust-smart-detail-line"><span class="cust-smart-detail-label">STATUS</span><span class="cust-smart-detail-value">${escapeHtml(formatOptionLabel(suggestion.status || "--"))}</span></div>
            <div class="cust-smart-detail-line"><span class="cust-smart-detail-label">DATE</span><span class="cust-smart-detail-value">${escapeHtml(formatDateTime(suggestion.receipt_datetime || ""))}</span></div>
        `,
    },
};
const notificationSmartSearchState = Object.fromEntries(
    Object.keys(NOTIFICATION_SMART_FIELD_CONFIG).map((fieldName) => [fieldName, {
        timer: null,
        abort: null,
        accepted: null,
    }]),
);

function renderCustomerSearchField(field) {
    const fieldId = `field-${field.name}`;
    return `
        <label>
            <span>${escapeHtml(field.label)}</span>
            <div class="customer-search-wrap" id="customer-search-wrap">
                <input type="hidden" name="${escapeHtml(field.name)}" id="${fieldId}">
                <input type="text" id="customer-search-input" placeholder="Search by name, code, phone, email, PAN…" autocomplete="off">
                <div class="customer-suggestion-panel" id="customer-suggestion-panel"></div>
            </div>
        </label>
    `;
}

function renderStockItemSearchField(field) {
    const fieldId = `field-${field.name}`;
    return `
        <label>
            <span>${escapeHtml(field.label)}</span>
            <div class="customer-search-wrap" id="stock-item-search-wrap">
                <input type="hidden" name="${escapeHtml(field.name)}" id="${fieldId}">
                <input type="text" id="stock-item-search-input" placeholder="Enter exact stock number" autocomplete="off">
                <div class="customer-suggestion-panel" id="stock-item-suggestion-panel"></div>
            </div>
        </label>
    `;
}

function renderArtisanSearchField(field) {
    const fieldId = `field-artisan_id`;
    return `
        <label class="full">
            <span>${escapeHtml(field.label)}</span>
            <div class="customer-search-wrap" id="artisan-search-wrap">
                <input type="hidden" name="artisan_id" id="${fieldId}">
                <input type="text" name="${escapeHtml(field.name)}" id="artisan-search-input" placeholder="Search artisan by name or description" autocomplete="off">
                <div class="customer-suggestion-panel" id="artisan-suggestion-panel"></div>
            </div>
        </label>
    `;
}

function renderNotificationSmartLookupField(field) {
    const config = NOTIFICATION_SMART_FIELD_CONFIG[field.name];
    if (!config) return "";
    const fieldId = `field-${field.name}`;
    const wrapId = `notification-${field.name}-search-wrap`;
    const inputId = `notification-${field.name}-search-input`;
    const panelId = `notification-${field.name}-suggestion-panel`;
    return `
        <label>
            <span>${escapeHtml(field.label)}</span>
            <div class="customer-search-wrap" id="${wrapId}">
                <input type="hidden" name="${escapeHtml(field.name)}" id="${fieldId}">
                <input type="text" id="${inputId}" placeholder="${escapeHtml(config.placeholder)}" autocomplete="off">
                <div class="customer-suggestion-panel" id="${panelId}"></div>
            </div>
        </label>
    `;
}

function initCustomerSearch() {
    const input = document.getElementById("customer-search-input");
    const hidden = document.getElementById("field-customer_id");
    if (!input || !hidden) return;
    _acceptedCustomer = null;
    input.addEventListener("input", () => {
        clearTimeout(_customerSearchTimer);
        const q = input.value.trim();
        if (q.length < 2) { clearCustomerSuggestions(); return; }
        _customerSearchTimer = setTimeout(() => fetchCustomerSearch(q), 280);
    });
    input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") clearCustomerSuggestions();
    });
}

function initStockItemSearch() {
    const input = document.getElementById("stock-item-search-input");
    const hidden = document.getElementById("field-stock_item_id");
    if (!input || !hidden) return;
    _acceptedStockItem = null;
    input.addEventListener("input", () => {
        clearTimeout(_stockItemSearchTimer);
        const q = input.value.trim();
        hidden.value = "";
        _acceptedStockItem = null;
        removeAcceptedBadge("stock-item-search-wrap");
        if (!q) {
            clearStockItemSuggestions();
            return;
        }
        _stockItemSearchTimer = setTimeout(() => fetchStockItemSearch(q), 220);
    });
    input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") clearStockItemSuggestions();
    });
}

function initArtisanSearch() {
    const input = document.getElementById("artisan-search-input");
    const hidden = document.getElementById("field-artisan_id");
    if (!input || !hidden) return;
    _acceptedArtisan = null;
    input.addEventListener("input", () => {
        clearTimeout(_artisanSearchTimer);
        const q = input.value.trim();
        hidden.value = "";
        _acceptedArtisan = null;
        removeAcceptedBadge("artisan-search-wrap");
        if (!q) {
            clearArtisanSuggestions();
            return;
        }
        _artisanSearchTimer = setTimeout(() => fetchArtisanSearch(q), 250);
    });
    input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") clearArtisanSuggestions();
    });
}

function initNotificationSmartLookup(fieldName) {
    const config = NOTIFICATION_SMART_FIELD_CONFIG[fieldName];
    const input = document.getElementById(`notification-${fieldName}-search-input`);
    const hidden = document.getElementById(`field-${fieldName}`);
    const tracker = notificationSmartSearchState[fieldName];
    if (!config || !input || !hidden || !tracker) return;
    tracker.accepted = null;
    input.addEventListener("input", () => {
        clearTimeout(tracker.timer);
        const query = input.value.trim();
        hidden.value = "";
        tracker.accepted = null;
        removeAcceptedBadge(`notification-${fieldName}-search-wrap`);
        if (query.length < (config.queryMinLength || 1)) {
            clearNotificationSmartSuggestions(fieldName);
            return;
        }
        tracker.timer = setTimeout(() => fetchNotificationSmartLookup(fieldName, query), 220);
    });
    input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") clearNotificationSmartSuggestions(fieldName);
    });
}

async function fetchCustomerSearch(query) {
    if (_customerSearchAbort) _customerSearchAbort.abort();
    _customerSearchAbort = new AbortController();
    try {
        const data = await requestJson(`/api/admin/customers/search?q=${encodeURIComponent(query)}`);
        renderCustomerSuggestions(data.suggestions || [], query);
    } catch (e) {
        if (e.name !== "AbortError") clearCustomerSuggestions();
    }
}

async function fetchStockItemSearch(query) {
    if (_stockItemSearchAbort) _stockItemSearchAbort.abort();
    _stockItemSearchAbort = new AbortController();
    try {
        const data = await requestJson(`/api/admin/stock-items/search?q=${encodeURIComponent(query)}`);
        renderStockItemSuggestions(data.suggestions || [], query);
    } catch (e) {
        if (e.name !== "AbortError") clearStockItemSuggestions();
    }
}

async function fetchArtisanSearch(query) {
    if (_artisanSearchAbort) _artisanSearchAbort.abort();
    _artisanSearchAbort = new AbortController();
    try {
        const data = await requestJson(`/api/admin/artisans/search?q=${encodeURIComponent(query)}`);
        renderArtisanSuggestions(data.suggestions || [], query);
    } catch (e) {
        if (e.name !== "AbortError") clearArtisanSuggestions();
    }
}

async function fetchNotificationSmartLookup(fieldName, query) {
    const config = NOTIFICATION_SMART_FIELD_CONFIG[fieldName];
    const tracker = notificationSmartSearchState[fieldName];
    if (!config || !tracker) return;
    if (tracker.abort) tracker.abort.abort();
    tracker.abort = new AbortController();
    try {
        const data = await requestJson(`${config.endpoint}?q=${encodeURIComponent(query)}`);
        renderNotificationSmartSuggestions(fieldName, data.suggestions || [], query);
    } catch (error) {
        if (error.name !== "AbortError") clearNotificationSmartSuggestions(fieldName);
    }
}

function highlightMatch(text, query) {
    if (!query || !text) return escapeHtml(text || "");
    const idx = String(text).toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return escapeHtml(text);
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + query.length);
    const after = text.slice(idx + query.length);
    return `${escapeHtml(before)}<span class="cust-smart-match-hl">${escapeHtml(match)}</span>${escapeHtml(after)}`;
}

function removeAcceptedBadge(wrapId) {
    const wrap = document.getElementById(wrapId);
    const badge = wrap?.querySelector(".customer-accepted-badge");
    if (badge) badge.remove();
}

function renderCustomerSuggestions(suggestions, query) {
    const panel = document.getElementById("customer-suggestion-panel");
    if (!panel) return;
    if (!suggestions.length) {
        panel.innerHTML = "";
        return;
    }
    panel.innerHTML = suggestions.map((s, i) => {
        const score = s.score || 0;
        const scoreClass = score >= 0.9 ? "high" : score >= 0.7 ? "medium" : "low";
        const scorePct = Math.round(score * 100);
        const details = [];
        if (s.primary_contact) details.push(`<span class="cust-smart-detail-label">PHONE</span><span class="cust-smart-detail-value">${highlightMatch(s.primary_contact, query)}</span>`);
        if (s.email) details.push(`<span class="cust-smart-detail-label">EMAIL</span><span class="cust-smart-detail-value">${highlightMatch(s.email, query)}</span>`);
        if (s.place_of_supply_name) details.push(`<span class="cust-smart-detail-label">PLACE</span><span class="cust-smart-detail-value">${escapeHtml(s.place_of_supply_name)}</span>`);
        if (s.pan_aadhaar_no) details.push(`<span class="cust-smart-detail-label">PAN/AADHAAR</span><span class="cust-smart-detail-value">${highlightMatch(s.pan_aadhaar_no, query)}</span>`);
        const detailLines = details.map(d => `<div class="cust-smart-detail-line">${d}</div>`).join("");
        return `<div class="cust-smart-card" style="animation-delay:${i * 40}ms">
            <div class="cust-smart-header">
                <div class="cust-smart-header-left">
                    <div class="cust-smart-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
                    <div class="cust-smart-text">
                        <span class="cust-smart-eyebrow">CUSTOMER MATCH</span>
                        <strong>${highlightMatch(s.full_name, query)}</strong>
                    </div>
                </div>
                <span class="cust-smart-score ${scoreClass}">${scorePct}%</span>
            </div>
            <div class="cust-smart-details">${detailLines}</div>
            <div class="cust-smart-actions">
                <button type="button" class="cust-smart-dismiss" data-dismiss-suggestion="${i}">Dismiss</button>
                <button type="button" class="cust-smart-accept" data-accept-suggestion="${i}">Accept</button>
            </div>
        </div>`;
    }).join("");
    // Store suggestions for accept handler
    panel._suggestions = suggestions;
}

function renderStockItemSuggestions(suggestions, query) {
    const panel = document.getElementById("stock-item-suggestion-panel");
    if (!panel) return;
    if (!suggestions.length) {
        panel.innerHTML = "";
        return;
    }
    panel.innerHTML = suggestions.map((s, i) => {
        const scorePct = Math.round((s.score || 0) * 100);
        const scoreClass = scorePct >= 95 ? "high" : scorePct >= 80 ? "medium" : "low";
        return `<div class="cust-smart-card" style="animation-delay:${i * 40}ms">
            <div class="cust-smart-header">
                <div class="cust-smart-header-left">
                    <div class="cust-smart-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></div>
                    <div class="cust-smart-text">
                        <span class="cust-smart-eyebrow">STOCK MATCH</span>
                        <strong>${highlightMatch(s.stock_no, query)}</strong>
                    </div>
                </div>
                <span class="cust-smart-score ${scoreClass}">${scorePct}%</span>
            </div>
            <div class="cust-smart-details">
                <div class="cust-smart-detail-line"><span class="cust-smart-detail-label">DESC</span><span class="cust-smart-detail-value">${escapeHtml(s.description || "--")}</span></div>
                <div class="cust-smart-detail-line"><span class="cust-smart-detail-label">PURITY</span><span class="cust-smart-detail-value">${escapeHtml(s.purity || "--")}</span></div>
                <div class="cust-smart-detail-line"><span class="cust-smart-detail-label">HSN</span><span class="cust-smart-detail-value">${escapeHtml(s.hsn_code || "--")}</span></div>
            </div>
            <div class="cust-smart-actions">
                <button type="button" class="cust-smart-dismiss" data-dismiss-stock-suggestion="${i}">Dismiss</button>
                <button type="button" class="cust-smart-accept" data-accept-stock-suggestion="${i}">Accept</button>
            </div>
        </div>`;
    }).join("");
    panel._suggestions = suggestions;
}

function renderArtisanSuggestions(suggestions, query) {
    const panel = document.getElementById("artisan-suggestion-panel");
    if (!panel) return;
    if (!suggestions.length) {
        panel.innerHTML = "";
        return;
    }
    panel.innerHTML = suggestions.map((s, i) => {
        const scorePct = Math.round((s.score || 0) * 100);
        const scoreClass = scorePct >= 90 ? "high" : scorePct >= 75 ? "medium" : "low";
        return `<div class="cust-smart-card" style="animation-delay:${i * 40}ms">
            <div class="cust-smart-header">
                <div class="cust-smart-header-left">
                    <div class="cust-smart-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
                    <div class="cust-smart-text">
                        <span class="cust-smart-eyebrow">ARTISAN MATCH</span>
                        <strong>${highlightMatch(s.name, query)}</strong>
                    </div>
                </div>
                <span class="cust-smart-score ${scoreClass}">${scorePct}%</span>
            </div>
            <div class="cust-smart-details">
                ${s.description ? `<div class="cust-smart-detail-line"><span class="cust-smart-detail-label">ABOUT</span><span class="cust-smart-detail-value">${highlightMatch(s.description, query)}</span></div>` : ""}
                ${s.usual_making_charge_percent != null && s.usual_making_charge_percent !== "" ? `<div class="cust-smart-detail-line"><span class="cust-smart-detail-label">USUAL MC%</span><span class="cust-smart-detail-value">${escapeHtml(s.usual_making_charge_percent)}</span></div>` : ""}
            </div>
            <div class="cust-smart-actions">
                <button type="button" class="cust-smart-dismiss" data-dismiss-artisan-suggestion="${i}">Dismiss</button>
                <button type="button" class="cust-smart-accept" data-accept-artisan-suggestion="${i}">Accept</button>
            </div>
        </div>`;
    }).join("");
    panel._suggestions = suggestions;
}

function renderNotificationSmartSuggestions(fieldName, suggestions, query) {
    const config = NOTIFICATION_SMART_FIELD_CONFIG[fieldName];
    const panel = document.getElementById(`notification-${fieldName}-suggestion-panel`);
    if (!config || !panel) return;
    if (!suggestions.length) {
        panel.innerHTML = "";
        return;
    }
    panel.innerHTML = suggestions.map((suggestion, index) => {
        const scorePct = Math.round((suggestion.score || 0) * 100);
        const scoreClass = scorePct >= (config.scoreHigh || 90) ? "high" : scorePct >= (config.scoreMedium || 75) ? "medium" : "low";
        return `<div class="cust-smart-card" style="animation-delay:${index * 40}ms">
            <div class="cust-smart-header">
                <div class="cust-smart-header-left">
                    <div class="cust-smart-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
                    <div class="cust-smart-text">
                        <span class="cust-smart-eyebrow">${escapeHtml(config.label.toUpperCase())} MATCH</span>
                        <strong>${highlightMatch(config.title(suggestion), query)}</strong>
                    </div>
                </div>
                <span class="cust-smart-score ${scoreClass}">${scorePct}%</span>
            </div>
            <div class="cust-smart-details">${config.renderDetails(suggestion, query)}</div>
            <div class="cust-smart-actions">
                <button type="button" class="cust-smart-dismiss" data-dismiss-notification-suggestion="${fieldName}:${index}">Dismiss</button>
                <button type="button" class="cust-smart-accept" data-accept-notification-suggestion="${fieldName}:${index}">Accept</button>
            </div>
        </div>`;
    }).join("");
    panel._suggestions = suggestions;
}

function clearCustomerSuggestions() {
    const panel = document.getElementById("customer-suggestion-panel");
    if (panel) { panel.innerHTML = ""; panel._suggestions = null; }
}

function clearStockItemSuggestions() {
    const panel = document.getElementById("stock-item-suggestion-panel");
    if (panel) { panel.innerHTML = ""; panel._suggestions = null; }
}

function clearArtisanSuggestions() {
    const panel = document.getElementById("artisan-suggestion-panel");
    if (panel) { panel.innerHTML = ""; panel._suggestions = null; }
}

function clearNotificationSmartSuggestions(fieldName) {
    const panel = document.getElementById(`notification-${fieldName}-suggestion-panel`);
    if (panel) {
        panel.innerHTML = "";
        panel._suggestions = null;
    }
}

function acceptCustomerSuggestion(suggestion) {
    const hidden = document.getElementById("field-customer_id");
    const input = document.getElementById("customer-search-input");
    const wrap = document.getElementById("customer-search-wrap");
    if (!hidden || !input || !wrap) return;
    hidden.value = suggestion.id;
    _acceptedCustomer = suggestion;
    input.value = suggestion.full_name || "";
    clearCustomerSuggestions();
    // Show accepted badge
    const existing = wrap.querySelector(".customer-accepted-badge");
    if (existing) existing.remove();
    const badge = document.createElement("div");
    badge.className = "customer-accepted-badge";
    const phoneStr = suggestion.primary_contact ? ` · ${escapeHtml(suggestion.primary_contact)}` : "";
    badge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span>Accepted: <span class="accepted-name">${escapeHtml(suggestion.full_name)}${phoneStr}</span></span>
        <button type="button" data-clear-customer title="Clear selection">✕</button>`;
    wrap.appendChild(badge);
}

function acceptStockItemSuggestion(suggestion) {
    const hidden = document.getElementById("field-stock_item_id");
    const input = document.getElementById("stock-item-search-input");
    const wrap = document.getElementById("stock-item-search-wrap");
    if (!hidden || !input || !wrap) return;
    hidden.value = suggestion.id || "";
    input.value = suggestion.stock_no || "";
    _acceptedStockItem = suggestion;
    clearStockItemSuggestions();
    removeAcceptedBadge("stock-item-search-wrap");
    const badge = document.createElement("div");
    badge.className = "customer-accepted-badge";
    const purityStr = suggestion.purity ? ` · ${escapeHtml(suggestion.purity)}` : "";
    badge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span>Accepted: <span class="accepted-name">${escapeHtml(suggestion.stock_no || "")}${purityStr}</span></span>
        <button type="button" data-clear-stock-item title="Clear selection">✕</button>`;
    wrap.appendChild(badge);
    fillOrderItemFromStockSuggestion(suggestion);
}

function acceptArtisanSuggestion(suggestion) {
    const hidden = document.getElementById("field-artisan_id");
    const input = document.getElementById("artisan-search-input");
    const wrap = document.getElementById("artisan-search-wrap");
    if (!hidden || !input || !wrap) return;
    hidden.value = suggestion.id || "";
    input.value = suggestion.name || "";
    _acceptedArtisan = suggestion;
    clearArtisanSuggestions();
    removeAcceptedBadge("artisan-search-wrap");
    const badge = document.createElement("div");
    badge.className = "customer-accepted-badge";
    const mcStr = suggestion.usual_making_charge_percent != null && suggestion.usual_making_charge_percent !== ""
        ? ` · ${escapeHtml(suggestion.usual_making_charge_percent)}%`
        : "";
    badge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span>Accepted: <span class="accepted-name">${escapeHtml(suggestion.name || "")}${mcStr}</span></span>
        <button type="button" data-clear-artisan title="Clear selection">✕</button>`;
    wrap.appendChild(badge);
    applyArtisanSuggestionToStockForm(suggestion);
}

function notificationSuggestionLabel(fieldName, suggestion) {
    if (fieldName === "artisan_id") return suggestion.name || "";
    if (fieldName === "order_id") return suggestion.order_number || "";
    if (fieldName === "invoice_id") return suggestion.invoice_no || "";
    if (fieldName === "receipt_id") return suggestion.receipt_no || "";
    return "";
}

function acceptNotificationSmartSuggestion(fieldName, suggestion) {
    const config = NOTIFICATION_SMART_FIELD_CONFIG[fieldName];
    const hidden = document.getElementById(`field-${fieldName}`);
    const input = document.getElementById(`notification-${fieldName}-search-input`);
    const wrap = document.getElementById(`notification-${fieldName}-search-wrap`);
    const tracker = notificationSmartSearchState[fieldName];
    if (!config || !hidden || !input || !wrap || !tracker) return;
    hidden.value = suggestion.id || "";
    input.value = notificationSuggestionLabel(fieldName, suggestion);
    tracker.accepted = suggestion;
    clearNotificationSmartSuggestions(fieldName);
    removeAcceptedBadge(`notification-${fieldName}-search-wrap`);
    const badge = document.createElement("div");
    badge.className = "customer-accepted-badge";
    badge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span>Accepted: <span class="accepted-name">${escapeHtml(notificationSuggestionLabel(fieldName, suggestion))}${config.badgeSuffix ? config.badgeSuffix(suggestion) : ""}</span></span>
        <button type="button" data-clear-notification-field="${fieldName}" title="Clear selection">✕</button>`;
    wrap.appendChild(badge);
}

function clearAcceptedCustomer() {
    const hidden = document.getElementById("field-customer_id");
    const input = document.getElementById("customer-search-input");
    const wrap = document.getElementById("customer-search-wrap");
    if (hidden) hidden.value = "";
    if (input) { input.value = ""; input.focus(); }
    _acceptedCustomer = null;
    const badge = wrap?.querySelector(".customer-accepted-badge");
    if (badge) badge.remove();
}

function clearAcceptedStockItem() {
    const hidden = document.getElementById("field-stock_item_id");
    const input = document.getElementById("stock-item-search-input");
    if (hidden) hidden.value = "";
    if (input) {
        input.value = "";
        input.focus();
    }
    _acceptedStockItem = null;
    removeAcceptedBadge("stock-item-search-wrap");
}

function clearAcceptedArtisan() {
    const hidden = document.getElementById("field-artisan_id");
    const input = document.getElementById("artisan-search-input");
    if (hidden) hidden.value = "";
    if (input) {
        input.value = "";
        input.focus();
    }
    _acceptedArtisan = null;
    removeAcceptedBadge("artisan-search-wrap");
}

function clearAcceptedNotificationField(fieldName) {
    const input = document.getElementById(`notification-${fieldName}-search-input`);
    const hidden = document.getElementById(`field-${fieldName}`);
    const tracker = notificationSmartSearchState[fieldName];
    if (hidden) hidden.value = "";
    if (input) {
        input.value = "";
        input.focus();
    }
    if (tracker) tracker.accepted = null;
    removeAcceptedBadge(`notification-${fieldName}-search-wrap`);
}

function fillOrderItemFromStockSuggestion(suggestion) {
    const form = document.querySelector('[data-entity-form="order-items"]');
    if (!form || !suggestion) return;
    const setValue = (name, value) => {
        const input = form.querySelector(`[name="${name}"]`);
        if (!input) return;
        input.value = value ?? "";
    };
    setValue("description", suggestion.description);
    setValue("quantity", suggestion.quantity);
    setValue("approx_weight_g", suggestion.net_weight_g);
    setValue("purity", suggestion.purity);
    setValue("predetermined_making_charges_percent", suggestion.making_charges_percent);
    const hsnField = form.querySelector('[name="hsn_code"]');
    if (hsnField) {
        hsnField.value = suggestion.hsn_code || "";
        syncSearchableSelectDisplay(form);
        syncStyledSelectDisplays(form);
    }
    const designNotes = form.querySelector('[name="design_notes"]');
    if (designNotes) designNotes.value = suggestion.notes || "";
}

function applyArtisanSuggestionToStockForm(suggestion) {
    const form = findEntityForm("stock-items");
    if (!form || !suggestion) return;
    const goldsmithInput = form.querySelector('[name="goldsmith_name"]');
    const goldsmithLossField = form.querySelector('[name="goldsmith_loss"]');
    if (goldsmithInput) goldsmithInput.value = suggestion.name || "";
    if (goldsmithLossField && !String(goldsmithLossField.value || "").trim() && suggestion.usual_making_charge_percent != null) {
        goldsmithLossField.value = suggestion.usual_making_charge_percent;
    }
}

/* ===== SEARCHABLE SELECT (HSN DROPDOWN) ===== */
function renderSearchableSelect(field) {
    const fieldId = `field-${field.name}`;
    const options = field.options || [];
    const chevronSvg = `<svg class="searchable-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    const searchSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
    const optionsHtml = options.map(o => {
        const parts = o.label.split(" · ");
        const code = parts[0] || o.value;
        const name = parts.slice(1).join(" · ");
        return `<div class="searchable-option" data-value="${escapeHtml(o.value)}" data-search-text="${escapeHtml(o.label.toLowerCase())}">
            <span class="searchable-option-code">${escapeHtml(code)}</span>
            <span class="searchable-option-name">${escapeHtml(name)}</span>
        </div>`;
    }).join("");
    const sectionHeaderHtml = field.sectionLabel
        ? `<div class="searchable-options-section-label">${escapeHtml(field.sectionLabel)}</div>`
        : "";
    const searchPlaceholder = field.name === "state_name" ? "Search state…" :
        field.name === "place_of_supply_name" ? "Search state…" :
        `Search ${escapeHtml(field.label).toLowerCase()}…`;
    return `
        <label>
            <span>${escapeHtml(field.label)}</span>
            <div class="searchable-select" data-searchable-for="${escapeHtml(field.name)}">
                <select name="${escapeHtml(field.name)}" id="${fieldId}" ${field.required ? "required" : ""}>
                    ${valueOptionsHtml(options, "")}
                </select>
                <button type="button" class="searchable-trigger" tabindex="0">
                    <div class="searchable-trigger-content">
                        <span class="searchable-trigger-placeholder">Select ${escapeHtml(field.label)}…</span>
                    </div>
                    ${chevronSvg}
                </button>
                <div class="searchable-panel">
                    <div class="searchable-search-box">
                        ${searchSvg}
                        <input type="text" class="searchable-search" placeholder="${searchPlaceholder}">
                    </div>
                    <div class="searchable-options">${sectionHeaderHtml}${optionsHtml}</div>
                    <div class="searchable-no-results">No results found</div>
                </div>
            </div>
        </label>
    `;
}


function initSearchableSelects(container) {
    const root = container || document;
    root.querySelectorAll(".searchable-select").forEach(wrap => {
        if (wrap._searchableInit) return;
        wrap._searchableInit = true;
        const trigger = wrap.querySelector(".searchable-trigger");
        const panel = wrap.querySelector(".searchable-panel");
        const searchInput = wrap.querySelector(".searchable-search");
        const optionsContainer = wrap.querySelector(".searchable-options");
        const noResults = wrap.querySelector(".searchable-no-results");
        const hiddenSelect = wrap.querySelector("select");
        if (!trigger || !panel || !hiddenSelect) return;

        function positionPanel() {
            const rect = trigger.getBoundingClientRect();
            panel.style.width = rect.width + "px";
            panel.style.left = rect.left + "px";
            const spaceBelow = window.innerHeight - rect.bottom;
            if (spaceBelow < 300 && rect.top > 300) {
                panel.style.bottom = (window.innerHeight - rect.top + 4) + "px";
                panel.style.top = "auto";
            } else {
                panel.style.top = (rect.bottom + 4) + "px";
                panel.style.bottom = "auto";
            }
        }

        function openPanel() {
            positionPanel();
            wrap.classList.add("open");
            panel.classList.add("open");
            if (searchInput) { searchInput.value = ""; searchInput.focus(); filterOptions(""); }
        }

        function closePanel() {
            wrap.classList.remove("open");
            panel.classList.remove("open");
        }

        function selectValue(value) {
            hiddenSelect.value = value;
            hiddenSelect.dispatchEvent(new Event("change", { bubbles: true }));
            updateTriggerDisplay();
            closePanel();
        }

        function updateTriggerDisplay() {
            const val = hiddenSelect.value;
            const content = trigger.querySelector(".searchable-trigger-content");
            if (!val) {
                content.innerHTML = `<span class="searchable-trigger-placeholder">Select…</span>`;
                return;
            }
            const opt = hiddenSelect.options[hiddenSelect.selectedIndex];
            const label = opt?.textContent || val;
            const parts = label.split(" · ");
            const code = parts[0] || val;
            const desc = parts[1] || "";
            /* For purity fields, show only the code chip — no description */
            const fieldName = wrap.dataset.searchableFor || "";
            const isPurity = fieldName === "purity";
            content.innerHTML = `<span class="searchable-trigger-code">${escapeHtml(code)}</span>` +
                (isPurity ? "" : `<span class="searchable-trigger-name">${escapeHtml(desc)}</span>`);
            // Mark selected in options
            optionsContainer.querySelectorAll(".searchable-option").forEach(o => o.classList.toggle("selected", o.dataset.value === val));
        }

        function filterOptions(query) {
            const q = query.toLowerCase().trim();
            let visible = 0;
            optionsContainer.querySelectorAll(".searchable-option").forEach(o => {
                const text = o.dataset.searchText || "";
                const show = !q || text.includes(q);
                o.dataset.hidden = show ? "false" : "true";
                if (show) visible++;
            });
            const sectionLabel = optionsContainer.querySelector(".searchable-options-section-label");
            if (sectionLabel) sectionLabel.style.display = visible > 0 ? "" : "none";
            if (noResults) noResults.classList.toggle("visible", visible === 0 && q.length > 0);
        }

        trigger.addEventListener("click", (e) => {
            e.preventDefault();
            if (wrap.classList.contains("open")) closePanel();
            else openPanel();
        });

        if (searchInput) {
            searchInput.addEventListener("input", () => filterOptions(searchInput.value));
            searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });
        }

        optionsContainer.addEventListener("click", (e) => {
            const opt = e.target.closest(".searchable-option");
            if (opt) selectValue(opt.dataset.value);
        });

        document.addEventListener("click", (e) => {
            if (!wrap.contains(e.target)) closePanel();
        });

        // Sync initial value
        updateTriggerDisplay();
    });
}

/* ===== STYLED SELECT (General-purpose themed dropdown) ===== */
function initStyledSelects(container) {
    const root = container || document;
    root.querySelectorAll(".styled-select-wrap").forEach(wrap => {
        if (wrap._styledInit) return;
        wrap._styledInit = true;
        const trigger = wrap.querySelector(".styled-select-trigger");
        const dropdown = wrap.querySelector(".styled-select-dropdown");
        const optionsContainer = wrap.querySelector(".styled-select-options");
        const hiddenSelect = wrap.querySelector("select");
        if (!trigger || !dropdown || !hiddenSelect) return;

        function positionDropdown() {
            const rect = trigger.getBoundingClientRect();
            dropdown.style.width = rect.width + "px";
            dropdown.style.left = rect.left + "px";
            const spaceBelow = window.innerHeight - rect.bottom;
            if (spaceBelow < 280 && rect.top > 280) {
                dropdown.style.bottom = (window.innerHeight - rect.top + 4) + "px";
                dropdown.style.top = "auto";
            } else {
                dropdown.style.top = (rect.bottom + 4) + "px";
                dropdown.style.bottom = "auto";
            }
        }

        function openDropdown() {
            positionDropdown();
            wrap.classList.add("open");
            dropdown.classList.add("open");
            syncSelectedState();
        }

        function closeDropdown() {
            wrap.classList.remove("open");
            dropdown.classList.remove("open");
        }

        function selectValue(value) {
            hiddenSelect.value = value;
            hiddenSelect.dispatchEvent(new Event("change", { bubbles: true }));
            updateTriggerText();
            closeDropdown();
        }

        function updateTriggerText() {
            const val = hiddenSelect.value;
            const textEl = trigger.querySelector(".styled-select-trigger-text");
            if (!val) {
                textEl.textContent = "Select";
                textEl.classList.add("placeholder");
                return;
            }
            const opt = hiddenSelect.options[hiddenSelect.selectedIndex];
            textEl.textContent = opt?.textContent || val;
            textEl.classList.remove("placeholder");
            syncSelectedState();
        }

        function syncSelectedState() {
            const val = hiddenSelect.value;
            optionsContainer.querySelectorAll(".styled-select-option").forEach(o => {
                o.classList.toggle("selected", o.dataset.value === val);
            });
        }

        trigger.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (wrap.classList.contains("open")) closeDropdown();
            else openDropdown();
        });

        optionsContainer.addEventListener("click", (e) => {
            const opt = e.target.closest(".styled-select-option");
            if (opt && !opt.classList.contains("disabled")) selectValue(opt.dataset.value);
        });

        document.addEventListener("click", (e) => {
            if (!wrap.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
        });

        // Sync initial value
        updateTriggerText();
    });
}

function syncStyledSelectDisplays(container) {
    const root = container || document;
    root.querySelectorAll(".styled-select-wrap").forEach(wrap => {
        const hiddenSelect = wrap.querySelector("select");
        const trigger = wrap.querySelector(".styled-select-trigger");
        if (!hiddenSelect || !trigger) return;
        const val = hiddenSelect.value;
        const textEl = trigger.querySelector(".styled-select-trigger-text");
        if (!textEl) return;
        if (!val) {
            textEl.textContent = "Select";
            textEl.classList.add("placeholder");
        } else {
            const opt = hiddenSelect.options[hiddenSelect.selectedIndex];
            textEl.textContent = opt?.textContent || val;
            textEl.classList.remove("placeholder");
        }
        const optionsContainer = wrap.querySelector(".styled-select-options");
        if (optionsContainer) {
            optionsContainer.querySelectorAll(".styled-select-option").forEach(o => {
                o.classList.toggle("selected", o.dataset.value === val);
            });
        }
    });
}

/* ===== FIELD RENDERER ===== */
function isSearchableSelectField(field) {
    const searchableNames = ["hsn_code", "purity", "state_name", "place_of_supply_name"];
    return field.type === "select" && searchableNames.includes(field.name) && (field.options || []).length > 3;
}

function isCustomerLookup(field) {
    return field.name === "customer_id" && field.type === "lookup" && field.lookup === "customers";
}

function isOrderItemStockLookup(field, entitySlug) {
    return entitySlug === "order-items" && field.name === "stock_item_id" && field.type === "lookup" && field.lookup === "stockItems";
}

function isStockItemArtisanIdField(field, entitySlug) {
    return entitySlug === "stock-items" && field.name === "artisan_id" && field.type === "lookup" && field.lookup === "artisans";
}

function isStockItemGoldsmithField(field, entitySlug) {
    return entitySlug === "stock-items" && field.name === "goldsmith_name";
}

function isNotificationSmartLookup(field, entitySlug) {
    return entitySlug === "notifications" && ["artisan_id", "order_id", "invoice_id", "receipt_id"].includes(field.name);
}

/* When editing, sync customer search field with existing customer_id value */
function syncCustomerSearchFromValue(slug, row) {
    const entity = getEntity(slug);
    if (!entity || !entity.fields.some(isCustomerLookup)) return;
    const customerId = row?.customer_id;
    if (!customerId) return;
    const hidden = document.getElementById("field-customer_id");
    if (hidden) hidden.value = customerId;
    /* Try to resolve name from lookup data */
    const options = state.lookups?.customers || [];
    const match = options.find(o => String(o.value) === String(customerId));
    if (match) {
        const input = document.getElementById("customer-search-input");
        if (input) input.value = match.label || "";
        acceptCustomerSuggestion({ id: customerId, full_name: match.label || String(customerId), primary_contact: "" });
    }
}

function syncStockItemSearchFromValue(slug, row) {
    if (slug !== "order-items") return;
    const stockItemId = row?.stock_item_id;
    if (!stockItemId) return;
    const hidden = document.getElementById("field-stock_item_id");
    const input = document.getElementById("stock-item-search-input");
    if (hidden) hidden.value = stockItemId;
    const options = state.lookups?.stockItems || [];
    const match = options.find((option) => String(option.value) === String(stockItemId));
    if (match && input) {
        input.value = (match.label || "").split(" - ")[0] || match.label || "";
        acceptStockItemSuggestion({
            id: stockItemId,
            stock_no: input.value,
            description: (match.label || "").split(" - ").slice(1).join(" - "),
        });
    }
}

function syncArtisanSearchFromValue(slug, row) {
    if (slug !== "stock-items") return;
    const artisanId = row?.artisan_id;
    const goldsmithName = row?.goldsmith_name || "";
    const input = document.getElementById("artisan-search-input");
    const hidden = document.getElementById("field-artisan_id");
    if (hidden) hidden.value = artisanId || "";
    if (input && goldsmithName) input.value = goldsmithName;
    if (!artisanId) return;
    const options = state.lookups?.artisans || [];
    const match = options.find((option) => String(option.value) === String(artisanId));
    if (match) {
        acceptArtisanSuggestion({
            id: artisanId,
            name: goldsmithName || (match.label || "").split(" - ")[0] || String(artisanId),
        });
    }
}

function syncNotificationSmartLookupsFromValue(row) {
    if (!row) return;
    const syncField = (fieldName, suggestion) => {
        if (!suggestion?.id) return;
        acceptNotificationSmartSuggestion(fieldName, suggestion);
    };
    if (row.artisan_id) {
        syncField("artisan_id", {
            id: row.artisan_id,
            name: row.artisan_name || formatLookupValue("artisans", row.artisan_id),
        });
    }
    if (row.order_id) {
        syncField("order_id", {
            id: row.order_id,
            order_number: row.order_number || formatLookupValue("orders", row.order_id),
        });
    }
    if (row.invoice_id) {
        syncField("invoice_id", {
            id: row.invoice_id,
            invoice_no: row.invoice_no || formatLookupValue("invoices", row.invoice_id),
            customer_name: row.customer_name || "",
        });
    }
    if (row.receipt_id) {
        syncField("receipt_id", {
            id: row.receipt_id,
            receipt_no: row.receipt_no || formatLookupValue("receipts", row.receipt_id),
            customer_name: row.customer_name || "",
        });
    }
}

/* Sync searchable select trigger when value set programmatically */
function syncSearchableSelectDisplay(container) {
    const root = container || document;
    root.querySelectorAll(".searchable-select").forEach(wrap => {
        const hiddenSelect = wrap.querySelector("select");
        const trigger = wrap.querySelector(".searchable-trigger");
        if (!hiddenSelect || !trigger) return;
        const val = hiddenSelect.value;
        const content = trigger.querySelector(".searchable-trigger-content");
        if (!content) return;
        if (!val) {
            content.innerHTML = `<span class="searchable-trigger-placeholder">Select\u2026</span>`;
            return;
        }
        const opt = hiddenSelect.options[hiddenSelect.selectedIndex];
        const label = opt?.textContent || val;
        const parts = label.split(" \u00b7 ");
        const code = parts[0] || val;
        const desc = parts[1] || "";
        const fieldName = wrap.dataset.searchableFor || "";
        const isPurity = fieldName === "purity";
        content.innerHTML = `<span class="searchable-trigger-code">${escapeHtml(code)}</span>` +
            (isPurity ? "" : `<span class="searchable-trigger-name">${escapeHtml(desc)}</span>`);
        const optionsContainer = wrap.querySelector(".searchable-options");
        if (optionsContainer) {
            optionsContainer.querySelectorAll(".searchable-option").forEach(o => o.classList.toggle("selected", o.dataset.value === val));
        }
    });
}

function renderField(field, entitySlug = "") {
    if (field.readOnly) return "";
    const required = field.required ? "required" : "";
    const fieldId = `field-${field.name}`;
    const stockHuidHelp = entitySlug === "stock-items" && field.name === "huid"
        ? `<small class="field-help">Enter one or more HUIDs separated by spaces.</small>`
        : "";
    const numberHelp = entitySlug === "stock-items" && field.name === "stock_no"
        ? `<small class="field-help">Suggested after HSN and purity are selected. You may change it.</small>`
        : entitySlug === "orders" && field.name === "order_number"
            ? `<small class="field-help">A financial-year suggestion is prefilled. You may change it.</small>`
            : "";
    if (field.type === "textarea" || field.type === "json") {
        return `
            <label class="full">
                <span>${escapeHtml(field.label)}</span>
                <textarea name="${escapeHtml(field.name)}" id="${fieldId}" rows="${field.textareaRows || 3}" ${required}></textarea>
            </label>
        `;
    }
    if (field.type === "checkbox") {
        return `
            <label class="full inline-check">
                <input type="checkbox" name="${escapeHtml(field.name)}" id="${fieldId}">
                <span>${escapeHtml(field.label)}</span>
            </label>
        `;
    }
    /* Customer lookup → smart search input */
    if (isCustomerLookup(field)) {
        return renderCustomerSearchField(field);
    }
    if (isOrderItemStockLookup(field, entitySlug)) {
        return renderStockItemSearchField(field);
    }
    if (isStockItemArtisanIdField(field, entitySlug)) {
        return "";
    }
    if (isStockItemGoldsmithField(field, entitySlug)) {
        return renderArtisanSearchField(field);
    }
    if (isNotificationSmartLookup(field, entitySlug)) {
        return renderNotificationSmartLookupField(field);
    }
    /* HSN code → searchable dropdown */
    if (isSearchableSelectField(field)) {
        return renderSearchableSelect(field);
    }
    if (field.type === "select") {
        const opts = field.options || [];
        const chevron = `<svg class="styled-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`;
        const optionsDivs = opts.map(o => `<div class="styled-select-option" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`).join("");
        return `
            <label>
                <span>${escapeHtml(field.label)}</span>
                <div class="styled-select-wrap" data-styled-select-for="${escapeHtml(field.name)}">
                    <select name="${escapeHtml(field.name)}" id="${fieldId}" ${required}>
                        ${valueOptionsHtml(opts, "")}
                    </select>
                    <button type="button" class="styled-select-trigger" tabindex="0">
                        <span class="styled-select-trigger-text placeholder">Select</span>
                        ${chevron}
                    </button>
                    <div class="styled-select-dropdown">
                        <div class="styled-select-options">
                            <div class="styled-select-option disabled" data-value="">Select</div>
                            ${optionsDivs}
                        </div>
                    </div>
                </div>
            </label>
        `;
    }
    if (field.type === "lookup") {
        const opts = getLookupOptions(field);
        const chevron = `<svg class="styled-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`;
        const optionsDivs = opts.map(o => `<div class="styled-select-option" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`).join("");
        return `
            <label>
                <span>${escapeHtml(field.label)}</span>
                <div class="styled-select-wrap" data-styled-select-for="${escapeHtml(field.name)}">
                    <select name="${escapeHtml(field.name)}" id="${fieldId}">
                        ${valueOptionsHtml(opts, "")}
                    </select>
                    <button type="button" class="styled-select-trigger" tabindex="0">
                        <span class="styled-select-trigger-text placeholder">Select</span>
                        ${chevron}
                    </button>
                    <div class="styled-select-dropdown">
                        <div class="styled-select-options">
                            <div class="styled-select-option disabled" data-value="">Select</div>
                            ${optionsDivs}
                        </div>
                    </div>
                </div>
            </label>
        `;
    }
    const typeMap = {
        email: "email",
        number: "number",
        integer: "number",
        date: "date",
        datetime: "datetime-local",
        array: "text",
    };
    const inputType = typeMap[field.type] || "text";
    const step = field.type === "number"
        ? (entitySlug === "raw-metal-purchases" && field.name === "weight_g" ? 'step="0.001"' : 'step="0.01"')
        : field.type === "integer" ? 'step="1"' : "";
    return `
        <label>
            <span>${escapeHtml(field.label)}</span>
            <input name="${escapeHtml(field.name)}" id="${fieldId}" type="${inputType}" ${step} ${required}>
            ${stockHuidHelp}
            ${numberHelp}
        </label>
    `;
}

function buildNotificationsSection() {
    const section = document.createElement("section");
    section.className = "page-section";
    section.dataset.sectionPanel = "notifications";
    section.innerHTML = `
        <article class="panel-card notifications-shell">
            <div class="panel-heading table-heading">
                <div>
                    <p class="panel-kicker">Notifications</p>
                    <h3>Calendar reminders for customers, artisans, and document follow-ups</h3>
                </div>
                <div class="hero-actions">
                    <button type="button" class="primary-action compact-action" data-create-notification>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        New Reminder
                    </button>
                    <button type="button" class="secondary-action compact-action" data-jump-notifications-today>Today</button>
                    <button type="button" class="secondary-action compact-action" data-refresh-entity="notifications">Refresh</button>
                </div>
            </div>
            <div class="notifications-toolbar">
                <input type="search" class="search-input" data-entity-search="notifications" placeholder="Search subject, body, customer, artisan, order, invoice, or receipt…">
                <div class="notifications-month-controls">
                    <button type="button" class="ghost-action compact-action" data-notification-month-shift="-1">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <input type="month" id="notifications-month-input">
                    <button type="button" class="ghost-action compact-action" data-notification-month-shift="1">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                </div>
            </div>
            <div class="notifications-filter-pills" id="notifications-filter-pills"></div>
            <div class="notifications-layout">
                <section class="notifications-calendar-card">
                    <div class="notifications-calendar-head">
                        <div>
                            <span class="label">Calendar</span>
                            <h4 id="notifications-month-label">Month</h4>
                        </div>
                        <button type="button" class="secondary-action compact-action" data-create-notification-for-selected>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            Add for Date
                        </button>
                    </div>
                    <div class="notifications-weekdays">
                        <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
                    </div>
                    <div class="notifications-calendar-grid" id="notifications-calendar-grid"></div>
                </section>
                <section class="notifications-sidebar">
                    <div class="notifications-agenda-card">
                        <div class="notifications-sidebar-head">
                            <div>
                                <span class="label">Selected Date</span>
                                <h4 id="notifications-selected-date-label">Date</h4>
                            </div>
                            <button type="button" class="ghost-action compact-action" data-create-notification-for-selected>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                Add
                            </button>
                        </div>
                        <div id="notifications-selected-list"></div>
                    </div>
                    <div class="notifications-agenda-card">
                        <div class="notifications-sidebar-head">
                            <div>
                                <span class="label">Upcoming</span>
                                <h4>Next reminders</h4>
                            </div>
                        </div>
                        <div id="notifications-upcoming-list"></div>
                    </div>
                </section>
            </div>
            <div class="notifications-table-wrap">
                <div class="notifications-sidebar-head">
                    <div>
                        <span class="label">All Reminders</span>
                        <h4>Search results and history</h4>
                    </div>
                </div>
                <div class="table-shell" id="notifications-table"></div>
            </div>
        </article>
    `;
    return section;
}

function notificationDayStatusCounts(dayRows) {
    let due = 0, open = 0, closed = 0;
    dayRows.forEach((row) => {
        if (isNotificationClosed(row)) { closed += 1; }
        else if (isNotificationDue(row)) { due += 1; }
        else { open += 1; }
    });
    return { due, open, closed };
}

function renderNotificationsCalendar(rows) {
    const grid = document.getElementById("notifications-calendar-grid");
    const monthInput = document.getElementById("notifications-month-input");
    const monthLabel = document.getElementById("notifications-month-label");
    if (!grid || !monthInput || !monthLabel) return;
    monthInput.value = state.notifications.calendarMonth;
    monthLabel.textContent = formatMonthLabel(state.notifications.calendarMonth);
    const [year, month] = state.notifications.calendarMonth.split("-").map(Number);
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    const leading = first.getDay();
    const totalDays = last.getDate();
    const today = localIsoDate(new Date());
    const cells = [];
    for (let i = 0; i < leading; i += 1) {
        cells.push(`<button type="button" class="notification-day is-empty" disabled></button>`);
    }
    for (let day = 1; day <= totalDays; day += 1) {
        const isoDate = `${year}-${padNumber(month)}-${padNumber(day)}`;
        const dayRows = rows.filter((row) => notificationMatchesDate(row, isoDate));
        const counts = notificationDayStatusCounts(dayRows);
        const total = dayRows.length;
        const classes = [
            "notification-day",
            isoDate === state.notifications.selectedDate ? "is-selected" : "",
            isoDate === today ? "is-today" : "",
            total ? "has-notifications" : "",
            counts.due ? "has-due" : "",
        ].filter(Boolean).join(" ");
        /* Build dot indicators — max 5 dots, then show count */
        let dotsHtml = "";
        const dotLimit = 5;
        const dotEntries = [];
        for (let d = 0; d < Math.min(counts.due, dotLimit); d++) dotEntries.push("dot-due");
        for (let d = 0; d < Math.min(counts.open, dotLimit - dotEntries.length); d++) dotEntries.push("dot-open");
        if (dotEntries.length > 0) {
            dotsHtml = `<span class="notification-day-dots">${dotEntries.map(c => `<span class="notification-day-dot ${c}"></span>`).join("")}</span>`;
        }
        const countBadge = total > 1 ? `<span class="notification-day-count">${total}</span>` : "";
        cells.push(`
            <button type="button" class="${classes}" data-select-notification-date="${isoDate}">
                <span class="notification-day-number">${day}</span>
                ${dotsHtml}
                ${countBadge}
            </button>
        `);
    }
    grid.innerHTML = cells.join("");
}

function notificationCardStatusClass(row) {
    if (isNotificationClosed(row)) return "is-closed";
    if (isNotificationDue(row)) return "is-due";
    return "";
}

function notificationCardIcon(row) {
    if (isNotificationClosed(row)) return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    if (isNotificationDue(row)) return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
}

function renderNotificationCards(target, rows, { emptyMessage = "No reminders scheduled." } = {}) {
    if (!target) return;
    if (!rows.length) {
        target.innerHTML = `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
        return;
    }
    target.innerHTML = rows.map((row, idx) => `
        <article class="notification-card ${notificationCardStatusClass(row)}" style="animation-delay:${idx * 50}ms">
            <div class="notification-card-top">
                <div class="notification-card-left">
                    <div class="notification-card-icon">${notificationCardIcon(row)}</div>
                    <div class="notification-card-info">
                        <span class="notification-card-time">${escapeHtml(formatDateTime(notificationEffectiveAt(row)))}</span>
                        <h5>${escapeHtml(row.subject || "Reminder")}</h5>
                    </div>
                </div>
                <div class="notification-card-status">${notificationStatusBadge(row)}</div>
            </div>
            ${row.body ? `<p class="notification-card-body">${escapeHtml(truncate(row.body, 180))}</p>` : ""}
            <div class="notification-card-links">${notificationLinkSummaryHtml(row)}</div>
            <div class="notification-card-actions">
                <button type="button" class="table-action" data-edit-notification="${row.id}">Edit</button>
                ${!isNotificationClosed(row) ? `<button type="button" class="table-action danger" data-close-notification="${row.id}">Close</button>` : ""}
            </div>
        </article>
    `).join("");
}

function renderNotificationsFilterPills(allRows) {
    const container = document.getElementById("notifications-filter-pills");
    if (!container) return;
    const counts = notificationDayStatusCounts(allRows);
    const total = allRows.length;
    const active = state.notifications.filter || "active";
    const pills = [
        { key: "active", label: "Active", count: counts.due + counts.open },
        { key: "due", label: "Due", count: counts.due },
        { key: "open", label: "Open", count: counts.open },
        { key: "closed", label: "Closed", count: counts.closed },
        { key: "all", label: "All", count: total },
    ];
    container.innerHTML = pills.map(p =>
        `<button type="button" class="notifications-filter-pill${p.key === active ? " active" : ""}" data-notification-filter="${p.key}">${p.label}<span class="pill-count">${p.count}</span></button>`
    ).join("");
}

function applyNotificationFilter(rows) {
    const filter = state.notifications.filter || "active";
    if (filter === "all") return rows;
    if (filter === "active") return rows.filter(r => !isNotificationClosed(r));
    if (filter === "due") return rows.filter(r => isNotificationDue(r));
    if (filter === "open") return rows.filter(r => !isNotificationClosed(r) && !isNotificationDue(r));
    if (filter === "closed") return rows.filter(r => isNotificationClosed(r));
    return rows;
}

function renderNotificationsSection() {
    const searchQuery = String(state.searches.notifications || "").trim().toLowerCase();
    const allRows = getNotificationRows().slice().sort(compareNotifications);
    const searchedRows = searchQuery
        ? allRows.filter((row) => JSON.stringify(row).toLowerCase().includes(searchQuery))
        : allRows;
    /* Render filter pills based on searched (pre-filter) data */
    renderNotificationsFilterPills(searchedRows);
    /* Apply status filter */
    const filteredRows = applyNotificationFilter(searchedRows);
    renderNotificationsCalendar(filteredRows);
    const selectedRows = getNotificationsForDate(state.notifications.selectedDate)
        .filter((row) => !searchQuery || JSON.stringify(row).toLowerCase().includes(searchQuery))
        .filter((row) => { const f = state.notifications.filter || "active"; return f === "all" || (f === "closed" ? isNotificationClosed(row) : !isNotificationClosed(row)); });
    const upcomingRows = filteredRows.filter(isNotificationUpcoming).slice(0, 8);
    const selectedDateLabel = document.getElementById("notifications-selected-date-label");
    if (selectedDateLabel) selectedDateLabel.textContent = formatDate(state.notifications.selectedDate);
    renderNotificationCards(document.getElementById("notifications-selected-list"), selectedRows, {
        emptyMessage: "No reminders on this date yet.",
    });
    renderNotificationCards(document.getElementById("notifications-upcoming-list"), upcomingRows, {
        emptyMessage: "No upcoming reminders.",
    });
    renderTable(
        document.getElementById("notifications-table"),
        [
            { key: "subject", label: "Subject" },
            { key: "effective_at", label: "When", render: (_value, row) => formatDateTime(notificationEffectiveAt(row)) },
            {
                key: "linked",
                label: "Linked To",
                render: (_value, row) => escapeHtml(describeNotificationLinks(row).join(" · ") || "Standalone reminder"),
            },
            { key: "status", label: "Status", render: (_value, row) => notificationStatusBadge(row) },
        ],
        filteredRows,
        [
            { entity: "notifications", action: "notification-edit", label: "Edit" },
            { entity: "notifications", action: "notification-open", label: "Open" },
            { entity: "notifications", action: "notification-close", label: "Close", kind: "danger" },
        ],
    );
}

function renderDueNotificationToasts() {
    if (!floatingNotificationStack) return;
    const dueRows = getNotificationRows()
        .filter(isNotificationDue)
        .sort(compareNotifications);
    if (!dueRows.length) {
        floatingNotificationStack.innerHTML = "";
        return;
    }
    floatingNotificationStack.innerHTML = dueRows.map((row, idx) => `
        <article class="floating-notification-card" style="animation-delay:${idx * 80}ms">
            <div class="floating-notification-head">
                <span class="floating-notification-badge"><span class="pulse-dot"></span> Reminder Due</span>
                <span class="floating-notification-time">${escapeHtml(formatDateTime(notificationEffectiveAt(row)))}</span>
            </div>
            <h4>${escapeHtml(row.subject || "Reminder")}</h4>
            ${row.body ? `<p>${escapeHtml(truncate(row.body, 160))}</p>` : ""}
            <div class="floating-notification-links">${notificationLinkSummaryHtml(row)}</div>
            <div class="floating-notification-actions">
                <button type="button" class="table-action" data-open-notification-related="${row.id}">Open</button>
                <button type="button" class="table-action" data-edit-notification="${row.id}">Reschedule</button>
                <button type="button" class="table-action danger" data-close-notification="${row.id}">Close</button>
            </div>
        </article>
    `).join("");
}

function buildEntitySection(entity) {
    if (entity.slug === "notifications") {
        return buildNotificationsSection();
    }
    if (entity.slug === "raw-metal-purchases") {
        const section = document.createElement("section");
        section.className = "page-section";
        section.dataset.sectionPanel = entity.slug;
        section.innerHTML = `
            <article class="panel-card">
                <div class="panel-heading table-heading">
                    <div>
                        <p class="panel-kicker">Raw Metal Stock</p>
                        <h3>Raw gold and silver purchases</h3>
                    </div>
                    <div class="hero-actions">
                        <button type="button" class="primary-action compact-action" data-open-form-drawer="raw-metal-purchases">Add Purchase</button>
                        <button type="button" class="secondary-action compact-action" data-export-entity="raw-metal-purchases">Export CSV</button>
                        <button type="button" class="secondary-action compact-action" data-refresh-entity="raw-metal-purchases">Refresh</button>
                    </div>
                </div>
                <div class="insight-grid raw-metal-stock-totals">
                    <div class="insight-tile"><span class="label">Gold in Stock</span><strong id="raw-gold-total">0.000 g</strong><small>Total recorded gold purchases</small></div>
                    <div class="insight-tile"><span class="label">Silver in Stock</span><strong id="raw-silver-total">0.000 g</strong><small>Total recorded silver purchases</small></div>
                </div>
                <div class="search-bar">
                    <input type="search" class="search-input" data-entity-search="raw-metal-purchases" placeholder="Search metal, source, or purchase date">
                </div>
                <div class="table-shell" id="raw-metal-purchases-table"></div>
            </article>`;
        return section;
    }
    const section = document.createElement("section");
    section.className = "page-section";
    section.dataset.sectionPanel = entity.slug;
    section.innerHTML = `
        <article class="panel-card">
            <div class="panel-heading table-heading">
                <div>
                    <p class="panel-kicker">${escapeHtml(entity.label)}</p>
                    <h3>Search and manage records</h3>
                </div>
                <div class="hero-actions">
                    <button type="button" class="primary-action compact-action" data-open-form-drawer="${entity.slug}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        New
                    </button>
                    <button type="button" class="secondary-action compact-action" data-export-entity="${entity.slug}">Export CSV</button>
                    <button type="button" class="secondary-action compact-action" data-refresh-entity="${entity.slug}">Refresh</button>
                </div>
            </div>
            <div class="search-bar">
                <input type="search" class="search-input" data-entity-search="${entity.slug}" placeholder="${escapeHtml(entity.searchPlaceholder)}">
            </div>
            <div class="table-shell" id="${entity.slug}-table"></div>
        </article>
    `;
    return section;
}

function openFormDrawer(slug, row = null) {
    const entity = getEntity(slug);
    if (!entity) return;
    state.formDrawer = { slug, mode: row ? "edit" : "create" };
    formDrawerKicker.textContent = entity.label;
    formDrawerTitle.textContent = row ? `Edit ${entity.label.toLowerCase()}` : `New ${entity.label.toLowerCase()}`;
    formDrawerBody.innerHTML = `
        <form class="editor-form entity-form" data-entity-form="${slug}" id="form-drawer-form">
            <input type="hidden" name="${escapeHtml(entity.primaryKey)}">
            <div class="field-grid two-col">
                ${entity.fields.map((field) => renderField(field, slug)).join("")}
            </div>
            <div class="form-actions" style="margin-top:16px">
                <button type="submit" class="primary-action">Save ${escapeHtml(entity.label)}</button>
                <button type="button" class="ghost-action" data-close-form-drawer>Cancel</button>
            </div>
        </form>
    `;
    rerenderLookupFields();
    initSearchableSelects(formDrawerBody);
    if (entity.fields.some(isCustomerLookup)) initCustomerSearch();
    if (slug === "order-items") initStockItemSearch();
    if (slug === "stock-items") initArtisanSearch();
    if (row) {
        setFormValues(slug, row);
        syncCustomerSearchFromValue(slug, row);
        syncStockItemSearchFromValue(slug, row);
        syncArtisanSearchFromValue(slug, row);
    }
    if (slug === "advance-receipts") {
        const form = document.getElementById("form-drawer-form");
        const transactionInput = form?.querySelector('[name="transaction_type"]');
        if (transactionInput && !row && !transactionInput.value) {
            transactionInput.value = "cash";
        }
        syncAdvanceReceiptDescriptionField(form, { clearWhenHidden: !row });
    }
    formDrawer.dataset.open = "true";
    formDrawer.setAttribute("aria-hidden", "false");
}

function closeFormDrawer() {
    state.formDrawer = { slug: null, mode: null };
    formDrawer.dataset.open = "false";
    formDrawer.setAttribute("aria-hidden", "true");
    formDrawerBody.innerHTML = "";
}

/* ===== APP MODAL SYSTEM ===== */
function openAppModal({ size, kicker, title, bodyHtml, footerHtml, tabs, activeTab, onOpen, onTabChange }) {
    appModal._lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.modal = { type: "app-modal", data: null, onTabChange: typeof onTabChange === "function" ? onTabChange : null };
    appModalContainer.className = "app-modal-container" + (size ? ` ${size}` : "");
    const closeIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    appModalHeader.innerHTML = `
        <div class="modal-title-group">
            <span class="modal-kicker">${escapeHtml(kicker || "")}</span>
            <h3 class="modal-title">${escapeHtml(title || "")}</h3>
        </div>
        <button type="button" class="modal-close-btn" data-close-modal>${closeIcon}</button>
    `;
    const startTab = activeTab || 0;
    if (tabs) {
        const tabBar = document.createElement("div");
        tabBar.className = "modal-tabs";
        const inner = tabs.map((t, i) => {
            const countHtml = t.count != null ? `<span class="tab-count">${t.count}</span>` : "";
            return `<button type="button" class="modal-tab-btn${i === startTab ? " active" : ""}" data-modal-tab="${i}">${escapeHtml(t.label)}${countHtml}</button>`;
        }).join("");
        tabBar.innerHTML = `<div class="modal-tabs-inner">${inner}</div>`;
        appModalHeader.after(tabBar);
        appModalBody.innerHTML = tabs.map((t, i) => `<div class="modal-tab-panel${i === startTab ? " active" : ""}" data-modal-tab-panel="${i}">${t.html}</div>`).join("");
    } else {
        const existingTabs = appModalContainer.querySelector(".modal-tabs");
        if (existingTabs) existingTabs.remove();
        appModalBody.innerHTML = bodyHtml || "";
    }
    appModalFooter.innerHTML = footerHtml || "";
    appModal.dataset.open = "true";
    appModal.setAttribute("aria-hidden", "false");
    appModal.inert = false;
    if (onOpen) onOpen();
    const closeButton = appModalHeader.querySelector(".modal-close-btn");
    closeButton?.focus();
}

function closeAppModal() {
    state.modal = { type: null, data: null, onTabChange: null };
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && appModal.contains(activeElement)) {
        activeElement.blur();
    }
    appModal.dataset.open = "false";
    appModal.inert = true;
    appModal.setAttribute("aria-hidden", "true");
    const existingTabs = appModalContainer.querySelector(".modal-tabs");
    if (existingTabs) existingTabs.remove();
    appModalBody.innerHTML = "";
    appModalFooter.innerHTML = "";
    const returnFocusTarget = appModal._lastFocusedElement;
    if (returnFocusTarget instanceof HTMLElement && document.contains(returnFocusTarget)) {
        window.setTimeout(() => returnFocusTarget.focus(), 0);
    }
    appModal._lastFocusedElement = null;
}

function switchModalTab(index) {
    appModalContainer.querySelectorAll(".modal-tab-btn").forEach((btn, i) => btn.classList.toggle("active", i === index));
    appModalContainer.querySelectorAll(".modal-tab-panel").forEach((panel, i) => panel.classList.toggle("active", i === index));
    if (typeof state.modal.onTabChange === "function") {
        state.modal.onTabChange(index);
    }
}

function getActiveModalTab() {
    const activeBtn = appModalContainer.querySelector(".modal-tab-btn.active");
    return activeBtn ? Number(activeBtn.dataset.modalTab) : 0;
}

/* Keyboard shortcut: Escape closes drawers/modals */
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        if (appModal.dataset.open === "true") { closeAppModal(); return; }
        if (formDrawer.dataset.open === "true") { closeFormDrawer(); return; }
        if (recordDrawer.dataset.open === "true") { closeDrawer(); return; }
    }
});

const NAV_ICONS = {
    customers: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    artisans: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 6a2 2 0 1 0-4 0v3H7a2 2 0 0 0-2 2v7h14v-7a2 2 0 0 0-2-2h-3z"/><path d="M10 12h4"/><path d="M12 9v6"/></svg>',
    'stock-items': '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
    'stock-movements': '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>',
    'payment-transactions': '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    'payment-transaction-tenders': '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    'document-files': '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
    notifications: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
};
const DEFAULT_NAV_ICON = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/></svg>';

function renderDynamicNavigation() {
    const groups = new Map((state.meta.groups || []).map((group) => [group.id, { ...group, entities: [] }]));
    getVisibleEntities().forEach((entity) => {
        if (groups.has(entity.group)) groups.get(entity.group).entities.push(entity);
    });
    dynamicNav.innerHTML = [...groups.values()].filter((group) => group.entities.length).map((group) => `
        <div class="nav-group">
            <p class="nav-group-title">${escapeHtml(group.label)}</p>
            <div class="nav-list">
                ${group.entities.map((entity) => `
                    <button class="nav-item" data-section="${entity.slug}">
                        ${NAV_ICONS[entity.slug] || DEFAULT_NAV_ICON}
                        <span class="nav-label">${escapeHtml(entity.navLabel)}</span>
                    </button>
                `).join("")}
            </div>
        </div>
    `).join("");
}

function renderEntitySections() {
    entitySections.innerHTML = "";
    getVisibleEntities().forEach((entity) => {
        entitySections.appendChild(buildEntitySection(entity));
    });
}

function renderQuickActions() {
    const quick = [
        { slug: "orderbook-hub", navLabel: "Orderbook" },
        { slug: "billing-hub", navLabel: "Billing Hub" },
        ...getVisibleEntities().slice(0, 4),
    ];
    quickActions.innerHTML = quick.map((entity) => `
        <button type="button" class="quick-link" data-open-section="${entity.slug}">
            Open ${escapeHtml(entity.navLabel)}
        </button>
    `).join("");
}

function navigateTo(sectionName) {
    state.activeSection = sectionName;
    sectionButtons().forEach((button) => {
        button.classList.toggle("active", button.dataset.section === sectionName);
    });
    sections().forEach((section) => {
        section.classList.toggle("active", section.dataset.sectionPanel === sectionName);
    });
    if (sectionName === "orderbook-hub") {
        loadOrderbookHub();
        return;
    }
    if (sectionName === "billing-hub") {
        loadBillingHub();
        return;
    }
    if (sectionName !== "dashboard") {
        loadEntityRows(sectionName);
    }
}

function renderMetrics(summary) {
    const cards = [
        ["Customers", summary.customerCount],
        ["Stock Items", summary.stockCount],
        ["Pending Orders", summary.pendingOrders],
        ["Today Sales", formatCurrency(summary.todaySales)],
        ["Receivables", formatCurrency(summary.receivables)],
        ["Open Notifications", summary.openNotifications || 0],
    ];
    metricGrid.innerHTML = cards.map(([label, value]) => `
        <article class="metric-card">
            <span class="label">${label}</span>
            <strong>${value}</strong>
        </article>
    `).join("");
    salesTotal.textContent = formatCurrency(summary.todaySales);
    receivablesTotal.textContent = formatCurrency(summary.receivables);
    notificationsTotal.textContent = String(summary.openNotifications || 0);
    supabaseStatus.textContent = summary.supabaseStatus || "unknown";
}

function renderDashboard() {
    const portal = state.portal || {};
    renderTable(dashboardCustomers, [
        { key: "full_name", label: "Name" },
        { key: "primary_contact", label: "Contact" },
        { key: "place_of_supply_name", label: "Supply State" },
        { key: "updated_at", label: "Updated", render: (value) => formatDate(value) },
    ], portal.dashboard?.customers || []);

    renderTable(dashboardStock, [
        { key: "stock_no", label: "Stock No" },
        { key: "description", label: "Description" },
        { key: "status", label: "Status", render: (value) => badge(value) },
        { key: "gross_weight_g", label: "Gross Wt", render: (value) => escapeHtml(value ?? "--") },
    ], portal.dashboard?.stock || []);

    renderTable(dashboardOrders, [
        { key: "order_number", label: "Order No" },
        { key: "order_type", label: "Type", render: (value) => badge(value) },
        { key: "status", label: "Status", render: (value) => badge(value) },
        { key: "promised_date", label: "Promised", render: (value) => formatDate(value) },
    ], portal.dashboard?.orders || []);

    renderTable(dashboardDocuments, [
        { key: "type", label: "Type", render: (value) => badge(value) },
        { key: "document_no", label: "No" },
        { key: "party", label: "Party" },
        { key: "document_date", label: "Date", render: (value) => formatDate(value) },
        { key: "amount", label: "Amount", render: (value) => formatCurrency(value) },
    ], portal.dashboard?.documents || []);

    renderTable(dashboardNotifications, [
        { key: "subject", label: "Subject" },
        { key: "effective_at", label: "When", render: (value) => formatDateTime(value) },
        {
            key: "linked",
            label: "Linked",
            render: (_value, row) => escapeHtml(describeNotificationLinks(row).join(" · ") || "Standalone reminder"),
        },
        { key: "status", label: "Status", render: (_value, row) => notificationStatusBadge(row) },
    ], portal.dashboard?.notifications || []);
}

function buildColumnDefinitions(entity) {
    const fieldMap = Object.fromEntries(entity.fields.map((field) => [field.name, field]));
    return entity.columns.map((name) => {
        const field = fieldMap[name];
        const label = field?.label || name.replaceAll("_", " ");
        if (entity.slug === "raw-metal-purchases" && name === "purchase_date") {
            return { key: name, label: "Date", render: (value) => formatDate(value) };
        }
        if (entity.slug === "raw-metal-purchases" && name === "metal") {
            return { key: name, label: "Metal", render: (value) => badge(formatOptionLabel(value)) };
        }
        if (entity.slug === "raw-metal-purchases" && name === "weight_g") {
            return { key: name, label: "Weight", render: (value) => `${escapeHtml(Number(value || 0).toFixed(3))} g` };
        }
        if (entity.slug === "raw-metal-purchases" && name === "rate_per_gram") {
            return { key: name, label: "Rate / Gram", render: (value) => `Rs. ${escapeHtml(Number(value || 0).toFixed(2))}` };
        }
        if (entity.slug === "stock-items" && name === "stock_no") {
            return { key: name, label, render: (value) => copyableValue(value, "stock number") };
        }
        if (entity.slug === "stock-items" && name === "huid") {
            return { key: name, label: "HUID", render: (value) => copyableHuidValues(value) };
        }
        if (entity.slug === "stock-items" && name === "net_weight_g") {
            return { key: name, label: "Net Wt", render: (value) => value == null || value === "" ? "--" : `${escapeHtml(value)} g` };
        }
        if (entity.slug === "stock-items" && name === "updated_at") {
            return { key: name, label: "Updated", render: (value) => formatStockTimestamp(value) };
        }
        /* Stock-items: ornament_type column derives its color from the row's HSN code */
        if (entity.slug === "stock-items" && name === "ornament_type") {
            return {
                key: name,
                label: "Type",
                render: (value, row) => ornamentTypeBadge(value, row?.hsn_code),
            };
        }
        /* Stock-items: purity column uses specialized purity badge */
        if (entity.slug === "stock-items" && name === "purity") {
            return {
                key: name,
                label,
                render: (value) => purityBadge(value),
            };
        }
        return {
            key: name,
            label,
            render: (value) => renderValue(field, value),
        };
    });
}

function buildPaymentTransactionColumnDefinitions() {
    return [
        { key: "document_number", label: "Reference No", render: (value) => escapeHtml(value || "--") },
        { key: "document_type", label: "Document Type", render: (value) => badge(value || "--") },
        { key: "direction", label: "Payment Direction", render: (value) => badge(formatOptionLabel(value) || "--") },
        { key: "total_amount", label: "Total Amount", render: (value) => formatCurrency(value) },
        { key: "transaction_datetime", label: "Transaction Datetime", render: (value) => formatDateTime(value) },
    ];
}

function renderValue(field, value) {
    if (value == null || value === "") return "--";
    if (!field) return escapeHtml(value);
    if (field.type === "checkbox") return badge(value ? "yes" : "no");
    if (field.type === "date") return formatDate(value);
    if (field.type === "datetime") return formatDateTime(value);
    if (field.type === "number" || field.type === "integer") return escapeHtml(value);
    if (field.type === "lookup") return escapeHtml(formatLookupValue(field.lookup, value));
    if (field.type === "select" && field.name === "ornament_type") return ornamentTypeBadge(value);
    if (field.type === "select" && field.name === "purity") return purityBadge(value);
    if (field.type === "select") return badge(formatOptionLabel(value));
    if (field.type === "json") return `<code>${escapeHtml(truncate(formatJson(value), 80))}</code>`;
    if (field.type === "array") return escapeHtml(Array.isArray(value) ? value.join(", ") : String(value));
    return escapeHtml(truncate(value, 100));
}

function renderDetailValue(field, value) {
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return "<span class=\"empty-state\">--</span>";
    if (field?.type === "lookup") return escapeHtml(formatLookupValue(field.lookup, value));
    if (field?.type === "checkbox") return badge(value ? "yes" : "no");
    if (field?.type === "date") return escapeHtml(formatDate(value));
    if (field?.type === "datetime") return escapeHtml(formatDateTime(value));
    if (field?.type === "select" && field?.name === "ornament_type") return ornamentTypeBadge(value);
    if (field?.type === "select" && field?.name === "purity") return purityBadge(value);
    if (field?.type === "select") return badge(formatOptionLabel(value));
    if (field?.type === "json") return `<pre class="drawer-code">${escapeHtml(formatJson(value))}</pre>`;
    if (field?.type === "array") return `<pre class="drawer-code">${escapeHtml(Array.isArray(value) ? value.join(", ") : String(value))}</pre>`;
    return `<span>${escapeHtml(String(value))}</span>`;
}

function renderFieldSubset(entitySlug, fieldNames) {
    const entity = getEntity(entitySlug);
    if (!entity) return "";
    const wanted = new Set(fieldNames);
    return entity.fields.filter((field) => wanted.has(field.name)).map((field) => renderField(field, entitySlug)).join("");
}

function buildOrderbookHub() {
    orderbookHub.innerHTML = `
        <article class="panel-card">
            <div class="hub-top-bar">
                <div class="hub-title-group">
                    <span class="hub-kicker">Orderbook Hub</span>
                    <h3>Orders, items, and advance receipts</h3>
                </div>
                <div class="hub-actions">
                    <button type="button" class="primary-action compact-action" data-create-order>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        New Order
                    </button>
                </div>
            </div>
            <div class="filter-bar">
                <input type="search" class="search-input" data-hub-search="orderbook" placeholder="Search orders, customer names, or status…">
                <button type="button" class="filter-toggle-btn" data-filter-toggle="orderbook">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                    Filters
                </button>
            </div>
            <div class="filter-panel" id="orderbook-filter-panel">
                <div class="filter-grid">
                    <div class="filter-group">
                        <span class="filter-label">Type</span>
                        <select data-filter="orderbook" data-filter-key="order_type">
                            <option value="">All Types</option>
                            <option value="custom_order">Custom Order</option>
                            <option value="stock_reservation">Stock Reservation</option>
                            <option value="repair">Repair</option>
                            <option value="alteration">Alteration</option>
                            <option value="special_request">Special Request</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <span class="filter-label">Status</span>
                        <select data-filter="orderbook" data-filter-key="status">
                            <option value="">All Statuses</option>
                            <option value="created">Created</option>
                            <option value="in_progress">In Progress</option>
                            <option value="finished">Finished</option>
                            <option value="pending_delivery">Pending Delivery</option>
                            <option value="delivered">Delivered</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <span class="filter-label">Date From</span>
                        <input type="date" data-filter="orderbook" data-filter-key="date_from">
                    </div>
                    <div class="filter-group">
                        <span class="filter-label">Date To</span>
                        <input type="date" data-filter="orderbook" data-filter-key="date_to">
                    </div>
                </div>
                <div class="filter-actions">
                    <button type="button" class="ghost-action compact-action" data-clear-filters="orderbook">Clear Filters</button>
                </div>
            </div>
            <div class="table-shell" id="orderbook-orders-table"></div>
        </article>
    `;
}

function buildBillingHub() {
    billingHub.innerHTML = `
        <article class="panel-card">
            <div class="hub-top-bar">
                <div class="hub-title-group">
                    <span class="hub-kicker">Billing Hub</span>
                    <h3>Invoices and receipts</h3>
                </div>
                <div class="hub-actions">
                    <button type="button" class="primary-action compact-action" data-create-document="invoice">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        New Invoice
                    </button>
                    <button type="button" class="secondary-action compact-action" data-create-document="receipt">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        New Receipt
                    </button>
                </div>
            </div>
            <div class="filter-bar">
                <input type="search" class="search-input" data-hub-search="billing" placeholder="Search invoice no, receipt no, customer, or status…">
                <button type="button" class="filter-toggle-btn" data-filter-toggle="billing">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                    Filters
                </button>
            </div>
            <div class="filter-panel" id="billing-filter-panel">
                <div class="filter-grid">
                    <div class="filter-group">
                        <span class="filter-label">Type</span>
                        <select data-filter="billing" data-filter-key="document_type">
                            <option value="">All Types</option>
                            <option value="invoice">Invoice</option>
                            <option value="receipt">Receipt</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <span class="filter-label">Status</span>
                        <select data-filter="billing" data-filter-key="status">
                            <option value="">All Statuses</option>
                            <option value="draft">Draft</option>
                            <option value="issued">Issued</option>
                            <option value="partially_paid">Partially Paid</option>
                            <option value="paid">Paid</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <span class="filter-label">Date From</span>
                        <input type="date" data-filter="billing" data-filter-key="date_from">
                    </div>
                    <div class="filter-group">
                        <span class="filter-label">Date To</span>
                        <input type="date" data-filter="billing" data-filter-key="date_to">
                    </div>
                    <div class="filter-group">
                        <span class="filter-label">Min Amount</span>
                        <input type="number" step="0.01" data-filter="billing" data-filter-key="amount_min" placeholder="0">
                    </div>
                    <div class="filter-group">
                        <span class="filter-label">Max Amount</span>
                        <input type="number" step="0.01" data-filter="billing" data-filter-key="amount_max" placeholder="∞">
                    </div>
                </div>
                <div class="filter-actions">
                    <button type="button" class="ghost-action compact-action" data-clear-filters="billing">Clear Filters</button>
                </div>
            </div>
            <div class="table-shell" id="billing-documents-table"></div>
        </article>
    `;
}

function renderEntityTable(slug) {
    const entity = getEntity(slug);
    if (!entity) return;
    if (slug === "notifications") {
        renderNotificationsSection();
        return;
    }
    const target = document.getElementById(`${slug}-table`);
    if (!target) return;
    if (slug === "raw-metal-purchases") {
        const purchases = state.rows[slug] || [];
        const totals = state.rawMetalTotals || purchases.reduce((sum, row) => {
            const metal = String(row.metal || "").toLowerCase();
            if (metal === "gold" || metal === "silver") sum[metal] += Number(row.weight_g || 0);
            return sum;
        }, { gold: 0, silver: 0 });
        const goldTotal = document.getElementById("raw-gold-total");
        const silverTotal = document.getElementById("raw-silver-total");
        if (goldTotal) goldTotal.textContent = `${totals.gold.toFixed(3)} g`;
        if (silverTotal) silverTotal.textContent = `${totals.silver.toFixed(3)} g`;
    }
    target.dataset.rowEntity = slug;
    target.dataset.rowPrimaryKey = entity.primaryKey;
    if (slug === "payment-transactions") {
        target.dataset.rowEntity = "payment-transactions";
        renderTable(target, buildPaymentTransactionColumnDefinitions(), state.rows[slug] || []);
        return;
    }
    const pencilIcon = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
    const trashIcon = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>`;
    const compactStockActions = slug === "stock-items";
    const actions = [
        { entity: slug, action: "edit", label: "Edit", primaryKey: entity.primaryKey, iconOnly: compactStockActions, icon: compactStockActions ? pencilIcon : "", title: compactStockActions ? "Edit stock item" : "Edit" },
        { entity: slug, action: "delete", label: "Delete", kind: "danger", primaryKey: entity.primaryKey, iconOnly: compactStockActions, icon: compactStockActions ? trashIcon : "", title: compactStockActions ? "Delete stock item" : "Delete" },
    ];
    renderTable(target, buildColumnDefinitions(entity), state.rows[slug] || [], actions);
}

/* ===== FILTERING ===== */
function applyHubFilters(hub, rows) {
    const f = state.filters[hub] || {};
    return rows.filter(r => {
        if (hub === "billing") {
            if (f.document_type && r.document_type !== f.document_type) return false;
            if (f.status && r.status !== f.status) return false;
            const dt = r.document_datetime || "";
            if (f.date_from && dt < f.date_from) return false;
            if (f.date_to && dt < f.date_to + "T99") { /* ok */ } else if (f.date_to && dt > f.date_to + "T99") return false;
            const amt = Number(r.document_amount || 0);
            if (f.amount_min && amt < Number(f.amount_min)) return false;
            if (f.amount_max && amt > Number(f.amount_max)) return false;
        }
        if (hub === "orderbook") {
            if (f.order_type && r.order_type !== f.order_type) return false;
            if (f.status && r.status !== f.status) return false;
            const dt = r.order_date || "";
            if (f.date_from && dt < f.date_from) return false;
            if (f.date_to && dt > f.date_to) return false;
        }
        return true;
    });
}

function syncOrderbookForms() {
    const selectedOrder = getOrderbookSelection();
    const orderTitle = document.getElementById("orderbook-selection-title");
    const orderSummary = document.getElementById("orderbook-selection-summary");
    if (!selectedOrder) {
        if (orderTitle) orderTitle.textContent = "Choose an order";
        if (orderSummary) orderSummary.textContent = "Select an order to work with its items and advance receipts.";
        renderTable(document.getElementById("orderbook-items-table"), [], []);
        renderTable(document.getElementById("orderbook-receipts-table"), [], []);
        return;
    }

    if (orderTitle) orderTitle.textContent = `${selectedOrder.order_number || "Order"} · ${selectedOrder.customer_name || "Walk-in customer"}`;
    if (orderSummary) {
        orderSummary.innerHTML = `
            <strong>${escapeHtml(formatOptionLabel(selectedOrder.status || "open"))}</strong> ·
            ${escapeHtml(selectedOrder.order_type || "--")} ·
            ${escapeHtml(formatDate(selectedOrder.order_date))} ·
            ${escapeHtml(selectedOrder.item_count || 0)} items ·
            ${escapeHtml(formatCurrency(selectedOrder.advance_total || 0))}
        `;
    }

    setFormValues("orders", selectedOrder);
    resetForm("order-items", false);
    const orderItemForm = document.querySelector('[data-entity-form="order-items"]');
    if (orderItemForm) {
        orderItemForm.querySelector('[name="order_id"]').value = selectedOrder.id || "";
    }

    const advanceForm = document.querySelector("[data-advance-receipt-form]");
    if (advanceForm) {
        setFormFieldValue(advanceForm, "order_id", selectedOrder.id || "");
        setFormFieldValue(advanceForm, "customer_id", selectedOrder.customer_id || "");
        setFormFieldValue(advanceForm, "customer_name", selectedOrder.customer_name || "");
        setFormFieldValue(advanceForm, "customer_contact_primary", selectedOrder.customer_contact || "");
        setFormFieldValue(advanceForm, "customer_email", selectedOrder.customer_email || "");
        setFormFieldValue(advanceForm, "order_number_display", selectedOrder.order_number || "");
        setFormFieldValue(advanceForm, "order_date_display", formatDate(selectedOrder.order_date));
        setFormFieldValue(advanceForm, "customer_name_display", selectedOrder.customer_name || "");
        const formIdInput = advanceForm.querySelector('[name="id"]');
        const receiptNoInput = advanceForm.querySelector('[name="receipt_no"]');
        if (formIdInput && receiptNoInput && !formIdInput.value && !receiptNoInput.value) {
            receiptNoInput.value = nextAdvanceReceiptNumber();
        }
        syncAdvanceReceiptDescriptionField(advanceForm);
    }

    renderTable(
        document.getElementById("orderbook-items-table"),
        [
            { key: "line_no", label: "Line" },
            { key: "description", label: "Description" },
            { key: "quantity", label: "Qty" },
            { key: "purity", label: "Purity" },
            { key: "status", label: "Status", render: (value) => badge(value) },
        ],
        selectedOrder.order_items || [],
        [
            { entity: "order-items", action: "edit", label: "Edit" },
            { entity: "order-items", action: "delete", label: "Delete", kind: "danger" },
        ],
    );

    renderTable(
        document.getElementById("orderbook-receipts-table"),
        [
            { key: "receipt_no", label: "Receipt No" },
            { key: "receipt_datetime", label: "Date", render: (value) => formatDateTime(value) },
            { key: "transaction_type", label: "Transaction Type", render: (value) => badge(formatOptionLabel(value) || "--") },
            { key: "amount", label: "Amount", render: (value) => formatCurrency(value) },
            { key: "valuation_description", label: "Description", render: (value) => escapeHtml(value || "--") },
            {
                key: "linked_receipt_no",
                label: "Receipt",
                render: (value, row) => row.receipt_id && isOldOrnamentAdvanceType(row.transaction_type)
                    ? `<button type="button" class="table-action" data-open-linked-receipt="${row.receipt_id}">${escapeHtml(value || "View Receipt")}</button>`
                    : "--",
            },
        ],
        selectedOrder.advance_receipts || [],
        [
            { entity: "advance-receipts", action: "hub-view-advance", label: "View" },
            { entity: "advance-receipts", action: "hub-edit-advance", label: "Edit" },
            { entity: "advance-receipts", action: "hub-delete-advance", label: "Delete", kind: "danger" },
        ],
    );
}

function syncBillingForms() {
    const selectedDocument = getBillingSelection();
    const selectedType = selectedDocument?.document_type || state.hubs.billing.selectedDocumentType || "invoice";
    state.hubs.billing.selectedDocumentType = selectedType;
    if (selectedDocument?.id) state.hubs.billing.selectedDocumentId = selectedDocument.id;

    document.querySelectorAll("[data-billing-type]").forEach((card) => {
        card.hidden = card.dataset.billingType !== selectedType;
    });
    document.querySelectorAll("[data-billing-item-type]").forEach((card) => {
        card.hidden = card.dataset.billingItemType !== selectedType;
    });

    const title = document.getElementById("billing-selection-title");
    const summary = document.getElementById("billing-selection-summary");
    const itemsTable = document.getElementById("billing-items-table");
    if (!selectedDocument) {
        if (title) title.textContent = "Choose a document";
        if (summary) summary.textContent = "The selected invoice or receipt will appear here together with its line items.";
        renderTable(itemsTable, [], []);
        return;
    }

    if (title) title.textContent = `${selectedDocument.document_no || "Document"} · ${selectedDocument.customer_name || "Walk-in customer"}`;
    if (summary) {
        summary.innerHTML = `
            <strong>${escapeHtml(selectedDocument.document_type)}</strong> ·
            ${escapeHtml(formatOptionLabel(selectedDocument.status || "--"))} ·
            ${escapeHtml(formatDateTime(selectedDocument.document_datetime))} ·
            ${escapeHtml(formatCurrency(selectedDocument.document_amount || 0))}
        `;
    }

    const parentSlug = selectedType === "invoice" ? "invoices" : "receipts";
    const childSlug = selectedType === "invoice" ? "invoice-items" : "receipt-items";
    setFormValues(parentSlug, selectedDocument);
    resetForm(childSlug, false);
    const childForm = document.querySelector(`[data-entity-form="${childSlug}"]`);
    const parentField = childSlug === "invoice-items" ? "invoice_id" : "receipt_id";
    if (childForm) {
        childForm.querySelector(`[name="${parentField}"]`).value = selectedDocument.id || "";
    }

    renderTable(
        itemsTable,
        [
            { key: "line_no", label: "Line" },
            { key: "description", label: "Description" },
            { key: "quantity", label: "Qty" },
            { key: "purity", label: "Purity" },
            { key: "line_total_amount", label: "Line Total", render: (value) => formatCurrency(value) },
        ],
        selectedDocument.line_items || [],
        [
            { entity: childSlug, action: "edit", label: "Edit" },
            { entity: childSlug, action: "delete", label: "Delete", kind: "danger" },
        ],
    );
}

function renderOrderbookHub() {
    const filtered = applyHubFilters("orderbook", state.hubs.orderbook.orders || []);
    renderTable(document.getElementById("orderbook-orders-table"),
        [
            { key: "order_number", label: "Order No" },
            { key: "customer_name", label: "Customer" },
            { key: "order_type", label: "Type", render: v => badge(v) },
            { key: "status", label: "Status", render: v => badge(v) },
            { key: "order_date", label: "Order Date", render: v => formatDate(v) },
            { key: "item_count", label: "Items" },
            { key: "advance_total", label: "Advance", render: v => formatCurrency(v) },
        ], filtered,
        [
            { entity: "orders", action: "hub-view-order", label: "View" },
            { entity: "orders", action: "hub-open-order", label: "Edit" },
            { entity: "orders", action: "hub-delete-order", label: "Delete", kind: "danger" },
        ],
    );
}

function renderBillingHub() {
    const filtered = applyHubFilters("billing", state.hubs.billing.documents || []);
    renderTable(document.getElementById("billing-documents-table"),
        [
            { key: "document_type", label: "Type", render: v => badge(v) },
            { key: "document_no", label: "No" },
            { key: "customer_name", label: "Customer" },
            { key: "status", label: "Status", render: v => badge(v) },
            { key: "document_datetime", label: "Date", render: v => formatDateTime(v) },
            { key: "document_amount", label: "Amount", render: v => formatCurrency(v) },
        ], filtered,
        [
            { entity: "billing", action: "hub-view-document", label: "View" },
            { entity: "billing", action: "hub-open-document", label: "Edit" },
            { entity: "billing", action: "hub-delete-document", label: "Delete", kind: "danger" },
        ],
    );
}

async function loadOrderbookHub(force = false) {
    if (!force && state.loaded["orderbook-hub"]) {
        renderOrderbookHub();
        return;
    }
    try {
        const query = state.searches["orderbook-hub"]?.trim();
        const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
        const payload = await requestJson(`/api/orderbook${suffix}`);
        state.hubs.orderbook.orders = payload.orders || [];
        if (!state.hubs.orderbook.orders.some((row) => String(row.id) === String(state.hubs.orderbook.selectedOrderId))) {
            state.hubs.orderbook.selectedOrderId = state.hubs.orderbook.orders[0]?.id || "";
        }
        state.loaded["orderbook-hub"] = true;
        renderOrderbookHub();
    } catch (error) {
        console.error(error);
        showToast(error.message, true);
    }
}

async function loadBillingHub(force = false) {
    if (!force && state.loaded["billing-hub"]) {
        renderBillingHub();
        return;
    }
    try {
        const query = state.searches["billing-hub"]?.trim();
        const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
        const payload = await requestJson(`/api/billing${suffix}`);
        state.hubs.billing.documents = payload.documents || [];
        if (!state.hubs.billing.documents.some((row) => (
            String(row.id) === String(state.hubs.billing.selectedDocumentId)
            && row.document_type === state.hubs.billing.selectedDocumentType
        ))) {
            state.hubs.billing.selectedDocumentId = state.hubs.billing.documents[0]?.id || "";
            state.hubs.billing.selectedDocumentType = state.hubs.billing.documents[0]?.document_type || "invoice";
        }
        state.loaded["billing-hub"] = true;
        renderBillingHub();
    } catch (error) {
        console.error(error);
        showToast(error.message, true);
    }
}

function resetAdvanceReceiptForm(editing = false) {
    const form = document.querySelector("[data-advance-receipt-form]");
    if (!form) return;
    form.reset();
    const selectedOrder = getOrderbookSelection();
    setFormFieldValue(form, "id", "");
    if (selectedOrder) {
        setFormFieldValue(form, "order_id", selectedOrder.id || "");
        setFormFieldValue(form, "customer_id", selectedOrder.customer_id || "");
        setFormFieldValue(form, "customer_name", selectedOrder.customer_name || "");
        setFormFieldValue(form, "customer_contact_primary", selectedOrder.customer_contact || "");
        setFormFieldValue(form, "customer_email", selectedOrder.customer_email || "");
        setFormFieldValue(form, "order_number_display", selectedOrder.order_number || "");
        setFormFieldValue(form, "order_date_display", formatDate(selectedOrder.order_date));
        setFormFieldValue(form, "customer_name_display", selectedOrder.customer_name || "");
    }
    if (!editing) {
        setFormFieldValue(form, "receipt_no", nextAdvanceReceiptNumber());
    }
    const transactionInput = form.querySelector('[name="transaction_type"]');
    if (transactionInput && !editing && !transactionInput.value) {
        transactionInput.value = "cash";
    }
    syncAdvanceReceiptDescriptionField(form);
    const title = document.getElementById("advance-receipts-form-title");
    if (title) title.textContent = `${editing ? "Edit" : "Create"} advance receipt`;
}

function fillAdvanceReceiptForm(row) {
    resetAdvanceReceiptForm(true);
    const form = document.querySelector("[data-advance-receipt-form]");
    if (!form) return;
    setFormFieldValue(form, "id", row.id || "");
    setFormFieldValue(form, "receipt_no", row.receipt_no || "");
    setFormFieldValue(form, "receipt_datetime", formatDateTimeLocal(row.receipt_datetime));
    setFormFieldValue(form, "amount", row.amount ?? row.amount_received ?? row.net_amount ?? row.gross_amount ?? "");
    setFormFieldValue(form, "customer_name", row.customer_name || "");
    setFormFieldValue(form, "customer_contact_primary", row.customer_contact_primary || "");
    setFormFieldValue(form, "customer_email", row.customer_email || "");
    const transactionInput = form.querySelector('[name="transaction_type"]');
    if (transactionInput) transactionInput.value = row.transaction_type || "cash";
    const descriptionInput = form.querySelector('[name="valuation_description"]');
    if (descriptionInput) descriptionInput.value = row.valuation_description || "";
    syncAdvanceReceiptDescriptionField(form, { clearWhenHidden: false });
}

function buildBillGenReceiptUrl(order, advanceReceipt) {
    const params = new URLSearchParams();
    params.set("source", "master_portal");
    params.set("mode", "receipt");
    params.set("return_to_portal", "1");
    params.set("advance_receipt_id", advanceReceipt.id || "");
    params.set("return_order_id", order.id || "");
    params.set("return_tab", "2");
    params.set("order_no", order.order_number || "");
    params.set("order_date", order.order_date || "");
    params.set("customer_id", order.customer_id || "");
    params.set("customer_name", order.customer_name || "");
    params.set("customer_contact", order.customer_contact || "");
    params.set("customer_contact2", order.customer_contact_secondary || "");
    params.set("customer_email", order.customer_email || "");
    params.set("customer_address", order.customer_address || "");
    params.set("customer_state_name", order.customer_state_name || "");
    params.set("customer_state_gst_code", order.customer_state_gst_code || "");
    params.set("place_of_supply_name", order.place_of_supply_name || "");
    params.set("place_of_supply_gst_code", order.place_of_supply_gst_code || "");
    params.set("customer_pincode", order.customer_pincode || "");
    params.set("customer_pan_aadhaar", order.customer_pan_aadhaar_no || "");
    params.set("advance_receipt_no", advanceReceipt.receipt_no || "");
    params.set("advance_amount", advanceReceipt.amount || "");
    params.set("advance_description", advanceReceipt.valuation_description || "");
    return `${billGenAppUrl}/?${params.toString()}#receipt`;
}

async function submitAdvanceReceiptForm() {
    const form = document.querySelector("[data-advance-receipt-form]");
    if (!form) return;
    const payload = Object.fromEntries(new FormData(form).entries());

    /* Modal context: order_id is already in a hidden field */
    const isModalContext = !!form.closest(".app-modal-container, .inline-item-form");
    const modalOrderId = payload.order_id;

    if (!isModalContext) {
        const selectedOrder = getOrderbookSelection();
        if (!selectedOrder) {
            showToast("Select an order before creating an advance receipt.", true);
            return;
        }
        payload.order_id = selectedOrder.id || "";
        payload.customer_id = selectedOrder.customer_id || "";
        payload.customer_name = selectedOrder.customer_name || "";
        payload.customer_contact_primary = selectedOrder.customer_contact || "";
        payload.customer_email = selectedOrder.customer_email || "";
    }

    try {
        const response = await requestJson("/api/admin/advance-receipts", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        const savedRow = response.row || {};
        const selectedOrder = getOrderbookSelection();
        const shouldOpenReceipt = isOldOrnamentAdvanceType(payload.transaction_type) && !savedRow.receipt_id;
        if (shouldOpenReceipt && selectedOrder) {
            window.location.href = buildBillGenReceiptUrl(selectedOrder, {
                ...payload,
                ...savedRow,
                amount: savedRow.amount || payload.amount,
            });
            return;
        }
        if (modalOrderId) {
            await refreshOrderbookOrder(modalOrderId, { reopenModalTab: isModalContext ? 2 : null });
        } else {
            await loadOrderbookHub(true);
            resetAdvanceReceiptForm(false);
        }
        showToast("Advance receipt saved");
    } catch (error) {
        console.error(error);
        showToast(error.message, true);
    }
}

function openDrawer(slug, recordId) {
    const entity = getEntity(slug);
    const row = findRow(slug, recordId);
    if (!entity || !row) return;
    state.drawer = { slug, recordId };
    drawerKicker.textContent = entity.label;
    drawerTitle.textContent = `${entity.label.slice(0, -1) || entity.label} details`;
    const fieldMap = Object.fromEntries(entity.fields.map((field) => [field.name, field]));
    const keys = [entity.primaryKey, ...entity.fields.map((field) => field.name).filter((name) => name !== entity.primaryKey)];
    drawerBody.innerHTML = keys.map((key) => {
        const field = fieldMap[key] || { label: key.replaceAll("_", " ") };
        return `
            <div class="drawer-row">
                <span class="drawer-label">${escapeHtml(field.label)}</span>
                <div class="drawer-value">${renderDetailValue(field, row[key])}</div>
            </div>
        `;
    }).join("");
    recordDrawer.dataset.open = "true";
    recordDrawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
    state.drawer = { slug: null, recordId: null };
    recordDrawer.dataset.open = "false";
    recordDrawer.setAttribute("aria-hidden", "true");
}

function resetForm(slug, editing = false, form = null) {
    const entity = getEntity(slug);
    form = findEntityForm(slug, form);
    if (!entity || !form) return;
    form.reset();
    const pkField = form.querySelector(`[name="${entity.primaryKey}"]`);
    if (pkField) pkField.value = "";
    entity.fields.forEach((field) => {
        if (field.type === "json") {
            const input = form.querySelector(`[name="${field.name}"]`);
            if (input) input.value = "";
        }
    });
    const title = document.getElementById(`${slug}-form-title`);
    if (title) title.textContent = `${editing ? "Edit" : "Create"} ${entity.label.toLowerCase()}`;
}

function setFormValues(slug, row, form = null) {
    const entity = getEntity(slug);
    form = findEntityForm(slug, form);
    if (!entity || !form) return;
    resetForm(slug, true, form);
    const pkField = form.querySelector(`[name="${entity.primaryKey}"]`);
    if (pkField) pkField.value = row[entity.primaryKey] ?? "";
    entity.fields.forEach((field) => {
        if (field.readOnly) return;
        const input = form.querySelector(`[name="${field.name}"]`);
        if (!input) return;
        const value = row[field.name];
        if (field.type === "checkbox") {
            input.checked = Boolean(value);
        } else if (field.type === "datetime") {
            input.value = formatDateTimeLocal(value);
        } else if (field.type === "json") {
            input.value = formatJson(value);
        } else if (field.type === "array") {
            input.value = Array.isArray(value) ? value.join(", ") : value ?? "";
        } else {
            input.value = value ?? "";
        }
    });
    if (slug === "advance-receipts") {
        syncAdvanceReceiptDescriptionField(form, { clearWhenHidden: false });
    }
    const title = document.getElementById(`${slug}-form-title`);
    if (title) title.textContent = `Edit ${entity.label.toLowerCase()}`;
}

function serializeForm(slug, form = null) {
    const entity = getEntity(slug);
    form = findEntityForm(slug, form);
    const payload = {};
    if (!entity || !form) return payload;
    const formData = new FormData(form);
    for (const [key, value] of formData.entries()) {
        payload[key] = value;
    }
    entity.fields.forEach((field) => {
        if (field.type === "checkbox") {
            payload[field.name] = Boolean(form.querySelector(`[name="${field.name}"]`)?.checked);
        } else if (field.type === "datetime") {
            payload[field.name] = localDateTimeInputToIso(payload[field.name]);
        }
    });
    return payload;
}

async function loadEntityRows(slug, force = false) {
    if (!force && state.loaded[slug]) {
        renderEntityTable(slug);
        return;
    }
    const query = state.searches[slug]?.trim();
    const search = query ? `?q=${encodeURIComponent(query)}` : "";
    try {
        const payload = await requestJson(`/api/admin/${slug}${search}`);
        state.rows[slug] = payload.rows || [];
        if (slug === "raw-metal-purchases") state.rawMetalTotals = payload.stockTotals || null;
        state.loaded[slug] = true;
        renderEntityTable(slug);
    } catch (error) {
        console.error(error);
        showToast(error.message, true);
    }
}

async function submitEntity(slug) {
    /* Detect modal inline form context */
    const form = findEntityForm(slug);
    const isModalInline = form && !!form.closest(".app-modal-container");
    const currentTab = isModalInline ? getActiveModalTab() : 0;
    let parentId = null;
    if (isModalInline) {
        const parentInput = form.querySelector('[name="order_id"], [name="invoice_id"], [name="receipt_id"], [name="payment_transaction_id"]');
        if (parentInput) parentId = parentInput.value;
    }
    try {
        await requestJson(`/api/admin/${slug}`, {
            method: "POST",
            body: JSON.stringify(serializeForm(slug, form)),
        });
        resetForm(slug, false);
        const visibleEntity = getVisibleEntities().some((entity) => entity.slug === slug);
        if (isModalInline && parentId && ["order-items", "advance-receipts"].includes(slug)) {
            await refreshOrderbookOrder(parentId, { reopenModalTab: currentTab });
        } else if (isModalInline && parentId && ["invoice-items", "receipt-items"].includes(slug)) {
            await refreshBillingDocument(parentId, { reopenModalTab: currentTab });
        } else if (isModalInline && parentId && ["payment-transaction-tenders"].includes(slug)) {
            await refreshPaymentTransaction(parentId, { reopenModalTab: currentTab });
        } else {
            const refreshTasks = [loadPortal()];
            if (visibleEntity) refreshTasks.push(loadEntityRows(slug, true));
            if (["orders", "order-items", "advance-receipts"].includes(slug)) refreshTasks.push(loadOrderbookHub(true));
            if (["invoices", "invoice-items", "receipts", "receipt-items"].includes(slug)) refreshTasks.push(loadBillingHub(true));
            if (slug === "customers" || slug === "artisans" || slug === "stock-items" || slug === "orders" || slug === "advance-receipts" || slug === "invoices" || slug === "receipts" || slug === "payment-transactions") {
                refreshTasks.push(loadLookups());
            }
            await Promise.all(refreshTasks);
            if (slug === "customers" || slug === "artisans" || slug === "stock-items" || slug === "orders" || slug === "advance-receipts" || slug === "invoices" || slug === "receipts" || slug === "payment-transactions") {
                rerenderLookupFields();
                renderAllVisibleTables();
            }
        }
        showToast(`${getEntity(slug).label} saved`);
        /* Re-open the parent modal on the same tab if inline modal context */
        if (isModalInline && parentId) {
            return;
        } else {
            closeFormDrawer();
        }
    } catch (error) {
        console.error(error);
        showToast(error.message, true);
    }
}

async function deleteEntity(slug, recordId, options = {}) {
    const { parentId = null, reopenModalTab = null, openView = false, confirmName = null, deleteLinked = false, linkedRecords = [] } = options;
    try {
        const params = new URLSearchParams({ id: recordId });
        if (confirmName !== null) params.set("confirm_name", confirmName);
        if (deleteLinked) params.set("delete_linked", "true");
        linkedRecords.forEach(record => params.append("linked_record", record));
        await requestJson(`/api/admin/${slug}?${params.toString()}`, { method: "DELETE" });
        if (parentId && ["order-items", "advance-receipts"].includes(slug)) {
            const refreshTasks = [refreshOrderbookOrder(parentId, { reopenModalTab })];
            if (slug === "advance-receipts") refreshTasks.push(loadBillingHub(true));
            if (slug === "advance-receipts") refreshTasks.push(loadEntityRows("payment-transactions", true));
            await Promise.all(refreshTasks);
        } else if (parentId && ["invoice-items", "receipt-items"].includes(slug)) {
            await refreshBillingDocument(parentId, { reopenModalTab, openView });
        } else if (parentId && ["payment-transaction-tenders"].includes(slug)) {
            await refreshPaymentTransaction(parentId, { reopenModalTab });
        } else {
            const refreshTasks = [loadPortal()];
            if (getVisibleEntities().some((entity) => entity.slug === slug)) refreshTasks.push(loadEntityRows(slug, true));
            if (["orders", "order-items", "advance-receipts", "receipts"].includes(slug)) refreshTasks.push(loadOrderbookHub(true));
            if (["invoices", "invoice-items", "receipts", "receipt-items", "advance-receipts"].includes(slug)) refreshTasks.push(loadBillingHub(true));
            if (["advance-receipts", "receipts"].includes(slug)) refreshTasks.push(loadEntityRows("payment-transactions", true));
            if (slug === "customers" || slug === "artisans" || slug === "stock-items" || slug === "orders" || slug === "advance-receipts" || slug === "invoices" || slug === "receipts" || slug === "payment-transactions") {
                refreshTasks.push(loadLookups());
            }
            await Promise.all(refreshTasks);
        }
        if (state.drawer.slug === slug && state.drawer.recordId === recordId) {
            closeDrawer();
        }
        if (slug === "customers" || slug === "artisans" || slug === "stock-items" || slug === "orders" || slug === "advance-receipts" || slug === "invoices" || slug === "receipts" || slug === "payment-transactions") {
            rerenderLookupFields();
            renderAllVisibleTables();
        }
        showToast("Record deleted");
    } catch (error) {
        console.error(error);
        const message = error.message.includes("violates foreign key constraint")
            ? "Delete blocked because this record is still linked elsewhere. Remove or relink the dependent records first."
            : error.message;
        showToast(message, true);
    }
}

function findRow(slug, recordId) {
    const entity = getEntity(slug);
    if (!entity) return null;
    return (state.rows[slug] || []).find((row) => String(row[entity.primaryKey]) === String(recordId));
}

function exportEntity(slug) {
    const query = state.searches[slug]?.trim();
    const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
    window.open(`/api/admin/${slug}/export.csv${suffix}`, "_blank", "noopener");
}

function rerenderLookupFields() {
    document.querySelectorAll("[data-entity-form]").forEach((form) => {
        const slug = form.dataset.entityForm;
        const entity = getEntity(slug);
        if (!entity) return;
        entity.fields.filter((field) => field.type === "lookup").forEach((field) => {
            /* Skip customer_id — rendered as smart search input, not a select */
            if (isCustomerLookup(field)) return;
            const input = form.querySelector(`[name="${field.name}"]`);
            if (!input || input.tagName !== "SELECT") return;
            const currentValue = input.value;
            input.innerHTML = valueOptionsHtml(getLookupOptions(field), currentValue);
            /* Also rebuild styled select options if present */
            const styledWrap = input.closest(".styled-select-wrap");
            if (styledWrap) {
                const optionsContainer = styledWrap.querySelector(".styled-select-options");
                if (optionsContainer) {
                    const opts = getLookupOptions(field);
                    optionsContainer.innerHTML = `<div class="styled-select-option disabled" data-value="">Select</div>` +
                        opts.map(o => `<div class="styled-select-option${String(currentValue) === String(o.value) ? " selected" : ""}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`).join("");
                }
                syncStyledSelectDisplays(styledWrap);
            }
        });
    });
}

function renderAllVisibleTables() {
    Object.keys(state.rows).forEach((slug) => renderEntityTable(slug));
}

async function loadPortal() {
    const portal = await requestJson("/api/portal");
    state.portal = portal;
    renderMetrics(state.portal.summary || {});
    renderDashboard();
}

async function loadLookups() {
    state.lookups = await requestJson("/api/lookups");
}

async function handlePortalLaunchState() {
    if (![...launchParams.keys()].length) return;
    const targetSection = launchParams.get("section") || "";
    const orderId = launchParams.get("order_id") || "";
    const receiptId = launchParams.get("receipt_id") || "";
    const advanceReceiptId = launchParams.get("advance_receipt_id") || "";
    const openOrderModal = launchParams.get("open_order_modal") === "1";
    const openReceiptModal = launchParams.get("open_receipt_modal") === "1";
    const activeTab = Number(launchParams.get("tab") || "0");
    const toastMessage = launchParams.get("toast") || "";

    if (targetSection === "orderbook-hub" && orderId) {
        navigateTo("orderbook-hub");
        await refreshOrderbookOrder(orderId);
        if (advanceReceiptId) {
            openAdvanceReceiptViewModal(advanceReceiptId, { orderIdHint: orderId });
        } else if (openOrderModal) {
            openOrderDetailModal(orderId, Number.isFinite(activeTab) ? activeTab : 0);
        }
    } else if (targetSection === "billing-hub" && receiptId) {
        navigateTo("billing-hub");
        await refreshBillingDocument(receiptId);
        if (openReceiptModal) {
            openBillingDocumentViewModal(receiptId, Number.isFinite(activeTab) ? activeTab : 0);
        }
    }

    if (toastMessage) {
        showToast(toastMessage);
    }
    window.history.replaceState({}, document.title, masterPortalAppUrl);
}

async function bootstrap() {
    refreshAllButton.disabled = true;
    refreshAllButton.textContent = "Loading...";
    try {
        const [meta, portal, lookups] = await Promise.all([
            requestJson("/api/admin/meta"),
            requestJson("/api/portal"),
            requestJson("/api/lookups"),
        ]);
        state.meta = meta;
        state.portal = portal;
        state.lookups = lookups;
        renderDynamicNavigation();
        renderEntitySections();
        buildOrderbookHub();
        buildBillingHub();
        renderQuickActions();
        renderMetrics(state.portal.summary || {});
        renderDashboard();
        rerenderLookupFields();
        await Promise.all([loadOrderbookHub(true), loadBillingHub(true), refreshNotificationsState(true)]);
        navigateTo(state.activeSection);
        await handlePortalLaunchState();
        window.setInterval(() => {
            renderDueNotificationToasts();
        }, 30000);
    } catch (error) {
        console.error(error);
        showToast(error.message, true);
        supabaseStatus.textContent = "load failed";
    } finally {
        refreshAllButton.disabled = false;
        refreshAllButton.textContent = "Refresh Dashboard";
    }
}

dynamicNav.addEventListener("click", (event) => {
    const button = event.target.closest(".nav-item");
    if (!button) return;
    navigateTo(button.dataset.section);
});

document.getElementById("main-nav").addEventListener("click", (event) => {
    const button = event.target.closest(".nav-item");
    if (!button) return;
    navigateTo(button.dataset.section);
});

document.body.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-copy-value]");
    if (copyButton) {
        event.preventDefault();
        event.stopPropagation();
        await copyTextToClipboard(copyButton.dataset.copyValue || "");
        return;
    }
    const selectNotificationDateBtn = event.target.closest("[data-select-notification-date]");
    if (selectNotificationDateBtn) {
        state.notifications.selectedDate = selectNotificationDateBtn.dataset.selectNotificationDate;
        renderNotificationsSection();
        return;
    }
    const monthShiftBtn = event.target.closest("[data-notification-month-shift]");
    if (monthShiftBtn) {
        state.notifications.calendarMonth = shiftMonth(state.notifications.calendarMonth, Number(monthShiftBtn.dataset.notificationMonthShift || "0"));
        renderNotificationsSection();
        return;
    }
    const jumpTodayBtn = event.target.closest("[data-jump-notifications-today]");
    if (jumpTodayBtn) {
        const today = localIsoDate(new Date());
        state.notifications.selectedDate = today;
        state.notifications.calendarMonth = today.slice(0, 7);
        renderNotificationsSection();
        return;
    }
    const filterPillBtn = event.target.closest("[data-notification-filter]");
    if (filterPillBtn) {
        state.notifications.filter = filterPillBtn.dataset.notificationFilter;
        renderNotificationsSection();
        return;
    }
    const createNotificationBtn = event.target.closest("[data-create-notification], [data-create-notification-for-selected]");
    if (createNotificationBtn) {
        setNotificationReturnContext(null);
        openNotificationFormModal({
            defaults: {
                reminder_at: startOfDayIso(state.notifications.selectedDate),
            },
        });
        return;
    }
    const orderAddNotificationBtn = event.target.closest("[data-order-add-notification]");
    if (orderAddNotificationBtn) {
        openNotificationFromOrder(orderAddNotificationBtn.dataset.orderAddNotification);
        return;
    }
    const editNotificationBtn = event.target.closest("[data-edit-notification]");
    if (editNotificationBtn) {
        const row = findRow("notifications", editNotificationBtn.dataset.editNotification);
        if (row) openNotificationFormModal({ row });
        return;
    }
    const openNotificationRelatedBtn = event.target.closest("[data-open-notification-related]");
    if (openNotificationRelatedBtn) {
        openNotificationRelatedRecord(openNotificationRelatedBtn.dataset.openNotificationRelated);
        return;
    }
    const closeNotificationBtn = event.target.closest("[data-close-notification]");
    if (closeNotificationBtn) {
        closeNotification(closeNotificationBtn.dataset.closeNotification).catch((error) => {
            console.error(error);
            showToast(error.message, true);
        });
        return;
    }
    const openNotificationTargetBtn = event.target.closest("[data-open-notification-target]");
    if (openNotificationTargetBtn) {
        openNotificationTarget(
            openNotificationTargetBtn.dataset.openNotificationTarget,
            openNotificationTargetBtn.dataset.openNotificationTargetId,
        );
        return;
    }
    const openLinkedReceiptBtn = event.target.closest("[data-open-linked-receipt]");
    if (openLinkedReceiptBtn) {
        openLinkedReceiptFromAdvance(openLinkedReceiptBtn.dataset.openLinkedReceipt);
        return;
    }
    /* Customer smart search: accept suggestion */
    const acceptBtn = event.target.closest("[data-accept-suggestion]");
    if (acceptBtn) {
        const panel = document.getElementById("customer-suggestion-panel");
        const idx = parseInt(acceptBtn.dataset.acceptSuggestion, 10);
        const suggestions = panel?._suggestions || [];
        if (suggestions[idx]) acceptCustomerSuggestion(suggestions[idx]);
        return;
    }
    /* Customer smart search: dismiss suggestion */
    const dismissBtn = event.target.closest("[data-dismiss-suggestion]");
    if (dismissBtn) {
        const card = dismissBtn.closest(".cust-smart-card");
        if (card) card.remove();
        return;
    }
    /* Customer smart search: clear accepted */
    const clearBtn = event.target.closest("[data-clear-customer]");
    if (clearBtn) { clearAcceptedCustomer(); return; }
    const acceptStockBtn = event.target.closest("[data-accept-stock-suggestion]");
    if (acceptStockBtn) {
        const panel = document.getElementById("stock-item-suggestion-panel");
        const idx = parseInt(acceptStockBtn.dataset.acceptStockSuggestion, 10);
        const suggestions = panel?._suggestions || [];
        if (suggestions[idx]) acceptStockItemSuggestion(suggestions[idx]);
        return;
    }
    const dismissStockBtn = event.target.closest("[data-dismiss-stock-suggestion]");
    if (dismissStockBtn) {
        dismissStockBtn.closest(".cust-smart-card")?.remove();
        return;
    }
    const clearStockBtn = event.target.closest("[data-clear-stock-item]");
    if (clearStockBtn) { clearAcceptedStockItem(); return; }
    const acceptArtisanBtn = event.target.closest("[data-accept-artisan-suggestion]");
    if (acceptArtisanBtn) {
        const panel = document.getElementById("artisan-suggestion-panel");
        const idx = parseInt(acceptArtisanBtn.dataset.acceptArtisanSuggestion, 10);
        const suggestions = panel?._suggestions || [];
        if (suggestions[idx]) acceptArtisanSuggestion(suggestions[idx]);
        return;
    }
    const dismissArtisanBtn = event.target.closest("[data-dismiss-artisan-suggestion]");
    if (dismissArtisanBtn) {
        dismissArtisanBtn.closest(".cust-smart-card")?.remove();
        return;
    }
    const clearArtisanBtn = event.target.closest("[data-clear-artisan]");
    if (clearArtisanBtn) { clearAcceptedArtisan(); return; }
    /* Per-item artisan smart search (order item assignments) */
    const acceptItemArtisanBtn = event.target.closest("[data-accept-item-artisan]");
    if (acceptItemArtisanBtn) {
        const [itemId, indexText] = String(acceptItemArtisanBtn.dataset.acceptItemArtisan || "").split(":");
        const panel = document.getElementById(`artisan-suggestion-panel-${itemId}`);
        const suggestions = panel?._suggestions || [];
        const suggestion = suggestions[Number(indexText || "-1")];
        if (suggestion) acceptItemArtisanSuggestion(itemId, suggestion);
        return;
    }
    const dismissItemArtisanBtn = event.target.closest("[data-dismiss-item-artisan]");
    if (dismissItemArtisanBtn) {
        dismissItemArtisanBtn.closest(".cust-smart-card")?.remove();
        return;
    }
    const clearItemArtisanBtn = event.target.closest("[data-clear-item-artisan]");
    if (clearItemArtisanBtn) {
        clearAcceptedItemArtisan(clearItemArtisanBtn.dataset.clearItemArtisan);
        return;
    }
    const acceptNotificationBtn = event.target.closest("[data-accept-notification-suggestion]");
    if (acceptNotificationBtn) {
        const [fieldName, indexText] = String(acceptNotificationBtn.dataset.acceptNotificationSuggestion || "").split(":");
        const panel = document.getElementById(`notification-${fieldName}-suggestion-panel`);
        const suggestions = panel?._suggestions || [];
        const suggestion = suggestions[Number(indexText || "-1")];
        if (suggestion) acceptNotificationSmartSuggestion(fieldName, suggestion);
        return;
    }
    const dismissNotificationBtn = event.target.closest("[data-dismiss-notification-suggestion]");
    if (dismissNotificationBtn) {
        dismissNotificationBtn.closest(".cust-smart-card")?.remove();
        return;
    }
    const clearNotificationFieldBtn = event.target.closest("[data-clear-notification-field]");
    if (clearNotificationFieldBtn) {
        clearAcceptedNotificationField(clearNotificationFieldBtn.dataset.clearNotificationField);
        return;
    }
    /* Close modal */
    const closeModalBtn = event.target.closest("[data-close-modal]");
    if (closeModalBtn) { closeAppModal(); return; }
    /* Modal tabs */
    const tabBtn = event.target.closest("[data-modal-tab]");
    if (tabBtn) { switchModalTab(Number(tabBtn.dataset.modalTab)); return; }
    /* Filter toggle */
    const filterToggle = event.target.closest("[data-filter-toggle]");
    if (filterToggle) {
        const hub = filterToggle.dataset.filterToggle;
        const panel = document.getElementById(`${hub}-filter-panel`);
        if (panel) { panel.classList.toggle("open"); filterToggle.classList.toggle("active"); }
        return;
    }
    /* Clear filters */
    const clearFilters = event.target.closest("[data-clear-filters]");
    if (clearFilters) {
        const hub = clearFilters.dataset.clearFilters;
        state.filters[hub] = {};
        document.querySelectorAll(`[data-filter="${hub}"]`).forEach(el => el.value = "");
        if (hub === "billing") renderBillingHub();
        if (hub === "orderbook") renderOrderbookHub();
        return;
    }
    /* Create document */
    const createDocumentButton = event.target.closest("[data-create-document]");
    if (createDocumentButton) {
        openCreateDocumentModal(createDocumentButton.dataset.createDocument);
        return;
    }
    /* Create order */
    const createOrderButton = event.target.closest("[data-create-order]");
    if (createOrderButton) { openCreateOrderModal(); return; }
    const lifecycleButton = event.target.closest("[data-order-transition]");
    if (lifecycleButton) {
        const orderId = lifecycleButton.dataset.orderId;
        const status = lifecycleButton.dataset.orderTransition;
        lifecycleButton.disabled = true;
        requestJson(`/api/orders/${encodeURIComponent(orderId)}/transition`, {
            method: "POST", body: JSON.stringify({ status }),
        }).then(async () => {
            await refreshOrderbookOrder(orderId, { reopenModalTab: 0 });
            showToast(`Order marked ${formatOptionLabel(status)}`);
        }).catch(error => showToast(error.message, true)).finally(() => { lifecycleButton.disabled = false; });
        return;
    }
    const itemArtisanButton = event.target.closest("[data-order-item-artisan-add]");
    if (itemArtisanButton) {
        const { orderId, itemId } = itemArtisanButton.dataset;
        const artisanId = document.getElementById(`artisan-hidden-${CSS.escape(itemId)}`)?.value || "";
        if (!artisanId) { showToast("Search and accept an artisan first", true); return; }
        itemArtisanButton.disabled = true;
        requestJson(`/api/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/artisans`, {
            method: "POST", body: JSON.stringify({ artisan_id: artisanId }),
        }).then(async () => {
            await refreshOrderbookOrder(orderId, { reopenModalTab: 1 });
            showToast("Artisan assigned to item");
        }).catch(error => showToast(error.message, true)).finally(() => { itemArtisanButton.disabled = false; });
        return;
    }
    /* Modal edit header */
    const editHeaderBtn = event.target.closest("[data-modal-edit-header]");
    if (editHeaderBtn) {
        openEditHeaderModal(editHeaderBtn.dataset.modalEditHeader, editHeaderBtn.dataset.docId);
        return;
    }
    /* Modal add item */
    const addItemBtn = event.target.closest("[data-modal-add-item]");
    if (addItemBtn) {
        showModalItemForm(addItemBtn.dataset.modalAddItem, addItemBtn.dataset.parentId, addItemBtn.dataset.parentField);
        return;
    }
    /* Modal edit item */
    const editItemBtn = event.target.closest("[data-modal-edit-item]");
    if (editItemBtn) {
        const childSlug = editItemBtn.dataset.modalEditItem;
        const itemId = editItemBtn.dataset.itemId;
        const parentId = editItemBtn.dataset.parentId;
        /* Find the row from billing or orderbook data */
        let editRow = null;
        for (const doc of (state.hubs.billing.documents || [])) {
            editRow = (doc.line_items || []).find(r => String(r.id) === String(itemId));
            if (editRow) break;
        }
        if (!editRow) {
            for (const ord of (state.hubs.orderbook.orders || [])) {
                editRow = (ord.order_items || []).find(r => String(r.id) === String(itemId))
                    || (ord.advance_receipts || []).find(r => String(r.id) === String(itemId));
                if (editRow) break;
            }
        }
        const parentField = childSlug === "invoice-items" ? "invoice_id" : childSlug === "receipt-items" ? "receipt_id" : "order_id";
        showModalItemForm(childSlug, parentId, parentField, editRow);
        return;
    }
    const openAdvanceReceiptBtn = event.target.closest("[data-open-advance-receipt]");
    if (openAdvanceReceiptBtn) {
        openAdvanceReceiptViewModal(openAdvanceReceiptBtn.dataset.openAdvanceReceipt, { orderIdHint: openAdvanceReceiptBtn.dataset.parentId || "" });
        return;
    }
    /* Modal delete item */
    const deleteItemBtn = event.target.closest("[data-modal-delete-item]");
    if (deleteItemBtn) {
        const childSlug = deleteItemBtn.dataset.modalDeleteItem;
        const itemId = deleteItemBtn.dataset.itemId;
        const parentId = deleteItemBtn.dataset.parentId;
        const currentTab = getActiveModalTab();
        if (childSlug === "advance-receipts") {
            /* Find advance receipt details for confirmation message */
            let receiptLabel = itemId;
            let hasLinkedReceipt = false;
            for (const ord of (state.hubs.orderbook.orders || [])) {
                const ar = (ord.advance_receipts || []).find(r => String(r.id) === String(itemId));
                if (ar) {
                    receiptLabel = ar.receipt_no || itemId;
                    hasLinkedReceipt = !!(ar.receipt_id && isOldOrnamentAdvanceType(ar.transaction_type));
                    break;
                }
            }
            const linkedWarning = hasLinkedReceipt
                ? `<div class="delete-confirm-dependents"><p class="delete-confirm-dep-title">⚠ This advance receipt has a linked receipt document that will also be affected.</p></div>`
                : "";
            openAppModal({
                size: "modal-xs",
                kicker: "Confirm Deletion",
                title: "Delete Advance Receipt",
                bodyHtml: `
                    <div class="delete-confirm-icon"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>
                    <p class="delete-confirm-msg">Are you sure you want to delete advance receipt <strong>${escapeHtml(receiptLabel)}</strong>? This action cannot be undone.</p>
                    ${linkedWarning}
                `,
                footerHtml: `
                    <button type="button" class="ghost-action" data-close-modal>Cancel</button>
                    <button type="button" class="delete-confirm-btn enabled" id="delete-confirm-btn">Delete</button>
                `,
                onOpen: () => {
                    document.getElementById("delete-confirm-btn").addEventListener("click", async () => {
                        const btn = document.getElementById("delete-confirm-btn");
                        btn.textContent = "Deleting...";
                        btn.disabled = true;
                        closeAppModal();
                        try {
                            await deleteEntity(childSlug, itemId, { parentId, reopenModalTab: currentTab });
                        } catch (e) { /* deleteEntity already shows toast */ }
                    });
                }
            });
            return;
        }
        try {
            await deleteEntity(childSlug, itemId, { parentId, reopenModalTab: currentTab });
        } catch (e) { /* deleteEntity already shows toast */ }
        return;
    }
    /* Modal add advance receipt */
    const addAdvanceBtn = event.target.closest("[data-modal-add-advance]");
    if (addAdvanceBtn) { showModalAdvanceForm(addAdvanceBtn.dataset.orderId); return; }
    /* Cancel inline form */
    const cancelInline = event.target.closest("[data-cancel-inline-form]");
    if (cancelInline) {
        const area = cancelInline.closest(".inline-item-form");
        if (area) area.remove();
        return;
    }
    /* Existing handlers */
    const openButton = event.target.closest("[data-open-section]");
    if (openButton) { navigateTo(openButton.dataset.openSection); return; }
    const resetButton = event.target.closest("[data-reset-form]");
    if (resetButton) { resetForm(resetButton.dataset.resetForm, false); return; }
    const resetAdvanceReceiptButton = event.target.closest("[data-reset-advance-receipt]");
    if (resetAdvanceReceiptButton) { resetAdvanceReceiptForm(false); return; }
    const refreshButton = event.target.closest("[data-refresh-entity]");
    if (refreshButton) { loadEntityRows(refreshButton.dataset.refreshEntity, true); return; }
    const exportButton = event.target.closest("[data-export-entity]");
    if (exportButton) { exportEntity(exportButton.dataset.exportEntity); return; }
    const closeDrawerButton = event.target.closest("[data-close-drawer]");
    if (closeDrawerButton) { closeDrawer(); return; }
    const closeFormDrawerButton = event.target.closest("[data-close-form-drawer]");
    if (closeFormDrawerButton) { closeFormDrawer(); return; }
    const openFormDrawerButton = event.target.closest("[data-open-form-drawer]");
    if (openFormDrawerButton) { openEntityFormModal(openFormDrawerButton.dataset.openFormDrawer); return; }
    const dataRow = event.target.closest(".data-row");
    if (dataRow && !event.target.closest("[data-action]")) {
        if (dataRow.dataset.rowEntity && dataRow.dataset.rowId) {
            if (dataRow.dataset.rowEntity === "customers") {
                openCustomerDetailModal(dataRow.dataset.rowId);
            } else if (dataRow.dataset.rowEntity === "artisans") {
                openArtisanDetailModal(dataRow.dataset.rowId);
            } else if (dataRow.dataset.rowEntity === "stock-items") {
                openStockItemDetailModal(dataRow.dataset.rowId);
            } else if (dataRow.dataset.rowEntity === "orders") {
                openOrderViewModal(dataRow.dataset.rowId);
            } else if (dataRow.dataset.rowEntity === "advance-receipts") {
                const context = findAdvanceReceiptContext(dataRow.dataset.rowId);
                if (context.advanceReceipt?.receipt_id && isOldOrnamentAdvanceType(context.advanceReceipt.transaction_type)) {
                    openLinkedReceiptFromAdvance(context.advanceReceipt.receipt_id);
                } else {
                    openAdvanceReceiptViewModal(dataRow.dataset.rowId);
                }
            } else if (dataRow.dataset.rowEntity === "billing") {
                openBillingDocumentViewModal(dataRow.dataset.rowId);
            } else if (dataRow.dataset.rowEntity === "payment-transactions") {
                openPaymentTransactionModal(dataRow.dataset.rowId);
            } else {
                openEntityDetailModal(dataRow.dataset.rowEntity, dataRow.dataset.rowId);
            }
            return;
        }
    }
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const { entity, action, id } = target.dataset;
    if (action === "notification-edit") {
        const row = findRow("notifications", id);
        if (row) openNotificationFormModal({ row });
        return;
    }
    if (action === "notification-open") {
        openNotificationRelatedRecord(id);
        return;
    }
    if (action === "notification-close") {
        closeNotification(id).catch((error) => {
            console.error(error);
            showToast(error.message, true);
        });
        return;
    }
    if (action === "hub-view-order") { openOrderViewModal(id); return; }
    if (action === "hub-open-order") { openOrderDetailModal(id); return; }
    if (action === "hub-delete-order") {
        const order = (state.hubs.orderbook.orders || []).find(r => String(r.id) === String(id));
        if (order) openDeleteConfirmModal("order", order.order_number || id, id, "orders");
        return;
    }
    if (action === "hub-view-advance") {
        openAdvanceReceiptViewModal(id);
        return;
    }
    if (action === "hub-edit-advance") {
        const currentOrder = (state.hubs.orderbook.orders || []).find((order) => (order.advance_receipts || []).some((row) => String(row.id) === String(id)));
        if (!currentOrder) return;
        const row = (currentOrder.advance_receipts || []).find((receipt) => String(receipt.id) === String(id));
        if (!row) return;
        showModalAdvanceForm(currentOrder.id, row);
        return;
    }
    if (action === "hub-delete-advance") {
        const currentOrder = (state.hubs.orderbook.orders || []).find((order) => (order.advance_receipts || []).some((row) => String(row.id) === String(id)));
        const row = (currentOrder?.advance_receipts || []).find((receipt) => String(receipt.id) === String(id));
        if (row) openDeleteConfirmModal("advance receipt", row.receipt_no || id, id, "advance-receipts");
        return;
    }
    if (action === "hub-view-document") { openBillingDocumentViewModal(id); return; }
    if (action === "hub-open-document") { openBillingDocumentModal(id); return; }
    if (action === "hub-delete-document") {
        const doc = (state.hubs.billing.documents || []).find(r => String(r.id) === String(id));
        if (!doc) return;
        const slug = doc.document_type === "invoice" ? "invoices" : "receipts";
        openDeleteConfirmModal(doc.document_type, doc.document_no || id, id, slug);
        return;
    }
    if (action === "edit") {
        const row = findRow(entity, id);
        if (!row) return;
        openEntityFormModal(entity, row);
        return;
    }
    if (action === "delete") {
        openEntityDeleteConfirmModal(entity, id);
    }
});

document.body.addEventListener("submit", (event) => {
    const advanceReceiptForm = event.target.closest("[data-advance-receipt-form]");
    if (advanceReceiptForm) {
        event.preventDefault();
        submitAdvanceReceiptForm();
        return;
    }
    const form = event.target.closest("[data-entity-form]");
    if (!form) return;
    event.preventDefault();
    submitEntity(form.dataset.entityForm);
});

document.body.addEventListener("input", (event) => {
    const advanceTransactionInput = event.target.closest('[data-advance-receipt-form] [name="transaction_type"], [data-entity-form="advance-receipts"] [name="transaction_type"]');
    if (advanceTransactionInput) {
        syncAdvanceReceiptDescriptionField(advanceTransactionInput.form);
        return;
    }
    const hubSearch = event.target.closest("[data-hub-search]");
    if (hubSearch) {
        const hub = hubSearch.dataset.hubSearch;
        const key = hub === "orderbook" ? "orderbook-hub" : "billing-hub";
        state.searches[key] = hubSearch.value;
        window.clearTimeout(hubSearch._searchTimer);
        hubSearch._searchTimer = window.setTimeout(() => {
            state.loaded[key] = false;
            if (key === "orderbook-hub") loadOrderbookHub(true);
            if (key === "billing-hub") loadBillingHub(true);
        }, 220);
        return;
    }
    /* Filter changes (client-side) */
    const filterEl = event.target.closest("[data-filter]");
    if (filterEl && filterEl.dataset.filterKey) {
        const hub = filterEl.dataset.filter;
        state.filters[hub] = state.filters[hub] || {};
        state.filters[hub][filterEl.dataset.filterKey] = filterEl.value;
        if (hub === "billing") renderBillingHub();
        if (hub === "orderbook") renderOrderbookHub();
        return;
    }
    const input = event.target.closest("[data-entity-search]");
    if (!input) return;
    const slug = input.dataset.entitySearch;
    state.searches[slug] = input.value;
    window.clearTimeout(input._searchTimer);
    input._searchTimer = window.setTimeout(() => {
        state.loaded[slug] = false;
        loadEntityRows(slug, true);
    }, 220);
});

document.body.addEventListener("change", (event) => {
    const monthInput = event.target.closest("#notifications-month-input");
    if (monthInput) {
        state.notifications.calendarMonth = monthInput.value || state.notifications.calendarMonth;
        renderNotificationsSection();
        return;
    }
    const filterEl = event.target.closest("[data-filter]");
    if (filterEl && filterEl.dataset.filterKey) {
        const hub = filterEl.dataset.filter;
        state.filters[hub] = state.filters[hub] || {};
        state.filters[hub][filterEl.dataset.filterKey] = filterEl.value;
        if (hub === "billing") renderBillingHub();
        if (hub === "orderbook") renderOrderbookHub();
    }
});

document.body.addEventListener("change", (event) => {
    const stockNumberDependency = event.target.closest('[data-entity-form="stock-items"] [name="hsn_code"], [data-entity-form="stock-items"] [name="purity"]');
    if (stockNumberDependency) {
        prefillNumberRecommendation(stockNumberDependency.form, "stock");
    }
    const hsnInput = event.target.closest('[data-entity-form="order-items"] [name="hsn_code"]');
    if (hsnInput) {
        syncOrderItemPurity(hsnInput.form);
        return;
    }
    const advanceTransactionInput = event.target.closest('[data-advance-receipt-form] [name="transaction_type"], [data-entity-form="advance-receipts"] [name="transaction_type"]');
    if (advanceTransactionInput) {
        syncAdvanceReceiptDescriptionField(advanceTransactionInput.form);
    }
});

refreshAllButton.addEventListener("click", async () => {
    refreshAllButton.disabled = true;
    refreshAllButton.textContent = "Refreshing...";
    try {
        await Promise.all([loadPortal(), loadLookups(), refreshNotificationsState(true)]);
        rerenderLookupFields();
        const active = state.activeSection;
        Object.keys(state.loaded).forEach((slug) => {
            state.loaded[slug] = false;
        });
        if (active === "orderbook-hub") {
            await loadOrderbookHub(true);
        } else if (active === "billing-hub") {
            await loadBillingHub(true);
        } else if (active !== "dashboard") {
            await loadEntityRows(active, true);
        }
        renderAllVisibleTables();
        renderDueNotificationToasts();
        showToast("Dashboard refreshed");
    } catch (error) {
        console.error(error);
        showToast(error.message, true);
    } finally {
        refreshAllButton.disabled = false;
        refreshAllButton.textContent = "Refresh Dashboard";
    }
});

drawerEditButton.addEventListener("click", () => {
    const { slug, recordId } = state.drawer;
    if (!slug || !recordId) return;
    const row = findRow(slug, recordId);
    if (!row) return;
    openFormDrawer(slug, row);
    closeDrawer();
});

drawerDeleteButton.addEventListener("click", () => {
    const { slug, recordId } = state.drawer;
    if (!slug || !recordId) return;
    deleteEntity(slug, recordId);
});

/* ===== ENTITY DETAIL MODAL ===== */
function openEntityDetailModal(slug, recordId) {
    const entity = getEntity(slug);
    const row = findRow(slug, recordId);
    if (!entity || !row) return;

    const fieldMap = Object.fromEntries(entity.fields.map(f => [f.name, f]));
    const keys = [entity.primaryKey, ...entity.fields.map(f => f.name).filter(n => n !== entity.primaryKey)];

    /* Group fields into sections for a structured display */
    const sectionIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/></svg>`;
    const detailRows = keys.map(key => {
        const field = fieldMap[key] || { label: key.replaceAll("_", " ") };
        return `<div class="modal-detail-item"><span class="modal-detail-label">${escapeHtml(field.label)}</span><div class="modal-detail-value">${renderDetailValue(field, row[key])}</div></div>`;
    }).join("");

    const detailHtml = `<div class="entity-modal-section">
        <div class="entity-modal-section-header">
            <span class="entity-modal-section-icon">${sectionIcon}</span>
            <span class="entity-modal-section-title">${escapeHtml(entity.label)} Details</span>
        </div>
        <div class="modal-detail-grid">${detailRows}</div>
    </div>`;

    const editIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
    const deleteIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

    openAppModal({
        kicker: entity.label,
        title: `${summarizeEntityRow(entity, row)}`,
        bodyHtml: detailHtml,
        footerHtml: `
            <button type="button" class="secondary-action compact-action" id="entity-modal-edit">${editIcon} Edit</button>
            <button type="button" class="ghost-action compact-action entity-modal-delete-btn" id="entity-modal-delete">${deleteIcon} Delete</button>
        `,
        onOpen: () => {
            document.getElementById("entity-modal-edit").addEventListener("click", () => {
                closeAppModal();
                openEntityFormModal(slug, row, () => openEntityDetailModal(slug, recordId));
            });
            document.getElementById("entity-modal-delete").addEventListener("click", () => {
                closeAppModal();
                openEntityDeleteConfirmModal(slug, recordId);
            });
        }
    });
}

function summarizeEntityRow(entity, row) {
    for (const candidate of ["full_name", "name", "subject", "template_name", "stock_no", "order_number", "receipt_no", "invoice_no", "transaction_number", "file_name", "recipient_name", "description"]) {
        const value = String(row[candidate] || "").trim();
        if (value) return value;
    }
    return String(row[entity.primaryKey] || "Record");
}

/* ===== CUSTOMER DETAIL MODAL (with linked records) ===== */
async function openCustomerDetailModal(recordId) {
    const entity = getEntity("customers");
    const row = findRow("customers", recordId);
    if (!entity || !row) return;

    const fieldMap = Object.fromEntries(entity.fields.map(f => [f.name, f]));
    const keys = [entity.primaryKey, ...entity.fields.map(f => f.name).filter(n => n !== entity.primaryKey)];

    /* --- Details tab --- */
    const sectionIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
    const detailRows = keys.map(key => {
        const field = fieldMap[key] || { label: key.replaceAll("_", " ") };
        return `<div class="modal-detail-item"><span class="modal-detail-label">${escapeHtml(field.label)}</span><div class="modal-detail-value">${renderDetailValue(field, row[key])}</div></div>`;
    }).join("");
    const editIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
    const deleteIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    const arrowIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;

    const detailHtml = `<div class="entity-modal-section">
        <div class="entity-modal-section-header">
            <span class="entity-modal-section-icon">${sectionIcon}</span>
            <span class="entity-modal-section-title">Customer Details</span>
        </div>
        <div class="modal-detail-grid">${detailRows}</div>
    </div>
    <div style="display:flex;gap:10px;margin-top:16px">
        <button type="button" class="secondary-action compact-action" id="cust-modal-edit">${editIcon} Edit Customer</button>
        <button type="button" class="ghost-action compact-action entity-modal-delete-btn" id="cust-modal-delete">${deleteIcon} Delete</button>
    </div>`;

    /* --- Loading placeholder for async tabs --- */
    const loadingHtml = `<div class="customer-loading"><div class="spinner"></div>Loading linked records…</div>`;

    /* --- SVG icons for card types --- */
    const orderIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>`;
    const invoiceIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    const receiptIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2z"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>`;
    const emptyIcon = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`;

    function buildLinkedCards(items, type) {
        if (!items || !items.length) {
            return `<div class="customer-linked-empty">${emptyIcon}<p>No ${type} found for this customer.</p></div>`;
        }
        const cards = items.map(item => {
            let title = "", metaParts = [], targetHub = "", openFn = "";
            if (type === "orders") {
                title = item.order_number || "Order";
                metaParts = [
                    `<span>${escapeHtml((item.order_type || "").replace(/_/g, " "))}</span>`,
                    `<span>${formatDate(item.order_date)}</span>`,
                    item.promised_date ? `<span>Due: ${formatDate(item.promised_date)}</span>` : "",
                ];
                targetHub = "orderbook-hub";
                openFn = `data-cust-nav-order="${item.id}"`;
            } else if (type === "invoices") {
                title = item.invoice_no || "Invoice";
                metaParts = [
                    `<span>${formatDateTime(item.invoice_datetime)}</span>`,
                    `<span>${formatCurrency(item.net_payable_amount)}</span>`,
                    item.balance_due_amount ? `<span>Due: ${formatCurrency(item.balance_due_amount)}</span>` : "",
                ];
                targetHub = "billing-hub";
                openFn = `data-cust-nav-invoice="${item.id}"`;
            } else {
                title = item.receipt_no || "Receipt";
                metaParts = [
                    `<span>${formatDateTime(item.receipt_datetime)}</span>`,
                    `<span>${formatCurrency(item.net_amount)}</span>`,
                    item.amount_received ? `<span>Received: ${formatCurrency(item.amount_received)}</span>` : "",
                ];
                targetHub = "billing-hub";
                openFn = `data-cust-nav-receipt="${item.id}"`;
            }
            const icon = type === "orders" ? orderIcon : type === "invoices" ? invoiceIcon : receiptIcon;
            return `<div class="customer-linked-card" ${openFn}>
                <div class="customer-linked-card-icon">${icon}</div>
                <div class="customer-linked-card-body">
                    <div class="customer-linked-card-header">
                        <span class="linked-title">${escapeHtml(title)}</span>
                        ${badge(item.status)}
                    </div>
                    <div class="customer-linked-card-meta">${metaParts.filter(Boolean).join("")}</div>
                </div>
                <div class="customer-linked-card-action">${arrowIcon}</div>
            </div>`;
        }).join("");
        return `<div class="customer-tab-summary"><span class="count-badge">${items.length}</span> ${type} found</div><div class="customer-linked-grid">${cards}</div>`;
    }

    /* Open modal immediately with loading state for linked tabs */
    openAppModal({
        kicker: "Customer",
        title: `${row.full_name || "Customer"}`,
        tabs: [
            { label: "Details", html: detailHtml },
            { label: "Orders", html: loadingHtml },
            { label: "Invoices", html: loadingHtml },
            { label: "Receipts", html: loadingHtml },
        ],
        onOpen: () => {
            document.getElementById("cust-modal-edit")?.addEventListener("click", () => {
                closeAppModal();
                openEntityFormModal("customers", row, () => openCustomerDetailModal(recordId));
            });
            document.getElementById("cust-modal-delete")?.addEventListener("click", () => {
                closeAppModal();
                openEntityDeleteConfirmModal("customers", recordId);
            });
        }
    });

    /* Fetch linked records asynchronously */
    try {
        const related = await requestJson(`/api/admin/customers/related?id=${encodeURIComponent(recordId)}`);
        const tabPanels = appModalContainer.querySelectorAll(".modal-tab-panel");
        if (tabPanels[1]) tabPanels[1].innerHTML = buildLinkedCards(related.orders, "orders");
        if (tabPanels[2]) tabPanels[2].innerHTML = buildLinkedCards(related.invoices, "invoices");
        if (tabPanels[3]) tabPanels[3].innerHTML = buildLinkedCards(related.receipts, "receipts");

        /* Update tab count badges */
        const tabBtns = appModalContainer.querySelectorAll(".modal-tab-btn");
        const counts = [null, (related.orders || []).length, (related.invoices || []).length, (related.receipts || []).length];
        counts.forEach((c, i) => {
            if (c != null && tabBtns[i]) {
                const existing = tabBtns[i].querySelector(".tab-count");
                if (existing) existing.textContent = c;
                else tabBtns[i].insertAdjacentHTML("beforeend", `<span class="tab-count">${c}</span>`);
            }
        });

        /* Attach navigation handlers to cards */
        appModalContainer.querySelectorAll("[data-cust-nav-order]").forEach(card => {
            card.addEventListener("click", () => {
                const orderId = card.dataset.custNavOrder;
                closeAppModal();
                navigateTo("orderbook-hub");
                loadOrderbookHub(true).then(() => {
                    state.hubs.orderbook.selectedOrderId = orderId;
                    openOrderViewModal(orderId);
                });
            });
        });
        appModalContainer.querySelectorAll("[data-cust-nav-invoice]").forEach(card => {
            card.addEventListener("click", () => {
                const invoiceId = card.dataset.custNavInvoice;
                closeAppModal();
                navigateTo("billing-hub");
                loadBillingHub(true).then(() => {
                    state.hubs.billing.selectedDocumentId = invoiceId;
                    state.hubs.billing.selectedDocumentType = "invoice";
                    openBillingDocumentViewModal(invoiceId);
                });
            });
        });
        appModalContainer.querySelectorAll("[data-cust-nav-receipt]").forEach(card => {
            card.addEventListener("click", () => {
                const receiptId = card.dataset.custNavReceipt;
                closeAppModal();
                navigateTo("billing-hub");
                loadBillingHub(true).then(() => {
                    state.hubs.billing.selectedDocumentId = receiptId;
                    state.hubs.billing.selectedDocumentType = "receipt";
                    openBillingDocumentViewModal(receiptId);
                });
            });
        });
    } catch (error) {
        console.error("Failed to load customer related records:", error);
        const tabPanels = appModalContainer.querySelectorAll(".modal-tab-panel");
        const errorHtml = `<div class="customer-linked-empty"><p>Failed to load linked records. ${escapeHtml(error.message)}</p></div>`;
        if (tabPanels[1]) tabPanels[1].innerHTML = errorHtml;
        if (tabPanels[2]) tabPanels[2].innerHTML = errorHtml;
        if (tabPanels[3]) tabPanels[3].innerHTML = errorHtml;
    }
}

async function openArtisanDetailModal(recordId) {
    const entity = getEntity("artisans");
    const row = findRow("artisans", recordId);
    if (!entity || !row) return;

    const fieldMap = Object.fromEntries(entity.fields.map((field) => [field.name, field]));
    const keys = [entity.primaryKey, ...entity.fields.map((field) => field.name).filter((name) => name !== entity.primaryKey)];
    const detailRows = keys.map((key) => {
        const field = fieldMap[key] || { label: key.replaceAll("_", " ") };
        return `<div class="modal-detail-item"><span class="modal-detail-label">${escapeHtml(field.label)}</span><div class="modal-detail-value">${renderDetailValue(field, row[key])}</div></div>`;
    }).join("");

    const detailHtml = `<div class="entity-modal-section">
        <div class="entity-modal-section-header">
            <span class="entity-modal-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            <span class="entity-modal-section-title">Artisan Details</span>
        </div>
        <div class="modal-detail-grid">${detailRows}</div>
    </div>`;
    const loadingHtml = `<div class="customer-loading"><div class="spinner"></div>Loading linked stock items…</div>`;
    const editIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
    const deleteIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

    openAppModal({
        size: "modal-artisan-detail",
        kicker: "Artisan",
        title: row.name || "Artisan",
        tabs: [
            { label: "Details", html: detailHtml },
            { label: "Stock Items", html: loadingHtml },
        ],
        footerHtml: `
            <button type="button" class="secondary-action compact-action" id="artisan-modal-edit">${editIcon} Edit</button>
            <button type="button" class="ghost-action compact-action entity-modal-delete-btn" id="artisan-modal-delete">${deleteIcon} Delete</button>
        `,
        onOpen: () => {
            document.getElementById("artisan-modal-edit")?.addEventListener("click", () => {
                closeAppModal();
                openEntityFormModal("artisans", row, () => openArtisanDetailModal(recordId));
            });
            document.getElementById("artisan-modal-delete")?.addEventListener("click", () => {
                closeAppModal();
                openEntityDeleteConfirmModal("artisans", recordId);
            });
        },
    });

    try {
        const related = await requestJson(`/api/admin/artisans/related?id=${encodeURIComponent(recordId)}`);
        const allItems = related.stock_items || [];
        const panel = appModalContainer.querySelectorAll(".modal-tab-panel")[1];
        const tabBtn = appModalContainer.querySelectorAll(".modal-tab-btn")[1];
        if (tabBtn) tabBtn.insertAdjacentHTML("beforeend", `<span class="tab-count">${allItems.length}</span>`);

        if (!panel) return;
        if (!allItems.length) {
            const emptyIcon = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`;
            panel.innerHTML = `<div class="artisan-stock-empty">${emptyIcon}<p>No stock items found for this artisan.</p></div>`;
            return;
        }

        /* ---- Helpers ---- */
        const searchIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
        const calendarIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
        const clearIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        const arrowIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
        const boxIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`;
        const emptyFilterIcon = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;

        function extractDateKey(dateStr) {
            if (!dateStr) return "Unknown";
            const d = new Date(dateStr);
            if (Number.isNaN(d.getTime())) return "Unknown";
            return d.toISOString().slice(0, 10);
        }

        function formatGroupDate(dateKey) {
            if (dateKey === "Unknown") return "Unknown Date";
            const d = new Date(dateKey + "T00:00:00");
            if (Number.isNaN(d.getTime())) return dateKey;
            return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
        }

        function matchSearch(item, query) {
            if (!query) return true;
            const q = query.toLowerCase();
            return [item.stock_no, item.description, item.purity, item.ornament_type, item.status, item.huid]
                .some((field) => String(field || "").toLowerCase().includes(q));
        }

        function matchDate(item, dateVal) {
            if (!dateVal) return true;
            const itemDate = extractDateKey(item.linked_at || item.created_at || item.updated_at);
            return itemDate === dateVal;
        }

        function buildStockCard(item) {
            const statusText = (item.status || "").replace(/_/g, " ");
            const ornamentText = (item.ornament_type || "").replace(/_/g, " ");
            return `<div class="artisan-stock-card" data-artisan-stock-item="${item.id}">
                <div class="artisan-stock-card-icon">${boxIcon}</div>
                <div class="artisan-stock-card-body">
                    <div class="artisan-stock-card-header">
                        <span class="stock-no">${escapeHtml(item.stock_no || "Stock Item")}</span>
                        ${badge(item.status)}
                        ${ornamentText ? `<span class="meta-chip">${escapeHtml(ornamentText)}</span>` : ""}
                    </div>
                    <div class="artisan-stock-card-desc">${escapeHtml(item.description || "No description")}</div>
                    <div class="artisan-stock-card-meta">
                        <span class="meta-chip"><span class="meta-label">Purity</span> ${escapeHtml(item.purity || "--")}</span>
                        <span class="meta-chip"><span class="meta-label">Gross</span> ${escapeHtml(String(item.gross_weight_g ?? "--"))} g</span>
                        ${item.net_weight_g != null ? `<span class="meta-chip"><span class="meta-label">Net</span> ${escapeHtml(String(item.net_weight_g))} g</span>` : ""}
                        ${renderStockItemPaymentMetaChips(item)}
                    </div>
                </div>
                <div class="artisan-stock-card-arrow">${arrowIcon}</div>
            </div>`;
        }

        function groupByDate(items) {
            const groups = {};
            const order = [];
            items.forEach((item) => {
                const key = extractDateKey(item.linked_at || item.created_at || item.updated_at);
                if (!groups[key]) {
                    groups[key] = [];
                    order.push(key);
                }
                groups[key].push(item);
            });
            /* Sort groups: newest first, Unknown last */
            order.sort((a, b) => {
                if (a === "Unknown") return 1;
                if (b === "Unknown") return -1;
                return b.localeCompare(a);
            });
            return order.map((key) => ({ dateKey: key, label: formatGroupDate(key), items: groups[key] }));
        }

        function renderStockItemsView(searchQuery, dateFilter) {
            let filtered = allItems;
            if (searchQuery) filtered = filtered.filter((item) => matchSearch(item, searchQuery));
            if (dateFilter) filtered = filtered.filter((item) => matchDate(item, dateFilter));

            const totalWeight = filtered.reduce((sum, item) => sum + (parseFloat(item.gross_weight_g) || 0), 0);
            const isFiltered = searchQuery || dateFilter;

            /* Summary stats */
            const summaryHtml = `<div class="artisan-stock-summary">
                <span class="artisan-stock-summary-stat">Total <span class="stat-value">${filtered.length}</span> item${filtered.length !== 1 ? "s" : ""}</span>
                <span class="artisan-stock-summary-stat">Weight <span class="stat-value">${totalWeight.toFixed(2)} g</span></span>
                ${isFiltered ? `<span class="artisan-stock-filter-active">${searchIcon} Filtered from ${allItems.length}</span>` : ""}
            </div>`;

            if (!filtered.length) {
                return summaryHtml + `<div class="artisan-stock-empty">${emptyFilterIcon}<p>No stock items match your ${searchQuery ? "search" : "date filter"}. Try adjusting the criteria.</p></div>`;
            }

            const groups = groupByDate(filtered);
            const groupsHtml = groups.map((group) => `<div class="artisan-stock-date-group">
                <div class="artisan-stock-date-header">
                    <span class="artisan-stock-date-label">
                        <span class="date-icon">${calendarIcon}</span>
                        ${escapeHtml(group.label)}
                        <span class="artisan-stock-date-count">${group.items.length}</span>
                    </span>
                </div>
                <div class="artisan-stock-cards">
                    ${group.items.map((item) => buildStockCard(item)).join("")}
                </div>
            </div>`).join("");

            return summaryHtml + `<div class="artisan-stock-scroll">${groupsHtml}</div>`;
        }

        /* ---- Build toolbar ---- */
        const toolbarHtml = `<div class="artisan-stock-toolbar">
            <div class="artisan-stock-search-wrap">
                <span class="search-icon">${searchIcon}</span>
                <input type="text" class="artisan-stock-search" id="artisan-stock-search" placeholder="Search by stock no, description, purity, type…" autocomplete="off">
            </div>
            <div class="artisan-stock-date-wrap">
                <label for="artisan-stock-date-filter">Added on</label>
                <input type="date" class="artisan-stock-date-input" id="artisan-stock-date-filter">
                <button type="button" class="artisan-stock-date-clear" id="artisan-stock-date-clear" title="Clear date filter">${clearIcon}</button>
            </div>
        </div>`;

        const contentId = "artisan-stock-content";
        panel.innerHTML = `${toolbarHtml}<div id="${contentId}">${renderStockItemsView("", "")}</div>`;

        /* ---- Wire up event listeners ---- */
        const searchInput = document.getElementById("artisan-stock-search");
        const dateInput = document.getElementById("artisan-stock-date-filter");
        const dateClear = document.getElementById("artisan-stock-date-clear");
        const contentEl = document.getElementById(contentId);

        function rerender() {
            if (!contentEl) return;
            contentEl.innerHTML = renderStockItemsView(searchInput?.value || "", dateInput?.value || "");
            attachCardNav();
        }

        function attachCardNav() {
            contentEl?.querySelectorAll("[data-artisan-stock-item]").forEach((card) => {
                card.addEventListener("click", () => {
                    closeAppModal();
                    navigateTo("stock-items");
                    loadEntityRows("stock-items", true).then(() => openStockItemDetailModal(card.dataset.artisanStockItem));
                });
            });
        }

        let searchTimer = null;
        searchInput?.addEventListener("input", () => {
            window.clearTimeout(searchTimer);
            searchTimer = window.setTimeout(rerender, 180);
        });
        dateInput?.addEventListener("change", rerender);
        dateClear?.addEventListener("click", () => {
            if (dateInput) dateInput.value = "";
            rerender();
        });

        attachCardNav();
    } catch (error) {
        const panel = appModalContainer.querySelectorAll(".modal-tab-panel")[1];
        if (panel) panel.innerHTML = `<div class="artisan-stock-empty"><p>Failed to load linked records. ${escapeHtml(error.message)}</p></div>`;
    }
}


const STOCK_ITEM_GENERAL_FIELD_NAMES = [
    "stock_no",
    "huid",
    "description",
    "hsn_code",
    "ornament_type",
    "quantity",
    "purity",
    "gross_weight_g",
    "weight_entry_unit",
    "weight_ratti",
    "net_weight_g",
    "stone_weight_g",
    "stone_amount",
    "stone_expense",
    "stone_expense_entry_mode",
    "stone_expense_per_ratti",
    "stone_cost_entry_mode",
    "stone_cost_per_ratti",
    "other_charges_amount",
    "silver_expense_entry_mode",
    "silver_expense_price_per_gm",
    "silver_cost_entry_mode",
    "silver_cost_price_per_gm",
    "silver_cost_total_price",
    "silver_other_expenses",
    "making_charges_percent",
    "making_baseline",
    "goldsmith_loss",
    "other_expenses",
    "status",
    "notes",
];

// HSN Codes for all items below are to be charges as 1.5% SGST + 1.5% CGST (or 3% IGST) = 3% GST
const GOLD_HSN_CODES = new Set(["71131910", "71131920", "71131930", "71131940", "71131960", "71131990", "71132000"]);
const GOLD_SEMI_MANUFACTURED_CODES = new Set(["71081200", "71081300", "71082000", "71090000"]);
const GOLD_ARTICLES_CODES = new Set(["71141910", "71141930", "71142010", "71142020", "71142030"]);
const SILVER_HSN_CODES = new Set(["71131110", "71131120", "71131130", "71131190"]);
const SILVER_SEMI_MANUFACTURED_CODES = new Set(["71069100", "71069210", "71069290", "71070000"]);
const SILVER_ARTICLES_CODES = new Set(["71141110", "71141120"]);
const IMITATION_HSN_CODES = new Set(["71179010", "71171990", "71179090", "71171100", "71171910", "71171920"]);
const PEARL_ARTICLES_HSN_CODES = new Set(["71161000", "71162000"]);
const PEARL_LOOSE_HSN_CODES = new Set(["71011010", "71011020", "71012100", "71012200"]);
// HSN Codes for all items above are to be charges as 1.5% SGST + 1.5% CGST (or 3% IGST) = 3% GST
// HSN Codes for all items below are to be charges as 0.125% SGST + 0.125% CGST (or 0.25% IGST) = 0.25% GST
const STONE_HSN_CODES = new Set(["71039110", "71039120", "71039130", "71039911", "71039912", "71039913", "71039919", "71039921", "71039929", "71039931", "71039932", "71039939", "71039941", "71039942", "71039943", "71039944", "71039949", "71039951", "71039952", "71039959", "71039990"]);
// HSN Codes for all items above are to be charges as 0.125% SGST + 0.125% CGST (or 0.25% IGST) = 0.25% GST

const ALL_GOLD_HSN_CODES = new Set([...GOLD_HSN_CODES, ...GOLD_SEMI_MANUFACTURED_CODES, ...GOLD_ARTICLES_CODES]);
const ALL_SILVER_HSN_CODES = new Set([...SILVER_HSN_CODES, ...SILVER_SEMI_MANUFACTURED_CODES, ...SILVER_ARTICLES_CODES]);
const ALL_STONE_CATEGORY_HSN_CODES = new Set([...STONE_HSN_CODES, ...PEARL_ARTICLES_HSN_CODES, ...PEARL_LOOSE_HSN_CODES]);

const GOLD_PURITY_VALUES = new Set(["22K", "24K", "18K", "14K", "9K"]);
const SILVER_PURITY_VALUES = new Set(["925", "999", "990", "970", "958", "835", "800"]);

function detectOrnamentCategory(hsnCode) {
    const code = String(hsnCode || "").trim();
    if (ALL_GOLD_HSN_CODES.has(code)) return "gold";
    if (ALL_SILVER_HSN_CODES.has(code)) return "silver";
    if (IMITATION_HSN_CODES.has(code)) return "imitation";
    if (ALL_STONE_CATEGORY_HSN_CODES.has(code)) return "stone";
    return "gold"; /* default to gold for unrecognised codes */
}

const GOLD_PURITY_BASELINE_MAP = {
    "22K": "0.92",
    "18K": "0.75",
    "14K": "0.583",
    "9K": "0.375",
    "24K": "1.00",
};

function stockItemDefaultBaseline(hsnCode, purityValue) {
    const code = String(hsnCode || "").trim();
    if (ALL_GOLD_HSN_CODES.has(code)) {
        const purity = String(purityValue || "").trim().toUpperCase();
        return GOLD_PURITY_BASELINE_MAP[purity] || "0.92";
    }
    if (ALL_SILVER_HSN_CODES.has(code)) return "0.925";
    return "0.920";
}

function hasMeaningfulValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
}

function formatCurrencyIfSet(value) {
    return hasMeaningfulValue(value) ? formatCurrency(value) : "--";
}

function formatDecimalValue(value, digits = 3, suffix = "") {
    const numberValue = toNumber(value);
    if (!Number.isFinite(numberValue)) return "--";
    return `${numberValue.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}

function getStockItemPaymentSummary(item) {
    const category = detectOrnamentCategory(item?.hsn_code);
    const parts = [];
    const netWeight = toNumber(item?.net_weight_g);
    const weightRatti = toNumber(item?.weight_ratti);
    const stoneExpense = item?.stone_expense;
    const otherExpense = item?.other_expenses;

    if (category === "gold") {
        const paymentWeight = (() => {
            const baseline = toNumber(item?.making_baseline);
            const goldsmithLoss = toNumber(item?.goldsmith_loss);
            if (!netWeight || !baseline) return null;
            return (baseline + goldsmithLoss / 100) * netWeight;
        })();
        if (paymentWeight != null) {
            parts.push({ label: "Pay wt", value: formatDecimalValue(paymentWeight, 3, " g") });
        }
        if (hasMeaningfulValue(stoneExpense)) {
            parts.push({ label: "Stone exp", value: formatCurrency(stoneExpense) });
        }
        if (hasMeaningfulValue(otherExpense)) {
            parts.push({ label: "Other exp", value: formatCurrency(otherExpense) });
        }
        return parts;
    }

    if (category === "silver") {
        const expensePerGm = item?.silver_expense_price_per_gm;
        const totalExpense = hasMeaningfulValue(otherExpense)
            ? otherExpense
            : (toNumber(expensePerGm) * netWeight);
        if (hasMeaningfulValue(expensePerGm) || hasMeaningfulValue(otherExpense)) {
            parts.push({
                label: "Expense/gm",
                value: `${formatCurrencyIfSet(expensePerGm)} (${formatCurrency(totalExpense)})`,
            });
        }
        if (hasMeaningfulValue(stoneExpense)) {
            parts.push({ label: "Stone exp", value: formatCurrency(stoneExpense) });
        }
        if (hasMeaningfulValue(item?.silver_other_expenses)) {
            parts.push({ label: "Other exp", value: formatCurrency(item.silver_other_expenses) });
        }
        return parts;
    }

    if (category === "stone") {
        const expensePerRatti = item?.stone_expense_per_ratti;
        const totalExpense = hasMeaningfulValue(otherExpense)
            ? otherExpense
            : (toNumber(expensePerRatti) * weightRatti);
        if (hasMeaningfulValue(expensePerRatti) || hasMeaningfulValue(otherExpense)) {
            parts.push({
                label: "Stone exp/ratti",
                value: `${formatCurrencyIfSet(expensePerRatti)} (${formatCurrency(totalExpense)})`,
            });
        }
        return parts;
    }

    if (category === "imitation") {
        if (hasMeaningfulValue(otherExpense)) {
            parts.push({ label: "Total exp", value: formatCurrency(otherExpense) });
        }
        return parts;
    }

    return parts;
}

function renderStockItemPaymentBadges(item) {
    return getStockItemPaymentSummary(item)
        .map(({ label, value }) => badge(`${label} ${value}`))
        .join("");
}

function renderStockItemPaymentMetaChips(item) {
    return getStockItemPaymentSummary(item)
        .map(({ label, value }) => `<span class="meta-chip payment-chip"><span class="meta-label">${escapeHtml(label)}</span> ${escapeHtml(value)}</span>`)
        .join("");
}

function filterStockItemPurityOptions(form, category) {
    if (!form) return;
    const purityWrap = form.querySelector('.searchable-select[data-searchable-for="purity"]');
    if (!purityWrap) return;
    const hiddenSelect = purityWrap.querySelector("select");
    const optionsContainer = purityWrap.querySelector(".searchable-options");
    if (!hiddenSelect || !optionsContainer) return;

    const allowedSet = category === "gold" ? GOLD_PURITY_VALUES
        : category === "silver" ? SILVER_PURITY_VALUES
            : null; /* imitation/stone: show all */

    /* Show/hide searchable dropdown options */
    optionsContainer.querySelectorAll(".searchable-option").forEach((opt) => {
        const val = opt.dataset.value || "";
        if (!val) return; /* keep placeholder */
        if (!allowedSet) { opt.dataset.hidden = "false"; return; }
        opt.dataset.hidden = allowedSet.has(val) ? "false" : "true";
    });

    /* Show/hide underlying <option> elements */
    Array.from(hiddenSelect.options).forEach((opt) => {
        if (!opt.value) return;
        if (!allowedSet) { opt.hidden = false; opt.disabled = false; return; }
        const allowed = allowedSet.has(opt.value);
        opt.hidden = !allowed;
        opt.disabled = !allowed;
    });

    /* If current value is not in allowed set, clear it */
    if (allowedSet && hiddenSelect.value && !allowedSet.has(hiddenSelect.value)) {
        hiddenSelect.value = "";
        hiddenSelect.dispatchEvent(new Event("change", { bubbles: true }));
        /* Update trigger display */
        const content = purityWrap.querySelector(".searchable-trigger-content");
        if (content) content.innerHTML = `<span class="searchable-trigger-placeholder">Select…</span>`;
    }
}

function buildStockItemArtisanCard(artisan, { removable = true, paymentHtml = "" } = {}) {
    if (!artisan?.id) return "";
    const makingBadge = artisan.usual_making_charge_percent != null && artisan.usual_making_charge_percent !== ""
        ? badge(`${artisan.usual_making_charge_percent}% MC`)
        : "";
    const cashBadge = artisan.usual_cash_charged != null && artisan.usual_cash_charged !== ""
        ? badge(`₹${Number(artisan.usual_cash_charged).toFixed(2)} cash`)
        : "";
    return `<article class="customer-linked-card" data-selected-artisan="${artisan.id}">
        <div class="customer-linked-card-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
        <div class="customer-linked-card-body">
            <div class="customer-linked-card-header">
                <span class="linked-title">${escapeHtml(artisan.name || "Artisan")}</span>
                ${makingBadge}
                ${cashBadge}
                ${paymentHtml}
            </div>
            <div class="customer-linked-card-meta"><span>${escapeHtml(artisan.description || "No description")}</span></div>
        </div>
        <div class="stock-artisan-card-actions">
            <button type="button" class="table-action" data-open-selected-artisan="${artisan.id}">Open</button>
            ${removable ? `<button type="button" class="table-action danger" data-remove-selected-artisan="${artisan.id}">Remove</button>` : ""}
        </div>
    </article>`;
}

function updateStockItemArtisanTabCount() {
    const count = appModalContainer._stockItemFormState?.selectedArtisans?.length || 0;
    const tabBtn = appModalContainer.querySelectorAll(".modal-tab-btn")[1];
    if (!tabBtn) return;
    const existing = tabBtn.querySelector(".tab-count");
    if (existing) existing.textContent = count;
    else tabBtn.insertAdjacentHTML("beforeend", `<span class="tab-count">${count}</span>`);
}

function renderStockItemSelectedArtisans() {
    const state = appModalContainer._stockItemFormState;
    const panel = document.getElementById("stock-item-artisan-selected-list");
    const hidden = document.getElementById("stock-item-artisan-ids");
    if (!panel || !state) return;
    const items = state.selectedArtisans || [];
    if (hidden) hidden.value = items.map((artisan) => artisan.id).filter(Boolean).join(",");
    updateStockItemArtisanTabCount();
    panel.innerHTML = items.length
        ? `<div class="customer-tab-summary"><span class="count-badge">${items.length}</span> linked artisan${items.length === 1 ? "" : "s"}</div><div class="customer-linked-grid">${items.map((artisan) => buildStockItemArtisanCard(artisan)).join("")}</div>`
        : `<div class="customer-linked-empty"><p>No artisans linked yet. This step is optional and can be completed later from edit mode.</p></div>`;
    panel.querySelectorAll("[data-remove-selected-artisan]").forEach((button) => {
        button.addEventListener("click", () => {
            state.selectedArtisans = state.selectedArtisans.filter((artisan) => String(artisan.id) !== String(button.dataset.removeSelectedArtisan));
            renderStockItemSelectedArtisans();
        });
    });
    panel.querySelectorAll("[data-open-selected-artisan]").forEach((button) => {
        button.addEventListener("click", () => {
            closeAppModal();
            navigateTo("artisans");
            loadEntityRows("artisans", true).then(() => openArtisanDetailModal(button.dataset.openSelectedArtisan));
        });
    });
}

function maybeSyncStockItemStoneWeight() {
    const form = document.getElementById("entity-modal-form");
    const state = appModalContainer._stockItemFormState;
    if (!form || !state) return;
    const grossField = form.querySelector('[name="gross_weight_g"]');
    const netField = form.querySelector('[name="net_weight_g"]');
    const stoneField = form.querySelector('[name="stone_weight_g"]');
    if (!grossField || !netField || !stoneField) return;
    const gross = toNumber(grossField.value);
    const net = toNumber(netField.value);
    const derived = Math.max(gross - net, 0);
    if (!stoneField.value.trim() || stoneField.dataset.manual !== "true" || stoneField.value === stoneField.dataset.autoValue) {
        stoneField.value = derived ? derived.toFixed(3) : "0";
        stoneField.dataset.autoValue = stoneField.value;
    }
}

function maybeSyncStockItemBaseline(force = false) {
    const form = document.getElementById("entity-modal-form");
    if (!form) return;
    const hsnField = form.querySelector('[name="hsn_code"]');
    const baselineField = form.querySelector('[name="making_baseline"]');
    const purityField = form.querySelector('[name="purity"]');
    if (!hsnField || !baselineField) return;
    if (force || !baselineField.value.trim() || baselineField.dataset.manual !== "true") {
        baselineField.value = stockItemDefaultBaseline(hsnField.value, purityField?.value);
    }
}

function stockToggleMode(form, toggleId, leftValue, rightValue) {
    const toggle = form?.querySelector(`#${toggleId}`);
    return toggle?.checked ? rightValue : leftValue;
}

function setPayloadNumber(payload, key, value) {
    if (Number.isFinite(value)) {
        payload[key] = String(value);
    }
}

function serializeStockItemPayload(form) {
    const payload = serializeForm("stock-items", form);
    if (Object.hasOwn(payload, "huid")) {
        payload.huid = splitHuidValues(payload.huid).join(" ");
    }
    const category = detectOrnamentCategory(form?.querySelector('[name="hsn_code"]')?.value);
    const numberValue = (name) => toNumber(form?.querySelector(`[name="${name}"]`)?.value);

    if (category === "silver") {
        payload.silver_expense_entry_mode = stockToggleMode(form, "silver-expense-toggle", "per_gm", "total");
        payload.silver_cost_entry_mode = stockToggleMode(form, "silver-cost-toggle", "per_gm", "total");
        const netWeight = numberValue("net_weight_g");
        if (payload.silver_expense_entry_mode === "per_gm") {
            setPayloadNumber(payload, "other_expenses", numberValue("silver_expense_price_per_gm") * netWeight);
        } else {
            payload.silver_expense_price_per_gm = "";
        }
        if (payload.silver_cost_entry_mode === "per_gm") {
            setPayloadNumber(payload, "silver_cost_total_price", numberValue("silver_cost_price_per_gm") * netWeight);
        } else {
            payload.silver_cost_price_per_gm = "";
        }
    } else if (category === "stone") {
        payload.weight_entry_unit = stockToggleMode(form, "stone-weight-toggle", "g", "ratti");
        payload.stone_expense_entry_mode = stockToggleMode(form, "stone-expense-toggle", "per_ratti", "total");
        payload.stone_cost_entry_mode = stockToggleMode(form, "stone-cost-toggle", "per_ratti", "total");
        const rattiWeight = numberValue("weight_ratti");
        if (payload.weight_entry_unit === "ratti") {
            payload.gross_weight_g = "0";
            payload.net_weight_g = "0";
        } else {
            payload.net_weight_g = payload.gross_weight_g || "0";
            payload.weight_ratti = "";
        }
        payload.stone_weight_g = "0";
        if (payload.stone_expense_entry_mode === "per_ratti") {
            setPayloadNumber(payload, "other_expenses", numberValue("stone_expense_per_ratti") * rattiWeight);
        } else {
            payload.stone_expense_per_ratti = "";
        }
        if (payload.stone_cost_entry_mode === "per_ratti") {
            setPayloadNumber(payload, "other_charges_amount", numberValue("stone_cost_per_ratti") * rattiWeight);
        } else {
            payload.stone_cost_per_ratti = "";
        }
    } else if (category === "imitation") {
        payload.gross_weight_g = payload.gross_weight_g || "0";
        payload.net_weight_g = payload.net_weight_g || "0";
        payload.stone_weight_g = payload.stone_weight_g || "0";
    }

    return payload;
}

async function fetchStockItemArtisanSuggestions(query) {
    const panel = document.getElementById("stock-item-artisan-search-results");
    const state = appModalContainer._stockItemFormState;
    if (!panel || !state) return;
    if (query.trim().length < 2) {
        panel.innerHTML = "";
        return;
    }
    try {
        const data = await requestJson(`/api/admin/artisans/search?q=${encodeURIComponent(query.trim())}`);
        const suggestions = (data.suggestions || []).filter((artisan) => !state.selectedArtisans.some((selected) => String(selected.id) === String(artisan.id)));
        panel.innerHTML = suggestions.length
            ? suggestions.map((artisan, index) => {
                const scorePct = Math.round((artisan.score || 0) * 100);
                const scoreClass = scorePct >= 90 ? "high" : scorePct >= 75 ? "medium" : "low";
                return `<div class="cust-smart-card" style="animation-delay:${index * 40}ms">
                    <div class="cust-smart-header">
                        <div class="cust-smart-header-left">
                            <div class="cust-smart-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
                            <div class="cust-smart-text">
                                <span class="cust-smart-eyebrow">ARTISAN MATCH</span>
                                <strong>${highlightMatch(artisan.name || "Artisan", query)}</strong>
                            </div>
                        </div>
                        <span class="cust-smart-score ${scoreClass}">${scorePct}%</span>
                    </div>
                    <div class="cust-smart-details">
                        ${artisan.description ? `<div class="cust-smart-detail-line"><span class="cust-smart-detail-label">ABOUT</span><span class="cust-smart-detail-value">${highlightMatch(artisan.description, query)}</span></div>` : ""}
                        ${artisan.usual_making_charge_percent != null && artisan.usual_making_charge_percent !== "" ? `<div class="cust-smart-detail-line"><span class="cust-smart-detail-label">USUAL MC%</span><span class="cust-smart-detail-value">${escapeHtml(artisan.usual_making_charge_percent)}</span></div>` : ""}
                        ${artisan.usual_cash_charged != null && artisan.usual_cash_charged !== "" ? `<div class="cust-smart-detail-line"><span class="cust-smart-detail-label">USUAL CASH</span><span class="cust-smart-detail-value">${escapeHtml(artisan.usual_cash_charged)}</span></div>` : ""}
                    </div>
                    <div class="cust-smart-actions">
                        <button type="button" class="cust-smart-dismiss" data-dismiss-stock-item-artisan-suggestion="${index}">Dismiss</button>
                        <button type="button" class="cust-smart-accept" data-add-stock-item-artisan="${artisan.id}">Link Artisan</button>
                    </div>
                </div>`;
            }).join("")
            : `<div class="customer-linked-empty"><p>No matching artisans found. Create artisans first from the Artisans master page, then link them here.</p></div>`;
        panel.querySelectorAll("[data-add-stock-item-artisan]").forEach((button) => {
            button.addEventListener("click", () => {
                const artisan = suggestions.find((item) => String(item.id) === String(button.dataset.addStockItemArtisan));
                if (!artisan) return;
                state.selectedArtisans.push(artisan);
                renderStockItemSelectedArtisans();
                panel.innerHTML = "";
                const searchInput = document.getElementById("stock-item-artisan-search-input");
                if (searchInput) searchInput.value = "";
            });
        });
        panel.querySelectorAll("[data-dismiss-stock-item-artisan-suggestion]").forEach((button) => {
            button.addEventListener("click", () => {
                button.closest(".cust-smart-card")?.remove();
            });
        });
    } catch (error) {
        panel.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    }
}

function updateStockItemModalStep(stepIndex = 0) {
    const state = appModalContainer._stockItemFormState;
    if (!state) return;
    state.currentStep = stepIndex;
    const totalSteps = 2;
    const stepLabel = document.getElementById("stock-item-progress-step");
    const stepCaption = document.getElementById("stock-item-progress-caption");
    const progressFill = document.getElementById("stock-item-progress-fill");
    const primaryButton = document.getElementById("entity-modal-save");
    const prevButton = document.getElementById("stock-item-prev-step");
    if (stepLabel) stepLabel.textContent = `Step ${stepIndex + 1} of ${totalSteps}`;
    if (stepCaption) {
        stepCaption.textContent = stepIndex === 0
            ? "Enter ornament details before reviewing optional artisan links."
            : state.isEdit
                ? "Update linked artisans if needed, or save without changing them."
                : "Link artisans if needed, or finish without adding any.";
    }
    if (progressFill) {
        progressFill.style.width = `${((stepIndex + 1) / totalSteps) * 100}%`;
    }
    if (primaryButton) {
        primaryButton.textContent = stepIndex === 0
            ? (state.isEdit ? "Review Artisans" : "Continue to Artisans")
            : (state.isEdit ? "Save Stock Item" : "Add to Stock");
    }
    if (prevButton) {
        prevButton.hidden = stepIndex === 0;
    }
}

async function submitStockItemModalForm(form, saveBtn) {
    if (!form) {
        showToast("Stock item form is unavailable.", true);
        return;
    }
    if (!form.reportValidity()) return;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    renderStockItemSelectedArtisans();
    try {
        await requestJson("/api/admin/stock-items", {
            method: "POST",
            body: JSON.stringify(serializeStockItemPayload(form)),
        });
        closeAppModal();
        await Promise.all([loadPortal(), loadEntityRows("stock-items", true), loadLookups()]);
        renderAllVisibleTables();
        showToast("Stock Item saved");
    } catch (error) {
        showToast(error.message, true);
        updateStockItemModalStep(appModalContainer._stockItemFormState?.currentStep || 1);
        saveBtn.disabled = false;
    }
}

function openStockItemFormModal(row = null, backFn = null) {
    const entity = getEntity("stock-items");
    if (!entity) return;
    const isEdit = !!row;
    const generalFields = entity.fields.filter((field) => STOCK_ITEM_GENERAL_FIELD_NAMES.includes(field.name));
    const initialArtisans = Array.isArray(row?.artisans) && row.artisans.length
        ? row.artisans
        : row?.artisan_id
            ? [{ id: row.artisan_id, name: row.artisan_name || row.goldsmith_name || formatLookupValue("artisans", row.artisan_id), description: "" }]
            : [];
    appModalContainer._stockItemFormState = {
        selectedArtisans: [...initialArtisans],
        currentStep: 0,
        isEdit,
    };

    /* Group fields by section */
    const identityNames = ["stock_no", "huid", "description", "hsn_code", "ornament_type"];
    const physicalNames = ["purity", "quantity", "gross_weight_g", "net_weight_g", "stone_weight_g"];
    const statusNames = ["status", "notes"];

    function fieldsByNames(names) {
        return names.map((name) => generalFields.find((f) => f.name === name)).filter(Boolean);
    }

    function formSection(iconSvg, title, fieldsHtml, { subtitle = "", id = "" } = {}) {
        const subtitleHtml = subtitle ? `<span class="stock-form-group-subtitle">${subtitle}</span>` : "";
        const idAttr = id ? ` id="${id}"` : "";
        return `<div class="stock-form-group"${idAttr}>
            <div class="stock-form-group-header">
                <span class="stock-form-group-icon">${iconSvg}</span>
                <span class="stock-form-group-title">${escapeHtml(title)}${subtitleHtml}</span>
            </div>
            <div class="stock-form-group-fields">
                <div class="field-grid two-col">
                    ${fieldsHtml}
                </div>
            </div>
        </div>`;
    }

    function renderFieldsHtml(names) {
        return fieldsByNames(names).map((field) => renderField(field, "stock-items")).join("");
    }

    function buildToggleSwitch(id, leftLabel, rightLabel, defaultChecked = false) {
        const checkedAttr = defaultChecked ? " checked" : "";
        const leftActive = defaultChecked ? "" : " active";
        const rightActive = defaultChecked ? " active" : "";
        return `<div class="stock-toggle-row">
            <label class="stock-toggle-label">
                <span class="stock-toggle-side${leftActive}" data-toggle-side="left" data-toggle-for="${id}">${leftLabel}</span>
                <span class="stock-toggle-switch">
                    <input type="checkbox" id="${id}" class="stock-toggle-checkbox"${checkedAttr}>
                    <span class="stock-toggle-slider"></span>
                </span>
                <span class="stock-toggle-side${rightActive}" data-toggle-side="right" data-toggle-for="${id}">${rightLabel}</span>
            </label>
        </div>`;
    }

    function buildStockItemPhysicalSection(category) {
        const physicalIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18"/><path d="M8 7l4-4 4 4"/><path d="M8 17l4 4 4-4"/></svg>`;
        if (category === "stone") {
            const initialWeightIsRatti = row ? (row.weight_entry_unit === "ratti" || row.weight_ratti != null) : true;
            const stonePhysicalHtml = `
                ${renderFieldsHtml(["quantity"])}
                ${buildToggleSwitch("stone-weight-toggle", "Grams", "Ratti", initialWeightIsRatti)}
                <div id="stone-weight-grams-row">
                    <label>
                        <span>Weight (gm)</span>
                        <input name="gross_weight_g" id="field-gross_weight_g" type="number" step="0.01" placeholder="Weight in grams">
                    </label>
                </div>
                <div id="stone-weight-ratti-row" style="display:none;">
                    <label>
                        <span>Weight (ratti)</span>
                        <input name="weight_ratti" id="field-weight_ratti" type="number" step="0.01" placeholder="Weight in ratti">
                    </label>
                </div>
            `;
            return formSection(physicalIcon, "Physical Properties", stonePhysicalHtml, { id: "stock-physical-section" });
        }
        if (category === "imitation") {
            return formSection(physicalIcon, "Physical Properties", renderFieldsHtml(["quantity"]), { id: "stock-physical-section" });
        }
        return formSection(physicalIcon, "Physical Properties", renderFieldsHtml(physicalNames), { id: "stock-physical-section" });
    }

    function buildStockItemCostExpenseSections(category) {
        let expenseHtml = "";
        let costHtml = "";

        if (category === "silver") {
            const initialSilverExpenseIsTotal = row?.silver_expense_entry_mode === "total";
            const initialSilverCostIsTotal = row?.silver_cost_entry_mode === "total";
            /* ── Silver Expenses ── */
            expenseHtml = `
                <label>
                    <span>Artisan Payment %</span>
                    <input name="goldsmith_loss" id="field-goldsmith_loss" type="number" step="0.01" placeholder="e.g. 80, 100">
                </label>
                ${buildToggleSwitch("silver-expense-toggle", "Per Gram", "Total Expense", initialSilverExpenseIsTotal)}
                <div id="silver-expense-per-gm-row">
                    <label>
                        <span>Expense / gm <span class="stock-inline-computed" id="silver-expense-total-display"></span></span>
                        <input name="silver_expense_price_per_gm" id="field-silver_expense_price_per_gm" type="number" step="0.01" placeholder="Expense per gram">
                    </label>
                </div>
                <div id="silver-expense-total-row" style="display:none;">
                    <label>
                        <span>Total Expense</span>
                        <input name="other_expenses" id="field-other_expenses" type="number" step="0.01" placeholder="Total expense amount">
                    </label>
                </div>
                ${renderFieldsHtml(["stone_expense"])}
                <label>
                    <span>Other Expenses</span>
                    <input name="silver_other_expenses" id="field-silver_other_expenses" type="number" step="0.01" placeholder="Any other expenses">
                </label>
            `;
            /* ── Silver Cost ── */
            costHtml = `
                ${buildToggleSwitch("silver-cost-toggle", "Per Gram", "Making Charges", initialSilverCostIsTotal)}
                <div id="silver-cost-per-gm-row">
                    <label>
                        <span>Cost / gm <span class="stock-inline-computed" id="silver-cost-total-display"></span></span>
                        <input name="silver_cost_price_per_gm" id="field-silver_cost_price_per_gm" type="number" step="0.01" placeholder="Cost per gram">
                    </label>
                </div>
                <div id="silver-cost-total-row" style="display:none;">
                    <label>
                        <span>Making Charges</span>
                        <input name="silver_cost_total_price" id="field-silver_cost_total_price" type="number" step="0.01" placeholder="Making charges">
                    </label>
                </div>
                ${renderFieldsHtml(["stone_amount", "other_charges_amount"])}
                <div id="stock-cost-loss-warnings" class="stock-cost-loss-warnings"></div>
            `;
        } else if (category === "stone") {
            const initialStoneExpenseIsTotal = row?.stone_expense_entry_mode === "total";
            const initialStoneCostIsTotal = row?.stone_cost_entry_mode === "total";
            /* ── Stone Expenses ── */
            expenseHtml = `
                ${buildToggleSwitch("stone-expense-toggle", "Per Ratti", "Total Expense", initialStoneExpenseIsTotal)}
                <div id="stone-expense-per-ratti-row">
                    <label>
                        <span>Expense / ratti <span class="stock-inline-computed" id="stone-expense-total-display"></span></span>
                        <input name="stone_expense_per_ratti" id="field-stone_expense_per_ratti" type="number" step="0.01" placeholder="Expense per ratti">
                    </label>
                </div>
                <div id="stone-expense-total-row" style="display:none;">
                    <label>
                        <span>Total Expense</span>
                        <input name="other_expenses" id="field-other_expenses" type="number" step="0.01" placeholder="Total expense">
                    </label>
                </div>
            `;
            /* ── Stone Cost ── */
            costHtml = `
                ${buildToggleSwitch("stone-cost-toggle", "Per Ratti", "Total Cost", initialStoneCostIsTotal)}
                <div id="stone-cost-per-ratti-row">
                    <label>
                        <span>Cost / ratti <span class="stock-inline-computed" id="stone-cost-total-display"></span></span>
                        <input name="stone_cost_per_ratti" id="field-stone_cost_per_ratti" type="number" step="0.01" placeholder="Cost per ratti">
                    </label>
                </div>
                <div id="stone-cost-total-row" style="display:none;">
                    <label>
                        <span>Total Cost</span>
                        <input name="other_charges_amount" id="field-other_charges_amount" type="number" step="0.01" placeholder="Total cost">
                    </label>
                </div>
                <div id="stock-cost-loss-warnings" class="stock-cost-loss-warnings"></div>
            `;
        } else if (category === "imitation") {
            /* ── Imitation Expenses ── */
            expenseHtml = `
                <label>
                    <span>Total Expense</span>
                    <input name="other_expenses" id="field-other_expenses" type="number" step="0.01" placeholder="Total expense">
                </label>
            `;
            /* ── Imitation Cost ── */
            costHtml = `
                <label>
                    <span>Total Cost</span>
                    <input name="other_charges_amount" id="field-other_charges_amount" type="number" step="0.01" placeholder="Total cost">
                </label>
                <div id="stock-cost-loss-warnings" class="stock-cost-loss-warnings"></div>
            `;
        } else {
            /* ── Gold (default) ── */
            expenseHtml = renderFieldsHtml(["making_baseline", "goldsmith_loss", "stone_expense", "other_expenses"]);
            costHtml = renderFieldsHtml(["making_charges_percent", "stone_amount", "other_charges_amount"])
                + `<div id="stock-cost-loss-warnings" class="stock-cost-loss-warnings"></div>`;
        }

        const expenseIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;
        const costIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;

        /* Artisan Charges first, then Customer Cost */
        return formSection(expenseIcon, "Artisan Charges", expenseHtml, { id: "stock-expense-section" })
            + formSection(costIcon, "To Be Paid By Customer", costHtml, { id: "stock-cost-section" });
    }

    function rebuildStockItemDynamicSections(form) {
        if (!form) return;
        const hsnField = form.querySelector('[name="hsn_code"]');
        const category = detectOrnamentCategory(hsnField?.value);

        /* Preserve existing field values before rebuild */
        const savedValues = {};
        form.querySelectorAll("input[name], select[name], textarea[name]").forEach((el) => {
            savedValues[el.name] = el.type === "checkbox" ? el.checked : el.value;
        });

        /* ── Rebuild Physical Properties ── */
        const physicalSection = form.querySelector("#stock-physical-section");
        if (physicalSection) {
            const temp2 = document.createElement("div");
            temp2.innerHTML = buildStockItemPhysicalSection(category);
            const newPhysical = temp2.children[0];
            physicalSection.replaceWith(newPhysical);
        }

        /* ── Rebuild Cost & Expense ── */
        const expenseSection = form.querySelector("#stock-expense-section");
        const costSection = form.querySelector("#stock-cost-section");
        if (expenseSection && costSection) {
            const temp = document.createElement("div");
            temp.innerHTML = buildStockItemCostExpenseSections(category);
            /* Save references BEFORE moving — temp.children is a live collection */
            const newExpense = temp.children[0];
            const newCost = temp.children[1];
            expenseSection.replaceWith(newExpense);
            costSection.replaceWith(newCost);
        }

        /* Restore preserved values */
        Object.entries(savedValues).forEach(([name, val]) => {
            const el = form.querySelector(`[name="${name}"]`);
            if (el) {
                if (el.type === "checkbox") el.checked = val;
                else el.value = val;
            }
        });

        /* Re-initialize searchable selects & styled selects on rebuilt sections */
        initSearchableSelects(form);
        initStyledSelects(form);
        syncSearchableSelectDisplay(form);
        syncStyledSelectDisplays(form);

        /* Make making_baseline required only for gold */
        const baselineField = form.querySelector('[name="making_baseline"]');
        if (baselineField) baselineField.required = (category === "gold");

        const purityFieldForRequirement = form.querySelector('[name="purity"]');
        if (purityFieldForRequirement) purityFieldForRequirement.required = (category === "gold" || category === "silver");

        /* Make goldsmith_loss (Artisan Making) required only for gold */
        const artisanMakingField = form.querySelector('[name="goldsmith_loss"]');
        if (artisanMakingField) artisanMakingField.required = (category === "gold");

        const netWeightField = form.querySelector('[name="net_weight_g"]');
        if (netWeightField) netWeightField.required = (category === "gold" || category === "silver");

        /* gross_weight_g, stone_weight_g, stone_amount, other_charges_amount are NOT required */
        ["gross_weight_g", "stone_weight_g", "stone_amount", "other_charges_amount"].forEach((name) => {
            const el = form.querySelector(`[name="${name}"]`);
            if (el) el.required = false;
        });

        /* Filter purity options */
        filterStockItemPurityOptions(form, category);

        /* Re-sync baseline with current purity when category changes */
        maybeSyncStockItemBaseline(false);

        /* Re-wire purity → baseline listener after physical section rebuild */
        const purityField = form.querySelector('[name="purity"]');
        if (purityField && hsnField) {
            purityField.addEventListener("change", () => {
                const cat = detectOrnamentCategory(hsnField.value);
                if (cat === "gold") {
                    const bField = form.querySelector('[name="making_baseline"]');
                    if (bField) {
                        bField.value = stockItemDefaultBaseline(hsnField.value, purityField.value);
                        bField.dataset.manual = "false";
                    }
                }
            });
        }

        /* Wire up toggles */
        wireStockItemToggles(form);
    }

    function wireToggle(form, toggleId, leftRowId, rightRowId) {
        const toggle = form.querySelector(`#${toggleId}`);
        const leftRow = form.querySelector(`#${leftRowId}`);
        const rightRow = form.querySelector(`#${rightRowId}`);
        const leftSide = form.querySelector(`[data-toggle-side="left"][data-toggle-for="${toggleId}"]`);
        const rightSide = form.querySelector(`[data-toggle-side="right"][data-toggle-for="${toggleId}"]`);
        if (!toggle) return;

        const sync = () => {
            const isRight = toggle.checked;
            if (leftRow) leftRow.style.display = isRight ? "none" : "";
            if (rightRow) rightRow.style.display = isRight ? "" : "none";
            if (leftSide) leftSide.classList.toggle("active", !isRight);
            if (rightSide) rightSide.classList.toggle("active", isRight);
        };
        toggle.addEventListener("change", sync);
        sync();
    }

    function wireComputedTotal(form, perUnitInputName, weightFieldName, displayId) {
        const perUnitInput = form.querySelector(`[name="${perUnitInputName}"]`);
        const weightInput = form.querySelector(`[name="${weightFieldName}"]`);
        const display = form.querySelector(`#${displayId}`);
        if (!perUnitInput || !display) return;

        const compute = () => {
            const perUnit = toNumber(perUnitInput.value);
            const weight = weightInput ? toNumber(weightInput.value) : 0;
            const total = perUnit * weight;
            display.textContent = total ? `= ${formatCurrency(total)}` : "";
        };
        perUnitInput.addEventListener("input", compute);
        if (weightInput) weightInput.addEventListener("input", compute);
        compute();
    }

    function purityToDecimal(purityVal) {
        if (!purityVal) return null;
        const str = String(purityVal).trim().toUpperCase();
        const karatMatch = str.match(/^(\d+)K$/);
        if (karatMatch) return parseInt(karatMatch[1]) / 24;
        const numericMatch = str.match(/^(\d{3})$/);
        if (numericMatch) return parseInt(numericMatch[1]) / 1000;
        return null;
    }

    function ceilN(x, n) {
        const factor = Math.pow(10, n);
        return Math.ceil(x * factor) / factor;
    }

    function wireStockItemToggles(form) {
        if (!form) return;

        /* ── Silver toggles ── */
        wireToggle(form, "silver-cost-toggle", "silver-cost-per-gm-row", "silver-cost-total-row");
        wireToggle(form, "silver-expense-toggle", "silver-expense-per-gm-row", "silver-expense-total-row");
        wireComputedTotal(form, "silver_cost_price_per_gm", "net_weight_g", "silver-cost-total-display");
        wireComputedTotal(form, "silver_expense_price_per_gm", "net_weight_g", "silver-expense-total-display");

        /* ── Stone toggles ── */
        wireToggle(form, "stone-weight-toggle", "stone-weight-grams-row", "stone-weight-ratti-row");
        wireToggle(form, "stone-cost-toggle", "stone-cost-per-ratti-row", "stone-cost-total-row");
        wireToggle(form, "stone-expense-toggle", "stone-expense-per-ratti-row", "stone-expense-total-row");
        wireComputedTotal(form, "stone_cost_per_ratti", "weight_ratti", "stone-cost-total-display");
        wireComputedTotal(form, "stone_expense_per_ratti", "weight_ratti", "stone-expense-total-display");

        /* ── Stone: auto-toggle cost/expense based on weight unit ── */
        const stoneWeightToggle = form.querySelector("#stone-weight-toggle");
        const stoneCostToggle = form.querySelector("#stone-cost-toggle");
        const stoneExpenseToggle = form.querySelector("#stone-expense-toggle");
        if (stoneWeightToggle && (stoneCostToggle || stoneExpenseToggle)) {
            stoneWeightToggle.addEventListener("change", () => {
                const isRatti = stoneWeightToggle.checked;
                /* Grams → force cost/expense to Total; Ratti → force to Per Ratti */
                if (stoneCostToggle) {
                    stoneCostToggle.checked = !isRatti;
                    stoneCostToggle.dispatchEvent(new Event("change"));
                }
                if (stoneExpenseToggle) {
                    stoneExpenseToggle.checked = !isRatti;
                    stoneExpenseToggle.dispatchEvent(new Event("change"));
                }
            });
        }

        /* ── Re-wire gross/net → stone weight auto-calculation ── */
        const grossField = form.querySelector('[name="gross_weight_g"]');
        const netField = form.querySelector('[name="net_weight_g"]');
        const stoneField = form.querySelector('[name="stone_weight_g"]');
        if (stoneField) {
            stoneField.addEventListener("input", () => { stoneField.dataset.manual = "true"; });
        }
        [grossField, netField].filter(Boolean).forEach((input) => input.addEventListener("input", maybeSyncStockItemStoneWeight));

        /* ── Gold: breakeven making charges ── */
        const makingPercentField = form.querySelector('[name="making_charges_percent"]');
        if (makingPercentField) {
            const mcLabel = makingPercentField.closest("label");
            const mcLabelSpan = mcLabel?.querySelector("span");
            if (mcLabelSpan && !form.querySelector("#gold-breakeven-display")) {
                const bkSpan = document.createElement("span");
                bkSpan.className = "stock-inline-computed";
                bkSpan.id = "gold-breakeven-display";
                mcLabelSpan.appendChild(bkSpan);
            }

            const computeBreakeven = () => {
                const purityField = form.querySelector('[name="purity"]');
                const baselineField = form.querySelector('[name="making_baseline"]');
                const artisanMakingField = form.querySelector('[name="goldsmith_loss"]');
                const display = form.querySelector("#gold-breakeven-display");
                const purityDec = purityToDecimal(purityField?.value);
                const baseline = toNumber(baselineField?.value);
                const artisanMaking = toNumber(artisanMakingField?.value);
                if (!purityDec || !baseline || !artisanMaking) {
                    if (display) display.textContent = "";
                    form._goldBreakeven = null;
                    return;
                }
                const raw = ((baseline + artisanMaking / 100) / purityDec) - 1;
                const breakeven = ceilN(raw, 3) * 100;
                if (display) display.textContent = `Breakeven: ${breakeven.toFixed(1)}%`;
                /* Store for loss warning access */
                form._goldBreakeven = breakeven;
            };

            [form.querySelector('[name="purity"]'),
            form.querySelector('[name="making_baseline"]'),
            form.querySelector('[name="goldsmith_loss"]')
            ].filter(Boolean).forEach(el => el.addEventListener("input", computeBreakeven));

            /* Also re-compute when purity searchable select changes */
            const puritySelect = form.querySelector('[name="purity"]');
            if (puritySelect) puritySelect.addEventListener("change", computeBreakeven);

            computeBreakeven();
        }

        /* ── Loss warnings (debounced 1s) ── */
        let _lossWarnTimer = null;
        const debouncedLossWarn = () => {
            clearTimeout(_lossWarnTimer);
            _lossWarnTimer = setTimeout(() => updateStockLossWarnings(form), 1000);
        };
        form.addEventListener("input", debouncedLossWarn);
        form.querySelectorAll(".stock-toggle-checkbox").forEach(cb => {
            cb.addEventListener("change", () => { clearTimeout(_lossWarnTimer); setTimeout(() => updateStockLossWarnings(form), 0); });
        });
    }

    const warningSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

    function isFieldVisible(el) {
        if (!el) return false;
        let node = el.closest("div[id]");
        while (node) {
            if (node.style && node.style.display === "none") return false;
            node = node.parentElement;
        }
        return true;
    }

    function updateStockLossWarnings(form) {
        const container = form.querySelector("#stock-cost-loss-warnings");
        if (!container) return;

        const hsnField = form.querySelector('[name="hsn_code"]');
        const category = detectOrnamentCategory(hsnField?.value);

        const warnings = [];

        function checkPair(expenseName, costName, label) {
            const expenseEl = form.querySelector(`[name="${expenseName}"]`);
            const costEl = form.querySelector(`[name="${costName}"]`);
            if (!expenseEl || !costEl) return;
            if (!isFieldVisible(expenseEl) || !isFieldVisible(costEl)) return;
            const expense = toNumber(expenseEl.value);
            const cost = toNumber(costEl.value);
            if (expense > 0 && cost > 0 && expense > cost) {
                const diff = expense - cost;
                warnings.push(`You will be incurring a loss of ${formatCurrency(expense)} \u2212 ${formatCurrency(cost)} = <strong>${formatCurrency(diff)}</strong> ${label}`);
            }
        }

        if (category === "gold") {
            checkPair("stone_expense", "stone_amount", "in Stone charges");
            checkPair("other_expenses", "other_charges_amount", "in Other Charges");
            /* Breakeven making charges warning */
            const makingPctEl = form.querySelector('[name="making_charges_percent"]');
            const makingPct = toNumber(makingPctEl?.value);
            const breakeven = form._goldBreakeven;
            if (makingPct > 0 && breakeven > 0 && makingPct < breakeven) {
                warnings.push(`Making Charges ${makingPct}% is below breakeven ${breakeven.toFixed(1)}%, which will incur a loss`);
            }
        } else if (category === "silver") {
            checkPair("silver_expense_price_per_gm", "silver_cost_price_per_gm", "per gram");
            checkPair("other_expenses", "silver_cost_total_price", "in Total");
            checkPair("stone_expense", "stone_amount", "in Stone charges");
            checkPair("silver_other_expenses", "other_charges_amount", "in Other Charges");
        } else if (category === "stone") {
            checkPair("stone_expense_per_ratti", "stone_cost_per_ratti", "per ratti");
            checkPair("other_expenses", "other_charges_amount", "in Total");
        } else if (category === "imitation") {
            checkPair("other_expenses", "other_charges_amount", "in Total");
        }

        container.innerHTML = warnings.map(w =>
            `<div class="stock-loss-warning">${warningSvg}<span>${w}</span></div>`
        ).join("");
    }

    const identityIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`;
    const physicalIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18"/><path d="M8 7l4-4 4 4"/><path d="M8 17l4 4 4-4"/></svg>`;
    const statusIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

    /* Detect initial category from row or default */
    const initialCategory = detectOrnamentCategory(row?.hsn_code);

    openAppModal({
        size: "modal-sm",
        kicker: "Stock Item",
        title: isEdit ? `Edit ${escapeHtml(row.stock_no || "Stock Item")}` : "New Stock Item",
        tabs: [
            {
                label: "Details",
                html: `<div class="entity-modal-section">
                    <div class="entity-modal-section-header">
                        <span class="entity-modal-section-icon">${identityIcon}</span>
                        <span class="entity-modal-section-title">${isEdit ? "Edit" : "Create"} Stock Item</span>
                    </div>
                    <form id="entity-modal-form" class="entity-modal-form" data-entity-form="stock-items">
                        <input type="hidden" name="id">
                        <input type="hidden" name="stone_dust_deduction_g" value="${escapeHtml(String(row?.stone_dust_deduction_g ?? 0))}">
                        <input type="hidden" name="artisan_ids" id="stock-item-artisan-ids">
                        <div class="stock-form-sections">
                            ${formSection(identityIcon, "Item Identity", renderFieldsHtml(identityNames))}
                            ${buildStockItemPhysicalSection(initialCategory)}
                            ${buildStockItemCostExpenseSections(initialCategory)}
                            ${formSection(statusIcon, "Status & Notes", renderFieldsHtml(statusNames))}
                        </div>
                    </form>
                </div>`,
            },
            {
                label: "Artisans",
                html: `<div class="entity-modal-section">
                    <div class="entity-modal-section-header">
                        <span class="entity-modal-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
                        <span class="entity-modal-section-title">Linked Artisans</span>
                    </div>
                    <div style="padding: 4px 18px 18px; display:grid; gap:16px;">
                        <div class="stock-form-group">
                            <div class="stock-form-group-header">
                                <span class="stock-form-group-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
                                <span class="stock-form-group-title">Search & Link Artisan</span>
                            </div>
                            <div class="stock-form-group-fields">
                                <div class="field-grid">
                                    <label class="full">
                                        <span>Find Artisan</span>
                                        <input type="text" id="stock-item-artisan-search-input" placeholder="Type artisan name or description to search…">
                                    </label>
                                </div>
                                <p class="stock-item-artisan-helper" style="margin-top:8px;">Only existing artisans can be linked. If you need a new artisan, create it first from the <strong>Artisans</strong> master page.</p>
                                <div id="stock-item-artisan-search-results"></div>
                            </div>
                        </div>
                        <div id="stock-item-artisan-selected-list"></div>
                    </div>
                </div>`,
            },
        ],
        footerHtml: `
            <div class="stock-item-footer-shell">
                    <div class="stock-item-progress">
                        <div class="stock-item-progress-head">
                            <span class="label" id="stock-item-progress-step">Step 1 of 2</span>
                            <span class="stock-item-progress-caption" id="stock-item-progress-caption">${isEdit ? "Review stock details before updating optional artisan links." : "Enter ornament details before reviewing optional artisan links."}</span>
                        </div>
                        <div class="stock-item-progress-bar"><span id="stock-item-progress-fill"></span></div>
                    </div>
                <div class="stock-item-footer-actions">
                    ${backFn ? `<button type="button" class="ghost-action compact-action" id="entity-modal-back">Back</button>` : ""}
                    <button type="button" class="ghost-action compact-action" id="stock-item-prev-step" hidden>Back to Details</button>
                    <button type="button" class="primary-action" id="entity-modal-save">Continue to Artisans</button>
                </div>
            </div>
        `,
        onTabChange: (index) => updateStockItemModalStep(index),
        onOpen: () => {
            const form = document.getElementById("entity-modal-form");
            if (form) form.dataset.editing = String(isEdit);
            const saveButton = document.getElementById("entity-modal-save");
            const prevStepButton = document.getElementById("stock-item-prev-step");
            document.getElementById("entity-modal-back")?.addEventListener("click", () => {
                closeAppModal();
                backFn?.();
            });
            prevStepButton?.addEventListener("click", () => {
                switchModalTab(0);
            });
            saveButton?.addEventListener("click", async () => {
                const currentStep = appModalContainer._stockItemFormState?.currentStep || 0;
                if (currentStep === 0) {
                    if (!form) {
                        showToast("Stock item form is unavailable.", true);
                        return;
                    }
                    if (!form.reportValidity()) return;
                    switchModalTab(1);
                    document.getElementById("stock-item-artisan-search-input")?.focus();
                    return;
                }
                await submitStockItemModalForm(form, saveButton);
            });
            try {
                initSearchableSelects(appModalBody);
                initStyledSelects(appModalBody);
                if (row) {
                    setFormValues("stock-items", row, form);
                }
                syncSearchableSelectDisplay(appModalBody);
                syncStyledSelectDisplays(appModalBody);
                const quantityField = form?.querySelector('[name="quantity"]');
                const stoneAmountField = form?.querySelector('[name="stone_amount"]');
                const otherChargesField = form?.querySelector('[name="other_charges_amount"]');
                const statusField = form?.querySelector('[name="status"]');
                if (!row) {
                    if (quantityField && !quantityField.value) quantityField.value = "1";
                    if (stoneAmountField && !stoneAmountField.value) stoneAmountField.value = "0";
                    if (otherChargesField && !otherChargesField.value) otherChargesField.value = "0";
                    if (statusField && !statusField.value) statusField.value = "in_stock";
                }
                maybeSyncStockItemBaseline(!row);
                maybeSyncStockItemStoneWeight();
                renderStockItemSelectedArtisans();
                updateStockItemModalStep(0);
                const grossField = form?.querySelector('[name="gross_weight_g"]');
                const netField = form?.querySelector('[name="net_weight_g"]');
                const stoneField = form?.querySelector('[name="stone_weight_g"]');
                const hsnField = form?.querySelector('[name="hsn_code"]');
                if (stoneField) {
                    stoneField.addEventListener("input", () => {
                        stoneField.dataset.manual = "true";
                    });
                }
                [grossField, netField].filter(Boolean).forEach((input) => input.addEventListener("input", maybeSyncStockItemStoneWeight));

                /* ── Make making_baseline required only for gold ── */
                const currentCategory = detectOrnamentCategory(hsnField?.value);
                const baselineField = form?.querySelector('[name="making_baseline"]');
                if (baselineField) {
                    baselineField.required = (currentCategory === "gold");
                    baselineField.addEventListener("input", () => {
                        baselineField.dataset.manual = "true";
                    });
                }

                const purityRequiredField = form?.querySelector('[name="purity"]');
                if (purityRequiredField) {
                    purityRequiredField.required = (currentCategory === "gold" || currentCategory === "silver");
                }

                /* ── Make goldsmith_loss (Artisan Making) required only for gold ── */
                const artisanMakingField = form?.querySelector('[name="goldsmith_loss"]');
                if (artisanMakingField) {
                    artisanMakingField.required = (currentCategory === "gold");
                }

                const netWeightRequiredField = form?.querySelector('[name="net_weight_g"]');
                if (netWeightRequiredField) {
                    netWeightRequiredField.required = (currentCategory === "gold" || currentCategory === "silver");
                }

                /* ── gross_weight_g, stone_weight_g, stone_amount, other_charges_amount are NOT required ── */
                ["gross_weight_g", "stone_weight_g", "stone_amount", "other_charges_amount"].forEach((name) => {
                    const el = form?.querySelector(`[name="${name}"]`);
                    if (el) el.required = false;
                });

                /* ── Filter purity options on initial load ── */
                filterStockItemPurityOptions(form, currentCategory);

                /* ── Purity change: update making baseline for gold ── */
                const purityField = form?.querySelector('[name="purity"]');
                if (purityField) {
                    const syncBaselineOnPurityChange = () => {
                        const cat = detectOrnamentCategory(hsnField?.value);
                        if (cat === "gold") {
                            const bField = form?.querySelector('[name="making_baseline"]');
                            if (bField) {
                                bField.value = stockItemDefaultBaseline(hsnField?.value, purityField.value);
                                bField.dataset.manual = "false";
                            }
                        }
                    };
                    purityField.addEventListener("change", syncBaselineOnPurityChange);
                }

                /* ── HSN change: rebuild all dynamic sections ── */
                if (hsnField) {
                    hsnField.addEventListener("change", () => {
                        maybeSyncStockItemBaseline(false);
                        rebuildStockItemDynamicSections(form);
                        /* Re-restore values for fields that survive across categories */
                        if (row) {
                            const fieldsToRestore = ["goldsmith_loss", "stone_expense", "other_expenses", "stone_amount", "other_charges_amount", "making_charges_percent", "making_baseline", "gross_weight_g", "weight_ratti", "silver_expense_price_per_gm", "silver_cost_price_per_gm", "silver_cost_total_price", "silver_other_expenses", "stone_expense_per_ratti", "stone_cost_per_ratti"];
                            fieldsToRestore.forEach((name) => {
                                const el = form.querySelector(`[name="${name}"]`);
                                if (el && row[name] != null) el.value = row[name];
                            });
                        }
                    });
                }

                /* ── Wire up toggles for initial category ── */
                wireStockItemToggles(form);

                const artisanSearchInput = document.getElementById("stock-item-artisan-search-input");
                if (artisanSearchInput) {
                    artisanSearchInput.addEventListener("input", () => {
                        window.clearTimeout(artisanSearchInput._timer);
                        artisanSearchInput._timer = window.setTimeout(() => fetchStockItemArtisanSuggestions(artisanSearchInput.value), 220);
                    });
                }
                syncStyledSelectDisplays(appModalBody);
            } catch (error) {
                console.error("Failed to initialize stock item modal", error);
                showToast(error.message || "Failed to initialize stock item form.", true);
            }
        },
    });
}


async function openStockItemDetailModal(recordId) {
    const entity = getEntity("stock-items");
    const row = findRow("stock-items", recordId);
    if (!entity || !row) return;

    const fieldMap = Object.fromEntries(entity.fields.map((field) => [field.name, field]));
    const arrowIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
    const emptyIcon = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`;
    const editIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
    const deleteIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    const boxIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`;

    function detailItem(key, value) {
        const field = fieldMap[key] || { label: key.replaceAll("_", " ") };
        return `<div class="modal-detail-item"><span class="modal-detail-label">${escapeHtml(field.label)}</span><div class="modal-detail-value">${renderDetailValue(field, value)}</div></div>`;
    }

    function staticDetailItem(label, value) {
        return `<div class="modal-detail-item"><span class="modal-detail-label">${escapeHtml(label)}</span><div class="modal-detail-value">${escapeHtml(value ?? "--")}</div></div>`;
    }

    function formatDecimal(value, digits = 3, suffix = "") {
        const numberValue = toNumber(value);
        if (!Number.isFinite(numberValue)) return "--";
        return `${numberValue.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
    }

    function extractKarat(value) {
        const text = String(value || "").trim().toUpperCase();
        if (!text) return 0;
        if (text.endsWith("K")) return toNumber(text.slice(0, -1));
        const purityMap = { "999": 24, "916": 22, "750": 18, "585": 14, "375": 9 };
        return purityMap[text] || 0;
    }

    function maybeGoldBaselineMakingCharges(item) {
        const purityKarat = extractKarat(item.purity);
        const baseline = toNumber(item.making_baseline);
        const goldsmithLoss = toNumber(item.goldsmith_loss);
        if (!purityKarat || !baseline) return null;
        return (((baseline + goldsmithLoss / 100) / (purityKarat / 24)) - 1) * 100;
    }

    function maybeGoldPaymentWeight(item) {
        const netWeight = toNumber(item.net_weight_g);
        const baseline = toNumber(item.making_baseline);
        const goldsmithLoss = toNumber(item.goldsmith_loss);
        if (!netWeight || !baseline) return null;
        return (baseline + goldsmithLoss / 100) * netWeight;
    }

    function mathText(text) {
        return `<span class="math-text">${escapeHtml(text)}</span>`;
    }

    function mathOp(text) {
        return `<span class="math-op">${escapeHtml(text)}</span>`;
    }

    function mathGroup(html, className = "") {
        return `<span class="math-group ${className}">${html}</span>`;
    }

    function mathFraction(numeratorHtml, denominatorHtml) {
        return `<span class="math-frac">
            <span class="math-frac-num">${numeratorHtml}</span>
            <span class="math-frac-den">${denominatorHtml}</span>
        </span>`;
    }

    function mathEquation(parts) {
        return `<div class="math-equation">${parts.join("")}</div>`;
    }

    function formulaDisclosure(title, formulas) {
        const rows = formulas.map(({ label, html }) => `
            <div class="stock-formula-row">
                <span class="stock-formula-label">${escapeHtml(label)}</span>
                <div class="stock-math-card">${html}</div>
            </div>
        `).join("");
        return `<details class="stock-formula-disclosure">
            <summary>${escapeHtml(title)}</summary>
            <div class="stock-formula-body">${rows}</div>
        </details>`;
    }

    function detailItems(keys) {
        return keys.map((key) => detailItem(key, row[key])).join("");
    }

    function sectionGroup(iconSvg, title, fieldsHtml) {
        return `<div class="stock-detail-group">
            <div class="stock-detail-group-header">
                <span class="stock-detail-group-icon">${iconSvg}</span>
                <span class="stock-detail-group-title">${escapeHtml(title)}</span>
            </div>
            <div class="modal-detail-grid">${fieldsHtml}</div>
        </div>`;
    }

    const identityIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const physicalIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18"/><path d="M8 7l4-4 4 4"/><path d="M8 17l4 4 4-4"/></svg>`;
    const costIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
    const profitIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>`;
    const statusIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const category = detectOrnamentCategory(row.hsn_code);
    const physicalKeys = category === "stone"
        ? ["quantity", "weight_entry_unit", "weight_ratti", "gross_weight_g"]
        : category === "imitation"
            ? ["quantity"]
            : ["purity", "quantity", "gross_weight_g", "net_weight_g", "stone_weight_g"];
    /* ===== COST FLOW SECTION: Expenses Incurred vs Charged to Customer ===== */
    const cfExpenseIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;
    const cfChargeIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;

    function cfCell(side, label, value) {
        return `<div class="stock-costflow-cell ${side}">
            <span class="stock-costflow-cell-label">${escapeHtml(label)}</span>
            <span class="stock-costflow-cell-value">${escapeHtml(String(value ?? "--"))}</span>
        </div>`;
    }

    function cfCellWithSub(side, label, perUnitValue, perUnitSuffix, totalValue) {
        const perUnit = toNumber(perUnitValue);
        const total = toNumber(totalValue);
        const perUnitStr = perUnit ? `${formatCurrency(perUnit)}${escapeHtml(perUnitSuffix)}` : "--";
        const totalStr = total ? `(${formatCurrency(total)})` : "";
        return `<div class="stock-costflow-cell ${side}">
            <span class="stock-costflow-cell-label">${escapeHtml(label)}</span>
            <span class="stock-costflow-cell-value">${perUnitStr}${totalStr ? ` <span class="costflow-sub">${totalStr}</span>` : ""}</span>
        </div>`;
    }

    function cfRow(expenseCell, costCell) {
        return `<div class="stock-costflow-row">${expenseCell}${costCell}</div>`;
    }

    function cfBannerChip(label, value) {
        return `<div class="stock-costflow-banner-chip">
            <span class="stock-costflow-banner-label">${escapeHtml(label)}</span>
            <span class="stock-costflow-banner-value">${escapeHtml(String(value ?? "--"))}</span>
        </div>`;
    }

    function cfBanner(chips) {
        if (!chips.length) return "";
        return `<div class="stock-costflow-banner">${chips.join("")}</div>`;
    }

    function cfColumnHeaders() {
        return `<div class="stock-costflow-headers">
            <div class="stock-costflow-header outflow">
                <span class="stock-costflow-header-icon">${cfExpenseIcon}</span>
                <span class="stock-costflow-header-title">Expenses Incurred</span>
            </div>
            <div class="stock-costflow-header inflow">
                <span class="stock-costflow-header-icon">${cfChargeIcon}</span>
                <span class="stock-costflow-header-title">Charged to Customer</span>
            </div>
        </div>`;
    }

    function cfTotalRow(expTotal, chargeTotal) {
        return `<div class="stock-costflow-total-row">
            <div class="stock-costflow-total-cell outflow">
                <span class="stock-costflow-total-label">Total Expenses</span>
                <span class="stock-costflow-total-value">${expTotal != null ? formatCurrency(expTotal) : "--"}</span>
            </div>
            <div class="stock-costflow-total-cell inflow">
                <span class="stock-costflow-total-label">Total Charges</span>
                <span class="stock-costflow-total-value">${chargeTotal != null ? formatCurrency(chargeTotal) : "--"}</span>
            </div>
        </div>`;
    }

    function cfWeightChip(label, value, chipType) {
        const typeClass = chipType ? `${chipType}-chip` : "expense-chip";
        return `<span class="stock-costflow-wt-chip ${typeClass}"><span class="stock-costflow-wt-chip-label">${escapeHtml(label)}</span><span class="stock-costflow-wt-chip-value">${escapeHtml(value)}</span></span>`;
    }

    function cfWeightOp(op) {
        return `<span class="stock-costflow-wt-op">${escapeHtml(op)}</span>`;
    }

    function buildComparisonSection() {
        let bannerHtml = "";
        let rowsHtml = "";
        let totalHtml = "";
        let breakupHtml = "";

        if (category === "silver") {
            /* Banner: Artisan Payment % */
            bannerHtml = cfBanner([
                cfBannerChip("Artisan Payment %", row.goldsmith_loss != null ? `${row.goldsmith_loss}%` : "--"),
            ]);

            /* Row 1: Expense/gm (Total) vs Cost/gm (Total) */
            const netWeight = toNumber(row.net_weight_g);
            const expPerGm = toNumber(row.silver_expense_price_per_gm);
            const costPerGm = toNumber(row.silver_cost_price_per_gm);
            const expTotal = toNumber(row.other_expenses) || (expPerGm * netWeight);
            const costTotal = toNumber(row.silver_cost_total_price) || (costPerGm * netWeight);
            const isExpTotalMode = row.silver_expense_entry_mode === "total";
            const isCostTotalMode = row.silver_cost_entry_mode === "total";

            if (isExpTotalMode) {
                rowsHtml += cfRow(
                    cfCell("outflow", "Total Expense", expTotal ? formatCurrency(expTotal) : "--"),
                    isCostTotalMode
                        ? cfCell("inflow", "Total Cost", costTotal ? formatCurrency(costTotal) : "--")
                        : cfCellWithSub("inflow", "Cost / gm", row.silver_cost_price_per_gm, " /gm", costTotal)
                );
            } else if (isCostTotalMode) {
                rowsHtml += cfRow(
                    cfCellWithSub("outflow", "Expense / gm", row.silver_expense_price_per_gm, " /gm", expTotal),
                    cfCell("inflow", "Total Cost", costTotal ? formatCurrency(costTotal) : "--")
                );
            } else {
                rowsHtml += cfRow(
                    cfCellWithSub("outflow", "Expense / gm", row.silver_expense_price_per_gm, " /gm", expTotal),
                    cfCellWithSub("inflow", "Cost / gm", row.silver_cost_price_per_gm, " /gm", costTotal)
                );
            }

            /* Row 2: Stone Expense vs Stone Cost */
            const stoneExp = toNumber(row.stone_expense);
            const stoneCost = toNumber(row.stone_amount);
            rowsHtml += cfRow(
                cfCell("outflow", "Stone Expense", row.stone_expense != null && row.stone_expense !== "" ? formatCurrency(row.stone_expense) : "--"),
                cfCell("inflow", "Stone Cost", row.stone_amount != null && row.stone_amount !== "" ? formatCurrency(row.stone_amount) : "--")
            );

            /* Row 3: Other Expenses vs Other Cost */
            const otherExp = toNumber(row.silver_other_expenses);
            const otherCost = toNumber(row.other_charges_amount);
            rowsHtml += cfRow(
                cfCell("outflow", "Other Expenses", row.silver_other_expenses != null && row.silver_other_expenses !== "" ? formatCurrency(row.silver_other_expenses) : "--"),
                cfCell("inflow", "Other Cost", row.other_charges_amount != null && row.other_charges_amount !== "" ? formatCurrency(row.other_charges_amount) : "--")
            );

            /* Total row */
            const sumExp = expTotal + stoneExp + otherExp;
            const sumCharge = costTotal + stoneCost + otherCost;
            totalHtml = cfTotalRow(sumExp || null, sumCharge || null);

        } else if (category === "gold") {
            /* Banner: Making Baseline */
            bannerHtml = cfBanner([
                cfBannerChip("Making Baseline", row.making_baseline ?? "--"),
            ]);

            /* Row 1: Artisan Making vs Making Charges % */
            rowsHtml += cfRow(
                cfCell("outflow", "Artisan Making %", row.goldsmith_loss != null && row.goldsmith_loss !== "" ? `${row.goldsmith_loss}%` : "--"),
                cfCell("inflow", "Making Charges %", row.making_charges_percent != null && row.making_charges_percent !== "" ? `${row.making_charges_percent}%` : "--")
            );

            /* Row 2: Stone Expense vs Stone Amount */
            const stoneExp = toNumber(row.stone_expense);
            const stoneCharge = toNumber(row.stone_amount);
            rowsHtml += cfRow(
                cfCell("outflow", "Stone Expense", row.stone_expense != null && row.stone_expense !== "" ? formatCurrency(row.stone_expense) : "--"),
                cfCell("inflow", "Stone Amount", row.stone_amount != null && row.stone_amount !== "" ? formatCurrency(row.stone_amount) : "--")
            );

            /* Row 3: Other Expenses vs Other Charges */
            const otherExp = toNumber(row.other_expenses);
            const otherCharge = toNumber(row.other_charges_amount);
            rowsHtml += cfRow(
                cfCell("outflow", "Other Expenses", row.other_expenses != null && row.other_expenses !== "" ? formatCurrency(row.other_expenses) : "--"),
                cfCell("inflow", "Other Charges", row.other_charges_amount != null && row.other_charges_amount !== "" ? formatCurrency(row.other_charges_amount) : "--")
            );

            /* Row 4: Payment Weight vs Weight Recouped */
            const netWeight = toNumber(row.net_weight_g);
            const purityKarat = extractKarat(row.purity);
            const baseline = toNumber(row.making_baseline);
            const goldsmithLoss = toNumber(row.goldsmith_loss);
            const makingPercent = toNumber(row.making_charges_percent);
            const paymentWeight = (netWeight && baseline) ? (baseline + goldsmithLoss / 100) * netWeight : null;
            const weightRecouped = (netWeight && purityKarat && makingPercent) ? (purityKarat / 24) * (1 + makingPercent / 100) * netWeight : null;
            rowsHtml += cfRow(
                cfCell("outflow", "Payment Weight", paymentWeight != null ? formatDecimal(paymentWeight, 3, " g") : "--"),
                cfCell("inflow", "Weight Recouped", weightRecouped != null ? formatDecimal(weightRecouped, 3, " g") : "--")
            );

            /* Total row (only monetary rows: stone + other) */
            const sumExp = stoneExp + otherExp;
            const sumCharge = stoneCharge + otherCharge;
            totalHtml = cfTotalRow(sumExp || null, sumCharge || null);

            /* Weight breakup equation (24K) */
            if (paymentWeight != null && weightRecouped != null) {
                const pureWeight = netWeight * (purityKarat / 24);
                const makingWeight = paymentWeight - pureWeight;
                const profitWeight = weightRecouped - paymentWeight;
                const fmt = (v) => formatDecimal(v, 3, " g");
                breakupHtml = `<div class="stock-costflow-weight-breakup">
                    <div class="stock-costflow-weight-breakup-title">Weight Breakup <span class="wt-badge-24k">24K</span></div>
                    <div class="stock-costflow-weight-equation">
                        ${cfWeightChip("Pure", fmt(pureWeight), "expense")}
                        ${cfWeightOp("+")}
                        ${cfWeightChip("Making", fmt(makingWeight), "expense")}
                        ${cfWeightOp("=")}
                        ${cfWeightChip("Payment", fmt(paymentWeight), "expense")}
                        ${cfWeightOp("+")}
                        ${cfWeightChip("Profit", fmt(profitWeight), "profit")}
                        ${cfWeightOp("=")}
                        ${cfWeightChip("Recouped", fmt(weightRecouped), "result")}
                    </div>
                </div>`;
            }

        } else if (category === "stone") {
            /* No banner for gemstones */
            const expPerRatti = toNumber(row.stone_expense_per_ratti);
            const costPerRatti = toNumber(row.stone_cost_per_ratti);
            const rattiWeight = toNumber(row.weight_ratti);
            const expTotal = toNumber(row.other_expenses) || (expPerRatti * rattiWeight);
            const costTotal = toNumber(row.other_charges_amount) || (costPerRatti * rattiWeight);
            const isExpTotalMode = row.stone_expense_entry_mode === "total";
            const isCostTotalMode = row.stone_cost_entry_mode === "total";

            if (isExpTotalMode && isCostTotalMode) {
                rowsHtml += cfRow(
                    cfCell("outflow", "Total Expense", expTotal ? formatCurrency(expTotal) : "--"),
                    cfCell("inflow", "Total Cost", costTotal ? formatCurrency(costTotal) : "--")
                );
            } else if (isExpTotalMode) {
                rowsHtml += cfRow(
                    cfCell("outflow", "Total Expense", expTotal ? formatCurrency(expTotal) : "--"),
                    cfCellWithSub("inflow", "Stone Cost / Ratti", row.stone_cost_per_ratti, " /ratti", costTotal)
                );
            } else if (isCostTotalMode) {
                rowsHtml += cfRow(
                    cfCellWithSub("outflow", "Stone Expense / Ratti", row.stone_expense_per_ratti, " /ratti", expTotal),
                    cfCell("inflow", "Total Cost", costTotal ? formatCurrency(costTotal) : "--")
                );
            } else {
                rowsHtml += cfRow(
                    cfCellWithSub("outflow", "Stone Expense / Ratti", row.stone_expense_per_ratti, " /ratti", expTotal),
                    cfCellWithSub("inflow", "Stone Cost / Ratti", row.stone_cost_per_ratti, " /ratti", costTotal)
                );
            }
            /* Single row — total would be redundant, skip it */

        } else if (category === "imitation") {
            /* No banner for imitation */
            rowsHtml += cfRow(
                cfCell("outflow", "Total Expense", row.other_expenses != null && row.other_expenses !== "" ? formatCurrency(row.other_expenses) : "--"),
                cfCell("inflow", "Total Cost", row.other_charges_amount != null && row.other_charges_amount !== "" ? formatCurrency(row.other_charges_amount) : "--")
            );
            /* Single row — total would be redundant, skip it */
        }

        return `<div class="stock-costflow-section">
            ${bannerHtml}
            ${cfColumnHeaders()}
            ${rowsHtml}
            ${totalHtml}
            ${breakupHtml}
        </div>`;
    }

    const comparisonHtml = buildComparisonSection();
    const heroStats = category === "stone"
        ? [
            ["Weight", row.weight_entry_unit === "ratti" ? `${row.weight_ratti ?? "--"} ratti` : `${row.gross_weight_g ?? "--"} g`],
            ["Qty", row.quantity ?? "--"],
            ["HSN", row.hsn_code || "--"],
        ]
        : category === "imitation"
            ? [["Qty", row.quantity ?? "--"], ["HSN", row.hsn_code || "--"], ["Status", row.status || "--"]]
            : [["Purity", row.purity || "--"], ["Gross Wt", `${row.gross_weight_g ?? "--"} g`], ["Net Wt", `${row.net_weight_g ?? "--"} g`], ["Qty", row.quantity ?? "--"]];

    const heroHtml = `<div class="stock-detail-hero">
        <div class="stock-detail-hero-icon">${boxIcon}</div>
        <div class="stock-detail-hero-body">
            <h4 class="stock-detail-hero-title">${escapeHtml(row.description || "Stock Item")}</h4>
            <p class="stock-detail-hero-subtitle">
                <span>${escapeHtml(row.stock_no || "--")}</span>
                ${row.huid ? `<span class="hero-sep">·</span><span>${escapeHtml(row.huid)}</span>` : ""}
                <span class="hero-sep">·</span>
                ${badge(row.status)}
            </p>
            <div class="stock-detail-hero-stats">
                ${heroStats.map(([label, value]) => `<div class="stock-detail-hero-stat"><span class="stat-label">${escapeHtml(label)}</span><span class="stat-value">${escapeHtml(value)}</span></div>`).join("")}
            </div>
        </div>
    </div>`;

    const identityHtml = sectionGroup(identityIcon, "Identity", [
        detailItem("stock_no", row.stock_no),
        detailItem("huid", row.huid),
        detailItem("description", row.description),
        detailItem("hsn_code", row.hsn_code),
        detailItem("ornament_type", row.ornament_type),
    ].join(""));

    const physicalHtml = sectionGroup(physicalIcon, "Physical Properties", detailItems(physicalKeys));

    const goldBaselineMakingCharges = category === "gold" ? maybeGoldBaselineMakingCharges(row) : null;
    const goldPaymentWeight = category === "gold" ? maybeGoldPaymentWeight(row) : null;
    const formulaHtml = category === "silver"
        ? formulaDisclosure("View formula", [
            {
                label: "Profit",
                html: mathEquation([
                    mathText("profit"), mathOp("="),
                    mathGroup(`${mathText("customer silver cost")}${mathOp("-")}${mathText("artisan silver expense")}`, "math-paren"),
                    mathOp("+"),
                    mathGroup(`${mathText("stone amount")}${mathOp("-")}${mathText("stone expense")}`, "math-paren"),
                    mathOp("+"),
                    mathGroup(`${mathText("other charges")}${mathOp("-")}${mathText("other expenses")}`, "math-paren"),
                ]),
            },
        ])
        : category === "stone"
            ? formulaDisclosure("View formula", [
                {
                    label: "Profit",
                    html: mathEquation([
                        mathText("profit"), mathOp("="),
                        mathGroup(`${mathText("cost per ratti")}${mathOp("-")}${mathText("expense per ratti")}`, "math-paren"),
                        mathOp("×"),
                        mathText("ratti"),
                    ]),
                },
                {
                    label: "Fallback",
                    html: mathEquation([mathText("profit"), mathOp("="), mathText("total cost"), mathOp("-"), mathText("total expense")]),
                },
            ])
            : category === "imitation"
                ? formulaDisclosure("View formula", [
                    {
                        label: "Profit",
                        html: mathEquation([mathText("profit"), mathOp("="), mathText("total cost"), mathOp("-"), mathText("total expense")]),
                    },
                ])
                : formulaDisclosure("View formulas", [
                    {
                        label: "Total weight recouped",
                        html: mathEquation([
                            mathText("total weight recouped"), mathOp("="), mathText("net weight"), mathOp("×"),
                            mathGroup([
                                mathFraction(mathText("purity"), mathText("24")),
                                mathOp("×"),
                                mathGroup(`${mathText("1")}${mathOp("+")}${mathFraction(mathText("making %"), mathText("100"))}`, "math-paren"),
                                mathOp("-"),
                                mathGroup(`${mathText("making baseline")}${mathOp("+")}${mathFraction(mathText("goldsmith loss"), mathText("100"))}`, "math-paren"),
                            ].join(""), "math-bracket"),
                        ]),
                    },
                    {
                        label: "Cash profit",
                        html: mathEquation([
                            mathText("profit cash amount"), mathOp("="),
                            mathGroup(`${mathText("stone amount")}${mathOp("-")}${mathText("stone expense")}`, "math-paren"),
                            mathOp("+"),
                            mathGroup(`${mathText("other charges")}${mathOp("-")}${mathText("other expenses")}`, "math-paren"),
                        ]),
                    },
                    {
                        label: "Baseline making charges",
                        html: mathEquation([
                            mathText("baseline making charges"), mathOp("="),
                            mathGroup([
                                mathFraction(
                                    mathGroup(`${mathText("making baseline")}${mathOp("+")}${mathFraction(mathText("goldsmith loss"), mathText("100"))}`),
                                    mathFraction(mathText("purity"), mathText("24")),
                                ),
                                mathOp("-"),
                                mathText("1"),
                            ].join(""), "math-bracket"),
                            mathOp("×"),
                            mathText("100"),
                        ]),
                    },
                    {
                        label: "Payment weight",
                        html: mathEquation([
                            mathText("payment weight"), mathOp("="),
                            mathGroup(`${mathText("making baseline")}${mathOp("+")}${mathFraction(mathText("goldsmith loss"), mathText("100"))}`, "math-paren"),
                            mathOp("×"),
                            mathText("net weight"),
                        ]),
                    },
                ]);
    const profitItems = [
        detailItem("profit_cash_amount", row.profit_cash_amount == null ? "Pending until invoice" : row.profit_cash_amount),
    ];
    if (category === "gold") {
        profitItems.push(detailItem("profit_excess_weight_g", row.profit_excess_weight_g == null ? "Pending until invoice" : row.profit_excess_weight_g));
        profitItems.push(staticDetailItem("baseline_making_charges", goldBaselineMakingCharges == null ? "--" : formatDecimal(goldBaselineMakingCharges, 2, "%")));
        profitItems.push(staticDetailItem("payment_weight", goldPaymentWeight == null ? "--" : formatDecimal(goldPaymentWeight, 3, " g")));
    }
    profitItems.push(detailItem("profit_calculated_at", row.profit_calculated_at == null ? "Pending until invoice" : row.profit_calculated_at));
    const profitHtml = sectionGroup(profitIcon, "Profit Analysis", profitItems.join("") + formulaHtml);

    const statusHtml = sectionGroup(statusIcon, "Status & Notes", [
        detailItem("status", row.status),
        detailItem("notes", row.notes),
    ].join(""));

    const detailHtml = `<div class="entity-modal-section">
        <div class="entity-modal-section-header">
            <span class="entity-modal-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></span>
            <span class="entity-modal-section-title">Stock Item Details</span>
        </div>
        <div style="padding: 4px 18px 18px;">
            ${heroHtml}
            ${identityHtml}
            ${physicalHtml}
            ${comparisonHtml}
            ${profitHtml}
            ${statusHtml}
        </div>
    </div>`;

    const loadingHtml = `<div class="customer-loading"><div class="spinner"></div>Loading linked records…</div>`;

    const huidLabel = row.huid ? ` · ${row.huid}` : "";
    openAppModal({
        kicker: "Stock Item",
        title: `${row.stock_no || "Stock"}${huidLabel} · ${row.description || "--"}`,
        tabs: [
            { label: "Details", html: detailHtml },
            { label: "Artisans", html: loadingHtml },
            { label: "Movements", html: loadingHtml },
            { label: "Documents", html: loadingHtml },
        ],
        footerHtml: `
            <button type="button" class="secondary-action compact-action" id="stock-item-modal-edit">${editIcon} Edit</button>
            <button type="button" class="ghost-action compact-action entity-modal-delete-btn" id="stock-item-modal-delete">${deleteIcon} Delete</button>
        `,
        onOpen: () => {
            document.getElementById("stock-item-modal-edit")?.addEventListener("click", () => {
                closeAppModal();
                openStockItemFormModal(row, () => openStockItemDetailModal(recordId));
            });
            document.getElementById("stock-item-modal-delete")?.addEventListener("click", () => {
                closeAppModal();
                openEntityDeleteConfirmModal("stock-items", recordId);
            });
        },
    });

    /* Fetch related data asynchronously */
    try {
        const related = await requestJson(`/api/admin/stock-items/related?id=${encodeURIComponent(recordId)}`);
        const artisans = related.artisans || [];
        const movements = related.movements || [];
        const orderItems = related.order_items || [];
        const invoiceItems = related.invoice_items || [];
        const paymentBadgesHtml = renderStockItemPaymentBadges(row);
        const tabPanels = appModalContainer.querySelectorAll(".modal-tab-panel");
        const tabBtns = appModalContainer.querySelectorAll(".modal-tab-btn");

        /* Artisans tab (index 1) */
        if (tabPanels[1]) {
            if (!artisans.length) {
                tabPanels[1].innerHTML = `<div class="customer-linked-empty">${emptyIcon}<p>No artisans linked with this stock item.</p></div>`;
            } else {
                tabPanels[1].innerHTML = `<div class="customer-tab-summary"><span class="count-badge">${artisans.length}</span> artisan${artisans.length > 1 ? "s" : ""} linked</div>
                    <div class="customer-linked-grid">
                        ${artisans.map((artisan) => `<div class="customer-linked-card" data-stock-item-artisan="${artisan.id}">
                            <div class="customer-linked-card-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
                            <div class="customer-linked-card-body">
                                <div class="customer-linked-card-header">
                                    <span class="linked-title">${escapeHtml(artisan.name || "Artisan")}</span>
                                    ${artisan.usual_making_charge_percent != null && artisan.usual_making_charge_percent !== "" ? badge(`${artisan.usual_making_charge_percent}% MC`) : ""}
                                    ${artisan.usual_cash_charged != null && artisan.usual_cash_charged !== "" ? badge(`₹${Number(artisan.usual_cash_charged).toFixed(2)} cash`) : ""}
                                    ${paymentBadgesHtml}
                                </div>
                                <div class="customer-linked-card-meta"><span>${escapeHtml(artisan.description || "No description")}</span></div>
                            </div>
                            <div class="customer-linked-card-action">${arrowIcon}</div>
                        </div>`).join("")}
                    </div>`;
            }
        }
        if (tabBtns[1]) tabBtns[1].insertAdjacentHTML("beforeend", `<span class="tab-count">${artisans.length}</span>`);
        appModalContainer.querySelectorAll("[data-stock-item-artisan]").forEach((card) => {
            card.addEventListener("click", () => {
                closeAppModal();
                navigateTo("artisans");
                loadEntityRows("artisans", true).then(() => openArtisanDetailModal(card.dataset.stockItemArtisan));
            });
        });

        /* Movements tab (index 2) */
        if (tabPanels[2]) {
            const movementIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>`;
            if (!movements.length) {
                tabPanels[2].innerHTML = `<div class="customer-linked-empty">${emptyIcon}<p>No stock movements recorded for this item.</p></div>`;
            } else {
                tabPanels[2].innerHTML = `<div class="customer-tab-summary"><span class="count-badge">${movements.length}</span> movement${movements.length > 1 ? "s" : ""} recorded</div>
                    <div class="customer-linked-grid">
                        ${movements.map((mv) => `<div class="stock-movement-card">
                            <div class="stock-movement-icon">${movementIcon}</div>
                            <div class="stock-movement-body">
                                <div class="stock-movement-header">
                                    <span class="stock-movement-title">${escapeHtml(formatOptionLabel(mv.previous_status || "--"))} → ${escapeHtml(formatOptionLabel(mv.new_status || "--"))}</span>
                                    ${badge(mv.new_status)}
                                </div>
                                <div class="stock-movement-meta">
                                    <span>${formatDateTime(mv.movement_at)}</span>
                                    ${mv.quantity_delta ? `<span>Qty: ${escapeHtml(mv.quantity_delta)}</span>` : ""}
                                    ${mv.reference_type ? `<span>${escapeHtml(formatOptionLabel(mv.reference_type))}</span>` : ""}
                                    ${mv.remarks ? `<span>${escapeHtml(truncate(mv.remarks, 60))}</span>` : ""}
                                </div>
                            </div>
                        </div>`).join("")}
                    </div>`;
            }
        }
        if (tabBtns[2]) tabBtns[2].insertAdjacentHTML("beforeend", `<span class="tab-count">${movements.length}</span>`);

        /* Documents tab (index 3) */
        if (tabPanels[3]) {
            const orderIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>`;
            const invoiceIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
            const totalDocs = orderItems.length + invoiceItems.length;
            if (!totalDocs) {
                tabPanels[3].innerHTML = `<div class="customer-linked-empty">${emptyIcon}<p>No orders or invoices reference this stock item.</p></div>`;
            } else {
                let docHtml = `<div class="customer-tab-summary"><span class="count-badge">${totalDocs}</span> document${totalDocs > 1 ? "s" : ""} linked</div>`;
                if (orderItems.length) {
                    docHtml += `<div class="stock-documents-group"><div class="stock-documents-group-label">Order Items (${orderItems.length})</div><div class="customer-linked-grid">${orderItems.map((item) => `<div class="stock-document-card" data-stock-nav-order="${item.order_id}">
                        <div class="stock-document-icon">${orderIcon}</div>
                        <div class="stock-document-body">
                            <div class="stock-document-header"><span class="stock-document-title">${escapeHtml(item.order_number || "Order")}</span>${badge(item.order_status || item.status)}</div>
                            <div class="stock-document-meta"><span>${escapeHtml(item.description || "--")}</span><span>Qty: ${escapeHtml(item.quantity ?? "--")}</span>${item.purity ? `<span>${escapeHtml(item.purity)}</span>` : ""}</div>
                        </div>
                        <div class="stock-document-arrow">${arrowIcon}</div>
                    </div>`).join("")}</div></div>`;
                }
                if (invoiceItems.length) {
                    docHtml += `<div class="stock-documents-group"><div class="stock-documents-group-label">Invoice Items (${invoiceItems.length})</div><div class="customer-linked-grid">${invoiceItems.map((item) => `<div class="stock-document-card" data-stock-nav-invoice="${item.invoice_id}">
                        <div class="stock-document-icon">${invoiceIcon}</div>
                        <div class="stock-document-body">
                            <div class="stock-document-header"><span class="stock-document-title">${escapeHtml(item.invoice_no || "Invoice")}</span>${badge(item.invoice_status)}</div>
                            <div class="stock-document-meta"><span>${escapeHtml(item.description || "--")}</span>${item.customer_name ? `<span>${escapeHtml(item.customer_name)}</span>` : ""}${item.line_total_amount ? `<span>${formatCurrency(item.line_total_amount)}</span>` : ""}</div>
                        </div>
                        <div class="stock-document-arrow">${arrowIcon}</div>
                    </div>`).join("")}</div></div>`;
                }
                tabPanels[3].innerHTML = docHtml;
            }
        }
        if (tabBtns[3]) tabBtns[3].insertAdjacentHTML("beforeend", `<span class="tab-count">${orderItems.length + invoiceItems.length}</span>`);

        /* Navigation handlers for document cards */
        appModalContainer.querySelectorAll("[data-stock-nav-order]").forEach((card) => {
            card.addEventListener("click", () => {
                const orderId = card.dataset.stockNavOrder;
                closeAppModal();
                navigateTo("orderbook-hub");
                loadOrderbookHub(true).then(() => {
                    state.hubs.orderbook.selectedOrderId = orderId;
                    openOrderViewModal(orderId);
                });
            });
        });
        appModalContainer.querySelectorAll("[data-stock-nav-invoice]").forEach((card) => {
            card.addEventListener("click", () => {
                const invoiceId = card.dataset.stockNavInvoice;
                closeAppModal();
                navigateTo("billing-hub");
                loadBillingHub(true).then(() => {
                    state.hubs.billing.selectedDocumentId = invoiceId;
                    state.hubs.billing.selectedDocumentType = "invoice";
                    openBillingDocumentViewModal(invoiceId);
                });
            });
        });
    } catch (error) {
        const tabPanels = appModalContainer.querySelectorAll(".modal-tab-panel");
        const errorHtml = `<div class="customer-linked-empty"><p>Failed to load linked records. ${escapeHtml(error.message)}</p></div>`;
        if (tabPanels[1]) tabPanels[1].innerHTML = errorHtml;
        if (tabPanels[2]) tabPanels[2].innerHTML = errorHtml;
        if (tabPanels[3]) tabPanels[3].innerHTML = errorHtml;
    }
}


function buildNotificationDefaults(defaults = {}) {
    return {
        subject: "",
        body: "",
        customer_id: "",
        artisan_id: "",
        order_id: "",
        invoice_id: "",
        receipt_id: "",
        reminder_at: startOfDayIso(state.notifications.selectedDate),
        ...defaults,
    };
}

function openNotificationFormModal({ row = null, defaults = {}, backFn = null } = {}) {
    const entity = getEntity("notifications");
    if (!entity) return;
    const isEdit = !!row;
    const backIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
    const clockIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const formHtml = `<div class="entity-modal-section">
        <div class="entity-modal-section-header">
            <span class="entity-modal-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/></svg></span>
            <span class="entity-modal-section-title">${isEdit ? "Edit" : "New"} Notification</span>
        </div>
        <form id="notification-modal-form" class="entity-modal-form" data-entity-form="notifications">
            <input type="hidden" name="id">
            <div class="field-grid two-col">
                ${entity.fields.filter((field) => !field.readOnly).map((field) => renderField(field, "notifications")).join("")}
            </div>
            <div class="quick-time-chips" id="notification-quick-chips">
                <button type="button" class="quick-time-chip" data-quick-time="today-5pm">${clockIcon} Today 5 PM</button>
                <button type="button" class="quick-time-chip" data-quick-time="tomorrow-9am">${clockIcon} Tomorrow 9 AM</button>
                <button type="button" class="quick-time-chip" data-quick-time="tomorrow-6pm">${clockIcon} Tomorrow 6 PM</button>
                <button type="button" class="quick-time-chip" data-quick-time="next-monday">${clockIcon} Next Monday</button>
                <button type="button" class="quick-time-chip" data-quick-time="in-1-hour">${clockIcon} In 1 Hour</button>
                <button type="button" class="quick-time-chip" data-quick-time="in-3-hours">${clockIcon} In 3 Hours</button>
            </div>
        </form>
    </div>`;

    openAppModal({
        size: "modal-sm",
        kicker: "Notifications",
        title: isEdit ? "Edit Notification" : "New Notification",
        bodyHtml: formHtml,
        footerHtml: `
            ${backFn ? `<button type="button" class="ghost-action compact-action" id="notification-modal-back">${backIcon} Back</button>` : ""}
            <button type="button" class="primary-action" id="notification-modal-save">Save Notification</button>
        `,
        onOpen: () => {
            rerenderLookupFields();
            initSearchableSelects(appModalBody);
            initStyledSelects(appModalBody);
            initCustomerSearch();
            Object.keys(NOTIFICATION_SMART_FIELD_CONFIG).forEach(initNotificationSmartLookup);
            const form = document.getElementById("notification-modal-form");
            setFormValues("notifications", buildNotificationDefaults(defaults));
            syncCustomerSearchFromValue("notifications", buildNotificationDefaults(defaults));
            syncNotificationSmartLookupsFromValue(buildNotificationDefaults(defaults));
            syncSearchableSelectDisplay(appModalBody);
            syncStyledSelectDisplays(appModalBody);
            if (row) {
                setFormValues("notifications", row);
                syncCustomerSearchFromValue("notifications", row);
                syncNotificationSmartLookupsFromValue(row);
                syncSearchableSelectDisplay(appModalBody);
                syncStyledSelectDisplays(appModalBody);
            }
            document.getElementById("notification-modal-back")?.addEventListener("click", () => {
                closeAppModal();
                backFn?.();
            });
            document.getElementById("notification-modal-save")?.addEventListener("click", async () => {
                try {
                    const payload = serializeForm("notifications");
                    if (!payload.reminder_at) {
                        payload.reminder_at = startOfDayIso(state.notifications.selectedDate);
                    }
                    if (row?.id) payload.id = row.id;
                    await requestJson("/api/admin/notifications", {
                        method: "POST",
                        body: JSON.stringify(payload),
                    });
                    closeAppModal();
                    await Promise.all([loadPortal(), refreshNotificationsState(true)]);
                    renderNotificationsSection();
                    showToast(`Notification ${isEdit ? "updated" : "saved"}`);
                    const returnContext = state.notifications.returnContext;
                    if (!isEdit && returnContext?.orderId) {
                        setNotificationReturnContext(null);
                        navigateTo("orderbook-hub");
                        await refreshOrderbookOrder(returnContext.orderId);
                        openOrderViewModal(returnContext.orderId, 3);
                    }
                } catch (error) {
                    console.error(error);
                    showToast(error.message, true);
                }
            });
            if (!row && form) {
                const reminderInput = form.querySelector('[name="reminder_at"]');
                if (reminderInput && !reminderInput.value) {
                    reminderInput.value = startOfDayIso(state.notifications.selectedDate);
                }
            }
            /* Quick-pick time chip handlers */
            document.getElementById("notification-quick-chips")?.addEventListener("click", (e) => {
                const chip = e.target.closest("[data-quick-time]");
                if (!chip) return;
                const reminderInput = form?.querySelector('[name="reminder_at"]');
                if (!reminderInput) return;
                const now = new Date();
                let target;
                switch (chip.dataset.quickTime) {
                    case "today-5pm":
                        target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0);
                        break;
                    case "tomorrow-9am":
                        target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
                        break;
                    case "tomorrow-6pm":
                        target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 18, 0);
                        break;
                    case "next-monday": {
                        const daysUntilMon = (8 - now.getDay()) % 7 || 7;
                        target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMon, 9, 0);
                        break;
                    }
                    case "in-1-hour":
                        target = new Date(now.getTime() + 60 * 60 * 1000);
                        break;
                    case "in-3-hours":
                        target = new Date(now.getTime() + 3 * 60 * 60 * 1000);
                        break;
                    default:
                        return;
                }
                reminderInput.value = formatDateTimeLocal(target.toISOString());
            });
        },
    });
}

function openNotificationFromOrder(orderId) {
    const order = (state.hubs.orderbook.orders || []).find((row) => String(row.id) === String(orderId));
    if (!order) return;
    setNotificationReturnContext({ orderId });
    closeAppModal();
    navigateTo("notifications");
    refreshNotificationsState(true).then(() => {
        state.notifications.selectedDate = (order.promised_date || order.order_date || localIsoDate(new Date())).slice(0, 10);
        state.notifications.calendarMonth = state.notifications.selectedDate.slice(0, 7);
        renderNotificationsSection();
        openNotificationFormModal({
            defaults: {
                customer_id: order.customer_id || "",
                order_id: order.id || "",
                reminder_at: startOfDayIso((order.promised_date || order.order_date || localIsoDate(new Date())).slice(0, 10)),
                subject: order.order_number ? `Follow up for order ${order.order_number}` : "",
            },
            backFn: () => openOrderViewModal(orderId, 3),
        });
    }).catch((error) => {
        console.error(error);
        showToast(error.message, true);
    });
}

function openNotificationTarget(targetType, targetId) {
    const type = String(targetType || "").trim();
    const id = String(targetId || "").trim();
    if (!type || !id) return;
    if (type === "order") {
        navigateTo("orderbook-hub");
        refreshOrderbookOrder(id).then(() => openOrderViewModal(id, 3)).catch((error) => {
            console.error(error);
            showToast(error.message, true);
        });
        return;
    }
    if (type === "invoice" || type === "receipt") {
        navigateTo("billing-hub");
        refreshBillingDocument(id, { openView: true, reopenModalTab: 0 }).catch((error) => {
            console.error(error);
            showToast(error.message, true);
        });
        return;
    }
    if (type === "customer") {
        navigateTo("customers");
        loadEntityRows("customers", true).then(() => openCustomerDetailModal(id)).catch((error) => {
            console.error(error);
            showToast(error.message, true);
        });
        return;
    }
    if (type === "artisan") {
        navigateTo("artisans");
        loadEntityRows("artisans", true).then(() => openArtisanDetailModal(id)).catch((error) => {
            console.error(error);
            showToast(error.message, true);
        });
    }
}

function openNotificationRelatedRecord(recordId) {
    const row = findRow("notifications", recordId);
    if (!row) return;
    if (row.order_id) {
        openNotificationTarget("order", row.order_id);
        return;
    }
    if (row.invoice_id || row.receipt_id) {
        openNotificationTarget(row.invoice_id ? "invoice" : "receipt", row.invoice_id || row.receipt_id);
        return;
    }
    if (row.customer_id) {
        openNotificationTarget("customer", row.customer_id);
        return;
    }
    if (row.artisan_id) {
        openNotificationTarget("artisan", row.artisan_id);
        return;
    }
    showToast("This reminder is not linked to an order, invoice, receipt, customer, or artisan.");
}

/* ===== ENTITY FORM MODAL ===== */
function openEntityFormModal(slug, row = null, backFn = null) {
    if (slug === "notifications") {
        openNotificationFormModal({ row, backFn });
        return;
    }
    if (slug === "payment-transactions") {
        openPaymentTransactionModal(row?.id || "", { row, backFn });
        return;
    }
    if (slug === "stock-items") {
        openStockItemFormModal(row, backFn);
        return;
    }
    const entity = getEntity(slug);
    if (!entity) return;
    const isEdit = !!row;
    const entityNoun = slug === "raw-metal-purchases" ? "Purchase" : entity.label.replace(/s$/, "");
    const formFields = entity.fields.filter(f => !f.readOnly);

    const backIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;

    const formHtml = `<div class="entity-modal-section">
        <div class="entity-modal-section-header">
            <span class="entity-modal-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${isEdit ? '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>' : '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'}</svg></span>
            <span class="entity-modal-section-title">${isEdit ? "Edit" : "New"} ${escapeHtml(entityNoun)}</span>
        </div>
        <form id="entity-modal-form" class="entity-modal-form" data-entity-form="${slug}">
            <input type="hidden" name="${escapeHtml(entity.primaryKey)}">
            <div class="field-grid two-col">
                ${formFields.map((field) => renderField(field, slug)).join("")}
            </div>
        </form>
    </div>`;

    openAppModal({
        size: "modal-sm",
        kicker: entity.label,
        title: isEdit ? `Edit ${escapeHtml(entityNoun)}` : `New ${escapeHtml(entityNoun)}`,
        bodyHtml: formHtml,
        footerHtml: `
            ${backFn ? `<button type="button" class="ghost-action compact-action" id="entity-modal-back">${backIcon} Back</button>` : ''}
            <button type="button" class="primary-action" id="entity-modal-save">Save ${escapeHtml(entityNoun)}</button>
        `,
        onOpen: () => {
            rerenderLookupFields();
            initSearchableSelects(appModalBody);
            initStyledSelects(appModalBody);
            if (entity.fields.some(isCustomerLookup)) initCustomerSearch();
            if (slug === "order-items") initStockItemSearch();
            if (slug === "stock-items") initArtisanSearch();
            if (row) {
                setFormValues(slug, row);
                syncCustomerSearchFromValue(slug, row);
                syncStockItemSearchFromValue(slug, row);
                syncArtisanSearchFromValue(slug, row);
                syncSearchableSelectDisplay(appModalBody);
                syncStyledSelectDisplays(appModalBody);
            } else if (slug === "raw-metal-purchases") {
                const dateField = appModalBody.querySelector('[name="purchase_date"]');
                if (dateField) dateField.value = localIsoDate(new Date());
            }
            if (slug === "orders" && !row) {
                const form = document.getElementById("entity-modal-form");
                prefillNumberRecommendation(form, "order");
                prefillOrderDateTime(form);
            }
            if (backFn) {
                document.getElementById("entity-modal-back")?.addEventListener("click", () => {
                    closeAppModal();
                    backFn();
                });
            }
            document.getElementById("entity-modal-save").addEventListener("click", async () => {
                const saveBtn = document.getElementById("entity-modal-save");
                const form = document.getElementById("entity-modal-form");
                if (form && !form.reportValidity()) return;
                saveBtn.textContent = "Saving...";
                saveBtn.disabled = true;
                try {
                    await requestJson(`/api/admin/${slug}`, {
                        method: "POST",
                        body: JSON.stringify(serializeForm(slug, form)),
                    });
                    closeAppModal();
                    const refreshTasks = [loadPortal()];
                    if (getVisibleEntities().some(e => e.slug === slug)) refreshTasks.push(loadEntityRows(slug, true));
                    if (["orders", "order-items", "advance-receipts"].includes(slug)) refreshTasks.push(loadOrderbookHub(true));
                    if (["invoices", "invoice-items", "receipts", "receipt-items"].includes(slug)) refreshTasks.push(loadBillingHub(true));
                    await Promise.all(refreshTasks);
                    if (["customers", "artisans", "stock-items", "orders", "advance-receipts", "invoices", "receipts", "payment-transactions"].includes(slug)) {
                        await loadLookups();
                        rerenderLookupFields();
                        renderAllVisibleTables();
                    }
                    showToast(slug === "raw-metal-purchases" ? "Purchase saved" : `${entity.label.replace(/s$/, "")} saved`);
                } catch (error) {
                    console.error(error);
                    showToast(error.message, true);
                    saveBtn.textContent = `Save ${entityNoun}`;
                    saveBtn.disabled = false;
                }
            });
        }
    });
}

/* ===== ENTITY DELETE CONFIRM MODAL ===== */
async function openEntityDeleteConfirmModal(slug, recordId) {
    const entity = getEntity(slug);
    const row = findRow(slug, recordId);
    if (!entity || !row) return;
    const recordLabel = summarizeEntityRow(entity, row);
    const entityLabel = entity.label.replace(/s$/, "");

    /* Fetch dependency info */
    let dependentLines = [];
    let linkedRecords = [];
    try {
        const check = await requestJson(`/api/admin/${slug}/delete-check?id=${encodeURIComponent(recordId)}`);
        dependentLines = (check.dependents || []).map(item => {
            const impact = slug === "customers"
                ? "will be retained unless selected below"
                : (item.cascade ? "will also be deleted" : "is linked and may block deletion");
            return `<li><strong>${item.count}</strong> ${escapeHtml(item.label)} — ${impact}</li>`;
        });
        linkedRecords = check.linkedRecords || [];
    } catch { /* proceed without dependency info */ }

    const isCustomer = slug === "customers";
    const customerName = String(row.full_name || "").trim();
    const dependentHtml = dependentLines.length
        ? `<div class="delete-confirm-dependents"><p class="delete-confirm-dep-title">Linked records:</p><ul>${dependentLines.join("")}</ul></div>`
        : "";
    const linkedRecordCheckboxes = linkedRecords.length ? `
        <div class="delete-linked-records-list">
            <p class="delete-confirm-dep-title">Permanently delete selected records:</p>
            ${linkedRecords.map(record => `
                <label class="delete-linked-records-option">
                    <input type="checkbox" data-linked-record value="${escapeHtml(`${record.table}:${record.id}`)}">
                    <span><strong>${escapeHtml(record.label)}</strong><span style="font-size:11.5px;color:var(--text-muted);margin-top:1px;">${escapeHtml(record.recordNo)}</span></span>
                </label>`).join("")}
        </div>` : "";
    const customerControls = isCustomer ? `
        <div class="delete-confirm-input-wrap">
            <label>Type <strong>${escapeHtml(customerName)}</strong> to confirm:</label>
            <input type="text" id="delete-confirm-input" autocomplete="off" placeholder="${escapeHtml(customerName)}">
        </div>
        ${linkedRecordCheckboxes}
        <p class="delete-confirm-hint">Linked invoices, receipts, and other records are kept by default, but will no longer be assigned to this customer.</p>
    ` : "";

    openAppModal({
        size: "modal-xs",
        kicker: "Confirm Deletion",
        title: `Delete ${entityLabel}`,
        bodyHtml: `
            <div class="delete-confirm-icon"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>
            <p class="delete-confirm-msg">Are you sure you want to delete <strong>${escapeHtml(entityLabel)} "${escapeHtml(recordLabel)}"</strong>? This action cannot be undone.</p>
            ${dependentHtml}
            ${customerControls}
        `,
        footerHtml: `
            <button type="button" class="ghost-action" data-close-modal>Cancel</button>
            <button type="button" class="delete-confirm-btn ${isCustomer ? "" : "enabled"}" id="delete-confirm-btn" ${isCustomer ? "disabled" : ""}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Delete</button>
        `,
        onOpen: () => {
            const btn = document.getElementById("delete-confirm-btn");
            const input = document.getElementById("delete-confirm-input");
            if (input) {
                input.addEventListener("input", () => {
                    const matches = input.value.trim() === customerName;
                    btn.disabled = !matches;
                    btn.classList.toggle("enabled", matches);
                });
                input.focus();
            }
            btn.addEventListener("click", async () => {
                if (btn.disabled) return;
                btn.textContent = "Deleting...";
                btn.disabled = true;
                const selectedLinkedRecords = [...document.querySelectorAll("[data-linked-record]:checked")]
                    .map(input => input.value);
                closeAppModal();
                await deleteEntity(slug, recordId, {
                    confirmName: isCustomer ? customerName : null,
                    linkedRecords: selectedLinkedRecords,
                });
            });
        }
    });
}

/* ===== DELETE CONFIRM MODAL (Hub documents/orders) ===== */
function openDeleteConfirmModal(docType, docNo, docId, entitySlug) {
    const label = docType.charAt(0).toUpperCase() + docType.slice(1);
    openAppModal({
        size: "modal-xs",
        kicker: "Confirm Deletion",
        title: `Delete ${label}`,
        bodyHtml: `
            <div class="delete-confirm-icon"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>
            <p class="delete-confirm-msg">You are about to permanently delete <strong>${escapeHtml(label)} ${escapeHtml(docNo)}</strong>. This action cannot be undone.</p>
            <div class="delete-confirm-input-wrap">
                <label>Type <strong>${escapeHtml(docNo)}</strong> to confirm:</label>
                <input type="text" id="delete-confirm-input" autocomplete="off" placeholder="${escapeHtml(docNo)}">
            </div>
            <p class="delete-confirm-hint">This field is case-sensitive</p>
            <button type="button" class="delete-confirm-btn" id="delete-confirm-btn" disabled>Delete Permanently</button>
        `,
        footerHtml: "",
        onOpen: () => {
            const inp = document.getElementById("delete-confirm-input");
            const btn = document.getElementById("delete-confirm-btn");
            inp.addEventListener("input", () => {
                const match = inp.value.trim() === String(docNo).trim();
                btn.classList.toggle("enabled", match);
                btn.disabled = !match;
            });
            btn.addEventListener("click", async () => {
                if (btn.disabled) return;
                btn.textContent = "Deleting...";
                btn.disabled = true;
                closeAppModal();
                await deleteEntity(entitySlug, docId);
            });
            inp.focus();
        }
    });
}

function isExchangeReceiptDocument(doc) {
    if (!doc || doc.document_type !== "receipt") return false;
    return Boolean(String(doc.linked_invoice_id || "").trim()) || Number(doc.less_invoice_amount || 0) > 0;
}

function getBillingDocumentHeaderFields(doc, isInvoice, compact = false) {
    if (isInvoice) {
        return compact
            ? ["invoice_no", "customer_name", "customer_id", "status", "invoice_datetime", "net_payable_amount"]
            : ["invoice_no", "customer_name", "customer_id", "status", "invoice_datetime", "net_payable_amount", "items_total_amount", "discount_amount", "taxable_amount", "total_tax_amount", "gross_invoice_total", "round_off_amount", "old_gold_advance_amount", "amount_received", "balance_due_amount"];
    }

    const fields = [
        { key: "receipt_no" },
        { key: "customer_name" },
        { key: "customer_id" },
        { key: "status" },
        { key: "receipt_datetime" },
        { key: "gross_amount", label: "Total Amount" },
        { key: "amount_received" },
    ];

    if (isExchangeReceiptDocument(doc)) {
        fields.push({ key: "less_invoice_amount" }, { key: "net_amount", label: "Net Amount" });
    } else {
        fields.push({ key: "net_amount", label: "Balance Amount" });
    }

    return fields;
}

/* ===== BILLING DOCUMENT DETAIL MODAL ===== */
function openBillingDocumentModal(docId, activeTab = 0) {
    const doc = (state.hubs.billing.documents || []).find(r => String(r.id) === String(docId));
    if (!doc) return;
    const isInvoice = doc.document_type === "invoice";
    const slug = isInvoice ? "invoices" : "receipts";
    const childSlug = isInvoice ? "invoice-items" : "receipt-items";
    const parentField = isInvoice ? "invoice_id" : "receipt_id";
    const entity = getEntity(slug);
    const childEntity = getEntity(childSlug);
    if (!entity) return;
    const headerFields = getBillingDocumentHeaderFields(doc, isInvoice, true);
    const fieldMap = Object.fromEntries(entity.fields.map(f => [f.name, f]));
    const detailHtml = `<div class="modal-detail-grid">${headerFields.map((entry) => {
        const key = typeof entry === "string" ? entry : entry.key;
        const customLabel = typeof entry === "string" ? "" : entry.label || "";
        const f = fieldMap[key] || { label: key.replace(/_/g, " ") };
        return `<div class="modal-detail-item"><span class="modal-detail-label">${escapeHtml(customLabel || f.label)}</span><div class="modal-detail-value">${renderDetailValue(f, doc[key])}</div></div>`;
    }).join("")}</div>
    <div style="margin-top:16px"><button type="button" class="secondary-action compact-action" data-modal-edit-header="${slug}" data-doc-id="${docId}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg> Edit Details
    </button></div>`;
    const items = doc.line_items || [];
    const itemsTotal = items.reduce((sum, r) => sum + Number(r.line_total_amount || 0), 0);
    const editIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
    const deleteIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
    const itemCols = [
        { key: "line_no", label: "Line" }, { key: "description", label: "Description" },
        { key: "quantity", label: "Qty" }, { key: "purity", label: "Purity" },
        { key: "line_total_amount", label: "Total", render: v => formatCurrency(v) }
    ];
    let itemsTableHtml = "";
    if (items.length) {
        const head = itemCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join("") + "<th>Actions</th>";
        const body = items.map(row => {
            const cells = itemCols.map(c => `<td>${c.render ? c.render(row[c.key]) : escapeHtml(row[c.key] ?? "--")}</td>`).join("");
            return `<tr>${cells}<td class="row-actions">
                <button type="button" class="table-action" data-modal-edit-item="${childSlug}" data-item-id="${row.id}" data-parent-id="${docId}">${editIcon} Edit</button>
                <button type="button" class="table-action danger" data-modal-delete-item="${childSlug}" data-item-id="${row.id}">${deleteIcon} Delete</button>
            </td></tr>`;
        }).join("");
        itemsTableHtml = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    } else {
        itemsTableHtml = `<p class="empty-state">No line items yet. Click "Add Item" to get started.</p>`;
    }
    const itemsTotalHtml = itemsTotal > 0 ? `<span class="modal-items-total">Total: ${formatCurrency(itemsTotal)}</span>` : "";
    const itemsHtml = `<div class="modal-items-header"><h4>${isInvoice ? "Invoice" : "Receipt"} Items <span class="items-count">${items.length}</span></h4>${itemsTotalHtml}
        <button type="button" class="primary-action compact-action" data-modal-add-item="${childSlug}" data-parent-id="${docId}" data-parent-field="${parentField}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Item
        </button></div><div class="table-shell">${itemsTableHtml}</div><div id="modal-item-form-area"></div>`;
    const backIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
    openAppModal({
        kicker: doc.document_type,
        title: `${doc.document_no || "Document"} · ${doc.customer_name || "Walk-in"}`,
        tabs: [{ label: "Details", html: detailHtml }, { label: "Items", count: items.length, html: itemsHtml }],
        activeTab,
        footerHtml: `<button type="button" class="ghost-action compact-action" id="billing-edit-back">${backIcon} Back</button>
            <button type="button" class="secondary-action compact-action" id="billing-edit-payments">Go to Payments</button>`,
        onOpen: () => {
            document.getElementById("billing-edit-back")?.addEventListener("click", () => {
                const tab = getActiveModalTab();
                closeAppModal();
                openBillingDocumentViewModal(docId, tab);
            });
            document.getElementById("billing-edit-payments")?.addEventListener("click", () => {
                closeAppModal();
                openLinkedPaymentTransaction(doc.document_type, doc.id, doc);
            });
        }
    });
}

/* ===== ORDERBOOK DETAIL MODAL ===== */
const ORDER_LIFECYCLE = ["created", "in_progress", "finished", "pending_delivery", "delivered"];
const LEGACY_ORDER_STATUS = { draft: "created", open: "created", ready: "finished" };
function lifecycleStatus(order) { return LEGACY_ORDER_STATUS[order.status] || order.status || "created"; }
function orderActivityTitle(event) {
    const labels = {
        created: "Order Created",
        order_details_updated: "Order Details Updated",
        order_item_added: "Order Item Added",
        order_item_updated: "Order Item Updated",
        details_updated: "Item Details Updated",
        final_details_linked: "Final Details Linked",
        artisan_assigned: "Artisan Added",
        advance_receipt_added: "Advance Receipt Added",
        advance_receipt_updated: "Advance Receipt Updated",
        advance_receipt_deleted: "Advance Receipt Deleted",
        order_item_deleted: "Order Item Removed",
        cancelled: "Order Cancelled",
        delivered: "Order Delivered",
        status_changed: "Order Status Updated",
    };
    if (event.event_type === "status_changed") {
        const statusLabels = {
            created: "Order Reopened",
            in_progress: "Handed to Artisans",
            finished: "Order Marked Finished",
            pending_delivery: "Ready for Delivery",
            delivered: "Order Delivered",
            cancelled: "Order Cancelled",
        };
        return statusLabels[event.to_status] || labels.status_changed;
    }
    return labels[event.event_type] || "Order Activity";
}
function orderActivityDetail(event) {
    const details = event.details || {};
    const parts = [];
    if (details.artisan_name) parts.push(details.artisan_name);
    if (details.receipt_no) parts.push(`Receipt ${details.receipt_no}`);
    if (details.amount !== undefined && details.amount !== null && details.amount !== "") parts.push(formatCurrency(details.amount));
    if (details.description) parts.push(details.description);
    if (details.order_number && event.event_type === "created") parts.push(details.order_number);
    if (details.remarks) parts.push(details.remarks);
    return parts.join(" · ");
}
function syncOrderItemPurity(form) {
    const hsn = form?.querySelector('[name="hsn_code"]')?.value || "";
    const purity = form?.querySelector('[name="purity"]');
    if (!purity) return;
    const isSilver = hsn.startsWith("7106") || hsn.startsWith("7114");
    [...purity.options].forEach(option => {
        if (!option.value) return;
        option.hidden = isSilver ? option.value !== "925" : option.value === "925";
    });
    if (isSilver && purity.value !== "925") purity.value = "925";
    if (!isSilver && purity.value === "925") purity.value = "";
    purity.dispatchEvent(new Event("change", { bubbles: true }));
}
function buildOrderTimeline(order, readOnly = false) {
    const current = lifecycleStatus(order);
    const events = order.lifecycle_events || [];
    const currentIndex = ORDER_LIFECYCLE.indexOf(current);
    const isCancelled = current === "cancelled";
    /* Progress ratio for the progress track */
    const progressRatio = isCancelled ? 0 : Math.min(1, (currentIndex) / (ORDER_LIFECYCLE.length - 1));
    const progressPct = Math.round(progressRatio * 100);

    /* SVG icons for step states */
    const checkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const spinnerIcon = `<svg class="order-step-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;

    const nodes = ORDER_LIFECYCLE.map((status, index) => {
        const isDelivered = current === "delivered";
        const done = !isCancelled && (index < currentIndex || (isDelivered && index === currentIndex));
        const active = !isCancelled && !isDelivered && status === current;
        const pending = isCancelled || (!done && !active);
        const matching = [...events].reverse().find(event => event.to_status === status);
        const timeLabel = matching ? escapeHtml(formatDate(matching.occurred_at)) : active ? "In progress" : pending ? "Awaiting" : "";
        return `<div class="order-timeline-step ${done ? "is-done" : ""} ${active ? "is-active" : ""} ${pending && !active ? "is-pending" : ""}"><div class="order-timeline-dot">${done ? checkIcon : active ? spinnerIcon : index + 1}</div><div class="order-timeline-label"><strong>${escapeHtml(formatOptionLabel(status))}</strong><small>${timeLabel}</small></div></div>`;
    }).join("");

    /* Activity history */
    const history = events.length
        ? events.slice().reverse().map(event => {
            const icon = `<span class="order-history-dot"></span>`;
            const detail = orderActivityDetail(event);
            return `<li>${icon}<div class="order-history-content"><strong>${escapeHtml(orderActivityTitle(event))}</strong><span>${escapeHtml(formatDateTime(event.occurred_at))}${detail ? ` · ${escapeHtml(detail)}` : ""}</span></div></li>`;
        }).join("")
        : `<li><span class="order-history-empty">No lifecycle events recorded yet.</span></li>`;

    /* Action buttons */
    let actions = "";
    if (!readOnly) {
        if (isCancelled) {
            actions = `<button class="secondary-action compact-action" data-order-transition="created" data-order-id="${order.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Reopen Order</button>`;
        } else {
            if (current !== "in_progress") actions += `<button class="primary-action compact-action" data-order-transition="in_progress" data-order-id="${order.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 3l14 9-14 9V3z"/></svg> Hand to Artisans</button>`;
            if (current === "in_progress") actions += `<button class="primary-action compact-action" data-order-transition="finished" data-order-id="${order.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Mark Finished</button>`;
            if (current === "finished") actions += `<button class="primary-action compact-action" data-order-transition="pending_delivery" data-order-id="${order.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> Pending Delivery</button>`;
            if (current === "pending_delivery") actions += `<button class="primary-action compact-action" data-order-transition="delivered" data-order-id="${order.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Check & Deliver</button>`;
            actions += `<button class="ghost-action compact-action order-cancel-btn" data-order-transition="cancelled" data-order-id="${order.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancel</button>`;
        }
    }

    const statusChip = isCancelled
        ? `<span class="order-status-chip is-cancelled">Cancelled</span>`
        : current === "delivered"
        ? `<span class="order-status-chip is-delivered">Delivered</span>`
        : `<span class="order-status-chip is-active">${escapeHtml(formatOptionLabel(current))}</span>`;

    const progressBar = !isCancelled ? `
        <div class="order-progress-track">
            <div class="order-progress-fill" style="width:${progressPct}%"></div>
        </div>` : ``;

    return `<section class="order-lifecycle-card ${isCancelled ? "is-cancelled" : ""}"><div class="order-lifecycle-head">
        <div class="order-lifecycle-head-left">
            <span class="hub-kicker">Order Progress</span>
            <div class="order-lifecycle-title-row">
                <h4>${escapeHtml(formatOptionLabel(current))}</h4>
                ${statusChip}
            </div>
        </div>
        <span class="order-lifecycle-meta">${isCancelled ? "Order closed" : `Step ${Math.min(currentIndex + 1, ORDER_LIFECYCLE.length)} of ${ORDER_LIFECYCLE.length}`}</span>
    </div>
    ${progressBar}
    <div class="order-timeline">${nodes}</div>
    ${actions ? `<div class="order-lifecycle-actions">${actions}</div>` : ""}
    <div class="order-history"><div class="order-history-header"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><h5>Activity History</h5></div><ul>${history}</ul></div></section>`;
}
function openOrderDetailModal(orderId, activeTab = 0) {
    const order = (state.hubs.orderbook.orders || []).find(r => String(r.id) === String(orderId));
    if (!order) return;
    const entity = getEntity("orders");
    if (!entity) return;
    const headerFields = ["order_number", "customer_id", "order_type", "order_datetime", "order_date", "promised_date", "status", "remarks"];
    const fieldMap = Object.fromEntries(entity.fields.map(f => [f.name, f]));
    const custName = order.customer_name || "";
    const detailHtml = `${buildOrderTimeline(order)}<div class="modal-detail-grid">${headerFields.map(k => {
        const f = fieldMap[k] || { label: k.replace(/_/g, " ") };
        let val = k === "customer_id" ? (custName || order[k]) : order[k];
        return `<div class="modal-detail-item"><span class="modal-detail-label">${escapeHtml(f.label)}</span><div class="modal-detail-value">${renderDetailValue(f, val)}</div></div>`;
    }).join("")}</div>
    <div style="margin-top:16px"><button type="button" class="secondary-action compact-action" data-modal-edit-header="orders" data-doc-id="${orderId}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg> Edit Details
    </button></div>`;
    const oItems = order.order_items || [];
    const oiCols = [{ key: "description", label: "Description" }, { key: "quantity", label: "Qty" }, { key: "purity", label: "Purity" }, { key: "status", label: "Status", render: v => badge(v) }];
    let oiTable = oItems.length ? buildModalItemTable(oiCols, oItems, "order-items", orderId, "order_id") : `<p class="empty-state">No items yet. Click "Add Item" to get started.</p>`;
    const artisanLabels = new Map((state.lookups?.artisans || []).map(artisan => [String(artisan.value), artisan.label]));
    const assignmentsByItem = new Map();
    (order.artisan_assignments || []).forEach(assignment => {
        const itemId = String(assignment.order_item_id || "");
        if (!itemId) return;
        const assigned = assignmentsByItem.get(itemId) || [];
        assigned.push(artisanLabels.get(String(assignment.artisan_id)) || "Assigned artisan");
        assignmentsByItem.set(itemId, assigned);
    });
    const artisanAssignmentHtml = oItems.length ? `<section class="order-item-artisans"><h5>Artisan assignments</h5><p class="form-stage-hint">Assign one or more artisans to each item, then hand the order to artisans.</p>${oItems.map(item => {
        const assigned = assignmentsByItem.get(String(item.id)) || [];
        const closed = ["delivered", "cancelled"].includes(lifecycleStatus(order));
        return `<div class="order-item-artisan-row"><div><strong>${escapeHtml(item.description || "Untitled item")}</strong><small>${assigned.length ? `Assigned: ${escapeHtml(assigned.join(", "))}` : "No artisan assigned"}</small></div><div class="order-item-artisan-controls"><div class="customer-search-wrap artisan-item-search-wrap" id="artisan-item-search-wrap-${escapeHtml(item.id)}"><input type="hidden" id="artisan-hidden-${escapeHtml(item.id)}"><input type="text" class="artisan-item-search-input" data-artisan-search-item="${escapeHtml(item.id)}" placeholder="Search artisan…" autocomplete="off" ${closed ? "disabled" : ""}><div class="customer-suggestion-panel artisan-item-suggestion-panel" id="artisan-suggestion-panel-${escapeHtml(item.id)}"></div></div><button type="button" class="secondary-action compact-action" data-order-item-artisan-add data-order-id="${orderId}" data-item-id="${item.id}" ${closed ? "disabled" : ""}>Add</button></div></div>`;
    }).join("")}</section>` : "";
    const itemsHtml = `<div class="modal-items-header"><h4>Order Items <span class="items-count">${oItems.length}</span></h4>
        <button type="button" class="primary-action compact-action" data-modal-add-item="order-items" data-parent-id="${orderId}" data-parent-field="order_id">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Item
        </button></div><div class="table-shell">${oiTable}</div>${artisanAssignmentHtml}<div id="modal-item-form-area"></div>`;
    const aReceipts = order.advance_receipts || [];
    const advanceTotal = aReceipts.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const arCols = [
        { key: "receipt_no", label: "Receipt No" },
        { key: "receipt_datetime", label: "Date", render: v => formatDateTime(v) },
        { key: "transaction_type", label: "Transaction Type", render: v => badge(formatOptionLabel(v) || "--") },
        { key: "amount", label: "Amount", render: v => formatCurrency(v) },
        { key: "valuation_description", label: "Description", render: v => escapeHtml(v || "--") },
    ];
    let arTable = aReceipts.length ? buildModalItemTable(arCols, aReceipts, "advance-receipts", orderId, "order_id") : `<p class="empty-state">No advance receipts yet. Click "Add Receipt" to record an advance.</p>`;
    const totalHtml = advanceTotal > 0 ? `<span class="modal-items-total">Total: ${formatCurrency(advanceTotal)}</span>` : "";
    const receiptsHtml = `<div class="modal-items-header"><h4>Advance Receipts <span class="items-count">${aReceipts.length}</span></h4>${totalHtml}
        <button type="button" class="primary-action compact-action" data-modal-add-advance data-order-id="${orderId}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Receipt
        </button></div><div class="table-shell">${arTable}</div><div id="modal-advance-form-area"></div>`;
    const notificationsHtml = buildOrderNotificationTabHtml(order);
    const backIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
    openAppModal({
        kicker: "Order",
        title: `${order.order_number || "Order"} · ${custName || "Walk-in"}`,
        tabs: [{ label: "Details", html: detailHtml }, { label: "Items", count: oItems.length, html: itemsHtml }, { label: "Advances", count: aReceipts.length, html: receiptsHtml }, { label: "Notifications", count: ((order.notifications && order.notifications.length) || getNotificationRows().filter((row) => String(row.order_id || "") === String(order.id || "")).length), html: notificationsHtml }],
        activeTab,
        footerHtml: `<button type="button" class="ghost-action compact-action" id="order-edit-back">${backIcon} Back</button>`,
        onOpen: () => {
            document.getElementById("order-edit-back")?.addEventListener("click", () => {
                const tab = getActiveModalTab();
                closeAppModal();
                openOrderViewModal(orderId, tab);
            });
            clearAllItemArtisanSearchState();
            initOrderItemArtisanSearches();
        }
    });
}

function buildModalItemTable(cols, rows, childSlug, parentId, parentField) {
    const editIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
    const deleteIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
    const receiptIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2z"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>`;
    const head = cols.map(c => `<th>${escapeHtml(c.label)}</th>`).join("") + "<th>Actions</th>";
    const body = rows.map(row => {
        const cells = cols.map(c => `<td>${c.render ? c.render(row[c.key]) : escapeHtml(row[c.key] ?? "--")}</td>`).join("");
        const openAdvanceButton = childSlug === "advance-receipts"
            ? `<button type="button" class="table-action" data-open-advance-receipt="${row.id}" data-parent-id="${parentId}">View</button>`
            : "";
        const openReceiptButton = childSlug === "advance-receipts" && row.receipt_id && isOldOrnamentAdvanceType(row.transaction_type)
            ? `<button type="button" class="table-action" data-open-linked-receipt="${row.receipt_id}">${receiptIcon} View Receipt</button>`
            : "";
        return `<tr>${cells}<td class="row-actions">
            ${openAdvanceButton}
            ${openReceiptButton}
            <button type="button" class="table-action" data-modal-edit-item="${childSlug}" data-item-id="${row.id}" data-parent-id="${parentId}">${editIcon} Edit</button>
            <button type="button" class="table-action danger" data-modal-delete-item="${childSlug}" data-item-id="${row.id}" data-parent-id="${parentId}">${deleteIcon} Delete</button>
        </td></tr>`;
    }).join("");
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildOrderNotificationTabHtml(order) {
    const notifications = (getNotificationRows() || [])
        .filter((row) => String(row.order_id || "") === String(order.id || ""))
        .sort(compareNotifications);
    const addBtn = `<button type="button" class="primary-action compact-action" data-order-add-notification="${order.id}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Reminder
    </button>`;
    if (!notifications.length) {
        return `<div class="modal-items-header"><h4>Reminders <span class="items-count">0</span></h4>${addBtn}</div><p class="empty-state">No reminders linked to this order yet.</p>`;
    }
    const cardsHtml = notifications.map((row) => {
        const statusCls = isNotificationClosed(row) ? "is-closed" : isNotificationDue(row) ? "is-due" : "";
        return `<div class="order-notif-mini ${statusCls}">
            <div class="order-notif-accent"></div>
            <div class="order-notif-icon">${notificationCardIcon(row)}</div>
            <div class="order-notif-content">
                <strong>${escapeHtml(row.subject || "Reminder")}</strong>
                <small>${escapeHtml(formatDateTime(notificationEffectiveAt(row)))}${row.body ? ` · ${escapeHtml(truncate(row.body, 60))}` : ""}</small>
            </div>
            <div class="order-notif-actions">
                <button type="button" class="table-action" data-edit-notification="${row.id}" title="Edit">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                </button>
                ${!isNotificationClosed(row) ? `<button type="button" class="table-action danger" data-close-notification="${row.id}" title="Close">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>` : ""}
            </div>
        </div>`;
    }).join("");
    return `<div class="modal-items-header"><h4>Reminders <span class="items-count">${notifications.length}</span></h4>${addBtn}</div>
        <div class="order-notif-timeline">${cardsHtml}</div>`;
}

/* ===== CREATE DOCUMENT / ORDER MODALS ===== */
function openCreateDocumentModal(docType) {
    const isInvoice = docType === "invoice";
    const slug = isInvoice ? "invoices" : "receipts";
    const entity = getEntity(slug);
    if (!entity) return;
    const fields = isInvoice
        ? ["invoice_no", "customer_id", "customer_name", "status", "invoice_datetime", "net_payable_amount", "items_total_amount", "discount_amount", "taxable_amount", "sgst_percent", "sgst_amount", "cgst_percent", "cgst_amount", "igst_percent", "igst_amount", "total_tax_amount", "gross_invoice_total", "round_off_amount", "old_gold_advance_amount", "amount_received", "balance_due_amount"]
        : ["receipt_no", "customer_id", "customer_name", "status", "receipt_datetime", "gross_amount", "less_invoice_amount", "discount_amount", "round_off_amount", "net_amount", "amount_received"];
    const formHtml = `<form id="modal-create-form" class="modal-edit-form" data-entity-form="${slug}">
        <input type="hidden" name="id">
        ${fields.map(name => {
        const f = entity.fields.find(ff => ff.name === name);
        return f && !f.readOnly ? renderField(f, slug) : "";
    }).join("")}
    </form>`;
    openAppModal({
        size: "modal-sm",
        kicker: `New ${docType}`,
        title: `Create ${isInvoice ? "Invoice" : "Receipt"}`,
        bodyHtml: formHtml,
        footerHtml: `<button type="button" class="ghost-action" data-close-modal>Cancel</button>
            <button type="button" class="primary-action" id="modal-create-save">Save ${isInvoice ? "Invoice" : "Receipt"}</button>`,
        onOpen: () => {
            rerenderLookupFields();
            initCustomerSearch();
            initSearchableSelects(appModalBody);
            initStyledSelects(appModalBody);
            document.getElementById("modal-create-save").addEventListener("click", async () => {
                try {
                    await requestJson(`/api/admin/${slug}`, { method: "POST", body: JSON.stringify(serializeForm(slug)) });
                    closeAppModal();
                    await Promise.all([loadBillingHub(true), loadPortal(), loadLookups()]);
                    rerenderLookupFields();
                    showToast(`${isInvoice ? "Invoice" : "Receipt"} created`);
                } catch (e) { showToast(e.message, true); }
            });
        }
    });
}

function openCreateOrderModal() {
    const entity = getEntity("orders");
    if (!entity) return;
    const fields = ["order_number", "customer_id", "order_type", "order_datetime", "order_date", "promised_date", "remarks"];
    const formHtml = `<form id="modal-create-form" class="modal-edit-form" data-entity-form="orders">
        <input type="hidden" name="id">
        ${fields.map(name => {
        const f = entity.fields.find(ff => ff.name === name);
        return f && !f.readOnly ? renderField(f, "orders") : "";
    }).join("")}
    </form>`;
    openAppModal({
        size: "modal-sm",
        kicker: "New Order",
        title: "Create Order",
        bodyHtml: formHtml,
        footerHtml: `<button type="button" class="ghost-action" data-close-modal>Cancel</button>
            <button type="button" class="primary-action" id="modal-create-save">Save Order</button>`,
        onOpen: () => {
            rerenderLookupFields();
            initCustomerSearch();
            initSearchableSelects(appModalBody);
            initStyledSelects(appModalBody);
            const form = document.getElementById("modal-create-form");
            prefillNumberRecommendation(form, "order");
            prefillOrderDateTime(form);
            document.getElementById("modal-create-save").addEventListener("click", async () => {
                try {
                    await requestJson("/api/admin/orders", { method: "POST", body: JSON.stringify(serializeForm("orders")) });
                    closeAppModal();
                    await Promise.all([loadOrderbookHub(true), loadPortal(), loadLookups()]);
                    rerenderLookupFields();
                    showToast("Order created");
                } catch (e) { showToast(e.message, true); }
            });
        }
    });
}

/* ===== MODAL INLINE ITEM FORM ===== */
function showModalItemForm(childSlug, parentId, parentField, editRow) {
    const entity = getEntity(childSlug);
    if (!entity) return;
    if (childSlug === "advance-receipts") {
        showModalAdvanceForm(parentId, editRow || null);
        return;
    }
    const areaId = childSlug === "advance-receipts" ? "modal-advance-form-area" : "modal-item-form-area";
    const area = document.getElementById(areaId);
    if (!area) return;
    const excluded = new Set(["id", parentField]);
    const parentOrder = childSlug === "order-items" ? (state.hubs.orderbook.orders || []).find(order => String(order.id) === String(parentId)) : null;
    const stage = parentOrder ? lifecycleStatus(parentOrder) : "created";
    const roughFields = new Set(["description", "hsn_code", "purity", "design_notes", "quantity", "approx_weight_g", "predetermined_rate_per_gram", "predetermined_making_charges_percent", "other_charges_amount", "stone_amount"]);
    const formFields = entity.fields.filter(f => !f.readOnly && !excluded.has(f.name) && (childSlug !== "order-items" ? true : (stage === "finished" || stage === "pending_delivery") ? f.name !== "status" && f.name !== "predetermined_making_charges_amount" : roughFields.has(f.name)));
    const itemHint = childSlug === "order-items" ? `<p class="form-stage-hint">${stage === "finished" || stage === "pending_delivery" ? "Final details: link the stock number to replace the rough estimate." : "Rough estimate only. These details can be revised until manufacture is finished."}</p>` : "";
    area.innerHTML = `<div class="inline-item-form"><h5>${editRow ? "Edit" : "Add"} ${entity.label.replace(/s$/, "")}</h5>${itemHint}
        <form id="modal-inline-item-form" data-entity-form="${childSlug}">
            <input type="hidden" name="id" value="${editRow?.id || ""}">
            <input type="hidden" name="${parentField}" value="${parentId}">
            ${childSlug === "order-items" ? `<input type="hidden" name="status" value="${stage === "finished" || stage === "pending_delivery" ? "finalized" : "rough"}">` : ""}
            <div class="field-grid two-col">${formFields.map((field) => renderField(field, childSlug)).join("")}</div>
            <div class="form-actions">
                <button type="submit" class="primary-action compact-action">Save</button>
                <button type="button" class="ghost-action compact-action" data-cancel-inline-form>Cancel</button>
            </div>
        </form></div>`;
    /* Auto-scroll to reveal the inline form */
    area.scrollIntoView({ behavior: "smooth", block: "nearest" });
    rerenderLookupFields();
    initSearchableSelects(area);
    initStyledSelects(area);
    if (childSlug === "order-items") initStockItemSearch();
    if (childSlug === "order-items") syncOrderItemPurity(area);
    if (editRow) {
        const form = document.getElementById("modal-inline-item-form");
        entity.fields.forEach(f => {
            if (f.readOnly) return;
            const inp = form.querySelector(`[name="${f.name}"]`);
            if (!inp) return;
            const v = editRow[f.name];
            if (f.type === "checkbox") inp.checked = Boolean(v);
            else if (f.type === "datetime") inp.value = formatDateTimeLocal(v);
            else inp.value = v ?? "";
        });
        syncSearchableSelectDisplay(area);
        syncStyledSelectDisplays(area);
        syncStockItemSearchFromValue(childSlug, editRow);
        if (childSlug === "advance-receipts") {
            syncAdvanceReceiptDescriptionField(form, { clearWhenHidden: false });
        }
    } else if (childSlug === "advance-receipts") {
        const form = document.getElementById("modal-inline-item-form");
        const transactionInput = form?.querySelector('[name="transaction_type"]');
        if (transactionInput && !transactionInput.value) {
            transactionInput.value = "cash";
        }
        syncAdvanceReceiptDescriptionField(form);
    }
}

function showModalAdvanceForm(orderId, editRow = null) {
    const order = (state.hubs.orderbook.orders || []).find(r => String(r.id) === String(orderId));
    if (!order) return;
    const area = document.getElementById("modal-advance-form-area");
    if (!area) return;
    const advanceReceiptEntity = getEntity("advance-receipts");
    const transactionField = advanceReceiptEntity?.fields.find((field) => field.name === "transaction_type");
    const transOpts = transactionField?.options || [];
    const chevron = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    const selectedTransactionType = editRow?.transaction_type || "cash";
    const optionsDivs = transOpts.map((option) => `<div class="styled-select-option${option.value === selectedTransactionType ? " selected" : ""}" data-value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</div>`).join("");
    const receiptIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2z"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>`;
    const saveIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const cancelIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    const isEdit = !!editRow;

    const existingDatetimeISO = editRow ? (editRow.receipt_datetime || "") : "";
    const calendarIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

    const editBadge = isEdit ? `<span class="advance-form-edit-badge">Editing</span>` : "";
    const isOldOrnament = isEdit && isOldOrnamentAdvanceType(selectedTransactionType);
    const oovInfoNote = isOldOrnament
        ? `<div class="advance-form-info-note"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> Amount and description are managed via the linked receipt document.</div>`
        : "";

    area.innerHTML = `<div class="inline-item-form advance-receipt-form entity-modal-section">
        <div class="entity-modal-section-header">
            <span class="entity-modal-section-icon">${receiptIcon}</span>
            <span class="entity-modal-section-title">${isEdit ? "Edit" : "New"} Advance Receipt</span>
            ${editBadge}
        </div>
        ${oovInfoNote}
        <form id="modal-advance-inline-form" data-advance-receipt-form>
            <input type="hidden" name="id" value="${escapeHtml(editRow?.id || "")}"><input type="hidden" name="order_id" value="${orderId}">
            <input type="hidden" name="customer_id" value="${order.customer_id || ""}">
            <input type="hidden" name="receipt_id" value="${escapeHtml(editRow?.receipt_id || "")}">
            <input type="hidden" name="customer_name" value="${escapeHtml(order.customer_name || "")}">
            <input type="hidden" name="customer_contact_primary" value="${escapeHtml(order.customer_contact || "")}">
            <input type="hidden" name="customer_email" value="${escapeHtml(order.customer_email || "")}">
            <div class="field-grid two-col" style="padding:4px 18px 18px">
                <label><span>Receipt No</span><input name="receipt_no" value="${escapeHtml(editRow?.receipt_no || nextAdvanceReceiptNumber())}" required ${isEdit ? "readonly" : ""}></label>
                <label data-advance-datetime-wrapper>
                    <span>Receipt Date</span>
                    <div class="datetime-dropdown" data-datetime-dropdown>
                        <div class="datetime-input-wrap">
                            <input type="text" class="datetime-text-input" data-datetime-input placeholder="DD/MM/YYYY  HH:MM" autocomplete="off">
                            <button type="button" class="datetime-cal-btn" data-datetime-cal-btn>${calendarIcon}</button>
                        </div>
                        <div class="datetime-panel" data-datetime-panel></div>
                    </div>
                    <input type="hidden" name="receipt_datetime" value="${escapeHtml(existingDatetimeISO)}" required>
                </label>
                <label data-advance-field="transaction_type"><span>Transaction Type</span>
                    <div class="styled-select-wrap" data-styled-select-for="transaction_type">
                        <select name="transaction_type" required>${valueOptionsHtml(transOpts, selectedTransactionType)}</select>
                        <button type="button" class="styled-select-trigger" tabindex="0">
                            <span class="styled-select-trigger-text">${escapeHtml(formatOptionLabel(selectedTransactionType))}</span>
                            ${chevron}
                        </button>
                        <div class="styled-select-dropdown">
                            <div class="styled-select-options">
                                <div class="styled-select-option disabled" data-value="">Select</div>
                                ${optionsDivs}
                            </div>
                        </div>
                    </div>
                </label>
                <label data-advance-field="amount"><span>Amount</span><input name="amount" type="number" step="0.01" required placeholder="Enter amount" value="${escapeHtml(editRow?.amount ?? "")}"></label>
                <label class="full-width" data-advance-field="description"><span>Description</span><textarea name="valuation_description" rows="2" placeholder="Optional: Describe ornaments received, purity/weight checks, valuation notes">${escapeHtml(editRow?.valuation_description || "")}</textarea></label>
            </div>
            <div class="form-actions" style="padding:0 18px 14px">
                <button type="submit" class="primary-action compact-action">${saveIcon} ${isEdit ? "Update" : "Save"} Receipt</button>
                <button type="button" class="ghost-action compact-action" data-cancel-inline-form>${cancelIcon} Cancel</button>
            </div>
        </form>
    </div>`;
    area.scrollIntoView({ behavior: "smooth", block: "nearest" });
    initStyledSelects(area);
    /* Initialize custom datetime picker */
    const dtpWrapper = area.querySelector("[data-advance-datetime-wrapper]");
    if (dtpWrapper) initAdvanceDatetimePicker(dtpWrapper);
    syncAdvanceReceiptDescriptionField(document.getElementById("modal-advance-inline-form"), { clearWhenHidden: false });
}

/* ===== MODAL EDIT HEADER ===== */
async function openEditHeaderModal(slug, docId) {
    const entity = getEntity(slug);
    if (!entity) return;
    let row;
    if (slug === "orders") {
        row = (state.hubs.orderbook.orders || []).find(r => String(r.id) === String(docId));
    } else {
        row = (state.hubs.billing.documents || []).find(r => String(r.id) === String(docId));
    }
    if (!row) return;
    const excluded = new Set(["id", ...(slug === "orders" ? ["status"] : [])]);
    const fields = entity.fields.filter(f => !f.readOnly && !excluded.has(f.name));
    const formHtml = `<form id="modal-edit-header-form" class="modal-edit-form" data-entity-form="${slug}">
        <input type="hidden" name="${entity.primaryKey}" value="${row[entity.primaryKey] || ""}">
        ${fields.map((field) => renderField(field, slug)).join("")}
    </form>`;
    const backIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
    const backTarget = slug === "orders" ? `<button type="button" class="ghost-action compact-action" id="header-edit-back">${backIcon} Back</button>` : `<button type="button" class="ghost-action compact-action" id="header-edit-back">${backIcon} Back</button>`;
    openAppModal({
        kicker: entity.label,
        title: `Edit ${entity.label.replace(/s$/, "")}`,
        bodyHtml: formHtml,
        footerHtml: `${backTarget}
            <button type="button" class="primary-action" id="modal-edit-save">Save Changes</button>`,
        onOpen: () => {
            rerenderLookupFields();
            initSearchableSelects(appModalBody);
            initStyledSelects(appModalBody);
            if (entity.fields.some(isCustomerLookup)) initCustomerSearch();
            if (slug === "stock-items") initArtisanSearch();
            setFormValues(slug, row);
            if (slug === "orders") prefillOrderDateTime(document.getElementById("modal-edit-header-form"));
            syncCustomerSearchFromValue(slug, row);
            syncArtisanSearchFromValue(slug, row);
            syncSearchableSelectDisplay(appModalBody);
            syncStyledSelectDisplays(appModalBody);
            document.getElementById("header-edit-back")?.addEventListener("click", () => {
                closeAppModal();
                if (slug === "orders") openOrderDetailModal(docId);
                else openBillingDocumentModal(docId);
            });
            document.getElementById("modal-edit-save").addEventListener("click", async () => {
                try {
                    await requestJson(`/api/admin/${slug}`, { method: "POST", body: JSON.stringify(serializeForm(slug)) });
                    closeAppModal();
                    const tasks = [loadPortal()];
                    if (["invoices", "receipts"].includes(slug)) tasks.push(loadBillingHub(true));
                    if (slug === "orders") tasks.push(loadOrderbookHub(true));
                    await Promise.all(tasks);
                    await loadLookups(); rerenderLookupFields();
                    showToast("Saved");
                } catch (e) { showToast(e.message, true); }
            });
        }
    });
}

/* ===== ORDER VIEW MODAL (read-only) ===== */
function openOrderViewModal(orderId, activeTab = 0) {
    const order = (state.hubs.orderbook.orders || []).find(r => String(r.id) === String(orderId));
    if (!order) return;
    const entity = getEntity("orders");
    if (!entity) return;
    const allFields = ["order_number", "customer_id", "order_type", "order_datetime", "order_date", "promised_date", "status", "remarks"];
    const fieldMap = Object.fromEntries(entity.fields.map(f => [f.name, f]));
    const custName = order.customer_name || "";

    const sectionIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>`;
    const detailRows = allFields.map(k => {
        const f = fieldMap[k] || { label: k.replace(/_/g, " ") };
        let val = k === "customer_id" ? (custName || order[k]) : order[k];
        return `<div class="modal-detail-item"><span class="modal-detail-label">${escapeHtml(f.label)}</span><div class="modal-detail-value">${renderDetailValue(f, val)}</div></div>`;
    }).join("");

    /* Order items */
    const oItems = order.order_items || [];
    const oiCols = [{ key: "description", label: "Description" }, { key: "quantity", label: "Qty" }, { key: "purity", label: "Purity" }, { key: "status", label: "Status", render: v => badge(v) }];
    let oiTableHtml = "";
    if (oItems.length) {
        const head = oiCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join("");
        const body = oItems.map(row => {
            const cells = oiCols.map(c => `<td>${c.render ? c.render(row[c.key]) : escapeHtml(row[c.key] ?? "--")}</td>`).join("");
            return `<tr>${cells}</tr>`;
        }).join("");
        oiTableHtml = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    } else {
        oiTableHtml = `<p class="empty-state">No items yet.</p>`;
    }

    /* Advance receipts */
    const aReceipts = order.advance_receipts || [];
    const advanceTotal = aReceipts.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const arCols = [{ key: "receipt_no", label: "Receipt No" }, { key: "receipt_datetime", label: "Date", render: v => formatDateTime(v) }, { key: "transaction_type", label: "Type", render: v => badge(formatOptionLabel(v) || "--") }, { key: "amount", label: "Amount", render: v => formatCurrency(v) }, { key: "valuation_description", label: "Description", render: v => escapeHtml(v || "--") }];
    let arTableHtml = "";
    if (aReceipts.length) {
        const head = arCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join("");
        const body = aReceipts.map(row => {
            const cells = arCols.map(c => `<td>${c.render ? c.render(row[c.key]) : escapeHtml(row[c.key] ?? "--")}</td>`).join("");
            return `<tr>${cells}</tr>`;
        }).join("");
        arTableHtml = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    } else {
        arTableHtml = `<p class="empty-state">No advance receipts.</p>`;
    }

    const totalHtml = advanceTotal > 0 ? `<span class="modal-items-total">Total: ${formatCurrency(advanceTotal)}</span>` : "";

    /* Details tab: lifecycle visualization is always visible (read-only) + order detail grid */
    const detailHtml = `${buildOrderTimeline(order, true)}<div class="entity-modal-section" style="margin-top:14px">
        <div class="entity-modal-section-header">
            <span class="entity-modal-section-icon">${sectionIcon}</span>
            <span class="entity-modal-section-title">Order Details</span>
        </div>
        <div class="modal-detail-grid">${detailRows}</div>
    </div>`;

    const itemsHtml = `<div class="modal-items-header"><h4>Order Items <span class="items-count">${oItems.length}</span></h4></div><div class="table-shell">${oiTableHtml}</div>`;
    const receiptsHtml = `<div class="modal-items-header"><h4>Advance Receipts <span class="items-count">${aReceipts.length}</span></h4>${totalHtml}</div><div class="table-shell">${arTableHtml}</div>`;
    const notificationsHtml = buildOrderNotificationTabHtml(order);

    const editIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
    const deleteIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    const customerIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`;

    const customerBtnHtml = order.customer_id ? `<button type="button" class="secondary-action compact-action" id="order-view-customer">${customerIcon} View Customer</button>` : "";

    openAppModal({
        kicker: "Order",
        title: `${order.order_number || "Order"} · ${custName || "Walk-in"}`,
        tabs: [
            { label: "Details", html: detailHtml },
            { label: "Items", count: oItems.length, html: itemsHtml },
            { label: "Advances", count: aReceipts.length, html: receiptsHtml },
            { label: "Notifications", count: ((order.notifications && order.notifications.length) || getNotificationRows().filter((row) => String(row.order_id || "") === String(order.id || "")).length), html: notificationsHtml }
        ],
        activeTab,
        footerHtml: `
            ${customerBtnHtml}
            <button type="button" class="secondary-action compact-action" id="order-view-edit">${editIcon} Edit</button>
            <button type="button" class="ghost-action compact-action entity-modal-delete-btn" id="order-view-delete">${deleteIcon} Delete</button>
        `,
        onOpen: () => {
            document.getElementById("order-view-edit")?.addEventListener("click", () => {
                const tab = getActiveModalTab();
                closeAppModal();
                openOrderDetailModal(orderId, tab);
            });
            document.getElementById("order-view-delete")?.addEventListener("click", () => {
                closeAppModal();
                openDeleteConfirmModal("order", order.order_number || orderId, orderId, "orders");
            });
            document.getElementById("order-view-customer")?.addEventListener("click", () => {
                closeAppModal();
                const custId = order.customer_id;
                if (custId) {
                    navigateTo("customers");
                    loadEntityRows("customers", true).then(() => {
                        openCustomerDetailModal(custId);
                    });
                }
            });
        }
    });
}

function openLinkedReceiptFromAdvance(receiptId) {
    if (!receiptId) return;
    closeAppModal();
    navigateTo("billing-hub");
    refreshBillingDocument(receiptId, { reopenModalTab: 0, openView: true }).catch((error) => {
        console.error(error);
        showToast(error.message, true);
    });
}

function findAdvanceReceiptContext(advanceReceiptId, orderIdHint = "") {
    const orders = state.hubs.orderbook.orders || [];
    if (orderIdHint) {
        const hintedOrder = orders.find((row) => String(row.id) === String(orderIdHint));
        const hintedReceipt = (hintedOrder?.advance_receipts || []).find((row) => String(row.id) === String(advanceReceiptId));
        if (hintedOrder && hintedReceipt) return { order: hintedOrder, advanceReceipt: hintedReceipt };
    }
    for (const order of orders) {
        const advanceReceipt = (order.advance_receipts || []).find((row) => String(row.id) === String(advanceReceiptId));
        if (advanceReceipt) return { order, advanceReceipt };
    }
    return { order: null, advanceReceipt: null };
}

function openAdvanceReceiptViewModal(advanceReceiptId, { orderIdHint = "", returnReceiptId = "" } = {}) {
    const { order, advanceReceipt } = findAdvanceReceiptContext(advanceReceiptId, orderIdHint);
    if (!advanceReceipt) return;
    const arrowIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
    const linkIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
    const receiptCardHtml = advanceReceipt.receipt_id && isOldOrnamentAdvanceType(advanceReceipt.transaction_type)
        ? `<div class="advance-linked-strip" data-advance-linked-receipt="${advanceReceipt.receipt_id}">
            <span class="advance-linked-strip-icon">${linkIcon}</span>
            <span class="advance-linked-strip-label">Linked Receipt</span>
            <span class="advance-linked-strip-no">${escapeHtml(advanceReceipt.linked_receipt_no || "Receipt")}</span>
            <span class="advance-linked-strip-meta">${formatCurrency(advanceReceipt.amount)} · ${formatDateTime(advanceReceipt.receipt_datetime)}</span>
            <span class="advance-linked-strip-arrow">${arrowIcon}</span>
        </div>`
        : "";
    const linkedReceiptButton = advanceReceipt.receipt_id && isOldOrnamentAdvanceType(advanceReceipt.transaction_type)
        ? `<button type="button" class="secondary-action compact-action" id="advance-view-receipt">View Receipt</button>`
        : "";
    const paymentsButton = `<button type="button" class="secondary-action compact-action" id="advance-view-payments">Go to Payments</button>`;
    const backToReceiptButton = returnReceiptId
        ? `<button type="button" class="ghost-action compact-action" id="advance-view-back-receipt">Back to Receipt</button>`
        : "";
    const backToOrderButton = order?.id
        ? `<button type="button" class="ghost-action compact-action" id="advance-view-back-order">Back to Order</button>`
        : "";
    const hasDescription = !!advanceReceipt.valuation_description;
    const descriptionCard = hasDescription
        ? `<div class="advance-view-description">
            <span class="advance-view-desc-label">Description</span>
            <p class="advance-view-desc-text">${escapeHtml(advanceReceipt.valuation_description)}</p>
        </div>`
        : "";

    const detailHtml = `<div class="entity-modal-section">
        <div class="entity-modal-section-header">
            <span class="entity-modal-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2z"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg></span>
            <span class="entity-modal-section-title">Advance Receipt Details</span>
        </div>
        <div class="advance-view-amount-hero">
            <span class="advance-view-amount-label">Amount</span>
            <span class="advance-view-amount-value">${formatCurrency(advanceReceipt.amount)}</span>
        </div>
        <div class="modal-detail-grid" style="padding:4px 18px 14px">
            <div class="modal-detail-item"><span class="modal-detail-label">Receipt No</span><div class="modal-detail-value">${escapeHtml(advanceReceipt.receipt_no || "--")}</div></div>
            <div class="modal-detail-item"><span class="modal-detail-label">Receipt Date</span><div class="modal-detail-value">${formatDateTime(advanceReceipt.receipt_datetime)}</div></div>
            <div class="modal-detail-item"><span class="modal-detail-label">Transaction Type</span><div class="modal-detail-value">${badge(formatOptionLabel(advanceReceipt.transaction_type) || "--")}</div></div>
            <div class="modal-detail-item"><span class="modal-detail-label">Order</span><div class="modal-detail-value">${escapeHtml(order?.order_number || advanceReceipt.order_number || "--")}</div></div>
        </div>
        ${descriptionCard}
        ${receiptCardHtml}
    </div>`;

    openAppModal({
        kicker: "Advance Receipt",
        title: `${advanceReceipt.receipt_no || "Advance Receipt"}${order?.customer_name ? ` · ${order.customer_name}` : ""}`,
        bodyHtml: detailHtml,
        footerHtml: `${backToReceiptButton}${backToOrderButton}${paymentsButton}${linkedReceiptButton}`,
        onOpen: () => {
            document.querySelector("[data-advance-linked-receipt]")?.addEventListener("click", () => {
                openLinkedReceiptFromAdvance(advanceReceipt.receipt_id);
            });
            document.getElementById("advance-view-receipt")?.addEventListener("click", () => {
                openLinkedReceiptFromAdvance(advanceReceipt.receipt_id);
            });
            document.getElementById("advance-view-back-order")?.addEventListener("click", () => {
                closeAppModal();
                if (order?.id) openOrderDetailModal(order.id, 2);
            });
            document.getElementById("advance-view-back-receipt")?.addEventListener("click", () => {
                closeAppModal();
                if (returnReceiptId) openLinkedReceiptFromAdvance(returnReceiptId);
            });
            document.getElementById("advance-view-payments")?.addEventListener("click", () => {
                closeAppModal();
                openLinkedPaymentTransaction("advance_receipt", advanceReceipt.id, advanceReceipt);
            });
        },
    });
}

function openAdvanceReceiptsFromReceipt(doc) {
    const advanceReceipt = (doc?.linked_advance_receipts || []).find((row) => isOldOrnamentAdvanceType(row.transaction_type))
        || (doc?.linked_advance_receipts || [])[0];
    const orderId = advanceReceipt?.order_id;
    if (!orderId || !advanceReceipt?.id) return;
    closeAppModal();
    navigateTo("orderbook-hub");
    refreshOrderbookOrder(orderId).then(() => {
        openAdvanceReceiptViewModal(advanceReceipt.id, { orderIdHint: orderId, returnReceiptId: doc.id || "" });
    }).catch((error) => {
        console.error(error);
        showToast(error.message, true);
    });
}

function buildPaymentTenderDetailText(tender) {
    const mode = String(tender?.payment_mode || "").trim();
    const label = String(tender?.instrument_label || "").trim();
    const number = String(tender?.instrument_number || "").trim();
    const account = String(tender?.account_number || "").trim();
    if (mode === "cheque") {
        return [number ? `Cheque No: ${number}` : "", label ? `Bank: ${label}` : ""].filter(Boolean).join(" · ") || "--";
    }
    if (mode === "card") {
        return [label ? `Bank: ${label}` : "", number ? `Card No: ${number}` : ""].filter(Boolean).join(" · ") || "--";
    }
    if (mode === "bank_transfer") {
        return [label ? `Bank: ${label}` : "", account ? `A/C: ${account}` : "", number ? `Ref: ${number}` : ""].filter(Boolean).join(" · ") || "--";
    }
    if (mode === "upi") {
        return [label ? `App: ${label}` : "", number ? `UPI Ref: ${number}` : ""].filter(Boolean).join(" · ") || "--";
    }
    if (mode === "adjustment") {
        return label || "Old Gold + Advance";
    }
    return label || "--";
}

function buildPaymentTenderTabHtml(payment) {
    const tenders = payment.tenders || [];
    const cols = [
        { key: "payment_mode", label: "Mode", render: (value) => badge(value === "adjustment" ? "Old Gold + Advance" : formatOptionLabel(value) || "--") },
        { key: "amount", label: "Amount", render: (value) => formatCurrency(value) },
        { key: "details", label: "Details", render: (_value, row) => escapeHtml(buildPaymentTenderDetailText(row)) },
    ];
    const editIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
    const deleteIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
    const addButton = payment.id
        ? `<button type="button" class="primary-action compact-action" id="payment-tender-add">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Payment Mode
        </button>`
        : "";
    if (!payment.id) {
        return `<div class="modal-items-header"><h4>Payment Modes <span class="items-count">0</span></h4></div><p class="empty-state">Save the payment first to add its tender breakup.</p><div id="payment-tender-form-area"></div>`;
    }
    let tableHtml = `<p class="empty-state">No payment modes added yet.</p>`;
    if (tenders.length) {
        const head = cols.map((col) => `<th>${escapeHtml(col.label)}</th>`).join("") + "<th>Actions</th>";
        const body = tenders.map((tender) => {
            const cells = cols.map((col) => `<td>${col.render ? col.render(tender[col.key], tender) : escapeHtml(tender[col.key] ?? "--")}</td>`).join("");
            return `<tr>
                ${cells}
                <td class="row-actions">
                    <button type="button" class="table-action" data-payment-tender-edit="${tender.id}">${editIcon} Edit</button>
                    <button type="button" class="table-action danger" data-payment-tender-delete="${tender.id}">${deleteIcon} Delete</button>
                </td>
            </tr>`;
        }).join("");
        tableHtml = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    return `<div class="modal-items-header"><h4>Payment Modes <span class="items-count">${tenders.length}</span></h4>${addButton}</div><div class="table-shell">${tableHtml}</div><div id="payment-tender-form-area"></div>`;
}

function syncPaymentTransactionLinkFields(form) {
    if (!form) return;
    const sourceType = form.querySelector('[name="source_type"]')?.value || "";
    const sourceFieldMap = {
        invoice: "invoice_id",
        receipt: "receipt_id",
        advance_receipt: "advance_receipt_id",
    };
    ["invoice_id", "receipt_id", "advance_receipt_id"].forEach((fieldName) => {
        const input = form.querySelector(`[name="${fieldName}"]`);
        const fieldWrap = input?.closest("label");
        if (!fieldWrap) return;
        const shouldShow = sourceFieldMap[sourceType] === fieldName;
        fieldWrap.hidden = !shouldShow;
        if (!shouldShow) input.value = "";
    });
}

function syncPaymentTenderFieldLabels(form) {
    if (!form) return;
    const mode = form.querySelector('[name="payment_mode"]')?.value || "";
    const labelInput = form.querySelector('[name="instrument_label"]');
    const numberInput = form.querySelector('[name="instrument_number"]');
    const accountInput = form.querySelector('[name="account_number"]');
    const labelWrap = labelInput?.closest("label");
    const numberWrap = numberInput?.closest("label");
    const accountWrap = accountInput?.closest("label");
    if (!labelInput || !numberInput || !accountInput || !labelWrap || !numberWrap || !accountWrap) return;

    labelWrap.hidden = false;
    numberWrap.hidden = false;
    accountWrap.hidden = true;
    labelInput.placeholder = "Optional details";
    numberInput.placeholder = "Reference number";
    accountInput.placeholder = "Account number";
    labelWrap.querySelector("span").textContent = "Details";
    numberWrap.querySelector("span").textContent = "Reference";
    accountWrap.querySelector("span").textContent = "Account Number";

    if (mode === "cash") {
        labelWrap.hidden = true;
        numberWrap.hidden = true;
        accountWrap.hidden = true;
        labelInput.value = "";
        numberInput.value = "";
        accountInput.value = "";
        return;
    }
    if (mode === "upi") {
        labelWrap.querySelector("span").textContent = "UPI App";
        numberWrap.querySelector("span").textContent = "UPI Ref No";
        labelInput.placeholder = "PhonePe / GPay / BHIM";
        numberInput.placeholder = "UPI reference";
        return;
    }
    if (mode === "card") {
        labelWrap.querySelector("span").textContent = "Card Bank Name";
        numberWrap.querySelector("span").textContent = "Card Number";
        labelInput.placeholder = "Issuing bank";
        numberInput.placeholder = "Last 4 digits / card ref";
        return;
    }
    if (mode === "cheque") {
        labelWrap.querySelector("span").textContent = "Bank Name";
        numberWrap.querySelector("span").textContent = "Cheque Number";
        labelInput.placeholder = "Cheque bank";
        numberInput.placeholder = "Cheque no";
        return;
    }
    if (mode === "bank_transfer") {
        labelWrap.querySelector("span").textContent = "Bank Name";
        numberWrap.querySelector("span").textContent = "Transfer Reference";
        accountWrap.hidden = false;
        labelInput.placeholder = "Sender / receiver bank";
        numberInput.placeholder = "Transfer ref";
        return;
    }
    if (mode === "adjustment") {
        labelWrap.querySelector("span").textContent = "Adjustment Label";
        numberWrap.hidden = true;
        accountWrap.hidden = true;
        labelInput.placeholder = "Old Gold + Advance";
        numberInput.value = "";
        accountInput.value = "";
    }
}

function showPaymentTenderForm(paymentId, editRow = null) {
    const entity = getEntity("payment-transaction-tenders");
    const area = document.getElementById("payment-tender-form-area");
    if (!entity || !area) return;
    const excluded = new Set(["id", "payment_transaction_id"]);
    const fields = entity.fields.filter((field) => !field.readOnly && !excluded.has(field.name));
    area.innerHTML = `<div class="inline-item-form">
        <h5>${editRow ? "Edit" : "Add"} Payment Mode</h5>
        <form id="payment-tender-inline-form" data-payment-tender-form>
            <input type="hidden" name="id" value="${escapeHtml(editRow?.id || "")}">
            <input type="hidden" name="payment_transaction_id" value="${escapeHtml(paymentId)}">
            <div class="field-grid two-col">
                ${fields.map((field) => renderField(field, "payment-transaction-tenders")).join("")}
            </div>
            <div class="form-actions">
                <button type="submit" class="primary-action compact-action">Save</button>
                <button type="button" class="ghost-action compact-action" id="payment-tender-cancel">Cancel</button>
            </div>
        </form>
    </div>`;
    rerenderLookupFields();
    initSearchableSelects(area);
    initStyledSelects(area);
    if (editRow) {
        const form = document.getElementById("payment-tender-inline-form");
        setFormValues("payment-transaction-tenders", editRow, form);
        syncSearchableSelectDisplay(area);
        syncStyledSelectDisplays(area);
    }
    const form = document.getElementById("payment-tender-inline-form");
    syncPaymentTenderFieldLabels(form);
    form?.querySelector('[name="payment_mode"]')?.addEventListener("change", () => syncPaymentTenderFieldLabels(form));
    document.getElementById("payment-tender-cancel")?.addEventListener("click", () => {
        area.innerHTML = "";
    });
}

async function refreshPaymentTransaction(recordId, { reopenModalTab = 0, openModal = true } = {}) {
    await Promise.all([loadEntityRows("payment-transactions", true), loadLookups()]);
    rerenderLookupFields();
    renderAllVisibleTables();
    if (openModal && recordId) {
        openPaymentTransactionModal(recordId, { activeTab: reopenModalTab });
    }
}

async function openLinkedPaymentTransaction(sourceType, documentId, fallbackRow = null) {
    try {
        navigateTo("payment-transactions");
        await loadEntityRows("payment-transactions", true);
        const payment = findPaymentTransactionByDocument(sourceType, documentId);
        if (payment) {
            openPaymentTransactionModal(payment.id);
            return;
        }
        const draft = {
            ...getPaymentTransactionDefaults(),
            direction: paymentDirectionForSourceType(sourceType),
            source_type: sourceType,
            total_amount: fallbackRow?.amount_received ?? fallbackRow?.amount ?? 0,
            transaction_datetime: fallbackRow?.document_datetime || fallbackRow?.receipt_datetime || fallbackRow?.invoice_datetime || new Date().toISOString(),
            customer_id: fallbackRow?.customer_id || "",
            invoice_id: sourceType === "invoice" ? documentId : "",
            receipt_id: sourceType === "receipt" ? documentId : "",
            advance_receipt_id: sourceType === "advance_receipt" ? documentId : "",
            reference_no: fallbackRow?.document_number || fallbackRow?.receipt_no || fallbackRow?.invoice_no || "",
            remarks: "",
        };
        showToast("No linked payment row was found, so a prefilled draft has been opened.", true);
        openPaymentTransactionModal("", { row: draft });
    } catch (error) {
        console.error(error);
        showToast(error.message, true);
    }
}

function openPaymentTransactionModal(recordId = "", { activeTab = 0, row = null, backFn = null } = {}) {
    const entity = getEntity("payment-transactions");
    if (!entity) return;
    const payment = row || findPaymentTransaction(recordId) || { ...getPaymentTransactionDefaults() };
    const linkedRecord = getPaymentTransactionLinkedRecord(payment);
    const fieldNames = ["transaction_datetime", "direction", "source_type", "invoice_id", "receipt_id", "advance_receipt_id", "total_amount", "reference_no", "remarks"];
    const formHtml = `<div class="entity-modal-section">
        <div class="entity-modal-section-header">
            <span class="entity-modal-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></span>
            <span class="entity-modal-section-title">Payment Details</span>
        </div>
        <form id="payment-transaction-form" class="entity-modal-form" data-entity-form="payment-transactions">
            <input type="hidden" name="id" value="${escapeHtml(payment.id || "")}">
            <input type="hidden" name="transaction_number" value="${escapeHtml(payment.transaction_number || "")}">
            <div class="field-grid two-col">
                ${fieldNames.map((name) => {
        const field = entity.fields.find((entry) => entry.name === name);
        return field ? renderField(field, "payment-transactions") : "";
    }).join("")}
            </div>
        </form>
    </div>`;
    const tendersHtml = buildPaymentTenderTabHtml(payment);
    const backIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
    const footerParts = [];
    if (backFn) {
        footerParts.push(`<button type="button" class="ghost-action compact-action" id="payment-modal-back">${backIcon} Back</button>`);
    }
    if (linkedRecord) {
        footerParts.push(`<button type="button" class="secondary-action compact-action" id="payment-modal-linked">${escapeHtml(linkedRecord.buttonLabel)}</button>`);
    }
    if (payment.id) {
        footerParts.push(`<button type="button" class="ghost-action compact-action entity-modal-delete-btn" id="payment-modal-delete">Delete</button>`);
    }
    footerParts.push(`<button type="button" class="primary-action compact-action" id="payment-modal-save">Save Payment</button>`);

    openAppModal({
        kicker: "Payments",
        title: payment.document_number || payment.transaction_number || "Payment Transaction",
        tabs: [
            { label: "Details", html: formHtml },
            { label: "Payment Modes", count: (payment.tenders || []).length, html: tendersHtml },
        ],
        activeTab,
        footerHtml: footerParts.join(""),
        onOpen: () => {
            const form = document.getElementById("payment-transaction-form");
            rerenderLookupFields();
            initSearchableSelects(appModalBody);
            initStyledSelects(appModalBody);
            setFormValues("payment-transactions", payment, form);
            syncSearchableSelectDisplay(appModalBody);
            syncStyledSelectDisplays(appModalBody);
            syncPaymentTransactionLinkFields(form);
            syncPaymentTransactionDirection(form);
            form?.querySelector('[name="source_type"]')?.addEventListener("change", () => {
                syncPaymentTransactionLinkFields(form);
                syncPaymentTransactionDirection(form);
            });

            document.getElementById("payment-modal-back")?.addEventListener("click", () => {
                closeAppModal();
                backFn?.();
            });
            document.getElementById("payment-modal-linked")?.addEventListener("click", () => {
                closeAppModal();
                if (!linkedRecord) return;
                if (linkedRecord.sourceType === "invoice" || linkedRecord.sourceType === "receipt") {
                    navigateTo("billing-hub");
                    refreshBillingDocument(linkedRecord.id, { openView: true, reopenModalTab: 0 }).catch((error) => {
                        console.error(error);
                        showToast(error.message, true);
                    });
                    return;
                }
                if (linkedRecord.sourceType === "advance_receipt") {
                    const context = findAdvanceReceiptContext(linkedRecord.id, payment.advance_order_id || "");
                    if (!context.advanceReceipt) {
                        if (!payment.advance_order_id) {
                            showToast("Linked advance receipt could not be found.", true);
                            return;
                        }
                        navigateTo("orderbook-hub");
                        refreshOrderbookOrder(payment.advance_order_id).then(() => {
                            openAdvanceReceiptViewModal(linkedRecord.id, { orderIdHint: payment.advance_order_id });
                        }).catch((error) => {
                            console.error(error);
                            showToast(error.message || "Linked advance receipt could not be found.", true);
                        });
                        return;
                    }
                    navigateTo("orderbook-hub");
                    refreshOrderbookOrder(context.order?.id || context.advanceReceipt.order_id || payment.advance_order_id || "").then(() => {
                        openAdvanceReceiptViewModal(linkedRecord.id, { orderIdHint: context.order?.id || context.advanceReceipt.order_id || payment.advance_order_id || "" });
                    }).catch((error) => {
                        console.error(error);
                        showToast(error.message, true);
                    });
                }
            });
            document.getElementById("payment-modal-delete")?.addEventListener("click", () => {
                closeAppModal();
                openEntityDeleteConfirmModal("payment-transactions", payment.id);
            });
            document.getElementById("payment-modal-save")?.addEventListener("click", async () => {
                try {
                    const response = await requestJson("/api/admin/payment-transactions", {
                        method: "POST",
                        body: JSON.stringify(serializeForm("payment-transactions", form)),
                    });
                    const savedId = response.row?.id || payment.id;
                    await refreshPaymentTransaction(savedId, { reopenModalTab: getActiveModalTab() });
                    showToast("Payment saved");
                } catch (error) {
                    console.error(error);
                    showToast(error.message, true);
                }
            });
            document.getElementById("payment-tender-add")?.addEventListener("click", () => {
                showPaymentTenderForm(payment.id);
            });
            const tenderPanel = appModalBody.querySelector('[data-modal-tab-panel="1"]') || appModalBody;
            tenderPanel.addEventListener("click", async (event) => {
                const editBtn = event.target.closest("[data-payment-tender-edit]");
                if (editBtn) {
                    const tender = (findPaymentTransaction(payment.id)?.tenders || []).find((row) => String(row.id) === String(editBtn.dataset.paymentTenderEdit));
                    if (tender) showPaymentTenderForm(payment.id, tender);
                    return;
                }
                const deleteBtn = event.target.closest("[data-payment-tender-delete]");
                if (deleteBtn) {
                    try {
                        await deleteEntity("payment-transaction-tenders", deleteBtn.dataset.paymentTenderDelete, {
                            parentId: payment.id,
                            reopenModalTab: 1,
                        });
                    } catch (error) {
                        console.error(error);
                    }
                }
            });
            tenderPanel.addEventListener("submit", async (event) => {
                const tenderForm = event.target.closest("[data-payment-tender-form]");
                if (!tenderForm) return;
                event.preventDefault();
                try {
                    await requestJson("/api/admin/payment-transaction-tenders", {
                        method: "POST",
                        body: JSON.stringify(serializeForm("payment-transaction-tenders", tenderForm)),
                    });
                    await refreshPaymentTransaction(payment.id, { reopenModalTab: 1 });
                    showToast("Payment mode saved");
                } catch (error) {
                    console.error(error);
                    showToast(error.message, true);
                }
            });
        },
    });
}

/* ===== BILLING DOCUMENT VIEW MODAL (read-only) ===== */
function openBillingDocumentViewModal(docId, activeTab = 0) {
    const doc = (state.hubs.billing.documents || []).find(r => String(r.id) === String(docId));
    if (!doc) return;
    const isInvoice = doc.document_type === "invoice";
    const slug = isInvoice ? "invoices" : "receipts";
    const entity = getEntity(slug);
    if (!entity) return;

    const headerFields = getBillingDocumentHeaderFields(doc, isInvoice);
    const fieldMap = Object.fromEntries(entity.fields.map(f => [f.name, f]));

    const sectionIcon = isInvoice
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2z"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>`;

    const detailRows = headerFields.map((entry) => {
        const key = typeof entry === "string" ? entry : entry.key;
        const customLabel = typeof entry === "string" ? "" : entry.label || "";
        const f = fieldMap[key] || { label: key.replace(/_/g, " ") };
        return `<div class="modal-detail-item"><span class="modal-detail-label">${escapeHtml(customLabel || f.label)}</span><div class="modal-detail-value">${renderDetailValue(f, doc[key])}</div></div>`;
    }).join("");

    /* Line items */
    const items = doc.line_items || [];
    const itemsTotal = items.reduce((sum, r) => sum + Number(r.line_total_amount || 0), 0);
    const itemCols = [{ key: "line_no", label: "Line" }, { key: "description", label: "Description" }, { key: "quantity", label: "Qty" }, { key: "purity", label: "Purity" }, { key: "line_total_amount", label: "Total", render: v => formatCurrency(v) }];
    let itemsTableHtml = "";
    if (items.length) {
        const head = itemCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join("");
        const body = items.map(row => {
            const cells = itemCols.map(c => `<td>${c.render ? c.render(row[c.key]) : escapeHtml(row[c.key] ?? "--")}</td>`).join("");
            return `<tr>${cells}</tr>`;
        }).join("");
        itemsTableHtml = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    } else {
        itemsTableHtml = `<p class="empty-state">No line items.</p>`;
    }
    const itemsTotalHtml = itemsTotal > 0 ? `<span class="modal-items-total">Total: ${formatCurrency(itemsTotal)}</span>` : "";
    const itemsHtml = `<div class="modal-items-header"><h4>${isInvoice ? "Invoice" : "Receipt"} Items <span class="items-count">${items.length}</span></h4>${itemsTotalHtml}</div><div class="table-shell">${itemsTableHtml}</div>`;

    const editIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
    const deleteIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    const customerIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`;

    const customerId = doc.customer_id;
    const customerBtnHtml = customerId ? `<button type="button" class="secondary-action compact-action" id="doc-view-customer">${customerIcon} View Customer</button>` : "";
    const linkedOldValuationAdvance = !isInvoice
        ? (doc.linked_advance_receipts || []).find((row) => isOldOrnamentAdvanceType(row.transaction_type))
        : null;
    const arrowIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
    const linkedAdvanceCardHtml = linkedOldValuationAdvance
        ? `<div class="entity-modal-section">
            <div class="entity-modal-section-header">
                <span class="entity-modal-section-icon">${sectionIcon}</span>
                <span class="entity-modal-section-title">Linked Advance Receipt</span>
            </div>
            <div class="customer-linked-card" data-doc-linked-advance="${linkedOldValuationAdvance.id}">
                <div class="customer-linked-card-icon">${sectionIcon}</div>
                <div class="customer-linked-card-body">
                    <div class="customer-linked-card-header">
                        <span class="linked-title">${escapeHtml(linkedOldValuationAdvance.receipt_no || "Advance Receipt")}</span>
                        ${badge(formatOptionLabel(linkedOldValuationAdvance.transaction_type) || "linked")}
                    </div>
                    <div class="customer-linked-card-meta">
                        <span>${formatCurrency(linkedOldValuationAdvance.amount)}</span>
                        <span>${escapeHtml(linkedOldValuationAdvance.order_number || "--")}</span>
                    </div>
                </div>
                <div class="customer-linked-card-action">${arrowIcon}</div>
            </div>
        </div>`
        : "";
    const detailHtml = `<div class="entity-modal-section">
        <div class="entity-modal-section-header">
            <span class="entity-modal-section-icon">${sectionIcon}</span>
            <span class="entity-modal-section-title">${isInvoice ? "Invoice" : "Receipt"} Details</span>
        </div>
        <div class="modal-detail-grid">${detailRows}</div>
    </div>${!isInvoice ? linkedAdvanceCardHtml : ""}`;
    const viewAdvancesBtnHtml = linkedOldValuationAdvance
        ? `<button type="button" class="secondary-action compact-action" id="doc-view-advances">Go to Advance Receipt</button>`
        : "";
    const viewPaymentsBtnHtml = `<button type="button" class="secondary-action compact-action" id="doc-view-payments">Go to Payments</button>`;

    openAppModal({
        kicker: doc.document_type,
        title: `${doc.document_no || "Document"} · ${doc.customer_name || "Walk-in"}`,
        tabs: [{ label: "Details", html: detailHtml }, { label: "Items", count: items.length, html: itemsHtml }],
        activeTab,
        footerHtml: `
            ${customerBtnHtml}
            ${viewPaymentsBtnHtml}
            ${viewAdvancesBtnHtml}
            <button type="button" class="secondary-action compact-action" id="doc-view-edit">${editIcon} Edit</button>
            <button type="button" class="ghost-action compact-action entity-modal-delete-btn" id="doc-view-delete">${deleteIcon} Delete</button>
        `,
        onOpen: () => {
            document.getElementById("doc-view-edit")?.addEventListener("click", () => {
                const tab = getActiveModalTab();
                closeAppModal();
                openBillingDocumentModal(docId, tab);
            });
            document.getElementById("doc-view-delete")?.addEventListener("click", () => {
                closeAppModal();
                const delSlug = doc.document_type === "invoice" ? "invoices" : "receipts";
                openDeleteConfirmModal(doc.document_type, doc.document_no || docId, docId, delSlug);
            });
            document.querySelector("[data-doc-linked-advance]")?.addEventListener("click", () => {
                openAdvanceReceiptsFromReceipt(doc);
            });
            document.getElementById("doc-view-customer")?.addEventListener("click", () => {
                closeAppModal();
                if (customerId) {
                    navigateTo("customers");
                    loadEntityRows("customers", true).then(() => {
                        openCustomerDetailModal(customerId);
                    });
                }
            });
            document.getElementById("doc-view-advances")?.addEventListener("click", () => {
                openAdvanceReceiptsFromReceipt(doc);
            });
            document.getElementById("doc-view-payments")?.addEventListener("click", () => {
                closeAppModal();
                openLinkedPaymentTransaction(doc.document_type, doc.id, doc);
            });
        }
    });
}

bootstrap();
