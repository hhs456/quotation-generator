/*
 * 估價單產生器 — 常量、純工具、儲存層讀寫、IndexedDB handle 記憶
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
   載入順序第 2 棒：只依賴 branding.js（APP_NAME / SHOP_NAME /
   DEFAULT_UNITS / DEFAULT_PRODUCTS / SEQ_BASE 在那一支宣告，本檔不重複宣告）。
   ========================================================================== */

const APP_VERSION = '0.3.0';

const STORAGE_KEYS = {
    products: 'quotation_products_v6',
    units: 'quotation_units_v1',
    clients: 'quotation_clients_v1',
    clientPrices: 'quotation_client_prices_v1',
    history: 'quotation_history_list_v4',
    seq: 'quotation_invoice_seq',
    current: 'quotation_current_state_v4',
    backup: 'quotation_file_backup_v1',
    settings: 'quotation_settings_v1'
};

/* 品牌與預設值（APP_NAME / SHOP_NAME / DEFAULT_UNITS / DEFAULT_PRODUCTS /
   SEQ_BASE）一律在 branding.js 宣告，本檔不得重複宣告，否則串在同一
   global scope 下會讓整個 app 載入失敗。 */
const SAVE_DEBOUNCE_MS = 400;

/* 單號留空時存進歷史紀錄的哨兵值。invoice.js 寫入、report.js 判讀，兩端必須
   共用同一個常數：它曾被直接拿去當去重鍵，字串一改錯就會靜默合併多張單據。 */
const NO_INVOICE_NO = '無單號';

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

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatMoney(value) {
    let num = Number(value);
    if (!isFinite(num)) num = 0;
    return Math.round(num).toLocaleString('en-US');
}

/* --------------------------- 日期與期間工具 --------------------------- */

/*
 * 單據日期是自由文字（民國年、分隔符號不一、也可能被手動改成任何東西），
 * 因此盡力解析：成功回傳中午 12 點的 Date，失敗回傳 null。
 * 用中午是為了避開時區／邊界導致的整天偏移。
 * 小於 1000 的年份一律視為民國年（115 → 2026）。
 * 日標記接受「日」「号」「號」，也可省略——手打的單據常常不寫。
 */
function parseDateLabel(raw) {
    if (raw === null || raw === undefined) return null;
    let text = String(raw).replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    let match = text.match(/(\d{1,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号號]?/) ||
                text.match(/(\d{1,4})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})/);
    if (!match) return null;
    let year = parseInt(match[1], 10);
    let month = parseInt(match[2], 10);
    let day = parseInt(match[3], 10);
    if (year < 1000) year += 1911;
    if (year < 1950 || year > 2100) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let date = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
}

function isoDateInput(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

/* <input type="date"> 的值（YYYY-MM-DD）→ 中午 12 點的 Date；空值或非法回傳 null */
function parseISODateInput(value) {
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    return parseDateLabel(match[1] + '/' + match[2] + '/' + match[3]);
}

function rocDateLabel(date) {
    return (date.getFullYear() - 1911) + '年' + pad2(date.getMonth() + 1) + '月' + pad2(date.getDate()) + '日';
}

function monthKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1);
}

function monthKeyLabel(key) {
    let parts = String(key).split('-');
    return (Number(parts[0]) - 1911) + '年' + parts[1] + '月';
}

function firstDayOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
}

function lastDayOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0, 0);
}

function firstDayOfYear(date) {
    return new Date(date.getFullYear(), 0, 1, 12, 0, 0, 0);
}

function lastDayOfYear(date) {
    return new Date(date.getFullYear(), 11, 31, 12, 0, 0, 0);
}

function shiftMonths(date, delta) {
    return new Date(date.getFullYear(), date.getMonth() + delta, 1, 12, 0, 0, 0);
}

/* 季度：1-3 月為第一季，依此類推 */
function currentQuarterRange(date) {
    let firstMonth = Math.floor(date.getMonth() / 3) * 3;
    return {
        from: new Date(date.getFullYear(), firstMonth, 1, 12, 0, 0, 0),
        to: new Date(date.getFullYear(), firstMonth + 3, 0, 12, 0, 0, 0)
    };
}

function isInDateRange(date, from, to) {
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
}

/* ----------------------------- 使用習慣設定 ----------------------------- */

/*
 * 紙張尺寸、店家名稱這類「展示設定」只存 localStorage，不寫進本機 JSON 檔案——
 * 檔案是營業資料（商品、客戶、單據）的快照，不該被列印偏好或店面展示污染。
 * 店家名稱刻意不進 PERSISTED_STORES：那套防抹除邏輯會把「空值」當成遺失並用
 * 檔案舊值復活，但清空店家名稱要的就是「真的不顯示」，兩者語意相反。
 */
function getSettings() {
    let saved = readJSON(STORAGE_KEYS.settings, null);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return saved;
}

function setSetting(key, value) {
    let saved = getSettings();
    saved[key] = value;
    writeJSON(STORAGE_KEYS.settings, saved);
}

/* ------------------------------ 店家名稱 ------------------------------ */

/*
 * 未設定過（key 不存在）→ 用預設店名，維持既有輸出；
 * 設定過就算空字串 → 照使用者意思不顯示店家名稱，只留「估價單」。
 */
function getShopName() {
    let saved = getSettings();
    if (!Object.prototype.hasOwnProperty.call(saved, 'shopName')) return SHOP_NAME;
    return String(saved.shopName === null || saved.shopName === undefined ? '' : saved.shopName).trim();
}

function setShopName(name) {
    setSetting('shopName', String(name === null || name === undefined ? '' : name).trim());
    applyDocumentTitle();
    return getShopName();
}

/* 店家名稱也是 A4 列印頁首唯一的店名來源（來自 <title>），所以要同步文件標題 */
function applyDocumentTitle() {
    let shop = getShopName();
    document.title = (shop ? shop + '－' : '') + APP_NAME;
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
