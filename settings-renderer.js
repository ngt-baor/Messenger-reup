const fields = {
  versionText: document.getElementById('version-text'),
  updateStatus: document.getElementById('update-status'),
  updateBadge: document.getElementById('update-badge'),
  updateProgress: document.getElementById('update-progress'),
  updateProgressBar: document.getElementById('update-progress-bar'),
  updateAction: document.getElementById('update-action'),
  autoLaunch: document.getElementById('auto-launch'),
  minimizeToTray: document.getElementById('minimize-to-tray'),
  sleepBackground: document.getElementById('sleep-background'),
  blockSeen: document.getElementById('block-seen'),
  blockTyping: document.getElementById('block-typing'),
  clearCache: document.getElementById('clear-cache'),
  clearSession: document.getElementById('clear-session'),
  openUserData: document.getElementById('open-user-data'),
};

const optionMap = new Map([
  [fields.autoLaunch, 'autoLaunch'],
  [fields.minimizeToTray, 'minimizeToTray'],
  [fields.sleepBackground, 'sleepBackgroundProfiles'],
  [fields.blockSeen, 'blockSeen'],
  [fields.blockTyping, 'blockTyping'],
]);

function renderState(state = {}) {
  const settings = state.settings || {};
  const update = state.update || {};

  fields.versionText.textContent = `v${state.version || 'không rõ'}`;
  fields.autoLaunch.checked = !!settings.autoLaunch;
  fields.minimizeToTray.checked = !!settings.minimizeToTray;
  fields.sleepBackground.checked = !!settings.sleepBackgroundProfiles;
  fields.blockSeen.checked = !!settings.blockSeen;
  fields.blockTyping.checked = !!settings.blockTyping;

  if (update.downloading) {
    const percent = Math.max(0, Math.min(100, Number(update.percent) || 0));
    fields.updateStatus.textContent = `Đang tải bản cập nhật v${update.version || ''}...`;
    fields.updateBadge.textContent = `${Math.round(percent)}%`;
    fields.updateBadge.className = 'status-badge active';
    fields.updateProgress.hidden = false;
    fields.updateProgressBar.style.width = `${percent}%`;
    fields.updateAction.textContent = 'Đang tải';
    fields.updateAction.disabled = true;
  } else if (update.downloaded) {
    fields.updateStatus.textContent = `Bản cập nhật v${update.version} đã tải xong.`;
    fields.updateBadge.textContent = 'Đã tải xong';
    fields.updateBadge.className = 'status-badge active';
    fields.updateAction.textContent = 'Cài ngay';
    fields.updateAction.disabled = false;
  } else if (update.available) {
    fields.updateStatus.textContent = `Có bản cập nhật mới v${update.version}.`;
    fields.updateBadge.textContent = 'Có bản mới';
    fields.updateBadge.className = 'status-badge active';
    fields.updateAction.textContent = 'Tải bản cập nhật';
    fields.updateAction.disabled = false;
  } else if (update.error) {
    fields.updateStatus.textContent = `Lỗi cập nhật: ${update.error}`;
    fields.updateBadge.textContent = 'Có lỗi';
    fields.updateBadge.className = 'status-badge error';
    fields.updateAction.textContent = 'Kiểm tra lại';
    fields.updateAction.disabled = false;
  } else {
    fields.updateStatus.textContent = 'Chưa có thông tin cập nhật mới.';
    fields.updateBadge.textContent = 'Sẵn sàng';
    fields.updateBadge.className = 'status-badge';
    fields.updateAction.textContent = 'Kiểm tra cập nhật';
    fields.updateAction.disabled = false;
  }

  if (!update.downloading) {
    fields.updateProgress.hidden = true;
    fields.updateProgressBar.style.width = '0%';
  }
}

async function refreshState() {
  renderState(await window.settingsApi.getState());
}

optionMap.forEach((key, input) => {
  input.addEventListener('change', async () => {
    renderState(await window.settingsApi.setOption(key, input.checked));
  });
});

fields.updateAction.addEventListener('click', async () => {
  fields.updateAction.disabled = true;
  renderState(await window.settingsApi.updateAction());
});

fields.clearCache.addEventListener('click', async () => {
  renderState(await window.settingsApi.clearCache(false));
});

fields.clearSession.addEventListener('click', async () => {
  renderState(await window.settingsApi.clearCache(true));
});

fields.openUserData.addEventListener('click', () => {
  window.settingsApi.openUserData();
});

window.settingsApi.onStateUpdated(renderState);
refreshState();
