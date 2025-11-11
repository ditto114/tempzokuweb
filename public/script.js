const dropSaleOptions = [
  { label: '499수작', multiplier: 1 - 0.018 },
  { label: '999수작', multiplier: 1 - 0.03 },
  { label: '2499수작', multiplier: 1 - 0.04 },
  { label: '상점판매', multiplier: 1 }
];

const guestSaleOptions = [
  { label: '499수작', multiplier: 1 - 0.018 },
  { label: '999수작', multiplier: 1 - 0.03 },
  { label: '2499수작', multiplier: 1 - 0.04 }
];

let members = [];

function formatCurrency(value) {
  const number = Number(value);
  const safeNumber = Number.isFinite(number) ? number : 0;
  const truncated = Math.floor(safeNumber);
  return truncated.toLocaleString('ko-KR');
}

function toNumber(value, fallback = 0) {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function createTableRow(tableBody, saleOptions, defaultItem = '') {
  const row = document.createElement('tr');

  const itemCell = document.createElement('td');
  const itemInput = document.createElement('input');
  itemInput.type = 'text';
  itemInput.value = defaultItem;
  itemCell.appendChild(itemInput);

  const priceCell = document.createElement('td');
  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.min = '0';
  priceInput.step = 'any';
  priceInput.placeholder = '0';
  priceCell.appendChild(priceInput);

  const methodCell = document.createElement('td');
  const methodSelect = document.createElement('select');
  saleOptions.forEach((option) => {
    const optionElement = document.createElement('option');
    optionElement.value = option.label;
    optionElement.textContent = option.label;
    optionElement.dataset.multiplier = option.multiplier;
    methodSelect.appendChild(optionElement);
  });
  methodCell.appendChild(methodSelect);

  const netCell = document.createElement('td');
  const netInput = document.createElement('input');
  netInput.type = 'text';
  netInput.readOnly = true;
  netInput.classList.add('net-amount');
  netInput.value = '0';
  netInput.dataset.value = '0';
  netCell.appendChild(netInput);

  function updateRowValues() {
    const price = parseFloat(priceInput.value) || 0;
    const multiplier = parseFloat(methodSelect.selectedOptions[0].dataset.multiplier) || 0;
    const netValue = price * multiplier;
    netInput.value = formatCurrency(netValue);
    netInput.dataset.value = String(netValue);
    updateTotals();
  }

  priceInput.addEventListener('input', updateRowValues);
  methodSelect.addEventListener('change', updateRowValues);

  row.appendChild(itemCell);
  row.appendChild(priceCell);
  row.appendChild(methodCell);
  row.appendChild(netCell);

  tableBody.appendChild(row);
  updateRowValues();
}

function getTotalNet() {
  return Array.from(document.querySelectorAll('.net-amount')).reduce((sum, input) => {
    const value = parseFloat(input.dataset.value) || 0;
    return sum + value;
  }, 0);
}

function calculateDistribution(totalNet) {
  const memberCount = members.length;

  const incentiveAmounts = members.map((member) => toNumber(member.incentive, 0) * 10000);
  const totalIncentives = incentiveAmounts.reduce((sum, amount) => sum + amount, 0);
  const distributable = totalNet - totalIncentives;
  const baseShare = memberCount > 0 ? distributable / memberCount : 0;

  const finalAmounts = new Array(memberCount).fill(0);

  if (memberCount === 0) {
    return { baseShare, finalAmounts, totalIncentives };
  }

  for (let i = 0; i < memberCount; i += 1) {
    const member = members[i];
    const rate = toNumber(member.rate, 100);

    if (memberCount === 1) {
      finalAmounts[0] += baseShare;
      continue;
    }

    const ownShare = baseShare * (rate / 100);
    const remainderShare = baseShare - ownShare;
    finalAmounts[i] += ownShare;

    const sharePerOther = remainderShare / (memberCount - 1);
    for (let j = 0; j < memberCount; j += 1) {
      if (j !== i) {
        finalAmounts[j] += sharePerOther;
      }
    }
  }

  for (let i = 0; i < memberCount; i += 1) {
    const deductionAmount = toNumber(members[i].deduction, 0) * 10000;
    if (deductionAmount === 0) {
      continue;
    }

    finalAmounts[i] -= deductionAmount;

    if (memberCount === 1) {
      continue;
    }

    const perOther = deductionAmount / (memberCount - 1);
    for (let j = 0; j < memberCount; j += 1) {
      if (j !== i) {
        finalAmounts[j] += perOther;
      }
    }
  }

  for (let i = 0; i < memberCount; i += 1) {
    finalAmounts[i] += incentiveAmounts[i];
  }

  return { baseShare, finalAmounts, totalIncentives };
}

function updateTotals() {
  const total = getTotalNet();
  const totalLabel = document.getElementById('total-net');
  totalLabel.textContent = formatCurrency(total);
  updateDistributionTable(total);
}

function updateDistributionTable(totalNet = getTotalNet()) {
  const tableBody = document.querySelector('#distribution-table tbody');
  tableBody.innerHTML = '';

  const memberCount = members.length;
  const memberCountLabel = document.getElementById('member-count');
  memberCountLabel.textContent = String(memberCount);

  const { baseShare, finalAmounts } = calculateDistribution(totalNet);

  const rowsToRender = Math.max(20, memberCount);

  for (let i = 0; i < rowsToRender; i += 1) {
    const row = document.createElement('tr');

    const nicknameCell = document.createElement('td');
    const jobCell = document.createElement('td');
    const shareCell = document.createElement('td');
    const rateCell = document.createElement('td');
    const deductionCell = document.createElement('td');
    const incentiveCell = document.createElement('td');
    const finalCell = document.createElement('td');

    if (i < memberCount) {
      const member = members[i];
      nicknameCell.textContent = member.nickname;
      jobCell.textContent = member.job;
      shareCell.textContent = formatCurrency(baseShare);

      const rateInput = document.createElement('input');
      rateInput.type = 'number';
      rateInput.min = '0';
      rateInput.step = '1';
      rateInput.value = member.rate ?? 100;
      rateInput.classList.add('distribution-input');
      rateInput.addEventListener('input', () => {
        member.rate = Math.max(0, toNumber(rateInput.value, 0));
        updateDistributionTable();
      });
      rateCell.appendChild(rateInput);

      const deductionInput = document.createElement('input');
      deductionInput.type = 'number';
      deductionInput.min = '0';
      deductionInput.step = '0.1';
      deductionInput.value = member.deduction ?? 0;
      deductionInput.classList.add('distribution-input');
      deductionInput.addEventListener('input', () => {
        member.deduction = Math.max(0, toNumber(deductionInput.value, 0));
        updateDistributionTable();
      });
      deductionCell.appendChild(deductionInput);

      const incentiveInput = document.createElement('input');
      incentiveInput.type = 'number';
      incentiveInput.min = '0';
      incentiveInput.step = '0.1';
      incentiveInput.value = member.incentive ?? 0;
      incentiveInput.classList.add('distribution-input');
      incentiveInput.addEventListener('input', () => {
        member.incentive = Math.max(0, toNumber(incentiveInput.value, 0));
        updateDistributionTable();
      });
      incentiveCell.appendChild(incentiveInput);

      finalCell.textContent = formatCurrency(finalAmounts[i]);
    } else {
      nicknameCell.textContent = '';
      jobCell.textContent = '';
      shareCell.textContent = '-';
      rateCell.textContent = '';
      deductionCell.textContent = '';
      incentiveCell.textContent = '';
      finalCell.textContent = '-';
    }

    row.appendChild(nicknameCell);
    row.appendChild(jobCell);
    row.appendChild(shareCell);
    row.appendChild(rateCell);
    row.appendChild(deductionCell);
    row.appendChild(incentiveCell);
    row.appendChild(finalCell);

    tableBody.appendChild(row);
  }

  updateMemberManagement();
}

function updateMemberManagement() {
  const management = document.getElementById('member-management');
  if (!management) {
    return;
  }

  const tableBody = management.querySelector('tbody');
  tableBody.innerHTML = '';

  if (members.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 3;
    emptyCell.textContent = '등록된 공대원이 없습니다.';
    emptyCell.style.textAlign = 'center';
    emptyRow.appendChild(emptyCell);
    tableBody.appendChild(emptyRow);
    return;
  }

  members.forEach((member) => {
    const row = document.createElement('tr');
    const nicknameCell = document.createElement('td');
    const jobCell = document.createElement('td');
    const actionCell = document.createElement('td');

    nicknameCell.textContent = member.nickname;
    jobCell.textContent = member.job;

    const deleteButton = document.createElement('button');
    deleteButton.textContent = '삭제';
    deleteButton.classList.add('danger');
    deleteButton.addEventListener('click', () => deleteMember(member.id));
    actionCell.appendChild(deleteButton);

    row.appendChild(nicknameCell);
    row.appendChild(jobCell);
    row.appendChild(actionCell);

    tableBody.appendChild(row);
  });
}

function toggleMemberManagement(visible) {
  const management = document.getElementById('member-management');
  if (!management) {
    return;
  }

  if (visible) {
    management.classList.remove('hidden');
  } else {
    management.classList.add('hidden');
  }
}

async function fetchMembers() {
  try {
    const response = await fetch('/api/members');
    if (!response.ok) {
      throw new Error('공대원 목록을 불러오지 못했습니다.');
    }
    const data = await response.json();
    const previousMembers = new Map(members.map((member) => [member.id, member]));
    members = data.map((member) => {
      const previous = previousMembers.get(member.id);
      return {
        ...member,
        rate: previous ? previous.rate : 100,
        deduction: previous ? previous.deduction : 0,
        incentive: previous ? previous.incentive : 0
      };
    });
    updateDistributionTable();
  } catch (error) {
    console.error(error);
    alert('공대원 목록을 불러오는 중 문제가 발생했습니다.');
  }
}

async function saveMember() {
  const nicknameInput = document.getElementById('nickname-input');
  const jobInput = document.getElementById('job-input');

  const nickname = nicknameInput.value.trim();
  const job = jobInput.value.trim();

  if (!nickname || !job) {
    alert('닉네임과 직업을 모두 입력해주세요.');
    return;
  }

  try {
    const response = await fetch('/api/members', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ nickname, job })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ message: '공대원 정보를 저장하지 못했습니다.' }));
      throw new Error(data.message || '공대원 정보를 저장하지 못했습니다.');
    }

    nicknameInput.value = '';
    jobInput.value = '';
    toggleMemberForm(false);
    await fetchMembers();
  } catch (error) {
    console.error(error);
    alert(error.message || '공대원을 추가하는 중 문제가 발생했습니다.');
  }
}

