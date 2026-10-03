/* ═══════════════════════════════════════════════
   GST Invoice Generator — App Logic
   ═══════════════════════════════════════════════ */

const initialData = JSON.parse(document.getElementById("initial-data").textContent);
const DOCUMENT_LAYOUT_SETTING_KEYS = ["invoice_item_limit", "receipt_item_limit", "hallmark_charge_per_item", "include_terms_and_conditions"];
let committedDocumentLayoutSettings = Object.fromEntries(DOCUMENT_LAYOUT_SETTING_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(initialData.document_settings || {}, key))
    .map((key) => [key, initialData.document_settings[key]]));
const form = document.getElementById("invoice-form");
const itemsContainer = document.getElementById("items-container");
const invoiceItemTemplate = document.getElementById("item-template-invoice");
const receiptItemTemplate = document.getElementById("item-template-receipt");
const previewFrame = document.getElementById("preview-frame");
const previewTitle = document.getElementById("preview-title");
const statusChip = document.getElementById("status-chip");
const resultLinks = document.getElementById("result-links");
const refreshPreviewButton = document.getElementById("refresh-preview");
const generateButton = document.getElementById("generate-pdf");
const addItemButton = document.getElementById("add-item");
const workspacePanel = document.getElementById("workspace-panel");
const itemCountBadge = document.getElementById("item-count-badge");
const viewSwitcher = document.getElementById("view-switcher");
const viewInvoice = document.getElementById("view-invoice");
const viewReceipt = document.getElementById("view-receipt");
const invoiceNoLabel = document.getElementById("invoice-no-label");
const orderNoLabel = document.getElementById("order-no-label");
const sectionTitleInvoice = document.getElementById("section-title-invoice");
const paymentsSectionTitle = document.getElementById("payments-section-title");
const amountReceivedLabel = document.getElementById("amount-received-label");
const customerMatchPanel = document.getElementById("customer-match-panel");
const documentMatchPanel = document.getElementById("document-match-panel");

const settingsToggleButton = document.getElementById("settings-toggle");
const settingsDrawer = document.getElementById("settings-drawer");
const exchangeModeToggle = document.getElementById("exchange-mode-toggle");

let previewTimer = null;
let activePreviewTarget = "preview-top";
let pendingPreviewTarget = "preview-top";
let currentDocType = "invoice";
let syncingFinancialFields = false;
let isHydratingView = false;
let customerLookupTimer = null;
let orderLookupTimer = null;
let linkedInvoiceLookupTimer = null;
let linkedReceiptLookupTimer = null;
let currentDocumentLookupTimer = null;
const pageParams = new URLSearchParams(window.location.search);
const workflowContext = {
    advance_receipt_id: pageParams.get("advance_receipt_id") || "",
    return_order_id: pageParams.get("return_order_id") || "",
    return_tab: pageParams.get("return_tab") || "",
    return_to_portal: ["1", "true", "yes", "on"].includes(String(pageParams.get("return_to_portal") || "").toLowerCase()),
};

const GOLD_HSN_CODES = new Set(["71131910", "71131920", "71131930", "71131940", "71131960", "71131990", "71132000"]);
const GOLD_SEMI_MANUFACTURED_CODES = new Set(["71081200", "71081300", "71082000", "71090000"]);
const GOLD_ARTICLES_CODES = new Set(["71141910", "71141930", "71142010", "71142020", "71142030"]);
const SILVER_HSN_CODES = new Set(["71131110", "71131120", "71131130", "71131190"]);
const SILVER_SEMI_MANUFACTURED_CODES = new Set(["71069100", "71069210", "71069290", "71070000"]);
const SILVER_ARTICLES_CODES = new Set(["71141110", "71141120"]);
const IMITATION_HSN_CODES = new Set(["71179010", "71171990", "71179090", "71171100", "71171910", "71171920"]);
const PEARL_ARTICLES_HSN_CODES = new Set(["71161000", "71162000"]);
const PEARL_LOOSE_HSN_CODES = new Set(["71011010", "71011020", "71012100", "71012200"]);
const STONE_HSN_CODES = new Set(["71039110", "71039120", "71039130", "71039911", "71039912", "71039913", "71039919", "71039921", "71039929", "71039931", "71039932", "71039939", "71039941", "71039942", "71039943", "71039944", "71039949", "71039951", "71039952", "71039959", "71039990"]);
const ALL_GOLD_HSN_CODES = new Set([...GOLD_HSN_CODES, ...GOLD_SEMI_MANUFACTURED_CODES, ...GOLD_ARTICLES_CODES]);
const ALL_SILVER_HSN_CODES = new Set([...SILVER_HSN_CODES, ...SILVER_SEMI_MANUFACTURED_CODES, ...SILVER_ARTICLES_CODES]);
const ALL_STONE_CATEGORY_HSN_CODES = new Set([...STONE_HSN_CODES, ...PEARL_ARTICLES_HSN_CODES, ...PEARL_LOOSE_HSN_CODES]);

/* Per-code descriptive labels (sourced from master_portal HSN_FIELD_OPTIONS) */
const HSN_CODE_LABELS = {
    // ── Gold Jewellery ──
    "71131910": "Gold Jewellery Unstudded (Plain)",
    "71131920": "Gold Jewellery Set with Pearls (Studded)",
    "71131930": "Gold Jewellery Set with Diamonds (Studded)",
    "71131940": "Gold Jewellery Set with Other Precious & Semi-Precious Stones (Studded)",
    "71131960": "Parts (Gold Jewellery)",
    "71131990": "Others",
    "71132000": "Gold Jewellery Clad with Precious Metal",
    // ── Gold Semi-Manufactured ──
    "71081200": "Gold Unwrought (Bars)",
    "71081300": "Gold (Other Semi-Manufactured Forms)",
    "71082000": "Gold (Monetary)",
    "71090000": "Base Metals or Silver Clad with Gold, Not Further Worked than Semi-Manufactured",
    // ── Gold Articles ──
    "71141910": "Articles of Gold (Whether or Not Plated or Clad with Precious Metal)",
    "71141930": "Parts (Articles of Gold)",
    "71142010": "Articles Clad with Base Metal Gold",
    "71142020": "Other Articles (Base Metal Gold)",
    "71142030": "Parts (Articles of Base Metal Gold)",
    // ── Silver Jewellery ──
    "71131110": "Silver Jewellery with Filigree Work",
    "71131120": "Silver Jewellery Studded with Gems",
    "71131130": "Other Articles of Silver Jewellery",
    "71131190": "Parts (Silver Jewellery)",
    // ── Silver Semi-Manufactured ──
    "71069100": "Silver Unwrought (Bars)",
    "71069210": "Silver in Semi-Manufactured Form (Sheets, Plates, Strips, Tubes and Pipes)",
    "71069290": "Silver in Semi-Manufactured Form (Others)",
    "71070000": "Base Metals Clad with Silver, Not Further Worked than Semi-Manufactured",
    // ── Silver Articles ──
    "71141110": "Articles of Silver (Whether or Not Plated or Clad with Precious Metal)",
    "71141120": "Parts of Silver (Whether or Not Plated or Clad with Precious Metal)",
    // ── Imitation Jewellery ──
    "71179010": "Jewellery Studded with Imitation Pearls or Imitation or Synthetic Stones",
    "71171990": "Other Imitation Jewellery (Plain)",
    "71179090": "Other Imitation Jewellery (Studded)",
    "71171100": "Cuff-Links (Imitation Jewellery)",
    "71171910": "Bangles (Imitation Jewellery)",
    "71171920": "German Silver Jewellery (Imitation Jewellery)",
    // ── Pearl / Precious & Semi-Precious Stone Articles ──
    "71161000": "Articles of Pearls (Natural or Cultured)",
    "71162000": "Articles of Precious or Semi-Precious Stones (Natural, Synthetic or Reconstructed)",
    // ── Pearls ──
    "71011010": "Natural Pearls Unworked",
    "71011020": "Natural Pearls Worked",
    "71012100": "Cultured Pearls Unworked",
    "71012200": "Cultured Pearls Worked",
    // ── Worked Precious / Semi-Precious Stones ──
    "71039110": "Ruby (Worked Precious Stones)",
    "71039120": "Sapphire (Worked Precious Stones)",
    "71039130": "Emeralds (Worked Precious Stones)",
    "71039911": "Yellow / Golden / Pink / Red / Green Beryl (Worked Semi-Precious Stones)",
    "71039912": "Chrysoberyl (Including Chrysoberyl Cat's Eye) (Worked Semi-Precious Stones)",
    "71039913": "Alexandrite (Including Alexandrite Cat's Eye) (Worked Semi-Precious Stones)",
    "71039919": "Others (Worked Semi-Precious Stones)",
    "71039921": "Moonstone (Worked Semi-Precious Stones)",
    "71039929": "Others (Worked Semi-Precious Stones)",
    "71039931": "Garnet (Worked Semi-Precious Stones)",
    "71039932": "Lapis-Lazuli (Worked Semi-Precious Stones)",
    "71039939": "Others (Worked Semi-Precious Stones)",
    "71039941": "Prehnite (Worked Semi-Precious Stones)",
    "71039942": "Agate (Worked Semi-Precious Stones)",
    "71039943": "Aventurine (Worked Semi-Precious Stones)",
    "71039944": "Chalcedony (Worked Semi-Precious Stones)",
    "71039949": "Other (Worked Semi-Precious Stones)",
    "71039951": "Tourmaline (Worked Semi-Precious Stones)",
    "71039952": "Tanzanite (Worked Semi-Precious Stones)",
    "71039959": "Other (Worked Semi-Precious Stones)",
    "71039990": "Others (Worked Semi-Precious Stones)",
};

function hsnOptions(codes) {
    return [...codes].map((code) => ({ code, shortDescription: HSN_CODE_LABELS[code] || code, example: "" }));
}

const HSN_CATEGORIES = [
    { label: "Gold Jewellery", options: hsnOptions(GOLD_HSN_CODES) },
    { label: "Gold Semi-Manufactured", options: hsnOptions(GOLD_SEMI_MANUFACTURED_CODES) },
    { label: "Gold Articles", options: hsnOptions(GOLD_ARTICLES_CODES) },
    { label: "Silver Jewellery", options: hsnOptions(SILVER_HSN_CODES) },
    { label: "Silver Semi-Manufactured", options: hsnOptions(SILVER_SEMI_MANUFACTURED_CODES) },
    { label: "Silver Articles", options: hsnOptions(SILVER_ARTICLES_CODES) },
    { label: "Imitation Jewellery", options: hsnOptions(IMITATION_HSN_CODES) },
    { label: "Pearl / Stone Articles", options: hsnOptions(PEARL_ARTICLES_HSN_CODES) },
    { label: "Loose Pearls", options: hsnOptions(PEARL_LOOSE_HSN_CODES) },
    { label: "Precious & Semi-Precious Stones (0.25% GST)", options: hsnOptions(STONE_HSN_CODES) },
];

const HSN_OPTIONS = HSN_CATEGORIES.flatMap((cat) => cat.options);

function detectItemCategory(hsnCode) {
    const code = String(hsnCode || "").trim();
    if (ALL_GOLD_HSN_CODES.has(code)) return "gold";
    if (ALL_SILVER_HSN_CODES.has(code)) return "silver";
    if (ALL_STONE_CATEGORY_HSN_CODES.has(code)) return "stone";
    if (IMITATION_HSN_CODES.has(code)) return "imitation";
    return "other";
}

const CATEGORIES_WITHOUT_MAKING_PERCENT = new Set(["silver", "stone", "imitation"]);
const CATEGORIES_WITHOUT_MAKING_CHARGES = new Set(["stone", "imitation"]);

function categoryAllowsMakingPercent(category) {
    return !CATEGORIES_WITHOUT_MAKING_PERCENT.has(category);
}

function categoryAllowsMakingCharges(category) {
    return !CATEGORIES_WITHOUT_MAKING_CHARGES.has(category);
}

const PURITY_OPTIONS = [
    "22K gold (916) · 91.6% pure, preferred for traditional jewellery and weddings",
    "24K gold (999) · 99.9% pure, mainly used in coins and bars",
    "18K gold (750) · 75% pure, commonly used in diamond-set jewellery",
    "14K gold (585) · 58.5% pure, typically for daily-wear or international designs",
    "9K gold (375) · 37.5% pure, permitted for low-budget or fashion jewellery projects since July 2025",
    "925",
    "999",
    "990",
    "970",
    "958",
    "835",
    "800",
];

const STATE_LIST = [
    // States
    { name: "Andhra Pradesh", iso: "IN-AP", gstCode: "37" },
    { name: "Arunachal Pradesh", iso: "IN-AR", gstCode: "12" },
    { name: "Assam", iso: "IN-AS", gstCode: "18" },
    { name: "Bihar", iso: "IN-BR", gstCode: "10" },
    { name: "Chhattisgarh", iso: "IN-CG", gstCode: "22" },
    { name: "Goa", iso: "IN-GA", gstCode: "30" },
    { name: "Gujarat", iso: "IN-GJ", gstCode: "24" },
    { name: "Haryana", iso: "IN-HR", gstCode: "06" },
    { name: "Himachal Pradesh", iso: "IN-HP", gstCode: "02" },
    { name: "Jharkhand", iso: "IN-JH", gstCode: "20" },
    { name: "Karnataka", iso: "IN-KA", gstCode: "29" },
    { name: "Kerala", iso: "IN-KL", gstCode: "32" },
    { name: "Madhya Pradesh", iso: "IN-MP", gstCode: "23" },
    { name: "Maharashtra", iso: "IN-MH", gstCode: "27" },
    { name: "Manipur", iso: "IN-MN", gstCode: "14" },
    { name: "Meghalaya", iso: "IN-ML", gstCode: "17" },
    { name: "Mizoram", iso: "IN-MZ", gstCode: "15" },
    { name: "Nagaland", iso: "IN-NL", gstCode: "13" },
    { name: "Odisha", iso: "IN-OR", gstCode: "21" },
    { name: "Punjab", iso: "IN-PB", gstCode: "03" },
    { name: "Rajasthan", iso: "IN-RJ", gstCode: "08" },
    { name: "Sikkim", iso: "IN-SK", gstCode: "11" },
    { name: "Tamil Nadu", iso: "IN-TN", gstCode: "33" },
    { name: "Telangana", iso: "IN-TG", gstCode: "36" },
    { name: "Tripura", iso: "IN-TR", gstCode: "16" },
    { name: "Uttar Pradesh", iso: "IN-UP", gstCode: "09" },
    { name: "Uttarakhand", iso: "IN-UK", gstCode: "05" },
    { name: "West Bengal", iso: "IN-WB", gstCode: "19" },
    // Union Territories
    { name: "Andaman & Nicobar", iso: "IN-AN", gstCode: "35" },
    { name: "Chandigarh", iso: "IN-CH", gstCode: "04" },
    { name: "Dadra & Nagar Haveli and Daman & Diu", iso: "IN-DH", gstCode: "26" },
    { name: "Delhi", iso: "IN-DL", gstCode: "07" },
    { name: "Jammu & Kashmir", iso: "IN-JK", gstCode: "01" },
    { name: "Ladakh", iso: "IN-LA", gstCode: "38" },
    { name: "Lakshadweep", iso: "IN-LD", gstCode: "31" },
    { name: "Puducherry", iso: "IN-PY", gstCode: "34" },
];

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getNamedField(name) {
    return form.querySelector(`[name="${name}"]`) || document.querySelector(`[name="${name}"][form="${form.id}"]`);
}

function toNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function toBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function escapeMarkup(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function createReceiptDraft(baseData) {
    const receiptData = deepClone(baseData);
    receiptData.document_type = "receipt";
    receiptData.invoice_info.invoice_no = baseData.document_sequence?.receipt_no || receiptData.invoice_info.invoice_no || "";
    receiptData.invoice_info.linked_reference_no = receiptData.invoice_info.linked_reference_no || "";
    receiptData.invoice_info.linked_invoice_no = baseData.invoice_info?.invoice_no || receiptData.invoice_info.linked_invoice_no || "";
    receiptData.invoice_info.linked_receipt_no = "";
    receiptData.invoice_info.copy_type = receiptData.invoice_info.copy_type || "Original for Buyer";
    receiptData.consignee_info = {
        name: "",
        address: "",
        contact: "",
        contact2: "",
        email: "",
        state_name: "West Bengal",
        pincode: "",
        pan_aadhaar: "",
        state_gst_code: "19",
    };
    receiptData.charges.sgst_percent = 0;
    receiptData.charges.cgst_percent = 0;
    receiptData.payment_info.discount = 0;
    receiptData.payment_info.round_off = 0;
    receiptData.payment_info.old_gold_advance = 0;
    receiptData.payment_info.less_invoice_amount = 0;
    receiptData.payment_info.net_amount = receiptData.payment_info.net_amount || "";
    receiptData.items = (receiptData.items || []).map((item) => {
        const grossWeight = toNumber(item.gross_weight);
        const netWeight = toNumber(item.net_weight);
        const fallbackNet = netWeight || grossWeight;
        const amount = toNumber(item.amount) || toNumber(item.gold_silver_amount);
        const ratePerGram = toNumber(item.rate_per_gram) || (fallbackNet > 0 ? amount / fallbackNet : 0);

        return {
            ...item,
            quantity: item.quantity || "1",
            stone_dust_deduction: toNumber(item.stone_dust_deduction || item.diamond_or_stone_weight),
            net_weight: fallbackNet,
            rate_per_gram: ratePerGram ? ratePerGram.toFixed(2) : "",
            amount: amount ? amount.toFixed(2) : "",
        };
    });
    return receiptData;
}

const documentDrafts = {
    invoice: { ...deepClone(initialData), document_type: "invoice" },
    receipt: createReceiptDraft(initialData),
};

function getOtherDocType(docType = currentDocType) {
    return docType === "invoice" ? "receipt" : "invoice";
}

function getSettingField(name) {
    return getNamedField(`document_settings.${name}`);
}

function isFeatureEnabled(name) {
    const field = getSettingField(name);
    if (!field) return false;
    if (field.type === "checkbox") return field.checked;
    return ["true", "1", "yes", "on"].includes(String(field.value || "").toLowerCase());
}

function getNumericSetting(name, fallback = 0) {
    const field = getSettingField(name);
    if (!field) return fallback;
    const parsed = parseFloat(field.value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function updateDraftPath(target, path, value) {
    const parts = path.split(".");
    let cursor = target;
    parts.forEach((part, index) => {
        if (index === parts.length - 1) {
            cursor[part] = value;
            return;
        }
        if (!cursor[part] || typeof cursor[part] !== "object") {
            cursor[part] = {};
        }
        cursor = cursor[part];
    });
}

function cloneCurrentSettingsIntoDrafts() {
    const currentSettings = serializeForm(currentDocType).document_settings || {};
    Object.values(documentDrafts).forEach((draft) => {
        draft.document_settings = { ...(draft.document_settings || {}), ...currentSettings };
    });
}

/* ── Custom State Dropdown ─────────────────── */
function buildStateOptions(container) {
    container.innerHTML = "";

    // States header
    const statesHeader = document.createElement("div");
    statesHeader.className = "state-category";
    statesHeader.textContent = "States";
    container.appendChild(statesHeader);

    // Build all items grouped
    const states = STATE_LIST.slice(0, 28);
    const uts = STATE_LIST.slice(28);

    states.forEach((s) => {
        container.appendChild(createStateOption(s));
    });

    // UT header
    const utHeader = document.createElement("div");
    utHeader.className = "state-category";
    utHeader.textContent = "Union Territories";
    container.appendChild(utHeader);

    uts.forEach((s) => {
        container.appendChild(createStateOption(s));
    });

    // No-results message
    const noResults = document.createElement("div");
    noResults.className = "state-no-results";
    noResults.textContent = "No matching states found";
    container.appendChild(noResults);
}

function createStateOption(s) {
    const row = document.createElement("div");
    row.className = "state-option";
    row.setAttribute("role", "option");
    row.dataset.name = s.name;
    row.dataset.gstCode = s.gstCode;
    row.innerHTML =
        `<span class="state-option-code">${s.gstCode}</span>` +
        `<span class="state-option-name">${s.name}</span>`;
    return row;
}

function updateStateTrigger(value) {
    const content = document.querySelector("[data-state-trigger-content]");
    if (!content) return;
    const s = STATE_LIST.find((st) => st.name === value);
    if (!s) {
        content.innerHTML = `<span class="state-trigger-placeholder">Select state</span>`;
        return;
    }
    content.innerHTML =
        `<span class="state-trigger-code">${s.gstCode}</span>` +
        `<span class="state-trigger-name">${s.name}</span>`;
}

function initStateDropdown() {
    const dropdown = document.querySelector("[data-state-dropdown]");
    const trigger = document.querySelector("[data-state-trigger]");
    const panel = document.querySelector("[data-state-panel]");
    const optionsContainer = document.querySelector("[data-state-options]");
    const searchInput = document.querySelector("[data-state-search]");
    const hiddenInput = form.querySelector('[name="customer_info.state_name"]');
    if (!dropdown || !trigger || !panel || !optionsContainer || !hiddenInput) return;

    // Portal panel to body so it escapes overflow:hidden
    panel.remove();
    document.body.appendChild(panel);

    buildStateOptions(optionsContainer);

    // If pre-populated
    if (hiddenInput.value) {
        updateStateTrigger(hiddenInput.value);
        const selected = optionsContainer.querySelector(`[data-name="${hiddenInput.value}"]`);
        if (selected) selected.classList.add("selected");
    }

    function positionPanel() {
        const rect = trigger.getBoundingClientRect();
        panel.style.top = (rect.bottom + 6) + "px";
        panel.style.left = rect.left + "px";
        panel.style.width = rect.width + "px";
    }

    function openDropdown() {
        // Close all HSN dropdowns first
        closeAllHsnDropdowns();
        dropdown.classList.add("open");
        panel.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
        searchInput.value = "";
        filterStateOptions(optionsContainer, "");
        positionPanel();
        requestAnimationFrame(() => searchInput.focus());
    }

    function closeDropdown() {
        dropdown.classList.remove("open");
        panel.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
    }

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains("open");
        closeAllStateDropdowns();
        closeAllHsnDropdowns();
        if (!isOpen) openDropdown();
    });

    const scrollParent = trigger.closest(".workspace-panel");
    if (scrollParent) {
        scrollParent.addEventListener("scroll", () => {
            if (dropdown.classList.contains("open")) positionPanel();
        }, { passive: true });
    }

    optionsContainer.addEventListener("click", (e) => {
        const optionRow = e.target.closest(".state-option");
        if (!optionRow) return;

        const name = optionRow.dataset.name;
        const gstCode = optionRow.dataset.gstCode;
        hiddenInput.value = name;

        // Also set the hidden gst code field
        let gstInput = form.querySelector('[name="customer_info.state_gst_code"]');
        if (!gstInput) {
            gstInput = document.createElement("input");
            gstInput.type = "hidden";
            gstInput.name = "customer_info.state_gst_code";
            form.appendChild(gstInput);
        }
        gstInput.value = gstCode;

        // Update selected styling
        optionsContainer.querySelectorAll(".state-option.selected").forEach((el) => el.classList.remove("selected"));
        optionRow.classList.add("selected");

        updateStateTrigger(name);
        closeDropdown();

        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
        hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    searchInput.addEventListener("input", () => {
        filterStateOptions(optionsContainer, searchInput.value);
    });

    panel.addEventListener("click", (e) => e.stopPropagation());
}

function filterStateOptions(container, query) {
    const q = query.toLowerCase().trim();
    const options = container.querySelectorAll(".state-option");
    const categories = container.querySelectorAll(".state-category");
    const noResults = container.querySelector(".state-no-results");
    let visibleCount = 0;

    const catMap = new Map();
    let currentCat = null;
    [...container.children].forEach((child) => {
        if (child.classList.contains("state-category")) {
            currentCat = child;
            catMap.set(currentCat, []);
        } else if (child.classList.contains("state-option") && currentCat) {
            catMap.get(currentCat).push(child);
        }
    });

    options.forEach((opt) => {
        const name = opt.dataset.name || "";
        const code = opt.dataset.gstCode || "";
        const match = !q || name.toLowerCase().includes(q) || code.includes(q);
        opt.dataset.hidden = match ? "false" : "true";
        if (match) visibleCount++;
    });

    catMap.forEach((opts, catEl) => {
        const anyVisible = opts.some((o) => o.dataset.hidden !== "true");
        catEl.style.display = anyVisible ? "" : "none";
    });

    if (noResults) {
        noResults.classList.toggle("visible", visibleCount === 0);
    }
}

/* ── Consignee State Dropdown ────────────────── */
function initConsigneeStateDropdown() {
    const dropdown = document.querySelector("[data-consignee-state-dropdown]");
    const trigger = document.querySelector("[data-consignee-state-trigger]");
    const panel = document.querySelector("[data-consignee-state-panel]");
    const optionsContainer = document.querySelector("[data-consignee-state-options]");
    const searchInput = document.querySelector("[data-consignee-state-search]");
    const hiddenInput = form.querySelector('[name="consignee_info.state_name"]');
    if (!dropdown || !trigger || !panel || !optionsContainer || !hiddenInput) return;

    // Portal panel to body so it escapes overflow:hidden
    panel.remove();
    document.body.appendChild(panel);

    buildStateOptions(optionsContainer);

    function updateTrigger(value) {
        const content = document.querySelector("[data-consignee-state-trigger-content]");
        if (!content) return;
        const s = STATE_LIST.find((st) => st.name === value);
        if (!s) {
            content.innerHTML = `<span class="state-trigger-placeholder">Select state</span>`;
            return;
        }
        content.innerHTML =
            `<span class="state-trigger-code">${s.gstCode}</span>` +
            `<span class="state-trigger-name">${s.name}</span>`;
    }

    // If pre-populated
    if (hiddenInput.value) {
        updateTrigger(hiddenInput.value);
        const selected = optionsContainer.querySelector(`[data-name="${hiddenInput.value}"]`);
        if (selected) selected.classList.add("selected");
    }

    function positionPanel() {
        const rect = trigger.getBoundingClientRect();
        panel.style.top = (rect.bottom + 6) + "px";
        panel.style.left = rect.left + "px";
        panel.style.width = rect.width + "px";
    }

    function openDropdown() {
        closeAllHsnDropdowns();
        closeAllCopyDropdowns();
        dropdown.classList.add("open");
        panel.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
        searchInput.value = "";
        filterStateOptions(optionsContainer, "");
        positionPanel();
        requestAnimationFrame(() => searchInput.focus());
    }

    function closeDropdown() {
        dropdown.classList.remove("open");
        panel.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
    }

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains("open");
        closeAllStateDropdowns();
        closeAllHsnDropdowns();
        closeAllCopyDropdowns();
        if (!isOpen) openDropdown();
    });

    const scrollParent = trigger.closest(".workspace-panel");
    if (scrollParent) {
        scrollParent.addEventListener("scroll", () => {
            if (dropdown.classList.contains("open")) positionPanel();
        }, { passive: true });
    }

    optionsContainer.addEventListener("click", (e) => {
        const optionRow = e.target.closest(".state-option");
        if (!optionRow) return;

        const name = optionRow.dataset.name;
        const gstCode = optionRow.dataset.gstCode;
        hiddenInput.value = name;

        let gstInput = form.querySelector('[name="consignee_info.state_gst_code"]');
        if (!gstInput) {
            gstInput = document.createElement("input");
            gstInput.type = "hidden";
            gstInput.name = "consignee_info.state_gst_code";
            form.appendChild(gstInput);
        }
        gstInput.value = gstCode;

        optionsContainer.querySelectorAll(".state-option.selected").forEach((el) => el.classList.remove("selected"));
        optionRow.classList.add("selected");

        updateTrigger(name);
        closeDropdown();

        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
        hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    searchInput.addEventListener("input", () => {
        filterStateOptions(optionsContainer, searchInput.value);
    });

    panel.addEventListener("click", (e) => e.stopPropagation());
}

/* ── Place of Supply State Dropdown ──────────── */
function initPosStateDropdown() {
    const dropdown = document.querySelector("[data-pos-state-dropdown]");
    const trigger = document.querySelector("[data-pos-state-trigger]");
    const panel = document.querySelector("[data-pos-state-panel]");
    const optionsContainer = document.querySelector("[data-pos-state-options]");
    const searchInput = document.querySelector("[data-pos-state-search]");
    const hiddenInput = form.querySelector('[name="customer_info.place_of_supply_name"]');
    if (!dropdown || !trigger || !panel || !optionsContainer || !hiddenInput) return;

    panel.remove();
    document.body.appendChild(panel);

    buildStateOptions(optionsContainer);

    function updateTrigger(value) {
        const content = document.querySelector("[data-pos-state-trigger-content]");
        if (!content) return;
        const s = STATE_LIST.find((st) => st.name === value);
        if (!s) {
            content.innerHTML = `<span class="state-trigger-placeholder">Select state</span>`;
            return;
        }
        content.innerHTML =
            `<span class="state-trigger-code">${s.gstCode}</span>` +
            `<span class="state-trigger-name">${s.name}</span>`;
    }

    if (hiddenInput.value) {
        updateTrigger(hiddenInput.value);
        const selected = optionsContainer.querySelector(`[data-name="${hiddenInput.value}"]`);
        if (selected) selected.classList.add("selected");
    }

    function positionPanel() {
        const rect = trigger.getBoundingClientRect();
        panel.style.top = (rect.bottom + 6) + "px";
        panel.style.left = rect.left + "px";
        panel.style.width = rect.width + "px";
    }

    function openDropdown() {
        closeAllHsnDropdowns();
        closeAllCopyDropdowns();
        dropdown.classList.add("open");
        panel.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
        searchInput.value = "";
        filterStateOptions(optionsContainer, "");
        positionPanel();
        requestAnimationFrame(() => searchInput.focus());
    }

    function closeDropdown() {
        dropdown.classList.remove("open");
        panel.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
    }

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains("open");
        closeAllStateDropdowns();
        closeAllHsnDropdowns();
        closeAllCopyDropdowns();
        if (!isOpen) openDropdown();
    });

    const scrollParent = trigger.closest(".workspace-panel");
    if (scrollParent) {
        scrollParent.addEventListener("scroll", () => {
            if (dropdown.classList.contains("open")) positionPanel();
        }, { passive: true });
    }

    optionsContainer.addEventListener("click", (e) => {
        const optionRow = e.target.closest(".state-option");
        if (!optionRow) return;

        const name = optionRow.dataset.name;
        const gstCode = optionRow.dataset.gstCode;
        hiddenInput.value = name;

        let gstInput = form.querySelector('[name="customer_info.place_of_supply_gst_code"]');
        if (!gstInput) {
            gstInput = document.createElement("input");
            gstInput.type = "hidden";
            gstInput.name = "customer_info.place_of_supply_gst_code";
            form.appendChild(gstInput);
        }
        gstInput.value = gstCode;

        optionsContainer.querySelectorAll(".state-option.selected").forEach((el) => el.classList.remove("selected"));
        optionRow.classList.add("selected");

        updateTrigger(name);
        closeDropdown();
        updateTaxMode();
        itemsContainer.querySelectorAll(".item-card").forEach((card) => {
            if (currentDocType === "invoice") syncInvoiceCardCalculations(card, "tax_refresh");
        });
        syncFinancialSummary();

        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
        hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    searchInput.addEventListener("input", () => {
        filterStateOptions(optionsContainer, searchInput.value);
    });

    panel.addEventListener("click", (e) => e.stopPropagation());
}

function closeAllStateDropdowns() {
    document.querySelectorAll(".state-dropdown.open").forEach((d) => {
        d.classList.remove("open");
        d.querySelector(".state-trigger")?.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll(".state-panel.open").forEach((p) => {
        p.classList.remove("open");
    });
}

/* ── Tax Mode Toggle (SGST+CGST vs IGST) ──── */
function updateTaxMode() {
    const posGstCode = (form.querySelector('[name="customer_info.place_of_supply_gst_code"]')?.value || "19").trim();
    const container = document.getElementById("tax-fields-container");
    const igstDisplay = document.getElementById("igst-display");
    if (!container) return;

    const isInterState = posGstCode !== "" && posGstCode !== "19";
    container.dataset.taxMode = isInterState ? "inter" : "intra";

    if (isInterState && igstDisplay) {
        const sgst = parseFloat(form.querySelector('[name="charges.sgst_percent"]')?.value || "1.5") || 0;
        const cgst = parseFloat(form.querySelector('[name="charges.cgst_percent"]')?.value || "1.5") || 0;
        igstDisplay.value = (sgst + cgst).toFixed(2);
    }
}

/* ── Custom HSN Dropdown ───────────────────── */
function buildHsnOptions(container) {
    container.innerHTML = "";
    HSN_CATEGORIES.forEach((cat) => {
        const header = document.createElement("div");
        header.className = "hsn-category";
        header.textContent = cat.label;
        container.appendChild(header);

        cat.options.forEach((opt) => {
            const row = document.createElement("div");
            row.className = "hsn-option";
            row.setAttribute("role", "option");
            row.dataset.code = opt.code;
            row.innerHTML = `<span class="hsn-option-code">${opt.code}</span>`
                + `<span class="hsn-option-name">${opt.shortDescription}</span>`
                + `<span class="hsn-option-example">${opt.example}</span>`;
            container.appendChild(row);
        });
    });

    // No-results message
    const noResults = document.createElement("div");
    noResults.className = "hsn-no-results";
    noResults.textContent = "No matching HSN codes found";
    container.appendChild(noResults);
}

function updateHsnTrigger(card, value) {
    const content = card.querySelector("[data-hsn-trigger-content]");
    if (!content) return;

    const opt = HSN_OPTIONS.find((o) => o.code === value);
    if (!opt) {
        content.innerHTML = `<span class="hsn-trigger-placeholder">Select HSN classification</span>`;
        return;
    }
    content.innerHTML = `<span class="hsn-trigger-code">${opt.code}</span>`
        + `<span class="hsn-trigger-name">${opt.shortDescription}</span>`;
}

function initHsnDropdown(card) {
    const dropdown = card.querySelector("[data-hsn-dropdown]");
    const trigger = card.querySelector("[data-hsn-trigger]");
    const panel = card.querySelector("[data-hsn-panel]");
    const optionsContainer = card.querySelector("[data-hsn-options]");
    const searchInput = card.querySelector("[data-hsn-search]");
    const hiddenInput = card.querySelector('[data-field="hsn"]');
    if (!dropdown || !trigger || !panel || !optionsContainer || !hiddenInput) return;

    // Portal: move the panel to <body> so it escapes overflow:hidden and transform containing blocks
    panel.remove();
    document.body.appendChild(panel);
    // Store a reference for cleanup when the card is removed
    card._hsnPanel = panel;

    buildHsnOptions(optionsContainer);

    // If pre-populated value, set it
    if (hiddenInput.value) {
        updateHsnTrigger(card, hiddenInput.value);
        const selected = optionsContainer.querySelector(`[data-code="${hiddenInput.value}"]`);
        if (selected) selected.classList.add("selected");
    }

    // Position the fixed panel relative to the trigger
    function positionPanel() {
        const rect = trigger.getBoundingClientRect();
        panel.style.top = (rect.bottom + 6) + "px";
        panel.style.left = rect.left + "px";
        panel.style.width = rect.width + "px";
    }

    function openDropdown() {
        dropdown.classList.add("open");
        panel.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
        searchInput.value = "";
        filterHsnOptions(optionsContainer, "");
        positionPanel();
        requestAnimationFrame(() => searchInput.focus());
    }

    function closeDropdown() {
        dropdown.classList.remove("open");
        panel.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
    }

    // Toggle open/close
    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains("open");

        // Close all other open dropdowns first
        closeAllHsnDropdowns();

        if (!isOpen) {
            openDropdown();
        }
    });

    // Reposition on scroll so the panel stays anchored to the trigger
    const scrollParent = trigger.closest(".workspace-panel");
    if (scrollParent) {
        scrollParent.addEventListener("scroll", () => {
            if (dropdown.classList.contains("open")) {
                positionPanel();
            }
        }, { passive: true });
    }

    // Option selection
    optionsContainer.addEventListener("click", (e) => {
        const optionRow = e.target.closest(".hsn-option");
        if (!optionRow) return;

        const code = optionRow.dataset.code;
        hiddenInput.value = code;

        // Update selected styling
        optionsContainer.querySelectorAll(".hsn-option.selected").forEach((el) => el.classList.remove("selected"));
        optionRow.classList.add("selected");

        updateHsnTrigger(card, code);
        syncItemCategoryControls(card, { clearCategoryAmounts: true });
        syncInvoiceCardCalculations(card, "hsn");
        syncFinancialSummary();
        persistCurrentDraft();
        queuePreview();
        closeDropdown();

        // Fire events so form serialization / preview picks it up
        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
        hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Search filtering
    searchInput.addEventListener("input", () => {
        filterHsnOptions(optionsContainer, searchInput.value);
    });

    // Prevent panel clicks from closing dropdown
    panel.addEventListener("click", (e) => e.stopPropagation());
}

function filterHsnOptions(container, query) {
    const q = query.toLowerCase().trim();
    const options = container.querySelectorAll(".hsn-option");
    const categories = container.querySelectorAll(".hsn-category");
    const noResults = container.querySelector(".hsn-no-results");
    let visibleCount = 0;

    // Map category headers to their option sets
    const catMap = new Map();
    let currentCat = null;
    [...container.children].forEach((child) => {
        if (child.classList.contains("hsn-category")) {
            currentCat = child;
            catMap.set(currentCat, []);
        } else if (child.classList.contains("hsn-option") && currentCat) {
            catMap.get(currentCat).push(child);
        }
    });

    options.forEach((opt) => {
        const code = opt.dataset.code || "";
        const name = opt.querySelector(".hsn-option-name")?.textContent || "";
        const example = opt.querySelector(".hsn-option-example")?.textContent || "";
        const match = !q || code.includes(q) || name.toLowerCase().includes(q) || example.toLowerCase().includes(q);
        opt.dataset.hidden = match ? "false" : "true";
        if (match) visibleCount++;
    });

    // Hide category headers with no visible children
    catMap.forEach((opts, catEl) => {
        const anyVisible = opts.some((o) => o.dataset.hidden !== "true");
        catEl.style.display = anyVisible ? "" : "none";
    });

    if (noResults) {
        noResults.classList.toggle("visible", visibleCount === 0);
    }
}

// Close all open HSN dropdowns (both the wrapper class and the portaled panels)
function closeAllHsnDropdowns() {
    document.querySelectorAll(".hsn-dropdown.open").forEach((d) => {
        d.classList.remove("open");
        d.querySelector("[data-hsn-trigger]")?.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll(".hsn-panel.open").forEach((p) => {
        p.classList.remove("open");
    });
}

/* ── Purity Custom Dropdown ────────────────── */
const PURITY_CATEGORIES = [
    {
        label: "",
        options: [
            { code: "N/A", name: "None", desc: "No purity · will not appear on bill" },
        ],
    },
    {
        label: "Gold",
        options: [
            { code: "22K", name: "22K Gold (916)", desc: "91.6% pure · traditional & wedding jewellery" },
            { code: "24K", name: "24K Gold (999)", desc: "99.9% pure · coins and bars" },
            { code: "18K", name: "18K Gold (750)", desc: "75% pure · diamond-set jewellery" },
            { code: "14K", name: "14K Gold (585)", desc: "58.5% pure · daily-wear & international designs" },
            { code: "9K",  name: "9K Gold (375)",  desc: "37.5% pure · fashion jewellery" },
        ],
    },
    {
        label: "Silver",
        options: [
            { code: "925", name: "Silver 925", desc: "Sterling silver" },
            { code: "999", name: "Silver 999", desc: "Fine silver" },
            { code: "990", name: "Silver 990", desc: "Fine silver" },
            { code: "970", name: "Silver 970", desc: "High purity" },
            { code: "958", name: "Silver 958", desc: "Britannia silver" },
            { code: "835", name: "Silver 835", desc: "European silver" },
            { code: "800", name: "Silver 800", desc: "Coin silver" },
        ],
    },
];

const PURITY_OPTIONS_FLAT = PURITY_CATEGORIES.flatMap((cat) => cat.options);

function buildPurityOptions(container) {
    container.innerHTML = "";
    PURITY_CATEGORIES.forEach((cat) => {
        if (cat.label) {
            const header = document.createElement("div");
            header.className = "purity-category";
            header.textContent = cat.label;
            container.appendChild(header);
        }
        cat.options.forEach((opt) => {
            const row = document.createElement("div");
            row.className = "purity-option";
            row.setAttribute("role", "option");
            row.dataset.code = opt.code;
            row.innerHTML =
                (opt.code ? `<span class="purity-option-code">${opt.code}</span>` : "") +
                `<span class="purity-option-name">${opt.name}</span>` +
                `<span class="purity-option-desc">${opt.desc}</span>`;
            container.appendChild(row);
        });
    });
    const noResults = document.createElement("div");
    noResults.className = "purity-no-results";
    noResults.textContent = "No matching purity found";
    container.appendChild(noResults);
}

function updatePurityTrigger(card, value) {
    const content = card.querySelector("[data-purity-trigger-content]");
    if (!content) return;
    /* "None" option has code === "" */
    if (value === "") {
        content.innerHTML = `<span class="purity-trigger-placeholder">None</span>`;
        return;
    }
    const opt = PURITY_OPTIONS_FLAT.find((o) => o.code === value);
    if (!opt) {
        content.innerHTML = `<span class="purity-trigger-placeholder">Select purity</span>`;
        return;
    }
    /* Show only the compact code chip in the trigger — not the full name */
    content.innerHTML =
        `<span class="purity-trigger-code">${opt.code}</span>`;
}

function filterPurityOptions(container, query) {
    const q = query.toLowerCase().trim();
    const options = container.querySelectorAll(".purity-option");
    const noResults = container.querySelector(".purity-no-results");
    let visibleCount = 0;

    const catMap = new Map();
    let currentCat = null;
    [...container.children].forEach((child) => {
        if (child.classList.contains("purity-category")) {
            currentCat = child;
            catMap.set(currentCat, []);
        } else if (child.classList.contains("purity-option") && currentCat) {
            catMap.get(currentCat).push(child);
        }
    });

    options.forEach((opt) => {
        const code = opt.dataset.code || "";
        const name = opt.querySelector(".purity-option-name")?.textContent || "";
        const desc = opt.querySelector(".purity-option-desc")?.textContent || "";
        const match = !q || code.toLowerCase().includes(q) || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
        opt.dataset.hidden = match ? "false" : "true";
        if (match) visibleCount++;
    });

    catMap.forEach((opts, catEl) => {
        const anyVisible = opts.some((o) => o.dataset.hidden !== "true");
        catEl.style.display = anyVisible ? "" : "none";
    });

    if (noResults) noResults.classList.toggle("visible", visibleCount === 0);
}

function closeAllPurityDropdowns() {
    document.querySelectorAll(".purity-dropdown.open").forEach((d) => {
        d.classList.remove("open");
        d.querySelector("[data-purity-trigger]")?.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll(".purity-panel.open").forEach((p) => {
        p.classList.remove("open");
    });
}

function initPurityDropdown(card) {
    const dropdown = card.querySelector("[data-purity-dropdown]");
    const trigger  = card.querySelector("[data-purity-trigger]");
    const panel    = card.querySelector("[data-purity-panel]");
    const optionsContainer = card.querySelector("[data-purity-options]");
    const searchInput = card.querySelector("[data-purity-search]");
    const hiddenInput = card.querySelector('[data-field="purity"]');
    if (!dropdown || !trigger || !panel || !optionsContainer || !hiddenInput) return;

    panel.remove();
    document.body.appendChild(panel);
    card._purityPanel = panel;

    buildPurityOptions(optionsContainer);

    /* Always update trigger — empty string means "None" */
    updatePurityTrigger(card, hiddenInput.value);
    if (hiddenInput.value) {
        const selected = optionsContainer.querySelector(`[data-code="${hiddenInput.value}"]`);
        if (selected) selected.classList.add("selected");
    } else {
        /* Pre-select the "None" option */
        const noneOpt = optionsContainer.querySelector('[data-code=""]');
        if (noneOpt) noneOpt.classList.add("selected");
    }

    function positionPanel() {
        const rect = trigger.getBoundingClientRect();
        panel.style.top  = (rect.bottom + 6) + "px";
        panel.style.left = rect.left + "px";
        panel.style.width = Math.max(rect.width, 220) + "px";
    }

    function openDropdown() {
        closeAllHsnDropdowns();
        closeAllPurityDropdowns();
        dropdown.classList.add("open");
        panel.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
        searchInput.value = "";
        filterPurityOptions(optionsContainer, "");
        positionPanel();
        requestAnimationFrame(() => searchInput.focus());
    }

    function closeDropdown() {
        dropdown.classList.remove("open");
        panel.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
    }

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains("open");
        closeAllHsnDropdowns();
        closeAllPurityDropdowns();
        if (!isOpen) openDropdown();
    });

    const scrollParent = trigger.closest(".workspace-panel");
    if (scrollParent) {
        scrollParent.addEventListener("scroll", () => {
            if (dropdown.classList.contains("open")) positionPanel();
        }, { passive: true });
    }

    optionsContainer.addEventListener("click", (e) => {
        const optionRow = e.target.closest(".purity-option");
        if (!optionRow) return;
        const code = optionRow.dataset.code;
        hiddenInput.value = code;
        optionsContainer.querySelectorAll(".purity-option.selected").forEach((el) => el.classList.remove("selected"));
        optionRow.classList.add("selected");
        updatePurityTrigger(card, code);
        closeDropdown();
        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
        hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    searchInput.addEventListener("input", () => filterPurityOptions(optionsContainer, searchInput.value));
    panel.addEventListener("click", (e) => e.stopPropagation());
}

// Close dropdowns on outside click
document.addEventListener("click", () => {
    closeAllHsnDropdowns();
    closeAllStateDropdowns();
    closeAllCopyDropdowns();
    closeAllDatetimeDropdowns();
    closeAllPurityDropdowns();
});

/* ── Custom Copy Dropdown ─────────────────── */
function initCopyDropdown() {
    const dropdown = document.querySelector("[data-copy-dropdown]");
    const trigger = document.querySelector("[data-copy-trigger]");
    const panel = document.querySelector("[data-copy-panel]");
    const optionsContainer = document.querySelector("[data-copy-options]");
    const hiddenInput = form.querySelector('[name="invoice_info.copy_type"]');
    if (!dropdown || !trigger || !panel || !optionsContainer || !hiddenInput) return;

    panel.remove();
    document.body.appendChild(panel);

    function updateTrigger(value) {
        const content = document.querySelector("[data-copy-trigger-content]");
        if (content) {
            content.innerHTML = `<span class="copy-trigger-name">${value}</span>`;
        }
    }

    if (hiddenInput.value) {
        updateTrigger(hiddenInput.value);
        const selected = optionsContainer.querySelector(`[data-value="${hiddenInput.value}"]`);
        if (selected) {
            optionsContainer.querySelectorAll(".copy-option.selected").forEach((el) => el.classList.remove("selected"));
            selected.classList.add("selected");
        }
    }

    function positionPanel() {
        const rect = trigger.getBoundingClientRect();
        panel.style.top = (rect.bottom + 6) + "px";
        panel.style.left = rect.left + "px";
        panel.style.width = rect.width + "px";
    }

    function openDropdown() {
        closeAllStateDropdowns();
        closeAllHsnDropdowns();
        dropdown.classList.add("open");
        panel.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
        positionPanel();
    }

    function closeDropdown() {
        dropdown.classList.remove("open");
        panel.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
    }

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains("open");
        closeAllStateDropdowns();
        closeAllHsnDropdowns();
        closeAllCopyDropdowns();
        if (!isOpen) openDropdown();
    });

    const scrollParent = trigger.closest(".workspace-panel");
    if (scrollParent) {
        scrollParent.addEventListener("scroll", () => {
            if (dropdown.classList.contains("open")) positionPanel();
        }, { passive: true });
    }

    optionsContainer.addEventListener("click", (e) => {
        const optionRow = e.target.closest(".copy-option");
        if (!optionRow) return;

        const value = optionRow.dataset.value;
        hiddenInput.value = value;

        optionsContainer.querySelectorAll(".copy-option.selected").forEach((el) => el.classList.remove("selected"));
        optionRow.classList.add("selected");

        updateTrigger(value);
        closeDropdown();

        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
        hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    panel.addEventListener("click", (e) => e.stopPropagation());
}

function closeAllCopyDropdowns() {
    document.querySelectorAll(".copy-dropdown.open").forEach((d) => {
        d.classList.remove("open");
        d.querySelector("[data-copy-trigger]")?.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll(".copy-panel.open").forEach((p) => {
        p.classList.remove("open");
    });
}

/* ── Custom DateTime Picker ────────────────── */
const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];
const SHORT_MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function closeAllDatetimeDropdowns() {
    document.querySelectorAll(".datetime-dropdown.open").forEach((d) => {
        d.classList.remove("open");
    });
    document.querySelectorAll(".datetime-panel.open").forEach((p) => {
        p.classList.remove("open");
    });
}

/* ── Auto-format helper: digits → DD/MM/YYYY HH:MM ─── */
function extractDigits(str) {
    return str.replace(/\D/g, "");
}

function formatDateTimeDigits(digits) {
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

function parseDateTimeString(str) {
    const digits = extractDigits(str);
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

function buildDatetimePanelHTML() {
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
                ${WEEKDAY_LABELS.map((d) => `<span class="dtp-weekday">${d}</span>`).join("")}
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

function initDatetimePicker(wrapper) {
    const dropdown = wrapper.querySelector("[data-datetime-dropdown]");
    const textInput = wrapper.querySelector("[data-datetime-input]");
    const calBtn = wrapper.querySelector("[data-datetime-cal-btn]");
    const panel = wrapper.querySelector("[data-datetime-panel]");
    const hiddenInput = wrapper.querySelector('input[type="hidden"]');
    if (!dropdown || !textInput || !calBtn || !panel || !hiddenInput) return;

    // Portal panel to body
    panel.remove();
    document.body.appendChild(panel);

    // Build inner HTML
    panel.innerHTML = buildDatetimePanelHTML();

    // View mode: "days" | "months" | "years"
    let viewMode = "days";

    const now = new Date();
    const state = {
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

    // Refs
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

    /* ── Rendering functions ── */
    function updateHeaderLabels() {
        monthBtn.textContent = MONTH_NAMES[state.viewMonth];
        yearBtn.textContent = state.viewYear;
        monthBtn.classList.toggle("active", viewMode === "months");
        yearBtn.classList.toggle("active", viewMode === "years");
    }

    function renderDaysView() {
        viewMode = "days";
        updateHeaderLabels();

        const weekdaysEl = bodyEl.querySelector(".dtp-weekdays");
        if (weekdaysEl) weekdaysEl.style.display = "";

        const firstDay = new Date(state.viewYear, state.viewMonth, 1).getDay();
        const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(state.viewYear, state.viewMonth, 0).getDate();

        const today = new Date();
        const todayDay = today.getDate();
        const todayMonth = today.getMonth();
        const todayYear = today.getFullYear();

        let html = "";

        for (let i = firstDay - 1; i >= 0; i--) {
            const d = daysInPrevMonth - i;
            html += `<button type="button" class="dtp-day dtp-day-other-month" data-day="${d}" data-month="${state.viewMonth - 1}" data-year="${state.viewYear}">${d}</button>`;
        }

        for (let d = 1; d <= daysInMonth; d++) {
            let cls = "dtp-day";
            if (d === todayDay && state.viewMonth === todayMonth && state.viewYear === todayYear) cls += " dtp-day-today";
            if (d === state.selectedDay && state.viewMonth === state.selectedMonth && state.viewYear === state.selectedYear) cls += " dtp-day-selected";
            html += `<button type="button" class="${cls}" data-day="${d}" data-month="${state.viewMonth}" data-year="${state.viewYear}">${d}</button>`;
        }

        const totalCells = firstDay + daysInMonth;
        const remaining = (7 - (totalCells % 7)) % 7;
        for (let d = 1; d <= remaining; d++) {
            html += `<button type="button" class="dtp-day dtp-day-other-month" data-day="${d}" data-month="${state.viewMonth + 1}" data-year="${state.viewYear}">${d}</button>`;
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
            if (m === today.getMonth() && state.viewYear === today.getFullYear()) cls += " dtp-month-current";
            if (m === state.viewMonth) cls += " dtp-month-selected";
            html += `<button type="button" class="${cls}" data-month-idx="${m}">${SHORT_MONTHS[m]}</button>`;
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
        const start = state.yearRangeStart;
        let html = "";
        for (let i = 0; i < 12; i++) {
            const y = start + i;
            let cls = "dtp-year-cell";
            if (y === today.getFullYear()) cls += " dtp-year-current";
            if (y === state.viewYear) cls += " dtp-year-selected";
            html += `<button type="button" class="${cls}" data-year-val="${y}">${y}</button>`;
        }
        daysContainer.innerHTML = html;
        daysContainer.className = "dtp-years";

        // Update year button to show range
        yearBtn.textContent = `${start} – ${start + 11}`;
    }

    function render() {
        if (viewMode === "months") renderMonthsView();
        else if (viewMode === "years") renderYearsView();
        else renderDaysView();
    }

    function updateTimeDisplay() {
        hourInput.value = pad2(state.hour);
        minInput.value = pad2(state.minute);
        amBtn.classList.toggle("active", state.period === "AM");
        pmBtn.classList.toggle("active", state.period === "PM");
    }

    function getH24() {
        let h24 = state.hour;
        if (state.period === "PM" && h24 !== 12) h24 += 12;
        if (state.period === "AM" && h24 === 12) h24 = 0;
        return h24;
    }

    function setFromH24(h) {
        if (h === 0) { state.hour = 12; state.period = "AM"; }
        else if (h < 12) { state.hour = h; state.period = "AM"; }
        else if (h === 12) { state.hour = 12; state.period = "PM"; }
        else { state.hour = h - 12; state.period = "PM"; }
    }

    function syncTextInput() {
        if (state.selectedDay === null) {
            textInput.value = "";
            return;
        }
        const dateStr = `${pad2(state.selectedDay)}/${pad2(state.selectedMonth + 1)}/${state.selectedYear}`;
        if (state.hasTime) {
            const h24 = getH24();
            textInput.value = `${dateStr}  ${pad2(h24)}:${pad2(state.minute)}`;
        } else {
            textInput.value = dateStr;
        }
    }

    function writeHiddenValue() {
        if (state.selectedDay === null) {
            hiddenInput.value = "";
        } else {
            const dateStr = `${pad2(state.selectedDay)}/${pad2(state.selectedMonth + 1)}/${state.selectedYear}`;
            if (state.hasTime) {
                const h24 = getH24();
                hiddenInput.value = `${dateStr} ${pad2(h24)}:${pad2(state.minute)}`;
            } else {
                hiddenInput.value = dateStr;
            }
        }
        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
        hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function applyAndClose() {
        writeHiddenValue();
        syncTextInput();
        closeDropdown();
        queuePreview();
    }

    /* ── Inline text input with auto-formatting ── */
    textInput.addEventListener("input", (e) => {
        const raw = textInput.value;
        const digits = extractDigits(raw);
        const formatted = formatDateTimeDigits(digits.substring(0, 12));

        // Preserve cursor position relative to digit count
        const cursorBefore = textInput.selectionStart;
        const digitsBefore = extractDigits(raw.substring(0, cursorBefore)).length;

        textInput.value = formatted;

        // Restore cursor: count digits in formatted up to the right position
        let digitsSeen = 0;
        let newCursor = 0;
        for (let i = 0; i < formatted.length; i++) {
            if (/\d/.test(formatted[i])) digitsSeen++;
            if (digitsSeen >= digitsBefore) { newCursor = i + 1; break; }
        }
        if (digitsSeen < digitsBefore) newCursor = formatted.length;
        textInput.setSelectionRange(newCursor, newCursor);

        // Parse and sync state
        const parsed = parseDateTimeString(formatted);
        if (parsed) {
            state.selectedDay = parsed.day;
            state.selectedMonth = parsed.month;
            state.selectedYear = parsed.year;
            state.viewMonth = parsed.month;
            state.viewYear = parsed.year;
            if (parsed.hasTime) {
                setFromH24(parsed.hour);
                state.minute = parsed.minute;
                state.hasTime = true;
            }
            writeHiddenValue();
            if (dropdown.classList.contains("open")) render();
            updateTimeDisplay();
        } else if (digits.length === 0) {
            state.selectedDay = null;
            state.selectedMonth = null;
            state.selectedYear = null;
            state.hasTime = false;
            writeHiddenValue();
            if (dropdown.classList.contains("open")) render();
        }

        queuePreview();
    });

    textInput.addEventListener("blur", () => {
        // On blur, reformat to clean display
        const parsed = parseDateTimeString(textInput.value);
        if (parsed) {
            state.selectedDay = parsed.day;
            state.selectedMonth = parsed.month;
            state.selectedYear = parsed.year;
            if (parsed.hasTime) {
                setFromH24(parsed.hour);
                state.minute = parsed.minute;
                state.hasTime = true;
            }
            syncTextInput();
            writeHiddenValue();
        } else if (extractDigits(textInput.value).length > 0 && extractDigits(textInput.value).length < 8) {
            // Incomplete date — clear
            textInput.value = "";
            state.selectedDay = null;
            writeHiddenValue();
        }
    });

    /* ── Panel positioning ── */
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
        closeAllHsnDropdowns();
        closeAllStateDropdowns();
        closeAllCopyDropdowns();

        if (state.selectedDay !== null) {
            state.viewYear = state.selectedYear;
            state.viewMonth = state.selectedMonth;
        } else {
            const n = new Date();
            state.viewYear = n.getFullYear();
            state.viewMonth = n.getMonth();
        }
        state.yearRangeStart = Math.floor(state.viewYear / 12) * 12;

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

    // Calendar icon opens/closes popup
    calBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains("open");
        closeAllDatetimeDropdowns();
        closeAllHsnDropdowns();
        closeAllStateDropdowns();
        closeAllCopyDropdowns();
        if (!isOpen) openDropdown();
    });

    const scrollParent = calBtn.closest(".workspace-panel");
    if (scrollParent) {
        scrollParent.addEventListener("scroll", () => {
            if (dropdown.classList.contains("open")) positionPanel();
        }, { passive: true });
    }

    /* ── Header navigation ── */
    monthBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (viewMode === "months") {
            viewMode = "days";
        } else {
            viewMode = "months";
        }
        render();
    });

    yearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (viewMode === "years") {
            viewMode = "days";
        } else {
            state.yearRangeStart = Math.floor(state.viewYear / 12) * 12;
            viewMode = "years";
        }
        render();
    });

    prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (viewMode === "years") {
            state.yearRangeStart -= 12;
        } else if (viewMode === "months") {
            state.viewYear--;
        } else {
            state.viewMonth--;
            if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
        }
        render();
    });

    nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (viewMode === "years") {
            state.yearRangeStart += 12;
        } else if (viewMode === "months") {
            state.viewYear++;
        } else {
            state.viewMonth++;
            if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
        }
        render();
    });

    /* ── Grid click handling ── */
    daysContainer.addEventListener("click", (e) => {
        const dayBtn = e.target.closest(".dtp-day");
        const monthCell = e.target.closest(".dtp-month-cell");
        const yearCell = e.target.closest(".dtp-year-cell");

        if (dayBtn) {
            let m = parseInt(dayBtn.dataset.month, 10);
            let y = parseInt(dayBtn.dataset.year, 10);
            if (m < 0) { m = 11; y--; }
            if (m > 11) { m = 0; y++; }
            state.selectedDay = parseInt(dayBtn.dataset.day, 10);
            state.selectedMonth = m;
            state.selectedYear = y;
            state.viewMonth = m;
            state.viewYear = y;
            render();
        } else if (monthCell) {
            state.viewMonth = parseInt(monthCell.dataset.monthIdx, 10);
            viewMode = "days";
            render();
        } else if (yearCell) {
            state.viewYear = parseInt(yearCell.dataset.yearVal, 10);
            state.yearRangeStart = Math.floor(state.viewYear / 12) * 12;
            viewMode = "months";
            render();
        }
    });

    /* ── Time spinners ── */
    hourUpBtn.addEventListener("click", (e) => { e.stopPropagation(); state.hour = state.hour >= 12 ? 1 : state.hour + 1; state.hasTime = true; updateTimeDisplay(); });
    hourDownBtn.addEventListener("click", (e) => { e.stopPropagation(); state.hour = state.hour <= 1 ? 12 : state.hour - 1; state.hasTime = true; updateTimeDisplay(); });
    minUpBtn.addEventListener("click", (e) => { e.stopPropagation(); state.minute = (state.minute + 1) % 60; state.hasTime = true; updateTimeDisplay(); });
    minDownBtn.addEventListener("click", (e) => { e.stopPropagation(); state.minute = state.minute <= 0 ? 59 : state.minute - 1; state.hasTime = true; updateTimeDisplay(); });

    hourInput.addEventListener("change", () => { let v = parseInt(hourInput.value, 10); if (isNaN(v) || v < 1) v = 1; if (v > 12) v = 12; state.hour = v; state.hasTime = true; updateTimeDisplay(); });
    minInput.addEventListener("change", () => { let v = parseInt(minInput.value, 10); if (isNaN(v) || v < 0) v = 0; if (v > 59) v = 59; state.minute = v; state.hasTime = true; updateTimeDisplay(); });

    amBtn.addEventListener("click", (e) => { e.stopPropagation(); state.period = "AM"; state.hasTime = true; updateTimeDisplay(); });
    pmBtn.addEventListener("click", (e) => { e.stopPropagation(); state.period = "PM"; state.hasTime = true; updateTimeDisplay(); });

    /* ── Footer buttons ── */
    nowBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const n = new Date();
        state.selectedDay = n.getDate();
        state.selectedMonth = n.getMonth();
        state.selectedYear = n.getFullYear();
        state.viewMonth = n.getMonth();
        state.viewYear = n.getFullYear();
        let h = n.getHours();
        state.period = h >= 12 ? "PM" : "AM";
        if (h === 0) { h = 12; state.period = "AM"; }
        else if (h > 12) h -= 12;
        state.hour = h;
        state.minute = n.getMinutes();
        state.hasTime = true;
        applyAndClose();
    });

    clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.selectedDay = null;
        state.selectedMonth = null;
        state.selectedYear = null;
        state.hour = 12;
        state.minute = 0;
        state.period = "AM";
        state.hasTime = false;
        textInput.value = "";
        writeHiddenValue();
        closeDropdown();
        queuePreview();
    });

    confirmBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.selectedDay === null) {
            const n = new Date();
            state.selectedDay = n.getDate();
            state.selectedMonth = n.getMonth();
            state.selectedYear = n.getFullYear();
        }
        applyAndClose();
    });

    panel.addEventListener("click", (e) => e.stopPropagation());

    /* ── Parse existing hidden value on init ── */
    function parseExistingValue() {
        const val = hiddenInput.value?.trim();
        if (!val) return;
        const parsed = parseDateTimeString(val);
        if (parsed) {
            state.selectedDay = parsed.day;
            state.selectedMonth = parsed.month;
            state.selectedYear = parsed.year;
            state.viewMonth = parsed.month;
            state.viewYear = parsed.year;
            if (parsed.hasTime) {
                setFromH24(parsed.hour);
                state.minute = parsed.minute;
                state.hasTime = true;
            }
            syncTextInput();
        }
    }

    parseExistingValue();
}

