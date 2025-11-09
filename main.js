document.addEventListener('DOMContentLoaded', () => {

    // --- STATE ---
    let state = {
        isDisguiseMode: false,
        accounts: JSON.parse(localStorage.getItem('accounts')) || [],
        categories: JSON.parse(localStorage.getItem('categories')) || [],
        transactions: JSON.parse(localStorage.getItem('transactions')) || [],
        selectedMonth: localStorage.getItem('selectedMonth') || 'all',
        balanceChart: null,
        reportChart: null
    };

    // --- DOM Elements ---
    const views = document.querySelectorAll('.view');
    const navLinks = document.querySelectorAll('.nav-link');
    const mainTitleEl = document.getElementById('main-title');
    
    // Dashboard
    const totalBalanceEl = document.getElementById('total-balance');
    const monthlyIncomeEl = document.getElementById('monthly-income');
    const monthlyExpenseEl = document.getElementById('monthly-expense');
    const totalInitialBalanceEl = document.getElementById('total-initial-balance');
    const accountBalancesEl = document.getElementById('account-balances');
    
    // Forms
    const transactionForm = document.getElementById('transaction-form');
    const addAccountForm = document.getElementById('add-account-form');
    const addCategoryForm = document.getElementById('add-category-form');
    
    // Tables & Filters
    const historyTableBody = document.getElementById('history-table-body');
    const accountsTableBody = document.getElementById('accounts-table-body');
    const categoriesTableBody = document.getElementById('categories-table-body');
    const monthFilterContainer = document.getElementById('month-filter-container');
    
    // Selects
    const accountSelectEl = document.getElementById('account-select');
    const categorySelectEl = document.getElementById('category-select');
    const categoryAccountLinkSelectEl = document.getElementById('category-account-link');

    // Modals
    const editModal = document.getElementById('edit-modal');
    const editForm = document.getElementById('edit-transaction-form');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const editAccountModal = document.getElementById('edit-account-modal');
    const editAccountForm = document.getElementById('edit-account-form');
    const cancelEditAccountBtn = document.getElementById('cancel-edit-account-btn');
    const editCategoryModal = document.getElementById('edit-category-modal');
    const editCategoryForm = document.getElementById('edit-category-form');
    const cancelEditCategoryBtn = document.getElementById('cancel-edit-category-btn');
    
    // --- UTILITY FUNCTIONS ---
    const formatCurrency = (amount, withSign = false) => {
        const displayAmount = state.isDisguiseMode ? amount * 10 : amount;
        const sign = withSign && displayAmount > 0 ? '+' : '';
        return `${sign}¥ ${Math.round(displayAmount).toLocaleString()}`;
    };
    const formatDate = (date) => new Date(date).toISOString().split('T')[0];
    const saveState = () => {
        localStorage.setItem('accounts', JSON.stringify(state.accounts));
        localStorage.setItem('categories', JSON.stringify(state.categories));
        localStorage.setItem('transactions', JSON.stringify(state.transactions));
        localStorage.setItem('selectedMonth', state.selectedMonth);
    };

    // --- CORE LOGIC ---
    const recalculateAllBalances = () => {
        state.accounts.forEach(acc => {
            const initialTx = state.transactions.find(tx => tx.accountId === acc.id && tx.type === 'initial');
            acc.balance = initialTx ? initialTx.amount : 0;
        });
        const sortedTransactions = [...state.transactions].filter(tx => tx.type !== 'initial').sort((a, b) => new Date(a.date) - new Date(b.date));
        sortedTransactions.forEach(tx => {
            const account = state.accounts.find(acc => acc.id === tx.accountId);
            if (account) {
                account.balance += (tx.deposit || 0) - (tx.withdrawal || 0);
            }
        });
    };
    
    // --- RENDER FUNCTIONS ---
    const render = () => {
        recalculateAllBalances();
        renderDashboard();
        renderMonthFilter();
        renderTransactionHistory();
        renderAccounts();
        renderCategories();
        updateChart();
        renderReport();
        saveState();
    };

    const renderDashboard = () => {
        const totalBalance = state.accounts.reduce((sum, acc) => sum + acc.balance, 0);
        const totalInitialBalance = state.transactions.filter(tx => tx.type === 'initial').reduce((sum, tx) => sum + tx.amount, 0);
        totalBalanceEl.firstChild.textContent = `${formatCurrency(totalBalance)} `;
        const diff = totalBalance - totalInitialBalance;
        const diffEl = totalBalanceEl.querySelector('.balance-diff');
        if (diff !== 0 && state.accounts.length > 0) {
            diffEl.textContent = `${diff > 0 ? '↑' : '↓'}${Math.abs(diff).toLocaleString()}`;
            diffEl.className = `balance-diff ${diff > 0 ? 'income-color' : 'expense-color'}`;
        } else { diffEl.textContent = ''; }
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        const monthlyTx = state.transactions.filter(tx => new Date(tx.date) >= firstDayOfMonth && tx.type !== 'initial');
        const lastMonthTx = state.transactions.filter(tx => new Date(tx.date) >= firstDayOfLastMonth && new Date(tx.date) <= lastDayOfLastMonth && tx.type !== 'initial');
        const monthlyIncome = monthlyTx.reduce((sum, tx) => sum + (tx.deposit || 0), 0);
        const monthlyExpense = monthlyTx.reduce((sum, tx) => sum + (tx.withdrawal || 0), 0);
        const lastMonthIncome = lastMonthTx.reduce((sum, tx) => sum + (tx.deposit || 0), 0);
        monthlyIncomeEl.firstChild.textContent = `${formatCurrency(monthlyIncome)} `;
        const incomeDiff = monthlyIncome - lastMonthIncome;
        const incomeDiffEl = monthlyIncomeEl.querySelector('.balance-diff');
        if (lastMonthIncome > 0) {
            incomeDiffEl.textContent = `${incomeDiff >= 0 ? '↑' : '↓'}${Math.abs(incomeDiff).toLocaleString()}`;
            incomeDiffEl.className = `balance-diff ${incomeDiff >= 0 ? 'income-color' : 'expense-color'}`;
        } else { incomeDiffEl.textContent = ''; }
        monthlyExpenseEl.firstChild.textContent = formatCurrency(monthlyExpense);
        totalInitialBalanceEl.textContent = formatCurrency(totalInitialBalance);
        accountBalancesEl.innerHTML = state.accounts.length > 0 ? '' : '<li>口座を追加してください</li>';
        state.accounts.forEach(acc => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${acc.name}</span><span>${formatCurrency(acc.balance)}</span>`;
            accountBalancesEl.appendChild(li);
        });
    };

    const renderMonthFilter = () => {
        monthFilterContainer.innerHTML = '';
        const months = [...new Set(state.transactions.filter(tx => tx.type !== 'initial').map(tx => tx.date.substring(0, 7)))].sort();
        const allBtn = document.createElement('button');
        allBtn.className = `month-filter-btn ${state.selectedMonth === 'all' ? 'active' : ''}`;
        allBtn.textContent = '全期間';
        allBtn.dataset.month = 'all';
        monthFilterContainer.appendChild(allBtn);
        months.forEach(month => {
            const btn = document.createElement('button');
            btn.className = `month-filter-btn ${state.selectedMonth === month ? 'active' : ''}`;
            const date = new Date(month + '-02');
            btn.textContent = `${date.getFullYear()}年${date.getMonth() + 1}月`;
            btn.dataset.month = month;
            monthFilterContainer.appendChild(btn);
        });
    };

    const renderTransactionHistory = () => {
        historyTableBody.innerHTML = '';
        const filteredTransactions = state.transactions.filter(tx => tx.type !== 'initial' && (state.selectedMonth === 'all' || tx.date.substring(0, 7) === state.selectedMonth)).sort((a, b) => new Date(b.date) - new Date(a.date));
        filteredTransactions.forEach(tx => {
            const account = state.accounts.find(acc => acc.id === tx.accountId);
            const category = state.categories.find(cat => cat.id === tx.categoryId);
            const tr = document.createElement('tr');
            const deposit = tx.deposit || 0;
            const withdrawal = tx.withdrawal || 0;
            const diff = deposit - withdrawal;
            tr.innerHTML = `
                <td>${formatDate(tx.date)}</td>
                <td>${category ? `<span class="category-tag" style="background-color:${category.color};">${category.name}</span>` : ''}</td>
                <td>${account ? account.name : '不明'}</td>
                <td class="income-color">${deposit > 0 ? formatCurrency(deposit) : ''}</td>
                <td class="expense-color">${withdrawal > 0 ? formatCurrency(withdrawal) : ''}</td>
                <td class="${diff >= 0 ? 'income-color' : 'expense-color'}">${formatCurrency(diff, true)}</td>
                <td>${tx.memo}</td>
                <td class="action-buttons">
                    <button class="edit-btn" data-id="${tx.id}"><i class="fas fa-edit"></i></button>
                    <button class="delete-btn" data-id="${tx.id}"><i class="fas fa-trash"></i></button>
                </td>
            `;
            historyTableBody.appendChild(tr);
        });
    };
    
    const renderCategories = () => {
        categoriesTableBody.innerHTML = '';
        state.categories.forEach(cat => {
            const linkedAccount = state.accounts.find(acc => acc.id === cat.defaultAccountId);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="category-tag" style="background-color:${cat.color};">${cat.name}</span></td>
                <td>${linkedAccount ? linkedAccount.name : 'なし'}</td>
                <td class="action-buttons">
                    <button class="edit-category-btn" data-id="${cat.id}"><i class="fas fa-edit"></i></button>
                    <button class="delete-category-btn" data-id="${cat.id}"><i class="fas fa-trash"></i></button>
                </td>
            `;
            categoriesTableBody.appendChild(tr);
        });
        
        // Update category select options
        const catOptionsHtml = `<option value="">カテゴリなし</option>` + state.categories.map(cat => `<option value="${cat.id}">${cat.name}</option>`).join('');
        categorySelectEl.innerHTML = catOptionsHtml;
        document.getElementById('edit-category-select').innerHTML = catOptionsHtml;
    };

    const renderAccounts = () => {
        accountsTableBody.innerHTML = '';
        state.accounts.forEach(acc => {
            const initialTx = state.transactions.find(tx => tx.accountId === acc.id && tx.type === 'initial');
            const initialBalance = initialTx ? initialTx.amount : 0;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${acc.name}</td>
                <td>${formatCurrency(initialBalance)}</td>
                <td>${formatCurrency(acc.balance)}</td>
                <td class="action-buttons">
                    <button class="edit-account-btn" data-id="${acc.id}"><i class="fas fa-edit"></i></button>
                    <button class="delete-account-btn" data-id="${acc.id}"><i class="fas fa-trash"></i></button>
                </td>
            `;
            accountsTableBody.appendChild(tr);
        });
        
        const accOptionsHtml = state.accounts.map(acc => `<option value="${acc.id}">${acc.name}</option>`).join('');
        accountSelectEl.innerHTML = accOptionsHtml;
        document.getElementById('edit-account-select').innerHTML = accOptionsHtml;
        
        const linkableAccOptions = `<option value="">なし</option>` + accOptionsHtml;
        categoryAccountLinkSelectEl.innerHTML = linkableAccOptions;
        document.getElementById('edit-category-account-link').innerHTML = linkableAccOptions;
    };
    
    const renderReport = () => {
        const ctx = document.getElementById('report-chart').getContext('2d');
        const reportData = {};
        state.transactions.filter(tx => tx.type !== 'initial').forEach(tx => {
            const month = tx.date.substring(0, 7);
            if (!reportData[month]) reportData[month] = { income: 0, expense: 0 };
            reportData[month].income += tx.deposit || 0;
            reportData[month].expense += tx.withdrawal || 0;
        });
        const sortedMonths = Object.keys(reportData).sort();
        const labels = sortedMonths.map(m => `${m.substring(0,4)}/${m.substring(5,7)}`);
        if (state.reportChart) state.reportChart.destroy();
        state.reportChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets: [ { label: '収入', data: sortedMonths.map(m => reportData[m].income), backgroundColor: 'rgba(46, 204, 113, 0.7)' }, { label: '支出', data: sortedMonths.map(m => reportData[m].expense), backgroundColor: 'rgba(231, 76, 60, 0.7)' } ] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
        });
    };

    const updateChart = () => {
        if (state.transactions.length === 0) { if(state.balanceChart) state.balanceChart.destroy(); return; };
        const ctx = document.getElementById('balance-chart').getContext('2d');
        const sortedTransactions = [...state.transactions].sort((a,b) => new Date(a.date) - new Date(b.date));
        if (sortedTransactions.length === 0) return;
        
        const startDate = new Date(sortedTransactions[0].date);
        const endDate = new Date();
        const dateMap = new Map();
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateKey = formatDate(d);
            const balances = { total: 0 };
            state.accounts.forEach(acc => balances[acc.id] = 0);
            dateMap.set(dateKey, balances);
        }
        let currentBalances = {};
        state.accounts.forEach(acc => {
            const initialTx = state.transactions.find(tx => tx.accountId === acc.id && tx.type === 'initial');
            currentBalances[acc.id] = initialTx ? initialTx.amount : 0;
        });
        
        dateMap.forEach(balances => { state.accounts.forEach(acc => balances[acc.id] = currentBalances[acc.id]); });
        
        sortedTransactions.filter(tx => tx.type !== 'initial').forEach(tx => {
            currentBalances[tx.accountId] += (tx.deposit || 0) - (tx.withdrawal || 0);
            for (let d = new Date(tx.date); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dateKey = formatDate(d);
                if (dateMap.has(dateKey)) { state.accounts.forEach(acc => dateMap.get(dateKey)[acc.id] = currentBalances[acc.id]); }
            }
        });
        dateMap.forEach(balances => balances.total = Object.values(balances).reduce((sum, val) => typeof val === 'number' ? sum + val : sum, 0));
        
        const labels = Array.from(dateMap.keys());
        const colors = ['#3498db', '#e74c3c', '#9b59b6', '#2ecc71', '#f1c40f', '#1abc9c', '#34495e'];
        
        const datasets = [{
            label: '総資産', data: labels.map(date => state.isDisguiseMode ? dateMap.get(date).total * 10 : dateMap.get(date).total),
            borderColor: 'rgba(0,0,0,0.8)', backgroundColor: 'rgba(0,0,0,0.1)', type: 'line', borderWidth: 3, fill: true
        }];
        state.accounts.forEach((acc, index) => {
            datasets.push({
                label: acc.name, data: labels.map(date => state.isDisguiseMode ? dateMap.get(date)[acc.id] * 10 : dateMap.get(date)[acc.id]),
                borderColor: colors[index % colors.length], type: 'line', borderWidth: 1.5, fill: false
            });
        });
        if (state.balanceChart) state.balanceChart.destroy();
        state.balanceChart = new Chart(ctx, {
            data: { labels, datasets },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'time', time: { unit: 'month' } }, y: { ticks: { callback: value => `¥ ${value.toLocaleString()}` } } } }
        });
    };

    // --- EVENT HANDLERS ---
    const setupEventListeners = () => {
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const viewId = link.getAttribute('data-view');
                views.forEach(view => view.classList.remove('active'));
                document.getElementById(viewId).classList.add('active');
                navLinks.forEach(l => l.classList.remove('active'));
                document.querySelectorAll(`.nav-link[data-view="${viewId}"]`).forEach(l => l.classList.add('active'));
                mainTitleEl.textContent = link.querySelector('span').textContent;
            });
        });

        addAccountForm.addEventListener('submit', e => { e.preventDefault(); const name = document.getElementById('account-name').value; const initialBalance = parseFloat(document.getElementById('initial-balance').value); if (name && !isNaN(initialBalance)) { const newAccount = { id: Date.now(), name, balance: 0 }; state.accounts.push(newAccount); if (initialBalance > 0) { state.transactions.push({ id: Date.now() + 1, accountId: newAccount.id, type: 'initial', amount: initialBalance, date: new Date().toISOString(), memo: '初期残高' }); } addAccountForm.reset(); render(); } });

        transactionForm.addEventListener('submit', e => { e.preventDefault(); const accountId = parseInt(accountSelectEl.value); const categoryId = parseInt(categorySelectEl.value) || null; const deposit = parseFloat(document.getElementById('deposit').value) || 0; const withdrawal = parseFloat(document.getElementById('withdrawal').value) || 0; const memo = document.getElementById('memo').value.trim(); const date = document.getElementById('date').value; if (isNaN(accountId) || (deposit === 0 && withdrawal === 0)) return; state.transactions.push({ id: Date.now(), accountId, date, deposit, withdrawal, memo, categoryId }); transactionForm.reset(); document.getElementById('date').value = formatDate(new Date()); render(); alert('記録しました。'); });
        
        categorySelectEl.addEventListener('change', e => { const categoryId = parseInt(e.target.value); if (!categoryId) return; const category = state.categories.find(c => c.id === categoryId); if (category && category.defaultAccountId) { accountSelectEl.value = category.defaultAccountId; } });

        monthFilterContainer.addEventListener('click', e => { if (e.target.classList.contains('month-filter-btn')) { state.selectedMonth = e.target.dataset.month; render(); } });
        
        historyTableBody.addEventListener('click', e => { const editBtn = e.target.closest('.edit-btn'); const deleteBtn = e.target.closest('.delete-btn'); if (editBtn) { const txId = parseInt(editBtn.dataset.id); const tx = state.transactions.find(t => t.id === txId); if (tx) { const form = document.getElementById('edit-transaction-form'); form.elements['edit-transaction-id'].value = tx.id; form.elements['edit-date'].value = formatDate(tx.date); form.elements['edit-category-select'].value = tx.categoryId || ''; form.elements['edit-account-select'].value = tx.accountId; form.elements['edit-deposit'].value = tx.deposit || 0; form.elements['edit-withdrawal'].value = tx.withdrawal || 0; form.elements['edit-memo'].value = tx.memo; editModal.classList.add('visible'); } } if (deleteBtn) { const txId = parseInt(deleteBtn.dataset.id); if (confirm('この取引を削除しますか？')) { state.transactions = state.transactions.filter(t => t.id !== txId); render(); } } });
        editForm.addEventListener('submit', e => { e.preventDefault(); const txId = parseInt(editForm.elements['edit-transaction-id'].value); const txIndex = state.transactions.findIndex(t => t.id === txId); if (txIndex > -1) { const tx = state.transactions[txIndex]; tx.date = editForm.elements['edit-date'].value; tx.accountId = parseInt(editForm.elements['edit-account-select'].value); tx.categoryId = parseInt(editForm.elements['edit-category-select'].value) || null; tx.deposit = parseFloat(editForm.elements['edit-deposit'].value) || 0; tx.withdrawal = parseFloat(editForm.elements['edit-withdrawal'].value) || 0; tx.memo = editForm.elements['edit-memo'].value.trim(); editModal.classList.remove('visible'); render(); } });
        cancelEditBtn.addEventListener('click', () => editModal.classList.remove('visible'));

        accountsTableBody.addEventListener('click', e => { const editBtn = e.target.closest('.edit-account-btn'); const deleteBtn = e.target.closest('.delete-account-btn'); if (editBtn) { const accountId = parseInt(editBtn.dataset.id); const account = state.accounts.find(acc => acc.id === accountId); if (account) { document.getElementById('edit-account-id').value = account.id; document.getElementById('edit-account-name').value = account.name; editAccountModal.classList.add('visible'); } } if (deleteBtn) { const accountId = parseInt(deleteBtn.dataset.id); const account = state.accounts.find(acc => acc.id === accountId); if (confirm(`口座「${account.name}」と関連する全ての取引を削除しますか？`)) { state.accounts = state.accounts.filter(acc => acc.id !== accountId); state.transactions = state.transactions.filter(tx => tx.accountId !== accountId); render(); } } });
        editAccountForm.addEventListener('submit', e => { e.preventDefault(); const accountId = parseInt(document.getElementById('edit-account-id').value); const newName = document.getElementById('edit-account-name').value.trim(); const account = state.accounts.find(acc => acc.id === accountId); if (account && newName) { account.name = newName; editAccountModal.classList.remove('visible'); render(); } });
        cancelEditAccountBtn.addEventListener('click', () => editAccountModal.classList.remove('visible'));
        
        addCategoryForm.addEventListener('submit', e => { e.preventDefault(); const name = document.getElementById('category-name').value.trim(); const color = document.getElementById('category-color').value; const defaultAccountId = parseInt(document.getElementById('category-account-link').value) || null; if (name) { state.categories.push({ id: Date.now(), name, color, defaultAccountId }); addCategoryForm.reset(); render(); } });
        categoriesTableBody.addEventListener('click', e => { const editBtn = e.target.closest('.edit-category-btn'); const deleteBtn = e.target.closest('.delete-category-btn'); if (editBtn) { const catId = parseInt(editBtn.dataset.id); const category = state.categories.find(c => c.id === catId); if (category) { const form = document.getElementById('edit-category-form'); form.elements['edit-category-id'].value = category.id; form.elements['edit-category-name'].value = category.name; form.elements['edit-category-color'].value = category.color; form.elements['edit-category-account-link'].value = category.defaultAccountId || ''; editCategoryModal.classList.add('visible'); } } if (deleteBtn) { const catId = parseInt(deleteBtn.dataset.id); if (confirm('このカテゴリを削除しますか？（取引履歴からはカテゴリ情報のみ削除されます）')) { state.categories = state.categories.filter(c => c.id !== catId); state.transactions.forEach(tx => { if (tx.categoryId === catId) tx.categoryId = null; }); render(); } } });
        editCategoryForm.addEventListener('submit', e => { e.preventDefault(); const catId = parseInt(editCategoryForm.elements['edit-category-id'].value); const category = state.categories.find(c => c.id === catId); if (category) { category.name = editCategoryForm.elements['edit-category-name'].value.trim(); category.color = editCategoryForm.elements['edit-category-color'].value; category.defaultAccountId = parseInt(editCategoryForm.elements['edit-category-account-link'].value) || null; editCategoryModal.classList.remove('visible'); render(); } });
        cancelEditCategoryBtn.addEventListener('click', () => editCategoryModal.classList.remove('visible'));

        const toggleDisguiseMode = () => { state.isDisguiseMode = !state.isDisguiseMode; render(); };
        window.addEventListener('keydown', e => { if (e.key === 'h') toggleDisguiseMode(); });
        let lastShakeTime = 0;
        window.addEventListener('devicemotion', e => { const { x, y, z } = e.acceleration; if (x === null) return; const acceleration = Math.sqrt(x*x + y*y + z*z); const now = Date.now(); if (acceleration > 20 && (now - lastShakeTime > 1000)) { lastShakeTime = now; toggleDisguiseMode(); } });
    };

    // --- INITIALIZATION ---
    const init = () => {
        document.getElementById('date').value = formatDate(new Date());
        setupEventListeners();
        render();
    };
    init();
});