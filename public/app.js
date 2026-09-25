import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";

import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  remove,
  get,
  update
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";


/* =========================================================
   FIREBASE CONFIG
========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyDXTkoz1xSpsWYuMUv-Wvm57TF0ajj0p9M9",
  authDomain: "expiry-monitoring-v2.firebaseapp.com",
  projectId: "expiry-monitoring-v2",
  storageBucket: "expiry-monitoring-v2.firebasestorage.app",
  messagingSenderId: "722745088244",
  appId: "1:722745088244:web:17a4f2854a98ee6f6366a1",
  measurementId: "G-YPXSVPRK36"
};


/* =========================================================
   INITIALIZE
========================================================= */

const app = initializeApp(firebaseConfig);

const db = getDatabase(app);

const auth = getAuth(app);


/* =========================================================
   GLOBAL DATA
========================================================= */

let firebaseReady = false;

let storeMaster = {};

let productData = [];

let dataHeaders = [];

let categories = {};

let storeCategories = {};

let submissions = {};

let currentItems = [];

let currentProduct = null;

let currentStore = null;


/* =========================================================
   AUTHENTICATION
========================================================= */

signInAnonymously(auth)
  .then(() => {
    console.log("Anonymous authentication started.");
  })
  .catch(error => {

    console.error(error);

    setFirebaseStatus(
      "Authentication Error",
      "error"
    );

  });


onAuthStateChanged(auth, user => {

  if (!user) {
    setFirebaseStatus(
      "Not Connected",
      "error"
    );

    return;
  }

  firebaseReady = true;

  setFirebaseStatus(
    "Firebase Connected",
    "connected"
  );

  startFirebaseListeners();

});


/* =========================================================
   FIREBASE STATUS
========================================================= */

function setFirebaseStatus(text, type) {

  const el = document.getElementById(
    "firebaseStatus"
  );

  if (!el) return;

  el.textContent = text;

  el.className = "status " + (type || "");

}


/* =========================================================
   REALTIME FIREBASE LISTENERS
========================================================= */

function startFirebaseListeners() {

  /*
   STORE MASTER
  */

  onValue(
    ref(db, "storeMaster"),
    snapshot => {

      storeMaster =
        snapshot.val() || {};

      renderStoreTable();

      populateStoreSelectors();

      updateStoreCount();

      console.log(
        "storeMaster updated",
        storeMaster
      );

    },
    error => {

      console.error(
        "storeMaster:",
        error
      );

    }
  );


  /*
   DATA
  */

  onValue(
    ref(db, "Data"),
    snapshot => {

      const value =
        snapshot.val() || {};

      processProductData(value);

      renderProducts();

      updateProductCount();

      console.log(
        "Data updated",
        productData.length
      );

    },
    error => {

      console.error(
        "Data:",
        error
      );

    }
  );


  /*
   CATEGORIES
  */

  onValue(
    ref(db, "categories"),
    snapshot => {

      categories =
        snapshot.val() || {};

      renderCategoryTable();

      populateCategorySelectors();

      updateCategoryCount();

    }
  );


  /*
   STORE CATEGORIES
  */

  onValue(
    ref(db, "storeCategories"),
    snapshot => {

      storeCategories =
        snapshot.val() || {};

      renderAssignmentTable();

    }
  );


  /*
   SUBMISSIONS
  */

  onValue(
    ref(db, "expiryMonitoring/submissions"),
    snapshot => {

      submissions =
        snapshot.val() || {};

      updateSubmissionCount();

    }
  );

}


/* =========================================================
   PROCESS DATA
========================================================= */

function processProductData(value) {

  productData = [];

  dataHeaders = [];

  /*
   Your Firebase Data currently looks like:

   Data
      headers
        0 SKU
        1 Barcodes
        2 UOM
        3 EN Desc
        ...
   */

  if (
    value &&
    Array.isArray(value.headers)
  ) {

    dataHeaders = value.headers;

  }


  /*
   If Data is an array
  */

  if (Array.isArray(value)) {

    productData =
      value.map(row => {

        if (Array.isArray(row)) {

          return arrayRowToProduct(row);

        }

        return row;

      });

    return;

  }


  /*
   If Data contains rows / records
  */

  const keys =
    Object.keys(value || {});


  keys.forEach(key => {

    if (key === "headers") return;

    const row = value[key];

    if (Array.isArray(row)) {

      productData.push(
        arrayRowToProduct(row)
      );

    } else if (
      row &&
      typeof row === "object"
    ) {

      productData.push(row);

    }

  });

}


