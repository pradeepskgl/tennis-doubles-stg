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

  if (!setupComplete) {
    el.innerHTML = `
      <span class="small-note">Set admin passcode:</span>
      <input id="setupPasscode" type="password" placeholder="Min 4 chars" style="width:140px;">
      <button onclick="doSetup()">Set Passcode</button>
      <span id="setupError" class="error-msg"></span>
    `;
    return;
  }

  if (isAdmin) {
    el.innerHTML = `
      <span class="small-note">Admin session active</span>
      <button class="secondary" onclick="doLogout()">Logout</button>
    `;
    return;
  }

  el.innerHTML = `
    <input id="loginPasscode" type="password" placeholder="Admin passcode" style="width:140px;" onkeydown="if(event.key==='Enter') doLogin();">
    <button onclick="doLogin()">Login</button>
    <span id="loginError" class="error-msg"></span>
  `;
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
