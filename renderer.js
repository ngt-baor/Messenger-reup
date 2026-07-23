const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  SERVICE_MESSENGER,
  SERVICE_DISCORD,
  normalizeService,
  normalizeProfile,
  migrateProfiles,
  buildPartitionName,
  profilesForService: filterProfilesForService,
  pickProfileIdForService: pickIdForService,
} = require('./service-model');

const profilesList = document.getElementById('profiles-list');
const scrollUpBtn = document.getElementById('scroll-up');
const scrollDownBtn = document.getElementById('scroll-down');

let profileBadgeCounts = {};

// Load profiles + migrate legacy (missing service → messenger)
let profiles = [];
try {
  const saved = localStorage.getItem('mp_profiles');
  if (saved) profiles = JSON.parse(saved);
} catch(e) {}

{
  const migrated = migrateProfiles(profiles);
  profiles = migrated.profiles;
  if (migrated.changed) {
    localStorage.setItem('mp_profiles', JSON.stringify(profiles));
  }
}

const bootSettings = ipcRenderer.sendSync('get-settings') || {};
const lockSettings = {
  enabled: !!bootSettings.appLockEnabled,
  hash: bootSettings.appLockHash || '',
  timeout: bootSettings.appLockTimeout ?? 5,
};
let activeService = normalizeService(bootSettings.activeService);
let exclusiveService = bootSettings.exclusiveService !== false;
const lastProfileByService = {
  messenger: bootSettings.lastProfileByService?.messenger || null,
  discord: bootSettings.lastProfileByService?.discord || null,
};

if (profiles.length === 0) {
  const id = Date.now().toString();
  profiles = [{
    id,
    name: 'Nick 1',
    service: SERVICE_MESSENGER,
    partition: `persist:nick_${id}`,
  }];
  saveProfiles();
}

function profilesForService(service = activeService) {
  return filterProfilesForService(profiles, service);
}

function pickProfileIdForService(service) {
  return pickIdForService(profiles, service, lastProfileByService);
}

let activeProfileId = pickProfileIdForService(activeService) || profiles[0].id;
{
  const active = profiles.find((p) => p.id === activeProfileId);
  if (active) activeService = normalizeService(active.service);
}

function saveProfiles() {
  localStorage.setItem('mp_profiles', JSON.stringify(profiles));
  ipcRenderer.send('profiles-updated', profiles);
}

function updateServiceButtons() {
  const btnM = document.getElementById('btn-service-messenger');
  const btnD = document.getElementById('btn-service-discord');
  if (btnM) {
    btnM.classList.toggle('active', activeService === SERVICE_MESSENGER);
    btnM.setAttribute('aria-pressed', activeService === SERVICE_MESSENGER ? 'true' : 'false');
  }
  if (btnD) {
    btnD.classList.toggle('active', activeService === SERVICE_DISCORD);
    btnD.setAttribute('aria-pressed', activeService === SERVICE_DISCORD ? 'true' : 'false');
  }
  const addBtn = document.getElementById('btn-add-profile');
  if (addBtn) {
    addBtn.title = activeService === SERVICE_DISCORD
      ? 'Thêm tài khoản Discord'
      : 'Thêm tài khoản Messenger';
  }
}

function switchService(service) {
  const next = normalizeService(service);
  if (next === activeService && profilesForService(next).some((p) => p.id === activeProfileId)) {
    updateServiceButtons();
    return;
  }
  activeService = next;
  const list = profilesForService(next);
  if (list.length === 0) {
    // Empty service: show empty state; user thêm nick bằng +
    activeProfileId = null;
    renderSidebar();
    ipcRenderer.send('set-active-service', next);
    ipcRenderer.send('set-browserview-visibility', false);
    return;
  }
  const id = pickProfileIdForService(next);
  if (id) switchProfile(id);
  else renderSidebar();
}

// ============================================================
//  SCROLL ARROWS & DRAG SCROLL
// ============================================================
function updateScrollArrows() {
  if (!profilesList) return;
  const canScrollUp = profilesList.scrollTop > 0;
  const canScrollDown = profilesList.scrollTop + profilesList.clientHeight < profilesList.scrollHeight - 1;
  
  scrollUpBtn.classList.toggle('visible', canScrollUp);
  scrollDownBtn.classList.toggle('visible', canScrollDown);
}

// Scroll arrow buttons
let scrollInterval = null;
function startScrolling(direction) {
  stopScrolling();
  const step = direction === 'up' ? -4 : 4;
  scrollInterval = setInterval(() => {
    profilesList.scrollTop += step;
    updateScrollArrows();
  }, 16);
}
function stopScrolling() {
  if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null; }
}