function initAllDatetimePickers() {
    document.querySelectorAll(".datetime-field").forEach((wrapper) => {
        initDatetimePicker(wrapper);
    });
}

/* ── Status ─────────────────────────────────── */
function setStatus(message, isError = false) {
    statusChip.textContent = "";
    // Recreate the dot
    const dot = document.createElement("span");
    dot.className = "status-dot";
    statusChip.appendChild(dot);
    statusChip.appendChild(document.createTextNode(message));
    statusChip.classList.toggle("error", isError);
}

/* ── Field Hydration ────────────────────────── */
function setFieldValue(name, value) {
    const field = getNamedField(name);
    if (!field) return;
    if (field.type === "checkbox") {
        field.checked = value === true || String(value).toLowerCase() === "true";
        return;
    }
    field.value = value ?? "";
}

function setCopyTypeValue(value) {
    const normalized = String(value || "Original for Buyer").trim() || "Original for Buyer";
    const hiddenInput = getNamedField("invoice_info.copy_type");
    if (hiddenInput) {
        hiddenInput.value = normalized;
    }
    const triggerContent = document.querySelector("[data-copy-trigger-content]");
    if (triggerContent) {
        triggerContent.innerHTML = `<span class="copy-trigger-name">${escapeMarkup(normalized)}</span>`;
    }
    const optionsContainer = document.querySelector("[data-copy-options]");
    if (optionsContainer) {
        optionsContainer.querySelectorAll(".copy-option.selected").forEach((el) => el.classList.remove("selected"));
        const selected = optionsContainer.querySelector(`[data-value="${CSS.escape(normalized)}"]`);
        if (selected) {
            selected.classList.add("selected");
        }
    }
}

