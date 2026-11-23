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

    cancelEditExpense();
    document.getElementById("trip-screen").style.display = "none";
    document.getElementById("dashboard-screen").style.display = "block";

    const trip = data.trips.find(t => String(t.id).trim() === String(activeTripId).trim());
    document.getElementById("active-trip-name").innerText = trip ? trip.name : "Trip";
    renderDashboard();
}

function backToTrips() {
    activeTripId = null;
    cancelEditExpense();
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

    const tripExpenses = data.expenses.filter(e => String(e.tripId).trim() === String(activeTripId).trim());
    const tripSettlements = data.settlements.filter(s => String(s.tripId).trim() === String(activeTripId).trim());

    // Block deletion if tied directly to any expense or settlement
    const tiedExpenses = tripExpenses.filter(
        e => String(e.paidBy).trim() === personKey || String(e.target).trim() === personKey
    );
    const tiedSettlements = tripSettlements.filter(
        s => String(s.fromId).trim() === personKey || String(s.toId).trim() === personKey
    );

    if (tiedExpenses.length > 0 || tiedSettlements.length > 0) {
        return alert(
            `Cannot delete "${person.name}" because they are tied to ${tiedExpenses.length} expense(s) and ${tiedSettlements.length} settlement(s). Edit or delete those entries first.`
        );
    }

    // Also check if trip has Split expenses (which include all trip members)
    const hasSplitExpenses = tripExpenses.some(e => e.type === "Split");
    if (hasSplitExpenses) {
        return alert(
            `Cannot delete "${person.name}" while Split expenses exist in this trip, as removing them would alter existing split shares.`
        );
    }

    if (!confirm(`Remove "${person.name}" from this trip?`)) return;

    data.people = data.people.filter(p => String(p.id).trim() !== personKey);
    renderDashboard();
    syncData("deletePerson", { id: personId });
}

// --- EXPENSE MANAGEMENT ---

function toggleIndTarget() {
    const type = document.getElementById("exp-type").value;
    document.getElementById("exp-target").style.display = type === "Individual" ? "inline-block" : "none";
}

function startEditExpense(expenseId) {
    if (isSyncing) return;
    const exp = data.expenses.find(e => String(e.id).trim() === String(expenseId).trim());
    if (!exp) return;

    document.getElementById("edit-expense-id").value = String(exp.id);
    document.getElementById("expense-form-title").innerText = "✏️ Edit Expense";
    document.getElementById("exp-name").value = exp.name;
    document.getElementById("exp-desc").value = exp.desc || "";
    document.getElementById("exp-amount").value = exp.amount;
    document.getElementById("exp-paid-by").value = String(exp.paidBy);
    document.getElementById("exp-type").value = exp.type;
    toggleIndTarget();
    document.getElementById("exp-target").value = String(exp.target || "");

    document.getElementById("save-expense-btn").innerText = "Update Expense";
    document.getElementById("cancel-edit-btn").style.display = "inline-block";
    document.getElementById("expense-form-card").scrollIntoView({ behavior: "smooth" });
}

function cancelEditExpense() {
    document.getElementById("edit-expense-id").value = "";
    document.getElementById("expense-form-title").innerText = "💳 Add Expense";
    document.getElementById("exp-name").value = "";
    document.getElementById("exp-desc").value = "";
    document.getElementById("exp-amount").value = "";
    document.getElementById("exp-paid-by").value = "";
    document.getElementById("exp-type").value = "Split";
    toggleIndTarget();
    document.getElementById("exp-target").value = "";

    document.getElementById("save-expense-btn").innerText = "Save Expense";
    document.getElementById("cancel-edit-btn").style.display = "none";
}

