// ── State ──────────────────────────────────────────────────────────────────────
let allChampions      = {};
let ownedSkinIds      = new Set();
let lootSkinIds       = new Set();
let champPositions    = {};
let skinPurchaseDates = {}; // skinId → timestamp ms
let currentFilter     = 'owned';
let currentPosition   = '';
let currentSort       = 'name'; // 'name' | 'date'
let currentSortDir    = 'asc';  // 'asc'  | 'desc'

// ── Boot: load everything from data/ ──────────────────────────────────────────
async function loadCollection() {
  document.getElementById('filePrompt').style.display   = 'none';
  document.getElementById('loadingState').style.display = 'block';

  try {
    const skinsPath = document.getElementById('skinsPath').value.trim();
    const lootPath  = document.getElementById('lootPath').value.trim();

    const [champions, positions, skinsList, lootList] = await Promise.all([
      fetchJSON('data/champions.json'),
      fetchJSON('data/champion_positions.json'),
      fetchJSON(skinsPath),
      fetchJSON(lootPath),
    ]);

    // Champion data
    allChampions = champions;

    // Positions — keyed by champion id (e.g. "AurelionSol")
    for (const id of Object.keys(allChampions)) {
      champPositions[id] = positions[id] ?? [];
    }

    // Owned skins + purchase dates
    for (const entry of skinsList) {
      if (entry.ownership?.owned === true) {
        const sid = Number(entry.id);
        ownedSkinIds.add(sid);
        const pd = entry.ownership?.rental?.purchaseDate;
        if (pd && pd !== 0) skinPurchaseDates[sid] = pd;
      }
    }

    // Loot skins — type SKIN_RENTAL, id is in storeItemId
    for (const entry of lootList) {
      if (entry.type === 'SKIN_RENTAL' && entry.storeItemId != null) {
        lootSkinIds.add(Number(entry.storeItemId));
      }
      // Also handle permanent skin shards: lootId "CHAMPION_SKIN_110004"
      const lid = entry.lootId ?? '';
      if (lid.startsWith('CHAMPION_SKIN_') && !lid.includes('RENTAL')) {
        const id = parseInt(lid.replace('CHAMPION_SKIN_', ''));
        if (!isNaN(id)) lootSkinIds.add(id);
      }
    }

    buildUI();

  } catch (err) {
    document.getElementById('loadingState').innerHTML =
      `<p style="color:#c85050">${err.message}</p>`;
  }
}

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load: ${path} (HTTP ${res.status})`);
  return res.json();
}

// ── Build UI ──────────────────────────────────────────────────────────────────
function buildUI() {
  document.getElementById('loadingState').style.display  = 'none';
  document.getElementById('searchWrap').style.display    = 'block';
  document.getElementById('statsBar').style.display      = 'flex';
  document.getElementById('filterTabs').style.display    = 'flex';
  document.getElementById('positionTabs').style.display  = 'flex';
  document.getElementById('sortBar').style.display       = 'flex';

  let totalOwned = 0, totalLoot = 0;
  for (const champ of Object.values(allChampions)) {
    for (const skin of champ.skins) {
      const id = parseInt(skin.id);
      if (ownedSkinIds.has(id)) totalOwned++;
      if (lootSkinIds.has(id))  totalLoot++;
    }
  }
  document.getElementById('statChamps').textContent = Object.keys(allChampions).length;
  document.getElementById('statOwned').textContent  = totalOwned;
  document.getElementById('statLoot').textContent   = totalLoot;

  renderGrid('');

  document.getElementById('searchInput').addEventListener('input', e => {
    renderGrid(e.target.value.trim().toLowerCase());
  });
}

// ── Filters & sort ────────────────────────────────────────────────────────────
function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === f);
  });
  renderGrid(document.getElementById('searchInput').value.trim().toLowerCase());
}

function setPosition(p) {
  currentPosition = currentPosition === p ? '' : p;
  document.querySelectorAll('.pos-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.pos === currentPosition);
  });
  renderGrid(document.getElementById('searchInput').value.trim().toLowerCase());
}

function setSort(v) {
  currentSort = v;
  renderGrid(document.getElementById('searchInput').value.trim().toLowerCase());
}

function setSortDir(v) {
  currentSortDir = v;
  renderGrid(document.getElementById('searchInput').value.trim().toLowerCase());
}

function champHasOwned(champ) {
  return champ.skins.some(s => s.num !== 0 && ownedSkinIds.has(parseInt(s.id)));
}
function champHasLoot(champ) {
  return champ.skins.some(s => lootSkinIds.has(parseInt(s.id)));
}

// Latest purchase date among all owned skins for a champion (0 if none)
function champLatestDate(champ) {
  return Math.max(0, ...champ.skins.map(s => skinPurchaseDates[parseInt(s.id)] ?? 0));
}

// ── Grid ──────────────────────────────────────────────────────────────────────
function renderGrid(query) {
  currentSort    = document.getElementById('sortBy').value;
  currentSortDir = document.getElementById('sortDir').value;

  const grid = document.getElementById('champGrid');

  const sorted = Object.values(allChampions).sort((a, b) => {
    if (currentSort === 'date') {
      const da = champLatestDate(a);
      const db = champLatestDate(b);
      if (da === 0 && db === 0) return a.name.localeCompare(b.name);
      if (da === 0) return 1;
      if (db === 0) return -1;
      return currentSortDir === 'asc' ? da - db : db - da;
    }
    return currentSortDir === 'asc'
      ? a.name.localeCompare(b.name)
      : b.name.localeCompare(a.name);
  });

  const filtered = sorted.filter(champ => {
    if (query && !champ.name.toLowerCase().includes(query)) return false;
    if (currentFilter === 'owned'   && !champHasOwned(champ)) return false;
    if (currentFilter === 'loot'    && !champHasLoot(champ))  return false;
    if (currentFilter === 'default' && (champHasOwned(champ) || champHasLoot(champ))) return false;
    if (currentPosition && !champPositions[champ.id]?.includes(currentPosition)) return false;
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">No champions found for "<em>${query || currentFilter}</em>"</div>`;
    return;
  }

  grid.innerHTML = filtered.map((champ, i) => {
    const imgUrl          = `data/img/champion/${champ.id}.png`;
    const ownedNonDefault = champ.skins.filter(s => s.num !== 0 && ownedSkinIds.has(parseInt(s.id)));
    const lootSkins       = champ.skins.filter(s => lootSkinIds.has(parseInt(s.id)));
    const totalExtra      = ownedNonDefault.length + lootSkins.length;

    const ownedBadge = ownedNonDefault.length > 0
      ? `<div class="owned-badge">${ownedNonDefault.length} owned</div>` : '';
    const lootBadge  = lootSkins.length > 0
      ? `<div class="loot-badge">${lootSkins.length} loot</div>` : '';

    return `<div class="champ-card" style="animation-delay:${Math.min(i * 0.02, 0.5)}s"
                  onclick="openModal('${champ.id}')">
      <img src="${imgUrl}" alt="${champ.name}" loading="lazy">
      ${ownedBadge}${lootBadge}
      <div class="champ-card-overlay">
        <div class="champ-name">${champ.name}</div>
        ${totalExtra > 0
          ? `<div class="skin-count">${ownedNonDefault.length} owned · ${lootSkins.length} loot</div>`
          : '<div class="skin-count">Default only</div>'}
      </div>
    </div>`;
  }).join('');
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModal(champId) {
  const champ = allChampions[champId];
  if (!champ) return;

  document.getElementById('modalThumb').src = `data/img/champion/${champ.id}.png`;
  document.getElementById('modalTitle').textContent = champ.name;

  const ownedNonDefault = champ.skins.filter(s => s.num !== 0 && ownedSkinIds.has(parseInt(s.id)));
  const lootSkins       = champ.skins.filter(s => lootSkinIds.has(parseInt(s.id)));
  document.getElementById('modalMeta').textContent =
    `${ownedNonDefault.length} owned · ${lootSkins.length} in loot`;

  let html = '';
  if (ownedNonDefault.length > 0) {
    html += `<div class="section-label">Owned Skins — ${ownedNonDefault.length}</div>`;
    html += `<div class="skins-grid">${ownedNonDefault.map(s => renderSkinCard(champ, s, false)).join('')}</div>`;
  }
  if (lootSkins.length > 0) {
    html += `<div class="section-label">In Loot — ${lootSkins.length}</div>`;
    html += `<div class="skins-grid">${lootSkins.map(s => renderSkinCard(champ, s, true)).join('')}</div>`;
  }
  if (!ownedNonDefault.length && !lootSkins.length) {
    html += `<p style="color:var(--text-dim);text-align:center;padding:2rem;font-size:0.9rem;letter-spacing:0.1em">No additional skins owned or in loot for this champion.</p>`;
  }

  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function renderSkinCard(champ, skin, isLoot) {
  const splashUrl   = `data/img/loading/${champ.id}_${skin.num}.jpg`;
  const displayName = skin.name === 'default' ? champ.name : skin.name;
  const lootBadge   = isLoot ? `<div class="loot-badge">LOOT</div>` : '';

  const pd = skinPurchaseDates[parseInt(skin.id)];
  const dateLine = pd
    ? `<div class="skin-info-sub">Acquired ${new Date(pd).toLocaleDateString()}</div>`
    : '';

  const splashRemote = `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${champ.id}_${skin.num}.jpg`;

  return `<div class="skin-card${isLoot ? ' is-loot' : ''}">
    <div class="skin-img-wrap">
      <img src="${splashUrl}" alt="${displayName}" loading="lazy"
           onerror="this.onerror=null;this.src='${splashRemote}'">
      ${lootBadge}
    </div>
    <div class="skin-info">
      <div class="skin-info-name">${displayName}</div>
      ${skin.chromas ? '<div class="skin-info-sub">✦ Has Chromas</div>' : ''}
      ${dateLine}
    </div>
  </div>`;
}

function closeModal(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById('modalOverlay').classList.remove('active');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModalDirect(); });