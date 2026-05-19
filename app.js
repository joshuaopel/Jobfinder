/* ============================================
   JOBFINDER — App Logic
   ============================================ */
'use strict';

const JOBS_URL = 'data/jobs.json';
const STORAGE_KEY = 'jobfinder_prefs';

const DEFAULT_SKILLS = [
  'AI', 'Prompt Engineering', 'Unreal Engine', 'Unity', '3D',
  'Motion Graphics', 'Animation', 'Creative Direction', 'Video Production',
  'Python', 'Game Design', 'Narrative Design', 'VFX', 'After Effects'
];
const DEFAULT_TITLES = [
  'Creative Director', 'AI Artist', 'Technical Artist', 'Motion Designer',
  'Game Designer', 'Narrative Designer', 'VFX Artist', 'Creative Technologist',
  'AI Content Creator', 'Art Director'
];
const SKILL_PRESETS = [
  'Blender', 'Cinema 4D', 'Houdini', 'Nuke', 'Maya', 'ZBrush', 'Substance',
  'Figma', 'Premiere', 'DaVinci', 'JavaScript', 'C++', 'Rust', 'Node.js',
  'Machine Learning', 'LLM', 'Stable Diffusion', 'Midjourney', 'ComfyUI',
  'Level Design', 'Concept Art', 'Storyboarding', 'Sound Design'
];

const CATEGORY_LABELS = {
  game_dev: '🎮 Game Dev',
  ai_tech: '🤖 AI / Tech',
  film: '🎬 Film',
  creative: '✨ Creative',
  other: '◎ Other'
};
const SOURCE_COLORS = {
  remotive: '#10b981',
  jobicy: '#06b6d4',
  greenhouse: '#7c3aed',
  lever: '#f59e0b',
  arbeitnow: '#ec4899',
  the_muse: '#f97316',
  manual: '#94a3b8'
};

/* ============================================
   STATE
   ============================================ */
const state = {
  allJobs: [],
  filteredJobs: [],
  skills: [],
  targetTitles: [],
  categories: new Set(['game_dev', 'ai_tech', 'film', 'creative', 'other']),
  location: 'all',
  sort: 'score',
  minScore: 0,
  search: '',
  activeTab: 'all',
  view: 'grid',
  loading: true
};

/* ============================================
   SCORING
   ============================================ */
function calculateScore(job) {
  if (!state.skills.length && !state.targetTitles.length) {
    // No preferences set — score by recency
    const daysOld = daysSince(job.posted_date);
    return Math.max(0, Math.round(100 - daysOld * 3));
  }

  const haystack = [
    job.title,
    job.company,
    job.description || '',
    (job.tags || []).join(' ')
  ].join(' ').toLowerCase();

  // Title relevance (35 pts)
  let titleScore = 0;
  for (const t of state.targetTitles) {
    const words = t.toLowerCase().split(/\s+/);
    const matched = words.filter(w => w.length > 2 && haystack.includes(w));
    const ratio = matched.length / words.length;
    if (ratio > 0) {
      titleScore = Math.max(titleScore, ratio * 35);
    }
  }

  // Skill matches (55 pts)
  let skillMatches = 0;
  for (const s of state.skills) {
    if (haystack.includes(s.toLowerCase())) skillMatches++;
  }
  const skillScore = state.skills.length > 0
    ? Math.min(55, (skillMatches / state.skills.length) * 55 * 1.8)
    : 0;

  // Recency bonus (10 pts)
  const daysOld = daysSince(job.posted_date);
  const recencyScore = Math.max(0, 10 - daysOld);

  return Math.min(100, Math.round(titleScore + skillScore + recencyScore));
}

function getSkillMatches(job) {
  const haystack = [job.title, job.description || '', (job.tags || []).join(' ')]
    .join(' ').toLowerCase();
  return state.skills.map(s => ({
    skill: s,
    found: haystack.includes(s.toLowerCase())
  }));
}

function scoreClass(score) {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'strong';
  if (score >= 40) return 'good';
  if (score >= 20) return 'fair';
  return 'low';
}

function scoreLabel(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Strong';
  if (score >= 40) return 'Good';
  if (score >= 20) return 'Fair';
  return 'Low';
}

