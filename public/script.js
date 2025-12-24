const dropSaleOptions = [
  { label: '노수작', type: 'nosujak' },
  { label: '499수작', multiplier: 1 - 0.018, type: 'fixed' },
  { label: '999수작', multiplier: 1 - 0.03, type: 'fixed' },
  { label: '2499수작', multiplier: 1 - 0.04, type: 'fixed' },
  { label: '택배', type: 'delivery' },
  { label: '상점판매', multiplier: 1, type: 'fixed' },
  { label: '직접입력', type: 'manual' },
];

const guestSaleOptions = [
  { label: '499수작', multiplier: 1 - 0.018, type: 'fixed' },
  { label: '999수작', multiplier: 1 - 0.03, type: 'fixed' },
  { label: '2499수작', multiplier: 1 - 0.04, type: 'fixed' },
  { label: '직접입력', type: 'manual' },
];

const guestDefaultItems = ['목걸이 1', '목걸이 2'];
const DEFAULT_SALE_ROWS = 2;

let members = [];
let baseMembers = [];
let isReadOnly = false;
let currentDistributionId = null;
let currentTitle = '';
let currentView = 'list';
let useBaseMembersForEditor = true;
let expenses = [];

const DEFAULT_EXPENSE_ROWS = 2;
const managedModalIds = ['member-modal', 'expense-modal', 'payment-input-modal'];

let saveFeedbackTimeout = null;
let paymentModalMemberIndex = null;

const LOGIN_PAGE_PATH = '/login.html';

function buildLoginRedirectPath() {
  const path = window.location.pathname || '/distribution.html';
  const search = window.location.search || '';
  return `${path}${search}`;
}

function redirectToLogin() {
  const redirectTarget = encodeURIComponent(buildLoginRedirectPath());
  window.location.href = `${LOGIN_PAGE_PATH}?redirect=${redirectTarget}`;
}

async function fetchWithAuth(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    redirectToLogin();
    throw new Error('UNAUTHORIZED');
  }
  return response;
}

async function ensureAuthenticated() {
  try {
    const response = await fetch('/api/session');
    if (!response.ok) {
      redirectToLogin();
      return false;
    }
    const data = await response.json();
    if (!data?.authenticated) {
      redirectToLogin();
      return false;
    }
    return true;
  } catch (error) {
    redirectToLogin();
    return false;
  }
}

function initAuthControls() {
  const logoutButton = document.getElementById('logout-button');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      try {
        const response = await fetch('/api/logout', { method: 'POST' });
        if (response.ok || response.status === 401) {
          window.location.href = '/';
          return;
        }
      } catch (error) {
        console.error('로그아웃 중 오류가 발생했습니다.', error);
      }
      window.location.href = LOGIN_PAGE_PATH;
    });
  }
}

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

function normalizeDisplayOrder(value, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function sanitizeNumericInput(value, maxDigits = 7) {
  if (value === undefined || value === null) {
    return '';
  }
  const raw = String(value);
  let digitCount = 0;
  let hasDecimal = false;
  let result = '';

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char >= '0' && char <= '9') {
      if (digitCount >= maxDigits) {
        continue;
      }
      result += char;
      digitCount += 1;
    } else if (char === '.' && !hasDecimal) {
      hasDecimal = true;
      if (digitCount === 0) {
        result += '0';
      }
      result += '.';
    }
  }

  return result.endsWith('.') ? result.slice(0, -1) : result;
}

function enforcePriceInputLength(input) {
  if (!input) {
    return '';
  }
  const sanitized = sanitizeNumericInput(input.value, 7);
  if (input.value !== sanitized) {
    input.value = sanitized;
  }
  return sanitized;
}

function formatSalePriceDisplay(units) {
  const numericUnits = Math.max(0, toNumber(units, 0));
  if (!Number.isFinite(numericUnits) || numericUnits === 0) {
    return '0만';
  }

  const amount = Math.floor(numericUnits * 10000);
  if (amount === 0) {
    return '0만';
  }

  const hundredMillion = Math.floor(amount / 100000000);
  const remainderAmount = amount % 100000000;

  if (hundredMillion === 0) {
    const remainderUnits = remainderAmount / 10000;
    const formattedUnits = remainderUnits.toLocaleString('ko-KR', {
      minimumFractionDigits: remainderUnits % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    });
    return `${formattedUnits}만`;
  }

  const parts = [`${hundredMillion.toLocaleString('ko-KR')}억`];
  if (remainderAmount > 0) {
    const remainderUnits = remainderAmount / 10000;
    const formattedRemainder = remainderUnits.toLocaleString('ko-KR', {
      minimumFractionDigits: remainderUnits % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    });
    parts.push(`${formattedRemainder}만`);
  }

  return parts.join(' ');
}

function calculateNosujakNet(price) {
  const amount = Number(price) || 0;
  if (amount < 1_000_000) {
    return amount * 0.992;
  }
  if (amount < 5_000_000) {
    return amount * 0.982;
  }
  if (amount < 10_000_000) {
    return amount * 0.97;
  }
  if (amount < 25_000_000) {
    return amount * 0.96;
  }
  if (amount < 100_000_000) {
    return amount * 0.95;
  }
  return amount * 0.94;
}

function calculateDeliveryNet(price) {
  const amount = Math.max(0, Number(price) || 0);
  if (amount >= 100_000_000) {
    return amount * 0.93;
  }
  if (amount >= 25_000_000) {
    return amount * 0.94;
  }
  if (amount >= 10_000_000) {
    return amount * 0.95;
  }
  if (amount >= 5_000_000) {
    return amount * 0.96;
  }
  if (amount >= 1_000_000) {
    return amount * 0.973;
  }
  if (amount >= 100_000) {
    return amount * 0.988;
  }
  return amount;
}

function updateBackdropVisibility() {
  const backdrop = document.getElementById('modal-backdrop');
  if (!backdrop) {
    return;
  }
  const anyOpen = managedModalIds.some((modalId) => {
    const modal = document.getElementById(modalId);
    return modal && !modal.classList.contains('hidden');
  });
  if (anyOpen) {
    backdrop.classList.remove('hidden');
  } else {
    backdrop.classList.add('hidden');
  }
}

