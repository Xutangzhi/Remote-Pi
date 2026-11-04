type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[]; data?: { hProperties: Record<string, boolean> } };

export function fileLinkPath(href: string): string | undefined {
  let value = href.trim();
  if (!value || value.startsWith('#') || value.startsWith('?') || value.startsWith('//')) return;
  if (/^file:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname && url.hostname !== 'localhost') return;
      value = url.pathname;
    } catch { return; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[^:]+\.[\w]+:\d+(?::\d+)?$/.test(value)) return;
  value = value.split(/[?#]/, 1)[0]!;
  try { value = decodeURIComponent(value); } catch { return; }
  value = value.replace(/:\d+(?::\d+)?$/, '');
  if (!value || /[\u0000-\u001f\\]/.test(value)) return;
  return value;
}

// Only inline code is promoted to a file link; fenced code and existing links stay intact.
export function remarkFileReferences() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || ['link', 'linkReference', 'code'].includes(node.type)) return;
      node.children = node.children.map((child) => {
        if (child.type === 'inlineCode' && child.value) {
          const path = fileLinkPath(child.value);
          if (path && !/\s/.test(path) && (/^(?:\/|\.\.?\/|~\/)/.test(path) || /^(?:[^/\s]+\/)*[^/\s]+\.[a-z\d]{1,12}$/i.test(path))) {
            return { type: 'link', url: child.value, children: [child], data: { hProperties: { 'data-file-reference': true } } };
          }
        }
        visit(child); return child;
      });
    };
    visit(tree);
  };
}

export function createFileReferenceChecker(suggest: (path: string) => Promise<{ path: string }[]>, workspacePath: string, directory = workspacePath) {
  const pending = new Map<string, Promise<boolean>>();
  return async (href: string): Promise<boolean> => {
    try {
      const path = remoteFilePath(href, workspacePath, directory);
      let request = pending.get(path);
      if (!request) {
        // Suggestions can include fuzzy matches and directories. Only an exact file is a link.
        request = suggest(path).then((files) => files.some((file) => file.path === path && !file.path.endsWith('/'))).catch(() => false).finally(() => pending.delete(path));
        pending.set(path, request);
      }
      return await request;
    } catch { return false; }
  };
}

export function filePreviewError(reason: unknown, path: string, workspacePath: string): string {
  const message = (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method 'pi:request': (?:Error: )?/, '');
  const location = path.startsWith('/') || path.startsWith('~/') ? path : `${workspacePath.replace(/\/$/, '')}/${path}`;
  return `无法预览 ${location}：${message === 'Path does not exist' ? '文件不存在。聊天中的路径可能只是示例，或文件尚未创建、已被移动。' : message}`;
}


export function remoteFilePath(href: string, workspacePath: string, directory = workspacePath): string {
  const path = fileLinkPath(href);
  if (!path) throw new Error('无法识别文件路径');
  if (path.startsWith('~/')) return path;
  const normalize = (value: string) => {
    const parts: string[] = [];
    for (const part of value.split('/')) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    return `/${parts.join('/')}`;
  };
  const root = normalize(workspacePath);
  const base = directory.startsWith('/') ? directory : `${root}/${directory}`;
  const absolute = normalize(path.startsWith('/') ? path : `${base}/${path}`);
  const prefix = root === '/' ? '/' : `${root}/`;
  return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute;
}
