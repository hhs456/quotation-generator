/*
 * 估價單產生器 — 單一客戶於指定期間（預設本月）的購貨統計
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
   report.js — 客戶購貨統計（期間彙整、報表渲染與列印）
   載入順序第 9 棒：依賴 core.js、currency.js、paper.js；
   統計來源為 invoice.js 的歷史單據（getHistoryList）。
   ========================================================================== */

let lastReport = null;

function getReportClient() {
    let select = document.getElementById('reportClientSelect');
    return select ? String(select.value || '').trim() : '';
}

/* 名單：正式客戶 ∪ 歷史單據出現過的買受人（手打的客戶也要查得到） */
function getReportClients() {
    let names = new Set();
    getClientsDB().forEach(name => {
        let trimmed = String(name || '').trim();
        if (trimmed) names.add(trimmed);
    });
    getHistoryList().forEach(rec => {
        if (!rec || typeof rec !== 'object') return;
        let buyer = String(rec.buyer || (rec.data && rec.data.buyer) || '').trim();
        if (buyer) names.add(buyer);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function getReportRange() {
    let from = parseISODateInput(getElementText('reportFrom'));
    let to = parseISODateInput(getElementText('reportTo'));
    if (from && to && from > to) {
        let swap = from;
        from = to;
        to = swap;
    }
    return { from: from, to: to };
}

/* ------------------------------ 統計計算 ------------------------------ */

function formatQty(qty) {
    return String(Math.round(qty * 1000) / 1000);
}

function computeCustomerReport(clientName, from, to) {
    let invoices = [];
    let undated = [];
    let seenInvoiceNos = new Set();
    let duplicated = 0;
    let anonymousSeq = 0;

    getHistoryList().forEach(rec => {
        if (!rec || typeof rec !== 'object') return;
        let data = rec.data && typeof rec.data === 'object' ? rec.data : {};
        let buyer = String(rec.buyer || data.buyer || '').trim();
        if (buyer !== clientName) return;

        /* 同一張單被存兩次（連按兩下、或載入後重存）只能算一次業績。
           歷史列表是新單在前，所以保留先出現的那一筆；沒有單號的紀錄各自成單，不去重。
           注意 saveToHistory() 把空單號寫成 NO_INVOICE_NO 哨兵值，所以 rec.invoiceNo
           恆非空——必須先還原成空字串，否則同一客戶的所有空單號單據會共用
           同一個哨兵鍵被合併掉，從各段彙整靜默消失。 */
        let invoiceNo = String(rec.invoiceNo || data.invoiceNo || '').trim();
        if (invoiceNo === NO_INVOICE_NO) invoiceNo = '';
        let dedupeKey = invoiceNo || '\u0000anon:' + (++anonymousSeq);
        if (seenInvoiceNos.has(dedupeKey)) {
            duplicated++;
            return;
        }
        seenInvoiceNos.add(dedupeKey);

        let dateLabel = String(data.invoiceDate || rec.dateStr || '').trim();
        let date = parseDateLabel(dateLabel);
        if (!date) {
            undated.push({
                invoiceNo: invoiceNo || NO_INVOICE_NO,
                dateLabel: dateLabel || '未填日期'
            });
            return;
        }
        if (!isInDateRange(date, from, to)) return;

        let lines = [];
        (Array.isArray(data.items) ? data.items : []).forEach(item => {
            if (!item || typeof item !== 'object') return;
            let name = String(item.name || '').trim();
            /* 金額一律走 roundAmount()：與畫面總計、歷史列表、熱感收據共用同一個算式
               和同一套「哪些行不算錢」的規則。回傳 '' 代表這行不計入。 */
            let amount = roundAmount(item.qty, item.price);
            if (amount === '') return;
            lines.push({
                name: name || '(未填品名)',
                unit: String(item.unit || '').trim(),
                qty: parseFloat(item.qty),
                amount: amount
            });
        });
        invoices.push({
            date: date,
            invoiceNo: invoiceNo || NO_INVOICE_NO,
            lines: lines,
            amount: lines.reduce((sum, line) => sum + line.amount, 0)
        });
    });

    invoices.sort((a, b) => (a.date - b.date) || a.invoiceNo.localeCompare(b.invoiceNo));

    let lineMap = new Map();
    let monthMap = new Map();
    invoices.forEach(inv => {
        let key = monthKey(inv.date);
        if (!monthMap.has(key)) monthMap.set(key, { key: key, count: 0, amount: 0 });
        let month = monthMap.get(key);
        month.count += 1;
        month.amount += inv.amount;
        inv.lines.forEach(line => {
            let lineKey = line.name + '\u0000' + line.unit;
            if (!lineMap.has(lineKey)) {
                lineMap.set(lineKey, { name: line.name, unit: line.unit, qty: 0, amount: 0, hits: 0 });
            }
            let agg = lineMap.get(lineKey);
            agg.qty += line.qty;
            agg.amount += line.amount;
            agg.hits += 1;
        });
    });

    let lines = Array.from(lineMap.values());
    lines.forEach(line => {
        line.qty = Math.round(line.qty * 1000) / 1000;
    });
    lines.sort((a, b) => (b.amount - a.amount) || a.name.localeCompare(b.name, 'zh-Hant'));

    let months = Array.from(monthMap.values());
    months.sort((a, b) => a.key.localeCompare(b.key));

    return {
        clientName: clientName,
        from: from,
        to: to,
        invoices: invoices,
        lines: lines,
        months: months,
        undated: undated,
        duplicated: duplicated,
        total: invoices.reduce((sum, inv) => sum + inv.amount, 0)
    };
}

function reportPeriodText(report) {
    if (!report.from && !report.to) return '全部期間';
    if (report.from && !report.to) return rocDateLabel(report.from) + ' 起';
    if (!report.from && report.to) return '直至 ' + rocDateLabel(report.to);
    return rocDateLabel(report.from) + ' ～ ' + rocDateLabel(report.to);
}

/* --------------------------- A4 報表 markup --------------------------- */

/*
 * 兩個版型共用的「資料疑難」提示：日期不可判定的單據、重複單號被合併。
 * 這些單據不計入期間，但必須看得見——不能靜默丟掉，否則店家會以為業績少了。
 * 回傳純字串陣列，A4 包成 .rp-note，熱感包成列，兩邊文案同一份。
 */
function reportNotes(report) {
    let notes = [];
    if (report.undated.length > 0) {
        let preview = report.undated.slice(0, 5).map(rec => `${rec.invoiceNo}（${rec.dateLabel}）`).join('、');
        let more = report.undated.length > 5 ? `…等 ${report.undated.length} 張` : '';
        notes.push(`另有 ${report.undated.length} 張單據的日期無法判定（格式不是「民國○○年 ○月 ○日」這類可解析的寫法），未計入本期間：${preview}${more}`);
    }
    if (report.duplicated > 0) {
        notes.push(`另有 ${report.duplicated} 筆重複單號的紀錄已合併（同一張單被存了多次，只算一次業績）`);
    }
    return notes;
}

function reportNotesHtml(report) {
    return reportNotes(report).map(note => `<div class="rp-note">${esc(note)}</div>`).join('');
}

function reportNotesThermalHtml(report) {
    return reportNotes(report).map(note => `<div class="rc-note">${esc(note)}</div>`).join('');
}

function buildReportA4Html(report) {
    let shop = getShopName();
    let html = '<div class="report">' +
        (shop ? `<div class="rp-shop">${esc(shop)}</div>` : '') +
        '<div class="rp-title">客戶購貨統計</div>' +
        '<div class="rp-meta">' +
        `<div>客戶：<strong>${esc(report.clientName || '（未選擇）')}</strong></div>` +
        `<div>期間：${esc(reportPeriodText(report))}</div>` +
        `<div>單據數：${report.invoices.length}</div>` +
        `<div>產出日期：${esc(rocDate())}</div>` +
        '</div>';

    if (report.invoices.length === 0) {
        html += `<div class="rp-empty">期間內查無客戶「${esc(report.clientName)}」的單據。</div>` + reportNotesHtml(report);
        return html + '</div>';
    }

    html += '<h4 class="rp-section">一、按月彙整</h4>' +
        '<table class="rp-table rp-table-month"><thead><tr>' +
        '<th>月份</th><th>單據數</th><th>金額</th>' +
        '</tr></thead><tbody>' +
        report.months.map(month =>
            `<tr><td>${esc(monthKeyLabel(month.key))}</td><td>${month.count}</td><td class="rp-num">${formatMoney(month.amount)}</td></tr>`
        ).join('') +
        `</tbody></table>`;

    html += '<h4 class="rp-section">二、品項彙整</h4>' +
        '<table class="rp-table rp-table-lines"><thead><tr>' +
        '<th>品名</th><th>單位</th><th>數量</th><th>筆數</th><th>金額</th>' +
        '</tr></thead><tbody>' +
        report.lines.map(line =>
            `<tr><td class="rp-name">${esc(line.name)}</td><td>${esc(line.unit)}</td>` +
            `<td>${esc(formatQty(line.qty))}</td><td>${line.hits}</td>` +
            `<td class="rp-num">${formatMoney(line.amount)}</td></tr>`
        ).join('') +
        '</tbody></table>';

    html += '<h4 class="rp-section">三、單據明細</h4>' +
        '<table class="rp-table rp-table-invoices"><thead><tr>' +
        '<th>日期</th><th>單號</th><th>品項數</th><th>金額</th>' +
        '</tr></thead><tbody>' +
        report.invoices.map(inv =>
            `<tr><td>${esc(rocDateLabel(inv.date))}</td><td>${esc(inv.invoiceNo)}</td>` +
            `<td>${inv.lines.length}</td><td class="rp-num">${formatMoney(inv.amount)}</td></tr>`
        ).join('') +
        '</tbody></table>';

    html += reportNotesHtml(report) +
        '<div class="rp-total">' +
        `<span>期間合計：${totalAmountText(report.total)}</span>` +
        `<span class="rp-total-cn">${esc(numberToChineseCurrency(report.total))}</span>` +
        '</div>' +
        '</div>';
    return html;
}

/* ------------------------ 熱感紙報表 markup ------------------------ */

function buildReportThermalHtml(report) {
    let shop = getShopName();
    let html = '<div class="receipt">' +
        (shop ? `<div class="rc-shop">${esc(shop)}</div>` : '') +
        '<div class="rc-title">客戶購貨統計</div>' +
        '<div class="rc-rule"></div>' +
        receiptRow('客戶', report.clientName || '（未選擇）') +
        receiptRow('期間', reportPeriodText(report)) +
        receiptRow('單據數', String(report.invoices.length)) +
        '<div class="rc-rule"></div>';

    if (report.invoices.length === 0) {
        html += '<div class="rc-empty">期間內查無此客戶的單據。</div>' + reportNotesThermalHtml(report);
        return html + '</div>';
    }

    if (report.months.length > 1) {
        html += '<div class="rc-section">按月</div>';
        report.months.forEach(month => {
            html += receiptRow(monthKeyLabel(month.key) + '（' + month.count + ' 張）', formatMoney(month.amount), 'rc-detail');
        });
    }

    html += '<div class="rc-section">品項</div>';
    report.lines.forEach(line => {
        /* 與收據共用 receiptItem()：同一套 escape、同一個金額格式。
           彙整列沒有單一單價，price 留空即不會印「× 單價」。 */
        html += receiptItem({
            name: line.name,
            qty: formatQty(line.qty),
            unit: line.unit,
            price: '',
            amount: line.amount
        });
    });

    html += '<div class="rc-section">單據</div>';
    report.invoices.forEach(inv => {
        html += receiptRow(rocDateLabel(inv.date) + ' ' + inv.invoiceNo, formatMoney(inv.amount), 'rc-detail');
    });

    html += '<div class="rc-rule"></div>' +
        thermalTotalFooterHtml('期間合計', report.total) +
        reportNotesThermalHtml(report) +
        '</div>';
    return html;
}

function buildReportHtml(report, thermal) {
    return thermal ? buildReportThermalHtml(report) : buildReportA4Html(report);
}

/* ------------------------------- 介面 ------------------------------- */

function renderReportClientOptions() {
    let select = document.getElementById('reportClientSelect');
    if (!select) return;
    let previous = select.value;
    let clients = getReportClients();
    select.innerHTML = '';
    clients.forEach(name => {
        let opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });
    if (clients.indexOf(previous) !== -1) select.value = previous;
}

function markReportPreset(kind) {
    document.querySelectorAll('#reportPresets button[data-preset]').forEach(btn => {
        btn.classList.toggle('btn-active', btn.dataset.preset === kind);
    });
}

function applyReportPreset(kind) {
    let now = new Date();
    let from = null;
    let to = null;
    if (kind === 'month') {
        from = firstDayOfMonth(now);
        to = lastDayOfMonth(now);
    } else if (kind === 'prevMonth') {
        let prev = shiftMonths(now, -1);
        from = firstDayOfMonth(prev);
        to = lastDayOfMonth(prev);
    } else if (kind === 'quarter') {
        let quarter = currentQuarterRange(now);
        from = quarter.from;
        to = quarter.to;
    } else if (kind === 'year') {
        from = firstDayOfYear(now);
        to = lastDayOfYear(now);
    } else {
        kind = 'all';
    }
    setElementText('reportFrom', isoDateInput(from));
    setElementText('reportTo', isoDateInput(to));
    markReportPreset(kind);
    renderReport();
}

function renderReport() {
    let box = document.getElementById('reportResult');
    let printBtn = document.getElementById('printReportBtn');
    if (!box) return;

    let client = getReportClient();
    if (!client) {
        lastReport = null;
        box.innerHTML = '<p class="empty-row-hint">目前沒有可統計的客戶。請先儲存單據（💾 儲存單據）或在「👥 客戶管理」建立客戶。</p>';
        if (printBtn) printBtn.disabled = true;
        return;
    }

    let range = getReportRange();
    lastReport = computeCustomerReport(client, range.from, range.to);
    let preset = getPaperPreset();
    if (preset.thermal) {
        /* 螢幕預覽直接照熱感紙的寬度畫，所見即所印 */
        box.innerHTML = `<div class="report-preview-thermal" style="width: ${esc(thermalContentWidth(preset))}">` +
            buildReportThermalHtml(lastReport) + '</div>';
    } else {
        box.innerHTML = buildReportA4Html(lastReport);
    }
    if (printBtn) printBtn.disabled = !hasPrintableReport(lastReport);
}

/* 有單據可算，或有診斷訊息（日期待定、重複單號）值得留紙，就允許列印 */
function hasPrintableReport(report) {
    return report.invoices.length > 0 || reportNotes(report).length > 0;
}

function openReportModal() {
    renderReportClientOptions();
    let select = document.getElementById('reportClientSelect');
    let buyer = getElementText('buyer').trim();
    if (select && buyer) {
        let matched = Array.from(select.options).some(opt => opt.value === buyer);
        if (matched) select.value = buyer;
    }
    applyReportPreset('month');
    document.getElementById('reportModal').style.display = 'flex';
}

function printReport() {
    renderReport();
    if (!lastReport || !hasPrintableReport(lastReport)) {
        alert('目前沒有可列印的統計報表，請先確認客戶與期間。');
        return;
    }
    printHtml(buildReportHtml(lastReport, isThermalPaper()));
}
