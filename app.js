const API_URL = "/sync";

let data = { trips: [], people: [], expenses: [], settlements: [] };
let activeTripId = null;
let isSyncing = false;

function setStatus(msg, type = "") {
    const bar = document.getElementById("sync-status");
    if (!bar) return;
    bar.innerText = msg;
    bar.className = "status-bar" + (type ? " " + type : "");
}

function setSyncLock(locked) {
    isSyncing = locked;
    document.querySelectorAll(".sync-lock").forEach(btn => {
        btn.disabled = locked;
    });
}

function isSettled(exp) {
    return exp.settled === true || String(exp.settled).toLowerCase() === "true";
}

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatMoney(val) {
    const num = Number(val) || 0;
    return "₹" + num.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatNetLabel(net, getsBackText = "(Gets Back)", owesText = "(Owes)") {
    if (Math.abs(net) < 0.005) {
        return `<span class="neutral">₹0.00 (Settled / Even)</span>`;
    }
    const cls = net > 0 ? "positive" : "negative";
    const label = net > 0 ? getsBackText : owesText;
    return `<span class="${cls}">${formatMoney(Math.abs(net))} ${label}</span>`;
}

// Distributes amount equally in exact paise so sum(splits) === amount
function computeEqualSplits(amount, personIds) {
    const splits = {};
    const n = personIds.length;
    if (n === 0) return splits;

    const totalPaise = Math.round((Number(amount) || 0) * 100);
    const basePaise = Math.floor(totalPaise / n);
    let remainder = totalPaise - basePaise * n;

    personIds.forEach(pid => {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder--;
        splits[String(pid).trim()] = (basePaise + extra) / 100;
    });
    return splits;
}

// Resolves per-person shares for both new (explicit splits JSON) and legacy expenses
function getExpenseSplits(exp, tripPeople) {
    if (exp.splits) {
        try {
            const parsed = typeof exp.splits === "string" ? JSON.parse(exp.splits) : exp.splits;
            if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
                const clean = {};
                Object.entries(parsed).forEach(([k, v]) => {
                    const num = parseFloat(v) || 0;
                    if (num > 0) clean[String(k).trim()] = num;
                });
                if (Object.keys(clean).length > 0) return clean;
            }
        } catch (e) {
            // Fall back to legacy fields if JSON is malformed
        }
    }

    const amt = parseFloat(exp.amount) || 0;
    if (exp.type === "Individual" && exp.target) {
        return { [String(exp.target).trim()]: amt };
    }

    const allIds = tripPeople.map(p => String(p.id).trim());
    return computeEqualSplits(amt, allIds);
}

async function init() {
    if (isSyncing) return;
    setSyncLock(true);
    setStatus("Loading data from Google Sheets...", "saving");
    try {
        const response = await fetch(API_URL);
        const result = await response.json();
        if (!response.ok || result.error) {
            throw new Error(result.error || "Server error");
        }
        data = {
            trips: result.trips || [],
            people: result.people || [],
            expenses: result.expenses || [],
            settlements: result.settlements || []
        };
        setStatus("Synced with Google Sheets ✓", "ok");
    } catch (e) {
        console.error("Failed to load data", e);
        setStatus("Error: " + e.message, "err");
    } finally {
        setSyncLock(false);
        renderTrips(activeTripId || "");
        if (activeTripId) renderDashboard();
    }
}

async function syncData(action, payload) {
    setSyncLock(true);
    setStatus("Saving changes to Google Sheets...", "saving");
    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, payload })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || "Backend did not confirm save");
        }
        setStatus("Saved to Google Sheets ✓", "ok");
    } catch (e) {
        console.error("Sync failed", e);
        setStatus("Sync failed: " + e.message, "err");
        alert("Failed to sync with Google Sheets: " + e.message);
    } finally {
        setSyncLock(false);
        renderTrips(activeTripId || "");
        if (activeTripId) renderDashboard();
    }
}

// --- TRIP MANAGEMENT ---

function renderTrips(selectedId = "") {
    const select = document.getElementById("trip-select");
    select.innerHTML = '<option value="">-- Select a Trip --</option>';
    data.trips.forEach(t => {
        const selected = String(t.id).trim() === String(selectedId).trim() ? "selected" : "";
        select.innerHTML += `<option value="${escapeHtml(t.id)}" ${selected}>${escapeHtml(t.name)}</option>`;
    });
}

function addTrip() {
    if (isSyncing) return;
    const name = document.getElementById("new-trip-name").value.trim();
    if (!name) return;
    const newTrip = { id: Date.now().toString(), name };
    data.trips.push(newTrip);
    document.getElementById("new-trip-name").value = "";
    renderTrips(newTrip.id);
    syncData("addTrip", newTrip);
}

function editTrip() {
    if (isSyncing) return;
    const tripId = document.getElementById("trip-select").value;
    if (!tripId) return alert("Please select a trip from the dropdown first.");

    const trip = data.trips.find(t => String(t.id).trim() === String(tripId).trim());
    if (!trip) return;

    const newName = prompt("Enter new trip name:", trip.name);
    if (!newName || !newName.trim() || newName.trim() === trip.name) return;

    trip.name = newName.trim();
    renderTrips(trip.id);
    syncData("editTrip", { id: trip.id, name: trip.name });
}

