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

const guestDefaultItems = ['목걸이 1', '목걸이 2', '알'];

let members = [];
let baseMembers = [];
let isReadOnly = false;
let currentDistributionId = null;
let currentTitle = '';
let currentView = 'list';
let useBaseMembersForEditor = true;

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

function generateDefaultTitle() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayName = dayNames[now.getDay()];
  return `${year}-${month}-${day}(${dayName}) 카스공대 혼테일 분배표`;
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function setPageTitle(title) {
  currentTitle = title;
  const titleElement = document.getElementById('page-title');
  if (!titleElement) {
    return;
  }
  if (currentView === 'list') {
    titleElement.textContent = '카스공대 혼테일 분배표';
  } else {
    titleElement.textContent = title || generateDefaultTitle();
  }
}

function createTableRow(tableBody, saleOptions, rowData = {}) {
  const row = document.createElement('tr');

  const itemCell = document.createElement('td');
  const itemInput = document.createElement('input');
  itemInput.type = 'text';
  itemInput.value = rowData.item || '';
  itemInput.placeholder = rowData.placeholder || '';
  itemInput.dataset.saleField = 'true';
  itemInput.classList.add('sale-field-input');
  if (isReadOnly) {
    itemInput.disabled = true;
  }
  const itemDisplay = document.createElement('span');
  itemDisplay.className = 'sale-field-display';
  itemCell.appendChild(itemInput);
  itemCell.appendChild(itemDisplay);

  const priceCell = document.createElement('td');
  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.min = '0';
  priceInput.step = 'any';
  priceInput.placeholder = '0 (만)';
  priceInput.dataset.saleField = 'true';
  priceInput.classList.add('sale-field-input', 'sale-price-input');
  let initialPriceUnits = null;
  if (rowData.priceUnits !== undefined) {
    initialPriceUnits = toNumber(rowData.priceUnits, 0);
  } else if (rowData.price !== undefined) {
    initialPriceUnits = toNumber(rowData.price, 0) / 10000;
  }
  if (Number.isFinite(initialPriceUnits)) {
    priceInput.value = String(initialPriceUnits);
  }
  if (isReadOnly) {
    priceInput.disabled = true;
  }
  const priceDisplay = document.createElement('span');
  priceDisplay.className = 'sale-field-display sale-price-display';
  priceCell.appendChild(priceInput);
  priceCell.appendChild(priceDisplay);

  const methodCell = document.createElement('td');
  const methodSelect = document.createElement('select');
  methodSelect.dataset.saleField = 'true';
  methodSelect.classList.add('sale-field-input');
  saleOptions.forEach((option) => {
    const optionElement = document.createElement('option');
    optionElement.value = option.label;
    optionElement.textContent = option.label;
    optionElement.dataset.multiplier = option.multiplier;
    methodSelect.appendChild(optionElement);
  });

  if (rowData.method) {
    const matching = Array.from(methodSelect.options).find((option) => option.value === rowData.method);
    if (matching) {
      methodSelect.value = matching.value;
    }
  }
  if (isReadOnly) {
    methodSelect.disabled = true;
  }
  const methodDisplay = document.createElement('span');
  methodDisplay.className = 'sale-field-display';
  methodCell.appendChild(methodSelect);
  methodCell.appendChild(methodDisplay);

  const netCell = document.createElement('td');
  const netInput = document.createElement('input');
  netInput.type = 'text';
  netInput.readOnly = true;
  netInput.classList.add('net-amount', 'sale-field-input');
  netInput.dataset.saleField = 'true';
  netInput.value = '0';
  netInput.dataset.value = '0';
  const netDisplay = document.createElement('span');
  netDisplay.className = 'sale-field-display sale-net-display';
  netCell.appendChild(netInput);
  netCell.appendChild(netDisplay);

  function updateRowValues() {
    const priceUnits = parseFloat(priceInput.value) || 0;
    const price = priceUnits * 10000;
    const selectedOption = methodSelect.selectedOptions[0];
    const multiplier = selectedOption ? parseFloat(selectedOption.dataset.multiplier) || 0 : 0;
    const netValue = price * multiplier;
    netInput.value = formatCurrency(netValue);
    netInput.dataset.value = String(netValue);
    syncSaleRowDisplay(row);
    updateTotals();
  }

  itemInput.addEventListener('input', () => {
    syncSaleRowDisplay(row);
  });
  priceInput.addEventListener('input', updateRowValues);
  methodSelect.addEventListener('change', updateRowValues);

  row.appendChild(itemCell);
  row.appendChild(priceCell);
  row.appendChild(methodCell);
  row.appendChild(netCell);

  tableBody.appendChild(row);
  row.classList.toggle('sale-row-readonly', isReadOnly);
  updateRowValues();
}

