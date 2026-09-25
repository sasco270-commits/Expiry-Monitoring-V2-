import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  get,
  set,
  push,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";


/* =========================================================
   FIREBASE CONFIGURATION
========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyDXTkoz1xSpsWYuMV-uFvm57TF0ajj0p9M9",
  authDomain: "expiry-monitoring-v2.firebaseapp.com",
  projectId: "expiry-monitoring-v2",
  storageBucket: "expiry-monitoring-v2.firebasestorage.app",
  messagingSenderId: "722745088244",
  appId: "1:722745088244:web:17a4f2854a98ee6f6366a1",
  measurementId: "G-YPXSVPRK36",
  databaseURL: "https://expiry-monitoring-v2-default-rtdb.firebaseio.com"
};


/* =========================================================
   INITIALIZE FIREBASE
========================================================= */

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getDatabase(app);

let currentUser = null;

let dataMaster = null;

let dataLoading = false;


/* =========================================================
   BASIC HELPERS
========================================================= */

function $(id) {
  return document.getElementById(id);
}


function clean(value) {
  return String(value ?? "").trim();
}


function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}


function keyNormalize(value) {
  return normalize(value)
    .replace(/[^a-z0-9]/g, "");
}


/* =========================================================
   STATUS MESSAGE
========================================================= */

function showStatus(message, type = "ok") {

  const element = $("status");

  if (!element) return;

  element.style.display = "block";

  element.className =
    type === "ok"
      ? "ok"
      : type === "info"
        ? "info"
        : "err";

  element.textContent = message;
}


/* =========================================================
   GET VALUE FROM FIREBASE OBJECT
========================================================= */

function getField(object, possibleNames) {

  if (!object || typeof object !== "object") {
    return "";
  }

  const wanted = new Set(
    possibleNames.map(keyNormalize)
  );

  for (const [key, value] of Object.entries(object)) {

    if (
      wanted.has(keyNormalize(key)) &&
      value !== null &&
      value !== undefined &&
      typeof value !== "object"
    ) {

      return clean(value);
    }
  }

  return "";
}


/* =========================================================
   STORE MASTER
========================================================= */

async function loadStore(storeCode) {

  storeCode = clean(storeCode);

  if (!storeCode) return;

  const status = $("storeLookupStatus");

  if (status) {
    status.textContent = "Loading store...";
  }

  try {

    const storeReference =
      ref(db, `storeMaster/${storeCode}`);

    const snapshot =
      await get(storeReference);

    if (!snapshot.exists()) {

      $("storeName").value = "";
      $("areaManager").value = "";
      $("operationManager").value = "";

      if (status) {
        status.textContent =
          `Store ${storeCode} not found`;
      }

      return;
    }

    const store = snapshot.val();

    $("storeName").value =
      getField(store, [
        "storeName",
        "Store Name",
        "name",
        "store"
      ]);

    $("areaManager").value =
      getField(store, [
        "areaManager",
        "Area Manager",
        "AM",
        "area"
      ]);

    $("operationManager").value =
      getField(store, [
        "operationManager",
        "Operation Manager",
        "OM",
        "operationsManager",
        "operationManagerName"
      ]);

    if (status) {
      status.textContent =
        `✓ Store ${storeCode} loaded from Firebase`;
    }

  } catch (error) {

    console.error(error);

    if (status) {
      status.textContent =
        "Firebase store lookup failed";
    }

    showStatus(
      "Unable to load store information.",
      "err"
    );
  }
}


/* =========================================================
   FIREBASE DATA MASTER
========================================================= */

async function loadDataMaster() {

  if (dataMaster !== null) {
    return dataMaster;
  }

  if (dataLoading) {

    while (dataLoading) {
      await new Promise(
        resolve => setTimeout(resolve, 100)
      );
    }

    return dataMaster;
  }

  dataLoading = true;

  try {

    const dataReference =
      ref(db, "Data");

    const snapshot =
      await get(dataReference);

    if (!snapshot.exists()) {

      throw new Error(
        "Firebase Data node was not found."
      );
    }

    dataMaster = snapshot.val();

    return dataMaster;

  } finally {

    dataLoading = false;
  }
}


