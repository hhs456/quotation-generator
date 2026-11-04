/*
 * 大毛小毛火鍋料估價單產生器 — 金額轉國字大寫
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
   currency.js — 金額轉國字大寫
   載入順序第 2 棒：無依賴。
   ========================================================================== */

const CN_NUMS = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
const CN_RADICES = ['', '拾', '佰', '仟'];
const CN_UNITS = ['', '萬', '億', '兆', '京', '垓'];

/*
 * 以四位為一節切分，逐節組成後再接節單位。
 * 「零」只在「前面已有內容、且目前尚未掛零」時插入一次，避免
 * 貳萬零元整 / 壹億零零壹元整 這類多餘或重複的零。
 */
function numberToChineseCurrency(num) {
    let value = Math.round(Number(num));
    if (!isFinite(value) || value <= 0) return '零元整';

    let digits = String(value);
    let groups = [];
    while (digits.length > 4) {
        groups.unshift(digits.slice(-4));
        digits = digits.slice(0, -4);
    }
    groups.unshift(digits);

    let output = '';
    for (let i = 0; i < groups.length; i++) {
        let group = groups[i];
        let unit = CN_UNITS[groups.length - 1 - i] || '';
        let part = '';
        let zero = false;

        for (let j = 0; j < group.length; j++) {
            let n = parseInt(group[j], 10);
            let radix = group.length - 1 - j;
            if (n === 0) {
                zero = true;
                continue;
            }
            if (zero && (part !== '' || output !== '') && !part.endsWith('零') && !output.endsWith('零')) {
                part += '零';
            }
            zero = false;
            part += CN_NUMS[n] + CN_RADICES[radix];
        }

        if (part === '') {
            let restHasValue = false;
            for (let k = i + 1; k < groups.length; k++) {
                if (parseInt(groups[k], 10) !== 0) restHasValue = true;
            }
            if (restHasValue && output !== '' && !output.endsWith('零')) output += '零';
        } else {
            output += part + unit;
        }
    }

    output = output.replace(/零+$/, '');
    return output + '元整';
}
