(function(){
  const init = () => {
    const source = document.querySelector('#afBook');
    const body = document.querySelector('#afBookRows');
    if(!source || !body) return;
    const rowsOf = text => text.split(/\r?\n/).map(line => line.trim().match(/^([A-Z0-9]+)\s+(\/.*)$/i)).filter(Boolean).map(m => [m[1], m[2]]);
    const commit = () => {
      source.value = Array.from(body.rows).map(row => Array.from(row.cells).map(cell => cell.textContent.trim()).join('\t')).filter(line => line.trim()).join('\n');
      source.dispatchEvent(new Event('input', {bubbles:true}));
      document.querySelector('#afBookCnt').textContent = '(' + body.rows.length + ')';
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
      document.querySelector('#afBookCnt').textContent = '(' + rows.length + ')';
    };
    paint(rowsOf(source.value));
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