import { state, recalcBalances, triggerRender } from './utils.js';
import { q, qA, gid, formatCur, formatDt, formatYMD } from './utils.js';

export const renderDropdowns = () => {
    const txs = state.currentUser.data.transactions.filter(t => t.type !== 'initial');
    // TypeError回避: t.date?.substring
    const months = [...new Set(txs.map(t => t.date?.substring(0, 7)).filter(Boolean))].sort().reverse();
    const buildOpts = (sel, val) => {
        sel.innerHTML = '<option value="all">全期間</option>' + months.map(m => `<option value="${m}" ${val === m ? 'selected' : ''}>${m.replace('-', '年')}月</option>`).join('');
    };
    buildOpts(gid('month-dropdown'), state.selectedMonth);
    buildOpts(gid('report-month-dropdown'), state.reportSelectedMonth);
};

export const renderDash = () => {
    const { accounts, transactions, settings } = state.currentUser.data;
    const validTx = transactions.filter(t => !t.isScheduled);

    const cashBal = accounts.reduce((s, a) => s + a.balance, 0);
    gid('total-balance').textContent = formatCur(cashBal);
    
    const scheduledExp = transactions.filter(t => t.isScheduled && t.withdrawal > 0).reduce((s, t) => s + t.withdrawal, 0);
    gid('scheduled-expense').textContent = formatCur(scheduledExp);

    const now = new Date();
    const mStr = formatDt(now).substring(0, 7);
    // TypeError回避: t.date?.substring
    const mTx = validTx.filter(t => t.date?.substring(0, 7) === mStr && t.type !== 'initial' && t.type !== 'transfer');
    const monthlyInc = mTx.reduce((s, t) => s + (t.deposit || 0), 0);
    const monthlyExp = mTx.reduce((s, t) => s + (t.withdrawal || 0), 0);
    gid('monthly-income').firstChild.textContent = `${formatCur(monthlyInc)} `;
    gid('monthly-expense').textContent = formatCur(monthlyExp);

    gid('account-balances').innerHTML = accounts.map(a => `<li><span>${a.name}</span><span>${formatCur(a.balance)}</span></li>`).join('') || '<li>なし</li>';

    const budget = settings.budget || 0;
    gid('budget-text').textContent = budget > 0 ? `${formatCur(monthlyExp)} / ${formatCur(budget)}` : '未設定';
    gid('budget-amount').value = budget || '';
    const pct = budget > 0 ? Math.min((monthlyExp / budget) * 100, 100) : 0;
    const pBar = gid('budget-progress');
    pBar.style.width = `${pct}%`;
    pBar.style.backgroundColor = pct > 90 ? 'var(--expense-color)' : (pct > 70 ? 'var(--warning-color)' : 'var(--primary-color)');
};

