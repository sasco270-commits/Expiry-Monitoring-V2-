import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getDatabase, ref, set, push, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";

const firebaseConfig = {
  "apiKey": "AIzaSyDXTkoz1xSpsWYuMUw-Vvm57TF0ajj0p9M9",
  "authDomain": "expiry-monitoring-v2.firebaseapp.com",
  "projectId": "expiry-monitoring-v2",
  "storageBucket": "expiry-monitoring-v2.firebasestorage.app",
  "messagingSenderId": "722745088244",
  "appId": "1:722745088244:web:17a4f2854a98ee6f6366a1",
  "measurementId": "G-YPXSVPRK36",
  "databaseURL": "https://expiry-monitoring-v2-default-rtdb.firebaseio.com"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
let currentUser = null;

const $ = id => document.getElementById(id);
function status(msg, ok=true) {
  const el=$("status"); el.style.display="block"; el.className=ok?"ok":"err"; el.textContent=msg;
}
function val(id) { return $(id).value.trim(); }
function addRow(data={}) {
  const tr=document.createElement("tr");
  tr.innerHTML=`<td><input class="sku" value="${data.sku||""}" placeholder="SKU"></td>
  <td><input class="itemName" value="${data.itemName||""}" placeholder="Item name"></td>
  <td><input class="qty" type="number" min="0" step="1" value="${data.quantity??""}" placeholder="Qty"></td>
  <td><input class="expiryDate" type="date" value="${data.expiryDate||""}"></td>
  <td><button class="remove" type="button">Remove</button></td>`;
  tr.querySelector(".remove").onclick=()=>tr.remove();
  $("rows").appendChild(tr);
}
function getItems() {
  return [...document.querySelectorAll("#rows tr")].map(tr=>({
    sku:tr.querySelector(".sku").value.trim(),
    itemName:tr.querySelector(".itemName").value.trim(),
    quantity:Number(tr.querySelector(".qty").value||0),
    expiryDate:tr.querySelector(".expiryDate").value
  })).filter(x=>x.sku||x.itemName||x.quantity||x.expiryDate);
}
function baseData() {
  return {
    storeCode:val("storeCode"), storeName:val("storeName"), areaManager:val("areaManager"),
    operationManager:val("operationManager"), category:val("category"),
    cycleStart:val("cycleStart"), cycleEnd:val("cycleEnd"), items:getItems()
  };
}
function validate(d) {
  if(!d.storeCode||!d.category||!d.cycleStart||!d.cycleEnd) throw new Error("Store Code, Category, Cycle Start and Cycle End are required.");
  if(d.cycleEnd<d.cycleStart) throw new Error("Cycle End cannot be before Cycle Start.");
  if(!d.items.length) throw new Error("Add at least one expiry item.");
}
async function saveDraft() {
  try {
    const d=baseData(); validate(d);
    if(!currentUser) throw new Error("Firebase authentication is not ready.");
    const draftId=`${d.storeCode}__${d.category}__${d.cycleStart}__${d.cycleEnd}`.replace(/[.#$\[\]/]/g,"_");
    await set(ref(db,`expiryMonitoring/drafts/${draftId}`),{...d,status:"DRAFT",updatedAt:serverTimestamp(),userId:currentUser.uid});
    status("Draft saved successfully.");
  } catch(e) { status(e.message,false); }
}
async function submitForm() {
  try {
    const d=baseData(); validate(d);
    if(!currentUser) throw new Error("Firebase authentication is not ready.");
    const submission=push(ref(db,"expiryMonitoring/submissions"));
    await set(submission,{...d,status:"SUBMITTED",submittedAt:serverTimestamp(),userId:currentUser.uid});
    const draftId=`${d.storeCode}__${d.category}__${d.cycleStart}__${d.cycleEnd}`.replace(/[.#$\[\]/]/g,"_");
    await set(ref(db,`expiryMonitoring/drafts/${draftId}`),null);
    status("Submitted successfully. Submission ID: "+submission.key);
  } catch(e) { status(e.message,false); }
}
window.addRow=addRow; window.saveDraft=saveDraft; window.submitForm=submitForm;
addRow();
signInAnonymously(auth).then(c=>{currentUser=c.user;$("authStatus").textContent="Firebase connected";})
.catch(e=>{console.error(e);$("authStatus").textContent="Firebase authentication error";status("Enable Anonymous Authentication in Firebase Console before submitting.",false);});
