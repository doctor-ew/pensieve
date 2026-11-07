const $ = id => document.getElementById(id);
const startSharing = new URLSearchParams(location.search).has('share');
const token = location.hash.slice(1) || sessionStorage.getItem('pensieve-token');
if (location.hash) { sessionStorage.setItem('pensieve-token', token); history.replaceState(null, '', '/'); }
const selected = new Set();
let shareSelection = [], sharingReady = false;
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
  sharingReady = info.sharing; $('service-url').value = info.shareService;
  $('heading').textContent = 'Your memory pool';
}
function action(handler) { return async event => { event?.preventDefault(); try { status('Working…'); await handler(event); } catch (error) { status(error.message); } }; }
$('refresh').onclick = action(async () => { await refresh(); status('All memories shown.'); });
$('capture-form').onsubmit = action(async () => { await api('capture', { text: $('capture').value }); $('capture').value = ''; await refresh(); status('Saved privately. Build the vector index to enable recall.'); });
$('session-form').onsubmit = action(async () => { const result = await api('import-session', { path: $('path').value, source: $('source').value }); await refresh(); status(`Imported ${result.imported} memories. ${result.warnings.join(' ')}`); });
$('index').onclick = action(async () => { const result = await api('index', {}); status(`Indexed ${result.indexed} memories.`); });
$('search-form').onsubmit = action(async () => { const result = await api('search', { query: $('query').value }); render(result.hits); $('heading').textContent = 'Recalled memories'; status(`${result.hits.length} results, ranked by vector similarity. Similarity is not a truth score.`); });
async function downloadPool(selection) {
  const bundle = await api('export', selection);
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'memory-pool.pensieve.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('Selected memories exported. The bundle includes text and source metadata; review it before sharing.');
}
$('export').onclick = action(() => downloadPool({ ids: [...selected] }));
$('download-pool').onclick = action(() => downloadPool({ all: true }));
$('bundle').onchange = action(async () => { const file = $('bundle').files[0]; if (!file) return; if (file.size > 10000000) throw new Error('Bundle exceeds 10 MB'); const result = await api('bundle', JSON.parse(await file.text())); await refresh(); status(`Imported ${result.imported} shared memories. Index them to enable recall.`); });
document.querySelectorAll('.close-dialog').forEach(button => button.onclick = () => button.closest('dialog').close());
const shareScope = () => $('share-scope').value === 'all' ? { all: true } : { ids: shareSelection };
async function previewShare() {
  const preview = await api('share-preview', shareScope());
  $('share-title').value = preview.title; $('share-brief').value = preview.brief;
  $('share-count').textContent = `${preview.count} memories will be visible to the invited recipients.`;
}
async function openShare() {
  if (!sharingReady) { $('settings-status').textContent = 'Connect your sharing service once, then you can create private links.'; $('settings-dialog').showModal(); return; }
  shareSelection = [...selected]; $('share-scope').value = shareSelection.length ? 'selected' : 'all';
  $('share-scope').querySelector('[value="selected"]').disabled = !shareSelection.length;
  $('share-result').hidden = true; $('publish-share').disabled = false; $('share-error').textContent = '';
  await previewShare(); $('share-dialog').showModal();
}
$('share-pool').onclick = action(openShare);
$('share-scope').onchange = async () => { try { await previewShare(); } catch (error) { $('share-error').textContent = error.message; } };
$('share-form').onsubmit = async event => {
  event.preventDefault(); $('publish-share').disabled = true; $('share-error').textContent = 'Creating your private link…';
  try {
    const result = await api('share', { ...shareScope(), title: $('share-title').value, brief: $('share-brief').value,
      recipients: $('share-emails').value.split(',').map(x => x.trim()).filter(Boolean), days: Number($('share-days').value), cloudAllowed: $('share-cloud').checked, accessMode: 'invitation-link' });
    $('share-link').value = result.invitations?.[0]?.url ?? result.url; $('share-result').hidden = false;
    $('share-invitations').replaceChildren();
    for (const invitation of result.invitations ?? []) {
      const link = document.createElement('a'); link.className = 'email-invite'; link.href = invitation.mailto; link.textContent = `Email invitation to ${invitation.email}`;
      $('share-invitations').append(link);
    }
    $('share-error').textContent = 'Ready. Open an email draft below, then send it from your email app. Anyone holding the private link can view the shared memories.';
  } catch (error) { $('share-error').textContent = error.message; $('publish-share').disabled = false; }
};
$('copy-share').onclick = async () => { try { await navigator.clipboard.writeText($('share-link').value); $('share-error').textContent = 'Link copied.'; } catch { $('share-link').select(); $('share-error').textContent = 'Select and copy the link above.'; } };
$('sharing-settings').onclick = () => $('settings-dialog').showModal();
$('settings-form').onsubmit = async event => {
  event.preventDefault();
  try { await api('sharing-settings', { url: $('service-url').value, token: $('service-token').value }); $('service-token').value = ''; await refresh(); $('settings-dialog').close(); await openShare(); }
  catch (error) { $('settings-status').textContent = error.message; }
};
$('manage-shares').onclick = action(async () => {
  const { shares } = await api('shares'); $('shares-list').replaceChildren();
  for (const share of shares) {
    const card = document.createElement('article'); card.className = 'card';
    const title = document.createElement('h3'); title.textContent = share.title;
    const detail = document.createElement('p'); detail.textContent = `${share.count} memories · ${share.recipients.join(', ')} · ${share.revoked ? 'Revoked' : 'Expires ' + new Date(share.expiresAt).toLocaleDateString()}`;
    const revoke = document.createElement('button'); revoke.textContent = 'Revoke access'; revoke.disabled = share.revoked;
    revoke.onclick = async () => { try { await api('revoke', { id: share.id }); revoke.disabled = true; detail.textContent = 'Access revoked'; } catch (error) { detail.textContent = error.message; } };
    card.append(title, detail, revoke); $('shares-list').append(card);
  }
  if (!shares.length) $('shares-list').textContent = 'No shared links yet.';
  $('manage-dialog').showModal();
});
if (token) action(async () => { await refresh(); status('Private memory pool ready.'); if (startSharing) await openShare(); })();