function deleteTrip() {
    if (isSyncing) return;
    const tripId = document.getElementById("trip-select").value;
    if (!tripId) return alert("Please select a trip from the dropdown first.");

    const trip = data.trips.find(t => String(t.id).trim() === String(tripId).trim());
    if (!trip) return;

    if (!confirm(`Delete "${trip.name}" along with all its people, expenses, and settlements?`)) return;

    data.trips = data.trips.filter(t => String(t.id).trim() !== String(tripId).trim());
    data.people = data.people.filter(p => String(p.tripId).trim() !== String(tripId).trim());
    data.expenses = data.expenses.filter(e => String(e.tripId).trim() !== String(tripId).trim());
    data.settlements = data.settlements.filter(s => String(s.tripId).trim() !== String(tripId).trim());

    renderTrips();
    syncData("deleteTrip", { id: tripId });
}

function loadTrip() {
    activeTripId = document.getElementById("trip-select").value;
    if (!activeTripId) return alert("Please select a trip first.");

    cancelEditExpense(false);
    document.getElementById("trip-screen").style.display = "none";
    document.getElementById("dashboard-screen").style.display = "block";

    const trip = data.trips.find(t => String(t.id).trim() === String(activeTripId).trim());
    document.getElementById("active-trip-name").innerText = trip ? trip.name : "Trip";
    renderDashboard();
}

function backToTrips() {
    activeTripId = null;
    cancelEditExpense(false);
    document.getElementById("trip-screen").style.display = "block";
    document.getElementById("dashboard-screen").style.display = "none";
    renderTrips();
}

// --- PEOPLE MANAGEMENT (ADD / EDIT / DELETE) ---

function addPerson() {
    if (isSyncing) return;
    const name = document.getElementById("new-person-name").value.trim();
    if (!name) return;
    const newPerson = { id: Date.now().toString(), tripId: activeTripId, name };
    data.people.push(newPerson);
    document.getElementById("new-person-name").value = "";
    renderDashboard();
    syncData("addPerson", newPerson);
}

function editPerson(personId) {
    if (isSyncing) return;
    const person = data.people.find(p => String(p.id).trim() === String(personId).trim());
    if (!person) return;

    const newName = prompt("Rename person:", person.name);
    if (!newName || !newName.trim() || newName.trim() === person.name) return;

    person.name = newName.trim();
    renderDashboard();
    syncData("editPerson", { id: person.id, name: person.name });
}

function deletePerson(personId) {
    if (isSyncing) return;
    const personKey = String(personId).trim();
    const person = data.people.find(p => String(p.id).trim() === personKey);
    if (!person) return;

    const tripPeople = data.people.filter(p => String(p.tripId).trim() === String(activeTripId).trim());
    const tripExpenses = data.expenses.filter(e => String(e.tripId).trim() === String(activeTripId).trim());
    const tripSettlements = data.settlements.filter(s => String(s.tripId).trim() === String(activeTripId).trim());

    const tiedExpenses = tripExpenses.filter(e => {
        if (String(e.paidBy).trim() === personKey) return true;
        if (String(e.target).trim() === personKey) return true;
        const splits = getExpenseSplits(e, tripPeople);
        return (splits[personKey] || 0) > 0;
    });

    const tiedSettlements = tripSettlements.filter(
        s => String(s.fromId).trim() === personKey || String(s.toId).trim() === personKey
    );

    if (tiedExpenses.length > 0 || tiedSettlements.length > 0) {
        return alert(
            `Cannot delete "${person.name}" because they are part of ${tiedExpenses.length} expense(s) and ${tiedSettlements.length} settlement(s). Edit or delete those entries first.`
        );
    }

    if (!confirm(`Remove "${person.name}" from this trip?`)) return;

    data.people = data.people.filter(p => String(p.id).trim() !== personKey);
    renderDashboard();
    syncData("deletePerson", { id: personId });
}

// --- SPLIT CHECKBOXES & CUSTOM AMOUNTS UI ---