function arrayRowToProduct(row) {

  const obj = {};

  dataHeaders.forEach(
    (header, index) => {

      obj[
        String(header)
      ] = row[index];

    }
  );

  return obj;

}


/* =========================================================
   STORE LOOKUP
========================================================= */

window.lookupStore = function() {

  const code =
    String(
      document.getElementById(
        "storeCode"
      ).value || ""
    ).trim();

  if (!code) {

    clearStoreInformation();

    return;

  }

  const store =
    findStore(code);

  if (!store) {

    clearStoreInformation();

    showFormMessage(
      "Store Code not found in Firebase storeMaster.",
      "error"
    );

    return;

  }

  currentStore = store;

  document.getElementById(
    "storeName"
  ).value =
    store.storeName ||
    store.name ||
    store.palmStore ||
    "";

  document.getElementById(
    "areaManager"
  ).value =
    store.areaManager || "";

  document.getElementById(
    "operationManager"
  ).value =
    store.operationManager || "";

  showFormMessage(
    "Store verified: " +
    (
      store.storeName ||
      store.name ||
      code
    ),
    "success"
  );

};


function findStore(code) {

  const target =
    String(code)
      .trim()
      .toUpperCase();

  /*
   Direct Firebase key
  */

  if (
    storeMaster[target]
  ) {

    return normalizeStore(
      target,
      storeMaster[target]
    );

  }

  /*
   Search values
  */

  for (
    const key of Object.keys(storeMaster)
  ) {

    const value =
      storeMaster[key];

    if (!value) continue;

    const possible =
      String(
        value.storeCode ||
        value.code ||
        key
      )
      .trim()
      .toUpperCase();

    if (
      possible === target
    ) {

      return normalizeStore(
        key,
        value
      );

    }

  }

  return null;

}


function normalizeStore(code, value) {

  return {

    code,

    ...value,

    storeName:
      value.storeName ||
      value.name ||
      value.palmStore ||
      code

  };

}


function clearStoreInformation() {

  currentStore = null;

  [
    "storeName",
    "areaManager",
    "operationManager"
  ].forEach(id => {

    const el =
      document.getElementById(id);

    if (el) el.value = "";

  });

}


/* =========================================================
   BARCODE / SKU LOOKUP
========================================================= */

window.lookupItem = function() {

  const value =
    String(
      document.getElementById(
        "barcodeInput"
      ).value || ""
    ).trim();

  if (!value) {

    currentProduct = null;

    clearItemMasterFields();

    return;

  }

  const product =
    findProduct(value);

  if (!product) {

    currentProduct = null;

    clearItemMasterFields();

    showItemLookup(
      "No SKU / Barcode found in Firebase /Data.",
      false
    );

    return;

  }

  currentProduct = product;

  fillItemMaster(product);

};


function findProduct(search) {

  const target =
    String(search)
      .trim()
      .toLowerCase();

  for (
    const product of productData
  ) {

    if (!product) continue;

    const sku =
      String(
        product["SKU"] ??
        product.sku ??
        ""
      )
      .trim()
      .toLowerCase();

    const barcode =
      String(
        product["Barcodes"] ??
        product["Barcode"] ??
        product.barcode ??
        ""
      )
      .trim()
      .toLowerCase();

    /*
      Some records may contain:

      123456,123457
      123456 / 123457
      123456;123457
    */

    const barcodeParts =
      barcode
        .split(/[,;\/|]+/)
        .map(x => x.trim())
        .filter(Boolean);

    if (
      sku === target ||
      barcode === target ||
      barcodeParts.includes(target)
    ) {

      return product;

    }

  }

  return null;

}


/* =========================================================
   PRODUCT FORM
========================================================= */

