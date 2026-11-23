const API_URL = "/sync";

let data = { trips: [], people: [], expenses: [] };
let activeTripId = null;

function setStatus(msg, type = "") {
    const bar = document.getElementById("sync-status");
    if (!bar) return;
    bar.innerText = msg;
    bar.className = "status-bar" + (type ? " " + type : "");
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
    setStatus("Loading data from Google Sheets...");
    try {
        const response = await fetch(API_URL);
        const result = await response.json();
        if (!response.ok || result.error) {
            throw new Error(result.error || "Server error");
        }
        data = {
            trips: result.trips || [],
            people: result.people || [],
            expenses: result.expenses || []
        };
        renderTrips(activeTripId || "");
        if (activeTripId) renderDashboard();
        setStatus("Synced with Google Sheets ✓", "ok");
    } catch (e) {
        console.error("Failed to load data", e);
        setStatus("Error: " + e.message, "err");
    }
}

async function syncData(action, payload) {
    setStatus("Saving changes to Google Sheets...");
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
    const name = document.getElementById("new-trip-name").value.trim();
    if (!name) return;
    const newTrip = { id: Date.now().toString(), name };
    data.trips.push(newTrip);
    renderTrips(newTrip.id);
    syncData("addTrip", newTrip);
    document.getElementById("new-trip-name").value = "";
}

function editTrip() {
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
    const tripId = document.getElementById("trip-select").value;
    if (!tripId) return alert("Please select a trip from the dropdown first.");

    const trip = data.trips.find(t => String(t.id).trim() === String(tripId).trim());
    if (!trip) return;

    if (!confirm(`Delete "${trip.name}" along with all its people and expenses?`)) return;

    data.trips = data.trips.filter(t => String(t.id).trim() !== String(tripId).trim());
    data.people = data.people.filter(p => String(p.tripId).trim() !== String(tripId).trim());
    data.expenses = data.expenses.filter(e => String(e.tripId).trim() !== String(tripId).trim());

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

// --- PEOPLE MANAGEMENT ---

function addPerson() {
    const name = document.getElementById("new-person-name").value.trim();
    if (!name) return;
    const newPerson = { id: Date.now().toString(), tripId: activeTripId, name };
    data.people.push(newPerson);
    document.getElementById("new-person-name").value = "";
    syncData("addPerson", newPerson);
    renderDashboard();
}

// --- EXPENSE MANAGEMENT ---

function toggleIndTarget() {
    const type = document.getElementById("exp-type").value;
    document.getElementById("exp-target").style.display = type === "Individual" ? "inline-block" : "none";
}

function startEditExpense(expenseId) {
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
            syncData("editExpense", exp);
        }
        cancelEditExpense();
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
        syncData("addExpense", newExp);
        cancelEditExpense();
    }

    renderDashboard();
}

function deleteExpense(expenseId) {
    const exp = data.expenses.find(e => String(e.id).trim() === String(expenseId).trim());
    if (!exp) return;

    if (!confirm(`Delete expense "${exp.name}"?`)) return;

    if (String(document.getElementById("edit-expense-id").value).trim() === String(expenseId).trim()) {
        cancelEditExpense();
    }

    data.expenses = data.expenses.filter(e => String(e.id).trim() !== String(expenseId).trim());
    syncData("deleteExpense", { id: expenseId });
    renderDashboard();
}

function toggleSettleExpense(expenseId) {
    const exp = data.expenses.find(e => String(e.id).trim() === String(expenseId).trim());
    if (!exp) return;

    exp.settled = !isSettled(exp);
    syncData("toggleSettleExpense", { id: expenseId, settled: exp.settled });
    renderDashboard();
}

// --- CALCULATIONS & RENDERING ---