scrollUpBtn.addEventListener('mousedown', () => startScrolling('up'));
scrollUpBtn.addEventListener('mouseup', stopScrolling);
scrollUpBtn.addEventListener('mouseleave', stopScrolling);
scrollDownBtn.addEventListener('mousedown', () => startScrolling('down'));
scrollDownBtn.addEventListener('mouseup', stopScrolling);
scrollDownBtn.addEventListener('mouseleave', stopScrolling);

// Click to scroll by one item
scrollUpBtn.addEventListener('click', () => {
  profilesList.scrollBy({ top: -50, behavior: 'smooth' });
  setTimeout(updateScrollArrows, 300);
});
scrollDownBtn.addEventListener('click', () => {
  profilesList.scrollBy({ top: 50, behavior: 'smooth' });
  setTimeout(updateScrollArrows, 300);
});

// Mouse drag scrolling on profiles list
let isDragging = false;
let dragStartY = 0;
let dragScrollTop = 0;

profilesList.addEventListener('mousedown', (e) => {
  // Only start drag if clicking on the list itself or between items
  isDragging = true;
  dragStartY = e.clientY;
  dragScrollTop = profilesList.scrollTop;
  profilesList.classList.add('dragging');
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  e.preventDefault();
  const diff = dragStartY - e.clientY;
  profilesList.scrollTop = dragScrollTop + diff;
  updateScrollArrows();
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    profilesList.classList.remove('dragging');
  }
});

// Mouse wheel scroll
profilesList.addEventListener('wheel', (e) => {
  e.preventDefault();
  profilesList.scrollTop += e.deltaY > 0 ? 50 : -50;
  updateScrollArrows();
}, { passive: false });

// Update arrows on content changes
const resizeObserver = new ResizeObserver(updateScrollArrows);
resizeObserver.observe(profilesList);

// ============================================================
//  RENDER SIDEBAR
// ============================================================
function updateProfileBadgeElement(badge, count) {
  if (!badge) return;
  badge.innerText = count > 9 ? '9+' : String(count);
  badge.style.display = count > 0 ? 'block' : 'none';
}

function renderSidebar() {
  profilesList.innerHTML = '';
  const visible = profilesForService(activeService);

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'profiles-empty';
    const label = activeService === SERVICE_DISCORD ? 'Discord' : 'Messenger';
    empty.innerHTML = `<strong>Chưa có nick ${label}</strong>Bấm + bên dưới để thêm và đăng nhập.`;
    profilesList.appendChild(empty);
  }

  visible.forEach(p => {
    const btn = document.createElement('div');
    btn.className = `profile-btn ${p.id === activeProfileId ? 'active' : ''}`;
    btn.title = p.name + ' (Click phải để đổi tên/xóa)';
    
    const span = document.createElement('span');
    span.innerText = p.name.charAt(0).toUpperCase();
    
    // Add avatar image if exists
    if (p.avatar) {
      const img = document.createElement('img');
      img.src = p.avatar.startsWith('http') ? p.avatar : `file://${p.avatar.replace(/\\/g, '/')}`;
      img.style.width = '100%'; img.style.height = '100%'; img.style.borderRadius = '50%';
      img.style.objectFit = 'cover'; img.style.position = 'absolute'; img.style.top = '0'; img.style.left = '0';
      img.onerror = () => {
        const current = profiles.find(x => x.id === p.id);
        if (current && current.avatar === p.avatar) {
          current.avatar = null;
          saveProfiles();
          renderSidebar();
        }
      };
      btn.appendChild(img);
      span.style.display = 'none';
    } else {
      btn.appendChild(span);
    }
    
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.id = `badge-${p.id}`;
    badge.innerText = '0';
    // Discord MVP: no unread badge cloning
    if (normalizeService(p.service) === SERVICE_DISCORD) {
      badge.style.display = 'none';
    } else if (profileBadgeCounts[p.id] > 0) {
      updateProfileBadgeElement(badge, profileBadgeCounts[p.id]);
    }
    btn.appendChild(badge);
    
    btn.onclick = () => switchProfile(p.id);
    
    btn.oncontextmenu = () => {
      openModal(p);
    };
    
    profilesList.appendChild(btn);
  });
  
  // Update scroll arrows after rendering
  setTimeout(updateScrollArrows, 50);
  updateServiceButtons();
}

function switchProfile(id) {
  const p = profiles.find(x => x.id === id);
  if (!p) return;
  activeProfileId = id;
  activeService = normalizeService(p.service);
  lastProfileByService[activeService] = id;
  renderSidebar();
  ipcRenderer.send('switch-profile', p);
}

// ============================================================
//  MODAL LOGIC
// ============================================================
let editingProfile = null;
let tempAvatarPath = null;
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const nameInput = document.getElementById('profile-name-input');
const avatarPreview = document.getElementById('avatar-preview');
const avatarImg = document.getElementById('avatar-img');
const avatarLetter = document.getElementById('avatar-letter');
const avatarInput = document.getElementById('avatar-input');

