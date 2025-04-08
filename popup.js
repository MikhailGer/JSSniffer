// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const downloadBtn = document.getElementById('download');
  const clearBtn = document.getElementById('clear');
  const stopBtn = document.getElementById('stop');
  const startBtn = document.getElementById('start');

  if (!downloadBtn || !clearBtn || !stopBtn || !startBtn) {
    console.warn('[popup.js] Кнопки не найдены!');
    return;
  }

  downloadBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'get_events' }, (response) => {
      const blob = new Blob([JSON.stringify(response.events, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `user_session_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  });

  clearBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'clear_events' });
    alert('Логи очищены');
  });

  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'set_tracking', enabled: false });
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            chrome.runtime.sendMessage({ type: 'set_tracking', enabled: false });
          }
        });
      }
    });
    alert('Трекинг остановлен на всех вкладках');
  });

  startBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'set_tracking', enabled: true });
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            chrome.runtime.sendMessage({ type: 'set_tracking', enabled: true });
          }
        });
      }
    });
    alert('Трекинг включён на всех вкладках');
  });
});
