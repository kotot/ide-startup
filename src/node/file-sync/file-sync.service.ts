/**
 * 服务端文件同步服务
 * 处理来自浏览器端的文件同步请求
 */

import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@opensumi/di';
import {
  FileChange,
  FileChangeType,
  BatchSyncRequest,
  BatchSyncResponse,
  InitialPullRequest,
  InitialPullResponse,
  FileNode,
} from '../../common/file-sync';

export const IServerFileSyncService = Symbol('IServerFileSyncService');

export interface IServerFileSyncService {
  /**
   * 处理初始化拉取请求
   */
  handlePull(request: InitialPullRequest): Promise<InitialPullResponse>;

  /**
   * 处理批量同步请求
   */
  handleSync(request: BatchSyncRequest): Promise<BatchSyncResponse>;
}

@Injectable()
export class ServerFileSyncService implements IServerFileSyncService {
  /**
   * 忽略的文件/目录模式
   */
  private ignorePatterns: string[] = [
    'node_modules',
    '.git',
    '.DS_Store',
    '*.log',
    '.idea',
    '.vscode',
    'dist',
    'build',
    'coverage',
    '.env',
    '.env.local',
  ];

  /**
   * 最大文件大小 (10MB)
   */
  private maxFileSize = 10 * 1024 * 1024;

  /**
   * 检查是否应该忽略
   */
  private shouldIgnore(name: string): boolean {
    for (const pattern of this.ignorePatterns) {
      if (pattern.startsWith('*')) {
        // 简单的通配符匹配
        const ext = pattern.substring(1);
        if (name.endsWith(ext)) {
          return true;
        }
      } else if (name === pattern) {
        return true;
      }
    }
    return false;
  }

  /**
   * 递归读取目录
   */
  private async readDirectoryRecursive(
    dirPath: string,
    relativePath: string = ''
  ): Promise<FileNode[]> {
    const nodes: FileNode[] = [];

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (this.shouldIgnore(entry.name)) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        const nodeRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          const children = await this.readDirectoryRecursive(fullPath, nodeRelativePath);
          nodes.push({
            path: entry.name,
            isDirectory: true,
            children,
          });
        } else if (entry.isFile()) {
          try {
            const stats = await fs.promises.stat(fullPath);

            // 跳过过大的文件
            if (stats.size > this.maxFileSize) {
              console.log(`[FileSyncService] Skipping large file: ${nodeRelativePath}`);
              continue;
            }

            // 读取文件内容
            const content = await fs.promises.readFile(fullPath, 'utf-8');

            nodes.push({
              path: entry.name,
              isDirectory: false,
              content,
              size: stats.size,
              mtime: stats.mtimeMs,
            });
          } catch (readError) {
            // 跳过无法读取的文件 (可能是二进制文件)
            console.log(`[FileSyncService] Skipping unreadable file: ${nodeRelativePath}`);
          }
        }
      }
    } catch (error) {
      console.error(`[FileSyncService] Error reading directory: ${dirPath}`, error);
    }

    return nodes;
  }

  /**
   * 处理初始化拉取请求
   */
  async handlePull(request: InitialPullRequest): Promise<InitialPullResponse> {
    const { workspaceDir } = request;

    try {
      // 验证工作区目录
      if (!workspaceDir) {
        return {
          success: false,
          error: 'Workspace directory is required',
          files: [],
          serverTimestamp: Date.now(),
        };
      }

      // 检查目录是否存在
      const stats = await fs.promises.stat(workspaceDir);
      if (!stats.isDirectory()) {
        return {
          success: false,
          error: 'Workspace path is not a directory',
          files: [],
          serverTimestamp: Date.now(),
        };
      }

      // 递归读取目录
      const files = await this.readDirectoryRecursive(workspaceDir);

      console.log(`[FileSyncService] Pull: ${files.length} root entries from ${workspaceDir}`);

      return {
        success: true,
        files,
        serverTimestamp: Date.now(),
      };
    } catch (error) {
      console.error('[FileSyncService] Pull error:', error);
      return {
        success: false,
        error: String(error),
        files: [],
        serverTimestamp: Date.now(),
      };
    }
  }

  /**
   * 处理批量同步请求
   */
  async handleSync(request: BatchSyncRequest): Promise<BatchSyncResponse> {
    const { workspaceDir, changes } = request;
    const failedFiles: Array<{ path: string; error: string }> = [];
    let syncedCount = 0;

    try {
      // 验证工作区目录
      if (!workspaceDir) {
        return {
          success: false,
          error: 'Workspace directory is required',
          syncedCount: 0,
          serverTimestamp: Date.now(),
        };
      }

      // 处理每个变更
      for (const change of changes) {
        const fullPath = path.join(workspaceDir, change.path);

        try {
          switch (change.type) {
            case FileChangeType.Created:
            case FileChangeType.Updated:
              if (change.isDirectory) {
                // 创建目录
                await fs.promises.mkdir(fullPath, { recursive: true });
              } else {
                // 确保父目录存在
                const parentDir = path.dirname(fullPath);
                await fs.promises.mkdir(parentDir, { recursive: true });

                // 写入文件
                await fs.promises.writeFile(fullPath, change.content || '', 'utf-8');
              }
              syncedCount++;
              break;

            case FileChangeType.Deleted:
              try {
                const stats = await fs.promises.stat(fullPath);
                if (stats.isDirectory()) {
                  await fs.promises.rm(fullPath, { recursive: true });
                } else {
                  await fs.promises.unlink(fullPath);
                }
                syncedCount++;
              } catch (deleteError: any) {
                // 文件不存在也算成功
                if (deleteError.code === 'ENOENT') {
                  syncedCount++;
                } else {
                  throw deleteError;
                }
              }
              break;
          }
        } catch (fileError) {
          console.error(`[FileSyncService] Error syncing file: ${change.path}`, fileError);
          failedFiles.push({
            path: change.path,
            error: String(fileError),
          });
        }
      }

      const success = failedFiles.length === 0;

      console.log(
        `[FileSyncService] Sync: ${syncedCount}/${changes.length} files synced to ${workspaceDir}`
      );

      return {
        success,
        syncedCount,
        failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
        serverTimestamp: Date.now(),
      };
    } catch (error) {
      console.error('[FileSyncService] Sync error:', error);
      return {
        success: false,
        error: String(error),
        syncedCount,
        failedFiles,
        serverTimestamp: Date.now(),
      };
    }
  }
}
