/* Simple admin panel logic
    Modes:
    - prefilled Issue: opens a new Issue page in the template repo with prefilled body
    - direct API: uses a PAT to call GitHub API (generate repo from template and edit files)

    WARNING: direct API is unsafe on untrusted devices. Keep PAT secure and do not commit it.
*/

const $ = id => document.getElementById(id);
const statusEl = $('status');

// Default template repo configuration
const FIXED_TEMPLATE_OWNER = () => 'uraharrattg-wq';
const FIXED_TEMPLATE_REPO = () => 'Shablon1';

// In-memory PAT (keeps token out of visible input when loaded from config.json or localStorage)
let IN_MEMORY_PAT = null;
function getPat(){
   try{
      if(IN_MEMORY_PAT) {
         console.log('Используется токен из памяти');
         return IN_MEMORY_PAT;
      }
      const saved = localStorage.getItem('admin_pat');
      if(saved) {
         console.log('Используется токен из localStorage');
         return saved;
      }
   }catch(e){ 
      console.warn('Ошибка доступа к localStorage:', e);
   }
   const input = $('pat');
   if(!input) {
      console.warn('Элемент ввода PAT не найден');
      return '';
   }
   console.log('Используется токен из поля ввода');
   return input.value || '';
}

function setStatus(text, err=false){
   if(!statusEl) return;
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

// Parse template owner/repo inputs. Accepts either:
// - owner in `templateOwner` and repo in `templateRepo` (repo may be just name)
// - full URL in templateRepo like `https://github.com/owner/repo`
// - combined `owner/repo` in templateRepo
function parseTemplateOwnerRepo(){
   let owner = ($('templateOwner').value || '').trim();
   let repo = ($('templateRepo').value || '').trim();
   if(!repo) return { owner, repo };
   // If repo contains a full GitHub URL, extract owner and repo
   const urlMatch = repo.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/\s]+)\/([^\/\s]+)(?:\/.*)?/i);
   if(urlMatch){
      owner = owner || urlMatch[1];
      repo = urlMatch[2];
      return { owner, repo };
   }
   // If repo contains owner/repo
   const orMatch = repo.match(/^([^\/\s]+)\/([^\/\s]+)$/);
   if(orMatch){
      owner = owner || orMatch[1];
      repo = orMatch[2];
      return { owner, repo };
   }
   return { owner, repo };
}

function openPrefilledIssue(){
   const parsed = parseTemplateOwnerRepo();
   const tplOwner = parsed.owner || 'TEMPLATE_OWNER';
   const tplRepo = parsed.repo || 'TEMPLATE_REPO';
   const issueTitle = ($('title').value || 'Создать клиента: ' + ($('repo').value || 'client')).trim();
   const body = buildIssueBody();
   const url = `https://github.com/${encodeURIComponent(tplOwner)}/${encodeURIComponent(tplRepo)}/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(body)}`;
   window.open(url, '_blank');
   setStatus('Открыта форма Issue в новой вкладке');
}

// --- Direct API (использовать осторожно) ---
async function checkPatScopes(pat) {
   try {
      // Получаем настройки из конфига
      let config;
      try {
         const response = await fetch('config.json');
         if (!response.ok) throw new Error('Config fetch failed: ' + response.status);
         config = await response.json();
         console.log('Конфигурация загружена успешно');
      } catch (e) {
         console.error('Ошибка загрузки конфига:', e);
         // Используем дефолтные значения из констант
         config = {
            templateOwner: FIXED_TEMPLATE_OWNER(),
            templateRepo: FIXED_TEMPLATE_REPO()
         };
         console.log('Используются значения по умолчанию:', config);
      }
      
      // Сначала проверим права на repo через конкретный endpoint
      const repoResponse = await fetch('https://api.github.com/repos/' + config.templateOwner + '/' + config.templateRepo, {
         headers: {
            'Authorization': 'token ' + pat,
            'Accept': 'application/vnd.github+json'
         }
      });
      
      console.log('Проверка прав repo:', repoResponse.status);
      
      // Проверим права на workflow через другой endpoint
      const workflowResponse = await fetch('https://api.github.com/repos/' + config.templateOwner + '/' + config.templateRepo + '/actions/workflows', {
         headers: {
            'Authorization': 'token ' + pat,
            'Accept': 'application/vnd.github+json'
         }
      });
      
      console.log('Проверка прав workflow:', workflowResponse.status);
      
      // Проверим права на pages
      const pagesResponse = await fetch('https://api.github.com/repos/' + config.templateOwner + '/' + config.templateRepo + '/pages', {
         headers: {
            'Authorization': 'token ' + pat,
            'Accept': 'application/vnd.github+json'
         }
      });
      
      console.log('Проверка прав pages:', pagesResponse.status);
      
      // Проверяем результаты
      const hasRepo = repoResponse.ok;
      const hasWorkflow = workflowResponse.ok;
      const hasPages = pagesResponse.status !== 404;
      
      console.log('Результаты проверки прав:', {
         repo: hasRepo,
         workflow: hasWorkflow,
         pages: hasPages
      });
      
      // Выведем все заголовки и тело ответов для отладки
      console.log('Repo response:', await repoResponse.text());
      console.log('Workflow response:', await workflowResponse.text());
      console.log('Pages response:', await pagesResponse.text());
      
      const missing = [];
      if (!hasRepo) missing.push('repo');
      if (!hasWorkflow) missing.push('workflow');
      if (!hasPages) missing.push('pages');
      
      if (missing.length > 0) {
         return {
            valid: false,
            message: `Токену не хватает прав: ${missing.join(', ')}. Нужны права: repo, workflow, pages`
         };
      }
      
      return { valid: true };
      
      if(missing.length > 0) {
         return {
            valid: false,
            message: `Токену не хватает прав: ${missing.join(', ')}. Нужны права: repo, workflow, pages`
         };
      }
      
      return { valid: true };
   } catch(e) {
      return { valid: false, message: 'Ошибка проверки токена: ' + (e.message || e) };
   }
}

