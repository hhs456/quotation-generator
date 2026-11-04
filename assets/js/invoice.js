/*
 * 估價單產生器 — 單據列、總計、驗證、列印、流水單號、歷史單據
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
   invoice.js — 單據列、總計、驗證、列印、流水單號、歷史單據
   載入順序第 5 棒：依賴 core.js、currency.js、store.js；
   執行期會呼叫 app.js 的 updateDatalist() / updateClientDatalist() / onBuyerChange()，
   以及 paper.js 的 isThermalPaper() / printHtml() / buildInvoiceThermalHtml()。
   ========================================================================== */

function collectState() {
    let state = {
        buyer: getElementText('buyer'),
        invoiceNo: getElementText('invoiceNo'),
        invoiceDate: getElementText('invoiceDate'),
        items: []
    };
    document.querySelectorAll('#itemTableBody tr').forEach(tr => {
        let nameInput = tr.querySelector('.item-name');
        let qtyInput = tr.querySelector('.item-qty');
        let unitSpan = tr.querySelector('.unit-label');
        let priceInput = tr.querySelector('.item-price');
        let remarkInput = tr.querySelector('.item-remark');
        if (nameInput) {
            state.items.push({
                name: nameInput.value,
                qty: qtyInput ? qtyInput.value : '',
                unit: unitSpan ? unitSpan.textContent : DEFAULT_UNITS[0],
                price: priceInput ? priceInput.value : '',
                remark: remarkInput ? remarkInput.value : ''
            });
        }
    });
    return state;
}

function addRow(data = null) {
    let tbody = document.getElementById('itemTableBody');
    let rowCount = tbody.rows.length + 1;
    let tr = document.createElement('tr');

    let nameVal = data ? (data.name || '') : '';
    let qtyVal = data && data.qty !== undefined && data.qty !== null ? data.qty : '';
    let unitVal = data ? data.unit : '';
    let priceVal = data && data.price !== undefined && data.price !== null ? data.price : '';
    let remarkVal = data ? (data.remark || '') : '';

    if (nameVal && !unitVal) {
        let db = getProductDB();
        if (db[nameVal]) unitVal = db[nameVal].unit;
    }
    if (!unitVal) unitVal = DEFAULT_UNITS[0];
    if (nameVal && (priceVal === '' || priceVal === undefined || priceVal === null)) {
        let resolved = getProductPriceForClient(nameVal, getElementText('buyer').trim());
        if (resolved) priceVal = resolved;
    }
    let amountVal = roundAmount(qtyVal, priceVal);

    tr.innerHTML = `
        <td>${rowCount}</td>
        <td><input type="text" list="productList" class="item-name" value="${esc(nameVal)}" placeholder="輸入或選取商品"></td>
        <td>
            <div class="qty-container">
                <input type="number" class="item-qty" value="${esc(qtyVal)}" placeholder="數量">
                <span class="unit-label">${esc(unitVal)}</span>
            </div>
        </td>
        <td><input type="number" class="item-price" value="${esc(priceVal)}" placeholder="單價"></td>
        <td class="item-amount">${esc(amountVal)}</td>
        <td><input type="text" class="item-remark" value="${esc(remarkVal)}" placeholder="備註"></td>
        <td class="no-print"><button type="button" class="btn-row-delete" data-action="delete-row">刪除</button></td>
    `;
    tbody.appendChild(tr);

    let nameInput = tr.querySelector('.item-name');
    let qtyInput = tr.querySelector('.item-qty');
    let unitSpan = tr.querySelector('.unit-label');
    let priceInput = tr.querySelector('.item-price');
    let remarkInput = tr.querySelector('.item-remark');

    function applyProductDefaults() {
        let db = getProductDB();
        let val = nameInput.value.trim();
        if (!db[val]) return;
        unitSpan.textContent = db[val].unit;
        priceInput.value = getProductPriceForClient(val, getElementText('buyer').trim());
        updateRowAmount(tr);
    }

    nameInput.addEventListener('input', function () {
        applyProductDefaults();
        handleUserAction();
    });
    nameInput.addEventListener('change', function () {
        applyProductDefaults();
        handleUserAction();
    });
    qtyInput.addEventListener('input', function () {
        updateRowAmount(tr);
        handleUserAction();
    });
    priceInput.addEventListener('input', function () {
        updateRowAmount(tr);
        handleUserAction();
    });
    remarkInput.addEventListener('input', function () {
        handleUserAction();
    });
}