function setNamedDateTimeValue(name, value) {
    const field = getNamedField(name);
    if (!field) return;
    field.value = value ?? "";
    const wrapper = field.closest(".datetime-field");
    const textInput = wrapper?.querySelector("[data-datetime-input]");
    if (textInput) {
        textInput.value = value ?? "";
        textInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
}

function updateConsigneeFromCustomerField(fieldName, value) {
    if (currentDocType !== "invoice") return;
    if (fieldName === "place_of_supply_name" || fieldName === "place_of_supply_gst_code") return;

    const consigneeField = form.querySelector(`[name="consignee_info.${fieldName}"]`);
    if (!consigneeField) return;

    consigneeField.value = value ?? "";

    if (fieldName === "state_name") {
        updateCustomStateTrigger("[data-consignee-state-trigger-content]", value || "");
        updateNamedStateSelection("[data-consignee-state-options]", value || "");
    }

    consigneeField.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateNarrationFromCustomerName(name) {
    const narrationField = form.querySelector('[name="payment_info.narration"]');
    if (!narrationField) return;
    narrationField.value = name ?? "";
    narrationField.dispatchEvent(new Event("input", { bubbles: true }));
}

function syncInvoiceDerivedFields(fieldName, value) {
    if (!isFeatureEnabled("sync_enabled")) return;
    updateConsigneeFromCustomerField(fieldName, value);
    if (fieldName === "name") {
        updateNarrationFromCustomerName(value);
    }
}

function isExchangeModeActive() {
    return isFeatureEnabled("exchange_mode");
}

function syncFieldToOtherDraft(path, value) {
    const otherDocType = getOtherDocType();
    updateDraftPath(documentDrafts[otherDocType], path, value);
}

function summarizeDraft(docType) {
    const draft = docType === currentDocType ? serializeForm(docType) : deepClone(documentDrafts[docType]);
    const items = draft.items || [];
    if (docType === "receipt") {
        const total = items.reduce((sum, item) => sum + toNumber(item.amount), 0);
        return { total, net: Math.max(total - toNumber(draft.payment_info?.less_invoice_amount), 0) };
    }

    const lines = items.map((item) => {
        const rate = getHsnTaxPercent(item.hsn);
        const inclusiveAmount = toNumber(item.negotiated_total_amount);
        const lineAmount = inclusiveAmount > 0
            ? roundCurrency(inclusiveAmount / (1 + rate / 100))
            : (toNumber(item.amount) || (toNumber(item.gold_silver_amount) + toNumber(item.diamond_or_stone_amount) + toNumber(item.other_charges) + toNumber(item.making_charges)));
        return { amount: lineAmount, rate };
    });
    const itemTotal = lines.reduce((sum, line) => sum + line.amount, 0);
    const discount = Math.max(toNumber(draft.payment_info?.discount), 0);
    const taxable = Math.max(itemTotal - discount, 0);
    const posCode = String(draft.customer_info?.place_of_supply_gst_code || "19").trim();
    const isIgst = posCode !== "" && posCode !== "19";
    const totalTax = calculateTaxGroups(lines, discount, isIgst).reduce((sum, group) => sum + group.totalTax, 0);
    const gross = calculateRoundedTotal(taxable + totalTax);
    const oldGold = toNumber(draft.payment_info?.old_gold_advance);
    return { total: gross, net: Math.max(gross - oldGold, 0) };
}

function applyExchangeAdjustments(options = {}) {
    if (!isExchangeModeActive()) return;

    const invoiceDraft = currentDocType === "invoice" ? serializeForm("invoice") : deepClone(documentDrafts.invoice);
    const receiptDraft = currentDocType === "receipt" ? serializeForm("receipt") : deepClone(documentDrafts.receipt);
    const invoiceSummary = summarizeDraft("invoice");
    const receiptSummary = summarizeDraft("receipt");
    const preserveInvoiceNetInput = options.preserveInvoiceNetInput === true;

    invoiceDraft.payment_info.old_gold_advance = formatCurrencyInput(receiptSummary.total);
    if (!preserveInvoiceNetInput) {
        invoiceDraft.payment_info.net_amount = formatExchangeNetFieldValue(Math.max(invoiceSummary.total - receiptSummary.total, 0));
    }
    receiptDraft.payment_info.less_invoice_amount = formatCurrencyInput(invoiceSummary.total);
    receiptDraft.payment_info.receipt_total_display = formatCurrencyInput(receiptSummary.total);
    receiptDraft.payment_info.receipt_net_display = formatExchangeNetFieldValue(Math.max(receiptSummary.total - invoiceSummary.total, 0));
    receiptDraft.payment_info.net_amount = formatExchangeNetFieldValue(Math.max(receiptSummary.total - invoiceSummary.total, 0));

    if (invoiceDraft.invoice_info.invoice_no) {
        receiptDraft.invoice_info.linked_invoice_no = invoiceDraft.invoice_info.invoice_no;
    }
    if (receiptDraft.invoice_info.invoice_no) {
        invoiceDraft.invoice_info.linked_receipt_no = receiptDraft.invoice_info.invoice_no;
    }

    documentDrafts.invoice = invoiceDraft;
    documentDrafts.receipt = receiptDraft;

    if (currentDocType === "invoice") {
        const oldGoldField = getPaymentField("old_gold_advance");
        const netAmountField = getPaymentField("net_amount");
        const linkedReceiptField = getNamedField("invoice_info.linked_receipt_no");
        if (oldGoldField) oldGoldField.value = invoiceDraft.payment_info.old_gold_advance;
        if (netAmountField && !(preserveInvoiceNetInput && document.activeElement === netAmountField)) {
            netAmountField.value = invoiceDraft.payment_info.net_amount;
        }
        if (linkedReceiptField && document.activeElement !== linkedReceiptField) {
            linkedReceiptField.value = invoiceDraft.invoice_info.linked_receipt_no || "";
        }
    } else {
        const lessInvoiceField = getPaymentField("less_invoice_amount");
        const netAmountField = getPaymentField("net_amount");
        const receiptTotalField = getPaymentField("receipt_total_display");
        const receiptNetDisplayField = getPaymentField("receipt_net_display");
        const linkedInvoiceField = getNamedField("invoice_info.linked_invoice_no");
        if (lessInvoiceField) lessInvoiceField.value = receiptDraft.payment_info.less_invoice_amount;
        if (netAmountField) netAmountField.value = receiptDraft.payment_info.net_amount;
        if (receiptTotalField) receiptTotalField.value = receiptDraft.payment_info.receipt_total_display;
        if (receiptNetDisplayField) receiptNetDisplayField.value = receiptDraft.payment_info.receipt_net_display;
        if (linkedInvoiceField && document.activeElement !== linkedInvoiceField) {
            linkedInvoiceField.value = receiptDraft.invoice_info.linked_invoice_no || "";
        }
    }
}

function updateNamedStateSelection(optionsSelector, value) {
    const optionsContainer = document.querySelector(optionsSelector);
    if (!optionsContainer) return;
    optionsContainer.querySelectorAll(".state-option.selected").forEach((el) => el.classList.remove("selected"));
    if (!value) return;
    const selected = optionsContainer.querySelector(`[data-name="${value}"]`);
    if (selected) selected.classList.add("selected");
}

function updateCustomStateTrigger(contentSelector, value, placeholder = "Select state") {
    const content = document.querySelector(contentSelector);
    if (!content) return;
    const match = STATE_LIST.find((state) => state.name === value);
    if (!match) {
        content.innerHTML = `<span class="state-trigger-placeholder">${placeholder}</span>`;
        return;
    }
    content.innerHTML =
        `<span class="state-trigger-code">${match.gstCode}</span>` +
        `<span class="state-trigger-name">${match.name}</span>`;
}

function hydrateScalarFields(data) {
    Object.entries(data.customer_info).forEach(([key, value]) => {
        if (key === "state_name") {
            const hiddenInput = form.querySelector('[name="customer_info.state_name"]');
            if (hiddenInput) hiddenInput.value = value ?? "";
            return;
        }
        if (key === "state_gst_code") {
            let gstInput = form.querySelector('[name="customer_info.state_gst_code"]');
            if (!gstInput) {
                gstInput = document.createElement("input");
                gstInput.type = "hidden";
                gstInput.name = "customer_info.state_gst_code";
                form.appendChild(gstInput);
            }
            gstInput.value = value ?? "";
            return;
        }
        if (key === "place_of_supply_name") {
            const hiddenInput = form.querySelector('[name="customer_info.place_of_supply_name"]');
            if (hiddenInput) hiddenInput.value = value ?? "";
            return;
        }
        if (key === "place_of_supply_gst_code") {
            let gstInput = form.querySelector('[name="customer_info.place_of_supply_gst_code"]');
            if (!gstInput) {
                gstInput = document.createElement("input");
                gstInput.type = "hidden";
                gstInput.name = "customer_info.place_of_supply_gst_code";
                form.appendChild(gstInput);
            }
            gstInput.value = value ?? "";
            return;
        }
        setFieldValue(`customer_info.${key}`, value);
    });

    // Consignee info hydration
    if (data.consignee_info) {
        Object.entries(data.consignee_info).forEach(([key, value]) => {
            if (key === "state_name") {
                const hiddenInput = form.querySelector('[name="consignee_info.state_name"]');
                if (hiddenInput) hiddenInput.value = value ?? "";
                return;
            }
            if (key === "state_gst_code") {
                let gstInput = form.querySelector('[name="consignee_info.state_gst_code"]');
                if (!gstInput) {
                    gstInput = document.createElement("input");
                    gstInput.type = "hidden";
                    gstInput.name = "consignee_info.state_gst_code";
                    form.appendChild(gstInput);
                }
                gstInput.value = value ?? "";
                return;
            }
            setFieldValue(`consignee_info.${key}`, value);
        });
    }
    Object.entries(data.invoice_info).forEach(([key, value]) => {
        if (key === "copy_type") {
            setCopyTypeValue(value);
            return;
        }
        setFieldValue(`invoice_info.${key}`, value);
    });
    Object.entries(data.charges).forEach(([key, value]) => setFieldValue(`charges.${key}`, value));
    Object.entries(data.payment_info).forEach(([key, value]) => setFieldValue(`payment_info.${key}`, value));
    Object.entries(data.document_settings || {}).forEach(([key, value]) => setFieldValue(`document_settings.${key}`, value));
    Object.entries((data.resolution || {}).customer || {}).forEach(([key, value]) => {
        setFieldValue(`resolution.customer.${key}`, value);
    });

    updateStateTrigger(data.customer_info?.state_name || "");
    updateCustomStateTrigger("[data-consignee-state-trigger-content]", data.consignee_info?.state_name || "");
    updateCustomStateTrigger("[data-pos-state-trigger-content]", data.customer_info?.place_of_supply_name || "", "Select place of supply");

    updateNamedStateSelection("[data-state-options]", data.customer_info?.state_name || "");
    updateNamedStateSelection("[data-consignee-state-options]", data.consignee_info?.state_name || "");
    updateNamedStateSelection("[data-pos-state-options]", data.customer_info?.place_of_supply_name || "");
}

function customerResolutionFields() {
    return {
        mode: form.querySelector('[name="resolution.customer.mode"]'),
        customerId: form.querySelector('[name="resolution.customer.customer_id"]'),
    };
}

function setCustomerResolution(mode = "new", customerId = "") {
    const fields = customerResolutionFields();
    if (fields.mode) fields.mode.value = mode;
    if (fields.customerId) fields.customerId.value = customerId || "";
}

function hideCustomerMatchPanel() {
    if (!customerMatchPanel) return;
    customerMatchPanel.hidden = true;
    customerMatchPanel.innerHTML = "";
}

function buildCustomerInfoFromSuggestion(suggestion) {
    return {
        name: suggestion.full_name || "",
        contact: suggestion.primary_contact || "",
        contact2: suggestion.secondary_contact || "",
        email: suggestion.email || "",
        address: suggestion.address_line || "",
        pincode: suggestion.pincode || "",
        pan_aadhaar: suggestion.pan_aadhaar_no || "",
        state_name: suggestion.state_name || "",
        state_gst_code: suggestion.state_gst_code || "",
        place_of_supply_name: suggestion.place_of_supply_name || "",
        place_of_supply_gst_code: suggestion.place_of_supply_gst_code || "",
    };
}

function buildCustomerInfoFromOrderMatch(match) {
    return buildCustomerInfoFromSuggestion(match?.customer || {});
}

function buildCustomerInfoFromDocumentMatch(match) {
    return {
        name: match?.customer_info?.name || "",
        contact: match?.customer_info?.contact || "",
        contact2: match?.customer_info?.contact2 || "",
        email: match?.customer_info?.email || "",
        address: match?.customer_info?.address || "",
        pincode: match?.customer_info?.pincode || "",
        pan_aadhaar: match?.customer_info?.pan_aadhaar || "",
        state_name: match?.customer_info?.state_name || "",
        state_gst_code: match?.customer_info?.state_gst_code || "",
        place_of_supply_name: match?.customer_info?.place_of_supply_name || "",
        place_of_supply_gst_code: match?.customer_info?.place_of_supply_gst_code || "",
    };
}

function buildCustomerInfoFromPortalParams() {
    return {
        name: pageParams.get("customer_name") || "",
        contact: pageParams.get("customer_contact") || "",
        contact2: pageParams.get("customer_contact2") || "",
        email: pageParams.get("customer_email") || "",
        address: pageParams.get("customer_address") || "",
        pincode: pageParams.get("customer_pincode") || "",
        pan_aadhaar: pageParams.get("customer_pan_aadhaar") || "",
        state_name: pageParams.get("customer_state_name") || "",
        state_gst_code: pageParams.get("customer_state_gst_code") || "",
        place_of_supply_name: pageParams.get("place_of_supply_name") || "",
        place_of_supply_gst_code: pageParams.get("place_of_supply_gst_code") || "",
    };
}

function buildConsigneeInfoFromDocumentMatch(match) {
    return {
        name: match?.consignee_info?.name || "",
        contact: match?.consignee_info?.contact || "",
        contact2: match?.consignee_info?.contact2 || "",
        email: match?.consignee_info?.email || "",
        address: match?.consignee_info?.address || "",
        pincode: match?.consignee_info?.pincode || "",
        pan_aadhaar: match?.consignee_info?.pan_aadhaar || "",
        state_name: match?.consignee_info?.state_name || "",
        state_gst_code: match?.consignee_info?.state_gst_code || "",
    };
}

function getDraftSnapshot(docType) {
    return docType === currentDocType ? serializeForm(docType) : deepClone(documentDrafts[docType]);
}

function applyCustomerInfoToCurrentForm(customerInfo, { customerId = "" } = {}) {
    Object.entries(customerInfo).forEach(([key, value]) => {
        setFieldValue(`customer_info.${key}`, value);
    });
    updateStateTrigger(customerInfo.state_name || "");
    updateCustomStateTrigger("[data-pos-state-trigger-content]", customerInfo.place_of_supply_name || "", "Select place of supply");
    updateNamedStateSelection("[data-state-options]", customerInfo.state_name || "");
    updateNamedStateSelection("[data-pos-state-options]", customerInfo.place_of_supply_name || "");

    if (currentDocType === "invoice") {
        ["name", "contact", "contact2", "email", "address", "pincode", "pan_aadhaar", "state_name", "state_gst_code"].forEach((key) => {
            updateConsigneeFromCustomerField(key, customerInfo[key]);
        });
    }

    updateNarrationFromCustomerName(customerInfo.name || "");
    setCustomerResolution(customerId ? "accepted" : "new", customerId || "");
    hideCustomerMatchPanel();
}

async function applyPortalReceiptPrefill() {
    if ((pageParams.get("mode") || "").toLowerCase() !== "receipt") return;

    const orderNo = pageParams.get("order_no") || "";
    if (orderNo) {
        try {
            const response = await fetch(`/api/order-match?order_no=${encodeURIComponent(orderNo)}`);
            const data = await response.json();
            const match = data?.match || null;
            if (match) {
                applyCustomerInfoToCurrentForm(buildCustomerInfoFromOrderMatch(match), { customerId: match.customer?.id || "" });
                setFieldValue("invoice_info.order_no", match.order_number || orderNo);
                setFieldValue("invoice_info.linked_reference_no", match.order_number || orderNo);
                setNamedDateTimeValue("invoice_info.order_date", match.order_date || "");
                setFieldValue("payment_info.remarks", match.receipt_adjustment_remarks || "");
            }
        } catch (error) {
            console.error(error);
        }
    }

    const customerInfo = buildCustomerInfoFromPortalParams();
    if (Object.values(customerInfo).some((value) => String(value || "").trim())) {
        applyCustomerInfoToCurrentForm(customerInfo, { customerId: pageParams.get("customer_id") || "" });
    }

    setFieldValue("invoice_info.order_no", pageParams.get("order_no") || getNamedField("invoice_info.order_no")?.value || "");
    setFieldValue("invoice_info.linked_reference_no", pageParams.get("order_no") || getNamedField("invoice_info.linked_reference_no")?.value || "");
    setNamedDateTimeValue("invoice_info.order_date", pageParams.get("order_date") || getNamedField("invoice_info.order_date")?.value || "");
    if (pageParams.get("advance_receipt_no")) {
        setFieldValue("payment_info.remarks", `Against advance receipt ${pageParams.get("advance_receipt_no")}`);
    }

    const description = pageParams.get("advance_description") || "";
    const amount = pageParams.get("advance_amount") || "";
    const cards = itemsContainer.querySelectorAll(".item-card");
    const firstCard = cards[0];
    if (firstCard) {
        const descriptionField = firstCard.querySelector('[data-field="description"]');
        const amountField = firstCard.querySelector('[data-field="amount"]');
        if (descriptionField && description && !String(descriptionField.value || "").trim()) {
            descriptionField.value = description;
        }
        if (amountField && amount && !String(amountField.value || "").trim()) {
            amountField.value = amount;
        }
    }

    syncFinancialSummary();
    persistCurrentDraft();
    queuePreview();
}

function normalizeOrderItemsForInvoice(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
        return [{}];
    }
    return items.map((item) => ({
        description: item.description || "",
        stock_no: item.stock_no || "",
        HUID: item.HUID || "",
        quantity: item.quantity || "1",
        hsn: item.hsn || "71131910",
        purity: item.purity || "",
        gold_silver_rate: item.gold_silver_rate || "",
        gross_weight: item.gross_weight || "",
        stone_dust_deduction: item.stone_dust_deduction || "",
        net_weight: item.net_weight || "",
        rate_per_gram: item.rate_per_gram || item.gold_silver_rate || "",
        gold_silver_amount: item.gold_silver_amount || "",
        diamond_or_stone_weight: item.diamond_or_stone_weight || "",
        diamond_or_stone_amount: item.diamond_or_stone_amount || "",
        stone_expense: item.stone_expense || "",
        other_charges: item.other_charges || "",
        making_charges: item.making_charges || "",
        making_charges_percent: item.making_charges_percent || "",
        show_making_percent: item.show_making_percent ?? true,
        making_baseline: item.making_baseline || "",
        goldsmith_loss: item.goldsmith_loss || "",
        other_expenses: item.other_expenses || "",
        ornament_type: item.ornament_type || "",
        negotiated_total_amount: item.amount || "",
        matched_stock_item_id: item.matched_stock_item_id || "",
        match_status: item.match_status || "new",
        match_source: item.match_source || "",
        amount: item.amount || "",
    }));
}

function normalizeStoredInvoiceItemsForDraft(items = []) {
    return normalizeOrderItemsForInvoice(items);
}

function normalizeStoredReceiptItemsForDraft(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
        return [{}];
    }
    return items.map((item) => ({
        description: item.description || "",
        purity: item.purity || "",
        gross_weight: item.gross_weight || "",
        net_weight: item.net_weight || "",
        rate_per_gram: item.rate_per_gram || "",
        amount: item.amount || "",
    }));
}

function storeInvoiceDraftFromMatch(match) {
    const draft = getDraftSnapshot("invoice");
    draft.customer_info = { ...(draft.customer_info || {}), ...(match.customer_info || {}) };
    draft.consignee_info = { ...(draft.consignee_info || {}), ...(match.consignee_info || {}) };
    draft.invoice_info = { ...(draft.invoice_info || {}), ...(match.invoice_info || {}) };
    draft.charges = { ...(draft.charges || {}), ...(match.charges || {}) };
    draft.payment_info = { ...(draft.payment_info || {}), ...(match.payment_info || {}) };
    draft.items = normalizeStoredInvoiceItemsForDraft(match.items || []);
    draft.resolution = draft.resolution || {};
    draft.resolution.customer = {
        mode: match.customer_id ? "accepted" : "new",
        customer_id: match.customer_id || "",
    };
    draft.document_type = "invoice";
    documentDrafts.invoice = draft;
}

function storeReceiptDraftFromMatch(match) {
    const draft = getDraftSnapshot("receipt");
    draft.customer_info = { ...(draft.customer_info || {}), ...(match.customer_info || {}) };
    draft.invoice_info = { ...(draft.invoice_info || {}), ...(match.invoice_info || {}) };
    draft.charges = { ...(draft.charges || {}), ...(match.charges || {}) };
    draft.payment_info = { ...(draft.payment_info || {}), ...(match.payment_info || {}) };
    draft.items = normalizeStoredReceiptItemsForDraft(match.items || []);
    draft.resolution = draft.resolution || {};
    draft.resolution.customer = {
        mode: match.customer_id ? "accepted" : "new",
        customer_id: match.customer_id || "",
    };
    draft.document_type = "receipt";
    documentDrafts.receipt = draft;
}