function fillItemMaster(product) {

  document.getElementById(
    "itemSku"
  ).value =
    product["SKU"] ??
    product.sku ??
    "";

  document.getElementById(
    "itemName"
  ).value =
    product["EN Desc"] ??
    product["Item Name"] ??
    product.itemName ??
    "";

  document.getElementById(
    "itemUom"
  ).value =
    product["UOM"] ??
    "";

  document.getElementById(
    "itemCost"
  ).value =
    product["Cost"] ??
    "";

  document.getElementById(
    "itemSupplier"
  ).value =
    product["Default Supplier"] ??
    "";

  document.getElementById(
    "itemVendor"
  ).value =
    product["Vendor Code"] ??
    "";

  showItemLookup(
    "Item found successfully.",
    true
  );

}


function clearItemMasterFields() {

  [
    "itemSku",
    "itemName",
    "itemUom",
    "itemCost",
    "itemSupplier",
    "itemVendor"
  ].forEach(id => {

    const el =
      document.getElementById(id);

    if (el) el.value = "";

  });

}


function showItemLookup(text, success) {

  const el =
    document.getElementById(
      "itemLookupResult"
    );

  if (!el) return;

  el.textContent = text;

  el.className =
    "lookup-result show";

  el.style.background =
    success
      ? "#f0fdf4"
      : "#fef2f2";

  el.style.borderColor =
    success
      ? "#bbf7d0"
      : "#fecaca";

}


window.barcodeEnter = function(event) {

  if (
    event.key !== "Enter"
  ) return;

  event.preventDefault();

  lookupItem();

};


/* =========================================================
   ADD ITEM
========================================================= */

window.addItem = function() {

  const barcode =
    document.getElementById(
      "barcodeInput"
    ).value.trim();

  const qty =
    Number(
      document.getElementById(
        "itemQty"
      ).value
    );

  const expiry =
    document.getElementById(
      "itemExpiry"
    ).value;

  if (!currentStore) {

    showFormMessage(
      "Please enter a valid Store Code first.",
      "error"
    );

    return;

  }

  if (!currentProduct) {

    showFormMessage(
      "Please enter a valid SKU or Barcode.",
      "error"
    );

    return;

  }

  if (!qty || qty <= 0) {

    showFormMessage(
      "Enter Quantity.",
      "error"
    );

    return;

  }

  if (!expiry) {

    showFormMessage(
      "Enter Expiry Date.",
      "error"
    );

    return;

  }

  currentItems.push({

    sku:
      currentProduct["SKU"] ||
      currentProduct.sku ||
      "",

    barcode,

    itemName:
      currentProduct["EN Desc"] ||
      currentProduct["Item Name"] ||
      "",

    uom:
      currentProduct["UOM"] ||
      "",

    cost:
      Number(
        currentProduct["Cost"] || 0
      ),

    quantity:qty,

    expiryDate:expiry,

    supplier:
      currentProduct["Default Supplier"] ||
      "",

    vendorCode:
      currentProduct["Vendor Code"] ||
      ""

  });

  renderItems();

  clearItem();

};


/* =========================================================
   CLEAR ITEM
========================================================= */

window.clearItem = function() {

  document.getElementById(
    "barcodeInput"
  ).value = "";

  document.getElementById(
    "itemQty"
  ).value = "";

  document.getElementById(
    "itemExpiry"
  ).value = "";

  currentProduct = null;

  clearItemMasterFields();

  const result =
    document.getElementById(
      "itemLookupResult"
    );

  if (result) {

    result.className =
      "lookup-result";

  }

};


/* =========================================================
   RENDER ITEMS
========================================================= */

function renderItems() {

  const body =
    document.getElementById(
      "itemsBody"
    );

  body.innerHTML = "";

  currentItems.forEach(
    (item,index) => {

      const tr =
        document.createElement(
          "tr"
        );

      tr.innerHTML = `

        <td>${escapeHtml(item.sku)}</td>

        <td>${escapeHtml(item.barcode)}</td>

        <td>${escapeHtml(item.itemName)}</td>

        <td>${escapeHtml(item.uom)}</td>

        <td>${formatNumber(item.cost)}</td>

        <td>${formatNumber(item.quantity)}</td>

        <td>${escapeHtml(item.expiryDate)}</td>

        <td>
          <button
            class="btn-red"
            onclick="removeItem(${index})">
            Remove
          </button>
        </td>

      `;

      body.appendChild(tr);

    }
  );

}


