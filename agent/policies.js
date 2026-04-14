'use strict';

const VALID_SEVERITIES = new Set(['warning', 'blocking']);
const VALID_MODES = new Set(['required', 'forbidden', 'recommended']);
const VALID_SCOPES = new Set(['project', 'environment', 'any']);
const VALID_ENVIRONMENT_TYPES = new Set(['local', 'remote']);
const VALID_ASSET_TYPES = new Set(['skill', 'agent', 'mcp', 'instruction', 'rule']);
const VALID_PROVIDERS = new Set(['claude', 'codex', 'gemini', 'cursor', 'windsurf', 'copilot', 'continue_dev']);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(values, predicate = null) {
  const normalized = Array.isArray(values)
    ? values.map((value) => normalizeString(value)).filter(Boolean)
    : [];
  const filtered = predicate ? normalized.filter(predicate) : normalized;
  return [...new Set(filtered)];
}

function wildcardToRegExp(pattern) {
  const source = String(pattern || '')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${source}$`, 'i');
}

function matchesPatterns(value, patterns) {
  if (!patterns?.length) return true;
  const normalized = normalizeString(value);
  if (!normalized) return false;
  return patterns.some((pattern) => wildcardToRegExp(pattern).test(normalized));
}

function normalizeSelectors(selectors = {}) {
  return {
    environmentIds: normalizeStringArray(selectors.environmentIds),
    environmentTypes: normalizeStringArray(selectors.environmentTypes, (value) => VALID_ENVIRONMENT_TYPES.has(value)),
    projectIds: normalizeStringArray(selectors.projectIds),
    projectTypes: normalizeStringArray(selectors.projectTypes),
    projectPathPatterns: normalizeStringArray(selectors.projectPathPatterns),
    providers: normalizeStringArray(selectors.providers, (value) => VALID_PROVIDERS.has(value)),
  };
}

function normalizeRule(rule = {}) {
  const mode = VALID_MODES.has(rule.mode) ? rule.mode : null;
  const assetType = VALID_ASSET_TYPES.has(rule.assetType) ? rule.assetType : null;
  const scope = VALID_SCOPES.has(rule.scope) ? rule.scope : 'any';
  const name = normalizeString(rule.name);
  const namePattern = normalizeString(rule.namePattern);
  const provider = VALID_PROVIDERS.has(rule.provider) ? rule.provider : null;
  const note = normalizeString(rule.note);

  if (!mode) throw new Error('Policy rule mode must be required, forbidden, or recommended');
  if (!assetType) throw new Error('Policy rule assetType must be one of skill, agent, mcp, instruction, rule');
  if (!name && !namePattern) {
    throw new Error('Policy rule must include name or namePattern');
  }

  return {
    mode,
    assetType,
    scope,
    name: name || null,
    namePattern: namePattern || null,
    provider,
    note: note || null,
  };
}

function normalizePolicyInput(input = {}, { partial = false } = {}) {
  const normalized = {};
  if (!partial || input.name !== undefined) {
    const name = normalizeString(input.name);
    if (!partial && !name) throw new Error('Policy name is required');
    if (name) normalized.name = name;
  }
  if (!partial || input.description !== undefined) {
    normalized.description = normalizeString(input.description || '');
  }
  if (!partial || input.enabled !== undefined) {
    normalized.enabled = typeof input.enabled === 'boolean' ? input.enabled : true;
  }
  if (!partial || input.severity !== undefined) {
    const severity = VALID_SEVERITIES.has(input.severity) ? input.severity : 'warning';
    normalized.severity = severity;
  }
  if (!partial || input.selectors !== undefined) {
    normalized.selectors = normalizeSelectors(input.selectors || {});
  }
  if (!partial || input.rules !== undefined) {
    if (!Array.isArray(input.rules) || input.rules.length === 0) {
      throw new Error('Policy must include at least one rule');
    }
    normalized.rules = input.rules.map(normalizeRule);
  }
  return normalized;
}

function buildSubjectProviders(subject, assets) {
  const values = new Set();
  for (const provider of subject.providers || []) values.add(provider);
  for (const asset of assets || []) {
    for (const provider of asset.providers || []) {
      if (provider) values.add(provider);
    }
  }
  return [...values];
}

function policyMatchesSubject(policy, subject) {
  const selectors = policy.selectors || {};

  if (selectors.environmentIds?.length) {
    const envId = subject.kind === 'project' ? subject.environmentId : subject.id;
    if (!envId || !selectors.environmentIds.includes(envId)) return false;
  }

  if (selectors.environmentTypes?.length) {
    if (!subject.environmentType || !selectors.environmentTypes.includes(subject.environmentType)) return false;
  }

  if (subject.kind === 'project') {
    if (selectors.projectIds?.length && !selectors.projectIds.includes(subject.id)) return false;
    if (selectors.projectTypes?.length && (!subject.projectType || !selectors.projectTypes.includes(subject.projectType))) return false;
    if (!matchesPatterns(subject.path, selectors.projectPathPatterns)) return false;
  } else if (
    selectors.projectIds?.length
    || selectors.projectTypes?.length
    || selectors.projectPathPatterns?.length
  ) {
    return false;
  }

  if (selectors.providers?.length) {
    const subjectProviders = new Set(subject.providers || []);
    const matches = selectors.providers.some((provider) => subjectProviders.has(provider));
    if (!matches) return false;
  }

  return true;
}

function assetMatchesRule(asset, rule) {
  if (!asset || asset.type !== rule.assetType) return false;
  if (rule.provider && !(asset.providers || []).includes(rule.provider)) return false;
  if (rule.name && asset.name !== rule.name) return false;
  if (rule.namePattern && !wildcardToRegExp(rule.namePattern).test(asset.name || '')) return false;
  return true;
}

function describeRule(rule) {
  return [
    rule.assetType,
    rule.name || rule.namePattern || '',
    rule.provider ? `(${rule.provider})` : '',
  ].filter(Boolean).join(' ');
}

function ruleSeverity(policy, rule) {
  if (rule.mode === 'recommended') return 'warning';
  return policy.severity === 'blocking' ? 'blocking' : 'warning';
}

function evaluateRuleForSubject(policy, rule, subject, pools) {
  const pool = rule.scope === 'project'
    ? pools.projectAssets
    : rule.scope === 'environment'
      ? pools.environmentAssets
      : pools.projectAssets.concat(pools.environmentAssets);
  const matches = pool.filter((asset) => assetMatchesRule(asset, rule));

  if (rule.mode === 'required' && matches.length === 0) {
    return {
      severity: ruleSeverity(policy, rule),
      mode: rule.mode,
      assetType: rule.assetType,
      scope: rule.scope,
      name: rule.name || null,
      namePattern: rule.namePattern || null,
      provider: rule.provider || null,
      message: `${subject.name} is missing required ${describeRule(rule)}`,
      note: rule.note || null,
    };
  }

  if (rule.mode === 'recommended' && matches.length === 0) {
    return {
      severity: 'warning',
      mode: rule.mode,
      assetType: rule.assetType,
      scope: rule.scope,
      name: rule.name || null,
      namePattern: rule.namePattern || null,
      provider: rule.provider || null,
      message: `${subject.name} is missing recommended ${describeRule(rule)}`,
      note: rule.note || null,
    };
  }

  if (rule.mode === 'forbidden' && matches.length > 0) {
    return {
      severity: ruleSeverity(policy, rule),
      mode: rule.mode,
      assetType: rule.assetType,
      scope: rule.scope,
      name: rule.name || null,
      namePattern: rule.namePattern || null,
      provider: rule.provider || null,
      message: `${subject.name} includes forbidden ${describeRule(rule)}`,
      note: rule.note || null,
      matchedAssets: matches.map((asset) => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        filePath: asset.filePath || null,
      })),
    };
  }

  return null;
}

function summarizeViolations(violations) {
  if (!violations.length) return 'No policy violations';
  const blockingCount = violations.filter((violation) => violation.severity === 'blocking').length;
  const warningCount = violations.filter((violation) => violation.severity !== 'blocking').length;
  const parts = [];
  if (blockingCount) parts.push(`${blockingCount} blocking`);
  if (warningCount) parts.push(`${warningCount} warning`);
  return parts.join(' · ');
}

function buildSubjectStatus(subject, matchedPolicies, violations) {
  const blockingCount = violations.filter((violation) => violation.severity === 'blocking').length;
  const warningCount = violations.filter((violation) => violation.severity !== 'blocking').length;
  return {
    kind: subject.kind,
    subjectId: subject.id,
    projectId: subject.kind === 'project' ? subject.id : null,
    environmentId: subject.kind === 'environment' ? subject.id : subject.environmentId || null,
    name: subject.name,
    path: subject.kind === 'project' ? subject.path : null,
    projectType: subject.kind === 'project' ? subject.projectType || null : null,
    environmentName: subject.environmentName || null,
    environmentType: subject.environmentType || null,
    providers: subject.providers || [],
    status: blockingCount > 0 ? 'broken' : warningCount > 0 ? 'warning' : 'ok',
    violationCount: violations.length,
    blockingCount,
    warningCount,
    summary: summarizeViolations(violations),
    matchedPolicyIds: matchedPolicies.map((policy) => policy.id),
    violations,
  };
}

async function evaluatePolicies({
  policies,
  projects,
  environments,
  localAssets,
  localEnvironmentId,
  getStoredAssetsByEnvironment,
  scanProjectAssets,
  remote,
}) {
  const enabledPolicies = (policies || []).filter((policy) => policy.enabled);
  const envById = new Map((environments || []).map((environment) => [environment.id, environment]));
  const environmentAssetsCache = new Map();
  const projectResults = [];
  const environmentResults = [];

  async function loadEnvironmentAssets(environmentId) {
    if (environmentAssetsCache.has(environmentId)) return environmentAssetsCache.get(environmentId);
    const environment = envById.get(environmentId);
    let assets = [];
    if (environment?.type === 'remote') {
      assets = getStoredAssetsByEnvironment(environmentId) || [];
    } else {
      assets = localAssets || [];
    }
    environmentAssetsCache.set(environmentId, assets);
    return assets;
  }

  async function evaluateProject(project) {
    const environmentId = project.environment_id || localEnvironmentId;
    const environment = envById.get(environmentId);
    const environmentAssets = await loadEnvironmentAssets(environmentId);
    let projectAssets = [];
    const scanIssues = [];
    try {
      projectAssets = project.environment_type === 'remote'
        ? await remote.scanRemoteProjectAssets(environment, project.path)
        : scanProjectAssets(project.path, {
          environmentId,
          environmentType: 'local',
        });
    } catch (err) {
      scanIssues.push({
        id: `scan:${project.id}`,
        policyId: '__runtime__',
        policyName: 'Runtime Scan',
        severity: 'warning',
        mode: 'recommended',
        assetType: 'instruction',
        scope: 'project',
        message: `Unable to evaluate remote project assets for ${project.name}: ${err.message}`,
        note: null,
      });
      projectAssets = [];
    }
    const subject = {
      kind: 'project',
      id: project.id,
      name: project.name,
      path: project.path,
      projectType: project.project_type || null,
      environmentId,
      environmentName: environment?.name || null,
      environmentType: project.environment_type || environment?.type || 'local',
      providers: buildSubjectProviders(project, projectAssets.concat(environmentAssets)),
    };
    const matchedPolicies = enabledPolicies.filter((policy) => policyMatchesSubject(policy, subject));
    const violations = [];
    for (const policy of matchedPolicies) {
      for (let index = 0; index < (policy.rules || []).length; index += 1) {
        const rule = policy.rules[index];
        const violation = evaluateRuleForSubject(policy, rule, subject, { projectAssets, environmentAssets });
        if (!violation) continue;
        violations.push({
          id: `${policy.id}:${index}:${subject.kind}:${subject.id}`,
          policyId: policy.id,
          policyName: policy.name,
          ...violation,
        });
      }
    }
    violations.push(...scanIssues);
    return buildSubjectStatus(subject, matchedPolicies, violations);
  }

  async function evaluateEnvironment(environment) {
    const environmentAssets = await loadEnvironmentAssets(environment.id);
    const subject = {
      kind: 'environment',
      id: environment.id,
      name: environment.name,
      environmentId: environment.id,
      environmentName: environment.name,
      environmentType: environment.type,
      providers: buildSubjectProviders(environment, environmentAssets),
    };
    const matchedPolicies = enabledPolicies.filter((policy) => policyMatchesSubject(policy, subject));
    const violations = [];
    for (const policy of matchedPolicies) {
      for (let index = 0; index < (policy.rules || []).length; index += 1) {
        const rule = policy.rules[index];
        const violation = evaluateRuleForSubject(policy, rule, subject, {
          projectAssets: [],
          environmentAssets,
        });
        if (!violation) continue;
        violations.push({
          id: `${policy.id}:${index}:${subject.kind}:${subject.id}`,
          policyId: policy.id,
          policyName: policy.name,
          ...violation,
        });
      }
    }
    return buildSubjectStatus(subject, matchedPolicies, violations);
  }

  for (const project of projects || []) {
    projectResults.push(await evaluateProject(project));
  }

  for (const environment of environments || []) {
    environmentResults.push(await evaluateEnvironment(environment));
  }

  const byProjectId = Object.fromEntries(projectResults.map((entry) => [entry.projectId, entry]));
  const byEnvironmentId = Object.fromEntries(environmentResults.map((entry) => [entry.environmentId, entry]));
  const allViolations = projectResults.concat(environmentResults);

  return {
    projects: projectResults,
    environments: environmentResults,
    byProjectId,
    byEnvironmentId,
    summary: {
      policyCount: enabledPolicies.length,
      projectCount: projectResults.length,
      environmentCount: environmentResults.length,
      violatingProjectCount: projectResults.filter((entry) => entry.violationCount > 0).length,
      violatingEnvironmentCount: environmentResults.filter((entry) => entry.violationCount > 0).length,
      blockingCount: allViolations.reduce((count, entry) => count + entry.blockingCount, 0),
      warningCount: allViolations.reduce((count, entry) => count + entry.warningCount, 0),
      violationCount: allViolations.reduce((count, entry) => count + entry.violationCount, 0),
    },
  };
}

module.exports = {
  normalizePolicyInput,
  evaluatePolicies,
  assetMatchesRule,
  describeRule,
};