function renderSplitParticipants(presetSplits = null) {
    const tripPeople = data.people.filter(p => String(p.tripId).trim() === String(activeTripId).trim());
    const container = document.getElementById("split-participants-list");
    const mode = document.getElementById("exp-split-mode").value;

    if (tripPeople.length === 0) {
        container.innerHTML = `<p class="muted" style="margin:0;">Add people to this trip first.</p>`;
        document.getElementById("split-status-bar").innerHTML = "";
        return;
    }

    // Preserve current checkbox/input selections when re-rendering unless presetSplits is supplied
    const existingChecked = {};
    const existingCustom = {};
    container.querySelectorAll(".participant-row").forEach(row => {
        const pid = row.dataset.personId;
        const cb = row.querySelector(".split-cb");
        const inp = row.querySelector(".custom-amt-input");
        if (cb) existingChecked[pid] = cb.checked;
        if (inp) existingCustom[pid] = inp.value;
    });

    container.innerHTML = tripPeople.map(p => {
        const pid = String(p.id).trim();
        let checked = true;
        let customVal = "";

        if (presetSplits) {
            checked = Object.prototype.hasOwnProperty.call(presetSplits, pid) && Number(presetSplits[pid]) > 0;
            customVal = checked ? Number(presetSplits[pid]).toFixed(2) : "";
        } else if (Object.keys(existingChecked).length > 0) {
            checked = Object.prototype.hasOwnProperty.call(existingChecked, pid) ? existingChecked[pid] : true;
            customVal = existingCustom[pid] ?? "";
        }

        const rightControl = mode === "Custom"
            ? `<input type="number" step="0.01" min="0" class="custom-amt-input" data-person-id="${escapeHtml(pid)}" value="${escapeHtml(customVal)}" placeholder="0.00" oninput="onCustomAmountInput('${escapeHtml(pid)}')">`
            : `<span class="participant-share" id="share-preview-${escapeHtml(pid)}">₹0.00</span>`;

        return `
            <div class="participant-row ${checked ? "" : "unchecked"}" data-person-id="${escapeHtml(pid)}">
                <label class="participant-check">
                    <input type="checkbox" class="split-cb" data-person-id="${escapeHtml(pid)}" ${checked ? "checked" : ""} onchange="onParticipantToggle('${escapeHtml(pid)}')">
                    <span>${escapeHtml(p.name)}</span>
                </label>
                ${rightControl}
            </div>
        `;
    }).join("");

    updateSplitPreview();
}

function onSplitModeChange() {
    const amount = parseFloat(document.getElementById("exp-amount").value) || 0;
    const mode = document.getElementById("exp-split-mode").value;

    // Capture currently checked people before switching modes
    const checkedIds = [];
    document.querySelectorAll(".split-cb:checked").forEach(cb => {
        checkedIds.push(cb.dataset.personId);
    });

    if (mode === "Custom") {
        const prefill = amount > 0 && checkedIds.length > 0
            ? computeEqualSplits(amount, checkedIds)
            : checkedIds.reduce((acc, id) => { acc[id] = 0; return acc; }, {});
        renderSplitParticipants(prefill);
    } else {
        const preset = checkedIds.reduce((acc, id) => { acc[id] = 1; return acc; }, {});
        renderSplitParticipants(preset);
    }
}

function selectAllParticipants(selectAll) {
    document.querySelectorAll(".participant-row").forEach(row => {
        const cb = row.querySelector(".split-cb");
        const inp = row.querySelector(".custom-amt-input");
        if (cb) cb.checked = selectAll;
        row.classList.toggle("unchecked", !selectAll);
        if (!selectAll && inp) inp.value = "";
    });
    updateSplitPreview();
}

function onParticipantToggle(personId) {
    const row = document.querySelector(`.participant-row[data-person-id="${CSS.escape(personId)}"]`);
    if (!row) return;
    const cb = row.querySelector(".split-cb");
    const inp = row.querySelector(".custom-amt-input");
    row.classList.toggle("unchecked", !cb.checked);
    if (!cb.checked && inp) inp.value = "";
    updateSplitPreview();
}

function onCustomAmountInput(personId) {
    const row = document.querySelector(`.participant-row[data-person-id="${CSS.escape(personId)}"]`);
    if (!row) return;
    const cb = row.querySelector(".split-cb");
    const inp = row.querySelector(".custom-amt-input");
    const val = parseFloat(inp.value) || 0;
    if (cb) {
        cb.checked = val > 0;
        row.classList.toggle("unchecked", !cb.checked);
    }
    updateSplitPreview();
}

function updateSplitPreview() {
    const mode = document.getElementById("exp-split-mode").value;
    const amount = parseFloat(document.getElementById("exp-amount").value) || 0;
    const statusEl = document.getElementById("split-status-bar");

    const checkedIds = [];
    document.querySelectorAll(".split-cb").forEach(cb => {
        const row = cb.closest(".participant-row");
        if (row) row.classList.toggle("unchecked", !cb.checked);
        if (cb.checked) checkedIds.push(cb.dataset.personId);
    });

    if (mode === "Equal") {
        const equalSplits = computeEqualSplits(amount, checkedIds);
        document.querySelectorAll(".split-cb").forEach(cb => {
            const pid = cb.dataset.personId;
            const span = document.getElementById(`share-preview-${pid}`);
            if (span) {
                span.innerText = cb.checked ? formatMoney(equalSplits[pid] || 0) : "Excluded";
            }
        });

        if (checkedIds.length === 0) {
            statusEl.innerHTML = `<span class="negative">Select at least 1 person to split this expense.</span>`;
        } else if (checkedIds.length === 1) {
            statusEl.innerHTML = `<span class="neutral">Individual expense for 1 person (${formatMoney(amount)})</span>`;
        } else {
            const perHead = amount / checkedIds.length;
            statusEl.innerHTML = `<span class="positive">Split equally among ${checkedIds.length} people (${formatMoney(perHead)} each)</span>`;
        }
    } else {
        let allocated = 0;
        document.querySelectorAll(".custom-amt-input").forEach(inp => {
            const pid = inp.dataset.personId;
            if (checkedIds.includes(pid)) {
                allocated += parseFloat(inp.value) || 0;
            }
        });

        const diff = amount - allocated;
        if (amount <= 0 && allocated > 0) {
            statusEl.innerHTML = `<span class="neutral">Custom total: ${formatMoney(allocated)} (will auto-fill Total Amount)</span>`;
        } else if (Math.abs(diff) <= 0.01 && allocated > 0) {
            statusEl.innerHTML = `<span class="positive">✓ Allocated: ${formatMoney(allocated)} / ${formatMoney(amount)}</span>`;
        } else if (diff > 0.01) {
            statusEl.innerHTML = `<span class="negative">Allocated: ${formatMoney(allocated)} / ${formatMoney(amount)} (${formatMoney(diff)} remaining)</span>`;
        } else {
            statusEl.innerHTML = `<span class="negative">Allocated: ${formatMoney(allocated)} / ${formatMoney(amount)} (${formatMoney(Math.abs(diff))} over total)</span>`;
        }
    }
}

