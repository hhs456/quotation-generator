/*
 * 大毛小毛火鍋料估價單產生器 — 常量、純工具、儲存層讀寫、IndexedDB handle 記憶
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
   core.js — 常量、純工具、儲存層讀寫、IndexedDB handle 記憶
   載入順序第 1 棒：不依賴其他檔。
   ========================================================================== */

const APP_VERSION = '0.2.0';

const STORAGE_KEYS = {
    products: 'quotation_products_v6',
    units: 'quotation_units_v1',
    clients: 'quotation_clients_v1',
    clientPrices: 'quotation_client_prices_v1',
    history: 'quotation_history_list_v4',
    seq: 'quotation_invoice_seq',
    current: 'quotation_current_state_v4',
    backup: 'quotation_file_backup_v1'
};

const DEFAULT_UNITS = ['斤', '包', '個', '箱', '盒', '台斤', '公斤'];
const DEFAULT_PRODUCTS = { '凍豆腐': { price: 42, unit: '斤' } };
const SEQ_BASE = 4183;
const SAVE_DEBOUNCE_MS = 400;

let globalFileHandle = null;
let rememberedHandle = null;
let lastFileData = null;
let hasWarnedUnlinked = false;
let saveTimer = null;
let writing = false;
let writeAgain = false;

/* ------------------------------ 純工具 ------------------------------ */

function esc(value) {
    if (value === undefined || value === null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function rocDate(date) {
    let d = date instanceof Date ? date : new Date();
    return (d.getFullYear() - 1911) + '年 ' + (d.getMonth() + 1) + '月 ' + d.getDate() + '日';
}

function isEmptyStore(raw) {
    if (raw === null || raw === undefined) return true;
    let t = String(raw).trim();
    return t === '' || t === '{}' || t === '[]' || t === 'null';
}

function roundAmount(qty, price) {
    let q = parseFloat(qty);
    let p = parseFloat(price);
    if (isNaN(q) || isNaN(p)) return '';
    if (q <= 0 || p < 0) return '';
    return Math.round(q * p);
}

function supportsFileSystemAccess() {
    return typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function';
}

/* --------------------------- localStorage 讀寫 --------------------------- */

function readRaw(key) {
    let raw = localStorage.getItem(key);
    return raw === '' ? null : raw;
}

function readJSON(key, fallback) {
    let raw = localStorage.getItem(key);
    if (raw === null || raw === '') return fallback;
    try {
        return JSON.parse(raw);
    } catch (e) {
        console.error('讀取暫存資料失敗', key, e);
        return fallback;
    }
}

function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

/* ------------------------------ 資料庫存取 ------------------------------ */

function getUnitDB() {
    let saved = readRaw(STORAGE_KEYS.units);
    if (saved === null) {
        writeJSON(STORAGE_KEYS.units, DEFAULT_UNITS);
        return DEFAULT_UNITS.slice();
    }
    let units = readJSON(STORAGE_KEYS.units, null);
    if (!Array.isArray(units) || units.length === 0) {
        writeJSON(STORAGE_KEYS.units, DEFAULT_UNITS);
        return DEFAULT_UNITS.slice();
    }
    return units;
}

function setUnitDB(units) {
    writeJSON(STORAGE_KEYS.units, units);
}

function getProductDB() {
    let saved = readRaw(STORAGE_KEYS.products);
    if (saved === null) {
        writeJSON(STORAGE_KEYS.products, DEFAULT_PRODUCTS);
        return JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));
    }
    let db = readJSON(STORAGE_KEYS.products, null);
    if (!db || typeof db !== 'object' || Array.isArray(db)) {
        writeJSON(STORAGE_KEYS.products, DEFAULT_PRODUCTS);
        return JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));
    }
    return db;
}

function setProductDB(db) {
    writeJSON(STORAGE_KEYS.products, db);
}

function getClientPricesDB() {
    let db = readJSON(STORAGE_KEYS.clientPrices, null);
    if (!db || typeof db !== 'object' || Array.isArray(db)) return {};
    return db;
}

function setClientPricesDB(db) {
    writeJSON(STORAGE_KEYS.clientPrices, db);
}

