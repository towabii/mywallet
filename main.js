const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwKT9eMppIlTxIV0ULDQ_-ijXd6wLv2uTRTntbfoTZ-YgMVzdQ2o9HPdt6xHTwYU14/exec'; // 必ずご自身のGASウェブアプリURLに書き換えてください

document.addEventListener('DOMContentLoaded', () => {
    // --- STATE & AUTH ---
    let state = { 
        isDisguiseMode: false, 
        currentUser: null, 
        selectedMonth: 'all', 
        reportSelectedMonth: 'all',
        balanceChart: null, 
        reportChart: null, 
        categoryChart: null,
        localBackupKey: null 
    };

    // --- DOM Elements ---
    const authView = document.getElementById('auth-view'); const appView = document.getElementById('app-view');
    const loginForm = document.getElementById('login-form'); const signupForm = document.getElementById('signup-form');
    const showSignup = document.getElementById('show-signup'); const showLogin = document.getElementById('show-login');
    const loadingOverlay = document.getElementById('loading-overlay');
    const views = document.querySelectorAll('.view'); const navLinks = document.querySelectorAll('.nav-link'); const mainTitleEl = document.getElementById('main-title');
    // Dashboard
    const totalBalanceEl = document.getElementById('total-balance'); const monthlyIncomeEl = document.getElementById('monthly-income');
    const monthlyExpenseEl = document.getElementById('monthly-expense'); const totalInitialBalanceEl = document.getElementById('total-initial-balance'); const accountBalancesEl = document.getElementById('account-balances');
    // Tabs & Forms
    const tabBtns = document.querySelectorAll('.tab-btn'); const tabContents = document.querySelectorAll('.tab-content');
    const transactionForm = document.getElementById('transaction-form');
    const scheduledForm = document.getElementById('scheduled-form');
    const adjustForm = document.getElementById('adjust-form');
    const addAccountForm = document.getElementById('add-account-form'); const addCategoryForm = document.getElementById('add-category-form');
    // Tables & Filters
    const historyTableBody = document.getElementById('history-table-body'); const accountsTableBody = document.getElementById('accounts-table-body'); const categoriesTableBody = document.getElementById('categories-table-body');
    const monthDropdown = document.getElementById('month-dropdown');
    const reportMonthDropdown = document.getElementById('report-month-dropdown');
    // Selects
    const accountSelectEl = document.getElementById('account-select'); const categorySelectEl = document.getElementById('category-select'); const categoryAccountLinkSelectEl = document.getElementById('category-account-link');
    // Modals & Settings
    const editModal = document.getElementById('edit-modal'); const editForm = document.getElementById('edit-transaction-form'); const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const editAccountModal = document.getElementById('edit-account-modal'); const editAccountForm = document.getElementById('edit-account-form'); const cancelEditAccountBtn = document.getElementById('cancel-edit-account-btn');
    const editCategoryModal = document.getElementById('edit-category-modal'); const editCategoryForm = document.getElementById('edit-category-form'); const cancelEditCategoryBtn = document.getElementById('cancel-edit-category-btn');
    const backupKeyModal = document.getElementById('backup-key-modal'); const closeBackupKeyModalBtn = document.getElementById('close-backup-key-modal'); const copyBackupKeyBtn = document.getElementById('copy-backup-key-btn');
    const logoutBtn = document.getElementById('logout-btn'); const changeEmailForm = document.getElementById('change-email-form'); const changePasswordForm = document.getElementById('change-password-form');
    const showBackupKeyForm = document.getElementById('show-backup-key-form');

    // --- UTILITY & API FUNCTIONS ---
    const showLoading = () => loadingOverlay.style.display = 'flex';
    const hideLoading = () => loadingOverlay.style.display = 'none';
    const simpleHash = str => { let hash = 0; for (let i = 0; i < str.length; i++) { const char = str.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash |= 0; } return hash.toString(); };
    const generateBackupKey = () => [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

    async function callGasApi(action, payload, showLoadingIndicator = false) {
        if (showLoadingIndicator) showLoading();
        try {
            const res = await fetch(GAS_WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action, payload }), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
            if (!res.ok) throw new Error(`サーバーエラー: ${res.status}`);
            const result = await res.json();
            if (result.status === 'error') throw new Error(result.message);
            return result;
        } catch (error) {
            console.error('API Error:', error);
            if(showLoadingIndicator) alert(`エラーが発生しました: ${error.message}`);
            return null;
        } finally {
            if (showLoadingIndicator) hideLoading();
        }
    }

    const formatCurrency = (amount, withSign = false) => { const displayAmount = state.isDisguiseMode ? amount * 10 : amount; const sign = withSign && displayAmount > 0 ? '+' : ''; return `${sign}¥ ${Math.round(displayAmount).toLocaleString()}`; };
    const formatDate = (date) => new Date(date).toISOString().split('T')[0];
    const saveSelectedMonth = () => { if (state.currentUser) localStorage.setItem(`selectedMonth_${state.currentUser.id}`, state.selectedMonth); };

    // --- CORE LOGIC ---
    const recalculateAllBalances = () => {
        if (!state.currentUser) return;
        state.currentUser.data.accounts.forEach(acc => {
            const initialTx = state.currentUser.data.transactions.find(tx => tx.accountId === acc.id && tx.type === 'initial');
            acc.balance = initialTx ? initialTx.amount : 0;
        });
        // 予定(isScheduled)は残高計算から除外
        const sortedTransactions = [...state.currentUser.data.transactions].filter(tx => tx.type !== 'initial' && !tx.isScheduled).sort((a, b) => new Date(a.date) - new Date(b.date));
        sortedTransactions.forEach(tx => { const account = state.currentUser.data.accounts.find(acc => acc.id === tx.accountId); if (account) { account.balance += (tx.deposit || 0) - (tx.withdrawal || 0); } });
    };
    
    // --- RENDER FUNCTIONS ---
    const render = () => { 
        if (!state.currentUser) return; 
        recalculateAllBalances(); 
        renderDropdowns();
        renderDashboard(); 
        renderTransactionHistory(); 
        renderAccounts(); 
        renderCategories(); 
        updateChart(); 
        renderReport(); 
    };

    const renderDropdowns = () => {
        const transactions = state.currentUser.data.transactions.filter(tx => tx.type !== 'initial');
        const months =[...new Set(transactions.map(tx => tx.date.substring(0, 7)))].sort().reverse();
        
        // 履歴用
        monthDropdown.innerHTML = '<option value="all">全期間</option>';
        months.forEach(month => {
            const date = new Date(month + '-02');
            const option = document.createElement('option');
            option.value = month; option.textContent = `${date.getFullYear()}年${date.getMonth() + 1}月`;
            if (state.selectedMonth === month) option.selected = true;
            monthDropdown.appendChild(option);
        });

        // レポート用
        reportMonthDropdown.innerHTML = '<option value="all">全期間</option>';
        months.forEach(month => {
            const date = new Date(month + '-02');
            const option = document.createElement('option');
            option.value = month; option.textContent = `${date.getFullYear()}年${date.getMonth() + 1}月`;
            if (state.reportSelectedMonth === month) option.selected = true;
            reportMonthDropdown.appendChild(option);
        });
    };

    const renderDashboard = () => { 
        const { accounts, transactions } = state.currentUser.data; 
        const validTx = transactions.filter(tx => !tx.isScheduled);
        const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0); 
        const totalInitialBalance = validTx.filter(tx => tx.type === 'initial').reduce((sum, tx) => sum + tx.amount, 0); 
        totalBalanceEl.firstChild.textContent = `${formatCurrency(totalBalance)} `; 
        
        const diff = totalBalance - totalInitialBalance; 
        const diffEl = totalBalanceEl.querySelector('.balance-diff'); 
        if (diff !== 0 && accounts.length > 0) { diffEl.textContent = `${diff > 0 ? '↑' : '↓'}${Math.abs(diff).toLocaleString()}`; diffEl.className = `balance-diff ${diff > 0 ? 'income-color' : 'expense-color'}`; } else { diffEl.textContent = ''; } 
        
        const now = new Date(); const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1); const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1); const lastDayOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0); 
        const monthlyTx = validTx.filter(tx => new Date(tx.date) >= firstDayOfMonth && tx.type !== 'initial'); 
        const lastMonthTx = validTx.filter(tx => new Date(tx.date) >= firstDayOfLastMonth && new Date(tx.date) <= lastDayOfLastMonth && tx.type !== 'initial'); 
        const monthlyIncome = monthlyTx.reduce((sum, tx) => sum + (tx.deposit || 0), 0); 
        const monthlyExpense = monthlyTx.reduce((sum, tx) => sum + (tx.withdrawal || 0), 0); 
        const lastMonthIncome = lastMonthTx.reduce((sum, tx) => sum + (tx.deposit || 0), 0); 
        
        monthlyIncomeEl.firstChild.textContent = `${formatCurrency(monthlyIncome)} `; 
        const incomeDiff = monthlyIncome - lastMonthIncome; const incomeDiffEl = monthlyIncomeEl.querySelector('.balance-diff'); 
        if (lastMonthIncome > 0) { incomeDiffEl.textContent = `${incomeDiff >= 0 ? '↑' : '↓'}${Math.abs(incomeDiff).toLocaleString()}`; incomeDiffEl.className = `balance-diff ${incomeDiff >= 0 ? 'income-color' : 'expense-color'}`; } else { incomeDiffEl.textContent = ''; } 
        
        monthlyExpenseEl.firstChild.textContent = formatCurrency(monthlyExpense); 
        totalInitialBalanceEl.textContent = formatCurrency(totalInitialBalance); 
        accountBalancesEl.innerHTML = accounts.length > 0 ? '' : '<li>口座を追加してください</li>'; 
        accounts.forEach(acc => { const li = document.createElement('li'); li.innerHTML = `<span>${acc.name}</span><span>${formatCurrency(acc.balance)}</span>`; accountBalancesEl.appendChild(li); }); 
    };

    const renderTransactionHistory = () => { 
        historyTableBody.innerHTML = ''; 
        const filteredTransactions = state.currentUser.data.transactions
            .filter(tx => tx.type !== 'initial' && (state.selectedMonth === 'all' || tx.date.substring(0, 7) === state.selectedMonth))
            .sort((a, b) => new Date(b.date) - new Date(a.date)); 

        filteredTransactions.forEach(tx => { 
            const account = state.currentUser.data.accounts.find(acc => acc.id === tx.accountId); 
            const category = state.currentUser.data.categories.find(cat => cat.id === tx.categoryId); 
            const tr = document.createElement('tr'); 
            if(tx.isScheduled) tr.classList.add('scheduled-row');

            const deposit = tx.deposit || 0; const withdrawal = tx.withdrawal || 0; const diff = deposit - withdrawal; 
            const statusHtml = tx.isScheduled ? '<span class="status-tag scheduled">予定</span>' : '<span class="status-tag completed">完了</span>';
            
            let actionHtml = `<div class="action-buttons">`;
            if (tx.isScheduled) {
                actionHtml += `<button class="execute-btn" data-id="${tx.id}" title="実行済みにする"><i class="fas fa-check-circle"></i></button>`;
            }
            actionHtml += `<button class="edit-btn" data-id="${tx.id}"><i class="fas fa-edit"></i></button><button class="delete-btn" data-id="${tx.id}"><i class="fas fa-trash"></i></button></div>`;

            tr.innerHTML = `
                <td>${statusHtml}</td>
                <td>${formatDate(tx.date)}</td>
                <td>${category ? `<span class="category-tag" style="background-color:${category.color};">${category.name}</span>` : ''}</td>
                <td>${account ? account.name : '不明'}</td>
                <td class="income-color">${deposit > 0 ? formatCurrency(deposit) : ''}</td>
                <td class="expense-color">${withdrawal > 0 ? formatCurrency(withdrawal) : ''}</td>
                <td class="${diff >= 0 ? 'income-color' : 'expense-color'}">${formatCurrency(diff, true)}</td>
                <td>${tx.memo}</td>
                <td>${actionHtml}</td>
            `; 
            historyTableBody.appendChild(tr); 
        }); 
    };

    const renderCategories = () => { 
        const { categories, accounts } = state.currentUser.data; 
        
        // 既存の選択値を保持
        const currentCatVal = categorySelectEl.value;
        const currentSchedCatVal = document.getElementById('scheduled-category-select')?.value;

        categoriesTableBody.innerHTML = ''; 
        categories.forEach(cat => { 
            const linkedAccount = accounts.find(acc => acc.id === cat.defaultAccountId); 
            const tr = document.createElement('tr'); 
            tr.innerHTML = `<td><span class="category-tag" style="background-color:${cat.color};">${cat.name}</span></td><td>${linkedAccount ? linkedAccount.name : 'なし'}</td><td class="action-buttons"><button class="edit-category-btn" data-id="${cat.id}"><i class="fas fa-edit"></i></button><button class="delete-category-btn" data-id="${cat.id}"><i class="fas fa-trash"></i></button></td>`; 
            categoriesTableBody.appendChild(tr); 
        }); 

        const catOptionsHtml = `<option value="">選択しない</option>` + categories.map(cat => `<option value="${cat.id}">${cat.name}</option>`).join(''); 
        categorySelectEl.innerHTML = catOptionsHtml; 
        document.getElementById('edit-category-select').innerHTML = catOptionsHtml; 
        const schedCatSel = document.getElementById('scheduled-category-select');
        if(schedCatSel) schedCatSel.innerHTML = catOptionsHtml;

        // 復元
        if(currentCatVal) categorySelectEl.value = currentCatVal;
        if(currentSchedCatVal && schedCatSel) schedCatSel.value = currentSchedCatVal;
    };

    const renderAccounts = () => { 
        const { accounts, transactions } = state.currentUser.data; 
        
        // 既存の選択値を保持して勝手に口座が変わるのを防ぐ
        const currentAccVal = accountSelectEl.value;
        const currentSchedAccVal = document.getElementById('scheduled-account-select')?.value;
        const currentAdjAccVal = document.getElementById('adjust-account-select')?.value;

        accountsTableBody.innerHTML = ''; 
        accounts.forEach(acc => { 
            const initialTx = transactions.find(tx => tx.accountId === acc.id && tx.type === 'initial'); 
            const initialBalance = initialTx ? initialTx.amount : 0; 
            const tr = document.createElement('tr'); 
            tr.innerHTML = `<td>${acc.name}</td><td>${formatCurrency(initialBalance)}</td><td>${formatCurrency(acc.balance)}</td><td class="action-buttons"><button class="edit-account-btn" data-id="${acc.id}"><i class="fas fa-edit"></i></button><button class="delete-account-btn" data-id="${acc.id}"><i class="fas fa-trash"></i></button></td>`; 
            accountsTableBody.appendChild(tr); 
        }); 

        const accOptionsHtml = `<option value="" disabled selected>選択してください</option>` + accounts.map(acc => `<option value="${acc.id}">${acc.name}</option>`).join(''); 
        
        accountSelectEl.innerHTML = accOptionsHtml; 
        document.getElementById('edit-account-select').innerHTML = accOptionsHtml; 
        const schedAccSel = document.getElementById('scheduled-account-select');
        if(schedAccSel) schedAccSel.innerHTML = accOptionsHtml;
        const adjAccSel = document.getElementById('adjust-account-select');
        if(adjAccSel) adjAccSel.innerHTML = accOptionsHtml;

        const linkableAccOptions = `<option value="">設定しない</option>` + accounts.map(acc => `<option value="${acc.id}">${acc.name}</option>`).join(''); 
        categoryAccountLinkSelectEl.innerHTML = linkableAccOptions; 
        document.getElementById('edit-category-account-link').innerHTML = linkableAccOptions; 

        // 復元
        if(currentAccVal) accountSelectEl.value = currentAccVal;
        if(currentSchedAccVal && schedAccSel) schedAccSel.value = currentSchedAccVal;
        if(currentAdjAccVal && adjAccSel) adjAccSel.value = currentAdjAccVal;

        // 残高調整用の現在残高表示更新
        updateAdjustAppBalance();
    };

    const renderReport = () => { 
        const validTx = state.currentUser.data.transactions.filter(tx => tx.type !== 'initial' && !tx.isScheduled);
        
        // 1. 棒グラフ (全期間推移)
        const reportData = {}; 
        validTx.forEach(tx => { 
            const month = tx.date.substring(0, 7); 
            if (!reportData[month]) reportData[month] = { income: 0, expense: 0 }; 
            reportData[month].income += tx.deposit || 0; reportData[month].expense += tx.withdrawal || 0; 
        }); 
        const sortedMonths = Object.keys(reportData).sort(); 
        const labels = sortedMonths.map(m => `${m.substring(0,4)}/${m.substring(5,7)}`); 
        
        if (state.reportChart) state.reportChart.destroy(); 
        const ctx = document.getElementById('report-chart').getContext('2d');
        state.reportChart = new Chart(ctx, { 
            type: 'bar', 
            data: { labels, datasets:[ 
                { label: '収入', data: sortedMonths.map(m => reportData[m].income), backgroundColor: 'rgba(46, 204, 113, 0.7)' }, 
                { label: '支出', data: sortedMonths.map(m => reportData[m].expense), backgroundColor: 'rgba(231, 76, 60, 0.7)' } 
            ] }, 
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } } 
        }); 

        // 2. 円グラフ (カテゴリ別支出)
        const pieData = {};
        let targetTx = validTx;
        if (state.reportSelectedMonth !== 'all') {
            targetTx = validTx.filter(tx => tx.date.substring(0, 7) === state.reportSelectedMonth);
        }
        
        targetTx.forEach(tx => {
            if (tx.withdrawal > 0) {
                const catId = tx.categoryId || 'unknown';
                if (!pieData[catId]) pieData[catId] = 0;
                pieData[catId] += tx.withdrawal;
            }
        });

        const pieLabels = []; const pieValues = []; const pieColors =[];
        Object.keys(pieData).forEach(catId => {
            if (catId === 'unknown') {
                pieLabels.push('カテゴリなし'); pieValues.push(pieData[catId]); pieColors.push('#bdc3c7');
            } else {
                const cat = state.currentUser.data.categories.find(c => c.id === parseInt(catId));
                if (cat) { pieLabels.push(cat.name); pieValues.push(pieData[catId]); pieColors.push(cat.color || '#3498db'); }
            }
        });

        if (state.categoryChart) state.categoryChart.destroy();
        const pieCtx = document.getElementById('category-chart').getContext('2d');
        state.categoryChart = new Chart(pieCtx, {
            type: 'doughnut',
            data: { labels: pieLabels, datasets:[{ data: pieValues, backgroundColor: pieColors, borderWidth: 1 }] },
            options: { 
                responsive: true, maintainAspectRatio: false, 
                plugins: { legend: { position: 'right' } }
            }
        });
    };

    const updateChart = () => { 
        const validTx = state.currentUser.data.transactions.filter(tx => !tx.isScheduled);
        if (!state.currentUser || validTx.length === 0) { if(state.balanceChart) state.balanceChart.destroy(); return; }; 
        
        const sortedTransactions = [...validTx].sort((a,b) => new Date(a.date) - new Date(b.date)); 
        if (sortedTransactions.length === 0) return; 
        
        const startDate = new Date(sortedTransactions[0].date); const endDate = new Date(); const dateMap = new Map(); 
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) { 
            const dateKey = formatDate(d); const balances = { total: 0 }; 
            state.currentUser.data.accounts.forEach(acc => balances[acc.id] = 0); dateMap.set(dateKey, balances); 
        } 
        
        let currentBalances = {}; 
        state.currentUser.data.accounts.forEach(acc => { 
            const initialTx = validTx.find(tx => tx.accountId === acc.id && tx.type === 'initial'); 
            currentBalances[acc.id] = initialTx ? initialTx.amount : 0; 
        }); 
        
        dateMap.forEach(balances => { state.currentUser.data.accounts.forEach(acc => balances[acc.id] = currentBalances[acc.id]); }); 
        
        sortedTransactions.filter(tx => tx.type !== 'initial').forEach(tx => { 
            currentBalances[tx.accountId] += (tx.deposit || 0) - (tx.withdrawal || 0); 
            for (let d = new Date(tx.date); d <= endDate; d.setDate(d.getDate() + 1)) { 
                const dateKey = formatDate(d); 
                if (dateMap.has(dateKey)) { state.currentUser.data.accounts.forEach(acc => dateMap.get(dateKey)[acc.id] = currentBalances[acc.id]); } 
            } 
        }); 
        
        dateMap.forEach(balances => balances.total = Object.values(balances).reduce((sum, val) => typeof val === 'number' ? sum + val : sum, 0)); 
        
        const labels = Array.from(dateMap.keys()); const colors =['#3498db', '#e74c3c', '#9b59b6', '#2ecc71', '#f1c40f', '#1abc9c', '#34495e']; 
        const datasets =[{ label: '総資産', data: labels.map(date => state.isDisguiseMode ? dateMap.get(date).total * 10 : dateMap.get(date).total), borderColor: 'rgba(0,0,0,0.8)', backgroundColor: 'rgba(0,0,0,0.1)', type: 'line', borderWidth: 3, fill: true }]; 
        
        state.currentUser.data.accounts.forEach((acc, index) => { 
            datasets.push({ label: acc.name, data: labels.map(date => state.isDisguiseMode ? dateMap.get(date)[acc.id] * 10 : dateMap.get(date)[acc.id]), borderColor: colors[index % colors.length], type: 'line', borderWidth: 1.5, fill: false }); 
        }); 
        
        if (state.balanceChart) state.balanceChart.destroy(); 
        const ctx = document.getElementById('balance-chart').getContext('2d');
        state.balanceChart = new Chart(ctx, { data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'time', time: { unit: 'month' } }, y: { ticks: { callback: value => `¥ ${value.toLocaleString()}` } } } } }); 
    };

    const updateAdjustAppBalance = () => {
        const adjustAccountSelect = document.getElementById('adjust-account-select');
        const currentAppBalanceEl = document.getElementById('current-app-balance');
        if(!adjustAccountSelect || !currentAppBalanceEl || !state.currentUser) return;

        const accountId = parseInt(adjustAccountSelect.value);
        if (isNaN(accountId)) {
            currentAppBalanceEl.textContent = '¥ 0'; return;
        }
        // 再計算済みの残高を使用
        const account = state.currentUser.data.accounts.find(a => a.id === accountId);
        currentAppBalanceEl.textContent = account ? formatCurrency(account.balance) : '¥ 0';
    };
    
    // --- EVENT HANDLERS ---
    const setupEventListeners = () => {
        // Auth
        showSignup.addEventListener('click', (e) => { e.preventDefault(); loginForm.style.display = 'none'; signupForm.style.display = 'block'; });
        showLogin.addEventListener('click', (e) => { e.preventDefault(); signupForm.style.display = 'none'; loginForm.style.display = 'block'; });
        signupForm.addEventListener('submit', async (e) => { e.preventDefault(); const email = document.getElementById('signup-email').value; const password = document.getElementById('signup-password').value; const backupKey = generateBackupKey(); state.localBackupKey = backupKey; const result = await callGasApi('signup', { email, passwordHash: simpleHash(password), backupKeyHash: simpleHash(backupKey) }, true); if (result) { document.getElementById('new-backup-key').textContent = backupKey; backupKeyModal.classList.add('visible'); } });
        copyBackupKeyBtn.addEventListener('click', () => { navigator.clipboard.writeText(document.getElementById('new-backup-key').textContent).then(() => { copyBackupKeyBtn.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(() => { copyBackupKeyBtn.innerHTML = '<i class="fas fa-copy"></i>'; }, 2000); }); });
        closeBackupKeyModalBtn.addEventListener('click', () => { backupKeyModal.classList.remove('visible'); signupForm.style.display = 'none'; loginForm.style.display = 'block'; signupForm.reset(); });
        loginForm.addEventListener('submit', async (e) => { e.preventDefault(); const email = document.getElementById('login-email').value; const password = document.getElementById('login-password').value; const result = await callGasApi('login', { email, passwordHash: simpleHash(password) }, true); if (result) { localStorage.setItem('loggedInUserId', result.userId); init(); } });
        logoutBtn.addEventListener('click', () => { if (confirm('ログアウトしますか？')) { localStorage.removeItem('loggedInUserId'); state.currentUser = null; window.location.reload(); } });

        // App Navigation
        navLinks.forEach(link => { link.addEventListener('click', (e) => { e.preventDefault(); const viewId = link.getAttribute('data-view'); views.forEach(view => view.classList.remove('active')); document.getElementById(viewId).classList.add('active'); navLinks.forEach(l => l.classList.remove('active')); document.querySelectorAll(`.nav-link[data-view="${viewId}"]`).forEach(l => l.classList.add('active')); mainTitleEl.textContent = link.querySelector('span').textContent; }); });
        
        // Tabs
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
            });
        });

        // Dropdowns
        monthDropdown.addEventListener('change', e => { state.selectedMonth = e.target.value; saveSelectedMonth(); renderTransactionHistory(); });
        reportMonthDropdown.addEventListener('change', e => { state.reportSelectedMonth = e.target.value; renderReport(); });
        document.getElementById('adjust-account-select').addEventListener('change', updateAdjustAppBalance);

        // Forms Submit
        addAccountForm.addEventListener('submit', async e => { e.preventDefault(); const name = document.getElementById('account-name').value; const initialBalance = parseFloat(document.getElementById('initial-balance').value); if (name && !isNaN(initialBalance)) { const newAccount = { id: Date.now(), name, balance: 0 }; state.currentUser.data.accounts.push(newAccount); if (initialBalance > 0) { state.currentUser.data.transactions.push({ id: Date.now() + 1, accountId: newAccount.id, type: 'initial', amount: initialBalance, date: new Date().toISOString(), memo: '初期残高' }); } addAccountForm.reset(); render(); await callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser }); } });
        
        transactionForm.addEventListener('submit', async e => { 
            e.preventDefault(); 
            const accountId = parseInt(accountSelectEl.value); 
            const categoryId = parseInt(categorySelectEl.value) || null; 
            const isIncome = document.querySelector('input[name="tx-type"]:checked').value === 'income';
            const amount = parseFloat(document.getElementById('tx-amount').value) || 0;
            const deposit = isIncome ? amount : 0; 
            const withdrawal = !isIncome ? amount : 0; 
            const memo = document.getElementById('memo').value.trim(); const date = document.getElementById('date').value; 
            
            if (isNaN(accountId) || amount === 0) return; 
            state.currentUser.data.transactions.push({ id: Date.now(), accountId, date, deposit, withdrawal, memo, categoryId, isScheduled: false }); 
            transactionForm.reset(); document.getElementById('date').value = formatDate(new Date()); render(); callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser }); 
        });

        scheduledForm.addEventListener('submit', async e => {
            e.preventDefault();
            const accountId = parseInt(document.getElementById('scheduled-account-select').value);
            const categoryId = parseInt(document.getElementById('scheduled-category-select').value) || null;
            const isIncome = document.querySelector('input[name="scheduled-type"]:checked').value === 'income';
            const amount = parseFloat(document.getElementById('scheduled-amount').value) || 0;
            const memo = document.getElementById('scheduled-memo').value.trim();
            const date = document.getElementById('scheduled-date').value;

            if (isNaN(accountId) || amount === 0) return;
            state.currentUser.data.transactions.push({ id: Date.now(), accountId, date, deposit: isIncome ? amount : 0, withdrawal: !isIncome ? amount : 0, memo: memo || '予定', categoryId, isScheduled: true });
            scheduledForm.reset(); document.getElementById('scheduled-date').value = formatDate(new Date()); alert('予定を追加しました。'); render(); callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser });
        });

        adjustForm.addEventListener('submit', async e => {
            e.preventDefault();
            const accountId = parseInt(document.getElementById('adjust-account-select').value);
            const actualBalance = parseFloat(document.getElementById('actual-balance').value);
            if(isNaN(accountId) || isNaN(actualBalance)) return;

            recalculateAllBalances();
            const account = state.currentUser.data.accounts.find(a => a.id === accountId);
            if(!account) return;

            const diff = actualBalance - account.balance;
            if (diff === 0) { alert('アプリの残高と実際の残高は既に一致しています。'); return; }

            const tx = { id: Date.now(), accountId, date: formatDate(new Date()), categoryId: null, deposit: diff > 0 ? diff : 0, withdrawal: diff < 0 ? Math.abs(diff) : 0, memo: '残高調整', isScheduled: false };
            state.currentUser.data.transactions.push(tx);
            adjustForm.reset(); updateAdjustAppBalance(); alert(`差額 ${formatCurrency(diff, true)} を調整しました。`); render(); callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser });
        });

        addCategoryForm.addEventListener('submit', async e => { e.preventDefault(); const name = document.getElementById('category-name').value.trim(); const color = document.getElementById('category-color').value; const defaultAccountId = parseInt(document.getElementById('category-account-link').value, 10) || null; if (name) { state.currentUser.data.categories.push({ id: Date.now(), name, color, defaultAccountId }); addCategoryForm.reset(); render(); await callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser }); } });
        
        // Category link auto select
        categorySelectEl.addEventListener('change', e => { const categoryId = parseInt(e.target.value); if (!categoryId) return; const category = state.currentUser.data.categories.find(c => c.id === categoryId); if (category && category.defaultAccountId) { accountSelectEl.value = category.defaultAccountId; } });
        document.getElementById('scheduled-category-select').addEventListener('change', e => { const categoryId = parseInt(e.target.value); if (!categoryId) return; const category = state.currentUser.data.categories.find(c => c.id === categoryId); if (category && category.defaultAccountId) { document.getElementById('scheduled-account-select').value = category.defaultAccountId; } });

        // Table Actions
        historyTableBody.addEventListener('click', async e => { 
            const executeBtn = e.target.closest('.execute-btn');
            const editBtn = e.target.closest('.edit-btn'); 
            const deleteBtn = e.target.closest('.delete-btn'); 

            if(executeBtn) {
                const txId = parseInt(executeBtn.dataset.id);
                const tx = state.currentUser.data.transactions.find(t => t.id === txId);
                if (tx && tx.isScheduled) {
                    if(confirm('この予定を実行済みにし、実際の残高に反映させますか？')) {
                        tx.isScheduled = false;
                        render();
                        await callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser });
                    }
                }
            }
            
            if (editBtn) { 
                const txId = parseInt(editBtn.dataset.id); 
                const tx = state.currentUser.data.transactions.find(t => t.id === txId); 
                if (tx) { 
                    const form = document.getElementById('edit-transaction-form'); 
                    form.elements['edit-transaction-id'].value = tx.id; 
                    form.elements['edit-date'].value = formatDate(tx.date); 
                    form.elements['edit-category-select'].value = tx.categoryId || ''; 
                    form.elements['edit-account-select'].value = tx.accountId; 
                    
                    const isIncome = tx.deposit > 0;
                    form.querySelector(`input[name="edit-tx-type"][value="${isIncome ? 'income' : 'expense'}"]`).checked = true;
                    form.elements['edit-amount'].value = isIncome ? tx.deposit : tx.withdrawal;
                    
                    form.elements['edit-memo'].value = tx.memo; 
                    editModal.classList.add('visible'); 
                } 
            } 
            if (deleteBtn) { const txId = parseInt(deleteBtn.dataset.id); if (confirm('この取引を削除しますか？')) { state.currentUser.data.transactions = state.currentUser.data.transactions.filter(t => t.id !== txId); render(); await callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser }); } } 
        });
        
        editForm.addEventListener('submit', async e => { 
            e.preventDefault(); 
            const txId = parseInt(editForm.elements['edit-transaction-id'].value); 
            const txIndex = state.currentUser.data.transactions.findIndex(t => t.id === txId); 
            if (txIndex > -1) { 
                const tx = state.currentUser.data.transactions[txIndex]; 
                tx.date = editForm.elements['edit-date'].value; 
                tx.accountId = parseInt(editForm.elements['edit-account-select'].value); 
                tx.categoryId = parseInt(editForm.elements['edit-category-select'].value) || null; 
                
                const isIncome = editForm.querySelector('input[name="edit-tx-type"]:checked').value === 'income';
                const amount = parseFloat(editForm.elements['edit-amount'].value) || 0;
                tx.deposit = isIncome ? amount : 0; 
                tx.withdrawal = !isIncome ? amount : 0; 
                tx.memo = editForm.elements['edit-memo'].value.trim(); 
                
                editModal.classList.remove('visible'); render(); await callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser }); 
            } 
        });
        
        cancelEditBtn.addEventListener('click', () => editModal.classList.remove('visible'));
        
        accountsTableBody.addEventListener('click', async e => { const editBtn = e.target.closest('.edit-account-btn'); const deleteBtn = e.target.closest('.delete-account-btn'); if (editBtn) { const accountId = parseInt(editBtn.dataset.id); const account = state.currentUser.data.accounts.find(acc => acc.id === accountId); if (account) { document.getElementById('edit-account-id').value = account.id; document.getElementById('edit-account-name').value = account.name; editAccountModal.classList.add('visible'); } } if (deleteBtn) { const accountId = parseInt(deleteBtn.dataset.id); const account = state.currentUser.data.accounts.find(acc => acc.id === accountId); if (confirm(`口座「${account.name}」と関連する全ての取引を削除しますか？`)) { state.currentUser.data.accounts = state.currentUser.data.accounts.filter(acc => acc.id !== accountId); state.currentUser.data.transactions = state.currentUser.data.transactions.filter(tx => tx.accountId !== accountId); render(); await callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser }); } } });
        editAccountForm.addEventListener('submit', async e => { e.preventDefault(); const accountId = parseInt(document.getElementById('edit-account-id').value); const newName = document.getElementById('edit-account-name').value.trim(); const account = state.currentUser.data.accounts.find(acc => acc.id === accountId); if (account && newName) { account.name = newName; editAccountModal.classList.remove('visible'); render(); await callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser }); } });
        cancelEditAccountBtn.addEventListener('click', () => editAccountModal.classList.remove('visible'));
        
        categoriesTableBody.addEventListener('click', async e => { const editBtn = e.target.closest('.edit-category-btn'); const deleteBtn = e.target.closest('.delete-category-btn'); if (editBtn) { const catId = parseInt(editBtn.dataset.id); const category = state.currentUser.data.categories.find(c => c.id === catId); if (category) { const form = document.getElementById('edit-category-form'); form.elements['edit-category-id'].value = category.id; form.elements['edit-category-name'].value = category.name; form.elements['edit-category-color'].value = category.color; form.elements['edit-category-account-link'].value = category.defaultAccountId || ''; editCategoryModal.classList.add('visible'); } } if (deleteBtn) { const catId = parseInt(deleteBtn.dataset.id); if (confirm('このカテゴリを削除しますか？')) { state.currentUser.data.categories = state.currentUser.data.categories.filter(c => c.id !== catId); state.currentUser.data.transactions.forEach(tx => { if (tx.categoryId === catId) tx.categoryId = null; }); render(); await callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser }); } } });
        editCategoryForm.addEventListener('submit', async e => { e.preventDefault(); const catId = parseInt(editCategoryForm.elements['edit-category-id'].value); const category = state.currentUser.data.categories.find(c => c.id === catId); if (category) { category.name = editCategoryForm.elements['edit-category-name'].value.trim(); category.color = editCategoryForm.elements['edit-category-color'].value; category.defaultAccountId = parseInt(editCategoryForm.elements['edit-category-account-link'].value, 10) || null; editCategoryModal.classList.remove('visible'); render(); await callGasApi('updateUserData', { userId: state.currentUser.id, userData: state.currentUser }); } });
        cancelEditCategoryBtn.addEventListener('click', () => editCategoryModal.classList.remove('visible'));
        
        // Settings forms
        changeEmailForm.addEventListener('submit', async e => { e.preventDefault(); const newEmail = document.getElementById('change-email-new').value; const password = document.getElementById('change-email-password').value; const result = await callGasApi('changeEmail', { userId: state.currentUser.id, newEmail, passwordHash: simpleHash(password) }, true); if (result) { state.currentUser.email = newEmail; alert('メールアドレスが変更されました。'); changeEmailForm.reset(); } });
        changePasswordForm.addEventListener('submit', async e => { e.preventDefault(); const currentPassword = document.getElementById('change-password-current').value; const newPassword = document.getElementById('change-password-new').value; const backupKey = document.getElementById('change-password-backup-key').value; const result = await callGasApi('changePassword', { userId: state.currentUser.id, currentPasswordHash: simpleHash(currentPassword), newPasswordHash: simpleHash(newPassword), backupKeyHash: simpleHash(backupKey) }, true); if (result) { state.currentUser.passwordHash = simpleHash(newPassword); alert('パスワードが変更されました。'); changePasswordForm.reset(); } });
        showBackupKeyForm.addEventListener('submit', async e => { e.preventDefault(); const password = document.getElementById('show-backup-key-password').value; const result = await callGasApi('getBackupKey', { userId: state.currentUser.id, passwordHash: simpleHash(password) }, true); if (result) { if (state.localBackupKey && simpleHash(state.localBackupKey) === result.backupKeyHash) { alert(`あなたのバックアップキー:\n${state.localBackupKey}`); } else { alert('バックアップキーを特定できませんでした。新規登録セッションでのみ正確なキーが表示されます。'); } showBackupKeyForm.reset(); } });

        // Disguise Mode
        const toggleDisguiseMode = () => { state.isDisguiseMode = !state.isDisguiseMode; render(); };
        window.addEventListener('keydown', e => { if (e.key === '1') toggleDisguiseMode(); });
        let lastShakeTime = 0; window.addEventListener('devicemotion', e => { const { x, y, z } = e.acceleration; if (x === null) return; const acc = Math.sqrt(x*x + y*y + z*z); const now = Date.now(); if (acc > 20 && (now - lastShakeTime > 1000)) { lastShakeTime = now; toggleDisguiseMode(); } });
    };

    // --- INITIALIZATION ---
    const init = async () => {
        const loggedInUserId = localStorage.getItem('loggedInUserId');
        if (loggedInUserId) {
            const result = await callGasApi('getUserData', { userId: parseInt(loggedInUserId) }, true);
            if (result && result.userData) {
                state.currentUser = result.userData;
                state.selectedMonth = localStorage.getItem(`selectedMonth_${state.currentUser.id}`) || 'all';
                authView.style.display = 'none'; appView.style.display = 'block';
                document.getElementById('date').value = formatDate(new Date());
                document.getElementById('scheduled-date').value = formatDate(new Date());
                setupEventListeners();
                render();
            } else { localStorage.removeItem('loggedInUserId'); authView.style.display = 'flex'; appView.style.display = 'none'; setupEventListeners(); }
        } else {
            authView.style.display = 'flex'; appView.style.display = 'none';
            setupEventListeners();
        }
    };
    init();
});