function updateRowAmount(tr) {
    let amountTd = tr.querySelector('.item-amount');
    amountTd.textContent = roundAmount(tr.querySelector('.item-qty').value, tr.querySelector('.item-price').value);
    calculateGrandTotal();
}

function calculateGrandTotal() {
    let total = 0;
    document.querySelectorAll('#itemTableBody .item-amount').forEach(td => {
        let val = parseFloat(td.textContent);
        if (!isNaN(val)) total += val;
    });
    document.getElementById('grandTotal').textContent = total;
    document.getElementById('chineseTotal').textContent = numberToChineseCurrency(total);
}

function deleteRow(tr) {
    if (!tr) return;
    tr.remove();
    reindexRows();
    calculateGrandTotal();
    handleUserAction();
}

function reindexRows() {
    document.querySelectorAll('#itemTableBody tr').forEach((tr, index) => {
        tr.cells[0].textContent = index + 1;
    });
}

function renderCurrentState() {
    updateUnitDatalist();
    updateDatalist();

    let state = readJSON(STORAGE_KEYS.current, null);
    setElementText('buyer', state && state.buyer ? state.buyer : '');
    setElementText('invoiceNo', state && state.invoiceNo ? state.invoiceNo : peekNextInvoiceNo());
    setElementText('invoiceDate', state && state.invoiceDate ? state.invoiceDate : rocDate());

    let tbody = document.getElementById('itemTableBody');
    tbody.innerHTML = '';
    if (state && Array.isArray(state.items) && state.items.length > 0) {
        state.items.forEach(item => addRow(item));
    } else {
        addRow();
    }
    calculateGrandTotal();
}

/* ------------------------------ 流水單號 ------------------------------ */

/* 只「預覽」下一號，不推進序號；避免每次重開頁面就燒掉一號 */
function peekNextInvoiceNo() {
    let lastSeq = parseInt(readRaw(STORAGE_KEYS.seq), 10);
    if (isNaN(lastSeq)) lastSeq = SEQ_BASE;
    return String(lastSeq + 1).padStart(7, '0');
}

/* 真正用掉某個單號時才推進，且永不倒退 */
function commitInvoiceSeq(invoiceNo) {
    let used = parseInt(String(invoiceNo || '').replace(/\D/g, ''), 10);
    if (isNaN(used)) return;
    let lastSeq = parseInt(readRaw(STORAGE_KEYS.seq), 10);
    if (isNaN(lastSeq)) lastSeq = SEQ_BASE;
    if (used > lastSeq) localStorage.setItem(STORAGE_KEYS.seq, String(used));
}

function createNewInvoice() {
    if (!confirm('確定要開立新單據嗎？這將清空目前畫面並自動產生下一組流水單號。')) return;
    setElementText('buyer', '');
    setElementText('invoiceNo', peekNextInvoiceNo());
    setElementText('invoiceDate', rocDate());
    document.getElementById('itemTableBody').innerHTML = '';
    addRow();
    calculateGrandTotal();
    handleUserAction();
}

/* ------------------------------ 驗證與列印 ------------------------------ */

