'use strict';

/**
 * Keyword-based auto-categorization.
 * Maps items to categories based on name and description patterns.
 */

const CATEGORY_RULES = [
  {
    cat: 'SEO & GEO',
    patterns: [/\bgeo\b/i, /\bseo\b/i, /\bcitability\b/i, /\bcrawler/i, /\bllms\.txt\b/i, /\bschema\.org\b/i, /\bhreflang\b/i, /\bserp\b/i],
  },
  {
    cat: 'UX & Design',
    patterns: [/\bux[\s-]/i, /\bdesign.system\b/i, /\baccessibility\b/i, /\ba11y\b/i, /\bpresentation\b/i, /\bui[\s/-]ux\b/i],
  },
  {
    cat: 'Content & Writing',
    patterns: [/\barticle/i, /\bhumanize/i, /\bwriter\b/i, /\bcopywrite/i, /\bsubstack\b/i, /\bnewsletter\b/i, /\btelegram.post/i, /\bcreative.direct/i, /\bfact.check/i],
  },
  {
    cat: 'Security & QA',
    patterns: [/\bsecurity\b/i, /\bqa\b/i, /\btest(?:ing)?\b/i, /\baudit\b/i, /\bperf(?:ormance)?\b/i, /\bowasp\b/i, /\bvulnerab/i],
  },
  {
    cat: 'DevOps & Infra',
    patterns: [/\bdeploy/i, /\bdocker\b/i, /\binfra/i, /\bci[\s/-]?cd\b/i, /\bmonitor/i, /\brelease\b/i, /\bfastlane\b/i, /\bcloudflare\b/i, /\bdevops\b/i],
  },
  {
    cat: 'Project Management',
    patterns: [/\bproject.research\b/i, /\blinear\b/i, /\bdecision/i, /\bplan.*review\b/i, /\binvestor\b/i, /\broadmap\b/i, /\bstrateg/i, /\breflection\b/i],
  },
  {
    cat: 'Development',
    patterns: [/\bflutter\b/i, /\bsupabase\b/i, /\bedge.function/i, /\bmigration\b/i, /\bpython\b/i, /\bnextjs\b|next\.js/i, /\breact\b/i, /\btypescript\b/i, /\briverpod\b/i, /\bprompt.engineer/i, /\blangfuse\b/i, /\btelegram.bot/i, /\bmcp.server\b/i, /\bmapbox\b/i, /\bauth.flow\b/i, /\bdebug/i, /\bpattern/i, /\barchitect/i, /\bcodex\b/i],
  },
  {
    cat: 'Code Quality',
    patterns: [/\bcode.audit\b/i, /\bcode.review\b/i, /\bship(?:it)?\b/i, /\bpre.(?:push|commit)\b/i, /\bverif(?:y|ication)\b/i, /\breality.check\b/i, /\bsimplif/i, /\bquality.gate\b/i, /\blint/i],
  },
  {
    cat: 'Research & Intel',
    patterns: [/\bosint\b/i, /\btool.radar\b/i, /\bgitmcp\b/i, /\boutline.doc/i, /\bskill.factory\b/i, /\bresearch\b/i],
  },
];

/**
 * Detect if an item is an orchestrator (uses other skills/agents)
 */
function isOrchestrator(item) {
  const text = `${item.name} ${item.desc}`.toLowerCase();
  const signals = [
    /orchestrat/i,
    /\bpipeline\b/i,
    /\bmulti.agent\b/i,
    /\bparallel.*agent/i,
    /\broutes?\s+to\b/i,
    /\bfull.*(?:cycle|audit|flow)\b/i,
    /\b(?:5|4|3)\s+(?:parallel\s+)?agents?\b/i,
    /\bphases?\b.*(?:business|tech|legal|design)/i,
  ];
  return signals.some(p => p.test(text));
}

/**
 * Extract dependency names from description text
 */
function extractDeps(desc) {
  const deps = [];
  // Look for patterns like "combines X + Y", "routes to: X, Y", "uses X, Y"
  const patterns = [
    /(?:combines?|uses?|includes?|routes?\s+to)[:\s]+([^.]+)/gi,
    /(?:sub-skills?|sub.skills?)[:\s]+([^.]+)/gi,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(desc);
    if (match) {
      const names = match[1].split(/[,+&]/).map(s => s.trim().toLowerCase().replace(/\s+/g, '-'));
      deps.push(...names.filter(n => n.length > 2 && n.length < 40));
    }
  }

  return [...new Set(deps)];
}