function closeProfileModal(beforeRestoreBrowserView) {
  modalOverlay.style.display = 'none';
  if (beforeRestoreBrowserView) beforeRestoreBrowserView();
  ipcRenderer.send('set-browserview-visibility', true);
}

function openModal(profileToEdit = null) {
  ipcRenderer.send('set-browserview-visibility', false);
  editingProfile = profileToEdit;
  tempAvatarPath = profileToEdit ? profileToEdit.avatar : null;
  const svcLabel = activeService === SERVICE_DISCORD ? 'Discord' : 'Messenger';
  modalTitle.innerText = profileToEdit
    ? `Chỉnh sửa tài khoản ${svcLabel}`
    : `Thêm tài khoản ${svcLabel}`;
  nameInput.value = profileToEdit ? profileToEdit.name : '';
  document.getElementById('modal-delete').style.display = profileToEdit ? 'block' : 'none';
  document.getElementById('modal-logout').style.display = profileToEdit ? 'flex' : 'none';
  
  updateAvatarPreview();
  modalOverlay.style.display = 'flex';
  nameInput.focus();
}

function updateAvatarPreview() {
  if (tempAvatarPath) {
    avatarImg.src = tempAvatarPath.startsWith('http') ? tempAvatarPath : `file://${tempAvatarPath.replace(/\\/g, '/')}`;
    avatarImg.style.display = 'block';
    avatarLetter.style.display = 'none';
  } else {
    avatarImg.style.display = 'none';
    avatarLetter.style.display = 'block';
    avatarLetter.innerText = nameInput.value ? nameInput.value.charAt(0).toUpperCase() : '+';
  }
}

nameInput.addEventListener('input', updateAvatarPreview);

avatarPreview.onclick = () => avatarInput.click();
document.getElementById('avatar-picker-text').addEventListener('click', () => avatarInput.click());
avatarInput.onchange = (e) => {
  if (e.target.files && e.target.files[0]) {
    tempAvatarPath = e.target.files[0].path;
    updateAvatarPreview();
  }
};

document.getElementById('modal-delete').onclick = () => {
  if (!editingProfile) return;
  const action = confirm(`Bạn có chắc chắn muốn XÓA tài khoản [${editingProfile.name}]?`);
  if (action) {
    const sameService = profilesForService(editingProfile.service);
    if (sameService.length <= 1 && normalizeService(editingProfile.service) === SERVICE_MESSENGER) {
      alert('Phải có ít nhất 1 tài khoản Messenger!');
      return;
    }
    if (sameService.length <= 1 && normalizeService(editingProfile.service) === SERVICE_DISCORD) {
      // Allow deleting last Discord account — list can be empty
    } else if (profiles.length <= 1) {
      alert('Phải có ít nhất 1 tài khoản!');
      return;
    }
    const deletedService = normalizeService(editingProfile.service);
    profiles = profiles.filter(x => x.id !== editingProfile.id);
    saveProfiles();
    ipcRenderer.send('delete-profile', editingProfile.id);
    if (activeProfileId === editingProfile.id) {
      const nextId = pickProfileIdForService(deletedService)
        || pickProfileIdForService(SERVICE_MESSENGER)
        || (profiles[0] && profiles[0].id);
      if (nextId) switchProfile(nextId);
      else {
        activeProfileId = null;
        renderSidebar();
      }
    } else {
      renderSidebar();
    }
    closeProfileModal();
  }
};

document.getElementById('modal-cancel').onclick = () => closeProfileModal();

document.getElementById('modal-save').onclick = () => {
  const name = nameInput.value.trim();
  if (!name) {
    alert('Vui lòng nhập tên tài khoản!');
    return;
  }
  
  if (editingProfile) {
    editingProfile.name = name;
    editingProfile.avatar = tempAvatarPath;
    if (!editingProfile.service) editingProfile.service = activeService;
  } else {
    // Sử dụng crypto UUID để tránh trùng ID
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString() + '_' + Math.random().toString(36).slice(2);
    const service = normalizeService(activeService);
    const partition = buildPartitionName(id, service);
    const p = { id, name, avatar: tempAvatarPath, partition, service };
    // Xóa sạch session cũ nếu tồn tại (đảm bảo không dùng cookie cũ)
    ipcRenderer.send('clear-new-profile-session', partition);
    profiles.push(p);
    activeProfileId = id;
    activeService = service;
  }
  
  saveProfiles();
  closeProfileModal(editingProfile ? renderSidebar : null);
  if (!editingProfile) switchProfile(activeProfileId);
};