window.removeItem = function(index) {

  currentItems.splice(
    index,
    1
  );

  renderItems();

};


/* =========================================================
   SAVE DRAFT
========================================================= */

window.saveDraft = async function() {

  if (!validateSubmission())
    return;

  try {

    const draftRef =
      push(
        ref(
          db,
          "expiryMonitoring/drafts"
        )
      );

    await set(
      draftRef,
      buildSubmissionObject(
        "DRAFT"
      )
    );

    showFormMessage(
      "Draft saved successfully.",
      "success"
    );

  } catch(error) {

    console.error(error);

    showFormMessage(
      "Draft save failed: " +
      error.message,
      "error"
    );

  }

};


/* =========================================================
   SUBMIT
========================================================= */

window.submitExpiry = async function() {

  if (!validateSubmission())
    return;

  if (
    !confirm(
      "Submit this expiry monitoring record?"
    )
  ) return;

  try {

    const submissionRef =
      push(
        ref(
          db,
          "expiryMonitoring/submissions"
        )
      );

    await set(
      submissionRef,
      buildSubmissionObject(
        "SUBMITTED"
      )
    );

    showFormMessage(
      "Submission completed successfully.",
      "success"
    );

    currentItems = [];

    renderItems();

  } catch(error) {

    console.error(error);

    showFormMessage(
      "Submission failed: " +
      error.message,
      "error"
    );

  }

};


function validateSubmission() {

  if (!currentStore) {

    showFormMessage(
      "Valid Store Code is required.",
      "error"
    );

    return false;

  }

  if (!currentItems.length) {

    showFormMessage(
      "Please add at least one item.",
      "error"
    );

    return false;

  }

  return true;

}


function buildSubmissionObject(status) {

  return {

    storeCode:
      currentStore.code,

    storeName:
      currentStore.storeName || "",

    areaManager:
      currentStore.areaManager || "",

    operationManager:
      currentStore.operationManager || "",

    category:
      document.getElementById(
        "category"
      ).value,

    cycleStart:
      document.getElementById(
        "cycleStart"
      ).value,

    cycleEnd:
      document.getElementById(
        "cycleEnd"
      ).value,

    status,

    items:currentItems,

    submittedAt:
      new Date().toISOString(),

    source:"GitHub Firebase Form"

  };

}


/* =========================================================
   ADMIN TABS
========================================================= */

window.openAdminTab = function(
  tab,
  button
) {

  document
    .querySelectorAll(
      ".admin-panel"
    )
    .forEach(panel => {

      panel.classList.remove(
        "active"
      );

    });

  document
    .querySelectorAll(
      ".admin-tab"
    )
    .forEach(btn => {

      btn.classList.remove(
        "active"
      );

    });

  const panel =
    document.getElementById(
      "admin" +
      capitalize(tab)
    );

  if (panel)
    panel.classList.add(
      "active"
    );

  if (button)
    button.classList.add(
      "active"
    );

};


function capitalize(value) {

  return value.charAt(0).toUpperCase() +
    value.slice(1);

}


/* =========================================================
   STORE ADMIN
========================================================= */

window.saveStore = async function() {

  const code =
    document.getElementById(
      "adminStoreCode"
    ).value.trim();

  if (!code) {

    alert(
      "Store Code is required."
    );

    return;

  }

  const data = {

    storeName:
      document.getElementById(
        "adminStoreName"
      ).value.trim(),

    areaManager:
      document.getElementById(
        "adminAreaManager"
      ).value.trim(),

    operationManager:
      document.getElementById(
        "adminOperationManager"
      ).value.trim(),

    email:
      document.getElementById(
        "adminStoreEmail"
      ).value.trim(),

    classification:
      document.getElementById(
        "adminClassification"
      ).value

  };

  try {

    await set(
      ref(
        db,
        "storeMaster/" +
        safeFirebaseKey(code)
      ),
      data
    );

    alert(
      "Store saved successfully."
    );

    clearStoreForm();

  } catch(error) {

    alert(
      "Error: " +
      error.message
    );

  }

};


