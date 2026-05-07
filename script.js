// ── State ──────────────────────────────────────────────────────────────────────
let allChampions = {};   // { champId: { name, key, skins:[{id,name,num}...] } }
let ownedSkinIds = new Set();
let lootSkinIds  = new Set();
let currentFilter = 'all';
let ddVersion = '';

// ── File loading ───────────────────────────────────────────────────────────────
let skinsData = null, lootData = null;

function readJSON(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => { try { res(JSON.parse(e.target.result)); } catch(err) { rej(err); } };
    r.onerror = rej;
    r.readAsText(file);
  });
}

document.getElementById('skinsFile').addEventListener('change', e => {
  if (e.target.files[0]) {
    skinsData = e.target.files[0];
    document.getElementById('skinsBtn').textContent = '✓ skins.json';
    document.getElementById('skinsBtn').classList.add('loaded');
    checkFilesReady();
  }
});

document.getElementById('lootFile').addEventListener('change', e => {
  if (e.target.files[0]) {
    lootData = e.target.files[0];
    document.getElementById('lootBtn').textContent = '✓ skinsLoot.json';
    document.getElementById('lootBtn').classList.add('loaded');
    checkFilesReady();
  }
});

function checkFilesReady() {
  document.getElementById('loadBtn').disabled = !(skinsData && lootData);
}

async function loadCollection() {
  document.getElementById('filePrompt').style.display = 'none';
  document.getElementById('loadingState').style.display = 'block';

  try {
    const [skinsList, lootList] = await Promise.all([
      readJSON(skinsData),
      readJSON(lootData)
    ]);

    // Parse owned skins: only add entries where ownership.owned is true
    for (const entry of skinsList) {
      if (entry.ownership?.owned === true) {
        ownedSkinIds.add(Number(entry.id));
      }
    }

    // Parse loot: filter entries that are skins (itemKey starts with CHAMPION_SKIN_)
    for (const entry of lootList) {
      // loot entries have lootId like "CHAMPION_SKIN_123456"
      const lid = entry.lootId ?? entry.lootName ?? '';
      if (lid.startsWith('CHAMPION_SKIN_')) {
        const num = parseInt(lid.replace('CHAMPION_SKIN_', ''));
        if (!isNaN(num)) lootSkinIds.add(num);
      }
    }

    await fetchDDragon();
  } catch(err) {
    document.getElementById('loadingState').innerHTML =
      `<p style="color:#c85050">Error: ${err.message}</p>`;
  }
}

// ── Data Dragon ────────────────────────────────────────────────────────────────
async function fetchDDragon() {
  // Get latest version
  const verRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
  const versions = await verRes.json();
  ddVersion = versions[0];

  // Get all champions
  const champRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/champion.json`);
  const champJson = await champRes.json();

  // For each champion, we need skin data — we'll load on demand (from champion detail endpoint)
  // But champion.json has basic info; skin list is in individual champion JSON
  // Build index: key (numeric) → champion id string
  const champIndex = {}; // numericId → {id, name, key}
  for (const [id, data] of Object.entries(champJson.data)) {
    champIndex[data.key] = { id, name: data.name, key: data.key };
  }

  // Fetch individual champion JSONs in batches to get skin lists
  const champIds = Object.values(champJson.data).map(c => c.id);

  // Batch fetch - 20 at a time
  const batchSize = 20;
  for (let i = 0; i < champIds.length; i += batchSize) {
    const batch = champIds.slice(i, i + batchSize);
    await Promise.all(batch.map(async (champId) => {
      try {
        const r = await fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/champion/${champId}.json`);
        const d = await r.json();
        const cdata = d.data[champId];
        allChampions[champId] = {
          id: champId,
          name: cdata.name,
          key: cdata.key,
          skins: cdata.skins // [{id, num, name, chromas}]
        };
      } catch(e) { /* skip */ }
    }));
  }

  buildUI();
}

// ── Build UI ──────────────────────────────────────────────────────────────────
function buildUI() {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('searchWrap').style.display = 'block';
  document.getElementById('statsBar').style.display = 'flex';
  document.getElementById('filterTabs').style.display = 'flex';

  // Stats
  let totalOwned = 0, totalLoot = 0;
  for (const champ of Object.values(allChampions)) {
    for (const skin of champ.skins) {
      const numId = parseInt(skin.id);
      if (ownedSkinIds.has(numId)) totalOwned++;
      if (lootSkinIds.has(numId)) totalLoot++;
    }
  }
  document.getElementById('statChamps').textContent = Object.keys(allChampions).length;
  document.getElementById('statOwned').textContent = totalOwned;
  document.getElementById('statLoot').textContent = totalLoot;

  renderGrid('');

  document.getElementById('searchInput').addEventListener('input', e => {
    renderGrid(e.target.value.trim().toLowerCase());
  });
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === f);
  });
  renderGrid(document.getElementById('searchInput').value.trim().toLowerCase());
}