/* =========================================================
   CONVERT HEADER + ARRAY DATA
========================================================= */

function arrayToObject(headers, row) {

  if (
    !Array.isArray(headers) ||
    !Array.isArray(row)
  ) {
    return null;
  }

  const object = {};

  headers.forEach((header, index) => {

    if (
      header !== null &&
      header !== undefined &&
      header !== ""
    ) {

      object[header] = row[index];
    }

  });

  return object;
}


/* =========================================================
   FIND ALL RECORDS INSIDE FIREBASE DATA
========================================================= */

function collectRecords(
  node,
  headers = null,
  records = []
) {

  if (Array.isArray(node)) {

    for (const item of node) {

      if (Array.isArray(item)) {

        const record =
          arrayToObject(headers, item);

        if (record) {
          records.push(record);
        }

      } else if (
        item &&
        typeof item === "object"
      ) {

        records.push(item);
      }
    }

    return records;
  }


  if (
    !node ||
    typeof node !== "object"
  ) {

    return records;
  }


  const localHeaders =
    Array.isArray(node.headers)
      ? node.headers
      : headers;


  /* Current object itself may be an item */

  const keys =
    Object.keys(node)
      .map(keyNormalize);


  const looksLikeItem =
    keys.includes("sku") ||
    keys.includes("barcodes") ||
    keys.includes("barcode") ||
    keys.includes("endesc") ||
    keys.includes("cost");


  if (looksLikeItem) {
    records.push(node);
  }


  for (
    const [key, value]
    of Object.entries(node)
  ) {

    if (key === "headers") {
      continue;
    }


    if (Array.isArray(value)) {

      for (const item of value) {

        if (Array.isArray(item)) {

          const record =
            arrayToObject(
              localHeaders,
              item
            );

          if (record) {
            records.push(record);
          }

        } else if (
          item &&
          typeof item === "object"
        ) {

          records.push(item);
        }
      }

    } else if (
      value &&
      typeof value === "object"
    ) {

      collectRecords(
        value,
        localHeaders,
        records
      );
    }
  }


  return records;
}


/* =========================================================
   CHECK BARCODE
========================================================= */

function barcodeMatches(
  record,
  barcode
) {

  barcode = normalize(barcode);

  if (!barcode) {
    return false;
  }


  const value =
    getField(record, [
      "Barcodes",
      "Barcode",
      "barCode"
    ]);


  if (!value) {
    return false;
  }


  const values =
    String(value)
      .split(/[,;|]/)
      .map(normalize);


  return values.includes(barcode);
}


/* =========================================================
   CHECK SKU
========================================================= */

function skuMatches(
  record,
  sku
) {

  sku = normalize(sku);

  if (!sku) {
    return false;
  }


  const value =
    getField(record, [
      "SKU",
      "sku"
    ]);


  return (
    value &&
    normalize(value) === sku
  );
}


/* =========================================================
   SEARCH ITEM
========================================================= */

function findItem(
  data,
  barcode,
  sku
) {

  barcode = clean(barcode);

  sku = clean(sku);


  /* -----------------------------------------
     DIRECT KEY SEARCH
  ----------------------------------------- */

  if (
    data &&
    typeof data === "object"
  ) {

    if (
      barcode &&
      data[barcode] &&
      typeof data[barcode] === "object"
    ) {

      return data[barcode];
    }


    if (
      sku &&
      data[sku] &&
      typeof data[sku] === "object"
    ) {

      return data[sku];
    }
  }


  /* -----------------------------------------
     SEARCH ALL RECORDS
  ----------------------------------------- */

  const records =
    collectRecords(data);


  /* Barcode first */

  if (barcode) {

    for (const record of records) {

      if (
        barcodeMatches(
          record,
          barcode
        )
      ) {

        return record;
      }
    }
  }


  /* SKU second */

  if (sku) {

    for (const record of records) {

      if (
        skuMatches(
          record,
          sku
        )
      ) {

        return record;
      }
    }
  }


  return null;
}