function syncSaleRowDisplay(row) {
  if (!row) {
    return;
  }
  const itemInput = row.querySelector('td:nth-child(1) input');
  const itemDisplay = row.querySelector('td:nth-child(1) .sale-field-display');
  if (itemDisplay) {
    const value = itemInput ? itemInput.value.trim() : '';
    itemDisplay.textContent = value || '-';
  }

  const priceInput = row.querySelector('td:nth-child(2) input');
  const priceDisplay = row.querySelector('td:nth-child(2) .sale-price-display');
  if (priceDisplay) {
    const units = priceInput ? parseFloat(priceInput.value) || 0 : 0;
    const formattedUnits = units.toLocaleString('ko-KR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    priceDisplay.textContent = `${formattedUnits}만`;
  }

  const methodSelect = row.querySelector('td:nth-child(3) select');
  const methodDisplay = row.querySelector('td:nth-child(3) .sale-field-display');
  if (methodDisplay) {
    methodDisplay.textContent = methodSelect ? methodSelect.value || '-' : '-';
  }

  const netInput = row.querySelector('.net-amount');
  const netDisplay = row.querySelector('.sale-net-display');
  if (netDisplay) {
    const netValue = netInput ? parseFloat(netInput.dataset.value) || 0 : 0;
    netDisplay.textContent = formatCurrency(netValue);
  }
}

function populateSaleTable(tableId, saleOptions, rowsData, fallbackRows = 0) {
  const tableBody = document.querySelector(`#${tableId} tbody`);
  if (!tableBody) {
    return;
  }
  tableBody.innerHTML = '';
  const rows = rowsData && rowsData.length > 0 ? rowsData : Array.from({ length: fallbackRows }, () => ({}));
  rows.forEach((row) => {
    createTableRow(tableBody, saleOptions, row);
  });
  if (rows.length === 0) {
    updateTotals();
  }
  applySaleTablesReadOnlyState();
}

function applySaleTablesReadOnlyState() {
  ['drop-table', 'guest-table'].forEach((tableId) => {
    const table = document.getElementById(tableId);
    if (!table) {
      return;
    }
    table.querySelectorAll('tbody tr').forEach((row) => {
      row.classList.toggle('sale-row-readonly', isReadOnly);
      syncSaleRowDisplay(row);
      row.querySelectorAll('.sale-field-input').forEach((element) => {
        if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
          if (element.classList.contains('net-amount')) {
            element.disabled = false;
            if (element instanceof HTMLInputElement) {
              element.readOnly = true;
            }
          } else {
            element.disabled = isReadOnly;
          }
        }
      });
    });
  });
}

