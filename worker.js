// worker.js — handles file parsing and incremental posting of rows to main thread
// Now also supports 'filter' command for efficient substring matching in the worker
importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

let parsedRows = []; // rows without header
let headers = [];

self.onmessage = async function(e){
  const {cmd} = e.data;
  if(cmd === 'parse'){
    try{
      const {fileArrayBuffer, sheetName} = e.data;
      const wb = XLSX.read(fileArrayBuffer, {type:'array'});
      const sheetNames = wb.SheetNames;
      postMessage({type:'sheets', sheets:sheetNames});
      const chosen = sheetName || sheetNames[0];
      const ws = wb.Sheets[chosen];
      const raw = XLSX.utils.sheet_to_json(ws, {header:1,defval:''});
      const batchSize = 1000;
      // first row = headers
      headers = raw.length ? raw[0].map(h=>String(h||'')) : [];
      for(let i=1;i<raw.length;i+=batchSize){
        const batch = raw.slice(i, i+batchSize);
        // normalize rows to same length as headers
        const norm = batch.map(r=>{
          const out = new Array(headers.length);
          for(let j=0;j<headers.length;j++) out[j] = r[j] !== undefined ? String(r[j]) : '';
          return out;
        });
        parsedRows = parsedRows.concat(norm);
        postMessage({type:'batch', start: i-1, batch: norm, total: raw.length-1});
      }
      postMessage({type:'done', total: parsedRows.length, headers});
    }catch(err){
      postMessage({type:'error', message:err.message});
    }
  }else if(cmd === 'filter'){
    // perform fast case-insensitive substring matching on parsedRows in worker
    const {query, cols, maxResults} = e.data;
    if(!query){
      // return all indices
      const indices = Array.from({length: parsedRows.length}, (_,i)=>i);
      postMessage({type:'filterDone', indices});
      return;
    }
    const q = String(query).toLowerCase();
    const targetCols = Array.isArray(cols) && cols.length ? cols : null; // indices of columns to check; null = all
    const batchSize = 2000; // send back matches in batches
    const indices = [];
    for(let i=0;i<parsedRows.length;i++){
      const row = parsedRows[i];
      let matched = false;
      if(targetCols){
        for(const c of targetCols){
          if(row[c] && row[c].toLowerCase().indexOf(q) !== -1){ matched = true; break; }
        }
      } else {
        for(let c=0;c<row.length;c++){
          if(row[c] && row[c].toLowerCase().indexOf(q) !== -1){ matched = true; break; }
        }
      }
      if(matched) indices.push(i);
      if(indices.length && indices.length % batchSize === 0){
        postMessage({type:'filterBatch', indicesChunk: indices.slice(-batchSize)});
      }
      if(maxResults && indices.length>=maxResults) break;
    }
    postMessage({type:'filterDone', indices});
  }
};