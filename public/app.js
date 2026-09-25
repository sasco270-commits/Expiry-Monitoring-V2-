import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";

import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";


/* =========================================================
   FIREBASE CONFIGURATION
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyDXtkoz1xSpsWYuMV-wvm57TF0ajj0p9M9",
  authDomain: "expiry-monitoring-v2.firebaseapp.com",
  projectId: "expiry-monitoring-v2",
  storageBucket: "expiry-monitoring-v2.firebasestorage.app",
  messagingSenderId: "722745088244",
  appId: "1:722745088244:web:17a4f2854a98ee6f6366a1",
  measurementId: "G-YPXSVPRK36",
  databaseURL: "https://expiry-monitoring-v2-default-rtdb.firebaseio.com"
};

const ADMIN_BOOTSTRAP_EMAIL = "sasco270@gmail.com";

const DEFAULT_MIN_QTY = {
  "Confectionery & Sweet Snacks": {
    B: 180,
    C: 80,
    A: 220,
    D: 50,
    Z: 20,
    HR: 60,
    MT: 60,
    X: 40
  },

  "Grocery - Food & Grocery - Non Food": {
    B: 80,
    C: 60,
    A: 100,
    D: 40,
    Z: 5,
    HR: 30,
    MT: 30,
    X: 40
  },

  "Beverages & Dairy & Salty Snacks & Frozen": {
    B: 180,
    C: 150,
    A: 200,
    D: 30,
    Z: 30,
    HR: 40,
    MT: 40,
    X: 60
  }
};


/* =========================================================
   FIREBASE INITIALIZATION
   ========================================================= */

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);


/* =========================================================
   GLOBAL DATA
   ========================================================= */

let stores = {};
let employees = {};
let categories = {};
let storeCategories = {};
let categoryCycle = {};
let minQty = {};
let dataLookup = {};

let currentStore = null;
let currentEmployee = null;
let currentCategory = "";
let currentCycle = null;

let scannedProducts = [];
let submissionStatus = null;
let pasteAllowed = true;
let adminUser = null;
let realtimeStarted = false;


/* =========================================================
   HELPERS
   ========================================================= */

const $ = id => document.getElementById(id);

