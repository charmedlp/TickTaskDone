import { describe, expect, it } from 'vitest';
import type { ProjectDto } from '@ticktaskdone/shared';
import { buildProjectTree, descendantProjectIds, flattenVisibleProjects } from './projectTree';

const project = (overrides: Partial<ProjectDto> & { idProject: number }): ProjectDto => ({
  workspaceId: 1,
  parentProjectId: null,
  name: `P${overrides.idProject}`,
  color: '#888',
  income: 0,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

// 1 -> 2 -> 3 ; 1 -> 4 ; 5 (root)
const projects: ProjectDto[] = [
  project({ idProject: 1, name: 'Alpha' }),
  project({ idProject: 2, name: 'Beta', parentProjectId: 1 }),
  project({ idProject: 3, name: 'Gamma', parentProjectId: 2 }),
  project({ idProject: 4, name: 'Delta', parentProjectId: 1 }),
  project({ idProject: 5, name: 'Epsilon' }),
];

describe('buildProjectTree', () => {
  it('nests by parent and sorts siblings by name, tagging depth', () => {
    const tree = buildProjectTree(projects);
    expect(tree.map((node) => node.project.name)).toEqual(['Alpha', 'Epsilon']);
    const alpha = tree[0];
    expect(alpha.depth).toBe(0);
    expect(alpha.children.map((node) => node.project.name)).toEqual(['Beta', 'Delta']);
    expect(alpha.children[0].children[0].project.name).toBe('Gamma');
    expect(alpha.children[0].children[0].depth).toBe(2);
  });
});

describe('descendantProjectIds', () => {
  it('includes the root and its whole subtree (invalid re-parent targets)', () => {
    expect([...descendantProjectIds(projects, 1)].sort()).toEqual([1, 2, 3, 4]);
    expect([...descendantProjectIds(projects, 5)]).toEqual([5]);
  });
});

describe('flattenVisibleProjects', () => {
  it('drops the subtree of a collapsed node', () => {
    const tree = buildProjectTree(projects);
    const visible = flattenVisibleProjects(tree, new Set([1]), true);
    expect(visible.map((node) => node.project.name)).toEqual(['Alpha', 'Epsilon']);
  });

  it('hides archived projects (and their subtree) unless showArchived', () => {
    const withArchived = projects.map((p) => (p.idProject === 1 ? { ...p, status: 'archived' as const } : p));
    const tree = buildProjectTree(withArchived);
    expect(flattenVisibleProjects(tree, new Set(), false).map((n) => n.project.name)).toEqual(['Epsilon']);
    expect(flattenVisibleProjects(tree, new Set(), true).map((n) => n.project.name)).toContain('Alpha');
  });
});