async function directCreateRepo(){
   const pat = getPat();
   if(!pat){ setStatus('PAT не указан', true); return; }
   
   // Проверяем права токена
   const check = await checkPatScopes(pat);
   if(!check.valid) {
      setStatus(check.message, true);
      showToast(check.message, false);
      return;
   }
   
   try{ localStorage.setItem('admin_pat', pat); }catch(e){}
   const parsed = parseTemplateOwnerRepo();
   const tplOwner = parsed.owner || 'TEMPLATE_OWNER';
   const tplRepo = parsed.repo || 'TEMPLATE_REPO';
   const owner = $('owner').value || '';
   const repo = $('repo').value || '';
   if(!owner || !repo){ setStatus('Заполните owner и repo', true); return; }

   setStatus('Создаю репозиторий из шаблона...');

   // 1) Generate repo from template
   const genUrl = `https://api.github.com/repos/${tplOwner}/${tplRepo}/generate`;
   console.log('Using template URL:', genUrl);
   
   const genBody = JSON.stringify({
      name: repo,
      description: "Generated from template",
      private: false,
      include_all_branches: false
   }, null, 2);

   try{
      setStatus('Проверяю существование шаблона...');
      const repoApi = `https://api.github.com/repos/${tplOwner}/${tplRepo}`;
      try{
         const checkResp = await fetch(repoApi, { method: 'GET', headers: { 'Authorization': 'token ' + pat, 'Accept':'application/vnd.github+json' } });
         if(!checkResp.ok){
            let txt = '';
            try{ const j = await checkResp.json(); txt = JSON.stringify(j); }catch(e){ try{ txt = await checkResp.text(); }catch(e2){ txt = ''; } }
            console.error('template repo check failed', checkResp.status, txt);
            if(checkResp.status === 404){
               const msg = 'Шаблон не найден: ' + repoApi + '. Проверьте templateOwner/templateRepo (можно вставить полный URL в поле Template repo).';
               setStatus(msg, true); showToast(msg, false); return;
            }
            const msg = 'Ошибка проверки шаблона: ' + checkResp.status + ' ' + txt;
            setStatus(msg, true); showToast(msg, false); return;
         }
         const info = await checkResp.json();
         if(!info.is_template){
            const msg = 'Репозиторий найден, но не отмечен как Template (Settings → Template repository). Проверьте шаблон: ' + repoApi;
            setStatus(msg, true); showToast(msg, false); console.warn('repo info', info); return;
         }
         // Verify template contains the configured filePath so new repos receive the file
         try{
            const pathToCheck = $('filePath').value || CONFIG.filePath || 'Values.js';
            const has = await templateHasFile(tplOwner, tplRepo, pathToCheck);
            if(!has){
               const msg = `Шаблон не содержит файл '${pathToCheck}' в default-ветке. Проверьте шаблон ${tplOwner}/${tplRepo} и путь.`;
               setStatus(msg, true); showToast(msg, false);
               return;
            }
         }catch(e2){ console.warn('template file check failed', e2); }
      }catch(e){ console.error('check template error', e); setStatus('Ошибка проверки шаблона: '+(e.message||e), true); showToast('Ошибка проверки шаблона', false); return; }

      // show final genUrl and body for debugging
      setStatus('Вызов API: ' + genUrl);
      console.log('generate repo url', genUrl);
      console.log('generate body', genBody);
      const genResp = await fetch(genUrl, {
         method: 'POST',
         headers: {
            'Authorization': 'token ' + pat,
            'Accept': 'application/vnd.github.baptiste-preview+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2020-07-01'
         },
         body: JSON.stringify({
            name: repo,
            description: "Generated from template",
            private: false,
            include_all_branches: true
         })
      });

      if(!genResp.ok){
         let bodyText = '';
         try{ const j = await genResp.json(); bodyText = JSON.stringify(j); }catch(e){ try{ bodyText = await genResp.text(); }catch(e2){ bodyText = ''; } }
         console.error('generate repo failed', genResp.status);
         console.log('Response headers:', Object.fromEntries(genResp.headers));
         console.log('Response body:', bodyText);
         try {
            console.log('Response JSON:', JSON.parse(bodyText));
         } catch(e) {
            console.log('Failed to parse response as JSON:', e);
         }
         // Provide targeted hints for common cases
         if(genResp.status === 404){
            const msg = 'Ошибка 404: шаблон не найден или путь некорректен. Проверьте templateOwner/templateRepo и что репозиторий является Template (в настройках GitHub). url: ' + genUrl;
            setStatus(msg, true);
            showToast(msg, false);
            return;
         }
         if(genResp.status === 403){
            // Тело ответа уже прочитано выше и сохранено в bodyText
            console.log('Полный ответ сервера 403:', bodyText);
            console.log('Заголовки ответа:');
            genResp.headers.forEach((value, key) => console.log(key + ': ' + value));
            
            const msg = 'Ошибка 403: недостаточно прав. Убедитесь, что PAT имеет scope repo и вы можете создавать репозитории в указанном owner (для организаций требуются права).';
            setStatus(msg + ' Response: ' + bodyText, true);
            showToast(msg, false);
            return;
         }
         // generic fallback
         setStatus('Ошибка создания репо: ' + genResp.status + ' ' + bodyText, true);
         showToast('Ошибка создания репо: ' + genResp.status, false);
         return;
      }

      const genData = await genResp.json();
      const fullName = genData.full_name || `${owner}/${repo}`;
      setStatus('Репозиторий создан: ' + fullName);

      // Убедимся что репозиторий публичный
      try {
        const updateUrl = `https://api.github.com/repos/${actualOwner}/${actualRepo}`;
        const updateResp = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'Authorization': 'token ' + pat,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            private: false,
            has_issues: true,
            has_wiki: false,
            has_projects: false
          })
        });
        
        if(updateResp.ok) {
          console.log('Repository settings updated successfully');
        } else {
          console.warn('Failed to update repository settings:', updateResp.status);
        }
      } catch(e) {
        console.warn('Error updating repository settings:', e);
      }
      // Use the actual owner/name returned by the API — GitHub may alter the repo name if requested name exists
      const actualOwner = (genData.owner && genData.owner.login) ? genData.owner.login : owner;
      const actualRepo = genData.name || repo;

      // Ждем пока репозиторий станет доступным
      setStatus('Ожидание инициализации репозитория...');
      let repoReady = false;
      for(let attempt = 1; attempt <= 5; attempt++) {
        try {
          const repoUrl = `https://api.github.com/repos/${actualOwner}/${actualRepo}`;
          console.log(`Checking if repository is ready (attempt ${attempt}/5)...`);
          const repoResp = await fetch(repoUrl, { 
            headers: { 
              'Authorization': 'token ' + pat, 
              'Accept': 'application/vnd.github+json' 
            } 
          });
          
          if(repoResp.ok) {
            const repoInfo = await repoResp.json();
            if(repoInfo.id) {
              console.log('Repository is ready:', repoInfo.full_name);
              repoReady = true;
              break;
            }
          }
          
          console.log(`Repository not ready yet (status: ${repoResp.status}), waiting 3 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch(e) {
          console.warn(`Error checking repository (attempt ${attempt}):`, e);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      if(!repoReady) {
        console.error('Repository did not become ready in time');
        setStatus('Ошибка: репозиторий не готов, попробуйте позже', true);
        return;
      }

      // Пробуем сразу загрузить файл values.js
      setStatus('Загружаю values.js...');
      let filesReady = false;
      for(let attempt = 1; attempt <= 5; attempt++) {
        try {
          const fileUrl = `https://api.github.com/repos/${actualOwner}/${actualRepo}/contents/FAKE/values.js`;
          console.log(`Checking values.js (attempt ${attempt}/5):`, fileUrl);
          const response = await fetch(fileUrl, { 
            headers: { 
              'Authorization': 'token ' + pat, 
              'Accept': 'application/vnd.github+json' 
            } 
          });
          
          if(response.ok) {
            const fileData = await response.json();
            console.log('Found values.js:', fileData);
            
            // Проверяем что это действительно файл и у него есть содержимое
            if(fileData && fileData.type === 'file' && fileData.content) {
              console.log('Confirmed values.js is a file with content');
              
              // Сразу декодируем и загружаем содержимое
              const content = decodeBase64Utf8(fileData.content);
              if(fileEditor) {
                fileEditor.value = content;
                console.log('File content loaded into editor, length:', content.length);
              }
              
              filesReady = true;
              break;
            }
          }
          
          console.log(`File not ready yet (status: ${response.status}), waiting 3 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch(e) {
          console.warn(`Error checking file (attempt ${attempt}):`, e);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      if(!filesReady) {
        console.error('Failed to load values.js content after all attempts');
        setStatus('Ошибка: не удалось загрузить содержимое values.js. Убедитесь, что файл существует в шаблоне и имеет содержимое', true);
        return;
      }

      // 2) Показать редактор сразу — файл берётся из шаблона. Откроем редактор и подождём, пока файл станет доступен.
      $('owner').value = actualOwner; $('repo').value = actualRepo;
      // Показываем редактор
      hide(repoListCard);
      hide(mainForm);
      show(editorCard);
      const editorElement = $('editorCard');
      if(editorElement) {
        console.log('Editor container visibility:', editorElement.style.display);
        console.log('Editor container dimensions:', {
          width: editorElement.offsetWidth,
          height: editorElement.offsetHeight
        });
      }
      
      const path = 'FAKE/values.js';
      console.log('Using path:', path);
      
      // Проверим наличие файла
      setEditorStatus('Проверяю наличие файла...');
      let fileExists = false;
      for(let attempt = 1; attempt <= 5; attempt++) {
        try {
          const fileUrl = `https://api.github.com/repos/${actualOwner}/${actualRepo}/contents/${path}`;
          console.log(`Checking if file exists (attempt ${attempt}/5): ${fileUrl}`);
          
          const fileResp = await fetch(fileUrl, { 
            headers: { 
              'Authorization': 'token ' + pat, 
              'Accept': 'application/vnd.github+json' 
            } 
          });
          
          if(fileResp.ok) {
            const fileData = await fileResp.json();
            if(fileData.content) {
              console.log('File found with content:', {
                name: fileData.name,
                size: fileData.size,
                encoding: fileData.encoding
              });
              fileExists = true;
              
              // Декодируем и загружаем содержимое сразу
              const content = decodeBase64Utf8(fileData.content);
              if(fileEditor) {
                fileEditor.value = content;
                console.log('File content loaded into editor, length:', content.length);
                console.log('Preview:', content.substring(0, 100) + '...');
              } else {
                console.error('fileEditor element not found!');
              }
              break;
            }
          }
          
          console.log(`File not ready yet (attempt ${attempt}), waiting 3 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch(e) {
          console.warn(`Error checking file (attempt ${attempt}):`, e);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      if(!fileExists) {
        console.error('File not found after all attempts');
        setEditorStatus('Ошибка: файл не найден, но продолжаю настройку Pages...', true);
      } else {
        setEditorStatus('Файл загружен. Настраиваю GitHub Pages...');
      }
      
      // Then enable Pages and trigger build
      setEditorStatus('Настраиваю GitHub Pages и запускаю сборку...');
      try{
         await enablePagesAndTrigger(actualOwner, actualRepo, pat);
      }catch(e){ console.warn('enablePagesAndTrigger failed', e); }
      setEditorStatus('Ожидаю появления файла в репозитории...');
      try{
         // Используем ту же функцию, что и при редактировании существующего репозитория
         await loadFileToEditor(actualOwner, actualRepo, path);
         setEditorStatus('Файл загружен и готов к редактированию');
      }catch(e){
         console.error('Error loading file:', e);
         setEditorStatus('Ошибка загрузки файла: '+(e.message||e), true);
      }

   } catch(e){
      setStatus('Ошибка: ' + (e.message || e), true);
   }
}

// NOTE: data.json creation/removal: removed. The admin panel no longer writes /contents/data.json.

// Check if template repository contains a specific file
async function templateHasFile(owner, repo, path){
   if(!owner || !repo || !path) return false;
   try{
      const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`;
      const headers = { 'Accept': 'application/vnd.github+json' };
      if(getPat()) headers['Authorization'] = 'token ' + getPat();
      const resp = await fetch(url, { headers });
      return resp.ok;
   }catch(e){
      console.warn('templateHasFile check failed', e);
      return false;
   }
}

// Wait for file to be available in new repository and load it
async function waitForFileAndLoad(owner, repo, path, maxAttempts=15, delay=3000){
   // Нормализуем путь
   path = path.toLowerCase();
   console.log(`Waiting for file ${owner}/${repo}/${path} to be available...`);
   
   for(let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
         console.log(`Attempt ${attempt}/${maxAttempts} to load file...`);
         const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`;
         const headers = { 'Accept': 'application/vnd.github+json' };
         if(getPat()) headers['Authorization'] = 'token ' + getPat();
         
         const resp = await fetch(url, { headers });
         if(resp.ok) {
            const data = await resp.json();
            console.log('File found, loading content...');
            if(data.content) {
               const content = decodeBase64Utf8(data.content);
               if(fileEditor) {
                  fileEditor.value = content;
                  console.log('Content loaded into editor');
               }
               CURRENT_FILE = { owner, repo, path, sha: data.sha };
               return true;
            }
         }
         console.log(`File not found (attempt ${attempt}), waiting ${delay}ms...`);
         await new Promise(resolve => setTimeout(resolve, delay));
      } catch(e) {
         console.warn(`Error checking file (attempt ${attempt}):`, e);
         await new Promise(resolve => setTimeout(resolve, delay));
      }
   }
   throw new Error(`File ${path} not found after ${maxAttempts} attempts`);
}

// UI handlers will be attached after DOM is fully loaded to avoid missing elements

function attachUiHandlers(){
   try{
      const btnIssue = $('btnIssue'); if(btnIssue) btnIssue.addEventListener('click', e => { openPrefilledIssue(); });
      const btnDirect = $('btnDirect'); if(btnDirect) btnDirect.addEventListener('click', e => { directCreateRepo(); });
      const btnDispatchLocal = $('btnDispatch'); if(btnDispatchLocal) btnDispatchLocal.addEventListener('click', e => { sendRepositoryDispatch(); });
      const patInput = $('pat'); if(patInput) patInput.addEventListener('change', e => { try{ localStorage.setItem('admin_pat', e.target.value); IN_MEMORY_PAT = null; const pi = $('patIndicator'); if(pi) pi.textContent = ''; }catch(ex){} });
      const chooseCreate = $('chooseCreate'); if(chooseCreate) chooseCreate.addEventListener('click', () => { hide(startChoice); show(mainForm); hide(repoListCard); hide(editorCard); if($('templateOwner') && !$('templateOwner').value) $('templateOwner').value = FIXED_TEMPLATE_OWNER(); if($('templateRepo') && !$('templateRepo').value) $('templateRepo').value = FIXED_TEMPLATE_REPO(); const g = $('globalBack'); if(g) g.style.display = ''; });
      const chooseEdit = $('chooseEdit'); if(chooseEdit) chooseEdit.addEventListener('click', () => { hide(startChoice); hide(mainForm); hide(editorCard); show(repoListCard); const g = $('globalBack'); if(g) g.style.display = ''; });
      const globalBack = $('globalBack'); if(globalBack) globalBack.addEventListener('click', ()=>{ hide(mainForm); hide(repoListCard); hide(editorCard); show(startChoice); globalBack.style.display = 'none'; });
      const btnList = $('btnListRepos'); if(btnList) btnList.addEventListener('click', listRepos);
      if(repoListEl) repoListEl.addEventListener('click', async (ev)=>{ const btn = ev.target.closest('button'); if(!btn) return; const owner = btn.dataset.owner; const repo = btn.dataset.repo; if($('owner')) $('owner').value = owner; if($('repo')) $('repo').value = repo; show(editorCard); hide(repoListCard); await loadFileToEditor(owner, repo, ($('filePath') && $('filePath').value) || 'Values.js'); });
      const btnSave = $('btnSaveFile'); if(btnSave) btnSave.addEventListener('click', saveFileToRepo);
      const btnDispatchFromEditor = $('btnDispatchFromEditor'); if(btnDispatchFromEditor) btnDispatchFromEditor.addEventListener('click', dispatchFromEditor);
   }catch(e){ console.warn('attachUiHandlers error', e); }
}

// Send repository_dispatch to existing client repo to trigger the update workflow (generic payload)
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

   const btn = $('btnDispatch');
   await activateButtonLoading(btn, 'Отправка...');
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
         showToast('Dispatch отправлен', true);
      } else {
         const txt = await resp.text();
         setStatus('Ошибка dispatch: ' + resp.status + ' ' + txt, true);
         showToast('Ошибка dispatch', false);
      }
   } catch(e){
      setStatus('Ошибка: ' + (e.message || e), true);
      showToast('Ошибка dispatch: '+(e.message||e), false);
   } finally{ deactivateButtonLoading(btn); }
}

// При загрузке — подгрузим PAT если есть
window.addEventListener('load', () => {
   // If there is a saved PAT in localStorage, keep it in memory but do NOT put the raw token into the visible input.
   try{
      const saved = localStorage.getItem('admin_pat');
      if(saved){ IN_MEMORY_PAT = saved; const pi = $('patIndicator'); if(pi) pi.textContent = 'PAT загружен (скрыт)'; }
   }catch(e){}
   // try to load ./config.json in the same folder as this script (admin/config.json)
   loadConfig();
   // Initially hide global back button
   const g = $('globalBack'); if(g) g.style.display = 'none';
   // Attach UI handlers now that DOM is ready
   try{ attachUiHandlers(); }catch(e){ console.warn('attachUiHandlers failed on load', e); }
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
         // set hidden owner input and inline display
         if(CONFIG.owner){
            try{ const ownerInput = $('owner'); if(ownerInput) ownerInput.value = CONFIG.owner; }catch(e){}
            try{ const inline = $('inlineOwner'); if(inline) inline.textContent = CONFIG.owner; }catch(e){}
            const ownerDisplay = $('configOwner'); if(ownerDisplay) ownerDisplay.textContent = CONFIG.owner || '(not set)';
         }
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

// Универсальные помощники для мгновенного показа состояния загрузки на кнопке.
// Используем requestAnimationFrame + setTimeout(0) чтобы дать браузеру шанс
// отрисовать изменения перед началом тяжёлой/асинхронной работы.
async function activateButtonLoading(btn, loadingText){
   if(!btn) return;
   try{
      // Сохраняем оригинальный текст в атрибуте data-orig-text
      if(!btn.dataset.origText) btn.dataset.origText = btn.textContent || '';
      btn.textContent = loadingText || 'Загрузка...';
   }catch(e){}
   btn.classList.add('loading');
   btn.disabled = true;
   btn.setAttribute('aria-busy','true');
   // yield для рендера: rAF -> setTimeout(0) (надёжнее, чем один rAF в некоторых браузерах)
   await new Promise(res => requestAnimationFrame(() => setTimeout(res, 0)));
}

function deactivateButtonLoading(btn){
   if(!btn) return;
   btn.classList.remove('loading');
   btn.disabled = false;
   btn.removeAttribute('aria-busy');
   try{
      if(btn.dataset.origText !== undefined){ btn.textContent = btn.dataset.origText; delete btn.dataset.origText; }
   }catch(e){}
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

// Decode base64 (UTF-8) into a JS string safely
function decodeBase64Utf8(b64){
   if(!b64) return '';
   try{
      // atob -> binary string, then convert to Uint8Array and decode as UTF-8
      const binary = atob(b64.replace(/\n/g, ''));
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for(let i=0;i<len;i++) bytes[i] = binary.charCodeAt(i);
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(bytes);
   }catch(e){
      // fallback: try the simple route
      try{ return decodeURIComponent(escape(atob(b64))); }catch(e2){ return atob(b64); }
   }
}

// Default pages workflow template to inject into new repos if missing
const PAGES_YML_TEMPLATE = `name: Build and deploy GitHub Pages

on:
   push:
      branches: [ main ]
   workflow_dispatch:

permissions:
   contents: read
   pages: write
   id-token: write

jobs:
   deploy:
      runs-on: ubuntu-latest
      environment:
         name: github-pages
         url: \${{ steps.deployment.outputs.page_url }}
      steps:
         - name: Checkout
           uses: actions/checkout@v4

         - name: Setup Pages
           uses: actions/configure-pages@v4

         - name: Upload artifact
           uses: actions/upload-pages-artifact@v2
           with:
              path: ./

         - name: Deploy to GitHub Pages
           id: deployment
           uses: actions/deploy-pages@v3
`;

// Try to ensure a Pages workflow exists and enable Pages for a repository.
// 1) determine default branch
// 2) create `.github/workflows/pages.yml` if missing
// 3) call PUT /repos/:owner/:repo/pages to enable Pages
// 4) trigger POST /repos/:owner/:repo/pages/builds to start a build
async function waitForPagesUrl(owner, repo, pat, maxAttempts = 10) {
   const headers = { 'Authorization': 'token ' + pat, 'Accept': 'application/vnd.github+json' };
   for(let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
         const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pages`;
         const resp = await fetch(url, { headers });
         if(resp.ok) {
            const data = await resp.json();
            if(data.html_url) {
               console.log('Pages URL found:', data.html_url);
               return data.html_url;
            }
         }
         console.log(`Waiting for Pages URL (attempt ${attempt}/${maxAttempts})...`);
         await new Promise(resolve => setTimeout(resolve, 5000));
      } catch(e) {
         console.warn(`Error checking Pages status (attempt ${attempt}):`, e);
      }
   }
   return null;
}

async function enablePagesAndTrigger(owner, repo, pat){
   if(!owner || !repo) return;
   if(!pat){ console.warn('No PAT provided to enablePagesAndTrigger'); return; }
   try{
      const headersAuth = { 'Authorization': 'token ' + pat, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' };
      // default branch
      let defaultBranch = 'main';
      try{
         const repoResp = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: { 'Authorization':'token '+pat, 'Accept':'application/vnd.github+json' } });
         if(repoResp.ok){ const info = await repoResp.json(); defaultBranch = info.default_branch || defaultBranch; }
      }catch(e){ console.warn('repo info fetch failed', e); }

      // ensure workflow exists
      const wfPath = '.github/workflows/pages.yml';
      const contentsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(wfPath)}`;
      let needCreate = false;
      try{
         const checkResp = await fetch(contentsUrl, { headers: { 'Authorization':'token '+pat, 'Accept':'application/vnd.github+json' } });
         if(!checkResp.ok){ if(checkResp.status === 404) needCreate = true; else console.warn('pages workflow check returned', checkResp.status); }
      }catch(e){ console.warn('pages workflow check error', e); needCreate = true; }

      if(needCreate){
         try{
            const b64 = await encodeBase64(PAGES_YML_TEMPLATE);
            const putBody = { message: 'Add pages workflow', content: b64 };
            const putResp = await fetch(contentsUrl, { method: 'PUT', headers: headersAuth, body: JSON.stringify(putBody) });
            if(!putResp.ok){ const txt = await putResp.text().catch(()=>putResp.statusText); console.warn('create pages workflow failed', putResp.status, txt); showToast('Не удалось добавить Pages workflow: ' + putResp.status, false); }
            else { showToast('Добавлен Pages workflow в репо', true); }
         }catch(e){ console.warn('create pages workflow exception', e); }
      }

      // enable Pages with retries
      try{
         const pagesUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pages`;
         // Настраиваем Pages для публикации из main ветки, корневой директории
         const pagesBody = {
            source: {
               branch: "main",
               path: "/"
            },
            build_type: "legacy",
            public: true
         };
         
         // Try enabling Pages with retries
         let success = false;
         for(let attempt = 1; attempt <= 5; attempt++) {
            console.log(`Enabling Pages attempt ${attempt}/5...`);
            showToast(`Попытка включения Pages ${attempt}/5...`, true);
            
            const putPages = await fetch(pagesUrl, { method: 'PUT', headers: headersAuth, body: JSON.stringify(pagesBody) });
            const responseText = await putPages.text().catch(() => putPages.statusText);
            
            if(putPages.ok) {
               success = true;
               console.log('Pages enabled successfully');
               showToast('GitHub Pages включен, ожидаем публикацию...', true);
               
               // Ждем появления URL сайта
               const pagesUrl = await waitForPagesUrl(owner, repo, pat);
               if(pagesUrl) {
                  showToast(`Сайт опубликован: ${pagesUrl}`, true);
               } else {
                  showToast('Сайт включен, но URL пока не доступен. Проверьте позже в настройках репозитория.', false);
               }
               break;
            } else {
               console.warn(`Enable pages failed attempt ${attempt}:`, putPages.status, responseText);
               showToast(`Не удалось включить Pages (попытка ${attempt}): ${putPages.status}`, false);
               
               // Wait longer between retries
               if(attempt < 5) {
                  const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // Exponential backoff up to 30s
                  console.log(`Waiting ${delay}ms before retry...`);
                  await new Promise(resolve => setTimeout(resolve, delay));
               }
            }
         }
         
         if(!success) {
            console.error('Failed to enable Pages after 5 attempts');
            showToast('Не удалось включить Pages после 5 попыток', false);
            return;
         }
         // trigger build
         try{
            const buildUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pages/builds`;
            const buildResp = await fetch(buildUrl, { method: 'POST', headers: headersAuth });
            if(buildResp.ok) showToast('Запущена сборка Pages', true); else { const txt = await buildResp.text().catch(()=>buildResp.statusText); console.warn('pages build failed', buildResp.status, txt); }
         }catch(e){ console.warn('pages build request failed', e); }
      }catch(e){ console.warn('enablePagesAndTrigger pages PUT failed', e); }

   }catch(e){ console.warn('enablePagesAndTrigger overall error', e); showToast('Ошибка настройки Pages: '+(e.message||e), false); }
}

// ========== New: start choice, repo list and editor logic ============

function show(el){ if(el) el.style.display = ''; }
function hide(el){ if(el) el.style.display = 'none'; }

const startChoice = $('startChoice');
const mainForm = $('mainForm');
const repoListCard = $('repoListCard');
const editorCard = $('editorCard');
const repoListEl = $('repoList');
const fileEditor = $('fileEditor');
console.log('Found editor element:', fileEditor ? 'yes' : 'no');
const editorStatus = $('editorStatus');

// Config (loaded from ./config.json if present)
let CONFIG = {
   owner: null,
   templateOwner: null,
   templateRepo: null,
   filePath: null,
   defaultBranches: ['main','master']
};

// Get repository branches via GitHub API. Returns array of branch names or CONFIG.defaultBranches on error.
async function getRepoBranches(owner, repo){
   try{
      const url = `https://api.github.com/repos/${owner}/${repo}/branches`;
      // If a PAT is available, include it so private repos / org repos work
      const pat = getPat();
      const headers = pat ? { 'Authorization': 'token ' + pat, 'Accept': 'application/vnd.github+json' } : {};
      const resp = await fetch(url, { headers });
      if(!resp.ok) return CONFIG.defaultBranches || ['main','master'];
      const arr = await resp.json();
      if(!Array.isArray(arr) || arr.length===0) return CONFIG.defaultBranches || ['main','master'];
      return arr.map(x=> x.name).filter(Boolean);
   }catch(e){
      return CONFIG.defaultBranches || ['main','master'];
   }
}

// List repos for given owner (user or org)
async function listRepos(){
   const owner = CONFIG.owner || ($('owner') && $('owner').value) || ($('templateOwner') && $('templateOwner').value);
   if(!owner){ setStatus('Укажите owner для списка репозиториев', true); return; }
   setStatus('Загружаю список репозиториев...');
   if(repoListEl) repoListEl.innerHTML = '';
   try{
      const pat = getPat();
      if (!pat) {
         setStatus('Токен не найден. Пожалуйста, введите PAT', true);
         return;
      }
      
      const headers = { 
         'Authorization': 'token ' + pat, 
         'Accept': 'application/vnd.github+json',
         'X-GitHub-Api-Version': '2022-11-28'
      };
      console.log('Запрос списка репозиториев для', owner);
      let resp = await fetch(`https://api.github.com/users/${owner}/repos`, { headers });
      
      // Если получили 401/403, попробуем через API организаций
      if (resp.status === 401) {
         console.error('Ошибка авторизации (401). Проверьте токен.');
         setStatus('Ошибка авторизации. Проверьте токен', true);
         return;
      }
      
      if (resp.status === 403) {
         console.warn('users API вернул 403, пробуем API организаций');
         resp = await fetch(`https://api.github.com/orgs/${owner}/repos`, { headers });
      }
      
      if (!resp.ok) {
         const errorText = await resp.text();
         console.error('Ошибка API:', resp.status, errorText);
         setStatus(`Ошибка получения списка: ${resp.status} - ${errorText}`, true);
         return;
      }
      const arr = await resp.json();
      if(!Array.isArray(arr) || arr.length===0){ if(repoListEl) repoListEl.innerHTML = '<li>Репозиториев не найдено</li>'; setStatus('Готово'); return; }
      arr.sort((a,b)=> a.name.localeCompare(b.name));
      arr.forEach(r=>{
         const li = document.createElement('li');
         li.style.padding = '6px 0';
         li.innerHTML = `<button class="repoBtn" data-owner="${owner}" data-repo="${r.name}">${r.name}</button>`;
         repoListEl.appendChild(li);
      });
      setStatus('Список загружен');
   }catch(e){ setStatus('Ошибка: '+(e && e.message? e.message: e), true); }
}

// Utility: encode JS string to base64 (UTF-8)
function encodeBase64Utf8Sync(str){
   try{ return btoa(unescape(encodeURIComponent(str))); }
   catch(e){
      // fallback for very large strings
      const encoder = new TextEncoder(); const bytes = encoder.encode(str);
      let binary = '';
      const chunk = 0x8000;
      for(let i=0;i<bytes.length;i+=chunk) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i+chunk)));
      return btoa(binary);
   }
}

