import { posix } from 'node:path';
import { extractZipEntries } from './zip-archive.js';

const worksheetRelationshipType = 'worksheet';

export function parseXlsxInventory(buffer) {
  const entries = extractZipEntries(buffer);
  const textEntries = new Map(entries.map((entry) => [
    normalizeZipPath(entry.name),
    entry.content.toString('utf8')
  ]));
  const workbookXml = textEntries.get('xl/workbook.xml');
  if (!workbookXml) throw new Error('XLSX supplier inventory is missing xl/workbook.xml.');

  const sharedStrings = parseSharedStrings(textEntries.get('xl/sharedStrings.xml') || '');
  return findWorksheetPaths(workbookXml, textEntries).flatMap((worksheetPath) => {
    const worksheetXml = textEntries.get(worksheetPath);
    if (!worksheetXml) throw new Error(`XLSX supplier inventory is missing ${worksheetPath}.`);
    return rowsToObjects(parseWorksheetRows(worksheetXml, sharedStrings));
  });
}

function findWorksheetPaths(workbookXml, textEntries) {
  const workbookPath = 'xl/workbook.xml';
  const relationships = parseWorkbookRelationships(textEntries.get('xl/_rels/workbook.xml.rels') || '', workbookPath);
  const sheetTags = matchTags(workbookXml, 'sheet');
  const worksheetPaths = [];

  for (const sheet of sheetTags) {
    const attrs = parseAttributes(sheet.openingTag);
    const relationshipId = attrs['r:id'] || attrs.id;
    const relationship = relationships.get(relationshipId);
    if (relationship && !worksheetPaths.includes(relationship)) worksheetPaths.push(relationship);
  }

  if (worksheetPaths.length) return worksheetPaths;
  if (textEntries.has('xl/worksheets/sheet1.xml')) return ['xl/worksheets/sheet1.xml'];
  const worksheets = [...textEntries.keys()].filter((name) => /^xl\/worksheets\/.+\.xml$/i.test(name));
  if (worksheets.length) return worksheets.sort((a, b) => a.localeCompare(b));
  throw new Error('XLSX supplier inventory does not contain a worksheet.');
}

function parseWorkbookRelationships(xml, workbookPath) {
  const relationships = new Map();
  const relationshipPattern = /<Relationship\b([^>]*)\/?>/gi;
  let match;
  while ((match = relationshipPattern.exec(xml))) {
    const attrs = parseAttributes(match[0]);
    const type = String(attrs.Type || attrs.type || '').toLowerCase();
    if (!type.includes(worksheetRelationshipType)) continue;
    const id = attrs.Id || attrs.id;
    const target = attrs.Target || attrs.target;
    if (id && target) relationships.set(id, resolveZipTarget(workbookPath, target));
  }
  return relationships;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return matchTags(xml, 'si').map((item) => parseTextRuns(item.content));
}

function parseWorksheetRows(xml, sharedStrings) {
  return matchTags(xml, 'row').map((row) => {
    const values = [];
    let nextColumnIndex = 0;
    for (const cell of matchTags(row.content, 'c')) {
      const attrs = parseAttributes(cell.openingTag);
      const refColumnIndex = getColumnIndex(attrs.r);
      const columnIndex = Number.isInteger(refColumnIndex) ? refColumnIndex : nextColumnIndex;
      values[columnIndex] = parseCellValue(cell.content, attrs, sharedStrings);
      nextColumnIndex = columnIndex + 1;
    }
    return values;
  });
}

function parseCellValue(content, attrs, sharedStrings) {
  const type = String(attrs.t || '').trim();
  if (type === 'inlineStr') return parseTextRuns(content);

  const rawValue = readFirstTagText(content, 'v');
  if (rawValue === '') return '';
  if (type === 's') return sharedStrings[Number(rawValue)] ?? '';
  if (type === 'b') return rawValue === '1' ? 'TRUE' : 'FALSE';
  return rawValue;
}

function rowsToObjects(rows) {
  const nonEmptyRows = rows.filter((row) => row.some((value) => String(value ?? '').trim() !== ''));
  if (nonEmptyRows.length < 2) return [];
  const headers = nonEmptyRows[0].map((header) => String(header ?? '').trim());

  return nonEmptyRows.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = row[index] ?? '';
    });
    return record;
  });
}

function matchTags(xml, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>|<${tagName}\\b[^>]*/>`, 'gi');
  const matches = [];
  let match;
  while ((match = pattern.exec(xml))) {
    const tag = match[0];
    const openingTag = tag.slice(0, tag.indexOf('>') + 1);
    const content = tag.endsWith('/>')
      ? ''
      : tag.slice(openingTag.length, tag.lastIndexOf(`</${tagName}>`));
    matches.push({ openingTag, content });
  }
  return matches;
}

function parseTextRuns(xml) {
  const values = [];
  const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
  let match;
  while ((match = textPattern.exec(xml))) {
    values.push(decodeXml(match[1]));
  }
  return values.join('');
}

function readFirstTagText(xml, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(pattern);
  return match ? decodeXml(match[1]).trim() : '';
}

function parseAttributes(tag) {
  const attributes = {};
  const attrPattern = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  let match;
  while ((match = attrPattern.exec(tag))) {
    attributes[match[1]] = decodeXml(match[3]);
  }
  return attributes;
}

function getColumnIndex(cellReference) {
  const match = String(cellReference || '').match(/^([A-Z]+)/i);
  if (!match) return null;
  return match[1].toUpperCase().split('').reduce((total, letter) =>
    total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function resolveZipTarget(basePath, target) {
  const rawTarget = String(target || '').replace(/\\/g, '/');
  if (rawTarget.startsWith('/')) return normalizeZipPath(rawTarget.slice(1));
  return normalizeZipPath(posix.join(posix.dirname(basePath), rawTarget));
}

function normalizeZipPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
