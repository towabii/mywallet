const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwKT9eMppIlTxIV0ULDQ_-ijXd6wLv2uTRTntbfoTZ-YgMVzdQ2o9HPdt6xHTwYU14/exec';

document.addEventListener('DOMContentLoaded', () => {
    // --- STATE ---
    let state = {
        currentUser: null,
        selectedMonth: 'all', historyStatus: 'all', reportSelectedMonth: 'all',
        charts: {}, isOffline: !navigator.onLine, hasLocalChanges: false
    };

    // --- DOM Elements ---
    const q = s => document.querySelector(s);
    const qA = s => document.querySelectorAll(s);
    const gid = id => document.getElementById(id);
    
    const views = qA('.view'); const navLinks = qA('.nav-link');
    const loading = gid('loading-overlay'); const offlineBanner = gid('offline-banner');
    const toastContainer = gid('toast-container');

    // --- UTILITIES ---
    const showLoading = () => loading.style.display = 'flex';
    const hideLoading = () => loading.style.display = 'none';
    const simpleHash = str => { let h = 0; for(let i=0; i<str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0; return h.toString(); };
    const formatCur = (v, sign) => `${sign && v>0?'+':''}¥ ${Math.round(v).toLocaleString()}`;
    const formatDt = d => new Date(d).toISOString().split('T')[0];
    const showToast = msg => {
        const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
        toastContainer.appendChild(t); setTimeout(() => t.remove(), 4000);
    };

    // --- NOTIFICATIONS ---
    const requestPushPerm = async () => {
        if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
        }
    };
    const notifyUser = (title, body) => {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body, icon: '/icon.png' });
        } else { showToast(`[通知] ${title}: ${body}`); }
    };

    // --- API & SYNC ---
    window.addEventListener('online', () => { state.isOffline = false; offlineBanner.style.display = 'none'; syncData(); });
    window.addEventListener('offline', () => { state.isOffline = true; offlineBanner.style.display = 'block'; });

    async function callGasApi(action, payload, showLd = false) {
        if (showLd) showLoading();
        try {
            if (state.isOffline &&['updateUserData'].includes(action)) throw new Error('offline');
            const res = await fetch(GAS_WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action, payload }) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const result = await res.json();
            if (result.status === 'error') throw new Error(result.message);
            if (result.status === 'conflict') return result; // 競合処理へ
            return result;
        } catch (e) {
            if (e.message === 'offline' || e.message === 'Failed to fetch') {
                if (action === 'updateUserData') {
                    state.hasLocalChanges = true; localStorage.setItem('localChanges', JSON.stringify(payload.userData));
                    showToast('オフラインのためローカルに保存しました'); return { status: 'success' };
                }
            } else { console.error(e); if(showLd) showToast(`エラー: ${e.message}`); }
            return null;
        } finally { if (showLd) hideLoading(); }
    }

    async function syncData() {
        if (!state.currentUser || !state.hasLocalChanges) return;
        const localData = JSON.parse(localStorage.getItem('localChanges'));
        if (!localData) return;
        
        const res = await callGasApi('syncData', { userId: state.currentUser.id, userData: localData, lastSyncedAt: state.currentUser.updatedAt || 0 }, true);
        if (res && res.status === 'success') {
            state.hasLocalChanges = false; localStorage.removeItem('localChanges');
            state.currentUser = res.userData; showToast('サーバーと同期しました'); render();
        } else if (res && res.status === 'conflict') {
            gid('conflict-modal').classList.add('visible');
            gid('conflict-use-server').onclick = () => {
                state.hasLocalChanges = false; localStorage.removeItem('localChanges');
                state.currentUser = res.serverData; gid('conflict-modal').classList.remove('visible'); render();
            };
            gid('conflict-use-local').onclick = async () => {
                localData.updatedAt = Date.now();
                await callGasApi('updateUserData', { userId: state.currentUser.id, userData: localData }, true);
                state.hasLocalChanges = false; localStorage.removeItem('localChanges');
                state.currentUser = localData; gid('conflict-modal').classList.remove('visible'); render();
            };
        }
    }

    const saveUser = async () => {
        state.currentUser.updatedAt = Date.now();
        localStorage.setItem(`selectedMonth_${state.currentUser.id}`, state.selectedMonth);
        await callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser });
    };

    // --- DATA MIGRATION & CALC ---
    const initUserData = (user) => {
        if(!user.data.stocks) user.data.stocks =[];
        if(!user.data.settings) user.data.settings = { budget: 0 };
        return user;
    };

    const recalcBalances = () => {
        state.currentUser.data.accounts.forEach(acc => {
            acc.balance = state.currentUser.data.transactions.find(tx => tx.accountId === acc.id && tx.type === 'initial')?.amount || 0;
        });
        const validTx = state.currentUser.data.transactions.filter(tx => tx.type !== 'initial' && !tx.isScheduled).sort((a,b)=>new Date(a.date)-new Date(b.date));
        validTx.forEach(tx => {
            if (tx.type === 'transfer') {
                const f = state.currentUser.data.accounts.find(a=>a.id === tx.accountId);
                const t = state.currentUser.data.accounts.find(a=>a.id === tx.toAccountId);
                if(f) f.balance -= tx.amount; if(t) t.balance += tx.amount;
            } else {
                const acc = state.currentUser.data.accounts.find(a=>a.id === tx.accountId);
                if(acc) acc.balance += (tx.deposit || 0) - (tx.withdrawal || 0);
            }
        });
    };

    // --- CHECKS (Notifications) ---
    const runChecks = () => {
        const { transactions, settings, stocks } = state.currentUser.data;
        // 予算
        if(!settings.budget || settings.budget <= 0) notifyUser('予算未設定', '今月の予算を設定して無駄遣いを防ぎましょう。');
        // 期限切れ予定
        const todayStr = formatDt(new Date());
        const overdue = transactions.filter(tx => tx.isScheduled && tx.date < todayStr);
        if(overdue.length > 0) notifyUser('未実行の予定', `実行日が過ぎた予定が ${overdue.length} 件あります。`);
        // 株価目標 (株価取得後に呼ばれる想定だが簡易的に)
        stocks.forEach(s => {
            if(s.targetPrice && s.currentPrice && s.currentPrice >= s.targetPrice) {
                notifyUser('目標株価到達', `${s.name} の株価が目標(¥${s.targetPrice})に到達しました！`);
            }
        });
    };

    // --- RENDERING ---
    const render = async () => {
        if(!state.currentUser) return;
        recalcBalances(); renderDropdowns(); renderDash(); renderHistory(); renderStocks(); renderAccounts(); renderCategories(); renderCharts();
    };

    const renderDropdowns = () => {
        const txs = state.currentUser.data.transactions.filter(t => t.type !== 'initial');
        const months =[...new Set(txs.map(t => t.date.substring(0,7)))].sort().reverse();
        const buildOpts = (sel, val) => {
            sel.innerHTML = '<option value="all">全期間</option>' + months.map(m=>`<option value="${m}" ${val===m?'selected':''}>${m.replace('-','年')}月</option>`).join('');
        };
        buildOpts(gid('month-dropdown'), state.selectedMonth);
        buildOpts(gid('report-month-dropdown'), state.reportSelectedMonth);
    };

    const renderDash = () => {
        const { accounts, transactions, settings, stocks } = state.currentUser.data;
        const validTx = transactions.filter(t => !t.isScheduled);
        
        const cashBal = accounts.reduce((s,a)=>s+a.balance, 0);
        const stockBal = stocks.reduce((s,st)=>s+(st.shares * (st.currentPrice||st.price)), 0);
        gid('cash-balance').textContent = formatCur(cashBal);
        gid('stock-balance').textContent = formatCur(stockBal);
        gid('total-balance').textContent = formatCur(cashBal + stockBal);

        gid('account-balances').innerHTML = accounts.map(a=>`<li><span>${a.name}</span><span>${formatCur(a.balance)}</span></li>`).join('') || '<li>なし</li>';

        // 予算進捗
        const now = new Date(); const mStr = formatDt(now).substring(0,7);
        const mTx = validTx.filter(t => t.date.substring(0,7) === mStr && t.type !== 'initial');
        const mExp = mTx.reduce((s,t) => s + (t.withdrawal||0), 0);
        const budget = settings.budget || 0;
        gid('budget-text').textContent = budget > 0 ? `${formatCur(mExp)} / ${formatCur(budget)}` : '未設定';
        gid('budget-amount').value = budget || '';
        const pct = budget > 0 ? Math.min((mExp/budget)*100, 100) : 0;
        const pBar = gid('budget-progress');
        pBar.style.width = `${pct}%`;
        pBar.style.backgroundColor = pct > 90 ? 'var(--expense-color)' : (pct > 70 ? 'var(--warning-color)' : 'var(--primary-color)');
    };

    const renderHistory = () => {
        const tb = gid('history-table-body'); tb.innerHTML = '';
        let txs = state.currentUser.data.transactions.filter(t => t.type !== 'initial');
        if(state.selectedMonth !== 'all') txs = txs.filter(t => t.date.substring(0,7) === state.selectedMonth);
        if(state.historyStatus === 'completed') txs = txs.filter(t => !t.isScheduled);
        if(state.historyStatus === 'scheduled') txs = txs.filter(t => t.isScheduled);
        
        txs.sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(tx => {
            const tr = document.createElement('tr');
            const statusHtml = tx.isScheduled ? '<span class="status-tag scheduled">予定</span>' : '<span class="status-tag completed">完了</span>';
            const cat = state.currentUser.data.categories.find(c=>c.id===tx.categoryId);
            const catHtml = cat ? `<span class="category-tag" style="background-color:${cat.color};">${cat.name}</span>` : '';
            
            let accName, incHtml='', expHtml='', diffHtml='';
            if(tx.type === 'transfer') {
                const f = state.currentUser.data.accounts.find(a=>a.id===tx.accountId)?.name || '不明';
                const t = state.currentUser.data.accounts.find(a=>a.id===tx.toAccountId)?.name || '不明';
                accName = `${f} <i class="fas fa-arrow-right"></i> ${t}`;
                diffHtml = `<span style="color:#3498db;">振替 ${formatCur(tx.amount)}</span>`;
            } else {
                accName = state.currentUser.data.accounts.find(a=>a.id===tx.accountId)?.name || '不明';
                incHtml = tx.deposit>0 ? `<span class="income-color">${formatCur(tx.deposit)}</span>` : '';
                expHtml = tx.withdrawal>0 ? `<span class="expense-color">${formatCur(tx.withdrawal)}</span>` : '';
                const diff = (tx.deposit||0) - (tx.withdrawal||0);
                diffHtml = `<span class="${diff>=0?'income-color':'expense-color'}">${formatCur(diff,true)}</span>`;
            }

            let actHtml = `<div class="action-buttons">`;
            if(tx.isScheduled) actHtml += `<button class="exec-tx" data-id="${tx.id}"><i class="fas fa-check-circle"></i></button>`;
            actHtml += `<button class="del-tx" data-id="${tx.id}"><i class="fas fa-trash"></i></button></div>`;

            tr.innerHTML = `<td>${statusHtml}</td><td>${formatDt(tx.date)}</td><td>${catHtml}</td><td>${accName}</td><td>${incHtml}</td><td>${expHtml}</td><td>${diffHtml}</td><td>${tx.memo}</td><td>${actHtml}</td>`;
            tb.appendChild(tr);
        });
    };

    const renderStocks = async () => {
        const stocks = state.currentUser.data.stocks;
        const tb = gid('stocks-table-body'); tb.innerHTML = '';
        if(stocks.length === 0) return tb.innerHTML='<tr><td colspan="7">銘柄がありません</td></tr>';

        // APIから株価更新 (キャッシュなければ)
        const tickersToFetch = stocks.filter(s => !s.currentPrice).map(s=>s.code);
        if(tickersToFetch.length > 0 && !state.isOffline) {
            const res = await callGasApi('getStockPrices', { tickers: tickersToFetch });
            if(res && res.prices) {
                stocks.forEach(s => { if(res.prices[s.code]) s.currentPrice = res.prices[s.code]; });
                saveUser(); // 更新を保存
                runChecks(); // 通知チェック
            }
        }

        stocks.forEach(s => {
            const cp = s.currentPrice || s.price;
            const evalVal = s.shares * cp;
            const pl = evalVal - (s.shares * s.price);
            const plHtml = `<span class="${pl>=0?'income-color':'expense-color'}">${formatCur(pl,true)}</span>`;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${s.code}</strong><br><small>${s.name}</small></td>
                <td>${s.shares}</td>
                <td>${formatCur(s.price)}</td>
                <td>${formatCur(cp)}</td>
                <td>${formatCur(evalVal)}</td>
                <td>${plHtml}</td>
                <td class="action-buttons">
                    <button class="sell-stock-btn" data-id="${s.id}"><i class="fas fa-hand-holding-usd"></i></button>
                    <button class="del-stock-btn" data-id="${s.id}"><i class="fas fa-trash"></i></button>
                </td>
            `;
            tb.appendChild(tr);
        });
        renderDash(); // 株式評価額が変わるため
    };

    const renderAccounts = () => {
        const accs = state.currentUser.data.accounts;
        const opts = `<option value="" disabled selected>選択してください</option>` + accs.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');['account-select', 'transfer-from', 'transfer-to', 'scheduled-account-select', 'adjust-account-select', 'stock-account'].forEach(id => {
            const el = gid(id); if(el) { const val = el.value; el.innerHTML = opts; if(val) el.value = val; }
        });
        
        const tb = gid('accounts-table-body'); tb.innerHTML = accs.map(a=>`<tr><td>${a.name}</td><td>${formatCur(a.balance)}</td><td class="action-buttons"><button class="del-acc" data-id="${a.id}"><i class="fas fa-trash"></i></button></td></tr>`).join('');
    };

    const renderCategories = () => {
        const cats = state.currentUser.data.categories; const accs = state.currentUser.data.accounts;
        const opts = `<option value="">なし</option>` + cats.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');['category-select', 'scheduled-category-select'].forEach(id => {
            const el = gid(id); if(el) { const val = el.value; el.innerHTML = opts; if(val) el.value = val; }
        });
        gid('category-account-link').innerHTML = `<option value="">設定しない</option>` + accs.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
        
        gid('categories-table-body').innerHTML = cats.map(c=>`<tr><td><span class="category-tag" style="background-color:${c.color}">${c.name}</span></td><td>${accs.find(a=>a.id===c.defaultAccountId)?.name||'なし'}</td><td class="action-buttons"><button class="del-cat" data-id="${c.id}"><i class="fas fa-trash"></i></button></td></tr>`).join('');
    };

    const renderCharts = () => {
        const { transactions, stocks } = state.currentUser.data;
        const validTx = transactions.filter(t=>!t.isScheduled && t.type!=='initial');

        // 月次資産グラフ (簡略化: 月末残高ではなく累計推移)
        const labels =[], data =[];
        let rBal = transactions.filter(t=>t.type==='initial').reduce((s,t)=>s+t.amount,0);
        validTx.sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(tx => {
            if(tx.type !== 'transfer') rBal += (tx.deposit||0) - (tx.withdrawal||0);
            const m = tx.date.substring(0,7);
            if(!labels.includes(m)) { labels.push(m); data.push(rBal); } else { data[data.length-1] = rBal; }
        });
        if(state.charts.bal) state.charts.bal.destroy();
        state.charts.bal = new Chart(gid('balance-chart').getContext('2d'), { type: 'line', data: { labels, datasets:[{ label:'現金資産', data, borderColor:'#3498db', fill:true, backgroundColor:'rgba(52,152,219,0.1)'}] }, options: {responsive:true, maintainAspectRatio:false} });

        // ポートフォリオ円グラフ
        const cash = state.currentUser.data.accounts.reduce((s,a)=>s+a.balance, 0);
        const stck = stocks.reduce((s,st)=>s+(st.shares * (st.currentPrice||st.price)), 0);
        if(state.charts.pf) state.charts.pf.destroy();
        state.charts.pf = new Chart(gid('portfolio-chart').getContext('2d'), { type:'doughnut', data:{ labels:['現金', '株式'], datasets:[{data:[cash, stck], backgroundColor:['#3498db','#f1c40f']}] }, options:{responsive:true, maintainAspectRatio:false} });

        // カテゴリ支出グラフ
        let tCat = validTx; if(state.reportSelectedMonth !== 'all') tCat = tCat.filter(t=>t.date.substring(0,7) === state.reportSelectedMonth);
        const pData = {}; tCat.forEach(t=>{ if(t.withdrawal>0) { const c = t.categoryId||'unknown'; pData[c] = (pData[c]||0)+t.withdrawal; }});
        const pLbls=[], pVals=[], pCols=[];
        Object.keys(pData).forEach(cId => {
            if(cId==='unknown') { pLbls.push('なし'); pVals.push(pData[cId]); pCols.push('#ccc'); }
            else { const c = state.currentUser.data.categories.find(ca=>ca.id==cId); if(c) { pLbls.push(c.name); pVals.push(pData[cId]); pCols.push(c.color); } }
        });
        if(state.charts.cat) state.charts.cat.destroy();
        state.charts.cat = new Chart(gid('category-chart').getContext('2d'), { type:'pie', data:{ labels:pLbls, datasets:[{data:pVals, backgroundColor:pCols}] }, options:{responsive:true, maintainAspectRatio:false} });
    };

    // --- EVENT LISTENERS ---
    const setupEvents = () => {
        // Auth
        gid('show-signup').onclick = e => { e.preventDefault(); gid('login-form').style.display='none'; gid('signup-form').style.display='block'; };
        gid('show-login').onclick = e => { e.preventDefault(); gid('signup-form').style.display='none'; gid('login-form').style.display='block'; };
        
        gid('login-form').onsubmit = async e => { e.preventDefault();
            const res = await callGasApi('login', { email: gid('login-email').value, passwordHash: simpleHash(gid('login-password').value) }, true);
            if(res && res.status==='success') { localStorage.setItem('uid', res.userId); init(); }
        };
        gid('signup-form').onsubmit = async e => { e.preventDefault();
            const email=gid('signup-email').value, pwd=gid('signup-password').value;
            const res = await callGasApi('signup', { email, passwordHash: simpleHash(pwd), backupKeyHash: 'dummy' }, true);
            if(res && res.status==='success') { showToast('作成完了。ログインしてください'); gid('show-login').click(); }
        };
        gid('logout-btn').onclick = () => { if(confirm('ログアウトしますか？')){ localStorage.removeItem('uid'); location.reload(); }};

        // Navigation
        navLinks.forEach(l => l.onclick = e => { e.preventDefault();
            const vId = l.dataset.view; views.forEach(v=>v.classList.remove('active')); gid(vId).classList.add('active');
            navLinks.forEach(nl=>nl.classList.remove('active')); qA(`.nav-link[data-view="${vId}"]`).forEach(nl=>nl.classList.add('active'));
            gid('main-title').textContent = l.querySelector('span').textContent;
        });

        // Tabs
        qA('.tab-btn').forEach(b => b.onclick = () => {
            qA('.tab-btn').forEach(tb=>tb.classList.remove('active')); qA('.tab-content').forEach(tc=>tc.classList.remove('active'));
            b.classList.add('active'); gid(`tab-${b.dataset.tab}`).classList.add('active');
        });

        // Forms
        gid('transaction-form').onsubmit = async e => { e.preventDefault();
            const aId = parseInt(gid('account-select').value), cId = parseInt(gid('category-select').value)||null;
            const amt = parseFloat(gid('tx-amount').value), isInc = q('input[name="tx-type"]:checked').value==='income';
            state.currentUser.data.transactions.push({ id:Date.now(), accountId:aId, categoryId:cId, date:gid('date').value, deposit:isInc?amt:0, withdrawal:!isInc?amt:0, memo:gid('memo').value, isScheduled:false });
            gid('transaction-form').reset(); gid('date').value=formatDt(new Date()); render(); await saveUser();
        };
        gid('transfer-form').onsubmit = async e => { e.preventDefault();
            const f = parseInt(gid('transfer-from').value), t = parseInt(gid('transfer-to').value), amt = parseFloat(gid('transfer-amount').value);
            if(f===t) return alert('同じ口座です');
            state.currentUser.data.transactions.push({ id:Date.now(), type:'transfer', accountId:f, toAccountId:t, amount:amt, date:gid('transfer-date').value, memo:gid('transfer-memo').value, isScheduled:false });
            gid('transfer-form').reset(); gid('transfer-date').value=formatDt(new Date()); showToast('振替完了'); render(); await saveUser();
        };
        gid('scheduled-form').onsubmit = async e => { e.preventDefault();
            const aId = parseInt(gid('scheduled-account-select').value), amt = parseFloat(gid('scheduled-amount').value), isInc = q('input[name="scheduled-type"]:checked').value==='income';
            state.currentUser.data.transactions.push({ id:Date.now(), accountId:aId, categoryId:parseInt(gid('scheduled-category-select').value)||null, date:gid('scheduled-date').value, deposit:isInc?amt:0, withdrawal:!isInc?amt:0, memo:gid('scheduled-memo').value, isScheduled:true });
            gid('scheduled-form').reset(); showToast('予定追加'); render(); await saveUser();
        };
        gid('adjust-form').onsubmit = async e => { e.preventDefault();
            const aId = parseInt(gid('adjust-account-select').value), actual = parseFloat(gid('actual-balance').value);
            const acc = state.currentUser.data.accounts.find(a=>a.id===aId);
            const diff = actual - acc.balance; if(diff===0) return showToast('ズレはありません');
            state.currentUser.data.transactions.push({ id:Date.now(), accountId:aId, date:formatDt(new Date()), deposit:diff>0?diff:0, withdrawal:diff<0?-diff:0, memo:'残高調整', isScheduled:false });
            gid('adjust-form').reset(); showToast('調整完了'); render(); await saveUser();
        };

        // Stocks
        gid('refresh-stocks').onclick = async () => {
            const tkrs = state.currentUser.data.stocks.map(s=>s.code);
            if(tkrs.length===0 || state.isOffline) return;
            const res = await callGasApi('getStockPrices', { tickers: tkrs }, true);
            if(res && res.prices) {
                state.currentUser.data.stocks.forEach(s => { if(res.prices[s.code]) s.currentPrice = res.prices[s.code]; });
                showToast('株価更新完了'); render(); await saveUser();
            }
        };
        gid('add-stock-form').onsubmit = async e => { e.preventDefault();
            state.currentUser.data.stocks.push({ id:Date.now(), code:gid('stock-code').value.toUpperCase(), name:gid('stock-name').value, shares:parseFloat(gid('stock-shares').value), price:parseFloat(gid('stock-price').value), targetPrice:parseFloat(gid('stock-target').value)||null, linkAccountId:parseInt(gid('stock-account').value), currentPrice:null });
            gid('add-stock-form').reset(); showToast('銘柄追加'); render(); await saveUser(); gid('refresh-stocks').click();
        };

        // Table actions
        document.body.addEventListener('click', async e => {
            const btn = e.target.closest('button'); if(!btn) return;
            // 予定実行
            if(btn.classList.contains('exec-tx')) {
                const tx = state.currentUser.data.transactions.find(t=>t.id==btn.dataset.id);
                if(tx && confirm('実行済みにしますか？')){ tx.isScheduled = false; tx.date = formatDt(new Date()); render(); await saveUser(); }
            }
            // 削除
            if(btn.classList.contains('del-tx')) {
                if(confirm('削除しますか？')){ state.currentUser.data.transactions = state.currentUser.data.transactions.filter(t=>t.id!=btn.dataset.id); render(); await saveUser(); }
            }
            // 株式売却モーダル
            if(btn.classList.contains('sell-stock-btn')) {
                gid('sell-stock-id').value = btn.dataset.id; gid('sell-stock-modal').classList.add('visible');
            }
            if(btn.classList.contains('del-stock-btn')) {
                if(confirm('削除しますか？')){ state.currentUser.data.stocks = state.currentUser.data.stocks.filter(s=>s.id!=btn.dataset.id); render(); await saveUser(); }
            }
        });

        // 株式売却実行
        gid('sell-stock-form').onsubmit = async e => { e.preventDefault();
            const sId = parseInt(gid('sell-stock-id').value), shares = parseFloat(gid('sell-shares').value), prc = parseFloat(gid('sell-price').value);
            const st = state.currentUser.data.stocks.find(s=>s.id===sId);
            if(!st || shares > st.shares) return alert('保有数を超えています');
            
            // 口座へ入金トランザクション
            state.currentUser.data.transactions.push({ id:Date.now(), accountId:st.linkAccountId, date:formatDt(new Date()), deposit: shares*prc, withdrawal:0, memo:`${st.name} 売却`, isScheduled:false });
            
            st.shares -= shares; if(st.shares <= 0) state.currentUser.data.stocks = state.currentUser.data.stocks.filter(s=>s.id!==sId);
            gid('sell-stock-modal').classList.remove('visible'); gid('sell-stock-form').reset(); showToast('売却完了'); render(); await saveUser();
        };

        // Filters
        gid('month-dropdown').onchange = e => { state.selectedMonth = e.target.value; renderHistory(); };
        gid('status-dropdown').onchange = e => { state.historyStatus = e.target.value; renderHistory(); };
        gid('report-month-dropdown').onchange = e => { state.reportSelectedMonth = e.target.value; renderCharts(); };

        // Settings
        gid('budget-form').onsubmit = async e => { e.preventDefault(); state.currentUser.data.settings.budget = parseFloat(gid('budget-amount').value)||0; showToast('保存しました'); render(); await saveUser(); };
        gid('add-account-form').onsubmit = async e => { e.preventDefault();
            const aId = Date.now(), bal = parseFloat(gid('initial-balance').value);
            state.currentUser.data.accounts.push({id:aId, name:gid('account-name').value, balance:0});
            if(bal>0) state.currentUser.data.transactions.push({id:Date.now()+1, type:'initial', accountId:aId, amount:bal});
            gid('add-account-form').reset(); render(); await saveUser();
        };
        gid('add-category-form').onsubmit = async e => { e.preventDefault();
            state.currentUser.data.categories.push({id:Date.now(), name:gid('category-name').value, color:gid('category-color').value, defaultAccountId:parseInt(gid('category-account-link').value)||null});
            gid('add-category-form').reset(); render(); await saveUser();
        };

        qA('.modal-close').forEach(b=>b.onclick=()=>qA('.modal-overlay').forEach(m=>m.classList.remove('visible')));
    };

    // --- INIT ---
    const init = async () => {
        const uid = localStorage.getItem('uid');
        if (uid) {
            let userStr = localStorage.getItem('localChanges');
            if (userStr) {
                state.currentUser = initUserData(JSON.parse(userStr)); state.hasLocalChanges = true;
            } else {
                const res = await callGasApi('getUserData', { userId: parseInt(uid) }, true);
                if (res && res.userData) state.currentUser = initUserData(res.userData);
            }

            if(state.currentUser) {
                state.selectedMonth = localStorage.getItem(`selectedMonth_${state.currentUser.id}`) || 'all';
                gid('auth-view').style.display='none'; gid('app-view').style.display='block';
                gid('date').value = formatDt(new Date()); gid('transfer-date').value = formatDt(new Date()); gid('scheduled-date').value = formatDt(new Date());
                setupEvents(); requestPushPerm();
                await syncData(); // オンラインなら同期
                render(); runChecks();
            } else { localStorage.removeItem('uid'); gid('auth-view').style.display='flex'; setupEvents(); }
        } else { gid('auth-view').style.display='flex'; setupEvents(); }
    };
    init();
});