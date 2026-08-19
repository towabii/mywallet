// --- CONSTANTS ---
export const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxBEkFNGTqOEMyxC5jruEqzGasE069r1CCB80FBBI5WuTnz5wccktVH2qwbQcOR_S4S/exec';

// --- STATE ---
export const state = {
    currentUser: null,
    selectedMonth: 'all',
    historyStatus: 'all',
    historySearch: '',
    historyAccount: 'all',
    historyCategory: 'all',
    historyMinAmount: '',
    historyMaxAmount: '',
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
        periods: [],
        periodTempStart: null
    },
    histCal: {
        year: new Date().getFullYear(),
        month: new Date().getMonth()
    }
};

// 再描画用のコールバック（循環参照を避けるための工夫）
let renderCallback = null;
export const setRenderCallback = (cb) => { renderCallback = cb; };
export const triggerRender = () => { if (renderCallback) renderCallback(); };

// --- DOM UTILITIES ---
export const q = s => document.querySelector(s);
export const qA = s => document.querySelectorAll(s);
export const gid = id => document.getElementById(id);

export const showLoading = () => gid('loading-overlay').style.display = 'flex';
export const hideLoading = () => gid('loading-overlay').style.display = 'none';

export const simpleHash = str => {
    let h = 0;
    for (let i = 0; i < str.length; i++)
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    return h.toString();
};

// 修正箇所2：マイナス金額の表示を「¥ -1,000」から「-¥ 1,000」に改善
export const formatCur = (v, sign) => {
    const isNeg = v < 0;
    const abs = Math.abs(Math.round(v));
    const prefix = isNeg ? '-' : (sign && v > 0 ? '+' : '');
    return `${prefix}¥ ${abs.toLocaleString()}`;
};

// 修正箇所3：toISOString()によるタイムゾーンの時差バグ（日付が1日ずれる現象）を修正
export const formatDt = d => {
    try {
        const dateObj = d ? new Date(d) : new Date();
        if (isNaN(dateObj.getTime())) throw new Error();
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    } catch(e) { 
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
};

export const formatYMD = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export const showToast = msg => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    gid('toast-container').appendChild(t);
    setTimeout(() => t.remove(), 4000);
};

export const requestPushPerm = async () => {
    if ('Notification' in window && Notification.permission === 'default')
        await Notification.requestPermission();
};

export const notifyUser = (title, body) => {
    if ('Notification' in window && Notification.permission === 'granted')
        new Notification(title, { body, icon: '/icon.png' });
    else
        showToast(`[通知] ${title}: ${body}`);
};

// --- DATA MANAGEMENT ---
export const initUserData = (user) => {
    if (!user || !user.data) throw new Error('ユーザーデータの形式が不正です。');
    user.data.accounts ||= [];
    user.data.categories ||= [];
    user.data.transactions ||= [];
    if (!user.data.settings) user.data.settings = { budget: 0 };
    user.data.monthlySnapshots ||= [];
    return user;
};

export const validateUserData = (user) => {
    try {
        initUserData(user);
        const accountIds = new Set(user.data.accounts.map(a => String(a.id)));
        const categoryIds = new Set(user.data.categories.map(c => String(c.id)));
        const transactionIds = new Set();
        for (const tx of user.data.transactions) {
            if (tx.id == null || transactionIds.has(String(tx.id))) return { valid: false, message: '取引IDが重複または不足しています。' };
            transactionIds.add(String(tx.id));
            if (!accountIds.has(String(tx.accountId)) || (tx.type === 'transfer' && !accountIds.has(String(tx.toAccountId)))) return { valid: false, message: '存在しない口座を参照する取引があります。' };
            if (tx.categoryId != null && !categoryIds.has(String(tx.categoryId))) return { valid: false, message: '存在しないカテゴリを参照する取引があります。' };
        }
        return { valid: true, message: `正常です（取引 ${user.data.transactions.length} 件）` };
    } catch (error) {
        return { valid: false, message: 'データ形式が不正です。' };
    }
};

export const buildMonthlySnapshots = (user) => {
    const balances = Object.fromEntries(user.data.accounts.map(a => [a.id, 0]));
    user.data.transactions.filter(t => t.type === 'initial').forEach(t => { if (balances[t.accountId] !== undefined) balances[t.accountId] = t.amount || 0; });
    const txs = user.data.transactions.filter(t => t.type !== 'initial' && !t.isScheduled && t.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const snapshots = {};
    txs.forEach(tx => {
        if (tx.type === 'transfer') { if (balances[tx.accountId] !== undefined) balances[tx.accountId] -= tx.amount || 0; if (balances[tx.toAccountId] !== undefined) balances[tx.toAccountId] += tx.amount || 0; }
        else if (balances[tx.accountId] !== undefined) balances[tx.accountId] += (tx.deposit || 0) - (tx.withdrawal || 0);
        const month = String(tx.date).slice(0, 7);
        snapshots[month] = { month, total: Object.values(balances).reduce((sum, value) => sum + value, 0), balances: { ...balances } };
    });
    return Object.values(snapshots).sort((a, b) => a.month.localeCompare(b.month));
};

export const recalcBalances = () => {
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

export const runChecks = () => {
    const { transactions, settings } = state.currentUser.data;
    if (!settings.budget || settings.budget <= 0)
        notifyUser('予算未設定', '予算を設定しましょう。');
    const overdue = transactions.filter(tx => tx.isScheduled && !tx.autoExec && tx.date < formatDt(new Date()));
    if (overdue.length > 0)
        notifyUser('未実行の予定', `手動実行待ちの予定が ${overdue.length} 件あります。`);
};

export const checkAutoExec = () => {
    let changed = false;
    const todayStr = formatDt(new Date());
    state.currentUser.data.transactions.forEach(tx => {
        if (tx.isScheduled && tx.autoExec && tx.date && tx.date <= todayStr) {
            tx.isScheduled = false;
            changed = true;
        }
    });
    return changed;
};

// --- API & SYNC ---
export async function callGasApi(action, payload, showLd = false) {
    if (showLd) showLoading();
    try {
        if (state.isOffline && ['updateUserData'].includes(action)) throw new Error('offline');
        const securedActions = ['getUserData', 'updateUserData', 'syncData', 'changeEmail', 'changePassword', 'getBackupKey'];
        const requestPayload = securedActions.includes(action) ? { ...payload, authToken: sessionStorage.getItem('authToken') || '' } : payload;
        const res = await fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            body: JSON.stringify({ action, payload: requestPayload })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        if (result.status === 'error') throw new Error(result.message);
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

export async function syncData() {
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
        triggerRender();
    } else if (res && res.status === 'conflict') {
        gid('conflict-modal').classList.add('visible');
        gid('conflict-use-server').onclick = () => {
            state.hasLocalChanges = false;
            localStorage.removeItem('localChanges');
            state.currentUser = res.serverData;
            gid('conflict-modal').classList.remove('visible');
            triggerRender();
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
            triggerRender();
        };
    }
}

export const saveUser = async () => {
    state.currentUser.updatedAt = Date.now();
    state.currentUser.data.monthlySnapshots = buildMonthlySnapshots(state.currentUser);
    const check = validateUserData(state.currentUser);
    if (!check.valid) { showToast(`保存を中止しました: ${check.message}`); return null; }
    localStorage.setItem(`selectedMonth_${state.currentUser.id}`, state.selectedMonth);
    await callGasApi('updateUserData', {
        userId: state.currentUser.id,
        userData: state.currentUser
    });
};
