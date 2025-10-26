/* Простая логика админ‑панели
   Режимы:
   - prefilled Issue: формирует ссылку и открывает страницу создания Issue в шаблонном репо
   - direct API: использует PAT и вызывает GitHub API (create from template + добавить data.json)

   ВНИМАНИЕ: direct API — небезопасно на чужом устройстве. Поменяйте TEMPLATE_* в UI.
*/

const $ = id => document.getElementById(id);
const statusEl = $('status');

// In-memory PAT (keeps token out of visible input when loaded from config.json or localStorage)
let IN_MEMORY_PAT = null;
function getPat(){
  try{
    if(IN_MEMORY_PAT) return IN_MEMORY_PAT;
    const saved = localStorage.getItem('admin_pat');
    if(saved) return saved;
  }catch(e){ /* ignore storage */ }
  const input = $('pat');
  return input? input.value : '';
}

function setStatus(text, err=false){
  statusEl.textContent = 'Статус: ' + text;
  statusEl.style.color = err ? '#9b2c2c' : '#0a6d0a';
}

// Шаблонные значения можно задать прямо в полях формы (index.html) — удобно для мобильного.

function buildIssueBody(){
  const title = $('title').value || $('repo').value || 'New client';
  const owner = $('owner').value || '';
  const repo = $('repo').value || '';
  const desc = $('desc').value || '';
  const image = $('image').value || '';
  // простой формат: ключ: значение строки
  return `client_name: ${title}\nowner: ${owner}\nrepo: ${repo}\ndescription: ${desc}\nimage: ${image}`;
}

function openPrefilledIssue(){
  const tplOwner = $('templateOwner').value || 'TEMPLATE_OWNER';
  const tplRepo = $('templateRepo').value || 'TEMPLATE_REPO';
  const issueTitle = ($('title').value || 'Создать клиента: ' + ($('repo').value || 'client')).trim();
  const body = buildIssueBody();
  const url = `https://github.com/${encodeURIComponent(tplOwner)}/${encodeURIComponent(tplRepo)}/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(body)}`;
  window.open(url, '_blank');
  setStatus('Открыта форма Issue в новой вкладке');
}

// --- Direct API (использовать осторожно) ---
async function directCreateRepo(){
  const pat = getPat();
  if(!pat){ setStatus('PAT не указан', true); return; }
  try{ localStorage.setItem('admin_pat', pat); }catch(e){}

  const tplOwner = $('templateOwner').value || 'TEMPLATE_OWNER';
  const tplRepo = $('templateRepo').value || 'TEMPLATE_REPO';
  const owner = $('owner').value || '';
  const repo = $('repo').value || '';
  if(!owner || !repo){ setStatus('Заполните owner и repo', true); return; }

  setStatus('Создаю репозиторий из шаблона...');

  // 1) Generate repo from template
  const genUrl = `https://api.github.com/repos/${tplOwner}/${tplRepo}/generate`;
  const genBody = {
    name: repo,
    owner: owner,
    private: false
  };

  try{
    const genResp = await fetch(genUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'token ' + pat,
        'Accept': 'application/vnd.github.baptiste-preview+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(genBody)
    });

    if(!genResp.ok){
      const text = await genResp.text();
      setStatus('Ошибка создания репо: ' + genResp.status + ' ' + text, true);
      return;
    }

    const genData = await genResp.json();
    const fullName = genData.full_name || `${owner}/${repo}`;
    setStatus('Репозиторий создан: ' + fullName);

    // 2) Создаем data.json в этом репо
    await createOrUpdateDataJson(pat, owner, repo);

    // 3) Готово — откроем Pages link (примерный)
    const pagesUrl = `https://${owner}.github.io/${repo}/`;
    setStatus('Готово. Открываю страницу: ' + pagesUrl);
    window.open(pagesUrl, '_blank');

  } catch(e){
    setStatus('Ошибка: ' + (e.message || e), true);
  }
}

