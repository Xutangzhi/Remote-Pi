type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[] };

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
            return { type: 'link', url: child.value, children: [child] };
          }
        }
        visit(child); return child;
      });
    };
    visit(tree);
  };
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
