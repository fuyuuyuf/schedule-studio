const STICKY_KEY = 'solarized-sticky-notes-v1';
const THEME_KEY = 'solarized-theme-v1';
const APPEARANCE_KEY = 'solarized-appearance-v1';
let stickyNotes = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(STICKY_KEY));
    if (!Array.isArray(value)) return [];
    return value.filter(note => note.content?.trim()).map(note => note.space === 'screen' ? note : {
      ...note, x: 53 + Number(note.x || 0) * .42, y: 15 + Number(note.y || 0) * .48, space: 'screen',
    });
  } catch (_) { return []; }
})();
let editingStickyId = null;
let stickyPoint = { x: 30, y: 30 };
let stickyColor = COLORS[4];
const stickyDraftIds = new Set();

function saveStickyNotes() {
  localStorage.setItem(STICKY_KEY, JSON.stringify(stickyNotes));
}

function stickyById(id) {
  return stickyNotes.find(note => note.id === id);
}

function stickyTitle(content, fallback) {
  const heading = String(content || '').match(/^#\s+(.+)$/m);
  return heading ? heading[1].replace(/[*_`]/g, '').trim() || fallback : fallback;
}

function renderStickyWall(focus = false) {
  $('#stickyWall').innerHTML = stickyNotes.map((note, index) => {
    const editingNote = note.id === editingStickyId;
    const color = COLORS.includes(note.color) ? note.color : COLORS[4];
    const fallback = `便签 #${index + 1}`;
    const label = stickyTitle(note.content, fallback);
    return `<article class="sticky-note ${editingNote ? 'editing' : ''}" data-sticky-id="${escapeHtml(note.id)}" aria-label="${escapeHtml(label)}" style="left:${note.x}%;top:${note.y}%;width:${note.width || 220}px;height:${note.height || 175}px;--sticky-color:${color}">
      ${editingNote ? `<div class="sticky-note-head"><small>${escapeHtml(label)}</small><div class="sticky-note-actions"><button class="sticky-save" type="button">保存</button><button class="sticky-delete" type="button" aria-label="删除便签" title="删除便签">×</button></div></div><textarea class="sticky-input" placeholder="输入 Markdown 内容…">${escapeHtml(note.content)}</textarea><div class="sticky-preview markdown-preview"></div><div class="sticky-resize" role="button" aria-label="拖动调整便签大小"></div>`
        : `<button class="sticky-delete" type="button" aria-label="删除便签" title="删除便签">×</button><div class="sticky-read markdown-preview">${note.content.trim() ? markdownToHtml(note.content) : '<p>双击输入内容…</p>'}</div>`}
    </article>`;
  }).join('');
  const active = $('#stickyWall .sticky-note.editing');
  if (active) {
    const textarea = active.querySelector('textarea');
    const preview = active.querySelector('.sticky-preview');
    preview.innerHTML = markdownToHtml(textarea.value) || '<p class="preview-empty">预览</p>';
    textarea.addEventListener('input', () => {
      const note = stickyById(editingStickyId);
      if (!note) return;
      note.content = textarea.value;
      const label = stickyTitle(note.content, `便签 #${stickyNotes.indexOf(note) + 1}`);
      active.querySelector('.sticky-note-head small').textContent = label;
      active.setAttribute('aria-label', label);
      preview.innerHTML = markdownToHtml(note.content) || '<p class="preview-empty">预览</p>';
      if (note.content.trim()) saveStickyNotes();
    });
    if (focus) requestAnimationFrame(() => textarea.focus());
  }
}

function finishStickyEdit() {
  if (!editingStickyId) return;
  const textarea = $('#stickyWall .sticky-note.editing textarea');
  const note = stickyById(editingStickyId);
  if (note && textarea) note.content = textarea.value;
  if (note && stickyDraftIds.has(note.id) && !note.content.trim()) stickyNotes = stickyNotes.filter(item => item.id !== note.id);
  if (note) stickyDraftIds.delete(note.id);
  editingStickyId = null;
  saveStickyNotes();
  renderStickyWall();
}

$('#standbyView').addEventListener('contextmenu', event => {
  if (event.target.closest('.sticky-note')) return;
  if (event.target.closest('button, .task-card')) return;
  event.preventDefault();
  const rect = $('#stickyWall').getBoundingClientRect();
  stickyPoint = {
    x: Math.max(0, Math.min(80, (event.clientX - rect.left) / rect.width * 100)),
    y: Math.max(0, Math.min(75, (event.clientY - rect.top) / rect.height * 100)),
  };
  const menu = $('#stickyContextMenu');
  menu.hidden = false;
  positionContextMenu(menu, event.clientX, event.clientY);
});
function createStickyNote(color = stickyColor) {
  finishStickyEdit();
  const note = { id: makeId(), x: stickyPoint.x, y: stickyPoint.y, space: 'screen', width: 220, height: 175, color, content: '' };
  stickyNotes.push(note);
  stickyDraftIds.add(note.id);
  editingStickyId = note.id;
  $('#stickyContextMenu').hidden = true;
  renderStickyWall(true);
}
$('#createStickyNote').addEventListener('click', () => createStickyNote());
$('#stickyColorOptions').innerHTML = COLORS.map(color => `<button type="button" data-sticky-color="${color}" style="--swatch:${color}" aria-label="创建${color}标签" title="${color}"></button>`).join('');
$('#stickyColorOptions').addEventListener('click', event => {
  const button = event.target.closest('[data-sticky-color]');
  if (!button) return;
  stickyColor = button.dataset.stickyColor;
  createStickyNote(stickyColor);
});
$('#clearStickyNotes').addEventListener('click', () => {
  $('#stickyContextMenu').hidden = true;
  if (!stickyNotes.length || !confirm('确定清空所有便签吗？此操作无法撤销。')) return;
  stickyNotes = [];
  stickyDraftIds.clear();
  editingStickyId = null;
  saveStickyNotes();
  renderStickyWall();
});
$('#stickyWall').addEventListener('click', event => {
  const deleteButton = event.target.closest('.sticky-delete');
  if (deleteButton) {
    const id = deleteButton.closest('.sticky-note')?.dataset.stickyId;
    if (!id) return;
    stickyNotes = stickyNotes.filter(note => note.id !== id);
    stickyDraftIds.delete(id);
    if (editingStickyId === id) editingStickyId = null;
    saveStickyNotes();
    renderStickyWall();
    return;
  }
  if (event.target.closest('.sticky-save')) finishStickyEdit();
});
$('#stickyWall').addEventListener('dblclick', event => {
  const card = event.target.closest('.sticky-note:not(.editing)');
  if (!card) return;
  finishStickyEdit();
  editingStickyId = card.dataset.stickyId;
  renderStickyWall(true);
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#stickyContextMenu')) $('#stickyContextMenu').hidden = true;
  if (editingStickyId && !event.target.closest('.sticky-note.editing, .sticky-delete')) finishStickyEdit();
}, true);

let stickyGesture = null;
$('#stickyWall').addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const card = event.target.closest('.sticky-note');
  if (!card) return;
  const note = stickyById(card.dataset.stickyId);
  if (!note) return;
  const resizing = Boolean(event.target.closest('.sticky-resize'));
  if (!resizing && card.classList.contains('editing') && !event.target.closest('.sticky-note-head')) return;
  if (!resizing && event.target.closest('button')) return;
  stickyGesture = { id: note.id, resizing, x: event.clientX, y: event.clientY, originX: note.x, originY: note.y,
    width: note.width || 220, height: note.height || 175 };
  card.setPointerCapture(event.pointerId);
  event.preventDefault();
});
$('#stickyWall').addEventListener('pointermove', event => {
  if (!stickyGesture) return;
  const card = $('#stickyWall .sticky-note[data-sticky-id="' + stickyGesture.id + '"]');
  const note = stickyById(stickyGesture.id);
  if (!card || !note) return;
  const wall = $('#stickyWall').getBoundingClientRect();
  const dx = event.clientX - stickyGesture.x;
  const dy = event.clientY - stickyGesture.y;
  if (stickyGesture.resizing) {
    note.width = Math.max(155, Math.min(window.innerWidth - 16, stickyGesture.width + dx));
    note.height = Math.max(110, Math.min(window.innerHeight - 16, stickyGesture.height + dy));
    card.style.width = `${note.width}px`;
    card.style.height = `${note.height}px`;
  } else {
    note.x = Math.max(0, Math.min(100 - card.offsetWidth / wall.width * 100, stickyGesture.originX + dx / wall.width * 100));
    note.y = Math.max(0, Math.min(100 - card.offsetHeight / wall.height * 100, stickyGesture.originY + dy / wall.height * 100));
    card.style.left = `${note.x}%`;
    card.style.top = `${note.y}%`;
  }
});
function finishStickyGesture() {
  if (!stickyGesture) return;
  stickyGesture = null;
  saveStickyNotes();
}
$('#stickyWall').addEventListener('pointerup', finishStickyGesture);
$('#stickyWall').addEventListener('pointercancel', finishStickyGesture);
saveStickyNotes();
renderStickyWall();

