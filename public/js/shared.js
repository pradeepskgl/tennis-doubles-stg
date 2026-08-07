let isAdmin = false;
let setupComplete = true;

async function checkAuth() {
  try {
    await Api.get('/api/auth/me');
    isAdmin = true;
  } catch (e) {
    isAdmin = false;
  }
}

async function checkSetup() {
  const status = await Api.get('/api/auth/status');
  setupComplete = status.setupComplete;
}

function renderNav(active) {
  const el = document.getElementById('navArea');
  if (!el) return;
  const items = [
    ['matches', '/', 'Matches'],
    ['standings', '/standings.html', 'Standings'],
    ['teams', '/teams.html', 'Teams']
  ];
  el.innerHTML = items.map(([key, href, label]) =>
    `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`
  ).join('');
}

function renderAuthArea() {
  const el = document.getElementById('authArea');
  if (!el) return;

  if (isAdmin) {
    el.innerHTML = `
      <span class="small-note">Admin session active</span>
      <button class="secondary" onclick="doLogout()">Logout</button>
    `;
    return;
  }

  el.innerHTML = `<a href="/admin" class="small-note">Admin login</a>`;
}

async function doSetup() {
  const passcode = document.getElementById('setupPasscode').value;
  try {
    await Api.post('/api/auth/setup', { passcode });
    setupComplete = true;
    renderAuthArea();
  } catch (e) {
    document.getElementById('setupError').textContent = e.message;
  }
}

async function doLogin() {
  const passcode = document.getElementById('loginPasscode').value;
  try {
    await Api.post('/api/auth/login', { passcode });
    isAdmin = true;
    renderAuthArea();
    if (typeof onAdminLogin === 'function') onAdminLogin();
  } catch (e) {
    document.getElementById('loginError').textContent = e.message;
  }
}

async function doLogout() {
  await Api.post('/api/auth/logout');
  isAdmin = false;
  renderAuthArea();
  if (typeof onAdminLogout === 'function') onAdminLogout();
}

async function initShared(activePage) {
  await checkAuth();
  await checkSetup();
  renderNav(activePage);
  renderAuthArea();
}
