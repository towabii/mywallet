const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyEXSiaJviDI_PTStiB7tXcDfTZ-k4AmDmXohuiSJwK5mZ3vmPc7JpsL9nvfbEwaSkJ/exec';

document.addEventListener('DOMContentLoaded', () => {
    // --- STATE ---
    let state = {
        currentUser: null,
        selectedMonth: 'all',
        historyStatus: 'all',
        reportSelectedMonth: 'all',
        charts: {},
        isOffline: !navigator.onLine,
        hasLocalChanges: false,
        cal: {
            currentYear: new Date().getFullYear(),
            currentMonth: new Date().getMonth(),
            mode: 'include',
            includes: new Set(),
            excludes: new Set(),
            periods:[],
            periodTempStart: null
        },
        histCal: {
            year: new Date().getFullYear(),
            month: new Date().getMonth()
        }
    };

    // --- DOM Elements ---
    const q = s => document.querySelector(s);
    const qA = s => document.querySelectorAll(s);
    const gid = id => document.getElementById(id);

    const views = qA('.view');
    const navLinks = qA('.nav-link');
    const loading = gid('loading-overlay');
    const offlineBanner = gid('offline-banner');
    const toastContainer = gid('toast-container');

    // --- UTILITIES ---
    const showLoading = () => loading.style.display = 'flex';
    const hideLoading = () => loading.style.display = 'none';
    const simpleHash = str => {
        let h = 0;
        for (let i = 0; i < str.length; i++)
            h = Math.imul(31, h) + str.charCodeAt(i) | 0;
        return h.toString();
    };
    const formatCur = (v, sign) => `${sign && v > 0 ? '+' : ''}¥ ${Math.round(v).toLocaleString()}`;
    const formatDt = d => new Date(d).toISOString().split('T')[0];
    const formatYMD = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const showToast = msg => {
        const t = document.createElement('div');
        t.className = 'toast';
        t.textContent = msg;
        toastContainer.appendChild(t);
        setTimeout( () => t.remove(), 4000);
    };

    // --- NOTIFICATIONS ---
    const requestPushPerm = async () => {
        if ('Notification'in window && Notification.permission === 'default')
            await Notification.requestPermission();
    };
    const notifyUser = (title, body) => {
        if ('Notification'in window && Notification.permission === 'granted')
            new Notification(title,{ body, icon: '/icon.png' });
        else
            showToast(`[通知] ${title}: ${body}`);
    };

    // --- API & SYNC ---
    window.addEventListener('online', () => {
        state.isOffline = false;
        offlineBanner.style.display = 'none';
        syncData();
    });
    window.addEventListener('offline', () => {
        state.isOffline = true;
        offlineBanner.style.display = 'block';
    });

    async function callGasApi(action, payload, showLd=false) {
        if (showLd) showLoading();
        try {
            if (state.isOffline &&['updateUserData'].includes(action)) throw new Error('offline');
            const res = await fetch(GAS_WEB_APP_URL, {
                method: 'POST',
                body: JSON.stringify({ action, payload })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const result = await res.json();
            if (result.status === 'error') throw new Error(result.message);
            if (result.status === 'conflict') return result;
            return result;
        } catch (e) {
            if (e.message === 'offline' || e.message === 'Failed to fetch') {
                if (action === 'updateUserData') {
                    state.hasLocalChanges = true;
                    localStorage.setItem('localChanges', JSON.stringify(payload.userData));
                    showToast('オフラインのためローカルに保存しました');
                    return { status: 'success' };
                }
            } else {
                console.error(e);
                if (showLd) showToast(`エラー: ${e.message}`);
            }
            return null;
        } finally {
            if (showLd) hideLoading();
        }
    }

    async function syncData() {
        if (!state.currentUser || !state.hasLocalChanges) return;
        const localData = JSON.parse(localStorage.getItem('localChanges'));
        if (!localData) return;

        const res = await callGasApi('syncData', {
            userId: state.currentUser.id,
            userData: localData,
            lastSyncedAt: state.currentUser.updatedAt || 0
        }, true);
        if (res && res.status === 'success') {
            state.hasLocalChanges = false;
            localStorage.removeItem('localChanges');
            state.currentUser = res.userData;
            showToast('サーバーと同期完了');
            render();
        } else if (res && res.status === 'conflict') {
            gid('conflict-modal').classList.add('visible');
            gid('conflict-use-server').onclick = () => {
                state.hasLocalChanges = false;
                localStorage.removeItem('localChanges');
                state.currentUser = res.serverData;
                gid('conflict-modal').classList.remove('visible');
                render();
            };
            gid('conflict-use-local').onclick = async () => {
                localData.updatedAt = Date.now();
                await callGasApi('updateUserData', {
                    userId: state.currentUser.id,
                    userData: localData
                }, true);
                state.hasLocalChanges = false;
                localStorage.removeItem('localChanges');
                state.currentUser = localData;
                gid('conflict-modal').classList.remove('visible');
                render();
            };
        }
    }

    const saveUser = async () => {
        state.currentUser.updatedAt = Date.now();
        localStorage.setItem(`selectedMonth_${state.currentUser.id}`, state.selectedMonth);
        await callGasApi('updateUserData', {
            userId: state.currentUser.id,
            userData: state.currentUser
        });
    };
    const initUserData = (user) => {
        if (!user.data.settings) user.data.settings = { budget: 0 };
        return user;
    };

    const recalcBalances = () => {
        state.currentUser.data.accounts.forEach(acc => {
            acc.balance = state.currentUser.data.transactions.find(tx => tx.accountId === acc.id && tx.type === 'initial')?.amount || 0;
        });
        const validTx = state.currentUser.data.transactions.filter(tx => tx.type !== 'initial' && !tx.isScheduled).sort((a, b) => new Date(a.date) - new Date(b.date));
        validTx.forEach(tx => {
            if (tx.type === 'transfer') {
                const f = state.currentUser.data.accounts.find(a => a.id === tx.accountId);
                const t = state.currentUser.data.accounts.find(a => a.id === tx.toAccountId);
                if (f) f.balance -= tx.amount;
                if (t) t.balance += tx.amount;
            } else {
                const acc = state.currentUser.data.accounts.find(a => a.id === tx.accountId);
                if (acc) acc.balance += (tx.deposit || 0) - (tx.withdrawal || 0);
            }
        });
    };

    const runChecks = () => {
        const {transactions, settings} = state.currentUser.data;
        if (!settings.budget || settings.budget <= 0)
            notifyUser('予算未設定', '予算を設定しましょう。');
        const overdue = transactions.filter(tx => tx.isScheduled && !tx.autoExec && tx.date < formatDt(new Date()));
        if (overdue.length > 0)
            notifyUser('未実行の予定', `手動実行待ちの予定が ${overdue.length} 件あります。`);
    };

    const checkAutoExec = () => {
        let changed = false;
        const todayStr = formatDt(new Date());
        state.currentUser.data.transactions.forEach(tx => {
            if (tx.isScheduled && tx.autoExec && tx.date <= todayStr) {
                tx.isScheduled = false;
                changed = true;
            }
        });
        return changed;
    };

    // --- RENDERING ---
    const render = async () => {
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

    const renderDropdowns = () => {
        const txs = state.currentUser.data.transactions.filter(t => t.type !== 'initial');
        const months =[...new Set(txs.map(t => t.date.substring(0, 7)))].sort().reverse();
        const buildOpts = (sel, val) => {
            sel.innerHTML = '<option value="all">全期間</option>' + months.map(m => `<option value="${m}" ${val === m ? 'selected' : ''}>${m.replace('-', '年')}月</option>`).join('');
        };
        buildOpts(gid('month-dropdown'), state.selectedMonth);
        buildOpts(gid('report-month-dropdown'), state.reportSelectedMonth);
    };

    const renderDash = () => {
        const {accounts, transactions, settings} = state.currentUser.data;
        const validTx = transactions.filter(t => !t.isScheduled);

        const cashBal = accounts.reduce((s, a) => s + a.balance, 0);
        gid('total-balance').textContent = formatCur(cashBal);
        
        const scheduledExp = transactions.filter(t => t.isScheduled && t.withdrawal > 0).reduce((s, t) => s + t.withdrawal, 0);
        gid('scheduled-expense').textContent = formatCur(scheduledExp);

        const now = new Date();
        const mStr = formatDt(now).substring(0, 7);
        const mTx = validTx.filter(t => t.date.substring(0, 7) === mStr && t.type !== 'initial' && t.type !== 'transfer');
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

    const renderHistory = () => {
        const tb = gid('history-table-body');
        tb.innerHTML = '';
        let txs = state.currentUser.data.transactions.filter(t => t.type !== 'initial');
        if (state.selectedMonth !== 'all')
            txs = txs.filter(t => t.date.substring(0, 7) === state.selectedMonth);
        if (state.historyStatus === 'completed')
            txs = txs.filter(t => !t.isScheduled);
        if (state.historyStatus === 'scheduled')
            txs = txs.filter(t => t.isScheduled);

        txs.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(tx => {
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
            if (tx.isScheduled)
                actHtml += `<button class="exec-tx" data-id="${tx.id}"><i class="fas fa-check-circle"></i></button>`;
            actHtml += `<button class="edit-tx" data-id="${tx.id}"><i class="fas fa-edit"></i></button><button class="del-tx" data-id="${tx.id}"><i class="fas fa-trash"></i></button></div>`;
            tr.innerHTML = `<td>${statusHtml}</td><td>${formatDt(tx.date)}</td><td>${catHtml}</td><td>${accName}</td><td>${incHtml}</td><td>${expHtml}</td><td>${diffHtml}</td><td>${tx.memo}</td><td>${actHtml}</td>`;
            tb.appendChild(tr);
        });
    };

    const renderHistoryCalendar = () => {
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
        
        // 予定を含めて集計する
        const txs = state.currentUser.data.transactions.filter(t => t.type !== 'initial');
        const mStrPrefix = formatYMD(state.histCal.year, state.histCal.month + 1, 1).substring(0, 8);
        
        const dailyData = {};
        txs.forEach(t => {
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

    const renderAccounts = () => {
        const accs = state.currentUser.data.accounts;
        const opts = `<option value="" disabled selected>選択してください</option>` + accs.map(a => `<option value="${a.id}">${a.name}</option>`).join('');['account-select', 'transfer-from', 'transfer-to', 'scheduled-account-select', 'rec-account-select', 'adjust-account-select', 'edit-account-select'].forEach(id => {
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

    const renderCategories = () => {
        const cats = state.currentUser.data.categories;
        const accs = state.currentUser.data.accounts;
        const opts = `<option value="">なし</option>` + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');['category-select', 'scheduled-category-select', 'rec-category-select', 'edit-category-select'].forEach(id => {
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

    const renderCharts = () => {
        const {transactions} = state.currentUser.data;
        const validTx = transactions.filter(t => !t.isScheduled);

        // 口座別資産推移グラフ
        const sTxs = [...validTx].sort((a, b) => new Date(a.date) - new Date(b.date));
        if (sTxs.length > 0) {
            const dMap = new Map();
            const endD = new Date();
            for (let d = new Date(sTxs[0].date); d <= endD; d.setDate(d.getDate() + 1)) {
                const k = formatDt(d);
                const b = { tot: 0 };
                state.currentUser.data.accounts.forEach(a => b[a.id] = 0);
                dMap.set(k, b);
            }
            let cBal = {};
            state.currentUser.data.accounts.forEach(a => {
                cBal[a.id] = sTxs.find(t => t.accountId === a.id && t.type === 'initial')?.amount || 0;
            });
            dMap.forEach(b => state.currentUser.data.accounts.forEach(a => b[a.id] = cBal[a.id]));
            sTxs.filter(t => t.type !== 'initial').forEach(t => {
                if (t.type === 'transfer') {
                    cBal[t.accountId] -= t.amount;
                    cBal[t.toAccountId] += t.amount;
                } else {
                    cBal[t.accountId] += (t.deposit || 0) - (t.withdrawal || 0);
                }
                for (let d = new Date(t.date); d <= endD; d.setDate(d.getDate() + 1)) {
                    const k = formatDt(d);
                    if (dMap.has(k)) state.currentUser.data.accounts.forEach(a => dMap.get(k)[a.id] = cBal[a.id]);
                }
            });
            dMap.forEach(b => b.tot = Object.values(b).reduce((s, v) => typeof v === 'number' ? s + v : s, 0));
            const lbls = Array.from(dMap.keys()), cols =['#3498db', '#e74c3c', '#9b59b6', '#2ecc71', '#f1c40f', '#1abc9c', '#34495e'];
            const ds =[{
                label: '全口座合計',
                data: lbls.map(d => dMap.get(d).tot),
                borderColor: 'rgba(0,0,0,0.8)',
                backgroundColor: 'rgba(0,0,0,0.05)',
                type: 'line',
                borderWidth: 3,
                fill: true,
                pointRadius: 0
            }];
            state.currentUser.data.accounts.forEach((a, i) => ds.push({
                label: a.name,
                data: lbls.map(d => dMap.get(d)[a.id]),
                borderColor: cols[i % cols.length],
                type: 'line',
                borderWidth: 1.5,
                fill: false,
                pointRadius: 0
            }));
            if (state.charts.bal) state.charts.bal.destroy();
            state.charts.bal = new Chart(gid('balance-chart').getContext('2d'), {
                data: { labels: lbls, datasets: ds },
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

        // 月毎収入・支出
        const repD = {};
        validTx.filter(t => t.type !== 'initial' && t.type !== 'transfer').forEach(t => {
            const m = t.date.substring(0, 7);
            if (!repD[m]) repD[m] = { inc: 0, exp: 0 };
            repD[m].inc += t.deposit || 0;
            repD[m].exp += t.withdrawal || 0;
        });
        const rMs = Object.keys(repD).sort();
        const rLs = rMs.map(m => `${m.substring(0, 4)}/${m.substring(5, 7)}`);
        if (state.charts.rep) state.charts.rep.destroy();
        state.charts.rep = new Chart(gid('report-chart').getContext('2d'),{
            type: 'bar',
            data: {
                labels: rLs,
                datasets:[
                    { label: '収入', data: rMs.map(m => repD[m].inc), backgroundColor: 'rgba(46,204,113,0.8)' },
                    { label: '支出', data: rMs.map(m => repD[m].exp), backgroundColor: 'rgba(231,76,60,0.8)' }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });

        // カテゴリ支出グラフ
        let tCat = validTx.filter(t => t.type !== 'initial' && t.type !== 'transfer');
        if (state.reportSelectedMonth !== 'all')
            tCat = tCat.filter(t => t.date.substring(0, 7) === state.reportSelectedMonth);
        const pData = {};
        tCat.forEach(t => {
            if (t.withdrawal > 0) {
                const c = t.categoryId || 'unknown';
                pData[c] = (pData[c] || 0) + t.withdrawal;
            }
        });
        const pLbls = [], pVals =[], pCols =[];
        Object.keys(pData).forEach(cId => {
            if (cId === 'unknown') {
                pLbls.push('未分類'); pVals.push(pData[cId]); pCols.push('#bdc3c7');
            } else {
                const c = state.currentUser.data.categories.find(ca => ca.id == cId);
                if (c) { pLbls.push(c.name); pVals.push(pData[cId]); pCols.push(c.color); }
            }
        });
        if (state.charts.cat) state.charts.cat.destroy();
        state.charts.cat = new Chart(gid('category-chart').getContext('2d'),{
            type: 'doughnut',
            data: { labels: pLbls, datasets:[{ data: pVals, backgroundColor: pCols, borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
        });
    };

    // --- CALENDAR LOGIC ---
    const renderCalendarUI = () => {
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

    const handleCalClick = (dStr) => {
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
                if (start > end) {[start, end] = [end, start]; }
                state.cal.periods.push({ start, end });
                state.cal.periodTempStart = null;
            }
        }
        renderCalendarUI();
    };

    const renderPeriodList = () => {
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

    // --- EVENT LISTENERS ---
    const setupEvents = () => {
        gid('show-signup').onclick = e => {
            e.preventDefault();
            gid('login-form').style.display = 'none';
            gid('signup-form').style.display = 'block';
        };
        gid('show-login').onclick = e => {
            e.preventDefault();
            gid('signup-form').style.display = 'none';
            gid('login-form').style.display = 'block';
        };
        gid('login-form').onsubmit = async e => {
            e.preventDefault();
            const res = await callGasApi('login', {
                email: gid('login-email').value,
                passwordHash: simpleHash(gid('login-password').value)
            }, true);
            if (res && res.status === 'success') {
                localStorage.setItem('uid', res.userId);
                init();
            }
        };
        gid('signup-form').onsubmit = async e => {
            e.preventDefault();
            const email = gid('signup-email').value, pwd = gid('signup-password').value, bk = Array(16).fill(0).map(()=>Math.floor(Math.random()*16).toString(16)).join('');
            const res = await callGasApi('signup', { email, passwordHash: simpleHash(pwd), backupKeyHash: simpleHash(bk) }, true);
            if (res && res.status === 'success') {
                gid('new-backup-key').textContent = bk;
                gid('backup-key-modal').classList.add('visible');
            }
        };
        gid('copy-backup-key-btn').onclick = () => navigator.clipboard.writeText(gid('new-backup-key').textContent).then(()=>showToast('コピーしました'));
        gid('logout-btn').onclick = () => {
            if (confirm('ログアウトしますか？')) {
                localStorage.removeItem('uid');
                location.reload();
            }
        };

        navLinks.forEach(l => l.onclick = e => {
            e.preventDefault();
            const vId = l.dataset.view;
            views.forEach(v => v.classList.remove('active'));
            gid(vId).classList.add('active');
            navLinks.forEach(nl => nl.classList.remove('active'));
            qA(`.nav-link[data-view="${vId}"]`).forEach(nl => nl.classList.add('active'));
            gid('main-title').textContent = l.querySelector('span').textContent;
        });
        qA('.tab-btn').forEach(b => b.onclick = () => {
            // モーダルや履歴表示用のタブは除外
            if(b.closest('#calendar-modal') || b.closest('#transactions')) return;
            
            qA('.tab-btn:not(#calendar-modal .tab-btn):not(#transactions .tab-btn)').forEach(tb => tb.classList.remove('active'));
            qA('.tab-content').forEach(tc => tc.classList.remove('active'));
            b.classList.add('active');
            gid(`tab-${b.dataset.tab}`).classList.add('active');
        });

        gid('transaction-form').onsubmit = async e => {
            e.preventDefault();
            const aId = parseInt(gid('account-select').value), cId = parseInt(gid('category-select').value) || null, amt = parseFloat(gid('tx-amount').value), isInc = q('input[name="tx-type"]:checked').value === 'income';
            state.currentUser.data.transactions.push({
                id: Date.now(), accountId: aId, categoryId: cId, date: gid('date').value,
                deposit: isInc ? amt : 0, withdrawal: !isInc ? amt : 0, memo: gid('memo').value, isScheduled: false, autoExec: false
            });
            gid('transaction-form').reset();
            gid('date').value = formatDt(new Date());
            render();
            await saveUser();
        };
        gid('transfer-form').onsubmit = async e => {
            e.preventDefault();
            const f = parseInt(gid('transfer-from').value), t = parseInt(gid('transfer-to').value), amt = parseFloat(gid('transfer-amount').value);
            if (f === t) return alert('同じ口座です');
            state.currentUser.data.transactions.push({
                id: Date.now(), type: 'transfer', accountId: f, toAccountId: t, amount: amt, date: gid('transfer-date').value, memo: gid('transfer-memo').value, isScheduled: false, autoExec: false
            });
            gid('transfer-form').reset();
            gid('transfer-date').value = formatDt(new Date());
            showToast('振替完了');
            render();
            await saveUser();
        };
        gid('scheduled-form').onsubmit = async e => {
            e.preventDefault();
            const aId = parseInt(gid('scheduled-account-select').value), amt = parseFloat(gid('scheduled-amount').value), isInc = q('input[name="scheduled-type"]:checked').value === 'income';
            state.currentUser.data.transactions.push({
                id: Date.now(), accountId: aId, categoryId: parseInt(gid('scheduled-category-select').value) || null, date: gid('scheduled-date').value,
                deposit: isInc ? amt : 0, withdrawal: !isInc ? amt : 0, memo: gid('scheduled-memo').value, isScheduled: true, autoExec: false
            });
            gid('scheduled-form').reset();
            showToast('予定追加');
            render();
            await saveUser();
        };

        // 定期・分割設定 (UI切り替え)
        qA('input[name="rec-amt-type"]').forEach(r => r.addEventListener('change', e => {
            if (e.target.value === 'fixed') {
                gid('rec-amt-fixed-wrapper').style.display = 'block';
                gid('rec-amt-split-wrapper').style.display = 'none';
            } else {
                gid('rec-amt-fixed-wrapper').style.display = 'none';
                gid('rec-amt-split-wrapper').style.display = 'block';
            }
        }));

        qA('input[name="rec-period-type"]').forEach(r => r.addEventListener('change', e => {
            gid('rec-period-date-wrapper').style.display = 'none';
            gid('rec-period-days-wrapper').style.display = 'none';
            gid('rec-period-count-wrapper').style.display = 'none';
            gid('rec-period-infinite-help').style.display = 'none';
            
            gid('rec-end-date').required = false;
            gid('rec-period-days').required = false;
            gid('rec-period-count').required = false;

            if (e.target.value === 'date') {
                gid('rec-period-date-wrapper').style.display = 'block';
                gid('rec-end-date').required = true;
            } else if (e.target.value === 'days') {
                gid('rec-period-days-wrapper').style.display = 'block';
                gid('rec-period-days').required = true;
            } else if (e.target.value === 'count') {
                gid('rec-period-count-wrapper').style.display = 'block';
                gid('rec-period-count').required = true;
            } else if (e.target.value === 'infinite') {
                gid('rec-period-infinite-help').style.display = 'block';
            }
        }));

        gid('rec-rule-base').addEventListener('change', e => {
            gid('rec-weekly-opts').style.display = e.target.value === 'weekly' ? 'block' : 'none';
            gid('rec-monthly-opts').style.display = e.target.value === 'monthly' ? 'block' : 'none';
        });

        // テキスト入力の折りたたみトグル
        gid('toggle-manual-dates-btn').onclick = (e) => {
            e.preventDefault();
            const container = gid('manual-dates-container');
            if (container.style.display === 'none') {
                container.style.display = 'block';
                e.target.innerHTML = '<i class="fas fa-chevron-up"></i> 文字入力を閉じる';
            } else {
                container.style.display = 'none';
                e.target.innerHTML = '<i class="fas fa-edit"></i> 文字で直接入力する（高度な設定を開く）';
            }
        };

        // --- 取引履歴のタブ切り替え ---
        gid('history-list-tab').onclick = () => {
            gid('history-list-tab').classList.add('active');
            gid('history-cal-tab').classList.remove('active');
            gid('history-list-view').style.display = 'block';
            gid('history-cal-view').style.display = 'none';
        };
        gid('history-cal-tab').onclick = () => {
            gid('history-cal-tab').classList.add('active');
            gid('history-list-tab').classList.remove('active');
            gid('history-cal-view').style.display = 'block';
            gid('history-list-view').style.display = 'none';
            renderHistoryCalendar();
        };
        gid('hist-cal-prev').onclick = () => {
            state.histCal.month--;
            if (state.histCal.month < 0) { state.histCal.month = 11; state.histCal.year--; }
            renderHistoryCalendar();
        };
        gid('hist-cal-next').onclick = () => {
            state.histCal.month++;
            if (state.histCal.month > 11) { state.histCal.month = 0; state.histCal.year++; }
            renderHistoryCalendar();
        };

        // --- カレンダーモーダル処理 ---
        gid('open-calendar-modal-btn').onclick = () => {
            const sepRegex = /[,\n\r]+/;
            state.cal.includes = new Set((gid('rec-include-dates').value || '').split(sepRegex).map(s=>s.trim()).filter(s=>s));
            state.cal.excludes = new Set((gid('rec-exclude-dates').value || '').split(sepRegex).map(s=>s.trim()).filter(s=>s));
            state.cal.periods =[];
            (gid('rec-exclude-periods').value || '').split(sepRegex).forEach(str => {
                const parts = str.split(/[~〜\-]/);
                if (parts.length === 2) {
                    state.cal.periods.push({ start: parts[0].trim(), end: parts[1].trim() });
                }
            });
            
            const sd = gid('rec-start-date').value ? new Date(gid('rec-start-date').value) : new Date();
            state.cal.currentYear = sd.getFullYear();
            state.cal.currentMonth = sd.getMonth();
            state.cal.periodTempStart = null;
            
            // 初回開くときは「追加日」モードにする
            qA('#calendar-modal .tab-btn').forEach(tb => tb.classList.remove('active'));
            qA('#calendar-modal .tab-btn[data-cal-mode="include"]')[0].classList.add('active');
            state.cal.mode = 'include';
            qA('#calendar-modal .tab-btn[data-cal-mode="include"]')[0].style.background = '#e8f5e9';
            qA('#calendar-modal .tab-btn[data-cal-mode="include"]')[0].style.color = '#27ae60';
            qA('#calendar-modal .tab-btn[data-cal-mode="exclude"]')[0].style.background = '#f4f7f6';
            qA('#calendar-modal .tab-btn[data-cal-mode="exclude"]')[0].style.color = '#7f8c8d';
            qA('#calendar-modal .tab-btn[data-cal-mode="period"]')[0].style.background = '#f4f7f6';
            qA('#calendar-modal .tab-btn[data-cal-mode="period"]')[0].style.color = '#7f8c8d';
            
            renderCalendarUI();
            gid('calendar-modal').classList.add('visible');
        };

        qA('#calendar-modal .tab-btn').forEach(b => b.addEventListener('click', e => {
            qA('#calendar-modal .tab-btn').forEach(tb => {
                tb.classList.remove('active');
                tb.style.background = '#f4f7f6';
                tb.style.color = '#7f8c8d';
            });
            b.classList.add('active');
            state.cal.mode = b.dataset.calMode;
            state.cal.periodTempStart = null;
            
            if (state.cal.mode === 'include') {
                b.style.background = '#e8f5e9'; b.style.color = '#27ae60';
            } else if (state.cal.mode === 'exclude') {
                b.style.background = '#fadbd8'; b.style.color = '#e74c3c';
            } else if (state.cal.mode === 'period') {
                b.style.background = '#f5b7b1'; b.style.color = '#c0392b';
            }
            renderCalendarUI();
        }));

        gid('cal-prev-month').onclick = () => {
            state.cal.currentMonth--;
            if (state.cal.currentMonth < 0) { state.cal.currentMonth = 11; state.cal.currentYear--; }
            renderCalendarUI();
        };
        gid('cal-next-month').onclick = () => {
            state.cal.currentMonth++;
            if (state.cal.currentMonth > 11) { state.cal.currentMonth = 0; state.cal.currentYear++; }
            renderCalendarUI();
        };

        gid('cal-apply-btn').onclick = () => {
            gid('rec-include-dates').value = Array.from(state.cal.includes).sort().join('\n');
            gid('rec-exclude-dates').value = Array.from(state.cal.excludes).sort().join('\n');
            gid('rec-exclude-periods').value = state.cal.periods.map(p => `${p.start}〜${p.end}`).join('\n');
            gid('calendar-modal').classList.remove('visible');
        };

        // 定期・分割設定 (Submit処理)
        gid('recurring-form').onsubmit = async e => {
            e.preventDefault();
            const startDateStr = gid('rec-start-date').value;
            if (!startDateStr) return alert('開始日を設定してください');

            const periodType = q('input[name="rec-period-type"]:checked').value;
            let endDateStr = gid('rec-end-date').value;
            let targetDays = parseInt(gid('rec-period-days').value) || 0;
            let targetCount = parseInt(gid('rec-period-count').value) || 0;
            
            const startDate = new Date(startDateStr);
            let endDate = new Date(startDateStr);
            let limitCount = Infinity;

            if (periodType === 'date') {
                if (!endDateStr || startDateStr > endDateStr) return alert('終了日を正しく設定してください');
                endDate = new Date(endDateStr);
            } else if (periodType === 'days') {
                if (targetDays <= 0) return alert('日数を正しく設定してください');
                endDate.setDate(endDate.getDate() + targetDays - 1);
            } else if (periodType === 'count') {
                if (targetCount <= 0) return alert('回数を正しく設定してください');
                endDate.setFullYear(endDate.getFullYear() + 10); // 安全装置
                limitCount = targetCount;
            } else if (periodType === 'infinite') {
                endDate.setFullYear(endDate.getFullYear() + 1); // 安全装置として1年分
            }

            const amtType = q('input[name="rec-amt-type"]:checked').value;
            let fixedAmt = 0;
            let totalAmt = 0;
            if (amtType === 'fixed') {
                fixedAmt = parseFloat(gid('rec-amount-fixed').value);
                if (!fixedAmt || fixedAmt <= 0) return alert('1回あたりの金額を正しく入力してください');
            } else {
                totalAmt = parseFloat(gid('rec-amount-total').value);
                if (!totalAmt || totalAmt <= 0) return alert('総額を正しく入力してください');
            }

            const rule = gid('rec-rule-base').value;
            const isInc = q('input[name="rec-type"]:checked').value === 'income';
            const aId = parseInt(gid('rec-account-select').value);
            const cId = parseInt(gid('rec-category-select').value) || null;
            const memo = gid('rec-memo').value;
            const autoExec = q('input[name="rec-auto"]:checked').value === 'auto';
            
            const sepRegex = /[,\n\r]+/;
            const excludes = (gid('rec-exclude-dates').value || '').split(sepRegex).map(s=>s.trim()).filter(s=>s);
            const includes = (gid('rec-include-dates').value || '').split(sepRegex).map(s=>s.trim()).filter(s=>s);
            const excludePeriodsStr = (gid('rec-exclude-periods').value || '').split(sepRegex).map(s=>s.trim()).filter(s=>s);
            
            const excludePeriods =[];
            excludePeriodsStr.forEach(str => {
                const parts = str.split(/[~〜\-]/);
                if (parts.length === 2) {
                    excludePeriods.push({ start: parts[0].trim(), end: parts[1].trim() });
                }
            });
            
            const checkedDows = Array.from(qA('input[name="rec-dow"]:checked')).map(cb => parseInt(cb.value));
            const targetMonthlyDate = parseInt(gid('rec-monthly-date').value);

            let d = new Date(startDate);
            const createdTxs =[];
            let baseId = Date.now();

            while(d <= endDate && createdTxs.length < limitCount) {
                let match = false;
                const dStr = formatDt(d);
                const dow = d.getDay();
                const dom = d.getDate();
                
                if (rule === 'custom') {
                    match = false;
                } else if (rule === 'daily') {
                    match = true;
                } else if (rule === 'weekday') {
                    match = (dow >= 1 && dow <= 5);
                } else if (rule === 'weekend') {
                    match = (dow === 0 || dow === 6);
                } else if (rule === 'weekly') {
                    if (checkedDows.includes(dow)) match = true;
                } else if (rule === 'monthly') {
                    if (dom === targetMonthlyDate) match = true;
                }
                
                if (excludes.includes(dStr)) match = false;
                excludePeriods.forEach(p => {
                    if (dStr >= p.start && dStr <= p.end) match = false;
                });
                
                if (includes.includes(dStr)) match = true;
                
                if (match) {
                    createdTxs.push({
                        id: baseId++,
                        accountId: aId,
                        categoryId: cId,
                        date: dStr,
                        memo: memo,
                        isScheduled: true,
                        autoExec: autoExec
                    });
                }
                d.setDate(d.getDate() + 1);
            }

            if (createdTxs.length === 0) return alert('条件に合致する日付がありませんでした');
            
            let baseAmt = 0;
            let remainder = 0;

            if (amtType === 'fixed') {
                baseAmt = fixedAmt;
            } else {
                baseAmt = Math.floor(totalAmt / createdTxs.length);
                remainder = totalAmt - (baseAmt * createdTxs.length);
            }

            createdTxs.forEach((tx, index) => {
                let finalAmt = baseAmt;
                if (amtType === 'split' && index === 0) {
                    finalAmt += remainder;
                }
                tx.deposit = isInc ? finalAmt : 0;
                tx.withdrawal = !isInc ? finalAmt : 0;
            });

            if (confirm(`${createdTxs.length}件の予定を生成しますか？\n(初回金額: ${baseAmt + (amtType==='split'?remainder:0)}円 / 最終金額: ${baseAmt}円)`)) {
                state.currentUser.data.transactions.push(...createdTxs);
                gid('recurring-form').reset();
                gid('rec-start-date').value = formatDt(new Date());
                gid('rec-end-date').value = formatDt(new Date());
                
                gid('rec-amt-fixed-wrapper').style.display = 'block';
                gid('rec-amt-split-wrapper').style.display = 'none';
                gid('rec-weekly-opts').style.display = 'none';
                gid('rec-monthly-opts').style.display = 'none';
                
                gid('rec-period-date-wrapper').style.display = 'block';
                gid('rec-period-days-wrapper').style.display = 'none';
                gid('rec-period-count-wrapper').style.display = 'none';
                gid('rec-period-infinite-help').style.display = 'none';
                gid('rec-end-date').required = true;
                gid('rec-period-days').required = false;
                gid('rec-period-count').required = false;
                
                showToast(`${createdTxs.length}件の予定を一括登録しました`);
                
                checkAutoExec(); // 即時自動実行チェック
                render();
                await saveUser();
            }
        };

        gid('adjust-form').onsubmit = async e => {
            e.preventDefault();
            const aId = parseInt(gid('adjust-account-select').value), actual = parseFloat(gid('actual-balance').value);
            const acc = state.currentUser.data.accounts.find(a => a.id === aId);
            const diff = actual - acc.balance;
            if (diff === 0) return showToast('ズレはありません');
            state.currentUser.data.transactions.push({
                id: Date.now(), accountId: aId, date: formatDt(new Date()),
                deposit: diff > 0 ? diff : 0, withdrawal: diff < 0 ? -diff : 0, memo: '残高調整', isScheduled: false, autoExec: false
            });
            gid('adjust-form').reset();
            showToast('調整完了');
            render();
            await saveUser();
        };

        document.body.addEventListener('click', async e => {
            const btn = e.target.closest('button');
            if (!btn) return;
            if (btn.classList.contains('exec-tx')) {
                const tx = state.currentUser.data.transactions.find(t => t.id == btn.dataset.id);
                if (tx && confirm('実行済みにしますか？')) {
                    tx.isScheduled = false;
                    tx.date = formatDt(new Date());
                    render();
                    await saveUser();
                }
            }
            if (btn.classList.contains('edit-tx')) {
                const tx = state.currentUser.data.transactions.find(t => t.id == btn.dataset.id);
                if (tx && tx.type !== 'transfer') {
                    gid('edit-transaction-id').value = tx.id;
                    gid('edit-date').value = formatDt(tx.date);
                    gid('edit-account-select').value = tx.accountId;
                    gid('edit-category-select').value = tx.categoryId || '';
                    const isInc = tx.deposit > 0;
                    q(`input[name="edit-tx-type"][value="${isInc ? 'income' : 'expense'}"]`).checked = true;
                    gid('edit-amount').value = isInc ? tx.deposit : tx.withdrawal;
                    gid('edit-memo').value = tx.memo;
                    gid('edit-modal').classList.add('visible');
                } else if (tx && tx.type === 'transfer') alert('振替は現在編集できません。削除して再登録してください。');
            }
            if (btn.classList.contains('del-tx')) {
                if (confirm('削除しますか？')) {
                    state.currentUser.data.transactions = state.currentUser.data.transactions.filter(t => t.id != btn.dataset.id);
                    render();
                    await saveUser();
                }
            }
            if (btn.classList.contains('del-acc')) {
                if (confirm('この口座と全関連取引を削除しますか？')) {
                    state.currentUser.data.accounts = state.currentUser.data.accounts.filter(a => a.id != btn.dataset.id);
                    state.currentUser.data.transactions = state.currentUser.data.transactions.filter(t => t.accountId != btn.dataset.id && t.toAccountId != btn.dataset.id);
                    render();
                    await saveUser();
                }
            }
            if (btn.classList.contains('del-cat')) {
                if (confirm('カテゴリを削除しますか？')) {
                    state.currentUser.data.categories = state.currentUser.data.categories.filter(c => c.id != btn.dataset.id);
                    state.currentUser.data.transactions.forEach(t => { if (t.categoryId == btn.dataset.id) t.categoryId = null; });
                    render();
                    await saveUser();
                }
            }
            if (btn.classList.contains('modal-close'))
                qA('.modal-overlay').forEach(m => m.classList.remove('visible'));
        });

        gid('edit-transaction-form').onsubmit = async e => {
            e.preventDefault();
            const tId = parseInt(gid('edit-transaction-id').value), tx = state.currentUser.data.transactions.find(t => t.id === tId);
            if (tx) {
                tx.date = gid('edit-date').value;
                tx.accountId = parseInt(gid('edit-account-select').value);
                tx.categoryId = parseInt(gid('edit-category-select').value) || null;
                const isInc = q('input[name="edit-tx-type"]:checked').value === 'income', amt = parseFloat(gid('edit-amount').value);
                tx.deposit = isInc ? amt : 0;
                tx.withdrawal = !isInc ? amt : 0;
                tx.memo = gid('edit-memo').value;
                gid('edit-modal').classList.remove('visible');
                render();
                await saveUser();
            }
        };

        gid('month-dropdown').onchange = e => { state.selectedMonth = e.target.value; renderHistory(); };
        gid('status-dropdown').onchange = e => { state.historyStatus = e.target.value; renderHistory(); };
        gid('report-month-dropdown').onchange = e => { state.reportSelectedMonth = e.target.value; renderCharts(); };
        gid('adjust-account-select').onchange = e => {
            const acc = state.currentUser.data.accounts.find(a => a.id === parseInt(e.target.value));
            gid('current-app-balance').textContent = acc ? formatCur(acc.balance) : '¥ 0';
        };

        gid('budget-form').onsubmit = async e => {
            e.preventDefault();
            state.currentUser.data.settings.budget = parseFloat(gid('budget-amount').value) || 0;
            showToast('保存しました');
            render();
            await saveUser();
        };
        gid('add-account-form').onsubmit = async e => {
            e.preventDefault();
            const aId = Date.now(), bal = parseFloat(gid('initial-balance').value);
            state.currentUser.data.accounts.push({ id: aId, name: gid('account-name').value, balance: 0 });
            if (bal > 0) state.currentUser.data.transactions.push({ id: Date.now() + 1, type: 'initial', accountId: aId, amount: bal });
            gid('add-account-form').reset();
            render();
            await saveUser();
        };
        gid('add-category-form').onsubmit = async e => {
            e.preventDefault();
            state.currentUser.data.categories.push({ id: Date.now(), name: gid('category-name').value, color: gid('category-color').value, defaultAccountId: parseInt(gid('category-account-link').value) || null });
            gid('add-category-form').reset();
            render();
            await saveUser();
        };

        gid('change-email-form').onsubmit = async e => {
            e.preventDefault();
            const res = await callGasApi('changeEmail', {
                userId: state.currentUser.id, newEmail: gid('change-email-new').value, passwordHash: simpleHash(gid('change-email-password').value)
            }, true);
            if (res) { showToast('変更完了'); gid('change-email-form').reset(); }
        };
        gid('change-password-form').onsubmit = async e => {
            e.preventDefault();
            const res = await callGasApi('changePassword', {
                userId: state.currentUser.id, currentPasswordHash: simpleHash(gid('change-password-current').value), newPasswordHash: simpleHash(gid('change-password-new').value), backupKeyHash: simpleHash(gid('change-password-backup-key').value)
            }, true);
            if (res) { showToast('変更完了'); gid('change-password-form').reset(); }
        };
        gid('show-backup-key-form').onsubmit = async e => {
            e.preventDefault();
            const res = await callGasApi('getBackupKey', {
                userId: state.currentUser.id, passwordHash: simpleHash(gid('show-backup-key-password').value)
            }, true);
            if (res) { alert('ローカルキーと一致確認済'); gid('show-backup-key-form').reset(); }
        };
    };

    // --- INIT ---
    const init = async () => {
        const uid = localStorage.getItem('uid');
        if (uid) {
            let userStr = localStorage.getItem('localChanges');
            if (userStr) {
                state.currentUser = initUserData(JSON.parse(userStr));
                state.hasLocalChanges = true;
            } else {
                const res = await callGasApi('getUserData', { userId: parseInt(uid) }, true);
                if (res && res.userData) state.currentUser = initUserData(res.userData);
            }

            if (state.currentUser) {
                state.selectedMonth = localStorage.getItem(`selectedMonth_${state.currentUser.id}`) || 'all';
                gid('auth-view').style.display = 'none';
                gid('app-view').style.display = 'block';
                gid('date').value = formatDt(new Date());
                gid('transfer-date').value = formatDt(new Date());
                gid('scheduled-date').value = formatDt(new Date());
                gid('rec-start-date').value = formatDt(new Date());
                gid('rec-end-date').value = formatDt(new Date());
                
                setupEvents();
                requestPushPerm();
                await syncData();
                
                // 定期・分割等で設定した「自動完了」をチェック
                const hasChanged = checkAutoExec();
                if (hasChanged) await saveUser();
                
                render();
                runChecks();
            } else {
                localStorage.removeItem('uid');
                gid('auth-view').style.display = 'flex';
                setupEvents();
            }
        } else {
            gid('auth-view').style.display = 'flex';
            setupEvents();
        }
    };
    init();
});