const $ = id => document.getElementById(id);
const id = location.pathname.split('/').pop();
const key = 'pensieve-share-' + id;
let token = sessionStorage.getItem(key) || '';
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