// --- EXPENSE MANAGEMENT ---

function startEditExpense(expenseId) {
    if (isSyncing) return;
    const exp = data.expenses.find(e => String(e.id).trim() === String(expenseId).trim());
    if (!exp) return;

    const tripPeople = data.people.filter(p => String(p.tripId).trim() === String(activeTripId).trim());
    const splits = getExpenseSplits(exp, tripPeople);

    document.getElementById("edit-expense-id").value = String(exp.id);
    document.getElementById("expense-form-title").innerText = "✏️ Edit Expense";
    document.getElementById("exp-name").value = exp.name;
    document.getElementById("exp-desc").value = exp.desc || "";
    document.getElementById("exp-amount").value = exp.amount;
    document.getElementById("exp-paid-by").value = String(exp.paidBy).trim();

    document.getElementById("exp-split-mode").value = exp.type === "Custom" ? "Custom" : "Equal";
    renderSplitParticipants(splits);

    document.getElementById("save-expense-btn").innerText = "Update Expense";
    document.getElementById("cancel-edit-btn").style.display = "inline-block";
    document.getElementById("expense-form-card").scrollIntoView({ behavior: "smooth" });
}

function cancelEditExpense(resetCheckboxes = true) {
    document.getElementById("edit-expense-id").value = "";
    document.getElementById("expense-form-title").innerText = "💳 Add Expense";
    document.getElementById("exp-name").value = "";
    document.getElementById("exp-desc").value = "";
    document.getElementById("exp-amount").value = "";
    document.getElementById("exp-paid-by").value = "";
    document.getElementById("exp-split-mode").value = "Equal";

    document.getElementById("save-expense-btn").innerText = "Save Expense";
    document.getElementById("cancel-edit-btn").style.display = "none";

    if (resetCheckboxes && activeTripId) {
        const tripPeople = data.people.filter(p => String(p.tripId).trim() === String(activeTripId).trim());
        const allChecked = tripPeople.reduce((acc, p) => { acc[String(p.id).trim()] = 1; return acc; }, {});
        renderSplitParticipants(allChecked);
    }
}

function saveExpense() {
    if (isSyncing) return;
    const editId = document.getElementById("edit-expense-id").value;
    const name = document.getElementById("exp-name").value.trim();
    const desc = document.getElementById("exp-desc").value.trim();
    let amount = parseFloat(document.getElementById("exp-amount").value);
    const paidBy = document.getElementById("exp-paid-by").value;
    const mode = document.getElementById("exp-split-mode").value;

    const checkedIds = [];
    document.querySelectorAll(".split-cb:checked").forEach(cb => {
        checkedIds.push(cb.dataset.personId);
    });

    if (!name || !paidBy) {
        return alert("Please enter an Expense Name and select who paid.");
    }
    if (checkedIds.length === 0) {
        return alert("Please select at least 1 person to split this expense with.");
    }

    let splits = {};
    if (mode === "Equal") {
        if (isNaN(amount) || amount <= 0) {
            return alert("Please enter a valid Amount greater than ₹0.");
        }
        splits = computeEqualSplits(amount, checkedIds);
    } else {
        let customTotal = 0;
        checkedIds.forEach(pid => {
            const inp = document.querySelector(`.custom-amt-input[data-person-id="${CSS.escape(pid)}"]`);
            const val = parseFloat(inp ? inp.value : 0) || 0;
            if (val > 0) {
                splits[pid] = Math.round(val * 100) / 100;
                customTotal += splits[pid];
            }
        });

        customTotal = Math.round(customTotal * 100) / 100;
        if (Object.keys(splits).length === 0 || customTotal <= 0) {
            return alert("Please enter valid custom amounts greater than ₹0.");
        }

        if (isNaN(amount) || amount <= 0) {
            amount = customTotal;
        } else if (Math.abs(customTotal - amount) > 0.01) {
            return alert(
                `Custom amounts (${formatMoney(customTotal)}) must match the Total Amount (${formatMoney(amount)}).`
            );
        }
    }

    const participantIds = Object.keys(splits);
    const typeLabel = mode === "Custom" ? "Custom" : (participantIds.length === 1 ? "Individual" : "Equal");
    const targetLabel = participantIds.length === 1 ? participantIds[0] : "";

    if (editId) {
        const exp = data.expenses.find(e => String(e.id).trim() === String(editId).trim());
        if (exp) {
            exp.name = name;
            exp.desc = desc;
            exp.amount = amount;
            exp.paidBy = paidBy;
            exp.type = typeLabel;
            exp.target = targetLabel;
            exp.splits = splits;
            cancelEditExpense();
            renderDashboard();
            syncData("editExpense", exp);
        }
    } else {
        const newExp = {
            id: Date.now().toString(),
            tripId: activeTripId,
            name,
            desc,
            amount,
            paidBy,
            type: typeLabel,
            target: targetLabel,
            settled: false,
            splits
        };
        data.expenses.push(newExp);
        cancelEditExpense();
        renderDashboard();
        syncData("addExpense", newExp);
    }
}

