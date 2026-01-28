/**
 * 文件同步服务
 * 负责将浏览器端的文件变更批量同步到服务器
 */

import { Injectable, Autowired } from '@opensumi/di';
import { Emitter, Event, IDisposable, Disposable } from '@opensumi/ide-core-common';
import { IMemoryFileSystem } from './memory-file-system';
import {
  FileChange,
  BatchSyncRequest,
  BatchSyncResponse,
  InitialPullRequest,
  InitialPullResponse,
  FileNode,
  FILE_SYNC_API,
} from '../../common/file-sync';

export const IFileSyncService = Symbol('IFileSyncService');

/**
 * 同步状态
 */
export enum SyncStatus {
  Idle = 'idle',
  Syncing = 'syncing',
  Error = 'error',
}

/**
 * 同步配置
 */
export interface FileSyncConfig {
  /** 服务器地址 */
  serverUrl: string;
  /** 工作区目录 */
  workspaceDir: string;
  /** 自动同步间隔 (毫秒, 0 表示禁用) */
  autoSyncInterval: number;
  /** 变更后的防抖延迟 (毫秒) */
  debounceDelay: number;
  /** 客户端ID */
  clientId?: string;
}

export interface IFileSyncService {
  /** 当前同步状态 */
  readonly status: SyncStatus;

  /** 状态变更事件 */
  onStatusChange: Event<SyncStatus>;

  /** 同步完成事件 */
  onSyncComplete: Event<BatchSyncResponse>;

  /** 初始化并拉取文件 */
  initialize(config: FileSyncConfig): Promise<void>;

  /** 手动触发同步 */
  sync(): Promise<BatchSyncResponse>;

  /** 获取待同步的变更数量 */
  getPendingChangesCount(): number;

  /** 启用/禁用自动同步 */
  setAutoSync(enabled: boolean): void;

  /** 销毁服务 */
  dispose(): void;
}

@Injectable()
export class FileSyncService implements IFileSyncService, IDisposable {
  @Autowired(IMemoryFileSystem)
  private memoryFs: IMemoryFileSystem;

  private config: FileSyncConfig | undefined;
  private _status: SyncStatus = SyncStatus.Idle;
  private autoSyncTimer: any = null;
  private debounceTimer: any = null;
  private disposed = false;

  private _onStatusChange = new Emitter<SyncStatus>();
  readonly onStatusChange: Event<SyncStatus> = this._onStatusChange.event;

  private _onSyncComplete = new Emitter<BatchSyncResponse>();
  readonly onSyncComplete: Event<BatchSyncResponse> = this._onSyncComplete.event;

  get status(): SyncStatus {
    return this._status;
  }

  private setStatus(status: SyncStatus): void {
    if (this._status !== status) {
      this._status = status;
      this._onStatusChange.fire(status);
    }
  }

  /**
   * 初始化同步服务并从服务器拉取文件
   */
  async initialize(config: FileSyncConfig): Promise<void> {
    this.config = config;

    // 生成唯一的客户端ID
    if (!config.clientId) {
      config.clientId = this.generateClientId();
    }

    this.memoryFs.setWorkspaceRoot(config.workspaceDir);

    // 从服务器拉取初始文件
    const files = await this.pullFromServer();
    await this.memoryFs.initialize(files);

    // 监听文件变更
    this.memoryFs.onDidChangeFile((changes) => {
      this.scheduleSync();
    });

    // 启动自动同步
    if (config.autoSyncInterval > 0) {
      this.setAutoSync(true);
    }

    console.log('[FileSyncService] Initialized');
  }

  /**
   * 从服务器拉取文件
   */
  private async pullFromServer(): Promise<FileNode[]> {
    if (!this.config) {
      throw new Error('FileSyncService not initialized');
    }

    const request: InitialPullRequest = {
      workspaceDir: this.config.workspaceDir,
      clientId: this.config.clientId,
    };

    try {
      const response = await fetch(`${this.config.serverUrl}${FILE_SYNC_API.PULL}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Pull failed: ${response.statusText}`);
      }

      const result: InitialPullResponse = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Pull failed');
      }

      console.log(`[FileSyncService] Pulled ${result.files.length} files from server`);
      return result.files;
    } catch (error) {
      console.error('[FileSyncService] Pull error:', error);
      throw error;
    }
  }

  /**
   * 调度同步 (防抖)
   */
  private scheduleSync(): void {
    if (!this.config || this.disposed) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.sync().catch(console.error);
    }, this.config.debounceDelay);
  }

  /**
   * 手动触发同步
   */
  async sync(): Promise<BatchSyncResponse> {
    if (!this.config) {
      throw new Error('FileSyncService not initialized');
    }

    const changes = this.memoryFs.getPendingChanges();
    if (changes.length === 0) {
      const response: BatchSyncResponse = {
        success: true,
        syncedCount: 0,
        serverTimestamp: Date.now(),
      };
      return response;
    }

    this.setStatus(SyncStatus.Syncing);

    try {
      const request: BatchSyncRequest = {
        workspaceDir: this.config.workspaceDir,
        changes,
        timestamp: Date.now(),
        clientId: this.config.clientId,
      };

      const response = await fetch(`${this.config.serverUrl}${FILE_SYNC_API.SYNC}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.statusText}`);
      }

      const result: BatchSyncResponse = await response.json();

      if (result.success) {
        // 清除已同步的变更
        const syncedPaths = changes
          .filter((c) => !result.failedFiles?.some((f) => f.path === c.path))
          .map((c) => c.path);
        this.memoryFs.markChangesSynced(syncedPaths);
        this.setStatus(SyncStatus.Idle);
      } else {
        this.setStatus(SyncStatus.Error);
      }

      console.log(`[FileSyncService] Synced ${result.syncedCount} files`);
      this._onSyncComplete.fire(result);
      return result;
    } catch (error) {
      console.error('[FileSyncService] Sync error:', error);
      this.setStatus(SyncStatus.Error);

      const errorResponse: BatchSyncResponse = {
        success: false,
        error: String(error),
        syncedCount: 0,
        serverTimestamp: Date.now(),
      };
      this._onSyncComplete.fire(errorResponse);
      return errorResponse;
    }
  }

  /**
   * 获取待同步的变更数量
   */
  getPendingChangesCount(): number {
    return this.memoryFs.getPendingChanges().length;
  }

  /**
   * 启用/禁用自动同步
   */
  setAutoSync(enabled: boolean): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }

    if (enabled && this.config && this.config.autoSyncInterval > 0) {
      this.autoSyncTimer = setInterval(() => {
        if (this._status !== SyncStatus.Syncing) {
          this.sync().catch(console.error);
        }
      }, this.config.autoSyncInterval);
    }
  }

  /**
   * 生成客户端ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 销毁服务
   */
  dispose(): void {
    this.disposed = true;

    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this._onStatusChange.dispose();
    this._onSyncComplete.dispose();
  }
}
