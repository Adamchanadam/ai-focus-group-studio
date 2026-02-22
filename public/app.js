// === State ===
const state = {
  currentView: 'setup',
  sessionId: null,
  topic: '',
  agents: [],
  messages: [],
  rounds: 3,
  currentRound: 0,
  agentCount: 3,
  isPaused: false,
  isRunning: false,
  editingAgentIndex: null,
  pendingInterjections: [],
  _abortController: null,
  summaryData: null,
  summaryGenerated: false,
  webSearchEnabled: true,
  goalMeasurement: '',
  focusGroupMode: 'share_perspectives',
  sessionTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  // Search Provider
  searchProvider: 'openai',       // 'openai' | 'exa' | 'firecrawl' | 'brave' | 'none'
  searchCount: 5,                 // 3-10
  availableProviders: [],         // from /api/config
  sidebarSearchProvider: 'brave', // default for sidebar quick search
  // Agent Library
  agentLibrary: [],
  panelCompMode: 'generate',   // 'generate' | 'library' | 'mix'
  selectedLibraryAgentIds: [],
  editingLibraryAgentId: null
};

// === LocalStorage ===
const STORAGE_KEY = 'fg_sessions';

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveSessions(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    if (e.name === 'QuotaExceededError' && sessions.length > 1) {
      console.warn('localStorage quota exceeded, removing oldest session');
      sessions.pop(); // remove oldest (last, since newest first)
      saveSessions(sessions);
    } else {
      console.warn('localStorage save failed:', e.message);
    }
  }
}

function saveCurrentSession() {
  if (!state.sessionId) return;
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === state.sessionId);
  const session = {
    id: state.sessionId,
    topic: state.topic,
    agents: state.agents,
    messages: state.messages,
    rounds: state.rounds,
    currentRound: state.currentRound,
    summaryData: state.summaryData,
    summaryGenerated: state.summaryGenerated,
    webSearchEnabled: state.searchProvider !== 'none',
    searchProvider: state.searchProvider,
    searchCount: state.searchCount,
    goalMeasurement: state.goalMeasurement,
    focusGroupMode: state.focusGroupMode,
    sessionTimezone: state.sessionTimezone,
    agentBriefs: state.agentBriefs || {},
    createdAt: idx >= 0 ? sessions[idx].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.unshift(session);
  }
  saveSessions(sessions);
  renderSessionList();
}

function deleteSession(id) {
  const sessions = loadSessions().filter(s => s.id !== id);
  saveSessions(sessions);
  if (state.sessionId === id) {
    state.sessionId = null;
    state.messages = [];
    state.agents = [];
    showView('setup');
  }
  renderSessionList();
}

function loadSession(id) {
  const session = loadSessions().find(s => s.id === id);
  if (!session) return;
  state.sessionId = session.id;
  state.topic = session.topic;
  state.agents = session.agents;
  state.messages = session.messages;
  state.rounds = session.rounds;
  state.currentRound = session.currentRound || 0;
  state.summaryData = session.summaryData || null;
  state.summaryGenerated = session.summaryGenerated || false;
  state.webSearchEnabled = session.webSearchEnabled !== false;
  state.searchProvider = session.searchProvider || (session.webSearchEnabled !== false ? 'openai' : 'none');
  state.searchCount = session.searchCount || 5;
  state.goalMeasurement = session.goalMeasurement || '';
  state.focusGroupMode = session.focusGroupMode || 'share_perspectives';
  state.sessionTimezone = session.sessionTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  state.agentBriefs = session.agentBriefs || {};
  state.isRunning = false;
  state.isPaused = false;
  showView('discussion');
  renderChat();
  renderAgentPanel();
  document.getElementById('chatTopic').textContent = state.topic;
  updateRoundIndicator();

  // Show summary button if discussion has messages and isn't running
  if (state.messages.some(m => m.type === 'agent')) {
    showSummaryPromptButton();
  }
}

// === View Switching ===
function showView(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(view === 'setup' ? 'viewSetup' : 'viewDiscussion').classList.add('active');
}

// === Rendering ===
function renderSessionList() {
  const list = document.getElementById('sessionList');
  const sessions = loadSessions();
  if (sessions.length === 0) {
    list.innerHTML = '<div class="session-list-empty">No saved sessions</div>';
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="session-item ${s.id === state.sessionId ? 'active' : ''}" data-id="${s.id}">
      <div class="session-item-topic">${escapeHtml(s.topic)}</div>
      <div class="session-item-meta">
        <span>${s.agents.length} agents &middot; ${s.messages.length} msgs</span>
        <button class="session-item-delete" data-delete="${s.id}">&times;</button>
      </div>
    </div>
  `).join('');
  // Event delegation is set up once in DOMContentLoaded
}

// === Agent Library ===
async function loadAgentLibrary() {
  try {
    const res = await fetch('/api/agents');
    if (!res.ok) throw new Error('Failed to load agents');
    state.agentLibrary = await res.json();
  } catch (err) {
    console.warn('Agent library load failed:', err.message);
    state.agentLibrary = [];
  }
  renderAgentLibrary();
  renderAgentPicker();
}

function renderAgentLibrary() {
  const list = document.getElementById('agentLibraryList');
  if (!list) return;
  if (state.agentLibrary.length === 0) {
    list.innerHTML = '<div class="agent-lib-empty">No saved agents</div>';
    return;
  }
  list.innerHTML = state.agentLibrary.map(a => `
    <div class="agent-lib-item" data-agent-id="${a.id}">
      <div class="agent-avatar agent-lib-avatar" style="background:${a.color}">${getInitials(a.name)}</div>
      <div class="agent-lib-info">
        <div class="agent-lib-name">${escapeHtml(a.name)}</div>
        <div class="agent-lib-role">${escapeHtml(a.role)}</div>
      </div>
      <span class="agent-lib-sessions">${a.knowledgeBase ? a.knowledgeBase.sessionCount : 0}</span>
    </div>
  `).join('');
}

function renderAgentPicker() {
  const grid = document.getElementById('agentPickerGrid');
  if (!grid) return;
  if (state.agentLibrary.length === 0) {
    grid.innerHTML = '<div class="agent-lib-empty">No agents in library. Create some first.</div>';
    return;
  }
  grid.innerHTML = state.agentLibrary.map(a => {
    const selected = state.selectedLibraryAgentIds.includes(a.id);
    return `
    <div class="agent-picker-card ${selected ? 'selected' : ''}" data-agent-id="${a.id}">
      <div class="agent-avatar" style="background:${a.color}">${getInitials(a.name)}</div>
      <div class="agent-picker-card-info">
        <div class="agent-picker-card-name">${escapeHtml(a.name)}</div>
        <div class="agent-picker-card-role">${escapeHtml(a.role)}</div>
        <div class="agent-picker-card-sessions">${a.knowledgeBase ? a.knowledgeBase.sessionCount : 0} sessions</div>
      </div>
      <div class="agent-picker-check">${selected ? '&#10003;' : ''}</div>
    </div>`;
  }).join('');
  updatePickerCount();
}

function togglePickerAgent(agentId) {
  const idx = state.selectedLibraryAgentIds.indexOf(agentId);
  if (idx >= 0) {
    state.selectedLibraryAgentIds.splice(idx, 1);
  } else {
    state.selectedLibraryAgentIds.push(agentId);
  }
  renderAgentPicker();
}

function updatePickerCount() {
  const el = document.getElementById('agentPickerCount');
  if (el) el.textContent = `${state.selectedLibraryAgentIds.length} selected`;
}

function openAgentLibDetail(agentId) {
  const agent = state.agentLibrary.find(a => a.id === agentId);
  if (!agent) return;
  state.editingLibraryAgentId = agentId;

  document.getElementById('agentLibDetailTitle').textContent = agent.name;
  document.getElementById('agentLibDetailRole').textContent = agent.role;
  document.getElementById('agentLibDetailBackground').textContent = agent.background || '-';
  document.getElementById('agentLibDetailPerspective').textContent = agent.perspective || '-';
  document.getElementById('agentLibDetailSessions').textContent =
    `${agent.knowledgeBase ? agent.knowledgeBase.sessionCount : 0} sessions`;

  const avatar = document.getElementById('agentLibDetailAvatar');
  avatar.style.background = agent.color;
  avatar.textContent = getInitials(agent.name);

  // Always show insights section — show content or empty hint
  const insightsEl = document.getElementById('agentLibDetailInsights');
  const insightsEmptyHint = document.getElementById('insightsEmptyHint');
  const insightsEditArea = document.getElementById('insightsEditArea');
  insightsEditArea.classList.add('hidden');  // reset edit mode
  if (agent.accumulatedInsights) {
    insightsEl.textContent = agent.accumulatedInsights;
    insightsEl.classList.remove('hidden');
    insightsEmptyHint.classList.add('hidden');
  } else {
    insightsEl.classList.add('hidden');
    insightsEmptyHint.classList.remove('hidden');
  }

  const topicsSection = document.getElementById('agentLibDetailTopicsSection');
  const topicsEl = document.getElementById('agentLibDetailTopics');
  if (agent.knowledgeBase && agent.knowledgeBase.topicsDiscussed && agent.knowledgeBase.topicsDiscussed.length > 0) {
    topicsSection.style.display = '';
    topicsEl.innerHTML = agent.knowledgeBase.topicsDiscussed.map(t =>
      `<span class="agent-lib-topic-tag">${escapeHtml(t.topic.substring(0, 60))}</span>`
    ).join('');
  } else {
    topicsSection.style.display = 'none';
  }

  // Render knowledge sources
  const sourcesSection = document.getElementById('agentLibDetailSourcesSection');
  const sourcesEl = document.getElementById('agentLibDetailSources');
  const kSources = agent.knowledgeSources || [];
  if (kSources.length > 0) {
    sourcesSection.style.display = '';
    // Show newest first, max 20
    const recent = kSources.slice().reverse().slice(0, 20);
    sourcesEl.innerHTML = recent.map(s => {
      const displayTitle = escapeHtml(s.title || (s.url.length > 60 ? s.url.substring(0, 60) + '...' : s.url));
      const dateStr = s.date ? new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      const topicStr = s.sessionTopic ? escapeHtml(s.sessionTopic.substring(0, 40)) : '';
      return `<div class="agent-lib-source-item">
        <a class="source-link" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${displayTitle}</a>
        <div class="source-meta">${dateStr}${topicStr ? ' &middot; ' + topicStr : ''}</div>
      </div>`;
    }).join('');
  } else {
    sourcesSection.style.display = 'none';
  }

  document.getElementById('agentLibDetailModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeAgentLibDetail() {
  document.getElementById('agentLibDetailModal').classList.add('hidden');
  document.getElementById('insightsEditArea').classList.add('hidden');
  document.body.style.overflow = '';
  state.editingLibraryAgentId = null;
}

function toggleInsightsEdit() {
  const editArea = document.getElementById('insightsEditArea');
  const insightsEl = document.getElementById('agentLibDetailInsights');
  const emptyHint = document.getElementById('insightsEmptyHint');
  const textarea = document.getElementById('insightsEditTextarea');

  if (editArea.classList.contains('hidden')) {
    // Enter edit mode
    const agent = state.agentLibrary.find(a => a.id === state.editingLibraryAgentId);
    textarea.value = agent ? (agent.accumulatedInsights || '') : '';
    editArea.classList.remove('hidden');
    insightsEl.classList.add('hidden');
    emptyHint.classList.add('hidden');
    textarea.focus();
  } else {
    // Cancel edit mode — restore display
    cancelInsightsEdit();
  }
}

function cancelInsightsEdit() {
  const agent = state.agentLibrary.find(a => a.id === state.editingLibraryAgentId);
  const editArea = document.getElementById('insightsEditArea');
  const insightsEl = document.getElementById('agentLibDetailInsights');
  const emptyHint = document.getElementById('insightsEmptyHint');

  editArea.classList.add('hidden');
  if (agent && agent.accumulatedInsights) {
    insightsEl.textContent = agent.accumulatedInsights;
    insightsEl.classList.remove('hidden');
    emptyHint.classList.add('hidden');
  } else {
    insightsEl.classList.add('hidden');
    emptyHint.classList.remove('hidden');
  }
}

async function saveInsightsEdit() {
  if (!state.editingLibraryAgentId) return;
  const textarea = document.getElementById('insightsEditTextarea');
  const newInsights = textarea.value.trim();

  try {
    const res = await fetch(`/api/agents/${state.editingLibraryAgentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accumulatedInsights: newInsights })
    });
    if (!res.ok) throw new Error('Failed to save');
    const updated = await res.json();

    // Update local state
    const idx = state.agentLibrary.findIndex(a => a.id === state.editingLibraryAgentId);
    if (idx >= 0) state.agentLibrary[idx] = updated;

    // Update display
    const insightsEl = document.getElementById('agentLibDetailInsights');
    const emptyHint = document.getElementById('insightsEmptyHint');
    document.getElementById('insightsEditArea').classList.add('hidden');

    if (newInsights) {
      insightsEl.textContent = newInsights;
      insightsEl.classList.remove('hidden');
      emptyHint.classList.add('hidden');
    } else {
      insightsEl.classList.add('hidden');
      emptyHint.classList.remove('hidden');
    }
    showToast('Insights saved');
  } catch (err) {
    showToast('Failed to save insights', 'error');
  }
}