/*
 * 客戶清單是「獨立資料」，不再是 clientPrices 的副產品。
 * 舊資料（沒有 quotation_clients_v1）自動從 clientPrices 的 keys 遷移，
 * 遷移後會寫回，之後使用者刪掉的客戶不會再長回來。
 */
function getClientsDB() {
    let saved = readRaw(STORAGE_KEYS.clients);
    if (saved !== null) {
        let list = readJSON(STORAGE_KEYS.clients, null);
        if (Array.isArray(list)) {
            return list.filter(name => typeof name === 'string' && name.trim() !== '');
        }
    }
    let migrated = Array.from(new Set(Object.keys(getClientPricesDB())));
    writeJSON(STORAGE_KEYS.clients, migrated);
    return migrated;
}

function setClientsDB(list) {
    writeJSON(STORAGE_KEYS.clients, Array.from(new Set(list)));
}

function getHistoryList() {
    let list = readJSON(STORAGE_KEYS.history, null);
    return Array.isArray(list) ? list : [];
}

function setHistoryList(list) {
    writeJSON(STORAGE_KEYS.history, list);
}

function getProductPriceForClient(productName, clientName) {
    if (clientName) {
        let clientPrices = getClientPricesDB();
        let custom = clientPrices[clientName] ? clientPrices[clientName][productName] : undefined;
        if (custom !== undefined && custom !== null && custom !== '' && !isNaN(parseFloat(custom))) {
            return parseFloat(custom);
        }
    }
    let db = getProductDB();
    if (db[productName] && db[productName].price !== undefined) {
        return db[productName].price;
    }
    return 0;
}

/* ------------------------- IndexedDB：記憶檔案位置 ------------------------- */

function openIDB() {
    return new Promise((resolve, reject) => {
        let request = indexedDB.open("QuotationAppDB", 1);
        request.onupgradeneeded = e => {
            let db = e.target.result;
            if (!db.objectStoreNames.contains("handles")) {
                db.createObjectStore("handles");
            }
        };
        request.onsuccess = e => resolve(e.target.result);
        request.onerror = e => reject(e.target.error);
    });
}

async function saveHandleToIDB(handle) {
    let db = await openIDB();
    return new Promise((resolve, reject) => {
        let tx = db.transaction("handles", "readwrite");
        let store = tx.objectStore("handles");
        store.put(handle, "savedFileHandle");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function loadHandleFromIDB() {
    let db = await openIDB();
    return new Promise((resolve, reject) => {
        let tx = db.transaction("handles", "readonly");
        let store = tx.objectStore("handles");
        let req = store.get("savedFileHandle");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/* ------------------------------ 狀態列顯示 ------------------------------ */

const STATUS_PALETTE = {
    ok: { bg: '#eef2f7', border: '#bce8f1', color: '#5cb85c' },
    warn: { bg: '#fcf8e3', border: '#faebcc', color: '#8a6d3b' },
    error: { bg: '#f2dede', border: '#ebccd1', color: '#c9302c' },
    info: { bg: '#f4f4f9', border: '#dddddd', color: '#555555' }
};

function setSaveStatus(kind, title, detailHtml) {
    let s = STATUS_PALETTE[kind] || STATUS_PALETTE.info;
    let bar = document.getElementById('statusBar');
    bar.style.backgroundColor = s.bg;
    bar.style.borderColor = s.border;
    document.getElementById('statusTitle').textContent = title;
    let text = document.getElementById('fileStatusText');
    text.innerHTML = detailHtml;
    text.style.color = s.color;
}

function setElementText(id, value) {
    let el = document.getElementById(id);
    if (el) el.value = value;
}

function getElementText(id) {
    let el = document.getElementById(id);
    return el ? el.value : '';
}

/* ------------------------------ 全域動作入口 ------------------------------ */

function handleUserAction() {
    updateClientDatalist();
    scheduleSave();
    warnUnlinkedOnce();
}

function warnUnlinkedOnce() {
    if (!globalFileHandle && !rememberedHandle && !hasWarnedUnlinked) {
        hasWarnedUnlinked = true;
        alert('⚠️ 溫馨提醒：\n目前尚未啟用本機自動存檔！\n修改的資料僅暫存在瀏覽器中。請點擊狀態列的「建立自動存檔檔案」，才能直接存入本機磁碟。');
    }
}