function deleteExpense(expenseId) {
    if (isSyncing) return;
    const exp = data.expenses.find(e => String(e.id).trim() === String(expenseId).trim());
    if (!exp) return;

    if (!confirm(`Delete expense "${exp.name}"?`)) return;

    if (String(document.getElementById("edit-expense-id").value).trim() === String(expenseId).trim()) {
        cancelEditExpense();
    }

    data.expenses = data.expenses.filter(e => String(e.id).trim() !== String(expenseId).trim());
    renderDashboard();
    syncData("deleteExpense", { id: expenseId });
}

function toggleSettleExpense(expenseId) {
    if (isSyncing) return;
    const exp = data.expenses.find(e => String(e.id).trim() === String(expenseId).trim());
    if (!exp) return;

    exp.settled = !isSettled(exp);
    renderDashboard();
    syncData("toggleSettleExpense", { id: expenseId, settled: exp.settled });
}

// --- LUMP-SUM SETTLEMENT PAYMENTS ---

function markSettlementPaid(fromId, toId, amount) {
    if (isSyncing) return;
    const tripPeople = data.people.filter(p => String(p.tripId).trim() === String(activeTripId).trim());
    const fromName = tripPeople.find(p => String(p.id).trim() === String(fromId).trim())?.name || "Person";
    const toName = tripPeople.find(p => String(p.id).trim() === String(toId).trim())?.name || "Person";
    const roundedAmt = Math.round((Number(amount) || 0) * 100) / 100;

    if (roundedAmt <= 0) return;
    if (!confirm(`Record lump-sum payment of ${formatMoney(roundedAmt)} from ${fromName} to ${toName}?`)) return;

    const newSettlement = {
        id: Date.now().toString(),
        tripId: activeTripId,
        fromId: String(fromId).trim(),
        toId: String(toId).trim(),
        amount: roundedAmt,
        createdAt: new Date().toISOString()
    };

    data.settlements.push(newSettlement);
    renderDashboard();
    syncData("addSettlement", newSettlement);
}

function undoSettlement(settlementId) {
    if (isSyncing) return;
    if (!confirm("Remove this recorded settlement payment?")) return;

    data.settlements = data.settlements.filter(s => String(s.id).trim() !== String(settlementId).trim());
    renderDashboard();
    syncData("deleteSettlement", { id: settlementId });
}

// --- CALCULATIONS & RENDERING ---

function calculateTripBalances(tripPeople, tripExpenses, tripSettlements) {
    const balances = {};
    tripPeople.forEach(p => {
        balances[String(p.id).trim()] = {
            id: String(p.id).trim(),
            name: p.name,
            paid: 0,
            share: 0,
            settlementDelta: 0
        };
    });

    tripExpenses.forEach(e => {
        if (isSettled(e)) return;
        const amt = parseFloat(e.amount) || 0;
        const paidByKey = String(e.paidBy).trim();

        if (balances[paidByKey]) {
            balances[paidByKey].paid += amt;
        }

        const splits = getExpenseSplits(e, tripPeople);
        Object.entries(splits).forEach(([pid, shareAmt]) => {
            if (balances[pid]) {
                balances[pid].share += Number(shareAmt) || 0;
            }
        });
    });

    tripSettlements.forEach(s => {
        const amt = parseFloat(s.amount) || 0;
        const fromKey = String(s.fromId).trim();
        const toKey = String(s.toId).trim();
        if (balances[fromKey]) balances[fromKey].settlementDelta += amt;
        if (balances[toKey]) balances[toKey].settlementDelta -= amt;
    });

    return balances;
}

function computeSettlements(balances) {
    const debtors = [];
    const creditors = [];

    Object.values(balances).forEach(b => {
        const net = b.paid - b.share + b.settlementDelta;
        if (net < -0.005) debtors.push({ id: b.id, name: b.name, amount: -net });
        else if (net > 0.005) creditors.push({ id: b.id, name: b.name, amount: net });
    });

    const transfers = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
        const pay = Math.min(debtors[i].amount, creditors[j].amount);
        if (pay > 0.005) {
            transfers.push({
                fromId: debtors[i].id,
                fromName: debtors[i].name,
                toId: creditors[j].id,
                toName: creditors[j].name,
                amount: pay
            });
        }
        debtors[i].amount -= pay;
        creditors[j].amount -= pay;
        if (debtors[i].amount < 0.005) i++;
        if (creditors[j].amount < 0.005) j++;
    }
    return transfers;
}