async function clearInsights() {
  if (!state.editingLibraryAgentId) return;
  if (!confirm('Clear all accumulated insights for this agent? This cannot be undone.')) return;
  document.getElementById('insightsEditTextarea').value = '';
  await saveInsightsEdit();
}

async function createAgentFromModal() {
  const name = document.getElementById('createAgentName').value.trim();
  const role = document.getElementById('createAgentRole').value.trim();
  const background = document.getElementById('createAgentBackground').value.trim();
  const perspective = document.getElementById('createAgentPerspective').value.trim();
  const colorEl = document.querySelector('#createAgentColorPicker .color-swatch.active');
  const color = colorEl ? colorEl.dataset.color : '#607D8B';

  if (!name || !role) {
    showNotification('Name and Role are required', 'error');
    return;
  }

  try {
    const isEditing = state.editingLibraryAgentId;
    const url = isEditing ? `/api/agents/${state.editingLibraryAgentId}` : '/api/agents';
    const method = isEditing ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role, background, perspective, color })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save agent');
    }
    showNotification(isEditing ? 'Agent updated' : 'Agent created', 'success');
    closeCreateAgentModal();
    await loadAgentLibrary();
  } catch (err) {
    showNotification('Error: ' + err.message, 'error');
  }
}

function openCreateAgentModal(editAgent) {
  if (editAgent) {
    state.editingLibraryAgentId = editAgent.id;
    document.getElementById('createAgentModalTitle').textContent = 'Edit Agent';
    document.getElementById('createAgentName').value = editAgent.name;
    document.getElementById('createAgentRole').value = editAgent.role;
    document.getElementById('createAgentBackground').value = editAgent.background || '';
    document.getElementById('createAgentPerspective').value = editAgent.perspective || '';
    // Set color
    document.querySelectorAll('#createAgentColorPicker .color-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === editAgent.color);
    });
  } else {
    state.editingLibraryAgentId = null;
    document.getElementById('createAgentModalTitle').textContent = 'Create Agent';
    document.getElementById('createAgentName').value = '';
    document.getElementById('createAgentRole').value = '';
    document.getElementById('createAgentBackground').value = '';
    document.getElementById('createAgentPerspective').value = '';
    document.querySelectorAll('#createAgentColorPicker .color-swatch').forEach((s, i) => {
      s.classList.toggle('active', i === 0);
    });
  }
  document.getElementById('createAgentModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeCreateAgentModal() {
  document.getElementById('createAgentModal').classList.add('hidden');
  document.body.style.overflow = '';
  state.editingLibraryAgentId = null;
}

async function deleteLibraryAgent(agentId) {
  if (!confirm('Delete this agent permanently?')) return;
  try {
    const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete');
    showNotification('Agent deleted', 'success');
    closeAgentLibDetail();
    await loadAgentLibrary();
  } catch (err) {
    showNotification('Error: ' + err.message, 'error');
  }
}

async function saveAgentsToLibrary() {
  const unsavedAgents = state.agents.filter(a => !a.id);
  if (unsavedAgents.length === 0) {
    showNotification('All agents are already in library', 'info');
    return;
  }
  try {
    const res = await fetch('/api/agents/save-from-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: unsavedAgents })
    });
    if (!res.ok) throw new Error('Failed to save');
    const saved = await res.json();
    // Update local agent references with new IDs
    for (const savedAgent of saved) {
      const match = state.agents.find(a => a.name === savedAgent.name && !a.id);
      if (match) match.id = savedAgent.id;
    }
    showNotification(`${saved.length} agents saved to library`, 'success');
    await loadAgentLibrary();
    renderRoleCards();
  } catch (err) {
    showNotification('Error: ' + err.message, 'error');
  }
}

