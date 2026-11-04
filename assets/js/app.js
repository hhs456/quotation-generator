/*
 * 大毛小毛火鍋料估價單產生器 — datalist 同步、事件綁定、啟動流程
 * Copyright (C) 2026 Hanson
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public
 * License along with this program.  If not, see
 * <http://www.gnu.org/licenses/>.
 */
'use strict';

/* ==========================================================================
   app.js — datalist 同步、事件綁定、啟動流程
   載入順序第 9 棒（最後）：依賴前面所有檔。
   ========================================================================== */

function updateUnitDatalist() {
    let datalist = document.getElementById('unitList');
    if (!datalist) return;
    datalist.innerHTML = '';
    getUnitDB().forEach(u => {
        let option = document.createElement('option');
        option.value = u;
        datalist.appendChild(option);
    });
}

function updateProductDatalist() {
    let datalist = document.getElementById('productList');
    if (!datalist) return;
    datalist.innerHTML = '';
    let db = getProductDB();
    for (let name in db) {
        let option = document.createElement('option');
        option.value = name;
        datalist.appendChild(option);
    }
}

/*
 * 買受人輸入框的自動完成：正式客戶名單 ∪ 目前輸入的文字。
 * selectedClientSelect（客戶管理彈窗）只用正式名單，所以刪掉的客戶
 * 不會像以前那樣被硬編碼回填，也不會因為打過一次就變成「刪不掉」的幽靈客戶。
 */
function updateClientDatalist() {
    let clients = getClientsDB();
    let clientSet = new Set(clients);

    let datalist = document.getElementById('clientList');
    if (datalist) {
        datalist.innerHTML = '';
        let autocomplete = new Set(clientSet);
        let currentBuyer = getElementText('buyer').trim();
        if (currentBuyer) autocomplete.add(currentBuyer);
        autocomplete.forEach(c => {
            let option = document.createElement('option');
            option.value = c;
            datalist.appendChild(option);
        });
    }

    let select = document.getElementById('selectedClientSelect');
    if (!select) return;
    let currentSelected = select.value;
    select.innerHTML = '';
    clients.forEach(c => {
        let opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });
    if (clientSet.has(currentSelected)) {
        select.value = currentSelected;
    } else if (clients.length > 0) {
        select.value = clients[0];
    }
}

function updateDatalist() {
    updateProductDatalist();
    updateClientDatalist();
}

/* 買受人變更（離開焦點 / Enter）或按下重新套用按鈕時，才依專屬價重算全單價 */
function onBuyerChange() {
    let buyer = getElementText('buyer').trim();
    document.querySelectorAll('#itemTableBody tr').forEach(tr => {
        let nameInput = tr.querySelector('.item-name');
        let priceInput = tr.querySelector('.item-price');
        if (!nameInput || !priceInput) return;
        let productName = nameInput.value.trim();
        if (!productName) return;
        priceInput.value = getProductPriceForClient(productName, buyer);
        updateRowAmount(tr);
    });
    handleUserAction();
}

/* ------------------------------ 事件委派 ------------------------------ */

const DELEGATED_CLICKS = {
    'delete-row': btn => deleteRow(btn.closest('tr')),
    'load-history': btn => loadHistoryItem(btn.dataset.id),
    'delete-history': btn => deleteHistoryItem(btn.dataset.id),
    'delete-unit': btn => deleteUnit(btn.dataset.unit),
    'delete-product': btn => deleteMemoryItem(btn.dataset.name),
    'delete-client-price': btn => deleteClientCustomPrice(btn.dataset.client, btn.dataset.product),
    'delete-client': () => deleteClient(getClientSelectValue()),
    'report-preset': btn => applyReportPreset(btn.dataset.preset),
    'close-modal': btn => {
        let target = btn.dataset.target;
        if (target === 'memoryModal') closeMemoryModal();
        else if (target === 'clientModal') closeClientModal();
        else closeModal(target);
    }
};

const DELEGATED_FIELDS = {
    'product-unit': el => updateMemoryData(el.dataset.name, 'unit', el.value),
    'product-price': el => updateMemoryData(el.dataset.name, 'price', el.value),
    'client-price': el => updateClientCustomPrice(el.dataset.client, el.dataset.product, el.value)
};

document.addEventListener('click', function (e) {
    let btn = e.target.closest('button[data-action]');
    if (!btn) return;
    let handler = DELEGATED_CLICKS[btn.dataset.action];
    if (handler) handler(btn);
});

document.addEventListener('change', function (e) {
    let el = e.target.closest('[data-field]');
    if (!el) return;
    let handler = DELEGATED_FIELDS[el.dataset.field];
    if (handler) handler(el);
});

/* ------------------------------ 靜態綁定 ------------------------------ */