function formatExpenseSplitSummary(exp, splits, tripPeople) {
    const entries = Object.entries(splits);
    const getName = (id) => tripPeople.find(p => String(p.id).trim() === String(id).trim())?.name || "Unknown";

    if (entries.length === 1) {
        return `Individual (${getName(entries[0][0])})`;
    }

    if (exp.type === "Custom") {
        const details = entries.map(([pid, amt]) => `${getName(pid)}: ${formatMoney(amt)}`).join(", ");
        return `Custom (${details})`;
    }

    if (entries.length === tripPeople.length && tripPeople.length > 0) {
        return `Equal Split (All ${entries.length})`;
    }

    const names = entries.map(([pid]) => getName(pid)).join(", ");
    return `Equal Split (${names})`;
}

function renderDashboard() {
    const tripPeople = data.people.filter(p => String(p.tripId).trim() === String(activeTripId).trim());
    const tripExpenses = data.expenses.filter(e => String(e.tripId).trim() === String(activeTripId).trim());
    const tripSettlements = data.settlements.filter(s => String(s.tripId).trim() === String(activeTripId).trim());
    const disabledAttr = isSyncing ? "disabled" : "";

    // Render People Chips
    const peopleContainer = document.getElementById("people-list");
    if (tripPeople.length === 0) {
        peopleContainer.innerHTML = `<p class="muted" style="margin:10px 0 0 0;">No people added yet.</p>`;
    } else {
        peopleContainer.innerHTML = `<div class="people-grid">` + tripPeople.map(p => `
            <div class="person-chip">
                <span>${escapeHtml(p.name)}</span>
                <button class="chip-btn warning sync-lock" ${disabledAttr} onclick="editPerson('${escapeHtml(p.id)}')" title="Rename">Edit</button>
                <button class="chip-btn danger sync-lock" ${disabledAttr} onclick="deletePerson('${escapeHtml(p.id)}')" title="Remove">✕</button>
            </div>
        `).join("") + `</div>`;
    }

    const prevPaidBy = document.getElementById("exp-paid-by").value;
    const prevIndView = document.getElementById("ind-view-select").value;

    let options = '<option value="">Select Person...</option>';
    tripPeople.forEach(p => {
        options += `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`;
    });

    document.getElementById("exp-paid-by").innerHTML = options;
    document.getElementById("ind-view-select").innerHTML = options;

    document.getElementById("exp-paid-by").value = prevPaidBy;
    document.getElementById("ind-view-select").value = prevIndView;

    // Render Split Checkboxes
    renderSplitParticipants();

    // Render Expenses Table
    const tbody = document.getElementById("expenses-tbody");
    tbody.innerHTML = "";

    let totalExp = 0;
    let unsettledExp = 0;

    tripExpenses.forEach(e => {
        const amt = parseFloat(e.amount) || 0;
        const settled = isSettled(e);
        totalExp += amt;
        if (!settled) unsettledExp += amt;

        const payer = tripPeople.find(p => String(p.id).trim() === String(e.paidBy).trim());
        const payerName = payer ? payer.name : "Unknown";
        const splits = getExpenseSplits(e, tripPeople);
        const splitDesc = formatExpenseSplitSummary(e, splits, tripPeople);

        const statusBadge = settled
            ? '<span class="badge badge-settled">Settled</span>'
            : '<span class="badge badge-pending">Pending</span>';

        const settleBtnLabel = settled ? "Reopen" : "Settle";
        const settleBtnClass = settled ? "secondary" : "success";

        tbody.innerHTML += `<tr class="${settled ? "settled-row" : ""}">
            <td>${statusBadge}</td>
            <td class="strike">${escapeHtml(e.name)}</td>
            <td>${escapeHtml(e.desc || "")}</td>
            <td class="strike">${formatMoney(amt)}</td>
            <td>${escapeHtml(payerName)}</td>
            <td>${escapeHtml(splitDesc)}</td>
            <td class="actions-col">
                <div class="action-group">
                    <button class="btn-sm ${settleBtnClass} sync-lock" ${disabledAttr} onclick="toggleSettleExpense('${escapeHtml(e.id)}')">${settleBtnLabel}</button>
                    <button class="btn-sm warning sync-lock" ${disabledAttr} onclick="startEditExpense('${escapeHtml(e.id)}')">Edit</button>
                    <button class="btn-sm danger sync-lock" ${disabledAttr} onclick="deleteExpense('${escapeHtml(e.id)}')">Delete</button>
                </div>
            </td>
        </tr>`;
    });

    document.getElementById("total-trip-expense").innerText = `Total Trip Expense: ${formatMoney(totalExp)}`;
    document.getElementById("unsettled-trip-expense").innerText = `Unsettled Remaining: ${formatMoney(unsettledExp)}`;

    // Render Balances Table
    const balances = calculateTripBalances(tripPeople, tripExpenses, tripSettlements);
    const balTbody = document.getElementById("balances-tbody");
    balTbody.innerHTML = "";

    Object.values(balances).forEach(b => {
        const net = b.paid - b.share + b.settlementDelta;
        let settleCol = `<span class="muted">₹0.00</span>`;
        if (b.settlementDelta > 0.005) {
            settleCol = `<span class="positive">+${formatMoney(b.settlementDelta)} (Paid)</span>`;
        } else if (b.settlementDelta < -0.005) {
            settleCol = `<span class="negative">-${formatMoney(Math.abs(b.settlementDelta))} (Rec'd)</span>`;
        }

        balTbody.innerHTML += `<tr>
            <td>${escapeHtml(b.name)}</td>
            <td>${formatMoney(b.paid)}</td>
            <td>${formatMoney(b.share)}</td>
            <td>${settleCol}</td>
            <td>${formatNetLabel(net)}</td>
        </tr>`;
    });

    const allTransfers = computeSettlements(balances);
    renderIndividualView(balances, allTransfers);
    renderOverallSettlements(tripPeople, tripSettlements, allTransfers);
}

