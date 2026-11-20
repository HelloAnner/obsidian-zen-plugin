/**
 * 将构建产物安装到目标 Obsidian 仓库的插件目录。
 * 插件内置热重载，文件覆盖后会自动重新加载生效。
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = process.env.OBSIDIAN_VAULT_PATH
  ? resolve(process.env.OBSIDIAN_VAULT_PATH)
  : resolve(root, '../notes/soul');
const PLUGIN_ID = 'obsidian-zen-plugin';
const pluginDir = join(VAULT, '.obsidian', 'plugins', PLUGIN_ID);

if (!existsSync(join(VAULT, '.obsidian'))) {
  console.error(`[install] vault not found: ${VAULT}`);
  process.exit(1);
}

mkdirSync(pluginDir, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  copyFileSync(join(root, file), join(pluginDir, file));
}
console.log(`[install] copied to ${pluginDir}`);

// 首次安装时自动启用插件（写入 community-plugins.json）
const enabledPath = join(VAULT, '.obsidian', 'community-plugins.json');
const enabled = existsSync(enabledPath) ? JSON.parse(readFileSync(enabledPath, 'utf8')) : [];
if (!enabled.includes(PLUGIN_ID)) {
  enabled.push(PLUGIN_ID);
  writeFileSync(enabledPath, JSON.stringify(enabled, null, 2));
  console.log(`[install] enabled "${PLUGIN_ID}" in community-plugins.json（若 Obsidian 正在运行，首次需重启一次）`);
}
