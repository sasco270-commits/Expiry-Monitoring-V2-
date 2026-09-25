import {
 initializeApp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";

import {
 getDatabase,
 ref,
 get,
 set,
 update,
 remove,
 push,
 onValue
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";

import {
 getAuth,
 signInAnonymously,
 signInWithEmailAndPassword,
 signOut,
 onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";


/* =========================================================
 FIREBASE
========================================================= */

const firebaseConfig = {
 apiKey:"AIzaSyDXTkoz1xSpsWYuMV-Wvm57TF0ajj0p9M9",
 authDomain:"expiry-monitoring-v2.firebaseapp.com",
 projectId:"expiry-monitoring-v2",
 storageBucket:"expiry-monitoring-v2.firebasestorage.app",
 messagingSenderId:"722745088244",
 appId:"1:722745088244:web:17a4f2854a98ee6f6366a1",
 measurementId:"G-YPXSVPRK36",
 databaseURL:"https://expiry-monitoring-v2-default-rtdb.firebaseio.com"
};

const app=initializeApp(firebaseConfig);
const db=getDatabase(app);
const auth=getAuth(app);


/* =========================================================
 GLOBAL DATA
========================================================= */

let stores={};
let categories={};
let storeCategories={};
let products=[];
let productMap={};
let submissions={};

let currentStore=null;
let currentProduct=null;
let currentItems=[];

let adminUser=null;


/* =========================================================
 AUTH
========================================================= */

signInAnonymously(auth).catch(error=>{
 console.error("Anonymous login:",error);
});


onAuthStateChanged(auth,user=>{

 if(!user){
  setStatus("Not Connected","err");
  return;
 }

 if(user.isAnonymous){

  setStatus("Firebase Connected","ok");

  startRealtime();

 }

});


function setStatus(text,type){

 const el=document.getElementById("firebaseStatus");

 if(!el)return;

 el.textContent=text;
 el.className="status "+type;

}


/* =========================================================
 REALTIME FIREBASE
========================================================= */

function startRealtime(){

 onValue(
  ref(db,"storeMaster"),
  snap=>{
   stores=snap.val()||{};
   renderStoreTable();
   populateStoreSelector();
   updateCounts();
  }
 );


 onValue(
  ref(db,"categories"),
  snap=>{
   categories=snap.val()||{};
   renderCategoryTable();
   populateCategorySelectors();
   renderStoreCategoryChecks();
   updateCounts();
  }
 );


 onValue(
  ref(db,"storeCategories"),
  snap=>{
   storeCategories=snap.val()||{};
   renderStoreCategoryChecks();
  }
 );


 onValue(
  ref(db,"Data"),
  snap=>{
   processData(snap.val()||{});
   renderDataTable();
   updateCounts();
  }
 );


 onValue(
  ref(db,"expiryMonitoring/submissions"),
  snap=>{
   submissions=snap.val()||{};
   updateCounts();
  }
 );

}


/* =========================================================
 DATA PROCESSOR
========================================================= */

function processData(data){

 products=[];
 productMap={};

 /*
 Existing structure:
 Data
   headers
     0 SKU
     1 Barcodes
     ...
 */

 let headers=
  Array.isArray(data.headers)
   ? data.headers
   : [];


 /*
 Direct /Data/items structure
 */

 if(
  data.items &&
  typeof data.items==="object"
 ){

  Object.entries(data.items)
   .forEach(([id,item])=>{

    if(!item)return;

    const product={
     ...item,
     _id:id
    };

    products.push(product);

    indexProduct(product);

   });

 }


 /*
 Other records directly under /Data
 */

 Object.entries(data)
  .forEach(([key,value])=>{

   if(key==="headers"||key==="items")
    return;

   if(!value)
    return;

   if(Array.isArray(value)){

    const product=
     rowToProduct(value,headers);

    if(product){

     product._id=key;

     products.push(product);

     indexProduct(product);

    }

   }
   else if(
    typeof value==="object"
   ){

    if(
     value.SKU ||
     value.sku ||
     value.Barcodes ||
     value.Barcode
    ){

     const product={
      ...value,
      _id:key
     };

     products.push(product);

     indexProduct(product);

    }

   }

  });

}


function rowToProduct(row,headers){

 if(!headers.length)
  return null;

 const item={};

 headers.forEach(
  (header,index)=>{
   item[String(header)]=row[index];
  }
 );

 return item;

}


function indexProduct(item){

 const sku=
  String(
   item.SKU||
   item.sku||
   ""
  ).trim().toLowerCase();

 const barcode=
  String(
   item.Barcodes||
   item.Barcode||
   item.barcode||
   ""
  ).trim().toLowerCase();

 if(sku)
  productMap["sku:"+sku]=item;

 barcode
  .split(/[,;|\/]+/)
  .map(x=>x.trim())
  .filter(Boolean)
  .forEach(x=>{
   productMap["barcode:"+x]=item;
  });

}


/* =========================================================
 STORE LOOKUP
========================================================= */

window.lookupStore=function(){

 const code=
  document.getElementById("storeCode")
   .value
   .trim();

 if(!code){

  clearStore();

  return;

 }

 const store=findStore(code);

 if(!store){

  clearStore();

  formMessage(
   "Store Code not found.",
   "error"
  );

  return;

 }

 currentStore=store;

 document.getElementById("storeName").value=
  store.storeName||
  store.name||
  "";

 document.getElementById("areaManager").value=
  store.areaManager||"";

 document.getElementById("operationManager").value=
  store.operationManager||"";

 populateStoreCategories(code);

};


function findStore(code){

 const wanted=
  String(code)
   .trim()
   .toUpperCase();

 if(stores[code])
  return normalizeStore(
   code,
   stores[code]
  );

 for(
  const key of Object.keys(stores)
 ){

  const s=stores[key]||{};

  const possible=
   String(
    s.storeCode||
    s.code||
    key
   )
   .trim()
   .toUpperCase();

  if(possible===wanted)
   return normalizeStore(
    key,
    s
   );

 }

 return null;

}


function normalizeStore(code,s){

 return{
  ...s,
  code,
  storeName:
   s.storeName||
   s.name||
   s.palmStore||
   code
 };

}


function clearStore(){

 currentStore=null;

 [
  "storeName",
  "areaManager",
  "operationManager"
 ].forEach(id=>{
  document.getElementById(id).value="";
 });

 document.getElementById(
  "category"
 ).innerHTML=
  '<option value="">Select Category</option>';

}


/* =========================================================
 STORE CATEGORY FILTER
========================================================= */

function populateStoreCategories(code){

 const select=
  document.getElementById("category");

 select.innerHTML=
  '<option value="">Select Category</option>';

 const assigned=
  storeCategories[code]||{};

 let count=0;

 Object.keys(assigned)
  .forEach(categoryKey=>{

   if(assigned[categoryKey]!==true)
    return;

   const category=
    categories[categoryKey];

   if(!category)
    return;

   const active=
    typeof category==="string"
     ? true
     : category.active!==false;

   if(!active)
    return;

   const name=
    typeof category==="string"
     ? category
     : category.name||categoryKey;

   const option=
    document.createElement("option");

   option.value=name;
   option.textContent=name;

   select.appendChild(option);

   count++;

  });

 if(!count){

  formMessage(
   "No category has been assigned to this store.",
   "error"
  );

 }

}


window.categoryChanged=function(){

 currentProduct=null;

 clearItemFields();

};


/* =========================================================
 ITEM LOOKUP
========================================================= */

window.lookupItem=function(){

 const value=
  document.getElementById(
   "barcodeInput"
  ).value
  .trim()
  .toLowerCase();

 if(!value){

  clearItemFields();

  return;

 }

 const product=
  productMap["sku:"+value]||
  productMap["barcode:"+value];

 if(!product){

  clearItemFields();

  itemMessage(
   "Item not found in Firebase Data.",
   "error"
  );

  return;

 }

 const selectedCategory=
  document.getElementById(
   "category"
  ).value
  .trim()
  .toLowerCase();

 const firebaseCategory=
  String(
   product.Category||
   product.category||
   ""
  )
  .trim()
  .toLowerCase();

 /*
 VERY IMPORTANT:
 Item must belong to selected category.
 */

 if(
  selectedCategory &&
  firebaseCategory!==selectedCategory
 ){

  currentProduct=null;

  clearItemFields();

  itemMessage(
   "ITEM NOT ALLOWED. Firebase category is '" +
   (product.Category||
    product.category||
    "")+
   "', but selected category is '" +
   document.getElementById(
    "category"
   ).value+
   "'.",
   "error"
  );

  return;

 }

 currentProduct=product;

 fillItemFields(product);

 itemMessage(
  "✓ Item found and category verified.",
  "success"
 );

};


function fillItemFields(p){

 document.getElementById("itemSku").value=
  p.SKU||p.sku||"";

 document.getElementById("itemName").value=
  p["EN Desc"]||
  p["Item Name"]||
  p.Description||
  "";

 document.getElementById("itemUom").value=
  p.UOM||"";

 document.getElementById("itemCost").value=
  p.Cost||"";

 document.getElementById("itemSupplier").value=
  p["Default Supplier"]||
  p.Supplier||
  "";

 document.getElementById("itemVendor").value=
  p["Vendor Code"]||
  p.VendorCode||
  "";

 document.getElementById("itemCategory").value=
  p.Category||
  p.category||
  "";

}


function clearItemFields(){

 [
  "itemSku",
  "itemName",
  "itemUom",
  "itemCost",
  "itemSupplier",
  "itemVendor",
  "itemCategory"
 ].forEach(id=>{
  document.getElementById(id).value="";
 });

}


window.barcodeEnter=function(e){

 if(e.key==="Enter"){

  e.preventDefault();

  lookupItem();

 }

};


/* =========================================================
 ADD ITEM
========================================================= */

window.addItem=function(){

 if(!currentStore){

  formMessage(
   "Enter a valid Store Code.",
   "error"
  );

  return;

 }

 if(
  !document.getElementById(
   "category"
  ).value
 ){

  formMessage(
   "Select Category.",
   "error"
  );

  return;

 }

 if(!currentProduct){

  itemMessage(
   "Enter a valid Barcode/SKU belonging to the selected category.",
   "error"
  );

  return;

 }

 const qty=
  Number(
   document.getElementById(
    "itemQty"
   ).value
  );

 const expiry=
  document.getElementById(
   "itemExpiry"
  ).value;

 if(!qty||qty<=0){

  itemMessage(
   "Enter Quantity.",
   "error"
  );

  return;

 }

 if(!expiry){

  itemMessage(
   "Enter Expiry Date.",
   "error"
  );

  return;

 }

 currentItems.push({

  sku:
   currentProduct.SKU||
   currentProduct.sku||
   "",

  barcode:
   currentProduct.Barcodes||
   currentProduct.Barcode||
   document.getElementById(
    "barcodeInput"
   ).value,

  itemName:
   currentProduct["EN Desc"]||
   currentProduct["Item Name"]||
   "",

  category:
   currentProduct.Category||
   currentProduct.category||
   "",

  uom:
   currentProduct.UOM||
   "",

  cost:
   Number(
    currentProduct.Cost||0
   ),

  quantity:qty,

  expiryDate:expiry,

  supplier:
   currentProduct["Default Supplier"]||
   "",

  vendorCode:
   currentProduct["Vendor Code"]||
   ""

 });

 renderItems();

 clearItem();

};


function renderItems(){

 const body=
  document.getElementById(
   "itemsBody"
  );

 body.innerHTML="";

 currentItems.forEach(
  (item,index)=>{

   const tr=
    document.createElement("tr");

   tr.innerHTML=`

   <td>${esc(item.sku)}</td>
   <td>${esc(item.barcode)}</td>
   <td>${esc(item.itemName)}</td>
   <td>${esc(item.category)}</td>
   <td>${esc(item.uom)}</td>
   <td>${esc(item.cost)}</td>
   <td>${esc(item.quantity)}</td>
   <td>${esc(item.expiryDate)}</td>

   <td>
   <button
    class="red"
    onclick="removeItem(${index})">
    Remove
   </button>
   </td>

   `;

   body.appendChild(tr);

  }
 );

}


window.removeItem=function(index){

 currentItems.splice(index,1);

 renderItems();

};


window.clearItem=function(){

 document.getElementById(
  "barcodeInput"
 ).value="";

 document.getElementById(
  "itemQty"
 ).value="";

 document.getElementById(
  "itemExpiry"
 ).value="";

 currentProduct=null;

 clearItemFields();

 document.getElementById(
  "itemMessage"
 ).className="message";

};


/* =========================================================
 SUBMIT / DRAFT
========================================================= */

window.saveDraft=async function(){

 if(!validateForm())
  return;

 try{

  const draft=
   push(
    ref(
     db,
     "expiryMonitoring/drafts"
    )
   );

  await set(
   draft,
   buildSubmission("DRAFT")
  );

  formMessage(
   "Draft saved successfully.",
   "success"
  );

 }catch(e){

  formMessage(
   e.message,
   "error"
  );

 }

};


window.submitExpiry=async function(){

 if(!validateForm())
  return;

 try{

  const record=
   push(
    ref(
     db,
     "expiryMonitoring/submissions"
    )
   );

  await set(
   record,
   buildSubmission("SUBMITTED")
  );

  currentItems=[];

  renderItems();

  formMessage(
   "Submission completed successfully.",
   "success"
  );

 }catch(e){

  formMessage(
   e.message,
   "error"
  );

 }

};


function validateForm(){

 if(!currentStore){

  formMessage(
   "Valid Store Code is required.",
   "error"
  );

  return false;

 }

 if(
  !document.getElementById(
   "category"
  ).value
 ){

  formMessage(
   "Category is required.",
   "error"
  );

  return false;

 }

 if(!currentItems.length){

  formMessage(
   "Add at least one item.",
   "error"
  );

  return false;

 }

 return true;

}


function buildSubmission(status){

 return{

  storeCode:currentStore.code,

  storeName:
   currentStore.storeName||"",

  areaManager:
   currentStore.areaManager||"",

  operationManager:
   currentStore.operationManager||"",

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

  source:"GitHub Firebase"

 };

}


/* =========================================================
 ADMIN LOGIN
========================================================= */

window.openAdminLogin=function(){

 showPage("adminLoginPage");

};


window.adminLogin=async function(){

 const email=
  document.getElementById(
   "adminEmail"
  ).value.trim();

 const password=
  document.getElementById(
   "adminPassword"
  ).value;

 if(!email||!password){

  loginMessage(
   "Enter admin email and password.",
   "error"
  );

  return;

 }

 try{

  const credential=
   await signInWithEmailAndPassword(
    auth,
    email,
    password
   );

  adminUser=credential.user;

  showPage("adminPage");

  loginMessage("","");

 }catch(e){

  loginMessage(
   e.message,
   "error"
  );

 }

};


window.adminLogout=async function(){

 await signOut(auth);

 adminUser=null;

 signInAnonymously(auth);

 showPage("homePage");

};


/* =========================================================
 ADMIN TABS
========================================================= */

window.openAdminTab=function(
 tab,
 button
){

 document
  .querySelectorAll(
   ".admin-section"
  )
  .forEach(x=>{
   x.classList.remove("active");
  });

 document
  .querySelectorAll(
   ".admin-tab"
  )
  .forEach(x=>{
   x.classList.remove("active");
  });

 const section=
  document.getElementById(
   "admin"+
   capitalize(tab)
  );

 if(section)
  section.classList.add("active");

 if(button)
  button.classList.add("active");

};


function capitalize(x){

 return x.charAt(0).toUpperCase()+
  x.slice(1);

}


/* =========================================================
 ADMIN STORE MANAGEMENT
========================================================= */

window.saveStore=async function(){

 if(!adminUser){

  alert("Admin login required.");

  return;

 }

 const code=
  document.getElementById(
   "adminStoreCode"
  ).value.trim();

 if(!code){

  alert("Store Code required.");

  return;

 }

 const store={

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
   ).value.trim(),

  active:true,

  updatedAt:
   new Date().toISOString()

 };

 await set(
  ref(
   db,
   "storeMaster/"+safeKey(code)
  ),
  store
 );

 clearStoreForm();

 alert("Store saved.");

};


window.editStore=function(code){

 const store=findStore(code);

 if(!store)return;

 document.getElementById(
  "adminStoreCode"
 ).value=code;

 document.getElementById(
  "adminStoreName"
 ).value=
  store.storeName||"";

 document.getElementById(
  "adminAreaManager"
 ).value=
  store.areaManager||"";

 document.getElementById(
  "adminOperationManager"
 ).value=
  store.operationManager||"";

 document.getElementById(
  "adminStoreEmail"
 ).value=
  store.email||"";

 document.getElementById(
  "adminClassification"
 ).value=
  store.classification||"";

};


window.deleteStore=async function(code){

 if(!confirm(
  "Delete Store "+code+"?"
 ))
 return;

 await remove(
  ref(
   db,
   "storeMaster/"+safeKey(code)
  )
 );

};


window.clearStoreForm=function(){

 [
  "adminStoreCode",
  "adminStoreName",
  "adminAreaManager",
  "adminOperationManager",
  "adminStoreEmail",
  "adminClassification"
 ].forEach(id=>{
  document.getElementById(id).value="";
 });

};


function renderStoreTable(){

 const body=
  document.getElementById(
   "storesTable"
  );

 if(!body)return;

 body.innerHTML="";

 Object.keys(stores)
  .sort()
  .forEach(code=>{

   const store=
    normalizeStore(
     code,
     stores[code]||{}
    );

   const tr=
    document.createElement("tr");

   tr.innerHTML=`

   <td>${esc(code)}</td>
   <td>${esc(store.storeName)}</td>
   <td>${esc(store.areaManager)}</td>
   <td>${esc(store.operationManager)}</td>
   <td>${esc(store.classification)}</td>

   <td>

   <button
    class="blue"
    onclick="editStore('${js(code)}')">
    Edit
   </button>

   <button
    class="red"
    onclick="deleteStore('${js(code)}')">
    Delete
   </button>

   </td>
   `;

   body.appendChild(tr);

  });

}


/* =========================================================
 CATEGORY MANAGEMENT
========================================================= */

window.saveCategory=async function(){

 if(!adminUser){

  alert("Admin login required.");

  return;

 }

 const name=
  document.getElementById(
   "adminCategoryName"
  ).value.trim();

 if(!name){

  alert("Enter category.");

  return;

 }

 const key=
  safeKey(name);

 await set(
  ref(
   db,
   "categories/"+key
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
 ).value="";

};


window.deleteCategory=async function(key){

 if(!confirm(
  "Delete this category?"
 ))
 return;

 await remove(
  ref(
   db,
   "categories/"+key
  )
 );

};


function renderCategoryTable(){

 const body=
  document.getElementById(
   "categoriesTable"
  );

 if(!body)return;

 body.innerHTML="";

 Object.keys(categories)
  .sort()
  .forEach(key=>{

   const c=
    categories[key];

   const name=
    typeof c==="string"
     ? c
     : c.name||key;

   const active=
    typeof c==="string"
     ? true
     : c.active!==false;

   const tr=
    document.createElement("tr");

   tr.innerHTML=`

   <td>${esc(name)}</td>

   <td>
   <span class="badge">
   ${active?"Active":"Inactive"}
   </span>
   </td>

   <td>

   <button
    class="red"
    onclick="deleteCategory('${js(key)}')">
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

function populateStoreSelector(){

 const select=
  document.getElementById(
   "assignmentStore"
  );

 if(!select)return;

 const current=
  select.value;

 select.innerHTML=
  '<option value="">Select Store</option>';

 Object.keys(stores)
  .sort()
  .forEach(code=>{

   const store=
    findStore(code);

   const option=
    document.createElement(
     "option"
    );

   option.value=code;

   option.textContent=
    code+
    " - "+
    (store?.storeName||"");

   select.appendChild(option);

  });

 if(current)
  select.value=current;

}


window.renderStoreCategoryChecks=function(){

 const container=
  document.getElementById(
   "categoryChecks"
  );

 const storeCode=
  document.getElementById(
   "assignmentStore"
  )?.value;

 if(!container)return;

 if(!storeCode){

  container.innerHTML=
   "Select Store.";

  return;

 }

 const assigned=
  storeCategories[storeCode]||{};

 container.innerHTML="";

 Object.keys(categories)
  .sort()
  .forEach(key=>{

   const c=
    categories[key];

   const name=
    typeof c==="string"
     ? c
     : c.name||key;

   const active=
    typeof c==="string"
     ? true
     : c.active!==false;

   if(!active)return;

   const row=
    document.createElement("label");

   row.className=
    "checkbox-row";

   row.innerHTML=`

   <input
    type="checkbox"
    class="store-category-check"
    value="${esc(key)}"
    ${assigned[key]===true?"checked":""}>

   <span>
   ${esc(name)}
   </span>

   `;

   container.appendChild(row);

  });

};


window.saveStoreCategories=async function(){

 if(!adminUser){

  alert("Admin login required.");

  return;

 }

 const storeCode=
  document.getElementById(
   "assignmentStore"
  ).value;

 if(!storeCode){

  alert("Select Store.");

  return;

 }

 const selected={};

 document
  .querySelectorAll(
   ".store-category-check:checked"
  )
  .forEach(cb=>{

   selected[
    cb.value
   ]=true;

  });

 await set(
  ref(
   db,
   "storeCategories/"+safeKey(storeCode)
  ),
  selected
 );

 alert(
  "Store categories updated."
 );

};


/* =========================================================
 ADMIN DATA MASTER
========================================================= */

window.saveDataItem=async function(){

 if(!adminUser){

  alert("Admin login required.");

  return;

 }

 const sku=
  document.getElementById(
   "dataSku"
  ).value.trim();

 if(!sku){

  alert("SKU is required.");

  return;

 }

 const id=
  safeKey(sku);

 const item={

  SKU:sku,

  Barcodes:
   document.getElementById(
    "dataBarcode"
   ).value.trim(),

  UOM:
   document.getElementById(
    "dataUom"
   ).value.trim(),

  "EN Desc":
   document.getElementById(
    "dataDesc"
   ).value.trim(),

  Cost:
   Number(
    document.getElementById(
     "dataCost"
    ).value||0
   ),

  "Default Supplier":
   document.getElementById(
    "dataSupplier"
   ).value.trim(),

  "Vendor Code":
   document.getElementById(
    "dataVendor"
   ).value.trim(),

  Category:
   document.getElementById(
    "dataCategory"
   ).value,

  "Non - Returnable & Returnable":
   document.getElementById(
    "dataReturnable"
   ).value.trim(),

  Qty:
   Number(
    document.getElementById(
     "dataQty"
    ).value||0
   ),

  updatedAt:
   new Date().toISOString()

 };

 await set(
  ref(
   db,
   "Data/items/"+id
  ),
  item
 );

 clearDataForm();

 alert(
  "Item saved to Firebase /Data."
 );

};


window.editDataItem=function(id){

 const item=
  products.find(
   x=>x._id===id
  );

 if(!item)return;

 document.getElementById(
  "dataSku"
 ).value=
  item.SKU||"";

 document.getElementById(
  "dataBarcode"
 ).value=
  item.Barcodes||
  item.Barcode||
  "";

 document.getElementById(
  "dataUom"
 ).value=
  item.UOM||"";

 document.getElementById(
  "dataDesc"
 ).value=
  item["EN Desc"]||
  "";

 document.getElementById(
  "dataCost"
 ).value=
  item.Cost||
  "";

 document.getElementById(
  "dataSupplier"
 ).value=
  item["Default Supplier"]||
  "";

 document.getElementById(
  "dataVendor"
 ).value=
  item["Vendor Code"]||
  "";

 document.getElementById(
  "dataCategory"
 ).value=
  item.Category||
  "";

 document.getElementById(
  "dataReturnable"
 ).value=
  item[
   "Non - Returnable & Returnable"
  ]||
  "";

 document.getElementById(
  "dataQty"
 ).value=
  item.Qty||
  "";

};


window.deleteDataItem=async function(id){

 if(!confirm(
  "Delete this item?"
 ))
 return;

 await remove(
  ref(
   db,
   "Data/items/"+id
  )
 );

};


window.clearDataForm=function(){

 [
  "dataSku",
  "dataBarcode",
  "dataUom",
  "dataDesc",
  "dataCost",
  "dataSupplier",
  "dataVendor",
  "dataReturnable",
  "dataQty"
 ].forEach(id=>{
  document.getElementById(id).value="";
 });

 document.getElementById(
  "dataCategory"
 ).value="";

};


/* =========================================================
 DATA TABLE
========================================================= */

window.renderDataTable=function(){

 const body=
  document.getElementById(
   "dataTable"
  );

 if(!body)return;

 const search=
  document.getElementById(
   "dataSearch"
  )
  .value
  .trim()
  .toLowerCase();

 body.innerHTML="";

 let count=0;

 products.forEach(item=>{

  if(count>=500)return;

  const text=
   JSON.stringify(item)
    .toLowerCase();

  if(
   search &&
   !text.includes(search)
  )
   return;

  const tr=
   document.createElement("tr");

  tr.innerHTML=`

  <td>${esc(item.SKU||"")}</td>

  <td>
  ${esc(
   item.Barcodes||
   item.Barcode||
   ""
  )}
  </td>

  <td>
  ${esc(
   item["EN Desc"]||
   ""
  )}
  </td>

  <td>${esc(item.UOM||"")}</td>

  <td>${esc(item.Cost||"")}</td>

  <td>
  ${esc(
   item["Default Supplier"]||
   ""
  )}
  </td>

  <td>
  ${esc(
   item["Vendor Code"]||
   ""
  )}
  </td>

  <td>
  <span class="badge">
  ${esc(
   item.Category||
   ""
  )}
  </span>
  </td>

  <td>

  ${
   item._id
    ? `
    <button
     class="blue"
     onclick="editDataItem('${js(item._id)}')">
     Edit
    </button>

    <button
     class="red"
     onclick="deleteDataItem('${js(item._id)}')">
     Delete
    </button>
    `
    : ""
  }

  </td>

  `;

  body.appendChild(tr);

  count++;

 });

};


/* =========================================================
 CATEGORY SELECT FOR ITEM ADMIN
========================================================= */

function populateCategorySelectors(){

 const select=
  document.getElementById(
   "dataCategory"
  );

 if(!select)return;

 const current=
  select.value;

 select.innerHTML=
  '<option value="">Select Category</option>';

 Object.keys(categories)
  .sort()
  .forEach(key=>{

   const c=
    categories[key];

   const name=
    typeof c==="string"
     ? c
     : c.name||key;

   const active=
    typeof c==="string"
     ? true
     : c.active!==false;

   if(!active)return;

   const option=
    document.createElement(
     "option"
    );

   option.value=name;
   option.textContent=name;

   select.appendChild(option);

  });

 if(current)
  select.value=current;

}


/* =========================================================
 COUNTERS
========================================================= */

function updateCounts(){

 const a=
  document.getElementById(
   "storeCount"
  );

 const b=
  document.getElementById(
   "categoryCount"
  );

 const c=
  document.getElementById(
   "productCount"
  );

 const d=
  document.getElementById(
   "submissionCount"
  );

 if(a)
  a.textContent=
   Object.keys(stores).length;

 if(b)
  b.textContent=
   Object.keys(categories).length;

 if(c)
  c.textContent=
   products.length;

 if(d)
  d.textContent=
   Object.keys(submissions).length;

}


/* =========================================================
 NAVIGATION
========================================================= */

window.showPage=function(id){

 document
  .querySelectorAll(".page")
  .forEach(page=>{
   page.classList.remove("active");
  });

 const page=
  document.getElementById(id);

 if(page)
  page.classList.add("active");

};


function formMessage(text,type){

 const el=
  document.getElementById(
   "formMessage"
  );

 el.textContent=text;

 el.className=
  "message show "+type;

}


function itemMessage(text,type){

 const el=
  document.getElementById(
   "itemMessage"
  );

 el.textContent=text;

 el.className=
  "message show "+type;

}


function loginMessage(text,type){

 const el=
  document.getElementById(
   "loginMessage"
  );

 el.textContent=text;

 el.className=
  "message "+
  (type ? "show "+type : "");

}


/* =========================================================
 HELPERS
========================================================= */

function safeKey(value){

 return String(value)
  .trim()
  .replace(/[.#$/\[\]]/g,"_")
  .replace(/\s+/g,"_");

}


function esc(value){

 return String(
  value??""
 )
 .replaceAll("&","&amp;")
 .replaceAll("<","&lt;")
 .replaceAll(">","&gt;")
 .replaceAll('"',"&quot;")
 .replaceAll("'","&#039;");

}


function js(value){

 return String(
  value??""
 )
 .replaceAll("\\","\\\\")
 .replaceAll("'","\\'");

}
