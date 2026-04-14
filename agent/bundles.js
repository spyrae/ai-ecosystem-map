'use strict';

const batch = require('./batch');
const agentIntrospection = require('./agent-introspection');

function bundleTargetLabel(target, resolvedTarget, context = {}) {
  if (target.kind === 'provider') return target.provider;
  if (target.kind === 'project') return context.project?.name || target.projectPath;
  if (target.kind === 'server') return context.server?.name || target.serverId;
  if (target.kind === 'running_agent') {
    const base = context.agent?.name || target.agentId;
    if (resolvedTarget?.kind === 'project') {
      return `${base} → ${context.project?.name || resolvedTarget.projectPath}`;
    }
    return base;
  }
  return 'unknown';
}

function buildBlockedPreview(message, code = 'invalid_target') {
  return {
    ok: true,
    total: 0,
    readyCount: 0,
    blockedCount: 1,
    hasChangesCount: 0,
    operationCount: 0,
    results: [{
      id: code,
      name: 'bundle-target',
      ok: true,
      plan: {
        source: null,
        target: null,
        operations: [],
        issues: [{ level: 'blocking', code, message }],
        canApply: false,
        hasChanges: false,
      },
    }],
  };
}

function resolveRunningAgentTarget(target, opts) {
  const agent = opts.getRunningAgentById(target.agentId);
  if (!agent) {
    return { error: 'Running agent not found', code: 'agent_not_found' };
  }

  const introspection = agent.introspection || agentIntrospection.getCachedIntrospection(agent);
  if (!introspection?.checkedAt) {
    return {
      error: 'Run introspection for this agent first so AEM can resolve the backing project.',
      code: 'agent_not_introspected',
      agent,
    };
  }

  const projectPaths = [...new Set(
    (introspection.assets || [])
      .map((asset) => asset.projectPath)
      .filter(Boolean)
  )];

  if (projectPaths.length !== 1) {
    return {
      error: projectPaths.length === 0
        ? 'This running agent is not tied to a writable local project.'
        : 'This running agent maps to multiple projects. Choose a concrete project target instead.',
      code: projectPaths.length === 0 ? 'agent_missing_project' : 'agent_ambiguous_project',
      agent,
    };
  }

  const project = opts.getProjects().find((entry) => entry.path === projectPaths[0]) || null;
  if (!project || project.environment_type === 'remote') {
    return {
      error: 'Only running agents backed by a local project can receive bundle sync right now.',
      code: 'agent_remote_project_unsupported',
      agent,
      project,
    };
  }

  return {
    agent,
    project,
    resolvedTarget: {
      kind: 'project',
      projectPath: project.path,
      method: target.method || 'symlink',
    },
    targetMeta: {
      resolved_kind: 'project',
      project_id: project.id,
      project_path: project.path,
    },
  };
}

function resolveBundleTarget(target, opts) {
  if (!target?.kind) {
    return { error: 'Bundle target is required', code: 'bundle_target_required' };
  }

  if (target.kind === 'provider') {
    if (!target.provider) return { error: 'Provider is required', code: 'provider_required' };
    return {
      resolvedTarget: {
        kind: 'provider',
        provider: target.provider,
        projectPath: target.projectPath || null,
      },
      targetRef: target.provider,
      targetLabel: bundleTargetLabel(target, null),
      targetMeta: target.projectPath ? { project_path: target.projectPath } : {},
    };
  }

  if (target.kind === 'project') {
    if (!target.projectPath) return { error: 'Project path is required', code: 'project_required' };
    const project = opts.getProjects().find((entry) => entry.path === target.projectPath) || null;
    return {
      resolvedTarget: {
        kind: 'project',
        projectPath: target.projectPath,
        method: target.method || 'symlink',
      },
      targetRef: project?.id || target.projectPath,
      targetLabel: bundleTargetLabel(target, null, { project }),
      targetMeta: project ? { project_id: project.id, project_path: project.path } : { project_path: target.projectPath },
    };
  }

  if (target.kind === 'server') {
    if (!target.serverId) return { error: 'Server is required', code: 'server_required' };
    const server = opts.getEnvironmentById(target.serverId);
    if (!server) return { error: 'Server not found', code: 'server_not_found' };
    return {
      resolvedTarget: {
        kind: 'server',
        serverId: target.serverId,
        direction: 'push',
      },
      targetRef: target.serverId,
      targetLabel: bundleTargetLabel(target, null, { server }),
      targetMeta: {},
    };
  }

  if (target.kind === 'running_agent') {
    const resolved = resolveRunningAgentTarget(target, opts);
    if (resolved.error) return resolved;
    return {
      resolvedTarget: resolved.resolvedTarget,
      targetRef: target.agentId,
      targetLabel: bundleTargetLabel(target, resolved.resolvedTarget, {
        agent: resolved.agent,
        project: resolved.project,
      }),
      targetMeta: resolved.targetMeta,
    };
  }

  return { error: `Unsupported bundle target kind "${target.kind}"`, code: 'unsupported_target_kind' };
}

