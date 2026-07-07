(function initFileCompareCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FileCompareCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function sortObject(value) {
    if (Array.isArray(value)) return value.map(sortObject);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort((a, b) => a.localeCompare(b)).map((key) => [key, sortObject(value[key])]));
  }

  function prepareText(text, extension, options = {}) {
    let result = String(text ?? '').replace(/\r\n?/g, '\n');
    if (extension === '.json') {
      try {
        const parsed = JSON.parse(result);
        result = JSON.stringify(options.sortJson ? sortObject(parsed) : parsed, null, 2);
      } catch {}
    } else if (extension === '.xml') {
      result = formatXml(result);
    }
    if (options.ignoreEmpty) result = result.split('\n').filter((line) => line.trim()).join('\n');
    return result;
  }

  function formatXml(xml) {
    const compact = String(xml ?? '').replace(/>\s*</g, '><').trim();
    if (!compact) return '';
    const tokens = compact.replace(/</g, '\n<').split('\n').filter(Boolean);
    let depth = 0;
    return tokens.map((token) => {
      if (/^<\//.test(token)) depth = Math.max(0, depth - 1);
      const line = `${'  '.repeat(depth)}${token}`;
      if (/^<[^!?/][^>]*[^/]>(?!.*<\/)/.test(token) && !/<\/[^>]+>$/.test(token)) depth += 1;
      return line;
    }).join('\n');
  }

  function lineKey(line, options = {}) {
    let value = String(line ?? '');
    if (options.ignoreSpace) value = value.replace(/\s+/g, ' ').trim();
    if (options.ignoreCase) value = value.toLocaleLowerCase();
    return value;
  }

  function buildMyersOperations(left, right, leftKeys, rightKeys) {
    const leftLength = left.length;
    const rightLength = right.length;
    const maxDistance = leftLength + rightLength;
    const searchLimit = Math.min(maxDistance, 1200);
    const trace = [];
    const frontier = new Map([[1, 0]]);
    for (let distance = 0; distance <= searchLimit; distance += 1) {
      trace.push(new Map(frontier));
      for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
        const down = frontier.get(diagonal + 1) ?? -1;
        const rightward = frontier.get(diagonal - 1) ?? -1;
        let leftIndex = diagonal === -distance || (diagonal !== distance && rightward < down) ? Math.max(0, down) : rightward + 1;
        let rightIndex = leftIndex - diagonal;
        while (leftIndex < leftLength && rightIndex < rightLength && leftKeys[leftIndex] === rightKeys[rightIndex]) {
          leftIndex += 1;
          rightIndex += 1;
        }
        frontier.set(diagonal, leftIndex);
        if (leftIndex >= leftLength && rightIndex >= rightLength) {
          const reversed = [];
          let x = leftLength;
          let y = rightLength;
          for (let step = trace.length - 1; step >= 0; step -= 1) {
            const previous = trace[step];
            const currentDiagonal = x - y;
            const previousDown = previous.get(currentDiagonal + 1) ?? -1;
            const previousRight = previous.get(currentDiagonal - 1) ?? -1;
            const previousDiagonal = currentDiagonal === -step || (currentDiagonal !== step && previousRight < previousDown)
              ? currentDiagonal + 1 : currentDiagonal - 1;
            const previousX = Math.max(0, previous.get(previousDiagonal) ?? 0);
            const previousY = previousX - previousDiagonal;
            while (x > previousX && y > previousY) {
              reversed.push({ type: 'equal', left: left[x - 1], right: right[y - 1] });
              x -= 1; y -= 1;
            }
            if (step === 0) break;
            if (x === previousX) {
              reversed.push({ type: 'insert', right: right[y - 1] });
              y -= 1;
            } else {
              reversed.push({ type: 'delete', left: left[x - 1] });
              x -= 1;
            }
          }
          return reversed.reverse();
        }
      }
    }

    let prefix = 0;
    while (prefix < leftLength && prefix < rightLength && leftKeys[prefix] === rightKeys[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < leftLength - prefix && suffix < rightLength - prefix && leftKeys[leftLength - 1 - suffix] === rightKeys[rightLength - 1 - suffix]) suffix += 1;
    const operations = [];
    for (let index = 0; index < prefix; index += 1) operations.push({ type: 'equal', left: left[index], right: right[index] });
    for (let index = prefix; index < leftLength - suffix; index += 1) operations.push({ type: 'delete', left: left[index] });
    for (let index = prefix; index < rightLength - suffix; index += 1) operations.push({ type: 'insert', right: right[index] });
    for (let index = suffix; index > 0; index -= 1) {
      operations.push({ type: 'equal', left: left[leftLength - index], right: right[rightLength - index] });
    }
    return operations;
  }

  function buildLineDiff(leftLines, rightLines, options = {}) {
    const left = Array.isArray(leftLines) ? leftLines : [];
    const right = Array.isArray(rightLines) ? rightLines : [];
    const leftKeys = left.map((line) => lineKey(line, options));
    const rightKeys = right.map((line) => lineKey(line, options));
    const operations = [];
    if ((left.length + 1) * (right.length + 1) <= 2500000) {
      const matrix = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
      for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
        for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
          matrix[leftIndex][rightIndex] = leftKeys[leftIndex] === rightKeys[rightIndex]
            ? matrix[leftIndex + 1][rightIndex + 1] + 1
            : Math.max(matrix[leftIndex + 1][rightIndex], matrix[leftIndex][rightIndex + 1]);
        }
      }
      let leftIndex = 0;
      let rightIndex = 0;
      while (leftIndex < left.length && rightIndex < right.length) {
        if (leftKeys[leftIndex] === rightKeys[rightIndex]) {
          operations.push({ type: 'equal', left: left[leftIndex], right: right[rightIndex] });
          leftIndex += 1; rightIndex += 1;
        } else if (matrix[leftIndex + 1][rightIndex] >= matrix[leftIndex][rightIndex + 1]) {
          operations.push({ type: 'delete', left: left[leftIndex] });
          leftIndex += 1;
        } else {
          operations.push({ type: 'insert', right: right[rightIndex] });
          rightIndex += 1;
        }
      }
      while (leftIndex < left.length) operations.push({ type: 'delete', left: left[leftIndex++] });
      while (rightIndex < right.length) operations.push({ type: 'insert', right: right[rightIndex++] });
    } else operations.push(...buildMyersOperations(left, right, leftKeys, rightKeys));

    const rows = [];
    const hunks = [];
    let leftLine = 1;
    let rightLine = 1;
    for (let index = 0; index < operations.length;) {
      const operation = operations[index];
      if (operation.type === 'equal') {
        rows.push({ type: 'equal', left: operation.left, right: operation.right, leftLine: leftLine++, rightLine: rightLine++ });
        index += 1;
        continue;
      }
      const block = [];
      while (index < operations.length && operations[index].type !== 'equal') block.push(operations[index++]);
      const deleted = block.filter((item) => item.type === 'delete').map((item) => item.left);
      const inserted = block.filter((item) => item.type === 'insert').map((item) => item.right);
      const hunk = {
        id: hunks.length,
        leftStart: leftLine - 1,
        rightStart: rightLine - 1,
        leftDelete: deleted.length,
        rightDelete: inserted.length,
        leftLines: deleted,
        rightLines: inserted
      };
      hunks.push(hunk);
      const count = Math.max(deleted.length, inserted.length);
      for (let blockIndex = 0; blockIndex < count; blockIndex += 1) {
        const hasLeft = blockIndex < deleted.length;
        const hasRight = blockIndex < inserted.length;
        rows.push({
          type: hasLeft && hasRight ? 'changed' : hasLeft ? 'deleted' : 'added',
          left: hasLeft ? deleted[blockIndex] : '',
          right: hasRight ? inserted[blockIndex] : '',
          leftLine: hasLeft ? leftLine++ : null,
          rightLine: hasRight ? rightLine++ : null,
          hunkId: hunk.id,
          firstInHunk: blockIndex === 0
        });
      }
    }
    return { rows, hunks, differentLines: rows.filter((row) => row.type !== 'equal').length };
  }

  function parseDelimited(text, delimiter) {
    const source = String(text ?? '');
    const separator = delimiter || (source.split('\n')[0]?.includes('\t') ? '\t' : ',');
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === separator && !quoted) {
        row.push(cell); cell = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && source[index + 1] === '\n') index += 1;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function columnLabel(index) {
    let value = index + 1;
    let result = '';
    while (value > 0) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
    return result;
  }

  function parseCellAddress(address) {
    const match = /^([A-Z]+)(\d+)$/i.exec(String(address || ''));
    if (!match) return null;
    return { column: columnNameToNumber(match[1].toUpperCase()) - 1, row: Number(match[2]) - 1 };
  }

  function tableToWorkbook(rows, name = '表格') {
    const cells = {};
    rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
      const address = `${columnLabel(columnIndex)}${rowIndex + 1}`;
      cells[address] = { address, row: rowIndex, column: columnIndex, value: String(value ?? '') };
    }));
    return { sheets: [{ name, cells, rows: rows.length, columns: Math.max(0, ...rows.map((row) => row.length)) }] };
  }

  function compareSheets(leftSheet, rightSheet, options = {}) {
    const leftCells = leftSheet?.cells || {};
    const rightCells = rightSheet?.cells || {};
    const addresses = [...new Set([...Object.keys(leftCells), ...Object.keys(rightCells)])].sort((a, b) => {
      const parse = (address) => ({ row: Number(/\d+/.exec(address)?.[0] || 0), column: columnNameToNumber(/[A-Z]+/.exec(address)?.[0] || '') });
      const leftAddress = parse(a); const rightAddress = parse(b);
      return leftAddress.row - rightAddress.row || leftAddress.column - rightAddress.column;
    });
    return addresses.map((address) => {
      const leftCell = leftCells[address];
      const rightCell = rightCells[address];
      const left = leftCell?.displayValue ?? leftCell?.value ?? '';
      const right = rightCell?.displayValue ?? rightCell?.value ?? '';
      const leftFormula = leftCell?.formula || '';
      const rightFormula = rightCell?.formula || '';
      const leftExists = Boolean(leftCell && (String(leftCell.value ?? '') !== '' || leftFormula));
      const rightExists = Boolean(rightCell && (String(rightCell.value ?? '') !== '' || rightFormula));
      let status = 'same';
      if (!leftExists && !rightExists) status = 'same';
      else if (!rightExists) status = 'left-only';
      else if (!leftExists) status = 'right-only';
      else if (lineKey(leftCell?.value ?? '', options) !== lineKey(rightCell?.value ?? '', options) || leftFormula !== rightFormula) status = 'different';
      return { address, left, right, leftFormula, rightFormula, status };
    });
  }

  function filterDifferenceRows(rows, onlyDifferences, statusKey = 'status') {
    if (!onlyDifferences) return rows;
    return rows.filter((row) => {
      const status = row?.[statusKey];
      return status !== 'same' && status !== 'equal';
    });
  }

  function spreadsheetPreviewAxes(leftSheet, rightSheet, comparedRows, onlyDifferences, limits = {}) {
    const visibleCellAddresses = [leftSheet, rightSheet].flatMap((sheet) => Object.entries(sheet?.cells || {})
      .filter(([_address, cell]) => cell?.value !== '' || cell?.formula)
      .map(([address]) => address));
    const differenceAddresses = (comparedRows || []).filter((row) => row.status !== 'same').map((row) => row.address);
    const sourceAddresses = onlyDifferences
      ? differenceAddresses
      : [...new Set([...visibleCellAddresses, ...differenceAddresses])];
    const coordinates = sourceAddresses.map(parseCellAddress).filter(Boolean);
    const maxRows = Math.max(1, Number(limits.maxRows) || 2500);
    const maxColumns = Math.max(1, Number(limits.maxColumns) || 120);
    const usedRows = [...new Set(coordinates.map((item) => item.row))].sort((a, b) => a - b);
    const usedColumns = [...new Set(coordinates.map((item) => item.column))].sort((a, b) => a - b);
    const continuousRows = usedRows.length ? usedRows[usedRows.length - 1] + 1 : 1;
    const continuousColumns = usedColumns.length ? usedColumns[usedColumns.length - 1] + 1 : 1;
    const useContinuousGrid = !onlyDifferences && continuousRows <= maxRows && continuousColumns <= maxColumns && continuousRows * continuousColumns <= 60000;
    const rows = useContinuousGrid ? Array.from({ length: continuousRows }, (_item, index) => index) : usedRows;
    const columns = useContinuousGrid ? Array.from({ length: continuousColumns }, (_item, index) => index) : usedColumns;
    const visibleColumns = (columns.length ? columns : [0]).slice(0, maxColumns);
    const cellSafeRowLimit = Math.max(1, Math.min(maxRows, Math.floor(60000 / visibleColumns.length)));
    const visibleRows = (rows.length ? rows : [0]).slice(0, cellSafeRowLimit);
    return {
      rows: visibleRows,
      columns: visibleColumns,
      totalRows: rows.length,
      totalColumns: columns.length,
      limited: rows.length > visibleRows.length || columns.length > visibleColumns.length
    };
  }

  function columnNameToNumber(name) {
    let value = 0;
    for (const char of name) value = value * 26 + char.charCodeAt(0) - 64;
    return value;
  }

  return { buildLineDiff, columnLabel, compareSheets, filterDifferenceRows, formatXml, parseCellAddress, parseDelimited, prepareText, sortObject, spreadsheetPreviewAxes, tableToWorkbook };
}));