const key = value =>
  String(value ?? "")
    .trim()
    .replace(/[.#$[\]/]/g, "_")
    .replace(/\s+/g, "_");

function norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeJs(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
}


/* =========================================================
   TOAST
   ========================================================= */

function toast(message, type = "info") {
  let el = $("toast");

  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast-notification";
    document.body.appendChild(el);
  }

  el.className = "toast-notification show " + type;

  el.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button
      class="toast-close"
      onclick="this.parentElement.className='toast-notification'"
    >×</button>
  `;

  clearTimeout(window.__toastTimer);

  window.__toastTimer = setTimeout(() => {
    el.className = "toast-notification";
  }, 5000);
}


/* =========================================================
   SYSTEM STATUS
   ========================================================= */

function setSystemStatus(ok, text) {
  const dot = $("statusDot");
  const st = $("statusText");

  if (dot) {
    dot.className = "status-dot " + (ok ? "online" : "offline");
  }

  if (st) {
    st.textContent = text;
  }

  const top = $("firebaseTopStatus");

  if (top) {
    top.textContent = text;
    top.className = "status-chip " + (ok ? "good" : "bad");
  }
}


/* =========================================================
   PAGE NAVIGATION
   ========================================================= */

window.showOnly = function (id) {

  [
    "landingPage",
    "weeklyExpiryLoginPage",
    "weeklyExpiryPage",
    "adminPage"
  ].forEach(x => {

    const el = $(x);

    if (el) {
      el.style.display = x === id ? "block" : "none";
    }

  });
};


/*
   IMPORTANT:
   These functions are exposed globally because
   index.html uses onclick="..."
*/

window.openWeeklyExpiryMonitoring = function () {
  window.showOnly("weeklyExpiryLoginPage");
};

window.expiryBackToHome = function () {
  window.showOnly("landingPage");
  resetLogin();
};

window.goBackToHome = window.expiryBackToHome;


/* =========================================================
   LOGIN
   ========================================================= */

function resetLogin() {

  if ($("expiryLoginStoreCode")) {
    $("expiryLoginStoreCode").value = "";
  }

  if ($("expiryLoginEmployeeId")) {

    $("expiryLoginEmployeeId").value = "";

    $("expiryLoginEmployeeId").disabled = true;
  }

  if ($("expiryStoreVerifiedPanel")) {
    $("expiryStoreVerifiedPanel").classList.remove("show");
  }

  setLoginError("");
}


function setLoginError(msg) {

  const el = $("expiryLoginError");

  if (!el) return;

  el.textContent = msg || "";

  el.style.display = msg ? "block" : "none";
}


/* =========================================================
   ANONYMOUS AUTH
   ========================================================= */

async function ensureAnonymous() {

  if (
    auth.currentUser &&
    auth.currentUser.isAnonymous
  ) {
    return auth.currentUser;
  }

  if (
    auth.currentUser &&
    !auth.currentUser.isAnonymous
  ) {
    return auth.currentUser;
  }

  return signInAnonymously(auth)
    .then(r => r.user);
}


/* =========================================================
   AUTH STATE
   ========================================================= */

onAuthStateChanged(auth, async user => {

  if (user) {

    if (user.isAnonymous) {

      setSystemStatus(
        true,
        "Firebase Connected"
      );

    } else {

      setSystemStatus(
        true,
        "Firebase Connected"
      );
    }

  } else {

    setSystemStatus(
      false,
      "Authentication Required"
    );
  }

});


/* =========================================================
   REALTIME FIREBASE LISTENERS
   ========================================================= */

function startRealtimeListeners() {

  if (realtimeStarted) return;

  realtimeStarted = true;


  onValue(
    ref(db, "storeMaster"),
    snapshot => {

      stores = snapshot.val() || {};

      renderStoreAdmin();
      refreshStoreLoginData();
    }
  );


  onValue(
    ref(db, "employeeMaster"),
    snapshot => {

      employees = snapshot.val() || {};

      renderEmployeeAdmin();
      refreshStoreLoginData();
    }
  );


  onValue(
    ref(db, "categories"),
    snapshot => {

      categories = snapshot.val() || {};

      renderCategoryAdmin();
      refreshCategoryDropdown();
    }
  );


  onValue(
    ref(db, "storeCategories"),
    snapshot => {

      storeCategories = snapshot.val() || {};

      renderStoreCategoryAdmin();
      refreshCategoryDropdown();
    }
  );


  onValue(
    ref(db, "categoryCycle"),
    snapshot => {

      categoryCycle = snapshot.val() || {};

      renderCycleAdmin();
      refreshCategoryDropdown();
    }
  );


  onValue(
    ref(db, "minQty"),
    snapshot => {

      minQty = snapshot.val() || {};

      renderMinQtyAdmin();
    }
  );


  onValue(
    ref(db, "settings/barcodePasteAllowed"),
    snapshot => {

      pasteAllowed =
        snapshot.val() !== false;

      renderSettingsAdmin();
    }
  );


  onValue(
    ref(db, "dataLookup"),
    snapshot => {

      dataLookup = snapshot.val() || {};
    }
  );
}


/* =========================================================
   STORE LOOKUP
   ========================================================= */

function findStore(storeCode) {

  const code = norm(storeCode);

  if (!code) return null;

  const values = Object.values(stores || {});

  return values.find(store =>
    norm(store.code) === code
  ) || null;
}


/* =========================================================
   EMPLOYEE LOOKUP
   ========================================================= */

function findEmployee(employeeId) {

  const id = norm(employeeId);

  if (!id) return null;

  const values = Object.values(
    employees || {}
  );

  return values.find(emp =>
    norm(emp.employeeId) === id
  ) || null;
}


/* =========================================================
   EMPLOYEE ACTIVE CHECK
   ========================================================= */

function employeeIsActive(employee) {

  if (!employee) return false;

  const status = norm(employee.status);

  return ![
    "inactive",
    "terminated",
    "resigned",
    "blocked",
    "suspended",
    "left"
  ].includes(status);
}


/* =========================================================
   STORE LOGIN
   ========================================================= */

async function verifyStoreLogin() {

  try {

    const storeCode =
      $("expiryLoginStoreCode")?.value?.trim();

    if (!storeCode) {

      setLoginError(
        "Please enter Store Code."
      );

      return;
    }


    const store =
      findStore(storeCode);

    if (!store) {

      setLoginError(
        "Store Code not found."
      );

      return;
    }


    currentStore = store;


    const panel =
      $("expiryStoreVerifiedPanel");

    if (panel) {
      panel.classList.add("show");
    }


    const employeeInput =
      $("expiryLoginEmployeeId");

    if (employeeInput) {

      employeeInput.disabled = false;

      employeeInput.focus();
    }


    const storeName =
      $("expiryVerifiedStoreName");

    if (storeName) {
      storeName.textContent =
        store.name || "";
    }


    const storeCodeDisplay =
      $("expiryVerifiedStoreCode");

    if (storeCodeDisplay) {
      storeCodeDisplay.textContent =
        store.code || "";
    }


    setLoginError("");

  } catch (error) {

    console.error(error);

    setLoginError(
      error.message ||
      "Unable to verify store."
    );
  }
}


/* =========================================================
   FINAL LOGIN
   ========================================================= */

async function loginWeeklyExpiry() {

  try {

    const storeCode =
      $("expiryLoginStoreCode")?.value?.trim();

    const employeeId =
      $("expiryLoginEmployeeId")?.value?.trim();


    if (!storeCode) {

      setLoginError(
        "Please enter Store Code."
      );

      return;
    }


    if (!employeeId) {

      setLoginError(
        "Please enter Employee ID."
      );

      return;
    }


    const store =
      findStore(storeCode);

    if (!store) {

      setLoginError(
        "Store Code not found."
      );

      return;
    }


    const employee =
      findEmployee(employeeId);

    if (!employee) {

      setLoginError(
        "Employee ID not found."
      );

      return;
    }


    if (!employeeIsActive(employee)) {

      setLoginError(
        "This employee is inactive."
      );

      return;
    }


    await ensureAnonymous();


    const uid =
      auth.currentUser.uid;


    await set(
      ref(db, "storeSessions/" + uid),
      {
        storeCode: store.code,
        employeeId: employee.employeeId,
        loginAt: Date.now()
      }
    );


    currentStore = store;
    currentEmployee = employee;


    showWeeklyExpiryForm();

    setLoginError("");


  } catch (error) {

    console.error(error);

    setLoginError(
      error.message ||
      "Login failed."
    );
  }
}


/* =========================================================
   WEEKLY EXPIRY PAGE
   ========================================================= */

function showWeeklyExpiryForm() {

  window.showOnly(
    "weeklyExpiryPage"
  );


  const storeCode =
    $("weeklyStoreCode");

  if (storeCode) {
    storeCode.value =
      currentStore?.code || "";
  }


  const storeName =
    $("weeklyStoreName");

  if (storeName) {
    storeName.textContent =
      currentStore?.name || "";
  }


  const employeeId =
    $("weeklyEmployeeId");

  if (employeeId) {
    employeeId.value =
      currentEmployee?.employeeId || "";
  }


  const employeeName =
    $("weeklyEmployeeName");

  if (employeeName) {
    employeeName.textContent =
      currentEmployee?.employeeName || "";
  }


  refreshCategoryDropdown();

  renderExpiryTable();

  loadDraft();
}


/* =========================================================
   CATEGORY CYCLE
   ========================================================= */

function cycleKey(cycle) {

  if (!cycle) return "";

  return (
    cycle._id ||
    cycle.id ||
    key(
      `${cycle.category}_${cycle.start}_${cycle.end}`
    )
  );
}


function categoryIsInCycle(categoryName, cycle) {

  if (!cycle) return false;

  if (
    norm(cycle.category) !==
    norm(categoryName)
  ) {
    return false;
  }


  const today =
    new Date();


  today.setHours(
    0, 0, 0, 0
  );


  const start =
    parseDate(cycle.start);

  const end =
    parseDate(cycle.end);


  if (!start || !end) {
    return false;
  }


  return (
    today >= start &&
    today <= end
  );
}


function getActiveCycles() {

  return Object.entries(
    categoryCycle || {}
  )
    .map(([id, value]) => ({
      ...(value || {}),
      _id: id
    }))
    .filter(cycle => {

      const start =
        parseDate(cycle.start);

      const end =
        parseDate(cycle.end);

      if (!start || !end) {
        return false;
      }

      const today =
        new Date();

      today.setHours(
        0, 0, 0, 0
      );

      return (
        today >= start &&
        today <= end
      );
    });
}


/* =========================================================
   CATEGORY DROPDOWN
   ========================================================= */

function refreshCategoryDropdown() {

  const select =
    $("categoryDropdown");

  if (!select) return;

  const storeCode =
    currentStore?.code;

  select.innerHTML =
    `<option value="">Select Category</option>`;


  if (!storeCode) return;


  const assigned =
    storeCategories?.[key(storeCode)] ||
    storeCategories?.[storeCode] ||
    {};


  const activeCycles =
    getActiveCycles();


  Object.entries(categories || {})
    .forEach(([id, category]) => {

      if (!category?.active) {
        return;
      }


      const categoryName =
        category.name || id;


      const assignedFlag =
        assigned?.[key(categoryName)] === true;


      if (!assignedFlag) {
        return;
      }


      const cycle =
        activeCycles.find(c =>
          norm(c.category) ===
          norm(categoryName)
        );


      if (!cycle) {
        return;
      }


      const option =
        document.createElement("option");

      option.value =
        categoryName;

      option.textContent =
        categoryName;

      select.appendChild(option);
    });
}


/* =========================================================
   CATEGORY CHANGE
   ========================================================= */

function categoryChanged() {

  const select =
    $("categoryDropdown");

  currentCategory =
    select?.value || "";


  const activeCycles =
    getActiveCycles();


  currentCycle =
    activeCycles.find(c =>
      norm(c.category) ===
      norm(currentCategory)
    ) || null;


  scannedProducts = [];


  renderExpiryTable();

  updateMinimumRequirement();

  loadDraft();
}


/* =========================================================
   PRODUCT LOOKUP
   ========================================================= */

function findProduct(value) {

  const search =
    String(value || "").trim();


  if (!search) return null;


  const barcodeKey =
    key(search);


  const barcodeProduct =
    dataLookup?.byBarcode?.[barcodeKey];


  if (barcodeProduct) {
    return normalizeProduct(
      barcodeProduct
    );
  }


  const skuProduct =
    dataLookup?.bySku?.[barcodeKey];


  if (skuProduct) {
    return normalizeProduct(
      skuProduct
    );
  }


  return null;
}


/* =========================================================
   NORMALIZE PRODUCT
   ========================================================= */

function normalizeProduct(product) {

  if (!product) return null;


  return {
    ...product,

    _id:
      product._id ||
      product.id ||
      "",

    _sourcePath:
      product._sourcePath ||
      "",

    _isArray:
      !!product._isArray,

    SKU:
      product.SKU ??
      product.sku ??
      "",

    Barcodes:
      product.Barcodes ??
      product.barcode ??
      product.Barcode ??
      "",

    UOM:
      product.UOM ?? "",

    "EN Desc":
      product["EN Desc"] ??
      product.description ??
      product.itemName ??
      "",

    Cost:
      Number(product.Cost ?? 0),

    "Default Supplier":
      product["Default Supplier"] ??
      "",

    "Vendor Code":
      product["Vendor Code"] ??
      "",

    Category:
      product.Category ??
      product.category ??
      "",

    "Non - Returnable & Returnable":
      product["Non - Returnable & Returnable"] ??
      "",

    Qty:
      Number(product.Qty ?? 0),

    "Total Cost":
      Number(product["Total Cost"] ?? 0),

    "Expiry Date":
      product["Expiry Date"] ??
      "",

    "Days Left":
      product["Days Left"] ??
      ""
  };
}


/* =========================================================
   BARCODE SCAN
   ========================================================= */

async function lookupBarcode() {

  const input =
    $("barcodeInput");

  if (!input) return;


  const value =
    input.value.trim();


  if (!value) return;


  const product =
    findProduct(value);


  if (!product) {

    toast(
      "Item not found in Data Master. Please contact Admin.",
      "error"
    );

    return;
  }


  if (
    currentCategory &&
    norm(product.Category) !==
    norm(currentCategory)
  ) {

    toast(
      "This item does not belong to the selected category.",
      "error"
    );

    return;
  }


  addProduct(product);


  input.value = "";

  input.focus();
}


/* =========================================================
   ADD PRODUCT
   ========================================================= */

function addProduct(product) {

  const barcode =
    product.Barcodes ||
    product.SKU;


  const existing =
    scannedProducts.find(
      item =>
        norm(item.barcode) ===
        norm(barcode)
    );


  if (existing) {

    toast(
      "This item is already added.",
      "warning"
    );

    return;
  }


  scannedProducts.push({

    id:
      crypto.randomUUID(),

    sku:
      product.SKU || "",

    barcode:
      barcode || "",

    product:
      product["EN Desc"] || "",

    category:
      product.Category || "",

    categoryKey:
      key(currentCategory),

    Qty:
      0,

    ExpiryDate:
      "",

    UOM:
      product.UOM || "",

    Cost:
      product.Cost || 0
  });


  renderExpiryTable();

  updateMinimumRequirement();
}


/* =========================================================
   DATE PARSER
   ========================================================= */

function parseDate(value) {

  if (!value) return null;


  if (
    value instanceof Date
  ) {
    return new Date(value);
  }


  const text =
    String(value).trim();


  let match =
    text.match(
      /^(\d{2})\/(\d{2})\/(\d{4})$/
    );


  if (match) {

    const day =
      Number(match[1]);

    const month =
      Number(match[2]) - 1;

    const year =
      Number(match[3]);

    const date =
      new Date(
        year,
        month,
        day
      );

    if (
      date.getFullYear() === year &&
      date.getMonth() === month &&
      date.getDate() === day
    ) {
      return date;
    }

    return null;
  }


  const date =
    new Date(text);


  if (Number.isNaN(date.getTime())) {
    return null;
  }


  return date;
}


/* =========================================================
   EXPIRY VALIDATION
   ========================================================= */

function validateExpiryDate(value) {

  const date =
    parseDate(value);


  if (!date) {

    return {
      ok: false,
      message:
        "Expiry Date must be DD/MM/YYYY."
    };
  }


  date.setHours(
    0, 0, 0, 0
  );


  const today =
    new Date();

  today.setHours(
    0, 0, 0, 0
  );


  const minimum =
    new Date(today);

  minimum.setDate(
    minimum.getDate() - 21
  );


  const maximum =
    new Date(
      2035,
      11,
      31
    );


  if (date < minimum) {

    return {
      ok: false,
      message:
        "Expiry Date cannot be older than 21 days."
    };
  }


  if (date > maximum) {

    return {
      ok: false,
      message:
        "Expiry Date cannot be after 31/12/2035."
    };
  }


  return {
    ok: true,
    date
  };
}


/* =========================================================
   RENDER EXPIRY TABLE
   ========================================================= */

function renderExpiryTable() {

  const tbody =
    $("dataTableBody") ||
    $("dataTable")?.querySelector("tbody");

  if (!tbody) return;


  tbody.innerHTML = "";


  scannedProducts.forEach(
    (item, index) => {

      const tr =
        document.createElement("tr");


      tr.innerHTML = `

        <td>${index + 1}</td>

        <td>
          ${escapeHtml(item.sku)}
        </td>

        <td>
          ${escapeHtml(item.barcode)}
        </td>

        <td>
          ${escapeHtml(item.product)}
        </td>

        <td>
          <input
            type="number"
            min="1"
            value="${item.Qty || ""}"
            class="qty-input"
            data-index="${index}"
          >
        </td>

        <td>
          <input
            type="text"
            placeholder="DD/MM/YYYY"
            value="${escapeHtml(item.ExpiryDate)}"
            class="expiry-input"
            data-index="${index}"
          >
        </td>

        <td>
          <button
            type="button"
            class="danger-btn"
            onclick="removeExpiryItem(${index})"
          >
            Remove
          </button>
        </td>
      `;


      tbody.appendChild(tr);
    }
  );


  tbody
    .querySelectorAll(".qty-input")
    .forEach(input => {

      input.addEventListener(
        "input",
        event => {

          const index =
            Number(
              event.target.dataset.index
            );

          scannedProducts[index].Qty =
            Number(
              event.target.value || 0
            );

          updateMinimumRequirement();
        }
      );
    });


  tbody
    .querySelectorAll(".expiry-input")
    .forEach(input => {

      input.addEventListener(
        "change",
        event => {

          const index =
            Number(
              event.target.dataset.index
            );

          scannedProducts[index].ExpiryDate =
            event.target.value.trim();
        }
      );
    });
}


/* =========================================================
   REMOVE ITEM
   ========================================================= */

window.removeExpiryItem = function(index) {

  scannedProducts.splice(
    index,
    1
  );

  renderExpiryTable();

  updateMinimumRequirement();
};


/* =========================================================
   MINIMUM SKU REQUIREMENT
   ========================================================= */

function getStoreClassification() {

  return (
    currentStore?.classification ||
    currentStore?.storeType ||
    "B"
  );
}


function getMinimumQty() {

  const category =
    currentCategory;


  const classification =
    getStoreClassification();


  const custom =
    minQty?.[key(category)];


  if (
    custom &&
    custom[classification] != null
  ) {
    return Number(
      custom[classification]
    );
  }


  return Number(
    DEFAULT_MIN_QTY?.[category]?.[
      classification
    ] || 0
  );
}


function getValidUniqueSkuCount() {

  const unique =
    new Set();


  scannedProducts.forEach(item => {

    if (
      Number(item.Qty) > 0 &&
      item.ExpiryDate
    ) {

      unique.add(
        norm(
          item.sku ||
          item.barcode
        )
      );
    }

  });


  return unique.size;
}


function updateMinimumRequirement() {

  const required =
    getMinimumQty();

  const count =
    getValidUniqueSkuCount();


  const el =
    $("minimumRequirement");


  if (el) {

    el.textContent =
      `Minimum required: ${required} SKU(s) | Current: ${count}`;
  }


  const submit =
    $("weeklySubmitBtn");


  if (submit) {

    submit.disabled =
      !currentCategory ||
      count < required;
  }
}


/* =========================================================
   SAVE DRAFT
   ========================================================= */

async function saveDraft() {

  try {

    if (!currentStore) {

      toast(
        "Please login first.",
        "error"
      );

      return;
    }


    if (!currentCategory) {

      toast(
        "Please select a category.",
        "error"
      );

      return;
    }


    const cycle =
      currentCycle;


    if (!cycle) {

      toast(
        "No active category cycle found.",
        "error"
      );

      return;
    }


    const draft = {

      storeCode:
        currentStore.code,

      storeName:
        currentStore.name || "",

      employeeId:
        currentEmployee?.employeeId || "",

      employeeName:
        currentEmployee?.employeeName || "",

      category:
        currentCategory,

      cycleId:
        cycleKey(cycle),

      items:
        scannedProducts,

      status:
        "DRAFT",

      updatedAt:
        Date.now()
    };


    await set(
      ref(
        db,
        `expiryDrafts/${key(currentStore.code)}/${key(cycleKey(cycle))}/${key(currentCategory)}`
      ),
      draft
    );


    toast(
      "Draft saved successfully.",
      "success"
    );


    loadDraft();

  } catch (error) {

    console.error(error);

    toast(
      error.message ||
      "Unable to save draft.",
      "error"
    );
  }
}


/* =========================================================
   LOAD DRAFT
   ========================================================= */

async function loadDraft() {

  if (
    !currentStore ||
    !currentCategory ||
    !currentCycle
  ) {
    return;
  }


  try {

    const snapshot =
      await get(
        ref(
          db,
          `expiryDrafts/${key(currentStore.code)}/${key(cycleKey(currentCycle))}/${key(currentCategory)}`
        )
      );


    if (!snapshot.exists()) {
      return;
    }


    const draft =
      snapshot.val();


    scannedProducts =
      Array.isArray(draft.items)
        ? draft.items
        : Object.values(
            draft.items || {}
          );


    renderExpiryTable();

    updateMinimumRequirement();


    toast(
      "Saved draft loaded.",
      "success"
    );

  } catch (error) {

    console.error(error);
  }
}


/* =========================================================
   FINAL SUBMISSION
   ========================================================= */

async function submitWeeklyExpiry() {

  try {

    if (!currentStore) {

      toast(
        "Please login first.",
        "error"
      );

      return;
    }


    if (!currentCategory) {

      toast(
        "Please select a category.",
        "error"
      );

      return;
    }


    if (!currentCycle) {

      toast(
        "No active category cycle.",
        "error"
      );

      return;
    }


    const validItems =
      scannedProducts.filter(item =>
        Number(item.Qty) > 0 &&
        item.ExpiryDate
      );


    const required =
      getMinimumQty();


    const unique =
      new Set(
        validItems.map(
          item =>
            norm(
              item.sku ||
              item.barcode
            )
        )
      );


    if (
      unique.size <
      required
    ) {

      toast(
        `Minimum ${required} unique SKU(s) required.`,
        "error"
      );

      return;
    }


    for (
      const item of validItems
    ) {

      const validation =
        validateExpiryDate(
          item.ExpiryDate
        );


      if (!validation.ok) {

        toast(
          `${item.sku}: ${validation.message}`,
          "error"
        );

        return;
      }
    }


    const submissionPath =
      `storeSubmissions/${key(currentStore.code)}/${key(currentCategory)}/${key(cycleKey(currentCycle))}`;


    const payload = {

      storeCode:
        currentStore.code,

      storeName:
        currentStore.name || "",

      employeeId:
        currentEmployee?.employeeId || "",

      employeeName:
        currentEmployee?.employeeName || "",

      category:
        currentCategory,

      cycleId:
        cycleKey(currentCycle),

      items:
        validItems.map(item => ({
          sku:
            item.sku || "",

          barcode:
            item.barcode || "",

          product:
            item.product || "",

          categoryKey:
            key(currentCategory),

          Qty:
            Number(item.Qty),

          ExpiryDate:
            item.ExpiryDate,

          UOM:
            item.UOM || "",

          Cost:
            Number(item.Cost || 0)
        })),

      status:
        "SUBMITTED",

      itemCount:
        unique.size,

      submittedAt:
        Date.now()
    };


    const result =
      await runTransaction(
        ref(
          db,
          submissionPath
        ),
        current => {

          if (
            current !== null
          ) {

            return;
          }

          return payload;
        }
      );


    if (!result.committed) {

      toast(
        "This category has already been submitted.",
        "warning"
      );

      return;
    }


    await remove(
      ref(
        db,
        `expiryDrafts/${key(currentStore.code)}/${key(cycleKey(currentCycle))}/${key(currentCategory)}`
      )
    );


    submissionStatus =
      payload;


    toast(
      "Submission completed successfully.",
      "success"
    );


    downloadSubmissionCSV(
      payload
    );


    scannedProducts = [];

    renderExpiryTable();

    updateMinimumRequirement();

  } catch (error) {

    console.error(error);

    toast(
      error.message ||
      "Submission failed.",
      "error"
    );
  }
}


/* =========================================================
   CSV DOWNLOAD
   ========================================================= */

function downloadSubmissionCSV(
  submission
) {

  const rows = [

    [
      "Store Code",
      "Store Name",
      "Employee ID",
      "Employee Name",
      "Category",
      "SKU",
      "Barcode",
      "Product",
      "Qty",
      "Expiry Date",
      "UOM",
      "Cost"
    ]

  ];


  submission.items.forEach(
    item => {

      rows.push([

        submission.storeCode,

        submission.storeName,

        submission.employeeId,

        submission.employeeName,

        submission.category,

        item.sku,

        item.barcode,

        item.product,

        item.Qty,

        item.ExpiryDate,

        item.UOM,

        item.Cost

      ]);

    }
  );


  const csv =
    rows
      .map(row =>
        row
          .map(value =>
            `"${String(value ?? "")
              .replaceAll('"', '""')}"`
          )
          .join(",")
      )
      .join("\n");


  const blob =
    new Blob(
      [csv],
      {
        type:
          "text/csv;charset=utf-8;"
      }
    );


  const url =
    URL.createObjectURL(blob);


  const a =
    document.createElement("a");


  a.href = url;

  a.download =
    `Expiry_${submission.storeCode}_${submission.category}_${Date.now()}.csv`;

  a.click();


  URL.revokeObjectURL(url);
}


