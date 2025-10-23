const fileInput = document.getElementById('fileInput');
const progressEl = document.getElementById('progress');
const statsEl = document.getElementById('stats');
const tableHead = document.getElementById('tableHead');
const tableBody = document.getElementById('tableBody');
const globalSearch = document.getElementById('globalSearch');
const btnExport = document.getElementById('btnExport');

let worker = null, rows = [], headers = [], filteredRows = [];
let fuse = null;
let searchTimeout = null;
let columnFilters = {};


// --- FILE LOADING ---
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  worker && worker.terminate();
  worker = new Worker('worker.js');
  worker.onmessage = msgHandler;
  const reader = new FileReader();
  reader.onload = evt => worker.postMessage({ cmd: 'parse', fileArrayBuffer: evt.target.result });
  reader.readAsArrayBuffer(file);
});


function msgHandler(e) {
  const msg = e.data;
  if (msg.type === 'sheets') {
    console.log('Sheets:', msg.sheets);
  } else if (msg.type === 'batch') {
    const { start, batch, total } = msg;
    if (start === 0) {
      headers = batch[0];
      rows = batch.slice(1);
      buildHead();
    } else {
      rows = rows.concat(batch);
    }
    progressEl.hidden = false;
    progressEl.value = Math.min(100, (rows.length / total) * 100);
    statsEl.textContent = `Loaded ${rows.length} rows`;
    filteredRows = rows;
    renderRows([]);
  } else if (msg.type === 'done') {
    progressEl.hidden = true;
    statsEl.textContent = `Loaded ${rows.length} total rows`;
    buildFuse();
  }
}


// --- BUILD TABLE HEADER + COLUMN FILTERS ---
function buildHead() {
  const headRow = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    const input = document.createElement('input');
    input.placeholder = h;
    input.className = 'col-filter';
    input.dataset.col = h;
    input.addEventListener('input', onColumnFilterChange);
    th.appendChild(document.createTextNode(h));
    th.appendChild(document.createElement('br'));
    th.appendChild(input);
    headRow.appendChild(th);
  });
  tableHead.innerHTML = '';
  tableHead.appendChild(headRow);
}


// --- COLUMN FILTER HANDLER ---
function onColumnFilterChange(e) {
  const col = e.target.dataset.col;
  const val = e.target.value.trim().toLowerCase();
  if (val) columnFilters[col] = val;
  else delete columnFilters[col];
  applyAllFilters(globalSearch.value.trim().toLowerCase());
}


// --- GLOBAL SEARCH INPUT ---
globalSearch.addEventListener('input', e => {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim().toLowerCase();
  searchTimeout = setTimeout(() => {
    applyAllFilters(query);
  }, 150);
});


// --- APPLY FILTERS (exact substring only) ---
function applyAllFilters(globalQuery = '') {
  let result = [...rows];

  // Apply column filters
  for (const [col, val] of Object.entries(columnFilters)) {
    const idx = headers.indexOf(col);
    if (idx !== -1) {
      result = result.filter(r => String(r[idx]).toLowerCase().includes(val));
    }
  }


  // Apply global search
  if (globalQuery) {
    result = result.filter(row =>
      row.some(cell => String(cell).toLowerCase().includes(globalQuery))
    );
  }


  filteredRows = result;

  // Collect all highlight terms: global + column filters
  let highlightQueries = Object.values(columnFilters);
  if (globalQuery) highlightQueries.push(globalQuery);

  renderRows(highlightQueries);
}


// --- HIGHLIGHT MATCH FUNCTION ---
function highlight(text, queries) {
  if (!queries || queries.length === 0) return text;
  let highlighted = String(text);
  queries.forEach(q => {
    if (q) {
      const regex = new RegExp(`(${q})`, 'gi');
      highlighted = highlighted.replace(regex, '<mark>$1</mark>');
    }
  });
  return highlighted;
}


// --- RENDER TABLE ROWS ---
function renderRows(queries = []) {
  if (!Array.isArray(queries)) queries = [queries];
  const html = filteredRows.map(r =>
    '<tr>' + r.map(c => `<td>${highlight(c, queries)}</td>`).join('') + '</tr>'
  ).join('');
  tableBody.innerHTML = html;
  statsEl.textContent = `Loading ${filteredRows.length} rows`;
}


// --- FUZZY SEARCH SETUP ---
function buildFuse() {
  const data = rows.map(r => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = r[i]));
    return obj;
  });
  fuse = new Fuse(data, { keys: headers, threshold: 0.4 });
}


btnExport.addEventListener('click', () => {
  if (!filteredRows.length) {
    alert('No filtered rows to export!');
    return;
  }

  // Export only currently filtered/searched rows
  const exportData = [headers, ...filteredRows];
  const ws = XLSX.utils.aoa_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Filtered_Results');
  XLSX.writeFile(wb, 'filtered_results.xlsx');
});