function applyOrderMatch(match) {
    if (!match || (currentDocType !== "invoice" && currentDocType !== "receipt")) return;

    const customerInfo = buildCustomerInfoFromOrderMatch(match);
    applyCustomerInfoToCurrentForm(customerInfo, { customerId: match.customer?.id || "" });

    setFieldValue("invoice_info.order_no", match.order_number || "");
    setFieldValue("invoice_info.linked_reference_no", match.order_number || "");
    setNamedDateTimeValue("invoice_info.order_date", match.order_date || "");
    setCopyTypeValue("Original for Buyer");

    if (currentDocType === "invoice" && !isExchangeModeActive()) {
        setFieldValue("payment_info.old_gold_advance", formatCurrencyInput(match.advance_total || 0));
    }
    setFieldValue("payment_info.remarks", match.receipt_adjustment_remarks || "");

    if (currentDocType === "invoice") {
        renderItems(normalizeOrderItemsForInvoice(match.items || []));
        updateTaxMode();
    }

    if (isExchangeModeActive() && isFeatureEnabled("sync_enabled")) {
        syncCustomerPayloadToOtherDraft(customerInfo, { mode: "accepted", customer_id: match.customer?.id || "" });
        syncFieldToOtherDraft("invoice_info.order_no", match.order_number || "");
        syncFieldToOtherDraft("invoice_info.order_date", match.order_date || "");
    }

    syncFinancialSummary();
    persistCurrentDraft();
    queuePreview();
}

function applyInvoiceMatch(match) {
    if (!match) return;
    storeInvoiceDraftFromMatch(match);
    documentDrafts.invoice.invoice_info = {
        ...(documentDrafts.invoice.invoice_info || {}),
        copy_type: "Duplicate",
    };

    if (currentDocType === "invoice") {
        hydrateDocumentDraft("invoice");
    } else {
        const customerInfo = buildCustomerInfoFromDocumentMatch(match);
        applyCustomerInfoToCurrentForm(customerInfo, { customerId: match.customer_id || "" });
        setFieldValue("invoice_info.linked_invoice_no", match.invoice_info?.invoice_no || "");
        setFieldValue("invoice_info.order_no", match.invoice_info?.order_no || "");
        setFieldValue("invoice_info.linked_reference_no", match.invoice_info?.order_no || "");
        setNamedDateTimeValue("invoice_info.order_date", match.invoice_info?.order_date || "");
        setCopyTypeValue("Duplicate");
        syncFinancialSummary();
    }

    persistCurrentDraft();
    queuePreview();
}

function applyReceiptMatch(match) {
    if (!match) return;
    storeReceiptDraftFromMatch(match);
    documentDrafts.receipt.invoice_info = {
        ...(documentDrafts.receipt.invoice_info || {}),
        copy_type: "Duplicate",
    };

    if (currentDocType === "receipt") {
        hydrateDocumentDraft("receipt");
    } else {
        const customerInfo = buildCustomerInfoFromDocumentMatch(match);
        applyCustomerInfoToCurrentForm(customerInfo, { customerId: match.customer_id || "" });
        setFieldValue("invoice_info.linked_receipt_no", match.invoice_info?.invoice_no || "");
        if (match.invoice_info?.order_no) {
            setFieldValue("invoice_info.order_no", match.invoice_info.order_no);
            setFieldValue("invoice_info.linked_reference_no", match.invoice_info.order_no);
        }
        if (match.invoice_info?.order_date) {
            setNamedDateTimeValue("invoice_info.order_date", match.invoice_info.order_date);
        }
        setCopyTypeValue("Duplicate");
        syncFinancialSummary();
    }

    persistCurrentDraft();
    queuePreview();
}

function syncCustomerPayloadToOtherDraft(customerInfo, resolution = {}) {
    if (!isExchangeModeActive() || !isFeatureEnabled("sync_enabled")) return;
    const otherDraft = documentDrafts[getOtherDocType()];
    if (!otherDraft) return;

    otherDraft.customer_info = {
        ...(otherDraft.customer_info || {}),
        ...customerInfo,
    };

    otherDraft.resolution = otherDraft.resolution || {};
    otherDraft.resolution.customer = {
        ...(otherDraft.resolution.customer || {}),
        ...resolution,
    };

    if (otherDraft.document_type === "invoice") {
        otherDraft.consignee_info = {
            ...(otherDraft.consignee_info || {}),
            name: customerInfo.name || "",
            contact: customerInfo.contact || "",
            contact2: customerInfo.contact2 || "",
            email: customerInfo.email || "",
            address: customerInfo.address || "",
            pincode: customerInfo.pincode || "",
            pan_aadhaar: customerInfo.pan_aadhaar || "",
            state_name: customerInfo.state_name || "",
            state_gst_code: customerInfo.state_gst_code || "",
        };
    }
}

function applyCustomerSuggestion(suggestion) {
    if (!suggestion) return;
    const customerInfo = buildCustomerInfoFromSuggestion(suggestion);
    Object.entries(customerInfo).forEach(([key, value]) => {
        setFieldValue(`customer_info.${key}`, value);
    });
    updateStateTrigger(suggestion.state_name || "");
    updateCustomStateTrigger("[data-pos-state-trigger-content]", suggestion.place_of_supply_name || "", "Select place of supply");
    updateNamedStateSelection("[data-state-options]", suggestion.state_name || "");
    updateNamedStateSelection("[data-pos-state-options]", suggestion.place_of_supply_name || "");
    ["name", "contact", "contact2", "email", "address", "pincode", "pan_aadhaar", "state_name", "state_gst_code"].forEach((key) => {
        updateConsigneeFromCustomerField(key, customerInfo[key]);
    });
    updateNarrationFromCustomerName(customerInfo.name || "");
    updateTaxMode();
    setCustomerResolution("accepted", suggestion.id || "");
    syncCustomerPayloadToOtherDraft(customerInfo, { mode: "accepted", customer_id: suggestion.id || "" });
    hideCustomerMatchPanel();
    syncFinancialSummary();
    persistCurrentDraft();
    queuePreview();
}

function getConfidenceColor(score) {
    if (score >= 0.90) return "#5ba88a";
    if (score >= 0.70) return "var(--gold)";
    return "var(--pearl-muted)";
}

function buildConfidenceRing(score) {
    const pct = Math.round((score || 0) * 100);
    const deg = Math.round(pct * 3.6);
    const color = getConfidenceColor(score);
    return `
        <div class="smart-ring" style="background: conic-gradient(${color} ${deg}deg, rgba(229,222,240,0.10) ${deg}deg)">
            <span class="smart-ring-label">${pct}%</span>
        </div>
    `;
}

function highlightMatch(text, query) {
    if (!query || !text) return escapeMarkup(text || "");
    const escaped = escapeMarkup(text);
    const q = query.trim().toLowerCase();
    if (!q) return escaped;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return escaped;
    const before = escapeMarkup(text.slice(0, idx));
    const match = escapeMarkup(text.slice(idx, idx + q.length));
    const after = escapeMarkup(text.slice(idx + q.length));
    return `${before}<span class="smart-match-identity">${match}</span>${after}`;
}

function renderCustomerSuggestions(suggestions, query) {
    if (!customerMatchPanel) return;
    if (!suggestions || suggestions.length === 0) {
        hideCustomerMatchPanel();
        return;
    }

    customerMatchPanel.hidden = false;
    customerMatchPanel.innerHTML = suggestions.map((suggestion, index) => {
        const pct = Math.round((suggestion.score || 0) * 100);
        const scoreClass = pct >= 90 ? "smart-score-solid" : pct >= 70 ? "smart-score" : "smart-score-amber";

        // Build compact detail fragments — omit empty values
        const line1Parts = [];
        const contacts = [suggestion.primary_contact, suggestion.secondary_contact].filter(Boolean);
        if (contacts.length) line1Parts.push({ label: "Phone", value: contacts.join(" / ") });
        if (suggestion.email) line1Parts.push({ label: "Email", value: suggestion.email });

        const line2Parts = [];
        const addressBits = [suggestion.address_line, suggestion.state_name, suggestion.pincode].filter(Boolean);
        if (addressBits.length) line2Parts.push({ label: "Addr", value: addressBits.join(", ") });
        if (suggestion.pan_aadhaar_no) line2Parts.push({ label: "PAN/ID", value: suggestion.pan_aadhaar_no });

        const renderLine = (parts) => parts.map((p, i) => {
            const sep = i > 0 ? `<span class="smart-detail-sep">·</span>` : "";
            return `${sep}<span class="smart-detail-label">${p.label}</span><span class="smart-detail-value">${escapeMarkup(p.value)}</span>`;
        }).join("");

        const detailsHtml = (line1Parts.length || line2Parts.length) ? `
            <div class="smart-detail-lines">
                ${line1Parts.length ? `<div class="smart-detail-line">${renderLine(line1Parts)}</div>` : ""}
                ${line2Parts.length ? `<div class="smart-detail-line">${renderLine(line2Parts)}</div>` : ""}
            </div>` : "";

        return `
        <div class="smart-panel" data-customer-suggestion-id="${suggestion.id}">
            <div class="smart-panel-header">
                <div class="smart-panel-header-left">
                    <div class="smart-panel-icon">🔍</div>
                    <div class="smart-panel-header-text">
                        <p class="smart-eyebrow">Smart Match</p>
                        <strong>${highlightMatch(suggestion.full_name || "Unnamed Customer", query)}</strong>
                    </div>
                </div>
                <span class="${scoreClass}">${pct}% match</span>
            </div>
            ${detailsHtml}
            <div class="smart-actions" style="justify-content: flex-end;">
                <button type="button" class="smart-button-dismiss" data-customer-reject="${index}" title="Dismiss">✕ Not this</button>
                <button type="button" class="smart-button smart-button-primary" data-customer-accept="${index}">Use this customer</button>
            </div>
        </div>
        `;
    }).join("");

    customerMatchPanel.querySelectorAll("[data-customer-accept]").forEach((button) => {
        button.addEventListener("click", () => {
            const suggestion = suggestions[Number(button.dataset.customerAccept)];
            applyCustomerSuggestion(suggestion);
        });
    });

    customerMatchPanel.querySelectorAll("[data-customer-reject]").forEach((button) => {
        button.addEventListener("click", () => {
            setCustomerResolution("rejected", "");
            hideCustomerMatchPanel();
            persistCurrentDraft();
        });
    });
}

async function fetchCustomerSuggestions() {
    if (currentDocType !== "invoice" && currentDocType !== "receipt") return;
    if (!isFeatureEnabled("recommendations_enabled")) {
        hideCustomerMatchPanel();
        return;
    }
    const name = (form.querySelector('[name="customer_info.name"]')?.value || "").trim();
    const contact = (form.querySelector('[name="customer_info.contact"]')?.value || "").trim();
    const email = (form.querySelector('[name="customer_info.email"]')?.value || "").trim();

    // Need at least one meaningful query
    const hasName = name.length >= 2;
    const hasContact = contact.length >= 3;
    const hasEmail = email.length >= 3;
    if (!hasName && !hasContact && !hasEmail) {
        hideCustomerMatchPanel();
        if ((customerResolutionFields().mode?.value || "new") !== "accepted") {
            setCustomerResolution("new", "");
        }
        return;
    }

    // Build a composite key to detect stale responses
    const queryKey = `${name}|${contact}|${email}`;

    try {
        const params = new URLSearchParams();
        if (hasName) params.set("name", name);
        if (hasContact) params.set("contact", contact);
        if (hasEmail) params.set("email", email);
        const response = await fetch(`/api/customer-suggestions?${params}`);
        if (!response.ok) {
            hideCustomerMatchPanel();
            return;
        }
        const data = await response.json();
        // Stale-check: ensure fields haven't changed during fetch
        const currentName = (form.querySelector('[name="customer_info.name"]')?.value || "").trim();
        const currentContact = (form.querySelector('[name="customer_info.contact"]')?.value || "").trim();
        const currentEmail = (form.querySelector('[name="customer_info.email"]')?.value || "").trim();
        if (`${currentName}|${currentContact}|${currentEmail}` !== queryKey) return;

        const displayQuery = hasName ? name : hasContact ? contact : email;
        renderCustomerSuggestions(data.suggestions || [], displayQuery);
    } catch (error) {
        console.error(error);
        hideCustomerMatchPanel();
    }
}

/* ── Document Match Smart Panel ────────────── */

// Tracks which document field values have been explicitly accepted by the user
// key: field identifier string, value: the accepted document number string
const acceptedDocumentNumbers = {};

function hideDocumentMatchPanel() {
    if (!documentMatchPanel) return;
    documentMatchPanel.hidden = true;
    documentMatchPanel.innerHTML = "";
}

function showDocumentAcceptedBadge(docLabel, docNo) {
    if (!documentMatchPanel) return;
    documentMatchPanel.hidden = false;
    documentMatchPanel.innerHTML = `
        <div class="doc-accepted-badge">
            <span class="doc-accepted-icon">✓</span>
            <span class="doc-accepted-text">${escapeMarkup(docLabel)} <strong>${escapeMarkup(docNo)}</strong> accepted</span>
        </div>
    `;
}

function clearDocumentAccepted(fieldKey) {
    delete acceptedDocumentNumbers[fieldKey];
    hideDocumentMatchPanel();
}

function renderDocumentMatchPanel(match, docLabel, fieldKey, onAccept) {
    if (!documentMatchPanel || !match) return;

    const customerName = match.customer_info?.name || "Unknown Customer";
    const docNo = match.invoice_info?.invoice_no || "";
    const docDate = match.invoice_info?.invoice_date || match.invoice_info?.order_date || "";
    const itemCount = (match.items || []).length;
    const iconMap = { order: "📋", invoice: "🧾", receipt: "🪙" };
    const icon = iconMap[match.document_type] || iconMap[docLabel] || "📄";

    const detailParts = [];
    if (customerName) detailParts.push({ label: "Customer", value: customerName });
    if (docDate) detailParts.push({ label: "Date", value: docDate });
    if (itemCount) detailParts.push({ label: "Items", value: String(itemCount) });

    const renderDetail = (parts) => parts.map((p, i) => {
        const sep = i > 0 ? `<span class="smart-detail-sep">·</span>` : "";
        return `${sep}<span class="smart-detail-label">${p.label}</span><span class="smart-detail-value">${escapeMarkup(p.value)}</span>`;
    }).join("");

    documentMatchPanel.hidden = false;
    documentMatchPanel.innerHTML = `
        <div class="smart-panel">
            <div class="smart-panel-header">
                <div class="smart-panel-header-left">
                    <div class="smart-panel-icon">${icon}</div>
                    <div class="smart-panel-header-text">
                        <p class="smart-eyebrow">Smart Match · ${escapeMarkup(docLabel)}</p>
                        <strong>Found <span class="smart-match-identity">${escapeMarkup(docNo)}</span></strong>
                    </div>
                </div>
                <span class="smart-score smart-score-solid">Found</span>
            </div>
            ${detailParts.length ? `
            <div class="smart-detail-lines">
                <div class="smart-detail-line">${renderDetail(detailParts)}</div>
            </div>` : ""}
            <div class="smart-actions" style="justify-content: flex-end;">
                <button type="button" class="smart-button-dismiss" id="doc-match-reject" title="Dismiss">✕ Not this</button>
                <button type="button" class="smart-button smart-button-primary" id="doc-match-accept">Use this ${escapeMarkup(docLabel.toLowerCase())}</button>
            </div>
        </div>
    `;
    documentMatchPanel.querySelector("#doc-match-accept")?.addEventListener("click", () => {
        // Mark this value as accepted BEFORE calling onAccept, so that
        // any re-triggered fetch (from blur/change on the field) sees it
        acceptedDocumentNumbers[fieldKey] = docNo;
        hideDocumentMatchPanel();
        onAccept();
        // Show the green badge after hydration settles
        requestAnimationFrame(() => showDocumentAcceptedBadge(docLabel, docNo));
    });
    documentMatchPanel.querySelector("#doc-match-reject")?.addEventListener("click", () => {
        hideDocumentMatchPanel();
    });
}

async function fetchOrderMatch(orderNo) {
    const query = String(orderNo || "").trim();
    if ((currentDocType !== "invoice" && currentDocType !== "receipt") || query.length < 1) {
        hideDocumentMatchPanel();
        return;
    }

    // Already accepted — just show badge, skip API call
    if (acceptedDocumentNumbers["order_no"] === query) {
        showDocumentAcceptedBadge("Order", query);
        return;
    }

    try {
        const response = await fetch(`/api/order-match?order_no=${encodeURIComponent(query)}`);
        if (!response.ok) { hideDocumentMatchPanel(); return; }
        const data = await response.json();
        const activeOrderNo = (getNamedField("invoice_info.order_no")?.value || "").trim();
        if (activeOrderNo !== query) return;
        // Re-check: user may have accepted while the API call was in flight
        if (acceptedDocumentNumbers["order_no"] === query) { showDocumentAcceptedBadge("Order", query); return; }
        if (!data.match) { hideDocumentMatchPanel(); return; }
        renderDocumentMatchPanel(
            { ...data.match, document_type: "order", invoice_info: { invoice_no: data.match.order_number || query, invoice_date: data.match.order_date || "" } },
            "Order",
            "order_no",
            () => applyOrderMatch(data.match)
        );
    } catch (error) {
        console.error(error);
        hideDocumentMatchPanel();
    }
}

async function fetchInvoiceMatch(invoiceNo) {
    const query = String(invoiceNo || "").trim();
    if (query.length < 1) { hideDocumentMatchPanel(); return; }

    if (acceptedDocumentNumbers["linked_invoice_no"] === query) {
        showDocumentAcceptedBadge("Invoice", query);
        return;
    }

    try {
        const response = await fetch(`/api/invoice-match?invoice_no=${encodeURIComponent(query)}`);
        if (!response.ok) { hideDocumentMatchPanel(); return; }
        const data = await response.json();
        const activeInvoiceNo = (getNamedField("invoice_info.linked_invoice_no")?.value || "").trim();
        if (activeInvoiceNo !== query) return;
        if (acceptedDocumentNumbers["linked_invoice_no"] === query) { showDocumentAcceptedBadge("Invoice", query); return; }
        if (!data.match) { hideDocumentMatchPanel(); return; }
        renderDocumentMatchPanel(data.match, "Invoice", "linked_invoice_no", () => applyInvoiceMatch(data.match));
    } catch (error) {
        console.error(error);
        hideDocumentMatchPanel();
    }
}

async function fetchReceiptMatch(receiptNo) {
    const query = String(receiptNo || "").trim();
    if (query.length < 1) { hideDocumentMatchPanel(); return; }

    if (acceptedDocumentNumbers["linked_receipt_no"] === query) {
        showDocumentAcceptedBadge("Receipt", query);
        return;
    }

    try {
        const response = await fetch(`/api/receipt-match?receipt_no=${encodeURIComponent(query)}`);
        if (!response.ok) { hideDocumentMatchPanel(); return; }
        const data = await response.json();
        const activeReceiptNo = (getNamedField("invoice_info.linked_receipt_no")?.value || "").trim();
        if (activeReceiptNo !== query) return;
        if (acceptedDocumentNumbers["linked_receipt_no"] === query) { showDocumentAcceptedBadge("Receipt", query); return; }
        if (!data.match) { hideDocumentMatchPanel(); return; }
        renderDocumentMatchPanel(data.match, "Receipt", "linked_receipt_no", () => applyReceiptMatch(data.match));
    } catch (error) {
        console.error(error);
        hideDocumentMatchPanel();
    }
}

async function fetchCurrentDocumentMatch(documentNo) {
    const query = String(documentNo || "").trim();
    if (query.length < 1) { hideDocumentMatchPanel(); return; }

    if (currentDocType === "invoice") {
        if (acceptedDocumentNumbers["invoice_no"] === query) {
            showDocumentAcceptedBadge("Invoice", query);
            return;
        }
        try {
            const response = await fetch(`/api/invoice-match?invoice_no=${encodeURIComponent(query)}`);
            if (!response.ok) { hideDocumentMatchPanel(); return; }
            const data = await response.json();
            const activeDocumentNo = (getNamedField("invoice_info.invoice_no")?.value || "").trim();
            if (activeDocumentNo !== query) return;
            if (acceptedDocumentNumbers["invoice_no"] === query) { showDocumentAcceptedBadge("Invoice", query); return; }
            if (!data.match) { hideDocumentMatchPanel(); return; }
            renderDocumentMatchPanel(data.match, "Invoice", "invoice_no", () => applyInvoiceMatch(data.match));
        } catch (error) {
            console.error(error);
            hideDocumentMatchPanel();
        }
        return;
    }

    if (acceptedDocumentNumbers["receipt_no"] === query) {
        showDocumentAcceptedBadge("Receipt", query);
        return;
    }
    try {
        const response = await fetch(`/api/receipt-match?receipt_no=${encodeURIComponent(query)}`);
        if (!response.ok) { hideDocumentMatchPanel(); return; }
        const data = await response.json();
        const activeDocumentNo = (getNamedField("invoice_info.invoice_no")?.value || "").trim();
        if (activeDocumentNo !== query) return;
        if (acceptedDocumentNumbers["receipt_no"] === query) { showDocumentAcceptedBadge("Receipt", query); return; }
        if (!data.match) { hideDocumentMatchPanel(); return; }
        renderDocumentMatchPanel(data.match, "Receipt", "receipt_no", () => applyReceiptMatch(data.match));
    } catch (error) {
        console.error(error);
        hideDocumentMatchPanel();
    }
}