async function triggerAgentLearning() {
  // Only learn for persistent agents (those with IDs)
  const persistentAgents = state.agents.filter(a => a.id);
  if (persistentAgents.length === 0) return;

  const agentMessages = state.messages.filter(m => m.type === 'agent');
  if (agentMessages.length === 0) return;

  for (const agent of persistentAgents) {
    // Collect this agent's contributions (max ~2000 chars)
    const myMessages = agentMessages.filter(m => m.agentName === agent.name);
    const contributions = myMessages
      .map(m => m.content)
      .join('\n---\n')
      .substring(0, 2000);

    if (!contributions) continue;

    // Collect sources from multiple places:
    // 1. Sources attached to this agent's messages (from SSE done event)
    const msgSources = myMessages.flatMap(m => m.sources || []);

    // 2. Inline citation URLs extracted from message content
    const inlineSources = [];
    const citationRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    for (const m of myMessages) {
      let match;
      while ((match = citationRegex.exec(m.content)) !== null) {
        inlineSources.push({ url: match[2], title: match[1] });
      }
    }

    // 3. Sources from related search messages for this agent
    const searchSources = state.messages
      .filter(m => m.type === 'search' && m.agentName === agent.name && m.results)
      .flatMap(m => m.results.map(r => ({ url: r.url, title: r.title })));

    // Deduplicate by URL
    const seen = new Set();
    const allSources = [...msgSources, ...inlineSources, ...searchSources].filter(s => {
      if (!s.url || seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    try {
      await fetch(`/api/agents/${agent.id}/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: state.topic,
          sessionId: state.sessionId,
          recentContributions: contributions,
          sources: allSources
        })
      });
    } catch (err) {
      console.warn(`Learning failed for ${agent.name}:`, err.message);
    }
  }
  // Refresh library to show updated knowledge
  await loadAgentLibrary();
}

function renderRoleCards() {
  const container = document.getElementById('roleCards');
  const briefs = state.agentBriefs || {};
  container.innerHTML = state.agents.map((agent, i) => {
    const brief = briefs[agent.name];
    const hasBrief = !!brief;
    return `
    <div class="role-card ${hasBrief ? 'prepared' : ''}" data-index="${i}" style="border-left-color: ${agent.color}">
      <div class="role-card-name">${escapeHtml(agent.name)}${agent.id ? ' <span class="role-card-lib-badge">Library</span>' : ''}</div>
      <div class="role-card-role">${escapeHtml(agent.role)}</div>
      <div class="role-card-bg">${escapeHtml(agent.background)}</div>
      <div class="role-card-perspective">${escapeHtml(agent.perspective)}</div>
      <div class="role-card-brief" id="briefSlot${i}">
        ${hasBrief ? `
          <div class="role-card-brief-label">Research Brief</div>
          <div class="role-card-brief-content">${escapeHtml(brief)}</div>
        ` : ''}
      </div>
    </div>`;
  }).join('');

  // Event delegation is set up once in DOMContentLoaded
}

function renderAgentPanel() {
  const list = document.getElementById('agentListMini');
  list.innerHTML = state.agents.map((agent, i) => `
    <div class="agent-mini" data-index="${i}" id="agentMini${i}" title="Click to view profile">
      <div class="agent-avatar" style="background: ${agent.color}">${getInitials(agent.name)}</div>
      <div class="agent-mini-info">
        <div class="agent-mini-name">${escapeHtml(agent.name)}</div>
        <div class="agent-mini-role">${escapeHtml(agent.role)}</div>
      </div>
    </div>
  `).join('');
}

function openAgentProfile(index) {
  const agent = state.agents[index];
  if (!agent) return;
  const briefs = state.agentBriefs || {};
  const brief = briefs[agent.name];

  document.getElementById('agentProfileTitle').textContent = agent.name;
  document.getElementById('agentProfileRole').textContent = agent.role;
  document.getElementById('agentProfileBackground').textContent = agent.background;
  document.getElementById('agentProfilePerspective').textContent = agent.perspective;

  const avatar = document.getElementById('agentProfileAvatar');
  avatar.style.background = agent.color;
  avatar.textContent = getInitials(agent.name);

  const briefSection = document.getElementById('agentProfileBriefSection');
  const briefEl = document.getElementById('agentProfileBrief');
  if (brief) {
    briefSection.style.display = '';
    briefEl.textContent = brief;
  } else {
    briefSection.style.display = 'none';
  }

  document.getElementById('agentProfileModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeAgentProfile() {
  document.getElementById('agentProfileModal').classList.add('hidden');
  document.body.style.overflow = '';
}

function createMessageElement(msg) {
  const div = document.createElement('div');
  if (msg.type === 'system') {
    div.className = 'message message-system';
    div.innerHTML = `<div class="message-text">${escapeHtml(msg.content)}</div>`;
  } else if (msg.type === 'user') {
    div.className = 'message message-user';
    div.innerHTML = `
      <div class="message-sender" style="color: #00a884">You (Moderator)</div>
      <div class="message-text">${escapeHtml(msg.content)}</div>
      <div class="message-time">${formatTime(msg.timestamp)}</div>`;
  } else if (msg.type === 'search') {
    div.className = 'message message-system message-search';
    div.innerHTML = `
      <div class="message-text">
        <span class="search-icon">&#128269;</span>
        <strong>${escapeHtml(msg.agentName)}</strong> searched: "${escapeHtml(msg.query)}"
        ${msg.results ? `<div class="search-citations">${msg.results.map(r =>
          `<a class="citation-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>`
        ).join('')}</div>` : ''}
      </div>`;
  } else {
    div.className = 'message message-agent';
    div.innerHTML = `
      <div class="message-sender" style="color: ${msg.agentColor}">
        ${escapeHtml(msg.agentName)}
        <span class="message-badge">${escapeHtml(msg.agentRole)}</span>
      </div>
      <div class="message-text">${escapeHtmlWithLinks(msg.content)}</div>
      <div class="message-time">${formatTime(msg.timestamp)}</div>`;
  }
  return div;
}

function renderChat() {
  const container = document.getElementById('chatMessages');
  const fragment = document.createDocumentFragment();
  for (const msg of state.messages) {
    fragment.appendChild(createMessageElement(msg));
  }
  container.innerHTML = '';
  container.appendChild(fragment);
  container.scrollTop = container.scrollHeight;
  updateReferencesPanel();
}

function appendMessageDOM(msg) {
  const container = document.getElementById('chatMessages');
  removeTypingIndicator();
  const div = createMessageElement(msg);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function addMessage(msg) {
  state.messages.push(msg);
  const el = appendMessageDOM(msg);
  updateReferencesPanel();
  return el;
}

function createStreamingBubble(agent) {
  const container = document.getElementById('chatMessages');
  removeTypingIndicator();

  const div = document.createElement('div');
  div.className = 'message message-agent message-streaming';
  div.id = 'streaming-msg';
  div.innerHTML = `
    <div class="message-sender" style="color: ${agent.color}">
      ${escapeHtml(agent.name)}
      <span class="message-badge">${escapeHtml(agent.role)}</span>
    </div>
    <div class="message-text"></div>
    <div class="message-time">${formatTime(new Date().toISOString())}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function showTypingIndicator(agent) {
  const container = document.getElementById('chatMessages');
  removeTypingIndicator();

  const div = document.createElement('div');
  div.className = 'typing-indicator';
  div.innerHTML = `
    <div class="message-sender" style="color: ${agent.color}; font-size: 0.8rem; font-weight: 600; margin-bottom: 4px;">
      ${escapeHtml(agent.name)}
    </div>
    <div class="typing-dots"><span></span><span></span><span></span></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
  const container = document.getElementById('chatMessages');
  const typing = container.querySelector('.typing-indicator');
  if (typing) typing.remove();
}

function highlightSpeakingAgent(index) {
  document.querySelectorAll('.agent-mini').forEach(el => el.classList.remove('agent-mini-speaking'));
  const el = document.getElementById(`agentMini${index}`);
  if (el) el.classList.add('agent-mini-speaking');
}

function updateRoundIndicator() {
  document.getElementById('roundIndicator').textContent =
    state.currentRound > 0 ? `Round ${state.currentRound}/${state.rounds}` : `${state.rounds} rounds`;
}

// === Role Editor Modal ===
function openRoleEditor(index) {
  state.editingAgentIndex = index;
  const agent = state.agents[index];
  document.getElementById('editName').value = agent.name;
  document.getElementById('editRole').value = agent.role;
  document.getElementById('editBackground').value = agent.background;
  document.getElementById('editPerspective').value = agent.perspective;
  document.getElementById('roleEditModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeRoleEditor() {
  document.getElementById('roleEditModal').classList.add('hidden');
  document.body.style.overflow = '';
  state.editingAgentIndex = null;
}

function saveRoleEdit() {
  const i = state.editingAgentIndex;
  if (i === null) return;
  const name = document.getElementById('editName').value.trim();
  const role = document.getElementById('editRole').value.trim();
  const background = document.getElementById('editBackground').value.trim();
  const perspective = document.getElementById('editPerspective').value.trim();
  if (!name || !role || !background || !perspective) {
    showNotification('All fields are required', 'error');
    return;
  }
  state.agents[i].name = name;
  state.agents[i].role = role;
  state.agents[i].background = background;
  state.agents[i].perspective = perspective;
  renderRoleCards();
  closeRoleEditor();
}

// === SSE Stream Reader ===
const SSE_TIMEOUT_MS = 60000;

async function readSSEStream(response, onChunk, onDone, onError) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('SSE stream timeout (60s)')), SSE_TIMEOUT_MS)
  );

  try {
    await Promise.race([
      (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'chunk') {
                fullText += data.content;
                onChunk(fullText, data.content);
              } else if (data.type === 'done') {
                onDone(fullText, data);
              } else if (data.type === 'error') {
                onError(data.error);
              }
            } catch (parseErr) {
              console.warn('SSE parse error:', parseErr.message, 'line:', line);
            }
          }
        }
        // Flush remaining bytes
        const remaining = decoder.decode();
        if (remaining) buffer += remaining;
      })(),
      timeoutPromise
    ]);
  } catch (err) {
    reader.cancel().catch(() => {});
    onError(err.message);
  }

  return fullText;
}

// === Retry helper for agent errors ===
function addRetryButton(agent, agentIndex, interjection) {
  const container = document.getElementById('chatMessages');
  const retryDiv = document.createElement('div');
  retryDiv.className = 'message message-system';
  retryDiv.innerHTML = `<div class="message-text"><button class="btn-retry" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:0.8rem;">Retry ${escapeHtml(agent.name)}</button></div>`;
  container.appendChild(retryDiv);
  container.scrollTop = container.scrollHeight;
  retryDiv.querySelector('.btn-retry').addEventListener('click', async () => {
    retryDiv.remove();
    await retrySingleAgent(agent, agentIndex, interjection);
  });
}

async function retrySingleAgent(agent, agentIndex, interjection) {
  highlightSpeakingAgent(agentIndex);
  showTypingIndicator(agent);
  try {
    const response = await fetch('/api/agent/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.sessionId,
        agentIndex,
        agents: state.agents,
        topic: state.topic,
        messages: state.messages.filter(m => m.type !== 'system'),
        userInterjection: interjection || null,
        webSearchEnabled: state.searchProvider !== 'none',
        searchProvider: state.searchProvider,
        searchCount: state.searchCount,
        goalMeasurement: state.goalMeasurement,
        focusGroupMode: state.focusGroupMode,
        sessionTimezone: state.sessionTimezone
      })
    });
    const msgDiv = createStreamingBubble(agent);
    const textEl = msgDiv.querySelector('.message-text');
    let retrySources = [];
    const fullText = await readSSEStream(
      response,
      (full) => { textEl.textContent = full; document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight; },
      (full, data) => {
        msgDiv.classList.remove('message-streaming');
        textEl.innerHTML = escapeHtmlWithLinks(full);
        const timeEl = msgDiv.querySelector('.message-time');
        if (timeEl) timeEl.textContent = formatTime(new Date().toISOString());
        retrySources = (data && data.sources) ? data.sources : [];
        if (retrySources.length > 0 && !/\[[^\]]+\]\(https?:\/\//.test(full)) {
          addMessage({ type: 'search', agentName: agent.name, query: 'web search', results: retrySources, timestamp: new Date().toISOString() });
        }
      },
      (err) => { textEl.textContent = `[Error: ${err}]`; msgDiv.classList.remove('message-streaming'); }
    );
    state.messages.push({ type: 'agent', agentName: agent.name, agentRole: agent.role, agentColor: agent.color, content: fullText, sources: retrySources, timestamp: new Date().toISOString() });
    updateReferencesPanel();
    saveCurrentSession();
  } catch (err) {
    removeTypingIndicator();
    addMessage({ type: 'system', content: `Retry failed for ${agent.name}: ${err.message}`, timestamp: new Date().toISOString() });
    addRetryButton(agent, agentIndex, interjection);
  }
  highlightSpeakingAgent(-1);
}

