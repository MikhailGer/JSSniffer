let allEvents = [];
let trackingEnabled = true;

/**
 * Добавляем универсальную функцию для пуша событий.
 * Если tabId undefined, пытаемся найти активную вкладку.
 */
function pushEvent(eventObj, fallbackTabId) {
  // Если нету явного tabId (или он 0/undefined),
  // пытаемся вычислить через fallbackTabId или через активную вкладку
  let finalTabId = eventObj.tabId ?? fallbackTabId;

  // Если всё ещё нет tabId, пробуем взять активную вкладку текущего окна
  if (!finalTabId) {
    chrome.windows.getCurrent({populate: true}, (win) => {
      if (!win) {
        // Если окна нет, пушим без tabId
        allEvents.push(eventObj);
      } else {
        const active = win.tabs.find(t => t.active);
        const newTabId = active ? active.id : null;
        allEvents.push({ ...eventObj, tabId: newTabId });
      }
    });
    return;
  }

  // Если tabId успешно определён, кладём сразу
  allEvents.push({ ...eventObj, tabId: finalTabId });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'user_event') {
    if (trackingEnabled) {
      // Используем sender.tab?.id, если он есть
      const possibleTabId = sender.tab?.id;
      pushEvent({ ...message.event }, possibleTabId);
    }
  }
  if (message.type === 'get_events') {
    sendResponse({ events: allEvents });
    return true;
  }
  if (message.type === 'clear_events') {
    allEvents = [];
  }
  if (message.type === 'set_tracking') {
    trackingEnabled = message.enabled;
  }
  if (message.type === 'get_tracking_status') {
    sendResponse({ enabled: trackingEnabled });
    return true;
  }
});

// Логирование активации вкладок
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab && tab.url) {
      pushEvent({
        type: 'tab_activated',
        timestamp: Date.now(),
        data: { url: tab.url, title: tab.title },
        tabId: activeInfo.tabId
      });
    } else {
      pushEvent({
        type: 'tab_activated',
        timestamp: Date.now(),
        data: { url: '', title: '' },
        tabId: activeInfo.tabId
      });
    }
  });
});

// Логирование фокуса окна
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  chrome.windows.get(windowId, { populate: true }, (win) => {
    if (!win) return;
    const activeTab = win.tabs.find(t => t.active);
    let dataObj = {
      type: 'window_focus',
      timestamp: Date.now(),
      data: {}
    };
    if (activeTab) {
      dataObj.data.url = activeTab.url;
      dataObj.data.title = activeTab.title;
      dataObj.tabId = activeTab.id; // вот так дополним
    }
    pushEvent(dataObj, null);
  });
});
