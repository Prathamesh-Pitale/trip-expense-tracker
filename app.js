const API_URL = "/api/sync"; 

let data = { trips: [], people: [], expenses: [] };
let activeTripId = null;

async function init() {
    try {
        const response = await fetch(API_URL);
        data = await response.json();
        renderTrips();
    } catch (e) {
        console.error("Failed to load data", e);
        alert("Could not load data. Ensure your Vercel Secret is set correctly.");
    }
}

async function syncData(action, payload) {
    fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action, payload })
    });
}

function renderTrips() {
    const select = document.getElementById('trip-select');
    select.innerHTML = '<option value="">-- Select a Trip --</option>';
    data.trips.forEach(t => select.innerHTML += `<option value="${t.id}">${t.name}</option>`);
}

function addTrip() {
    const name = document.getElementById('new-trip-name').value;
    if (!name) return;
    const newTrip = { id: Date.now().toString(), name };
    data.trips.push(newTrip); 
    renderTrips();
    syncData('addTrip', newTrip);
    document.getElementById('new-trip-name').value = '';
}

function loadTrip() {
    activeTripId = document.getElementById('trip-select').value;
    if (!activeTripId) return;
    
    document.getElementById('trip-screen').style.display = 'none';
    document.getElementById('dashboard-screen').style.display = 'block';
    
    document.getElementById('active-trip-name').innerText = data.trips.find(t => t.id === activeTripId).name;
    renderDashboard();
}

function backToTrips() {
    activeTripId = null;
    document.getElementById('trip-screen').style.display = 'block';
    document.getElementById('dashboard-screen').style.display = 'none';
}

function addPerson() {
    const name = document.getElementById('new-person-name').value;
    if (!name) return;
    const newPerson = { id: Date.now().toString(), tripId: activeTripId, name };
    data.people.push(newPerson);
    document.getElementById('new-person-name').value = '';
    syncData('addPerson', newPerson);
    renderDashboard();
}

function toggleIndTarget() {
    const type = document.getElementById('exp-type').value;
    document.getElementById('exp-target').style.display = (type === 'Individual') ? 'inline-block' : 'none';
}

function addExpense() {
    const exp = {
        id: Date.now().toString(),
        tripId: activeTripId,
        name: document.getElementById('exp-name').value,
        desc: document.getElementById('exp-desc').value,
        amount: parseFloat(document.getElementById('exp-amount').value),
        paidBy: document.getElementById('exp-paid-by').value,
        type: document.getElementById('exp-type').value,
        target: document.getElementById('exp-target').value
    };
    
    if(!exp.name || !exp.amount || !exp.paidBy) return alert("Please fill Name, Amount, and Paid By.");
    
    data.expenses.push(exp);
    syncData('addExpense', exp);
    
    document.getElementById('exp-name').value = '';
    document.getElementById('exp-desc').value = '';
    document.getElementById('exp-amount').value = '';
    renderDashboard();
}

function renderDashboard() {
    const tripPeople = data.people.filter(p => p.tripId === activeTripId);
    const tripExpenses = data.expenses.filter(e => e.tripId === activeTripId);
    
    document.getElementById('people-list').innerText = "People: " + tripPeople.map(p => p.name).join(", ");
    
    let options = '<option value="">Select Person...</option>';
    tripPeople.forEach(p => options += `<option value="${p.id}">${p.name}</option>`);
    document.getElementById('exp-paid-by').innerHTML = options;
    document.getElementById('exp-target').innerHTML = options;
    document.getElementById('ind-view-select').innerHTML = options;
    
    const tbody = document.getElementById('expenses-tbody');
    tbody.innerHTML = '';
    let totalExp = 0;
    
    const balances = {};
    tripPeople.forEach(p => balances[p.id] = { name: p.name, paid: 0, share: 0 });

    tripExpenses.forEach(e => {
        totalExp += e.amount;
        const payerName = tripPeople.find(p => p.id === e.paidBy)?.name || 'Unknown';
        const targetName = e.type === 'Individual' ? ` (for ${tripPeople.find(p => p.id === e.target)?.name})` : '';
        
        tbody.innerHTML += `<tr>
            <td>${e.name}</td><td>${e.desc}</td><td>$${e.amount.toFixed(2)}</td>
            <td>${payerName}</td><td>${e.type}${targetName}</td>
        </tr>`;

        if(balances[e.paidBy]) balances[e.paidBy].paid += e.amount;
        
        if (e.type === 'Split' && tripPeople.length > 0) {
            const splitAmt = e.amount / tripPeople.length;
            tripPeople.forEach(p => balances[p.id].share += splitAmt);
        } else if (e.type === 'Individual' && balances[e.target]) {
            balances[e.target].share += e.amount;
        }
    });

    document.getElementById('total-trip-expense').innerText = `Total Trip Expense: $${totalExp.toFixed(2)}`;

    const balTbody = document.getElementById('balances-tbody');
    balTbody.innerHTML = '';
    Object.values(balances).forEach(b => {
        const net = b.paid - b.share;
        const netClass = net >= 0 ? 'positive' : 'negative';
        balTbody.innerHTML += `<tr>
            <td>${b.name}</td><td>$${b.paid.toFixed(2)}</td><td>$${b.share.toFixed(2)}</td>
            <td class="${netClass}">$${Math.abs(net).toFixed(2)} ${net >= 0 ? '(Gets Back)' : '(Owes)'}</td>
        </tr>`;
    });
    
    renderIndividualView();
}

function renderIndividualView() {
    const personId = document.getElementById('ind-view-select').value;
    const content = document.getElementById('ind-view-content');
    if(!personId) { content.innerHTML = ''; return; }
    
    const tripPeople = data.people.filter(p => p.tripId === activeTripId);
    let html = '<ul style="margin: 0; padding-left: 20px;">';
    let totalOwed = 0;

    data.expenses.filter(e => e.tripId === activeTripId).forEach(e => {
        if (e.type === 'Split') {
            const splitAmt = e.amount / tripPeople.length;
            html += `<li><strong>${e.name}</strong>: $${splitAmt.toFixed(2)} <em>(Split share of $${e.amount})</em></li>`;
            totalOwed += splitAmt;
        } else if (e.type === 'Individual' && e.target === personId) {
            html += `<li><strong>${e.name}</strong>: $${e.amount.toFixed(2)} <em>(Individual expense)</em></li>`;
            totalOwed += e.amount;
        }
    });
    
    html += `</ul><p><strong>Total specific burden for this person: $${totalOwed.toFixed(2)}</strong></p>`;
    content.innerHTML = html;
}

init();