function renderIndividualView(precomputedBalances, precomputedTransfers) {
    const personId = String(document.getElementById("ind-view-select").value).trim();
    const content = document.getElementById("ind-view-content");
    if (!personId) {
        content.innerHTML = "";
        return;
    }

    const tripPeople = data.people.filter(p => String(p.tripId).trim() === String(activeTripId).trim());
    const tripExpenses = data.expenses.filter(e => String(e.tripId).trim() === String(activeTripId).trim());
    const tripSettlements = data.settlements.filter(s => String(s.tripId).trim() === String(activeTripId).trim());
    const selectedPerson = tripPeople.find(p => String(p.id).trim() === personId);
    const personName = selectedPerson ? selectedPerson.name : "Person";
    const disabledAttr = isSyncing ? "disabled" : "";

    let paidItemsHtml = "";
    let shareItemsHtml = "";

    let unsettledPaid = 0;
    let unsettledOwnShare = 0;
    let lifetimeOwnShare = 0;

    tripExpenses.forEach(e => {
        const amt = parseFloat(e.amount) || 0;
        const settled = isSettled(e);
        const paidByKey = String(e.paidBy).trim();
        const payer = tripPeople.find(p => String(p.id).trim() === paidByKey);
        const payerName = payer ? payer.name : "Unknown";
        const splits = getExpenseSplits(e, tripPeople);
        const splitEntries = Object.entries(splits);
        const myShare = Number(splits[personId]) || 0;

        const settledTag = settled ? ' <span class="badge badge-settled">Settled</span>' : "";

        // 1. Bills Paid By This Person
        if (paidByKey === personId) {
            if (!settled) unsettledPaid += amt;

            let paidNote = "";
            if (splitEntries.length === 1 && splitEntries[0][0] === personId) {
                paidNote = `Personal expense — ₹0.00 owed by others`;
            } else if (splitEntries.length === 1) {
                const otherName = tripPeople.find(p => String(p.id).trim() === splitEntries[0][0])?.name || "Other";
                paidNote = `Paid for ${escapeHtml(otherName)} — gets back ${formatMoney(amt)}`;
            } else {
                const othersShare = amt - myShare;
                paidNote = `Your share ${formatMoney(myShare)}, others' share ${formatMoney(othersShare)}`;
            }

            paidItemsHtml += `<li><strong>${escapeHtml(e.name)}</strong>: Paid ${formatMoney(amt)} <em>(${paidNote})</em>${settledTag}</li>`;
        }

        // 2. Bills Where This Person Has a Share
        if (myShare > 0) {
            const payerTag = paidByKey === personId
                ? '<span class="badge badge-self">Paid by you</span>'
                : `Paid by ${escapeHtml(payerName)}`;

            const splitNote = splitEntries.length === 1
                ? `Personal item — ${payerTag}`
                : `Your portion of ${formatMoney(amt)} bill — ${payerTag}`;

            shareItemsHtml += `<li><strong>${escapeHtml(e.name)}</strong>: ${formatMoney(myShare)} <em>(${splitNote})</em>${settledTag}</li>`;
            lifetimeOwnShare += myShare;
            if (!settled) unsettledOwnShare += myShare;
        }
    });

    const balances = precomputedBalances || calculateTripBalances(tripPeople, tripExpenses, tripSettlements);
    const personBal = balances[personId] || { paid: 0, share: 0, settlementDelta: 0 };
    const net = personBal.paid - personBal.share + personBal.settlementDelta;

    const settlements = (precomputedTransfers || computeSettlements(balances)).filter(
        t => t.fromId === personId || t.toId === personId
    );

    let settlementLines = "";
    if (settlements.length === 0) {
        settlementLines = `<p class="muted" style="margin-top:10px; margin-bottom:0;">✓ No pending payments for ${escapeHtml(personName)}.</p>`;
    } else {
        settlementLines = `<div style="margin-top:10px;">`;
        settlements.forEach(t => {
            const text = t.fromId === personId
                ? `<span class="negative">${escapeHtml(personName)} needs to pay ${escapeHtml(t.toName)}: ${formatMoney(t.amount)}</span>`
                : `<span class="positive">${escapeHtml(t.fromName)} needs to pay ${escapeHtml(personName)}: ${formatMoney(t.amount)}</span>`;

            settlementLines += `
                <div class="settlement-row">
                    <div>${text}</div>
                    <button class="btn-sm success sync-lock" ${disabledAttr} onclick="markSettlementPaid('${escapeHtml(t.fromId)}', '${escapeHtml(t.toId)}', ${t.amount})">Mark Paid</button>
                </div>`;
        });
        settlementLines += `</div>`;
    }

    const transferRow = Math.abs(personBal.settlementDelta) > 0.005
        ? `<tr>
            <td>
                Direct Settle-Up Payments
                <span class="calc-sub">Lump-sum transfers already given or received</span>
            </td>
            <td>${personBal.settlementDelta >= 0 ? "+" : "−"} ${formatMoney(Math.abs(personBal.settlementDelta))}</td>
        </tr>`
        : "";

    content.innerHTML = `
        <div class="ind-section">
            <h4>💸 Bills Paid by ${escapeHtml(personName)}</h4>
            ${paidItemsHtml ? `<ul>${paidItemsHtml}</ul>` : `<p class="muted" style="margin:0;">No bills paid by ${escapeHtml(personName)}.</p>`}
        </div>
        <div class="ind-section">
            <h4>🧾 ${escapeHtml(personName)}'s Own Share of Bills</h4>
            ${shareItemsHtml ? `<ul>${shareItemsHtml}</ul>` : `<p class="muted" style="margin:0;">No expenses include ${escapeHtml(personName)}.</p>`}
        </div>
        <div class="ind-summary">
            <h4>🧮 How ${escapeHtml(personName)}'s Balance is Calculated</h4>
            <table class="calc-table">
                <tr>
                    <td>
                        Bills Paid by ${escapeHtml(personName)} (Unsettled)
                        <span class="calc-sub">Total amount paid out of pocket on pending bills</span>
                    </td>
                    <td>${formatMoney(unsettledPaid)}</td>
                </tr>
                <tr>
                    <td>
                        Minus: ${escapeHtml(personName)}'s Own Share (Unsettled)
                        <span class="calc-sub">Your personal portion of pending split &amp; individual bills</span>
                    </td>
                    <td>− ${formatMoney(unsettledOwnShare)}</td>
                </tr>
                ${transferRow}
                <tr class="calc-total">
                    <td>Final Balance for ${escapeHtml(personName)}</td>
                    <td>${formatNetLabel(net, `(${personName} Gets Back)`, `(${personName} Owes)`)}</td>
                </tr>
            </table>
            ${settlementLines}
            <div class="lifetime-note">
                📊 <strong>${escapeHtml(personName)}'s Total Trip Cost (Settled + Unsettled):</strong> ${formatMoney(lifetimeOwnShare)}
                <span class="calc-sub">Total value of everything ${escapeHtml(personName)} consumed across the entire trip.</span>
            </div>
        </div>
    `;
}