function sortBaseMembers() {
  baseMembers = baseMembers
    .map((member, index) => ({
      ...member,
      displayOrder: normalizeDisplayOrder(member.displayOrder ?? member.order, index + 1),
    }))
    .sort((a, b) => {
      const orderA = normalizeDisplayOrder(a.displayOrder, Number.MAX_SAFE_INTEGER);
      const orderB = normalizeDisplayOrder(b.displayOrder, Number.MAX_SAFE_INTEGER);
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      if (a.id !== undefined && b.id !== undefined) {
        return a.id - b.id;
      }
      return 0;
    });
}

function syncMembersWithBaseOrder() {
  if (!Array.isArray(members) || members.length === 0) {
    return;
  }
  const orderMap = new Map();
  baseMembers.forEach((member, index) => {
    const orderValue = normalizeDisplayOrder(member.displayOrder, index + 1);
    orderMap.set(member.id, { order: orderValue, index });
  });

  members.sort((a, b) => {
    const infoA = orderMap.get(a.id);
    const infoB = orderMap.get(b.id);
    if (infoA && infoB) {
      if (infoA.order !== infoB.order) {
        return infoA.order - infoB.order;
      }
      if (a.id !== undefined && b.id !== undefined) {
        return a.id - b.id;
      }
      return 0;
    }
    if (infoA) {
      return -1;
    }
    if (infoB) {
      return 1;
    }
    return 0;
  });
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

  const inlineTitleInput = document.getElementById('save-title-inline');
  if (inlineTitleInput && currentView === 'editor') {
    inlineTitleInput.value = title || generateDefaultTitle();
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
    priceInput.value = sanitizeNumericInput(String(initialPriceUnits), 7);
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
    if (option.multiplier !== undefined) {
      optionElement.dataset.multiplier = option.multiplier;
    }
    optionElement.dataset.type = option.type || 'fixed';
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
  const initialNet = rowData.net !== undefined ? Math.max(0, Math.floor(toNumber(rowData.net, 0))) : 0;
  netInput.value = initialNet > 0 ? formatCurrency(initialNet) : '0';
  netInput.dataset.value = String(initialNet);
  const netDisplay = document.createElement('span');
  netDisplay.className = 'sale-field-display sale-net-display';
  netCell.appendChild(netInput);
  netCell.appendChild(netDisplay);

  const manualState = { handler: null };

  function enableManualMode() {
    priceInput.disabled = true;
    const numericValue = Math.max(0, Math.floor(toNumber(netInput.dataset.value, 0)));
    if (isReadOnly) {
      netInput.readOnly = true;
      netInput.disabled = true;
      netInput.value = formatCurrency(numericValue);
    } else {
      netInput.readOnly = false;
      netInput.disabled = false;
      netInput.value = numericValue > 0 ? String(numericValue) : '';
    }
    if (!manualState.handler) {
      manualState.handler = () => {
        if (isReadOnly) {
          return;
        }
        const sanitized = netInput.value.replace(/[^0-9]/g, '');
        netInput.value = sanitized;
        const numeric = Math.max(0, Math.floor(toNumber(sanitized, 0)));
        netInput.dataset.value = String(numeric);
        syncSaleRowDisplay(row);
        updateTotals();
      };
    }
    netInput.removeEventListener('input', manualState.handler);
    netInput.addEventListener('input', manualState.handler);
  }

  function disableManualMode() {
    priceInput.disabled = isReadOnly;
    netInput.removeEventListener('input', manualState.handler);
    netInput.readOnly = true;
    netInput.disabled = false;
  }

  function updateRowValues() {
    const selectedOption = methodSelect.selectedOptions[0];
    const optionType = selectedOption?.dataset.type || 'fixed';
    const priceUnits = parseFloat(priceInput.value) || 0;
    const price = priceUnits * 10000;

    if (optionType === 'manual') {
      enableManualMode();
      const numericValue = Math.max(0, Math.floor(toNumber(netInput.dataset.value, 0)));
      if (isReadOnly) {
        netInput.value = formatCurrency(numericValue);
      } else if (!netInput.value && numericValue > 0) {
        netInput.value = String(numericValue);
      }
      syncSaleRowDisplay(row);
      updateTotals();
      return;
    }

    disableManualMode();

    let netValue = 0;
    if (optionType === 'nosujak') {
      netValue = calculateNosujakNet(price);
    } else if (optionType === 'delivery') {
      netValue = calculateDeliveryNet(price);
    } else {
      const multiplier = parseFloat(selectedOption?.dataset.multiplier) || 0;
      netValue = price * multiplier;
    }
    const safeNet = Math.max(0, Math.floor(netValue));
    netInput.dataset.value = String(safeNet);
    netInput.value = formatCurrency(safeNet);
    syncSaleRowDisplay(row);
    updateTotals();
  }

  itemInput.addEventListener('input', () => {
    syncSaleRowDisplay(row);
  });
  priceInput.addEventListener('input', () => {
    enforcePriceInputLength(priceInput);
    updateRowValues();
  });
  methodSelect.addEventListener('change', () => {
    updateRowValues();
  });

  row.appendChild(itemCell);
  row.appendChild(priceCell);
  row.appendChild(methodCell);
  row.appendChild(netCell);

  row.updateRowValues = updateRowValues;
  tableBody.appendChild(row);
  row.classList.toggle('sale-row-readonly', isReadOnly);
  updateRowValues();
}

function syncSaleRowDisplay(row) {
  if (!row) {
    return;
  }
  const isReadonlyRow = row.classList.contains('sale-row-readonly');
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
    priceDisplay.textContent = isReadonlyRow && units === 0 ? '-' : formatSalePriceDisplay(units);
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
    netDisplay.textContent = isReadonlyRow && netValue === 0 ? '-' : formatCurrency(netValue);
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
      if (typeof row.updateRowValues === 'function') {
        row.updateRowValues();
      } else {
        syncSaleRowDisplay(row);
      }
      row.querySelectorAll('.sale-field-input').forEach((element) => {
        if (element instanceof HTMLSelectElement) {
          element.disabled = isReadOnly;
        } else if (element instanceof HTMLInputElement && !element.classList.contains('net-amount')) {
          element.disabled = isReadOnly;
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
    const selectedOption = saleOptions.find((option) => option.label === method) || saleOptions[0];
    const methodType = methodSelect?.selectedOptions[0]?.dataset.type || selectedOption.type || 'fixed';
    const priceUnits = priceInput ? toNumber(priceInput.value, 0) : 0;
    const price = priceUnits * 10000;
    let multiplier = selectedOption.multiplier ?? null;
    let net = 0;

    if (methodType === 'manual') {
      net = netInput ? Math.max(0, Math.floor(toNumber(netInput.dataset.value, 0))) : 0;
      multiplier = null;
    } else if (methodType === 'nosujak') {
      net = calculateNosujakNet(price);
      multiplier = null;
    } else {
      multiplier = toNumber(multiplier, 0);
      net = price * multiplier;
    }

    return {
      item: itemInput ? itemInput.value : '',
      price,
      priceUnits,
      method,
      methodType,
      multiplier,
      net,
    };
  });
}

function normalizeExpenseRow(row = {}) {
  const description = typeof row.description === 'string' ? row.description : '';
  let amountUnits = 0;
  if (row.amountUnits !== undefined) {
    amountUnits = toNumber(row.amountUnits, 0);
  } else if (row.amount !== undefined) {
    amountUnits = toNumber(row.amount, 0) / 10000;
  }
  return { description, amountUnits };
}

function setExpenses(newExpenses = []) {
  if (Array.isArray(newExpenses) && newExpenses.length > 0) {
    expenses = newExpenses.map((row) => normalizeExpenseRow(row));
  } else {
    expenses = Array.from({ length: DEFAULT_EXPENSE_ROWS }, () => normalizeExpenseRow());
  }
}

function getTotalExpenses() {
  return expenses.reduce((sum, expense) => {
    const amountUnits = Math.max(0, toNumber(expense.amountUnits, 0));
    const amount = Math.floor(amountUnits * 10000);
    return sum + amount;
  }, 0);
}

function renderExpenseRows() {
  const tableBody = document.getElementById('expense-table-body');
  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';

  expenses.forEach((expense, index) => {
    const row = document.createElement('tr');

    const descriptionCell = document.createElement('td');
    const descriptionInput = document.createElement('input');
    descriptionInput.type = 'text';
    descriptionInput.value = expense.description;
    descriptionInput.placeholder = '내용';
    if (isReadOnly) {
      descriptionInput.disabled = true;
    }
    descriptionInput.addEventListener('input', () => {
      expenses[index].description = descriptionInput.value;
    });
    descriptionCell.appendChild(descriptionInput);

    const amountCell = document.createElement('td');
    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.min = '0';
    amountInput.step = '0.1';
    amountInput.value = expense.amountUnits ? String(expense.amountUnits) : '';
    if (isReadOnly) {
      amountInput.disabled = true;
    }
    amountInput.addEventListener('input', () => {
      expenses[index].amountUnits = Math.max(0, toNumber(amountInput.value, 0));
      updateTotals();
    });
    amountCell.appendChild(amountInput);

    row.appendChild(descriptionCell);
    row.appendChild(amountCell);
    tableBody.appendChild(row);
  });

  const addButton = document.getElementById('add-expense-row');
  if (addButton) {
    addButton.disabled = isReadOnly;
  }
}

function openExpenseModal() {
  const modal = document.getElementById('expense-modal');
  if (!modal) {
    return;
  }
  renderExpenseRows();
  modal.classList.remove('hidden');
  updateBackdropVisibility();
}

function closeExpenseModal() {
  const modal = document.getElementById('expense-modal');
  if (!modal) {
    return;
  }
  modal.classList.add('hidden');
  updateBackdropVisibility();
}

function openPaymentInputModal(memberIndex) {
  const modal = document.getElementById('payment-input-modal');
  const input = document.getElementById('payment-input-value');
  if (!modal || !input) {
    return;
  }
  paymentModalMemberIndex = memberIndex;
  input.value = '';
  modal.classList.remove('hidden');
  updateBackdropVisibility();
  input.focus();
}

function closePaymentInputModal() {
  const modal = document.getElementById('payment-input-modal');
  if (!modal) {
    return;
  }
  paymentModalMemberIndex = null;
  modal.classList.add('hidden');
  updateBackdropVisibility();
}

function handlePaymentInputConfirm() {
  const modal = document.getElementById('payment-input-modal');
  const input = document.getElementById('payment-input-value');
  if (!modal || !input) {
    return;
  }
  if (paymentModalMemberIndex === null || paymentModalMemberIndex < 0 || paymentModalMemberIndex >= members.length) {
    closePaymentInputModal();
    return;
  }
  const increment = Math.max(0, Math.floor(toNumber(input.value, 0)));
  if (increment > 0) {
    const member = members[paymentModalMemberIndex];
    const currentPayment = Math.max(0, Math.floor(toNumber(member.paymentAmount, 0)));
    member.paymentAmount = currentPayment + increment;
  }
  closePaymentInputModal();
  updateTotals();
}

function addExpenseRow() {
  expenses.push(normalizeExpenseRow());
  renderExpenseRows();
}

function getTableNetSum(tableId) {
  const table = document.getElementById(tableId);
  if (!table) {
    return 0;
  }
  return Array.from(table.querySelectorAll('.net-amount')).reduce((sum, input) => {
    const value = Math.max(0, toNumber(input.dataset.value, 0));
    return sum + value;
  }, 0);
}

function getTotalNet() {
  return ['drop-table', 'guest-table'].reduce((sum, tableId) => sum + getTableNetSum(tableId), 0);
}

function getValidMembers() {
  return members.filter((member) => {
    if (!member || typeof member !== 'object') {
      return false;
    }
    const nickname = typeof member.nickname === 'string' ? member.nickname.trim() : '';
    const job = typeof member.job === 'string' ? member.job.trim() : '';
    if (nickname || job) {
      return true;
    }
    return member.id !== undefined && member.id !== null;
  });
}

function calculateDistribution(totalNet, totalExpense = getTotalExpenses(), additionalIncentive = 0) {
  const memberCount = members.length;
  const shareAmounts = new Array(memberCount).fill(0);
  const finalAmounts = new Array(memberCount).fill(0);
  const participatingIndexes = members
    .map((member, index) => (member.participating === false ? null : index))
    .filter((index) => index !== null);
  const participantCount = participatingIndexes.length;

  const incentiveAmounts = members.map((member) => Math.max(0, toNumber(member.incentive, 0) * 10000));

  const totalIncentives = incentiveAmounts.reduce((sum, amount) => sum + amount, 0);
  const extraIncentive = Math.max(0, Math.floor(additionalIncentive));
  const combinedIncentives = totalIncentives + extraIncentive;
  const distributable = totalNet - combinedIncentives - totalExpense;

  const weights = participatingIndexes.map((index) => {
    const rate = Math.max(0, toNumber(members[index].rate, 100));
    return rate / 100;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const unitAmount = totalWeight > 0 ? distributable / totalWeight : 0;

  participatingIndexes.forEach((index, order) => {
    const share = unitAmount * weights[order];
    shareAmounts[index] = share;
    finalAmounts[index] = share;
  });

  participatingIndexes.forEach((index) => {
    const deductionAmount = Math.max(0, toNumber(members[index].deduction, 0) * 10000);
    if (deductionAmount === 0) {
      return;
    }

    finalAmounts[index] -= deductionAmount;

    const recipients = participatingIndexes.filter((otherIndex) => otherIndex !== index);
    if (recipients.length > 0) {
      const perRecipient = deductionAmount / recipients.length;
      recipients.forEach((otherIndex) => {
        finalAmounts[otherIndex] += perRecipient;
      });
    }
  });

  incentiveAmounts.forEach((amount, index) => {
    finalAmounts[index] += amount;
  });

  return {
    unitAmount,
    shareAmounts,
    finalAmounts,
    totalIncentives: combinedIncentives,
    participantCount,
    totalExpense,
    totalWeight,
  };
}

function updateTotals(distributionData = null) {
  const total = getTotalNet();
  const totalExpense = getTotalExpenses();
  const dropNetTotal = getTableNetSum('drop-table');
  const dropIncentive = Math.floor(dropNetTotal * 0.01);
  const calculated = distributionData || calculateDistribution(total, totalExpense, dropIncentive);
  const totalIncentiveValue = calculated.totalIncentives;
  const totalDistribution = total - totalIncentiveValue - totalExpense;

  const totalLabel = document.getElementById('total-net');
  if (totalLabel) {
    totalLabel.textContent = formatCurrency(total);
  }

  const totalIncentiveLabel = document.getElementById('total-incentive');
  if (totalIncentiveLabel) {
    totalIncentiveLabel.textContent = formatCurrency(totalIncentiveValue);
  }

  const totalExpenseLabel = document.getElementById('total-expense');
  if (totalExpenseLabel) {
    totalExpenseLabel.textContent = formatCurrency(totalExpense);
  }

  const expenseSumLabel = document.getElementById('expense-sum');
  if (expenseSumLabel) {
    expenseSumLabel.textContent = formatCurrency(totalExpense);
  }

  const totalDistributionLabel = document.getElementById('total-distribution');
  if (totalDistributionLabel) {
    totalDistributionLabel.textContent = formatCurrency(totalDistribution);
  }

  updateDistributionTable(total, calculated);
}

function createRateControls(member, rateCell, rateValue) {
  const effectiveRate = member.participating === false ? 0 : rateValue;
  if (isReadOnly) {
    rateCell.textContent = `${Number(effectiveRate).toLocaleString('ko-KR')}%`;
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.classList.add('input-with-controls');

  const rateInput = document.createElement('input');
  rateInput.type = 'number';
  rateInput.min = '0';
  rateInput.step = '1';
  rateInput.value = effectiveRate;
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

  if (isReadOnly || member.participating === false) {
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

  const distributionTable = document.getElementById('distribution-table');
  if (distributionTable) {
    distributionTable.classList.toggle('hide-action-column', isReadOnly);
  }
  tableBody.innerHTML = '';

  const memberCount = members.length;
  const memberCountLabel = document.getElementById('member-count');
  const dropNetTotal = getTableNetSum('drop-table');
  const dropIncentive = Math.floor(dropNetTotal * 0.01);
  const calculated = distributionData || calculateDistribution(totalNet, getTotalExpenses(), dropIncentive);
  if (memberCountLabel) {
    const validMembers = getValidMembers();
    const participatingCount = validMembers.filter((member) => member.participating !== false).length;
    const inactiveCount = Math.max(0, validMembers.length - participatingCount);
    memberCountLabel.textContent = `${participatingCount} + ${inactiveCount}`;
  }

  const { shareAmounts, finalAmounts, participantCount } = calculated;
  const rowsToRender = Math.max(20, memberCount);

  for (let i = 0; i < rowsToRender; i += 1) {
    const row = document.createElement('tr');

    const actionCell = document.createElement('td');
    actionCell.classList.add('action-column');
    const nicknameCell = document.createElement('td');
    const jobCell = document.createElement('td');
    const participantCell = document.createElement('td');
    participantCell.classList.add('checkbox-cell');
    const shareCell = document.createElement('td');
    const rateCell = document.createElement('td');
    const deductionCell = document.createElement('td');
    const incentiveCell = document.createElement('td');
    const finalCell = document.createElement('td');
    const paymentCell = document.createElement('td');
    const remainingCell = document.createElement('td');
    remainingCell.classList.add('numeric-cell');
    const paidCell = document.createElement('td');
    paidCell.classList.add('checkbox-cell');

    if (i < memberCount) {
      const member = members[i];
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = '⛔';
      removeButton.classList.add('icon-button', 'danger-text');
      removeButton.disabled = isReadOnly;
      removeButton.addEventListener('click', () => {
        if (isReadOnly) {
          return;
        }
        members.splice(i, 1);
        useBaseMembersForEditor = false;
        updateTotals();
      });
      actionCell.appendChild(removeButton);

      nicknameCell.textContent = member.nickname;
      jobCell.textContent = member.job;

      const participantCheckbox = document.createElement('input');
      participantCheckbox.type = 'checkbox';
      participantCheckbox.checked = member.participating !== false;
      participantCheckbox.disabled = isReadOnly;
      participantCheckbox.classList.add('distribution-checkbox');
      participantCheckbox.addEventListener('change', () => {
        const checked = participantCheckbox.checked;
        if (!checked) {
          member.previousRate = member.rate ?? 0;
          member.rate = 0;
        } else {
          member.participating = true;
          if (member.rate === 0) {
            if (Number.isFinite(member.previousRate) && member.previousRate > 0) {
              member.rate = member.previousRate;
            } else if (!Number.isFinite(member.previousRate)) {
              member.rate = 100;
            }
          }
          member.previousRate = undefined;
        }
        member.participating = checked;
        updateTotals();
      });
      participantCell.appendChild(participantCheckbox);

      const shareAmount = shareAmounts[i] ?? 0;
      if (member.participating === false || participantCount === 0) {
        shareCell.textContent = '-';
      } else {
        shareCell.textContent = formatCurrency(shareAmount);
      }

      if (member.participating === false) {
        member.rate = 0;
      }
      createRateControls(member, rateCell, member.rate ?? 100);

      if (isReadOnly) {
        const deductionValue = Math.max(0, Number(member.deduction ?? 0));
        const incentiveValue = Math.max(0, Number(member.incentive ?? 0));

        deductionCell.textContent = deductionValue === 0
          ? '-'
          : `${deductionValue.toLocaleString('ko-KR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })}만`;
        incentiveCell.textContent = incentiveValue === 0
          ? '-'
          : `${incentiveValue.toLocaleString('ko-KR', {
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

      const finalAmount = Math.max(0, Math.floor(finalAmounts[i] ?? 0));
      finalCell.textContent = formatCurrency(finalAmount);

      const paymentValueElement = document.createElement('span');
      const paymentAmount = Math.max(0, Math.floor(toNumber(member.paymentAmount, 0)));
      member.paymentAmount = paymentAmount;
      paymentValueElement.classList.add('payment-value');
      paymentCell.appendChild(paymentValueElement);

      const paidCheckbox = document.createElement('input');
      paidCheckbox.type = 'checkbox';
      paidCheckbox.checked = member.paid === true;
      paidCheckbox.disabled = false;
      paidCheckbox.dataset.alwaysEnabled = 'true';
      paidCheckbox.classList.add('distribution-checkbox');

      const remainingValueElement = document.createElement('span');
      remainingCell.appendChild(remainingValueElement);

      function updatePaymentAndRemainingDisplay() {
        const safePayment = Math.max(0, Math.floor(toNumber(member.paymentAmount, 0)));
        member.paymentAmount = safePayment;
        const calculatedRemaining = Math.floor(finalAmount - safePayment);
        member.remainingAmount = calculatedRemaining;

        if (member.paid) {
          paymentValueElement.textContent = '-';
          remainingValueElement.textContent = '-';
          return;
        }

        paymentValueElement.textContent = formatCurrency(safePayment);
        remainingValueElement.textContent = formatCurrency(calculatedRemaining);
      }

      const controlsWrapper = document.createElement('div');
      controlsWrapper.classList.add('payment-controls');
      controlsWrapper.appendChild(paidCheckbox);

      const quickAddButton = document.createElement('button');
      quickAddButton.type = 'button';
      quickAddButton.textContent = '499';
      quickAddButton.classList.add('mini-button', 'secondary');
      quickAddButton.dataset.lockable = 'true';
      quickAddButton.addEventListener('click', () => {
        if (isReadOnly) {
          return;
        }
        const currentPayment = Math.max(0, Math.floor(toNumber(member.paymentAmount, 0)));
        member.paymentAmount = currentPayment + 5_000_000;
        updatePaymentAndRemainingDisplay();
      });

      const manualButton = document.createElement('button');
      manualButton.type = 'button';
      manualButton.textContent = '직접입력';
      manualButton.classList.add('mini-button', 'secondary');
      manualButton.dataset.lockable = 'true';
      manualButton.addEventListener('click', () => {
        if (isReadOnly) {
          return;
        }
        openPaymentInputModal(i);
      });

      paidCheckbox.addEventListener('change', () => {
        member.paid = paidCheckbox.checked;
        updatePaymentAndRemainingDisplay();
      });

      controlsWrapper.appendChild(quickAddButton);
      controlsWrapper.appendChild(manualButton);
      paidCell.appendChild(controlsWrapper);
      updatePaymentAndRemainingDisplay();
    } else {
      nicknameCell.textContent = '';
      jobCell.textContent = '';
      participantCell.textContent = '';
      shareCell.textContent = '-';
      rateCell.textContent = '';
      deductionCell.textContent = '';
      incentiveCell.textContent = '';
      finalCell.textContent = '-';
      paymentCell.textContent = '';
      remainingCell.textContent = '-';
      paidCell.textContent = '';
    }

    row.appendChild(actionCell);
    row.appendChild(nicknameCell);
    row.appendChild(jobCell);
    row.appendChild(participantCell);
    row.appendChild(shareCell);
    row.appendChild(rateCell);
    row.appendChild(deductionCell);
    row.appendChild(incentiveCell);
    row.appendChild(finalCell);
    row.appendChild(paymentCell);
    row.appendChild(remainingCell);
    row.appendChild(paidCell);

    tableBody.appendChild(row);
  }

  applyReadOnlyState();
}

function renderMemberModal() {
  const tableBody = document.getElementById('member-management-body');
  if (!tableBody) {
    return;
  }

  sortBaseMembers();
  tableBody.innerHTML = '';

  if (baseMembers.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 6;
    emptyCell.textContent = '등록된 공대원이 없습니다.';
    emptyCell.style.textAlign = 'center';
    emptyRow.appendChild(emptyCell);
    tableBody.appendChild(emptyRow);
    const outstandingTotalLabel = document.getElementById('outstanding-total');
    if (outstandingTotalLabel) {
      outstandingTotalLabel.textContent = '0';
    }
    return;
  }

  let outstandingTotal = 0;

  baseMembers.forEach((member, index) => {
    const row = document.createElement('tr');

    const orderCell = document.createElement('td');
    orderCell.classList.add('order-cell');
    const orderButtons = document.createElement('div');
    orderButtons.classList.add('order-buttons');
    const moveUpButton = document.createElement('button');
    moveUpButton.type = 'button';
    moveUpButton.textContent = '🔺';
    moveUpButton.classList.add('order-button', 'secondary');
    const moveDownButton = document.createElement('button');
    moveDownButton.type = 'button';
    moveDownButton.textContent = '🔻';
    moveDownButton.classList.add('order-button', 'secondary');
    const orderValue = document.createElement('span');
    orderValue.classList.add('order-value');
    orderValue.textContent = normalizeDisplayOrder(member.displayOrder, index + 1);

    moveUpButton.addEventListener('click', () => handleMemberReorder(index, -1));
    moveDownButton.addEventListener('click', () => handleMemberReorder(index, 1));

    orderButtons.appendChild(moveUpButton);
    orderButtons.appendChild(moveDownButton);
    orderCell.appendChild(orderButtons);
    orderCell.appendChild(orderValue);

    const nicknameCell = document.createElement('td');
    nicknameCell.textContent = member.nickname;

    const jobCell = document.createElement('td');
    jobCell.textContent = member.job;

    const includedCell = document.createElement('td');
    const includedCheckbox = document.createElement('input');
    includedCheckbox.type = 'checkbox';
    includedCheckbox.checked = member.included !== false;
    includedCheckbox.addEventListener('change', async () => {
      const newValue = includedCheckbox.checked;
      try {
        await updateMemberIncluded(member.id, newValue);
      } catch (error) {
        console.error(error);
        includedCheckbox.checked = !newValue;
        alert(error.message || '분배 포함 여부를 변경하지 못했습니다.');
      }
    });
    includedCell.appendChild(includedCheckbox);

    const outstandingCell = document.createElement('td');
    const outstandingValue = Math.max(0, toNumber(member.outstandingAmount, 0));
    outstandingCell.textContent = formatCurrency(outstandingValue);
    outstandingTotal += outstandingValue;

    const actionCell = document.createElement('td');
    const deleteButton = document.createElement('button');
    deleteButton.textContent = '삭제';
    deleteButton.classList.add('danger');
    deleteButton.addEventListener('click', () => deleteMember(member.id));
    actionCell.appendChild(deleteButton);

    row.appendChild(orderCell);
    row.appendChild(nicknameCell);
    row.appendChild(jobCell);
    row.appendChild(includedCell);
    row.appendChild(outstandingCell);
    row.appendChild(actionCell);

    tableBody.appendChild(row);
  });

  const outstandingTotalLabel = document.getElementById('outstanding-total');
  if (outstandingTotalLabel) {
    outstandingTotalLabel.textContent = formatCurrency(outstandingTotal);
  }
}

function openMemberModal() {
  const modal = document.getElementById('member-modal');
  if (!modal) {
    return;
  }
  renderMemberModal();
  modal.classList.remove('hidden');
  updateBackdropVisibility();
}

function closeMemberModal() {
  const modal = document.getElementById('member-modal');
  if (!modal) {
    return;
  }
  modal.classList.add('hidden');
  updateBackdropVisibility();
}

async function reorderMembersOnServer(sourceId, targetId) {
  if (!sourceId || !targetId) {
    return;
  }
  const response = await fetchWithAuth('/api/members/reorder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sourceId, targetId }),
  });

  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ message: '순번을 변경하지 못했습니다.' }));
    throw new Error(data.message || '순번을 변경하지 못했습니다.');
  }
}

function handleMemberReorder(currentIndex, direction) {
  const targetIndex = currentIndex + direction;
  if (targetIndex < 0 || targetIndex >= baseMembers.length) {
    return;
  }

  const currentMember = baseMembers[currentIndex];
  const targetMember = baseMembers[targetIndex];
  if (!currentMember || !targetMember) {
    return;
  }

  const currentOrder = normalizeDisplayOrder(currentMember.displayOrder, currentIndex + 1);
  const targetOrder = normalizeDisplayOrder(targetMember.displayOrder, targetIndex + 1);

  [baseMembers[currentIndex], baseMembers[targetIndex]] = [targetMember, currentMember];
  baseMembers[currentIndex].displayOrder = currentOrder;
  baseMembers[targetIndex].displayOrder = targetOrder;

  syncMembersWithBaseOrder();
  updateTotals();
  renderMemberModal();

  reorderMembersOnServer(currentMember.id, targetMember.id).catch((error) => {
    console.error(error);
    alert(error.message || '순번을 변경하지 못했습니다.');
    [baseMembers[targetIndex], baseMembers[currentIndex]] = [targetMember, currentMember];
    baseMembers[currentIndex].displayOrder = currentOrder;
    baseMembers[targetIndex].displayOrder = targetOrder;
    syncMembersWithBaseOrder();
    updateTotals();
    renderMemberModal();
  });
}

async function updateMemberIncluded(memberId, included) {
  if (!memberId) {
    return;
  }
  try {
    const response = await fetchWithAuth(`/api/members/${memberId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ included }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ message: '분배 포함 여부를 변경하지 못했습니다.' }));
      throw new Error(data.message || '분배 포함 여부를 변경하지 못했습니다.');
    }

    await fetchMembers();
  } catch (error) {
    throw error;
  }
}

async function fetchMembers() {
  try {
    const response = await fetchWithAuth('/api/members');
    if (!response.ok) {
      throw new Error('공대원 목록을 불러오지 못했습니다.');
    }
    const data = await response.json();
    const previousMembers = new Map(members.map((member) => [member.id, member]));
    baseMembers = data.map((member, index) => {
      const included = member.included !== false;
      const outstandingAmount = Math.max(0, toNumber(member.outstandingAmount, 0));
      const displayOrder = normalizeDisplayOrder(member.displayOrder, index + 1);
      return {
        ...member,
        included,
        displayOrder,
        outstandingAmount,
      };
    });

    sortBaseMembers();

    if (useBaseMembersForEditor || members.length === 0) {
      members = baseMembers.map((member) => {
        const previous = previousMembers.get(member.id) || {};
        return {
          ...member,
        rate: previous.rate ?? 100,
        deduction: previous.deduction ?? 0,
        incentive: previous.incentive ?? 0,
        participating: previous.participating !== undefined
          ? previous.participating !== false
          : member.included !== false,
        paymentAmount: Math.max(0, toNumber(previous.paymentAmount, 0)),
        remainingAmount: Math.max(0, toNumber(previous.remainingAmount, 0)),
        paid: previous.paid === true,
      };
    });
      if (currentView === 'editor') {
        updateTotals();
      }
    }

    syncMembersWithBaseOrder();

    renderMemberModal();
  } catch (error) {
    console.error(error);
    alert('공대원 목록을 불러오는 중 문제가 발생했습니다.');
  }
}

async function saveMember(event = null) {
  if (event) {
    event.preventDefault();
  }
  const nicknameInput = document.getElementById('member-nickname-input');
  const jobInput = document.getElementById('member-job-input');

  if (!nicknameInput || !jobInput) {
    return;
  }

  const nickname = nicknameInput.value.trim();
  const job = jobInput.value.trim();

  if (!nickname || !job) {
    alert('닉네임과 직업을 모두 입력해주세요.');
    return;
  }

  try {
    const response = await fetchWithAuth('/api/members', {
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
    const response = await fetchWithAuth(`/api/members/${id}`, {
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

function applyReadOnlyState() {
  const editorPage = document.getElementById('editor-page');
  if (!editorPage) {
    return;
  }

  editorPage.querySelectorAll('input, select').forEach((element) => {
    if (element.dataset.alwaysEnabled === 'true') {
      return;
    }
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

  editorPage.querySelectorAll('[data-hide-when-readonly]').forEach((element) => {
    element.classList.toggle('hidden', isReadOnly);
  });
}

function updateEditModeButton() {
  const editModeButton = document.getElementById('enter-edit-mode');
  if (!editModeButton) {
    return;
  }
  const shouldShow = currentView === 'editor' && isReadOnly && currentDistributionId !== null;
  editModeButton.classList.toggle('hidden', !shouldShow);
}

function setReadOnly(readOnly) {
  isReadOnly = readOnly;
  applyReadOnlyState();
  applySaleTablesReadOnlyState();
  updateNavState();
  updateEditModeButton();
}

function prepareNewDistribution() {
  useBaseMembersForEditor = true;
  currentDistributionId = null;
  setReadOnly(false);
  members = baseMembers.map((member) => ({
    ...member,
    rate: member.rate ?? 100,
    deduction: member.deduction ?? 0,
    incentive: member.incentive ?? 0,
    participating: member.included !== false,
    paymentAmount: 0,
    remainingAmount: 0,
    paid: false,
  }));

  syncMembersWithBaseOrder();

  setExpenses([]);

  populateSaleTable('drop-table', dropSaleOptions, [], DEFAULT_SALE_ROWS);
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

  const baseMap = new Map(baseMembers.map((member) => [member.id, member]));

  if (savedMembers.length > 0) {
    members = savedMembers.map((member) => {
      const baseInfo = member.id ? baseMap.get(member.id) : null;
      const included = member.included !== undefined
        ? member.included !== false
        : baseInfo
          ? baseInfo.included !== false
          : true;
      const combined = {
        ...(baseInfo || {}),
        ...member,
      };
      combined.nickname = combined.nickname ?? baseInfo?.nickname ?? '';
      combined.job = combined.job ?? baseInfo?.job ?? '';
      combined.included = included;
      combined.rate = member.rate ?? 100;
      combined.deduction = member.deduction ?? 0;
      combined.incentive = member.incentive ?? 0;
      combined.participating = member.participating !== false;
      const savedFinalAmount = Math.max(0, toNumber(member.finalAmount, 0));
      const savedPaymentAmount = Math.max(0, toNumber(member.paymentAmount, 0));
      const savedRemainingAmount = toNumber(member.remainingAmount, savedFinalAmount - savedPaymentAmount);
      combined.paid = member.paid === true;
      combined.paymentAmount = savedPaymentAmount;
      combined.remainingAmount = savedRemainingAmount;
      return combined;
    });
  } else {
    members = baseMembers.map((member) => ({
      ...member,
      rate: member.rate ?? 100,
      deduction: member.deduction ?? 0,
      incentive: member.incentive ?? 0,
      participating: member.included !== false,
      paymentAmount: 0,
      remainingAmount: 0,
      paid: false,
    }));
  }

  setExpenses(Array.isArray(payload.expenses) ? payload.expenses : []);

  populateSaleTable('drop-table', dropSaleOptions, dropData, DEFAULT_SALE_ROWS);
  populateSaleTable('guest-table', guestSaleOptions, guestData, guestDefaultItems.length);
  syncMembersWithBaseOrder();
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
  updateEditModeButton();
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
  updateEditModeButton();
}

function updateNavState() {
  const navList = document.getElementById('nav-list');

  if (navList) {
    navList.disabled = currentView === 'list';
  }
}

async function loadDistributionList() {
  try {
    const response = await fetchWithAuth('/api/distributions');
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

    const statusCell = document.createElement('td');
    const paidTrueCount = Number(distribution.paid_true_count) || 0;
    const paidFalseCount = Number(distribution.paid_false_count) || 0;
    const trackedCount = paidTrueCount + paidFalseCount;
    statusCell.textContent = `${trackedCount} / ${paidTrueCount}`;

    const actionCell = document.createElement('td');
    const viewButton = document.createElement('button');
    viewButton.textContent = '보기';
    viewButton.classList.add('secondary');
    viewButton.addEventListener('click', () => openDistribution(distribution.id, true));

    const deleteButton = document.createElement('button');
    deleteButton.textContent = '삭제';
    deleteButton.classList.add('danger');
    deleteButton.addEventListener('click', () => deleteDistribution(distribution.id));

    actionCell.appendChild(viewButton);
    actionCell.appendChild(deleteButton);

    row.appendChild(titleCell);
    row.appendChild(createdCell);
    row.appendChild(statusCell);
    row.appendChild(actionCell);

    tableBody.appendChild(row);
  });
}

async function deleteDistribution(id) {
  if (!id) {
    return;
  }
  const confirmed = window.confirm('선택한 분배표를 삭제하시겠습니까?');
  if (!confirmed) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/api/distributions/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ message: '분배표를 삭제하지 못했습니다.' }));
      throw new Error(data.message || '분배표를 삭제하지 못했습니다.');
    }

    if (currentDistributionId === id) {
      currentDistributionId = null;
      currentTitle = '';
    }

    await loadDistributionList();
    alert('분배표가 삭제되었습니다.');
  } catch (error) {
    console.error(error);
    alert(error.message || '분배표를 삭제하는 중 문제가 발생했습니다.');
  }
}

async function openDistribution(id, readOnly) {
  try {
    const response = await fetchWithAuth(`/api/distributions/${id}`);
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

function showSaveCompleteMessage() {
  const message = document.getElementById('save-feedback');
  if (!message) {
    return;
  }

  message.classList.remove('hidden');
  if (saveFeedbackTimeout) {
    clearTimeout(saveFeedbackTimeout);
  }
  saveFeedbackTimeout = setTimeout(() => {
    message.classList.add('hidden');
  }, 1000);
}

function collectDistributionPayload() {
  const totalNet = getTotalNet();
  const totalExpense = getTotalExpenses();
  const dropNetTotal = getTableNetSum('drop-table');
  const dropIncentive = Math.floor(dropNetTotal * 0.01);
  const distributionData = calculateDistribution(totalNet, totalExpense, dropIncentive);

  return {
    dropSales: getSaleTableData('drop-table', dropSaleOptions),
    guestSales: getSaleTableData('guest-table', guestSaleOptions),
    expenses: expenses.map((expense) => {
      const amountUnits = Math.max(0, toNumber(expense.amountUnits, 0));
      return {
        description: expense.description,
        amountUnits,
        amount: Math.floor(amountUnits * 10000),
      };
    }),
    members: members.map((member, index) => {
      const { previousRate, previousPaymentAmount, ...memberData } = member;
      const finalAmount = Math.max(0, Math.floor(distributionData.finalAmounts[index] ?? 0));
      const rawPaymentAmount = Math.max(0, Math.floor(toNumber(member.paymentAmount, 0)));
      const paymentAmount = rawPaymentAmount;
      const remainingAmount = Math.floor(finalAmount - paymentAmount);
      member.paymentAmount = paymentAmount;
      member.remainingAmount = remainingAmount;
      return {
        ...memberData,
        included: member.included !== false,
        participating: member.participating !== false,
        paid: member.paid === true,
        finalAmount,
        paymentAmount,
        remainingAmount,
      };
    }),
    totals: {
      totalNet,
      totalExpenses: totalExpense,
      totalIncentives: distributionData.totalIncentives,
      totalDistribution: totalNet - distributionData.totalIncentives - totalExpense,
      participantCount: distributionData.participantCount,
      unitAmount: distributionData.unitAmount,
      totalWeight: distributionData.totalWeight,
    },
  };
}

async function handleSaveDistribution() {
  const titleInput = document.getElementById('save-title-inline');
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
    const response = await fetchWithAuth(currentDistributionId ? `/api/distributions/${currentDistributionId}` : '/api/distributions', {
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
    titleInput.value = currentTitle;
    showSaveCompleteMessage();
    await loadDistributionList();
    updateNavState();
  } catch (error) {
    console.error(error);
    alert(error.message || '분배표를 저장하는 중 문제가 발생했습니다.');
  }
}

function initTables() {
  populateSaleTable('drop-table', dropSaleOptions, [], DEFAULT_SALE_ROWS);
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
  const memberForm = document.getElementById('member-add-form');
  if (memberForm) {
    memberForm.addEventListener('submit', (event) => saveMember(event));
  }

  const openMemberModalButton = document.getElementById('open-member-management');
  if (openMemberModalButton) {
    openMemberModalButton.addEventListener('click', () => {
      openMemberModal();
    });
  }

  const closeMemberModalButton = document.getElementById('close-member-modal');
  if (closeMemberModalButton) {
    closeMemberModalButton.addEventListener('click', () => {
      closeMemberModal();
    });
  }

  const openExpenseButton = document.getElementById('open-expense-modal');
  if (openExpenseButton) {
    openExpenseButton.addEventListener('click', () => {
      openExpenseModal();
    });
  }

  const addMercenaryButton = document.getElementById('add-mercenary-row');
  if (addMercenaryButton) {
    addMercenaryButton.addEventListener('click', () => {
      if (isReadOnly) {
        return;
      }
      const nicknameInput = prompt('추가할 용병의 닉네임을 입력해주세요.');
      const nickname = typeof nicknameInput === 'string' ? nicknameInput.trim() : '';
      if (!nickname) {
        return;
      }

      const jobInput = prompt('추가할 용병의 직업을 입력해주세요.');
      const job = typeof jobInput === 'string' ? jobInput.trim() : '';
      if (!job) {
        return;
      }

      useBaseMembersForEditor = false;
      members.push({
        id: null,
        nickname,
        job,
        included: true,
        participating: true,
        rate: 100,
        deduction: 0,
        incentive: 0,
        paymentAmount: 0,
        remainingAmount: 0,
        paid: false,
      });
      updateTotals();
    });
  }

  const closeExpenseButton = document.getElementById('close-expense-modal');
  if (closeExpenseButton) {
    closeExpenseButton.addEventListener('click', () => {
      closeExpenseModal();
    });
  }

  const addExpenseRowButton = document.getElementById('add-expense-row');
  if (addExpenseRowButton) {
    addExpenseRowButton.addEventListener('click', () => {
      if (isReadOnly) {
        return;
      }
      addExpenseRow();
      renderExpenseRows();
    });
  }

  const navListButton = document.getElementById('nav-list');
  if (navListButton) {
    navListButton.addEventListener('click', () => {
      closeMemberModal();
      closeExpenseModal();
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
      handleSaveDistribution();
    });
  }

  const confirmPaymentInputButton = document.getElementById('confirm-payment-input');
  if (confirmPaymentInputButton) {
    confirmPaymentInputButton.addEventListener('click', () => {
      if (isReadOnly) {
        closePaymentInputModal();
        return;
      }
      handlePaymentInputConfirm();
    });
  }

  const cancelPaymentInputButton = document.getElementById('cancel-payment-input');
  if (cancelPaymentInputButton) {
    cancelPaymentInputButton.addEventListener('click', () => {
      closePaymentInputModal();
    });
  }

  const enterEditModeButton = document.getElementById('enter-edit-mode');
  if (enterEditModeButton) {
    enterEditModeButton.addEventListener('click', () => {
      if (!isReadOnly) {
        return;
      }
      setReadOnly(false);
      updateTotals();
    });
  }

  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeMemberModal();
      closeExpenseModal();
      closePaymentInputModal();
    });
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const authenticated = await ensureAuthenticated();
  if (!authenticated) {
    return;
  }

  initAuthControls();
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