/* =========================================================
   EVENT BINDINGS
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    startRealtimeListeners();


    const verifyBtn =
      $("verifyStoreBtn");

    if (verifyBtn) {

      verifyBtn.addEventListener(
        "click",
        verifyStoreLogin
      );
    }


    const loginBtn =
      $("weeklyLoginBtn");

    if (loginBtn) {

      loginBtn.addEventListener(
        "click",
        loginWeeklyExpiry
      );
    }


    const category =
      $("categoryDropdown");

    if (category) {

      category.addEventListener(
        "change",
        categoryChanged
      );
    }


    const barcode =
      $("barcodeInput");

    if (barcode) {

      barcode.addEventListener(
        "keydown",
        event => {

          if (
            event.key === "Enter"
          ) {

            event.preventDefault();

            lookupBarcode();
          }

        }
      );
    }


    const save =
      $("saveBtn");

    if (save) {

      save.addEventListener(
        "click",
        saveDraft
      );
    }


    const submit =
      $("weeklySubmitBtn");

    if (submit) {

      submit.addEventListener(
        "click",
        submitWeeklyExpiry
      );
    }


    /*
       THIS IS IMPORTANT FOR GITHUB PAGES.
       The page must show Home immediately.
    */

    window.showOnly(
      "landingPage"
    );

  }
);