async function deleteMember(id) {
  if (!confirm('해당 공대원을 삭제하시겠습니까?')) {
    return;
  }

  try {
    const response = await fetch(`/api/members/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok && response.status !== 204) {
      const data = await response.json().catch(() => ({ message: '공대원 정보를 삭제하지 못했습니다.' }));
      throw new Error(data.message || '공대원 정보를 삭제하지 못했습니다.');
    }

    await fetchMembers();
  } catch (error) {
    console.error(error);
    alert(error.message || '공대원을 삭제하는 중 문제가 발생했습니다.');
  }
}

function toggleMemberForm(visible) {
  const form = document.getElementById('member-form');
  if (visible) {
    form.classList.remove('hidden');
  } else {
    form.classList.add('hidden');
  }
}

function initTables() {
  const dropTableBody = document.querySelector('#drop-table tbody');
  const guestTableBody = document.querySelector('#guest-table tbody');

  for (let i = 0; i < 3; i += 1) {
    createTableRow(dropTableBody, dropSaleOptions);
  }

  const guestDefaults = ['목걸이 1', '목걸이 2', '알'];
  guestDefaults.forEach((itemName) => {
    createTableRow(guestTableBody, guestSaleOptions, itemName);
  });

  document.getElementById('add-drop-row').addEventListener('click', () => {
    createTableRow(dropTableBody, dropSaleOptions);
  });

  document.getElementById('add-guest-row').addEventListener('click', () => {
    createTableRow(guestTableBody, guestSaleOptions);
  });
}

function initMemberControls() {
  document.getElementById('add-member-btn').addEventListener('click', () => toggleMemberForm(true));
  document.getElementById('cancel-member').addEventListener('click', () => toggleMemberForm(false));
  document.getElementById('save-member').addEventListener('click', (event) => {
    event.preventDefault();
    saveMember();
  });
  document.getElementById('manage-members-btn').addEventListener('click', () => {
    updateMemberManagement();
    toggleMemberManagement(true);
  });
  document.getElementById('close-management').addEventListener('click', () => toggleMemberManagement(false));
}

window.addEventListener('DOMContentLoaded', () => {
  initTables();
  initMemberControls();
  fetchMembers();
});