function daysSince(dateStr) {
  if (!dateStr) return 30;
  const posted = new Date(dateStr);
  const now = new Date();
  return Math.max(0, (now - posted) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  if (!dateStr) return 'Unknown date';
  const d = daysSince(dateStr);
  if (d < 1) return 'Today';
  if (d < 2) return 'Yesterday';
  if (d < 7) return `${Math.floor(d)} days ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ============================================
   FILTERING
   ============================================ */
function applyFilters() {
  let jobs = state.allJobs.map(j => ({ ...j, _score: calculateScore(j) }));

  // Tab / category filter
  if (state.activeTab !== 'all') {
    jobs = jobs.filter(j => j.category === state.activeTab);
  } else {
    jobs = jobs.filter(j => state.categories.has(j.category || 'other'));
  }

  // Location filter
  if (state.location !== 'all') {
    jobs = jobs.filter(j => j.location_type === state.location);
  }

  // Min score filter
  if (state.minScore > 0) {
    jobs = jobs.filter(j => j._score >= state.minScore);
  }

  // Search
  if (state.search) {
    const q = state.search.toLowerCase();
    jobs = jobs.filter(j =>
      j.title.toLowerCase().includes(q) ||
      j.company.toLowerCase().includes(q) ||
      (j.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  // Sort
  if (state.sort === 'score') {
    jobs.sort((a, b) => b._score - a._score);
  } else if (state.sort === 'date') {
    jobs.sort((a, b) => new Date(b.posted_date || 0) - new Date(a.posted_date || 0));
  } else if (state.sort === 'company') {
    jobs.sort((a, b) => a.company.localeCompare(b.company));
  }

  state.filteredJobs = jobs;
  render();
}

/* ============================================
   RENDERING
   ============================================ */
function render() {
  const container = document.getElementById('jobs-container');
  const emptyState = document.getElementById('empty-state');
  const loadingState = document.getElementById('loading-state');

  if (state.loading) {
    loadingState.style.display = 'flex';
    emptyState.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  loadingState.style.display = 'none';

  if (!state.filteredJobs.length) {
    emptyState.style.display = 'flex';
    container.innerHTML = '';
  } else {
    emptyState.style.display = 'none';
    container.innerHTML = state.filteredJobs.map(renderCard).join('');
  }

  updateCounts();
  updateResultCount();
  updateSourceStats();
}

function renderCard(job) {
  const score = job._score;
  const cls = scoreClass(score);
  const locType = job.location_type || 'onsite';
  const locLabel = locType === 'remote' ? '🌐 Remote' : locType === 'dallas' ? '📍 Dallas' : `📍 ${job.location || 'On-site'}`;
  const categoryLabel = CATEGORY_LABELS[job.category] || '◎ Other';
  const excerpt = stripHtml(job.description || '').slice(0, 180).trim() + '…';
  const tags = (job.tags || []).slice(0, 5);
  const avatar = (job.company || '?')[0].toUpperCase();
  const matchedSkillsCount = state.skills.length
    ? state.skills.filter(s => (job.description || job.title || '').toLowerCase().includes(s.toLowerCase())).length
    : 0;

  return `
  <div class="job-card ${score >= 80 ? 'score-high' : ''}" onclick="App.openModal('${escapeAttr(job.id)}')">
    <div class="score-line ${cls}"></div>
    <div class="card-top">
      <div class="company-avatar">${avatar}</div>
      <div class="card-info">
        <div class="job-title">${escapeHtml(job.title)}</div>
        <div class="job-company">
          ${escapeHtml(job.company)}
          <span class="location-badge ${locType}">${locLabel}</span>
        </div>
      </div>
      <div class="score-badge ${cls}">
        <span class="score-num">${score}</span>
        <span class="score-label">${scoreLabel(score)}</span>
      </div>
    </div>
    <div class="card-tags">
      <span class="tag tag-source">${escapeHtml(job.source || 'web')}</span>
      <span class="tag tag-category">${categoryLabel}</span>
      ${tags.map(t => {
        const matched = state.skills.some(s => s.toLowerCase() === t.toLowerCase());
        return `<span class="tag tag-skill ${matched ? 'matched' : ''}">${escapeHtml(t)}</span>`;
      }).join('')}
      ${state.skills.length ? `<span class="tag tag-skill" style="opacity:0.5">${matchedSkillsCount}/${state.skills.length} skills</span>` : ''}
    </div>
    <p class="job-excerpt">${escapeHtml(excerpt)}</p>
    <div class="card-footer">
      <span class="posted-date">${formatDate(job.posted_date)}</span>
      <a class="apply-btn" href="${escapeAttr(job.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
        Apply →
      </a>
    </div>
  </div>`;
}

function updateCounts() {
  const catCounts = {};
  state.allJobs.forEach(j => {
    const cat = j.category || 'other';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });
  Object.keys(catCounts).forEach(cat => {
    const el = document.getElementById(`count-${cat}`);
    if (el) el.textContent = catCounts[cat];
  });
}

function updateResultCount() {
  const el = document.getElementById('result-count');
  if (el) {
    const total = state.allJobs.length;
    const showing = state.filteredJobs.length;
    el.textContent = total > 0
      ? `${showing.toLocaleString()} / ${total.toLocaleString()} jobs`
      : 'No jobs loaded';
  }
}

function updateSourceStats() {
  const counts = {};
  state.allJobs.forEach(j => {
    const src = j.source || 'other';
    counts[src] = (counts[src] || 0) + 1;
  });
  const el = document.getElementById('source-stats');
  if (!el) return;
  el.innerHTML = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([src, n]) => {
      const color = SOURCE_COLORS[src] || '#94a3b8';
      return `<div class="source-row">
        <div class="source-dot" style="background:${color}"></div>
        <span class="source-name">${src}</span>
        <span class="source-n">${n}</span>
      </div>`;
    }).join('');
}

function updateLastUpdated(ts) {
  const el = document.getElementById('last-updated');
  if (!el) return;
  if (!ts) { el.textContent = 'Never scraped'; return; }
  const d = new Date(ts);
  el.textContent = `Updated ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

/* ============================================
   MODAL
   ============================================ */
function openModal(jobId) {
  const job = state.allJobs.find(j => j.id === jobId);
  if (!job) return;

  const score = calculateScore(job);
  const cls = scoreClass(score);
  const locType = job.location_type || 'onsite';
  const locLabel = locType === 'remote' ? '🌐 Remote'
    : locType === 'dallas' ? '📍 Dallas, TX'
    : `📍 ${job.location || 'On-site'}`;
  const categoryLabel = CATEGORY_LABELS[job.category] || '◎ Other';
  const skillMatches = getSkillMatches(job);
  const descHtml = formatDescription(job.description || 'No description available.');
  const posted = formatDate(job.posted_date);

  const matchedCount = skillMatches.filter(m => m.found).length;

  const content = `
    <div class="modal-header">
      <div class="modal-title">${escapeHtml(job.title)}</div>
      <div class="modal-meta">
        <strong>${escapeHtml(job.company)}</strong>
        <span>·</span>
        <span>${locLabel}</span>
        <span>·</span>
        <span>${categoryLabel}</span>
        <span>·</span>
        <span style="color:var(--text-3)">${posted}</span>
      </div>
    </div>
    <div class="modal-score score-badge ${cls}" style="display:inline-flex;margin-bottom:16px">
      <span class="score-num" style="font-size:22px">${score}</span>
      <div style="margin-left:10px">
        <div style="font-size:13px;font-weight:700;color:var(--text-1)">${scoreLabel(score)} Match</div>
        <div style="font-size:11px;color:var(--text-3)">${matchedCount} of ${state.skills.length || 0} skills found</div>
      </div>
    </div>
    <div class="modal-tags">
      <span class="tag tag-source">${escapeHtml(job.source || 'web')}</span>
      ${(job.tags || []).map(t => {
        const matched = state.skills.some(s => s.toLowerCase() === t.toLowerCase());
        return `<span class="tag tag-skill ${matched ? 'matched' : ''}">${escapeHtml(t)}</span>`;
      }).join('')}
    </div>
    ${state.skills.length ? `
    <div class="skill-match-section">
      <div class="skill-match-label">Skill Breakdown</div>
      ${skillMatches.slice(0, 12).map(m => `
        <div class="skill-bar-row">
          <span class="skill-bar-name">${escapeHtml(m.skill)}</span>
          <div class="skill-bar-track">
            <div class="skill-bar-fill" style="width:${m.found ? 100 : 0}%"></div>
          </div>
          <span class="${m.found ? 'skill-bar-found' : 'skill-bar-miss'}">${m.found ? '✓' : '—'}</span>
        </div>`).join('')}
    </div>` : ''}
    <div class="modal-desc">${descHtml}</div>
    <div class="modal-actions">
      <a href="${escapeAttr(job.url)}" target="_blank" rel="noopener" class="btn-apply-full">Apply Now →</a>
    </div>
  `;

  document.getElementById('modal-content').innerHTML = content;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('job-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('job-modal').classList.remove('open');
  document.body.style.overflow = '';
}

/* ============================================
   TAG INPUT
   ============================================ */
function initTagInput(inputId, containerId, stateKey, onChange) {
  const input = document.getElementById(inputId);
  const container = document.getElementById(containerId);
  if (!input || !container) return;

  function renderTags() {
    container.innerHTML = state[stateKey].map((tag, i) => `
      <span class="skill-tag">
        ${escapeHtml(tag)}
        <span class="tag-remove" onclick="App.removeTag('${stateKey}', ${i})">×</span>
      </span>
    `).join('');
  }

  function addTag(val) {
    val = val.trim();
    if (!val) return;
    const tags = val.split(',').map(t => t.trim()).filter(Boolean);
    tags.forEach(tag => {
      if (tag && !state[stateKey].includes(tag)) {
        state[stateKey].push(tag);
      }
    });
    renderTags();
    savePrefs();
    if (onChange) onChange();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input.value);
      input.value = '';
    } else if (e.key === 'Backspace' && !input.value && state[stateKey].length) {
      state[stateKey].pop();
      renderTags();
      savePrefs();
      if (onChange) onChange();
    }
  });

  input.addEventListener('blur', () => {
    if (input.value) { addTag(input.value); input.value = ''; }
  });

  // Make clicking the wrap focus the input
  document.getElementById(inputId.replace('-input', '-wrap'))?.addEventListener('click', () => input.focus());

  renderTags();
}

