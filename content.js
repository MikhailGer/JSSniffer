// content_v3.js – v3 desktop‑only: shadow DOM, frameChain, boundingRect, aria, pointer‑mods

let trackingEnabled = true;
let lastTimestamp = Date.now();
let lastClickData = null;
let lastClickTimeout = null;

/**************************
 *  Helpers – time & meta *
 *************************/
function getDelta() {
  const now = Date.now();
  const d = now - lastTimestamp;
  lastTimestamp = now;
  return d;
}

// ───── frame chain (index path from window.top to current frame) ─────
function getFrameChain() {
  const chain = [];
  let win = window;
  while (win !== win.top) {
    try {
      const parentWin = win.parent;
      const frames = parentWin.frames;
      let idx = -1;
      for (let i = 0; i < frames.length; i++) if (frames[i] === win) { idx = i; break; }
      chain.unshift(idx);
      win = parentWin;
    } catch (e) {
      // cross‑origin frame – прерываем (остальное сверху уже не корпится)
      break;
    }
  }
  return chain;
}

// ───── selector helpers ─────
function getSelector(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
  if (el.id) return `#${el.id}`;
  if (el === document.body) return 'body';
  const path = [];
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    let sel = el.nodeName.toLowerCase();
    if (el.className) sel += '.' + Array.from(el.classList).join('.');
    let sib = el, nth = 1;
    while ((sib = sib.previousElementSibling)) if (sib.nodeName === el.nodeName) nth++;
    sel += `:nth-of-type(${nth})`;
    path.unshift(sel);
    el = el.parentElement;
  }
  return path.join(' > ');
}

function getBounding(el) {
  try {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  } catch (_) { return null; }
}

// shallow shadowRoot path (tags)
function getShadowPath(el) {
  const segments = [];
  let n = el;
  while (n) {
    const root = n.getRootNode();
    if (root instanceof ShadowRoot) {
      const host = root.host;
      segments.unshift(host.tagName.toLowerCase());
      n = host;
    } else {
      break;
    }
  }
  return segments;
}

function getElementDescriptor(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return {};
  return {
    selector: getSelector(el),
    tag: el.tagName ? el.tagName.toLowerCase() : null,
    id: el.id || null,
    name: el.getAttribute('name') || null,
    classList: Array.from(el.classList || []),
    type: el.getAttribute('type') || null,
    placeholder: el.getAttribute('placeholder') || null,
    text: el.innerText ? el.innerText.trim() : null,
    role: el.getAttribute('role') || null,
    ariaLabel: el.getAttribute('aria-label') || null,
    boundingRect: getBounding(el),
    shadowPath: getShadowPath(el)
  };
}

function getPointerMeta(ev) {
  return {
    pointerType: ev.pointerType || 'mouse',
    buttons: ev.buttons,
    ctrlKey: ev.ctrlKey,
    shiftKey: ev.shiftKey,
    altKey: ev.altKey,
    metaKey: ev.metaKey
  };
}

/**************************
 *  Event dispatcher       *
 *************************/
function sendEvent(type, data) {
  if (!trackingEnabled) return;
  chrome.runtime.sendMessage({
    type: 'user_event',
    event: {
      type,
      timestamp: Date.now(),
      delta: getDelta(),
      frameChain: getFrameChain(),
      data
    }
  });
}

/**************************
 *  Gesture markers        *
 *************************/
document.addEventListener('click',   () => lastClickData = Date.now(), true);
document.addEventListener('keydown', () => lastClickData = Date.now(), true);
document.addEventListener('submit',  () => lastClickData = Date.now(), true);

/**************************
 *  Main listeners         *
 *************************/

function handleClick(e) {
  const clickable = e.target.closest('a, button, [onclick], [role="button"], .btn, .clickable');
  if (!clickable) return;

  const descriptor = getElementDescriptor(clickable);
  const clickData  = {
    x: e.clientX,
    y: e.clientY,
    ...descriptor,
    ...getPointerMeta(e),
    href: clickable.href || null,
    target: clickable.target || null
  };
  sendEvent('click', clickData);

  // ——— навигационные ссылки
  if (clickable.tagName === 'A' && clickable.href && !clickable.href.startsWith('javascript:')) {
    e.preventDefault();
    sendEvent('navigate_intent', {
      href: clickable.href,
      ...descriptor,
      was_recent_click: true,
      click_x: e.clientX,
      click_y: e.clientY
    });
    setTimeout(() => {
      if (clickable.target && clickable.target.toLowerCase() === '_blank') {
        window.open(clickable.href, '_blank');
      } else {
        window.location.href = clickable.href;
      }
    }, 120);
  }
}

function setupListeners() {
  if (!document.body) return setTimeout(setupListeners, 300);

  // core interactions
  document.addEventListener('click', handleClick, true);

  document.addEventListener('submit', e => {
    const formDesc = getElementDescriptor(e.target);
    sendEvent('form_submit', { ...formDesc, action: e.target.action, method: e.target.method });
    sendEvent('navigate_intent', { href: e.target.action, ...formDesc });
  });

  // nav lifecycle
  window.addEventListener('beforeunload', () => sendEvent('beforeunload', { url: location.href }));
  window.addEventListener('load',         () => sendEvent('completed_navigation', { url: location.href, title: document.title }));
  window.addEventListener('popstate',     () => sendEvent('history_popstate', { url: location.href }));

  const push = history.pushState;
  history.pushState = function() { push.apply(this, arguments); sendEvent('history_pushstate', { url: location.href }); };
  const replace = history.replaceState;
  history.replaceState = function() { replace.apply(this, arguments); sendEvent('history_replacestate', { url: location.href }); };

  // keys / input
  document.addEventListener('keydown', e => {
    sendEvent('keydown', {
      key: e.key,
      code: e.code,
      repeat: e.repeat,
      ...getPointerMeta(e),
      ...getElementDescriptor(e.target)
    });
  });

  document.addEventListener('input', e => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) {
      sendEvent('input', { value: e.target.value || e.target.innerText, ...getElementDescriptor(e.target) });
    }
  });

  // hover / mouse‑move
  let lastHover = null;
  document.addEventListener('mouseover', e => {
    const d = getElementDescriptor(e.target);
    if (d.selector !== lastHover) {
      lastHover = d.selector;
      sendEvent('hover', { ...d, ...getPointerMeta(e) });
    }
  });

  let mouseT;
  document.addEventListener('mousemove', e => {
    clearTimeout(mouseT);
    mouseT = setTimeout(() => sendEvent('mouse_move', {
      x: e.clientX, y: e.clientY, ...getPointerMeta(e), ...getElementDescriptor(e.target)
    }), 100);
  });

  // wheel / scroll
  window.addEventListener('wheel', e => {
    sendEvent('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, ...getPointerMeta(e) });
  }, { passive: true });

  let scrollT;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollT);
    scrollT = setTimeout(() => sendEvent('scroll', { x: scrollX, y: scrollY }), 150);
  }, { passive: true });

  /***********************************
   *  Gentle MutationObserver v2      *
   ***********************************/
  const queue = [];
  const observer = new MutationObserver(list => {
    const added = list.flatMap(m => [...m.addedNodes]).filter(n => n.nodeType === 1 && n.tagName !== 'SCRIPT');
    if (!added.length) return;
    queue.push(...added.map(n => ({ selector: getSelector(n), tag: n.tagName.toLowerCase(), shadowPath: getShadowPath(n) })));
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(() => { if (queue.length) sendEvent('dom_batch', queue.splice(0)); }, 200);
}

setupListeners();