const STATIC_BINDINGS = {
    reconnectBtn: reconnectLocalFile,
    restoreBtn: restoreFileBackup,
    linkFileBtn: linkLocalFile,
    openFileBtn: openLocalFile,
    reapplyPriceBtn: onBuyerChange,
    newInvoiceBtn: createNewInvoice,
    addRowBtn: function () { addRow(); handleUserAction(); },
    saveHistoryBtn: saveToHistory,
    openHistoryBtn: openHistoryModal,
    openMemoryBtn: openMemoryModal,
    openClientBtn: openClientModal,
    openReportBtn: openReportModal,
    printReportBtn: printReport,
    printBtn: validateAndPrint,
    addUnitBtn: addNewUnit,
    addProductBtn: addNewMemoryItem,
    addClientBtn: addNewClient,
    deleteClientBtn: function () { deleteClient(getClientSelectValue()); },
    clearClientBtn: deleteClientPricing,
    addClientPriceBtn: addCustomPriceForClient
};

function bindStaticButtons() {
    Object.keys(STATIC_BINDINGS).forEach(id => {
        let el = document.getElementById(id);
        if (el) el.addEventListener('click', STATIC_BINDINGS[id]);
    });

    let select = document.getElementById('selectedClientSelect');
    if (select) select.addEventListener('change', renderClientPricingTable);

    let shopName = document.getElementById('shopNameInput');
    if (shopName) shopName.addEventListener('change', function () {
        shopName.value = setShopName(shopName.value);
    });

    let reportClient = document.getElementById('reportClientSelect');
    if (reportClient) reportClient.addEventListener('change', renderReport);
    ['reportFrom', 'reportTo'].forEach(id => {
        let el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', function () {
            markReportPreset('');
            renderReport();
        });
    });

    ['buyer', 'invoiceNo', 'invoiceDate'].forEach(id => {
        let el = document.getElementById(id);
        if (el) el.addEventListener('input', handleUserAction);
    });
    let buyerEl = document.getElementById('buyer');
    if (buyerEl) buyerEl.addEventListener('change', onBuyerChange);
}

/*
 * 檔內欄位與 localStorage 鍵的對應若錯位（例如 STORAGE_KEYS 改名而對應表漏改），
 * 資料會被寫進錯誤的鍵而靜默遺失。啟動時先大聲確認，避免重蹈覆轍。
 */
function validateStoreMapping() {
    let missing = Object.keys(STORE_TO_KEY).filter(field => !STORE_TO_KEY[field]);
    if (missing.length === 0) return true;
    console.error('儲存欄位對應不完整', missing);
    alert('內部錯誤：儲存欄位對應不完整（' + missing.join(', ') + '），資料可能無法正確存檔，請更新檔案後再使用。');
    return false;
}

function initCompatNotice() {
    let notices = [];
    if (!supportsFileSystemAccess()) {
        notices.push('此瀏覽器不支援「本機檔案自動存檔」（File System Access API），資料只會存在瀏覽器的 localStorage 中。請改用 Chrome 或 Edge。');
    }
    if (window.location.protocol === 'file:') {
        notices.push('目前以 file:// 開啟：部分瀏覽器（Firefox、Safari）會封鎖此協定下的 IndexedDB，導致「記住檔案位置」失效。若重開頁面後需要重新選檔，屬正常現象。');
    }
    if (notices.length === 0) return;
    let el = document.getElementById('compatNotice');
    el.innerHTML = notices.map(n => `<div>⚠️ ${esc(n)}</div>`).join('');
    el.style.display = 'block';
}

function flushSaveOnExit() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    runSaveQueue();
}

window.addEventListener('pagehide', flushSaveOnExit);
window.addEventListener('beforeunload', flushSaveOnExit);

/* ------------------------------ 啟動 ------------------------------ */

window.addEventListener('DOMContentLoaded', async function () {
    let versionEl = document.getElementById('appVersion');
    if (versionEl) versionEl.textContent = 'v' + APP_VERSION;
    bindStaticButtons();
    if (!validateStoreMapping()) return;
    initCompatNotice();
    initPaperSelectors();
    applyDocumentTitle();
    getClientsDB();
    updateUnitDatalist();
    updateDatalist();

    try {
        let stored = await loadHandleFromIDB();
        if (stored) {
            rememberedHandle = stored;
            document.getElementById('reconnectBtn').style.display = 'inline-block';
            setSaveStatus('warn', '尚未啟用本機自動存檔：', `找到上次檔案 [<strong>${esc(stored.name)}</strong>]，請點擊右側「⚡ 啟用自動存檔」後才會開始寫入。`);
        }
    } catch (e) {
        console.error('讀取記憶的檔案位置失敗', e);
    }

    showRestoreButton(readRaw(STORAGE_KEYS.backup) !== null);
    renderCurrentState();
});