/* =========================================================
   NORMALIZE ITEM
========================================================= */

function normalizeItem(record) {

  return {

    sku:
      getField(record, [
        "SKU",
        "sku"
      ]),

    barcode:
      getField(record, [
        "Barcodes",
        "Barcode",
        "barcode"
      ]),

    uom:
      getField(record, [
        "UOM",
        "uom"
      ]),

    itemName:
      getField(record, [
        "EN Desc",
        "ENDesc",
        "Description",
        "Item Name",
        "ItemName"
      ]),

    cost:
      getField(record, [
        "Cost",
        "cost"
      ]),

    supplier:
      getField(record, [
        "Default Supplier",
        "DefaultSupplier",
        "Supplier"
      ]),

    vendorCode:
      getField(record, [
        "Vendor Code",
        "VendorCode"
      ]),

    category:
      getField(record, [
        "Category",
        "category"
      ]),

    returnable:
      getField(record, [
        "Non - Returnable & Returnable",
        "Non-Returnable & Returnable",
        "Returnable"
      ]),

    masterQty:
      getField(record, [
        "Qty",
        "Quantity"
      ]),

    totalCost:
      getField(record, [
        "Total Cost",
        "TotalCost"
      ]),

    expiryDate:
      getField(record, [
        "Expiry Date",
        "ExpiryDate"
      ]),

    daysLeft:
      getField(record, [
        "Days Left",
        "DaysLeft"
      ])
  };
}


/* =========================================================
   ADD ITEM ROW
========================================================= */

function addRow(data = {}) {

  const table =
    $("rows");

  if (!table) return;


  const row =
    document.createElement("tr");


  row.innerHTML = `

    <td>
      <input
        class="sku lookup-input"
        placeholder="SKU"
        value="${escapeHtml(data.sku || "")}">
    </td>

    <td>
      <input
        class="barcode lookup-input"
        placeholder="Barcode"
        value="${escapeHtml(data.barcode || "")}">
    </td>

    <td>
      <input
        class="uom"
        readonly
        value="${escapeHtml(data.uom || "")}">
    </td>

    <td>
      <input
        class="itemName"
        readonly
        value="${escapeHtml(data.itemName || "")}">
    </td>

    <td>
      <input
        class="cost"
        readonly
        value="${escapeHtml(data.cost || "")}">
    </td>

    <td>
      <input
        class="supplier"
        readonly
        value="${escapeHtml(data.supplier || "")}">
    </td>

    <td>
      <input
        class="vendorCode"
        readonly
        value="${escapeHtml(data.vendorCode || "")}">
    </td>

    <td>
      <input
        class="itemCategory"
        readonly
        value="${escapeHtml(data.category || "")}">
    </td>

    <td>
      <input
        class="returnable"
        readonly
        value="${escapeHtml(data.returnable || "")}">
    </td>

    <td>
      <input
        class="qty"
        type="number"
        min="0"
        step="1"
        value="${escapeHtml(data.quantity || "")}">
    </td>

    <td>
      <input
        class="expiryDate"
        type="date"
        value="${escapeHtml(data.expiryDate || "")}">
    </td>

    <td>
      <input
        class="daysLeft"
        readonly
        value="${escapeHtml(data.daysLeft || "")}">
    </td>

    <td>
      <button
        type="button"
        class="remove">
        Remove
      </button>
    </td>
  `;


  table.appendChild(row);


  /* Remove button */

  row
    .querySelector(".remove")
    .addEventListener(
      "click",
      () => row.remove()
    );


  /* Barcode lookup */

  const barcodeInput =
    row.querySelector(".barcode");


  barcodeInput.addEventListener(
    "change",
    () => lookupItem(row)
  );


  barcodeInput.addEventListener(
    "blur",
    () => lookupItem(row)
  );


  /* SKU lookup */

  const skuInput =
    row.querySelector(".sku");


  skuInput.addEventListener(
    "change",
    () => lookupItem(row)
  );


  skuInput.addEventListener(
    "blur",
    () => lookupItem(row)
  );


  /* Existing data */

  if (
    data.barcode ||
    data.sku
  ) {

    lookupItem(row);
  }
}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