// ── Nút Đăng xuất & Đăng nhập lại ──
document.getElementById('modal-logout').onclick = () => {
  if (!editingProfile) return;
  const profileName = editingProfile.name;
  const action = confirm(`Bạn có chắc muốn ĐĂNG XUẤT tài khoản [${profileName}]?\n\nThao tác này sẽ xóa toàn bộ cookie/session và cho phép bạn đăng nhập lại tài khoản khác.`);
  if (!action) return;

  const logoutBtn = document.getElementById('modal-logout');
  logoutBtn.classList.add('loading');
  logoutBtn.innerHTML = '<svg viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Đang đăng xuất...';

  // Xóa avatar cache
  editingProfile.avatar = null;
  saveProfiles();

  ipcRenderer.send('logout-profile', {
    id: editingProfile.id,
    name: editingProfile.name,
    partition: editingProfile.partition,
    service: normalizeService(editingProfile.service),
  });
};

// Nhận kết quả logout
ipcRenderer.on('logout-profile-done', (event, { id, success }) => {
  const logoutBtn = document.getElementById('modal-logout');
  if (success) {
    logoutBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Đã đăng xuất';
    logoutBtn.style.color = '#51cf66';
    logoutBtn.style.borderColor = '#51cf66';
    setTimeout(() => {
      closeProfileModal(() => {
        logoutBtn.classList.remove('loading');
        logoutBtn.style.color = '';
        logoutBtn.style.borderColor = '';
        renderSidebar();
      });
    }, 800);
  } else {
    logoutBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Lỗi, thử lại';
    logoutBtn.classList.remove('loading');
  }
});

document.getElementById('btn-add-profile').onclick = () => openModal();

// ============================================================
//  RIGHT SIDEBAR TOOLBAR
// ============================================================
let isDarkMode = true;
function applyThemeUi() {
  document.body.className = isDarkMode ? 'dark-mode' : 'light-mode';
  document.getElementById('icon-sun').style.display = isDarkMode ? 'none' : 'block';
  document.getElementById('icon-moon').style.display = isDarkMode ? 'block' : 'none';
}

const toggleDarkMode = () => {
  isDarkMode = !isDarkMode;
  applyThemeUi();
  ipcRenderer.send('set-theme', isDarkMode);
};
document.getElementById('btn-dark-mode').onclick = toggleDarkMode;
document.getElementById('btn-zoom-in').onclick = () => ipcRenderer.send('zoom-in');
document.getElementById('btn-zoom-out').onclick = () => ipcRenderer.send('zoom-out');
document.getElementById('btn-fs').onclick = () => ipcRenderer.send('toggle-fullscreen');
document.getElementById('btn-pin').onclick = () => {
  const btn = document.getElementById('btn-pin');
  const isPinned = btn.style.opacity === '1';
  btn.style.opacity = isPinned ? '0.4' : '1';
  ipcRenderer.send('toggle-always-on-top');
};
document.getElementById('btn-reload').onclick = () => ipcRenderer.send('reload-page');
document.getElementById('btn-home').onclick = () => ipcRenderer.send('go-home');
document.getElementById('btn-back').onclick = () => ipcRenderer.send('go-back');
document.getElementById('btn-settings').onclick = () => ipcRenderer.send('open-settings');
document.getElementById('btn-j2team').onclick = () => {
  require('electron').shell.openExternal('https://chromewebstore.google.com/detail/j2team-security/hmlcjjclebjnfohgmgikjfnbmfkigocc');
};

// Lock button — click: lock, right-click: settings
document.getElementById('btn-lock').onclick = () => {
  const ls = lockSettings;
  if (ls.enabled && ls.hash) {
    lockApp('verify');
  } else {
    lockApp('setup');
  }
};
document.getElementById('btn-lock').oncontextmenu = (e) => {
  e.preventDefault();
  openLockSettings();
};

// ============================================================
//  IPC UPDATES FROM MAIN
// ============================================================
ipcRenderer.on('update-profile-badge', (event, { id, count }) => {
  const p = profiles.find((x) => x.id === id);
  if (p && normalizeService(p.service) === SERVICE_DISCORD) {
    profileBadgeCounts[id] = 0;
    return;
  }
  const badge = document.getElementById(`badge-${id}`);
  updateProfileBadgeElement(badge, count);
  profileBadgeCounts[id] = count || 0;
  const totalCount = Object.values(profileBadgeCounts).reduce((a, b) => a + b, 0);
  ipcRenderer.send('update-badge', totalCount);
});

ipcRenderer.on('update-profile-avatar', (event, { id, avatarUrl }) => {
  const p = profiles.find(x => x.id === id);
  if (p) {
    const isAutoAvatar = !p.avatar || p.avatar.startsWith('http');
    if (isAutoAvatar && p.avatar !== avatarUrl) {
      p.avatar = avatarUrl;
      saveProfiles();
      renderSidebar();
    }
  }
});

