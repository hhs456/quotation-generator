'use strict';

/* ==========================================================================
   clients.js — 客戶名單與客戶專屬定價的管理彈窗
   載入順序第 6 棒：依賴 core.js；執行期會呼叫 store.js / invoice.js / app.js 的函式。
   ========================================================================== */

function getClientSelectValue() {
    let select = document.getElementById('selectedClientSelect');
    return select ? select.value : '';
}

function refreshClientViews() {
    updateClientDatalist();
    renderClientPricingTable();
}

/* 若畫面上的買受人正是被異動的客戶，立即重算單價 */
function reapplyIfBuyerMatches(clientName) {
    if (getElementText('buyer').trim() === clientName) {
        onBuyerChange();
    }
}

function openClientModal() {
    refreshClientViews();
    document.getElementById('clientModal').style.display = 'flex';
}

function closeClientModal() {
    closeModal('clientModal');
    updateClientDatalist();
}

function addNewClient() {
    let input = document.getElementById('newClientNameInput');
    let clientName = input.value.trim();
    if (!clientName) {
        alert('請輸入要新增的客戶名稱！');
        input.focus();
        return;
    }

    let clients = getClientsDB();
    if (clients.includes(clientName)) {
        alert(`客戶「${clientName}」已經存在！`);
        let select = document.getElementById('selectedClientSelect');
        if (select) select.value = clientName;
        renderClientPricingTable();
        return;
    }
    clients.push(clientName);
    setClientsDB(clients);

    let clientPrices = getClientPricesDB();
    if (!clientPrices[clientName]) {
        clientPrices[clientName] = {};
        setClientPricesDB(clientPrices);
    }

    input.value = '';
    updateClientDatalist();

    let select = document.getElementById('selectedClientSelect');
    if (select) select.value = clientName;
    renderClientPricingTable();
    flushSave();
    alert(`已成功新增客戶「${clientName}」！`);
}

/*
 * 刪除客戶：同時移出名單並清掉他的專屬價。
 * 這是原本缺少的語意 —— 以前只有「清除專屬價」，而且客戶不在
 * clientPrices 裡時會靜默無動作，看起來就像「刪不掉」。
 */
function deleteClient(clientName) {
    if (!clientName) {
        alert('請先選擇要刪除的客戶！');
        return;
    }
    let clientPrices = getClientPricesDB();
    let priceCount = clientPrices[clientName] ? Object.keys(clientPrices[clientName]).length : 0;
    let suffix = priceCount > 0 ? `\n（將一併刪除 ${priceCount} 項專屬定價）` : '';
    if (!confirm(`確定要刪除客戶「${clientName}」嗎？${suffix}`)) return;

    setClientsDB(getClientsDB().filter(c => c !== clientName));
    if (clientPrices[clientName]) {
        delete clientPrices[clientName];
        setClientPricesDB(clientPrices);
    }

    refreshClientViews();
    reapplyIfBuyerMatches(clientName);
    flushSave();
    alert(`已刪除客戶「${clientName}」。`);
}

/* 保留客戶，只清掉他的專屬定價 */
function deleteClientPricing() {
    let clientName = getClientSelectValue();
    if (!clientName) {
        alert('請先選擇要清除的客戶！');
        return;
    }
    let clientPrices = getClientPricesDB();
    let priceCount = clientPrices[clientName] ? Object.keys(clientPrices[clientName]).length : 0;
    if (priceCount === 0) {
        alert(`客戶「${clientName}」目前沒有專屬定價可清除。`);
        return;
    }
    if (!confirm(`確定要清除客戶「${clientName}」的 ${priceCount} 項專屬定價嗎？`)) return;

    delete clientPrices[clientName];
    setClientPricesDB(clientPrices);

    refreshClientViews();
    reapplyIfBuyerMatches(clientName);
    flushSave();
    alert(`已清除「${clientName}」的所有專屬定價。`);
}

function renderClientPricingTable() {
    let tbody = document.getElementById('clientPricingTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let clients = getClientsDB();
    if (clients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row-hint">目前沒有客戶，請先透過上方「新增客戶」建立名單</td></tr>';
        return;
    }

    let clientName = getClientSelectValue();
    if (!clientName) return;

    let db = getProductDB();
    let clientPrices = getClientPricesDB();
    let clientData = clientPrices[clientName] || {};
    let names = Object.keys(clientData);

    if (names.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-row-hint">此客戶目前尚無自定義專屬定價商品，請透過上方欄位新增</td></tr>';
        return;
    }

    names.forEach(productName => {
        let basePrice = db[productName] ? db[productName].price : '(商品已刪除)';
        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${esc(productName)}</strong></td>
            <td class="base-price-text">$${esc(basePrice)}</td>
            <td><input type="number" value="${esc(clientData[productName])}" data-field="client-price" data-client="${esc(clientName)}" data-product="${esc(productName)}"></td>
            <td><button type="button" class="btn-xs" data-action="delete-client-price" data-client="${esc(clientName)}" data-product="${esc(productName)}">刪除</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function addCustomPriceForClient() {
    let clientName = getClientSelectValue();
    if (!clientName) {
        alert('請先選擇客戶！');
        return;
    }

    let nameInput = document.getElementById('newClientProdName');
    let priceInput = document.getElementById('newClientProdPrice');
    let prodName = nameInput.value.trim();
    let price = parseFloat(priceInput.value);

    if (!prodName) {
        alert('請輸入或選取商品名稱！');
        nameInput.focus();
        return;
    }
    if (isNaN(price) || price < 0) {
        alert('請輸入有效的專屬單價！');
        priceInput.focus();
        return;
    }

    let clientPrices = getClientPricesDB();
    if (!clientPrices[clientName]) clientPrices[clientName] = {};
    clientPrices[clientName][prodName] = price;
    setClientPricesDB(clientPrices);

    nameInput.value = '';
    priceInput.value = '';
    renderClientPricingTable();
    reapplyIfBuyerMatches(clientName);
    flushSave();
    alert(`已成功新增「${clientName}」的 ${prodName} 專屬定價！`);
}

function updateClientCustomPrice(clientName, productName, value) {
    let clientPrices = getClientPricesDB();
    if (!clientPrices[clientName]) return;
    if (value === '' || isNaN(value) || parseFloat(value) < 0) {
        delete clientPrices[clientName][productName];
    } else {
        clientPrices[clientName][productName] = parseFloat(value);
    }
    setClientPricesDB(clientPrices);
    renderClientPricingTable();
    reapplyIfBuyerMatches(clientName);
    flushSave();
}

function deleteClientCustomPrice(clientName, productName) {
    if (!confirm(`確定要刪除客戶「${clientName}」的專屬商品「${productName}」嗎？`)) return;
    let clientPrices = getClientPricesDB();
    if (!clientPrices[clientName] || clientPrices[clientName][productName] === undefined) return;

    delete clientPrices[clientName][productName];
    setClientPricesDB(clientPrices);
    renderClientPricingTable();
    reapplyIfBuyerMatches(clientName);
    flushSave();
}