/* =========================================================
   LOOKUP ITEM FOR ROW
========================================================= */

async function lookupItem(row) {

  const barcode =
    clean(
      row.querySelector(
        ".barcode"
      ).value
    );


  const sku =
    clean(
      row.querySelector(
        ".sku"
      ).value
    );


  if (
    !barcode &&
    !sku
  ) {

    return;
  }


  try {

    showStatus(
      "Searching Firebase item master...",
      "info"
    );


    const data =
      await loadDataMaster();


    const item =
      findItem(
        data,
        barcode,
        sku
      );


    if (!item) {

      showStatus(
        `Item not found: ${barcode || sku}`,
        "err"
      );

      return;
    }


    const x =
      normalizeItem(item);


    row.querySelector(".sku").value =
      x.sku || "";


    row.querySelector(".barcode").value =
      x.barcode || barcode;


    row.querySelector(".uom").value =
      x.uom || "";


    row.querySelector(".itemName").value =
      x.itemName || "";


    row.querySelector(".cost").value =
      x.cost || "";


    row.querySelector(".supplier").value =
      x.supplier || "";


    row.querySelector(".vendorCode").value =
      x.vendorCode || "";


    row.querySelector(".itemCategory").value =
      x.category || "";


    row.querySelector(".returnable").value =
      x.returnable || "";


    row.querySelector(".daysLeft").value =
      x.daysLeft || "";


    showStatus(
      `✓ Item loaded: ${x.itemName || x.sku || x.barcode}`,
      "ok"
    );


  } catch (error) {

    console.error(error);

    showStatus(
      "Firebase item lookup failed: " +
      error.message,
      "err"
    );
  }
}


/* =========================================================
   COLLECT FORM ITEMS
========================================================= */

function getItems() {

  const rows =
    document.querySelectorAll(
      "#rows tr"
    );


  const items = [];


  rows.forEach(row => {

    const item = {

      sku:
        clean(
          row.querySelector(
            ".sku"
          ).value
        ),

      barcode:
        clean(
          row.querySelector(
            ".barcode"
          ).value
        ),

      uom:
        clean(
          row.querySelector(
            ".uom"
          ).value
        ),

      itemName:
        clean(
          row.querySelector(
            ".itemName"
          ).value
        ),

      cost:
        clean(
          row.querySelector(
            ".cost"
          ).value
        ),

      defaultSupplier:
        clean(
          row.querySelector(
            ".supplier"
          ).value
        ),

      vendorCode:
        clean(
          row.querySelector(
            ".vendorCode"
          ).value
        ),

      category:
        clean(
          row.querySelector(
            ".itemCategory"
          ).value
        ),

      returnable:
        clean(
          row.querySelector(
            ".returnable"
          ).value
        ),

      quantity:
        Number(
          row.querySelector(
            ".qty"
          ).value || 0
        ),

      expiryDate:
        clean(
          row.querySelector(
            ".expiryDate"
          ).value
        ),

      daysLeft:
        clean(
          row.querySelector(
            ".daysLeft"
          ).value
        )
    };


    if (
      item.sku ||
      item.barcode ||
      item.itemName ||
      item.quantity ||
      item.expiryDate
    ) {

      items.push(item);
    }

  });


  return items;
}


/* =========================================================
   GET FORM DATA
========================================================= */

function getFormData() {

  return {

    storeCode:
      clean(
        $("storeCode").value
      ),

    storeName:
      clean(
        $("storeName").value
      ),

    areaManager:
      clean(
        $("areaManager").value
      ),

    operationManager:
      clean(
        $("operationManager").value
      ),

    category:
      clean(
        $("category").value
      ),

    cycleStart:
      clean(
        $("cycleStart").value
      ),

    cycleEnd:
      clean(
        $("cycleEnd").value
      ),

    items:
      getItems()
  };
}


/* =========================================================
   VALIDATE
========================================================= */

