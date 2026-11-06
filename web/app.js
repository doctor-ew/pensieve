const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('pensieve-token');
if (location.hash) { sessionStorage.setItem('pensieve-token', token); history.replaceState(null, '', '/'); }
const selected = new Set();
const status = message => { $('status').textContent = message; };
async function api(path, data) {
  const response = await fetch('/api/' + path, { method: data ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
function selection() { $('selected').textContent = selected.size ? `${selected.size} selected — review text and metadata before export` : 'Nothing selected for sharing'; $('export').disabled = !selected.size; }
function render(memories) {
  selected.clear(); selection(); $('memories').replaceChildren();
  if (!memories.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'A clear pool, ready for your first memory.\nCapture a thought or import a Codex or Claude session above.'; $('memories').append(empty); }
  for (const memory of memories) {
    const card = document.createElement('article'); card.className = 'card';
    const top = document.createElement('div'); top.className = 'card-top';
    const label = document.createElement('span'); label.textContent = `${memory.source} · ${memory.role}${memory.score === undefined ? '' : ' · similarity ' + memory.score.toFixed(3)}`;
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', 'Select memory ' + memory.id.slice(0, 8)); checkbox.onchange = () => { checkbox.checked ? selected.add(memory.id) : selected.delete(memory.id); selection(); };
    top.append(label, checkbox);
    const text = document.createElement('pre'); text.textContent = memory.text;
    const citation = document.createElement('small'); citation.textContent = `${memory.locator}\nSession: ${memory.session}\nProject: ${memory.project || 'unspecified'}\n${memory.timestamp || 'timestamp unknown'}\n${memory.id}`; citation.style.whiteSpace = 'pre-wrap';
    card.append(top, text, citation); $('memories').append(card);
  }
}
async function refresh() {
  const data = await api('memories'); render(data.items); $('count').textContent = `${data.memories} memories`;
  const info = await api('status'); $('provider').textContent = info.provider;
  $('heading').textContent = 'Your memory pool';
}
function action(handler) { return async event => { event?.preventDefault(); try { status('Working…'); await handler(event); } catch (error) { status(error.message); } }; }
$('refresh').onclick = action(async () => { await refresh(); status('All memories shown.'); });
$('capture-form').onsubmit = action(async () => { await api('capture', { text: $('capture').value }); $('capture').value = ''; await refresh(); status('Saved privately. Build the vector index to enable recall.'); });
$('session-form').onsubmit = action(async () => { const result = await api('import-session', { path: $('path').value, source: $('source').value }); await refresh(); status(`Imported ${result.imported} memories. ${result.warnings.join(' ')}`); });
$('index').onclick = action(async () => { const result = await api('index', {}); status(`Indexed ${result.indexed} memories.`); });
$('search-form').onsubmit = action(async () => { const result = await api('search', { query: $('query').value }); render(result.hits); $('heading').textContent = 'Recalled memories'; status(`${result.hits.length} results, ranked by vector similarity. Similarity is not a truth score.`); });
$('export').onclick = action(async () => {
  const bundle = await api('export', { ids: [...selected] });
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'pensieve-bundle.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('Selected memories exported. The bundle includes text and source metadata; review it before sharing.');
});
$('bundle').onchange = action(async () => { const file = $('bundle').files[0]; if (!file) return; if (file.size > 10000000) throw new Error('Bundle exceeds 10 MB'); const result = await api('bundle', JSON.parse(await file.text())); await refresh(); status(`Imported ${result.imported} shared memories. Index them to enable recall.`); });
if (token) action(async () => { await refresh(); status('Private memory pool ready.'); })();