window.editStore = function(code) {

  const store =
    findStore(code);

  if (!store) return;

  document.getElementById(
    "adminStoreCode"
  ).value = code;

  document.getElementById(
    "adminStoreName"
  ).value =
    store.storeName || "";

  document.getElementById(
    "adminAreaManager"
  ).value =
    store.areaManager || "";

  document.getElementById(
    "adminOperationManager"
  ).value =
    store.operationManager || "";

  document.getElementById(
    "adminStoreEmail"
  ).value =
    store.email || "";

  document.getElementById(
    "adminClassification"
  ).value =
    store.classification || "";

};


window.deleteStore = async function(code) {

  if (
    !confirm(
      "Delete Store " +
      code +
      "?"
    )
  ) return;

  try {

    await remove(
      ref(
        db,
        "storeMaster/" +
        safeFirebaseKey(code)
      )
    );

  } catch(error) {

    alert(
      error.message
    );

  }

};


window.clearStoreForm = function() {

  [
    "adminStoreCode",
    "adminStoreName",
    "adminAreaManager",
    "adminOperationManager",
    "adminStoreEmail"
  ].forEach(id => {

    document.getElementById(
      id
    ).value = "";

  });

  document.getElementById(
    "adminClassification"
  ).value = "";

};


/* =========================================================
   STORE TABLE
========================================================= */

function renderStoreTable() {

  const body =
    document.getElementById(
      "storesTable"
    );

  if (!body) return;

  body.innerHTML = "";

  Object.keys(storeMaster)
    .sort()
    .forEach(code => {

      const store =
        normalizeStore(
          code,
          storeMaster[code] || {}
        );

      const tr =
        document.createElement(
          "tr"
        );

      tr.innerHTML = `

        <td>
          <b>${escapeHtml(code)}</b>
        </td>

        <td>
          ${escapeHtml(
            store.storeName || ""
          )}
        </td>

        <td>
          ${escapeHtml(
            store.areaManager || ""
          )}
        </td>

        <td>
          ${escapeHtml(
            store.operationManager || ""
          )}
        </td>

        <td>
          <span class="badge">
            ${escapeHtml(
              store.classification || ""
            )}
          </span>
        </td>

        <td>

          <button
            class="btn-blue"
            onclick="editStore('${escapeJs(code)}')">
            Edit
          </button>

          <button
            class="btn-red"
            onclick="deleteStore('${escapeJs(code)}')">
            Delete
          </button>

        </td>

      `;

      body.appendChild(tr);

    });

}


/* =========================================================
   CATEGORY ADMIN
========================================================= */

window.saveCategory = async function() {

  const name =
    document.getElementById(
      "adminCategoryName"
    ).value.trim();

  if (!name) {

    alert(
      "Enter category name."
    );

    return;

  }

  const key =
    safeFirebaseKey(name);

  try {

    await set(
      ref(
        db,
        "categories/" + key
      ),
      {
        name:name,
        active:true,
        updatedAt:
          new Date().toISOString()
      }
    );

    document.getElementById(
      "adminCategoryName"
    ).value = "";

  } catch(error) {

    alert(
      error.message
    );

  }

};


window.deleteCategory = async function(
  key
) {

  if (
    !confirm(
      "Delete this category?"
    )
  ) return;

  try {

    await remove(
      ref(
        db,
        "categories/" +
        key
      )
    );

  } catch(error) {

    alert(
      error.message
    );

  }

};


function renderCategoryTable() {

  const body =
    document.getElementById(
      "categoriesTable"
    );

  if (!body) return;

  body.innerHTML = "";

  Object.keys(categories)
    .sort()
    .forEach(key => {

      const value =
        categories[key];

      const name =
        typeof value === "string"
          ? value
          : (
              value.name ||
              key
            );

      const tr =
        document.createElement(
          "tr"
        );

      tr.innerHTML = `

        <td>
          ${escapeHtml(name)}
        </td>

        <td>

          <button
            class="btn-red"
            onclick="deleteCategory('${escapeJs(key)}')">
            Delete
          </button>

        </td>

      `;

      body.appendChild(tr);

    });

}


/* =========================================================
   STORE CATEGORY ASSIGNMENT
========================================================= */