// === API Calls ===
async function generateRoles() {
  const topic = document.getElementById('topicInput').value.trim();
  if (!topic) { showNotification('Please enter a discussion topic.', 'error'); return; }

  state.topic = topic;
  state.goalMeasurement = document.getElementById('goalInput').value.trim();
  state.focusGroupMode = document.getElementById('focusGroupMode').value;
  state.sessionTimezone = document.getElementById('sessionTimezone').value;

  const btn = document.getElementById('generateRolesBtn');
  btn.disabled = true;
  btn.classList.add('btn-loading');

  // Determine request params based on panel composition mode
  const selectedIds = state.selectedLibraryAgentIds;
  const mode = state.panelCompMode;
  let requestBody = {
    topic,
    agentCount: state.agentCount,
    goalMeasurement: state.goalMeasurement,
    focusGroupMode: state.focusGroupMode,
    sessionTimezone: state.sessionTimezone
  };

  if (mode === 'library') {
    if (selectedIds.length === 0) {
      showNotification('Select at least one agent from the library', 'error');
      btn.disabled = false;
      btn.classList.remove('btn-loading');
      return;
    }
    btn.textContent = 'Loading agents...';
    requestBody.selectedAgentIds = selectedIds;
    requestBody.generateCount = 0;
  } else if (mode === 'mix') {
    btn.textContent = 'Building panel...';
    requestBody.selectedAgentIds = selectedIds;
    const remainingToGenerate = Math.max(0, state.agentCount - selectedIds.length);
    requestBody.generateCount = remainingToGenerate;
  } else {
    btn.textContent = 'Generating roles...';
  }

  try {
    const res = await fetch('/api/discuss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to generate roles');
    }

    const data = await res.json();
    state.sessionId = data.sessionId;
    state.agents = data.agents;
    renderRoleCards();
    document.getElementById('roleEditor').classList.remove('hidden');
  } catch (err) {
    showNotification('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('btn-loading');
    btn.textContent = mode === 'library' ? 'Load Agents' : 'Generate Roles';
  }
}

// === Agent Preparation Phase (visible to user before discussion) ===
async function prepareAgents() {
  const btn = document.getElementById('prepareAgentsBtn');
  const startBtn = document.getElementById('startDiscussionBtn');
  btn.disabled = true;
  btn.classList.add('btn-loading');
  btn.textContent = 'Researching...';
  startBtn.disabled = true;

  state.agentBriefs = {};

  // Insert progress bar after role cards
  const roleActions = document.querySelector('.role-actions');
  let progressDiv = document.querySelector('.prep-progress');
  if (!progressDiv) {
    progressDiv = document.createElement('div');
    progressDiv.className = 'prep-progress';
    progressDiv.innerHTML = `
      <div class="prep-progress-bar"><div class="prep-progress-fill" id="prepProgressFill"></div></div>
      <div class="prep-progress-text" id="prepProgressText">Preparing 0/${state.agents.length} agents...</div>`;
    roleActions.parentNode.insertBefore(progressDiv, roleActions);
  }

  const total = state.agents.length;
  let completed = 0;

  // Show loading on each card
  for (let i = 0; i < total; i++) {
    const slot = document.getElementById(`briefSlot${i}`);
    if (slot) {
      slot.innerHTML = `
        <div class="role-card-brief-loading">
          <div class="mini-spinner"></div>
          <span>Researching topic...</span>
        </div>`;
    }
  }

  // Launch all preparations in parallel, update UI as each completes
  const promises = state.agents.map((agent, i) =>
    fetch('/api/agent/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.sessionId,
        agentIndex: i,
        agents: state.agents,
        topic: state.topic,
        goalMeasurement: state.goalMeasurement,
        webSearchEnabled: state.searchProvider !== 'none',
        searchProvider: state.searchProvider,
        searchCount: state.searchCount
      })
    })
    .then(r => r.json())
    .then(data => {
      state.agentBriefs[agent.name] = data.brief;
      completed++;

      // Update this card's brief slot
      const slot = document.getElementById(`briefSlot${i}`);
      if (slot) {
        slot.innerHTML = `
          <div class="role-card-brief-label">Research Brief</div>
          <div class="role-card-brief-content">${escapeHtml(data.brief)}</div>`;
        slot.closest('.role-card').classList.add('prepared');
      }

      // Update progress bar
      const fill = document.getElementById('prepProgressFill');
      const text = document.getElementById('prepProgressText');
      if (fill) fill.style.width = `${(completed / total) * 100}%`;
      if (text) text.textContent = `Prepared ${completed}/${total} agents`;
    })
    .catch(err => {
      completed++;
      console.warn(`Prep failed for ${agent.name}:`, err.message);
      const slot = document.getElementById(`briefSlot${i}`);
      if (slot) {
        slot.innerHTML = `<div style="color:var(--danger);font-size:0.8rem;">Research failed — will use expertise only</div>`;
      }
      const fill = document.getElementById('prepProgressFill');
      const text = document.getElementById('prepProgressText');
      if (fill) fill.style.width = `${(completed / total) * 100}%`;
      if (text) text.textContent = `Prepared ${completed}/${total} agents`;
    })
  );

  await Promise.all(promises);

  // Done — update UI
  btn.classList.remove('btn-loading');
  btn.textContent = 'Re-Research Topic';
  btn.disabled = false;
  startBtn.disabled = false;

  const text = document.getElementById('prepProgressText');
  if (text) text.textContent = `All ${total} agents prepared — ready to discuss`;

  showNotification(`All ${total} agents have researched the topic and are ready!`, 'success');
  saveCurrentSession();
}

async function startDiscussion() {
  state.messages = [];
  state.currentRound = 0;
  state.isPaused = false;
  state.isRunning = true;
  state.summaryData = null;
  state.summaryGenerated = false;

  showView('discussion');
  // Show topic with date/timezone context
  const tz = state.sessionTimezone || 'UTC';
  try {
    const dateStr = new Date().toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('chatTopic').textContent = `${state.topic} (${dateStr} ${tz})`;
  } catch {
    document.getElementById('chatTopic').textContent = state.topic;
  }
  renderAgentPanel();
  renderChat();
  updateRoundIndicator();
  updatePauseButton();

  // Check if agents were already prepared in the setup phase
  const hasBriefs = state.agentBriefs && Object.keys(state.agentBriefs).length > 0;

  if (hasBriefs) {
    // Agents already prepared — skip to discussion
    const briefCount = Object.keys(state.agentBriefs).length;
    addMessage({
      type: 'system',
      content: `All ${briefCount} panelists pre-researched and ready. Starting discussion: "${state.topic}"`,
      timestamp: new Date().toISOString()
    });
  } else {
    // Fallback: prepare during discussion start (old behavior)
    addMessage({
      type: 'system',
      content: `Preparing panelists — each agent is researching the topic...`,
      timestamp: new Date().toISOString()
    });

    try {
      state.agentBriefs = {};
      const prepPromises = state.agents.map((agent, i) =>
        fetch('/api/agent/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: state.sessionId,
            agentIndex: i,
            agents: state.agents,
            topic: state.topic,
            goalMeasurement: state.goalMeasurement,
            webSearchEnabled: state.webSearchEnabled
          })
        }).then(r => r.json()).then(data => {
          state.agentBriefs[agent.name] = data.brief;
        }).catch(err => {
          console.warn(`Prep failed for ${agent.name}:`, err.message);
        })
      );

      await Promise.all(prepPromises);

      addMessage({
        type: 'system',
        content: `All panelists ready. Starting discussion: "${state.topic}" with ${state.agents.length} panelists`,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.warn('Agent preparation phase failed, continuing without briefs:', err.message);
      addMessage({
        type: 'system',
        content: `Discussion started: "${state.topic}" with ${state.agents.length} panelists`,
        timestamp: new Date().toISOString()
      });
    }
  }

  saveCurrentSession();
  await runDiscussion();
}