/* =========================================================
   ADMIN
   ========================================================= */

window.openAdmin = function () {

  window.showOnly(
    "adminPage"
  );

  renderAdminPage();
};


window.closeAdmin = function () {

  window.showOnly(
    "landingPage"
  );
};


async function adminLogin() {

  const email =
    $("adminEmail")?.value?.trim();

  const password =
    $("adminPassword")?.value || "";


  if (!email || !password) {

    toast(
      "Enter admin email and password.",
      "error"
    );

    return;
  }


  try {

    const credential =
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );


    adminUser =
      credential.user;


    /*
       Bootstrap administrator.
    */

    if (
      norm(email) ===
      norm(ADMIN_BOOTSTRAP_EMAIL)
    ) {

      await set(
        ref(
          db,
          `admins/${credential.user.uid}`
        ),
        true
      );
    }


    toast(
      "Admin login successful.",
      "success"
    );


    renderAdminPage();

  } catch (error) {

    console.error(error);

    toast(
      error.message ||
      "Admin login failed.",
      "error"
    );
  }
}


window.adminLogin =
  adminLogin;


/* =========================================================
   ADMIN LOGOUT
   ========================================================= */

window.adminLogout =
  async function () {

    try {

      await signOut(auth);

      adminUser = null;

      window.showOnly(
        "landingPage"
      );

    } catch (error) {

      console.error(error);
    }
  };