// Toast notifications (bottom-right). Uses #toast-container in index.html
function showToast(message, success=true, timeout=4000){
   try{
      const container = document.getElementById('toast-container') || document.body;
      const toast = document.createElement('div');
      toast.className = 'admin-toast ' + (success? 'toast-success':'toast-error');
      toast.textContent = message;
      // Inline styles for positioning and basic look (CSS can override)
      toast.style.margin = '8px';
      toast.style.padding = '10px 14px';
      toast.style.borderRadius = '6px';
      toast.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
      toast.style.background = success? '#0a6d0a' : '#9b2c2c';
      toast.style.color = '#fff';
      toast.style.fontSize = '13px';
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 200ms ease, transform 200ms ease';
      toast.style.transform = 'translateY(6px)';
      // Ensure container is positioned
      if(container === document.body){
         // create a wrapper if not present
         let wrapper = document.getElementById('toast-wrapper');
         if(!wrapper){ wrapper = document.createElement('div'); wrapper.id = 'toast-wrapper'; document.body.appendChild(wrapper); wrapper.style.position='fixed'; wrapper.style.right='16px'; wrapper.style.bottom='16px'; wrapper.style.zIndex='99999'; }
         wrapper.appendChild(toast);
      } else {
         // container exists in DOM (index.html)
         // ensure container is positioned bottom-right
         container.style.position = container.style.position || 'fixed';
         container.style.right = container.style.right || '16px';
         container.style.bottom = container.style.bottom || '16px';
         container.style.zIndex = container.style.zIndex || '99999';
         container.appendChild(toast);
      }
      // show
      requestAnimationFrame(()=>{ toast.style.opacity = '1'; toast.style.transform='translateY(0)'; });
      // remove after timeout
      setTimeout(()=>{
         toast.style.opacity = '0'; toast.style.transform='translateY(6px)';
         setTimeout(()=>{ try{ toast.remove(); }catch(e){} }, 220);
      }, timeout);
   }catch(e){ console.warn('showToast failed', e); }
}