async function runDiscussion() {
  for (let round = 1; round <= state.rounds; round++) {
    if (!state.isRunning) break;

    state.currentRound = round;
    updateRoundIndicator();

    addMessage({
      type: 'system',
      content: `--- Round ${round} of ${state.rounds} ---`,
      timestamp: new Date().toISOString()
    });

    for (let i = 0; i < state.agents.length; i++) {
      if (!state.isRunning) break;

      // Wait if paused (Promise-based, no CPU polling)
      if (state.isPaused) {
        await waitForResume();
      }
      if (!state.isRunning) break;

      const agent = state.agents[i];
      highlightSpeakingAgent(i);
      showTypingIndicator(agent);

      // Check for pending user interjections (consume all queued)
      const interjections = state.pendingInterjections.splice(0);
      const interjection = interjections.length > 0 ? interjections.join('\n\n') : null;

      try {
        // Round 1: filter out agent messages to prevent anchoring bias
        // Each agent forms their own opinion independently
        let messagesToSend = state.messages.filter(m => m.type !== 'system');
        if (round === 1) {
          messagesToSend = messagesToSend.filter(m => m.type !== 'agent');
        }

        const response = await fetch('/api/agent/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: state.sessionId,
            agentIndex: i,
            agents: state.agents,
            topic: state.topic,
            messages: messagesToSend,
            userInterjection: interjection,
            webSearchEnabled: state.searchProvider !== 'none',
            searchProvider: state.searchProvider,
            searchCount: state.searchCount,
            goalMeasurement: state.goalMeasurement,
            focusGroupMode: state.focusGroupMode,
            sessionTimezone: state.sessionTimezone,
            round: round,
            totalRounds: state.rounds
          })
        });

        const msgDiv = createStreamingBubble(agent);
        const textEl = msgDiv.querySelector('.message-text');
        let capturedSources = [];

        const fullText = await readSSEStream(
          response,
          (full) => {
            textEl.textContent = full;
            document.getElementById('chatMessages').scrollTop =
              document.getElementById('chatMessages').scrollHeight;
          },
          (full, data) => {
            msgDiv.classList.remove('message-streaming');
            textEl.innerHTML = escapeHtmlWithLinks(full);
            // Update timestamp to completion time
            const timeEl = msgDiv.querySelector('.message-time');
            if (timeEl) timeEl.textContent = formatTime(new Date().toISOString());
            // Capture sources from SSE done event
            capturedSources = (data && data.sources) ? data.sources : [];
            // Show web search sources only if not already inline-cited
            if (capturedSources.length > 0) {
              const hasInlineCitations = /\[[^\]]+\]\(https?:\/\//.test(full);
              if (!hasInlineCitations) {
                addMessage({
                  type: 'search',
                  agentName: agent.name,
                  query: 'web search',
                  results: capturedSources,
                  timestamp: new Date().toISOString()
                });
              }
            }
          },
          (err) => {
            textEl.textContent = `[Error: ${err}]`;
            msgDiv.classList.remove('message-streaming');
          }
        );

        // Add to state (streaming bubble is already in DOM)
        state.messages.push({
          type: 'agent',
          agentName: agent.name,
          agentRole: agent.role,
          agentColor: agent.color,
          content: fullText,
          sources: capturedSources,
          timestamp: new Date().toISOString()
        });
        updateReferencesPanel();

        saveCurrentSession();

      } catch (err) {
        removeTypingIndicator();
        addMessage({
          type: 'system',
          content: `Error getting response from ${agent.name}: ${err.message}`,
          timestamp: new Date().toISOString()
        });
        addRetryButton(agent, i, interjection);
      }

      await sleep(500);
    }
  }

  state.isRunning = false;
  highlightSpeakingAgent(-1);
  updatePauseButton();

  addMessage({
    type: 'system',
    content: 'Discussion complete.',
    timestamp: new Date().toISOString()
  });

  showSummaryPromptButton();

  // Auto-save new agents to library after discussion completes
  const unsavedAgents = state.agents.filter(a => !a.id);
  if (unsavedAgents.length > 0) {
    try {
      const res = await fetch('/api/agents/save-from-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: unsavedAgents })
      });
      if (res.ok) {
        const saved = await res.json();
        for (const savedAgent of saved) {
          const match = state.agents.find(a => a.name === savedAgent.name && !a.id);
          if (match) match.id = savedAgent.id;
        }
        await loadAgentLibrary();
        showNotification(`${saved.length} agents saved to library`, 'success');
      }
    } catch (err) {
      console.error('Auto-save agents failed:', err);
    }
  }

  // Trigger knowledge accumulation for persistent agents
  triggerAgentLearning();

  saveCurrentSession();
}

function updatePauseButton() {
  const btn = document.getElementById('pauseBtn');
  if (!state.isRunning) {
    btn.style.opacity = '0.4';
    btn.innerHTML = '&#10074;&#10074;';
    btn.title = 'Discussion not running';
  } else {
    btn.style.opacity = '1';
    btn.innerHTML = state.isPaused ? '&#9654;' : '&#10074;&#10074;';
    btn.title = state.isPaused ? 'Resume discussion' : 'Pause discussion';
  }
}

function showSummaryPromptButton() {
  const container = document.getElementById('chatMessages');
  // Remove any existing summary prompt
  const existing = container.querySelector('.summary-prompt');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.className = 'summary-prompt';

  if (state.summaryGenerated) {
    div.innerHTML = `
      <button class="btn-summary-prompt" id="summaryPromptBtn">
        View Summary &amp; Action Items
      </button>`;
  } else {
    div.innerHTML = `
      <button class="btn-summary-prompt" id="summaryPromptBtn">
        Generate Summary &amp; Action Items
      </button>`;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  div.querySelector('#summaryPromptBtn').addEventListener('click', generateSummary);
}

async function doSearch(query) {
  const resultsDiv = document.getElementById('searchResults');
  resultsDiv.innerHTML = '<div class="loading-spinner" style="padding: 12px; font-size: 0.8rem;">Searching...</div>';

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, provider: state.sidebarSearchProvider })
    });
    const data = await res.json();

    if (data.results && data.results.length > 0) {
      resultsDiv.innerHTML = data.results.map(r => `
        <div class="search-result">
          <div class="search-result-title">
            <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>
          </div>
          <div class="search-result-desc">${escapeHtml(r.description)}</div>
        </div>
      `).join('') + `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">Source: ${data.source}</div>`;
    } else {
      resultsDiv.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 8px;">No results found</div>';
    }
  } catch (err) {
    resultsDiv.innerHTML = `<div style="color: var(--danger); font-size: 0.8rem; padding: 8px;">Search failed: ${err.message}</div>`;
  }
}

async function generateSummary() {
  // Block if summary already generated
  if (state.summaryGenerated) {
    const modal = document.getElementById('summaryModal');
    const content = document.getElementById('summaryContent');
    modal.classList.remove('hidden');
    if (state.summaryData) {
      renderSummary(state.summaryData);
    } else {
      content.innerHTML = '<div class="summary-text">Summary has already been generated for this session.</div>';
    }
    return;
  }

  // Immediately disable any summary buttons to prevent double-click
  const summaryPromptBtn = document.getElementById('summaryPromptBtn');
  if (summaryPromptBtn) summaryPromptBtn.disabled = true;
  document.getElementById('summaryBtn').disabled = true;

  const modal = document.getElementById('summaryModal');
  const content = document.getElementById('summaryContent');
  modal.classList.remove('hidden');
  content.innerHTML = '<div class="loading-spinner">Generating summary...</div>';

  // Stop the discussion if still running
  state.isRunning = false;
  updatePauseButton();

  try {
    const res = await fetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.sessionId,
        topic: state.topic,
        messages: state.messages.filter(m => m.type !== 'system'),
        agents: state.agents
      })
    });

    // Handle server-side guard (409 = already generated)
    if (res.status === 409) {
      state.summaryGenerated = true;
      saveCurrentSession();
      content.innerHTML = '<div class="summary-text">Summary has already been generated for this session.</div>';
      return;
    }

    await readSSEStream(
      res,
      (full) => {
        content.innerHTML = `<div class="summary-streaming"><div class="loading-spinner">Generating summary...</div><div class="summary-preview">${escapeHtml(full.substring(0, 200))}...</div></div>`;
      },
      (fullText) => {
        try {
          const summary = parseSummaryJSON(fullText);
          state.summaryData = summary;
          state.summaryGenerated = true;
          renderSummary(summary);
          saveCurrentSession();
          // Trigger knowledge accumulation for persistent agents (background)
          triggerAgentLearning().catch(err =>
            console.warn('Agent learning failed:', err.message)
          );
        } catch (e) {
          console.warn('Summary JSON parse failed:', e.message);
          content.innerHTML = `<div class="summary-text">${renderMarkdown(fullText)}</div>`;
        }
      },
      (err) => {
        content.innerHTML = `<div style="color: var(--danger);">Error: ${escapeHtml(err)}</div>`;
      }
    );
  } catch (err) {
    content.innerHTML = `<div style="color: var(--danger);">Failed to generate summary: ${escapeHtml(err.message)}</div>`;
  }
}

// Robust JSON parser for summary - handles truncated/wrapped JSON
function parseSummaryJSON(text) {
  // Strip markdown code fences if present
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Try direct parse
  try { return JSON.parse(cleaned); } catch {}
  // Try extracting JSON object
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
    // Try repairing truncated JSON by closing open structures
    let repaired = match[0];
    // Count unclosed brackets/braces
    let braces = 0, brackets = 0, inString = false, escaped = false;
    for (const ch of repaired) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') braces++;
      if (ch === '}') braces--;
      if (ch === '[') brackets++;
      if (ch === ']') brackets--;
    }
    // Close any open strings and structures
    if (inString) repaired += '"';
    while (brackets > 0) { repaired += ']'; brackets--; }
    while (braces > 0) { repaired += '}'; braces--; }
    try { return JSON.parse(repaired); } catch {}
  }
  throw new Error('Unable to parse summary JSON');
}

