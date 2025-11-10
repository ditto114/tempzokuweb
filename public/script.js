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
  const number = Number(value || 0);
  const hasFraction = !Number.isInteger(number);
  return number.toLocaleString('ko-KR', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0
  });
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

  const share = memberCount > 0 ? totalNet / memberCount : 0;

  const rowsToRender = Math.max(20, memberCount);

  for (let i = 0; i < rowsToRender; i += 1) {
    const row = document.createElement('tr');

    const nicknameCell = document.createElement('td');
    const jobCell = document.createElement('td');
    const shareCell = document.createElement('td');
    const deleteCell = document.createElement('td');

    if (i < memberCount) {
      const member = members[i];
      nicknameCell.textContent = member.nickname;
      jobCell.textContent = member.job;
      shareCell.textContent = formatCurrency(share);

      const deleteButton = document.createElement('button');
      deleteButton.textContent = '삭제';
      deleteButton.classList.add('danger', 'delete-btn');
      deleteButton.addEventListener('click', () => deleteMember(member.id));
      deleteCell.appendChild(deleteButton);
    } else {
      nicknameCell.textContent = '';
      jobCell.textContent = '';
      shareCell.textContent = '-';
      deleteCell.textContent = '';
    }

    row.appendChild(nicknameCell);
    row.appendChild(jobCell);
    row.appendChild(shareCell);
    row.appendChild(deleteCell);

    tableBody.appendChild(row);
  }
}

async function fetchMembers() {
  try {
    const response = await fetch('/api/members');
    if (!response.ok) {
      throw new Error('공대원 목록을 불러오지 못했습니다.');
    }
    members = await response.json();
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
}

window.addEventListener('DOMContentLoaded', () => {
  initTables();
  initMemberControls();
  fetchMembers();
});