// ============================================================
//  INIT
// ============================================================
const settings = bootSettings;
isDarkMode = settings.isDarkMode;
applyThemeUi();
if(settings.alwaysOnTop) {
  document.getElementById('btn-pin').style.opacity = '1';
}

document.getElementById('btn-service-messenger').onclick = () => switchService(SERVICE_MESSENGER);
document.getElementById('btn-service-discord').onclick = () => switchService(SERVICE_DISCORD);

ipcRenderer.send('profiles-updated', profiles);
if (activeProfileId) {
  switchProfile(activeProfileId);
} else {
  renderSidebar();
}

// ============================================================
//  APP LOCK MODULE
// ============================================================
const crypto = require('crypto');

const lockScreen = document.getElementById('lock-screen');
const pinDotsContainer = document.getElementById('pin-dots');
const lockMessage = document.getElementById('lock-message');
const pinKeys = document.querySelectorAll('.pin-key[data-key]');
const lockDisableBtn = document.getElementById('lock-disable-btn');

const lock = {
  mode: 'verify',    // 'verify' | 'setup' | 'confirm'
  enteredPin: '',
  setupPin: '',
  wrongAttempts: 0,
  idleTimer: null,
  isLocked: false,
};
function saveLockSettings(patch) {
  Object.assign(lockSettings, patch);
  ipcRenderer.send('save-lock-settings', patch);
}

function setLockMessage(text, state = '') {
  lockMessage.textContent = text;
  lockMessage.className = `lock-subtitle${state ? ` ${state}` : ''}`;
}


function hashPin(pin) {
  return crypto.createHash('sha256').update(pin + '_messlo_salt_2026').digest('hex');
}

function lockApp(mode) {
  lock.mode = mode || 'verify';
  lock.enteredPin = '';
  lock.setupPin = '';
  lock.isLocked = true;
  lockScreen.classList.add('active');
  ipcRenderer.send('set-browserview-visibility', false);
  updatePinDots();

  if (mode === 'setup') {
    setLockMessage('Tạo mã PIN mới (4 số)');
    lockDisableBtn.style.display = 'none';
  } else {
    setLockMessage('Nhập mã PIN để mở khoá');
    lockDisableBtn.style.display = 'none';
  }
}

function unlockApp() {
  lock.isLocked = false;
  lock.enteredPin = '';
  lock.wrongAttempts = 0;
  lockScreen.classList.remove('active');
  ipcRenderer.send('set-browserview-visibility', true);
  resetIdleTimer();
}

function updatePinDots() {
  const dots = pinDotsContainer.querySelectorAll('.pin-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('filled', i < lock.enteredPin.length);
  });
}

function handlePinKey(key) {
  if (key === 'delete') {
    lock.enteredPin = lock.enteredPin.slice(0, -1);
    updatePinDots();
    return;
  }
  if (lock.enteredPin.length >= 4) return;
  lock.enteredPin += key;
  updatePinDots();
  if (lock.enteredPin.length === 4) {
    setTimeout(handlePinComplete, 200);
  }
}

function handlePinComplete() {
  const ls = lockSettings;

  if (lock.mode === 'setup') {
    // Step 1: Save first entry
    lock.setupPin = lock.enteredPin;
    lock.enteredPin = '';
    lock.mode = 'confirm';
    setLockMessage('Xác nhận lại mã PIN');
    updatePinDots();

  } else if (lock.mode === 'confirm') {
    // Step 2: Confirm PIN match
    if (lock.enteredPin === lock.setupPin) {
      const hash = hashPin(lock.enteredPin);
      saveLockSettings({ enabled: true, hash });
      setLockMessage('Đã thiết lập mã PIN', 'success');
      setTimeout(unlockApp, 700);
    } else {
      setLockMessage('Không khớp! Nhập lại từ đầu', 'error');
      pinDotsContainer.classList.add('shake');
      setTimeout(() => {
        pinDotsContainer.classList.remove('shake');
        lock.mode = 'setup';
        lock.enteredPin = '';
        lock.setupPin = '';
        setLockMessage('Tạo mã PIN mới (4 số)');
        updatePinDots();
      }, 600);
    }

  } else if (lock.mode === 'verify') {
    // Verify PIN
    const hash = hashPin(lock.enteredPin);
    if (hash === ls.hash) {
      setLockMessage('Đã mở khoá', 'success');
      setTimeout(unlockApp, 300);
    } else {
      lock.wrongAttempts++;
      setLockMessage(`Sai mã PIN! (${lock.wrongAttempts}/5)`, 'error');
      pinDotsContainer.classList.add('shake');
      lock.enteredPin = '';
      setTimeout(() => {
        pinDotsContainer.classList.remove('shake');
        updatePinDots();
      }, 500);

      if (lock.wrongAttempts >= 5) {
        setLockMessage('Quá 5 lần sai. Đợi 30 giây...', 'error');
        pinKeys.forEach(k => k.disabled = true);
        setTimeout(() => {
          lock.wrongAttempts = 0;
          setLockMessage('Nhập mã PIN để mở khoá');
          pinKeys.forEach(k => k.disabled = false);
        }, 30000);
      }
    }
  }
}

