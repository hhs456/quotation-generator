/*
 * 估價單產生器 — 品牌與發行預設值
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
   branding.js — 品牌與發行預設值
   載入順序第 1 棒：不依賴其他檔；其他檔於執行期讀取這裡的常數。
   發行給不同對象時只改這一支檔案，不要把店名與預設值散在 core.js 各處。
   ========================================================================== */

/* 產品名稱。用於文件標題（A4 列印頁首取自此处）與程式內文 */
const APP_NAME = '估價單產生器';

/*
 * 預設店家名稱。發行版刻意留空：
 * 尚未設定過時單據只印「估 價 單」，等使用者自己在「⚙️ 商品管理」填入。
 * 留空是刻意支援的狀態（見 README〈店家名稱〉），不是漏填。
 * 注意店家名稱存在 localStorage，不進 JSON 檔案，因此換機器會回到這個預設值。
 */
const SHOP_NAME = '';

/*
 * 預設單位清單。第一個元素同時作為「商品查無資料時」的兜底單位，
 * 所以清單不可為空——invoice.js / catalog.js 以 DEFAULT_UNITS[0] 取代舊的硬編碼。
 */
const DEFAULT_UNITS = ['個', '包', '盒', '箱', '公斤', '台斤'];

/* 預設商品基底。發行版刻意留空，讓每個對象從零建立自己的品項與定價 */
const DEFAULT_PRODUCTS = {};

/*
 * 流水單號的冷啟動基準。0 代表全新安裝的第一張單為 0000001。
 * 僅在 localStorage 與 JSON 檔案都沒有序號紀錄時才會用到；
 * 客戶若沿用既有單號體系，只改這裡，不要動 invoice.js 的推進邏輯。
 */
const SEQ_BASE = 0;
