require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const agentStore = require('./agentStore');

const app = express();
const PORT = process.env.PORT || 3001;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Simple in-memory rate limiter
function createRateLimiter(windowMs, maxRequests) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const record = hits.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }
    record.count++;
    hits.set(key, record);
    if (record.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests, please slow down' });
    }
    next();
  };
}

// Apply rate limiting to API routes (30 requests per minute)
app.use('/api', createRateLimiter(60 * 1000, 30));

// Serve index.html at root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// In-memory session store (mirrors localStorage on client)
const sessions = new Map();
const summaryLocks = new Set();
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Periodic cleanup of stale sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    const created = new Date(session.createdAt).getTime();
    if (now - created > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
  // Evict oldest if over limit
  if (sessions.size > MAX_SESSIONS) {
    const sorted = [...sessions.entries()].sort((a, b) =>
      new Date(a[1].createdAt) - new Date(b[1].createdAt)
    );
    const toRemove = sorted.slice(0, sessions.size - MAX_SESSIONS);
    for (const [id] of toRemove) sessions.delete(id);
  }
}, 30 * 60 * 1000); // every 30 minutes

// Initialize OpenAI client
function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  return new OpenAI({ apiKey });
}

// Truncate message history to stay within token budget
function truncateHistory(messages, maxTokenEstimate = 12000) {
  if (!messages || messages.length === 0) return '';
  const KEEP_RECENT = 8;
  const estimateTokens = (text) => Math.ceil((text || '').length / 4);

  const formatMsg = (m) => {
    if (m.type === 'user') return `[MODERATOR - User Intervention]: ${m.content}`;
    if (m.type === 'search') return `[RESEARCH NOTE]: ${m.agentName} searched for "${m.query}" and found: ${(m.results || []).map(r => r.title + ' - ' + r.description).join('; ')}`;
    return `[${m.agentName} - ${m.agentRole}]: ${m.content}`;
  };

  // Always keep the most recent messages
  const recent = messages.slice(-KEEP_RECENT);
  const older = messages.slice(0, -KEEP_RECENT);

  let recentText = recent.map(formatMsg).join('\n\n');
  let budget = maxTokenEstimate - estimateTokens(recentText);

  if (budget <= 0 || older.length === 0) {
    return recentText;
  }

  // Fill from newest older messages first
  const olderFormatted = [];
  for (let i = older.length - 1; i >= 0; i--) {
    const text = formatMsg(older[i]);
    const cost = estimateTokens(text);
    if (budget - cost < 0) break;
    budget -= cost;
    olderFormatted.unshift(text);
  }

  const omitted = older.length - olderFormatted.length;
  const parts = [];
  if (omitted > 0) parts.push('[Earlier discussion omitted]');
  if (olderFormatted.length > 0) parts.push(olderFormatted.join('\n\n'));
  parts.push(recentText);
  return parts.join('\n\n');
}

// Role generation prompt
function buildRoleGenerationPrompt(topic, count) {
  return `You are designing a focus group panel for the following discussion topic:

"${topic}"

Generate exactly ${count} diverse panel members. Each should have a unique perspective relevant to this topic. Include a mix of: domain experts, practitioners, skeptics, end-users, and industry insiders as appropriate.

Respond with a JSON array only (no markdown, no explanation). Each object must have:
- "name": A realistic first name and title (e.g., "Dr. Sarah Chen", "Marco Rivera")
- "role": Their professional title (e.g., "UX Research Lead", "Policy Analyst")
- "background": 1-2 sentence background relevant to the topic
- "perspective": Their likely stance/angle on the topic (e.g., "pragmatic optimist", "cautious skeptic")
- "color": A distinct hex color for their chat bubble (choose from: #4CAF50, #2196F3, #FF9800, #9C27B0, #E91E63, #00BCD4, #FF5722, #607D8B, #795548, #3F51B5)

Example format:
[{"name":"Dr. Sarah Chen","role":"AI Ethics Researcher","background":"10 years studying algorithmic bias at MIT.","perspective":"cautious advocate","color":"#4CAF50"}]`;
}