function saveExpense() {
    if (isSyncing) return;
    const editId = document.getElementById("edit-expense-id").value;
    const name = document.getElementById("exp-name").value.trim();
    const desc = document.getElementById("exp-desc").value.trim();
    const amount = parseFloat(document.getElementById("exp-amount").value);
    const paidBy = document.getElementById("exp-paid-by").value;
    const type = document.getElementById("exp-type").value;
    const target = type === "Individual" ? document.getElementById("exp-target").value : "";

    if (!name || isNaN(amount) || amount <= 0 || !paidBy) {
        return alert("Please enter a valid Name, Amount, and Paid By.");
    }
    if (type === "Individual" && !target) {
        return alert("Please select who this individual expense is for.");
    }

    if (editId) {
        const exp = data.expenses.find(e => String(e.id).trim() === String(editId).trim());
        if (exp) {
            exp.name = name;
            exp.desc = desc;
            exp.amount = amount;
            exp.paidBy = paidBy;
            exp.type = type;
            exp.target = target;
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
            type,
            target,
            settled: false
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
            settlementDelta: 0 // + when payer sends settlement, - when recipient receives settlement
        };
    });

    tripExpenses.forEach(e => {
        if (isSettled(e)) return;
        const amt = parseFloat(e.amount) || 0;
        const paidByKey = String(e.paidBy).trim();

        if (balances[paidByKey]) {
            balances[paidByKey].paid += amt;
        }

        if (e.type === "Split" && tripPeople.length > 0) {
            const splitAmt = amt / tripPeople.length;
            tripPeople.forEach(p => {
                balances[String(p.id).trim()].share += splitAmt;
            });
        } else if (e.type === "Individual") {
            const targetKey = String(e.target).trim();
            if (balances[targetKey]) {
                balances[targetKey].share += amt;
            }
        }
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

function renderDashboard() {
    const tripPeople = data.people.filter(p => String(p.tripId).trim() === String(activeTripId).trim());
    const tripExpenses = data.expenses.filter(e => String(e.tripId).trim() === String(activeTripId).trim());
    const tripSettlements = data.settlements.filter(s => String(s.tripId).trim() === String(activeTripId).trim());
    const disabledAttr = isSyncing ? "disabled" : "";

    // Render People List with Rename & Delete controls
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
    const prevTarget = document.getElementById("exp-target").value;
    const prevIndView = document.getElementById("ind-view-select").value;

    let options = '<option value="">Select Person...</option>';
    tripPeople.forEach(p => {
        options += `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`;
    });

    document.getElementById("exp-paid-by").innerHTML = options;
    document.getElementById("exp-target").innerHTML = options;
    document.getElementById("ind-view-select").innerHTML = options;

    document.getElementById("exp-paid-by").value = prevPaidBy;
    document.getElementById("exp-target").value = prevTarget;
    document.getElementById("ind-view-select").value = prevIndView;

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
        const targetPerson = tripPeople.find(p => String(p.id).trim() === String(e.target).trim());
        const targetName = e.type === "Individual" ? ` (for ${targetPerson ? targetPerson.name : "Unknown"})` : "";

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
            <td>${escapeHtml(e.type + targetName)}</td>
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
    let unsettledShare = 0;
    let totalOverallShare = 0;

    tripExpenses.forEach(e => {
        const amt = parseFloat(e.amount) || 0;
        const settled = isSettled(e);
        const paidByKey = String(e.paidBy).trim();
        const targetKey = String(e.target).trim();
        const payer = tripPeople.find(p => String(p.id).trim() === paidByKey);
        const payerName = payer ? payer.name : "Unknown";
        const targetPerson = tripPeople.find(p => String(p.id).trim() === targetKey);
        const targetName = targetPerson ? targetPerson.name : "Unknown";

        const settledTag = settled ? ' <span class="badge badge-settled">Settled</span>' : "";

        if (paidByKey === personId) {
            if (!settled) unsettledPaid += amt;

            let paidNote = "";
            if (e.type === "Split" && tripPeople.length > 0) {
                const ownShare = amt / tripPeople.length;
                const othersShare = amt - ownShare;
                paidNote = `Split — own share ${formatMoney(ownShare)}, gets back ${formatMoney(othersShare)}`;
            } else if (e.type === "Individual" && targetKey === personId) {
                paidNote = `Individual for self — ₹0.00 owed by others`;
            } else if (e.type === "Individual") {
                paidNote = `Individual paid for ${escapeHtml(targetName)} — gets back ${formatMoney(amt)}`;
            }

            paidItemsHtml += `<li><strong>${escapeHtml(e.name)}</strong>: Paid ${formatMoney(amt)} <em>(${paidNote})</em>${settledTag}</li>`;
        }

        if (e.type === "Split" && tripPeople.length > 0) {
            const splitAmt = amt / tripPeople.length;
            const payerTag = paidByKey === personId
                ? '<span class="badge badge-self">Self-paid</span>'
                : `Paid by ${escapeHtml(payerName)}`;

            shareItemsHtml += `<li><strong>${escapeHtml(e.name)}</strong>: ${formatMoney(splitAmt)} <em>(Split share of ${formatMoney(amt)} — ${payerTag})</em>${settledTag}</li>`;
            totalOverallShare += splitAmt;
            if (!settled) unsettledShare += splitAmt;

        } else if (e.type === "Individual" && targetKey === personId) {
            const payerTag = paidByKey === personId
                ? '<span class="badge badge-self">Self-paid</span>'
                : `Paid by ${escapeHtml(payerName)}`;

            shareItemsHtml += `<li><strong>${escapeHtml(e.name)}</strong>: ${formatMoney(amt)} <em>(Individual — ${payerTag})</em>${settledTag}</li>`;
            totalOverallShare += amt;
            if (!settled) unsettledShare += amt;
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
        settlementLines = `<p class="muted" style="margin-top:8px;">No pending settlements for ${escapeHtml(personName)}.</p>`;
    } else {
        settlementLines = `<div style="margin-top:10px;">`;
        settlements.forEach(t => {
            const text = t.fromId === personId
                ? `<span class="negative">${escapeHtml(personName)} owes ${escapeHtml(t.toName)}: ${formatMoney(t.amount)}</span>`
                : `<span class="positive">${escapeHtml(t.fromName)} owes ${escapeHtml(personName)}: ${formatMoney(t.amount)}</span>`;

            settlementLines += `
                <div class="settlement-row">
                    <div>${text}</div>
                    <button class="btn-sm success sync-lock" ${disabledAttr} onclick="markSettlementPaid('${escapeHtml(t.fromId)}', '${escapeHtml(t.toId)}', ${t.amount})">Mark Paid</button>
                </div>`;
        });
        settlementLines += `</div>`;
    }

    content.innerHTML = `
        <div class="ind-section">
            <h4>💸 Expenses Paid by ${escapeHtml(personName)}</h4>
            ${paidItemsHtml ? `<ul>${paidItemsHtml}</ul>` : `<p class="muted" style="margin:0;">No expenses paid by ${escapeHtml(personName)}.</p>`}
        </div>
        <div class="ind-section">
            <h4>🧾 ${escapeHtml(personName)}'s Expense Shares & Personal Items</h4>
            ${shareItemsHtml ? `<ul>${shareItemsHtml}</ul>` : `<p class="muted" style="margin:0;">No expenses assigned to ${escapeHtml(personName)}.</p>`}
        </div>
        <div class="ind-summary">
            <p><strong>Expenses Paid Out of Pocket (Unsettled):</strong> ${formatMoney(unsettledPaid)}</p>
            <p><strong>Share / Personal Cost (Unsettled):</strong> ${formatMoney(unsettledShare)} <span class="muted">(Overall incl. settled: ${formatMoney(totalOverallShare)})</span></p>
            <p><strong>Lump-Sum Settlements Applied:</strong> ${personBal.settlementDelta >= 0 ? "+" : "-"}${formatMoney(Math.abs(personBal.settlementDelta))}</p>
            <p><strong>Net Balance for ${escapeHtml(personName)}:</strong> ${formatNetLabel(net, `(${personName} Gets Back)`, `(${personName} Owes)`)}</p>
            ${settlementLines}
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