function champHasOwned(champ) {
  return champ.skins.some(s => s.num !== 0 && ownedSkinIds.has(parseInt(s.id)));
}
function champHasLoot(champ) {
  return champ.skins.some(s => lootSkinIds.has(parseInt(s.id)));
}

function renderGrid(query) {
  const grid = document.getElementById('champGrid');
  const sorted = Object.values(allChampions).sort((a,b) => a.name.localeCompare(b.name));

  const filtered = sorted.filter(champ => {
    if (query && !champ.name.toLowerCase().includes(query)) return false;
    if (currentFilter === 'owned' && !champHasOwned(champ)) return false;
    if (currentFilter === 'loot' && !champHasLoot(champ)) return false;
    if (currentFilter === 'default' && (champHasOwned(champ) || champHasLoot(champ))) return false;
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">No champions found for "<em>${query || currentFilter}</em>"</div>`;
    return;
  }

  grid.innerHTML = filtered.map((champ, i) => {
    const imgUrl = `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${champ.id}.png`;
    const ownedNonDefault = champ.skins.filter(s => s.num !== 0 && ownedSkinIds.has(parseInt(s.id)));
    const lootSkins = champ.skins.filter(s => lootSkinIds.has(parseInt(s.id)));
    const totalExtra = ownedNonDefault.length + lootSkins.length;

    const badge = totalExtra > 0
      ? `<div class="owned-badge">${totalExtra} skin${totalExtra !== 1 ? 's' : ''}</div>`
      : '';

    return `<div class="champ-card" style="animation-delay:${Math.min(i*0.02, 0.5)}s"
                  onclick="openModal('${champ.id}')">
      <img src="${imgUrl}" alt="${champ.name}" loading="lazy">
      ${badge}
      <div class="champ-card-overlay">
        <div class="champ-name">${champ.name}</div>
        ${totalExtra > 0 ? `<div class="skin-count">${ownedNonDefault.length} owned · ${lootSkins.length} loot</div>` : '<div class="skin-count">Default only</div>'}
      </div>
    </div>`;
  }).join('');
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModal(champId) {
  const champ = allChampions[champId];
  if (!champ) return;

  document.getElementById('modalThumb').src =
    `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${champ.id}.png`;
  document.getElementById('modalTitle').textContent = champ.name;

  const ownedNonDefault = champ.skins.filter(s => s.num !== 0 && ownedSkinIds.has(parseInt(s.id)));
  const lootSkins = champ.skins.filter(s => lootSkinIds.has(parseInt(s.id)));
  document.getElementById('modalMeta').textContent =
    `${ownedNonDefault.length} owned · ${lootSkins.length} in loot`;

  let html = '';

  if (ownedNonDefault.length > 0) {
    html += `<div class="section-label">Owned Skins — ${ownedNonDefault.length}</div>`;
    html += `<div class="skins-grid">`;
    html += ownedNonDefault.map(skin => renderSkinCard(champ, skin, false)).join('');
    html += `</div>`;
  }

  if (lootSkins.length > 0) {
    html += `<div class="section-label">In Loot — ${lootSkins.length}</div>`;
    html += `<div class="skins-grid">`;
    html += lootSkins.map(skin => renderSkinCard(champ, skin, true)).join('');
    html += `</div>`;
  }

  // Default skin
  const defaultSkin = champ.skins.find(s => s.num === 0);
  if (defaultSkin) {
    html += `<div class="section-label">Default</div>`;
    html += `<div class="skins-grid">`;
    html += renderSkinCard(champ, defaultSkin, false);
    html += `</div>`;
  }

  if (!ownedNonDefault.length && !lootSkins.length) {
    html += `<p style="color:var(--text-dim);text-align:center;padding:2rem;font-size:0.9rem;letter-spacing:0.1em">No additional skins owned or in loot for this champion.</p>`;
  }

  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function renderSkinCard(champ, skin, isLoot) {
  // Splash art URL
  const splashUrl = `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${champ.id}_${skin.num}.jpg`;
  const displayName = skin.name === 'default' ? champ.name : skin.name;
  const lootBadge = isLoot ? `<div class="loot-badge">LOOT</div>` : '';

  return `<div class="skin-card${isLoot ? ' is-loot' : ''}">
    <div class="skin-img-wrap">
      <img src="${splashUrl}" alt="${displayName}" loading="lazy">
      ${lootBadge}
    </div>
    <div class="skin-info">
      <div class="skin-info-name">${displayName}</div>
      ${skin.chromas ? '<div class="skin-info-sub">✦ Has Chromas</div>' : ''}
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

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModalDirect();
});