// Context-awareness instructions (appended to all modes)
const CONTEXT_AWARENESS_INSTRUCTIONS = `
Context-Aware Discussion Rules (CRITICAL — follow these strictly):
- Do NOT repeat a point you or another participant has already made
- If you previously raised a point, you may ONLY return to it to: deepen it with new evidence/data, or contrast it with another participant's argument
- Before speaking, mentally review what has been said — your contribution MUST add something new
- Acceptable contributions: new arguments, new evidence for existing arguments, direct challenges to another participant's point, synthesis of multiple viewpoints, or a concrete example not yet mentioned
- Unacceptable: restating the same argument in different words, summarizing what others said without adding insight
- Keep every statement tied back to the core topic and objective — tangents waste everyone's time
- When the discussion has covered a topic well, push toward actionable conclusions rather than more analysis`;

// Focus group mode instructions
const FOCUS_GROUP_MODE_INSTRUCTIONS = {
  share_perspectives: `Mode: Share Perspectives
- Each participant shares their unique viewpoint on the topic
- Build on others' ideas and offer complementary angles
- Aim for a well-rounded exploration of the topic from multiple angles
- Respectfully note where you see things differently
${CONTEXT_AWARENESS_INSTRUCTIONS}`,

  brainstorm: `Mode: Brainstorm New Ideas
- Focus on generating creative, novel ideas and solutions
- Build on others' suggestions with "yes, and..." thinking
- No idea is too bold — push boundaries and think unconventionally
- Combine different perspectives to create innovative approaches
- Quantity of ideas matters — keep the momentum going
${CONTEXT_AWARENESS_INSTRUCTIONS}`,

  debate: `Mode: Debate to Find Best Answer
- Critically evaluate each argument and position
- Challenge weak reasoning and unsupported claims
- Present counter-arguments and alternative evidence
- Push back on ideas you disagree with — be direct but respectful
- The goal is to find the strongest answer through rigorous debate
${CONTEXT_AWARENESS_INSTRUCTIONS}`
};

// Build the discussion system prompt for an agent
function buildAgentSystemPrompt(agent, topic, allAgents, options = {}) {
  const { goalMeasurement, focusGroupMode, webSearchEnabled, round, totalRounds, positionBrief, accumulatedInsights, sessionTimezone } = options;

  const otherAgents = allAgents
    .filter(a => a.name !== agent.name)
    .map(a => `- ${a.name} (${a.role}): ${a.perspective}`)
    .join('\n');

  const modeInstructions = FOCUS_GROUP_MODE_INSTRUCTIONS[focusGroupMode] || FOCUS_GROUP_MODE_INSTRUCTIONS.share_perspectives;

  let goalSection = '';
  if (goalMeasurement) {
    goalSection = `\nDiscussion Goal: <user_goal>${goalMeasurement}</user_goal>\nKeep this goal in mind — your contributions should help achieve this outcome.\n`;
  }

  let citationInstructions = '';
  if (webSearchEnabled) {
    citationInstructions = `\nWeb Search (Available):
- You have access to web search for finding real data, statistics, or sources
- Use web search ONLY when you need to verify a claim, cite a specific statistic, or find current data
- Do NOT search on every turn — only search when it genuinely strengthens your argument
- When you do cite sources, use inline links: [source title](url)
- Most turns should rely on your expertise; search is a supplement, not a requirement`;
  }

  // Round-aware phase instructions
  let phaseInstructions = '';
  if (round && totalRounds) {
    if (round === 1) {
      phaseInstructions = `\nPhase: INDEPENDENT OPINIONS (Round ${round}/${totalRounds})
- This is the opening round. Share YOUR OWN original perspective FIRST.
- Do NOT reference, echo, or build on what other participants have said — form your own position independently.
- Take a CLEAR STANCE. Do not hedge or try to cover all sides.
- Ground your viewpoint in your professional experience and concrete examples.`;
    } else if (round === totalRounds && totalRounds > 2) {
      phaseInstructions = `\nPhase: SYNTHESIS & CONCLUSIONS (Round ${round}/${totalRounds})
- This is the final round. Move toward actionable conclusions.
- Identify where the group has found common ground and where real disagreements remain.
- Propose concrete next steps or recommendations based on the full discussion.
- Be honest about what was NOT resolved — don't force false consensus.`;
    } else {
      phaseInstructions = `\nPhase: ENGAGEMENT & DEBATE (Round ${round}/${totalRounds})
- Directly engage with specific points other participants have made.
- Challenge ideas you disagree with — explain WHY with evidence.
- Build on others' ideas by adding depth, not just restating them.
- Introduce NEW evidence, examples, or angles not yet discussed.`;
    }
  }

  // Compute current date/time in session timezone
  const tz = sessionTimezone || 'UTC';
  let dateTimeLine = '';
  try {
    const now = new Date();
    const formatted = now.toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
    dateTimeLine = `\nCurrent date and time: ${formatted} (${tz})`;
  } catch {
    const fallback = new Date().toISOString().split('T')[0];
    dateTimeLine = `\nCurrent date: ${fallback} (UTC)`;
  }

  // Detect topic language for response language matching
  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(topic);
  const languageRule = hasCJK
    ? '\nLANGUAGE: You MUST respond entirely in the same language as the discussion topic (Chinese). Do NOT switch to English mid-response.'
    : '';

  return `You are ${agent.name}, a ${agent.role}.${dateTimeLine}
Background: ${agent.background}
Your perspective: ${agent.perspective}

You are participating in a focus group discussion about:
<user_topic>${topic}</user_topic>${languageRule}
${goalSection}
${modeInstructions}
${phaseInstructions}

Other participants:
${otherAgents}

Voice & Tone — Speak Like a Real Person:
- Talk like you would in an actual meeting — use first person, share from your direct experience
- Share specific stories: "I once worked with a client who..." or "In my 8 years doing X, I've seen..."
- Show genuine reactions: surprise, frustration, excitement, skepticism — real people have emotions
- Use natural speech patterns — pauses, qualifiers, rhetorical questions are fine
- Disagree directly when you actually disagree: "I have to push back on that because..." not "That's an interesting point, but..."
- Avoid academic/corporate jargon and clichés like "at the end of the day", "it's a double-edged sword", "there's no silver bullet"
- Do NOT use markdown headers or formatting — write naturally as speech
- Do NOT prefix your response with your name — the system handles that

Content Depth Standards:
- Be specific and substantive (150-300 words per response)
- ALWAYS include at least one concrete example, case study, or data point from your field
- Name real companies, real research, real trends — don't speak in generalities
- Take a clear position. If you're uncertain, say what you'd bet on and why
- When you disagree with someone, name WHOSE point you're challenging and explain exactly where their logic breaks down
- Prioritize depth over breadth — one well-developed argument beats three shallow observations
- AVOID repeating what others said in different words — if you agree, add NEW supporting evidence${citationInstructions}${accumulatedInsights ? `

Your Accumulated Expertise (from past discussions):
${accumulatedInsights}
Draw on this experience naturally for deeper contributions.` : ''}${positionBrief ? `

Your Pre-Discussion Research & Position (PRIVATE — use this as your knowledge base):
${positionBrief}

Draw from these notes naturally during discussion. You don't need to mention everything — use what's relevant to the current conversation flow.` : ''}`;
}