async function createOrUpdateDataJson(pat, owner, repo){
  setStatus('Коммитим data.json...');
  const path = 'data.json';
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const dataObj = {
    title: $('title').value || '',
    description: $('desc').value || '',
    image: $('image').value || ''
  };
  const content = await encodeBase64(JSON.stringify(dataObj, null, 2));

  // Нужно узнать, есть ли файл — если есть, получить sha, иначе создать
  let existingSha = null;
  try{
    const getResp = await fetch(api, { headers: {'Authorization':'token '+pat, 'User-Agent':'admin-panel'} });
    if(getResp.ok){
      const g = await getResp.json();
      existingSha = g.sha;
    }
  }catch(e){ /* ignore */ }

  const body = {
    message: existingSha ? 'Update data.json via admin panel' : 'Create data.json via admin panel',
    content: content,
    branch: 'main'
  };
  if(existingSha) body.sha = existingSha;

  const putResp = await fetch(api, {
    method: 'PUT',
    headers: {
      'Authorization': 'token ' + pat,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if(!putResp.ok){
    const txt = await putResp.text();
    setStatus('Ошибка при записи data.json: ' + putResp.status + ' ' + txt, true);
    throw new Error('write failed');
  }
  setStatus('data.json успешно записан');
}

// UI handlers
$('btnIssue').addEventListener('click', e => { openPrefilledIssue(); });
$('btnDirect').addEventListener('click', e => { directCreateRepo(); });

// Send repository_dispatch to existing client repo to update data.json via workflow
async function sendRepositoryDispatch(){
  const pat = getPat();
  if(!pat){ setStatus('PAT не указан', true); return; }
  const owner = $('owner').value || '';
  const repo = $('repo').value || '';
  if(!owner || !repo){ setStatus('Заполните owner и repo', true); return; }

  const dataObj = {
    title: $('title').value || '',
    description: $('desc').value || '',
    image: $('image').value || ''
  };

  setStatus('Отправляю repository_dispatch...');
  const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const body = {
    event_type: 'update-data',
    client_payload: { data: dataObj }
  };

  try{
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'token ' + pat,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if(resp.ok || resp.status === 204){
      setStatus('Dispatch отправлен');
    } else {
      const txt = await resp.text();
      setStatus('Ошибка dispatch: ' + resp.status + ' ' + txt, true);
    }
  } catch(e){
    setStatus('Ошибка: ' + (e.message || e), true);
  }
}

$('btnDispatch').addEventListener('click', e => { sendRepositoryDispatch(); });

// Поддержка: вставка PAT в поле сохраняется в localStorage автоматически
$('pat').addEventListener('change', e => { try{ localStorage.setItem('admin_pat', e.target.value); IN_MEMORY_PAT = null; const pi = $('patIndicator'); if(pi) pi.textContent = ''; }catch(ex){} });

// При загрузке — подгрузим PAT если есть
window.addEventListener('load', () => {
  // If there is a saved PAT in localStorage, keep it in memory but do NOT put the raw token into the visible input.
  try{
    const saved = localStorage.getItem('admin_pat');
    if(saved){ IN_MEMORY_PAT = saved; const pi = $('patIndicator'); if(pi) pi.textContent = 'PAT загружен (скрыт)'; }
  }catch(e){}
  // try to load ./config.json in the same folder as this script (admin/config.json)
  loadConfig();
});

async function loadConfig(){
  try{
    // When opening files via file://, fetch('./config.json') is blocked by browser CORS.
    // Detect that and show a helpful message to the user.
    if(window.location && window.location.protocol === 'file:'){
      setStatus('Файлы открыты по file:// — браузер блокирует fetch. Запустите локальный HTTP‑сервер (напр.: `python -m http.server` или установите Live Server) и откройте панель через http://localhost:PORT/admin/', true);
      return;
    }

    const resp = await fetch('./config.json');
    if(!resp.ok){ setStatus('config.json не найден: '+resp.status, true); return; }
    const j = await resp.json();
    Object.assign(CONFIG, j || {});
    // update UI
    if(CONFIG.templateOwner && !$('templateOwner').value) $('templateOwner').value = CONFIG.templateOwner;
    if(CONFIG.templateRepo && !$('templateRepo').value) $('templateRepo').value = CONFIG.templateRepo;
    if(CONFIG.filePath) $('filePath').value = CONFIG.filePath;
    const ownerDisplay = $('configOwner'); if(ownerDisplay) ownerDisplay.textContent = CONFIG.owner || '(not set)';
    // If config contains a PAT and user hasn't saved one in localStorage, keep it in memory
    // (do NOT write it into the visible input to avoid exposing the token)
    try{
      const savedPat = localStorage.getItem('admin_pat');
      if(CONFIG.pat && !savedPat){
        IN_MEMORY_PAT = CONFIG.pat;
        const patIndicator = $('patIndicator'); if(patIndicator) patIndicator.textContent = 'PAT загружен (скрыт)';
        setStatus('Admin token загружен из config', false);
      }
    }catch(e){ /* ignore storage errors */ }
  }catch(e){ setStatus('loadConfig failed: '+(e && e.message? e.message: e), true); }
}

// Мелкие вспомогательные функции
function btoa(str){
  // безопасный btoa
  return window.btoa(unescape(encodeURIComponent(str)));
}

// Safe base64 encode for large strings: encode UTF-8 and process in chunks
// Async base64 encoder that handles very large strings using Blob+FileReader if needed.
async function encodeBase64(str){
  try{
    // fast path
    return window.btoa(unescape(encodeURIComponent(str)));
  }catch(e){
    // fallback: use TextEncoder -> Blob -> FileReader.readAsDataURL to produce base64 reliably
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = (err) => reject(err || new Error('FileReader error'));
      fr.readAsDataURL(blob);
    });
    // dataUrl looks like: data:application/octet-stream;base64,AAAA...
    const idx = dataUrl.indexOf(',');
    return idx >= 0 ? dataUrl.substring(idx + 1) : dataUrl;
  }
}

// ========== New: start choice, repo list and editor logic ============

function show(el){ el.style.display = ''; }
function hide(el){ el.style.display = 'none'; }

const startChoice = $('startChoice');
const mainForm = $('mainForm');
const repoListCard = $('repoListCard');
const editorCard = $('editorCard');
const repoListEl = $('repoList');
const fileEditor = $('fileEditor');
const editorStatus = $('editorStatus');

// Config (loaded from ./config.json if present)
let CONFIG = {
  owner: null,
  templateOwner: null,
  templateRepo: null,
  filePath: null,
  defaultBranches: ['main','master']
};

// Default template owner/repo (can be overridden by config.json)
const FIXED_TEMPLATE_OWNER = () => CONFIG.templateOwner || $('templateOwner').placeholder || 'TEMPLATE_OWNER';
const FIXED_TEMPLATE_REPO = () => CONFIG.templateRepo || $('templateRepo').placeholder || 'TEMPLATE_REPO';

function setEditorStatus(t, err=false){ editorStatus.textContent = 'Статус: '+t; editorStatus.style.color = err? '#9b2c2c':'#0a6d0a'; }

// Start buttons
$('chooseCreate').addEventListener('click', () => {
  hide(startChoice);
  show(mainForm);
  show(editorCard);
  // prefill template owner/repo from constants if empty
  if(!$('templateOwner').value) $('templateOwner').value = FIXED_TEMPLATE_OWNER;
  if(!$('templateRepo').value) $('templateRepo').value = FIXED_TEMPLATE_REPO;
});

$('chooseEdit').addEventListener('click', () => {
  hide(startChoice);
  show(mainForm);
  show(repoListCard);
});

// List repos for given owner (user or org)
async function listRepos(){
  const owner = CONFIG.owner || $('owner').value || $('templateOwner').value;
  if(!owner){ setStatus('Укажите owner для списка репозиториев', true); return; }
  setStatus('Загружаю список репозиториев...');
  repoListEl.innerHTML = '';
  try{
    const resp = await fetch(`https://api.github.com/users/${owner}/repos`);
    if(!resp.ok){ setStatus('Ошибка получения списка: '+resp.status, true); return; }
    const arr = await resp.json();
    if(!Array.isArray(arr) || arr.length===0){ repoListEl.innerHTML = '<li>Репозиториев не найдено</li>'; setStatus('Готово'); return; }
    arr.sort((a,b)=> a.name.localeCompare(b.name));
    arr.forEach(r=>{
      const li = document.createElement('li');
      li.style.padding = '6px 0';
      li.innerHTML = `<button class="repoBtn" data-owner="${owner}" data-repo="${r.name}">${r.name}</button>`;
      repoListEl.appendChild(li);
    });
    setStatus('Список загружен');
  }catch(e){ setStatus('Ошибка: '+e.message, true); }
}

$('btnListRepos').addEventListener('click', listRepos);

// Click handler for repo buttons (event delegation)
repoListEl.addEventListener('click', async (ev)=>{
  const btn = ev.target.closest('button'); if(!btn) return;
  const owner = btn.dataset.owner; const repo = btn.dataset.repo;
  $('owner').value = owner; $('repo').value = repo;
  // show editor and load file
  show(editorCard); hide(repoListCard);
  await loadFileToEditor(owner, repo, $('filePath').value || 'Values.js');
});

// Load file content into editor (try raw first)
async function loadFileToEditor(owner, repo, path){
  setEditorStatus('Загружаю файл...');
  // normalize path: remove leading slashes
  const normPath = (path || 'Values.js').replace(/^\/+/, '');
  const branches = ['main','master'];
  try{
    for(const br of branches){
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${br}/${normPath}`;
      const r = await fetch(rawUrl);
      if(r.ok){ const txt = await r.text(); fileEditor.value = txt; setEditorStatus(`Файл загружен (raw, branch=${br})`); return; }
    }

    // fallback to API contents, try branches
    for(const br of branches){
      const api = `https://api.github.com/repos/${owner}/${repo}/contents/${normPath}?ref=${br}`;
      const r2 = await fetch(api);
      if(r2.ok){ const j = await r2.json(); const content = atob((j.content||'').replace(/\n/g,'')); fileEditor.value = content; setEditorStatus(`Файл загружен (API, branch=${br})`); return; }
    }

    setEditorStatus('Файл не найден в репо', true);
    fileEditor.value = '';
  }catch(e){ setEditorStatus('Ошибка: '+e.message, true); }
}

// Get sha of file if exists
async function getFileSha(owner, repo, path, pat){
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = pat? {'Authorization':'token '+pat}: {};
  const r = await fetch(api, {headers});
  if(r.ok){ const j = await r.json(); return j.sha; }
  return null;
}

// Save file via PUT /contents
async function saveFileToRepo(){
  const pat = getPat();
  if(!pat){ setEditorStatus('PAT не указан', true); return; }
  const owner = $('owner').value; const repo = $('repo').value; const path = $('filePath').value || 'Values.js';
  if(!owner || !repo){ setEditorStatus('Укажите owner и repo', true); return; }
  setEditorStatus('Сохраняю файл...');
  try{
  const content = await encodeBase64(fileEditor.value || '');
    const sha = await getFileSha(owner, repo, path, pat);
    const payload = { message: sha? 'Update Values.js via admin':'Create Values.js via admin', content, branch:'main' };
    if(sha) payload.sha = sha;
    const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const resp = await fetch(api, { method:'PUT', headers:{ 'Authorization':'token '+pat, 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
    if(resp.ok){ setEditorStatus('Файл сохранён'); }
    else {
      // Try to parse JSON error to give helpful guidance for 403s
      let bodyText = '';
      try{
        const j = await resp.json(); bodyText = JSON.stringify(j);
      }catch(e){ try{ bodyText = await resp.text(); }catch(e2){ bodyText = '';} }
      if(resp.status === 403 && bodyText && bodyText.indexOf('Resource not accessible by personal access token')!==-1){
        setEditorStatus('Ошибка 403: токен не имеет доступа к ресурсу. Проверьте права PAT (repo / public_repo или fine‑grained доступ к репозиториям) и авторизацию SSO для организации. Подробнее: https://docs.github.com/rest/repos/contents#create-or-update-file-contents', true);
      } else {
        setEditorStatus('Ошибка сохранения: '+resp.status+' '+bodyText, true);
      }
    }
  }catch(e){ setEditorStatus('Ошибка: '+e.message, true); }
}

$('btnSaveFile').addEventListener('click', saveFileToRepo);

// Dispatch from editor (update via repository_dispatch)
async function dispatchFromEditor(){
  const pat = getPat(); if(!pat){ setEditorStatus('PAT не указан', true); return; }
  const owner = $('owner').value; const repo = $('repo').value; const path = $('filePath').value || 'Values.js';
  const dataObj = { file: fileEditor.value || '' };
  setEditorStatus('Отправляю dispatch...');
  try{
    const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
    const body = { event_type: 'update-data', client_payload: { data: { path, content: dataObj.file } } };
    const r = await fetch(url, { method:'POST', headers:{ 'Authorization':'token '+pat, 'Accept':'application/vnd.github+json', 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    if(r.ok || r.status===204){ setEditorStatus('Dispatch отправлен'); } else { const txt=await r.text(); setEditorStatus('Ошибка dispatch: '+r.status+' '+txt, true); }
  }catch(e){ setEditorStatus('Ошибка: '+e.message, true); }
}

const _btnDispatchFromEditor = $('btnDispatchFromEditor');
if(_btnDispatchFromEditor) _btnDispatchFromEditor.addEventListener('click', dispatchFromEditor);

