// 文件扩展名到语言名称的映射（用于代码高亮）
// Shiki 内置支持大部分语言，不需要手动注册

export const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  py: 'python', pyw: 'python',
  json: 'json', jsonc: 'json',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  css: 'css', scss: 'scss', less: 'less',
  sql: 'sql',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', mdx: 'markdown',
  java: 'java',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', h: 'cpp', c: 'c',
  go: 'go',
  rs: 'rust',
  html: 'html', xml: 'xml', svg: 'xml',
  tf: 'hcl',
  vue: 'vue',
  svelte: 'svelte',
  kt: 'kotlin',
  swift: 'swift',
  r: 'r',
  lua: 'lua',
  php: 'php',
  rb: 'ruby',
  scala: 'scala',
  dart: 'dart',
  el: 'elisp',
  ex: 'elixir', exs: 'elixir',
  graphql: 'graphql', gql: 'graphql',
  dockerfile: 'dockerfile',
  toml: 'toml',
  ini: 'ini',
  diff: 'diff',
  make: 'makefile',
};

/**
 * 根据文件名获取对应的编程语言名称
 * @param filename 文件名或文件路径
 * @returns Shiki 语言标识符
 */
export function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXT_LANG_MAP[ext] || 'text';
}