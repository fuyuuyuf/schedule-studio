const storageKey = 'schedule-studio-stickers-v1';
const endpoint = 'http://127.0.0.1:3456/api/v1/plugins/sticker-widget';
const stickerWidth = 160;
const minStickerWidth = 48;
const maxStickerWidth = 600;

async function request(method, route) {
  const response = await fetch(`${endpoint}/${route}`, { method, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || '请求失败');
  return result.data;
}

function loadPlacedStickers() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string')
      .map(item => ({ ...item, width: clamp(Number(item.width) || stickerWidth, minStickerWidth, maxStickerWidth), draft: item.draft === true })) : [];
  } catch (_) { return []; }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function mount({ root }) {
  const standby = root.closest('#standbyView') || document.querySelector('#standbyView');
  const layer = root.querySelector('.sticker-widget-layer');
  const menu = document.querySelector('#stickyContextMenu');
  const stickyGroup = menu?.querySelector('.sticky-create-group');
  const stickyButton = menu?.querySelector('#createStickyNote');
  const originalStickyMarkup = stickyButton?.innerHTML || '';
  const originalStickyParent = stickyGroup?.parentNode || null;
  const originalStickyNext = stickyGroup?.nextSibling || null;
  const removalMenu = document.createElement('div');
  removalMenu.className = 'sticker-remove-menu';
  removalMenu.setAttribute('role', 'menu');
  removalMenu.setAttribute('aria-label', '贴纸操作');
  removalMenu.innerHTML = '<button type="button" role="menuitem">删除贴纸</button>';
  removalMenu.hidden = true;
  document.body.append(removalMenu);

  let placed = loadPlacedStickers();
  let activeDraftId = placed.findLast(item => item.draft)?.id || null;
  let catalog = [];
  let point = { x: 30, y: 20 };
  let selectedId = null;
  let gesture = null;
  let whiteBorder = false;
  let catalogToken = 0;
  let lastCatalogAt = 0;
  let thumbnailObserver = null;
  const imageCache = new Map();
  const imageVersions = new Map();
  const cleanup = [];
  let picker = null;
  let stickerGroup = null;
  let componentGroup = null;
  let standaloneGroup = null;

  function save() {
    localStorage.setItem(storageKey, JSON.stringify(placed));
  }

  function hideRemovalMenu() {
    removalMenu.hidden = true;
    selectedId = null;
  }

  function positionMenu(element, x, y) {
    element.hidden = false;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = x + width > window.innerWidth && x >= width ? x - width : x;
    element.style.left = `${clamp(left, 8, Math.max(8, window.innerWidth - width - 8))}px`;
    element.style.top = `${clamp(y, 8, Math.max(8, window.innerHeight - height - 8))}px`;
  }

  async function imageFor(name) {
    if (!imageCache.has(name)) {
      const value = request('GET', `image?name=${encodeURIComponent(name)}`).then(result => result.dataUrl);
      imageCache.set(name, value);
      value.catch(() => imageCache.delete(name));
    }
    return imageCache.get(name);
  }

  function fitSticker(item, card, image) {
    const bounds = layer.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !image.naturalWidth) return;
    const ratio = image.naturalHeight / image.naturalWidth;
    const maxWidth = Math.max(minStickerWidth, Math.min(maxStickerWidth, bounds.width - 10, (bounds.height - 10) / ratio));
    item.width = clamp(item.width, minStickerWidth, maxWidth);
    card.style.width = `${item.width}px`;
    item.x = clamp(Number(item.x) || 0, 0, Math.max(0, 100 - item.width / bounds.width * 100));
    item.y = clamp(Number(item.y) || 0, 0, Math.max(0, 100 - item.width * ratio / bounds.height * 100));
    card.style.left = `${item.x}%`;
    card.style.top = `${item.y}%`;
  }

  function renderPlaced() {
    layer.replaceChildren();
    const bounds = layer.getBoundingClientRect();
    for (const item of placed) {
      const card = document.createElement('div');
      card.className = `sticker-card${item.draft ? ' is-draft' : ''}`;
      card.dataset.stickerId = item.id;
      card.setAttribute('role', 'img');
      card.setAttribute('aria-label', `${item.name} 贴纸`);
      card.tabIndex = 0;
      card.style.left = `${clamp(Number(item.x) || 0, 0, 100)}%`;
      card.style.top = `${clamp(Number(item.y) || 0, 0, 100)}%`;
      card.style.width = `${item.width}px`;
      const image = document.createElement('img');
      image.alt = item.name;
      image.draggable = false;
      image.addEventListener('load', () => fitSticker(item, card, image));
      card.append(image);
      if (item.draft) {
        const handle = document.createElement('span');
        handle.className = 'sticker-resize';
        handle.setAttribute('role', 'button');
        handle.setAttribute('aria-label', '拖动调整贴纸大小');
        handle.title = '拖动调整大小，点击空白处完成';
        card.append(handle);
      }
      layer.append(card);
      void imageFor(item.name).then(source => {
        if (card.isConnected) image.src = source;
      }).catch(() => {
        if (!card.isConnected) return;
        image.remove();
        card.classList.add('is-missing');
        const message = document.createElement('span');
        message.textContent = `${item.name} 已移出贴纸目录`;
        card.prepend(message);
      });
      if (bounds.width && bounds.height) {
        item.x = clamp(Number(item.x) || 0, 0, Math.max(0, 100 - item.width / bounds.width * 100));
        item.y = clamp(Number(item.y) || 0, 0, Math.max(0, 100 - item.width / bounds.height * 100));
        card.style.left = `${item.x}%`;
        card.style.top = `${item.y}%`;
      }
    }
  }

  function renderPicker() {
    if (!picker) return;
    thumbnailObserver?.disconnect();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const image = entry.target;
        const name = image.closest('[data-texture-name]')?.dataset.textureName;
        if (name) void imageFor(name).then(source => { if (image.isConnected) image.src = source; }).catch(() => { image.hidden = true; });
      }
    }, { root: picker, rootMargin: '48px' });
    thumbnailObserver = observer;
    picker.replaceChildren();
    if (!catalog.length) {
      const message = document.createElement('p');
      message.className = 'sticker-picker-status';
      message.textContent = '目录中暂无贴纸。请到软件设置中打开贴纸目录，放入图片。';
      picker.append(message);
      return;
    }
    for (const item of catalog) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sticker-picker-item';
      button.dataset.textureName = item.name;
      button.setAttribute('role', 'menuitem');
      button.setAttribute('aria-label', `创建贴纸 ${item.name}`);
      const image = document.createElement('img');
      image.alt = '';
      const label = document.createElement('span');
      label.textContent = item.name;
      button.append(image, label);
      picker.append(button);
      observer.observe(image);
    }
  }

  async function refreshCatalog(force = false) {
    if (!force && Date.now() - lastCatalogAt < 1500) return;
    const token = ++catalogToken;
    try {
      const result = await request('GET', 'catalog');
      if (token !== catalogToken) return;
      for (const item of result.stickers) {
        if (imageVersions.get(item.name) !== item.version) imageCache.delete(item.name);
        imageVersions.set(item.name, item.version);
      }
      catalog = result.stickers;
      lastCatalogAt = Date.now();
      renderPicker();
    } catch (error) {
      if (token !== catalogToken || !picker) return;
      picker.innerHTML = '';
      const message = document.createElement('p');
      message.className = 'sticker-picker-status';
      message.textContent = `读取贴纸失败：${error.message}`;
      picker.append(message);
    }
  }

  async function refreshConfig() {
    try {
      const config = await request('GET', 'config');
      whiteBorder = config.whiteBorder;
      root.classList.toggle('sticker-white-border', whiteBorder);
    } catch (_) { /* 服务临时不可用时沿用当前显示。 */ }
  }

  function finishDraft() {
    if (!activeDraftId) return;
    const item = placed.find(value => value.id === activeDraftId);
    activeDraftId = null;
    if (!item) return;
    item.draft = false;
    save();
    renderPlaced();
  }

  function addSticker(name) {
    if (!catalog.some(item => item.name === name)) return;
    finishDraft();
    const bounds = layer.getBoundingClientRect();
    const item = {
      id: globalThis.crypto?.randomUUID?.() || `sticker-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      x: clamp(point.x, 0, Math.max(0, 100 - stickerWidth / Math.max(bounds.width, 1) * 100)),
      y: clamp(point.y, 0, Math.max(0, 100 - stickerWidth / Math.max(bounds.height, 1) * 100)),
      width: stickerWidth,
      draft: true,
    };
    placed.push(item);
    activeDraftId = item.id;
    save();
    if (menu) menu.hidden = true;
    closePicker();
    renderPlaced();
  }

  function closePicker() {
    stickerGroup?.classList.remove('is-open');
    stickerGroup?.querySelector('.sticker-create-trigger')?.setAttribute('aria-expanded', 'false');
  }

  function orientComponentMenu() {
    if (!standaloneGroup || !componentGroup || !menu || menu.hidden) return;
    componentGroup.classList.remove('opens-left', 'opens-below', 'opens-above');
    const options = componentGroup.querySelector('.sticker-component-create-options');
    const width = parseFloat(getComputedStyle(options).width);
    const rect = menu.getBoundingClientRect();
    const left = rect.left - 8;
    const right = window.innerWidth - rect.right - 8;
    if (right >= width + 220 || (right >= width && left < width)) return;
    if (left >= width) componentGroup.classList.add('opens-left');
    else {
      componentGroup.classList.add('opens-below');
      if (window.innerHeight - rect.bottom < 100 && rect.top >= 100) componentGroup.classList.add('opens-above');
    }
  }

  function orientStickyColors() {
    if (!standaloneGroup || !stickyGroup) return;
    const colors = stickyGroup.querySelector('.sticky-color-options');
    if (!colors) return;
    stickyGroup.classList.remove('opens-left', 'opens-below', 'opens-above');
    const rect = stickyGroup.getBoundingClientRect();
    const width = parseFloat(getComputedStyle(colors).width);
    const left = rect.left - 8;
    const right = window.innerWidth - rect.right - 8;
    if (componentGroup.classList.contains('opens-below')) stickyGroup.classList.add('opens-below');
    else if (componentGroup.classList.contains('opens-left') && left >= width) stickyGroup.classList.add('opens-left');
    else if (right < width && left >= width) stickyGroup.classList.add('opens-left');
    else if (right < width) stickyGroup.classList.add('opens-below');
    if (stickyGroup.classList.contains('opens-below') && window.innerHeight - rect.bottom < 110 && rect.top >= 110) stickyGroup.classList.add('opens-above');
  }

  function orientPicker() {
    if (!picker || !stickerGroup) return;
    stickerGroup.classList.remove('opens-left', 'opens-below', 'opens-above');
    picker.style.top = '0px';
    const rect = stickerGroup.getBoundingClientRect();
    const width = parseFloat(getComputedStyle(picker).width);
    const left = rect.left - 8;
    const right = window.innerWidth - rect.right - 8;
    if (componentGroup?.classList.contains('opens-below')) stickerGroup.classList.add('opens-below');
    else if (componentGroup?.classList.contains('opens-left') && left >= width) stickerGroup.classList.add('opens-left');
    else if (right < width && left >= width) stickerGroup.classList.add('opens-left');
    else if (right < width) stickerGroup.classList.add('opens-below');
    if (stickerGroup.classList.contains('opens-below')) {
      if (window.innerHeight - rect.bottom < 140 && rect.top >= 140) stickerGroup.classList.add('opens-above');
    } else {
      const height = Math.min(320, window.innerHeight - 16);
      picker.style.top = `${Math.min(0, window.innerHeight - rect.top - height - 8)}px`;
    }
  }

  function onStandbyContextMenu(event) {
    if (event.target.closest('.sticker-card, .standby-calendar, .sticky-note, button, .task-card')) return;
    const bounds = layer.getBoundingClientRect();
    point = {
      x: (event.clientX - bounds.left) / Math.max(bounds.width, 1) * 100,
      y: (event.clientY - bounds.top) / Math.max(bounds.height, 1) * 100,
    };
    orientComponentMenu();
    void refreshCatalog(true);
  }

  function onStandbyClick(event) {
    if (!activeDraftId || event.target.closest('.sticker-card, .sticky-note, .standby-calendar, .task-card, button, input, textarea')) return;
    finishDraft();
  }

  function onLayerContextMenu(event) {
    const card = event.target.closest('.sticker-card');
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    selectedId = card.dataset.stickerId;
    if (menu) menu.hidden = true;
    positionMenu(removalMenu, event.clientX, event.clientY);
  }

  function onRemove() {
    if (!selectedId) return;
    if (selectedId === activeDraftId) activeDraftId = null;
    placed = placed.filter(item => item.id !== selectedId);
    save();
    hideRemovalMenu();
    renderPlaced();
  }

  function onPointerDown(event) {
    if (event.button !== 0 || gesture) return;
    const card = event.target.closest('.sticker-card');
    if (!card) return;
    const item = placed.find(value => value.id === card.dataset.stickerId);
    if (!item) return;
    const resizing = item.draft && Boolean(event.target.closest('.sticker-resize'));
    const image = card.querySelector('img');
    const ratio = image?.naturalWidth ? image.naturalHeight / image.naturalWidth : 1;
    gesture = { id: item.id, pointerId: event.pointerId, resizing, ratio, x: event.clientX, y: event.clientY,
      originX: Number(item.x) || 0, originY: Number(item.y) || 0, width: item.width };
    card.classList.add(resizing ? 'is-resizing' : 'is-dragging');
    card.setPointerCapture(event.pointerId);
    hideRemovalMenu();
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const card = layer.querySelector(`[data-sticker-id="${CSS.escape(gesture.id)}"]`);
    const item = placed.find(value => value.id === gesture.id);
    if (!card || !item) return;
    const bounds = layer.getBoundingClientRect();
    if (gesture.resizing) {
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy / gesture.ratio;
      const availableWidth = bounds.width * (1 - item.x / 100) - 8;
      const availableHeight = bounds.height * (1 - item.y / 100) - 8;
      const maxWidth = Math.max(minStickerWidth, Math.min(maxStickerWidth, availableWidth, availableHeight / gesture.ratio));
      item.width = clamp(gesture.width + delta, minStickerWidth, maxWidth);
      card.style.width = `${item.width}px`;
      return;
    }
    item.x = clamp(gesture.originX + (event.clientX - gesture.x) / Math.max(bounds.width, 1) * 100, 0, Math.max(0, 100 - card.offsetWidth / Math.max(bounds.width, 1) * 100));
    item.y = clamp(gesture.originY + (event.clientY - gesture.y) / Math.max(bounds.height, 1) * 100, 0, Math.max(0, 100 - card.offsetHeight / Math.max(bounds.height, 1) * 100));
    card.style.left = `${item.x}%`;
    card.style.top = `${item.y}%`;
  }

  function onPointerEnd(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    layer.querySelector(`[data-sticker-id="${CSS.escape(gesture.id)}"]`)?.classList.remove('is-dragging', 'is-resizing');
    gesture = null;
    save();
  }

  function onDocumentPointerDown(event) {
    if (!event.target.closest('.sticker-remove-menu')) hideRemovalMenu();
    if (!event.target.closest('.sticker-create-group')) closePicker();
  }

  function installCreateMenu() {
    if (!menu || !stickyGroup || !stickyButton) return;
    componentGroup = menu.querySelector('.calendar-component-create-group');
    let options = componentGroup?.querySelector('.calendar-component-create-options');
    if (!options) {
      standaloneGroup = document.createElement('div');
      standaloneGroup.className = 'sticker-component-create-group';
      standaloneGroup.innerHTML = '<button class="sticker-component-create-trigger" type="button" aria-haspopup="menu">＋ 创建组件 <span>›</span></button><div class="sticker-component-create-options" role="menu"></div>';
      componentGroup = standaloneGroup;
      options = standaloneGroup.querySelector('.sticker-component-create-options');
      stickyButton.innerHTML = '便签 <span>›</span>';
      options.append(stickyGroup);
      menu.prepend(standaloneGroup);
      menu.setAttribute('aria-label', '组件操作');
      standaloneGroup.addEventListener('pointerenter', orientComponentMenu);
      standaloneGroup.addEventListener('focusin', orientComponentMenu);
      stickyGroup.addEventListener('pointerenter', orientStickyColors);
      stickyGroup.addEventListener('focusin', orientStickyColors);
      cleanup.push(() => {
        standaloneGroup.removeEventListener('pointerenter', orientComponentMenu);
        standaloneGroup.removeEventListener('focusin', orientComponentMenu);
        stickyGroup.removeEventListener('pointerenter', orientStickyColors);
        stickyGroup.removeEventListener('focusin', orientStickyColors);
        stickyGroup.classList.remove('opens-left', 'opens-below', 'opens-above');
        stickyButton.innerHTML = originalStickyMarkup;
        if (originalStickyParent) originalStickyParent.insertBefore(stickyGroup, originalStickyNext);
        standaloneGroup.remove();
        menu.setAttribute('aria-label', '便签操作');
      });
    }
    stickerGroup = document.createElement('div');
    stickerGroup.className = 'sticker-create-group';
    stickerGroup.innerHTML = '<button class="sticker-create-trigger" type="button" aria-haspopup="menu" aria-expanded="false">贴纸 <span>›</span></button><div class="sticker-picker" data-component-submenu role="menu"><p class="sticker-picker-status">正在读取贴纸…</p></div>';
    picker = stickerGroup.querySelector('.sticker-picker');
    options.append(stickerGroup);
    stickerGroup.addEventListener('pointerenter', orientPicker);
    stickerGroup.addEventListener('focusin', orientPicker);
    stickerGroup.addEventListener('pointerenter', () => void refreshCatalog());
    stickerGroup.querySelector('.sticker-create-trigger').addEventListener('click', () => {
      stickerGroup.classList.toggle('is-open');
      stickerGroup.querySelector('.sticker-create-trigger').setAttribute('aria-expanded', String(stickerGroup.classList.contains('is-open')));
      orientPicker();
      void refreshCatalog(true);
    });
    picker.addEventListener('click', event => {
      const button = event.target.closest('[data-texture-name]');
      if (button) addSticker(button.dataset.textureName);
    });
    cleanup.push(() => stickerGroup.remove());
  }

  installCreateMenu();
  standby?.addEventListener('contextmenu', onStandbyContextMenu);
  standby?.addEventListener('click', onStandbyClick);
  layer.addEventListener('contextmenu', onLayerContextMenu);
  layer.addEventListener('pointerdown', onPointerDown);
  layer.addEventListener('pointermove', onPointerMove);
  layer.addEventListener('pointerup', onPointerEnd);
  layer.addEventListener('pointercancel', onPointerEnd);
  removalMenu.querySelector('button').addEventListener('click', onRemove);
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  const configTimer = window.setInterval(refreshConfig, 10000);
  window.addEventListener('focus', refreshConfig);
  renderPlaced();
  void refreshConfig();

  return () => {
    window.clearInterval(configTimer);
    thumbnailObserver?.disconnect();
    window.removeEventListener('focus', refreshConfig);
    standby?.removeEventListener('contextmenu', onStandbyContextMenu);
    standby?.removeEventListener('click', onStandbyClick);
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    removalMenu.remove();
    for (const dispose of cleanup.reverse()) dispose();
  };
}
