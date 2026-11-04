/*
 * 估價單產生器 — 本機檔案連結、自動存檔管線、防抹除保護、備份還原
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
   store.js — 本機檔案連結、自動存檔管線、防抹除保護、備份還原
   載入順序第 4 棒：依賴 core.js；執行期會呼叫 invoice.js 的 collectState()。
   ========================================================================== */

const JSON_FILE_TYPE = {
    description: 'JSON 檔案',
    accept: { 'application/json': ['.json'] }
};

/* 檔案欄位 -> localStorage 鍵。兩者的名稱並非完全相同（currentState -> current），
   所以一律走這張對應表，不要用 STORAGE_KEYS[檔案欄位] 直接查。 */
const STORE_TO_KEY = {
    products: STORAGE_KEYS.products,
    units: STORAGE_KEYS.units,
    clients: STORAGE_KEYS.clients,
    clientPrices: STORAGE_KEYS.clientPrices,
    history: STORAGE_KEYS.history,
    seq: STORAGE_KEYS.seq,
    currentState: STORAGE_KEYS.current
};

/* 寫入檔案的資料欄位（也是防抹除保護的比對範圍，不含畫面暫存 currentState） */
const PERSISTED_STORES = ['products', 'units', 'clients', 'clientPrices', 'history', 'seq'];

function collectPersistedSources() {
    let sources = {};
    PERSISTED_STORES.forEach(key => {
        sources[key] = readRaw(STORE_TO_KEY[key]);
    });
    return sources;
}

function extractStores(source) {
    let pick = key => (source && typeof source[key] === 'string' && source[key] !== '') ? source[key] : null;
    let stores = {};
    PERSISTED_STORES.forEach(key => {
        stores[key] = pick(key);
    });
    return stores;
}

/*
 * 防抹除：本機 localStorage 為空、但檔案有資料時，沿用檔案版本，
 * 避免換機器 / 清過瀏覽器 / file:// 隔離 後第一次按鍵就把歷史蓋掉。
 */
function buildFullData(state) {
    let local = collectPersistedSources();
    let protectedKeys = [];
    if (lastFileData) {
        PERSISTED_STORES.forEach(key => {
            if (key === 'seq') return;
            if (isEmptyStore(local[key]) && !isEmptyStore(lastFileData[key])) {
                local[key] = lastFileData[key];
                protectedKeys.push(key);
            }
        });
    }
    let data = Object.assign({}, local, { currentState: JSON.stringify(state) });
    return { data: data, protectedKeys: protectedKeys };
}

async function writeToHandle(data) {
    let writable = await globalFileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
}

async function performSave() {
    let state = collectState();
    writeJSON(STORAGE_KEYS.current, state);

    let built = buildFullData(state);
    if (!globalFileHandle) {
        if (built.protectedKeys.length > 0) {
            setSaveStatus('warn', '僅暫存於瀏覽器：', '本機暫存資料與檔案不同步，已避免覆蓋檔案。請先「啟用自動存檔」或「載入其他檔案」。');
        } else {
            setSaveStatus('info', '尚未啟用本機自動存檔：', '資料僅暫存在瀏覽器中。');
        }
        return;
    }

    setSaveStatus('info', '儲存中：', `正在寫入 [<strong>${esc(globalFileHandle.name)}</strong>] …`);
    try {
        await writeToHandle(built.data);
        lastFileData = extractStores(built.data);
        let stamp = new Date().toLocaleTimeString('zh-TW', { hour12: false });
        if (built.protectedKeys.length > 0) {
            setSaveStatus('warn', '本機自動存檔中：', `[<strong>${esc(globalFileHandle.name)}</strong>] 已寫入 ${stamp}（部分資料以檔案版本保留）`);
        } else {
            setSaveStatus('ok', '本機自動存檔中：', `[<strong>${esc(globalFileHandle.name)}</strong>] 已寫入 ${stamp}`);
        }
    } catch (err) {
        console.error('自動寫入本機檔案失敗', err);
        document.getElementById('reconnectBtn').style.display = 'inline-block';
        setSaveStatus('error', '寫入本機檔案失敗：', `${esc(err && err.message ? err.message : String(err))}｜請點擊「⚡ 啟用自動存檔」重新授權後再試。`);
    }
}

/* debounce + 單一 in-flight 佇列：避免並發 createWritable 互踩 */
async function runSaveQueue() {
    saveTimer = null;
    if (writing) {
        writeAgain = true;
        return;
    }
    writing = true;
    try {
        do {
            writeAgain = false;
            await performSave();
        } while (writeAgain);
    } finally {
        writing = false;
    }
}

function scheduleSave(delay) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(runSaveQueue, delay === undefined ? SAVE_DEBOUNCE_MS : delay);
}

function flushSave() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    runSaveQueue();
}

function showRestoreButton(visible) {
    document.getElementById('restoreBtn').style.display = visible ? 'inline-block' : 'none';
}

function applyBackupToStorage(backupData) {
    if (!backupData || typeof backupData !== 'object') backupData = {};
    Object.keys(STORE_TO_KEY).forEach(field => {
        let value = backupData[field];
        if (typeof value === 'string' && value !== '') {
            localStorage.setItem(STORE_TO_KEY[field], value);
        } else {
            localStorage.removeItem(STORE_TO_KEY[field]);
        }
    });
    lastFileData = extractStores(backupData);
}

