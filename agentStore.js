const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');

// In-memory cache
let agents = [];
let loaded = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load() {
  ensureDataDir();
  try {
    if (fs.existsSync(AGENTS_FILE)) {
      const raw = fs.readFileSync(AGENTS_FILE, 'utf-8');
      agents = JSON.parse(raw);
    } else {
      agents = [];
    }
  } catch (err) {
    console.error('agentStore: failed to load agents.json, starting fresh:', err.message);
    agents = [];
  }
  loaded = true;
  console.log(`agentStore: loaded ${agents.length} persistent agents`);
}

function save() {
  ensureDataDir();
  const tmpFile = AGENTS_FILE + '.tmp';
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(agents, null, 2), 'utf-8');
    fs.renameSync(tmpFile, AGENTS_FILE);
  } catch (err) {
    console.error('agentStore: atomic save failed:', err.message);
    // Fallback: direct write
    try {
      fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf-8');
    } catch (err2) {
      console.error('agentStore: direct save also failed:', err2.message);
    }
  }
}

function getAll() {
  if (!loaded) load();
  return agents;
}

function getById(id) {
  if (!loaded) load();
  return agents.find(a => a.id === id) || null;
}

function create(agentData) {
  if (!loaded) load();
  const now = new Date().toISOString();
  const agent = {
    id: uuidv4(),
    name: agentData.name,
    role: agentData.role,
    background: agentData.background || '',
    perspective: agentData.perspective || '',
    color: agentData.color || '#607D8B',
    createdAt: now,
    updatedAt: now,
    knowledgeBase: {
      topicsDiscussed: [],
      sessionCount: 0
    },
    accumulatedInsights: '',
    knowledgeSources: []
  };
  agents.push(agent);
  save();
  return agent;
}

function update(id, updates) {
  if (!loaded) load();
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) return null;

  const allowedFields = ['name', 'role', 'background', 'perspective', 'color', 'accumulatedInsights', 'knowledgeSources'];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      agents[idx][field] = updates[field];
    }
  }
  agents[idx].updatedAt = new Date().toISOString();
  save();
  return agents[idx];
}

function remove(id) {
  if (!loaded) load();
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) return false;
  agents.splice(idx, 1);
  save();
  return true;
}

function updateKnowledge(id, { topic, sessionId, newInsights, sources }) {
  if (!loaded) load();
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) return null;

  const agent = agents[idx];

  // Add topic to discussed list
  if (topic && sessionId) {
    agent.knowledgeBase.topicsDiscussed.push({
      topic,
      sessionId,
      date: new Date().toISOString()
    });
    agent.knowledgeBase.sessionCount++;
  }

  // Update accumulated insights (LLM-merged string)
  if (newInsights) {
    agent.accumulatedInsights = newInsights;
  }

  // Append knowledge sources (FIFO, max 50)
  if (Array.isArray(sources) && sources.length > 0) {
    if (!agent.knowledgeSources) agent.knowledgeSources = [];
    const dated = sources.map(s => ({
      url: s.url,
      title: s.title || '',
      date: new Date().toISOString(),
      sessionTopic: topic || ''
    }));
    agent.knowledgeSources = agent.knowledgeSources.concat(dated);
    if (agent.knowledgeSources.length > 50) {
      agent.knowledgeSources = agent.knowledgeSources.slice(-50);
    }
  }

  agent.updatedAt = new Date().toISOString();
  save();
  return agent;
}

module.exports = {
  load,
  save,
  getAll,
  getById,
  create,
  update,
  remove,
  updateKnowledge
};