// PIN pad click handlers
pinKeys.forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.getAttribute('data-key');
    if (key) handlePinKey(key);
  });
});

// Keyboard support on lock screen
document.addEventListener('keydown', (e) => {
  if (!lock.isLocked) return;
  if (e.key >= '0' && e.key <= '9') handlePinKey(e.key);
  else if (e.key === 'Backspace') handlePinKey('delete');
});

// Lock disable button (shown in footer)
lockDisableBtn.onclick = () => {
  if (confirm('Bạn có chắc muốn tắt khoá ứng dụng?')) {
    saveLockSettings({ enabled: false, hash: '' });
    unlockApp();
  }
};

// ============================================================
//  LOCK SETTINGS MODAL
// ============================================================
const lockSettingsOverlay = document.getElementById('lock-settings-overlay');
const lsToggle = document.getElementById('ls-toggle-lock');
const lsTimeout = document.getElementById('ls-timeout');
const lsChangePin = document.getElementById('ls-change-pin');
const lsRemovePin = document.getElementById('ls-remove-pin');

function syncLockSettingsControls() {
  const enabled = lockSettings.enabled;
  lsToggle.classList.toggle('on', enabled);
  lsChangePin.style.display = enabled ? 'block' : 'none';
  lsRemovePin.style.display = enabled ? 'block' : 'none';
}

function beginPinSetupFromSettings() {
  lockSettingsOverlay.style.display = 'none';
  lockApp('setup');
}

function closeLockSettings() {
  lockSettingsOverlay.style.display = 'none';
  ipcRenderer.send('set-browserview-visibility', true);
}

function openLockSettings() {
  syncLockSettingsControls();
  lsTimeout.value = String(lockSettings.timeout || 5);
  lockSettingsOverlay.style.display = 'flex';
  ipcRenderer.send('set-browserview-visibility', false);
}

lsToggle.onclick = () => {
  const ls = lockSettings;
  if (!ls.enabled) {
    // Enable: show setup PIN
    beginPinSetupFromSettings();
  } else {
    // Disable
    saveLockSettings({ enabled: false, hash: '' });
    syncLockSettingsControls();
    resetIdleTimer();
  }
};

lsTimeout.onchange = () => {
  saveLockSettings({ timeout: parseInt(lsTimeout.value) });
  resetIdleTimer();
};

lsChangePin.onclick = () => {
  beginPinSetupFromSettings();
};

lsRemovePin.onclick = () => {
  if (confirm('Xoá mã PIN? Khoá ứng dụng sẽ bị tắt.')) {
    saveLockSettings({ enabled: false, hash: '' });
    closeLockSettings();
    lsToggle.classList.remove('on');
    resetIdleTimer();
  }
};

document.getElementById('ls-close').onclick = () => closeLockSettings();

// ============================================================
//  IDLE DETECTION — Auto-lock after timeout
// ============================================================
function resetIdleTimer() {
  if (lock.idleTimer) clearTimeout(lock.idleTimer);
  const ls = lockSettings;
  if (ls.enabled && ls.timeout > 0) {
    lock.idleTimer = setTimeout(() => {
      if (ls.enabled && !lock.isLocked) lockApp('verify');
    }, ls.timeout * 60 * 1000);
  }
}

['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, () => {
    if (!lock.isLocked) resetIdleTimer();
  }, { passive: true });
});

// ============================================================
//  INIT LOCK — Lock on startup if enabled
// ============================================================
if (lockSettings.enabled && lockSettings.hash) {
  lockApp('verify');
}
resetIdleTimer();

// ============================================================
//  DOWNLOAD MANAGER MODULE
// ============================================================
const dlPanel = document.getElementById('download-panel');
const dlList = document.getElementById('dl-list');
const dlCount = document.getElementById('dl-count');
const dlEmpty = document.getElementById('dl-empty');
const dlToast = document.getElementById('dl-toast');

let downloads = []; // { id, filename, savePath, total, received, state, done }
let dlPanelOpen = false;

function setDownloadPanelOpen(open) {
  dlPanelOpen = Boolean(open);
  dlPanel.style.display = dlPanelOpen ? 'flex' : 'none';
}

// Toggle download panel
document.getElementById('btn-download').onclick = () => {
  setDownloadPanelOpen(!dlPanelOpen);
};
document.getElementById('dl-close').onclick = () => setDownloadPanelOpen(false);

