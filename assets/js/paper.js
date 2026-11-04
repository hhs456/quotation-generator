/*
 * 大毛小毛火鍋料估價單產生器 — 紙張規格（A4 / 熱感 10cm、8cm）、@page 注入、列印管線
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
   paper.js — 紙張規格、@page 注入、列印管線、熱感單據排版
   載入順序第 7 棒：依賴 core.js、currency.js；執行期被 invoice.js / report.js 呼叫。
   ========================================================================== */

const PAPER_SETTING_KEY = 'printPaper';

/*
 * A4 的 page / margin 刻意留空：沿用瀏覽器既有預設，避免改了這個功能
 * 就順手改變已經在用的 A4 輸出結果。
 * 熱感紙的長度用 auto（連續紙）。可印內容寬度一律由 page 減左右邊距算出，
 * 不再手存一份——存死的數字遲早會跟 @page 不同步，右側就被裁掉。
 */
const PAPER_PRESETS = {
    a4: {
        label: 'A4（直式）',
        page: '',
        margin: '',
        thermal: false
    },
    thermal100: {
        label: '10cm 熱感單據（100mm）',
        page: '100mm auto',
        margin: '4mm 3mm',
        thermal: true
    },
    thermal80: {
        label: '8cm 熱感單據（80mm）',
        page: '80mm auto',
        margin: '3mm 2mm',
        thermal: true
    }
};

const DEFAULT_PAPER = 'a4';

/* @page 的內容框寬 = 紙寬 − 左右邊距。CSS margin 簡寫依序是 上 / 右左 / 下。 */
function thermalContentWidth(preset) {
    let pageMm = parseFloat(preset.page);
    let parts = String(preset.margin || '').trim().split(/\s+/).map(parseFloat);
    let sideMm = parts.length >= 2 ? parts[1] : parts[0];
    if (!isFinite(pageMm) || !isFinite(sideMm)) return '';
    return (pageMm - 2 * sideMm) + 'mm';
}

function normalizePaperKind(kind) {
    return PAPER_PRESETS[kind] ? kind : DEFAULT_PAPER;
}

function getPaperKind() {
    return normalizePaperKind(getSettings()[PAPER_SETTING_KEY]);
}

function getPaperPreset(kind) {
    return PAPER_PRESETS[normalizePaperKind(kind || getPaperKind())];
}

function isThermalPaper() {
    return getPaperPreset().thermal;
}

function setPaperKind(kind) {
    let normalized = normalizePaperKind(kind);
    setSetting(PAPER_SETTING_KEY, normalized);
    applyPageSize();
    syncPaperSelectors(normalized);
    /* 報表彈窗開著時換紙張，預覽要跟著換版（A4 表格 / 熱感直列） */
    let modal = document.getElementById('reportModal');
    if (modal && modal.style.display === 'flex') renderReport();
    return normalized;
}

/* 把 @page 寫進獨立的 style 元素。@page 無法用 body 屬性選擇器條件化，
   所以紙寬切換只能靠「覆寫這一塊 style」而不是靠 CSS 類別。 */
function applyPageSize() {
    let styleEl = document.getElementById('pageSizeStyle');
    if (!styleEl) return;
    let preset = getPaperPreset();
    if (!preset.page) {
        styleEl.textContent = '';
        return;
    }
    styleEl.textContent = '@media print { @page { size: ' + preset.page + '; margin: ' + preset.margin + '; } }';
}

/* 主畫面與報表彈窗各有一個紙張選擇器，共用在同一個設定值上，
   任一處變更都要同步另一處的顯示（含程式性賦值，不會觸發 change）。 */
function syncPaperSelectors(kind) {
    document.querySelectorAll('.paper-select').forEach(select => {
        select.value = kind;
    });
}

function initPaperSelectors() {
    let current = getPaperKind();
    applyPageSize();
    document.querySelectorAll('.paper-select').forEach(select => {
        select.innerHTML = '';
        Object.keys(PAPER_PRESETS).forEach(kind => {
            let opt = document.createElement('option');
            opt.value = kind;
            opt.textContent = PAPER_PRESETS[kind].label;
            select.appendChild(opt);
        });
        select.value = current;
        select.addEventListener('change', function () {
            setPaperKind(select.value);
        });
    });
}