function validate(data) {

  if (!data.storeCode) {
    throw new Error(
      "Please enter Store Code."
    );
  }


  if (!data.category) {
    throw new Error(
      "Please enter Category."
    );
  }


  if (!data.cycleStart) {
    throw new Error(
      "Please select Cycle Start."
    );
  }


  if (!data.cycleEnd) {
    throw new Error(
      "Please select Cycle End."
    );
  }


  if (
    data.cycleEnd <
    data.cycleStart
  ) {

    throw new Error(
      "Cycle End cannot be before Cycle Start."
    );
  }


  if (!data.items.length) {

    throw new Error(
      "Please add at least one item."
    );
  }


  data.items.forEach(
    (item, index) => {

      if (
        !item.barcode &&
        !item.sku
      ) {

        throw new Error(
          `Item ${index + 1}: Barcode or SKU is required.`
        );
      }


      if (!item.expiryDate) {

        throw new Error(
          `Item ${index + 1}: Expiry Date is required.`
        );
      }

    }
  );
}


/* =========================================================
   DRAFT ID
========================================================= */

function getDraftId(data) {

  return (

    `${data.storeCode}__` +
    `${data.category}__` +
    `${data.cycleStart}__` +
    `${data.cycleEnd}`

  ).replace(
    /[.#$\[\]/]/g,
    "_"
  );
}


/* =========================================================
   SAVE DRAFT
========================================================= */

async function saveDraft() {

  try {

    const data =
      getFormData();


    validate(data);


    if (!currentUser) {

      throw new Error(
        "Firebase authentication is not ready."
      );
    }


    const draftId =
      getDraftId(data);


    await set(

      ref(
        db,
        `expiryMonitoring/drafts/${draftId}`
      ),

      {

        ...data,

        status: "DRAFT",

        updatedAt:
          serverTimestamp(),

        userId:
          currentUser.uid
      }
    );


    showStatus(
      "✓ Draft saved successfully.",
      "ok"
    );


  } catch (error) {

    console.error(error);

    showStatus(
      error.message,
      "err"
    );
  }
}


/* =========================================================
   SUBMIT
========================================================= */

async function submitForm() {

  try {

    const data =
      getFormData();


    validate(data);


    if (!currentUser) {

      throw new Error(
        "Firebase authentication is not ready."
      );
    }


    const submissionReference =
      push(
        ref(
          db,
          "expiryMonitoring/submissions"
        )
      );


    await set(
      submissionReference,
      {

        ...data,

        status:
          "SUBMITTED",

        submittedAt:
          serverTimestamp(),

        userId:
          currentUser.uid
      }
    );


    const draftId =
      getDraftId(data);


    await set(
      ref(
        db,
        `expiryMonitoring/drafts/${draftId}`
      ),
      null
    );


    showStatus(
      "✓ Submitted successfully.",
      "ok"
    );


  } catch (error) {

    console.error(error);

    showStatus(
      error.message,
      "err"
    );
  }
}


/* =========================================================
   MAKE FUNCTIONS AVAILABLE TO HTML
========================================================= */

window.addRow =
  addRow;

window.saveDraft =
  saveDraft;

window.submitForm =
  submitForm;


/* =========================================================
   STORE CODE EVENTS
========================================================= */

$("storeCode")
  ?.addEventListener(
    "change",
    () => loadStore(
      $("storeCode").value
    )
  );


$("storeCode")
  ?.addEventListener(
    "blur",
    () => loadStore(
      $("storeCode").value
    )
  );


/* =========================================================
   FIREBASE ANONYMOUS LOGIN
========================================================= */

signInAnonymously(auth)

  .then(result => {

    currentUser =
      result.user;


    if ($("authStatus")) {

      $("authStatus").textContent =
        "Firebase connected";
    }


    showStatus(
      "✓ Firebase connected.",
      "info"
    );

  })

  .catch(error => {

    console.error(error);


    if ($("authStatus")) {

      $("authStatus").textContent =
        "Firebase authentication error";
    }


    showStatus(
      "Enable Anonymous Authentication in Firebase Console.",
      "err"
    );

  });


/* =========================================================
   START WITH ONE EMPTY ITEM ROW
========================================================= */

if ($("rows")) {

  addRow();
}