/* ── Item Cards ─────────────────────────────── */
function updateItemCountBadge() {
    const count = itemsContainer.querySelectorAll(".item-card").length;
    itemCountBadge.textContent = count;
}

function getItemField(card, name) {
    return card.querySelector(`[data-field="${name}"]`);
}

function getItemCategory(card) {
    return detectItemCategory(getItemField(card, "hsn")?.value);
}

function getItemFieldLabel(card, name) {
    return getItemField(card, name)?.closest("label") || null;
}

function syncMakingPercentVisibilityControl(card) {
    const showMakingPercentField = getItemField(card, "show_making_percent");
    const makingPercentField = getItemField(card, "making_charges_percent");
    if (!showMakingPercentField || !makingPercentField) return;

    const category = getItemCategory(card);
    const categoryAllowsPercent = categoryAllowsMakingPercent(category);
    const showMakingPercent = showMakingPercentField.type === "checkbox"
        ? showMakingPercentField.checked
        : toBoolean(showMakingPercentField.value, true);
    const disabled = !categoryAllowsPercent || !showMakingPercent;
    makingPercentField.disabled = disabled;
    makingPercentField.closest("label")?.classList.toggle("is-disabled", disabled);
}

function getNegotiatedAdjustmentField(category) {
    if (category === "stone") return "diamond_or_stone_amount";
    if (category === "imitation") return "other_charges";
    return "making_charges";
}

function syncItemCategoryControls(card, { clearRemovedValues = true, clearCategoryAmounts = false } = {}) {
    const category = getItemCategory(card);
    const allowsMakingCharges = categoryAllowsMakingCharges(category);
    const allowsMakingPercent = categoryAllowsMakingPercent(category);

    getItemFieldLabel(card, "making_charges")?.classList.toggle("hidden-by-category", !allowsMakingCharges);
    getItemFieldLabel(card, "making_charges_percent")?.classList.toggle("hidden-by-category", !allowsMakingPercent);
    getItemFieldLabel(card, "show_making_percent")?.classList.toggle("hidden-by-category", !allowsMakingPercent);

    const makingChargesField = getItemField(card, "making_charges");
    const makingPercentField = getItemField(card, "making_charges_percent");
    const showMakingPercentField = getItemField(card, "show_making_percent");
    if (clearRemovedValues && !allowsMakingCharges && makingChargesField) {
        makingChargesField.value = "";
    }
    if (clearRemovedValues && !allowsMakingPercent) {
        if (makingPercentField) makingPercentField.value = "";
        if (showMakingPercentField) showMakingPercentField.checked = false;
    }
    if (clearCategoryAmounts) {
        if (category === "silver") {
            const rateField = getItemField(card, "gold_silver_rate");
            const amountField = getItemField(card, "gold_silver_amount");
            if (rateField) rateField.value = "";
            if (amountField) amountField.value = "";
        } else if (category === "stone") {
            const rateField = getItemField(card, "gold_silver_rate");
            const metalAmountField = getItemField(card, "gold_silver_amount");
            const otherChargesField = getItemField(card, "other_charges");
            if (rateField) rateField.value = "";
            if (metalAmountField) metalAmountField.value = "";
            if (otherChargesField) otherChargesField.value = "";
        } else if (category === "imitation") {
            const rateField = getItemField(card, "gold_silver_rate");
            const metalAmountField = getItemField(card, "gold_silver_amount");
            const stoneAmountField = getItemField(card, "diamond_or_stone_amount");
            if (rateField) rateField.value = "";
            if (metalAmountField) metalAmountField.value = "";
            if (stoneAmountField) stoneAmountField.value = "";
        }
    }

    const negotiatedHint = card.querySelector(".negotiated-total-field .field-hint");
    if (negotiatedHint) {
        const targetField = getNegotiatedAdjustmentField(category);
        const targetLabel = {
            diamond_or_stone_amount: "stone amount",
            other_charges: "hallmark / misc",
            making_charges: "making charges",
        }[targetField];
        negotiatedHint.textContent = `Auto-fills · Enter to back-calculate ${targetLabel}`;
    }

    syncMakingPercentVisibilityControl(card);
}

function formatWeightInput(value) {
    return toNumber(value) ? toNumber(value).toFixed(3) : "";
}

function getHsnTaxPercent(hsnCode) {
    return STONE_HSN_CODES.has(String(hsnCode || "").trim()) ? 0.25 : 3;
}

function getCardTaxPercent(card) {
    return currentDocType === "receipt" ? 0 : getHsnTaxPercent(getItemField(card, "hsn")?.value);
}

function calculateTaxGroups(lines, discount, isIgst) {
    const totalAmount = lines.reduce((sum, line) => sum + line.amount, 0);
    const appliedDiscount = Math.min(Math.max(discount, 0), totalAmount);
    const groups = new Map();
    lines.forEach(({ amount, rate }) => {
        const taxable = Math.max(amount - (totalAmount ? appliedDiscount * amount / totalAmount : 0), 0);
        groups.set(rate, (groups.get(rate) || 0) + taxable);
    });
    return [...groups.entries()].sort(([left], [right]) => right - left).map(([rate, taxable]) => {
        const roundedTaxable = roundCurrency(taxable);
        const sgst = isIgst ? 0 : roundCurrency(roundedTaxable * (rate / 2) / 100);
        const cgst = isIgst ? 0 : roundCurrency(roundedTaxable * (rate / 2) / 100);
        const igst = isIgst ? roundCurrency(roundedTaxable * rate / 100) : 0;
        return { rate, taxable: roundedTaxable, sgst, cgst, igst, totalTax: sgst + cgst + igst };
    });
}

function ensureNegotiatedFieldValue(card, totalWithTax) {
    const negotiatedField = getItemField(card, "negotiated_total_amount");
    if (!negotiatedField) return;
    if (document.activeElement === negotiatedField) return;
    if (!negotiatedField.value.trim() || negotiatedField.dataset.locked !== "true") {
        negotiatedField.value = totalWithTax ? totalWithTax.toFixed(2) : "";
        negotiatedField.dataset.locked = "false";
    }
}

function syncInvoiceCardCalculations(card, changedField = "") {
    if (currentDocType !== "invoice") return;

    syncItemCategoryControls(card, { clearRemovedValues: changedField === "hsn" || changedField === "match_apply" });
    const category = getItemCategory(card);
    const allowsMakingCharges = categoryAllowsMakingCharges(category);
    const allowsMakingPercent = categoryAllowsMakingPercent(category);
    const grossField = getItemField(card, "gross_weight");
    const deductionField = getItemField(card, "stone_dust_deduction");
    const quantityField = getItemField(card, "quantity");
    const netField = getItemField(card, "net_weight");
    const rateField = getItemField(card, "gold_silver_rate");
    const amountField = getItemField(card, "gold_silver_amount");
    const makingChargesField = getItemField(card, "making_charges");
    const makingPercentField = getItemField(card, "making_charges_percent");
    const stoneAmountField = getItemField(card, "diamond_or_stone_amount");
    const otherChargesField = getItemField(card, "other_charges");
    const totalField = getItemField(card, "amount");
    if (!grossField || !netField || !rateField || !amountField || !makingChargesField || !makingPercentField || !stoneAmountField || !otherChargesField || !totalField) {
        return;
    }

    const grossWeight = toNumber(grossField.value);
    const deductionWeight = toNumber(deductionField?.value);
    if (isFeatureEnabled("sync_enabled") && (changedField === "gross_weight" || changedField === "stone_dust_deduction")) {
        const derivedNet = Math.max(grossWeight - deductionWeight, 0);
        netField.value = derivedNet ? derivedNet.toFixed(3) : "";
    }

    if (isFeatureEnabled("sync_enabled") && quantityField && changedField === "quantity" && category !== "stone" && category !== "imitation") {
        const quantity = Math.max(toNumber(quantityField.value) || 1, 1);
        const defaultCharge = roundCurrency(quantity * getNumericSetting("hallmark_charge_per_item", 53));
        otherChargesField.value = defaultCharge ? defaultCharge.toFixed(2) : "";
    }

    const netWeight = toNumber(netField.value);
    const goldRate = toNumber(rateField.value);
    const goldAmount = roundCurrency(goldRate * netWeight);
    if (changedField === "gold_silver_rate" || changedField === "net_weight" || changedField === "gross_weight" || changedField === "stone_dust_deduction") {
        amountField.value = goldAmount ? goldAmount.toFixed(2) : "";
    }

    const baseGoldAmount = toNumber(amountField.value);
    if (!allowsMakingCharges) {
        makingChargesField.value = "";
        makingPercentField.value = "";
        card.dataset.makingMode = "charges";
    } else if (changedField === "making_charges") {
        card.dataset.makingMode = "charges";
    } else if (allowsMakingPercent && changedField === "making_charges_percent") {
        card.dataset.makingMode = "percent";
    }

    const makingMode = allowsMakingPercent
        ? (card.dataset.makingMode || (makingPercentField.value.trim() ? "percent" : "charges"))
        : "charges";
    let makingCharges = allowsMakingCharges ? toNumber(makingChargesField.value) : 0;
    let makingPercent = allowsMakingPercent ? toNumber(makingPercentField.value) : 0;
    if (allowsMakingPercent && baseGoldAmount > 0) {
        const shouldDriveFromPercent =
            changedField === "making_charges_percent"
            || (makingMode === "percent" && (!makingChargesField.value.trim() || ["gold_silver_rate", "net_weight", "gross_weight", "stone_dust_deduction", "match_apply", "tax_refresh"].includes(changedField)));
        if (shouldDriveFromPercent) {
            makingCharges = roundCurrency(baseGoldAmount * (makingPercent / 100));
            makingChargesField.value = makingCharges ? makingCharges.toFixed(2) : "";
        } else {
            makingPercent = roundCurrency((makingCharges / baseGoldAmount) * 100);
            makingPercentField.value = makingCharges ? makingPercent.toFixed(2) : "";
        }
    } else if (!allowsMakingPercent || changedField === "making_charges") {
        makingPercentField.value = "";
    }

    const lineTotal = roundCurrency(
        baseGoldAmount
        + toNumber(stoneAmountField.value)
        + toNumber(otherChargesField.value)
        + toNumber(makingChargesField.value)
    );
    totalField.value = lineTotal ? lineTotal.toFixed(2) : "";

    const negotiatedTotal = roundCurrency(lineTotal * (1 + getCardTaxPercent(card) / 100));
    ensureNegotiatedFieldValue(card, negotiatedTotal);
}

function backCalculateFromNegotiatedTotal(card) {
    if (currentDocType !== "invoice") return;
    if (!isFeatureEnabled("back_calculation_enabled")) return;
    syncItemCategoryControls(card, { clearRemovedValues: true });
    const category = getItemCategory(card);
    const adjustmentFieldName = getNegotiatedAdjustmentField(category);
    const negotiatedField = getItemField(card, "negotiated_total_amount");
    const amountField = getItemField(card, "gold_silver_amount");
    const stoneAmountField = getItemField(card, "diamond_or_stone_amount");
    const otherChargesField = getItemField(card, "other_charges");
    const makingChargesField = getItemField(card, "making_charges");
    const makingPercentField = getItemField(card, "making_charges_percent");
    const totalField = getItemField(card, "amount");
    if (!negotiatedField || !amountField || !stoneAmountField || !otherChargesField || !makingChargesField || !makingPercentField || !totalField) return;

    const targetWithTax = toNumber(negotiatedField.value);
    if (!targetWithTax) {
        negotiatedField.dataset.locked = "false";
        syncInvoiceCardCalculations(card, "negotiated_total_amount");
        return;
    }

    const taxMultiplier = 1 + getCardTaxPercent(card) / 100;
    const preTaxTarget = roundCurrency(targetWithTax / taxMultiplier);
    const values = {
        gold_silver_amount: toNumber(amountField.value),
        diamond_or_stone_amount: toNumber(stoneAmountField.value),
        other_charges: toNumber(otherChargesField.value),
        making_charges: categoryAllowsMakingCharges(category) ? toNumber(makingChargesField.value) : 0,
    };
    const adjustmentField = getItemField(card, adjustmentFieldName);
    if (!adjustmentField) return;
    const fixedTotal = Object.entries(values)
        .filter(([fieldName]) => fieldName !== adjustmentFieldName)
        .reduce((sum, [, value]) => sum + value, 0);
    const recalculatedAmount = Math.max(roundCurrency(preTaxTarget - fixedTotal), 0);
    adjustmentField.value = recalculatedAmount.toFixed(2);

    if (adjustmentFieldName === "making_charges" && categoryAllowsMakingPercent(category) && values.gold_silver_amount > 0) {
        makingPercentField.value = ((recalculatedAmount / values.gold_silver_amount) * 100).toFixed(2);
    } else if (!categoryAllowsMakingPercent(category)) {
        makingPercentField.value = "";
    }
    totalField.value = preTaxTarget.toFixed(2);
    negotiatedField.value = targetWithTax.toFixed(2);
    negotiatedField.dataset.locked = "true";
    card.dataset.makingMode = adjustmentFieldName === "making_charges" ? "charges" : "";
    syncFinancialSummary();
    persistCurrentDraft();
    queuePreview();
}

function bindItemFieldEvents(card, input) {
    input.addEventListener("input", () => {
        if (input.dataset.field === "show_making_percent") {
            syncMakingPercentVisibilityControl(card);
        }
        if (!isHydratingView) {
            persistCurrentDraft();
        }
        if (currentDocType === "receipt") {
            syncReceiptCardCalculations(card, input.dataset.field);
        } else {
            if (input.dataset.field === "negotiated_total_amount") {
                input.dataset.locked = "true";
            } else {
                syncInvoiceCardCalculations(card, input.dataset.field);
            }
        }
        syncFinancialSummary();
        queuePreview();
    });
    input.addEventListener("focus", () => syncPreviewToItem(card));
    input.addEventListener("change", () => {
        if (input.dataset.field === "show_making_percent") {
            syncMakingPercentVisibilityControl(card);
        }
        if (!isHydratingView) {
            persistCurrentDraft();
        }
        if (currentDocType === "invoice" && input.dataset.field !== "negotiated_total_amount") {
            syncInvoiceCardCalculations(card, input.dataset.field);
            syncFinancialSummary();
            queuePreview();
        }
        syncPreviewToItem(card);
    });
    if (input.dataset.field === "negotiated_total_amount") {
        input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            backCalculateFromNegotiatedTotal(card);
        });
    }
}

function syncReceiptCardCalculations(card, changedField = "") {
    if (currentDocType !== "receipt") return;

    const grossField = card.querySelector('[data-field="gross_weight"]');
    const netField = card.querySelector('[data-field="net_weight"]');
    const rateField = card.querySelector('[data-field="rate_per_gram"]');
    const amountField = card.querySelector('[data-field="amount"]');
    if (!grossField || !netField || !rateField || !amountField) return;

    const grossWeight = toNumber(grossField.value);
    const netWeight = toNumber(netField.value);
    const rate = toNumber(rateField.value);

    if (changedField === "gross_weight" && !netField.value.trim()) {
        netField.value = grossWeight ? grossWeight.toFixed(3) : "";
    }

    if (changedField !== "amount") {
        const derivedNet = toNumber(netField.value);
        const computedAmount = derivedNet * rate;
        amountField.value = computedAmount ? computedAmount.toFixed(2) : "";
    }
}

function hideItemMatchPanel(card) {
    const panel = card.querySelector("[data-item-match-panel]");
    if (!panel) return;
    panel.hidden = true;
    panel.innerHTML = "";
}

function setItemMatchState(card, { status = "new", stockItemId = "", source = "" } = {}) {
    const statusField = getItemField(card, "match_status");
    const stockItemField = getItemField(card, "matched_stock_item_id");
    const sourceField = getItemField(card, "match_source");
    if (statusField) statusField.value = status;
    if (stockItemField) stockItemField.value = stockItemId;
    if (sourceField) sourceField.value = source;
}

function applyItemMatch(card, match) {
    if (!match) return;
    const category = detectItemCategory(match.hsn_code);
    const netWeight = toNumber(match.net_weight_g);
    const silverRate = toNumber(match.silver_cost_price_per_gm || match.rate_per_gram);
    const silverTotal = toNumber(match.silver_cost_total_price || match.gold_silver_amount)
        || (silverRate && netWeight ? roundCurrency(silverRate * netWeight) : 0);
    const allowsMakingCharges = categoryAllowsMakingCharges(category);
    const allowsMakingPercent = categoryAllowsMakingPercent(category);
    const makingCharges = category === "silver"
        ? silverTotal
        : (allowsMakingCharges ? toNumber(match.making_charges_amount) : 0);
    const stoneTotal = category === "stone"
        ? (
            toNumber(match.other_charges_amount)
            || toNumber(match.stone_amount)
            || roundCurrency(toNumber(match.stone_cost_per_ratti) * toNumber(match.weight_ratti))
        )
        : toNumber(match.stone_amount);
    const imitationTotal = category === "imitation"
        ? (toNumber(match.other_charges_amount) || toNumber(match.gold_silver_amount) || toNumber(match.stone_amount))
        : 0;
    const shouldUseMetalFields = category !== "silver" && category !== "stone" && category !== "imitation";
    const mapping = {
        stock_no: match.stock_no || "",
        HUID: match.huid || "",
        description: match.description || "",
        quantity: match.quantity || "",
        hsn: match.hsn_code || "",
        purity: match.purity || "",
        gross_weight: match.gross_weight_g || "",
        stone_dust_deduction: match.stone_dust_deduction_g || "",
        net_weight: match.net_weight_g || "",
        gold_silver_rate: shouldUseMetalFields ? (match.rate_per_gram || "") : "",
        gold_silver_amount: shouldUseMetalFields ? (match.gold_silver_amount || "") : "",
        diamond_or_stone_weight: category === "stone" ? (match.weight_ratti || match.stone_weight_g || "") : (category === "imitation" ? "" : (match.stone_weight_g || "")),
        diamond_or_stone_amount: category === "imitation" ? "" : (stoneTotal || ""),
        stone_expense: match.stone_expense || "",
        other_charges: category === "stone" ? "" : (category === "imitation" ? (imitationTotal || "") : (match.other_charges_amount || "")),
        making_charges: allowsMakingCharges ? (makingCharges || "") : "",
        making_charges_percent: allowsMakingPercent ? (match.making_charges_percent || "") : "",
        show_making_percent: allowsMakingPercent ? (match.show_making_percent ?? true) : false,
        making_baseline: match.making_baseline || "",
        goldsmith_loss: match.goldsmith_loss || "",
        other_expenses: match.other_expenses || "",
        ornament_type: match.ornament_type || "",
    };
    Object.entries(mapping).forEach(([key, value]) => {
        const field = getItemField(card, key);
        if (field) {
            if (field.type === "checkbox") {
                field.checked = toBoolean(value, true);
            } else {
                field.value = value ?? "";
            }
        }
    });
    syncItemCategoryControls(card);
    setItemMatchState(card, {
        status: "accepted",
        stockItemId: match.id || "",
        source: match.huid ? "huid" : "stock_no",
    });
    updateHsnTrigger(card, match.hsn_code || "");
    // Update purity trigger if purity was set
    const purityHidden = card.querySelector('[data-field="purity"]');
    if (purityHidden && purityHidden.value) {
        updatePurityTrigger(card, purityHidden.value);
    }
    syncInvoiceCardCalculations(card, "match_apply");
    hideItemMatchPanel(card);
    syncFinancialSummary();
    persistCurrentDraft();
    queuePreview();
}

function renderItemMatch(card, match, identityText) {
    const panel = card.querySelector("[data-item-match-panel]");
    if (!panel || !match) return;
    const statusRaw = (match.status || "in_stock").replaceAll("_", " ");
    const statusClass = statusRaw === "in stock" ? "smart-score-solid" : "smart-score-amber";
    panel.hidden = false;
    panel.innerHTML = `
        <div class="smart-panel-header">
            <div class="smart-panel-header-left">
                <div class="smart-panel-icon">📦</div>
                <div class="smart-panel-header-text">
                    <p class="smart-eyebrow">Inventory Match</p>
                    <strong>Found <span class="smart-match-identity">${escapeMarkup(identityText)}</span> in stock</strong>
                </div>
            </div>
            <span class="smart-score ${statusClass}">${statusRaw}</span>
        </div>
        <div class="smart-detail-lines">
            <div class="smart-detail-line">
                <span class="smart-detail-label">Desc</span><span class="smart-detail-value">${escapeMarkup(match.description || "--")}</span>
                ${match.stock_no ? `<span class="smart-detail-sep">·</span><span class="smart-detail-label">Stock</span><span class="smart-detail-value">${escapeMarkup(match.stock_no)}</span>` : ""}
                ${match.huid ? `<span class="smart-detail-sep">·</span><span class="smart-detail-label">HUID</span><span class="smart-detail-value">${escapeMarkup(match.huid)}</span>` : ""}
            </div>
            <div class="smart-detail-line">
                <span class="smart-detail-label">Purity</span><span class="smart-detail-value">${escapeMarkup(match.purity || "--")}</span>
                <span class="smart-detail-sep">·</span><span class="smart-detail-label">Net Wt</span><span class="smart-detail-value">${toNumber(match.net_weight_g).toFixed(3)}g</span>
                <span class="smart-detail-sep">·</span><span class="smart-detail-label">Stone</span><span class="smart-detail-value">₹${toNumber(match.stone_amount).toFixed(2)}</span>
                <span class="smart-detail-sep">·</span><span class="smart-detail-label">Other</span><span class="smart-detail-value">₹${toNumber(match.other_charges_amount).toFixed(2)}</span>
            </div>
        </div>
        <div class="smart-actions" style="justify-content: flex-end;">
            <button type="button" class="smart-button-dismiss" data-item-reject title="Dismiss">✕ Not this</button>
            <button type="button" class="smart-button smart-button-primary" data-item-accept>Use this item</button>
        </div>
    `;
    panel.querySelector("[data-item-accept]")?.addEventListener("click", () => applyItemMatch(card, match));
    panel.querySelector("[data-item-reject]")?.addEventListener("click", () => {
        setItemMatchState(card, { status: "rejected", stockItemId: "", source: "" });
        hideItemMatchPanel(card);
        persistCurrentDraft();
    });
}