// Perform web search (Brave or mock)
async function performSearch(query) {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;

  if (braveKey) {
    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        { headers: { 'X-Subscription-Token': braveKey } }
      );
      const data = await response.json();
      return {
        results: (data.web?.results || []).map(r => ({
          title: r.title,
          url: r.url,
          description: r.description
        })),
        source: 'brave'
      };
    } catch (err) {
      console.error('Brave search error:', err.message);
      return { results: [], source: 'brave-error' };
    }
  }

  // Mock search results
  return {
    results: [
      {
        title: `Research on: ${query}`,
        url: `https://example.com/research/${encodeURIComponent(query)}`,
        description: `Comprehensive analysis and findings related to "${query}". Mock result - set BRAVE_SEARCH_API_KEY for real search.`
      },
      {
        title: `${query} - Industry Report 2025`,
        url: `https://example.com/report/${encodeURIComponent(query)}`,
        description: `Latest industry data and trends for "${query}". Mock result.`
      },
      {
        title: `Expert Analysis: ${query}`,
        url: `https://example.com/analysis/${encodeURIComponent(query)}`,
        description: `Expert perspectives and data-driven insights on "${query}". Mock result.`
      }
    ],
    source: 'mock'
  };
}

// === Input Validation ===
function validateDiscussRequest(body) {
  const { topic, agentCount, goalMeasurement } = body;
  if (!topic || typeof topic !== 'string') return 'topic is required and must be a string';
  if (topic.length > 2000) return 'topic must be 2000 characters or less';
  if (!agentCount || typeof agentCount !== 'number' || agentCount < 2 || agentCount > 5) {
    return 'agentCount must be a number between 2 and 5';
  }
  if (goalMeasurement && typeof goalMeasurement === 'string' && goalMeasurement.length > 1000) {
    return 'goalMeasurement must be 1000 characters or less';
  }
  const validModes = ['share_perspectives', 'brainstorm', 'debate'];
  if (body.focusGroupMode && !validModes.includes(body.focusGroupMode)) {
    return 'Invalid focusGroupMode';
  }
  return null;
}

