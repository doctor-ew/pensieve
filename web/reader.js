const $ = id => document.getElementById(id);
const id = location.pathname.split('/').pop();
const key = 'pensieve-share-' + id;
const invitationToken = location.hash.slice(1);
let token = /^[a-f0-9]{64}$/.test(invitationToken) ? invitationToken : sessionStorage.getItem(key) || '';
if (invitationToken) { if (token) sessionStorage.setItem(key, token); history.replaceState(null, '', location.pathname); }
async function api(action = '', data) {
  const response = await fetch(`/api/reader/${id}${action ? '/' + action : ''}`, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: data ? JSON.stringify(data) : undefined });
  const value = await response.json();
  if (!response.ok) {
    if (response.status === 401) { token = ''; sessionStorage.removeItem(key); $('content').hidden = true; $('signin').hidden = false; }
    throw new Error(value.error || 'Request failed');
  }
  return value;
}
function memoryCard(memory) {
  const card = document.createElement('article'); card.className = 'card';
  const label = document.createElement('small'); label.textContent = `${memory.source} · ${memory.timestamp || 'Date unknown'} · ${memory.id.slice(0,12)}`;
  const content = document.createElement('pre'); content.textContent = memory.text;
  const source = document.createElement('small'); source.textContent = `${memory.locator} · Session ${memory.session}`;
  card.append(label, content, source); return card;
}
async function load() {
  const snapshot = await api(); $('signin').hidden = true; $('content').hidden = false;
  $('title').textContent = snapshot.title; $('brief').textContent = snapshot.brief;
  $('expires').textContent = `Shared ${new Date(snapshot.createdAt).toLocaleDateString()} · Access ends ${new Date(snapshot.expiresAt).toLocaleDateString()}`;
  $('sources-title').textContent = `${snapshot.memories.length} supporting memories`;
  $('reader-memories').replaceChildren(...snapshot.memories.map(memoryCard));
  $('reader-status').textContent = '';
}
$('email-form').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { const result = await api('code', { email: $('email').value }); $('reader-status').textContent = result.message; $('code-form').hidden = false; $('code').focus(); }
  catch (error) { $('reader-status').textContent = error.message; }
  finally { button.disabled = false; }
};
$('code-form').onsubmit = async event => {
  event.preventDefault();
  try { const result = await api('verify', { email: $('email').value, code: $('code').value }); token = result.token; sessionStorage.setItem(key, token); $('code').value = ''; await load(); }
  catch (error) { $('reader-status').textContent = error.message; }
};
$('ask-form').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; $('reader-status').textContent = 'Looking through the shared memories…';
  try {
    const result = await api('ask', { question: $('question').value });
    const text = document.createElement('p'); text.textContent = result.text;
    const label = document.createElement('small'); label.textContent = result.mode === 'generated' ? 'Generated answer · Check the cited passages below' : 'Source excerpts';
    $('answer').replaceChildren(label, text, ...result.sources.map(memoryCard)); $('reader-status').textContent = '';
  } catch (error) { $('reader-status').textContent = error.message; }
  finally { button.disabled = false; }
};
$('signout').onclick = () => { sessionStorage.removeItem(key); location.reload(); };
if (token) load().catch(error => { $('reader-status').textContent = error.message; });

$('download-agent').onclick = async () => {
  const button = $('download-agent'); button.disabled = true;
  try {
    // Fetch again so expiry/revocation is enforced at download time.
    const bundle = await api('download');
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'pensieve-memories.pensieve.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    $('reader-status').textContent = 'Downloaded. In your repository, run pensieve unpack with the downloaded file, then ask your agent to read .pensieve/START-HERE.md.';
  } catch (error) { $('reader-status').textContent = error.message; }
  finally { button.disabled = false; }
};