/* =========================================================
   ADMIN CHECK
   ========================================================= */

async function isAdmin() {

  const user =
    auth.currentUser;


  if (!user) return false;


  if (
    user.email ===
    ADMIN_BOOTSTRAP_EMAIL
  ) {
    return true;
  }


  const snapshot =
    await get(
      ref(
        db,
        `admins/${user.uid}`
      )
    );


  return (
    snapshot.exists() &&
    snapshot.val() === true
  );
}


/* =========================================================
   ADMIN PAGE
   ========================================================= */

async function renderAdminPage() {

  const logged =
    await isAdmin();


  const login =
    $("adminLoginPanel");

  const content =
    $("adminContent");


  if (login) {

    login.style.display =
      logged ? "none" : "block";
  }


  if (content) {

    content.style.display =
      logged ? "block" : "none";
  }


  if (!logged) {
    return;
  }


  renderStoreAdmin();
  renderEmployeeAdmin();
  renderCategoryAdmin();
  renderStoreCategoryAdmin();
  renderCycleAdmin();
  renderMinQtyAdmin();
  renderDataMasterAdmin();
  renderSettingsAdmin();
}


/* =========================================================
   STORE ADMIN
   ========================================================= */

window.addStore =
  async function () {

    if (!(await isAdmin())) {
      return;
    }


    const code =
      $("adminStoreCode")?.value?.trim();

    const name =
      $("adminStoreName")?.value?.trim();


    if (!code || !name) {

      toast(
        "Store Code and Store Name are required.",
        "error"
      );

      return;
    }


    const id =
      key(code);


    await set(
      ref(
        db,
        `storeMaster/${id}`
      ),
      {

        code,

        name,

        classification:
          $("adminStoreClassification")?.value?.trim() || "",

        areaManager:
          $("adminStoreAreaManager")?.value?.trim() || "",

        region:
          $("adminStoreRegion")?.value?.trim() || "",

        location:
          $("adminStoreLocation")?.value?.trim() || "",

        storeType:
          $("adminStoreType")?.value?.trim() || "",

        email:
          $("adminStoreEmail")?.value?.trim() || "",

        operationManager:
          $("adminStoreOperationManager")?.value?.trim() || "",

        promotionStore:
          $("adminStorePromotion")?.value?.trim() || "",

        updatedAt:
          Date.now()
      }
    );


    toast(
      "Store saved.",
      "success"
    );
  };