// Track currently loaded file (owner/repo/path/sha)
let CURRENT_FILE = null;

// Load file content from GitHub Contents API into the editor
async function loadFileToEditor(owner, repo, path, retryCount = 5){
   try{
      console.log(`Loading file ${owner}/${repo}/${path}`);
      
      // Небольшая задержка перед загрузкой, чтобы дать GitHub время на репликацию
      await new Promise(resolve => setTimeout(resolve, 3000));
      setStatus(`Загружаю файл ${owner}/${repo}/${path}...`);
      if(editorStatus) editorStatus.textContent = 'Статус: загрузка...';
      const pat = getPat();
      const headers = pat? { 'Authorization': 'token '+pat, 'Accept':'application/vnd.github+json' } : { 'Accept':'application/vnd.github+json' };
      const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`;
      console.log('Request URL:', url);
      console.log('Using headers:', { ...headers, Authorization: headers.Authorization ? 'token [HIDDEN]' : undefined });
      const resp = await fetch(url, { headers });
      if(!resp.ok){ 
         const txt = await resp.text().catch(()=>resp.statusText); 
         console.error('File load failed:', resp.status, txt);
         
         // Если файл не найден и есть еще попытки, пробуем снова
         if(resp.status === 404 && retryCount > 0) {
            console.log(`File not found, retrying in 3 seconds... (${retryCount} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            return loadFileToEditor(owner, repo, path, retryCount - 1);
         }
         
         throw new Error('HTTP '+resp.status+' '+txt); 
      }
      const j = await resp.json();
      console.log('File API response:', { 
        name: j.name,
        path: j.path,
        size: j.size,
        encoding: j.encoding,
        hasContent: !!j.content,
        contentStart: j.content ? j.content.substring(0, 50) + '...' : 'no content'
      });
      
      const raw = j.content || j.encoding==='base64' && j.content || '';
      if(!raw) {
         console.error('No content received from API');
         throw new Error('No content received from API');
      }
      
      console.log('Raw content length:', raw.length);
      const decoded = decodeBase64Utf8(raw);
      console.log('Decoded content length:', decoded.length);
      console.log('Content preview:', decoded.substring(0, 100) + '...');
      
      if(fileEditor) {
         fileEditor.value = decoded;
         const actualContent = fileEditor.value;
         console.log('Editor content length:', actualContent.length);
         console.log('Editor content preview:', actualContent.substring(0, 100) + '...');
      } else {
         console.error('fileEditor element not found');
      }
      CURRENT_FILE = { owner, repo, path, sha: j.sha };
      setStatus('Файл загружен');
      if(editorStatus) editorStatus.textContent = 'Статус: файл загружен и готов к редактированию';
   }catch(e){ setStatus('Ошибка загрузки: '+(e.message||e), true); if(editorStatus) editorStatus.textContent = 'Статус: ошибка'; throw e; }
}

