let trackingEnabled = true;
let lastTimestamp = Date.now();

function getDelta() {
  const now = Date.now();
  const delta = now - lastTimestamp;
  lastTimestamp = now;
  return delta;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'set_tracking') {
    trackingEnabled = message.enabled;
    console.log('[Sniffer] Трекинг теперь', trackingEnabled ? 'включён' : 'выключен');
  }
});

function getSelector(el) {
  if (el.id) return `#${el.id}`;
  if (el === document.body) return 'body';
  let path = [];
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    let selector = el.nodeName.toLowerCase();
    if (el.className) selector += '.' + Array.from(el.classList).join('.');
    let sibling = el, nth = 1;
    while ((sibling = sibling.previousElementSibling)) {
      if (sibling.nodeName === el.nodeName) nth++;
    }
    selector += `:nth-of-type(${nth})`;
    path.unshift(selector);
    el = el.parentElement;
  }
  return path.join(' > ');
}

function getElementDescriptor(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return {};
  return {
    selector: getSelector(el),
    tag: el.tagName?.toLowerCase() || null,
    id: el.id || null,
    name: el.getAttribute('name') || null,
    classList: Array.from(el.classList || []),
    type: el.getAttribute('type') || null,
    placeholder: el.getAttribute('placeholder') || null,
    text: el.innerText?.trim() || null
  };
}

function sendEvent(type, data) {
  if (!trackingEnabled) return;
  chrome.runtime.sendMessage({
    type: 'user_event',
    event: {
      type,
      timestamp: Date.now(),
      delta: getDelta(),
      data
    }
  });
}

function setupListeners() {
  if (!document.body) {
    setTimeout(setupListeners, 300);
    return;
  }

  // Навигация через ссылки
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && a.href && !a.href.startsWith('javascript:')) {
      sendEvent('navigate_intent', {
        href: a.href,
        target: a.target || null,
        ...getElementDescriptor(a)
      });
    }
  });

  // Навигация через отправку формы (например, Enter)
  document.addEventListener('submit', (e) => {
    const action = e.target.action;
    if (action && !action.startsWith('javascript:')) {
      sendEvent('navigate_intent', {
        href: action,
        target: e.target.target || null,
        ...getElementDescriptor(e.target)
      });
    }

    sendEvent('form_submit', {
      ...getElementDescriptor(e.target),
      action: e.target.action,
      method: e.target.method
    });
  });

  window.addEventListener('beforeunload', () => {
    sendEvent('beforeunload', { url: window.location.href });
  });

  window.addEventListener('load', () => {
    sendEvent('completed_navigation', {
      url: window.location.href,
      title: document.title
    });
  });

  window.addEventListener('popstate', () => {
    sendEvent('history_popstate', { url: window.location.href });
  });

  const origPush = history.pushState;
  history.pushState = function () {
    origPush.apply(this, arguments);
    sendEvent('history_pushstate', { url: window.location.href });
  };

  const origReplace = history.replaceState;
  history.replaceState = function () {
    origReplace.apply(this, arguments);
    sendEvent('history_replacestate', { url: window.location.href });
  };

  // Hover
  let lastHoverSelector = null;
  document.addEventListener('mouseover', (e) => {
    const desc = getElementDescriptor(e.target);
    if (desc.selector !== lastHoverSelector) {
      lastHoverSelector = desc.selector;
      sendEvent('hover', desc);
    }
  });

  // Mouse move
  let mouseTimeout;
  document.addEventListener('mousemove', (e) => {
    if (mouseTimeout) clearTimeout(mouseTimeout);
    mouseTimeout = setTimeout(() => {
      sendEvent('mouse_move', {
        x: e.clientX,
        y: e.clientY,
        ...getElementDescriptor(e.target)
      });
    }, 100);
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    sendEvent('keydown', {
      key: e.key,
      ...getElementDescriptor(e.target)
    });
  });

  // Input
  document.addEventListener('input', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
      sendEvent('input', {
        value: e.target.value,
        ...getElementDescriptor(e.target)
      });
    }
  });

  // Clicks
  document.addEventListener('click', (e) => {
    let target = e.target;
    if (target.tagName !== 'BUTTON' && target.tagName !== 'A') {
      while (target && target !== document.body) {
        if (
          (target.getAttribute('role') === 'button') ||
          target.classList.contains('btn') ||
          target.classList.contains('clickable') ||
          target.getAttribute('onclick')
        ) break;
        target = target.parentElement;
      }
    }
    if (target) {
      sendEvent('click', {
        x: e.clientX,
        y: e.clientY,
        href: target.href || null,
        target: target.target || null,
        ...getElementDescriptor(target)
      });
    }
  });

  // Scroll
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      sendEvent('scroll', {
        x: window.scrollX,
        y: window.scrollY
      });
    }, 200);
  });

  // DOM mutation
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          sendEvent('dom_added', {
            ...getElementDescriptor(node),
            outerHTML: node.outerHTML.slice(0, 300)
          });
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

setupListeners();