/**
 * Categorize a single item
 */
function categorizeItem(item) {
  const text = `${item.name} ${item.desc}`;

  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some(p => p.test(text))) {
      return rule.cat;
    }
  }

  // Fallback by type
  if (item.type === 'agent') return 'Agents';
  if (item.type === 'mcp') return 'MCP Servers';
  if (item.name.startsWith('gsd')) return 'GSD System';

  return 'Other';
}

/**
 * Generate tags from description keywords
 */
function generateTags(item) {
  const tags = [];
  const text = `${item.name} ${item.desc}`.toLowerCase();

  const TAG_KEYWORDS = {
    'flutter': /flutter/i, 'dart': /dart/i, 'supabase': /supabase/i,
    'python': /python/i, 'typescript': /typescript/i, 'nextjs': /next\.?js/i,
    'react': /react/i, 'astro': /astro/i, 'docker': /docker/i,
    'ai': /\bai\b|llm|gpt|claude|gemini/i, 'seo': /seo/i, 'geo': /\bgeo\b/i,
    'testing': /test/i, 'security': /security|owasp/i, 'database': /database|sql|postgres/i,
    'auth': /auth/i, 'deploy': /deploy/i, 'monitoring': /monitor/i,
    'writing': /writ|article|blog/i, 'research': /research/i,
    'mobile': /mobile|ios|android/i, 'maps': /mapbox|map/i,
    'telegram': /telegram/i, 'github': /github/i, 'mcp': /\bmcp\b/i,
    'planning': /plan/i, 'audit': /audit/i, 'review': /review/i,
  };

  for (const [tag, pattern] of Object.entries(TAG_KEYWORDS)) {
    if (pattern.test(text)) tags.push(tag);
  }

  return tags.slice(0, 5); // Max 5 tags
}

/**
 * Main categorization pipeline
 */
function categorize(raw) {
  const allItems = [];

  // Process skills
  for (const skill of raw.skills) {
    const cat = skill.name.startsWith('gsd:') ? 'GSD System' : categorizeItem(skill);
    const orch = isOrchestrator(skill);
    allItems.push({
      name: skill.name,
      type: skill.type,
      cat: orch ? 'Orchestrators' : cat,
      desc: (skill.desc || '').substring(0, 200),
      tags: generateTags(skill),
      isOrchestrator: orch,
      deps: extractDeps(skill.desc || ''),
      providers: skill.providers || [],
      keywords: `${skill.name} ${skill.desc}`.toLowerCase().substring(0, 200),
    });
  }

  // Process agents
  for (const agent of raw.agents) {
    allItems.push({
      name: agent.name,
      type: 'agent',
      cat: 'Agents',
      desc: (agent.desc || '').substring(0, 200),
      tags: generateTags(agent),
      isOrchestrator: false,
      deps: [],
      providers: agent.providers || [],
      keywords: `${agent.name} ${agent.desc}`.toLowerCase().substring(0, 200),
    });
  }

  // Process instructions (AGENTS.md, GEMINI.md, etc.)
  for (const instr of (raw.instructions || [])) {
    allItems.push({
      name: instr.name,
      type: 'instruction',
      cat: 'Instructions',
      desc: (instr.desc || '').substring(0, 200),
      tags: generateTags(instr),
      isOrchestrator: false,
      deps: [],
      providers: instr.providers || [],
      keywords: `${instr.name} ${instr.desc}`.toLowerCase().substring(0, 200),
    });
  }

  // Process rules (Cursor, Windsurf)
  for (const rule of (raw.rules || [])) {
    allItems.push({
      name: rule.name,
      type: 'rule',
      cat: 'Rules',
      desc: (rule.desc || '').substring(0, 200),
      tags: generateTags(rule),
      isOrchestrator: false,
      deps: [],
      providers: rule.providers || [],
      keywords: `${rule.name} ${rule.desc}`.toLowerCase().substring(0, 200),
    });
  }

  // Process MCP servers
  for (const mcp of raw.mcpServers) {
    allItems.push({
      name: mcp.name,
      type: 'mcp',
      cat: 'MCP Servers',
      desc: (mcp.desc || '').substring(0, 200),
      tags: generateTags(mcp),
      isOrchestrator: false,
      deps: [],
      providers: mcp.providers || [],
      keywords: `${mcp.name} ${mcp.desc}`.toLowerCase().substring(0, 200),
    });
  }

  return allItems;
}

module.exports = { categorize };