window.assignCategory = async function() {

  const store =
    document.getElementById(
      "assignmentStore"
    ).value;

  const category =
    document.getElementById(
      "assignmentCategory"
    ).value;

  if (!store || !category) {

    alert(
      "Select Store and Category."
    );

    return;

  }

  try {

    await set(
      ref(
        db,
        "storeCategories/" +
        safeFirebaseKey(store) +
        "/" +
        safeFirebaseKey(category)
      ),
      true
    );

  } catch(error) {

    alert(
      error.message
    );

  }

};


window.removeCategoryAssignment =
async function() {

  const store =
    document.getElementById(
      "assignmentStore"
    ).value;

  const category =
    document.getElementById(
      "assignmentCategory"
    ).value;

  if (!store || !category)
    return;

  try {

    await remove(
      ref(
        db,
        "storeCategories/" +
        safeFirebaseKey(store) +
        "/" +
        safeFirebaseKey(category)
      )
    );

  } catch(error) {

    alert(
      error.message
    );

  }

};


function renderAssignmentTable() {

  const body =
    document.getElementById(
      "assignmentTable"
    );

  if (!body) return;

  body.innerHTML = "";

  Object.keys(storeCategories)
    .sort()
    .forEach(storeCode => {

      const cats =
        storeCategories[
          storeCode
        ] || {};

      Object.keys(cats)
        .forEach(category => {

          const store =
            findStore(
              storeCode
            );

          const tr =
            document.createElement(
              "tr"
            );

          tr.innerHTML = `

            <td>
              ${escapeHtml(storeCode)}
            </td>

            <td>
              ${escapeHtml(
                store?.storeName || ""
              )}
            </td>

            <td>
              <span class="badge">
                ${escapeHtml(category)}
              </span>
            </td>

          `;

          body.appendChild(tr);

        });

    });

}


/* =========================================================
   SELECTORS
========================================================= */

function populateStoreSelectors() {

  const selectors = [

    "assignmentStore"

  ];

  selectors.forEach(id => {

    const select =
      document.getElementById(id);

    if (!select) return;

    const current =
      select.value;

    select.innerHTML =
      `<option value="">
        Select Store
      </option>`;

    Object.keys(storeMaster)
      .sort()
      .forEach(code => {

        const store =
          findStore(code);

        const option =
          document.createElement(
            "option"
          );

        option.value = code;

        option.textContent =
          code +
          " · " +
          (
            store?.storeName ||
            ""
          );

        select.appendChild(
          option
        );

      });

    if (current)
      select.value = current;

  });

}


function populateCategorySelectors() {

  const formSelect =
    document.getElementById(
      "category"
    );

  const adminSelect =
    document.getElementById(
      "assignmentCategory"
    );

  const current =
    formSelect?.value || "";

  const currentAdmin =
    adminSelect?.value || "";


  if (formSelect) {

    formSelect.innerHTML =
      `<option value="">
        Select Category
      </option>`;

  }

  if (adminSelect) {

    adminSelect.innerHTML =
      `<option value="">
        Select Category
      </option>`;

  }


  Object.keys(categories)
    .sort()
    .forEach(key => {

      const value =
        categories[key];

      const name =
        typeof value === "string"
          ? value
          : (
              value.name ||
              key
            );

      if (formSelect) {

        const option =
          document.createElement(
            "option"
          );

        option.value = name;

        option.textContent =
          name;

        formSelect.appendChild(
          option
        );

      }


      if (adminSelect) {

        const option =
          document.createElement(
            "option"
          );

        option.value = name;

        option.textContent =
          name;

        adminSelect.appendChild(
          option
        );

      }

    });


  if (
    formSelect &&
    current
  )
    formSelect.value =
      current;

  if (
    adminSelect &&
    currentAdmin
  )
    adminSelect.value =
      currentAdmin;

}


/* =========================================================
   PRODUCT TABLE
========================================================= */

