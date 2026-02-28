const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyNFukFMjg-sgkoRzTXjdJABVLiVf-Nt3eKHIJ7b6MDP-6OvYCRbn2YlWzpeLXUBrod/exec';

document.addEventListener('DOMContentLoaded', () => {
    // --- STATE ---
    let state = {
        currentUser: null, selectedMonth: 'all', historyStatus: 'all', reportSelectedMonth: 'all',
        charts: {}, isOffline: !navigator.onLine, hasLocalChanges: false,
        liveQuotes: {} // ブラウザ内でのみ保持
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
    const requestPushPerm = async () => { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); };
    const notifyUser = (title, body) => { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: '/icon.png' }); else showToast(`[通知] ${title}: ${body}`); };

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
            if (result.status === 'conflict') return result;
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
            state.currentUser = res.userData; showToast('サーバーと同期完了'); render();
        } else if (res && res.status === 'conflict') {
            gid('conflict-modal').classList.add('visible');
            gid('conflict-use-server').onclick = () => { state.hasLocalChanges = false; localStorage.removeItem('localChanges'); state.currentUser = res.serverData; gid('conflict-modal').classList.remove('visible'); render(); };
            gid('conflict-use-local').onclick = async () => { localData.updatedAt = Date.now(); await callGasApi('updateUserData', { userId: state.currentUser.id, userData: localData }, true); state.hasLocalChanges = false; localStorage.removeItem('localChanges'); state.currentUser = localData; gid('conflict-modal').classList.remove('visible'); render(); };
        }
    }

    const saveUser = async () => { state.currentUser.updatedAt = Date.now(); localStorage.setItem(`selectedMonth_${state.currentUser.id}`, state.selectedMonth); await callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser }); };
    const initUserData = (user) => { if(!user.data.stocks) user.data.stocks =[]; if(!user.data.settings) user.data.settings = { budget: 0 }; return user; };

    const recalcBalances = () => {
        state.currentUser.data.accounts.forEach(acc => {
            acc.balance = state.currentUser.data.transactions.find(tx => tx.accountId === acc.id && tx.type === 'initial')?.amount || 0;
        });
        const validTx = state.currentUser.data.transactions.filter(tx => tx.type !== 'initial' && !tx.isScheduled).sort((a,b)=>new Date(a.date)-new Date(b.date));
        validTx.forEach(tx => {
            if (tx.type === 'transfer') {
                const f = state.currentUser.data.accounts.find(a=>a.id === tx.accountId); const t = state.currentUser.data.accounts.find(a=>a.id === tx.toAccountId);
                if(f) f.balance -= tx.amount; if(t) t.balance += tx.amount;
            } else {
                const acc = state.currentUser.data.accounts.find(a=>a.id === tx.accountId);
                if(acc) acc.balance += (tx.deposit || 0) - (tx.withdrawal || 0);
            }
        });
    };

    const runChecks = () => {
        const { transactions, settings, stocks } = state.currentUser.data;
        if(!settings.budget || settings.budget <= 0) notifyUser('予算未設定', '予算を設定しましょう。');
        const overdue = transactions.filter(tx => tx.isScheduled && tx.date < formatDt(new Date()));
        if(overdue.length > 0) notifyUser('未実行の予定', `実行日が過ぎた予定が ${overdue.length} 件あります。`);
        stocks.forEach(s => { const q = state.liveQuotes[s.code]; if(s.targetPrice && q && q.price >= s.targetPrice) notifyUser('目標到達', `${s.name}が目標(¥${s.targetPrice})に到達!`); });
    };

    // --- FETCH LIVE QUOTES ---
    const fetchQuotes = async (showLd = false) => {
        const tkrs = state.currentUser.data.stocks.map(s=>s.code);
        if(tkrs.length === 0 || state.isOffline) return;
        const res = await callGasApi('getStockPrices', { tickers: tkrs }, showLd);
        if(res && res.data) {
            state.liveQuotes = res.data;
            renderDash(); renderStocks(); renderAccounts(); renderCharts(); runChecks();
        }
    };

    // --- RENDERING ---
    const render = async () => { if(!state.currentUser) return; recalcBalances(); renderDropdowns(); renderDash(); renderHistory(); renderStocks(); renderAccounts(); renderCategories(); renderCharts(); };

    const renderDropdowns = () => {
        const txs = state.currentUser.data.transactions.filter(t => t.type !== 'initial');
        const months =[...new Set(txs.map(t => t.date.substring(0,7)))].sort().reverse();
        const buildOpts = (sel, val) => { sel.innerHTML = '<option value="all">全期間</option>' + months.map(m=>`<option value="${m}" ${val===m?'selected':''}>${m.replace('-','年')}月</option>`).join(''); };
        buildOpts(gid('month-dropdown'), state.selectedMonth); buildOpts(gid('report-month-dropdown'), state.reportSelectedMonth);
    };

    const renderDash = () => {
        const { accounts, transactions, settings, stocks } = state.currentUser.data;
        const validTx = transactions.filter(t => !t.isScheduled);
        
        const cashBal = accounts.reduce((s,a)=>s+a.balance, 0);
        const stockBal = stocks.reduce((s,st) => {
            const prc = state.liveQuotes[st.code] ? state.liveQuotes[st.code].price : st.price;
            return s + (st.shares * prc);
        }, 0);
        gid('total-balance').textContent = formatCur(cashBal + stockBal);
        gid('stock-balance').textContent = formatCur(stockBal);

        const now = new Date(); const mStr = formatDt(now).substring(0,7);
        // 今月の収入・支出 (振替や初期残高は除外)
        const mTx = validTx.filter(t => t.date.substring(0,7) === mStr && t.type !== 'initial' && t.type !== 'transfer');
        const monthlyInc = mTx.reduce((s,t) => s + (t.deposit||0), 0);
        const monthlyExp = mTx.reduce((s,t) => s + (t.withdrawal||0), 0);
        gid('monthly-income').firstChild.textContent = `${formatCur(monthlyInc)} `;
        gid('monthly-expense').textContent = formatCur(monthlyExp);

        gid('account-balances').innerHTML = accounts.map(a=>`<li><span>${a.name}</span><span>${formatCur(a.balance)}</span></li>`).join('') || '<li>なし</li>';

        const budget = settings.budget || 0;
        gid('budget-text').textContent = budget > 0 ? `${formatCur(monthlyExp)} / ${formatCur(budget)}` : '未設定';
        gid('budget-amount').value = budget || '';
        const pct = budget > 0 ? Math.min((monthlyExp/budget)*100, 100) : 0;
        const pBar = gid('budget-progress'); pBar.style.width = `${pct}%`;
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
                const f = state.currentUser.data.accounts.find(a=>a.id===tx.accountId)?.name || '不明'; const t = state.currentUser.data.accounts.find(a=>a.id===tx.toAccountId)?.name || '不明';
                accName = `${f} <i class="fas fa-arrow-right"></i> ${t}`; diffHtml = `<span style="color:#3498db;">振替 ${formatCur(tx.amount)}</span>`;
            } else {
                accName = state.currentUser.data.accounts.find(a=>a.id===tx.accountId)?.name || '不明';
                incHtml = tx.deposit>0 ? `<span class="income-color">${formatCur(tx.deposit)}</span>` : ''; expHtml = tx.withdrawal>0 ? `<span class="expense-color">${formatCur(tx.withdrawal)}</span>` : '';
                const diff = (tx.deposit||0) - (tx.withdrawal||0); diffHtml = `<span class="${diff>=0?'income-color':'expense-color'}">${formatCur(diff,true)}</span>`;
            }

            let actHtml = `<div class="action-buttons">`;
            if(tx.isScheduled) actHtml += `<button class="exec-tx" data-id="${tx.id}"><i class="fas fa-check-circle"></i></button>`;
            actHtml += `<button class="edit-tx" data-id="${tx.id}"><i class="fas fa-edit"></i></button><button class="del-tx" data-id="${tx.id}"><i class="fas fa-trash"></i></button></div>`;
            tr.innerHTML = `<td>${statusHtml}</td><td>${formatDt(tx.date)}</td><td>${catHtml}</td><td>${accName}</td><td>${incHtml}</td><td>${expHtml}</td><td>${diffHtml}</td><td>${tx.memo}</td><td>${actHtml}</td>`;
            tb.appendChild(tr);
        });
    };

    const renderStocks = () => {
        const stocks = state.currentUser.data.stocks;
        const cont = gid('stocks-list-container'); cont.innerHTML = '';
        if(stocks.length === 0) { cont.innerHTML = '<p style="color:#777;text-align:center;">銘柄がありません</p>'; return; }

        stocks.forEach(s => {
            const q = state.liveQuotes[s.code] || { price: s.price, change: 0, changepct: 0 };
            const evalVal = s.shares * q.price;
            const pl = evalVal - (s.shares * s.price);
            const plPct = s.price > 0 ? (pl / (s.shares * s.price)) * 100 : 0;
            const isUpDay = q.change >= 0; const isUpTotal = pl >= 0;

            cont.innerHTML += `
                <div class="stock-card">
                    <div class="stock-header">
                        <div class="stock-title"><strong>${s.code}</strong><small>${s.name}</small></div>
                        <div class="stock-current-price">
                            <span class="price">${formatCur(q.price)}</span>
                            <span class="change ${isUpDay?'income-color':'expense-color'}">${isUpDay?'+':''}${q.change} (${isUpDay?'+':''}${q.changepct.toFixed(2)}%)</span>
                        </div>
                    </div>
                    <div class="stock-details">
                        <div>保有数: <strong>${s.shares}</strong></div>
                        <div>取得単価: <strong>${formatCur(s.price)}</strong></div>
                        <div>評価額: <strong>${formatCur(evalVal)}</strong></div>
                        <div class="${isUpTotal?'income-color':'expense-color'}">評価損益: <strong>${isUpTotal?'+':''}${formatCur(pl, false)} (${isUpTotal?'+':''}${plPct.toFixed(2)}%)</strong></div>
                    </div>
                    <div class="stock-actions">
                        <button class="small-btn sell-stock-btn" data-id="${s.id}" style="background-color: var(--secondary-color);"><i class="fas fa-hand-holding-usd"></i> 売却</button>
                        <button class="small-btn cancel-btn del-stock-btn" data-id="${s.id}"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            `;
        });
    };

    const renderAccounts = () => {
        const accs = state.currentUser.data.accounts;
        const opts = `<option value="" disabled selected>選択してください</option>` + accs.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');['account-select', 'transfer-from', 'transfer-to', 'scheduled-account-select', 'adjust-account-select', 'stock-account', 'edit-account-select'].forEach(id => { const el = gid(id); if(el) { const val = el.value; el.innerHTML = opts; if(val) el.value = val; } });
        
        const txs = state.currentUser.data.transactions;
        const stocks = state.currentUser.data.stocks;
        
        gid('accounts-table-body').innerHTML = accs.map(a=>{
            const ini = txs.find(t=>t.accountId===a.id && t.type==='initial')?.amount||0;
            const linkedStocks = stocks.filter(s => s.linkAccountId === a.id);
            const stVal = linkedStocks.reduce((sum, st) => { const prc = state.liveQuotes[st.code]?.price || st.price; return sum + (st.shares * prc); }, 0);
            return `<tr>
                <td><strong>${a.name}</strong></td>
                <td>${formatCur(a.balance)}</td>
                <td>${formatCur(stVal)}</td>
                <td><strong>${formatCur(a.balance + stVal)}</strong></td>
                <td class="action-buttons"><button class="del-acc" data-id="${a.id}"><i class="fas fa-trash"></i></button></td>
            </tr>`;
        }).join('');
        if(gid('adjust-account-select').value) gid('current-app-balance').textContent = formatCur(accs.find(a=>a.id===parseInt(gid('adjust-account-select').value))?.balance||0);
    };

    const renderCategories = () => {
        const cats = state.currentUser.data.categories; const accs = state.currentUser.data.accounts;
        const opts = `<option value="">なし</option>` + cats.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');['category-select', 'scheduled-category-select', 'edit-category-select'].forEach(id => { const el = gid(id); if(el) { const val = el.value; el.innerHTML = opts; if(val) el.value = val; } });
        gid('category-account-link').innerHTML = `<option value="">設定しない</option>` + accs.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
        gid('categories-table-body').innerHTML = cats.map(c=>`<tr><td><span class="category-tag" style="background-color:${c.color}">${c.name}</span></td><td>${accs.find(a=>a.id===c.defaultAccountId)?.name||'なし'}</td><td class="action-buttons"><button class="del-cat" data-id="${c.id}"><i class="fas fa-trash"></i></button></td></tr>`).join('');
    };

    const renderCharts = () => {
        const { transactions } = state.currentUser.data;
        const validTx = transactions.filter(t=>!t.isScheduled);

        // 口座別資産推移グラフ
        const sTxs = [...validTx].sort((a,b)=>new Date(a.date)-new Date(b.date));
        if(sTxs.length > 0) {
            const dMap = new Map(); const endD = new Date();
            for(let d=new Date(sTxs[0].date); d<=endD; d.setDate(d.getDate()+1)){ const k=formatDt(d); const b={tot:0}; state.currentUser.data.accounts.forEach(a=>b[a.id]=0); dMap.set(k,b); }
            let cBal = {}; state.currentUser.data.accounts.forEach(a=>{ cBal[a.id] = sTxs.find(t=>t.accountId===a.id&&t.type==='initial')?.amount||0; });
            dMap.forEach(b=>state.currentUser.data.accounts.forEach(a=>b[a.id]=cBal[a.id]));
            sTxs.filter(t=>t.type!=='initial').forEach(t=>{
                if(t.type==='transfer'){ cBal[t.accountId]-=t.amount; cBal[t.toAccountId]+=t.amount; } else { cBal[t.accountId]+=(t.deposit||0)-(t.withdrawal||0); }
                for(let d=new Date(t.date); d<=endD; d.setDate(d.getDate()+1)){ const k=formatDt(d); if(dMap.has(k)) state.currentUser.data.accounts.forEach(a=>dMap.get(k)[a.id]=cBal[a.id]); }
            });
            dMap.forEach(b=>b.tot=Object.values(b).reduce((s,v)=>typeof v==='number'?s+v:s,0));
            const lbls=Array.from(dMap.keys()), cols=['#3498db','#e74c3c','#9b59b6','#2ecc71','#f1c40f','#1abc9c','#34495e'];
            const ds=[{label:'全口座合計', data:lbls.map(d=>dMap.get(d).tot), borderColor:'rgba(0,0,0,0.8)', backgroundColor:'rgba(0,0,0,0.05)', type:'line', borderWidth:3, fill:true, pointRadius: 0}];
            state.currentUser.data.accounts.forEach((a,i)=>ds.push({label:a.name, data:lbls.map(d=>dMap.get(d)[a.id]), borderColor:cols[i%cols.length], type:'line', borderWidth:1.5, fill:false, pointRadius: 0}));
            if(state.charts.bal) state.charts.bal.destroy();
            state.charts.bal = new Chart(gid('balance-chart').getContext('2d'), { data:{labels:lbls, datasets:ds}, options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, scales:{x:{type:'time',time:{unit:'month'}},y:{ticks:{callback:v=>`¥ ${v.toLocaleString()}`}}}}});
        }

        // 月毎収入・支出
        const repD = {};
        validTx.filter(t=>t.type!=='initial' && t.type!=='transfer').forEach(t=>{ const m = t.date.substring(0,7); if(!repD[m]) repD[m]={inc:0,exp:0}; repD[m].inc+=t.deposit||0; repD[m].exp+=t.withdrawal||0; });
        const rMs = Object.keys(repD).sort(); const rLs = rMs.map(m=>`${m.substring(0,4)}/${m.substring(5,7)}`);
        if(state.charts.rep) state.charts.rep.destroy();
        state.charts.rep = new Chart(gid('report-chart').getContext('2d'), { type:'bar', data:{labels:rLs, datasets:[{label:'収入',data:rMs.map(m=>repD[m].inc),backgroundColor:'rgba(46,204,113,0.8)'},{label:'支出',data:rMs.map(m=>repD[m].exp),backgroundColor:'rgba(231,76,60,0.8)'}]}, options:{responsive:true, maintainAspectRatio:false}});

        // カテゴリ支出グラフ
        let tCat = validTx.filter(t=>t.type!=='initial' && t.type!=='transfer');
        if(state.reportSelectedMonth !== 'all') tCat = tCat.filter(t=>t.date.substring(0,7) === state.reportSelectedMonth);
        const pData = {}; tCat.forEach(t=>{ if(t.withdrawal>0) { const c = t.categoryId||'unknown'; pData[c] = (pData[c]||0)+t.withdrawal; }});
        const pLbls=[], pVals=[], pCols=[];
        Object.keys(pData).forEach(cId => {
            if(cId==='unknown') { pLbls.push('未分類'); pVals.push(pData[cId]); pCols.push('#bdc3c7'); }
            else { const c = state.currentUser.data.categories.find(ca=>ca.id==cId); if(c) { pLbls.push(c.name); pVals.push(pData[cId]); pCols.push(c.color); } }
        });
        if(state.charts.cat) state.charts.cat.destroy();
        state.charts.cat = new Chart(gid('category-chart').getContext('2d'), { type:'doughnut', data:{ labels:pLbls, datasets:[{data:pVals, backgroundColor:pCols, borderWidth:0}] }, options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right'}}} });
    };

    // --- EVENT LISTENERS ---
    const setupEvents = () => {
        gid('show-signup').onclick = e => { e.preventDefault(); gid('login-form').style.display='none'; gid('signup-form').style.display='block'; };
        gid('show-login').onclick = e => { e.preventDefault(); gid('signup-form').style.display='none'; gid('login-form').style.display='block'; };
        gid('login-form').onsubmit = async e => { e.preventDefault(); const res = await callGasApi('login', { email: gid('login-email').value, passwordHash: simpleHash(gid('login-password').value) }, true); if(res && res.status==='success') { localStorage.setItem('uid', res.userId); init(); } };
        gid('signup-form').onsubmit = async e => { e.preventDefault(); const email=gid('signup-email').value, pwd=gid('signup-password').value, bk = Array(16).fill(0).map(()=>Math.floor(Math.random()*16).toString(16)).join(''); const res = await callGasApi('signup', { email, passwordHash: simpleHash(pwd), backupKeyHash: simpleHash(bk) }, true); if(res && res.status==='success') { gid('new-backup-key').textContent = bk; gid('backup-key-modal').classList.add('visible'); } };
        gid('copy-backup-key-btn').onclick = () => navigator.clipboard.writeText(gid('new-backup-key').textContent).then(()=>showToast('コピーしました'));
        gid('logout-btn').onclick = () => { if(confirm('ログアウトしますか？')){ localStorage.removeItem('uid'); location.reload(); }};

        navLinks.forEach(l => l.onclick = e => { e.preventDefault(); const vId = l.dataset.view; views.forEach(v=>v.classList.remove('active')); gid(vId).classList.add('active'); navLinks.forEach(nl=>nl.classList.remove('active')); qA(`.nav-link[data-view="${vId}"]`).forEach(nl=>nl.classList.add('active')); gid('main-title').textContent = l.querySelector('span').textContent; });
        qA('.tab-btn').forEach(b => b.onclick = () => { qA('.tab-btn').forEach(tb=>tb.classList.remove('active')); qA('.tab-content').forEach(tc=>tc.classList.remove('active')); b.classList.add('active'); gid(`tab-${b.dataset.tab}`).classList.add('active'); });

        gid('transaction-form').onsubmit = async e => { e.preventDefault(); const aId=parseInt(gid('account-select').value), cId=parseInt(gid('category-select').value)||null, amt=parseFloat(gid('tx-amount').value), isInc=q('input[name="tx-type"]:checked').value==='income'; state.currentUser.data.transactions.push({ id:Date.now(), accountId:aId, categoryId:cId, date:gid('date').value, deposit:isInc?amt:0, withdrawal:!isInc?amt:0, memo:gid('memo').value, isScheduled:false }); gid('transaction-form').reset(); gid('date').value=formatDt(new Date()); render(); await saveUser(); };
        gid('transfer-form').onsubmit = async e => { e.preventDefault(); const f=parseInt(gid('transfer-from').value), t=parseInt(gid('transfer-to').value), amt=parseFloat(gid('transfer-amount').value); if(f===t) return alert('同じ口座です'); state.currentUser.data.transactions.push({ id:Date.now(), type:'transfer', accountId:f, toAccountId:t, amount:amt, date:gid('transfer-date').value, memo:gid('transfer-memo').value, isScheduled:false }); gid('transfer-form').reset(); gid('transfer-date').value=formatDt(new Date()); showToast('振替完了'); render(); await saveUser(); };
        gid('scheduled-form').onsubmit = async e => { e.preventDefault(); const aId=parseInt(gid('scheduled-account-select').value), amt=parseFloat(gid('scheduled-amount').value), isInc=q('input[name="scheduled-type"]:checked').value==='income'; state.currentUser.data.transactions.push({ id:Date.now(), accountId:aId, categoryId:parseInt(gid('scheduled-category-select').value)||null, date:gid('scheduled-date').value, deposit:isInc?amt:0, withdrawal:!isInc?amt:0, memo:gid('scheduled-memo').value, isScheduled:true }); gid('scheduled-form').reset(); showToast('予定追加'); render(); await saveUser(); };
        gid('adjust-form').onsubmit = async e => { e.preventDefault(); const aId=parseInt(gid('adjust-account-select').value), actual=parseFloat(gid('actual-balance').value); const acc=state.currentUser.data.accounts.find(a=>a.id===aId); const diff=actual-acc.balance; if(diff===0) return showToast('ズレはありません'); state.currentUser.data.transactions.push({ id:Date.now(), accountId:aId, date:formatDt(new Date()), deposit:diff>0?diff:0, withdrawal:diff<0?-diff:0, memo:'残高調整', isScheduled:false }); gid('adjust-form').reset(); showToast('調整完了'); render(); await saveUser(); };

        // --- 株式検索 ---
        const sInp = gid('stock-search-input'), sRes = gid('stock-search-results');
        let sTo;
        sInp.addEventListener('input', e => {
            clearTimeout(sTo); const qStr = e.target.value.trim();
            if(qStr.length < 2) { sRes.style.display = 'none'; return; }
            sTo = setTimeout(async () => {
                try {
                    const res = await callGasApi('searchStock', { query: qStr });
                    sRes.innerHTML = '';
                    if(res && res.data && res.data.length > 0) {
                        res.data.forEach(item => {
                            const li = document.createElement('li'); li.textContent = `${item.symbol} - ${item.name || '不明'}`;
                            li.onclick = () => {
                                let code = item.symbol; if(code.endsWith('.T')) code = code.replace('.T', '');
                                gid('stock-code').value = code; gid('stock-name').value = item.name || '';
                                sRes.style.display = 'none'; sInp.value = '';
                            };
                            sRes.appendChild(li);
                        });
                        sRes.style.display = 'block';
                    } else {
                        const li = document.createElement('li'); li.textContent = '見つかりませんでした'; li.style.color = '#999';
                        sRes.appendChild(li); sRes.style.display = 'block';
                    }
                } catch(err) { console.error(err); }
            }, 600);
        });
        document.addEventListener('click', e => { if(e.target !== sInp && e.target !== sRes) sRes.style.display = 'none'; });

        gid('refresh-stocks').onclick = () => fetchQuotes(true);
        gid('add-stock-form').onsubmit = async e => { e.preventDefault(); const accId=parseInt(gid('stock-account').value), shrs=parseFloat(gid('stock-shares').value), prc=parseFloat(gid('stock-price').value), nm=gid('stock-name').value; const sId = Date.now();
            const acc = state.currentUser.data.accounts.find(a=>a.id === accId);
            if(acc && acc.balance < (shrs * prc)) if(!confirm('口座の買付余力が不足していますが追加しますか？')) return;

            state.currentUser.data.stocks.push({ id:sId, code:gid('stock-code').value.toUpperCase(), name:nm, shares:shrs, price:prc, targetPrice:parseFloat(gid('stock-target').value)||null, linkAccountId:accId }); 
            state.currentUser.data.transactions.push({ id:sId+1, accountId:accId, date:formatDt(new Date()), deposit:0, withdrawal:shrs*prc, memo:`[株式買付] ${nm}`, isScheduled:false }); 
            gid('add-stock-form').reset(); showToast('買付代金を出金し、銘柄を追加しました'); render(); await saveUser(); fetchQuotes(); 
        };
        gid('sell-stock-form').onsubmit = async e => { e.preventDefault(); const sId=parseInt(gid('sell-stock-id').value), shrs=parseFloat(gid('sell-shares').value), prc=parseFloat(gid('sell-price').value); const st=state.currentUser.data.stocks.find(s=>s.id===sId); if(!st||shrs>st.shares) return alert('保有数オーバー'); state.currentUser.data.transactions.push({ id:Date.now(), accountId:st.linkAccountId, date:formatDt(new Date()), deposit:shrs*prc, withdrawal:0, memo:`[株式売却] ${st.name}`, isScheduled:false }); st.shares-=shrs; if(st.shares<=0) state.currentUser.data.stocks=state.currentUser.data.stocks.filter(s=>s.id!==sId); gid('sell-stock-modal').classList.remove('visible'); gid('sell-stock-form').reset(); showToast('売却代金を入金しました'); render(); await saveUser(); };

        document.body.addEventListener('click', async e => {
            const btn = e.target.closest('button'); if(!btn) return;
            if(btn.classList.contains('exec-tx')) { const tx=state.currentUser.data.transactions.find(t=>t.id==btn.dataset.id); if(tx&&confirm('実行済みにしますか？')){ tx.isScheduled=false; tx.date=formatDt(new Date()); render(); await saveUser(); } }
            if(btn.classList.contains('edit-tx')) { 
                const tx=state.currentUser.data.transactions.find(t=>t.id==btn.dataset.id); 
                if(tx && tx.type!=='transfer'){ gid('edit-transaction-id').value=tx.id; gid('edit-date').value=formatDt(tx.date); gid('edit-account-select').value=tx.accountId; gid('edit-category-select').value=tx.categoryId||''; const isInc=tx.deposit>0; q(`input[name="edit-tx-type"][value="${isInc?'income':'expense'}"]`).checked=true; gid('edit-amount').value=isInc?tx.deposit:tx.withdrawal; gid('edit-memo').value=tx.memo; gid('edit-modal').classList.add('visible'); } else if(tx && tx.type==='transfer') alert('振替は現在編集できません。削除して再登録してください。');
            }
            if(btn.classList.contains('del-tx')) { if(confirm('削除しますか？')){ state.currentUser.data.transactions=state.currentUser.data.transactions.filter(t=>t.id!=btn.dataset.id); render(); await saveUser(); } }
            if(btn.classList.contains('sell-stock-btn')) { gid('sell-stock-id').value=btn.dataset.id; gid('sell-stock-modal').classList.add('visible'); }
            if(btn.classList.contains('del-stock-btn')) { if(confirm('削除しますか？（資金は戻りません）')){ state.currentUser.data.stocks=state.currentUser.data.stocks.filter(s=>s.id!=btn.dataset.id); render(); await saveUser(); } }
            if(btn.classList.contains('del-acc')) { if(confirm('この口座と全関連取引を削除しますか？')){ state.currentUser.data.accounts=state.currentUser.data.accounts.filter(a=>a.id!=btn.dataset.id); state.currentUser.data.transactions=state.currentUser.data.transactions.filter(t=>t.accountId!=btn.dataset.id && t.toAccountId!=btn.dataset.id); render(); await saveUser(); } }
            if(btn.classList.contains('del-cat')) { if(confirm('カテゴリを削除しますか？')){ state.currentUser.data.categories=state.currentUser.data.categories.filter(c=>c.id!=btn.dataset.id); state.currentUser.data.transactions.forEach(t=>{if(t.categoryId==btn.dataset.id) t.categoryId=null;}); render(); await saveUser(); } }
            if(btn.classList.contains('modal-close')) qA('.modal-overlay').forEach(m=>m.classList.remove('visible'));
        });

        gid('edit-transaction-form').onsubmit = async e => { e.preventDefault(); const tId=parseInt(gid('edit-transaction-id').value), tx=state.currentUser.data.transactions.find(t=>t.id===tId); if(tx){ tx.date=gid('edit-date').value; tx.accountId=parseInt(gid('edit-account-select').value); tx.categoryId=parseInt(gid('edit-category-select').value)||null; const isInc=q('input[name="edit-tx-type"]:checked').value==='income', amt=parseFloat(gid('edit-amount').value); tx.deposit=isInc?amt:0; tx.withdrawal=!isInc?amt:0; tx.memo=gid('edit-memo').value; gid('edit-modal').classList.remove('visible'); render(); await saveUser(); } };

        gid('month-dropdown').onchange = e => { state.selectedMonth = e.target.value; renderHistory(); };
        gid('status-dropdown').onchange = e => { state.historyStatus = e.target.value; renderHistory(); };
        gid('report-month-dropdown').onchange = e => { state.reportSelectedMonth = e.target.value; renderCharts(); };
        gid('adjust-account-select').onchange = e => { const acc = state.currentUser.data.accounts.find(a=>a.id===parseInt(e.target.value)); gid('current-app-balance').textContent = acc?formatCur(acc.balance):'¥ 0'; };

        gid('budget-form').onsubmit = async e => { e.preventDefault(); state.currentUser.data.settings.budget = parseFloat(gid('budget-amount').value)||0; showToast('保存しました'); render(); await saveUser(); };
        gid('add-account-form').onsubmit = async e => { e.preventDefault(); const aId=Date.now(), bal=parseFloat(gid('initial-balance').value); state.currentUser.data.accounts.push({id:aId, name:gid('account-name').value, balance:0}); if(bal>0) state.currentUser.data.transactions.push({id:Date.now()+1, type:'initial', accountId:aId, amount:bal}); gid('add-account-form').reset(); render(); await saveUser(); };
        gid('add-category-form').onsubmit = async e => { e.preventDefault(); state.currentUser.data.categories.push({id:Date.now(), name:gid('category-name').value, color:gid('category-color').value, defaultAccountId:parseInt(gid('category-account-link').value)||null}); gid('add-category-form').reset(); render(); await saveUser(); };
        
        gid('change-email-form').onsubmit = async e => { e.preventDefault(); const res = await callGasApi('changeEmail', {userId:state.currentUser.id, newEmail:gid('change-email-new').value, passwordHash:simpleHash(gid('change-email-password').value)}, true); if(res){ showToast('変更完了'); gid('change-email-form').reset(); }};
        gid('change-password-form').onsubmit = async e => { e.preventDefault(); const res = await callGasApi('changePassword', {userId:state.currentUser.id, currentPasswordHash:simpleHash(gid('change-password-current').value), newPasswordHash:simpleHash(gid('change-password-new').value), backupKeyHash:simpleHash(gid('change-password-backup-key').value)}, true); if(res){ showToast('変更完了'); gid('change-password-form').reset(); }};
        gid('show-backup-key-form').onsubmit = async e => { e.preventDefault(); const res = await callGasApi('getBackupKey', {userId:state.currentUser.id, passwordHash:simpleHash(gid('show-backup-key-password').value)}, true); if(res){ alert('ローカルキーと一致確認済'); gid('show-backup-key-form').reset(); }};
    };

    // --- INIT ---
    const init = async () => {
        const uid = localStorage.getItem('uid');
        if (uid) {
            let userStr = localStorage.getItem('localChanges');
            if (userStr) { state.currentUser = initUserData(JSON.parse(userStr)); state.hasLocalChanges = true; } 
            else { const res = await callGasApi('getUserData', { userId: parseInt(uid) }, true); if (res && res.userData) state.currentUser = initUserData(res.userData); }

            if(state.currentUser) {
                state.selectedMonth = localStorage.getItem(`selectedMonth_${state.currentUser.id}`) || 'all';
                gid('auth-view').style.display='none'; gid('app-view').style.display='block';
                gid('date').value = formatDt(new Date()); gid('transfer-date').value = formatDt(new Date()); gid('scheduled-date').value = formatDt(new Date());
                setupEvents(); requestPushPerm(); await syncData(); render();
                // 初期ロード時・非同期で株価取得
                fetchQuotes();
            } else { localStorage.removeItem('uid'); gid('auth-view').style.display='flex'; setupEvents(); }
        } else { gid('auth-view').style.display='flex'; setupEvents(); }
    };
    init();
});