// Close panel when clicking outside
document.addEventListener('click', (e) => {
  if (dlPanelOpen && !dlPanel.contains(e.target) && e.target.id !== 'btn-download' && !e.target.closest('#btn-download')) {
    setDownloadPanelOpen(false);
  }
});

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getDownloadPercent(download) {
  return download.total > 0 ? Math.round((download.received / download.total) * 100) : 0;
}

function getFileTypeLabel(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (!ext || ext === filename.toLowerCase()) return 'FILE';
  return ext.slice(0, 4).toUpperCase();
}

function showDlToast(prefix, filename = '') {
  dlToast.textContent = prefix;
  if (filename) {
    const name = document.createElement('b');
    name.textContent = filename;
    dlToast.appendChild(name);
  }
  dlToast.classList.add('show');
  setTimeout(() => dlToast.classList.remove('show'), 3000);
}

function createDownloadActionButton(title, svgMarkup, onClick) {
  const button = document.createElement('button');
  button.className = 'dl-action-btn';
  button.title = title;
  button.innerHTML = svgMarkup;
  button.addEventListener('click', onClick);
  return button;
}

function renderDownloads() {
  // Update count
  const activeCount = downloads.filter(d => !d.done).length;
  dlCount.textContent = downloads.length;
  dlCount.style.display = downloads.length > 0 ? 'inline' : 'none';
  dlEmpty.style.display = downloads.length === 0 ? 'block' : 'none';

  // Remove existing items (keep empty placeholder)
  dlList.querySelectorAll('.dl-item').forEach(el => el.remove());

  // Render each download (newest first)
  [...downloads].reverse().forEach(dl => {
    const item = document.createElement('div');
    item.className = 'dl-item';
    item.id = `dl-item-${dl.id}`;

    const pct = getDownloadPercent(dl);
    const iconClass = dl.done ? (dl.state === 'completed' ? 'dl-done' : 'dl-error') : '';
    const fileTypeLabel = getFileTypeLabel(dl.filename);
    const statusText = dl.done
      ? (dl.state === 'completed' ? 'Hoàn tất' : (dl.state === 'cancelled' ? 'Đã huỷ' : 'Lỗi'))
      : (dl.state === 'interrupted' ? 'Tạm dừng' : `${pct}%`);
    const sizeText = dl.total > 0
      ? `${formatBytes(dl.received)} / ${formatBytes(dl.total)}`
      : (dl.received > 0 ? formatBytes(dl.received) : 'Đang tải...');

    item.innerHTML = `
      <div class="dl-icon ${iconClass}"></div>
      <div class="dl-info">
        <div class="dl-filename"></div>
        <div class="dl-meta"><span></span><span>·</span><span></span></div>
        ${!dl.done ? '<div class="dl-progress-bar"><div class="dl-progress-fill"></div></div>' : ''}
      </div>
      <div class="dl-actions"></div>`;

    item.querySelector('.dl-icon').textContent = fileTypeLabel;
    const filenameEl = item.querySelector('.dl-filename');
    filenameEl.textContent = dl.filename;
    filenameEl.setAttribute('title', dl.filename);

    const metaSpans = item.querySelectorAll('.dl-meta span');
    metaSpans[0].textContent = statusText;
    metaSpans[2].textContent = sizeText;

    const progressFill = item.querySelector('.dl-progress-fill');
    if (progressFill) progressFill.style.width = `${pct}%`;

    const actions = item.querySelector('.dl-actions');
    if (dl.done && dl.state === 'completed') {
      actions.append(
        createDownloadActionButton(
          'Mở file',
          '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
          () => ipcRenderer.send('open-download-file', dl.savePath)
        ),
        createDownloadActionButton(
          'Mở thư mục',
          '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
          () => ipcRenderer.send('open-download-folder', dl.savePath)
        )
      );
    } else if (!dl.done) {
      actions.appendChild(createDownloadActionButton(
        'Huỷ',
        '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        () => ipcRenderer.send('cancel-download', dl.id)
      ));
    }

    dlList.insertBefore(item, dlEmpty);
  });
}

// IPC: Download events from main process
ipcRenderer.on('download-started', (event, data) => {
  downloads.push({ id: data.id, filename: data.filename, savePath: data.savePath, total: data.total, received: 0, state: 'progressing', done: false });
  renderDownloads();
  // Auto-open panel & show toast
  if (!dlPanelOpen) {
    setDownloadPanelOpen(true);
  }
  showDlToast('Bắt đầu tải: ', data.filename);
});