async function lookupItemMatch(card) {
    if (currentDocType !== "invoice") return;
    if (!isFeatureEnabled("recommendations_enabled")) {
        hideItemMatchPanel(card);
        return;
    }
    const stockNo = (getItemField(card, "stock_no")?.value || "").trim();
    const huid = (getItemField(card, "HUID")?.value || "").trim();
    if (!stockNo && !huid) {
        hideItemMatchPanel(card);
        setItemMatchState(card, { status: "new", stockItemId: "", source: "" });
        return;
    }

    try {
        const response = await fetch(`/api/item-match?stock_no=${encodeURIComponent(stockNo)}&huid=${encodeURIComponent(huid)}`);
        if (!response.ok) {
            hideItemMatchPanel(card);
            return;
        }
        const data = await response.json();
        const currentStock = (getItemField(card, "stock_no")?.value || "").trim();
        const currentHuid = (getItemField(card, "HUID")?.value || "").trim();
        if (currentStock !== stockNo || currentHuid !== huid) return;
        if (data.match) {
            const identity = huid || stockNo;
            renderItemMatch(card, data.match, identity);
        } else {
            hideItemMatchPanel(card);
            if ((getItemField(card, "match_status")?.value || "new") !== "accepted") {
                setItemMatchState(card, { status: "new", stockItemId: "", source: "" });
            }
        }
    } catch (error) {
        console.error(error);
        hideItemMatchPanel(card);
    }
}

function createItemCard(item = {}) {
    const template = currentDocType === "receipt" ? receiptItemTemplate : invoiceItemTemplate;
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".item-card");
    const index = itemsContainer.children.length + 1;

    // Set title and numbered badge
    const title = fragment.querySelector(".item-title");
    title.textContent = `Item ${index}`;
    const badge = fragment.querySelector(".item-number-badge");
    badge.textContent = index;

    // Populate standard fields
    fragment.querySelectorAll("[data-field]").forEach((input) => {
        let value = item[input.dataset.field] ?? "";
        // Default HSN to Plain Gold Jewellery for new invoice items
        if (input.dataset.field === "hsn" && input.type === "hidden" && value === "") {
            value = "71131910";
        }
        if (input.dataset.field === "hsn" && input.type === "hidden") {
            input.value = value;
        } else if (input.type === "checkbox") {
            input.checked = toBoolean(value, true);
            bindItemFieldEvents(card, input);
        } else {
            input.value = value;
            if (input.type !== "hidden") {
                bindItemFieldEvents(card, input);
            }
        }
        if (input.dataset.field === "hsn" && input.type === "hidden") {
            input.addEventListener("focus", () => syncPreviewToItem(card));
            input.addEventListener("change", () => syncPreviewToItem(card));
        }
    });
    syncItemCategoryControls(card);

    if (currentDocType === "invoice") {
        initHsnDropdown(card);
        // After init, update the HSN trigger for the default value
        const hsnHidden = card.querySelector('[data-field="hsn"]');
        if (hsnHidden && hsnHidden.value) {
            updateHsnTrigger(card, hsnHidden.value);
            // Mark the default option as selected in the portaled panel
            if (card._hsnPanel) {
                const defaultOpt = card._hsnPanel.querySelector(`[data-code="${hsnHidden.value}"]`);
                if (defaultOpt) defaultOpt.classList.add("selected");
            }
        }
        initPurityDropdown(card);
        const purityHidden = card.querySelector('[data-field="purity"]');
        if (purityHidden && purityHidden.value) {
            updatePurityTrigger(card, purityHidden.value);
        }
        const stockField = getItemField(card, "stock_no");
        const huidField = getItemField(card, "HUID");
        [stockField, huidField].filter(Boolean).forEach((field) => {
            field.addEventListener("blur", () => lookupItemMatch(card));
            field.addEventListener("input", () => {
                if ((getItemField(card, "match_status")?.value || "new") === "accepted") {
                    setItemMatchState(card, { status: "new", stockItemId: "", source: "" });
                }
                window.clearTimeout(card._itemLookupTimer);
                card._itemLookupTimer = window.setTimeout(() => lookupItemMatch(card), 250);
            });
        });
        const itemCategory = getItemCategory(card);
        if (!item.other_charges && itemCategory !== "stone" && itemCategory !== "imitation") {
            const quantity = Math.max(toNumber(getItemField(card, "quantity")?.value) || 1, 1);
            const defaultCharge = roundCurrency(quantity * getNumericSetting("hallmark_charge_per_item", 53));
            const otherChargesField = getItemField(card, "other_charges");
            if (otherChargesField) {
                otherChargesField.value = defaultCharge ? defaultCharge.toFixed(2) : "";
            }
        }
        syncInvoiceCardCalculations(card);
        if (item.match_status === "accepted" && item.matched_stock_item_id) {
            setItemMatchState(card, {
                status: item.match_status,
                stockItemId: item.matched_stock_item_id,
                source: item.match_source || "",
            });
        }
    } else {
        initPurityDropdown(card);
        const purityHidden = card.querySelector('[data-field="purity"]');
        if (purityHidden && purityHidden.value) {
            updatePurityTrigger(card, purityHidden.value);
        }
        syncReceiptCardCalculations(card);
    }

    fragment.querySelector(".remove-item").addEventListener("click", () => {
        card.style.opacity = "0";
        card.style.transform = "translateY(-8px) scale(0.98)";
        card.style.transition = "all 200ms cubic-bezier(0.4, 0, 0.2, 1)";
        setTimeout(() => {
            // Clean up the portaled HSN panel from body
            if (card._hsnPanel && card._hsnPanel.parentNode) {
                card._hsnPanel.remove();
            }
            // Clean up the portaled Purity panel from body
            if (card._purityPanel && card._purityPanel.parentNode) {
                card._purityPanel.remove();
            }
            card.remove();
            renumberItems();
            updateItemCountBadge();
            syncFinancialSummary();
            queuePreview();
            checkComplianceWarnings();
        }, 200);
    });

    itemsContainer.appendChild(fragment);
    updateItemCountBadge();
}

function renumberItems() {
    [...itemsContainer.querySelectorAll(".item-card")].forEach((card, index) => {
        card.querySelector(".item-title").textContent = `Item ${index + 1}`;
        card.querySelector(".item-number-badge").textContent = index + 1;
    });
}

function renderItems(items = []) {
    itemsContainer.innerHTML = "";
    const sourceItems = items.length ? items : [{}];
    sourceItems.forEach((item) => createItemCard(item));
    renumberItems();
    updateItemCountBadge();
}

/* ── Preview Sync ───────────────────────────── */
function getPreviewDocument() {
    return previewFrame.contentDocument || previewFrame.contentWindow?.document || null;
}

function scrollPreviewToTarget(targetId, smooth = true) {
    const previewDocument = getPreviewDocument();
    if (!previewDocument) return;

    const target = previewDocument.getElementById(targetId);
    if (!target) return;

    target.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
        block: "start",
    });
}

function setPreviewTarget(targetId, smooth = true) {
    activePreviewTarget = targetId;
    pendingPreviewTarget = targetId;
    scrollPreviewToTarget(targetId, smooth);
}

function syncPreviewToSection(section) {
    const targetId = section?.dataset.previewTarget;
    if (!targetId) return;
    setPreviewTarget(targetId);
}

function syncPreviewToItem(card) {
    const cards = [...itemsContainer.querySelectorAll(".item-card")];
    const index = cards.indexOf(card);
    const itemsPerPage = currentDocType === "receipt"
        ? Math.max(Math.round(getNumericSetting("receipt_item_limit", 4)), 1)
        : Math.max(Math.round(getNumericSetting("invoice_item_limit", 3)), 1);
    const page = Math.floor(Math.max(index, 0) / itemsPerPage) + 1;
    setPreviewTarget(`preview-page-${page}`);
}

function updatePreviewTargetFromScroll() {
    const sections = [...form.querySelectorAll(".form-section")].filter((section) => !section.hidden);
    const panelRect = workspacePanel.getBoundingClientRect();
    const guideLine = panelRect.top + 140;

    let bestSection = sections[0];
    let bestDistance = Number.POSITIVE_INFINITY;

    sections.forEach((section) => {
        const rect = section.getBoundingClientRect();
        const distance = Math.abs(rect.top - guideLine);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestSection = section;
        }
    });

    if (!bestSection) return;

    if (bestSection.classList.contains("items-section")) {
        const focusedCard = document.activeElement?.closest(".item-card");
        if (focusedCard) {
            syncPreviewToItem(focusedCard);
            return;
        }
    }

    syncPreviewToSection(bestSection);
}

/* ── Form Serialization ─────────────────────── */
function getNestedValue(container, path, value) {
    const parts = path.split(".");
    let cursor = container;
    parts.forEach((part, index) => {
        const isLeaf = index === parts.length - 1;
        if (isLeaf) {
            cursor[part] = value;
            return;
        }
        if (!cursor[part] || typeof cursor[part] !== "object") {
            cursor[part] = {};
        }
        cursor = cursor[part];
    });
}

function serializeForm(docType = currentDocType) {
    const payload = {
        customer_info: {},
        consignee_info: {},
        invoice_info: {},
        charges: {},
        payment_info: {},
        items: [],
        document_type: docType,
        workflow_context: { ...workflowContext },
    };

    const namedFields = [
        ...form.querySelectorAll("[name]"),
        ...document.querySelectorAll(`[form="${form.id}"][name]`),
    ];

    namedFields.forEach((field) => {
        if (field.name) {
            const fieldValue = field.type === "checkbox" ? field.checked : field.value;
            getNestedValue(payload, field.name, fieldValue);
        }
    });

    itemsContainer.querySelectorAll(".item-card").forEach((card) => {
        const item = {};
        card.querySelectorAll("[data-field]").forEach((field) => {
            item[field.dataset.field] = field.type === "checkbox" ? field.checked : field.value;
        });
        payload.items.push(item);
    });

    if (!payload.invoice_info.linked_reference_no && payload.invoice_info.order_no) {
        payload.invoice_info.linked_reference_no = payload.invoice_info.order_no;
    }

    return payload;
}

function persistCurrentDraft() {
    documentDrafts[currentDocType] = serializeForm(currentDocType);
    cloneCurrentSettingsIntoDrafts();
    if (isExchangeModeActive()) {
        const netAmountField = getPaymentField("net_amount");
        applyExchangeAdjustments({
            preserveInvoiceNetInput: currentDocType === "invoice" && document.activeElement === netAmountField,
        });
    }
}

function hydrateDocumentDraft(docType) {
    const draft = documentDrafts[docType];
    if (!draft) return;

    if (isExchangeModeActive()) {
        applyExchangeAdjustments();
    }
    isHydratingView = true;
    hydrateScalarFields(draft);
    renderItems(draft.items || []);
    isHydratingView = false;

    syncFinancialSummary();
    updateTaxMode();
    updatePreviewTargetFromScroll();
}

/* ── API Communication ──────────────────────── */
async function postJson(url, payload) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Request failed: ${response.status}`);
    }

    return response.json();
}

async function refreshPreview() {
    setStatus("Refreshing preview…");
    try {
        const payload = serializeForm();
        const data = await postJson("/api/preview", payload);
        pendingPreviewTarget = activePreviewTarget;
        previewFrame.srcdoc = data.html;
        setStatus("Preview ready");
    } catch (error) {
        setStatus("Preview failed", true);
        console.error(error);
    }
}

function queuePreview() {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(refreshPreview, 400);
}

function roundCurrency(value) {
    return Math.round(value * 100) / 100;
}

function formatCurrencyInput(value) {
    return roundCurrency(value).toFixed(2);
}

function formatExchangeNetFieldValue(value) {
    return roundCurrency(value) <= 0 ? "" : formatCurrencyInput(value);
}

function getPaymentField(name) {
    return form.querySelector(`[name="payment_info.${name}"]`);
}

function calculateRoundedTotal(totalBeforeOldGold) {
    const lower = Math.floor(totalBeforeOldGold);
    const decimal = totalBeforeOldGold - lower;
    return decimal >= 0.5 ? Math.ceil(totalBeforeOldGold) : lower;
}

function calculateFinancialSummary(discountOverride = null) {
    let totalAmount = 0;
    const invoiceLines = [];
    itemsContainer.querySelectorAll(".item-card").forEach((card) => {
        if (currentDocType === "receipt") {
            totalAmount += parseFloat(card.querySelector('[data-field="amount"]')?.value) || 0;
            return;
        }

        const goldSilver = parseFloat(card.querySelector('[data-field="gold_silver_amount"]')?.value) || 0;
        const stoneAmt = parseFloat(card.querySelector('[data-field="diamond_or_stone_amount"]')?.value) || 0;
        const otherCharges = parseFloat(card.querySelector('[data-field="other_charges"]')?.value) || 0;
        const makingCharges = parseFloat(card.querySelector('[data-field="making_charges"]')?.value) || 0;
        const rate = getCardTaxPercent(card);
        const inclusiveAmount = toNumber(getItemField(card, "negotiated_total_amount")?.value);
        const calculatedLineAmount = parseFloat(card.querySelector('[data-field="amount"]')?.value) || (goldSilver + stoneAmt + otherCharges + makingCharges);
        const lineAmount = inclusiveAmount > 0
            ? roundCurrency(inclusiveAmount / (1 + rate / 100))
            : calculatedLineAmount;
        totalAmount += lineAmount;
        invoiceLines.push({ amount: lineAmount, rate });
    });

    if (currentDocType === "receipt") {
        const amountPaid = (
            (parseFloat(form.querySelector('[name="payment_info.cash_amount"]')?.value) || 0) +
            (parseFloat(form.querySelector('[name="payment_info.cheque_amount"]')?.value) || 0) +
            (parseFloat(form.querySelector('[name="payment_info.bank_amount"]')?.value) || 0)
        );
        const lessInvoiceAmount = isExchangeModeActive()
            ? (parseFloat(form.querySelector('[name="payment_info.less_invoice_amount"]')?.value) || 0)
            : 0;
        const netAmount = Math.max(totalAmount - lessInvoiceAmount, 0);
        return {
            totalAmount,
            taxPercent: 0,
            isIgst: false,
            discount: 0,
            taxableAmount: totalAmount,
            totalTax: 0,
            roundOff: 0,
            oldGold: 0,
            lessInvoiceAmount,
            totalBeforeOldGold: totalAmount,
            roundedTotal: totalAmount,
            netAmount,
            amountPaid,
        };
    }

    const posGstCode = (form.querySelector('[name="customer_info.place_of_supply_gst_code"]')?.value || "19").trim();
    const isIgst = posGstCode !== "" && posGstCode !== "19";

    const discount = discountOverride == null
        ? (parseFloat(getPaymentField("discount")?.value) || 0)
        : Math.max(0, discountOverride);
    const taxableAmount = Math.max(totalAmount - discount, 0);
    const taxGroups = calculateTaxGroups(invoiceLines, discount, isIgst);
    const totalTax = taxGroups.reduce((sum, group) => sum + group.totalTax, 0);
    const taxPercent = taxableAmount ? roundCurrency(totalTax * 100 / taxableAmount) : 0;

    const oldGold = parseFloat(getPaymentField("old_gold_advance")?.value) || 0;
    const totalBeforeOldGold = taxableAmount + totalTax;
    const roundedTotal = calculateRoundedTotal(totalBeforeOldGold);
    const roundOff = roundCurrency(roundedTotal - totalBeforeOldGold);
    const netAmount = roundCurrency(roundedTotal - oldGold);

    return {
        totalAmount,
        taxPercent,
        taxGroups,
        isIgst,
        discount,
        taxableAmount,
        totalTax,
        roundOff,
        oldGold,
        totalBeforeOldGold,
        roundedTotal,
        netAmount,
    };
}

function syncFinancialSummary(options = {}) {
    if (syncingFinancialFields) return;

    const discountField = getPaymentField("discount");
    const roundOffField = getPaymentField("round_off");
    const netAmountField = getPaymentField("net_amount");
    if (!discountField || !roundOffField || !netAmountField) return;

    syncingFinancialFields = true;

    try {
        const updatedSummary = calculateFinancialSummary();
        if (currentDocType === "receipt") {
            roundOffField.value = "0.00";
            netAmountField.value = formatExchangeNetFieldValue(updatedSummary.netAmount);
            const receiptTotalField = getPaymentField("receipt_total_display");
            const lessInvoiceField = getPaymentField("less_invoice_amount");
            const receiptNetDisplayField = getPaymentField("receipt_net_display");
            if (receiptTotalField) receiptTotalField.value = formatCurrencyInput(updatedSummary.totalAmount);
            if (lessInvoiceField && isExchangeModeActive()) {
                lessInvoiceField.value = formatCurrencyInput(updatedSummary.lessInvoiceAmount || 0);
            }
            if (receiptNetDisplayField) receiptNetDisplayField.value = formatExchangeNetFieldValue(updatedSummary.netAmount);
            const amountReceivedField = getPaymentField("amount_received");
            if (amountReceivedField && document.activeElement !== amountReceivedField) {
                amountReceivedField.value = formatCurrencyInput(updatedSummary.amountPaid);
            }
        } else {
            roundOffField.value = formatCurrencyInput(updatedSummary.roundOff);
            if (options.updateNetAmount !== false) {
                netAmountField.value = isExchangeModeActive()
                    ? formatExchangeNetFieldValue(updatedSummary.netAmount)
                    : formatCurrencyInput(updatedSummary.netAmount);
            }
        }
        return updatedSummary;
    } finally {
        syncingFinancialFields = false;
    }
}

function findDiscountForTargetNetAmount(targetNetAmount) {
    const baseSummary = calculateFinancialSummary();
    const maxDiscount = roundCurrency(baseSummary.totalAmount);
    const taxMultiplier = 1 + baseSummary.taxPercent / 100;
    const formulaDiscount = Math.max(
        0,
        roundCurrency(baseSummary.totalAmount - ((targetNetAmount + baseSummary.oldGold) / taxMultiplier)),
    );

    let low = 0;
    let high = maxDiscount;

    for (let i = 0; i < 40; i += 1) {
        const mid = (low + high) / 2;
        const summary = calculateFinancialSummary(mid);
        if (summary.netAmount > targetNetAmount) {
            low = mid;
        } else {
            high = mid;
        }
    }

    const candidates = [
        0,
        maxDiscount,
        formulaDiscount,
        roundCurrency(low),
        roundCurrency(high),
        roundCurrency((low + high) / 2),
    ];

    let bestSummary = calculateFinancialSummary(0);
    let bestDiscount = 0;
    let bestDifference = Math.abs(bestSummary.netAmount - targetNetAmount);

    candidates.forEach((candidate) => {
        const boundedDiscount = Math.min(maxDiscount, Math.max(0, candidate));
        const summary = calculateFinancialSummary(boundedDiscount);
        const difference = Math.abs(summary.netAmount - targetNetAmount);

        if (difference < bestDifference || (difference === bestDifference && boundedDiscount > bestDiscount)) {
            bestDifference = difference;
            bestDiscount = boundedDiscount;
            bestSummary = summary;
        }
    });

    return {
        discount: bestDiscount,
        summary: bestSummary,
    };
}

function applyNegotiatedNetAmount() {
    if (currentDocType === "receipt") return;
    if (!isFeatureEnabled("back_calculation_enabled")) return;
    const discountField = getPaymentField("discount");
    const roundOffField = getPaymentField("round_off");
    const netAmountField = getPaymentField("net_amount");
    if (!discountField || !roundOffField || !netAmountField) return;

    const targetNetAmount = parseFloat(netAmountField.value);
    if (Number.isNaN(targetNetAmount)) {
        syncFinancialSummary();
        return;
    }

    const result = findDiscountForTargetNetAmount(targetNetAmount);
    discountField.value = formatCurrencyInput(result.discount);
    roundOffField.value = formatCurrencyInput(result.summary.roundOff);
    netAmountField.value = isExchangeModeActive()
        ? formatExchangeNetFieldValue(result.summary.netAmount)
        : formatCurrencyInput(result.summary.netAmount);
    persistCurrentDraft();
    queuePreview();
    checkComplianceWarnings();
}

function handleNetAmountKeydown(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyNegotiatedNetAmount();
}

/* ── Progress Bar ───────────────────────────── */
const progressOverlay = document.getElementById("progress-overlay");
const progressBar = document.getElementById("progress-bar");
const progressStep = document.getElementById("progress-step");
const progressPercent = document.getElementById("progress-percent");

const PROGRESS_STAGES = [
    { at: 0, label: "Preparing document…" },
    { at: 15, label: "Collecting form data…" },
    { at: 30, label: "Rendering invoice…" },
    { at: 55, label: "Generating PDF…" },
    { at: 75, label: "Optimizing output…" },
    { at: 90, label: "Finalizing…" },
];

let progressValue = 0;
let progressInterval = null;

function showProgress() {
    progressValue = 0;
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    progressStep.textContent = PROGRESS_STAGES[0].label;
    progressOverlay.classList.remove("hiding");
    progressOverlay.classList.add("active");

    let stageIdx = 0;
    progressInterval = setInterval(() => {
        if (progressValue >= 90) {
            clearInterval(progressInterval);
            progressInterval = null;
            return;
        }

        // Ease toward 90 with diminishing increments
        const remaining = 90 - progressValue;
        const step = Math.max(0.5, remaining * 0.06);
        progressValue = Math.min(progressValue + step, 90);

        progressBar.style.width = `${progressValue}%`;
        progressPercent.textContent = `${Math.round(progressValue)}%`;

        // Advance stage label
        while (stageIdx < PROGRESS_STAGES.length - 1 && progressValue >= PROGRESS_STAGES[stageIdx + 1].at) {
            stageIdx++;
            progressStep.textContent = PROGRESS_STAGES[stageIdx].label;
        }
    }, 80);
}

function completeProgress() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    progressValue = 100;
    progressBar.style.width = "100%";
    progressPercent.textContent = "100%";
    progressStep.textContent = "Complete!";

    setTimeout(() => {
        progressOverlay.classList.add("hiding");
        // Wait for the exit animation to finish
        setTimeout(() => {
            progressOverlay.classList.remove("active", "hiding");
            progressBar.style.width = "0%";
        }, 300);
    }, 600);
}

function failProgress() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    progressStep.textContent = "Generation failed";
    progressPercent.textContent = "—";

    setTimeout(() => {
        progressOverlay.classList.add("hiding");
        setTimeout(() => {
            progressOverlay.classList.remove("active", "hiding");
            progressBar.style.width = "0%";
        }, 300);
    }, 1500);
}

async function generateInvoice() {
    setStatus("Generating PDF…");
    resultLinks.innerHTML = "";
    generateButton.disabled = true;
    showProgress();

    try {
        const payload = serializeForm();
        const data = await postJson("/api/generate", payload);
        if (data.storage?.enabled && data.storage?.status === "error") {
            throw new Error(data.storage.message || "Document saved locally, but syncing to Billing Hub failed.");
        }

        completeProgress();

        const anchor = document.createElement("a");
        anchor.href = data.pdf_url;
        anchor.target = "_blank";
        anchor.rel = "noreferrer";
        anchor.textContent = "↗ Open PDF";
        resultLinks.appendChild(anchor);
        window.open(data.pdf_url, "_blank", "noopener,noreferrer");

        setStatus("PDF generated");
        await refreshPreview();
        if (currentDocType === "receipt" && workflowContext.return_to_portal && workflowContext.return_order_id) {
            const params = new URLSearchParams({
                section: "orderbook-hub",
                order_id: workflowContext.return_order_id,
                receipt_id: data.storage?.document_id || "",
                advance_receipt_id: data.storage?.advance_receipt_id || workflowContext.advance_receipt_id || "",
                open_order_modal: "1",
                tab: workflowContext.return_tab || "2",
                toast: "Receipt generated and linked",
            });
            window.setTimeout(() => {
                window.location.href = `http://127.0.0.1:5051/?${params.toString()}`;
            }, 400);
        }
    } catch (error) {
        failProgress();
        setStatus("Generation failed", true);
        console.error(error);
    } finally {
        generateButton.disabled = false;
    }
}