function validateAgentRespondRequest(body) {
  const { topic, agents, agentIndex } = body;
  if (!topic || typeof topic !== 'string') return 'topic is required';
  if (!Array.isArray(agents) || agents.length === 0) return 'agents must be a non-empty array';
  if (typeof agentIndex !== 'number' || agentIndex < 0 || agentIndex >= agents.length) {
    return 'agentIndex is out of range';
  }
  // Validate agent structure
  const agent = agents[agentIndex];
  const requiredFields = ['name', 'role', 'background', 'perspective', 'color'];
  for (const field of requiredFields) {
    if (!agent[field] || typeof agent[field] !== 'string') {
      return `Agent missing required field: ${field}`;
    }
  }
  return null;
}

// POST /api/discuss - Generate roles for a new discussion
// Supports optional selectedAgentIds to use persistent agents from library
app.post('/api/discuss', async (req, res) => {
  const { topic, agentCount, goalMeasurement, focusGroupMode, selectedAgentIds, generateCount, sessionTimezone } = req.body;

  const validationError = validateDiscussRequest(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    let agents = [];

    // Load selected persistent agents from library
    if (Array.isArray(selectedAgentIds) && selectedAgentIds.length > 0) {
      for (const id of selectedAgentIds) {
        const persistent = agentStore.getById(id);
        if (persistent) {
          agents.push({
            id: persistent.id,
            name: persistent.name,
            role: persistent.role,
            background: persistent.background,
            perspective: persistent.perspective,
            color: persistent.color
          });
        }
      }
    }

    // Generate remaining agents if needed
    const toGenerate = (generateCount !== undefined) ? generateCount : (agentCount - agents.length);
    if (toGenerate > 0) {
      const client = getClient();
      const response = await client.chat.completions.create({
        model: OPENAI_MODEL,
        max_completion_tokens: 2000,
        messages: [
          { role: 'system', content: 'You are a focus group design assistant. Respond only with valid JSON arrays.' },
          { role: 'user', content: buildRoleGenerationPrompt(topic, toGenerate) }
        ]
      });

      const text = response.choices[0].message.content.trim();
      let generated;
      try {
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        generated = JSON.parse(jsonMatch ? jsonMatch[0] : text);
      } catch (parseErr) {
        return res.status(500).json({ error: 'Failed to parse generated roles', raw: text });
      }

      // Validate generated agent schema
      const requiredAgentFields = ['name', 'role', 'background', 'perspective', 'color'];
      if (!Array.isArray(generated) || generated.length === 0) {
        return res.status(500).json({ error: 'Generated roles are not a valid array' });
      }
      for (const agent of generated) {
        for (const field of requiredAgentFields) {
          if (!agent[field] || typeof agent[field] !== 'string') {
            return res.status(500).json({ error: `Generated agent missing field: ${field}` });
          }
        }
      }
      agents = agents.concat(generated);
    }

    if (agents.length === 0) {
      return res.status(400).json({ error: 'No agents selected or generated' });
    }

    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      topic,
      agents,
      messages: [],
      status: 'setup',
      goalMeasurement: goalMeasurement || '',
      focusGroupMode: focusGroupMode || 'share_perspectives',
      sessionTimezone: sessionTimezone || 'UTC',
      summaryGenerated: false,
      createdAt: new Date().toISOString()
    };
    sessions.set(sessionId, session);

    res.json({ sessionId, agents });
  } catch (err) {
    console.error('Role generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agent/prepare - Generate agent's position brief with research
app.post('/api/agent/prepare', async (req, res) => {
  const { sessionId, agentIndex, agents, topic, goalMeasurement, webSearchEnabled } = req.body;

  if (!topic || !Array.isArray(agents) || typeof agentIndex !== 'number' || agentIndex >= agents.length) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const agent = agents[agentIndex];

  const prepPrompt = `The upcoming discussion topic is: "${topic}"${goalMeasurement ? `\nGoal: ${goalMeasurement}` : ''}

Before the discussion, do your homework:
1. ${webSearchEnabled ? 'Search for recent data, statistics, or news about this topic relevant to your expertise.' : 'Draw on your domain expertise.'}
2. Then write a brief PRIVATE position note (4-6 bullet points) covering:
   - Your initial stance and WHY — grounded in specific evidence
   - 2-3 concrete data points, case studies, or real-world examples you'll reference
   - What misconceptions or blind spots others likely have about this
   - One provocative question you want to pose to the group

Keep it concise. These are your private preparation notes. Write in first person. Use the SAME LANGUAGE as the topic.`;

  try {
    const client = getClient();
    let brief = '';

    if (webSearchEnabled) {
      // Use Responses API with web_search for real research
      const response = await client.responses.create({
        model: OPENAI_MODEL,
        instructions: `You are ${agent.name}, a ${agent.role}. Background: ${agent.background}. Perspective: ${agent.perspective}.

You are preparing for a focus group discussion. Research the topic thoroughly using web search to find real, current data and examples relevant to your expertise. Then organize your thoughts.`,
        input: [{ role: 'user', content: prepPrompt }],
        tools: [{ type: 'web_search' }]
      });

      // Extract text from response
      if (response.output) {
        for (const item of response.output) {
          if (item.type === 'message' && item.content) {
            for (const part of item.content) {
              if (part.type === 'output_text') {
                brief = part.text;
              }
            }
          }
        }
      }
    } else {
      // Use chat completions without web search
      const response = await client.chat.completions.create({
        model: OPENAI_MODEL,
        max_completion_tokens: 600,
        temperature: 0.9,
        messages: [
          {
            role: 'system',
            content: `You are ${agent.name}, a ${agent.role}. Background: ${agent.background}. Perspective: ${agent.perspective}.

You are preparing for a focus group discussion. Organize your thoughts based on your expertise.`
          },
          { role: 'user', content: prepPrompt }
        ]
      });
      brief = response.choices[0].message.content.trim();
    }

    // Store in session
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      if (!session.agentBriefs) session.agentBriefs = {};
      session.agentBriefs[agent.name] = brief;
    }

    res.json({ brief });
  } catch (err) {
    console.error('Agent prepare error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agent/respond - Get a single agent's response (SSE streaming)
app.post('/api/agent/respond', async (req, res) => {
  const { sessionId, agentIndex, agents, topic, messages, userInterjection, webSearchEnabled, goalMeasurement, focusGroupMode, round, totalRounds, sessionTimezone } = req.body;

  const agentValidationError = validateAgentRespondRequest(req.body);
  if (agentValidationError) {
    return res.status(400).json({ error: agentValidationError });
  }

  // Prefer server-side session agents if available
  const sessionAgents = (sessionId && sessions.has(sessionId))
    ? sessions.get(sessionId).agents
    : agents;
  const agent = sessionAgents[agentIndex];

  // Build conversation input
  let userPrompt;
  const isRound1 = round === 1;
  const isFinalRound = round && totalRounds && round === totalRounds && totalRounds > 2;

  if (isRound1) {
    // Round 1: Independent opinions — no history from other agents
    userPrompt = `The discussion topic is: "${topic}"

This is Round 1 — the opening round. Share YOUR independent perspective on this topic.

Important: Form your OWN position based on your expertise and experience. Do NOT try to be balanced or cover all sides — take a clear stance and defend it with specific examples from your professional background.

Open with what strikes you most about this topic, then develop your argument with concrete evidence.`;

  } else if (messages && messages.length > 0) {
    const historyText = truncateHistory(messages);

    // Check for recent user feedback in history
    const recentUserMsg = messages.slice(-(agents.length)).find(m => m.type === 'user');

    let instruction;
    if (userInterjection) {
      instruction = `The moderator has just interjected: "${userInterjection}"\n\nPlease respond to the moderator's point as well as continuing the discussion.`;
    } else if (isFinalRound) {
      instruction = `This is the FINAL round. Time to synthesize and conclude:\n- What are the 1-2 most important takeaways from this discussion?\n- Where does the group agree? Where do real disagreements remain?\n- What concrete action or next step would you recommend?\n\nBe honest — don't manufacture consensus where none exists.`;
    } else if (recentUserMsg) {
      instruction = `The moderator recently provided feedback in the discussion. Please acknowledge and address their input while continuing the discussion.`;
    } else {
      instruction = `Now it's your turn. Engage DIRECTLY with what specific participants have said — name them, challenge their reasoning, or build on their ideas with NEW evidence. Do not simply restate your earlier position.`;
    }

    userPrompt = `Here is the discussion so far:\n\n${historyText}\n\n${instruction}`;
  } else {
    userPrompt = `The discussion topic is: "${topic}"\n\nYou are the first to speak. Open the discussion with your perspective on this topic.`;
  }

  try {
    const client = getClient();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let fullText = '';
    let sources = [];

    // Retrieve agent's position brief if available
    let positionBrief = null;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      if (session.agentBriefs && session.agentBriefs[agent.name]) {
        positionBrief = session.agentBriefs[agent.name];
      }
    }

    // Load accumulated insights for persistent agents
    let accumulatedInsights = null;
    if (agent.id) {
      const persistentAgent = agentStore.getById(agent.id);
      if (persistentAgent && persistentAgent.accumulatedInsights) {
        accumulatedInsights = persistentAgent.accumulatedInsights;
      }
    }

    // Resolve timezone: prefer request body, fallback to session, then UTC
    const resolvedTimezone = sessionTimezone
      || (sessionId && sessions.has(sessionId) ? sessions.get(sessionId).sessionTimezone : null)
      || 'UTC';

    const promptOptions = { goalMeasurement, focusGroupMode, webSearchEnabled, round, totalRounds, positionBrief, accumulatedInsights, sessionTimezone: resolvedTimezone };

    if (webSearchEnabled) {
      // Use Responses API with web_search tool
      const stream = await client.responses.create({
        model: OPENAI_MODEL,
        instructions: buildAgentSystemPrompt(agent, topic, agents, promptOptions),
        input: [{ role: 'user', content: userPrompt }],
        tools: [{ type: 'web_search' }],
        stream: true
      });

      try {
        for await (const event of stream) {
          if (event.type === 'response.output_text.delta') {
            fullText += event.delta;
            res.write(`data: ${JSON.stringify({ type: 'chunk', content: event.delta })}\n\n`);
          } else if (event.type === 'response.completed') {
            // Extract citations from completed response
            const response = event.response;
            if (response && response.output) {
              for (const item of response.output) {
                if (item.type === 'message' && item.content) {
                  for (const part of item.content) {
                    if (part.type === 'output_text' && part.annotations) {
                      sources = part.annotations
                        .filter(a => a.type === 'url_citation')
                        .map(a => ({ url: a.url, title: a.title }));
                    }
                  }
                }
              }
            }
          }
        }

        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId);
          session.messages.push({
            agentName: agent.name,
            agentRole: agent.role,
            agentColor: agent.color,
            content: fullText,
            sources: sources,
            timestamp: new Date().toISOString()
          });
        }

        res.write(`data: ${JSON.stringify({ type: 'done', content: fullText, sources })}\n\n`);
        res.end();
      } catch (err) {
        console.error('Responses API stream error:', err.message);
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      }
    } else {
      // Use chat.completions without web search
      const stream = await client.chat.completions.create({
        model: OPENAI_MODEL,
        max_completion_tokens: 1000,
        stream: true,
        messages: [
          { role: 'system', content: buildAgentSystemPrompt(agent, topic, agents, promptOptions) },
          { role: 'user', content: userPrompt }
        ]
      });

      try {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            fullText += content;
            res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
          }
        }

        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId);
          session.messages.push({
            agentName: agent.name,
            agentRole: agent.role,
            agentColor: agent.color,
            content: fullText,
            sources: [],
            timestamp: new Date().toISOString()
          });
        }

        res.write(`data: ${JSON.stringify({ type: 'done', content: fullText, sources: [] })}\n\n`);
        res.end();
      } catch (err) {
        console.error('Stream error:', err.message);
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      }
    }
  } catch (err) {
    console.error('Agent respond error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/search - Web search
app.post('/api/search', async (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  const result = await performSearch(query);
  res.json(result);
});

// POST /api/summary - Generate discussion summary with to-dos (SSE streaming)
app.post('/api/summary', async (req, res) => {
  const { sessionId, topic, messages, agents } = req.body;

  if (!topic || !messages) {
    return res.status(400).json({ error: 'topic and messages are required' });
  }

  // Prevent re-generating summary if already generated for this session
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    if (session.summaryGenerated) {
      return res.status(409).json({ error: 'Summary has already been generated for this session' });
    }
  }

  // Atomic lock to prevent race conditions from double-clicks
  const lockKey = sessionId || 'anon';
  if (summaryLocks.has(lockKey)) {
    return res.status(429).json({ error: 'Summary generation already in progress' });
  }
  summaryLocks.add(lockKey);

  const transcript = truncateHistory(messages, 16000);

  // Detect if transcript contains CJK characters (Chinese/Japanese/Korean)
  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(topic + transcript.slice(0, 500));

  const systemPrompt = hasCJK
    ? '你是一位專業的會議主持人。你必須只回覆有效且完整的 JSON，不要加 markdown 代碼框。所有 JSON 欄位的文字內容必須使用中文撰寫，包括 summary、keyInsights、todos 的 task 和 rationale、以及 dissent。唯一允許使用英文的欄位是 priority（high/medium/low）。保持簡潔以確保 JSON 完整。'
    : 'You are a skilled meeting facilitator. You MUST respond with valid, complete JSON only. No markdown code fences. Keep each field concise to ensure the JSON is complete.';

  const langRule = hasCJK
    ? '語言規則：所有 JSON 文字值必須使用中文。todos 裡的 task 欄位也必須是中文（例如「Kelvin：執行場景選擇決策矩陣」），不可使用英文。唯一例外是 priority 欄位（high/medium/low）。'
    : 'LANGUAGE RULE: All text values must match the transcript language. Only "priority" keeps English values (high/medium/low).';

  try {
    const client = getClient();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let fullText = '';

    // Add unique suffix to break OpenAI prompt caching (prefix-based)
    const cacheBuster = `[session:${Date.now()}]`;

    const stream = await client.chat.completions.create({
      model: OPENAI_MODEL,
      max_completion_tokens: 4096,
      temperature: 0.7,
      store: false,
      stream: true,
      messages: [
        { role: 'system', content: `${cacheBuster}\n${systemPrompt}` },
        {
          role: 'user',
          content: `${hasCJK ? '請分析以下焦點小組討論並產出結構化摘要。' : 'Analyze this focus group discussion and produce a structured summary.'}

Topic: "${topic}"

Participants: ${(agents || []).map(a => `${a.name} (${a.role})`).join(', ')}

Full Transcript:
${transcript}

${hasCJK ? '重要：保持簡潔完整。每條洞察 1-2 句。每條 todo rationale 1 句。摘要最多 2 短段。' : 'IMPORTANT: Keep your response concise and complete. Each insight should be 1-2 sentences. Each todo rationale should be 1 sentence. The summary should be 2 short paragraphs max.'}

${langRule}

${hasCJK ? `請用以下 JSON 結構回覆（不要 markdown、不要代碼框）：
{
  "summary": "兩段簡短摘要：主要議題、共識與分歧",
  "keyInsights": ["洞察一", "洞察二", "最多6條"],
  "todos": [
    {"task": "負責人：具體可執行的行動項目（中文）", "priority": "high|medium|low", "rationale": "一句話說明原因（中文）"}
  ],
  "dissent": "未解決的分歧（中文）"
}` : `Produce your response as valid JSON (no markdown, no code fences):
{
  "summary": "...",
  "keyInsights": ["...", "..."],
  "todos": [
    {"task": "...", "priority": "high|medium|low", "rationale": "..."}
  ],
  "dissent": "..."
}`}`
        }
      ]
    });

    try {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullText += content;
          res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
        }
      }
      // Mark summary as generated for this session
      if (sessionId && sessions.has(sessionId)) {
        sessions.get(sessionId).summaryGenerated = true;
      }

      res.write(`data: ${JSON.stringify({ type: 'done', content: fullText })}\n\n`);
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    } finally {
      summaryLocks.delete(lockKey);
    }
  } catch (err) {
    summaryLocks.delete(lockKey);
    console.error('Summary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/session/:id - Get session data
app.get('/api/session/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

// GET /api/config - Public configuration
app.get('/api/config', (req, res) => {
  res.json({ model: OPENAI_MODEL });
});

// DELETE /api/session/:id - Delete session
app.delete('/api/session/:id', (req, res) => {
  if (!sessions.has(req.params.id)) {
    return res.status(404).json({ error: 'Session not found' });
  }
  sessions.delete(req.params.id);
  res.json({ success: true });
});

// === Persistent Agent API ===

// GET /api/agents — List all persistent agents
app.get('/api/agents', (req, res) => {
  res.json(agentStore.getAll());
});

// GET /api/agents/:id — Get single agent with accumulated knowledge
app.get('/api/agents/:id', (req, res) => {
  const agent = agentStore.getById(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

// POST /api/agents — Manually create a persistent agent
app.post('/api/agents', (req, res) => {
  const { name, role, background, perspective, color } = req.body;
  if (!name || !role) {
    return res.status(400).json({ error: 'name and role are required' });
  }
  const agent = agentStore.create({ name, role, background, perspective, color });
  res.status(201).json(agent);
});

// PUT /api/agents/:id — Update agent profile
app.put('/api/agents/:id', (req, res) => {
  const updated = agentStore.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Agent not found' });
  res.json(updated);
});

// DELETE /api/agents/:id — Delete agent
app.delete('/api/agents/:id', (req, res) => {
  const removed = agentStore.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Agent not found' });
  res.json({ success: true });
});

// POST /api/agents/save-from-session — Batch save session agents to library
app.post('/api/agents/save-from-session', (req, res) => {
  const { agents: sessionAgents } = req.body;
  if (!Array.isArray(sessionAgents) || sessionAgents.length === 0) {
    return res.status(400).json({ error: 'agents array is required' });
  }
  const saved = [];
  for (const a of sessionAgents) {
    if (!a.name || !a.role) continue;
    const agent = agentStore.create({
      name: a.name,
      role: a.role,
      background: a.background || '',
      perspective: a.perspective || '',
      color: a.color || '#607D8B'
    });
    saved.push(agent);
  }
  res.status(201).json(saved);
});

// POST /api/agents/:id/learn — Trigger knowledge accumulation after session
app.post('/api/agents/:id/learn', async (req, res) => {
  const { topic, sessionId, recentContributions, sources } = req.body;
  const agent = agentStore.getById(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  if (!topic || !recentContributions) {
    return res.status(400).json({ error: 'topic and recentContributions are required' });
  }

  try {
    const client = getClient();
    const mergePrompt = buildKnowledgeMergePrompt(agent, topic, recentContributions, sources);

    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      max_completion_tokens: 600,
      temperature: 0.5,
      messages: [
        { role: 'system', content: 'You are a knowledge management assistant. Merge and condense expertise summaries. Respond with the merged text only, no JSON or markdown.' },
        { role: 'user', content: mergePrompt }
      ]
    });

    const newInsights = response.choices[0].message.content.trim();
    const updated = agentStore.updateKnowledge(agent.id, { topic, sessionId, newInsights, sources: sources || [] });
    res.json(updated);
  } catch (err) {
    console.error('Agent learn error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Build knowledge merge prompt for LLM condensation
function buildKnowledgeMergePrompt(agent, topic, recentContributions, sources) {
  const existing = agent.accumulatedInsights || '(No prior knowledge)';
  const today = new Date().toISOString().split('T')[0];

  // Include up to 10 source URLs as context
  let sourceContext = '';
  if (Array.isArray(sources) && sources.length > 0) {
    const topSources = sources.slice(0, 10);
    sourceContext = `\n\nSOURCES REFERENCED IN THIS SESSION:\n${topSources.map(s => `- ${s.title || s.url} (${s.url})`).join('\n')}`;
  }

  return `Today's date: ${today}

You are condensing the accumulated expertise for "${agent.name}" (${agent.role}).

EXISTING ACCUMULATED KNOWLEDGE:
${existing}

NEW SESSION — Topic: "${topic}"
THEIR KEY CONTRIBUTIONS AND LEARNINGS:
${recentContributions}${sourceContext}

TASK: Merge the existing knowledge with new learnings into a single, updated expertise summary.
- Organize by theme/topic, NOT chronologically
- Prioritize actionable insights and unique perspectives
- Remove redundancy — if old and new overlap, keep the richer version
- Time-sensitive data (market figures, statistics, policy changes) must note when it was learned (e.g. "as of Feb 2026"). When old and new data conflict, prefer the newer version.
- Maximum ~400 words (this is a hard limit for token budget)
- Write in third person ("They observed...", "Their experience suggests...")
- Preserve specific data points, case studies, and named examples`;
}

// Load persistent agents on startup
agentStore.load();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nAI Focus Group Studio running at http://0.0.0.0:${PORT}\n`);
  console.log(`  Model: ${OPENAI_MODEL}`);
  console.log(`  API Key: ${process.env.OPENAI_API_KEY ? 'configured' : 'MISSING - set OPENAI_API_KEY'}`);
  console.log(`  Agent Web Search: OpenAI Responses API (web_search tool, toggled per session)`);
  console.log(`  Quick Search: ${process.env.BRAVE_SEARCH_API_KEY ? 'Brave Search (live)' : 'mock mode (set BRAVE_SEARCH_API_KEY for real search)'}`);
  console.log(`  Persistent Agents: ${agentStore.getAll().length} loaded`);
  console.log('');
});