export const renderHistory = () => {
    const tb = gid('history-table-body');
    tb.innerHTML = '';
    let txs = state.currentUser.data.transactions.filter(t => t.type !== 'initial');
    if (state.selectedMonth !== 'all') {
        // TypeError回避
        txs = txs.filter(t => t.date?.substring(0, 7) === state.selectedMonth);
    }
    if (state.historyStatus === 'completed') txs = txs.filter(t => !t.isScheduled);
    if (state.historyStatus === 'scheduled') txs = txs.filter(t => t.isScheduled);

    txs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).forEach(tx => {
        const tr = document.createElement('tr');
        const statusHtml = tx.isScheduled ? `<span class="status-tag scheduled">予定 ${tx.autoExec ? '(自動)' : ''}</span>` : '<span class="status-tag completed">完了</span>';
        const cat = state.currentUser.data.categories.find(c => c.id === tx.categoryId);
        const catHtml = cat ? `<span class="category-tag" style="background-color:${cat.color};">${cat.name}</span>` : '';

        let accName, incHtml = '', expHtml = '', diffHtml = '';
        if (tx.type === 'transfer') {
            const f = state.currentUser.data.accounts.find(a => a.id === tx.accountId)?.name || '不明';
            const t = state.currentUser.data.accounts.find(a => a.id === tx.toAccountId)?.name || '不明';
            accName = `${f} <i class="fas fa-arrow-right"></i> ${t}`;
            diffHtml = `<span style="color:#3498db;">振替 ${formatCur(tx.amount)}</span>`;
        } else {
            accName = state.currentUser.data.accounts.find(a => a.id === tx.accountId)?.name || '不明';
            incHtml = tx.deposit > 0 ? `<span class="income-color">${formatCur(tx.deposit)}</span>` : '';
            expHtml = tx.withdrawal > 0 ? `<span class="expense-color">${formatCur(tx.withdrawal)}</span>` : '';
            const diff = (tx.deposit || 0) - (tx.withdrawal || 0);
            diffHtml = `<span class="${diff >= 0 ? 'income-color' : 'expense-color'}">${formatCur(diff, true)}</span>`;
        }

        let actHtml = `<div class="action-buttons">`;
        if (tx.isScheduled) actHtml += `<button class="exec-tx" data-id="${tx.id}"><i class="fas fa-check-circle"></i></button>`;
        actHtml += `<button class="edit-tx" data-id="${tx.id}"><i class="fas fa-edit"></i></button><button class="del-tx" data-id="${tx.id}"><i class="fas fa-trash"></i></button></div>`;
        tr.innerHTML = `<td>${statusHtml}</td><td>${tx.date ? formatDt(tx.date) : '不明'}</td><td>${catHtml}</td><td>${accName}</td><td>${incHtml}</td><td>${expHtml}</td><td>${diffHtml}</td><td>${tx.memo || ''}</td><td>${actHtml}</td>`;
        tb.appendChild(tr);
    });
};

export const renderHistoryCalendar = () => {
    gid('hist-cal-month-year').textContent = `${state.histCal.year}年 ${state.histCal.month + 1}月`;
    const grid = gid('history-calendar-grid');
    grid.innerHTML = '<div class="cal-day-header">日</div><div class="cal-day-header">月</div><div class="cal-day-header">火</div><div class="cal-day-header">水</div><div class="cal-day-header">木</div><div class="cal-day-header">金</div><div class="cal-day-header">土</div>';
    
    const firstDay = new Date(state.histCal.year, state.histCal.month, 1).getDay();
    const daysInMonth = new Date(state.histCal.year, state.histCal.month + 1, 0).getDate();
    
    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-cell empty';
        grid.appendChild(empty);
    }
    
    const txs = state.currentUser.data.transactions.filter(t => t.type !== 'initial');
    const mStrPrefix = formatYMD(state.histCal.year, state.histCal.month + 1, 1).substring(0, 8);
    
    const dailyData = {};
    txs.forEach(t => {
        if (!t.date) return;
        if (t.date.startsWith(mStrPrefix)) {
            const dStr = t.date;
            if (!dailyData[dStr]) dailyData[dStr] = { inc: 0, exp: 0, sInc: 0, sExp: 0 };
            if (t.isScheduled) {
                dailyData[dStr].sInc += (t.deposit || 0);
                dailyData[dStr].sExp += (t.withdrawal || 0);
            } else {
                dailyData[dStr].inc += (t.deposit || 0);
                dailyData[dStr].exp += (t.withdrawal || 0);
            }
        }
    });

    for (let d = 1; d <= daysInMonth; d++) {
        const dStr = formatYMD(state.histCal.year, state.histCal.month + 1, d);
        const cell = document.createElement('div');
        cell.className = 'hist-cal-cell';
        
        let html = `<div class="hist-cal-date">${d}</div>`;
        if (dailyData[dStr]) {
            if (dailyData[dStr].inc > 0) html += `<div class="hist-cal-inc">+${dailyData[dStr].inc.toLocaleString()}</div>`;
            if (dailyData[dStr].exp > 0) html += `<div class="hist-cal-exp">-${dailyData[dStr].exp.toLocaleString()}</div>`;
            if (dailyData[dStr].sInc > 0) html += `<div class="hist-cal-inc scheduled-text">[予] +${dailyData[dStr].sInc.toLocaleString()}</div>`;
            if (dailyData[dStr].sExp > 0) html += `<div class="hist-cal-exp scheduled-text">[予] -${dailyData[dStr].sExp.toLocaleString()}</div>`;
        }
        
        cell.innerHTML = html;
        grid.appendChild(cell);
    }
};