window.deleteStore =
  async function (id) {

    if (!(await isAdmin())) {
      return;
    }


    if (
      !confirm(
        "Delete this store?"
      )
    ) {
      return;
    }


    await remove(
      ref(
        db,
        `storeMaster/${id}`
      )
    );


    toast(
      "Store deleted.",
      "success"
    );
  };


/* =========================================================
   EMPLOYEE ADMIN
   ========================================================= */

window.addEmployee =
  async function () {

    if (!(await isAdmin())) {
      return;
    }


    const employeeId =
      $("adminEmployeeId")?.value?.trim();

    const employeeName =
      $("adminEmployeeName")?.value?.trim();

    const status =
      $("adminEmployeeStatus")?.value ||
      "Active";


    if (
      !employeeId ||
      !employeeName
    ) {

      toast(
        "Employee ID and name are required.",
        "error"
      );

      return;
    }


    await set(
      ref(
        db,
        `employeeMaster/${key(employeeId)}`
      ),
      {

        employeeId,

        employeeName,

        status,

        updatedAt:
          Date.now()
      }
    );


    toast(
      "Employee saved.",
      "success"
    );
  };


window.deleteEmployee =
  async function (id) {

    if (!(await isAdmin())) {
      return;
    }


    if (
      !confirm(
        "Delete employee?"
      )
    ) {
      return;
    }


    await remove(
      ref(
        db,
        `employeeMaster/${id}`
      )
    );


    toast(
      "Employee deleted.",
      "success"
    );
  };


/* =========================================================
   CATEGORY ADMIN
   ========================================================= */

window.addCategory =
  async function () {

    if (!(await isAdmin())) {
      return;
    }


    const name =
      $("adminCategoryName")?.value?.trim();


    if (!name) {

      toast(
        "Category name is required.",
        "error"
      );

      return;
    }


    await set(
      ref(
        db,
        `categories/${key(name)}`
      ),
      {

        name,

        active: true,

        createdAt:
          Date.now()
      }
    );


    toast(
      "Category added.",
      "success"
    );
  };


window.deleteCategory =
  async function (id) {

    if (!(await isAdmin())) {
      return;
    }


    if (
      !confirm(
        "Delete category?"
      )
    ) {
      return;
    }


    await remove(
      ref(
        db,
        `categories/${id}`
      )
    );


    toast(
      "Category deleted.",
      "success"
    );
  };


/* =========================================================
   CATEGORY RENAME
   ========================================================= */

