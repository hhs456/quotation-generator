/*
 * 大毛小毛火鍋料估價單產生器 — 單位與商品基本資料庫的管理彈窗
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
   catalog.js — 單位與商品基本資料庫的管理彈窗
   載入順序第 5 棒：依賴 core.js；執行期會呼叫 store.js / app.js 的函式。
   ========================================================================== */

function openMemoryModal() {
    let shopInput = document.getElementById('shopNameInput');
    if (shopInput) shopInput.value = getShopName();
    renderUnitManager();
    renderProductManager();
    document.getElementById('memoryModal').style.display = 'flex';
}

function closeMemoryModal() {
    closeModal('memoryModal');
    updateDatalist();
    updateUnitDatalist();
}

/* -------------------------------- 單位 -------------------------------- */

function renderUnitManager() {
    let units = getUnitDB();
    let container = document.getElementById('unitListContainer');
    container.innerHTML = '';
    units.forEach(u => {
        let badge = document.createElement('div');
        badge.className = 'unit-badge';
        badge.innerHTML = `<span>${esc(u)}</span> <button type="button" data-action="delete-unit" data-unit="${esc(u)}" aria-label="刪除單位 ${esc(u)}">×</button>`;
        container.appendChild(badge);
    });
}

function addNewUnit() {
    let input = document.getElementById('newUnitName');
    let val = input.value.trim();
    if (!val) {
        alert('請輸入單位名稱！');
        input.focus();
        return;
    }
    let units = getUnitDB();
    if (units.includes(val)) {
        alert('此單位已經存在！');
        return;
    }
    units.push(val);
    setUnitDB(units);
    input.value = '';
    updateUnitDatalist();
    renderUnitManager();
    flushSave();
}

function deleteUnit(unitName) {
    let units = getUnitDB();
    if (units.length <= 1) {
        alert('至少需保留一個單位！');
        return;
    }
    if (!confirm(`確定要刪除單位「${unitName}」嗎？`)) return;
    setUnitDB(units.filter(u => u !== unitName));
    updateUnitDatalist();
    renderUnitManager();
    flushSave();
}

/* -------------------------------- 商品 -------------------------------- */

function renderProductManager() {
    let db = getProductDB();
    let tbody = document.getElementById('memoryTableBody');
    tbody.innerHTML = '';

    for (let name in db) {
        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${esc(name)}</strong></td>
            <td><input type="text" list="unitList" value="${esc(db[name].unit)}" data-field="product-unit" data-name="${esc(name)}"></td>
            <td><input type="number" value="${esc(db[name].price)}" data-field="product-price" data-name="${esc(name)}"></td>
            <td><button type="button" class="btn-xs" data-action="delete-product" data-name="${esc(name)}">刪除</button></td>
        `;
        tbody.appendChild(tr);
    }
}

function addNewMemoryItem() {
    let nameInput = document.getElementById('newMemName');
    let unitInput = document.getElementById('newMemUnit');
    let priceInput = document.getElementById('newMemPrice');

    let name = nameInput.value.trim();
    if (!name) {
        alert('請輸入商品名稱！');
        nameInput.focus();
        return;
    }
    let unit = unitInput.value.trim() || '斤';
    let price = parseFloat(priceInput.value);
    if (isNaN(price) || price < 0) price = 0;

    let db = getProductDB();
    db[name] = { price: price, unit: unit };
    setProductDB(db);

    nameInput.value = '';
    unitInput.value = '';
    priceInput.value = '';

    renderProductManager();
    updateDatalist();
    flushSave();
}

function updateMemoryData(name, field, value) {
    let db = getProductDB();
    if (!db[name]) return;
    if (field === 'price') {
        let parsed = parseFloat(value);
        db[name].price = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    } else {
        db[name].unit = String(value).trim() || db[name].unit;
    }
    setProductDB(db);
    updateDatalist();
    flushSave();
}

function deleteMemoryItem(name) {
    if (!confirm(`確定要從商品管理中刪除「${name}」嗎？`)) return;
    let db = getProductDB();
    delete db[name];
    setProductDB(db);

    let clientPrices = getClientPricesDB();
    for (let c in clientPrices) {
        if (clientPrices[c] && clientPrices[c][name] !== undefined) {
            delete clientPrices[c][name];
        }
    }
    setClientPricesDB(clientPrices);

    renderProductManager();
    renderClientPricingTable();
    updateDatalist();
    flushSave();
}
