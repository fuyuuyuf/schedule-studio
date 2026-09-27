import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bundledTextureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'texture');
const textureDirectory = process.env.SCHEDULE_DATA_DIR
  ? path.join(process.env.SCHEDULE_DATA_DIR, 'stickers') : bundledTextureDirectory;
const imageTypes = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'],
]);
const maxImageBytes = 5 * 1024 * 1024;

function imageFile(name) {
  if (typeof name !== 'string' || !name || path.basename(name) !== name || name === '.' || name === '..') {
    throw new Error('贴纸文件名无效');
  }
  const mime = imageTypes.get(path.extname(name).toLowerCase());
  if (!mime) throw new Error('不支持的贴纸格式');
  const file = path.join(textureDirectory, name);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > maxImageBytes) throw new Error('贴纸不存在或超过 5 MB');
  return { file, mime, stat };
}

export function activate(context) {
  fs.mkdirSync(textureDirectory, { recursive: true });
  if (textureDirectory !== bundledTextureDirectory && fs.existsSync(bundledTextureDirectory)) {
    // 安装目录可能只读，内置贴纸首次复制到用户数据目录后再允许用户增删。
    for (const name of fs.readdirSync(bundledTextureDirectory)) {
      if (!imageTypes.has(path.extname(name).toLowerCase())) continue;
      const destination = path.join(textureDirectory, name);
      if (!fs.existsSync(destination)) fs.copyFileSync(path.join(bundledTextureDirectory, name), destination);
    }
  }

  context.http.register('GET', 'catalog', () => ({
    stickers: fs.readdirSync(textureDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile() && imageTypes.has(path.extname(entry.name).toLowerCase()))
      .map(entry => {
        const stat = fs.statSync(path.join(textureDirectory, entry.name));
        return { name: entry.name, bytes: stat.size, version: stat.mtimeMs };
      })
      .filter(item => item.bytes <= maxImageBytes)
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .slice(0, 100),
  }));

  context.http.register('GET', 'image', ({ query }) => {
    const { file, mime } = imageFile(query.name);
    return { dataUrl: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` };
  });

  context.http.register('GET', 'config', () => ({
    directory: textureDirectory,
    whiteBorder: context.storage.get('whiteBorder', false) === true,
  }));

  context.http.register('PATCH', 'config', ({ body }) => {
    if (typeof body?.whiteBorder !== 'boolean') throw new Error('白边设置必须为布尔值');
    context.storage.set('whiteBorder', body.whiteBorder);
    return { directory: textureDirectory, whiteBorder: body.whiteBorder };
  });

  context.http.register('POST', 'open-directory', async () => {
    fs.mkdirSync(textureDirectory, { recursive: true });
    return await new Promise((resolve, reject) => {
      const child = spawn('explorer.exe', [textureDirectory], { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve({ directory: textureDirectory });
      });
    });
  });
}