function getSaleTableData(tableId, saleOptions) {
  const tableBody = document.querySelector(`#${tableId} tbody`);
  if (!tableBody) {
    return [];
  }
  return Array.from(tableBody.querySelectorAll('tr')).map((row) => {
    const itemInput = row.querySelector('td:nth-child(1) input');
    const priceInput = row.querySelector('td:nth-child(2) input');
    const methodSelect = row.querySelector('td:nth-child(3) select');
    const netInput = row.querySelector('.net-amount');

    const method = methodSelect ? methodSelect.value : saleOptions[0].label;
    const multiplier = saleOptions.find((option) => option.label === method)?.multiplier ?? saleOptions[0].multiplier;
    const priceUnits = priceInput ? toNumber(priceInput.value, 0) : 0;
    const price = priceUnits * 10000;

    return {
      item: itemInput ? itemInput.value : '',
      price,
      priceUnits,
      method,
      multiplier,
      net: netInput ? toNumber(netInput.dataset.value, 0) : 0,
    };
  });
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

function updateTotals(distributionData = null) {
  const total = getTotalNet();
  const calculated = distributionData || calculateDistribution(total);
  const totalIncentiveBonus = total * 0.01;
  const totalIncentiveValue = calculated.totalIncentives + totalIncentiveBonus;
  const totalDistribution = total - totalIncentiveValue;

  const totalLabel = document.getElementById('total-net');
  if (totalLabel) {
    totalLabel.textContent = formatCurrency(total);
  }

  const totalIncentiveLabel = document.getElementById('total-incentive');
  if (totalIncentiveLabel) {
    totalIncentiveLabel.textContent = formatCurrency(totalIncentiveValue);
  }

  const totalDistributionLabel = document.getElementById('total-distribution');
  if (totalDistributionLabel) {
    totalDistributionLabel.textContent = formatCurrency(totalDistribution);
  }

  updateDistributionTable(total, calculated);
}

function createRateControls(member, rateCell, rateValue) {
  if (isReadOnly) {
    rateCell.textContent = `${Number(rateValue).toLocaleString('ko-KR')}%`;
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.classList.add('input-with-controls');

  const rateInput = document.createElement('input');
  rateInput.type = 'number';
  rateInput.min = '0';
  rateInput.step = '1';
  rateInput.value = rateValue;
  rateInput.classList.add('distribution-input');

  const controlContainer = document.createElement('div');
  controlContainer.classList.add('control-buttons');

  const increaseButton = document.createElement('button');
  increaseButton.type = 'button';
  increaseButton.textContent = '+5%';
  increaseButton.classList.add('mini-button');
  increaseButton.dataset.lockable = 'true';

  const decreaseButton = document.createElement('button');
  decreaseButton.type = 'button';
  decreaseButton.textContent = '-5%';
  decreaseButton.classList.add('mini-button');
  decreaseButton.dataset.lockable = 'true';

  function commitRateChange(newValue) {
    const safeValue = Math.max(0, toNumber(newValue, 0));
    member.rate = safeValue;
    rateInput.value = safeValue;
    updateTotals();
  }

  rateInput.addEventListener('change', () => {
    commitRateChange(rateInput.value);
  });

  increaseButton.addEventListener('click', () => {
    if (isReadOnly) {
      return;
    }
    commitRateChange(toNumber(rateInput.value, rateValue) + 5);
  });

  decreaseButton.addEventListener('click', () => {
    if (isReadOnly) {
      return;
    }
    commitRateChange(toNumber(rateInput.value, rateValue) - 5);
  });

  if (isReadOnly) {
    rateInput.disabled = true;
    increaseButton.disabled = true;
    decreaseButton.disabled = true;
  }

  controlContainer.appendChild(increaseButton);
  controlContainer.appendChild(decreaseButton);
  wrapper.appendChild(rateInput);
  wrapper.appendChild(controlContainer);
  rateCell.appendChild(wrapper);
}

function updateDistributionTable(totalNet = getTotalNet(), distributionData = null) {
  const tableBody = document.querySelector('#distribution-table tbody');
  if (!tableBody) {
    return;
  }
  tableBody.innerHTML = '';

  const memberCount = members.length;
  const memberCountLabel = document.getElementById('member-count');
  if (memberCountLabel) {
    memberCountLabel.textContent = String(memberCount);
  }

  const { baseShare, finalAmounts, totalIncentives } = distributionData || calculateDistribution(totalNet);
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

      createRateControls(member, rateCell, member.rate ?? 100);

      if (isReadOnly) {
        deductionCell.textContent = `${Number(member.deduction ?? 0).toLocaleString('ko-KR', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })}만`;
        incentiveCell.textContent = `${Number(member.incentive ?? 0).toLocaleString('ko-KR', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })}만`;
      } else {
        const deductionInput = document.createElement('input');
        deductionInput.type = 'number';
        deductionInput.min = '0';
        deductionInput.step = '0.1';
        deductionInput.value = member.deduction ?? 0;
        deductionInput.classList.add('distribution-input');
        deductionInput.addEventListener('change', () => {
          member.deduction = Math.max(0, toNumber(deductionInput.value, 0));
          updateTotals();
        });
        deductionCell.appendChild(deductionInput);

        const incentiveInput = document.createElement('input');
        incentiveInput.type = 'number';
        incentiveInput.min = '0';
        incentiveInput.step = '0.1';
        incentiveInput.value = member.incentive ?? 0;
        incentiveInput.classList.add('distribution-input');
        incentiveInput.addEventListener('change', () => {
          member.incentive = Math.max(0, toNumber(incentiveInput.value, 0));
          updateTotals();
        });
        incentiveCell.appendChild(incentiveInput);
      }

      finalCell.textContent = formatCurrency(finalAmounts[i] ?? 0);
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
  const totalIncentiveLabel = document.getElementById('total-incentive');
  if (totalIncentiveLabel) {
    const totalIncentiveBonus = totalNet * 0.01;
    totalIncentiveLabel.textContent = formatCurrency(totalIncentives + totalIncentiveBonus);
  }

  applyReadOnlyState();
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
    deleteButton.dataset.lockable = 'true';
    deleteButton.addEventListener('click', () => deleteMember(member.id));
    if (isReadOnly) {
      deleteButton.disabled = true;
    }
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
    baseMembers = data.map((member) => {
      const previous = previousMembers.get(member.id);
      return {
        ...member,
        rate: previous ? previous.rate : 100,
        deduction: previous ? previous.deduction : 0,
        incentive: previous ? previous.incentive : 0,
      };
    });

    if (useBaseMembersForEditor || members.length === 0) {
      members = baseMembers.map((member) => ({ ...member }));
      if (currentView === 'editor') {
        updateTotals();
      }
    }
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
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nickname, job }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ message: '공대원 정보를 저장하지 못했습니다.' }));
      throw new Error(data.message || '공대원 정보를 저장하지 못했습니다.');
    }

    nicknameInput.value = '';
    jobInput.value = '';
    toggleMemberForm(false);
    await fetchMembers();
    updateTotals();
  } catch (error) {
    console.error(error);
    alert(error.message || '공대원을 추가하는 중 문제가 발생했습니다.');
  }
}

