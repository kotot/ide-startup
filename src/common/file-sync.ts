/**
 * 文件同步相关的共享类型和接口定义
 */

/**
 * 文件变更类型
 */
export enum FileChangeType {
  Created = 1,
  Updated = 2,
  Deleted = 3,
}

/**
 * 单个文件变更记录
 */
export interface FileChange {
  /** 文件路径 (相对于工作区根目录) */
  path: string;
  /** 变更类型 */
  type: FileChangeType;
  /** 文件内容 (删除时为空) */
  content?: string;
  /** 是否为目录 */
  isDirectory?: boolean;
  /** 文件编码 */
  encoding?: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 批量同步请求
 */
export interface BatchSyncRequest {
  /** 工作区路径 */
  workspaceDir: string;
  /** 变更列表 */
  changes: FileChange[];
  /** 请求时间戳 */
  timestamp: number;
  /** 客户端ID (用于多客户端场景) */
  clientId?: string;
}

/**
 * 同步响应
 */
export interface BatchSyncResponse {
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 同步的文件数量 */
  syncedCount: number;
  /** 失败的文件 */
  failedFiles?: Array<{
    path: string;
    error: string;
  }>;
  /** 服务器时间戳 */
  serverTimestamp: number;
}

/**
 * 初始化拉取请求
 */
export interface InitialPullRequest {
  /** 工作区路径 */
  workspaceDir: string;
  /** 客户端ID */
  clientId?: string;
}

/**
 * 文件节点信息
 */
export interface FileNode {
  /** 文件路径 */
  path: string;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 文件内容 (目录时为空) */
  content?: string;
  /** 文件大小 */
  size?: number;
  /** 最后修改时间 */
  mtime?: number;
  /** 子文件/目录 (仅目录有效) */
  children?: FileNode[];
}

/**
 * 初始化拉取响应
 */
export interface InitialPullResponse {
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 文件树 */
  files: FileNode[];
  /** 服务器时间戳 */
  serverTimestamp: number;
}

/**
 * 同步服务的 Token
 */
export const IFileSyncServiceToken = Symbol('IFileSyncService');

/**
 * 同步 API 路径
 */
export const FILE_SYNC_API = {
  /** 初始化拉取 */
  PULL: '/api/file-sync/pull',
  /** 批量同步 */
  SYNC: '/api/file-sync/sync',
  /** 健康检查 */
  HEALTH: '/api/file-sync/health',
};