/* ------------------------------ 列印管線 ------------------------------ */

function cleanupPrintDoc() {
    document.body.classList.remove('printing-doc');
    let doc = document.getElementById('printDoc');
    if (doc) doc.innerHTML = '';
}

/*
 * 把已組好的 HTML 塞進 #printDoc 列印。
 * window.print() 在 Chrome / Edge / Firefox 會阻塞到對話框關閉，之後再清場；
 * afterprint 是保險，避免某些瀏覽器提早回傳而留下打印用的 DOM。
 */
function printHtml(html) {
    let doc = document.getElementById('printDoc');
    if (!doc) {
        window.print();
        return;
    }
    let preset = getPaperPreset();
    doc.innerHTML = preset.thermal
        ? `<div class="print-thermal" style="width: ${esc(thermalContentWidth(preset))}">${html}</div>`
        : `<div class="print-a4">${html}</div>`;
    applyPageSize();
    document.body.classList.add('printing-doc');
    window.print();
    cleanupPrintDoc();
}

window.addEventListener('afterprint', cleanupPrintDoc);

/* ---------------------------- 熱感單據排版 ---------------------------- */

function receiptRow(label, value, extraClass) {
    return `<div class="rc-row${extraClass ? ' ' + extraClass : ''}">` +
        `<span class="rc-label">${esc(label)}</span>` +
        `<span class="rc-value">${esc(value)}</span>` +
        '</div>';
}

function receiptItem(item) {
    let detail = [item.qty, item.unit].filter(part => part !== '' && part !== undefined && part !== null).join(' ');
    if (item.price !== '' && item.price !== undefined && item.price !== null) detail += ' × ' + item.price;
    let html = `<div class="rc-item">` +
        `<div class="rc-item-name">${esc(item.name)}</div>` +
        receiptRow(detail, item.amount === '' ? '—' : formatMoney(item.amount), 'rc-detail');
    if (item.remark) html += `<div class="rc-remark">備註 ${esc(item.remark)}</div>`;
    html += '</div>';
    return html;
}

/* 目前畫面上的單據 → 熱感紙（10cm／8cm）用的直列式收據 */
function buildInvoiceThermalHtml(state) {
    let brandEl = document.querySelector('.buyer-brand');
    let brand = brandEl ? brandEl.textContent.trim() : '';
    let buyer = [String(state.buyer || '').trim(), brand].filter(part => part !== '').join(' ');
    let total = 0;
    let items = [];

    (Array.isArray(state.items) ? state.items : []).forEach(item => {
        let name = String(item.name || '').trim();
        let qty = String(item.qty === undefined || item.qty === null ? '' : item.qty).trim();
        let price = String(item.price === undefined || item.price === null ? '' : item.price).trim();
        let remark = String(item.remark || '').trim();
        if (!name && !qty && !price && !remark) return;
        let amount = roundAmount(qty, price);
        if (amount !== '') total += amount;
        items.push({
            name: name || '(未填品名)',
            qty: qty,
            unit: String(item.unit || '').trim(),
            price: price,
            amount: amount,
            remark: remark
        });
    });

    let shop = getShopName();
    let html = '<div class="receipt">' +
        (shop ? `<div class="rc-shop">${esc(shop)}</div>` : '') +
        '<div class="rc-title">估 價 單</div>' +
        '<div class="rc-rule"></div>' +
        receiptRow('單號', state.invoiceNo || '') +
        receiptRow('日期', state.invoiceDate || '') +
        receiptRow('買受人', buyer) +
        '<div class="rc-rule"></div>' +
        '<div class="rc-items">' +
        (items.length > 0 ? items.map(receiptItem).join('') : '<div class="rc-empty">無品項</div>') +
        '</div>' +
        '<div class="rc-rule"></div>' +
        receiptRow('合計', 'NT$ ' + formatMoney(total), 'rc-total') +
        `<div class="rc-cn">${esc(numberToChineseCurrency(total))}</div>` +
        '<div class="rc-sign">顧客簽章 ＿＿＿＿＿＿＿＿＿＿</div>' +
        '</div>';
    return html;
}
