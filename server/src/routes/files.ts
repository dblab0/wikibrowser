import { Router } from 'express';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

export const filesRouter = Router();

/**
 * 获取文件内容（支持按行号范围高亮）
 * GET /api/files/content?path={filePath}&startLine={n}&endLine={m}
 * @param req - Express 请求对象，query 包含 path、startLine、endLine
 * @param res - Express 响应对象
 */
filesRouter.get('/content', async (req, res) => {
  const { path: filePath, startLine, endLine } = req.query;

  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_PATH', message: 'File path is required' }
    });
  }

  // 安全检查：只允许访问项目目录下的文件
  const resolvedPath = path.resolve(filePath);

  try {
    if (!existsSync(resolvedPath)) {
      return res.status(404).json({
        success: false,
        error: { code: 'FILE_NOT_FOUND', message: 'File not found' }
      });
    }

    const content = await readFile(resolvedPath, 'utf-8');
    const lines = content.split('\n');

    const startLineNum = startLine ? parseInt(startLine as string, 10) : undefined;
    const endLineNum = endLine ? parseInt(endLine as string, 10) : undefined;

    res.json({
      success: true,
      data: {
        path: filePath,
        totalLines: lines.length,
        lines: lines.map((content, idx) => ({
          lineNumber: idx + 1,
          content,
          highlighted: startLineNum && endLineNum
            ? idx + 1 >= startLineNum && idx + 1 <= endLineNum
            : false,
        })),
      }
    });
  } catch (err) {
    console.error('[FilesRoute] 读取文件失败:', err);
    res.status(500).json({
      success: false,
      error: { code: 'READ_ERROR', message: 'Failed to read file' }
    });
  }
});