// Save editor content back to repository using Contents API (requires PAT)
async function saveFileToRepo(){
   const btn = $('btnSaveFile');
   await activateButtonLoading(btn, 'Сохранение...');
   try{
      setStatus('Сохранение файла...');
      if(editorStatus) editorStatus.textContent = 'Статус: сохранение...';
      const owner = (CURRENT_FILE && CURRENT_FILE.owner) || ($('owner') && $('owner').value) || '';
      const repo = (CURRENT_FILE && CURRENT_FILE.repo) || ($('repo') && $('repo').value) || '';
      const path = (CURRENT_FILE && CURRENT_FILE.path) || ($('filePath') && $('filePath').value) || 'FAKE/values.js';
   if(!owner || !repo){ setStatus('Укажите owner и repo перед сохранением', true); showToast('Укажите owner и repo перед сохранением', false); return; }
   const pat = getPat(); if(!pat){ setStatus('Для сохранения требуется PAT', true); showToast('Для сохранения требуется PAT', false); return; }
   const content = fileEditor ? fileEditor.value : '';
   
   // Проверяем существование файла и получаем его sha
   try {
      const checkUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`;
      const checkResp = await fetch(checkUrl, { 
         headers: { 
            'Authorization': 'token ' + pat, 
            'Accept': 'application/vnd.github+json' 
         } 
      });
      if(checkResp.ok) {
         const fileInfo = await checkResp.json();
         CURRENT_FILE = { owner, repo, path, sha: fileInfo.sha };
      }
   } catch(e) {
      console.warn('File check failed, will create new file', e);
   }

   // Use the async, blob-based encoder for large payloads to avoid renderer OOM/crash
   const b64 = await encodeBase64(content);
   const body = { message: `Update ${path} via admin`, content: b64 };
   if(CURRENT_FILE && CURRENT_FILE.sha) body.sha = CURRENT_FILE.sha;
      const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`;
      const resp = await fetch(url, { method: 'PUT', headers: { 'Authorization':'token '+pat, 'Accept':'application/vnd.github+json', 'Content-Type':'application/json' }, body: JSON.stringify(body) });
      if(!resp.ok){
         const txt = await resp.text().catch(()=>resp.statusText);
         console.error('Save failed', resp.status, txt);
         // Provide helpful hint for common cases
         if(resp.status === 401 || resp.status === 403){
            const msg = 'Ошибка сохранения: недостаточно прав. Убедитесь, что PAT имеет scope repo и доступ к этому репозиторию.';
            setStatus(msg, true); showToast(msg, false);
         } else if(resp.status === 422){
            const msg = 'Ошибка сохранения: конфликт SHA или неверная структура запроса (422). Попробуйте заново загрузить файл и повторить.';
            setStatus(msg, true); showToast(msg, false);
         } else {
            const msg = 'Ошибка сохранения: '+resp.status+' '+txt;
            setStatus(msg, true); showToast(msg, false);
         }
         if(editorStatus) editorStatus.textContent = 'Статус: ошибка';
         return;
      }
      const j = await resp.json();
      CURRENT_FILE = { owner, repo, path, sha: j.content && j.content.sha ? j.content.sha : (j.commit && j.commit.sha ? j.commit.sha : null) };
   setStatus('Файл сохранён'); if(editorStatus) editorStatus.textContent = 'Статус: сохранено';
   try{ showToast('Файл сохранён', true); }catch(e){}
   }catch(e){
      console.error('saveFileToRepo error', e);
      setStatus('Ошибка сохранения: '+(e.message||e), true);
      if(editorStatus) editorStatus.textContent = 'Статус: ошибка';
   } finally{
      deactivateButtonLoading(btn);
   }
}