ipcRenderer.on('download-progress', (event, data) => {
  const dl = downloads.find(d => d.id === data.id);
  if (dl) {
    dl.received = data.received;
    dl.total = data.total || dl.total;
    dl.state = data.state;
    // Update progress bar directly for performance
    const fill = document.querySelector(`#dl-item-${dl.id} .dl-progress-fill`);
    const pct = getDownloadPercent(dl);
    if (fill) {
      fill.style.width = pct + '%';
      const metaSpans = document.querySelectorAll(`#dl-item-${dl.id} .dl-meta span`);
      if (metaSpans[0]) metaSpans[0].textContent = pct + '%';
      if (metaSpans[2]) metaSpans[2].textContent = `${formatBytes(dl.received)} / ${formatBytes(dl.total)}`;
    }
  }
});

ipcRenderer.on('download-done', (event, data) => {
  const dl = downloads.find(d => d.id === data.id);
  if (dl) {
    dl.done = true;
    dl.state = data.state;
    dl.savePath = data.savePath || dl.savePath;
    renderDownloads();
    if (data.state === 'completed') {
      showDlToast('Đã tải xong: ', data.filename);
    } else {
      showDlToast('Tải thất bại: ', data.filename);
    }
  }
});

// App update progress
const updateProgressOverlay = document.getElementById('update-progress-overlay');
const updateProgressHeading = document.getElementById('update-progress-heading');
const updateProgressStatus = document.getElementById('update-progress-status');
const updateProgressDetail = document.getElementById('update-progress-detail');
const updateProgressPercent = document.getElementById('update-progress-percent');
const updateProgressTrack = document.getElementById('update-progress-track');
const updateProgressFill = document.getElementById('update-progress-fill');
const updateProgressClose = document.getElementById('update-progress-close');
const updateInstallNow = document.getElementById('update-install-now');
const updateInstallLater = document.getElementById('update-install-later');
const updateReleaseNotes = document.getElementById('update-release-notes');

updateProgressClose.addEventListener('click', () => {
  ipcRenderer.send('close-update-progress');
});
updateInstallNow.addEventListener('click', () => {
  ipcRenderer.send('install-update-now');
});
updateInstallLater.addEventListener('click', () => {
  ipcRenderer.send('install-update-later');
});

ipcRenderer.on('update-progress-state', (event, state = {}) => {
  if (!state.visible) {
    updateProgressOverlay.classList.remove('visible');
    updateProgressOverlay.setAttribute('aria-hidden', 'true');
    return;
  }

  updateProgressOverlay.classList.add('visible');
  updateProgressOverlay.setAttribute('aria-hidden', 'false');
  updateProgressHeading.textContent = state.version
    ? `Đang cập nhật Messenger ${state.version}`
    : 'Đang cập nhật Messenger';

  const hasPercent = Number.isFinite(state.percent);
  const percent = hasPercent
    ? Math.max(0, Math.min(100, Math.round(state.percent)))
    : 0;

  updateProgressTrack.classList.toggle('indeterminate', !hasPercent && state.phase !== 'error');
  updateProgressFill.style.width = hasPercent ? `${percent}%` : '0';
  updateProgressPercent.textContent = state.phase === 'error'
    ? 'Lỗi'
    : (hasPercent ? `${percent}%` : '...');
  updateProgressClose.classList.toggle('visible', state.phase === 'error');
  updateInstallNow.classList.toggle('visible', state.phase === 'downloaded');
  updateInstallLater.classList.toggle('visible', state.phase === 'downloaded');
  updateReleaseNotes.textContent = state.releaseNotes || '';
  updateReleaseNotes.classList.toggle('visible', !!state.releaseNotes);

  if (state.phase === 'downloading') {
    updateProgressStatus.textContent = 'Đang tải bản cập nhật...';
    if (state.total > 0) {
      const speed = state.bytesPerSecond > 0
        ? ` · ${formatBytes(state.bytesPerSecond)}/s`
        : '';
      updateProgressDetail.textContent =
        `${formatBytes(state.transferred || 0)} / ${formatBytes(state.total)}${speed}`;
    } else {
      updateProgressDetail.textContent = 'Đang kết nối...';
    }
  } else if (state.phase === 'downloaded') {
    updateProgressStatus.textContent = 'Đã tải xong bản cập nhật';
    updateProgressDetail.textContent = 'Sẵn sàng cài đặt';
  } else if (state.phase === 'installing') {
    updateProgressStatus.textContent = 'Đang khởi động trình cài đặt...';
    updateProgressDetail.textContent = 'Messenger sẽ tự khởi động lại';
  } else if (state.phase === 'error') {
    updateProgressStatus.textContent = 'Không thể cập nhật Messenger';
    updateProgressDetail.textContent = state.message || 'Vui lòng thử lại sau.';
  } else {
    updateProgressStatus.textContent = 'Đang chuẩn bị cập nhật...';
    updateProgressDetail.textContent = 'Đang kết nối...';
  }
});