function loadStateIntoUI(backupData) {
    applyBackupToStorage(backupData);
    renderCurrentState();
    document.getElementById('reconnectBtn').style.display = 'none';
    if (globalFileHandle) {
        setSaveStatus('ok', '本機自動存檔中：', `已連結 [<strong>${esc(globalFileHandle.name)}</strong>] 自動存檔`);
    } else {
        setSaveStatus('warn', '僅暫存於瀏覽器：', '已載入備份內容，但尚未連結本機檔案。');
    }
}

async function readHandleText(handle) {
    try {
        let file = await handle.getFile();
        return await file.text();
    } catch (e) {
        console.error('讀取檔案失敗', e);
        return null;
    }
}

/*
 * 取得檔案 handle 後的統一收編流程。
 * preferFileContent=true 直接載入檔案；否則詢問使用者要載入還是覆蓋。
 */
async function adoptFileHandle(handle, preferFileContent) {
    globalFileHandle = handle;
    rememberedHandle = handle;
    try {
        await saveHandleToIDB(handle);
    } catch (e) {
        console.error('記憶檔案位置失敗（此瀏覽器的 file:// 環境可能不支援 IndexedDB）', e);
    }

    let parsed = null;
    let raw = await readHandleText(handle);
    if (raw !== null && raw.trim() !== '') {
        localStorage.setItem(STORAGE_KEYS.backup, raw);
        showRestoreButton(true);
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            parsed = null;
        }
        if (!parsed || typeof parsed !== 'object') {
            alert(`檔案「${handle.name}」不是有效的 JSON 格式，將以目前畫面的資料覆蓋。`);
            parsed = null;
        }
    }

    document.getElementById('reconnectBtn').style.display = 'none';

    if (parsed && (preferFileContent || confirm(`檔案「${handle.name}」已有資料。\n\n【確定】＝載入檔案內容到目前畫面（推薦）\n【取消】＝保留目前畫面並覆蓋檔案`))) {
        loadStateIntoUI(parsed);
        return;
    }

    // 以目前畫面覆蓋檔案：不動 localStorage，只用檔案舊值做防抹除保護
    lastFileData = parsed ? extractStores(parsed) : null;
    setSaveStatus('ok', '本機自動存檔中：', `已連結 [<strong>${esc(handle.name)}</strong>] 自動存檔`);
    flushSave();
}

async function linkLocalFile() {
    if (!supportsFileSystemAccess()) {
        alert('您的瀏覽器不支援直接寫入本機檔案 API，請使用 Chrome 或 Edge 瀏覽器。');
        return;
    }
    try {
        let handle = await window.showSaveFilePicker({
            suggestedName: 'quotation_database.json',
            startIn: globalFileHandle || undefined,
            types: [JSON_FILE_TYPE]
        });
        await adoptFileHandle(handle, false);
        alert(`自動存檔啟用成功（檔案名稱：${handle.name}）！系統會在你修改資料時自動增量存檔。`);
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error(err);
            setSaveStatus('error', '建立存檔檔案失敗：', esc(err && err.message ? err.message : String(err)));
        }
    }
}

async function openLocalFile() {
    if (!supportsFileSystemAccess()) {
        alert('您的瀏覽器不支援直接讀取本機檔案 API，請使用 Chrome 或 Edge 瀏覽器。');
        return;
    }
    try {
        let [handle] = await window.showOpenFilePicker({
            startIn: globalFileHandle || undefined,
            types: [JSON_FILE_TYPE]
        });
        await adoptFileHandle(handle, true);
        alert(`本機檔案「${handle.name}」讀取成功並已啟用自動存檔！`);
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error(err);
            setSaveStatus('error', '載入檔案失敗：', esc(err && err.message ? err.message : String(err)));
        }
    }
}

async function reconnectLocalFile() {
    let handle = globalFileHandle || rememberedHandle;
    if (!handle) {
        try {
            handle = await loadHandleFromIDB();
        } catch (e) {
            console.error(e);
        }
    }
    if (!handle) {
        alert('找不到先前記憶的檔案紀錄，請先點擊「建立自動存檔檔案」。');
        return;
    }
    try {
        const opts = { mode: 'readwrite' };
        if ((await handle.queryPermission(opts)) !== 'granted') {
            if ((await handle.requestPermission(opts)) !== 'granted') {
                alert('未取得檔案存取權限！');
                return;
            }
        }
        await adoptFileHandle(handle, true);
        alert('已成功啟用自動存檔！');
    } catch (err) {
        alert('啟用自動存檔失敗，可能檔案已被移動或刪除，請重新建立檔案。');
        console.error(err);
        setSaveStatus('error', '啟用自動存檔失敗：', esc(err && err.message ? err.message : String(err)));
    }
}

async function restoreFileBackup() {
    let raw = readRaw(STORAGE_KEYS.backup);
    if (!raw) {
        alert('找不到可還原的檔案備份。');
        return;
    }
    if (!confirm('確定要用「本次連結時讀到的原始檔案內容」覆蓋目前的檔案與畫面嗎？\n（目前畫面中尚未寫入的修改會被取代。）')) return;
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        alert('備份內容不是有效的 JSON，無法還原。');
        return;
    }
    if (globalFileHandle) {
        try {
            await writeToHandle(parsed);
        } catch (e) {
            alert('還原寫入失敗：' + (e && e.message ? e.message : e));
            return;
        }
    }
    loadStateIntoUI(parsed);
    flushSave();
    alert('已還原備份內容。');
}