window.renameAdminCategory =
  async function (
    oldId,
    oldName
  ) {

    if (!(await isAdmin())) {
      return;
    }


    const newName =
      prompt(
        "Enter new category name:",
        oldName
      );


    if (!newName) {
      return;
    }


    const newId =
      key(newName);


    if (
      newId === oldId
    ) {
      return;
    }


    await set(
      ref(
        db,
        `categories/${newId}`
      ),
      {

        name: newName,

        active:
          categories?.[oldId]?.active !== false,

        updatedAt:
          Date.now()
      }
    );


    await remove(
      ref(
        db,
        `categories/${oldId}`
      )
    );


    /*
       Migrate store category assignments.
    */

    const updates = {};


    Object.entries(
      storeCategories || {}
    ).forEach(
      ([storeCode, assignments]) => {

        if (
          assignments?.[oldId] === true
        ) {

          updates[
            `storeCategories/${storeCode}/${newId}`
          ] = true;

          updates[
            `storeCategories/${storeCode}/${oldId}`
          ] = null;
        }
      }
    );


    /*
       Migrate cycle category names.
    */

    Object.entries(
      categoryCycle || {}
    ).forEach(
      ([cycleId, cycle]) => {

        if (
          norm(cycle?.category) ===
          norm(oldName)
        ) {

          updates[
            `categoryCycle/${cycleId}/category`
          ] = newName;
        }
      }
    );


    if (
      Object.keys(updates).length
    ) {

      await update(
        ref(db),
        updates
      );
    }


    toast(
      "Category renamed.",
      "success"
    );
  };


/* =========================================================
   STORE CATEGORY ASSIGNMENT
   ========================================================= */

window.assignCategoryToStore =
  async function (
    storeCode,
    categoryName,
    checked
  ) {

    if (!(await isAdmin())) {
      return;
    }


    await set(
      ref(
        db,
        `storeCategories/${key(storeCode)}/${key(categoryName)}`
      ),
      !!checked
    );


    toast(
      checked
        ? "Category assigned."
        : "Category removed.",
      "success"
    );
  };


/* =========================================================
   CATEGORY CYCLE ADMIN
   ========================================================= */

window.addCategoryCycle =
  async function () {

    if (!(await isAdmin())) {
      return;
    }


    const category =
      $("adminCycleCategory")?.value?.trim();

    const start =
      $("adminCycleStart")?.value;

    const end =
      $("adminCycleEnd")?.value;


    if (
      !category ||
      !start ||
      !end
    ) {

      toast(
        "Category, start and end date are required.",
        "error"
      );

      return;
    }


    const cycleId =
      push(
        ref(
          db,
          "categoryCycle"
        )
      ).key;


    await set(
      ref(
        db,
        `categoryCycle/${cycleId}`
      ),
      {

        category,

        start,

        end,

        createdAt:
          Date.now()
      }
    );


    toast(
      "Category cycle saved.",
      "success"
    );
  };


window.deleteCategoryCycle =
  async function (id) {

    if (!(await isAdmin())) {
      return;
    }


    await remove(
      ref(
        db,
        `categoryCycle/${id}`
      )
    );


    toast(
      "Cycle deleted.",
      "success"
    );
  };


/* =========================================================
   MIN QTY ADMIN
   ========================================================= */

window.saveMinQty =
  async function () {

    if (!(await isAdmin())) {
      return;
    }


    const category =
      $("adminMinCategory")?.value?.trim();


    if (!category) {

      toast(
        "Select a category.",
        "error"
      );

      return;
    }


    const classifications =
      [
        "B",
        "C",
        "A",
        "D",
        "Z",
        "HR",
        "MT",
        "X"
      ];


    const values = {};


    classifications.forEach(
      classification => {

        const input =
          document.querySelector(
            `[data-minqty="${classification}"]`
          );


        values[classification] =
          Number(
            input?.value || 0
          );
      }
    );


    await set(
      ref(
        db,
        `minQty/${key(category)}`
      ),
      values
    );


    toast(
      "Minimum quantities saved.",
      "success"
    );
  };


/* =========================================================
   BARCODE PASTE SETTING
   ========================================================= */

window.saveBarcodeSetting =
  async function () {

    if (!(await isAdmin())) {
      return;
    }


    const checkbox =
      $("adminBarcodePasteAllowed");


    await set(
      ref(
        db,
        "settings/barcodePasteAllowed"
      ),
      !!checkbox?.checked
    );


    toast(
      "Barcode setting saved.",
      "success"
    );
  };


/* =========================================================
   DATA MASTER
   ========================================================= */

async function readDataMaster() {

  const snapshot =
    await get(
      ref(db, "Data")
    );


  if (!snapshot.exists()) {
    return {};
  }


  return snapshot.val();
}


function dataMasterRows(data) {

  if (!data) return [];


  const headers =
    Array.isArray(data.headers)
      ? data.headers
      : [];


  const rows = [];


  Object.entries(data)
    .forEach(
      ([id, value]) => {

        if (
          id === "headers" ||
          id === "items"
        ) {
          return;
        }


        if (Array.isArray(value)) {

          const item = {};

          headers.forEach(
            (header, index) => {

              item[header] =
                value[index] ?? "";
            }
          );


          item._id =
            id;

          item._sourcePath =
            `Data/${id}`;

          item._isArray =
            true;


          rows.push(item);
        }
      }
    );


  if (data.items) {

    Object.entries(
      data.items
    ).forEach(
      ([id, item]) => {

        rows.push({

          ...(item || {}),

          _id:
            id,

          _sourcePath:
            `Data/items/${id}`,

          _isArray:
            false

        });

      }
    );
  }


  return rows;
}


/* =========================================================
   BUILD LOOKUP INDEX
   ========================================================= */

