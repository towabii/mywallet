import { state, setRenderCallback, gid, q, qA, simpleHash, formatDt, showToast, requestPushPerm } from './utils.js';
import { callGasApi, syncData, saveUser, initUserData, runChecks, checkAutoExec } from './utils.js';
import { render, renderHistory, renderCharts, renderHistoryCalendar, renderCalendarUI } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {

    // 描画コールバックの設定
    setRenderCallback(render);

    const views = qA('.view');
    const navLinks = qA('.nav-link');
    const offlineBanner = gid('offline-banner');

    window.addEventListener('online', () => {
        state.isOffline = false;
        offlineBanner.style.display = 'none';
        syncData();
    });
    window.addEventListener('offline', () => {
        state.isOffline = true;
        offlineBanner.style.display = 'block';
    });

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
            const email = gid('signup-email').value, pwd = gid('signup-password').value, bk = Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
            const res = await callGasApi('signup', { email, passwordHash: simpleHash(pwd), backupKeyHash: simpleHash(bk) }, true);
            if (res && res.status === 'success') {
                gid('new-backup-key').textContent = bk;
                gid('backup-key-modal').classList.add('visible');
            }
        };
        gid('copy-backup-key-btn').onclick = () => navigator.clipboard.writeText(gid('new-backup-key').textContent).then(() => showToast('コピーしました'));
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
            if (b.closest('#calendar-modal') || b.closest('#transactions')) return;
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

        gid('open-calendar-modal-btn').onclick = () => {
            const sepRegex = /[,\n\r]+/;
            state.cal.includes = new Set((gid('rec-include-dates').value || '').split(sepRegex).map(s => s.trim()).filter(s => s));
            state.cal.excludes = new Set((gid('rec-exclude-dates').value || '').split(sepRegex).map(s => s.trim()).filter(s => s));
            state.cal.periods = [];
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
                endDate.setFullYear(endDate.getFullYear() + 10);
                limitCount = targetCount;
            } else if (periodType === 'infinite') {
                endDate.setFullYear(endDate.getFullYear() + 1);
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
            const excludes = (gid('rec-exclude-dates').value || '').split(sepRegex).map(s => s.trim()).filter(s => s);
            const includes = (gid('rec-include-dates').value || '').split(sepRegex).map(s => s.trim()).filter(s => s);
            const excludePeriodsStr = (gid('rec-exclude-periods').value || '').split(sepRegex).map(s => s.trim()).filter(s => s);
            
            const excludePeriods = [];
            excludePeriodsStr.forEach(str => {
                const parts = str.split(/[~〜\-]/);
                if (parts.length === 2) excludePeriods.push({ start: parts[0].trim(), end: parts[1].trim() });
            });
            
            const checkedDows = Array.from(qA('input[name="rec-dow"]:checked')).map(cb => parseInt(cb.value));
            const targetMonthlyDate = parseInt(gid('rec-monthly-date').value);

            let d = new Date(startDate);
            const createdTxs = [];
            let baseId = Date.now();

            while(d <= endDate && createdTxs.length < limitCount) {
                let match = false;
                const dStr = formatDt(d);
                const dow = d.getDay();
                const dom = d.getDate();
                
                if (rule === 'custom') match = false;
                else if (rule === 'daily') match = true;
                else if (rule === 'weekday') match = (dow >= 1 && dow <= 5);
                else if (rule === 'weekend') match = (dow === 0 || dow === 6);
                else if (rule === 'weekly') { if (checkedDows.includes(dow)) match = true; }
                else if (rule === 'monthly') { if (dom === targetMonthlyDate) match = true; }
                
                if (excludes.includes(dStr)) match = false;
                excludePeriods.forEach(p => { if (dStr >= p.start && dStr <= p.end) match = false; });
                if (includes.includes(dStr)) match = true;
                
                if (match) {
                    createdTxs.push({
                        id: baseId++, accountId: aId, categoryId: cId, date: dStr,
                        memo: memo, isScheduled: true, autoExec: autoExec
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
                if (amtType === 'split' && index === 0) finalAmt += remainder;
                tx.deposit = isInc ? finalAmt : 0;
                tx.withdrawal = !isInc ? finalAmt : 0;
            });

            if (confirm(`${createdTxs.length}件の予定を生成しますか？\n(初回金額: ${baseAmt + (amtType === 'split' ? remainder : 0)}円 / 最終金額: ${baseAmt}円)`)) {
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
                
                checkAutoExec();
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