function calculateTripBalances(tripPeople, tripExpenses) {
    const balances = {};
    tripPeople.forEach(p => {
        balances[String(p.id).trim()] = { id: String(p.id).trim(), name: p.name, paid: 0, share: 0 };
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

    return balances;
}

function computeSettlements(balances) {
    const debtors = [];
    const creditors = [];

    Object.values(balances).forEach(b => {
        const net = b.paid - b.share;
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

    document.getElementById("people-list").innerText =
        "People: " + (tripPeople.length ? tripPeople.map(p => p.name).join(", ") : "None added yet");

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
                    <button class="btn-sm ${settleBtnClass}" onclick="toggleSettleExpense('${escapeHtml(e.id)}')">${settleBtnLabel}</button>
                    <button class="btn-sm warning" onclick="startEditExpense('${escapeHtml(e.id)}')">Edit</button>
                    <button class="btn-sm danger" onclick="deleteExpense('${escapeHtml(e.id)}')">Delete</button>
                </div>
            </td>
        </tr>`;
    });

    document.getElementById("total-trip-expense").innerText = `Total Trip Expense: ${formatMoney(totalExp)}`;
    document.getElementById("unsettled-trip-expense").innerText = `Unsettled Remaining: ${formatMoney(unsettledExp)}`;

    const balances = calculateTripBalances(tripPeople, tripExpenses);
    const balTbody = document.getElementById("balances-tbody");
    balTbody.innerHTML = "";

    Object.values(balances).forEach(b => {
        const net = b.paid - b.share;
        balTbody.innerHTML += `<tr>
            <td>${escapeHtml(b.name)}</td>
            <td>${formatMoney(b.paid)}</td>
            <td>${formatMoney(b.share)}</td>
            <td>${formatNetLabel(net)}</td>
        </tr>`;
    });

    renderIndividualView();
}

function renderIndividualView() {
    const personId = String(document.getElementById("ind-view-select").value).trim();
    const content = document.getElementById("ind-view-content");
    if (!personId) {
        content.innerHTML = "";
        return;
    }

    const tripPeople = data.people.filter(p => String(p.tripId).trim() === String(activeTripId).trim());
    const tripExpenses = data.expenses.filter(e => String(e.tripId).trim() === String(activeTripId).trim());
    const selectedPerson = tripPeople.find(p => String(p.id).trim() === personId);
    const personName = selectedPerson ? selectedPerson.name : "Person";

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

        // 1. Expenses Paid By This Person
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

        // 2. Expenses Consumed / Share Assigned To This Person
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

    const balances = calculateTripBalances(tripPeople, tripExpenses);
    const settlements = computeSettlements(balances).filter(
        t => t.fromId === personId || t.toId === personId
    );

    const net = unsettledPaid - unsettledShare;

    let settlementLines = "";
    if (settlements.length === 0) {
        settlementLines = `<p class="muted" style="margin-top:6px;">No pending settlements for ${escapeHtml(personName)}.</p>`;
    } else {
        settlementLines = '<ul style="margin:6px 0 0 0; padding-left:20px;">';
        settlements.forEach(t => {
            if (t.fromId === personId) {
                settlementLines += `<li class="negative">${escapeHtml(personName)} owes ${escapeHtml(t.toName)}: ${formatMoney(t.amount)}</li>`;
            } else {
                settlementLines += `<li class="positive">${escapeHtml(t.fromName)} owes ${escapeHtml(personName)}: ${formatMoney(t.amount)}</li>`;
            }
        });
        settlementLines += "</ul>";
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
            <p><strong>Total Paid Out of Pocket (Unsettled):</strong> ${formatMoney(unsettledPaid)}</p>
            <p><strong>Total Share / Personal Cost (Unsettled):</strong> ${formatMoney(unsettledShare)} <span class="muted">(Overall incl. settled: ${formatMoney(totalOverallShare)})</span></p>
            <p><strong>Net Balance for ${escapeHtml(personName)}:</strong> ${formatNetLabel(net, `(${personName} Gets Back)`, `(${personName} Owes)`)}</p>
            ${settlementLines}
        </div>
    `;
}

init();