async function deleteMember(id) {
  if (!id) {
    return;
  }
  if (!confirm('해당 공대원을 삭제하시겠습니까?')) {
    return;
  }

  try {
    const response = await fetch(`/api/members/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 204) {
      const data = await response.json().catch(() => ({ message: '공대원 정보를 삭제하지 못했습니다.' }));
      throw new Error(data.message || '공대원 정보를 삭제하지 못했습니다.');
    }

    await fetchMembers();
    updateTotals();
  } catch (error) {
    console.error(error);
    alert(error.message || '공대원을 삭제하는 중 문제가 발생했습니다.');
  }
}

function toggleMemberForm(visible) {
  const form = document.getElementById('member-form');
  if (!form) {
    return;
  }
  if (visible) {
    form.classList.remove('hidden');
  } else {
    form.classList.add('hidden');
  }
}

function applyReadOnlyState() {
  const editorPage = document.getElementById('editor-page');
  if (!editorPage) {
    return;
  }

  editorPage.querySelectorAll('input, select').forEach((element) => {
    if (element.hasAttribute('data-lockable')) {
      element.disabled = isReadOnly;
    } else if (element.dataset.saleField === 'true') {
      if (element.classList.contains('net-amount')) {
        element.disabled = false;
      } else {
        element.disabled = isReadOnly;
      }
    } else if (element.closest('.modal-content')) {
      element.disabled = false;
    } else if (element.classList.contains('net-amount')) {
      element.disabled = false;
    } else {
      element.disabled = isReadOnly;
    }
  });

  editorPage.querySelectorAll('button[data-lockable="true"]').forEach((button) => {
    button.disabled = isReadOnly;
  });
}

function setReadOnly(readOnly) {
  isReadOnly = readOnly;
  applyReadOnlyState();
  applySaleTablesReadOnlyState();
  updateNavState();
}

function prepareNewDistribution() {
  useBaseMembersForEditor = true;
  currentDistributionId = null;
  setReadOnly(false);
  members = baseMembers.map((member) => ({ ...member }));

  populateSaleTable('drop-table', dropSaleOptions, [], 3);
  populateSaleTable(
    'guest-table',
    guestSaleOptions,
    guestDefaultItems.map((item) => ({ item })),
    guestDefaultItems.length,
  );

  setPageTitle(generateDefaultTitle());
  updateTotals();
  showEditorView(false);
}

function populateFromDistributionData(payload = {}) {
  const dropData = Array.isArray(payload.dropSales) ? payload.dropSales : [];
  const guestData = Array.isArray(payload.guestSales) ? payload.guestSales : [];
  const savedMembers = Array.isArray(payload.members) ? payload.members : [];

  members = savedMembers.map((member) => ({
    ...member,
    rate: member.rate ?? 100,
    deduction: member.deduction ?? 0,
    incentive: member.incentive ?? 0,
  }));

  populateSaleTable('drop-table', dropSaleOptions, dropData, 3);
  populateSaleTable('guest-table', guestSaleOptions, guestData, guestDefaultItems.length);
  updateTotals();
}

function showListView() {
  currentView = 'list';
  const listPage = document.getElementById('list-page');
  const editorPage = document.getElementById('editor-page');
  if (listPage) {
    listPage.classList.remove('hidden');
  }
  if (editorPage) {
    editorPage.classList.add('hidden');
  }
  setPageTitle(currentTitle);
  updateNavState();
}

function showEditorView(readOnly = false) {
  currentView = 'editor';
  const listPage = document.getElementById('list-page');
  const editorPage = document.getElementById('editor-page');
  if (listPage) {
    listPage.classList.add('hidden');
  }
  if (editorPage) {
    editorPage.classList.remove('hidden');
  }
  setReadOnly(readOnly);
  setPageTitle(currentTitle || generateDefaultTitle());
  updateTotals();
}

function updateNavState() {
  const navList = document.getElementById('nav-list');

  if (navList) {
    navList.disabled = currentView === 'list';
  }
}

async function loadDistributionList() {
  try {
    const response = await fetch('/api/distributions');
    if (!response.ok) {
      throw new Error('분배표 목록을 불러오지 못했습니다.');
    }
    const data = await response.json();
    renderDistributionList(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error(error);
    alert(error.message || '분배표 목록을 불러오는 중 문제가 발생했습니다.');
  }
}

function renderDistributionList(distributions) {
  const tableBody = document.getElementById('distribution-list-body');
  if (!tableBody) {
    return;
  }
  tableBody.innerHTML = '';

  if (distributions.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 4;
    emptyCell.classList.add('empty');
    emptyCell.textContent = '저장된 분배표가 없습니다.';
    emptyRow.appendChild(emptyCell);
    tableBody.appendChild(emptyRow);
    return;
  }

  distributions.forEach((distribution) => {
    const row = document.createElement('tr');

    const titleCell = document.createElement('td');
    titleCell.textContent = distribution.title;

    const createdCell = document.createElement('td');
    createdCell.textContent = formatDateTime(distribution.created_at);

    const updatedCell = document.createElement('td');
    updatedCell.textContent = formatDateTime(distribution.updated_at);

    const actionCell = document.createElement('td');
    const viewButton = document.createElement('button');
    viewButton.textContent = '보기';
    viewButton.classList.add('secondary');
    viewButton.addEventListener('click', () => openDistribution(distribution.id, true));

    const editButton = document.createElement('button');
    editButton.textContent = '수정';
    editButton.classList.add('primary');
    editButton.addEventListener('click', () => openDistribution(distribution.id, false));

    actionCell.appendChild(viewButton);
    actionCell.appendChild(editButton);

    row.appendChild(titleCell);
    row.appendChild(createdCell);
    row.appendChild(updatedCell);
    row.appendChild(actionCell);

    tableBody.appendChild(row);
  });
}

async function openDistribution(id, readOnly) {
  try {
    const response = await fetch(`/api/distributions/${id}`);
    if (!response.ok) {
      throw new Error('분배표를 불러오지 못했습니다.');
    }
    const data = await response.json();
    currentDistributionId = data.id;
    currentTitle = data.title;
    useBaseMembersForEditor = false;
    setReadOnly(readOnly);
    populateFromDistributionData(data.data);
    showEditorView(readOnly);
    setPageTitle(currentTitle);
    updateNavState();
  } catch (error) {
    console.error(error);
    alert(error.message || '분배표를 불러오는 중 문제가 발생했습니다.');
  }
}

function toggleSaveModal(visible) {
  const backdrop = document.getElementById('modal-backdrop');
  const modal = document.getElementById('save-modal');
  const titleInput = document.getElementById('save-title-input');
  if (!backdrop || !modal || !titleInput) {
    return;
  }

  if (visible) {
    titleInput.value = currentTitle || generateDefaultTitle();
    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');
    titleInput.focus();
  } else {
    backdrop.classList.add('hidden');
    modal.classList.add('hidden');
  }
}

function collectDistributionPayload() {
  const totalNet = getTotalNet();
  const distributionData = calculateDistribution(totalNet);
  const incentiveBonus = totalNet * 0.01;
  const totalIncentive = distributionData.totalIncentives + incentiveBonus;
  const totalDistribution = totalNet - totalIncentive;

  return {
    dropSales: getSaleTableData('drop-table', dropSaleOptions),
    guestSales: getSaleTableData('guest-table', guestSaleOptions),
    members: members.map((member, index) => ({
      ...member,
      finalAmount: distributionData.finalAmounts[index] ?? 0,
    })),
    totals: {
      totalNet,
      incentiveBonus,
      totalIncentives: distributionData.totalIncentives,
      totalIncentiveWithBonus: totalIncentive,
      totalDistribution,
      memberCount: members.length,
      baseShare: distributionData.baseShare,
    },
  };
}

async function handleSaveDistribution() {
  const titleInput = document.getElementById('save-title-input');
  if (!titleInput) {
    return;
  }

  const title = titleInput.value.trim();
  if (!title) {
    alert('제목을 입력해주세요.');
    return;
  }

  const payload = collectDistributionPayload();

  try {
    const response = await fetch(currentDistributionId ? `/api/distributions/${currentDistributionId}` : '/api/distributions', {
      method: currentDistributionId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, data: payload }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ message: '분배표를 저장하지 못했습니다.' }));
      throw new Error(data.message || '분배표를 저장하지 못했습니다.');
    }

    const saved = await response.json();
    currentDistributionId = saved.id;
    currentTitle = saved.title;
    setPageTitle(currentTitle);
    toggleSaveModal(false);
    alert('분배표가 저장되었습니다.');
    await loadDistributionList();
    updateNavState();
  } catch (error) {
    console.error(error);
    alert(error.message || '분배표를 저장하는 중 문제가 발생했습니다.');
  }
}

function initTables() {
  populateSaleTable('drop-table', dropSaleOptions, [], 3);
  populateSaleTable(
    'guest-table',
    guestSaleOptions,
    guestDefaultItems.map((item) => ({ item })),
    guestDefaultItems.length,
  );

  const addDropButton = document.getElementById('add-drop-row');
  if (addDropButton) {
    addDropButton.addEventListener('click', () => {
      const dropTableBody = document.querySelector('#drop-table tbody');
      if (dropTableBody) {
        createTableRow(dropTableBody, dropSaleOptions, {});
        applySaleTablesReadOnlyState();
      }
    });
  }

  const addGuestButton = document.getElementById('add-guest-row');
  if (addGuestButton) {
    addGuestButton.addEventListener('click', () => {
      const guestTableBody = document.querySelector('#guest-table tbody');
      if (guestTableBody) {
        createTableRow(guestTableBody, guestSaleOptions, {});
        applySaleTablesReadOnlyState();
      }
    });
  }
}

function initMemberControls() {
  const addMemberButton = document.getElementById('add-member-btn');
  if (addMemberButton) {
    addMemberButton.addEventListener('click', () => toggleMemberForm(true));
  }
  const cancelMemberButton = document.getElementById('cancel-member');
  if (cancelMemberButton) {
    cancelMemberButton.addEventListener('click', () => toggleMemberForm(false));
  }
  const saveMemberButton = document.getElementById('save-member');
  if (saveMemberButton) {
    saveMemberButton.addEventListener('click', (event) => {
      event.preventDefault();
      saveMember();
    });
  }
  const manageMembersButton = document.getElementById('manage-members-btn');
  if (manageMembersButton) {
    manageMembersButton.addEventListener('click', () => {
      updateMemberManagement();
      toggleMemberManagement(true);
    });
  }
  const closeManagementButton = document.getElementById('close-management');
  if (closeManagementButton) {
    closeManagementButton.addEventListener('click', () => toggleMemberManagement(false));
  }

  const navListButton = document.getElementById('nav-list');
  if (navListButton) {
    navListButton.addEventListener('click', () => {
      toggleSaveModal(false);
      showListView();
    });
  }

  const listCreateButton = document.getElementById('list-create');
  if (listCreateButton) {
    listCreateButton.addEventListener('click', () => {
      prepareNewDistribution();
    });
  }

  const refreshDistributionsButton = document.getElementById('refresh-distributions');
  if (refreshDistributionsButton) {
    refreshDistributionsButton.addEventListener('click', () => {
      loadDistributionList();
    });
  }

  const openSaveModalButton = document.getElementById('open-save-modal');
  if (openSaveModalButton) {
    openSaveModalButton.addEventListener('click', () => {
      if (isReadOnly) {
        return;
      }
      toggleSaveModal(true);
    });
  }

  const cancelSaveButton = document.getElementById('cancel-save');
  if (cancelSaveButton) {
    cancelSaveButton.addEventListener('click', () => {
      toggleSaveModal(false);
    });
  }

  const confirmSaveButton = document.getElementById('confirm-save');
  if (confirmSaveButton) {
    confirmSaveButton.addEventListener('click', () => {
      handleSaveDistribution();
    });
  }

  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', () => toggleSaveModal(false));
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  currentTitle = generateDefaultTitle();
  initTables();
  initMemberControls();
  await fetchMembers();
  await loadDistributionList();
  showListView();
  updateTotals();
  setPageTitle(currentTitle);
  updateNavState();
});