function renderSummary(summary) {
  const content = document.getElementById('summaryContent');

  const priorityIcon = { high: '🔴', medium: '🟡', low: '🟢' };
  const priorityLabel = { high: 'High', medium: 'Medium', low: 'Low' };

  content.innerHTML = `
    <div class="summary-section summary-executive">
      <div class="section-header">
        <span class="section-icon">📋</span>
        <h3>Executive Summary</h3>
      </div>
      <div class="summary-text">${renderMarkdown(summary.summary || '')}</div>
    </div>

    ${(summary.keyInsights && summary.keyInsights.length) ? `
    <div class="summary-section summary-insights">
      <div class="section-header">
        <span class="section-icon">💡</span>
        <h3>Key Insights</h3>
      </div>
      <div class="insight-grid">
        ${summary.keyInsights.map((insight, i) => `
          <div class="insight-card">
            <span class="insight-number">${i + 1}</span>
            <div class="insight-text">${escapeHtml(insight)}</div>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    ${(summary.todos && summary.todos.length) ? `
    <div class="summary-section summary-actions">
      <div class="section-header">
        <span class="section-icon">✅</span>
        <h3>Action Items</h3>
        <span class="todo-count">${summary.todos.length} items</span>
      </div>
      <p class="todo-hint">Check to approve, click X to remove</p>
      <ul class="todo-list" id="todoList">
        ${summary.todos.map((todo, i) => `
          <li class="todo-item" data-index="${i}">
            <input type="checkbox" class="todo-check" data-index="${i}" />
            <div class="todo-content">
              <div class="todo-task">${escapeHtml(todo.task)}</div>
              <div class="todo-meta">
                <span class="todo-priority todo-priority-${todo.priority}">
                  ${priorityIcon[todo.priority] || ''} ${priorityLabel[todo.priority] || todo.priority}
                </span>
              </div>
              <div class="todo-rationale">${escapeHtml(todo.rationale)}</div>
            </div>
            <button class="todo-remove" data-index="${i}" title="Remove">&times;</button>
          </li>
        `).join('')}
      </ul>
    </div>` : ''}

    ${summary.dissent ? `
    <div class="summary-section summary-dissent">
      <div class="section-header">
        <span class="section-icon">⚠️</span>
        <h3>Unresolved Disagreements</h3>
      </div>
      <div class="dissent-box">${renderMarkdown(summary.dissent)}</div>
    </div>` : ''}
  `;

  // Bind todo interactions
  content.querySelectorAll('.todo-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const item = content.querySelector(`.todo-item[data-index="${idx}"]`);
      if (item) {
        item.style.opacity = '0';
        item.style.maxHeight = '0';
        item.style.padding = '0';
        item.style.margin = '0';
        item.style.overflow = 'hidden';
        item.style.transition = 'all 0.3s';
        setTimeout(() => item.remove(), 300);
        if (state.summaryData && state.summaryData.todos) {
          state.summaryData.todos.splice(idx, 1);
          saveCurrentSession();
        }
      }
    });
  });

  content.querySelectorAll('.todo-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const item = cb.closest('.todo-item');
      if (item) item.classList.toggle('todo-approved', cb.checked);
    });
  });
}

// === Export Functions ===
function exportAsJson() {
  const refs = collectReferences();
  const data = {
    topic: state.topic,
    agents: state.agents,
    messages: state.messages,
    rounds: state.rounds,
    currentRound: state.currentRound,
    goalMeasurement: state.goalMeasurement,
    focusGroupMode: state.focusGroupMode,
    webSearchEnabled: state.searchProvider !== 'none',
    searchProvider: state.searchProvider,
    searchCount: state.searchCount,
    summaryGenerated: state.summaryGenerated,
    summary: state.summaryData,
    references: refs.map(r => ({ title: r.title, url: r.url, agent: r.agent })),
    exportedAt: new Date().toISOString()
  };
  downloadFile(`focus-group-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function exportAsMarkdown() {
  let md = `# Focus Group: ${state.topic}\n\n`;
  md += `**Date:** ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Panelists:** ${state.agents.map(a => `${a.name} (${a.role})`).join(', ')}\n`;
  md += `**Mode:** ${state.focusGroupMode}\n`;
  if (state.goalMeasurement) md += `**Goal:** ${state.goalMeasurement}\n`;
  md += `**Rounds:** ${state.currentRound}/${state.rounds}\n`;
  md += `**Web Search:** ${state.searchProvider !== 'none' ? state.searchProvider : 'Disabled'}\n\n`;
  md += `---\n\n## Discussion\n\n`;

  for (const msg of state.messages) {
    if (msg.type === 'system') {
      md += `*${msg.content}*\n\n`;
    } else if (msg.type === 'user') {
      md += `### Moderator\n${msg.content}\n\n`;
    } else if (msg.type === 'search') {
      md += `> **${msg.agentName}** searched: "${msg.query}"\n\n`;
    } else {
      md += `### ${msg.agentName} (${msg.agentRole})\n${msg.content}\n\n`;
    }
  }

  if (state.summaryData) {
    md += `---\n\n## Summary\n\n${state.summaryData.summary}\n\n`;
    if (state.summaryData.keyInsights) {
      md += `### Key Insights\n\n`;
      state.summaryData.keyInsights.forEach(i => { md += `- ${i}\n`; });
      md += '\n';
    }
    if (state.summaryData.todos) {
      md += `### Action Items\n\n`;
      state.summaryData.todos.forEach(t => { md += `- [ ] **[${t.priority}]** ${t.task} — ${t.rationale}\n`; });
      md += '\n';
    }
    if (state.summaryData.dissent) {
      md += `### Unresolved Disagreements\n\n${state.summaryData.dissent}\n\n`;
    }
  }

  // References section
  const refs = collectReferences();
  if (refs.length > 0) {
    md += `---\n\n## References\n\n`;
    refs.forEach(r => { md += `- [${r.title}](${r.url}) — *${r.agent}*\n`; });
    md += '\n';
  }

  downloadFile(`focus-group-${Date.now()}.md`, md, 'text/markdown');
}

function importSession() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (!data.topic || typeof data.topic !== 'string') {
          showNotification('Invalid session file: missing or invalid topic', 'error'); return;
        }
        if (!Array.isArray(data.agents) || data.agents.length === 0) {
          showNotification('Invalid session file: missing or empty agents', 'error'); return;
        }
        if (!Array.isArray(data.messages)) {
          showNotification('Invalid session file: missing messages array', 'error'); return;
        }
        // Validate each agent has required fields
        for (const a of data.agents) {
          if (!a.name || !a.role || !a.color) {
            showNotification('Invalid agent data in file: missing name, role, or color', 'error'); return;
          }
        }
        // Create a new session from imported data
        state.sessionId = 'imported-' + Date.now();
        state.topic = data.topic;
        state.agents = data.agents;
        state.messages = data.messages;
        state.rounds = data.rounds || 3;
        state.currentRound = data.currentRound || 0;
        state.summaryData = data.summary || null;
        state.summaryGenerated = data.summaryGenerated || !!data.summary;
        state.goalMeasurement = data.goalMeasurement || '';
        state.focusGroupMode = data.focusGroupMode || 'share_perspectives';
        state.searchProvider = data.searchProvider || (data.webSearchEnabled !== false ? 'openai' : 'none');
        state.searchCount = data.searchCount || 5;
        state.webSearchEnabled = state.searchProvider !== 'none';
        state.isRunning = false;
        state.isPaused = false;
        saveCurrentSession();
        showView('discussion');
        renderChat();
        renderAgentPanel();
        document.getElementById('chatTopic').textContent = state.topic;
        updateRoundIndicator();
      } catch (err) {
        showNotification('Failed to parse file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// === Notifications (replaces alert()) ===
function showNotification(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) { console.warn(message); return; }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.textContent = message;
  container.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.addEventListener('transitionend', () => toast.remove());
    // Fallback removal
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 500);
  }, duration);
}

// === Helpers ===
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Lightweight markdown renderer: escapes HTML first (XSS safe), then applies formatting
function renderMarkdown(str) {
  if (!str) return '';
  let html = escapeHtml(str);

  // Code blocks (``` ... ```)
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Bold **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic *text* (not inside bold or list marker)
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a class="citation-link-inline" href="$2" target="_blank" rel="noopener">$1</a>'
  );

  // Process lines for lists and paragraphs
  const lines = html.split('\n');
  let result = '';
  let inOl = false, inUl = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const olMatch = trimmed.match(/^(\d+)[.)]\s+(.*)/);
    const ulMatch = trimmed.match(/^[-–•]\s+(.*)/);

    if (olMatch) {
      if (inUl) { result += '</ul>'; inUl = false; }
      if (!inOl) { result += '<ol>'; inOl = true; }
      result += `<li>${olMatch[2]}</li>`;
    } else if (ulMatch) {
      if (inOl) { result += '</ol>'; inOl = false; }
      if (!inUl) { result += '<ul>'; inUl = true; }
      result += `<li>${ulMatch[1]}</li>`;
    } else {
      if (inOl) { result += '</ol>'; inOl = false; }
      if (inUl) { result += '</ul>'; inUl = false; }
      if (trimmed === '') {
        result += '<br>';
      } else {
        result += `<p>${trimmed}</p>`;
      }
    }
  }
  if (inOl) result += '</ol>';
  if (inUl) result += '</ul>';
  return result;
}

// Backward compat alias
function escapeHtmlWithLinks(str) {
  return renderMarkdown(str);
}

// === References ===
function collectReferences() {
  const refs = [];
  const seen = new Set();
  for (const msg of state.messages) {
    if (msg.type === 'agent' && msg.content) {
      const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      let m;
      while ((m = linkRegex.exec(msg.content)) !== null) {
        if (!seen.has(m[2])) {
          seen.add(m[2]);
          refs.push({ title: m[1], url: m[2], agent: msg.agentName, color: msg.agentColor });
        }
      }
    }
    if (msg.type === 'search' && msg.results) {
      for (const r of msg.results) {
        if (!seen.has(r.url)) {
          seen.add(r.url);
          refs.push({ title: r.title, url: r.url, agent: msg.agentName, color: '#888' });
        }
      }
    }
  }
  return refs;
}

function updateReferencesPanel() {
  const container = document.getElementById('referencesPanel');
  if (!container) return;
  const refs = collectReferences();
  if (refs.length === 0) {
    container.innerHTML = '<div class="refs-empty">No references yet</div>';
    return;
  }
  container.innerHTML = refs.map(r => `
    <a class="ref-item" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">
      <span class="ref-dot" style="background:${r.color}"></span>
      <span class="ref-text">
        <span class="ref-title">${escapeHtml(r.title)}</span>
        <span class="ref-agent">${escapeHtml(r.agent)}</span>
      </span>
    </a>
  `).join('');
}

