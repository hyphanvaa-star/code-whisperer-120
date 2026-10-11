(function(){
  const init = () => {
    bind('#afBook', '#afBookRows', '#afBookCnt', true);
    bind('#afDef', '#afDefRows', '#afDefCnt', false);
    const paste = document.querySelector('#afBookPaste');
    const source = document.querySelector('#afBook');
    const status = document.querySelector('#afBookPasteStatus');
    if(!paste || !source || !status) return;
    paste.addEventListener('input', () => {
      if(!paste.value.trim()){ status.textContent = ''; return; }
      const lines = paste.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const rows = [];
      for(const line of lines){
        if(/^(CODE|CODE ADDRESS)\s+(ĐỊA CHỈ AFTN|AFTN ADDRESS)$/i.test(line)) continue;
        const match = line.match(/^([A-Z0-9]{8})\s+(\/\S.*)$/i);
        if(!match){ status.textContent = 'Có dòng không hợp lệ; danh bạ cũ chưa thay đổi.'; return; }
        rows.push([match[1].toUpperCase(), match[2]]);
      }
      if(!rows.length){ status.textContent = 'Chưa có địa chỉ hợp lệ.'; return; }
      source.value = rows.map(row => row.join('\t')).join('\n');
      localStorage.setItem('aftn.book.replaced', '1');
      source.dispatchEvent(new Event('input', {bubbles:true}));
      status.textContent = 'Đã cập nhật ' + rows.length + ' địa chỉ.';
      paste.value = '';
    });
  };
  const bind = (sourceId, bodyId, countId, parenthesized) => {
    const source = document.querySelector(sourceId);
    const body = document.querySelector(bodyId);
    if(!source || !body) return;
    const rowsOf = text => text.split(/\r?\n/).map(line => line.trim().match(/^([A-Z0-9]+)\s+(\/.*)$/i)).filter(Boolean).map(m => [m[1], m[2]]);
    const count = length => { document.querySelector(countId).textContent = parenthesized ? '(' + length + ')' : String(length); };
    const commit = () => {
      source.value = Array.from(body.rows).map(row => Array.from(row.cells).map(cell => cell.textContent.trim()).join('\t')).filter(line => line.trim()).join('\n');
      source.dispatchEvent(new Event('input', {bubbles:true}));
      count(rowsOf(source.value).length);
    };
    const paint = rows => {
      const fragment = document.createDocumentFragment();
      for(const pair of rows){
        const row = document.createElement('tr');
        pair.forEach((value, column) => {
          const cell = document.createElement('td');
          cell.contentEditable = 'true';
          cell.spellcheck = false;
          cell.setAttribute('aria-label', (column ? 'Địa chỉ AFTN ' : 'CODE ') + pair[0]);
          cell.textContent = value;
          row.append(cell);
        });
        fragment.append(row);
      }
      body.replaceChildren(fragment);
      count(rows.length);
    };
    paint(rowsOf(source.value));
    source.addEventListener('input', () => {
      const current = Array.from(body.rows).map(row => Array.from(row.cells).map(cell => cell.textContent.trim()).join('\t')).join('\n');
      if(JSON.stringify(rowsOf(current)) !== JSON.stringify(rowsOf(source.value))) paint(rowsOf(source.value));
    });
    body.addEventListener('input', commit);
    body.addEventListener('paste', event => {
      const text = event.clipboardData?.getData('text/plain') || '';
      const rows = rowsOf(text);
      if(!rows.length) return;
      event.preventDefault();
      const cell = event.target.closest('td');
      if(!cell) return;
      let index = cell.parentElement.rowIndex - 1;
      for(const pair of rows){
        let row = body.rows[index++];
        if(!row){ row = body.insertRow(); for(let c=0;c<2;c++){ const td=row.insertCell(); td.contentEditable='true'; td.spellcheck=false; } }
        pair.forEach((value,c) => { row.cells[c].textContent=value; });
      }
      commit();
    });
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();