function validateInvoice() {
    let errors = [];
    if (!getElementText('buyer').trim()) errors.push('請填寫「買受人」。');
    if (!getElementText('invoiceNo').trim()) errors.push('請填寫「單號」。');
    if (!getElementText('invoiceDate').trim()) errors.push('請填寫「日期」。');

    let filledRows = 0;
    document.querySelectorAll('#itemTableBody tr').forEach((tr, index) => {
        let name = tr.querySelector('.item-name').value.trim();
        let qtyRaw = tr.querySelector('.item-qty').value.trim();
        let priceRaw = tr.querySelector('.item-price').value.trim();
        let remark = tr.querySelector('.item-remark').value.trim();
        if (!name && !qtyRaw && !priceRaw && !remark) return;
        filledRows++;
        let qty = parseFloat(qtyRaw);
        let price = parseFloat(priceRaw);
        let label = name ? `商品「${name}」` : '未命名商品';
        if (!name) {
            errors.push(`第 ${index + 1} 行：有填寫內容但未輸入「品名」。`);
        }
        if (!qtyRaw || isNaN(qty) || qty <= 0) {
            errors.push(`第 ${index + 1} 行：${label} 的「數量」必須為大於 0 的數字。`);
        }
        if (!priceRaw || isNaN(price) || price < 0) {
            errors.push(`第 ${index + 1} 行：${label} 的「單價」必須為 0 以上的數字。`);
        }
    });
    if (filledRows === 0) errors.push('單據沒有任何品項，無法列印。');
    return errors;
}

function validateAndPrint() {
    let errors = validateInvoice();
    if (errors.length > 0) {
        alert('⚠️ 無法列印單據：\n' + errors.join('\n') + '\n請補齊資料後再試。');
        return;
    }
    commitInvoiceSeq(getElementText('invoiceNo'));
    flushSave();
    if (isThermalPaper()) {
        printHtml(buildInvoiceThermalHtml(collectState()));
    } else {
        window.print();
    }
}

/* ------------------------------ 歷史單據 ------------------------------ */

function saveToHistory() {
    let state = collectState();
    if (state.items.length === 0) {
        alert('目前沒有品項可儲存！');
        return;
    }
    writeJSON(STORAGE_KEYS.current, state);

    let historyList = getHistoryList();
    historyList.unshift({
        id: 'INV_' + Date.now(),
        dateStr: state.invoiceDate || '未指定日期',
        buyer: state.buyer || '未指定買受人',
        invoiceNo: state.invoiceNo || NO_INVOICE_NO,
        total: document.getElementById('grandTotal').textContent,
        data: state
    });
    setHistoryList(historyList);
    commitInvoiceSeq(state.invoiceNo);
    flushSave();
    alert('已成功將此單據儲存至歷史紀錄！');
}

function openHistoryModal() {
    let historyList = getHistoryList();
    let tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = '';

    if (historyList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-row-hint">尚無歷史單據紀錄</td></tr>';
    } else {
        historyList.forEach(rec => {
            let tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${esc(rec.invoiceNo)}</td>
                <td>${esc(rec.buyer)}</td>
                <td>${esc(rec.dateStr)}</td>
                <td>$${esc(rec.total)}</td>
                <td>
                    <button type="button" class="btn-xs btn-secondary" data-action="load-history" data-id="${esc(rec.id)}">載入</button>
                    <button type="button" class="btn-xs" data-action="delete-history" data-id="${esc(rec.id)}">刪除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
    document.getElementById('historyModal').style.display = 'flex';
}

function closeModal(id) {
    let el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

function loadHistoryItem(id) {
    let rec = getHistoryList().find(r => r.id === id);
    if (!rec) return;
    setElementText('buyer', rec.data.buyer || '');
    setElementText('invoiceNo', rec.data.invoiceNo || '');
    setElementText('invoiceDate', rec.data.invoiceDate || '');

    let tbody = document.getElementById('itemTableBody');
    tbody.innerHTML = '';
    (Array.isArray(rec.data.items) ? rec.data.items : []).forEach(item => addRow(item));
    calculateGrandTotal();
    handleUserAction();
    closeModal('historyModal');
    alert(`已成功載入單號：${rec.invoiceNo} 的單據！`);
}

function deleteHistoryItem(id) {
    if (!confirm('確定要刪除這筆歷史單據紀錄嗎？')) return;
    setHistoryList(getHistoryList().filter(r => r.id !== id));
    flushSave();
    openHistoryModal();
}