function renderOverallSettlements(tripPeople, tripSettlements, allTransfers) {
    const container = document.getElementById("overall-settlements-content");
    if (!container) return;

    const disabledAttr = isSyncing ? "disabled" : "";
    let html = "";

    if (allTransfers.length === 0) {
        html += `<p class="positive" style="margin:4px 0;">✓ Everyone is completely settled up! No pending dues.</p>`;
    } else {
        allTransfers.forEach(t => {
            html += `
                <div class="settlement-row">
                    <div>
                        <strong>${escapeHtml(t.fromName)}</strong> owes <strong>${escapeHtml(t.toName)}</strong>:
                        <span class="negative">${formatMoney(t.amount)}</span>
                    </div>
                    <button class="btn-sm success sync-lock" ${disabledAttr} onclick="markSettlementPaid('${escapeHtml(t.fromId)}', '${escapeHtml(t.toId)}', ${t.amount})">Mark Settled</button>
                </div>`;
        });
    }

    if (tripSettlements.length > 0) {
        html += `<div class="settlement-history">
            <p class="muted" style="margin:0 0 8px 0;"><strong>Recorded Lump-Sum Payments:</strong></p>`;
        tripSettlements.forEach(s => {
            const fromName = tripPeople.find(p => String(p.id).trim() === String(s.fromId).trim())?.name || "Unknown";
            const toName = tripPeople.find(p => String(p.id).trim() === String(s.toId).trim())?.name || "Unknown";
            html += `
                <div class="settlement-history-row">
                    <span>✓ <strong>${escapeHtml(fromName)}</strong> paid <strong>${escapeHtml(toName)}</strong> ${formatMoney(s.amount)}</span>
                    <button class="btn-sm secondary sync-lock" ${disabledAttr} onclick="undoSettlement('${escapeHtml(s.id)}')">Undo</button>
                </div>`;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

init();