window.renderProducts = function() {

  const body =
    document.getElementById(
      "productsTable"
    );

  if (!body) return;

  const search =
    String(
      document.getElementById(
        "productSearch"
      )?.value || ""
    )
    .trim()
    .toLowerCase();

  body.innerHTML = "";

  let count = 0;

  productData.forEach(
    product => {

      if (count >= 500)
        return;

      const sku =
        product["SKU"] ?? "";

      const barcode =
        product["Barcodes"] ??
        product["Barcode"] ??
        "";

      const uom =
        product["UOM"] ?? "";

      const desc =
        product["EN Desc"] ?? "";

      const cost =
        product["Cost"] ?? "";

      const supplier =
        product["Default Supplier"] ??
        "";

      const vendor =
        product["Vendor Code"] ??
        "";

      const category =
        product["Category"] ??
        "";

      const combined =
        (
          sku +
          " " +
          barcode +
          " " +
          desc +
          " " +
          category
        )
        .toLowerCase();

      if (
        search &&
        !combined.includes(search)
      )
        return;

      const tr =
        document.createElement(
          "tr"
        );

      tr.innerHTML = `

        <td>${escapeHtml(sku)}</td>

        <td>${escapeHtml(barcode)}</td>

        <td>${escapeHtml(uom)}</td>

        <td>${escapeHtml(desc)}</td>

        <td>${escapeHtml(cost)}</td>

        <td>${escapeHtml(supplier)}</td>

        <td>${escapeHtml(vendor)}</td>

        <td>${escapeHtml(category)}</td>

      `;

      body.appendChild(tr);

      count++;

    }
  );

};


/* =========================================================
   COUNTERS
========================================================= */

function updateStoreCount() {

  const el =
    document.getElementById(
      "storeCount"
    );

  if (el)
    el.textContent =
      Object.keys(
        storeMaster
      ).length;

}


function updateCategoryCount() {

  const el =
    document.getElementById(
      "categoryCount"
    );

  if (el)
    el.textContent =
      Object.keys(
        categories
      ).length;

}


function updateProductCount() {

  const el =
    document.getElementById(
      "productCount"
    );

  if (el)
    el.textContent =
      productData.length;

}


function updateSubmissionCount() {

  const el =
    document.getElementById(
      "submissionCount"
    );

  if (el)
    el.textContent =
      Object.keys(
        submissions
      ).length;

}


/* =========================================================
   FIREBASE TEST
========================================================= */

window.testFirebase = async function() {

  try {

    await get(
      ref(
        db,
        "Data"
      )
    );

    showFirebaseAdminMessage(
      "Firebase connection is working correctly.",
      "success"
    );

  } catch(error) {

    showFirebaseAdminMessage(
      error.message,
      "error"
    );

  }

};


window.reloadFirebaseData =
function() {

  startFirebaseListeners();

  showFirebaseAdminMessage(
    "Firebase listeners refreshed.",
    "success"
  );

};


function showFirebaseAdminMessage(
  text,
  type
) {

  const el =
    document.getElementById(
      "firebaseAdminMessage"
    );

  if (!el) return;

  el.textContent = text;

  el.className =
    "message show " +
    type;

}


/* =========================================================
   PAGE NAVIGATION
========================================================= */

window.showPage = function(
  pageId
) {

  document
    .querySelectorAll(
      ".page"
    )
    .forEach(page => {

      page.classList.remove(
        "active"
      );

    });

  const page =
    document.getElementById(
      pageId
    );

  if (page)
    page.classList.add(
      "active"
    );

};


/* =========================================================
   FORM MESSAGE
========================================================= */

function showFormMessage(
  text,
  type
) {

  const el =
    document.getElementById(
      "formMessage"
    );

  if (!el) return;

  el.textContent = text;

  el.className =
    "message show " +
    type;

}


/* =========================================================
   HELPERS
========================================================= */

function escapeHtml(value) {

  return String(
    value ?? ""
  )
  .replaceAll("&","&amp;")
  .replaceAll("<","&lt;")
  .replaceAll(">","&gt;")
  .replaceAll('"',"&quot;")
  .replaceAll("'","&#039;");

}


function escapeJs(value) {

  return String(
    value ?? ""
  )
  .replaceAll("\\","\\\\")
  .replaceAll("'","\\'");

}


function safeFirebaseKey(value) {

  return String(
    value
  )
  .trim()
  .replace(/[.#$/\[\]]/g,"_");

}


function formatNumber(value) {

  const n =
    Number(value);

  if (
    Number.isNaN(n)
  )
    return "";

  return n.toLocaleString(
    undefined,
    {
      maximumFractionDigits:2
    }
  );

}


/* =========================================================
   INITIAL UI
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    populateCategorySelectors();

    populateStoreSelectors();

    renderItems();

  }
);