function getInitials(name) {
  return name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Pause/resume via Promise (no CPU polling)
let _resumeResolve = null;
function waitForResume() {
  return new Promise(resolve => { _resumeResolve = resolve; });
}
function signalResume() {
  if (_resumeResolve) { _resumeResolve(); _resumeResolve = null; }
}

// === Event Listeners ===
document.addEventListener('DOMContentLoaded', () => {
  // Load server config (model name + search providers)
  fetch('/api/config').then(r => r.json()).then(cfg => {
    const badge = document.getElementById('modelBadge');
    if (badge) badge.textContent = cfg.model || 'unknown';

    // Populate search provider dropdowns
    if (cfg.searchProviders) {
      state.availableProviders = cfg.searchProviders;

      // Main search provider select
      const mainSelect = document.getElementById('searchProvider');
      if (mainSelect) {
        mainSelect.innerHTML = '';
        for (const p of cfg.searchProviders) {
          const opt = document.createElement('option');
          opt.value = p.id;
          if (p.available) {
            opt.textContent = p.name;
          } else {
            opt.textContent = `${p.name} (API key not set)`;
            opt.disabled = true;
          }
          mainSelect.appendChild(opt);
        }
        // Set default
        if (cfg.defaultSearchProvider) {
          state.searchProvider = cfg.defaultSearchProvider;
          mainSelect.value = cfg.defaultSearchProvider;
        }
        updateSearchCountVisibility();
        updateSearchProviderHint();
      }

      // Sidebar search provider select (exclude openai and none)
      const sidebarSelect = document.getElementById('sidebarSearchProvider');
      if (sidebarSelect) {
        sidebarSelect.innerHTML = '';
        const sidebarProviders = cfg.searchProviders.filter(p => p.id !== 'openai' && p.id !== 'none');
        if (sidebarProviders.length === 0) {
          const fallback = cfg.searchProviders.filter(p => p.id !== 'none');
          for (const p of fallback) {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.available ? p.name : `${p.name} (no key)`;
            opt.disabled = !p.available;
            sidebarSelect.appendChild(opt);
          }
          state.sidebarSearchProvider = (fallback.find(p => p.available) || fallback[0])?.id || 'brave';
        } else {
          for (const p of sidebarProviders) {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.available ? p.name : `${p.name} (no key)`;
            opt.disabled = !p.available;
            sidebarSelect.appendChild(opt);
          }
          state.sidebarSearchProvider = (sidebarProviders.find(p => p.available) || sidebarProviders[0]).id;
        }
        sidebarSelect.value = state.sidebarSearchProvider;
      }
    }
  }).catch(() => {});

  // Helper: show/hide search count stepper based on provider
  function updateSearchCountVisibility() {
    const group = document.getElementById('searchCountGroup');
    if (group) {
      // Hide stepper for OpenAI (AI decides) and none (disabled)
      const hide = state.searchProvider === 'openai' || state.searchProvider === 'none';
      group.classList.toggle('hidden', hide);
    }
  }

  // Helper: update provider hint text
  function updateSearchProviderHint() {
    const hint = document.getElementById('searchProviderHint');
    if (!hint) return;
    const hints = {
      openai: 'AI decides when and what to search (OpenAI Responses API)',
      exa: 'App pre-searches using Exa.ai, results injected into prompt',
      firecrawl: 'App pre-searches using Firecrawl, results injected into prompt',
      brave: 'App pre-searches using Brave, results injected into prompt',
      none: 'Web search disabled — agents use expertise only'
    };
    hint.textContent = hints[state.searchProvider] || '';
  }

  // Populate timezone selector
  const tzSelect = document.getElementById('sessionTimezone');
  if (tzSelect) {
    try {
      const timezones = Intl.supportedValuesOf('timeZone');
      const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      for (const tz of timezones) {
        const opt = document.createElement('option');
        opt.value = tz;
        opt.textContent = tz.replace(/_/g, ' ');
        if (tz === userTz) opt.selected = true;
        tzSelect.appendChild(opt);
      }
    } catch {
      // Fallback for browsers without Intl.supportedValuesOf
      const fallbackTzs = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Singapore', 'Australia/Sydney'];
      for (const tz of fallbackTzs) {
        const opt = document.createElement('option');
        opt.value = tz;
        opt.textContent = tz.replace(/_/g, ' ');
        tzSelect.appendChild(opt);
      }
    }
    tzSelect.addEventListener('change', (e) => {
      state.sessionTimezone = e.target.value;
    });
  }

  renderSessionList();

  // Event delegation for session list (avoids re-binding on every render)
  document.getElementById('sessionList').addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('[data-delete]');
    if (deleteBtn) {
      e.stopPropagation();
      if (confirm('Delete this session?')) deleteSession(deleteBtn.dataset.delete);
      return;
    }
    const item = e.target.closest('.session-item');
    if (item && item.dataset.id) loadSession(item.dataset.id);
  });

  // Event delegation for role cards
  document.getElementById('roleCards').addEventListener('click', (e) => {
    const card = e.target.closest('.role-card');
    if (card && card.dataset.index !== undefined) {
      openRoleEditor(parseInt(card.dataset.index));
    }
  });

  // New session button
  document.getElementById('newSessionBtn').addEventListener('click', () => {
    state.sessionId = null;
    state.messages = [];
    state.agents = [];
    state.isRunning = false;
    state.isPaused = false;
    state.summaryData = null;
    state.summaryGenerated = false;
    state.webSearchEnabled = true;
    state.goalMeasurement = '';
    state.focusGroupMode = 'share_perspectives';
    state.sessionTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Reset search provider to default
    const defaultProvider = state.availableProviders.find(p => p.id !== 'openai' && p.id !== 'none');
    state.searchProvider = defaultProvider ? defaultProvider.id : 'openai';
    state.searchCount = 5;
    document.getElementById('topicInput').value = '';
    document.getElementById('goalInput').value = '';
    document.getElementById('focusGroupMode').value = 'share_perspectives';
    const spSel = document.getElementById('searchProvider');
    if (spSel) spSel.value = state.searchProvider;
    updateSearchCountVisibility();
    updateSearchProviderHint();
    updateSearchCountStepper();
    const tzSel = document.getElementById('sessionTimezone');
    if (tzSel) tzSel.value = state.sessionTimezone;
    document.getElementById('roleEditor').classList.add('hidden');
    showView('setup');
    renderSessionList();
  });

  // Search provider select
  document.getElementById('searchProvider').addEventListener('change', (e) => {
    state.searchProvider = e.target.value;
    state.webSearchEnabled = e.target.value !== 'none';
    updateSearchCountVisibility();
    updateSearchProviderHint();
  });

  // Search count stepper (3–10)
  function updateSearchCountStepper() {
    document.getElementById('searchCountValue').textContent = state.searchCount;
    document.getElementById('searchCountMinus').disabled = state.searchCount <= 3;
    document.getElementById('searchCountPlus').disabled = state.searchCount >= 10;
  }
  document.getElementById('searchCountMinus').addEventListener('click', () => {
    if (state.searchCount > 3) { state.searchCount--; updateSearchCountStepper(); }
  });
  document.getElementById('searchCountPlus').addEventListener('click', () => {
    if (state.searchCount < 10) { state.searchCount++; updateSearchCountStepper(); }
  });
  updateSearchCountStepper();

  // Sidebar search provider
  document.getElementById('sidebarSearchProvider').addEventListener('change', (e) => {
    state.sidebarSearchProvider = e.target.value;
  });

  // Agent count stepper (2–5)
  function updateAgentStepper() {
    document.getElementById('agentCountValue').textContent = state.agentCount;
    document.getElementById('agentCountMinus').disabled = state.agentCount <= 2;
    document.getElementById('agentCountPlus').disabled = state.agentCount >= 5;
  }
  document.getElementById('agentCountMinus').addEventListener('click', () => {
    if (state.agentCount > 2) { state.agentCount--; updateAgentStepper(); }
  });
  document.getElementById('agentCountPlus').addEventListener('click', () => {
    if (state.agentCount < 5) { state.agentCount++; updateAgentStepper(); }
  });
  updateAgentStepper();

  // Round stepper (1–5)
  function updateRoundStepper() {
    document.getElementById('roundValue').textContent = state.rounds;
    document.getElementById('roundMinus').disabled = state.rounds <= 1;
    document.getElementById('roundPlus').disabled = state.rounds >= 5;
  }
  document.getElementById('roundMinus').addEventListener('click', () => {
    if (state.rounds > 1) { state.rounds--; updateRoundStepper(); }
  });
  document.getElementById('roundPlus').addEventListener('click', () => {
    if (state.rounds < 5) { state.rounds++; updateRoundStepper(); }
  });
  updateRoundStepper();

  // Generate roles
  document.getElementById('generateRolesBtn').addEventListener('click', generateRoles);

  // Regenerate roles (also resets briefs)
  document.getElementById('regenerateBtn').addEventListener('click', () => {
    state.agentBriefs = {};
    document.getElementById('startDiscussionBtn').disabled = true;
    document.getElementById('prepareAgentsBtn').textContent = 'Prepare Agents — Research Topic';
    const progress = document.querySelector('.prep-progress');
    if (progress) progress.remove();
    generateRoles();
  });

  // Prepare agents — research topic
  document.getElementById('prepareAgentsBtn').addEventListener('click', prepareAgents);

  // Start discussion
  document.getElementById('startDiscussionBtn').addEventListener('click', startDiscussion);

  // Pause/resume
  document.getElementById('pauseBtn').addEventListener('click', () => {
    if (!state.isRunning) return;
    state.isPaused = !state.isPaused;
    updatePauseButton();

    addMessage({
      type: 'system',
      content: state.isPaused ? 'Discussion paused by moderator' : 'Discussion resumed',
      timestamp: new Date().toISOString()
    });

    if (!state.isPaused) signalResume();
  });

  // User interjection
  const sendMsg = () => {
    const input = document.getElementById('userInput');
    const text = input.value.trim();
    if (!text) return;

    addMessage({
      type: 'user',
      content: text,
      timestamp: new Date().toISOString()
    });

    state.pendingInterjections.push(text);
    input.value = '';
    saveCurrentSession();

    // If paused, auto-resume with system message
    if (state.isPaused) {
      state.isPaused = false;
      updatePauseButton();
      signalResume();
      addMessage({
        type: 'system',
        content: 'Discussion resumed with moderator feedback',
        timestamp: new Date().toISOString()
      });
    }

    // If discussion ended, trigger a feedback response round
    if (!state.isRunning && state.agents.length > 0) {
      triggerFeedbackRound(text);
    }
  };

  // Respond to feedback after discussion has ended
  async function triggerFeedbackRound(feedback) {
    state.isRunning = true;
    updatePauseButton();

    addMessage({
      type: 'system',
      content: '--- Responding to moderator feedback ---',
      timestamp: new Date().toISOString()
    });

    // Pick up to 5 respondents: prioritize agents who spoke recently + random diversity
    const maxRespondents = Math.min(5, state.agents.length);
    const recentAgentNames = state.messages
      .filter(m => m.type === 'agent')
      .slice(-state.agents.length)
      .map(m => m.agentName);
    const recentAgents = [];
    const otherAgents = [];
    for (const a of state.agents) {
      if (recentAgentNames.includes(a.name)) recentAgents.push(a);
      else otherAgents.push(a);
    }
    // Shuffle others for diversity
    for (let i = otherAgents.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [otherAgents[i], otherAgents[j]] = [otherAgents[j], otherAgents[i]];
    }
    const respondents = [...recentAgents, ...otherAgents].slice(0, maxRespondents);

    for (let i = 0; i < respondents.length; i++) {
      if (!state.isRunning) break;

      const agent = respondents[i];
      const agentIndex = state.agents.indexOf(agent);
      highlightSpeakingAgent(agentIndex);
      showTypingIndicator(agent);

      try {
        const response = await fetch('/api/agent/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: state.sessionId,
            agentIndex: agentIndex,
            agents: state.agents,
            topic: state.topic,
            messages: state.messages.filter(m => m.type !== 'system'),
            userInterjection: feedback,
            webSearchEnabled: state.searchProvider !== 'none',
            searchProvider: state.searchProvider,
            searchCount: state.searchCount,
            goalMeasurement: state.goalMeasurement,
            focusGroupMode: state.focusGroupMode,
            sessionTimezone: state.sessionTimezone
          })
        });

        const msgDiv = createStreamingBubble(agent);
        const textEl = msgDiv.querySelector('.message-text');
        let feedbackSources = [];

        const fullText = await readSSEStream(
          response,
          (full) => {
            textEl.textContent = full;
            document.getElementById('chatMessages').scrollTop =
              document.getElementById('chatMessages').scrollHeight;
          },
          (full, data) => {
            msgDiv.classList.remove('message-streaming');
            textEl.innerHTML = escapeHtmlWithLinks(full);
            const timeEl = msgDiv.querySelector('.message-time');
            if (timeEl) timeEl.textContent = formatTime(new Date().toISOString());
            feedbackSources = (data && data.sources) ? data.sources : [];
            if (feedbackSources.length > 0) {
              const hasInlineCitations = /\[[^\]]+\]\(https?:\/\//.test(full);
              if (!hasInlineCitations) {
                addMessage({
                  type: 'search',
                  agentName: agent.name,
                  query: 'web search',
                  results: feedbackSources,
                  timestamp: new Date().toISOString()
                });
              }
            }
          },
          (err) => {
            textEl.textContent = `[Error: ${err}]`;
            msgDiv.classList.remove('message-streaming');
          }
        );

        state.messages.push({
          type: 'agent',
          agentName: agent.name,
          agentRole: agent.role,
          agentColor: agent.color,
          content: fullText,
          sources: feedbackSources,
          timestamp: new Date().toISOString()
        });
        updateReferencesPanel();

        saveCurrentSession();
      } catch (err) {
        removeTypingIndicator();
        addMessage({
          type: 'system',
          content: `Error getting response from ${agent.name}: ${err.message}`,
          timestamp: new Date().toISOString()
        });
        addRetryButton(agent, agentIndex, feedback);
      }

      await sleep(500);
    }

    state.isRunning = false;
    state.pendingInterjections = [];
    highlightSpeakingAgent(-1);
    updatePauseButton();
    saveCurrentSession();
  }

  document.getElementById('sendBtn').addEventListener('click', sendMsg);
  document.getElementById('userInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMsg();
  });

  // Summary (header button)
  document.getElementById('summaryBtn').addEventListener('click', generateSummary);
  document.getElementById('closeSummaryBtn').addEventListener('click', () => {
    document.getElementById('summaryModal').classList.add('hidden');
  });
  document.getElementById('closeSummaryDoneBtn').addEventListener('click', () => {
    document.getElementById('summaryModal').classList.add('hidden');
  });

  // Export
  document.getElementById('exportJsonBtn').addEventListener('click', exportAsJson);
  document.getElementById('exportMdBtn').addEventListener('click', exportAsMarkdown);
  document.getElementById('importBtn').addEventListener('click', importSession);

  // Role edit modal
  document.getElementById('closeRoleEditBtn').addEventListener('click', closeRoleEditor);
  document.getElementById('cancelRoleEditBtn').addEventListener('click', closeRoleEditor);
  document.getElementById('saveRoleEditBtn').addEventListener('click', saveRoleEdit);

  // Agent profile modal (discussion view — click panelist to view profile + brief)
  document.getElementById('agentListMini').addEventListener('click', (e) => {
    const mini = e.target.closest('.agent-mini');
    if (mini && mini.dataset.index !== undefined) {
      openAgentProfile(parseInt(mini.dataset.index));
    }
  });
  document.getElementById('closeAgentProfileBtn').addEventListener('click', closeAgentProfile);
  document.getElementById('closeAgentProfileDoneBtn').addEventListener('click', closeAgentProfile);

  // Search
  const doSearchAction = () => {
    const query = document.getElementById('searchInput').value.trim();
    if (query) doSearch(query);
  };
  document.getElementById('searchBtn').addEventListener('click', doSearchAction);
  document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearchAction();
  });

  // Close modals on overlay click + restore scroll
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
        document.body.style.overflow = '';
      }
    });
  });

  // Keyboard shortcut: Escape closes topmost visible modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const visibleModals = [...document.querySelectorAll('.modal-overlay:not(.hidden)')];
      if (visibleModals.length > 0) {
        const topModal = visibleModals[visibleModals.length - 1];
        topModal.classList.add('hidden');
        document.body.style.overflow = '';
      }
    }
  });

  // === Agent Library Events ===
  loadAgentLibrary();

  // Agent Library list — click to view detail
  document.getElementById('agentLibraryList').addEventListener('click', (e) => {
    const item = e.target.closest('.agent-lib-item');
    if (item && item.dataset.agentId) {
      openAgentLibDetail(item.dataset.agentId);
    }
  });

  // Create Agent button
  document.getElementById('createAgentBtn').addEventListener('click', () => openCreateAgentModal());

  // Create Agent Modal
  document.getElementById('closeCreateAgentBtn').addEventListener('click', closeCreateAgentModal);
  document.getElementById('cancelCreateAgentBtn').addEventListener('click', closeCreateAgentModal);
  document.getElementById('saveCreateAgentBtn').addEventListener('click', createAgentFromModal);

  // Color picker
  document.getElementById('createAgentColorPicker').addEventListener('click', (e) => {
    const swatch = e.target.closest('.color-swatch');
    if (swatch) {
      document.querySelectorAll('#createAgentColorPicker .color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
    }
  });

  // Agent Library Detail Modal
  document.getElementById('closeAgentLibDetailBtn').addEventListener('click', closeAgentLibDetail);
  document.getElementById('closeAgentLibDetailDoneBtn').addEventListener('click', closeAgentLibDetail);

  // Insights edit controls
  document.getElementById('insightsEditBtn').addEventListener('click', toggleInsightsEdit);
  document.getElementById('insightsEditCancelBtn').addEventListener('click', cancelInsightsEdit);
  document.getElementById('insightsEditSaveBtn').addEventListener('click', saveInsightsEdit);
  document.getElementById('insightsClearBtn').addEventListener('click', clearInsights);

  document.getElementById('deleteAgentLibBtn').addEventListener('click', () => {
    if (state.editingLibraryAgentId) deleteLibraryAgent(state.editingLibraryAgentId);
  });
  document.getElementById('editAgentLibBtn').addEventListener('click', () => {
    if (state.editingLibraryAgentId) {
      const agent = state.agentLibrary.find(a => a.id === state.editingLibraryAgentId);
      if (agent) {
        closeAgentLibDetail();
        openCreateAgentModal(agent);
      }
    }
  });

  // Save to Library button
  document.getElementById('saveToLibraryBtn').addEventListener('click', saveAgentsToLibrary);

  // Panel Composition selector
  document.querySelectorAll('#panelCompSelector .panel-comp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#panelCompSelector .panel-comp-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.panelCompMode = btn.dataset.mode;

      const picker = document.getElementById('agentPicker');
      const hint = document.getElementById('panelCompHint');
      const genBtn = document.getElementById('generateRolesBtn');

      if (btn.dataset.mode === 'generate') {
        picker.classList.add('hidden');
        hint.textContent = 'AI will generate all agents for this session';
        genBtn.textContent = 'Generate Roles';
      } else if (btn.dataset.mode === 'library') {
        picker.classList.remove('hidden');
        hint.textContent = 'Select agents from your library — no generation needed';
        genBtn.textContent = 'Load Agents';
        renderAgentPicker();
      } else {
        picker.classList.remove('hidden');
        hint.textContent = 'Select library agents + AI generates the rest';
        genBtn.textContent = 'Generate Roles';
        renderAgentPicker();
      }
    });
  });

  // Agent Picker — click to toggle selection
  document.getElementById('agentPickerGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.agent-picker-card');
    if (card && card.dataset.agentId) {
      togglePickerAgent(card.dataset.agentId);
    }
  });
});