export const renderAccounts = () => {
    const accs = state.currentUser.data.accounts;
    const opts = `<option value="" disabled selected>選択してください</option>` + accs.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    ['account-select', 'transfer-from', 'transfer-to', 'scheduled-account-select', 'rec-account-select', 'adjust-account-select', 'edit-account-select'].forEach(id => {
        const el = gid(id);
        if (el) {
            const val = el.value;
            el.innerHTML = opts;
            if (val) el.value = val;
        }
    });

    gid('accounts-table-body').innerHTML = accs.map(a => {
        return `<tr>
            <td><strong>${a.name}</strong></td>
            <td><strong>${formatCur(a.balance)}</strong></td>
            <td class="action-buttons"><button class="del-acc" data-id="${a.id}"><i class="fas fa-trash"></i></button></td>
        </tr>`;
    }).join('');
    if (gid('adjust-account-select').value)
        gid('current-app-balance').textContent = formatCur(accs.find(a => a.id === parseInt(gid('adjust-account-select').value))?.balance || 0);
};

export const renderCategories = () => {
    const cats = state.currentUser.data.categories;
    const accs = state.currentUser.data.accounts;
    const opts = `<option value="">なし</option>` + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    ['category-select', 'scheduled-category-select', 'rec-category-select', 'edit-category-select'].forEach(id => {
        const el = gid(id);
        if (el) {
            const val = el.value;
            el.innerHTML = opts;
            if (val) el.value = val;
        }
    });
    gid('category-account-link').innerHTML = `<option value="">設定しない</option>` + accs.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    gid('categories-table-body').innerHTML = cats.map(c => `<tr><td><span class="category-tag" style="background-color:${c.color}">${c.name}</span></td><td>${accs.find(a => a.id === c.defaultAccountId)?.name || 'なし'}</td><td class="action-buttons"><button class="del-cat" data-id="${c.id}"><i class="fas fa-trash"></i></button></td></tr>`).join('');
};