const systemDark = matchMedia('(prefers-color-scheme: dark)');
let appearanceChoice = localStorage.getItem(APPEARANCE_KEY) || 'light';
let savedTheme;
try { savedTheme = JSON.parse(localStorage.getItem(THEME_KEY)) || { name: 'Solarized', css: '' }; }
catch (_) { savedTheme = { name: 'Solarized', css: '' }; }

function applySoftwareAppearance() {
  const dark = appearanceChoice === 'dark' || (appearanceChoice === 'system' && systemDark.matches);
  document.body.dataset.appearance = dark ? 'dark' : 'light';
  document.body.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-light', !dark);
}

function applySoftwareTheme(css) {
  // 阻止导入主题从远程地址额外读取内容。
  $('#uploadedThemeStyle').textContent = String(css || '').replace(/@import\s+[^;]+;/gi, '').replace(/url\(\s*(['"]?)(?!data:)[^)]*\)/gi, 'none');
}

async function syncSoftwareSettings() {
  try {
    const response = await fetch('http://127.0.0.1:3456/settings', { cache: 'no-store' });
    if (!response.ok) return;
    let next = await response.json();
    if (!next.hasSavedSettings && (localStorage.getItem(APPEARANCE_KEY) || localStorage.getItem(THEME_KEY) || localStorage.getItem('solarized-reverse-wheel-v1'))) {
      const migrated = await fetch('http://127.0.0.1:3456/import-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appearance: appearanceChoice, reverseWheel, themeName: savedTheme.name, themeCss: savedTheme.css }),
      });
      if (migrated.ok) next = await migrated.json();
    }
    appearanceChoice = next.appearance;
    reverseWheel = Boolean(next.reverseWheel);
    applySoftwareAppearance();
    applySoftwareTheme(next.themeCss);
  } catch (_) { /* 托盘程序未启动时继续沿用浏览器原有外观。 */ }
}

systemDark.addEventListener('change', applySoftwareAppearance);
applySoftwareAppearance();
applySoftwareTheme(savedTheme.css);
requestAnimationFrame(() => document.documentElement.classList.add('theme-ready'));
syncSoftwareSettings();
setInterval(syncSoftwareSettings, 10000);
window.addEventListener('focus', syncSoftwareSettings);
