// Pure project-hierarchy helpers (brief §1/§2). Projects nest by `parentProjectId`
// to arbitrary depth ("phases"). Kept separate from the Vue view so the tree
// building and the re-parent cycle guard are unit-testable.
import type { ProjectDto } from '@ticktaskdone/shared';

export interface ProjectNode {
  project: ProjectDto;
  depth: number;
  children: ProjectNode[];
}

const byName = (left: ProjectDto, right: ProjectDto): number => left.name.localeCompare(right.name);

// Nested tree of the root projects (parentProjectId === null), each with its depth
// and children, siblings sorted by name.
export const buildProjectTree = (projects: ProjectDto[]): ProjectNode[] => {
  const childrenOf = new Map<number | null, ProjectDto[]>();
  for (const project of projects) {
    const siblings = childrenOf.get(project.parentProjectId) ?? [];
    siblings.push(project);
    childrenOf.set(project.parentProjectId, siblings);
  }
  const build = (parentId: number | null, depth: number): ProjectNode[] =>
    [...(childrenOf.get(parentId) ?? [])].sort(byName).map((project) => ({
      project,
      depth,
      children: build(project.idProject, depth + 1),
    }));
  return build(null, 0);
};

// A project plus all of its descendants — the invalid targets when re-parenting
// (a project cannot move under itself or its own subtree). The DB trigger also
// guards, but excluding them from the picker avoids a guaranteed error.
export const descendantProjectIds = (projects: ProjectDto[], rootId: number): Set<number> => {
  const childrenOf = new Map<number, ProjectDto[]>();
  for (const project of projects) {
    if (project.parentProjectId !== null) {
      const siblings = childrenOf.get(project.parentProjectId) ?? [];
      siblings.push(project);
      childrenOf.set(project.parentProjectId, siblings);
    }
  }
  const result = new Set<number>([rootId]);
  const stack: number[] = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) {
      break;
    }
    for (const child of childrenOf.get(id) ?? []) {
      if (!result.has(child.idProject)) {
        result.add(child.idProject);
        stack.push(child.idProject);
      }
    }
  }
  return result;
};

// Flatten the tree to a render list, honoring collapsed nodes and the archived
// filter. A node hidden by the filter (or under a collapsed parent) drops its whole
// subtree with it.
export const flattenVisibleProjects = (
  tree: ProjectNode[],
  collapsed: Set<number>,
  showArchived: boolean,
): ProjectNode[] => {
  const out: ProjectNode[] = [];
  const walk = (nodes: ProjectNode[]): void => {
    for (const node of nodes) {
      if (!showArchived && node.project.status === 'archived') {
        continue;
      }
      out.push(node);
      if (!collapsed.has(node.project.idProject)) {
        walk(node.children);
      }
    }
  };
  walk(tree);
  return out;
};