function removeTag(stateKey, idx) {
  state[stateKey].splice(idx, 1);
  if (stateKey === 'skills') {
    document.getElementById('skills-tags').innerHTML = state.skills.map((tag, i) => `
      <span class="skill-tag">${escapeHtml(tag)}<span class="tag-remove" onclick="App.removeTag('skills',${i})">×</span></span>
    `).join('');
  } else {
    document.getElementById('titles-tags').innerHTML = state.targetTitles.map((tag, i) => `
      <span class="skill-tag">${escapeHtml(tag)}<span class="tag-remove" onclick="App.removeTag('targetTitles',${i})">×</span></span>
    `).join('');
  }
  savePrefs();
  applyFilters();
}

/* ============================================
   PERSISTENCE
   ============================================ */
function savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      skills: state.skills,
      targetTitles: state.targetTitles
    }));
  } catch (e) {}
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      state.skills = p.skills || DEFAULT_SKILLS;
      state.targetTitles = p.targetTitles || DEFAULT_TITLES;
    } else {
      state.skills = [...DEFAULT_SKILLS];
      state.targetTitles = [...DEFAULT_TITLES];
    }
  } catch (e) {
    state.skills = [...DEFAULT_SKILLS];
    state.targetTitles = [...DEFAULT_TITLES];
  }
}