export const renderCharts = () => {
    const { transactions } = state.currentUser.data;
    // 予定(scheduled)以外の有効な取引を日付順にソート
    const validTx = transactions.filter(t => !t.isScheduled);
    const sTxs = [...validTx].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    
    if (sTxs.length > 0) {
        // --- 口座別資産推移グラフの計算を最適化 ---
        
        // 1. 今日の日付文字列を取得
        const today = new Date();
        const todayStr = formatYMD(today.getFullYear(), today.getMonth() + 1, today.getDate());
        
        // 2. グラフの開始日を決定（一番古い「initial」以外の取引日。なければ今日）
        let startDStr = todayStr;
        const firstTx = sTxs.find(t => t.type !== 'initial' && t.date);
        if (firstTx) {
            startDStr = firstTx.date.substring(0, 10);
        }

        // 3. グラフの終了日を決定（基本は今日。もし未来の取引があればその日まで）
        let endDStr = todayStr;
        const lastTx = sTxs[sTxs.length - 1];
        if (lastTx && lastTx.date && lastTx.date.substring(0, 10) > endDStr) {
            endDStr = lastTx.date.substring(0, 10);
        }

        // 4. 初期残高（initial）の集計
        let currentBalances = {};
        state.currentUser.data.accounts.forEach(a => {
            currentBalances[a.id] = sTxs.find(t => t.accountId === a.id && t.type === 'initial')?.amount || 0;
        });

        // 5. 日付ごとに取引をグループ化
        const txByDate = {};
        sTxs.filter(t => t.type !== 'initial').forEach(t => {
            if (!t.date) return;
            const dStr = t.date.substring(0, 10);
            if (!txByDate[dStr]) txByDate[dStr] = [];
            txByDate[dStr].push(t);
        });

        // 6. 開始日から終了日まで1日ずつ残高を計算し、配列に格納
        const labels = [];
        const dMap = new Map();
        let d = new Date(startDStr + "T00:00:00");
        const endD = new Date(endDStr + "T00:00:00");

        while (d <= endD) {
            const k = formatYMD(d.getFullYear(), d.getMonth() + 1, d.getDate());
            labels.push(k);
            
            // この日の取引があれば適用
            if (txByDate[k]) {
                txByDate[k].forEach(t => {
                    if (t.type === 'transfer') {
                        if (currentBalances[t.accountId] !== undefined) currentBalances[t.accountId] -= t.amount;
                        if (currentBalances[t.toAccountId] !== undefined) currentBalances[t.toAccountId] += t.amount;
                    } else {
                        if (currentBalances[t.accountId] !== undefined) currentBalances[t.accountId] += (t.deposit || 0) - (t.withdrawal || 0);
                    }
                });
            }
            
            // スナップショットを保存
            const snapshot = { tot: 0 };
            state.currentUser.data.accounts.forEach(a => {
                snapshot[a.id] = currentBalances[a.id];
                snapshot.tot += currentBalances[a.id];
            });
            dMap.set(k, snapshot);
            
            d.setDate(d.getDate() + 1);
        }

        // 7. Chart.js 用のデータセットを作成
        const cols = ['#3498db', '#e74c3c', '#9b59b6', '#2ecc71', '#f1c40f', '#1abc9c', '#34495e'];
        const ds = [{
            label: '全口座合計',
            data: labels.map(dateKey => dMap.get(dateKey).tot),
            borderColor: 'rgba(0,0,0,0.8)',
            backgroundColor: 'rgba(0,0,0,0.05)',
            type: 'line',
            borderWidth: 3,
            fill: true,
            pointRadius: 0
        }];
        
        state.currentUser.data.accounts.forEach((a, i) => ds.push({
            label: a.name,
            data: labels.map(dateKey => dMap.get(dateKey)[a.id]),
            borderColor: cols[i % cols.length],
            type: 'line',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0
        }));
        
        // 8. 描画
        if (state.charts.bal) state.charts.bal.destroy();
        state.charts.bal = new Chart(gid('balance-chart').getContext('2d'), {
            data: { labels: labels, datasets: ds },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: { 
                    x: { type: 'time', time: { unit: 'month' } }, 
                    y: { ticks: { callback: v => `¥ ${v.toLocaleString()}` } } 
                }
            }
        });
    }

    // --- 月毎収入・支出グラフ ---
    const repD = {};
    validTx.filter(t => t.type !== 'initial' && t.type !== 'transfer').forEach(t => {
        if (!t.date) return;
        const m = t.date.substring(0, 7);
        if (!repD[m]) repD[m] = { inc: 0, exp: 0 };
        repD[m].inc += t.deposit || 0;
        repD[m].exp += t.withdrawal || 0;
    });
    const rMs = Object.keys(repD).sort();
    const rLs = rMs.map(m => `${m.substring(0, 4)}/${m.substring(5, 7)}`);
    if (state.charts.rep) state.charts.rep.destroy();
    state.charts.rep = new Chart(gid('report-chart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: rLs,
            datasets: [
                { label: '収入', data: rMs.map(m => repD[m].inc), backgroundColor: 'rgba(46,204,113,0.8)' },
                { label: '支出', data: rMs.map(m => repD[m].exp), backgroundColor: 'rgba(231,76,60,0.8)' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });

    // --- カテゴリ別支出グラフ ---
    let tCat = validTx.filter(t => t.type !== 'initial' && t.type !== 'transfer');
    if (state.reportSelectedMonth !== 'all') {
        tCat = tCat.filter(t => t.date?.substring(0, 7) === state.reportSelectedMonth);
    }
    const pData = {};
    tCat.forEach(t => {
        if (t.withdrawal > 0) {
            const c = t.categoryId || 'unknown';
            pData[c] = (pData[c] || 0) + t.withdrawal;
        }
    });
    const pLbls = [], pVals = [], pCols = [];
    Object.keys(pData).forEach(cId => {
        if (cId === 'unknown') {
            pLbls.push('未分類'); pVals.push(pData[cId]); pCols.push('#bdc3c7');
        } else {
            const c = state.currentUser.data.categories.find(ca => ca.id == cId);
            if (c) { pLbls.push(c.name); pVals.push(pData[cId]); pCols.push(c.color); }
        }
    });
    if (state.charts.cat) state.charts.cat.destroy();
    state.charts.cat = new Chart(gid('category-chart').getContext('2d'), {
        type: 'doughnut',
        data: { labels: pLbls, datasets: [{ data: pVals, backgroundColor: pCols, borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });
};

export const renderPeriodList = () => {
    const list = gid('cal-period-list');
    list.innerHTML = '';
    state.cal.periods.forEach((p, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${p.start} 〜 ${p.end}</span> <i class="fas fa-times" style="color:var(--expense-color); cursor:pointer; padding:5px;"></i>`;
        li.querySelector('i').onclick = (e) => {
            e.stopPropagation();
            state.cal.periods.splice(idx, 1);
            renderCalendarUI();
        };
        list.appendChild(li);
    });
    
    if (state.cal.mode === 'period') {
        gid('cal-period-list-container').style.display = 'block';
        gid('cal-period-help').style.display = 'block';
    } else {
        gid('cal-period-list-container').style.display = 'none';
        gid('cal-period-help').style.display = 'none';
    }
};

export const handleCalClick = (dStr) => {
    if (state.cal.mode === 'include') {
        if (state.cal.includes.has(dStr)) state.cal.includes.delete(dStr);
        else state.cal.includes.add(dStr);
        state.cal.excludes.delete(dStr);
    } else if (state.cal.mode === 'exclude') {
        if (state.cal.excludes.has(dStr)) state.cal.excludes.delete(dStr);
        else state.cal.excludes.add(dStr);
        state.cal.includes.delete(dStr);
    } else if (state.cal.mode === 'period') {
        if (!state.cal.periodTempStart) {
            state.cal.periodTempStart = dStr;
        } else {
            let start = state.cal.periodTempStart;
            let end = dStr;
            if (start > end) { [start, end] = [end, start]; }
            state.cal.periods.push({ start, end });
            state.cal.periodTempStart = null;
        }
    }
    renderCalendarUI();
};

export const renderCalendarUI = () => {
    gid('cal-month-year').textContent = `${state.cal.currentYear}年 ${state.cal.currentMonth + 1}月`;
    const grid = gid('modal-calendar-grid'); 
    const headers = grid.querySelectorAll('.cal-day-header');
    grid.innerHTML = '';
    headers.forEach(h => grid.appendChild(h));
    
    const firstDay = new Date(state.cal.currentYear, state.cal.currentMonth, 1).getDay();
    const daysInMonth = new Date(state.cal.currentYear, state.cal.currentMonth + 1, 0).getDate();
    
    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-cell empty';
        grid.appendChild(empty);
    }
    
    for (let d = 1; d <= daysInMonth; d++) {
        const cell = document.createElement('div');
        cell.className = 'cal-cell';
        cell.textContent = d;
        const dStr = formatYMD(state.cal.currentYear, state.cal.currentMonth + 1, d);
        
        if (state.cal.includes.has(dStr)) cell.classList.add('include');
        if (state.cal.excludes.has(dStr)) cell.classList.add('exclude');
        
        let isPeriod = false;
        let isStart = false;
        let isEnd = false;
        state.cal.periods.forEach(p => {
            if (dStr >= p.start && dStr <= p.end) {
                isPeriod = true;
                if (dStr === p.start) isStart = true;
                if (dStr === p.end) isEnd = true;
            }
        });
        
        if (isPeriod) {
            cell.classList.add('period');
            if (isStart && isEnd) cell.classList.add('period-single');
            else if (isStart) cell.classList.add('period-start');
            else if (isEnd) cell.classList.add('period-end');
        }
        
        if (state.cal.periodTempStart === dStr) {
            cell.classList.add('period-start');
            cell.style.opacity = '0.7';
        }
        
        cell.onclick = () => handleCalClick(dStr);
        grid.appendChild(cell);
    }
    renderPeriodList();
};

// メインの描画関数エクスポート
export const render = async () => {
    if (!state.currentUser) return;
    recalcBalances();
    renderDropdowns();
    renderDash();
    renderHistory();
    renderHistoryCalendar();
    renderAccounts();
    renderCategories();
    renderCharts();
};