function buildBundleRequests(bundle, resolvedTarget) {
  return (bundle.items || []).map((item) => ({
    source: {
      assetId: item.assetId || undefined,
      name: item.name,
      type: item.type,
      filePath: item.filePath || undefined,
      providers: item.providers || [],
      projectPath: item.projectPath || undefined,
    },
    target: resolvedTarget,
  }));
}

async function previewBundle(bundle, target, opts) {
  const resolution = resolveBundleTarget(target, opts);
  if (resolution.error) {
    return {
      bundleId: bundle.id,
      bundleVersion: bundle.current_version,
      target: target || null,
      resolvedTarget: null,
      preview: buildBlockedPreview(resolution.error, resolution.code),
    };
  }

  const requests = buildBundleRequests(bundle, resolution.resolvedTarget);
  const preview = await batch.previewBatchSync({ requests }, opts);
  return {
    bundleId: bundle.id,
    bundleVersion: bundle.current_version,
    target: {
      ...target,
      label: resolution.targetLabel,
      ref: resolution.targetRef,
      meta: resolution.targetMeta,
    },
    resolvedTarget: resolution.resolvedTarget,
    preview,
  };
}

async function applyBundle(bundle, target, opts) {
  const previewResult = await previewBundle(bundle, target, opts);
  const readyCount = previewResult.preview?.readyCount || 0;
  const hasChangesCount = previewResult.preview?.hasChangesCount || 0;
  const blockingCount = (previewResult.preview?.results || []).reduce((count, entry) => {
    const hasBlocking = entry.plan?.issues?.some((issue) => issue.level === 'blocking');
    return count + (entry.ok && !hasBlocking ? 0 : 1);
  }, 0);

  if (!readyCount || !hasChangesCount || blockingCount > 0) {
    return {
      ok: false,
      ...previewResult,
      result: null,
      error: 'Bundle preview is blocked or already up to date',
    };
  }

  const requests = buildBundleRequests(bundle, previewResult.resolvedTarget);
  const result = await batch.applyBatchSync({ requests }, opts);
  const success = result.successCount > 0 && result.failureCount === 0;
  opts.recordBundleApplication({
    bundleId: bundle.id,
    bundleVersion: bundle.current_version,
    targetKind: target.kind,
    targetRef: previewResult.target.ref,
    targetLabel: previewResult.target.label,
    targetMeta: {
      ...(previewResult.target.meta || {}),
      resolved_target: previewResult.resolvedTarget,
    },
    lastStatus: success ? 'applied' : (result.successCount > 0 ? 'partial' : 'blocked'),
    lastSummary: success
      ? `Applied ${result.appliedCount} bundle operations`
      : `${result.successCount} succeeded, ${result.failureCount} failed`,
  });

  return {
    ok: success,
    ...previewResult,
    result,
    error: success ? null : 'Bundle apply completed with failures',
  };
}

module.exports = {
  previewBundle,
  applyBundle,
};