/* ============================================
   DATA LOADING
   ============================================ */
async function loadJobs() {
  state.loading = true;
  render();
  try {
    const res = await fetch(`${JOBS_URL}?v=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.allJobs = data.jobs || [];
    updateLastUpdated(data.last_updated);
  } catch (e) {
    console.warn('Could not load jobs.json — using seed data', e);
    state.allJobs = SEED_JOBS;
    updateLastUpdated(null);
  }
  state.loading = false;
  applyFilters();
}

/* ============================================
   CONTROLS INIT
   ============================================ */
function initControls() {
  // Search
  document.getElementById('search-input')?.addEventListener('input', e => {
    state.search = e.target.value;
    applyFilters();
  });

  // Category checkboxes
  document.querySelectorAll('#category-filters input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', e => {
      if (e.target.checked) state.categories.add(e.target.value);
      else state.categories.delete(e.target.value);
      applyFilters();
    });
  });

  // Location radio
  document.querySelectorAll('[name=location]').forEach(r => {
    r.addEventListener('change', e => {
      state.location = e.target.value;
      applyFilters();
    });
  });

  // Sort radio
  document.querySelectorAll('[name=sort]').forEach(r => {
    r.addEventListener('change', e => {
      state.sort = e.target.value;
      applyFilters();
    });
  });

  // Min score slider
  const slider = document.getElementById('min-score');
  const sliderLabel = document.getElementById('min-score-label');
  slider?.addEventListener('input', e => {
    state.minScore = Number(e.target.value);
    if (sliderLabel) sliderLabel.textContent = `${state.minScore}%`;
    applyFilters();
  });

  // Category tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeTab = tab.dataset.tab;
      applyFilters();
    });
  });

  // Keyboard shortcut for search
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('search-input')?.focus();
    }
    if (e.key === 'Escape') closeModal();
  });

  // Preset skill chips
  const presetWrap = document.getElementById('skill-presets');
  if (presetWrap) {
    presetWrap.innerHTML = '<span class="preset-label">Quick add:</span>' +
      SKILL_PRESETS.map(s =>
        `<span class="preset-chip" onclick="App.addPresetSkill('${escapeAttr(s)}')">${escapeHtml(s)}</span>`
      ).join('');
  }
}

/* ============================================
   HELPERS
   ============================================ */
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatDescription(raw) {
  // Convert basic HTML or plain text to readable format
  let text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return escapeHtml(text);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ============================================
   SEED DATA (shown when jobs.json is missing)
   ============================================ */
const SEED_JOBS = [
  {
    id: 'seed-1', title: 'Senior AI Artist', company: 'Epic Games', location: 'Remote',
    location_type: 'remote', category: 'ai_tech', source: 'greenhouse',
    url: 'https://www.epicgames.com/site/en-US/careers',
    description: 'Work at the intersection of AI and art to define the next generation of game visuals. You will use generative AI tools, design pipelines, and Unreal Engine to create groundbreaking content. Requirements: 5+ years in game art, proficiency with AI tools, Unreal Engine 5, Python scripting.',
    tags: ['AI', 'Unreal Engine', 'Python', 'Game Art', 'Generative AI'],
    posted_date: new Date(Date.now() - 1 * 86400000).toISOString()
  },
  {
    id: 'seed-2', title: 'Narrative Designer', company: 'Bungie', location: 'Remote',
    location_type: 'remote', category: 'game_dev', source: 'greenhouse',
    url: 'https://www.bungie.net/en/About/Careers',
    description: 'Shape stories that define a generation of players. Drive the creative vision for world-building, character arcs, and in-game writing. You will collaborate with design, art, and audio teams to craft immersive narrative experiences in Destiny 2 and future projects.',
    tags: ['Narrative Design', 'Game Design', 'Writing', 'Worldbuilding'],
    posted_date: new Date(Date.now() - 2 * 86400000).toISOString()
  },
  {
    id: 'seed-3', title: 'Motion Graphics Designer', company: 'Riot Games', location: 'Remote / LA',
    location_type: 'remote', category: 'creative', source: 'greenhouse',
    url: 'https://www.riotgames.com/en/work-with-us',
    description: 'Create stunning motion graphics for esports broadcasts, game trailers, and social media. Requires After Effects, Cinema 4D, and a strong portfolio of broadcast design work.',
    tags: ['Motion Graphics', 'After Effects', 'Cinema 4D', 'Esports', 'Broadcast'],
    posted_date: new Date(Date.now() - 3 * 86400000).toISOString()
  },
  {
    id: 'seed-4', title: 'AI / ML Engineer — Creative Tools', company: 'Adobe', location: 'Remote or Dallas, TX',
    location_type: 'dallas', category: 'ai_tech', source: 'greenhouse',
    url: 'https://adobe.wd5.myworkdayjobs.com/en-US/external_experienced/jobs',
    description: 'Build the AI that powers Creative Cloud. Work on Firefly, Sensei, and the next generation of generative tools. Strong Python, ML frameworks (PyTorch/JAX), and passion for creative applications required.',
    tags: ['Machine Learning', 'Python', 'PyTorch', 'Generative AI', 'Creative Tools'],
    posted_date: new Date(Date.now() - 0 * 86400000).toISOString()
  },
  {
    id: 'seed-5', title: 'Technical Artist — Real-Time VFX', company: 'Respawn Entertainment', location: 'Remote',
    location_type: 'remote', category: 'game_dev', source: 'lever',
    url: 'https://www.ea.com/careers',
    description: 'Craft real-time visual effects for Star Wars Jedi and future titles. Bridge the gap between art and engineering: shader development, particle systems, optimization, and artist tooling in Unreal Engine.',
    tags: ['VFX', 'Unreal Engine', 'HLSL', 'Technical Art', 'Niagara'],
    posted_date: new Date(Date.now() - 4 * 86400000).toISOString()
  },
  {
    id: 'seed-6', title: 'Creative Director — AI Products', company: 'Anthropic', location: 'Remote',
    location_type: 'remote', category: 'ai_tech', source: 'greenhouse',
    url: 'https://www.anthropic.com/careers',
    description: 'Lead the creative vision for Claude and Anthropic consumer products. You bring deep experience in product design, brand, and emerging AI interfaces. You will define how humans interact with powerful AI systems.',
    tags: ['Creative Direction', 'AI', 'Product Design', 'Brand', 'UX'],
    posted_date: new Date(Date.now() - 1 * 86400000).toISOString()
  },
  {
    id: 'seed-7', title: 'VFX Compositor', company: 'Netflix Animation', location: 'Remote',
    location_type: 'remote', category: 'film', source: 'lever',
    url: 'https://jobs.netflix.com',
    description: 'Composite visual effects for original animated features and series. Requires Nuke, strong understanding of color science, and experience on feature film or high-end episodic content.',
    tags: ['VFX', 'Nuke', 'Compositing', 'Color Science', 'Animation'],
    posted_date: new Date(Date.now() - 5 * 86400000).toISOString()
  },
  {
    id: 'seed-8', title: 'Prompt Engineer — Generative AI', company: 'Midjourney', location: 'Remote',
    location_type: 'remote', category: 'ai_tech', source: 'greenhouse',
    url: 'https://midjourney.com/jobs',
    description: 'Design, test, and refine prompting systems that power world-class image generation. Work directly with model teams to translate user needs into optimal prompt strategies. Strong aesthetic sensibility and technical curiosity required.',
    tags: ['Prompt Engineering', 'AI', 'Generative AI', 'Midjourney', 'Creative'],
    posted_date: new Date(Date.now() - 2 * 86400000).toISOString()
  }
];

/* ============================================
   PUBLIC API
   ============================================ */
window.App = {
  refresh() {
    const icon = document.getElementById('refresh-icon');
    if (icon) icon.classList.add('spinning');
    loadJobs().finally(() => {
      if (icon) icon.classList.remove('spinning');
    });
    // Show info about manual GitHub Actions trigger
    const info = document.getElementById('scraper-info');
    if (info) {
      info.style.display = 'block';
      setTimeout(() => { info.style.display = 'none'; }, 8000);
    }
  },
  openModal(id) { openModal(id); },
  closeModal() { closeModal(); },
  setView(v) {
    state.view = v;
    const container = document.getElementById('jobs-container');
    if (container) {
      container.classList.toggle('list-view', v === 'list');
    }
    document.getElementById('view-grid')?.classList.toggle('active', v === 'grid');
    document.getElementById('view-list')?.classList.toggle('active', v === 'list');
  },
  resetFilters() {
    state.location = 'all';
    state.sort = 'score';
    state.minScore = 0;
    state.search = '';
    state.activeTab = 'all';
    state.categories = new Set(['game_dev', 'ai_tech', 'film', 'creative', 'other']);

    document.getElementById('search-input').value = '';
    document.querySelector('[name=location][value=all]').checked = true;
    document.querySelector('[name=sort][value=score]').checked = true;
    document.getElementById('min-score').value = 0;
    document.getElementById('min-score-label').textContent = '0%';
    document.querySelectorAll('#category-filters input').forEach(cb => cb.checked = true);
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'all'));

    applyFilters();
  },
  removeTag(key, idx) { removeTag(key, idx); },
  addPresetSkill(skill) {
    if (!state.skills.includes(skill)) {
      state.skills.push(skill);
      document.getElementById('skills-tags').innerHTML = state.skills.map((tag, i) =>
        `<span class="skill-tag">${escapeHtml(tag)}<span class="tag-remove" onclick="App.removeTag('skills',${i})">×</span></span>`
      ).join('');
      savePrefs();
      applyFilters();
    }
  }
};

/* ============================================
   INIT
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
  loadPrefs();
  initControls();
  initTagInput('skills-input', 'skills-tags', 'skills', applyFilters);
  initTagInput('titles-input', 'titles-tags', 'targetTitles', applyFilters);
  loadJobs();
});