/* ── Collapsible Sections ───────────────────── */
function initCollapsibleSections() {
    document.querySelectorAll(".section-title-row[data-toggle]").forEach((titleRow) => {
        titleRow.addEventListener("click", (e) => {
            // Don't toggle when clicking inside an input
            if (e.target.closest("input, textarea, select")) return;

            const section = titleRow.closest(".form-section");
            if (!section) return;

            section.classList.toggle("collapsed");
        });
    });
}

/* ── Document Type Toggle ──────────────────── */
function setDocumentType(docType) {
    if (!documentDrafts[docType]) return;
    if (docType === currentDocType && !isHydratingView) {
        updateDocumentView();
        return;
    }

    persistCurrentDraft();
    currentDocType = docType;
    window.location.hash = docType;
    // Clear any accepted document states since we're switching doc type
    Object.keys(acceptedDocumentNumbers).forEach((k) => delete acceptedDocumentNumbers[k]);
    hideDocumentMatchPanel();
    hydrateDocumentDraft(docType);
    updateDocumentView();
    queuePreview();
}

function updateDocumentView() {
    const isReceipt = currentDocType === "receipt";
    const exchangeMode = isExchangeModeActive();
    form.dataset.documentType = currentDocType;
    form.dataset.exchangeMode = exchangeMode ? "true" : "false";
    viewSwitcher?.setAttribute("data-active", currentDocType);
    viewInvoice?.classList.toggle("active", !isReceipt);
    viewReceipt?.classList.toggle("active", isReceipt);

    document.querySelectorAll(".view-only").forEach((element) => {
        const visible =
            element.classList.contains("view-invoice-only") ? !isReceipt :
            element.classList.contains("view-receipt-only") ? isReceipt :
            true;
        element.hidden = !visible;
    });
    document.querySelectorAll(".exchange-only").forEach((element) => {
        element.hidden = !exchangeMode || element.hidden;
    });
    document.querySelectorAll(".non-exchange-only").forEach((element) => {
        element.hidden = exchangeMode || element.hidden;
    });
    // Sync mode switcher pill states
    const modeSwitcher = document.getElementById("mode-switcher");
    const modeStandard = document.getElementById("mode-standard");
    const modeExchange = document.getElementById("mode-exchange");
    if (modeSwitcher) {
        modeSwitcher.classList.toggle("exchange-active", exchangeMode);
    }
    if (modeStandard && modeExchange) {
        modeStandard.classList.toggle("active", !exchangeMode);
        modeExchange.classList.toggle("active", exchangeMode);
    }

    if (previewTitle) previewTitle.textContent = isReceipt ? "Receipt Preview" : "Invoice Preview";
    invoiceNoLabel.textContent = isReceipt ? "Receipt No" : "Invoice No";
    if (orderNoLabel) orderNoLabel.textContent = isReceipt ? "Order No" : "Linked Order No";
    sectionTitleInvoice.textContent = isReceipt ? "Receipt" : "Invoice";
    if (paymentsSectionTitle) paymentsSectionTitle.textContent = isReceipt ? "Payments" : "Tax & Payments";
    if (amountReceivedLabel) amountReceivedLabel.textContent = isReceipt ? "Amount Paid" : "Amount Received";
}

/* ── Compliance Warning Checker ─────────────── */
const warningPan = document.getElementById("warning-pan");
const warningCash = document.getElementById("warning-cash");
const warningsContainer = document.getElementById("compliance-warnings");

function checkComplianceWarnings() {
    const netAmountField = getPaymentField("net_amount");
    const shouldPreserveNetInput = document.activeElement === netAmountField;
    const summary = syncFinancialSummary({ updateNetAmount: !shouldPreserveNetInput }) || calculateFinancialSummary();
    const netAmount = summary.netAmount;

    // --- Check PAN/Aadhaar warning ---
    const panValue = (form.querySelector('[name="customer_info.pan_aadhaar"]')?.value || "").trim();
    const showPanWarning = netAmount > 200000 && panValue === "";

    // --- Check Cash Amount warning ---
    const cashAmount = parseFloat(form.querySelector('[name="payment_info.cash_amount"]')?.value) || 0;
    const showCashWarning = cashAmount > 199999;

    // --- Toggle visibility ---
    if (warningPan) warningPan.classList.toggle("visible", showPanWarning);
    if (warningCash) warningCash.classList.toggle("visible", showCashWarning);

    // Toggle the container's backdrop (sticky glass effect) when any warning is active
    if (warningsContainer) {
        warningsContainer.classList.toggle("has-warnings", showPanWarning || showCashWarning);
    }
}

/* ── Bootstrap ──────────────────────────────── */
async function bootstrap() {
    const discountField = getPaymentField("discount");
    const netAmountField = getPaymentField("net_amount");
    const customerNameField = form.querySelector('[name="customer_info.name"]');
    const invoiceNoField = form.querySelector('[name="invoice_info.invoice_no"]');
    const orderNoField = form.querySelector('[name="invoice_info.order_no"]');
    const linkedInvoiceField = form.querySelector('[name="invoice_info.linked_invoice_no"]');
    const linkedReceiptField = form.querySelector('[name="invoice_info.linked_receipt_no"]');
    if (discountField) {
        discountField.addEventListener("input", () => {
            syncFinancialSummary();
        });
    }
    if (netAmountField) {
        netAmountField.addEventListener("keydown", handleNetAmountKeydown);
    }

    form.querySelectorAll("input, textarea, select").forEach((field) => {
        field.addEventListener("input", () => {
            if (!isHydratingView) {
                persistCurrentDraft();
            }
            queuePreview();
        });
        field.addEventListener("change", () => {
            if (!isHydratingView) {
                persistCurrentDraft();
            }
            queuePreview();
        });
        field.addEventListener("focus", () => {
            const section = field.closest(".form-section");
            if (!section) return;

            // Auto-expand collapsed section on focus
            if (section.classList.contains("collapsed")) {
                section.classList.remove("collapsed");
            }

            if (section.classList.contains("items-section")) {
                const card = field.closest(".item-card");
                if (card) {
                    syncPreviewToItem(card);
                    return;
                }
            }
            syncPreviewToSection(section);
        });
    });

    previewFrame.addEventListener("load", () => {
        scrollPreviewToTarget(pendingPreviewTarget, false);
    });

    workspacePanel.addEventListener("scroll", updatePreviewTargetFromScroll, { passive: true });
    refreshPreviewButton.addEventListener("click", refreshPreview);
    generateButton.addEventListener("click", generateInvoice);
    addItemButton.addEventListener("click", () => {
        // Auto-expand items section if collapsed
        const itemsSection = addItemButton.closest(".form-section");
        if (itemsSection && itemsSection.classList.contains("collapsed")) {
            itemsSection.classList.remove("collapsed");
        }

        createItemCard();
        renumberItems();
        persistCurrentDraft();
        const cards = itemsContainer.querySelectorAll(".item-card");
        const lastCard = cards[cards.length - 1];
        if (lastCard) {
            syncPreviewToItem(lastCard);
            // Scroll the last card into view smoothly
            lastCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        queuePreview();
    });

    initCollapsibleSections();
    initStateDropdown();
    initConsigneeStateDropdown();
    initPosStateDropdown();
    updateTaxMode();

    // Update IGST display when SGST/CGST values change
    const sgstInput = form.querySelector('[name="charges.sgst_percent"]');
    const cgstInput = form.querySelector('[name="charges.cgst_percent"]');
    const refreshItemTaxOutputs = () => {
        itemsContainer.querySelectorAll(".item-card").forEach((card) => {
            if (currentDocType === "invoice") {
                syncInvoiceCardCalculations(card, "tax_refresh");
            }
        });
        syncFinancialSummary();
    };
    if (sgstInput) sgstInput.addEventListener("input", () => {
        updateTaxMode();
        refreshItemTaxOutputs();
    });
    if (cgstInput) cgstInput.addEventListener("input", () => {
        updateTaxMode();
        refreshItemTaxOutputs();
    });
    const customerContactField = form.querySelector('[name="customer_info.contact"]');
    const customerEmailField = form.querySelector('[name="customer_info.email"]');

    function queueCustomerLookup() {
        window.clearTimeout(customerLookupTimer);
        customerLookupTimer = window.setTimeout(() => {
            fetchCustomerSuggestions();
        }, 240);
    }

    if (customerNameField) {
        customerNameField.addEventListener("input", () => {
            const currentResolution = customerResolutionFields().mode?.value || "new";
            if (currentResolution !== "accepted") {
                setCustomerResolution("new", "");
            }
            queueCustomerLookup();
        });
    }
    if (customerContactField) {
        customerContactField.addEventListener("input", queueCustomerLookup);
    }
    if (customerEmailField) {
        customerEmailField.addEventListener("input", queueCustomerLookup);
    }
    if (invoiceNoField) {
        invoiceNoField.addEventListener("input", () => {
            clearDocumentAccepted("invoice_no");
            clearDocumentAccepted("receipt_no");
            window.clearTimeout(currentDocumentLookupTimer);
            currentDocumentLookupTimer = window.setTimeout(() => {
                fetchCurrentDocumentMatch(invoiceNoField.value || "");
            }, 240);
        });
        invoiceNoField.addEventListener("blur", () => {
            window.clearTimeout(currentDocumentLookupTimer);
            fetchCurrentDocumentMatch(invoiceNoField.value || "");
        });
        invoiceNoField.addEventListener("change", () => {
            window.clearTimeout(currentDocumentLookupTimer);
            fetchCurrentDocumentMatch(invoiceNoField.value || "");
        });
    }
    if (orderNoField) {
        orderNoField.addEventListener("input", () => {
            clearDocumentAccepted("order_no");
            window.clearTimeout(orderLookupTimer);
            orderLookupTimer = window.setTimeout(() => {
                fetchOrderMatch(orderNoField.value || "");
            }, 240);
        });
        orderNoField.addEventListener("blur", () => {
            window.clearTimeout(orderLookupTimer);
            fetchOrderMatch(orderNoField.value || "");
        });
        orderNoField.addEventListener("change", () => {
            window.clearTimeout(orderLookupTimer);
            fetchOrderMatch(orderNoField.value || "");
        });
    }
    if (linkedInvoiceField) {
        linkedInvoiceField.addEventListener("input", () => {
            clearDocumentAccepted("linked_invoice_no");
            window.clearTimeout(linkedInvoiceLookupTimer);
            linkedInvoiceLookupTimer = window.setTimeout(() => {
                fetchInvoiceMatch(linkedInvoiceField.value || "");
            }, 240);
        });
        linkedInvoiceField.addEventListener("blur", () => {
            window.clearTimeout(linkedInvoiceLookupTimer);
            fetchInvoiceMatch(linkedInvoiceField.value || "");
        });
        linkedInvoiceField.addEventListener("change", () => {
            window.clearTimeout(linkedInvoiceLookupTimer);
            fetchInvoiceMatch(linkedInvoiceField.value || "");
        });
    }
    if (linkedReceiptField) {
        linkedReceiptField.addEventListener("input", () => {
            clearDocumentAccepted("linked_receipt_no");
            window.clearTimeout(linkedReceiptLookupTimer);
            linkedReceiptLookupTimer = window.setTimeout(() => {
                fetchReceiptMatch(linkedReceiptField.value || "");
            }, 240);
        });
        linkedReceiptField.addEventListener("blur", () => {
            window.clearTimeout(linkedReceiptLookupTimer);
            fetchReceiptMatch(linkedReceiptField.value || "");
        });
        linkedReceiptField.addEventListener("change", () => {
            window.clearTimeout(linkedReceiptLookupTimer);
            fetchReceiptMatch(linkedReceiptField.value || "");
        });
    }

    // Auto-populate consignee_info when customer_info changes
    const customerPrefix = "customer_info.";
    const syncCustomerToConsignee = (e) => {
        if(!e.target.name) return;
        if(e.target.name.startsWith(customerPrefix)) {
            const fieldName = e.target.name.substring(customerPrefix.length);
            if (currentDocType === "invoice") {
                syncInvoiceDerivedFields(fieldName, e.target.value);
            }
            if (isExchangeModeActive() && isFeatureEnabled("sync_enabled")) {
                syncFieldToOtherDraft(`customer_info.${fieldName}`, e.target.type === "checkbox" ? e.target.checked : e.target.value);
            }
        }
    };

    form.addEventListener("input", syncCustomerToConsignee);
    form.addEventListener("change", syncCustomerToConsignee);

    const syncCustomerToNarration = (e) => {
        if (!e.target.name) return;
        if (e.target.name === "customer_info.name" && currentDocType === "invoice" && isFeatureEnabled("sync_enabled")) {
            updateNarrationFromCustomerName(e.target.value);
        }
    };

    form.addEventListener("input", syncCustomerToNarration);
    form.addEventListener("change", syncCustomerToNarration);

    const syncLinkedDocumentNumbers = (e) => {
        if (!e.target.name) return;
        if (e.target.name === "invoice_info.invoice_no" && isExchangeModeActive()) {
            if (currentDocType === "invoice") {
                syncFieldToOtherDraft("invoice_info.linked_invoice_no", e.target.value);
            } else {
                syncFieldToOtherDraft("invoice_info.linked_receipt_no", e.target.value);
            }
            applyExchangeAdjustments();
        }
    };
    form.addEventListener("input", syncLinkedDocumentNumbers);
    form.addEventListener("change", syncLinkedDocumentNumbers);

    let lastHallmarkCharge = getNumericSetting("hallmark_charge_per_item", 53);
    const settingsChanged = (event) => {
        if (!event?.commitLayout && event?.target?.name && DOCUMENT_LAYOUT_SETTING_KEYS.some((key) => event.target.name === `document_settings.${key}`)) return;
        const settings = { ...(serializeForm(currentDocType).document_settings || {}), ...committedDocumentLayoutSettings };
        if (event?.target?.name === "document_settings.hallmark_charge_per_item") {
            const nextCharge = Math.max(parseFloat(event.target.value) || 0, 0);
            itemsContainer.querySelectorAll(".item-card").forEach((card) => {
                if (["stone", "imitation"].includes(getItemCategory(card))) return;
                const quantity = Math.max(toNumber(getItemField(card, "quantity")?.value) || 1, 1);
                const chargesField = getItemField(card, "other_charges");
                const currentCharges = toNumber(chargesField?.value);
                if (chargesField && (Math.abs(currentCharges - lastHallmarkCharge * quantity) < 0.01 || !chargesField.value.trim())) {
                    chargesField.value = nextCharge * quantity ? (nextCharge * quantity).toFixed(2) : "";
                }
            });
            lastHallmarkCharge = nextCharge;
        }
        cloneCurrentSettingsIntoDrafts();
        if (isExchangeModeActive()) {
            applyExchangeAdjustments();
        }
        persistCurrentDraft();
        updateDocumentView();
        syncFinancialSummary();
        queuePreview();
    };
    form.querySelectorAll('[name^="document_settings."]').forEach((field) => {
        if (DOCUMENT_LAYOUT_SETTING_KEYS.some((key) => field.name === `document_settings.${key}`)) return;
        field.addEventListener("input", settingsChanged);
        field.addEventListener("change", settingsChanged);
    });

    async function saveSettingsSection(section, keys, button) {
        const settings = {};
        keys.forEach((key) => {
            const field = getSettingField(key);
            if (field) settings[key] = field.type === "checkbox" ? field.checked : field.value;
        });
        button.disabled = true;
        button.textContent = "Saving…";
        try {
            const response = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ section, settings }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Could not save settings.");
            initialData.document_settings = { ...(initialData.document_settings || {}), ...result.document_settings };
            if (section === "document_layout") {
                committedDocumentLayoutSettings = Object.fromEntries(DOCUMENT_LAYOUT_SETTING_KEYS.map((key) => [key, result.document_settings[key]]));
                settingsChanged({ target: getSettingField("hallmark_charge_per_item"), commitLayout: true });
            } else {
                settingsChanged();
            }
            button.textContent = "Saved";
            window.setTimeout(() => { button.textContent = "Save"; }, 1600);
        } catch (error) {
            console.error("Could not save settings to Supabase", error);
            button.textContent = "Retry";
        } finally {
            button.disabled = false;
        }
    }

    document.getElementById("save-document-layout")?.addEventListener("click", (event) => {
        saveSettingsSection("document_layout", DOCUMENT_LAYOUT_SETTING_KEYS, event.currentTarget);
    });
    document.getElementById("save-smart-features")?.addEventListener("click", (event) => {
        saveSettingsSection("smart_features", ["recommendations_enabled", "back_calculation_enabled", "sync_enabled"], event.currentTarget);
    });

    const settingsBackdrop = document.getElementById("settings-backdrop");
    const settingsCloseBtn = document.getElementById("settings-close");

    function openSettingsDrawer() {
        if (settingsDrawer) settingsDrawer.hidden = false;
        if (settingsBackdrop) settingsBackdrop.hidden = false;
    }

    function closeSettingsDrawer() {
        if (settingsDrawer) settingsDrawer.hidden = true;
        if (settingsBackdrop) settingsBackdrop.hidden = true;
    }

    settingsToggleButton?.addEventListener("click", openSettingsDrawer);
    settingsCloseBtn?.addEventListener("click", closeSettingsDrawer);
    settingsBackdrop?.addEventListener("click", closeSettingsDrawer);

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && settingsDrawer && !settingsDrawer.hidden) {
            closeSettingsDrawer();
        }
    });
    // Mode switcher pill clicks
    const modeSwitcher = document.getElementById("mode-switcher");
    const modeStandardBtn = document.getElementById("mode-standard");
    const modeExchangeBtn = document.getElementById("mode-exchange");

    function setExchangeMode(enabled) {
        if (exchangeModeToggle) {
            exchangeModeToggle.checked = enabled;
            exchangeModeToggle.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (modeSwitcher && enabled) {
            modeSwitcher.classList.remove("mode-flash");
            void modeSwitcher.offsetWidth; // force reflow
            modeSwitcher.classList.add("mode-flash");
        }
        settingsChanged();
    }

    modeStandardBtn?.addEventListener("click", () => setExchangeMode(false));
    modeExchangeBtn?.addEventListener("click", () => setExchangeMode(true));

    // Run compliance checks reactively on any form input/change
    form.addEventListener("input", checkComplianceWarnings);
    form.addEventListener("change", checkComplianceWarnings);

    initCopyDropdown();
    initAllDatetimePickers();
    viewInvoice.addEventListener("click", () => setDocumentType("invoice"));
    viewReceipt.addEventListener("click", () => setDocumentType("receipt"));

    const requestedMode = (pageParams.get("mode") || "").toLowerCase();
    const initialView = requestedMode === "receipt" || window.location.hash === "#receipt" ? "receipt" : "invoice";
    currentDocType = initialView;
    updateDocumentView();
    hydrateDocumentDraft(initialView);
    if (requestedMode === "receipt") {
        await applyPortalReceiptPrefill();
    }
    hideCustomerMatchPanel();
    hideDocumentMatchPanel();
    syncFinancialSummary();
    updatePreviewTargetFromScroll();
    refreshPreview();
    checkComplianceWarnings();
}

bootstrap();