window.buildDataIndex =
  async function () {

    if (!(await isAdmin())) {
      return;
    }


    try {

      const data =
        await readDataMaster();


      const rows =
        dataMasterRows(data);


      if (!rows.length) {

        toast(
          "No Data Master records found.",
          "warning"
        );

        return;
      }


      const updates = {};


      rows.forEach(
        product => {

          const barcodeValues =
            String(
              product.Barcodes || ""
            )
              .split(/[;,|]/)
              .map(v => v.trim())
              .filter(Boolean);


          barcodeValues.forEach(
            barcode => {

              updates[
                `dataLookup/byBarcode/${key(barcode)}`
              ] = product;
            }
          );


          if (product.SKU) {

            updates[
              `dataLookup/bySku/${key(product.SKU)}`
            ] = product;
          }

        }
      );


      const paths =
        Object.keys(updates);


      const chunkSize =
        1000;


      for (
        let i = 0;
        i < paths.length;
        i += chunkSize
      ) {

        const chunk =
          {};


        paths
          .slice(
            i,
            i + chunkSize
          )
          .forEach(
            path => {

              chunk[path] =
                updates[path];
            }
          );


        await update(
          ref(db),
          chunk
        );
      }


      toast(
        `Index created for ${rows.length} products.`,
        "success"
      );

    } catch (error) {

      console.error(error);

      toast(
        error.message ||
        "Unable to build Data Index.",
        "error"
      );
    }
  };


/* =========================================================
   ADMIN RENDER FUNCTIONS
   ========================================================= */

function renderStoreAdmin() {

  const container =
    $("adminStoresList");

  if (!container) return;


  container.innerHTML =
    Object.entries(
      stores || {}
    )
      .map(
        ([id, store]) => `

          <div class="admin-row">

            <div>
              <strong>
                ${escapeHtml(store.code)}
              </strong>

              -
              ${escapeHtml(store.name)}
            </div>

            <button
              onclick="deleteStore('${safeJs(id)}')"
              class="danger-btn"
            >
              Delete
            </button>

          </div>
        `
      )
      .join("");
}


function renderEmployeeAdmin() {

  const container =
    $("adminEmployeesList");

  if (!container) return;


  container.innerHTML =
    Object.entries(
      employees || {}
    )
      .map(
        ([id, employee]) => `

          <div class="admin-row">

            <div>

              <strong>
                ${escapeHtml(employee.employeeId)}
              </strong>

              -
              ${escapeHtml(employee.employeeName)}

              <small>
                ${escapeHtml(employee.status)}
              </small>

            </div>

            <button
              onclick="deleteEmployee('${safeJs(id)}')"
              class="danger-btn"
            >
              Delete
            </button>

          </div>
        `
      )
      .join("");
}


function renderCategoryAdmin() {

  const container =
    $("adminCategoriesList");

  if (!container) return;


  container.innerHTML =
    Object.entries(
      categories || {}
    )
      .map(
        ([id, category]) => `

          <div class="admin-row">

            <div>

              <strong>
                ${escapeHtml(category.name)}
              </strong>

              <span>
                ${category.active ? "Active" : "Inactive"}
              </span>

            </div>

            <div>

              <button
                onclick="renameAdminCategory(
                  '${safeJs(id)}',
                  '${safeJs(category.name)}'
                )"
              >
                Rename
              </button>

              <button
                onclick="deleteCategory('${safeJs(id)}')"
                class="danger-btn"
              >
                Delete
              </button>

            </div>

          </div>
        `
      )
      .join("");
}


function renderStoreCategoryAdmin() {

  const container =
    $("adminStoreCategoriesList");

  if (!container) return;


  let html = "";


  Object.entries(
    stores || {}
  ).forEach(
    ([storeId, store]) => {

      html += `

        <div class="admin-store-category">

          <h4>
            ${escapeHtml(store.code)}
            -
            ${escapeHtml(store.name)}
          </h4>
      `;


      Object.entries(
        categories || {}
      ).forEach(
        ([categoryId, category]) => {

          const checked =
            storeCategories?.[
              storeId
            ]?.[
              categoryId
            ] === true;


          html += `

            <label class="checkbox-row">

              <input
                type="checkbox"
                ${
                  checked
                    ? "checked"
                    : ""
                }

                onchange="
                  assignCategoryToStore(
                    '${safeJs(store.code)}',
                    '${safeJs(category.name)}',
                    this.checked
                  )
                "
              >

              ${escapeHtml(category.name)}

            </label>
          `;
        }
      );


      html += `
        </div>
      `;
    }
  );


  container.innerHTML =
    html;
}


function renderCycleAdmin() {

  const container =
    $("adminCyclesList");

  if (!container) return;


  container.innerHTML =
    Object.entries(
      categoryCycle || {}
    )
      .map(
        ([id, cycle]) => `

          <div class="admin-row">

            <div>

              <strong>
                ${escapeHtml(cycle.category)}
              </strong>

              <span>
                ${escapeHtml(cycle.start)}
                →
                ${escapeHtml(cycle.end)}
              </span>

            </div>

            <button
              class="danger-btn"
              onclick="
                deleteCategoryCycle(
                  '${safeJs(id)}'
                )
              "
            >
              Delete
            </button>

          </div>
        `
      )
      .join("");
}


function renderMinQtyAdmin() {

  const select =
    $("adminMinCategory");

  if (!select) return;


  select.innerHTML =
    `<option value="">Select Category</option>`;


  Object.values(
    categories || {}
  ).forEach(
    category => {

      const option =
        document.createElement(
          "option"
        );

      option.value =
        category.name;

      option.textContent =
        category.name;

      select.appendChild(
        option
      );
    }
  );
}


function renderDataMasterAdmin() {

  const container =
    $("adminDataMasterList");

  if (!container) return;


  container.innerHTML = `
    <div class="admin-info">

      Firebase Data Master is protected.

      Store users cannot edit
      Data Master records.

      Use
      <strong>
        Build Barcode/SKU Index
      </strong>
      after importing or changing
      the Data Master.

    </div>
  `;
}


function renderSettingsAdmin() {

  const checkbox =
    $("adminBarcodePasteAllowed");

  if (checkbox) {
    checkbox.checked =
      pasteAllowed;
  }
}


function refreshStoreLoginData() {

  /*
     Store data is realtime.
     Nothing else is required here.
  */
}


/* =========================================================
   INITIALIZE
   ========================================================= */

window.addEventListener(
  "load",
  () => {

    /*
       Make sure the home page is visible
       even if Firebase takes time to load.
    */

    window.showOnly(
      "landingPage"
    );

  }
);
