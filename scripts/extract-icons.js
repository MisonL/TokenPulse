import path from 'path';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

// 图标映射配置
const iconMapping = {
  claude: { component: 'Claude', file: 'claude.png' },
  gemini: { component: 'Gemini', file: 'gemini.png' },
  antigravity: { component: 'Google', file: 'antigravity.png' }, // 使用 Google 图标
  kiro: { component: 'Aws', file: 'kiro.png' },
  codex: { component: 'OpenAI', file: 'codex.png', componentType: 'Mono' }, // 使用 Mono 组件
  qwen: { component: 'Qwen', file: 'qwen.png' },
  iflow: { component: 'AlibabaCloud', file: 'iflow.png' }, // 使用 AlibabaCloud 图标
  aistudio: { component: 'GoogleCloud', file: 'aistudio.png' }
};

// 从组件文件中提取 SVG 路径
function extractSVGFromComponent(componentPath) {
  try {
    const content = readFileSync(componentPath, 'utf-8');

    // 提取 SVG viewBox
    const viewBoxMatch = content.match(/viewBox:\s*"([^"]+)"/);
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24';

    // 提取所有 path 元素 - 匹配 JSX 格式
    const paths = [];

    // 模式 1: _jsx("path", { d: "...", fill: "#...", ... }) - 匹配颜色值
    let jsxPathRegex = /_jsx\(\s*"path",\s*\{[^}]*d:\s*"([^"]+)"[^}]*fill:\s*"(#[0-9A-Fa-f]+)"[^}]*\}/g;
    let match;

    while ((match = jsxPathRegex.exec(content)) !== null) {
      paths.push({
        d: match[1],
        fill: match[2]
      });
    }

    // 模式 2: _jsx("path", { d: "...", fill: "currentColor", ... }) - 匹配 currentColor
    jsxPathRegex = /_jsx\(\s*"path",\s*\{[^}]*d:\s*"([^"]+)"[^}]*fill:\s*"currentColor"[^}]*\}/g;
    while ((match = jsxPathRegex.exec(content)) !== null) {
      paths.push({
        d: match[1],
        fill: '#000000' // 使用黑色作为默认颜色
      });
    }

    // 模式 3: _jsx("path", { d: "...", fill: fill, ... }) - 匹配变量引用
    jsxPathRegex = /_jsx\(\s*"path",\s*\{[^}]*d:\s*"([^"]+)"[^}]*fill:\s*fill[^}]*\}/g;
    while ((match = jsxPathRegex.exec(content)) !== null) {
      paths.push({
        d: match[1],
        fill: '#000000' // 使用黑色作为默认颜色
      });
    }

    // 模式 4: 更宽松的模式 - 匹配 d 和 fill 属性
    const loosePathRegex = /d:\s*"([^"]+)"[^}]*fill:\s*"([^"]+)"/g;
    while ((match = loosePathRegex.exec(content)) !== null) {
      const d = match[1];
      const fill = match[2];

      // 跳过 fill 变量引用（如 fill: fill）
      if (fill !== 'fill' && fill !== 'currentColor') {
        paths.push({
          d: d,
          fill: fill
        });
      }
    }

    // 模式 5: 尝试匹配 HTML 格式（作为最后手段）
    if (paths.length === 0) {
      const htmlPathRegex = /<path[^>]*d=["']([^"']+)["'][^>]*fill=["']([^"']+)["'][^>]*\/>/g;
      while ((match = htmlPathRegex.exec(content)) !== null) {
        paths.push({
          d: match[1],
          fill: match[2]
        });
      }
    }

    // 如果仍然没有找到路径，尝试提取所有 d 属性
    if (paths.length === 0) {
      const dRegex = /d:\s*"([^"]+)"/g;
      while ((match = dRegex.exec(content)) !== null) {
        paths.push({
          d: match[1],
          fill: '#000000' // 使用黑色作为默认颜色
        });
      }
    }

    return { viewBox, paths };
  } catch (error) {
    console.error(`Error reading component file: ${componentPath}`, error);
    return null;
  }
}

// 创建 SVG 字符串
function createSVGString(viewBox, paths, size = 128) {
  const pathsStr = paths.map(p => `<path d="${p.d}" fill="${p.fill}" />`).join('\n  ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
  ${pathsStr}
</svg>`;
}

// 主函数
async function main() {
  const iconsDir = path.join(process.cwd(), 'frontend/public/assets/icons');

  // 确保输出目录存在
  mkdirSync(iconsDir, { recursive: true });

  for (const [key, config] of Object.entries(iconMapping)) {
    const componentType = config.componentType || 'Color';
    const componentPath = path.join(
      process.cwd(),
      `frontend/node_modules/@lobehub/icons/es/${config.component}/components/${componentType}.js`
    );

    const svgData = extractSVGFromComponent(componentPath);

    if (!svgData || svgData.paths.length === 0) {
      console.error(`Failed to extract SVG for ${key} - no paths found`);
      continue;
    }

    // 创建 SVG 字符串
    const svgString = createSVGString(svgData.viewBox, svgData.paths);

    // 转换为 PNG
    const outputPath = path.join(iconsDir, config.file);

    try {
      await sharp(Buffer.from(svgString))
        .resize(128, 128)
        .png()
        .toFile(outputPath);

      console.log(`✓ Generated ${config.file} (${svgData.paths.length} paths)`);
    } catch (error) {
      console.error(`Error converting ${key}:`, error);
    }
  }

  console.log('\n✅ All icons generated successfully!');
}

main().catch(console.error);